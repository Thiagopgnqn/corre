import crypto from 'crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { eq, and, isNull, gte, lte, desc, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  users,
  refreshTokens,
  userSettings,
  studyPlans,
  userIdentities,
  emailVerificationCodes,
  subjectProgress,
  electiveAssignments,
  professorReviews,
  subjectEnrollments,
  scheduleProposals,
  userBasket,
  scheduleSelections,
} from '../../db/schema.js';
import { env } from '../../config/env.js';
import { isDisposableEmail } from '../../config/disposableDomains.js';
import { defaultMailer } from '../mailer/mailer.service.js';
import { verifyGoogleCredential } from './googleAuth.service.js';
import type {
  RegisterInput,
  LoginInput,
  GoogleLoginInput,
} from './auth.schemas.js';

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

/**
 * Normaliza una dirección de correo para prevenir multicuentas (Gmail con puntos y tags '+')
 */
export function computeCanonicalEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) return trimmed;
  let localPart = trimmed.slice(0, atIndex);
  let domainPart = trimmed.slice(atIndex + 1);

  if (domainPart === 'googlemail.com') {
    domainPart = 'gmail.com';
  }

  if (domainPart === 'gmail.com') {
    const plusIndex = localPart.indexOf('+');
    if (plusIndex !== -1) {
      localPart = localPart.slice(0, plusIndex);
    }
    localPart = localPart.replace(/\./g, '');
  }

  return `${localPart}@${domainPart}`;
}

/**
 * Hashea un código de 6 dígitos con HMAC-SHA256 y un pepper del servidor
 */
export function hashVerificationCode(rawCode: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(rawCode.trim()).digest('hex');
}

/**
 * Compara en tiempo constante el código provisto contra el hash almacenado
 */
export function verifyCodeHash(inputCode: string, storedHash: string, pepper: string): boolean {
  const inputHash = hashVerificationCode(inputCode, pepper);
  const inputBuffer = Buffer.from(inputHash, 'utf-8');
  const storedBuffer = Buffer.from(storedHash, 'utf-8');
  if (inputBuffer.length !== storedBuffer.length) return false;
  return crypto.timingSafeEqual(inputBuffer, storedBuffer);
}

function generateTokens(payload: {
  id: string;
  email: string;
  role: 'user' | 'admin';
  selectedPlanId: string | null;
  emailVerified: boolean;
}) {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

  const rawRefreshToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  return { accessToken, rawRefreshToken, tokenHash, expiresAt };
}

/**
 * Timestamp de corte de la migración 0003 (adición de verificación de email e identidades).
 * Cuentas creadas antes de esta fecha provienen del sistema anterior y nunca deben eliminarse.
 */
export const MIGRATION_0003_CUTOFF = new Date(1793410567201); // 2026-10-31T01:36:07.201Z

let customDataChecker: ((userId: string) => Promise<boolean> | boolean) | null = null;

export function setUserDataCheckerForTesting(
  fn: ((userId: string) => Promise<boolean> | boolean) | null
) {
  customDataChecker = fn;
}

/**
 * Comprueba si un usuario tiene datos guardados en la base de datos
 * (progreso, electivas, reseñas, cursadas, propuestas, etc.).
 */
export async function userHasAssociatedData(userId: string): Promise<boolean> {
  if (customDataChecker) {
    return await customDataChecker(userId);
  }

  const [hasProgress] = await db
    .select({ id: subjectProgress.id })
    .from(subjectProgress)
    .where(eq(subjectProgress.userId, userId))
    .limit(1);
  if (hasProgress) return true;

  const [hasElectives] = await db
    .select({ id: electiveAssignments.id })
    .from(electiveAssignments)
    .where(eq(electiveAssignments.userId, userId))
    .limit(1);
  if (hasElectives) return true;

  const [hasReviews] = await db
    .select({ id: professorReviews.id })
    .from(professorReviews)
    .where(eq(professorReviews.userId, userId))
    .limit(1);
  if (hasReviews) return true;

  const [hasEnrollments] = await db
    .select({ id: subjectEnrollments.id })
    .from(subjectEnrollments)
    .where(eq(subjectEnrollments.userId, userId))
    .limit(1);
  if (hasEnrollments) return true;

  const [hasProposals] = await db
    .select({ id: scheduleProposals.id })
    .from(scheduleProposals)
    .where(eq(scheduleProposals.userId, userId))
    .limit(1);
  if (hasProposals) return true;

  const [hasBasket] = await db
    .select({ id: userBasket.id })
    .from(userBasket)
    .where(eq(userBasket.userId, userId))
    .limit(1);
  if (hasBasket) return true;

  const [hasSelections] = await db
    .select({ id: scheduleSelections.id })
    .from(scheduleSelections)
    .where(eq(scheduleSelections.userId, userId))
    .limit(1);
  if (hasSelections) return true;

  return false;
}

export class AuthService {
  /**
   * Registra un nuevo usuario con contraseña hasheada en Argon2id y envía código de verificación
   */
  static async register(input: RegisterInput) {
    if (isDisposableEmail(input.email)) {
      const err = new Error(
        'No se permiten correos electrónicos temporales o descartables. Por favor usá tu correo habitual.'
      );
      (err as any).status = 400;
      throw err;
    }

    const canonicalEmail = computeCanonicalEmail(input.email);

    // Buscar si ya existe una cuenta con este email o canonical_email
    const existing = await db
      .select({
        id: users.id,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.canonicalEmail, canonicalEmail))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].emailVerifiedAt !== null) {
        // Verificar si la cuenta verificada existente usa Google
        const googleIdent = await db
          .select({ id: userIdentities.id })
          .from(userIdentities)
          .where(
            and(
              eq(userIdentities.userId, existing[0].id),
              eq(userIdentities.provider, 'google')
            )
          )
          .limit(1);

        if (googleIdent.length > 0) {
          const err = new Error(
            'Ya existe una cuenta con este correo, probá con Continuar con Google'
          );
          (err as any).status = 409;
          throw err;
        }

        const err = new Error('Ya existe una cuenta verificada con este correo electrónico');
        (err as any).status = 409;
        throw err;
      }

      // Si existe pero NO está verificada, esa cuenta no tiene derecho sobre el email:
      // Se elimina la cuenta no verificada previa para permitir crear la nueva
      await db.delete(users).where(eq(users.id, existing[0].id));
    }

    // Hashear contraseña con Argon2id
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

    // Generar código de verificación criptográfico de 6 dígitos
    const rawCode = crypto.randomInt(100000, 1000000).toString();
    const codeHash = hashVerificationCode(rawCode, env.VERIFICATION_CODE_PEPPER);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    // Transacción: crear usuario, settings, código de verificación y refresh token inicial
    const result = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({
          email: input.email,
          canonicalEmail,
          passwordHash,
          role: 'user',
          selectedPlanId: planId,
          emailVerifiedAt: null,
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

      // Guardar código hasheado
      await tx.insert(emailVerificationCodes).values({
        userId: newUser.id,
        codeHash,
        expiresAt: codeExpiresAt,
        attempts: 0,
      });

      // Emitir tokens de sesión (con claim emailVerified: false)
      const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
        id: newUser.id,
        email: newUser.email,
        role: newUser.role as 'user' | 'admin',
        selectedPlanId: newUser.selectedPlanId,
        emailVerified: false,
      });

      await tx.insert(refreshTokens).values({
        userId: newUser.id,
        tokenHash,
        expiresAt,
      });

      return {
        user: {
          ...newUser,
          emailVerified: false,
        },
        accessToken,
        refreshToken: rawRefreshToken,
      };
    });

    // Despacho del código por email mediante MailerService (no rollback si falla)
    let emailDeliveryFailed = false;
    try {
      const sendResult = await defaultMailer.sendVerificationCode({
        to: input.email,
        code: rawCode,
      });
      if (!sendResult.success) {
        emailDeliveryFailed = true;
      }
    } catch {
      emailDeliveryFailed = true;
      console.error('[Auth] Error de transporte enviando correo de verificación al registrar.');
    }

    return {
      ...result,
      emailDeliveryFailed,
    };
  }

  /**
   * Inicio de sesión y registro con Google Identity Services
   */
  static async googleAuth(input: GoogleLoginInput) {
    const googleUser = await verifyGoogleCredential(input.credential);
    const canonicalEmail = computeCanonicalEmail(googleUser.email);

    // 1. Buscar si la identidad de Google (por sub) ya existe
    const [existingIdentity] = await db
      .select({
        id: userIdentities.id,
        userId: userIdentities.userId,
      })
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.provider, 'google'),
          eq(userIdentities.providerUserId, googleUser.sub)
        )
      )
      .limit(1);

    if (existingIdentity) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, existingIdentity.userId))
        .limit(1);

      if (user) {
        // Asegurar que el email quede marcado como verificado
        if (!user.emailVerifiedAt) {
          await db
            .update(users)
            .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }

        let planId = user.selectedPlanId;
        if (!planId) {
          const defaultPlan = await db
            .select({ id: studyPlans.id })
            .from(studyPlans)
            .where(eq(studyPlans.isActive, true))
            .limit(1);
          if (defaultPlan.length > 0) {
            planId = defaultPlan[0].id;
            await db
              .update(users)
              .set({ selectedPlanId: planId, updatedAt: new Date() })
              .where(eq(users.id, user.id));
          }
        }

        const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
          id: user.id,
          email: user.email,
          role: user.role as 'user' | 'admin',
          selectedPlanId: planId,
          emailVerified: true,
        });

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
            emailVerified: true,
          },
          accessToken,
          refreshToken: rawRefreshToken,
        };
      }
    }

    // 2. Si no existía la identidad de Google, buscar cuenta por email
    const [existingUser] = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.canonicalEmail, canonicalEmail),
          eq(users.email, googleUser.email.trim().toLowerCase())
        )
      )
      .limit(1);

    // Plan por defecto
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

    // Caso A: No existe ninguna cuenta con ese email -> crear cuenta verificada
    if (!existingUser) {
      const result = await db.transaction(async (tx) => {
        const [newUser] = await tx
          .insert(users)
          .values({
            email: googleUser.email,
            canonicalEmail,
            passwordHash: null,
            role: 'user',
            selectedPlanId: planId,
            emailVerifiedAt: new Date(),
            lastLoginAt: new Date(),
          })
          .returning({
            id: users.id,
            email: users.email,
            role: users.role,
            selectedPlanId: users.selectedPlanId,
          });

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

        await tx.insert(userIdentities).values({
          userId: newUser.id,
          provider: 'google',
          providerUserId: googleUser.sub,
        });

        const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
          id: newUser.id,
          email: newUser.email,
          role: newUser.role as 'user' | 'admin',
          selectedPlanId: newUser.selectedPlanId,
          emailVerified: true,
        });

        await tx.insert(refreshTokens).values({
          userId: newUser.id,
          tokenHash,
          expiresAt,
        });

        return {
          user: {
            ...newUser,
            emailVerified: true,
          },
          accessToken,
          refreshToken: rawRefreshToken,
        };
      });

      return result;
    }

    // Caso B: Existe una cuenta con ese email y YA está verificada -> vincular Google
    if (existingUser.emailVerifiedAt !== null) {
      const [existingGoogleIdent] = await db
        .select({ id: userIdentities.id })
        .from(userIdentities)
        .where(
          and(
            eq(userIdentities.userId, existingUser.id),
            eq(userIdentities.provider, 'google')
          )
        )
        .limit(1);

      if (!existingGoogleIdent) {
        await db.insert(userIdentities).values({
          userId: existingUser.id,
          provider: 'google',
          providerUserId: googleUser.sub,
        });
      }

      if (!existingUser.canonicalEmail) {
        await db
          .update(users)
          .set({ canonicalEmail, updatedAt: new Date() })
          .where(eq(users.id, existingUser.id));
      }

      const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
        id: existingUser.id,
        email: existingUser.email,
        role: existingUser.role as 'user' | 'admin',
        selectedPlanId: existingUser.selectedPlanId,
        emailVerified: true,
      });

      await db.insert(refreshTokens).values({
        userId: existingUser.id,
        tokenHash,
        expiresAt,
      });

      return {
        user: {
          id: existingUser.id,
          email: existingUser.email,
          role: existingUser.role,
          selectedPlanId: existingUser.selectedPlanId,
          emailVerified: true,
        },
        accessToken,
        refreshToken: rawRefreshToken,
      };
    }

    // Caso C: Existe una cuenta con ese email, creada con contraseña y SIN verificar.
    // Si la cuenta tiene datos guardados (progreso, electivas, reseñas, cursadas, propuestas)
    // o fue creada antes de la migración 0003, NO se elimina: se actualiza a Google conservando sus datos.
    // Solo se elimina si no tiene ningún dato asociado y fue creada después de la migración 0003.
    const isPreMigration0003 = existingUser.createdAt < MIGRATION_0003_CUTOFF;
    const hasData = await userHasAssociatedData(existingUser.id);
    const shouldPreserveAccount = isPreMigration0003 || hasData;

    if (shouldPreserveAccount) {
      const result = await db.transaction(async (tx) => {
        const effectivePlanId = existingUser.selectedPlanId || planId;

        // 1. Borrar password_hash y marcar email_verified_at y canonical_email
        await tx
          .update(users)
          .set({
            passwordHash: null,
            emailVerifiedAt: new Date(),
            canonicalEmail,
            selectedPlanId: effectivePlanId,
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id));

        // 2. Revocar todos sus refresh tokens y sesiones previas
        await tx
          .update(refreshTokens)
          .set({
            revokedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(refreshTokens.userId, existingUser.id));

        // 3. Invalidar cualquier código de verificación previo
        await tx
          .update(emailVerificationCodes)
          .set({
            consumedAt: new Date(),
          })
          .where(eq(emailVerificationCodes.userId, existingUser.id));

        // 4. Vincular identidad de Google si aún no existe
        const [existingGoogleIdent] = await tx
          .select({ id: userIdentities.id })
          .from(userIdentities)
          .where(
            and(
              eq(userIdentities.userId, existingUser.id),
              eq(userIdentities.provider, 'google')
            )
          )
          .limit(1);

        if (!existingGoogleIdent) {
          await tx.insert(userIdentities).values({
            userId: existingUser.id,
            provider: 'google',
            providerUserId: googleUser.sub,
          });
        }

        // 5. Asegurar settings por defecto si no existieran
        const [settings] = await tx
          .select({ userId: userSettings.userId })
          .from(userSettings)
          .where(eq(userSettings.userId, existingUser.id))
          .limit(1);

        if (!settings) {
          await tx.insert(userSettings).values({
            userId: existingUser.id,
            includePromotionsInGPA: true,
            minPassingGrade: 4,
            includeAnalistaTrack: false,
            allowBlockedElectivesPlanning: false,
            includeElectivesInProgress: true,
            soundEnabled: true,
            tutorialCompleted: false,
          });
        }

        // 6. Emitir nueva sesión verificada para esta cuenta
        const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
          id: existingUser.id,
          email: existingUser.email,
          role: existingUser.role as 'user' | 'admin',
          selectedPlanId: effectivePlanId,
          emailVerified: true,
        });

        await tx.insert(refreshTokens).values({
          userId: existingUser.id,
          tokenHash,
          expiresAt,
        });

        return {
          user: {
            id: existingUser.id,
            email: existingUser.email,
            role: existingUser.role,
            selectedPlanId: effectivePlanId,
            emailVerified: true,
          },
          accessToken,
          refreshToken: rawRefreshToken,
        };
      });

      return result;
    }

    // Subcaso C.2: Cuenta creada después de migración 0003, sin verificar y SIN ningún dato asociado.
    // Solo se elimina la cuenta sin verificar si no tiene ningún dato asociado.
    await db.delete(users).where(eq(users.id, existingUser.id));

    const result = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({
          email: googleUser.email,
          canonicalEmail,
          passwordHash: null,
          role: 'user',
          selectedPlanId: planId,
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
        })
        .returning({
          id: users.id,
          email: users.email,
          role: users.role,
          selectedPlanId: users.selectedPlanId,
        });

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

      await tx.insert(userIdentities).values({
        userId: newUser.id,
        provider: 'google',
        providerUserId: googleUser.sub,
      });

      const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
        id: newUser.id,
        email: newUser.email,
        role: newUser.role as 'user' | 'admin',
        selectedPlanId: newUser.selectedPlanId,
        emailVerified: true,
      });

      await tx.insert(refreshTokens).values({
        userId: newUser.id,
        tokenHash,
        expiresAt,
      });

      return {
        user: {
          ...newUser,
          emailVerified: true,
        },
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
    const canonicalEmail = computeCanonicalEmail(input.email);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.canonicalEmail, canonicalEmail))
      .limit(1);

    const genericError = new Error('Email o contraseña incorrectos');
    (genericError as any).status = 401;

    if (!user) {
      // Protección contra timing attack / enumeración: correr hash ficticio
      await hash('dummy_password_timing_defense', ARGON2_OPTIONS);
      throw genericError;
    }

    // Si la cuenta fue creada solo con Google y no tiene contraseña
    if (!user.passwordHash) {
      await hash('dummy_password_timing_defense', ARGON2_OPTIONS);
      throw genericError;
    }

    const isValid = await verify(user.passwordHash, input.password);
    if (!isValid) {
      throw genericError;
    }

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

    const isVerified = Boolean(user.emailVerifiedAt);

    // Actualizar last_login_at
    await db
      .update(users)
      .set({
        selectedPlanId: planId,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Si la cuenta no está verificada, comprobar si ya tiene un código activo o generar uno
    if (!isVerified) {
      const [activeCode] = await db
        .select()
        .from(emailVerificationCodes)
        .where(
          and(
            eq(emailVerificationCodes.userId, user.id),
            isNull(emailVerificationCodes.consumedAt),
            gte(emailVerificationCodes.expiresAt, new Date())
          )
        )
        .orderBy(desc(emailVerificationCodes.createdAt))
        .limit(1);

      if (!activeCode) {
        const rawCode = crypto.randomInt(100000, 1000000).toString();
        const codeHash = hashVerificationCode(rawCode, env.VERIFICATION_CODE_PEPPER);
        await db.insert(emailVerificationCodes).values({
          userId: user.id,
          codeHash,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          attempts: 0,
        });
        defaultMailer
          .sendVerificationCode({ to: user.email, code: rawCode })
          .catch(() => {});
      }
    }

    const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role as 'user' | 'admin',
      selectedPlanId: planId,
      emailVerified: isVerified,
    });

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
        emailVerified: isVerified,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Valida el código de verificación de 6 dígitos ingresado por el usuario
   */
  static async verifyEmail(userId: string, inputCode: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    if (user.emailVerifiedAt !== null) {
      // Ya verificado
      const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
        id: user.id,
        email: user.email,
        role: user.role as 'user' | 'admin',
        selectedPlanId: user.selectedPlanId,
        emailVerified: true,
      });

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
          selectedPlanId: user.selectedPlanId,
          emailVerified: true,
        },
        accessToken,
        refreshToken: rawRefreshToken,
      };
    }

    // Buscar el código activo más reciente
    const [activeCode] = await db
      .select()
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.userId, userId),
          isNull(emailVerificationCodes.consumedAt)
        )
      )
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);

    if (!activeCode) {
      const err = new Error(
        'No hay ningún código de verificación activo. Por favor solicitá un nuevo código.'
      );
      (err as any).status = 400;
      throw err;
    }

    // Comprobar expiración
    if (activeCode.expiresAt.getTime() < Date.now()) {
      await db
        .update(emailVerificationCodes)
        .set({ consumedAt: new Date() })
        .where(eq(emailVerificationCodes.id, activeCode.id));

      const err = new Error(
        'El código de verificación ha expirado. Por favor solicitá uno nuevo.'
      );
      (err as any).status = 400;
      throw err;
    }

    // Comprobar intentos fallidos
    if (activeCode.attempts >= 5) {
      await db
        .update(emailVerificationCodes)
        .set({ consumedAt: new Date() })
        .where(eq(emailVerificationCodes.id, activeCode.id));

      const err = new Error(
        'Se superó el límite de 5 intentos fallidos para este código. Por favor solicitá uno nuevo.'
      );
      (err as any).status = 400;
      throw err;
    }

    // Comparación en tiempo constante con HMAC
    const isMatch = verifyCodeHash(inputCode, activeCode.codeHash, env.VERIFICATION_CODE_PEPPER);

    if (!isMatch) {
      const nextAttempts = activeCode.attempts + 1;
      await db
        .update(emailVerificationCodes)
        .set({
          attempts: nextAttempts,
          consumedAt: nextAttempts >= 5 ? new Date() : null,
        })
        .where(eq(emailVerificationCodes.id, activeCode.id));

      if (nextAttempts >= 5) {
        const err = new Error(
          'Código incorrecto. Superaste el límite de 5 intentos fallidos. Por favor solicitá un nuevo código.'
        );
        (err as any).status = 400;
        throw err;
      }

      const remaining = 5 - nextAttempts;
      const err = new Error(
        `Código incorrecto. Te quedan ${remaining} ${remaining === 1 ? 'intento' : 'intentos'}.`
      );
      (err as any).status = 400;
      throw err;
    }

    // Código correcto: marcar como consumido y verificar usuario
    await db.transaction(async (tx) => {
      await tx
        .update(emailVerificationCodes)
        .set({ consumedAt: new Date() })
        .where(eq(emailVerificationCodes.id, activeCode.id));

      await tx
        .update(users)
        .set({
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    });

    // Reemitir tokens con claim emailVerified: true
    const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role as 'user' | 'admin',
      selectedPlanId: user.selectedPlanId,
      emailVerified: true,
    });

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
        selectedPlanId: user.selectedPlanId,
        emailVerified: true,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Reenvía un nuevo código respetando el cooldown de 60s y el tope de 5 envíos por hora
   */
  static async resendVerificationCode(userId: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    if (user.emailVerifiedAt !== null) {
      const err = new Error('Tu cuenta ya se encuentra verificada.');
      (err as any).status = 400;
      throw err;
    }

    // 1. Cooldown de 60 segundos desde el último código emitido
    const [lastCode] = await db
      .select({ createdAt: emailVerificationCodes.createdAt })
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.userId, userId))
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);

    if (lastCode) {
      const elapsedMs = Date.now() - lastCode.createdAt.getTime();
      if (elapsedMs < 60 * 1000) {
        const waitSec = Math.ceil((60 * 1000 - elapsedMs) / 1000);
        const err = new Error(
          `Por favor esperá ${waitSec} ${waitSec === 1 ? 'segundo' : 'segundos'} antes de solicitar otro código.`
        );
        (err as any).status = 429;
        throw err;
      }
    }

    // 2. Tope de 5 códigos por hora por cuenta
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCodes = await db
      .select({ id: emailVerificationCodes.id })
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.userId, userId),
          gte(emailVerificationCodes.createdAt, oneHourAgo)
        )
      );

    if (recentCodes.length >= 5) {
      const err = new Error(
        'Alcanzaste el límite de 5 envíos de código por hora. Por favor intentá más tarde.'
      );
      (err as any).status = 429;
      throw err;
    }

    // 3. Invalidar todos los códigos activos anteriores
    await db
      .update(emailVerificationCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(emailVerificationCodes.userId, userId),
          isNull(emailVerificationCodes.consumedAt)
        )
      );

    // 4. Generar nuevo código de 6 dígitos
    const rawCode = crypto.randomInt(100000, 1000000).toString();
    const codeHash = hashVerificationCode(rawCode, env.VERIFICATION_CODE_PEPPER);

    await db.insert(emailVerificationCodes).values({
      userId,
      codeHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
    });

    let emailDeliveryFailed = false;
    try {
      const sendResult = await defaultMailer.sendVerificationCode({
        to: user.email,
        code: rawCode,
      });
      if (!sendResult.success) {
        emailDeliveryFailed = true;
      }
    } catch {
      emailDeliveryFailed = true;
      console.error('[Auth] Error de transporte al reenviar código de verificación.');
    }

    return {
      success: true,
      message: 'Código de verificación enviado correctamente.',
      emailDeliveryFailed,
    };
  }

  /**
   * Cancela el registro eliminando la cuenta no verificada para permitir cambiar el email
   */
  static async cancelRegistration(userId: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return { success: true, message: 'Cuenta no encontrada' };
    }

    if (user.emailVerifiedAt !== null) {
      const err = new Error('No podés cancelar una cuenta que ya está verificada.');
      (err as any).status = 400;
      throw err;
    }

    await db.delete(users).where(eq(users.id, userId));
    return { success: true, message: 'Registro cancelado correctamente.' };
  }

  /**
   * Limpieza automática de cuentas no verificadas de más de 7 días
   */
  static async cleanupUnverifiedAccounts(olderThanDays = 7) {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const unverified = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.emailVerifiedAt), lte(users.createdAt, cutoff)));

    let deletedCount = 0;
    for (const u of unverified) {
      await db.delete(users).where(eq(users.id, u.id));
      deletedCount++;
    }
    return deletedCount;
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

    if (tokenRecord.revokedAt) {
      const revokedTime = tokenRecord.revokedAt.getTime();
      const elapsed = now - revokedTime;

      if (elapsed <= REFRESH_GRACE_WINDOW_MS && tokenRecord.replacedByHash) {
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
            const isVerified = Boolean(user.emailVerifiedAt);
            const accessToken = jwt.sign(
              {
                id: user.id,
                email: user.email,
                role: user.role,
                selectedPlanId: user.selectedPlanId,
                emailVerified: isVerified,
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
                emailVerified: isVerified,
              },
              accessToken,
              refreshToken: null,
            };
          }
        }
      }

      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(refreshTokens.userId, tokenRecord.userId));

      console.warn(
        `🚨 ALERTA DE SEGURIDAD: Reutilización de refresh token detectada para user_id: ${tokenRecord.userId}.`
      );

      const err = new Error('Sesión comprometida o expirada. Por favor vuelva a iniciar sesión.');
      (err as any).status = 401;
      throw err;
    }

    if (tokenRecord.expiresAt.getTime() < now) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(refreshTokens.id, tokenRecord.id));

      const err = new Error('Sesión expirada');
      (err as any).status = 401;
      throw err;
    }

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

    const isVerified = Boolean(user.emailVerifiedAt);

    const {
      accessToken,
      rawRefreshToken: newRawRefresh,
      tokenHash: newHash,
      expiresAt,
    } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role as 'user' | 'admin',
      selectedPlanId: user.selectedPlanId,
      emailVerified: isVerified,
    });

    await db.transaction(async (tx) => {
      await tx
        .update(refreshTokens)
        .set({
          revokedAt: new Date(),
          replacedByHash: newHash,
          updatedAt: new Date(),
        })
        .where(eq(refreshTokens.id, tokenRecord.id));

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
        emailVerified: isVerified,
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
   * Obtiene datos del usuario autenticado con estado de verificación e identidades
   */
  static async getMe(userId: string) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        selectedPlanId: users.selectedPlanId,
        emailVerifiedAt: users.emailVerifiedAt,
        passwordHash: users.passwordHash,
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

    // Identidades vinculadas (ej. Google)
    const identities = await db
      .select({ provider: userIdentities.provider })
      .from(userIdentities)
      .where(eq(userIdentities.userId, user.id));

    const authProviders = Array.from(
      new Set([
        ...identities.map((i) => i.provider),
        ...(user.passwordHash ? ['password'] : []),
      ])
    );

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      selectedPlanId,
      emailVerified: Boolean(user.emailVerifiedAt),
      authProviders,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}
