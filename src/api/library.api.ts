import { apiFetch, ApiError } from './client';
import type {
  AdminLibraryFile,
  AdminLibraryReport,
  LibraryFilePublic,
  LibraryFileUser,
  LibraryFilterParams,
  LibraryMyUploadsResponse,
  LibraryReportReason,
  LibrarySubjectSummary,
  StorageTestReport,
  StorageTestStep,
  UploadInitPayload,
  UploadInitResponse,
} from '../types/library';

/**
 * Cliente HTTP de la Biblioteca.
 * Las rutas y formatos reflejan exactamente server/src/modules/library/library.routes.ts
 * y server/src/modules/admin/admin.routes.ts (sección 8). Las respuestas del backend se
 * normalizan acá a los tipos de src/types/library.ts para que los componentes no dependan
 * de los nombres internos de los campos.
 */

// ---------------------------------------------------------------------
// Normalizadores (respuesta backend -> tipos frontend)
// ---------------------------------------------------------------------

function toPublicFile(raw: any): LibraryFilePublic {
  return {
    id: raw.id,
    subjectId: raw.subjectId,
    kind: raw.kind,
    academicYear: raw.academicYear ?? null,
    term: raw.term ?? null,
    examInstance: raw.examInstance ?? null,
    hasSolution: Boolean(raw.hasSolution),
    title: raw.title,
    description: raw.description ?? null,
    originalFilename: raw.originalFilename,
    mimeType: raw.mimeType,
    sizeBytes: Number(raw.sizeBytes || 0),
    downloadCount: Number(raw.downloadCount || 0),
    helpfulCount: Number(raw.helpfulCount || 0),
    hasVotedHelpful: Boolean(raw.userHasVotedHelpful ?? raw.hasVotedHelpful),
    professorNames: Array.isArray(raw.professors)
      ? raw.professors.map((p: any) => p.displayName || p.name).filter(Boolean)
      : raw.professorNames || [],
    createdAt: String(raw.createdAt),
  };
}

function toUserFile(raw: any): LibraryFileUser {
  return {
    ...toPublicFile(raw),
    status: raw.status,
    rejectionReason: raw.rejectionReason ?? null,
    updatedAt: String(raw.updatedAt ?? raw.createdAt),
  };
}

function toAdminFile(raw: any): AdminLibraryFile {
  return {
    ...toUserFile(raw),
    storageKey: raw.storageKey ?? '',
    sha256: raw.sha256 ?? null,
    uploaderUserId: raw.uploaderUserId ?? null,
    reviewedBy: raw.reviewedBy ?? null,
    reviewedAt: raw.reviewedAt ?? null,
    subjectName: raw.subjectName,
  };
}

function toMyUploads(raw: any): LibraryMyUploadsResponse {
  return {
    files: (raw?.uploads || []).map(toUserFile),
    usedBytes: Number(raw?.quota?.usedBytes || 0),
    maxBytes: Number(raw?.quota?.maxBytes || 0),
    hasStatusUpdates: Boolean(raw?.hasStatusUpdates),
  };
}

const STEP_LABELS: Record<'upload' | 'read' | 'delete', string> = {
  upload: 'Subida de objeto de prueba (PUT)',
  read: 'Lectura del objeto (GET)',
  delete: 'Borrado del objeto (DELETE)',
};

function toStorageReport(raw: any): StorageTestReport {
  const steps = raw?.steps || {};
  const stepsCompleted: StorageTestStep[] = (['upload', 'read', 'delete'] as const).map((k) => ({
    name: STEP_LABELS[k],
    success: Boolean(steps[k]?.ok),
    message: steps[k]?.message,
  }));
  const stepMap = { upload: 'put', read: 'get', delete: 'delete' } as const;
  return {
    success: Boolean(raw?.success),
    step: raw?.errorStep ? stepMap[raw.errorStep as 'upload' | 'read' | 'delete'] : 'complete',
    message: raw?.message || '',
    stepsCompleted,
    details: { isMock: Boolean(raw?.isMock) },
  };
}

// ---------------------------------------------------------------------
// Estudiantes: /api/library/*
// ---------------------------------------------------------------------

export const libraryApi = {
  async getTermsStatus(): Promise<{
    success: boolean;
    data: { accepted: boolean; version: string | null; acceptedAt: string | null; currentVersion: string };
  }> {
    return apiFetch('/api/library/terms-status');
  },

  async acceptTerms(version?: string): Promise<{ success: boolean; data: any }> {
    return apiFetch('/api/library/accept-terms', {
      method: 'POST',
      body: JSON.stringify(version ? { version } : {}),
    });
  },

  /** GET /api/library/subjects — materias del plan con cantidad de archivos aprobados. */
  async getSubjectsSummary(): Promise<{ success: boolean; data: LibrarySubjectSummary[] }> {
    const res = await apiFetch<{ success: boolean; data: any[] }>('/api/library/subjects');
    return {
      success: res.success,
      data: (res.data || []).map((s) => ({
        id: s.id,
        name: s.name,
        codeInPlan: Number(s.codeInPlan),
        level: Number(s.level),
        kind: s.kind,
        approvedFilesCount: Number(s.approvedFilesCount || 0),
      })),
    };
  },

  /** GET /api/library/files — catálogo de archivos aprobados. */
  async listFiles(params?: LibraryFilterParams & { hasSolution?: boolean }): Promise<{
    success: boolean;
    data: { files: LibraryFilePublic[]; total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const qs = new URLSearchParams();
    if (params?.subjectId) qs.set('subjectId', params.subjectId);
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.academicYear) qs.set('year', String(params.academicYear));
    if (params?.term) qs.set('term', params.term);
    if (params?.professorId) qs.set('professorId', params.professorId);
    if (params?.hasSolution !== undefined) qs.set('hasSolution', String(params.hasSolution));
    if (params?.search) qs.set('search', params.search);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();

    const res = await apiFetch<{ success: boolean; data: any }>(
      `/api/library/files${query ? `?${query}` : ''}`
    );
    const d = res.data || {};
    return {
      success: res.success,
      data: {
        files: (d.items || []).map(toPublicFile),
        total: Number(d.total || 0),
        page: Number(d.page || 1),
        pageSize: Number(d.pageSize || 0),
        totalPages: Number(d.totalPages || 0),
      },
    };
  },

  /**
   * GET /api/library/my-uploads — marca las novedades como vistas.
   * Usar solo al abrir "Mis Aportes".
   */
  async getMyUploads(): Promise<{ success: boolean; data: LibraryMyUploadsResponse }> {
    const res = await apiFetch<{ success: boolean; data: any }>('/api/library/my-uploads');
    return { success: res.success, data: toMyUploads(res.data) };
  },

  /**
   * GET /api/library/my-uploads?peek=1 — consulta si hay novedades SIN marcarlas como vistas.
   * Usado por el badge del Navbar y la portada de la Biblioteca.
   */
  async peekMyUploads(): Promise<{ success: boolean; data: LibraryMyUploadsResponse }> {
    const res = await apiFetch<{ success: boolean; data: any }>('/api/library/my-uploads?peek=1');
    return { success: res.success, data: toMyUploads(res.data) };
  },

  async initUpload(payload: UploadInitPayload): Promise<{ success: boolean; data: UploadInitResponse }> {
    return apiFetch('/api/library/uploads/init', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * PUT directo a Cloudflare R2. Envía exactamente el Content-Type con el que se firmó la URL
   * (si difiere, R2 responde SignatureDoesNotMatch). Content-Length lo fija el navegador.
   */
  async uploadDirectToR2(
    uploadUrl: string,
    file: File | Blob,
    contentType: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', contentType);

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            onProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new ApiError(
              `Error al subir archivo al almacenamiento (${xhr.status}).`,
              xhr.status,
              'STORAGE_UPLOAD_ERROR'
            )
          );
        }
      };

      xhr.onerror = () => {
        reject(
          new ApiError(
            'Error de red o CORS al transferir el archivo al almacenamiento.',
            0,
            'STORAGE_NETWORK_ERROR'
          )
        );
      };

      xhr.send(file);
    });
  },

  async completeUpload(fileId: string): Promise<{ success: boolean; data: any }> {
    return apiFetch(`/api/library/uploads/${encodeURIComponent(fileId)}/complete`, {
      method: 'POST',
    });
  },

  async getDownloadUrl(fileId: string): Promise<{
    success: boolean;
    data: { downloadUrl: string; filename: string; mimeType: string; sizeBytes: number };
  }> {
    return apiFetch(`/api/library/files/${encodeURIComponent(fileId)}/download`);
  },

  async toggleHelpful(fileId: string): Promise<{
    success: boolean;
    data: { helpfulCount: number; hasVoted: boolean };
  }> {
    const res = await apiFetch<{ success: boolean; data: any }>(
      `/api/library/files/${encodeURIComponent(fileId)}/helpful`,
      { method: 'POST' }
    );
    return {
      success: res.success,
      data: { helpfulCount: Number(res.data?.helpfulCount || 0), hasVoted: Boolean(res.data?.voted) },
    };
  },

  async reportFile(
    fileId: string,
    reason: LibraryReportReason,
    note?: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await apiFetch<{ success: boolean; data: any }>(
      `/api/library/files/${encodeURIComponent(fileId)}/report`,
      { method: 'POST', body: JSON.stringify({ reason, note }) }
    );
    return { success: res.success, message: res.data?.message || 'Reporte recibido.' };
  },

  async updateMyUpload(
    fileId: string,
    data: { title?: string; description?: string }
  ): Promise<{ success: boolean; data: any }> {
    return apiFetch(`/api/library/my-uploads/${encodeURIComponent(fileId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteMyUpload(fileId: string): Promise<{ success: boolean; data: any }> {
    return apiFetch(`/api/library/my-uploads/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    });
  },
};

// ---------------------------------------------------------------------
// Administración: /api/admin/library/*
// La reautenticación viaja en la cookie HttpOnly admin_reauth_token que setea
// POST /api/admin/reauth (AdminReauthModal); no hace falta enviarla en el body.
// ---------------------------------------------------------------------

export interface AdminLibraryStats {
  approvedCount: number;
  pendingCount: number;
  openReportsCount: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
  storageWarning: boolean;
}

export const adminLibraryApi = {
  async getStats(): Promise<{ success: boolean; data: AdminLibraryStats }> {
    return apiFetch('/api/admin/library/stats');
  },

  async getPendingFiles(): Promise<{ success: boolean; data: { files: AdminLibraryFile[]; total: number } }> {
    const res = await apiFetch<{ success: boolean; data: any[] }>('/api/admin/library/pending');
    const files = (res.data || []).map(toAdminFile);
    return { success: res.success, data: { files, total: files.length } };
  },

  async approveFile(fileId: string): Promise<{ success: boolean; message?: string }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/approve`, {
      method: 'PATCH',
    });
  },

  async rejectFile(fileId: string, reason: string): Promise<{ success: boolean; message?: string }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  /** Baja definitiva del archivo (borra el objeto en R2). Requiere reautenticación. */
  async removeFile(fileId: string, reason?: string): Promise<{ success: boolean; message?: string }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/remove`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  async getReports(status: 'open' | 'dismissed' | 'actioned' | 'all' = 'open'): Promise<{
    success: boolean;
    data: { reports: AdminLibraryReport[]; total: number };
  }> {
    const res = await apiFetch<{ success: boolean; data: any[] }>(
      `/api/admin/library/reports?status=${encodeURIComponent(status)}`
    );
    const reports: AdminLibraryReport[] = (res.data || []).map((r) => ({
      id: r.id,
      fileId: r.fileId,
      reporterUserId: r.reporterUserId,
      reason: r.reason,
      note: r.note ?? null,
      status: r.status,
      createdAt: String(r.createdAt),
      file: {
        id: r.fileId,
        title: r.fileTitle,
        kind: r.fileKind,
        subjectId: r.subjectId,
        status: r.fileStatus,
      },
    }));
    return { success: res.success, data: { reports, total: reports.length } };
  },

  async updateReportStatus(
    reportId: string,
    status: 'open' | 'dismissed' | 'actioned'
  ): Promise<{ success: boolean }> {
    return apiFetch(`/api/admin/library/reports/${encodeURIComponent(reportId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async dismissReport(reportId: string): Promise<{ success: boolean }> {
    return adminLibraryApi.updateReportStatus(reportId, 'dismissed');
  },

  /** Da de baja el archivo denunciado (requiere reauth) y marca el reporte como accionado. */
  async actionReport(
    reportOrId: AdminLibraryReport | string,
    reason?: string,
    fileId?: string
  ): Promise<{ success: boolean }> {
    const reportId = typeof reportOrId === 'string' ? reportOrId : reportOrId.id;
    const targetFileId = typeof reportOrId === 'string' ? fileId : reportOrId.fileId;
    if (targetFileId) {
      await adminLibraryApi.removeFile(targetFileId, reason);
    }
    return adminLibraryApi.updateReportStatus(reportId, 'actioned');
  },

  async getCatalog(params?: {
    status?: string;
    subjectId?: string;
    kind?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    success: boolean;
    data: { files: AdminLibraryFile[]; total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.subjectId) qs.set('subjectId', params.subjectId);
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.search) qs.set('search', params.search);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();

    const res = await apiFetch<{ success: boolean; data: any }>(
      `/api/admin/library/files${query ? `?${query}` : ''}`
    );
    const d = res.data || {};
    return {
      success: res.success,
      data: {
        files: (d.items || []).map(toAdminFile),
        total: Number(d.total || 0),
        page: Number(d.page || 1),
        pageSize: Number(d.pageSize || 0),
        totalPages: Number(d.totalPages || 0),
      },
    };
  },

  async getPreviewUrl(fileId: string): Promise<{
    success: boolean;
    data: { previewUrl: string; mimeType: string; filename: string };
  }> {
    const res = await apiFetch<{ success: boolean; data: any }>(
      `/api/admin/library/files/${encodeURIComponent(fileId)}/preview-url`
    );
    return {
      success: res.success,
      data: {
        previewUrl: res.data?.previewUrl,
        mimeType: res.data?.mimeType,
        filename: res.data?.originalFilename,
      },
    };
  },

  /** GET con reautenticación reciente; queda registrado como library.view_uploader. */
  async getUploaderIdentity(
    fileId: string,
    _reauthTicket?: string
  ): Promise<{
    success: boolean;
    data: {
      hasUploader: boolean;
      message?: string;
      uploader?: { id: string; email: string; name?: string; status: string; role: string; createdAt: string };
    };
  }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/uploader`);
  },

  async suspendAuthor(
    fileId: string,
    reasonOrTicket: string,
    maybeReason?: string
  ): Promise<{ success: boolean; data: any }> {
    const reason = maybeReason !== undefined ? maybeReason : reasonOrTicket;
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/suspend-author`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async testStorage(_reauthTicket?: string): Promise<{ success: boolean; data: StorageTestReport }> {
    const res = await apiFetch<{ success: boolean; data: any }>('/api/admin/library/test-storage', {
      method: 'POST',
    });
    return { success: res.success, data: toStorageReport(res.data) };
  },
};
