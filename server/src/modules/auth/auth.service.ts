import crypto from 'crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, refreshTokens, userSettings, studyPlans } from '../../db/schema.js';
import { env } from '../../config/env.js';
import type { RegisterInput, LoginInput } from './auth.schemas.js';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_DAYS = 30;
const REFRESH_GRACE_WINDOW_MS = 20 * 1000; // 20 segundos de gracia para tabs concurrentes

// Opciones estandarizadas para Argon2id (mismo costo de memoria y tiempo)
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,
  timeCost: 3,
  outputLen: 32,
};

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateTokens(payload: {
  id: string;
  email: string;
  role: 'user' | 'admin';
  selectedPlanId: string | null;
}) {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

  const rawRefreshToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  return { accessToken, rawRefreshToken, tokenHash, expiresAt };
}

export class AuthService {
  /**
   * Registra un nuevo usuario con contraseña hasheada en Argon2id
   */
  static async register(input: RegisterInput) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (existing.length > 0) {
      const err = new Error('Ya existe una cuenta registrada con este correo electrónico');
      (err as any).status = 409;
      throw err;
    }

    // Hashear con Argon2id (@node-rs/argon2 con N-API binaria nativa)
    const passwordHash = await hash(input.password, ARGON2_OPTIONS);

    // Asignar plan por defecto si no vino provisto
    let planId = input.selectedPlanId || null;
    if (!planId) {
      const defaultPlan = await db
        .select({ id: studyPlans.id })
        .from(studyPlans)
        .where(eq(studyPlans.isActive, true))
        .limit(1);
      if (defaultPlan.length > 0) {
        planId = defaultPlan[0].id;
      }
    }

    // Transacción: crear usuario, settings y refresh token inicial
    const result = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          role: 'user',
          selectedPlanId: planId,
          lastLoginAt: new Date(),
        })
        .returning({
          id: users.id,
          email: users.email,
          role: users.role,
          selectedPlanId: users.selectedPlanId,
        });

      // Crear settings iniciales
      await tx.insert(userSettings).values({
        userId: newUser.id,
        includePromotionsInGPA: true,
        minPassingGrade: 4,
        includeAnalistaTrack: false,
        allowBlockedElectivesPlanning: false,
        includeElectivesInProgress: true,
        soundEnabled: true,
        tutorialCompleted: false,
      });

      const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
        id: newUser.id,
        email: newUser.email,
        role: newUser.role as 'user' | 'admin',
        selectedPlanId: newUser.selectedPlanId,
      });

      await tx.insert(refreshTokens).values({
        userId: newUser.id,
        tokenHash,
        expiresAt,
      });

      return {
        user: newUser,
        accessToken,
        refreshToken: rawRefreshToken,
      };
    });

    return result;
  }

  /**
   * Inicia sesión validando credenciales y emite nuevos tokens
   */
  static async login(input: LoginInput) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    const genericError = new Error('Email o contraseña incorrectos');
    (genericError as any).status = 401;

    if (!user) {
      // Protección contra timing attack / enumeración: correr hash ficticio
      await hash('dummy_password_timing_defense', ARGON2_OPTIONS);
      throw genericError;
    }

    const isValid = await verify(user.passwordHash, input.password);
    if (!isValid) {
      throw genericError;
    }

    // Si el usuario no tiene plan asignado (ej. se registró antes de correr el seed),
    // verificar si ya existe un plan activo para asignarlo automáticamente
    let planId = user.selectedPlanId;
    if (!planId) {
      const defaultPlan = await db
        .select({ id: studyPlans.id })
        .from(studyPlans)
        .where(eq(studyPlans.isActive, true))
        .limit(1);
      if (defaultPlan.length > 0) {
        planId = defaultPlan[0].id;
      }
    }

    // Actualizar last_login_at y plan si fue asignado
    await db
      .update(users)
      .set({
        selectedPlanId: planId,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role as 'user' | 'admin',
      selectedPlanId: planId,
    });

    // Guardar refresh token
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        selectedPlanId: planId,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Rotación de refresh token con ventana de gracia de 20s y detección de reutilización
   */
  static async refresh(rawRefreshToken: string) {
    if (!rawRefreshToken) {
      const err = new Error('Refresh token no provisto');
      (err as any).status = 401;
      throw err;
    }

    const incomingHash = hashToken(rawRefreshToken);

    const [tokenRecord] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, incomingHash))
      .limit(1);

    if (!tokenRecord) {
      const err = new Error('Sesión inválida');
      (err as any).status = 401;
      throw err;
    }

    const now = Date.now();

    // 1. Caso: Token revocado o previamente reemplazado
    if (tokenRecord.revokedAt) {
      const revokedTime = tokenRecord.revokedAt.getTime();
      const elapsed = now - revokedTime;

      // Si cae dentro de la ventana de gracia de 20 segundos (ej. dos pestañas renovando simultáneamente):
      if (elapsed <= REFRESH_GRACE_WINDOW_MS && tokenRecord.replacedByHash) {
        // Encontrar el token de reemplazo activo
        const [replacement] = await db
          .select()
          .from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, tokenRecord.replacedByHash))
          .limit(1);

        if (replacement && !replacement.revokedAt && replacement.expiresAt.getTime() > now) {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, tokenRecord.userId))
            .limit(1);

          if (user) {
            const accessToken = jwt.sign(
              {
                id: user.id,
                email: user.email,
                role: user.role,
                selectedPlanId: user.selectedPlanId,
              },
              env.JWT_SECRET,
              { expiresIn: ACCESS_TOKEN_EXPIRY }
            );

            return {
              user: {
                id: user.id,
                email: user.email,
                role: user.role,
                selectedPlanId: user.selectedPlanId,
              },
              accessToken,
              // Mantener el token actual para no desincronizar
              refreshToken: null,
            };
          }
        }
      }

      // Si está fuera de la ventana de gracia -> DETECCIÓN DE REUTILIZACIÓN (Replay Attack)
      // Revocar INMEDIATAMENTE todos los refresh tokens de este usuario por seguridad
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(refreshTokens.userId, tokenRecord.userId));

      console.warn(`🚨 ALERTA DE SEGURIDAD: Reutilización de refresh token detectada para user_id: ${tokenRecord.userId}. Todos los tokens fueron revocados.`);

      const err = new Error('Sesión comprometida o expirada. Por favor vuelva a iniciar sesión.');
      (err as any).status = 401;
      throw err;
    }

    // 2. Caso: Token vencido por fecha
    if (tokenRecord.expiresAt.getTime() < now) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(refreshTokens.id, tokenRecord.id));

      const err = new Error('Sesión expirada');
      (err as any).status = 401;
      throw err;
    }

    // 3. Caso normal: Rotar token en una transacción
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, tokenRecord.userId))
      .limit(1);

    if (!user) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 401;
      throw err;
    }

    const { accessToken, rawRefreshToken: newRawRefresh, tokenHash: newHash, expiresAt } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role as 'user' | 'admin',
      selectedPlanId: user.selectedPlanId,
    });

    await db.transaction(async (tx) => {
      // Marcar el token anterior como revocado y enlazar su reemplazo
      await tx
        .update(refreshTokens)
        .set({
          revokedAt: new Date(),
          replacedByHash: newHash,
          updatedAt: new Date(),
        })
        .where(eq(refreshTokens.id, tokenRecord.id));

      // Insertar el nuevo token
      await tx.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: newHash,
        expiresAt,
      });
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        selectedPlanId: user.selectedPlanId,
      },
      accessToken,
      refreshToken: newRawRefresh,
    };
  }

  /**
   * Cierra sesión revocando el refresh token
   */
  static async logout(rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, tokenHash));
    }
    return { success: true };
  }

  /**
   * Obtiene datos del usuario autenticado
   */
  static async getMe(userId: string) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        selectedPlanId: users.selectedPlanId,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    // Si aún no tiene plan asignado y ya existe un plan en la BD (post-seed):
    let selectedPlanId = user.selectedPlanId;
    if (!selectedPlanId) {
      const defaultPlan = await db
        .select({ id: studyPlans.id })
        .from(studyPlans)
        .where(eq(studyPlans.isActive, true))
        .limit(1);
      if (defaultPlan.length > 0) {
        selectedPlanId = defaultPlan[0].id;
        await db
          .update(users)
          .set({ selectedPlanId, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      }
    }

    return {
      ...user,
      selectedPlanId,
    };
  }
}

