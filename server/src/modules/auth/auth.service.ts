import crypto from 'crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { eq, and, isNull, gte, lte, desc, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  users,
  refreshTokens,
  userSettings,
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
import { logAdminAction } from '../admin/admin.audit.js';
import {
  getUserLiveStatus,
  invalidateUserStatusCache,
} from '../../middlewares/auth.middleware.js';
import { getCatalogStore } from '../catalog/catalog.store.js';
import { getAuthStore } from './auth.store.js';
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

async function resolvePublishedOrDefaultPlanId(
  requestedPlanId?: string | null
): Promise<string | null> {
  const catalog = getCatalogStore();
  if (requestedPlanId) {
    const found = await catalog.resolvePublishedPlan(requestedPlanId);
    if (!found) {
      const err = new Error('El plan de estudio seleccionado no existe o no está publicado');
      (err as any).status = 404;
      throw err;
    }
    return found.plan.id;
  }
  const defaultFound = await catalog.resolvePublishedPlan('current');
  return defaultFound?.plan.id || null;
}

async function ensureUserSelectedPlanId(
  userId: string,
  currentSelectedPlanId: string | null | undefined,
  preResolvedPlanId?: string | null
): Promise<string | null> {
  if (currentSelectedPlanId) {
    return currentSelectedPlanId;
  }
  const fallbackPlanId = preResolvedPlanId ?? (await resolvePublishedOrDefaultPlanId(null));
  if (fallbackPlanId) {
    await getAuthStore().updateUserFields(userId, { selectedPlanId: fallbackPlanId });
    invalidateUserStatusCache(userId);
  }
  return fallbackPlanId;
}

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

    // Asignar plan publicado seleccionado o plan por defecto
    const planId = await resolvePublishedOrDefaultPlanId(input.selectedPlanId);

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
        planId,
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
    const store = getAuthStore();
    const googleUser = await verifyGoogleCredential(input.credential);
    const canonicalEmail = computeCanonicalEmail(googleUser.email);

    // 1. Buscar si la identidad de Google (por sub) ya existe
    const existingIdentity = await store.findGoogleIdentityByProviderUserId(googleUser.sub);

    if (existingIdentity) {
      const user = await store.findUserById(existingIdentity.userId);

      if (user) {
        if (user.status === 'suspended') {
          const err = new Error('Tu cuenta ha sido suspendida. Si creés que se trata de un error, contactá a soporte.');
          (err as any).status = 403;
          (err as any).code = 'ACCOUNT_SUSPENDED';
          throw err;
        }

        // Asegurar que el email quede marcado como verificado
        if (!user.emailVerifiedAt) {
          await store.updateUserFields(user.id, { emailVerifiedAt: new Date() });
        }

        const planId = await ensureUserSelectedPlanId(user.id, user.selectedPlanId);

        const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
          id: user.id,
          email: user.email,
          role: user.role,
          selectedPlanId: planId,
          emailVerified: true,
        });

        await store.insertRefreshToken({
          userId: user.id,
          tokenHash,
          expiresAt,
        });

        if (user.role === 'admin') {
          logAdminAction({
            adminUserId: user.id,
            adminEmail: user.email,
            action: 'admin.login',
            targetType: 'user',
            targetId: user.id,
            details: { method: 'google' },
          }).catch(() => {});
        }

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
    const existingUser = await store.findUserByCanonicalOrEmail(
      canonicalEmail,
      googleUser.email.trim().toLowerCase()
    );

    if (existingUser && existingUser.status === 'suspended') {
      const err = new Error('Tu cuenta ha sido suspendida. Si creés que se trata de un error, contactá a soporte.');
      (err as any).status = 403;
      (err as any).code = 'ACCOUNT_SUSPENDED';
      throw err;
    }

    // Plan publicado seleccionado o plan por defecto
    const planId = await resolvePublishedOrDefaultPlanId(input.selectedPlanId);

    // Caso A: No existe ninguna cuenta con ese email -> crear cuenta verificada
    if (!existingUser) {
      return await store.createGoogleUserWithRefreshToken({
        email: googleUser.email,
        canonicalEmail,
        selectedPlanId: planId,
        providerUserId: googleUser.sub,
        generateSession: (newUser) =>
          generateTokens({
            ...newUser,
            emailVerified: true,
          }),
      });
    }

    // Caso B: Existe una cuenta con ese email y YA está verificada -> vincular Google
    if (existingUser.emailVerifiedAt !== null) {
      const existingGoogleIdent = await store.findUserGoogleIdentity(existingUser.id);

      if (!existingGoogleIdent) {
        await store.insertGoogleIdentity(existingUser.id, googleUser.sub);
      }

      const effectivePlanId = await ensureUserSelectedPlanId(
        existingUser.id,
        existingUser.selectedPlanId,
        planId
      );
      if (!existingUser.canonicalEmail) {
        await store.updateUserFields(existingUser.id, { canonicalEmail });
      }

      const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
        id: existingUser.id,
        email: existingUser.email,
        role: existingUser.role,
        selectedPlanId: effectivePlanId,
        emailVerified: true,
      });

      await store.insertRefreshToken({
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
    }

    // Caso C: Existe una cuenta con ese email, creada con contraseña y SIN verificar.
    // Si la cuenta tiene datos guardados (progreso, electivas, reseñas, cursadas, propuestas)
    // o fue creada antes de la migración 0003, NO se elimina: se actualiza a Google conservando sus datos.
    // Solo se elimina si no tiene ningún dato asociado y fue creada después de la migración 0003.
    const isPreMigration0003 = existingUser.createdAt < MIGRATION_0003_CUTOFF;
    const hasData = await userHasAssociatedData(existingUser.id);
    const shouldPreserveAccount = isPreMigration0003 || hasData;

    if (shouldPreserveAccount) {
      const effectivePlanId = existingUser.selectedPlanId || planId;
      const result = await store.preserveUnverifiedUserWithGoogle({
        userId: existingUser.id,
        canonicalEmail,
        selectedPlanId: effectivePlanId,
        providerUserId: googleUser.sub,
        generateSession: (u) =>
          generateTokens({
            ...u,
            emailVerified: true,
          }),
      });
      if (!existingUser.selectedPlanId && effectivePlanId) {
        invalidateUserStatusCache(existingUser.id);
      }
      return result;
    }

    // Subcaso C.2: Cuenta creada después de migración 0003, sin verificar y SIN ningún dato asociado.
    // Solo se elimina la cuenta sin verificar si no tiene ningún dato asociado.
    return await store.createGoogleUserWithRefreshToken({
      replaceExistingUserId: existingUser.id,
      email: googleUser.email,
      canonicalEmail,
      selectedPlanId: planId,
      providerUserId: googleUser.sub,
      generateSession: (newUser) =>
        generateTokens({
          ...newUser,
          emailVerified: true,
        }),
    });
  }

  /**
   * Inicia sesión validando credenciales y emite nuevos tokens
   */
  static async login(input: LoginInput) {
    const store = getAuthStore();
    const canonicalEmail = computeCanonicalEmail(input.email);

    const user = await store.findUserByCanonicalEmail(canonicalEmail);

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

    if (user.status === 'suspended') {
      const suspendedError = new Error('Tu cuenta ha sido suspendida. Si creés que se trata de un error, contactá a soporte.');
      (suspendedError as any).status = 403;
      (suspendedError as any).code = 'ACCOUNT_SUSPENDED';
      throw suspendedError;
    }

    let planId = user.selectedPlanId;
    if (!planId) {
      planId = await resolvePublishedOrDefaultPlanId(null);
    }

    const isVerified = Boolean(user.emailVerifiedAt);

    // Actualizar last_login_at
    await store.updateUserFields(user.id, {
      selectedPlanId: planId,
      lastLoginAt: new Date(),
    });
    if (!user.selectedPlanId && planId) {
      invalidateUserStatusCache(user.id);
    }

    // Si la cuenta no está verificada, comprobar si ya tiene un código activo o generar uno
    if (!isVerified) {
      const activeCode = await store.findLatestVerificationCode(user.id, true);

      if (!activeCode) {
        const rawCode = crypto.randomInt(100000, 1000000).toString();
        const codeHash = hashVerificationCode(rawCode, env.VERIFICATION_CODE_PEPPER);
        await store.createVerificationCode({
          userId: user.id,
          codeHash,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });
        defaultMailer
          .sendVerificationCode({ to: user.email, code: rawCode })
          .catch(() => {});
      }
    }

    const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      selectedPlanId: planId,
      emailVerified: isVerified,
    });

    await store.insertRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    if (user.role === 'admin') {
      logAdminAction({
        adminUserId: user.id,
        adminEmail: user.email,
        action: 'admin.login',
        targetType: 'user',
        targetId: user.id,
        details: { method: 'password' },
      }).catch(() => {});
    }

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
    const store = getAuthStore();
    const user = await store.findUserById(userId);

    if (!user) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    if (user.emailVerifiedAt !== null) {
      // Ya verificado
      const effectivePlanId = await ensureUserSelectedPlanId(user.id, user.selectedPlanId);
      const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
        id: user.id,
        email: user.email,
        role: user.role,
        selectedPlanId: effectivePlanId,
        emailVerified: true,
      });

      await store.insertRefreshToken({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          selectedPlanId: effectivePlanId,
          emailVerified: true,
        },
        accessToken,
        refreshToken: rawRefreshToken,
      };
    }

    // Buscar el código activo más reciente
    const activeCode = await store.findLatestVerificationCode(userId, false);

    if (!activeCode) {
      const err = new Error(
        'No hay ningún código de verificación activo. Por favor solicitá un nuevo código.'
      );
      (err as any).status = 400;
      throw err;
    }

    // Comprobar expiración
    if (activeCode.expiresAt.getTime() < Date.now()) {
      await store.consumeVerificationCode(activeCode.id);

      const err = new Error(
        'El código de verificación ha expirado. Por favor solicitá uno nuevo.'
      );
      (err as any).status = 400;
      throw err;
    }

    // Comprobar intentos fallidos
    if (activeCode.attempts >= 5) {
      await store.consumeVerificationCode(activeCode.id);

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
      await store.incrementVerificationAttempts(
        activeCode.id,
        nextAttempts,
        nextAttempts >= 5 ? new Date() : null
      );

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
    const effectivePlanId = user.selectedPlanId || (await resolvePublishedOrDefaultPlanId(null));
    await store.completeEmailVerification({
      codeId: activeCode.id,
      userId,
      selectedPlanId: !user.selectedPlanId && effectivePlanId ? effectivePlanId : undefined,
    });
    if (!user.selectedPlanId && effectivePlanId) {
      invalidateUserStatusCache(user.id);
    }

    // Reemitir tokens con claim emailVerified: true
    const { accessToken, rawRefreshToken, tokenHash, expiresAt } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      selectedPlanId: effectivePlanId,
      emailVerified: true,
    });

    await store.insertRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        selectedPlanId: effectivePlanId,
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

    const store = getAuthStore();
    const incomingHash = hashToken(rawRefreshToken);
    const tokenRecord = await store.findRefreshTokenByHash(incomingHash);

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
        const replacement = await store.findRefreshTokenByHash(tokenRecord.replacedByHash);

        if (replacement && !replacement.revokedAt && replacement.expiresAt.getTime() > now) {
          const user = await store.findUserById(tokenRecord.userId);

          if (user) {
            const effectivePlanId = await ensureUserSelectedPlanId(user.id, user.selectedPlanId);
            const isVerified = Boolean(user.emailVerifiedAt);
            const accessToken = jwt.sign(
              {
                id: user.id,
                email: user.email,
                role: user.role,
                selectedPlanId: effectivePlanId,
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
                selectedPlanId: effectivePlanId,
                emailVerified: isVerified,
              },
              accessToken,
              refreshToken: null,
            };
          }
        }
      }

      await store.revokeAllUserRefreshTokens(tokenRecord.userId);

      console.warn(
        `🚨 ALERTA DE SEGURIDAD: Reutilización de refresh token detectada para user_id: ${tokenRecord.userId}.`
      );

      const err = new Error('Sesión comprometida o expirada. Por favor vuelva a iniciar sesión.');
      (err as any).status = 401;
      throw err;
    }

    if (tokenRecord.expiresAt.getTime() < now) {
      await store.revokeRefreshToken(tokenRecord.id);

      const err = new Error('Sesión expirada');
      (err as any).status = 401;
      throw err;
    }

    const liveUser = await getUserLiveStatus(tokenRecord.userId);
    const dbUser =
      !liveUser || liveUser.selectedPlanId === undefined
        ? await store.findUserById(tokenRecord.userId)
        : null;
    const user = liveUser
      ? {
          id: liveUser.id,
          email: liveUser.email,
          role: liveUser.role,
          status: liveUser.status,
          emailVerifiedAt: liveUser.emailVerified ? new Date() : null,
          selectedPlanId:
            liveUser.selectedPlanId !== undefined
              ? liveUser.selectedPlanId
              : (dbUser?.selectedPlanId ?? null),
        }
      : dbUser;

    if (!user) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 401;
      throw err;
    }

    if (user.status === 'suspended') {
      await store.revokeAllUserRefreshTokens(user.id);
      const err = new Error('Tu cuenta ha sido suspendida. Si creés que se trata de un error, contactá a soporte.');
      (err as any).status = 403;
      (err as any).code = 'ACCOUNT_SUSPENDED';
      throw err;
    }

    const isVerified = Boolean(user.emailVerifiedAt);
    const effectivePlanId = await ensureUserSelectedPlanId(user.id, user.selectedPlanId);

    const {
      accessToken,
      rawRefreshToken: newRawRefresh,
      tokenHash: newHash,
      expiresAt,
    } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      selectedPlanId: effectivePlanId,
      emailVerified: isVerified,
    });

    await store.rotateRefreshToken({
      oldTokenId: tokenRecord.id,
      userId: user.id,
      newHash,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        selectedPlanId: effectivePlanId,
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
      await getAuthStore().logoutByTokenHash(tokenHash);
    }
    return { success: true };
  }

  /**
   * Obtiene datos del usuario autenticado con estado de verificación e identidades
   */
  static async getMe(userId: string) {
    const store = getAuthStore();
    const user = await store.findUserById(userId);

    if (!user) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    const selectedPlanId = await ensureUserSelectedPlanId(user.id, user.selectedPlanId);

    // Identidades vinculadas (ej. Google)
    const identityProviders = await store.listUserIdentityProviders(user.id);

    const authProviders = Array.from(
      new Set([
        ...identityProviders,
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
