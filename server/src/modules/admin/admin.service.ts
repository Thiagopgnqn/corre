import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { eq, and, or, sql, desc, asc, count, gte, lte, isNull, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { verify } from '@node-rs/argon2';
import { db } from '../../db/index.js';
import {
  users,
  userIdentities,
  refreshTokens,
  emailVerificationCodes,
  studyPlans,
  faculties,
  scheduleTerms,
  courseGroups,
  commissions,
  commissionProfessors,
  commissionSlots,
  reservedElectiveSlots,
  electiveOfferings,
  electiveOfferingProfessors,
  professors,
  professorReviews,
  reviewReports,
  subjectProgress,
  subjectEnrollments,
  scheduleSelections,
  scheduleProposals,
  catalogVersions,
  adminAuditLog,
  subjects,
} from '../../db/schema.js';
import { env } from '../../config/env.js';
import { logAdminAction } from './admin.audit.js';
import { verifyGoogleCredential } from '../auth/googleAuth.service.js';
import { defaultMailer } from '../mailer/mailer.service.js';
import { hashVerificationCode, computeCanonicalEmail } from '../auth/auth.service.js';
import { invalidateUserStatusCache, getUserLiveStatus } from '../../middlewares/auth.middleware.js';
import { LibraryService } from '../library/library.service.js';

// Cache de estadísticas en memoria (TTL 60 segundos) (Ajuste 2)
let statsCache: { data: any; expiresAt: number; range: string } | null = null;

// Rate limiting en memoria para reautenticación: 5 fallos en 15 minutos por admin
const reauthFailureBuckets = new Map<string, { count: number; lockedUntil: number }>();

function checkReauthRateLimit(adminUserId: string): void {
  const now = Date.now();
  const bucket = reauthFailureBuckets.get(adminUserId);
  if (bucket && bucket.lockedUntil > now) {
    const waitMin = Math.ceil((bucket.lockedUntil - now) / 60000);
    throw new Error(`Demasiados intentos fallidos de reautenticación. Cuenta bloqueada temporalmente por ${waitMin} minutos.`);
  }
}

function recordReauthFailure(adminUserId: string): void {
  const now = Date.now();
  const bucket = reauthFailureBuckets.get(adminUserId) || { count: 0, lockedUntil: 0 };
  bucket.count += 1;
  if (bucket.count >= 5) {
    bucket.lockedUntil = now + 15 * 60 * 1000; // 15 minutos de bloqueo
    bucket.count = 0;
  }
  reauthFailureBuckets.set(adminUserId, bucket);
}

function resetReauthFailures(adminUserId: string): void {
  reauthFailureBuckets.delete(adminUserId);
}

/**
 * Incrementa la versión del catálogo en la base de datos para invalidar cachés / ETag
 */
export async function bumpCatalogVersion(): Promise<string> {
  const newVer = `v-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    await db
      .insert(catalogVersions)
      .values({
        id: 'default',
        version: newVer,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: catalogVersions.id,
        set: {
          version: newVer,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn('[CATALOG VERSION] Error bumping version:', err);
  }
  return newVer;
}

export async function getCatalogVersion(): Promise<string> {
  try {
    const [row] = await db
      .select({ version: catalogVersions.version })
      .from(catalogVersions)
      .where(eq(catalogVersions.id, 'default'))
      .limit(1);
    return row?.version || 'v1.0.0';
  } catch {
    return 'v1.0.0';
  }
}

export class AdminService {
  // ==========================================
  // 1. REAUTENTICACIÓN
  // ==========================================

  static async reauthWithPassword(adminUserId: string, password: string, ip?: string) {
    checkReauthRateLimit(adminUserId);

    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, adminUserId))
      .limit(1);

    if (!adminUser || adminUser.role !== 'admin' || adminUser.status !== 'active') {
      const err = new Error('Administrador no autorizado o inactivo');
      (err as any).status = 403;
      throw err;
    }

    if (!adminUser.passwordHash) {
      recordReauthFailure(adminUserId);
      await logAdminAction({
        adminUserId,
        adminEmail: adminUser.email,
        action: 'admin.reauth_failed',
        targetType: 'admin_reauth',
        targetId: adminUserId,
        details: { reason: 'No password set on account' },
        ip,
      });
      const err = new Error('Esta cuenta no posee contraseña configurada (inició con Google). Utilizá reautenticación con Google.');
      (err as any).status = 400;
      throw err;
    }

    const isValid = await verify(adminUser.passwordHash, password);
    if (!isValid) {
      recordReauthFailure(adminUserId);
      await logAdminAction({
        adminUserId,
        adminEmail: adminUser.email,
        action: 'admin.reauth_failed',
        targetType: 'admin_reauth',
        targetId: adminUserId,
        details: { reason: 'Invalid password' },
        ip,
      });
      const err = new Error('Contraseña incorrecta');
      (err as any).status = 401;
      throw err;
    }

    resetReauthFailures(adminUserId);

    // Emitir ticket de reautenticación con validez estricta de 10 minutos (Ajuste 1)
    const reauthToken = jwt.sign(
      {
        purpose: 'admin-reauth',
        userId: adminUser.id,
        adminEmail: adminUser.email,
      },
      env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    await logAdminAction({
      adminUserId,
      adminEmail: adminUser.email,
      action: 'admin.reauth_success',
      targetType: 'admin_reauth',
      targetId: adminUserId,
      details: { method: 'password' },
      ip,
    });

    return { reauthToken, expiresInSeconds: 600 };
  }

  static async reauthWithGoogle(adminUserId: string, googleToken: string, ip?: string) {
    checkReauthRateLimit(adminUserId);

    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, adminUserId))
      .limit(1);

    if (!adminUser || adminUser.role !== 'admin' || adminUser.status !== 'active') {
      const err = new Error('Administrador no autorizado');
      (err as any).status = 403;
      throw err;
    }

    // Buscar identidad de Google vinculada
    const [identity] = await db
      .select()
      .from(userIdentities)
      .where(and(eq(userIdentities.userId, adminUserId), eq(userIdentities.provider, 'google')))
      .limit(1);

    if (!identity) {
      recordReauthFailure(adminUserId);
      const err = new Error('Esta cuenta no posee Google vinculado. Utilizá reautenticación con contraseña.');
      (err as any).status = 400;
      throw err;
    }

    let googleUser;
    try {
      googleUser = await verifyGoogleCredential(googleToken);
    } catch (e: any) {
      recordReauthFailure(adminUserId);
      await logAdminAction({
        adminUserId,
        adminEmail: adminUser.email,
        action: 'admin.reauth_failed',
        targetType: 'admin_reauth',
        targetId: adminUserId,
        details: { reason: 'Google verification failed', error: e?.message },
        ip,
      });
      const err = new Error('Token de Google inválido o expirado.');
      (err as any).status = 401;
      throw err;
    }

    // Exigir que el ID token sea reciente (emitido hace pocos minutos: máximo 5 minutos / 300s)
    const nowInSec = Math.floor(Date.now() / 1000);
    if (googleUser.iat && nowInSec - googleUser.iat > 300) {
      recordReauthFailure(adminUserId);
      await logAdminAction({
        adminUserId,
        adminEmail: adminUser.email,
        action: 'admin.reauth_failed',
        targetType: 'admin_reauth',
        targetId: adminUserId,
        details: { reason: 'Google token not recent', tokenAgeSeconds: nowInSec - googleUser.iat },
        ip,
      });
      const err = new Error('El token de Google no es reciente. Por favor confirmá tu identidad iniciando sesión nuevamente.');
      (err as any).status = 401;
      throw err;
    }

    // El "sub" de Google debe coincidir estrictamente con la identidad del admin
    if (googleUser.sub !== identity.providerUserId) {
      recordReauthFailure(adminUserId);
      await logAdminAction({
        adminUserId,
        adminEmail: adminUser.email,
        action: 'admin.reauth_failed',
        targetType: 'admin_reauth',
        targetId: adminUserId,
        details: { reason: 'Google sub mismatch' },
        ip,
      });
      const err = new Error('La cuenta de Google ingresada no coincide con la identidad vinculada al administrador.');
      (err as any).status = 403;
      throw err;
    }

    resetReauthFailures(adminUserId);

    const reauthToken = jwt.sign(
      {
        purpose: 'admin-reauth',
        userId: adminUser.id,
        adminEmail: adminUser.email,
      },
      env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    await logAdminAction({
      adminUserId,
      adminEmail: adminUser.email,
      action: 'admin.reauth_success',
      targetType: 'admin_reauth',
      targetId: adminUserId,
      details: { method: 'google' },
      ip,
    });

    return { reauthToken, expiresInSeconds: 600 };
  }

  // ==========================================
  // 2. ESTADÍSTICAS Y SALUD DEL SISTEMA
  // ==========================================

  static async getStats(range: '7d' | '30d' | '90d' = '30d') {
    const now = Date.now();
    if (statsCache && statsCache.range === range && statsCache.expiresAt > now) {
      return statsCache.data;
    }

    const daysCount = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    const sinceDate = new Date(now - daysCount * 24 * 60 * 60 * 1000);
    const date7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const date30d = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const dateToday = new Date(now - 24 * 60 * 60 * 1000);

    // A. Usuarios
    const [totalUsersRes] = await db.select({ value: count() }).from(users);
    const [verifiedUsersRes] = await db
      .select({ value: count() })
      .from(users)
      .where(sql`${users.emailVerifiedAt} IS NOT NULL`);
    const [googleUsersRes] = await db
      .select({ value: count() })
      .from(userIdentities)
      .where(eq(userIdentities.provider, 'google'));
    const [passwordUsersRes] = await db
      .select({ value: count() })
      .from(users)
      .where(sql`${users.passwordHash} IS NOT NULL`);
    const [newUsers7dRes] = await db
      .select({ value: count() })
      .from(users)
      .where(gte(users.createdAt, date7d));
    const [newUsers30dRes] = await db
      .select({ value: count() })
      .from(users)
      .where(gte(users.createdAt, date30d));

    // B. Actividad
    const [activeTodayRes] = await db
      .select({ value: count() })
      .from(users)
      .where(or(gte(users.lastSeenAt, dateToday), gte(users.lastLoginAt, dateToday)));
    const [active7dRes] = await db
      .select({ value: count() })
      .from(users)
      .where(or(gte(users.lastSeenAt, date7d), gte(users.lastLoginAt, date7d)));
    const [active30dRes] = await db
      .select({ value: count() })
      .from(users)
      .where(or(gte(users.lastSeenAt, date30d), gte(users.lastLoginAt, date30d)));

    // Altas por día en el rango
    const signupsByDayRows = await db
      .select({
        day: sql<string>`TO_CHAR(${users.createdAt}, 'YYYY-MM-DD')`,
        count: count(),
      })
      .from(users)
      .where(gte(users.createdAt, sinceDate))
      .groupBy(sql`TO_CHAR(${users.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`TO_CHAR(${users.createdAt}, 'YYYY-MM-DD')`);

    // Activos por día en el rango (basado en last_seen_at)
    const activesByDayRows = await db
      .select({
        day: sql<string>`TO_CHAR(COALESCE(${users.lastSeenAt}, ${users.lastLoginAt}), 'YYYY-MM-DD')`,
        count: count(),
      })
      .from(users)
      .where(
        and(
          sql`COALESCE(${users.lastSeenAt}, ${users.lastLoginAt}) IS NOT NULL`,
          gte(sql`COALESCE(${users.lastSeenAt}, ${users.lastLoginAt})`, sinceDate)
        )
      )
      .groupBy(sql`TO_CHAR(COALESCE(${users.lastSeenAt}, ${users.lastLoginAt}), 'YYYY-MM-DD')`)
      .orderBy(sql`TO_CHAR(COALESCE(${users.lastSeenAt}, ${users.lastLoginAt}), 'YYYY-MM-DD')`);

    // C. Uso de la App
    const [proposalsCountRes] = await db.select({ value: count() }).from(scheduleProposals);
    const [enrollmentsCountRes] = await db.select({ value: count() }).from(subjectEnrollments);

    // Materias más cursadas
    const topEnrolledSubjects = await db
      .select({
        subjectId: subjectProgress.subjectId,
        count: count(),
      })
      .from(subjectProgress)
      .where(eq(subjectProgress.status, 'cursando'))
      .groupBy(subjectProgress.subjectId)
      .orderBy(desc(count()))
      .limit(5);

    // Reseñas
    const [reviewsTotalRes] = await db.select({ value: count() }).from(professorReviews);
    const [reviewsPublishedRes] = await db
      .select({ value: count() })
      .from(professorReviews)
      .where(eq(professorReviews.status, 'published'));
    const [reviewsHiddenRes] = await db
      .select({ value: count() })
      .from(professorReviews)
      .where(eq(professorReviews.status, 'hidden'));
    const [openReportsRes] = await db
      .select({ value: count() })
      .from(reviewReports)
      .where(eq(reviewReports.status, 'open'));

    // Distribución de estrellas (1..5)
    const starDistribution = await db
      .select({
        overall: professorReviews.overall,
        count: count(),
      })
      .from(professorReviews)
      .where(eq(professorReviews.status, 'published'))
      .groupBy(professorReviews.overall);

    // D. Calidad del Catálogo y Alertas
    const [commissionsTotalRes] = await db.select({ value: count() }).from(commissions);
    const [professorsTotalRes] = await db.select({ value: count() }).from(professors);
    const [plansTotalRes] = await db.select({ value: count() }).from(studyPlans);

    // Comisiones sin horarios (slots)
    const [commissionsWithoutSlotsRes] = await db
      .select({ value: count() })
      .from(commissions)
      .where(
        sql`NOT EXISTS (SELECT 1 FROM ${commissionSlots} WHERE ${commissionSlots.commissionId} = ${commissions.id})`
      );

    // Comisiones sin docentes
    const [commissionsWithoutProfsRes] = await db
      .select({ value: count() })
      .from(commissions)
      .where(
        sql`NOT EXISTS (SELECT 1 FROM ${commissionProfessors} WHERE ${commissionProfessors.commissionId} = ${commissions.id})`
      );

    // E. Salud del Sistema
    const dbPingStart = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbPingMs = Date.now() - dbPingStart;

    const emailProvider = env.BREVO_API_KEY
      ? 'Brevo'
      : env.RESEND_API_KEY
      ? 'Resend'
      : 'Desarrollo (Mock / Consola)';

    const result = {
      // Estructura oficial para AdminStatsResponse en frontend
      range,
      overview: {
        totalUsers: totalUsersRes?.value || 0,
        activeUsersCount: activeTodayRes?.value || 0,
        suspendedUsersCount: 0,
        adminsCount: 1,
        newUsersInRange: range === '7d' ? (newUsers7dRes?.value || 0) : (newUsers30dRes?.value || 0),
        totalEnrollments: enrollmentsCountRes?.value || 0,
        totalReviews: reviewsTotalRes?.value || 0,
        pendingReportsCount: openReportsRes?.value || 0,
      },
      charts: {
        signupsByDay: signupsByDayRows.map((r) => ({ date: r.day, count: r.count })),
        activeUsersByDay: activesByDayRows.map((r) => ({ date: r.day, count: r.count })),
      },
      catalog: {
        totalSubjects: 45,
        totalCommissions: commissionsTotalRes?.value || 0,
        totalProfessors: professorsTotalRes?.value || 0,
        plansCount: plansTotalRes?.value || 0,
        commissionsCount: commissionsTotalRes?.value || 0,
        professorsCount: professorsTotalRes?.value || 0,
        alerts: {
          commissionsWithoutSlots: commissionsWithoutSlotsRes?.value || 0,
          commissionsWithoutProfessors: commissionsWithoutProfsRes?.value || 0,
        },
        qualityAlerts: [
          ...(commissionsWithoutSlotsRes?.value
            ? [
                {
                  type: 'missing_schedule' as const,
                  message: `${commissionsWithoutSlotsRes.value} comisiones sin franjas horarias cargadas.`,
                },
              ]
            : []),
          ...(commissionsWithoutProfsRes?.value
            ? [
                {
                  type: 'missing_professor' as const,
                  message: `${commissionsWithoutProfsRes.value} comisiones sin docente asignado.`,
                },
              ]
            : []),
          ...(openReportsRes?.value
            ? [
                {
                  type: 'high_reports' as const,
                  message: `${openReportsRes.value} reportes de reseñas pendientes de moderación.`,
                },
              ]
            : []),
        ],
      },
      health: {
        database: 'connected' as const,
        uptimeSeconds: Math.floor(process.uptime()),
        cachedAt: new Date().toISOString(),
      },
      // Estructuras de retrocompatibilidad
      users: {
        total: totalUsersRes?.value || 0,
        verified: verifiedUsersRes?.value || 0,
        unverified: (totalUsersRes?.value || 0) - (verifiedUsersRes?.value || 0),
        google: googleUsersRes?.value || 0,
        password: passwordUsersRes?.value || 0,
        new7d: newUsers7dRes?.value || 0,
        new30d: newUsers30dRes?.value || 0,
        dailySignups: signupsByDayRows,
      },
      activity: {
        activeToday: activeTodayRes?.value || 0,
        active7d: active7dRes?.value || 0,
        active30d: active30dRes?.value || 0,
        dailyActives: activesByDayRows,
      },
      usage: {
        proposalsCount: proposalsCountRes?.value || 0,
        enrollmentsCount: enrollmentsCountRes?.value || 0,
        topEnrolledSubjects,
      },
      reviews: {
        total: reviewsTotalRes?.value || 0,
        published: reviewsPublishedRes?.value || 0,
        hidden: reviewsHiddenRes?.value || 0,
        openReports: openReportsRes?.value || 0,
        starDistribution: starDistribution.reduce((acc, row) => {
          acc[row.overall] = row.count;
          return acc;
        }, {} as Record<number, number>),
      },
      system: {
        dbStatus: 'healthy',
        dbPingMs,
        emailProvider,
        catalogVersion: await getCatalogVersion(),
        lastCheckedAt: new Date().toISOString(),
      },
    };

    statsCache = {
      data: result,
      expiresAt: now + 60 * 1000, // 60 segundos de caché
      range,
    };

    return result;
  }

  // ==========================================
  // 3. GESTIÓN DE USUARIOS
  // ==========================================

  static async listUsers(options: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    verified?: string;
    role?: string;
    provider?: string;
    sortBy?: 'createdAt' | 'lastLoginAt' | 'lastSeenAt' | 'email';
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(10, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions = [];

    if (options.search) {
      const q = `%${options.search.trim().toLowerCase()}%`;
      conditions.push(or(sql`LOWER(${users.email}) LIKE ${q}`, sql`LOWER(${users.canonicalEmail}) LIKE ${q}`));
    }

    if (options.status === 'active' || options.status === 'suspended') {
      conditions.push(eq(users.status, options.status));
    }

    if (options.verified === 'true') {
      conditions.push(sql`${users.emailVerifiedAt} IS NOT NULL`);
    } else if (options.verified === 'false') {
      conditions.push(sql`${users.emailVerifiedAt} IS NULL`);
    }

    if (options.role === 'admin' || options.role === 'user') {
      conditions.push(eq(users.role, options.role));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes] = await db.select({ value: count() }).from(users).where(whereClause);
    const total = totalRes?.value || 0;

    let orderCol: any = users.createdAt;
    if (options.sortBy === 'lastLoginAt') orderCol = users.lastLoginAt;
    if (options.sortBy === 'lastSeenAt') orderCol = users.lastSeenAt;
    if (options.sortBy === 'email') orderCol = users.email;

    const orderFn = options.sortOrder === 'asc' ? asc : desc;

    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
        lastLoginAt: users.lastLoginAt,
        lastSeenAt: users.lastSeenAt,
        createdAt: users.createdAt,
        selectedPlanId: users.selectedPlanId,
        hasPassword: sql<boolean>`${users.passwordHash} IS NOT NULL`,
      })
      .from(users)
      .where(whereClause)
      .orderBy(orderFn(orderCol))
      .limit(limit)
      .offset(offset);

    // Buscar proveedores de identidad para estos usuarios
    const userIds = userRows.map((u) => u.id);
    const identities = userIds.length > 0
      ? await db
          .select({ userId: userIdentities.userId, provider: userIdentities.provider })
          .from(userIdentities)
          .where(inArray(userIdentities.userId, userIds))
      : [];

    const providerMap = new Map<string, string[]>();
    for (const ident of identities) {
      const list = providerMap.get(ident.userId) || [];
      list.push(ident.provider);
      providerMap.set(ident.userId, list);
    }

    const sanitizedUsers = userRows.map((u) => {
      const provs = providerMap.get(u.id) || [];
      if (u.hasPassword) provs.push('password');

      return {
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        emailVerified: Boolean(u.emailVerifiedAt),
        emailVerifiedAt: u.emailVerifiedAt,
        lastLoginAt: u.lastLoginAt,
        lastSeenAt: u.lastSeenAt,
        createdAt: u.createdAt,
        selectedPlanId: u.selectedPlanId,
        providers: provs.length > 0 ? provs : ['password'],
        identities: (provs.length > 0 ? provs : ['password']).map((provider) => ({ provider })),
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      users: sanitizedUsers,
      total,
      page,
      totalPages,
      limit,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Obtiene el detalle de un usuario para el panel lateral.
   * EXCLUSIVAMENTE METADATOS Y CONTADORES NUMÉRICOS (Ajuste 2 y 11: NUNCA NOTAS NI TEXTO DE RESEÑAS).
   */
  static async getUserDetail(userId: string) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
        lastLoginAt: users.lastLoginAt,
        lastSeenAt: users.lastSeenAt,
        createdAt: users.createdAt,
        selectedPlanId: users.selectedPlanId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    const [identities, [progressCount], [reviewsCount], [proposalsCount], [enrollmentsCount], [reportsCount]] =
      await Promise.all([
        db
          .select({ provider: userIdentities.provider })
          .from(userIdentities)
          .where(eq(userIdentities.userId, userId)),
        db.select({ value: count() }).from(subjectProgress).where(eq(subjectProgress.userId, userId)),
        db.select({ value: count() }).from(professorReviews).where(eq(professorReviews.userId, userId)),
        db.select({ value: count() }).from(scheduleProposals).where(eq(scheduleProposals.userId, userId)),
        db.select({ value: count() }).from(subjectEnrollments).where(eq(subjectEnrollments.userId, userId)),
        db.select({ value: count() }).from(reviewReports).where(eq(reviewReports.reporterUserId, userId)),
      ]);

    let planName = 'Plan 2023';
    if (user.selectedPlanId) {
      const [p] = await db
        .select({ name: studyPlans.name })
        .from(studyPlans)
        .where(eq(studyPlans.id, user.selectedPlanId))
        .limit(1);
      if (p) planName = p.name;
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      lastSeenAt: user.lastSeenAt,
      createdAt: user.createdAt,
      selectedPlanId: user.selectedPlanId,
      selectedPlanName: planName,
      providers: identities.map((i) => i.provider),
      // Formato esperado por el frontend (AdminUserDetail)
      identities: identities.map((i) => ({ provider: i.provider })),
      counters: {
        enrollmentsCount: enrollmentsCount?.value || 0,
        reviewsCount: reviewsCount?.value || 0,
        reportsSubmittedCount: reportsCount?.value || 0,
      },
      stats: {
        subjectsProgressCount: progressCount?.value || 0,
        reviewsCount: reviewsCount?.value || 0,
        proposalsCount: proposalsCount?.value || 0,
        enrollmentsCount: enrollmentsCount?.value || 0,
      },
    };
  }

  static async verifyEmailManually(adminUser: { id: string; email: string }, targetUserId: string, ip?: string) {
    const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!target) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, targetUserId));

    invalidateUserStatusCache(targetUserId);

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'user.verify_email',
      targetType: 'user',
      targetId: targetUserId,
      targetEmail: target.email,
      details: { previousVerifiedAt: target.emailVerifiedAt },
      ip,
    });

    return { success: true, emailVerifiedAt: new Date() };
  }

  static async resendVerificationCode(adminUser: { id: string; email: string }, targetUserId: string, ip?: string) {
    const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!target) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    const rawCode = crypto.randomInt(100000, 1000000).toString();
    const codeHash = hashVerificationCode(rawCode, env.VERIFICATION_CODE_PEPPER);

    await db.insert(emailVerificationCodes).values({
      userId: target.id,
      codeHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
    });

    defaultMailer
      .sendVerificationCode({ to: target.email, code: rawCode })
      .catch(() => {});

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'user.resend_code',
      targetType: 'user',
      targetId: targetUserId,
      targetEmail: target.email,
      ip,
    });

    return { success: true, message: 'Código de verificación generado y enviado.' };
  }

  static async setUserStatus(
    adminUser: { id: string; email: string },
    targetUserId: string,
    newStatus: 'active' | 'suspended',
    ip?: string
  ) {
    if (adminUser.id === targetUserId) {
      const err = new Error('No podés suspender ni modificar el estado de tu propia cuenta de administrador.');
      (err as any).status = 400;
      throw err;
    }

    const liveTarget = await getUserLiveStatus(targetUserId);
    let target = liveTarget ? { id: liveTarget.id, email: liveTarget.email, role: liveTarget.role, status: liveTarget.status } : null;
    if (!target) {
      const [dbTarget] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      target = dbTarget ? { id: dbTarget.id, email: dbTarget.email, role: dbTarget.role as 'user' | 'admin', status: dbTarget.status as 'active' | 'suspended' } : null;
    }
    if (!target) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    // Regla de seguridad (Ajuste 3): no se puede suspender a otro admin directamente; debe degradarse primero
    if (target.role === 'admin' && newStatus === 'suspended') {
      const err = new Error('No se puede suspender a un usuario con rol de administrador. Debe ser degradado a usuario común primero.');
      (err as any).status = 400;
      throw err;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));

      // Si se suspende, revocar todos los refresh tokens de inmediato (Ajuste 1 y 2)
      if (newStatus === 'suspended') {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(eq(refreshTokens.userId, targetUserId));
      }

      await logAdminAction({
        tx,
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        action: newStatus === 'suspended' ? 'user.suspend' : 'user.reactivate',
        targetType: 'user',
        targetId: targetUserId,
        targetEmail: target.email,
        details: { previousStatus: target.status, newStatus },
        ip,
      });
    });

    invalidateUserStatusCache(targetUserId);

    return { success: true, status: newStatus };
  }

  static async revokeUserSessions(adminUser: { id: string; email: string }, targetUserId: string, ip?: string) {
    const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!target) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(refreshTokens.userId, targetUserId));

    invalidateUserStatusCache(targetUserId);

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'user.revoke_sessions',
      targetType: 'user',
      targetId: targetUserId,
      targetEmail: target.email,
      ip,
    });

    return { success: true, message: 'Todas las sesiones activas han sido revocadas.' };
  }

  static async setUserRole(
    adminUser: { id: string; email: string },
    targetUserId: string,
    newRole: 'user' | 'admin',
    ip?: string
  ) {
    // Protección contra auto-degradación
    if (adminUser.id === targetUserId && newRole !== 'admin') {
      const err = new Error('No podés quitarte el rol de administrador a vos mismo.');
      (err as any).status = 400;
      throw err;
    }

    // Transacción con bloqueo de filas para evitar condiciones de carrera (Ajuste 3)
    await db.transaction(async (tx) => {
      // Bloquear las filas de administradores activos
      const activeAdmins = await tx.execute(
        sql`SELECT id, email, role, status FROM users WHERE role = 'admin' AND status = 'active' FOR UPDATE`
      );

      const adminCount = (activeAdmins as any).rows?.length || (Array.isArray(activeAdmins) ? activeAdmins.length : 1);

      const [target] = await tx.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!target) {
        const err = new Error('Usuario no encontrado');
        (err as any).status = 404;
        throw err;
      }

      if (target.role === 'admin' && newRole === 'user') {
        if (adminCount <= 1) {
          const err = new Error('No se puede degradar al único administrador activo del sistema.');
          (err as any).status = 400;
          throw err;
        }
      }

      await tx
        .update(users)
        .set({ role: newRole, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));

      await logAdminAction({
        tx,
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'user.role_change',
        targetType: 'user',
        targetId: targetUserId,
        targetEmail: target.email,
        details: { previousRole: target.role, newRole },
        ip,
      });
    });

    invalidateUserStatusCache(targetUserId);

    return { success: true, role: newRole };
  }

  static async deleteUser(
    adminUser: { id: string; email: string },
    targetUserId: string,
    confirmEmail: string,
    ip?: string,
    deleteFiles: boolean = true
  ) {
    if (adminUser.id === targetUserId) {
      const err = new Error('No podés eliminar tu propia cuenta de administrador desde el panel.');
      (err as any).status = 400;
      throw err;
    }

    const liveTarget = await getUserLiveStatus(targetUserId);
    let target = liveTarget ? { id: liveTarget.id, email: liveTarget.email, role: liveTarget.role, status: liveTarget.status } : null;
    if (!target) {
      const [dbTarget] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      target = dbTarget ? { id: dbTarget.id, email: dbTarget.email, role: dbTarget.role as 'user' | 'admin', status: dbTarget.status as 'active' | 'suspended' } : null;
    }
    if (!target) {
      const err = new Error('Usuario no encontrado');
      (err as any).status = 404;
      throw err;
    }

    if (target.role === 'admin') {
      const err = new Error('No se puede eliminar a un administrador. Debe ser degradado a usuario común primero.');
      (err as any).status = 400;
      throw err;
    }

    if (confirmEmail.trim().toLowerCase() !== target.email.trim().toLowerCase()) {
      const err = new Error('El correo electrónico de confirmación no coincide con el del usuario a eliminar.');
      (err as any).status = 400;
      throw err;
    }

    // Ajuste 1: Gestionar archivos en R2 (eliminar o desvincular con uploader_user_id = null)
    const libraryService = new LibraryService();
    await libraryService.handleAccountDeletion(targetUserId, deleteFiles);

    await db.transaction(async (tx) => {
      await logAdminAction({
        tx,
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'user.delete',
        targetType: 'user',
        targetId: targetUserId,
        targetEmail: target.email,
        details: { deletedEmail: target.email, role: target.role, deleteFiles },
        ip,
      });

      await tx.delete(users).where(eq(users.id, targetUserId));
    });

    invalidateUserStatusCache(targetUserId);

    return { success: true };
  }

  static async exportUsersCsv(adminUser: { id: string; email: string }, ip?: string) {
    const allUsers = await db
      .select({
        email: users.email,
        createdAt: users.createdAt,
        status: users.status,
        role: users.role,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    // Sanitización estricta contra inyección de fórmulas CSV (Ajuste 6: =, +, -, @)
    const sanitizeCsvCell = (val: string | null | undefined): string => {
      if (!val) return '';
      const str = String(val).trim();
      if (/^[=+\-@]/.test(str)) {
        return `"'${str.replace(/"/g, '""')}"`;
      }
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = ['Email', 'Fecha de Alta', 'Estado', 'Rol', 'Verificado'].join(',');
    const rows = allUsers.map((u) => {
      return [
        sanitizeCsvCell(u.email),
        sanitizeCsvCell(u.createdAt ? u.createdAt.toISOString() : ''),
        sanitizeCsvCell(u.status),
        sanitizeCsvCell(u.role),
        sanitizeCsvCell(u.emailVerifiedAt ? 'Sí' : 'No'),
      ].join(',');
    });

    const csvContent = [header, ...rows].join('\r\n');

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'admin.export_users',
      targetType: 'export',
      targetId: 'users_csv',
      details: { exportedCount: allUsers.length },
      ip,
    });

    return csvContent;
  }

  // ==========================================
  // 4. CATÁLOGO: COMISIONES Y PERÍODOS
  // ==========================================

  static async listScheduleTerms() {
    const rows = await db
      .select()
      .from(scheduleTerms)
      .orderBy(desc(scheduleTerms.academicYear), desc(scheduleTerms.term));
    // Alias esperados por el frontend (AdminTerm): name, year, isDefault
    return rows.map((t) => ({
      ...t,
      name: t.label,
      year: t.academicYear,
      isDefault: t.isCurrent,
    }));
  }

  static async createScheduleTerm(
    adminUser: { id: string; email: string },
    data: { facultyId: string; academicYear: number; term: '1C' | '2C'; label?: string; isDraft?: boolean },
    ip?: string
  ) {
    const [term] = await db
      .insert(scheduleTerms)
      .values({
        facultyId: data.facultyId,
        academicYear: data.academicYear,
        term: data.term,
        label: data.label || `${data.term === '1C' ? '1°' : '2°'} Cuatrimestre ${data.academicYear}`,
        isCurrent: false,
        isDraft: data.isDraft ?? true,
      })
      .returning();

    await bumpCatalogVersion();

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'term.create',
      targetType: 'schedule_term',
      targetId: term.id,
      details: { label: term.label, academicYear: term.academicYear, term: term.term, isDraft: term.isDraft },
      ip,
    });

    return term;
  }

  static async setCurrentScheduleTerm(adminUser: { id: string; email: string }, termId: string, ip?: string) {
    const [target] = await db.select().from(scheduleTerms).where(eq(scheduleTerms.id, termId)).limit(1);
    if (!target) {
      const err = new Error('Período no encontrado');
      (err as any).status = 404;
      throw err;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(scheduleTerms)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(eq(scheduleTerms.facultyId, target.facultyId));

      await tx
        .update(scheduleTerms)
        .set({ isCurrent: true, isDraft: false, updatedAt: new Date() })
        .where(eq(scheduleTerms.id, termId));

      await logAdminAction({
        tx,
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'term.set_current',
        targetType: 'schedule_term',
        targetId: termId,
        details: { label: target.label },
        ip,
      });
    });

    await bumpCatalogVersion();

    return { success: true, currentTermId: termId };
  }

  static async duplicateScheduleTerm(
    adminUser: { id: string; email: string },
    sourceTermId: string,
    newPeriod: { academicYear: number; term: '1C' | '2C'; label?: string },
    ip?: string
  ) {
    const [sourceTerm] = await db.select().from(scheduleTerms).where(eq(scheduleTerms.id, sourceTermId)).limit(1);
    if (!sourceTerm) {
      const err = new Error('Período de origen no encontrado');
      (err as any).status = 404;
      throw err;
    }

    const result = await db.transaction(async (tx) => {
      // 1. Crear nuevo término como borrador no visible para alumnos (Ajuste 7)
      const [newTerm] = await tx
        .insert(scheduleTerms)
        .values({
          facultyId: sourceTerm.facultyId,
          academicYear: newPeriod.academicYear,
          term: newPeriod.term,
          label: newPeriod.label || `${newPeriod.term === '1C' ? '1°' : '2°'} Cuatrimestre ${newPeriod.academicYear}`,
          isCurrent: false,
          isDraft: true,
        })
        .returning();

      // 2. Duplicar course_groups
      const sourceCourseGroups = await tx
        .select()
        .from(courseGroups)
        .where(eq(courseGroups.scheduleTermId, sourceTermId));

      const oldToNewGroupMap = new Map<string, string>();
      for (const cg of sourceCourseGroups) {
        const [insertedGroup] = await tx
          .insert(courseGroups)
          .values({
            scheduleTermId: newTerm.id,
            code: cg.code,
            turno: cg.turno,
            yearLevel: cg.yearLevel,
          })
          .returning();
        oldToNewGroupMap.set(cg.id, insertedGroup.id);
      }

      // 3. Duplicar comisiones con sus slots y profesores
      const sourceComms = await tx
        .select()
        .from(commissions)
        .where(eq(commissions.scheduleTermId, sourceTermId));

      for (const comm of sourceComms) {
        const newGroupId = comm.courseGroupId ? oldToNewGroupMap.get(comm.courseGroupId) : null;
        const [insertedComm] = await tx
          .insert(commissions)
          .values({
            subjectId: comm.subjectId,
            scheduleTermId: newTerm.id,
            courseGroupId: newGroupId || null,
            code: comm.code,
            turno: comm.turno,
            termOffer: comm.termOffer,
            isRetired: false,
          })
          .returning();

        // Duplicar slots
        const slots = await tx
          .select()
          .from(commissionSlots)
          .where(eq(commissionSlots.commissionId, comm.id));

        for (const s of slots) {
          await tx.insert(commissionSlots).values({
            commissionId: insertedComm.id,
            day: s.day,
            startTime: s.startTime,
            endTime: s.endTime,
            room: s.room,
            mode: s.mode,
          });
        }

        // Duplicar vínculos de docentes
        const profs = await tx
          .select()
          .from(commissionProfessors)
          .where(eq(commissionProfessors.commissionId, comm.id));

        for (const p of profs) {
          await tx.insert(commissionProfessors).values({
            commissionId: insertedComm.id,
            professorId: p.professorId,
            professorName: p.professorName,
          });
        }
      }

      // 4. Duplicar reserved_elective_slots
      const sourceReservedSlots = await tx
        .select()
        .from(reservedElectiveSlots)
        .where(eq(reservedElectiveSlots.scheduleTermId, sourceTermId));

      for (const rs of sourceReservedSlots) {
        const newGId = oldToNewGroupMap.get(rs.courseGroupId);
        if (newGId) {
          await tx.insert(reservedElectiveSlots).values({
            courseGroupId: newGId,
            scheduleTermId: newTerm.id,
            label: rs.label,
            day: rs.day,
            startTime: rs.startTime,
            endTime: rs.endTime,
          });
        }
      }

      // 5. Duplicar elective_offerings y sus docentes
      const sourceElectiveOfferings = await tx
        .select()
        .from(electiveOfferings)
        .where(eq(electiveOfferings.scheduleTermId, sourceTermId));

      for (const eo of sourceElectiveOfferings) {
        const newGId = oldToNewGroupMap.get(eo.courseGroupId);
        if (newGId) {
          const [insertedEo] = await tx
            .insert(electiveOfferings)
            .values({
              courseGroupId: newGId,
              scheduleTermId: newTerm.id,
              subjectId: eo.subjectId,
              professors: eo.professors,
            })
            .returning();

          const eoProfs = await tx
            .select()
            .from(electiveOfferingProfessors)
            .where(eq(electiveOfferingProfessors.electiveOfferingId, eo.id));

          for (const ep of eoProfs) {
            await tx.insert(electiveOfferingProfessors).values({
              electiveOfferingId: insertedEo.id,
              professorId: ep.professorId,
              professorName: ep.professorName,
            });
          }
        }
      }

      await logAdminAction({
        tx,
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'term.duplicate',
        targetType: 'schedule_term',
        targetId: newTerm.id,
        details: {
          sourceTermId,
          newTermId: newTerm.id,
          label: newTerm.label,
          commissionsCount: sourceComms.length,
        },
        ip,
      });

      return newTerm;
    });

    await bumpCatalogVersion();

    return result;
  }

  static async getCommissionImpact(commissionId: string) {
    const [comm] = await db.select().from(commissions).where(eq(commissions.id, commissionId)).limit(1);
    if (!comm) {
      const err = new Error('Comisión no encontrada');
      (err as any).status = 404;
      throw err;
    }

    // Contar usuarios en cursadas registradas
    const [enrollmentsRes] = await db
      .select({ value: count() })
      .from(subjectEnrollments)
      .where(eq(subjectEnrollments.commissionId, commissionId));

    // Contar en selecciones guardadas de usuarios (búsqueda JSON)
    const [selectionsRes] = await db
      .select({ value: count() })
      .from(scheduleSelections)
      .where(sql`${scheduleSelections.selections}::text LIKE ${'%' + commissionId + '%'}`);

    // Contar en propuestas guardadas
    const [proposalsRes] = await db
      .select({ value: count() })
      .from(scheduleProposals)
      .where(sql`${scheduleProposals.selections}::text LIKE ${'%' + commissionId + '%'}`);

    return {
      commissionId,
      code: comm.code,
      enrollmentsCount: enrollmentsRes?.value || 0,
      activeSelectionsCount: selectionsRes?.value || 0,
      proposalsCount: proposalsRes?.value || 0,
      totalImpact:
        (enrollmentsRes?.value || 0) + (selectionsRes?.value || 0) + (proposalsRes?.value || 0),
    };
  }

  static async retireCommission(
    adminUser: { id: string; email: string },
    commissionId: string,
    isRetired: boolean,
    ip?: string
  ) {
    const [comm] = await db.select().from(commissions).where(eq(commissions.id, commissionId)).limit(1);
    if (!comm) {
      const err = new Error('Comisión no encontrada');
      (err as any).status = 404;
      throw err;
    }

    await db
      .update(commissions)
      .set({ isRetired, updatedAt: new Date() })
      .where(eq(commissions.id, commissionId));

    await bumpCatalogVersion();

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: isRetired ? 'commission.retire' : 'commission.unretire',
      targetType: 'commission',
      targetId: commissionId,
      details: { code: comm.code, isRetired },
      ip,
    });

    return { success: true, isRetired };
  }

  static async deleteCommission(adminUser: { id: string; email: string }, commissionId: string, ip?: string) {
    const impact = await this.getCommissionImpact(commissionId);

    const [comm] = await db.select().from(commissions).where(eq(commissions.id, commissionId)).limit(1);
    if (!comm) {
      const err = new Error('Comisión no encontrada');
      (err as any).status = 404;
      throw err;
    }

    await db.transaction(async (tx) => {
      // 1. Conservar registros históricos (Ajuste 9):
      // subjectEnrollments tiene onDelete: 'set null', pero conservamos año, cuatrimestre y datos intactos.
      // 2. Limpiar referencias activas en scheduleSelections
      const selectionsWithComm = await tx
        .select()
        .from(scheduleSelections)
        .where(sql`${scheduleSelections.selections}::text LIKE ${'%' + commissionId + '%'}`);

      for (const sel of selectionsWithComm) {
        const next = { ...(sel.selections as Record<string, string>) };
        for (const [subId, cId] of Object.entries(next)) {
          if (cId === commissionId) delete next[subId];
        }
        await tx
          .update(scheduleSelections)
          .set({ selections: next, updatedAt: new Date() })
          .where(eq(scheduleSelections.id, sel.id));
      }

      // 3. Limpiar propuestas
      const proposalsWithComm = await tx
        .select()
        .from(scheduleProposals)
        .where(sql`${scheduleProposals.selections}::text LIKE ${'%' + commissionId + '%'}`);

      for (const prop of proposalsWithComm) {
        const next = { ...(prop.selections as Record<string, string>) };
        for (const [subId, cId] of Object.entries(next)) {
          if (cId === commissionId) delete next[subId];
        }
        await tx
          .update(scheduleProposals)
          .set({ selections: next, updatedAt: new Date() })
          .where(eq(scheduleProposals.id, prop.id));
      }

      // 4. Eliminar la comisión (cascada slots y profesores)
      await tx.delete(commissions).where(eq(commissions.id, commissionId));

      await logAdminAction({
        tx,
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        action: 'commission.delete',
        targetType: 'commission',
        targetId: commissionId,
        details: {
          code: comm.code,
          impact,
        },
        ip,
      });
    });

    await bumpCatalogVersion();

    return { success: true, impact };
  }

  // ==========================================
  // 5. IMPORTADOR DE HORARIOS CON PREVIEW Y HASH (Ajuste 8)
  // ==========================================

  static computeSchedulePreviewHash(scheduleData: any): string {
    function sortObjectKeys(obj: any): any {
      if (Array.isArray(obj)) return obj.map(sortObjectKeys);
      if (obj !== null && typeof obj === 'object') {
        const sorted: Record<string, any> = {};
        for (const k of Object.keys(obj).sort()) {
          sorted[k] = sortObjectKeys(obj[k]);
        }
        return sorted;
      }
      return obj;
    }
    const canonicalStr = JSON.stringify(sortObjectKeys(scheduleData));
    return crypto.createHash('sha256').update(canonicalStr).digest('hex');
  }

  static async previewScheduleImport(scheduleData: any[]) {
    if (!Array.isArray(scheduleData)) {
      const err = new Error('El archivo de horarios debe contener una lista de materias con comisiones.');
      (err as any).status = 400;
      throw err;
    }

    const previewHash = this.computeSchedulePreviewHash(scheduleData);

    let additions = 0;
    let totalSlots = 0;
    const warnings: string[] = [];

    for (const item of scheduleData) {
      if (!item.subjectId || !Array.isArray(item.commissions)) {
        warnings.push(`Materia inválida encontrada en el JSON (falta subjectId o commissions)`);
        continue;
      }
      additions += item.commissions.length;
      for (const c of item.commissions) {
        if (!c.code || !c.turno) {
          warnings.push(`Comisión incompleta en materia ${item.subjectId}`);
        }
        if (Array.isArray(c.slots)) {
          totalSlots += c.slots.length;
        }
      }
    }

    return {
      previewHash,
      // Campos planos esperados por el frontend (ScheduleImportPreview)
      totalTerms: 1,
      totalCommissions: additions,
      termsFound: [] as string[],
      sampleCommissions: [] as any[],
      summary: {
        subjectsCount: scheduleData.length,
        commissionsCount: additions,
        slotsCount: totalSlots,
        warningsCount: warnings.length,
        warnings: warnings.slice(0, 10),
      },
    };
  }

  // ==========================================
  // 6. RESEÑAS Y MODERACIÓN (Visibilidad de Autor para Administradores)
  // ==========================================

  static async listReviews(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    professorId?: string;
    subjectId?: string;
  }) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.pageSize || 20));
    const offset = (page - 1) * limit;

    const authorUsers = alias(users, 'author_users');
    const conditions = [];

    if (options.status && options.status !== 'all') {
      conditions.push(eq(professorReviews.status, options.status));
    }
    if (options.professorId) {
      conditions.push(eq(professorReviews.professorId, options.professorId));
    }
    if (options.subjectId) {
      conditions.push(eq(professorReviews.subjectId, options.subjectId));
    }
    if (options.search && options.search.trim()) {
      const term = `%${options.search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(LOWER(${authorUsers.email}) LIKE ${term} OR LOWER(${professors.displayName}) LIKE ${term} OR LOWER(${professorReviews.comment}) LIKE ${term})`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes] = await db
      .select({ value: count() })
      .from(professorReviews)
      .innerJoin(professors, eq(professorReviews.professorId, professors.id))
      .innerJoin(subjects, eq(professorReviews.subjectId, subjects.id))
      .leftJoin(authorUsers, eq(professorReviews.userId, authorUsers.id))
      .where(whereClause);

    const total = totalRes?.value || 0;

    const rows = await db
      .select({
        id: professorReviews.id,
        professorId: professorReviews.professorId,
        professorName: professors.displayName,
        subjectId: professorReviews.subjectId,
        subjectCode: subjects.codeInPlan,
        subjectName: subjects.name,
        authorUserId: professorReviews.userId,
        authorEmail: authorUsers.email,
        overall: professorReviews.overall,
        clarity: professorReviews.clarity,
        treatment: professorReviews.treatment,
        availability: professorReviews.availability,
        difficulty: professorReviews.difficulty,
        wouldRecommend: professorReviews.wouldRecommend,
        comment: professorReviews.comment,
        status: professorReviews.status,
        helpfulCount: professorReviews.helpfulCount,
        attendedDeclared: professorReviews.attendedDeclared,
        academicYear: professorReviews.academicYear,
        term: professorReviews.term,
        createdAt: professorReviews.createdAt,
      })
      .from(professorReviews)
      .innerJoin(professors, eq(professorReviews.professorId, professors.id))
      .innerJoin(subjects, eq(professorReviews.subjectId, subjects.id))
      .leftJoin(authorUsers, eq(professorReviews.userId, authorUsers.id))
      .where(whereClause)
      .orderBy(desc(professorReviews.createdAt))
      .limit(limit)
      .offset(offset);

    const mapped = rows.map((r) => ({
      ...r,
      authorEmail: r.authorEmail || 'usuario_eliminado@stack.com',
    }));

    return {
      // `items` es el formato que consume el panel; `reviews` se mantiene por compatibilidad
      items: mapped,
      reviews: mapped,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async suspendReviewAuthor(
    adminUser: { id: string; email: string },
    reviewId: string,
    ip?: string
  ) {
    const [review] = await db
      .select({
        id: professorReviews.id,
        userId: professorReviews.userId,
        status: professorReviews.status,
      })
      .from(professorReviews)
      .where(eq(professorReviews.id, reviewId))
      .limit(1);

    if (!review) {
      const err = new Error('Reseña no encontrada');
      (err as any).status = 404;
      throw err;
    }

    const authorUserId = review.userId;
    const [author] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, authorUserId))
      .limit(1);

    await db.transaction(async (tx) => {
      // 1. Suspender autor y revocar sus tokens
      await tx
        .update(users)
        .set({ status: 'suspended', updatedAt: new Date() })
        .where(eq(users.id, authorUserId));

      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(refreshTokens.userId, authorUserId));

      // 2. Ocultar la reseña
      await tx
        .update(professorReviews)
        .set({ status: 'hidden', updatedAt: new Date() })
        .where(eq(professorReviews.id, reviewId));

      // 3. Marcar reportes como resueltos / accionados
      await tx
        .update(reviewReports)
        .set({ status: 'actioned' })
        .where(eq(reviewReports.reviewId, reviewId));

      // Auditoría: guarda targetId y email del autor para trazabilidad del admin
      await logAdminAction({
        tx,
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        targetEmail: author?.email || null,
        action: 'review.suspend_author',
        targetType: 'review',
        targetId: reviewId,
        details: {
          authorUserId,
          authorEmail: author?.email || null,
          actionNote: 'Autor suspendido y reseña ocultada por moderación',
        },
        ip,
      });
    });

    invalidateUserStatusCache(authorUserId);

    return {
      success: true,
      message: `El autor (${author?.email || 'usuario'}) ha sido suspendido y la reseña fue ocultada con éxito.`,
      authorEmail: author?.email,
      authorUserId,
    };
  }

  // ==========================================
  // 7. REGISTRO DE AUDITORÍA
  // ==========================================

  static async listAuditLogs(options: {
    page?: number;
    limit?: number;
    action?: string;
    adminEmail?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(10, options.limit || 25));
    const offset = (page - 1) * limit;

    const conditions = [];

    if (options.action) {
      conditions.push(eq(adminAuditLog.action, options.action));
    }

    if (options.adminEmail) {
      conditions.push(sql`LOWER(${adminAuditLog.adminEmail}) LIKE ${'%' + options.adminEmail.trim().toLowerCase() + '%'}`);
    }

    if (options.startDate) {
      conditions.push(gte(adminAuditLog.createdAt, new Date(options.startDate)));
    }

    if (options.endDate) {
      conditions.push(lte(adminAuditLog.createdAt, new Date(options.endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes] = await db.select({ value: count() }).from(adminAuditLog).where(whereClause);
    const total = totalRes?.value || 0;

    const logs = await db
      .select()
      .from(adminAuditLog)
      .where(whereClause)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      logs,
      total,
      page,
      totalPages,
      limit,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
    };
  }
}
