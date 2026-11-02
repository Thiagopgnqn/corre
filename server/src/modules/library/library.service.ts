import { eq, and, or, sql, desc, asc, count, inArray, gte, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import path from 'path';
import { db } from '../../db/index.js';
import {
  users,
  subjects,
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
import { logAdminAction } from '../admin/admin.audit.js';
import { invalidateUserStatusCache } from '../../middlewares/auth.middleware.js';

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
  kind?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ILibraryService {
  acceptTerms(userId: string, version?: string): Promise<{ success: boolean; acceptedAt: Date; version: string }>;
  getTermsStatus(userId: string): Promise<{ accepted: boolean; acceptedAt: Date | null; version: string | null; currentVersion: string }>;
  initUpload(userId: string, input: InitUploadInput): Promise<any>;
  completeUpload(userId: string, fileId: string): Promise<any>;
  listSubjectsWithCounts(planId?: string | null): Promise<any[]>;
  listFiles(filters: ListLibraryFilesFilters, currentUserId?: string): Promise<any>;
  getFileDetail(fileId: string, currentUserId?: string, isAdmin?: boolean): Promise<any>;
  getDownloadUrl(fileId: string, userId: string, isAdmin?: boolean): Promise<any>;
  toggleHelpful(fileId: string, userId: string): Promise<any>;
  reportFile(fileId: string, userId: string, reason: any, note?: string): Promise<any>;
  listMyUploads(userId: string, markChecked?: boolean): Promise<any>;
  updateMyFile(userId: string, fileId: string, updates: any): Promise<any>;
  deleteMyFile(userId: string, fileId: string): Promise<any>;
  listPendingFiles(): Promise<any[]>;
  listAllFilesAdmin(filters: ListAdminLibraryFilters): Promise<any>;
  getPreviewUrl(fileId: string): Promise<any>;
  approveFile(fileId: string, adminUserId: string): Promise<any>;
  rejectFile(fileId: string, adminUserId: string, reason: string): Promise<any>;
  removeFile(fileId: string, adminUserId: string, reason?: string): Promise<any>;
  getUploaderIdentity(fileId: string, adminUser: { id: string; email: string }, ip?: string): Promise<any>;
  suspendAuthor(fileId: string, adminUser: { id: string; email: string }, reason: string, ip?: string): Promise<any>;
  listReports(status?: any): Promise<any[]>;
  updateReportStatus(reportId: string, newStatus: any): Promise<any>;
  getLibraryStats(): Promise<any>;
  testR2Connection(adminUser: { id: string; email: string }, ip?: string): Promise<StorageTestResult>;
  cleanupAbandonedUploads(): Promise<any>;
  handleAccountDeletion(userId: string, deleteFiles: boolean): Promise<void>;
}

/**
 * Implementación de producción respaldada por PostgreSQL y Cloudflare R2
 */
export class PgLibraryService implements ILibraryService {
  private r2: IR2StorageService;

  constructor(r2Service?: IR2StorageService) {
    this.r2 = r2Service || getR2Service();
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

  async initUpload(userId: string, input: InitUploadInput) {
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

    const [subject] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, input.subjectId))
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

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const [dailyUploadsRes] = await tx
        .select({ count: count() })
        .from(libraryFiles)
        .where(
          and(
            eq(libraryFiles.uploaderUserId, userId),
            gte(libraryFiles.createdAt, todayStart),
            sql`${libraryFiles.status} != 'removed'`
          )
        );

      if ((dailyUploadsRes?.count || 0) >= LIBRARY_CONFIG.MAX_DAILY_UPLOADS) {
        throw Object.assign(
          new Error(
            `Alcanzaste el límite de ${LIBRARY_CONFIG.MAX_DAILY_UPLOADS} subidas diarias. Podrás subir más material mañana.`
          ),
          { status: 429, code: 'LIMIT_DAILY_UPLOADS' }
        );
      }

      const [pendingRes] = await tx
        .select({ count: count() })
        .from(libraryFiles)
        .where(and(eq(libraryFiles.uploaderUserId, userId), eq(libraryFiles.status, 'pending')));

      if ((pendingRes?.count || 0) >= LIBRARY_CONFIG.MAX_PENDING_UPLOADS) {
        throw Object.assign(
          new Error(
            `Tenés ${LIBRARY_CONFIG.MAX_PENDING_UPLOADS} archivos en revisión. Esperá a que sean moderados para subir más.`
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
          { status: 429, code: 'LIMIT_USER_QUOTA' }
        );
      }

      // Requisito 1: sha256 es NULL durante estado 'uploading'
      await tx.insert(libraryFiles).values({
        id: fileId,
        uploaderUserId: userId,
        subjectId: input.subjectId,
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

  async completeUpload(userId: string, fileId: string) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(and(eq(libraryFiles.id, fileId), eq(libraryFiles.uploaderUserId, userId)))
      .limit(1);

    if (!file) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (file.status !== 'uploading') {
      if (file.status === 'pending' || file.status === 'approved') {
        return { success: true, file };
      }
      throw Object.assign(new Error(`El archivo se encuentra en estado '${file.status}'.`), {
        status: 400,
      });
    }

    const head = await this.r2.headObject(file.storageKey);
    if (!head.exists) {
      await this.r2.deleteObject(file.storageKey);
      await db
        .update(libraryFiles)
        .set({ status: 'rejected', rejectionReason: 'El archivo no fue recibido en el almacenamiento.' })
        .where(eq(libraryFiles.id, fileId));
      throw Object.assign(
        new Error('No se encontró el archivo en el almacenamiento. Por favor reintentá la subida.'),
        { status: 400 }
      );
    }

    if (head.sizeBytes !== file.sizeBytes) {
      await this.r2.deleteObject(file.storageKey);
      await db
        .update(libraryFiles)
        .set({
          status: 'rejected',
          rejectionReason: `Tamaño transferido (${head.sizeBytes}) no coincide con lo declarado (${file.sizeBytes}).`,
        })
        .where(eq(libraryFiles.id, fileId));
      throw Object.assign(
        new Error('El tamaño real del archivo difiere del declarado. Subida rechazada por seguridad.'),
        { status: 400 }
      );
    }

    const stream = await this.r2.getObjectStream(file.storageKey);
    const validation = await validateFileStream(
      stream,
      file.mimeType as AllowedMimeType,
      file.sizeBytes
    );

    if (!validation.isValid) {
      await this.r2.deleteObject(file.storageKey);
      const reason = validation.error || 'Fallo en la validación de seguridad del archivo.';
      await db
        .update(libraryFiles)
        .set({ status: 'rejected', rejectionReason: reason })
        .where(eq(libraryFiles.id, fileId));
      throw Object.assign(new Error(reason), { status: 400 });
    }

    // Pre-chequeo de duplicados por SHA-256
    const [existingDuplicate] = await db
      .select({ id: libraryFiles.id, title: libraryFiles.title })
      .from(libraryFiles)
      .where(
        and(
          eq(libraryFiles.sha256, validation.sha256),
          sql`${libraryFiles.status} NOT IN ('removed', 'rejected')`,
          sql`${libraryFiles.id} != ${fileId}`
        )
      )
      .limit(1);

    if (existingDuplicate) {
      await this.r2.deleteObject(file.storageKey);
      const reason = `Ya existe un archivo idéntico en el sistema ("${existingDuplicate.title}").`;
      await db
        .update(libraryFiles)
        .set({ status: 'rejected', rejectionReason: reason })
        .where(eq(libraryFiles.id, fileId));
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
        await this.r2.deleteObject(file.storageKey);
        const reason = 'Ya existe un archivo idéntico en el sistema.';
        await db
          .update(libraryFiles)
          .set({ status: 'rejected', rejectionReason: reason })
          .where(eq(libraryFiles.id, fileId));
        throw Object.assign(new Error(reason), { status: 409, code: 'DUPLICATE_FILE' });
      }
      throw dbErr;
    }
  }

  async listSubjectsWithCounts(planId?: string | null) {
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
      })
      .from(subjects)
      .where(whereClause)
      .orderBy(asc(subjects.level), asc(subjects.codeInPlan));

    const countsRows = await db
      .select({
        subjectId: libraryFiles.subjectId,
        approvedCount: count(),
      })
      .from(libraryFiles)
      .where(eq(libraryFiles.status, 'approved'))
      .groupBy(libraryFiles.subjectId);

    const countsMap = new Map<string, number>();
    for (const r of countsRows) {
      countsMap.set(r.subjectId, Number(r.approvedCount || 0));
    }

    return subjectsRows.map((s) => ({
      ...s,
      approvedFilesCount: countsMap.get(s.id) || 0,
    }));
  }

  async listFiles(filters: ListLibraryFilesFilters, currentUserId?: string) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.pageSize || 20));
    const offset = (page - 1) * limit;

    const conditions = [eq(libraryFiles.status, 'approved')];

    if (filters.subjectId) {
      conditions.push(eq(libraryFiles.subjectId, filters.subjectId));
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

    const items = fileRows.map((f) => ({
      ...f,
      uploaderDisplay: 'Subido por un estudiante',
      professors: profsMap.get(f.id) || [],
      userHasVotedHelpful: helpfulMap.has(f.id),
    }));

    return {
      items,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFileDetail(fileId: string, currentUserId?: string, isAdmin = false) {
    const [file] = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
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

    if (!file) {
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

    return {
      id: file.id,
      subjectId: file.subjectId,
      subjectName: file.subjectName,
      subjectCode: file.subjectCode,
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

  async getDownloadUrl(fileId: string, userId: string, isAdmin = false) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
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

  async toggleHelpful(fileId: string, userId: string) {
    const [file] = await db
      .select({ id: libraryFiles.id, helpfulCount: libraryFiles.helpfulCount, status: libraryFiles.status })
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file || file.status !== 'approved') {
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
    note?: string
  ) {
    const [file] = await db
      .select({ id: libraryFiles.id, status: libraryFiles.status })
      .from(libraryFiles)
      .where(eq(libraryFiles.id, fileId))
      .limit(1);

    if (!file) {
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
        downloadCount: libraryFiles.downloadCount,
        helpfulCount: libraryFiles.helpfulCount,
        createdAt: libraryFiles.createdAt,
        updatedAt: libraryFiles.updatedAt,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .where(and(eq(libraryFiles.uploaderUserId, userId), sql`${libraryFiles.status} != 'removed'`))
      .orderBy(desc(libraryFiles.createdAt));

    const hasStatusUpdates = uploads.some(
      (u) =>
        (u.status === 'approved' || u.status === 'rejected') &&
        new Date(u.updatedAt) > new Date(lastChecked)
    );

    const totalBytesUsed = uploads
      .filter((u) => u.status !== 'rejected')
      .reduce((acc, curr) => acc + Number(curr.sizeBytes || 0), 0);

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
    }
  ) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(and(eq(libraryFiles.id, fileId), eq(libraryFiles.uploaderUserId, userId)))
      .limit(1);

    if (!file || file.status === 'removed') {
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
    if (updates.academicYear !== undefined) payload.academicYear = updates.academicYear || null;
    if (updates.term !== undefined) payload.term = updates.term || null;
    if (updates.hasSolution !== undefined) payload.hasSolution = Boolean(updates.hasSolution);

    if (
      (updates.subjectId && updates.subjectId !== file.subjectId) ||
      (updates.kind && updates.kind !== file.kind)
    ) {
      if (updates.subjectId) payload.subjectId = updates.subjectId;
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

  async deleteMyFile(userId: string, fileId: string) {
    const [file] = await db
      .select()
      .from(libraryFiles)
      .where(and(eq(libraryFiles.id, fileId), eq(libraryFiles.uploaderUserId, userId)))
      .limit(1);

    if (!file) {
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

  async listPendingFiles() {
    const rows = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
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
        sha256: libraryFiles.sha256,
        status: libraryFiles.status,
        createdAt: libraryFiles.createdAt,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
      .where(eq(libraryFiles.status, 'pending'))
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
      .where(whereClause);

    const total = totalRes?.value || 0;

    const rows = await db
      .select({
        id: libraryFiles.id,
        subjectId: libraryFiles.subjectId,
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
        status: libraryFiles.status,
        rejectionReason: libraryFiles.rejectionReason,
        downloadCount: libraryFiles.downloadCount,
        helpfulCount: libraryFiles.helpfulCount,
        createdAt: libraryFiles.createdAt,
        updatedAt: libraryFiles.updatedAt,
      })
      .from(libraryFiles)
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
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

    return updated;
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

  async listReports(status: 'open' | 'dismissed' | 'actioned' | 'all' = 'open') {
    const conditions = [];
    if (status !== 'all') {
      conditions.push(eq(libraryReports.status, status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await db
      .select({
        id: libraryReports.id,
        fileId: libraryReports.fileId,
        fileTitle: libraryFiles.title,
        fileStatus: libraryFiles.status,
        subjectName: subjects.name,
        reporterUserId: libraryReports.reporterUserId,
        reason: libraryReports.reason,
        note: libraryReports.note,
        status: libraryReports.status,
        createdAt: libraryReports.createdAt,
      })
      .from(libraryReports)
      .innerJoin(libraryFiles, eq(libraryReports.fileId, libraryFiles.id))
      .innerJoin(subjects, eq(libraryFiles.subjectId, subjects.id))
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
export class InMemoryLibraryService implements ILibraryService {
  private r2: IR2StorageService;
  public users = new Map<string, {
    id: string;
    email: string;
    role: 'user' | 'admin';
    status: 'active' | 'suspended';
    emailVerifiedAt: Date | null;
    libraryTermsAcceptedAt: Date | null;
    libraryTermsVersion: string | null;
    libraryLastCheckedAt: Date | null;
  }>();

  public subjects = new Map<string, { id: string; name: string; codeInPlan: number; level: number; kind: string; planId?: string }>();
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
  }

  // Métodos auxiliares de seeding para tests
  seedUser(user: { id: string; email: string; role?: 'user' | 'admin'; status?: 'active' | 'suspended'; emailVerified?: boolean; termsAccepted?: boolean }) {
    this.users.set(user.id, {
      id: user.id,
      email: user.email,
      role: user.role || 'user',
      status: user.status || 'active',
      emailVerifiedAt: user.emailVerified !== false ? new Date() : null,
      libraryTermsAcceptedAt: user.termsAccepted ? new Date() : null,
      libraryTermsVersion: user.termsAccepted ? LIBRARY_CONFIG.CURRENT_TERMS_VERSION : null,
      libraryLastCheckedAt: null,
    });
  }

  seedSubject(s: { id: string; name: string; codeInPlan: number; level: number; kind?: string; planId?: string }) {
    this.subjects.set(s.id, {
      id: s.id,
      name: s.name,
      codeInPlan: s.codeInPlan,
      level: s.level,
      kind: s.kind || 'integradora',
      planId: s.planId || 'plan-2023',
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

  async initUpload(userId: string, input: InitUploadInput) {
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

    if (!this.subjects.has(input.subjectId)) {
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

    // Topes diarios
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const userDailyUploads = Array.from(this.files.values()).filter(
      (f) => f.uploaderUserId === userId && f.createdAt >= today && f.status !== 'removed'
    ).length;

    if (userDailyUploads >= LIBRARY_CONFIG.MAX_DAILY_UPLOADS) {
      throw Object.assign(
        new Error(`Alcanzaste el límite de ${LIBRARY_CONFIG.MAX_DAILY_UPLOADS} subidas diarias. Podrás subir más material mañana.`),
        { status: 429, code: 'LIMIT_DAILY_UPLOADS' }
      );
    }

    // Pendientes simultáneos
    const userPending = Array.from(this.files.values()).filter(
      (f) => f.uploaderUserId === userId && f.status === 'pending'
    ).length;

    if (userPending >= LIBRARY_CONFIG.MAX_PENDING_UPLOADS) {
      throw Object.assign(
        new Error(`Tenés ${LIBRARY_CONFIG.MAX_PENDING_UPLOADS} archivos en revisión. Esperá a que sean moderados para subir más.`),
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
        { status: 429, code: 'LIMIT_USER_QUOTA' }
      );
    }

    const fileId = crypto.randomUUID();
    const storageKey = `library/${fileId}${ext}`;
    const safeOriginalName = input.originalFilename.replace(/[^a-zA-Z0-9._\-áéíóúÁÉÍÓÚñÑ ]/g, '_');

    const fileRecord = {
      id: fileId,
      uploaderUserId: userId,
      subjectId: input.subjectId,
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
      status: 'uploading',
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
  }

  async completeUpload(userId: string, fileId: string) {
    const file = this.files.get(fileId);
    if (!file || file.uploaderUserId !== userId) {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (file.status !== 'uploading') {
      if (file.status === 'pending' || file.status === 'approved') return { success: true, file };
      throw Object.assign(new Error(`El archivo se encuentra en estado '${file.status}'.`), { status: 400 });
    }

    const head = await this.r2.headObject(file.storageKey);
    if (!head.exists) {
      await this.r2.deleteObject(file.storageKey);
      file.status = 'rejected';
      file.rejectionReason = 'El archivo no fue recibido en el almacenamiento.';
      throw Object.assign(new Error('No se encontró el archivo en el almacenamiento. Por favor reintentá la subida.'), { status: 400 });
    }

    if (head.sizeBytes !== file.sizeBytes) {
      await this.r2.deleteObject(file.storageKey);
      file.status = 'rejected';
      file.rejectionReason = `Tamaño transferido (${head.sizeBytes}) no coincide con lo declarado (${file.sizeBytes}).`;
      throw Object.assign(new Error('El tamaño real del archivo difiere del declarado. Subida rechazada por seguridad.'), { status: 400 });
    }

    const stream = await this.r2.getObjectStream(file.storageKey);
    const validation = await validateFileStream(stream, file.mimeType as AllowedMimeType, file.sizeBytes);

    if (!validation.isValid) {
      await this.r2.deleteObject(file.storageKey);
      const reason = validation.error || 'Fallo en la validación de seguridad del archivo.';
      file.status = 'rejected';
      file.rejectionReason = reason;
      throw Object.assign(new Error(reason), { status: 400 });
    }

    // Comprobación de duplicados (Requisito 1: pre-chequeo)
    const existingDuplicate = Array.from(this.files.values()).find(
      (f) => f.id !== fileId && f.sha256 === validation.sha256 && !['removed', 'rejected'].includes(f.status)
    );

    if (existingDuplicate || this.simulateSha256CollisionOnComplete) {
      await this.r2.deleteObject(file.storageKey);
      const reason = 'Ya existe un archivo idéntico en el sistema.';
      file.status = 'rejected';
      file.rejectionReason = reason;
      throw Object.assign(new Error(reason), { status: 409, code: 'DUPLICATE_FILE' });
    }

    file.sha256 = validation.sha256;
    file.status = 'pending';
    file.rejectionReason = null;
    file.updatedAt = new Date();

    return {
      success: true,
      file,
      message: 'Tu archivo quedó en revisión; te avisaremos en "Mis archivos" cuando esté publicado.',
    };
  }

  async listSubjectsWithCounts(planId?: string | null) {
    const result: any[] = [];
    for (const s of this.subjects.values()) {
      if (planId && s.planId && s.planId !== planId) continue;
      const approvedCount = Array.from(this.files.values()).filter(
        (f) => f.subjectId === s.id && f.status === 'approved'
      ).length;
      result.push({
        ...s,
        approvedFilesCount: approvedCount,
      });
    }
    return result.sort((a, b) => a.level - b.level || a.codeInPlan - b.codeInPlan);
  }

  async listFiles(filters: ListLibraryFilesFilters, currentUserId?: string) {
    let items = Array.from(this.files.values()).filter((f) => f.status === 'approved');

    if (filters.subjectId) items = items.filter((f) => f.subjectId === filters.subjectId);
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
      const sub = this.subjects.get(f.subjectId);
      const profIds = Array.from(this.fileProfessors.get(f.id) || []);
      const profs = profIds.map((pid) => this.professors.get(pid)).filter(Boolean);
      return {
        id: f.id,
        subjectId: f.subjectId,
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

  async getFileDetail(fileId: string, currentUserId?: string, isAdmin = false) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    if (f.status !== 'approved' && !isAdmin && f.uploaderUserId !== currentUserId) {
      throw Object.assign(new Error('El archivo no está disponible públicamente.'), { status: 403 });
    }

    const sub = this.subjects.get(f.subjectId);
    const profIds = Array.from(this.fileProfessors.get(f.id) || []);
    const profs = profIds.map((pid) => this.professors.get(pid)).filter(Boolean);

    return {
      id: f.id,
      subjectId: f.subjectId,
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

  async getDownloadUrl(fileId: string, userId: string, isAdmin = false) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
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

  async toggleHelpful(fileId: string, userId: string) {
    const f = this.files.get(fileId);
    if (!f || f.status !== 'approved') throw Object.assign(new Error('Archivo no disponible.'), { status: 404 });

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

  async reportFile(fileId: string, userId: string, reason: any, note?: string) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });

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
      .filter((f) => f.uploaderUserId === userId && f.status !== 'removed')
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

    if (u && markChecked) {
      u.libraryLastCheckedAt = new Date();
    }

    return {
      uploads,
      hasStatusUpdates,
      quota: {
        usedBytes: totalBytesUsed,
        maxBytes: LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES,
      },
    };
  }

  async updateMyFile(userId: string, fileId: string, updates: any) {
    const f = this.files.get(fileId);
    if (!f || f.uploaderUserId !== userId || f.status === 'removed') {
      throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    }

    if (updates.title) f.title = sanitizeLibraryText(updates.title, 120);
    if (updates.description !== undefined) f.description = updates.description ? sanitizeLibraryText(updates.description, 500) : null;
    if (updates.academicYear !== undefined) f.academicYear = updates.academicYear || null;
    if (updates.term !== undefined) f.term = updates.term || null;
    if (updates.examInstance !== undefined) f.examInstance = updates.examInstance ? sanitizeLibraryText(updates.examInstance, 50) : null;
    if (updates.hasSolution !== undefined) f.hasSolution = Boolean(updates.hasSolution);

    if ((updates.subjectId && updates.subjectId !== f.subjectId) || (updates.kind && updates.kind !== f.kind)) {
      if (updates.subjectId) f.subjectId = updates.subjectId;
      if (updates.kind) f.kind = updates.kind;
      f.status = 'pending';
      f.rejectionReason = null;
      f.reviewedBy = null;
      f.reviewedAt = null;
    }
    f.updatedAt = new Date();
    return f;
  }

  async deleteMyFile(userId: string, fileId: string) {
    const f = this.files.get(fileId);
    if (!f || f.uploaderUserId !== userId) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });

    await this.r2.deleteObject(f.storageKey);
    f.status = 'removed';
    f.updatedAt = new Date();
    return { success: true, message: 'Archivo eliminado exitosamente.' };
  }

  async listPendingFiles() {
    return Array.from(this.files.values())
      .filter((f) => f.status === 'pending')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((f) => {
        const sub = this.subjects.get(f.subjectId);
        const profIds = Array.from(this.fileProfessors.get(f.id) || []);
        const profs = profIds.map((pid) => this.professors.get(pid)).filter(Boolean);
        return {
          id: f.id,
          subjectId: f.subjectId,
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
          sha256: f.sha256,
          status: f.status,
          createdAt: f.createdAt,
          professors: profs,
        };
      });
  }

  async listAllFilesAdmin(filters: ListAdminLibraryFilters) {
    let items = Array.from(this.files.values());
    if (filters.status && filters.status !== 'all') items = items.filter((f) => f.status === filters.status);
    if (filters.subjectId && filters.subjectId !== 'all') items = items.filter((f) => f.subjectId === filters.subjectId);
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
      return {
        id: f.id,
        subjectId: f.subjectId,
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
        status: f.status,
        rejectionReason: f.rejectionReason,
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

    f.status = 'approved';
    f.rejectionReason = null;
    f.reviewedBy = adminUserId;
    f.reviewedAt = new Date();
    f.updatedAt = new Date();
    return f;
  }

  async rejectFile(fileId: string, adminUserId: string, reason: string) {
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });

    f.status = 'rejected';
    f.rejectionReason = sanitizeLibraryText(reason, 500) || 'El archivo no cumple con las pautas de publicación.';
    f.reviewedBy = adminUserId;
    f.reviewedAt = new Date();
    f.updatedAt = new Date();
    return f;
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

  async listReports(status: 'open' | 'dismissed' | 'actioned' | 'all' = 'open') {
    let repList = Array.from(this.reports.values());
    if (status !== 'all') repList = repList.filter((r) => r.status === status);
    repList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return repList.map((r) => {
      const f = this.files.get(r.fileId);
      const sub = f ? this.subjects.get(f.subjectId) : null;
      return {
        id: r.id,
        fileId: r.fileId,
        fileTitle: f?.title || 'Archivo',
        fileStatus: f?.status || 'desconocido',
        subjectName: sub?.name || 'Materia',
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

export function setLibraryServiceForTesting(service: ILibraryService | null): void {
  activeLibraryService = service;
}

// Alias para compatibilidad con código preexistente
export const LibraryService = PgLibraryService;
