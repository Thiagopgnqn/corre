import { eq, and, or, sql, desc, asc, count, inArray, gte, isNull, lt, isNotNull } from 'drizzle-orm';
import crypto from 'crypto';
import path from 'path';
import { db } from '../../db/index.js';
import {
  users,
  userSettings,
  subjects,
  studyPlans,
  careers,
  faculties,
  professors,
  libraryFiles,
  libraryFileProfessors,
  libraryDownloads,
  libraryDownloadLogs,
  libraryHelpfulVotes,
  libraryReports,
  libraryOrphanDeletions,
  LibraryFile,
} from '../../db/schema.js';
import { LIBRARY_CONFIG, AllowedMimeType } from '../../config/library.config.js';
import { getR2Service, IR2StorageService, MemoryMockR2Service, StorageTestResult } from '../../services/r2.service.js';
import {
  validateFileStream,
  sanitizeLibraryText,
  checkLibraryProfanity,
} from './library.validator.js';
import {
  notifyAdminNewPendingFile,
  notifyUploaderFileApproved,
  notifyUploaderFileRejected,
  setMailerDataSource,
  recordUploadCompleted,
  recordUploaderAction,
  IMailerDataSource,
  LibraryFileNotificationItem,
  PendingUploaderFileItem,
} from './library.mailer.js';
import { validationSemaphore } from '../../utils/semaphore.js';
import { logAdminAction } from '../admin/admin.audit.js';
import { invalidateUserStatusCache } from '../../middlewares/auth.middleware.js';
import { isValidUuid } from '../catalog/catalog.helpers.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const initUploadRateLimitMap = new Map<string, RateLimitEntry>();

export function checkInitUploadRateLimit(userId: string): void {
  const now = Date.now();
  const entry = initUploadRateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    initUploadRateLimitMap.set(userId, {
      count: 1,
      resetAt: now + LIBRARY_CONFIG.UPLOAD_INIT_RATE_LIMIT_WINDOW_MS,
    });
    return;
  }

  if (entry.count >= LIBRARY_CONFIG.UPLOAD_INIT_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    const err: any = new Error(
      'Demasiadas solicitudes de subida en poco tiempo. Por favor esperá unos minutos.'
    );
    err.status = 429;
    err.code = 'LIMIT_RATE_EXCEEDED';
    err.retryAfter = retryAfterSeconds;
    throw err;
  }

  entry.count++;
}

export function resetInitUploadRateLimits(): void {
  initUploadRateLimitMap.clear();
}

export interface InitUploadInput {
  subjectId: string;
  kind: 'parcial' | 'final' | 'apunte' | 'resumen' | 'tp' | 'guia' | 'otro';
  academicYear?: number;
  term?: '1C' | '2C' | 'A';
  examInstance?: string;
  hasSolution?: boolean;
  title: string;
  description?: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  professorIds?: string[];
  acceptTerms?: boolean;
}

export interface ListLibraryFilesFilters {
  planId?: string | null;
  subjectId?: string;
  kind?: string;
  year?: number;
  term?: string;
  professorId?: string;
  hasSolution?: boolean;
  search?: string;
  sort?: 'recent' | 'downloads' | 'helpful';
  page?: number;
  pageSize?: number;
}

export interface ListAdminLibraryFilters {
  status?: string;
  subjectId?: string;
  careerId?: string;
  planId?: string;
  kind?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ILibraryService {
  acceptTerms(userId: string, version?: string): Promise<{ success: boolean; acceptedAt: Date; version: string }>;
  getTermsStatus(userId: string): Promise<{ accepted: boolean; acceptedAt: Date | null; version: string | null; currentVersion: string }>;
  initUpload(userId: string, input: InitUploadInput, planId?: string | null): Promise<any>;
  completeUpload(userId: string, fileId: string, planId?: string | null): Promise<any>;
  listSubjectsWithCounts(planId?: string | null): Promise<any[]>;
  listFiles(filters: ListLibraryFilesFilters, currentUserId?: string): Promise<any>;
  getFileDetail(fileId: string, currentUserId?: string, isAdmin?: boolean, planId?: string | null): Promise<any>;
  getDownloadUrl(fileId: string, userId: string, isAdmin?: boolean, planId?: string | null): Promise<any>;
  toggleHelpful(fileId: string, userId: string, planId?: string | null): Promise<any>;
  reportFile(fileId: string, userId: string, reason: any, note?: string, planId?: string | null): Promise<any>;
  listMyUploads(userId: string, markChecked?: boolean): Promise<any>;
  updateMyFile(userId: string, fileId: string, updates: any, planId?: string | null): Promise<any>;
  deleteMyFile(userId: string, fileId: string, planId?: string | null): Promise<any>;
  listPendingFiles(filters?: { careerId?: string; planId?: string }): Promise<any[]>;
  listAllFilesAdmin(filters: ListAdminLibraryFilters): Promise<any>;
  getPreviewUrl(fileId: string): Promise<any>;
  approveFile(fileId: string, adminUserId: string): Promise<any>;
  rejectFile(fileId: string, adminUserId: string, reason: string): Promise<any>;
  resendAdminNotification(fileId: string): Promise<{ success: boolean; message: string; notifiedAt?: Date }>;
  removeFile(fileId: string, adminUserId: string, reason?: string): Promise<any>;
  getUploaderIdentity(fileId: string, adminUser: { id: string; email: string }, ip?: string): Promise<any>;
  suspendAuthor(fileId: string, adminUser: { id: string; email: string }, reason: string, ip?: string): Promise<any>;
  listReports(status?: any, filters?: { careerId?: string; planId?: string }): Promise<any[]>;
  updateReportStatus(reportId: string, newStatus: any): Promise<any>;
  getLibraryStats(): Promise<any>;
  testR2Connection(adminUser: { id: string; email: string }, ip?: string): Promise<StorageTestResult>;
  cleanupAbandonedUploads(): Promise<any>;
  handleAccountDeletion(userId: string, deleteFiles: boolean): Promise<void>;
}

export interface PendingUploaderRawRow {
  fileId: string;
  uploaderUserId: string | null;
  status: string;
  title: string;
  rejectionReason: string | null;
  subjectName: string | null;
  careerId?: string | null;
  careerCode?: string | null;
  careerName?: string | null;
  planName?: string | null;
  facultyName?: string | null;
  userEmail: string;
  userStatus: string;
}

/**
 * Construye los ítems de notificación al uploader sin duplicar filas aunque el usuario tenga
 * múltiples filas en `user_settings` (una por plan): opt-out gana (`every !== false`).
 */
export function buildPendingUploaderFileItems(
  rows: PendingUploaderRawRow[],
  settingsRows: Array<{ userId: string; notifyLibraryEmail: boolean | null }>
): PendingUploaderFileItem[] {
  const optedOutUsers = new Set<string>();
  for (const s of settingsRows) {
    if (s.notifyLibraryEmail === false) {
      optedOutUsers.add(s.userId);
    }
  }

  return rows
    .filter((r): r is PendingUploaderRawRow & { uploaderUserId: string } => Boolean(r.uploaderUserId))
    .map((r) => ({
      fileId: r.fileId,
      uploaderUserId: r.uploaderUserId,
      userEmail: r.userEmail,
      userStatus: r.userStatus,
      notifyLibraryEmail: !optedOutUsers.has(r.uploaderUserId),
      status: r.status as 'approved' | 'rejected',
      title: r.title,
      subjectName: r.subjectName || 'Materia',
      careerId: r.careerId ?? null,
      careerCode: r.careerCode ?? null,
      careerName: r.careerName ?? null,
      planName: r.planName ?? null,
      facultyName: r.facultyName ?? null,
      rejectionReason: r.rejectionReason,
    }));
}

/**
 * Implementación de producción respaldada por PostgreSQL y Cloudflare R2
 */
export class PgLibraryService implements ILibraryService, IMailerDataSource {
  private r2: IR2StorageService;

  constructor(r2Service?: IR2StorageService) {
    this.r2 = r2Service || getR2Service();
    setMailerDataSource(this);
  }

  async getPendingAdminFiles(): Promise<LibraryFileNotificationItem[]> {
    const rows = await db
      .select({
        id: libraryFiles.id,
        title: libraryFiles.title,
        kind: libraryFiles.kind,
        academicYear: libraryFiles.academicYear,
        term: libraryFiles.term,
        sizeBytes: libraryFiles.sizeBytes,
        mimeType: libraryFiles.mimeType,
        createdAt: libraryFiles.createdAt,
        subjectName: subjects.name,
        careerId: careers.id,
        careerCode: careers.code,
        careerName: careers.name,
        planName: studyPlans.name,
        facultyName: faculties.name,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .innerJoin(studyPlans, eq(subjects.planId, studyPlans.id))
      .innerJoin(careers, eq(studyPlans.careerId, careers.id))
      .innerJoin(faculties, eq(careers.facultyId, faculties.id))
      .where(
        and(
          eq(libraryFiles.status, 'pending'),
          isNull(libraryFiles.adminNotifiedAt)
        )
      )
      .orderBy(asc(libraryFiles.createdAt));

    return rows.map((r) => ({
      ...r,
      sizeBytes: Number(r.sizeBytes),
      subjectName: r.subjectName || 'Materia',
    }));
  }

  async markAdminNotified(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await db
      .update(libraryFiles)
      .set({ adminNotifiedAt: new Date() })
      .where(inArray(libraryFiles.id, fileIds));
  }

  async getPendingUploaderFiles(): Promise<PendingUploaderFileItem[]> {
    const rows = await db
      .select({
        fileId: libraryFiles.id,
        uploaderUserId: libraryFiles.uploaderUserId,
        status: libraryFiles.status,
        title: libraryFiles.title,
        rejectionReason: libraryFiles.rejectionReason,
        subjectName: subjects.name,
        careerId: careers.id,
        careerCode: careers.code,
        careerName: careers.name,
        planName: studyPlans.name,
        facultyName: faculties.name,
        userEmail: users.email,
        userStatus: users.status,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .innerJoin(studyPlans, eq(subjects.planId, studyPlans.id))
      .innerJoin(careers, eq(studyPlans.careerId, careers.id))
      .innerJoin(faculties, eq(careers.facultyId, faculties.id))
      .innerJoin(users, eq(libraryFiles.uploaderUserId, users.id))
      .where(
        and(
          sql`${libraryFiles.status} IN ('approved', 'rejected')`,
          isNull(libraryFiles.uploaderNotifiedAt),
          isNotNull(libraryFiles.uploaderUserId),
          sql`NOT (${libraryFiles.status} = 'rejected' AND ${libraryFiles.reviewedAt} IS NULL)`
        )
      )
      .orderBy(asc(libraryFiles.updatedAt));

    const uploaderIds = Array.from(
      new Set(rows.map((r) => r.uploaderUserId).filter((id): id is string => Boolean(id)))
    );

    const settingsRows =
      uploaderIds.length > 0
        ? await db
            .select({
              userId: userSettings.userId,
              notifyLibraryEmail: userSettings.notifyLibraryEmail,
            })
            .from(userSettings)
            .where(inArray(userSettings.userId, uploaderIds))
        : [];

    return buildPendingUploaderFileItems(rows, settingsRows);
  }

  async markUploaderNotified(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await db
      .update(libraryFiles)
      .set({ uploaderNotifiedAt: new Date() })
      .where(inArray(libraryFiles.id, fileIds));
  }

  async acceptTerms(userId: string, version: string = LIBRARY_CONFIG.CURRENT_TERMS_VERSION) {
    await db
      .update(users)
      .set({
        libraryTermsAcceptedAt: new Date(),
        libraryTermsVersion: version,
      })
      .where(eq(users.id, userId));
    return { success: true, acceptedAt: new Date(), version };
  }

  async getTermsStatus(userId: string) {
    const [user] = await db
      .select({
        libraryTermsAcceptedAt: users.libraryTermsAcceptedAt,
        libraryTermsVersion: users.libraryTermsVersion,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const isAccepted = Boolean(
      user?.libraryTermsAcceptedAt &&
        user?.libraryTermsVersion === LIBRARY_CONFIG.CURRENT_TERMS_VERSION
    );

    return {
      accepted: isAccepted,
      acceptedAt: user?.libraryTermsAcceptedAt || null,
      version: user?.libraryTermsVersion || null,
      currentVersion: LIBRARY_CONFIG.CURRENT_TERMS_VERSION,
    };
  }

  private async getPlanSubjectScope(planId: string) {
    if (!isValidUuid(planId)) return [];
    return await db
      .select({
        id: subjects.id,
        name: subjects.name,
        codeInPlan: subjects.codeInPlan,
        level: subjects.level,
        kind: subjects.kind,
        sharedSubjectId: subjects.sharedSubjectId,
      })
      .from(subjects)
      .where(eq(subjects.planId, planId))
      .orderBy(asc(subjects.level), asc(subjects.codeInPlan));
  }

  private async isFileAccessibleInPlan(
    file: { subjectId: string; sharedSubjectId?: string | null; sourcePlanId?: string | null },
    planId?: string | null
  ): Promise<boolean> {
    if (!planId) return true;
    if (!isValidUuid(planId)) return false;
    if (file.sourcePlanId === planId) return true;

    const matchCond = file.sharedSubjectId
      ? or(eq(subjects.id, file.subjectId), eq(subjects.sharedSubjectId, file.sharedSubjectId))!
      : eq(subjects.id, file.subjectId);

    const [match] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.planId, planId), matchCond))
      .limit(1);

    return Boolean(match);
  }

  async initUpload(userId: string, input: InitUploadInput, planId?: string | null) {
    checkInitUploadRateLimit(userId);

    const currentYear = new Date().getFullYear();
    if (input.academicYear !== undefined && input.academicYear !== null) {
      const yearNum = Number(input.academicYear);
      if (!Number.isInteger(yearNum) || yearNum < LIBRARY_CONFIG.ACADEMIC_YEAR_MIN || yearNum > currentYear) {
        throw Object.assign(
          new Error(`El año académico debe ser un número entero entre ${LIBRARY_CONFIG.ACADEMIC_YEAR_MIN} y ${currentYear}.`),
          { status: 400 }
        );
      }
    }

    if (input.term !== undefined && input.term !== null && (input.term as string) !== '') {
      if (!['1C', '2C', 'A'].includes(input.term)) {
        throw Object.assign(
          new Error("El cuatrimestre debe ser '1C', '2C' o 'A'."),
          { status: 400 }
        );
      }
    }

    if (!LIBRARY_CONFIG.ALLOWED_MIME_TYPES.includes(input.mimeType as AllowedMimeType)) {
      throw Object.assign(
        new Error(
          `Formato de archivo no permitido (${input.mimeType}). Solo se admiten PDF, JPG, PNG y WebP.`
        ),
        { status: 400 }
      );
    }

    const ext = path.extname(input.originalFilename || '').toLowerCase();
    if (!LIBRARY_CONFIG.ALLOWED_EXTENSIONS.includes(ext as any)) {
      throw Object.assign(
        new Error(
          `Extensión no permitida (${ext}). Solo se admiten archivos .pdf, .jpg, .jpeg, .png y .webp.`
        ),
        { status: 400 }
      );
    }

    const isPdf = input.mimeType === 'application/pdf';
    const maxSize = isPdf ? LIBRARY_CONFIG.MAX_PDF_SIZE_BYTES : LIBRARY_CONFIG.MAX_IMAGE_SIZE_BYTES;
    const typeLabel = isPdf ? 'documentos PDF (25 MB)' : 'imágenes (10 MB)';

    if (input.sizeBytes <= 0 || input.sizeBytes > maxSize) {
      throw Object.assign(
        new Error(`El archivo excede el tamaño máximo permitido para ${typeLabel}.`),
        { status: 400 }
      );
    }

    if (!isValidUuid(input.subjectId) || (planId && !isValidUuid(planId))) {
      throw Object.assign(new Error('La materia especificada no existe en el catálogo.'), {
        status: 404,
      });
    }

    const [subject] = await db
      .select({
        id: subjects.id,
        planId: subjects.planId,
        sharedSubjectId: subjects.sharedSubjectId,
      })
      .from(subjects)
      .where(
        planId
          ? and(eq(subjects.id, input.subjectId), eq(subjects.planId, planId))
          : eq(subjects.id, input.subjectId)
      )
      .limit(1);

    if (!subject) {
      throw Object.assign(new Error('La materia especificada no existe en el catálogo.'), {
        status: 404,
      });
    }

    const cleanTitle = sanitizeLibraryText(input.title, 120);
    if (!cleanTitle || cleanTitle.length < 3) {
      throw Object.assign(new Error('El título debe tener al menos 3 caracteres.'), { status: 400 });
    }
    const cleanDescription = input.description ? sanitizeLibraryText(input.description, 500) : null;
    const cleanExamInstance = input.examInstance ? sanitizeLibraryText(input.examInstance, 50) : null;

    if (checkLibraryProfanity(cleanTitle) || (cleanDescription && checkLibraryProfanity(cleanDescription))) {
      throw Object.assign(
        new Error('El texto contiene expresiones no permitidas según las normas de la comunidad.'),
        { status: 400 }
      );
    }

    const safeOriginalName = input.originalFilename.replace(/[^a-zA-Z0-9._\-áéíóúÁÉÍÓÚñÑ ]/g, '_');
    const fileId = crypto.randomUUID();
    const storageKey = `library/${fileId}${ext}`;

    return await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({
          id: users.id,
          libraryTermsAcceptedAt: users.libraryTermsAcceptedAt,
          libraryTermsVersion: users.libraryTermsVersion,
          emailVerifiedAt: users.emailVerifiedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');

      if (!lockedUser) {
        throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
      }

      if (!lockedUser.emailVerifiedAt) {
        throw Object.assign(
          new Error('Debés verificar tu correo electrónico para subir material de estudio.'),
          { status: 403 }
        );
      }

      if (
        !lockedUser.libraryTermsAcceptedAt ||
        lockedUser.libraryTermsVersion !== LIBRARY_CONFIG.CURRENT_TERMS_VERSION
      ) {
        if (input.acceptTerms) {
          await tx
            .update(users)
            .set({
              libraryTermsAcceptedAt: new Date(),
              libraryTermsVersion: LIBRARY_CONFIG.CURRENT_TERMS_VERSION,
            })
            .where(eq(users.id, userId));
        } else {
          throw Object.assign(
            new Error('Debés aceptar los Términos de la Biblioteca antes de subir tu primer archivo.'),
            { status: 403, code: 'TERMS_REQUIRED' }
          );
        }
      }

      // Limpieza proactiva de subidas incompletas de más de 30 min para este usuario
      const staleThreshold = new Date(
        Date.now() - LIBRARY_CONFIG.UPLOADING_EXPIRATION_MINUTES * 60 * 1000
      );
      await tx
        .delete(libraryFiles)
        .where(
          and(
            eq(libraryFiles.uploaderUserId, userId),
            eq(libraryFiles.status, 'uploading'),
            lt(libraryFiles.createdAt, staleThreshold)
          )
        );

      // Freno anti-spam: bloqueo temporal si acumula >= MAX_REJECTIONS_THRESHOLD rechazos en REJECTIONS_WINDOW_DAYS
      if (LIBRARY_CONFIG.MAX_REJECTIONS_THRESHOLD > 0 && LIBRARY_CONFIG.REJECTIONS_WINDOW_DAYS > 0) {
        const windowStart = new Date(
          Date.now() - LIBRARY_CONFIG.REJECTIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000
        );
        const [rejRes] = await tx
          .select({
            count: count(),
            oldestReviewedAt: sql<Date | null>`MIN(${libraryFiles.reviewedAt})`,
          })
          .from(libraryFiles)
          .where(
            and(
              eq(libraryFiles.uploaderUserId, userId),
              eq(libraryFiles.status, 'rejected'),
              gte(libraryFiles.reviewedAt, windowStart)
            )
          );

        const rejectionsCount = Number(rejRes?.count || 0);
        if (rejectionsCount >= LIBRARY_CONFIG.MAX_REJECTIONS_THRESHOLD) {
          const oldestDate = rejRes?.oldestReviewedAt ? new Date(rejRes.oldestReviewedAt) : windowStart;
          const unlockTime = new Date(
            oldestDate.getTime() + LIBRARY_CONFIG.REJECTIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000
          );
          const hoursLeft = Math.max(1, Math.ceil((unlockTime.getTime() - Date.now()) / (1000 * 60 * 60)));
          throw Object.assign(
            new Error(
              `Tu cuenta acumula ${rejectionsCount} archivos rechazados en los últimos ${LIBRARY_CONFIG.REJECTIONS_WINDOW_DAYS} días. Podrás volver a subir material en aproximadamente ${hoursLeft} hora(s).`
            ),
            { status: 429, code: 'TOO_MANY_REJECTIONS' }
          );
        }
      }

      const [pendingRes] = await tx
        .select({ count: count() })
        .from(libraryFiles)
        .where(
          and(
            eq(libraryFiles.uploaderUserId, userId),
            sql`${libraryFiles.status} IN ('pending', 'uploading')`
          )
        );

      if ((pendingRes?.count || 0) >= LIBRARY_CONFIG.MAX_PENDING_UPLOADS) {
        throw Object.assign(
          new Error(
            `Tenés ${LIBRARY_CONFIG.MAX_PENDING_UPLOADS} archivos pendientes de revisión (máximo ${LIBRARY_CONFIG.MAX_PENDING_UPLOADS}). Esperá a que se aprueben para subir más.`
          ),
          { status: 429, code: 'LIMIT_PENDING_UPLOADS' }
        );
      }

      const [quotaRes] = await tx
        .select({ totalBytes: sql<number>`COALESCE(SUM(${libraryFiles.sizeBytes}), 0)` })
        .from(libraryFiles)
        .where(
          and(
            eq(libraryFiles.uploaderUserId, userId),
            sql`${libraryFiles.status} NOT IN ('removed', 'rejected')`
          )
        );

      const currentUsed = Number(quotaRes?.totalBytes || 0);
      if (currentUsed + input.sizeBytes > LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES) {
        throw Object.assign(
          new Error(
            `La subida excede tu cuota total de almacenamiento (${Math.round(
              LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES / (1024 * 1024)
            )} MB). Eliminá material antiguo o esperá la moderación.`
          ),
          { status: 429, code: 'LIMIT_STORAGE_QUOTA' }
        );
      }

      // Requisito 1: sha256 es NULL durante estado 'uploading'
      await tx.insert(libraryFiles).values({
        id: fileId,
        uploaderUserId: userId,
        subjectId: subject.id,
        sharedSubjectId: subject.sharedSubjectId ?? null,
        sourceSubjectId: subject.id,
        sourcePlanId: subject.planId ?? null,
        kind: input.kind,
        academicYear: input.academicYear || null,
        term: input.term || null,
        examInstance: cleanExamInstance,
        hasSolution: Boolean(input.hasSolution),
        title: cleanTitle,
        description: cleanDescription,
        originalFilename: safeOriginalName,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: null,
        status: 'uploading',
      });

      if (input.professorIds && input.professorIds.length > 0) {
        for (const profId of input.professorIds) {
          await tx
            .insert(libraryFileProfessors)
            .values({ fileId, professorId: profId })
            .onConflictDoNothing();
        }
      }

      const uploadUrl = await this.r2.getPresignedUploadUrl({
        key: storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        expiresInSeconds: LIBRARY_CONFIG.PRESIGNED_PUT_EXPIRES_SECONDS,
      });

      return {
        fileId,
        uploadUrl,
        storageKey,
        expiresInSeconds: LIBRARY_CONFIG.PRESIGNED_PUT_EXPIRES_SECONDS,
        headers: {
          'Content-Type': input.mimeType,
          'Content-Length': String(input.sizeBytes),
        },
      };
    });
  }

  private async deleteFromR2OrQueueOrphan(storageKey: string, errorContext: string): Promise<void> {
    let deleted = false;
    let lastError = errorContext;
    try {
      deleted = await this.r2.deleteObject(storageKey);
    } catch (err: any) {
      lastError = `${errorContext}: ${err?.message || String(err)}`;
    }
    if (!deleted) {
      await db
        .insert(libraryOrphanDeletions)
        .values({ storageKey, lastError })
        .onConflictDoNothing();
    }
  }

  private async markAutoRejectedUpload(fileId: string, rejectionReason: string): Promise<void> {
    const now = new Date();
    await db
      .update(libraryFiles)
      .set({
        status: 'rejected',
        rejectionReason,
        uploaderNotifiedAt: now,
        updatedAt: now,
      })
      .where(eq(libraryFiles.id, fileId));
  }

  async completeUpload(userId: string, fileId: string, planId?: string | null) {
    if (!isValidUuid(fileId)) {
      throw Object.assign(
        new Error('Archivo no encontrado o la sesión de subida expiró por inactividad.'),
        { status: 404, code: 'UPLOAD_NOT_FOUND_OR_EXPIRED' }
      );
    }

    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file || file.uploaderUserId !== userId || !(await this.isFileAccessibleInPlan(file, planId))) {
      throw Object.assign(
        new Error('Archivo no encontrado o la sesión de subida expiró por inactividad.'),
        { status: 404, code: 'UPLOAD_NOT_FOUND_OR_EXPIRED' }
      );
    }

    if (file.status !== 'uploading') {
      if (file.status === 'pending' || file.status === 'approved') {
        return {
          success: true,
          file,
          message: 'Tu archivo quedó en revisión; te avisaremos en "Mis archivos" cuando esté publicado.',
        };
      }
      if (file.status === 'rejected') {
        throw Object.assign(
          new Error(`El archivo fue rechazado: ${file.rejectionReason || 'No cumple las pautas de publicación.'}`),
          { status: 400, code: 'UPLOAD_ALREADY_REJECTED' }
        );
      }
      if (file.status === 'hidden' || file.status === 'removed') {
        throw Object.assign(
          new Error(`El archivo se encuentra en estado '${file.status}'.`),
          { status: 400, code: 'UPLOAD_NOT_ACTIVE' }
        );
      }
      throw Object.assign(new Error(`El archivo se encuentra en estado '${file.status}'.`), {
        status: 400,
        code: 'INVALID_STATUS',
      });
    }

    const head = await this.r2.headObject(file.storageKey);
    if (!head.exists) {
      await this.r2.deleteObject(file.storageKey);
      await this.markAutoRejectedUpload(fileId, 'El archivo no fue recibido en el almacenamiento.');
      throw Object.assign(
        new Error('No se encontró el archivo en el almacenamiento. Por favor reintentá la subida.'),
        { status: 400 }
      );
    }

    if (head.sizeBytes !== file.sizeBytes) {
      await this.deleteFromR2OrQueueOrphan(
        file.storageKey,
        'Error al borrar objeto de R2 tras rechazo por tamaño en completeUpload'
      );
      await this.markAutoRejectedUpload(
        fileId,
        `Tamaño transferido (${head.sizeBytes}) no coincide con lo declarado (${file.sizeBytes}).`
      );
      throw Object.assign(
        new Error('El tamaño real del archivo difiere del declarado. Subida rechazada por seguridad.'),
        { status: 400, code: 'INVALID_FILE_CONTENT' }
      );
    }

    const validation = await validationSemaphore.runWithLock(async () => {
      const stream = await this.r2.getObjectStream(file.storageKey);
      return await validateFileStream(
        stream,
        file.mimeType as AllowedMimeType,
        file.sizeBytes
      );
    });

    if (!validation.isValid) {
      await this.deleteFromR2OrQueueOrphan(
        file.storageKey,
        'Error al borrar objeto de R2 tras rechazo de validación en completeUpload'
      );
      const reason = validation.error || 'Fallo en la validación de seguridad del archivo.';
      await this.markAutoRejectedUpload(fileId, reason);
      const code = validation.hasDangerousPdfMarks ? 'DANGEROUS_PDF_CONTENT' : 'INVALID_FILE_CONTENT';
      throw Object.assign(new Error(reason), { status: 400, code });
    }

    const dupScopeCond = file.sharedSubjectId
      ? eq(libraryFiles.sharedSubjectId, file.sharedSubjectId)
      : eq(libraryFiles.subjectId, file.subjectId);

    // Pre-chequeo de duplicados por SHA-256 (agrupado por sharedSubjectId cuando existe)
    const [existingDuplicate] = await db
      .select({ id: libraryFiles.id, title: libraryFiles.title })
      .from(libraryFiles)
      .where(
        and(
          eq(libraryFiles.sha256, validation.sha256),
          dupScopeCond,
          sql`${libraryFiles.status} NOT IN ('removed', 'rejected')`,
          sql`${libraryFiles.id} != ${fileId}`
        )
      )
      .limit(1);

    if (existingDuplicate) {
      await this.deleteFromR2OrQueueOrphan(
        file.storageKey,
        'Error al borrar objeto de R2 tras rechazo por duplicado en completeUpload'
      );
      const reason = `Ya existe un archivo idéntico en el sistema ("${existingDuplicate.title}").`;
      await this.markAutoRejectedUpload(fileId, reason);
      throw Object.assign(new Error(reason), { status: 409, code: 'DUPLICATE_FILE' });
    }

    // Actualizar a 'pending' capturando condición de carrera (Requisito 1)
    try {
      const [updated] = await db
        .update(libraryFiles)
        .set({
          sha256: validation.sha256,
          status: 'pending',
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(libraryFiles.id, fileId))
        .returning();

      // Notificar a administradores de forma agrupada
      recordUploadCompleted();

      return {
        success: true,
        file: updated,
        message: 'Tu archivo quedó en revisión; te avisaremos en "Mis archivos" cuando esté publicado.',
      };
    } catch (dbErr: any) {
      if (
        dbErr.code === '23505' ||
        dbErr.message?.includes('uq_lib_files_sha256_active') ||
        dbErr.message?.includes('duplicate key')
      ) {
        await this.deleteFromR2OrQueueOrphan(
          file.storageKey,
          'Error al borrar objeto de R2 tras rechazo por duplicado concurrente en completeUpload'
        );
        const reason = 'Ya existe un archivo idéntico en el sistema.';
        await this.markAutoRejectedUpload(fileId, reason);
        throw Object.assign(new Error(reason), { status: 409, code: 'DUPLICATE_FILE' });
      }
      throw dbErr;
    }
  }

  async listSubjectsWithCounts(planId?: string | null) {
    if (planId && !isValidUuid(planId)) return [];

    const conditions = [];
    if (planId) {
      conditions.push(eq(subjects.planId, planId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const subjectsRows = await db
      .select({
        id: subjects.id,
        name: subjects.name,
        codeInPlan: subjects.codeInPlan,
        level: subjects.level,
        kind: subjects.kind,
        sharedSubjectId: subjects.sharedSubjectId,
      })
      .from(subjects)
      .where(whereClause)
      .orderBy(asc(subjects.level), asc(subjects.codeInPlan));

    if (subjectsRows.length === 0) return [];

    const subjectIds = subjectsRows.map((s) => s.id);
    const sharedIds = Array.from(
      new Set(
        subjectsRows
          .map((s) => s.sharedSubjectId)
          .filter((sid): sid is string => Boolean(sid))
      )
    );

    const fileMatchConds = [inArray(libraryFiles.subjectId, subjectIds)];
    if (sharedIds.length > 0) {
      fileMatchConds.push(inArray(libraryFiles.sharedSubjectId, sharedIds));
    }

    const approvedFiles = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
        sharedSubjectId: libraryFiles.sharedSubjectId,
      })
      .from(libraryFiles)
      .where(and(eq(libraryFiles.status, 'approved'), or(...fileMatchConds)!));

    return subjectsRows.map((s) => {
      const seenIds = new Set<string>();
      for (const f of approvedFiles) {
        if (
          f.subjectId === s.id ||
          (s.sharedSubjectId && f.sharedSubjectId === s.sharedSubjectId)
        ) {
          seenIds.add(f.id);
        }
      }
      return {
        ...s,
        approvedFilesCount: seenIds.size,
      };
    });
  }

  async listFiles(filters: ListLibraryFilesFilters, currentUserId?: string) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.pageSize || 20));
    const offset = (page - 1) * limit;

    const conditions = [eq(libraryFiles.status, 'approved')];
    let targetPlanSubject: {
      id: string;
      name: string;
      codeInPlan: number;
      sharedSubjectId: string | null;
    } | null = null;
    const planSubById = new Map<
      string,
      { id: string; name: string; codeInPlan: number; sharedSubjectId: string | null }
    >();
    const planSubByShared = new Map<
      string,
      { id: string; name: string; codeInPlan: number; sharedSubjectId: string | null }
    >();

    if (filters.planId) {
      const planSubs = await this.getPlanSubjectScope(filters.planId);
      for (const s of planSubs) {
        planSubById.set(s.id, s);
        if (s.sharedSubjectId) planSubByShared.set(s.sharedSubjectId, s);
      }

      if (filters.subjectId) {
        const matchedSub = isValidUuid(filters.subjectId)
          ? planSubById.get(filters.subjectId)
          : undefined;
        if (!matchedSub) {
          throw Object.assign(
            new Error('La materia especificada no pertenece a tu plan de estudios.'),
            { status: 404 }
          );
        }
        targetPlanSubject = matchedSub;
        if (matchedSub.sharedSubjectId) {
          conditions.push(
            or(
              eq(libraryFiles.sharedSubjectId, matchedSub.sharedSubjectId),
              eq(libraryFiles.subjectId, matchedSub.id)
            )!
          );
        } else {
          conditions.push(eq(libraryFiles.subjectId, matchedSub.id));
        }
      } else {
        const subIds = planSubs.map((s) => s.id);
        const sharedIds = Array.from(planSubByShared.keys());
        const scopeOrs = [];
        if (subIds.length > 0) scopeOrs.push(inArray(libraryFiles.subjectId, subIds));
        if (sharedIds.length > 0) scopeOrs.push(inArray(libraryFiles.sharedSubjectId, sharedIds));
        if (scopeOrs.length === 0) {
          return { items: [], total: 0, page, pageSize: limit, totalPages: 0 };
        }
        conditions.push(or(...scopeOrs)!);
      }
    } else if (filters.subjectId) {
      if (!isValidUuid(filters.subjectId)) {
        return { items: [], total: 0, page, pageSize: limit, totalPages: 0 };
      }
      const [sub] = await db
        .select({ id: subjects.id, sharedSubjectId: subjects.sharedSubjectId })
        .from(subjects)
        .where(eq(subjects.id, filters.subjectId))
        .limit(1);
      if (sub?.sharedSubjectId) {
        conditions.push(
          or(
            eq(libraryFiles.sharedSubjectId, sub.sharedSubjectId),
            eq(libraryFiles.subjectId, sub.id)
          )!
        );
      } else {
        conditions.push(eq(libraryFiles.subjectId, filters.subjectId));
      }
    }
    if (filters.kind && filters.kind !== 'all') {
      conditions.push(eq(libraryFiles.kind, filters.kind));
    }
    if (filters.year) {
      conditions.push(eq(libraryFiles.academicYear, filters.year));
    }
    if (filters.term && filters.term !== 'all') {
      conditions.push(eq(libraryFiles.term, filters.term));
    }
    if (filters.hasSolution !== undefined) {
      conditions.push(eq(libraryFiles.hasSolution, filters.hasSolution));
    }
    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          sql`LOWER(${libraryFiles.title}) LIKE ${q}`,
          sql`LOWER(COALESCE(${libraryFiles.description}, '')) LIKE ${q}`,
          sql`LOWER(COALESCE(${libraryFiles.examInstance}, '')) LIKE ${q}`
        )!
      );
    }

    if (filters.professorId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${libraryFileProfessors}
          WHERE ${libraryFileProfessors.fileId} = ${libraryFiles.id}
            AND ${libraryFileProfessors.professorId} = ${filters.professorId}
        )`
      );
    }

    const whereClause = and(...conditions);

    const [totalRes] = await db
      .select({ value: count() })
      .from(libraryFiles)
      .where(whereClause);

    const total = totalRes?.value || 0;

    let orderByClause = desc(libraryFiles.createdAt);
    if (filters.sort === 'downloads') {
      orderByClause = desc(libraryFiles.downloadCount);
    } else if (filters.sort === 'helpful') {
      orderByClause = desc(libraryFiles.helpfulCount);
    }

    const fileRows = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
        sharedSubjectId: libraryFiles.sharedSubjectId,
        sourceSubjectId: libraryFiles.sourceSubjectId,
        sourcePlanId: libraryFiles.sourcePlanId,
        subjectName: subjects.name,
        subjectCode: subjects.codeInPlan,
        kind: libraryFiles.kind,
        academicYear: libraryFiles.academicYear,
        term: libraryFiles.term,
        examInstance: libraryFiles.examInstance,
        hasSolution: libraryFiles.hasSolution,
        title: libraryFiles.title,
        description: libraryFiles.description,
        originalFilename: libraryFiles.originalFilename,
        mimeType: libraryFiles.mimeType,
        sizeBytes: libraryFiles.sizeBytes,
        downloadCount: libraryFiles.downloadCount,
        helpfulCount: libraryFiles.helpfulCount,
        createdAt: libraryFiles.createdAt,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    const fileIds = fileRows.map((f) => f.id);

    const profRows = fileIds.length > 0
      ? await db
          .select({
            fileId: libraryFileProfessors.fileId,
            professorId: professors.id,
            displayName: professors.displayName,
          })
          .from(libraryFileProfessors)
          .innerJoin(professors, eq(libraryFileProfessors.professorId, professors.id))
          .where(inArray(libraryFileProfessors.fileId, fileIds))
      : [];

    const profsMap = new Map<string, Array<{ id: string; displayName: string }>>();
    for (const p of profRows) {
      const list = profsMap.get(p.fileId) || [];
      list.push({ id: p.professorId, displayName: p.displayName });
      profsMap.set(p.fileId, list);
    }

    const helpfulMap = new Set<string>();
    if (currentUserId && fileIds.length > 0) {
      const votes = await db
        .select({ fileId: libraryHelpfulVotes.fileId })
        .from(libraryHelpfulVotes)
        .where(
          and(
            eq(libraryHelpfulVotes.userId, currentUserId),
            inArray(libraryHelpfulVotes.fileId, fileIds)
          )
        );
      votes.forEach((v) => helpfulMap.add(v.fileId));
    }

    const items = fileRows.map((f) => {
      const resolvedSub =
        targetPlanSubject ||
        planSubById.get(f.subjectId) ||
        (f.sharedSubjectId ? planSubByShared.get(f.sharedSubjectId) : undefined);

      return {
        ...f,
        subjectId: resolvedSub?.id || f.subjectId,
        subjectName: resolvedSub?.name || f.subjectName,
        subjectCode: resolvedSub?.codeInPlan ?? f.subjectCode,
        uploaderDisplay: 'Subido por un estudiante',
        professors: profsMap.get(f.id) || [],
        userHasVotedHelpful: helpfulMap.has(f.id),
      };
    });

    return {
      items,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFileDetail(
    fileId: string,
    currentUserId?: string,
    isAdmin = false,
    planId?: string | null
  ) {
    if (!isValidUuid(fileId)) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const [file] = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
        sharedSubjectId: libraryFiles.sharedSubjectId,
        sourcePlanId: libraryFiles.sourcePlanId,
        subjectName: subjects.name,
        subjectCode: subjects.codeInPlan,
        kind: libraryFiles.kind,
        academicYear: libraryFiles.academicYear,
        term: libraryFiles.term,
        examInstance: libraryFiles.examInstance,
        hasSolution: libraryFiles.hasSolution,
        title: libraryFiles.title,
        description: libraryFiles.description,
        originalFilename: libraryFiles.originalFilename,
        mimeType: libraryFiles.mimeType,
        sizeBytes: libraryFiles.sizeBytes,
        downloadCount: libraryFiles.downloadCount,
        helpfulCount: libraryFiles.helpfulCount,
        status: libraryFiles.status,
        uploaderUserId: libraryFiles.uploaderUserId,
        createdAt: libraryFiles.createdAt,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file || (!isAdmin && !(await this.isFileAccessibleInPlan(file, planId)))) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (file.status !== 'approved' && !isAdmin && file.uploaderUserId !== currentUserId) {
      throw Object.assign(new Error('El archivo no está disponible públicamente.'), { status: 403 });
    }

    const profRows = await db
      .select({
        professorId: professors.id,
        displayName: professors.displayName,
      })
      .from(libraryFileProfessors)
      .innerJoin(professors, eq(libraryFileProfessors.professorId, professors.id))
      .where(eq(libraryFileProfessors.fileId, fileId));

    let userHasVotedHelpful = false;
    if (currentUserId) {
      const [v] = await db
        .select({ fileId: libraryHelpfulVotes.fileId })
        .from(libraryHelpfulVotes)
        .where(
          and(eq(libraryHelpfulVotes.fileId, fileId), eq(libraryHelpfulVotes.userId, currentUserId))
        )
        .limit(1);
      userHasVotedHelpful = Boolean(v);
    }

    let resolvedSubjectId = file.subjectId;
    let resolvedSubjectName = file.subjectName;
    let resolvedSubjectCode = file.subjectCode;
    if (planId) {
      const planSubs = await this.getPlanSubjectScope(planId);
      const matched =
        planSubs.find((s) => s.id === file.subjectId) ||
        (file.sharedSubjectId ? planSubs.find((s) => s.sharedSubjectId === file.sharedSubjectId) : undefined);
      if (matched) {
        resolvedSubjectId = matched.id;
        resolvedSubjectName = matched.name;
        resolvedSubjectCode = matched.codeInPlan;
      }
    }

    return {
      id: file.id,
      subjectId: resolvedSubjectId,
      subjectName: resolvedSubjectName,
      subjectCode: resolvedSubjectCode,
      sharedSubjectId: file.sharedSubjectId ?? null,
      sourcePlanId: file.sourcePlanId ?? null,
      kind: file.kind,
      academicYear: file.academicYear,
      term: file.term,
      examInstance: file.examInstance,
      hasSolution: file.hasSolution,
      title: file.title,
      description: file.description,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      downloadCount: file.downloadCount,
      helpfulCount: file.helpfulCount,
      status: file.status,
      createdAt: file.createdAt,
      uploaderDisplay: 'Subido por un estudiante',
      professors: profRows.map((p) => ({ id: p.professorId, displayName: p.displayName })),
      userHasVotedHelpful,
    };
  }

  async getDownloadUrl(fileId: string, userId: string, isAdmin = false, planId?: string | null) {
    if (!isValidUuid(fileId)) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file || (!isAdmin && !(await this.isFileAccessibleInPlan(file, planId)))) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (file.status === 'rejected' || file.status === 'removed') {
      throw Object.assign(
        new Error('El archivo no está disponible para descarga ya que fue rechazado o dado de baja.'),
        { status: 410, code: 'FILE_NOT_AVAILABLE' }
      );
    }

    if (file.status !== 'approved' && !isAdmin && file.uploaderUserId !== userId) {
      throw Object.assign(
        new Error('Este archivo se encuentra en revisión y aún no está disponible para descarga.'),
        { status: 403 }
      );
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [dlCountRes] = await db
      .select({ count: count() })
      .from(libraryDownloadLogs)
      .where(
        and(
          eq(libraryDownloadLogs.userId, userId),
          gte(libraryDownloadLogs.downloadedAt, oneHourAgo)
        )
      );

    if ((dlCountRes?.count || 0) >= LIBRARY_CONFIG.MAX_HOURLY_DOWNLOADS) {
      throw Object.assign(
        new Error(
          `Superaste el límite de ${LIBRARY_CONFIG.MAX_HOURLY_DOWNLOADS} descargas por hora. Por favor intentá nuevamente más tarde.`
        ),
        { status: 429, code: 'LIMIT_HOURLY_DOWNLOADS' }
      );
    }

    await db.insert(libraryDownloadLogs).values({
      fileId,
      userId,
    });

    const isFirstDownload = await db
      .insert(libraryDownloads)
      .values({ fileId, userId })
      .onConflictDoNothing()
      .returning();

    if (isFirstDownload && isFirstDownload.length > 0) {
      await db
        .update(libraryFiles)
        .set({ downloadCount: sql`${libraryFiles.downloadCount} + 1` })
        .where(eq(libraryFiles.id, fileId));
    }

    const downloadUrl = await this.r2.getPresignedDownloadUrl({
      key: file.storageKey,
      filename: file.originalFilename,
      mimeType: file.mimeType,
      expiresInSeconds: LIBRARY_CONFIG.PRESIGNED_GET_EXPIRES_SECONDS,
    });

    return {
      downloadUrl,
      filename: file.originalFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }

  async toggleHelpful(fileId: string, userId: string, planId?: string | null) {
    if (!isValidUuid(fileId)) {
      throw Object.assign(new Error('Archivo no disponible.'), { status: 404 });
    }

    const [file] = await db
      .select({
        id: libraryFiles.id,
        helpfulCount: libraryFiles.helpfulCount,
        status: libraryFiles.status,
        subjectId: libraryFiles.subjectId,
        sharedSubjectId: libraryFiles.sharedSubjectId,
        sourcePlanId: libraryFiles.sourcePlanId,
      })
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file || file.status !== 'approved' || !(await this.isFileAccessibleInPlan(file, planId))) {
      throw Object.assign(new Error('Archivo no disponible.'), { status: 404 });
    }

    const [existing] = await db
      .select()
      .from(libraryHelpfulVotes)
      .where(and(eq(libraryHelpfulVotes.fileId, fileId), eq(libraryHelpfulVotes.userId, userId)))
      .limit(1);

    if (existing) {
      await db
        .delete(libraryHelpfulVotes)
        .where(and(eq(libraryHelpfulVotes.fileId, fileId), eq(libraryHelpfulVotes.userId, userId)));

      await db
        .update(libraryFiles)
        .set({ helpfulCount: sql`GREATEST(0, ${libraryFiles.helpfulCount} - 1)` })
        .where(eq(libraryFiles.id, fileId));

      return { voted: false, helpfulCount: Math.max(0, file.helpfulCount - 1) };
    } else {
      await db.insert(libraryHelpfulVotes).values({ fileId, userId });

      await db
        .update(libraryFiles)
        .set({ helpfulCount: sql`${libraryFiles.helpfulCount} + 1` })
        .where(eq(libraryFiles.id, fileId));

      return { voted: true, helpfulCount: file.helpfulCount + 1 };
    }
  }

  async reportFile(
    fileId: string,
    userId: string,
    reason: 'derechos_de_autor' | 'contenido_inapropiado' | 'incorrecto_o_enganoso' | 'duplicado' | 'otro',
    note?: string,
    planId?: string | null
  ) {
    if (!isValidUuid(fileId)) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const [file] = await db
      .select({
        id: libraryFiles.id,
        status: libraryFiles.status,
        subjectId: libraryFiles.subjectId,
        sharedSubjectId: libraryFiles.sharedSubjectId,
        sourcePlanId: libraryFiles.sourcePlanId,
      })
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file || !(await this.isFileAccessibleInPlan(file, planId))) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const cleanNote = note ? sanitizeLibraryText(note, 300) : null;

    await db
      .insert(libraryReports)
      .values({
        fileId,
        reporterUserId: userId,
        reason,
        note: cleanNote,
      })
      .onConflictDoNothing();

    const openReports = await db
      .select({ reason: libraryReports.reason })
      .from(libraryReports)
      .where(and(eq(libraryReports.fileId, fileId), eq(libraryReports.status, 'open')));

    const totalOpen = openReports.length;
    const copyrightOpen = openReports.filter((r) => r.reason === 'derechos_de_autor').length;

    let autoHidden = false;
    if (
      copyrightOpen >= LIBRARY_CONFIG.AUTO_HIDE_COPYRIGHT_REPORTS_THRESHOLD ||
      totalOpen >= LIBRARY_CONFIG.AUTO_HIDE_GENERAL_REPORTS_THRESHOLD
    ) {
      await db
        .update(libraryFiles)
        .set({ status: 'hidden' })
        .where(eq(libraryFiles.id, fileId));
      autoHidden = true;
    }

    return {
      success: true,
      openReportsCount: totalOpen,
      autoHidden,
      message: autoHidden
        ? 'El material fue ocultado preventivamente hasta que un administrador lo revise.'
        : 'Reporte recibido. Un administrador lo revisará a la brevedad.',
    };
  }

  async listMyUploads(userId: string, markChecked = true) {
    const [user] = await db
      .select({ libraryLastCheckedAt: users.libraryLastCheckedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const lastChecked = user?.libraryLastCheckedAt || new Date(0);

    const uploads = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
        subjectName: subjects.name,
        kind: libraryFiles.kind,
        title: libraryFiles.title,
        description: libraryFiles.description,
        originalFilename: libraryFiles.originalFilename,
        sizeBytes: libraryFiles.sizeBytes,
        mimeType: libraryFiles.mimeType,
        status: libraryFiles.status,
        rejectionReason: libraryFiles.rejectionReason,
        adminNotifiedAt: libraryFiles.adminNotifiedAt,
        uploaderNotifiedAt: libraryFiles.uploaderNotifiedAt,
        downloadCount: libraryFiles.downloadCount,
        helpfulCount: libraryFiles.helpfulCount,
        createdAt: libraryFiles.createdAt,
        updatedAt: libraryFiles.updatedAt,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .where(
        and(
          eq(libraryFiles.uploaderUserId, userId),
          sql`${libraryFiles.status} NOT IN ('removed', 'uploading')`,
          sql`NOT (${libraryFiles.status} = 'rejected' AND ${libraryFiles.reviewedAt} IS NULL)`
        )
      )
      .orderBy(desc(libraryFiles.createdAt));

    const hasStatusUpdates = uploads.some(
      (u) =>
        (u.status === 'approved' || u.status === 'rejected') &&
        new Date(u.updatedAt) > new Date(lastChecked)
    );

    const totalBytesUsed = uploads
      .filter((u) => u.status !== 'rejected')
      .reduce((acc, curr) => acc + Number(curr.sizeBytes || 0), 0);

    const [pendingRes] = await db
      .select({ count: count() })
      .from(libraryFiles)
      .where(
        and(
          eq(libraryFiles.uploaderUserId, userId),
          sql`${libraryFiles.status} IN ('pending', 'uploading')`
        )
      );

    const pendingCount = Number(pendingRes?.count || 0);

    // En modo "peek" (markChecked = false) solo se consulta, sin consumir la novedad
    if (markChecked) {
      await db
        .update(users)
        .set({ libraryLastCheckedAt: new Date() })
        .where(eq(users.id, userId));
    }

    return {
      uploads,
      hasStatusUpdates,
      quota: {
        usedBytes: totalBytesUsed,
        maxBytes: LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES,
        pendingCount,
        maxPending: LIBRARY_CONFIG.MAX_PENDING_UPLOADS,
      },
    };
  }

  async updateMyFile(
    userId: string,
    fileId: string,
    updates: {
      title?: string;
      description?: string;
      kind?: 'parcial' | 'final' | 'apunte' | 'resumen' | 'tp' | 'guia' | 'otro';
      subjectId?: string;
      academicYear?: number;
      term?: '1C' | '2C' | 'A';
      examInstance?: string;
      hasSolution?: boolean;
    },
    planId?: string | null
  ) {
    if (!isValidUuid(fileId)) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(and(eq(libraryFiles.id, fileId), eq(libraryFiles.uploaderUserId, userId)))
      .limit(1);

    if (!file || file.status === 'removed' || !(await this.isFileAccessibleInPlan(file, planId))) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const payload: Partial<LibraryFile> = {
      updatedAt: new Date(),
    };

    if (updates.title) payload.title = sanitizeLibraryText(updates.title, 120);
    if (updates.description !== undefined) {
      payload.description = updates.description ? sanitizeLibraryText(updates.description, 500) : null;
    }
    if (updates.examInstance !== undefined) {
      payload.examInstance = updates.examInstance ? sanitizeLibraryText(updates.examInstance, 50) : null;
    }
    if (updates.academicYear !== undefined && updates.academicYear !== null) {
      const yearNum = Number(updates.academicYear);
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(yearNum) || yearNum < LIBRARY_CONFIG.ACADEMIC_YEAR_MIN || yearNum > currentYear) {
        throw Object.assign(
          new Error(`El año académico debe ser un número entero entre ${LIBRARY_CONFIG.ACADEMIC_YEAR_MIN} y ${currentYear}.`),
          { status: 400 }
        );
      }
      payload.academicYear = yearNum;
    } else if (updates.academicYear === null) {
      payload.academicYear = null;
    }

    if (updates.term !== undefined && updates.term !== null && (updates.term as any) !== '') {
      if (!['1C', '2C', 'A'].includes(updates.term)) {
        throw Object.assign(
          new Error("El cuatrimestre debe ser '1C', '2C' o 'A'."),
          { status: 400 }
        );
      }
      payload.term = updates.term;
    } else if (updates.term === null || (updates.term as any) === '') {
      payload.term = null;
    }
    if (updates.hasSolution !== undefined) payload.hasSolution = Boolean(updates.hasSolution);

    if (
      (updates.subjectId && updates.subjectId !== file.subjectId) ||
      (updates.kind && updates.kind !== file.kind)
    ) {
      if (updates.subjectId) {
        if (!isValidUuid(updates.subjectId)) {
          throw Object.assign(new Error('La materia especificada no pertenece a tu plan de estudios.'), { status: 404 });
        }
        const [newSub] = await db
          .select({
            id: subjects.id,
            planId: subjects.planId,
            sharedSubjectId: subjects.sharedSubjectId,
          })
          .from(subjects)
          .where(
            planId
              ? and(eq(subjects.id, updates.subjectId), eq(subjects.planId, planId))
              : eq(subjects.id, updates.subjectId)
          )
          .limit(1);
        if (!newSub) {
          throw Object.assign(new Error('La materia especificada no pertenece a tu plan de estudios.'), { status: 404 });
        }
        payload.subjectId = newSub.id;
        payload.sharedSubjectId = newSub.sharedSubjectId ?? null;
        payload.sourceSubjectId = newSub.id;
        payload.sourcePlanId = newSub.planId ?? null;
      }
      if (updates.kind) payload.kind = updates.kind;
      payload.status = 'pending';
      payload.rejectionReason = null;
      payload.reviewedBy = null;
      payload.reviewedAt = null;
    }

    const [updated] = await db
      .update(libraryFiles)
      .set(payload)
      .where(eq(libraryFiles.id, fileId))
      .returning();

    return updated;
  }

  async deleteMyFile(userId: string, fileId: string, planId?: string | null) {
    if (!isValidUuid(fileId)) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(and(eq(libraryFiles.id, fileId), eq(libraryFiles.uploaderUserId, userId)))
      .limit(1);

    if (!file || !(await this.isFileAccessibleInPlan(file, planId))) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const deletedR2 = await this.r2.deleteObject(file.storageKey);
    if (!deletedR2) {
      await db
        .insert(libraryOrphanDeletions)
        .values({ storageKey: file.storageKey, lastError: 'Error de red al borrar en R2' })
        .onConflictDoNothing();
    }

    await db
      .update(libraryFiles)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(eq(libraryFiles.id, fileId));

    return { success: true, message: 'Archivo eliminado exitosamente.' };
  }

  async listPendingFiles(filters?: { careerId?: string; planId?: string }) {
    const conditions = [eq(libraryFiles.status, 'pending')];
    if (filters?.careerId && filters.careerId !== 'all') {
      conditions.push(eq(careers.id, filters.careerId));
    }
    if (filters?.planId && filters.planId !== 'all') {
      conditions.push(eq(studyPlans.id, filters.planId));
    }

    const rows = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
        subjectName: subjects.name,
        subjectCode: subjects.codeInPlan,
        careerId: careers.id,
        careerCode: careers.code,
        careerName: careers.name,
        planId: studyPlans.id,
        planName: studyPlans.name,
        planYear: studyPlans.year,
        planStatus: studyPlans.status,
        facultyName: faculties.name,
        kind: libraryFiles.kind,
        academicYear: libraryFiles.academicYear,
        term: libraryFiles.term,
        examInstance: libraryFiles.examInstance,
        hasSolution: libraryFiles.hasSolution,
        title: libraryFiles.title,
        description: libraryFiles.description,
        originalFilename: libraryFiles.originalFilename,
        mimeType: libraryFiles.mimeType,
        sizeBytes: libraryFiles.sizeBytes,
        sha256: libraryFiles.sha256,
        status: libraryFiles.status,
        adminNotifiedAt: libraryFiles.adminNotifiedAt,
        uploaderNotifiedAt: libraryFiles.uploaderNotifiedAt,
        createdAt: libraryFiles.createdAt,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .innerJoin(studyPlans, eq(subjects.planId, studyPlans.id))
      .innerJoin(careers, eq(studyPlans.careerId, careers.id))
      .innerJoin(faculties, eq(careers.facultyId, faculties.id))
      .where(and(...conditions))
      .orderBy(asc(libraryFiles.createdAt));

    const fileIds = rows.map((r) => r.id);
    const profRows = fileIds.length > 0
      ? await db
          .select({
            fileId: libraryFileProfessors.fileId,
            professorId: professors.id,
            displayName: professors.displayName,
          })
          .from(libraryFileProfessors)
          .innerJoin(professors, eq(libraryFileProfessors.professorId, professors.id))
          .where(inArray(libraryFileProfessors.fileId, fileIds))
      : [];

    const profsMap = new Map<string, Array<{ id: string; displayName: string }>>();
    for (const p of profRows) {
      const list = profsMap.get(p.fileId) || [];
      list.push({ id: p.professorId, displayName: p.displayName });
      profsMap.set(p.fileId, list);
    }

    return rows.map((r) => ({
      ...r,
      professors: profsMap.get(r.id) || [],
    }));
  }

  async listAllFilesAdmin(filters: ListAdminLibraryFilters) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.pageSize || 25));
    const offset = (page - 1) * limit;

    const conditions = [];

    if (filters.status && filters.status !== 'all') {
      conditions.push(eq(libraryFiles.status, filters.status));
    }
    if (filters.subjectId && filters.subjectId !== 'all') {
      conditions.push(eq(libraryFiles.subjectId, filters.subjectId));
    }
    if (filters.careerId && filters.careerId !== 'all') {
      conditions.push(eq(careers.id, filters.careerId));
    }
    if (filters.planId && filters.planId !== 'all') {
      conditions.push(eq(studyPlans.id, filters.planId));
    }
    if (filters.kind && filters.kind !== 'all') {
      conditions.push(eq(libraryFiles.kind, filters.kind));
    }
    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          sql`LOWER(${libraryFiles.title}) LIKE ${q}`,
          sql`LOWER(${libraryFiles.originalFilename}) LIKE ${q}`,
          sql`LOWER(COALESCE(${libraryFiles.description}, '')) LIKE ${q}`
        )!
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes] = await db
      .select({ value: count() })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .innerJoin(studyPlans, eq(subjects.planId, studyPlans.id))
      .innerJoin(careers, eq(studyPlans.careerId, careers.id))
      .innerJoin(faculties, eq(careers.facultyId, faculties.id))
      .where(whereClause);

    const total = totalRes?.value || 0;

    const rows = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
        subjectName: subjects.name,
        subjectCode: subjects.codeInPlan,
        careerId: careers.id,
        careerCode: careers.code,
        careerName: careers.name,
        planId: studyPlans.id,
        planName: studyPlans.name,
        planYear: studyPlans.year,
        planStatus: studyPlans.status,
        facultyName: faculties.name,
        kind: libraryFiles.kind,
        academicYear: libraryFiles.academicYear,
        term: libraryFiles.term,
        examInstance: libraryFiles.examInstance,
        hasSolution: libraryFiles.hasSolution,
        title: libraryFiles.title,
        description: libraryFiles.description,
        originalFilename: libraryFiles.originalFilename,
        mimeType: libraryFiles.mimeType,
        sizeBytes: libraryFiles.sizeBytes,
        status: libraryFiles.status,
        rejectionReason: libraryFiles.rejectionReason,
        adminNotifiedAt: libraryFiles.adminNotifiedAt,
        uploaderNotifiedAt: libraryFiles.uploaderNotifiedAt,
        downloadCount: libraryFiles.downloadCount,
        helpfulCount: libraryFiles.helpfulCount,
        createdAt: libraryFiles.createdAt,
        updatedAt: libraryFiles.updatedAt,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .innerJoin(studyPlans, eq(subjects.planId, studyPlans.id))
      .innerJoin(careers, eq(studyPlans.careerId, careers.id))
      .innerJoin(faculties, eq(careers.facultyId, faculties.id))
      .where(whereClause)
      .orderBy(desc(libraryFiles.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPreviewUrl(fileId: string) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (file.status === 'rejected' || file.status === 'removed') {
      throw Object.assign(
        new Error(
          `No se puede previsualizar el archivo porque su estado es '${file.status}' y su contenido fue purgado.`
        ),
        { status: 410, code: 'FILE_CONTENT_PURGED' }
      );
    }

    const previewUrl = await this.r2.getPresignedDownloadUrl({
      key: file.storageKey,
      filename: file.originalFilename,
      mimeType: file.mimeType,
      expiresInSeconds: LIBRARY_CONFIG.PRESIGNED_PREVIEW_EXPIRES_SECONDS,
    });

    return {
      previewUrl,
      mimeType: file.mimeType,
      originalFilename: file.originalFilename,
      sizeBytes: file.sizeBytes,
    };
  }

  async approveFile(fileId: string, adminUserId: string) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const [updated] = await db
      .update(libraryFiles)
      .set({
        status: 'approved',
        rejectionReason: null,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(libraryFiles.id, fileId))
      .returning();

    // Notificar al estudiante que subió el archivo (agrupado y debounced)
    if (file.status === 'pending' && !file.uploaderNotifiedAt) {
      recordUploaderAction();
    }

    return updated;
  }

  async rejectFile(fileId: string, adminUserId: string, reason: string) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const cleanReason = sanitizeLibraryText(reason, 500) || 'El archivo no cumple con las pautas de publicación.';

    const [updated] = await db
      .update(libraryFiles)
      .set({
        status: 'rejected',
        rejectionReason: cleanReason,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(libraryFiles.id, fileId))
      .returning();

    // 3a: Encolar el borrado del objeto de R2 en library_orphan_deletions (con reintentos)
    if (file.storageKey) {
      await db.insert(libraryOrphanDeletions).values({
        storageKey: file.storageKey,
        attempts: 0,
      });
    }

    // Notificar al estudiante del rechazo con el motivo indicado (agrupado y debounced)
    if (!file.uploaderNotifiedAt) {
      recordUploaderAction();
    }

    return updated;
  }

  async resendAdminNotification(fileId: string) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (file.status !== 'pending') {
      throw Object.assign(
        new Error('Solo se pueden reenviar avisos para archivos en estado pendiente de revisión.'),
        { status: 400 }
      );
    }

    // Reiniciar marca de notificación para permitir reenvío
    await db
      .update(libraryFiles)
      .set({ adminNotifiedAt: null })
      .where(eq(libraryFiles.id, fileId));

    const sent = await notifyAdminNewPendingFile(fileId);
    return {
      success: sent,
      message: sent
        ? 'Aviso reenviado correctamente a los administradores.'
        : 'No se pudo enviar el aviso (verifique la configuración de correo o el límite de envíos).',
      notifiedAt: sent ? new Date() : undefined,
    };
  }

  async removeFile(fileId: string, adminUserId: string, reason?: string) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const cleanReason = reason ? sanitizeLibraryText(reason, 500) : 'Dado de baja por moderación.';

    const [updated] = await db
      .update(libraryFiles)
      .set({
        status: 'removed',
        rejectionReason: cleanReason,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(libraryFiles.id, fileId))
      .returning();

    await this.r2.deleteObject(file.storageKey);

    return updated;
  }

  async getUploaderIdentity(
    fileId: string,
    adminUser: { id: string; email: string },
    ip?: string
  ) {
    const [file] = await db
      .select({
        id: libraryFiles.id,
        title: libraryFiles.title,
        uploaderUserId: libraryFiles.uploaderUserId,
      })
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (!file.uploaderUserId) {
      return {
        hasUploader: false,
        message: 'El autor original dio de baja su cuenta o desvinculó sus datos personales.',
      };
    }

    const [author] = await db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, file.uploaderUserId))
      .limit(1);

    if (!author) {
      return {
        hasUploader: false,
        message: 'Usuario no encontrado en la base de datos.',
      };
    }

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'library.view_uploader',
      targetType: 'library_file',
      targetId: file.id,
      targetEmail: author.email,
      details: {
        fileId: file.id,
        fileTitle: file.title,
        authorUserId: author.id,
      },
      ip,
    });

    return {
      hasUploader: true,
      uploader: {
        id: author.id,
        email: author.email,
        status: author.status,
        role: author.role,
        createdAt: author.createdAt,
      },
    };
  }

  async suspendAuthor(
    fileId: string,
    adminUser: { id: string; email: string },
    reason: string,
    ip?: string
  ) {
    const [file] = await db
      .select({
        id: libraryFiles.id,
        title: libraryFiles.title,
        uploaderUserId: libraryFiles.uploaderUserId,
      })
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file || !file.uploaderUserId) {
      throw Object.assign(
        new Error('No se encontró al autor del archivo o la cuenta ya no existe.'),
        { status: 404 }
      );
    }

    if (file.uploaderUserId === adminUser.id) {
      throw Object.assign(new Error('No podés suspender tu propia cuenta de administrador.'), {
        status: 400,
      });
    }

    const [author] = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, file.uploaderUserId))
      .limit(1);

    if (!author) {
      throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
    }

    if (author.role === 'admin') {
      throw Object.assign(
        new Error('No podés suspender a un administrador. Debe ser degradado previamente.'),
        { status: 400 }
      );
    }

    const cleanReason = sanitizeLibraryText(reason, 500) || 'Infracción grave de los términos de la biblioteca.';

    await db
      .update(users)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(users.id, author.id));

    invalidateUserStatusCache(author.id);

    await db
      .update(libraryFiles)
      .set({ status: 'hidden', rejectionReason: cleanReason, updatedAt: new Date() })
      .where(eq(libraryFiles.id, fileId));

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'library.suspend_author',
      targetType: 'user',
      targetId: author.id,
      targetEmail: author.email,
      details: {
        fileId: file.id,
        fileTitle: file.title,
        reason: cleanReason,
      },
      ip,
    });

    return {
      success: true,
      message: `El autor ha sido suspendido y el archivo ${file.id} fue ocultado.`,
    };
  }

  async listReports(
    status: 'open' | 'dismissed' | 'actioned' | 'all' = 'open',
    filters?: { careerId?: string; planId?: string }
  ) {
    const conditions = [];
    if (status !== 'all') {
      conditions.push(eq(libraryReports.status, status));
    }
    if (filters?.careerId && filters.careerId !== 'all') {
      conditions.push(eq(careers.id, filters.careerId));
    }
    if (filters?.planId && filters.planId !== 'all') {
      conditions.push(eq(studyPlans.id, filters.planId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await db
      .select({
        id: libraryReports.id,
        fileId: libraryReports.fileId,
        fileTitle: libraryFiles.title,
        fileKind: libraryFiles.kind,
        fileStatus: libraryFiles.status,
        subjectId: libraryFiles.subjectId,
        subjectName: subjects.name,
        careerId: careers.id,
        careerCode: careers.code,
        careerName: careers.name,
        planId: studyPlans.id,
        planName: studyPlans.name,
        planYear: studyPlans.year,
        planStatus: studyPlans.status,
        facultyName: faculties.name,
        reporterUserId: libraryReports.reporterUserId,
        reason: libraryReports.reason,
        note: libraryReports.note,
        status: libraryReports.status,
        createdAt: libraryReports.createdAt,
      })
      .from(libraryReports)
      .innerJoin(libraryFiles, eq(libraryReports.fileId, libraryFiles.id))
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .innerJoin(studyPlans, eq(subjects.planId, studyPlans.id))
      .innerJoin(careers, eq(studyPlans.careerId, careers.id))
      .innerJoin(faculties, eq(careers.facultyId, faculties.id))
      .where(whereClause)
      .orderBy(desc(libraryReports.createdAt));
  }

  async updateReportStatus(reportId: string, newStatus: 'open' | 'dismissed' | 'actioned') {
    const [updated] = await db
      .update(libraryReports)
      .set({ status: newStatus })
      .where(eq(libraryReports.id, reportId))
      .returning();

    return updated;
  }

  async getLibraryStats() {
    const [approvedFiles] = await db
      .select({
        count: count(),
        totalBytes: sql<number>`COALESCE(SUM(${libraryFiles.sizeBytes}), 0)`,
      })
      .from(libraryFiles)
      .where(eq(libraryFiles.status, 'approved'));

    const [pendingFiles] = await db
      .select({ count: count() })
      .from(libraryFiles)
      .where(eq(libraryFiles.status, 'pending'));

    const [openReports] = await db
      .select({ count: count() })
      .from(libraryReports)
      .where(eq(libraryReports.status, 'open'));

    const totalBytes = Number(approvedFiles?.totalBytes || 0);

    return {
      approvedCount: Number(approvedFiles?.count || 0),
      pendingCount: Number(pendingFiles?.count || 0),
      openReportsCount: Number(openReports?.count || 0),
      totalSizeBytes: totalBytes,
      totalSizeFormatted: `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`,
      storageWarning: totalBytes >= LIBRARY_CONFIG.STORAGE_WARNING_THRESHOLD_BYTES,
    };
  }

  async testR2Connection(adminUser: { id: string; email: string }, ip?: string): Promise<StorageTestResult> {
    const result = await this.r2.testConnection();

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'library.test_storage',
      targetType: 'storage',
      details: {
        success: result.success,
        isMock: result.isMock,
        errorStep: result.errorStep || null,
        message: result.message,
      },
      ip,
    });

    return result;
  }

  async cleanupAbandonedUploads() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Subidas huérfanas > 24h
    const abandonedFiles = await db
      .select({ id: libraryFiles.id, storageKey: libraryFiles.storageKey })
      .from(libraryFiles)
      .where(
        and(eq(libraryFiles.status, 'uploading'), sql`${libraryFiles.createdAt} < ${oneDayAgo}`)
      )
      .limit(100);

    let cleanedCount = 0;
    for (const f of abandonedFiles) {
      await this.r2.deleteObject(f.storageKey);
      await db.delete(libraryFiles).where(eq(libraryFiles.id, f.id));
      cleanedCount++;
    }

    // 2. Reintentar objetos huérfanos registrados con límite de reintentos
    const orphans = await db
      .select()
      .from(libraryOrphanDeletions)
      .where(sql`${libraryOrphanDeletions.attempts} < 5`)
      .limit(50);

    for (const o of orphans) {
      try {
        const ok = await this.r2.deleteObject(o.storageKey);
        if (ok) {
          await db.delete(libraryOrphanDeletions).where(eq(libraryOrphanDeletions.id, o.id));
        } else {
          await db
            .update(libraryOrphanDeletions)
            .set({
              attempts: sql`${libraryOrphanDeletions.attempts} + 1`,
              lastError: 'Fallo al eliminar objeto en R2',
            })
            .where(eq(libraryOrphanDeletions.id, o.id));
        }
      } catch (err: any) {
        await db
          .update(libraryOrphanDeletions)
          .set({
            attempts: sql`${libraryOrphanDeletions.attempts} + 1`,
            lastError: err?.message || String(err),
          })
          .where(eq(libraryOrphanDeletions.id, o.id));
      }
    }

    // 3. Purga periódica de library_download_logs (registros de más de 7 días - Requisito 2)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const purgedLogs = await db
      .delete(libraryDownloadLogs)
      .where(sql`${libraryDownloadLogs.downloadedAt} < ${sevenDaysAgo}`)
      .returning({ id: libraryDownloadLogs.id });

    return { cleanedCount, purgedLogsCount: purgedLogs.length };
  }

  async handleAccountDeletion(userId: string, deleteFiles: boolean) {
    if (deleteFiles) {
      const userFiles = await db
        .select({ id: libraryFiles.id, storageKey: libraryFiles.storageKey })
        .from(libraryFiles)
        .where(eq(libraryFiles.uploaderUserId, userId));

      for (const f of userFiles) {
        try {
          const ok = await this.r2.deleteObject(f.storageKey);
          if (!ok) {
            await db
              .insert(libraryOrphanDeletions)
              .values({ storageKey: f.storageKey, lastError: 'Fallo al borrar cuenta' })
              .onConflictDoNothing();
          }
        } catch (err: any) {
          await db
            .insert(libraryOrphanDeletions)
            .values({ storageKey: f.storageKey, lastError: err?.message || String(err) })
            .onConflictDoNothing();
        }
      }

      await db.delete(libraryFiles).where(eq(libraryFiles.uploaderUserId, userId));
    } else {
      await db
        .update(libraryFiles)
        .set({ uploaderUserId: null })
        .where(eq(libraryFiles.uploaderUserId, userId));
    }
  }
}

/**
 * Implementación en memoria aislada para tests y desarrollo sin base de datos ni R2 activo.
 * Reproduce fielmente las reglas de negocio, integridad referencial y condiciones de carrera.
 */
export class InMemoryLibraryService implements ILibraryService, IMailerDataSource {
  private r2: IR2StorageService;
  private userLocks = new Map<string, Promise<void>>();

  public users = new Map<string, {
    id: string;
    email: string;
    role: 'user' | 'admin';
    status: 'active' | 'suspended';
    emailVerifiedAt: Date | null;
    libraryTermsAcceptedAt: Date | null;
    libraryTermsVersion: string | null;
    libraryLastCheckedAt: Date | null;
    notifyLibraryEmail?: boolean;
  }>();

  public subjects = new Map<string, { id: string; name: string; codeInPlan: number; level: number; kind: string; planId?: string; sharedSubjectId?: string | null }>();
  public plans = new Map<string, { id: string; name: string; year: number; status: string; careerId: string; careerCode: string; careerName: string; facultyName: string }>();
  public professors = new Map<string, { id: string; displayName: string }>();
  public files = new Map<string, any>();
  public fileProfessors = new Map<string, Set<string>>(); // fileId -> Set<professorId>
  public downloads = new Map<string, Date>(); // `${fileId}:${userId}` -> date
  public downloadLogs: Array<{ id: string; fileId: string; userId: string; downloadedAt: Date }> = [];
  public helpfulVotes = new Set<string>(); // `${fileId}:${userId}`
  public reports = new Map<string, any>(); // reportId -> report
  public orphanDeletions = new Map<string, { id: string; storageKey: string; attempts: number; lastError: string | null; createdAt: Date }>();
  public simulateSha256CollisionOnComplete = false;

  constructor(r2Service?: IR2StorageService) {
    this.r2 = r2Service || new MemoryMockR2Service();
    setMailerDataSource(this);
  }

  private async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prevLock = this.userLocks.get(userId) || Promise.resolve();
    let resolveLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.userLocks.set(userId, currentLock);

    try {
      await prevLock;
      return await fn();
    } finally {
      resolveLock();
      if (this.userLocks.get(userId) === currentLock) {
        this.userLocks.delete(userId);
      }
    }
  }

  private getSubjectHierarchy(subjectId: string) {
    const sub = this.subjects.get(subjectId);
    const planId = sub?.planId || null;
    const plan = planId ? this.plans.get(planId) : undefined;
    return {
      careerId: plan?.careerId ?? null,
      careerCode: plan?.careerCode ?? null,
      careerName: plan?.careerName ?? null,
      planId,
      planName: plan?.name ?? null,
      planYear: plan?.year ?? null,
      planStatus: plan?.status ?? null,
      facultyName: plan?.facultyName ?? null,
    };
  }

  async getPendingAdminFiles(): Promise<LibraryFileNotificationItem[]> {
    const res: LibraryFileNotificationItem[] = [];
    for (const f of this.files.values()) {
      if (f.status === 'pending' && !f.adminNotifiedAt) {
        const sub = this.subjects.get(f.subjectId);
        const hier = this.getSubjectHierarchy(f.subjectId);
        res.push({
          id: f.id,
          title: f.title,
          kind: f.kind,
          academicYear: f.academicYear,
          term: f.term,
          sizeBytes: f.sizeBytes,
          mimeType: f.mimeType,
          createdAt: f.createdAt,
          subjectName: sub?.name || 'Materia',
          careerId: hier.careerId,
          careerCode: hier.careerCode,
          careerName: hier.careerName,
          planName: hier.planName,
          facultyName: hier.facultyName,
        });
      }
    }
    return res.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async markAdminNotified(fileIds: string[]): Promise<void> {
    const idSet = new Set(fileIds);
    for (const f of this.files.values()) {
      if (idSet.has(f.id)) {
        f.adminNotifiedAt = new Date();
      }
    }
  }

  async getPendingUploaderFiles(): Promise<PendingUploaderFileItem[]> {
    const res: PendingUploaderFileItem[] = [];
    for (const f of this.files.values()) {
      if (
        (f.status === 'approved' || f.status === 'rejected') &&
        !f.uploaderNotifiedAt &&
        f.uploaderUserId &&
        !(f.status === 'rejected' && !f.reviewedAt)
      ) {
        const u = this.users.get(f.uploaderUserId);
        const sub = this.subjects.get(f.subjectId);
        const hier = this.getSubjectHierarchy(f.subjectId);
        if (u) {
          res.push({
            fileId: f.id,
            uploaderUserId: f.uploaderUserId,
            userEmail: u.email,
            userStatus: u.status,
            notifyLibraryEmail: u.notifyLibraryEmail !== false,
            status: f.status as 'approved' | 'rejected',
            title: f.title,
            subjectName: sub?.name || 'Materia',
            careerId: hier.careerId,
            careerCode: hier.careerCode,
            careerName: hier.careerName,
            planName: hier.planName,
            facultyName: hier.facultyName,
            rejectionReason: f.rejectionReason,
          });
        }
      }
    }
    return res;
  }

  async markUploaderNotified(fileIds: string[]): Promise<void> {
    const idSet = new Set(fileIds);
    for (const f of this.files.values()) {
      if (idSet.has(f.id)) {
        f.uploaderNotifiedAt = new Date();
      }
    }
  }

  // Métodos auxiliares de seeding para tests
  seedPlan(plan: {
    id: string;
    name: string;
    year: number;
    status?: string;
    careerId: string;
    careerCode: string;
    careerName: string;
    facultyName?: string;
  }) {
    this.plans.set(plan.id, {
      id: plan.id,
      name: plan.name,
      year: plan.year,
      status: plan.status || 'published',
      careerId: plan.careerId,
      careerCode: plan.careerCode,
      careerName: plan.careerName,
      facultyName: plan.facultyName || 'UTN FRC',
    });
  }
  seedUser(user: { id: string; email: string; role?: 'user' | 'admin'; status?: 'active' | 'suspended'; emailVerified?: boolean; termsAccepted?: boolean; notifyLibraryEmail?: boolean }) {
    this.users.set(user.id, {
      id: user.id,
      email: user.email,
      role: user.role || 'user',
      status: user.status || 'active',
      emailVerifiedAt: user.emailVerified !== false ? new Date() : null,
      libraryTermsAcceptedAt: user.termsAccepted ? new Date() : null,
      libraryTermsVersion: user.termsAccepted ? LIBRARY_CONFIG.CURRENT_TERMS_VERSION : null,
      libraryLastCheckedAt: null,
      notifyLibraryEmail: user.notifyLibraryEmail ?? true,
    });
  }

  seedSubject(s: { id: string; name: string; codeInPlan: number; level: number; kind?: string; planId?: string; sharedSubjectId?: string | null }) {
    this.subjects.set(s.id, {
      id: s.id,
      name: s.name,
      codeInPlan: s.codeInPlan,
      level: s.level,
      kind: s.kind || 'integradora',
      planId: s.planId || 'plan-2023',
      sharedSubjectId: s.sharedSubjectId ?? null,
    });
  }

  seedProfessor(p: { id: string; displayName: string }) {
    this.professors.set(p.id, p);
  }

  async acceptTerms(userId: string, version: string = LIBRARY_CONFIG.CURRENT_TERMS_VERSION) {
    const u = this.users.get(userId);
    if (u) {
      u.libraryTermsAcceptedAt = new Date();
      u.libraryTermsVersion = version;
    }
    return { success: true, acceptedAt: new Date(), version };
  }

  async getTermsStatus(userId: string) {
    const u = this.users.get(userId);
    const isAccepted = Boolean(
      u?.libraryTermsAcceptedAt && u?.libraryTermsVersion === LIBRARY_CONFIG.CURRENT_TERMS_VERSION
    );
    return {
      accepted: isAccepted,
      acceptedAt: u?.libraryTermsAcceptedAt || null,
      version: u?.libraryTermsVersion || null,
      currentVersion: LIBRARY_CONFIG.CURRENT_TERMS_VERSION,
    };
  }

  private isFileAccessibleInPlanInMemory(
    file: { subjectId: string; sharedSubjectId?: string | null; sourcePlanId?: string | null },
    planId?: string | null
  ): boolean {
    if (!planId) return true;
    if (file.sourcePlanId === planId) return true;
    for (const s of this.subjects.values()) {
      if (s.planId !== planId) continue;
      if (s.id === file.subjectId) return true;
      if (file.sharedSubjectId && s.sharedSubjectId === file.sharedSubjectId) return true;
    }
    return false;
  }

  async initUpload(userId: string, input: InitUploadInput, planId?: string | null) {
    return await this.withUserLock(userId, async () => {
      checkInitUploadRateLimit(userId);

      const currentYear = new Date().getFullYear();
      if (input.academicYear !== undefined && input.academicYear !== null) {
        const yearNum = Number(input.academicYear);
        if (!Number.isInteger(yearNum) || yearNum < LIBRARY_CONFIG.ACADEMIC_YEAR_MIN || yearNum > currentYear) {
          throw Object.assign(
            new Error(`El año académico debe ser un número entero entre ${LIBRARY_CONFIG.ACADEMIC_YEAR_MIN} y ${currentYear}.`),
            { status: 400 }
          );
        }
      }

      if (input.term !== undefined && input.term !== null && (input.term as string) !== '') {
        if (!['1C', '2C', 'A'].includes(input.term)) {
          throw Object.assign(
            new Error("El cuatrimestre debe ser '1C', '2C' o 'A'."),
            { status: 400 }
          );
        }
      }

      if (!LIBRARY_CONFIG.ALLOWED_MIME_TYPES.includes(input.mimeType as AllowedMimeType)) {
        throw Object.assign(
          new Error(`Formato de archivo no permitido (${input.mimeType}). Solo se admiten PDF, JPG, PNG y WebP.`),
          { status: 400 }
        );
      }

      const ext = path.extname(input.originalFilename || '').toLowerCase();
      if (!LIBRARY_CONFIG.ALLOWED_EXTENSIONS.includes(ext as any)) {
        throw Object.assign(
          new Error(`Extensión no permitida (${ext}). Solo se admiten archivos .pdf, .jpg, .jpeg, .png y .webp.`),
          { status: 400 }
        );
      }

      const isPdf = input.mimeType === 'application/pdf';
      const maxSize = isPdf ? LIBRARY_CONFIG.MAX_PDF_SIZE_BYTES : LIBRARY_CONFIG.MAX_IMAGE_SIZE_BYTES;
      const typeLabel = isPdf ? 'documentos PDF (25 MB)' : 'imágenes (10 MB)';

      if (input.sizeBytes <= 0 || input.sizeBytes > maxSize) {
        throw Object.assign(new Error(`El archivo excede el tamaño máximo permitido para ${typeLabel}.`), { status: 400 });
      }

      const subject = this.subjects.get(input.subjectId);
      if (!subject || (planId && subject.planId !== planId)) {
        throw Object.assign(new Error('La materia especificada no existe en el catálogo.'), { status: 404 });
      }

      const cleanTitle = sanitizeLibraryText(input.title, 120);
      if (!cleanTitle || cleanTitle.length < 3) {
        throw Object.assign(new Error('El título debe tener al menos 3 caracteres.'), { status: 400 });
      }
      const cleanDescription = input.description ? sanitizeLibraryText(input.description, 500) : null;
      const cleanExamInstance = input.examInstance ? sanitizeLibraryText(input.examInstance, 50) : null;

      if (checkLibraryProfanity(cleanTitle) || (cleanDescription && checkLibraryProfanity(cleanDescription))) {
        throw Object.assign(
          new Error('El texto contiene expresiones no permitidas según las normas de la comunidad.'),
          { status: 400 }
        );
      }

      const user = this.users.get(userId);
      if (!user) {
        throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
      }
      if (!user.emailVerifiedAt) {
        throw Object.assign(new Error('Debés verificar tu correo electrónico para subir material de estudio.'), { status: 403 });
      }
      if (!user.libraryTermsAcceptedAt || user.libraryTermsVersion !== LIBRARY_CONFIG.CURRENT_TERMS_VERSION) {
        if (input.acceptTerms) {
          user.libraryTermsAcceptedAt = new Date();
          user.libraryTermsVersion = LIBRARY_CONFIG.CURRENT_TERMS_VERSION;
        } else {
          throw Object.assign(new Error('Debés aceptar los Términos de la Biblioteca antes de subir tu primer archivo.'), {
            status: 403,
            code: 'TERMS_REQUIRED',
          });
        }
      }

      // Limpieza proactiva de subidas incompletas de más de 30 min para este usuario
      const staleThreshold = new Date(
        Date.now() - LIBRARY_CONFIG.UPLOADING_EXPIRATION_MINUTES * 60 * 1000
      );
      for (const [id, f] of this.files.entries()) {
        if (f.uploaderUserId === userId && f.status === 'uploading' && f.createdAt < staleThreshold) {
          this.files.delete(id);
        }
      }

      // Freno anti-spam: bloqueo temporal si acumula >= MAX_REJECTIONS_THRESHOLD rechazos en REJECTIONS_WINDOW_DAYS
      if (LIBRARY_CONFIG.MAX_REJECTIONS_THRESHOLD > 0 && LIBRARY_CONFIG.REJECTIONS_WINDOW_DAYS > 0) {
        const windowStart = new Date(Date.now() - LIBRARY_CONFIG.REJECTIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const rejectedFiles = Array.from(this.files.values()).filter(
          (f) =>
            f.uploaderUserId === userId &&
            f.status === 'rejected' &&
            f.reviewedAt &&
            f.reviewedAt >= windowStart
        );
        if (rejectedFiles.length >= LIBRARY_CONFIG.MAX_REJECTIONS_THRESHOLD) {
          let oldestDate = windowStart;
          for (const f of rejectedFiles) {
            if (f.reviewedAt && f.reviewedAt < oldestDate) oldestDate = f.reviewedAt;
          }
          const unlockTime = new Date(oldestDate.getTime() + LIBRARY_CONFIG.REJECTIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
          const hoursLeft = Math.max(1, Math.ceil((unlockTime.getTime() - Date.now()) / (1000 * 60 * 60)));
          throw Object.assign(
            new Error(
              `Tu cuenta acumula ${rejectedFiles.length} archivos rechazados en los últimos ${LIBRARY_CONFIG.REJECTIONS_WINDOW_DAYS} días. Podrás volver a subir material en aproximadamente ${hoursLeft} hora(s).`
            ),
            { status: 429, code: 'TOO_MANY_REJECTIONS' }
          );
        }
      }

      // Pendientes simultáneos (incluye 'pending' y 'uploading' activos)
      const userPending = Array.from(this.files.values()).filter(
        (f) => f.uploaderUserId === userId && (f.status === 'pending' || f.status === 'uploading')
      ).length;

      if (userPending >= LIBRARY_CONFIG.MAX_PENDING_UPLOADS) {
        throw Object.assign(
          new Error(
            `Tenés ${LIBRARY_CONFIG.MAX_PENDING_UPLOADS} archivos pendientes de revisión (máximo ${LIBRARY_CONFIG.MAX_PENDING_UPLOADS}). Esperá a que se aprueben para subir más.`
          ),
          { status: 429, code: 'LIMIT_PENDING_UPLOADS' }
        );
      }

      // Cuota total
      const currentQuota = Array.from(this.files.values())
        .filter((f) => f.uploaderUserId === userId && !['removed', 'rejected'].includes(f.status))
        .reduce((sum, f) => sum + f.sizeBytes, 0);

      if (currentQuota + input.sizeBytes > LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES) {
        throw Object.assign(
          new Error(`La subida excede tu cuota total de almacenamiento (${Math.round(LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES / (1024 * 1024))} MB). Eliminá material antiguo o esperá la moderación.`),
          { status: 429, code: 'LIMIT_STORAGE_QUOTA' }
        );
      }

      const fileId = crypto.randomUUID();
      const storageKey = `library/${fileId}${ext}`;
      const safeOriginalName = input.originalFilename.replace(/[^a-zA-Z0-9._\-áéíóúÁÉÍÓÚñÑ ]/g, '_');

      const fileRecord = {
        id: fileId,
        uploaderUserId: userId,
        subjectId: subject.id,
        sharedSubjectId: subject.sharedSubjectId ?? null,
        sourceSubjectId: subject.id,
        sourcePlanId: subject.planId ?? null,
        kind: input.kind,
        academicYear: input.academicYear || null,
        term: input.term || null,
        examInstance: cleanExamInstance,
        hasSolution: Boolean(input.hasSolution),
        title: cleanTitle,
        description: cleanDescription,
        originalFilename: safeOriginalName,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: null, // Null mientras está en estado uploading (Requisito 1)
        status: 'uploading' as const,
        adminNotifiedAt: null,
        uploaderNotifiedAt: null,
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        downloadCount: 0,
        helpfulCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.files.set(fileId, fileRecord);

      if (input.professorIds && input.professorIds.length > 0) {
        this.fileProfessors.set(fileId, new Set(input.professorIds));
      }

      const uploadUrl = await this.r2.getPresignedUploadUrl({
        key: storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        expiresInSeconds: LIBRARY_CONFIG.PRESIGNED_PUT_EXPIRES_SECONDS,
      });

      return {
        fileId,
        uploadUrl,
        storageKey,
        expiresInSeconds: LIBRARY_CONFIG.PRESIGNED_PUT_EXPIRES_SECONDS,
        headers: {
          'Content-Type': input.mimeType,
          'Content-Length': String(input.sizeBytes),
        },
      };
    });
  }

  private async deleteFromR2OrQueueOrphan(storageKey: string, errorContext: string): Promise<void> {
    let deleted = false;
    let lastError = errorContext;
    try {
      deleted = await this.r2.deleteObject(storageKey);
    } catch (err: any) {
      lastError = `${errorContext}: ${err?.message || String(err)}`;
    }
    if (!deleted) {
      const orphanId = crypto.randomUUID();
      this.orphanDeletions.set(orphanId, {
        id: orphanId,
        storageKey,
        attempts: 0,
        lastError,
        createdAt: new Date(),
      });
    }
  }

  private markAutoRejectedUpload(file: any, rejectionReason: string): void {
    const now = new Date();
    file.status = 'rejected';
    file.rejectionReason = rejectionReason;
    file.uploaderNotifiedAt = now;
    file.updatedAt = now;
  }

  async completeUpload(userId: string, fileId: string, planId?: string | null) {
    const file = this.files.get(fileId);
    if (!file || file.uploaderUserId !== userId || !this.isFileAccessibleInPlanInMemory(file, planId)) {
      throw Object.assign(
        new Error('Archivo no encontrado o la sesión de subida expiró por inactividad.'),
        { status: 404, code: 'UPLOAD_NOT_FOUND_OR_EXPIRED' }
      );
    }

    if (file.status !== 'uploading') {
      if (file.status === 'pending' || file.status === 'approved') {
        return {
          success: true,
          file,
          message: 'Tu archivo quedó en revisión; te avisaremos en "Mis archivos" cuando esté publicado.',
        };
      }
      if (file.status === 'rejected') {
        throw Object.assign(
          new Error(`El archivo fue rechazado: ${file.rejectionReason || 'No cumple las pautas de publicación.'}`),
          { status: 400, code: 'UPLOAD_ALREADY_REJECTED' }
        );
      }
      if (file.status === 'hidden' || file.status === 'removed') {
        throw Object.assign(
          new Error(`El archivo se encuentra en estado '${file.status}'.`),
          { status: 400, code: 'UPLOAD_NOT_ACTIVE' }
        );
      }
      throw Object.assign(new Error(`El archivo se encuentra en estado '${file.status}'.`), {
        status: 400,
        code: 'INVALID_STATUS',
      });
    }

    const head = await this.r2.headObject(file.storageKey);
    if (!head.exists) {
      await this.r2.deleteObject(file.storageKey);
      this.markAutoRejectedUpload(file, 'El archivo no fue recibido en el almacenamiento.');
      throw Object.assign(new Error('No se encontró el archivo en el almacenamiento. Por favor reintentá la subida.'), { status: 400 });
    }

    if (head.sizeBytes !== file.sizeBytes) {
      await this.deleteFromR2OrQueueOrphan(
        file.storageKey,
        'Error al borrar objeto de R2 tras rechazo por tamaño en completeUpload'
      );
      this.markAutoRejectedUpload(
        file,
        `Tamaño transferido (${head.sizeBytes}) no coincide con lo declarado (${file.sizeBytes}).`
      );
      throw Object.assign(new Error('El tamaño real del archivo difiere del declarado. Subida rechazada por seguridad.'), {
        status: 400,
        code: 'INVALID_FILE_CONTENT',
      });
    }

    const validation = await validationSemaphore.runWithLock(async () => {
      const stream = await this.r2.getObjectStream(file.storageKey);
      return await validateFileStream(stream, file.mimeType as AllowedMimeType, file.sizeBytes);
    });

    if (!validation.isValid) {
      await this.deleteFromR2OrQueueOrphan(
        file.storageKey,
        'Error al borrar objeto de R2 tras rechazo de validación en completeUpload'
      );
      const reason = validation.error || 'Fallo en la validación de seguridad del archivo.';
      this.markAutoRejectedUpload(file, reason);
      const code = validation.hasDangerousPdfMarks ? 'DANGEROUS_PDF_CONTENT' : 'INVALID_FILE_CONTENT';
      throw Object.assign(new Error(reason), { status: 400, code });
    }

    // Comprobación de duplicados por SHA-256 (agrupado por sharedSubjectId cuando existe)
    const existingDuplicate = Array.from(this.files.values()).find(
      (f) =>
        f.id !== fileId &&
        f.sha256 === validation.sha256 &&
        !['removed', 'rejected'].includes(f.status) &&
        (file.sharedSubjectId && f.sharedSubjectId
          ? f.sharedSubjectId === file.sharedSubjectId
          : f.subjectId === file.subjectId)
    );

    if (existingDuplicate || this.simulateSha256CollisionOnComplete) {
      await this.deleteFromR2OrQueueOrphan(
        file.storageKey,
        'Error al borrar objeto de R2 tras rechazo por duplicado en completeUpload'
      );
      const reason = 'Ya existe un archivo idéntico en el sistema.';
      this.markAutoRejectedUpload(file, reason);
      throw Object.assign(new Error(reason), { status: 409, code: 'DUPLICATE_FILE' });
    }

    file.sha256 = validation.sha256;
    file.status = 'pending';
    file.rejectionReason = null;
    file.updatedAt = new Date();

    recordUploadCompleted();

    return {
      success: true,
      file,
      message: 'Tu archivo quedó en revisión; te avisaremos en "Mis archivos" cuando esté publicado.',
    };
  }

  async listSubjectsWithCounts(planId?: string | null) {
    const result: any[] = [];
    for (const s of this.subjects.values()) {
      if (planId && s.planId !== planId) continue;
      const seenIds = new Set<string>();
      for (const f of this.files.values()) {
        if (f.status !== 'approved') continue;
        if (f.subjectId === s.id || (s.sharedSubjectId && f.sharedSubjectId === s.sharedSubjectId)) {
          seenIds.add(f.id);
        }
      }
      result.push({
        ...s,
        approvedFilesCount: seenIds.size,
      });
    }
    return result.sort((a, b) => a.level - b.level || a.codeInPlan - b.codeInPlan);
  }

  async listFiles(filters: ListLibraryFilesFilters, currentUserId?: string) {
    let items = Array.from(this.files.values()).filter((f) => f.status === 'approved');
    let targetPlanSubject: { id: string; name: string; codeInPlan: number; sharedSubjectId?: string | null } | null = null;
    const planSubById = new Map<string, { id: string; name: string; codeInPlan: number; sharedSubjectId?: string | null }>();
    const planSubByShared = new Map<string, { id: string; name: string; codeInPlan: number; sharedSubjectId?: string | null }>();

    if (filters.planId) {
      for (const s of this.subjects.values()) {
        if (s.planId !== filters.planId) continue;
        planSubById.set(s.id, s);
        if (s.sharedSubjectId) planSubByShared.set(s.sharedSubjectId, s);
      }

      if (filters.subjectId) {
        const matched = planSubById.get(filters.subjectId);
        if (!matched) {
          throw Object.assign(new Error('La materia especificada no pertenece a tu plan de estudios.'), { status: 404 });
        }
        targetPlanSubject = matched;
        items = items.filter(
          (f) =>
            f.subjectId === matched.id ||
            Boolean(matched.sharedSubjectId && f.sharedSubjectId === matched.sharedSubjectId)
        );
      } else {
        items = items.filter(
          (f) =>
            planSubById.has(f.subjectId) ||
            Boolean(f.sharedSubjectId && planSubByShared.has(f.sharedSubjectId))
        );
      }
    } else if (filters.subjectId) {
      const sub = this.subjects.get(filters.subjectId);
      items = items.filter(
        (f) =>
          f.subjectId === filters.subjectId ||
          Boolean(sub?.sharedSubjectId && f.sharedSubjectId === sub.sharedSubjectId)
      );
    }

    if (filters.kind && filters.kind !== 'all') items = items.filter((f) => f.kind === filters.kind);
    if (filters.year) items = items.filter((f) => f.academicYear === filters.year);
    if (filters.term && filters.term !== 'all') items = items.filter((f) => f.term === filters.term);
    if (filters.hasSolution !== undefined) items = items.filter((f) => f.hasSolution === filters.hasSolution);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      items = items.filter((f) => f.title.toLowerCase().includes(q) || (f.description && f.description.toLowerCase().includes(q)));
    }
    if (filters.professorId) {
      items = items.filter((f) => this.fileProfessors.get(f.id)?.has(filters.professorId!));
    }

    const total = items.length;
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(50, Math.max(1, filters.pageSize || 20));
    const offset = (page - 1) * pageSize;

    if (filters.sort === 'downloads') {
      items.sort((a, b) => b.downloadCount - a.downloadCount);
    } else if (filters.sort === 'helpful') {
      items.sort((a, b) => b.helpfulCount - a.helpfulCount);
    } else {
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    const paged = items.slice(offset, offset + pageSize).map((f) => {
      const resolvedSub =
        targetPlanSubject ||
        planSubById.get(f.subjectId) ||
        (f.sharedSubjectId ? planSubByShared.get(f.sharedSubjectId) : undefined);
      const sub = resolvedSub || this.subjects.get(f.subjectId);
      const profIds = Array.from(this.fileProfessors.get(f.id) || []);
      const profs = profIds.map((pid) => this.professors.get(pid)).filter(Boolean);
      return {
        id: f.id,
        subjectId: sub?.id || f.subjectId,
        sharedSubjectId: f.sharedSubjectId ?? sub?.sharedSubjectId ?? null,
        sourcePlanId: f.sourcePlanId ?? null,
        subjectName: sub?.name || 'Materia',
        subjectCode: sub?.codeInPlan || 0,
        kind: f.kind,
        academicYear: f.academicYear,
        term: f.term,
        examInstance: f.examInstance,
        hasSolution: f.hasSolution,
        title: f.title,
        description: f.description,
        originalFilename: f.originalFilename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        downloadCount: f.downloadCount,
        helpfulCount: f.helpfulCount,
        createdAt: f.createdAt,
        uploaderDisplay: 'Subido por un estudiante', // Privacidad estricta
        professors: profs,
        userHasVotedHelpful: currentUserId ? this.helpfulVotes.has(`${f.id}:${currentUserId}`) : false,
      };
    });

    return {
      items: paged,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getFileDetail(
    fileId: string,
    currentUserId?: string,
    isAdmin = false,
    planId?: string | null
  ) {
    const f = this.files.get(fileId);
    if (!f || (!isAdmin && !this.isFileAccessibleInPlanInMemory(f, planId))) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }
    if (f.status !== 'approved' && !isAdmin && f.uploaderUserId !== currentUserId) {
      throw Object.assign(new Error('El archivo no está disponible públicamente.'), { status: 403 });
    }

    let sub = this.subjects.get(f.subjectId);
    if (planId) {
      for (const cand of this.subjects.values()) {
        if (cand.planId !== planId) continue;
        if (cand.id === f.subjectId || (f.sharedSubjectId && cand.sharedSubjectId === f.sharedSubjectId)) {
          sub = cand;
          break;
        }
      }
    }
    const profIds = Array.from(this.fileProfessors.get(f.id) || []);
    const profs = profIds.map((pid) => this.professors.get(pid)).filter(Boolean);

    return {
      id: f.id,
      subjectId: sub?.id || f.subjectId,
      sharedSubjectId: f.sharedSubjectId ?? sub?.sharedSubjectId ?? null,
      sourcePlanId: f.sourcePlanId ?? null,
      subjectName: sub?.name || 'Materia',
      subjectCode: sub?.codeInPlan || 0,
      kind: f.kind,
      academicYear: f.academicYear,
      term: f.term,
      examInstance: f.examInstance,
      hasSolution: f.hasSolution,
      title: f.title,
      description: f.description,
      originalFilename: f.originalFilename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      downloadCount: f.downloadCount,
      helpfulCount: f.helpfulCount,
      status: f.status,
      createdAt: f.createdAt,
      uploaderDisplay: 'Subido por un estudiante',
      professors: profs,
      userHasVotedHelpful: currentUserId ? this.helpfulVotes.has(`${f.id}:${currentUserId}`) : false,
    };
  }

  async getDownloadUrl(fileId: string, userId: string, isAdmin = false, planId?: string | null) {
    const f = this.files.get(fileId);
    if (!f || (!isAdmin && !this.isFileAccessibleInPlanInMemory(f, planId))) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (f.status === 'rejected' || f.status === 'removed') {
      throw Object.assign(
        new Error('El archivo no está disponible para descarga ya que fue rechazado o dado de baja.'),
        { status: 410, code: 'FILE_NOT_AVAILABLE' }
      );
    }

    if (f.status !== 'approved' && !isAdmin && f.uploaderUserId !== userId) {
      throw Object.assign(new Error('Este archivo se encuentra en revisión y aún no está disponible para descarga.'), { status: 403 });
    }

    // Rate limit horario de descargas
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentDownloads = this.downloadLogs.filter(
      (l) => l.userId === userId && l.downloadedAt >= oneHourAgo
    ).length;

    if (recentDownloads >= LIBRARY_CONFIG.MAX_HOURLY_DOWNLOADS) {
      throw Object.assign(
        new Error(`Superaste el límite de ${LIBRARY_CONFIG.MAX_HOURLY_DOWNLOADS} descargas por hora. Por favor intentá nuevamente más tarde.`),
        { status: 429, code: 'LIMIT_HOURLY_DOWNLOADS' }
      );
    }

    this.downloadLogs.push({ id: crypto.randomUUID(), fileId, userId, downloadedAt: new Date() });

    const downloadKey = `${fileId}:${userId}`;
    if (!this.downloads.has(downloadKey)) {
      this.downloads.set(downloadKey, new Date());
      f.downloadCount++;
    }

    const downloadUrl = await this.r2.getPresignedDownloadUrl({
      key: f.storageKey,
      filename: f.originalFilename,
      mimeType: f.mimeType,
      expiresInSeconds: LIBRARY_CONFIG.PRESIGNED_GET_EXPIRES_SECONDS,
    });

    return {
      downloadUrl,
      filename: f.originalFilename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
    };
  }

  async toggleHelpful(fileId: string, userId: string, planId?: string | null) {
    const f = this.files.get(fileId);
    if (!f || f.status !== 'approved' || !this.isFileAccessibleInPlanInMemory(f, planId)) {
      throw Object.assign(new Error('Archivo no disponible.'), { status: 404 });
    }

    const key = `${fileId}:${userId}`;
    if (this.helpfulVotes.has(key)) {
      this.helpfulVotes.delete(key);
      f.helpfulCount = Math.max(0, f.helpfulCount - 1);
      return { voted: false, helpfulCount: f.helpfulCount };
    } else {
      this.helpfulVotes.add(key);
      f.helpfulCount++;
      return { voted: true, helpfulCount: f.helpfulCount };
    }
  }

  async reportFile(fileId: string, userId: string, reason: any, note?: string, planId?: string | null) {
    const f = this.files.get(fileId);
    if (!f || !this.isFileAccessibleInPlanInMemory(f, planId)) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    const reportId = crypto.randomUUID();
    this.reports.set(reportId, {
      id: reportId,
      fileId,
      reporterUserId: userId,
      reason,
      note: note ? sanitizeLibraryText(note, 300) : null,
      status: 'open',
      createdAt: new Date(),
    });

    const openReports = Array.from(this.reports.values()).filter((r) => r.fileId === fileId && r.status === 'open');
    const totalOpen = openReports.length;
    const copyrightOpen = openReports.filter((r) => r.reason === 'derechos_de_autor').length;

    let autoHidden = false;
    if (
      copyrightOpen >= LIBRARY_CONFIG.AUTO_HIDE_COPYRIGHT_REPORTS_THRESHOLD ||
      totalOpen >= LIBRARY_CONFIG.AUTO_HIDE_GENERAL_REPORTS_THRESHOLD
    ) {
      f.status = 'hidden';
      autoHidden = true;
    }

    return {
      success: true,
      openReportsCount: totalOpen,
      autoHidden,
      message: autoHidden
        ? 'El material fue ocultado preventivamente hasta que un administrador lo revise.'
        : 'Reporte recibido. Un administrador lo revisará a la brevedad.',
    };
  }

  async listMyUploads(userId: string, markChecked = true) {
    const u = this.users.get(userId);
    const lastChecked = u?.libraryLastCheckedAt || new Date(0);

    const uploads = Array.from(this.files.values())
      .filter(
        (f) =>
          f.uploaderUserId === userId &&
          f.status !== 'removed' &&
          f.status !== 'uploading' &&
          !(f.status === 'rejected' && !f.reviewedAt)
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((f) => {
        const sub = this.subjects.get(f.subjectId);
        return {
          id: f.id,
          subjectId: f.subjectId,
          subjectName: sub?.name || 'Materia',
          kind: f.kind,
          title: f.title,
          description: f.description,
          originalFilename: f.originalFilename,
          sizeBytes: f.sizeBytes,
          mimeType: f.mimeType,
          status: f.status,
          rejectionReason: f.rejectionReason,
          downloadCount: f.downloadCount,
          helpfulCount: f.helpfulCount,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        };
      });

    const hasStatusUpdates = uploads.some(
      (up) => (up.status === 'approved' || up.status === 'rejected') && up.updatedAt > lastChecked
    );

    const totalBytesUsed = uploads
      .filter((up) => up.status !== 'rejected')
      .reduce((sum, up) => sum + up.sizeBytes, 0);

    const pendingCount = Array.from(this.files.values()).filter(
      (f) => f.uploaderUserId === userId && (f.status === 'pending' || f.status === 'uploading')
    ).length;

    if (u && markChecked) {
      u.libraryLastCheckedAt = new Date();
    }

    return {
      uploads,
      hasStatusUpdates,
      quota: {
        usedBytes: totalBytesUsed,
        maxBytes: LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES,
        pendingCount,
        maxPending: LIBRARY_CONFIG.MAX_PENDING_UPLOADS,
      },
    };
  }

  async updateMyFile(userId: string, fileId: string, updates: any, planId?: string | null) {
    const f = this.files.get(fileId);
    if (
      !f ||
      f.uploaderUserId !== userId ||
      f.status === 'removed' ||
      !this.isFileAccessibleInPlanInMemory(f, planId)
    ) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (updates.title) f.title = sanitizeLibraryText(updates.title, 120);
    if (updates.description !== undefined) f.description = updates.description ? sanitizeLibraryText(updates.description, 500) : null;

    if (updates.academicYear !== undefined && updates.academicYear !== null) {
      const yearNum = Number(updates.academicYear);
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(yearNum) || yearNum < LIBRARY_CONFIG.ACADEMIC_YEAR_MIN || yearNum > currentYear) {
        throw Object.assign(
          new Error(`El año académico debe ser un número entero entre ${LIBRARY_CONFIG.ACADEMIC_YEAR_MIN} y ${currentYear}.`),
          { status: 400 }
        );
      }
      f.academicYear = yearNum;
    } else if (updates.academicYear === null) {
      f.academicYear = null;
    }

    if (updates.term !== undefined && updates.term !== null && updates.term !== '') {
      if (!['1C', '2C', 'A'].includes(updates.term)) {
        throw Object.assign(
          new Error("El cuatrimestre debe ser '1C', '2C' o 'A'."),
          { status: 400 }
        );
      }
      f.term = updates.term;
    } else if (updates.term === null || updates.term === '') {
      f.term = null;
    }
    if (updates.term !== undefined) f.term = updates.term || null;
    if (updates.examInstance !== undefined) f.examInstance = updates.examInstance ? sanitizeLibraryText(updates.examInstance, 50) : null;
    if (updates.hasSolution !== undefined) f.hasSolution = Boolean(updates.hasSolution);

    if ((updates.subjectId && updates.subjectId !== f.subjectId) || (updates.kind && updates.kind !== f.kind)) {
      if (updates.subjectId) {
        const newSub = this.subjects.get(updates.subjectId);
        if (!newSub || (planId && newSub.planId !== planId)) {
          throw Object.assign(new Error('La materia especificada no pertenece a tu plan de estudios.'), { status: 404 });
        }
        f.subjectId = newSub.id;
        f.sharedSubjectId = newSub.sharedSubjectId ?? null;
        f.sourceSubjectId = newSub.id;
        f.sourcePlanId = newSub.planId ?? null;
      }
      if (updates.kind) f.kind = updates.kind;
      f.status = 'pending';
      f.rejectionReason = null;
      f.reviewedBy = null;
      f.reviewedAt = null;
    }
    f.updatedAt = new Date();
    return f;
  }

  async deleteMyFile(userId: string, fileId: string, planId?: string | null) {
    const f = this.files.get(fileId);
    if (!f || f.uploaderUserId !== userId || !this.isFileAccessibleInPlanInMemory(f, planId)) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    await this.r2.deleteObject(f.storageKey);
    f.status = 'removed';
    f.updatedAt = new Date();
    return { success: true, message: 'Archivo eliminado exitosamente.' };
  }

  async listPendingFiles(filters?: { careerId?: string; planId?: string }) {
    return Array.from(this.files.values())
      .filter((f) => {
        if (f.status !== 'pending') return false;
        const hier = this.getSubjectHierarchy(f.subjectId);
        if (filters?.careerId && filters.careerId !== 'all' && hier.careerId !== filters.careerId) {
          return false;
        }
        if (filters?.planId && filters.planId !== 'all' && hier.planId !== filters.planId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((f) => {
        const sub = this.subjects.get(f.subjectId);
        const hier = this.getSubjectHierarchy(f.subjectId);
        const profIds = Array.from(this.fileProfessors.get(f.id) || []);
        const profs = profIds.map((pid) => this.professors.get(pid)).filter(Boolean);
        return {
          id: f.id,
          subjectId: f.subjectId,
          subjectName: sub?.name || 'Materia',
          subjectCode: sub?.codeInPlan || 0,
          ...hier,
          kind: f.kind,
          academicYear: f.academicYear,
          term: f.term,
          examInstance: f.examInstance,
          hasSolution: f.hasSolution,
          title: f.title,
          description: f.description,
          originalFilename: f.originalFilename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          sha256: f.sha256,
          status: f.status,
          adminNotifiedAt: f.adminNotifiedAt || null,
          uploaderNotifiedAt: f.uploaderNotifiedAt || null,
          createdAt: f.createdAt,
          professors: profs,
        };
      });
  }

  async listAllFilesAdmin(filters: ListAdminLibraryFilters) {
    let items = Array.from(this.files.values());
    if (filters.status && filters.status !== 'all') items = items.filter((f) => f.status === filters.status);
    if (filters.subjectId && filters.subjectId !== 'all') items = items.filter((f) => f.subjectId === filters.subjectId);
    if (filters.careerId && filters.careerId !== 'all') {
      items = items.filter((f) => this.getSubjectHierarchy(f.subjectId).careerId === filters.careerId);
    }
    if (filters.planId && filters.planId !== 'all') {
      items = items.filter((f) => this.getSubjectHierarchy(f.subjectId).planId === filters.planId);
    }
    if (filters.kind && filters.kind !== 'all') items = items.filter((f) => f.kind === filters.kind);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      items = items.filter((f) => f.title.toLowerCase().includes(q) || f.originalFilename.toLowerCase().includes(q));
    }

    const total = items.length;
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize || 25));
    const offset = (page - 1) * pageSize;

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const paged = items.slice(offset, offset + pageSize).map((f) => {
      const sub = this.subjects.get(f.subjectId);
      const hier = this.getSubjectHierarchy(f.subjectId);
      return {
        id: f.id,
        subjectId: f.subjectId,
        subjectName: sub?.name || 'Materia',
        subjectCode: sub?.codeInPlan || 0,
        ...hier,
        kind: f.kind,
        academicYear: f.academicYear,
        term: f.term,
        examInstance: f.examInstance,
        hasSolution: f.hasSolution,
        title: f.title,
        description: f.description,
        originalFilename: f.originalFilename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        status: f.status,
        rejectionReason: f.rejectionReason,
        adminNotifiedAt: f.adminNotifiedAt || null,
        uploaderNotifiedAt: f.uploaderNotifiedAt || null,
        downloadCount: f.downloadCount,
        helpfulCount: f.helpfulCount,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      };
    });

    return {
      items: paged,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getPreviewUrl(fileId: string) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });

    if (f.status === 'rejected' || f.status === 'removed') {
      throw Object.assign(
        new Error(`No se puede previsualizar el archivo porque su estado es '${f.status}' y su contenido fue purgado.`),
        { status: 410, code: 'FILE_CONTENT_PURGED' }
      );
    }

    const previewUrl = await this.r2.getPresignedDownloadUrl({
      key: f.storageKey,
      filename: f.originalFilename,
      mimeType: f.mimeType,
      expiresInSeconds: LIBRARY_CONFIG.PRESIGNED_PREVIEW_EXPIRES_SECONDS,
    });

    return {
      previewUrl,
      mimeType: f.mimeType,
      originalFilename: f.originalFilename,
      sizeBytes: f.sizeBytes,
    };
  }

  async approveFile(fileId: string, adminUserId: string) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });

    const wasPending = f.status === 'pending';
    f.status = 'approved';
    f.rejectionReason = null;
    f.reviewedBy = adminUserId;
    f.reviewedAt = new Date();
    f.updatedAt = new Date();

    if (wasPending && !f.uploaderNotifiedAt && f.uploaderUserId) {
      recordUploaderAction();
    }

    return f;
  }

  async rejectFile(fileId: string, adminUserId: string, reason: string) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });

    const cleanReason = sanitizeLibraryText(reason, 500) || 'El archivo no cumple con las pautas de publicación.';
    f.status = 'rejected';
    f.rejectionReason = cleanReason;
    f.reviewedBy = adminUserId;
    f.reviewedAt = new Date();
    f.updatedAt = new Date();

    // 3a: Encolar el borrado del objeto en orphanDeletions (simulador de R2)
    const orphanId = crypto.randomUUID();
    this.orphanDeletions.set(orphanId, {
      id: orphanId,
      storageKey: f.storageKey,
      attempts: 0,
      lastError: null,
      createdAt: new Date(),
    });

    if (!f.uploaderNotifiedAt && f.uploaderUserId) {
      recordUploaderAction();
    }

    return f;
  }

  async resendAdminNotification(fileId: string) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    if (f.status !== 'pending') {
      throw Object.assign(
        new Error('Solo se pueden reenviar avisos para archivos en estado pendiente de revisión.'),
        { status: 400 }
      );
    }

    f.adminNotifiedAt = null;
    const sub = this.subjects.get(f.subjectId);
    const hier = this.getSubjectHierarchy(f.subjectId);
    const sent = await notifyAdminNewPendingFile(fileId, {
      id: f.id,
      title: f.title,
      subjectName: sub?.name || 'Materia',
      careerId: hier.careerId,
      careerCode: hier.careerCode,
      careerName: hier.careerName,
      planName: hier.planName,
      facultyName: hier.facultyName,
      kind: f.kind,
      academicYear: f.academicYear,
      term: f.term,
      sizeBytes: f.sizeBytes,
      mimeType: f.mimeType,
      createdAt: f.createdAt,
      adminNotifiedAt: null,
    });

    if (sent) {
      f.adminNotifiedAt = new Date();
    }

    return {
      success: sent,
      message: sent
        ? 'Aviso reenviado correctamente a los administradores.'
        : 'No se pudo enviar el aviso (verifique la configuración de correo o el límite de envíos).',
      notifiedAt: sent ? new Date() : undefined,
    };
  }

  async removeFile(fileId: string, adminUserId: string, reason?: string) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });

    f.status = 'removed';
    f.rejectionReason = reason ? sanitizeLibraryText(reason, 500) : 'Dado de baja por moderación.';
    f.reviewedBy = adminUserId;
    f.reviewedAt = new Date();
    f.updatedAt = new Date();
    await this.r2.deleteObject(f.storageKey);
    return f;
  }

  async getUploaderIdentity(fileId: string, adminUser: { id: string; email: string }, ip?: string) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });

    if (!f.uploaderUserId) {
      return { hasUploader: false, message: 'El autor original dio de baja su cuenta o desvinculó sus datos personales.' };
    }

    const u = this.users.get(f.uploaderUserId);
    if (!u) return { hasUploader: false, message: 'Usuario no encontrado en la base de datos.' };

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'library.view_uploader',
      targetType: 'library_file',
      targetId: f.id,
      targetEmail: u.email,
      details: { fileId: f.id, fileTitle: f.title, authorUserId: u.id },
      ip,
    });

    return {
      hasUploader: true,
      uploader: {
        id: u.id,
        email: u.email,
        status: u.status,
        role: u.role,
        createdAt: new Date(),
      },
    };
  }

  async suspendAuthor(fileId: string, adminUser: { id: string; email: string }, reason: string, ip?: string) {
    const f = this.files.get(fileId);
    if (!f || !f.uploaderUserId) {
      throw Object.assign(new Error('No se encontró al autor del archivo o la cuenta ya no existe.'), { status: 404 });
    }

    if (f.uploaderUserId === adminUser.id) {
      throw Object.assign(new Error('No podés suspender tu propia cuenta de administrador.'), { status: 400 });
    }

    const u = this.users.get(f.uploaderUserId);
    if (!u) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });

    if (u.role === 'admin') {
      throw Object.assign(new Error('No podés suspender a un administrador. Debe ser degradado previamente.'), { status: 400 });
    }

    const cleanReason = sanitizeLibraryText(reason, 500) || 'Infracción grave de los términos de la biblioteca.';
    u.status = 'suspended';
    f.status = 'hidden';
    f.rejectionReason = cleanReason;

    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'library.suspend_author',
      targetType: 'user',
      targetId: u.id,
      targetEmail: u.email,
      details: { fileId: f.id, fileTitle: f.title, reason: cleanReason },
      ip,
    });

    return { success: true, message: `El autor ha sido suspendido y el archivo ${f.id} fue ocultado.` };
  }

  async listReports(
    status: 'open' | 'dismissed' | 'actioned' | 'all' = 'open',
    filters?: { careerId?: string; planId?: string }
  ) {
    let repList = Array.from(this.reports.values());
    if (status !== 'all') repList = repList.filter((r) => r.status === status);
    if (filters?.careerId && filters.careerId !== 'all') {
      repList = repList.filter((r) => {
        const f = this.files.get(r.fileId);
        return f ? this.getSubjectHierarchy(f.subjectId).careerId === filters.careerId : false;
      });
    }
    if (filters?.planId && filters.planId !== 'all') {
      repList = repList.filter((r) => {
        const f = this.files.get(r.fileId);
        return f ? this.getSubjectHierarchy(f.subjectId).planId === filters.planId : false;
      });
    }
    repList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return repList.map((r) => {
      const f = this.files.get(r.fileId);
      const sub = f ? this.subjects.get(f.subjectId) : null;
      const hier = f
        ? this.getSubjectHierarchy(f.subjectId)
        : {
            careerId: null,
            careerCode: null,
            careerName: null,
            planId: null,
            planName: null,
            planYear: null,
            planStatus: null,
            facultyName: null,
          };
      return {
        id: r.id,
        fileId: r.fileId,
        fileTitle: f?.title || 'Archivo',
        fileKind: f?.kind || 'apunte',
        fileStatus: f?.status || 'desconocido',
        subjectId: f?.subjectId || null,
        subjectName: sub?.name || 'Materia',
        ...hier,
        reporterUserId: r.reporterUserId,
        reason: r.reason,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt,
      };
    });
  }

  async updateReportStatus(reportId: string, newStatus: 'open' | 'dismissed' | 'actioned') {
    const r = this.reports.get(reportId);
    if (!r) throw Object.assign(new Error('Reporte no encontrado.'), { status: 404 });
    r.status = newStatus;
    return r;
  }

  async getLibraryStats() {
    const approved = Array.from(this.files.values()).filter((f) => f.status === 'approved');
    const pending = Array.from(this.files.values()).filter((f) => f.status === 'pending');
    const openReports = Array.from(this.reports.values()).filter((r) => r.status === 'open');
    const totalBytes = approved.reduce((sum, f) => sum + f.sizeBytes, 0);

    return {
      approvedCount: approved.length,
      pendingCount: pending.length,
      openReportsCount: openReports.length,
      totalSizeBytes: totalBytes,
      totalSizeFormatted: `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`,
      storageWarning: totalBytes >= LIBRARY_CONFIG.STORAGE_WARNING_THRESHOLD_BYTES,
    };
  }

  async testR2Connection(adminUser: { id: string; email: string }, ip?: string): Promise<StorageTestResult> {
    const result = await this.r2.testConnection();
    await logAdminAction({
      adminUserId: adminUser.id,
      adminEmail: adminUser.email,
      action: 'library.test_storage',
      targetType: 'storage',
      details: {
        success: result.success,
        isMock: result.isMock,
        errorStep: result.errorStep || null,
        message: result.message,
      },
      ip,
    });
    return result;
  }

  async cleanupAbandonedUploads() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [id, f] of this.files.entries()) {
      if (f.status === 'uploading' && f.createdAt < oneDayAgo) {
        await this.r2.deleteObject(f.storageKey);
        this.files.delete(id);
        cleanedCount++;
      }
    }

    for (const [id, o] of this.orphanDeletions.entries()) {
      if (o.attempts < 5) {
        const ok = await this.r2.deleteObject(o.storageKey);
        if (ok) {
          this.orphanDeletions.delete(id);
        } else {
          o.attempts++;
          o.lastError = 'Fallo al eliminar objeto en R2';
        }
      }
    }

    // Purga periódica de library_download_logs (> 7 días)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const beforeCount = this.downloadLogs.length;
    this.downloadLogs = this.downloadLogs.filter((l) => l.downloadedAt >= sevenDaysAgo);
    const purgedLogsCount = beforeCount - this.downloadLogs.length;

    return { cleanedCount, purgedLogsCount };
  }

  async handleAccountDeletion(userId: string, deleteFiles: boolean) {
    const userFiles = Array.from(this.files.values()).filter((f) => f.uploaderUserId === userId);
    for (const f of userFiles) {
      if (deleteFiles) {
        await this.r2.deleteObject(f.storageKey);
        this.files.delete(f.id);
      } else {
        f.uploaderUserId = null;
      }
    }
  }
}

// Singleton de servicio activo (configurable en tests)
let activeLibraryService: ILibraryService | null = null;

export function getLibraryService(): ILibraryService {
  if (activeLibraryService) return activeLibraryService;
  return new PgLibraryService();
}

export function getActiveLibraryService(): ILibraryService | null {
  return activeLibraryService;
}

export function setLibraryServiceForTesting(service: ILibraryService | null): void {
  activeLibraryService = service;
  if (service && 'getPendingAdminFiles' in (service as any)) {
    setMailerDataSource(service as any);
  } else if (!service) {
    setMailerDataSource(null);
  }
}

// Alias para compatibilidad con código preexistente
export const LibraryService = PgLibraryService;
