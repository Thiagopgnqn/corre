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
  UploadInitPayload,
  UploadInitResponse,
} from '../types/library';

export const libraryApi = {
  /**
   * Obtiene el estado de aceptación de los términos de la biblioteca.
   */
  async getTermsStatus(): Promise<{
    success: boolean;
    data: { accepted: boolean; version: string | null; acceptedAt: string | null };
  }> {
    return apiFetch('/api/library/terms-status');
  },

  /**
   * Registra la aceptación de los términos y condiciones de la biblioteca.
   */
  async acceptTerms(): Promise<{
    success: boolean;
    data: { accepted: boolean; version: string };
  }> {
    return apiFetch('/api/library/accept-terms', {
      method: 'POST',
    });
  },

  /**
   * Obtiene la cantidad de archivos aprobados por materia para badges en el grafo.
   */
  async getSubjectsSummary(): Promise<{
    success: boolean;
    data: LibrarySubjectSummary[];
  }> {
    return apiFetch('/api/library/subjects-summary');
  },

  /**
   * Lista archivos aprobados con filtros aplicados.
   */
  async listFiles(params?: LibraryFilterParams): Promise<{
    success: boolean;
    data: {
      files: LibraryFilePublic[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    const qs = new URLSearchParams();
    if (params?.subjectId) qs.set('subjectId', params.subjectId);
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.academicYear) qs.set('academicYear', String(params.academicYear));
    if (params?.term) qs.set('term', params.term);
    if (params?.examInstance) qs.set('examInstance', params.examInstance);
    if (params?.professorId) qs.set('professorId', params.professorId);
    if (params?.search) qs.set('search', params.search);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));

    const query = qs.toString();
    return apiFetch(`/api/library/files${query ? `?${query}` : ''}`);
  },

  /**
   * Obtiene los archivos subidos por el usuario actual y el estado de su cuota.
   */
  async getMyUploads(): Promise<{
    success: boolean;
    data: LibraryMyUploadsResponse;
  }> {
    return apiFetch('/api/library/my-uploads');
  },

  /**
   * Marca las notificaciones de moderación de los aportes como revisadas.
   */
  async markUploadsChecked(): Promise<{ success: boolean }> {
    return apiFetch('/api/library/my-uploads/mark-checked', {
      method: 'POST',
    });
  },

  /**
   * Inicia el proceso de subida y obtiene la URL prefirmada para Cloudflare R2.
   */
  async initUpload(payload: UploadInitPayload): Promise<{
    success: boolean;
    data: UploadInitResponse;
  }> {
    return apiFetch('/api/library/uploads/init', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Sube el archivo directamente a Cloudflare R2 mediante PUT.
   * Requiere enviar obligatoriamente el Content-Type firmado.
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
            const percent = Math.round((evt.loaded / evt.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new ApiError(
              `Error al subir archivo a R2 (${xhr.status}): ${xhr.statusText || 'Rechazado por storage'}`,
              xhr.status,
              'STORAGE_UPLOAD_ERROR'
            )
          );
        }
      };

      xhr.onerror = () => {
        reject(
          new ApiError(
            'Error de red o CORS al transferir archivo a R2',
            0,
            'STORAGE_NETWORK_ERROR'
          )
        );
      };

      xhr.send(file);
    });
  },

  /**
   * Notifica la finalización de la subida para validación y cambio de estado a pending.
   */
  async completeUpload(fileId: string): Promise<{
    success: boolean;
    data: LibraryFilePublic;
  }> {
    return apiFetch(`/api/library/uploads/${encodeURIComponent(fileId)}/complete`, {
      method: 'POST',
    });
  },

  /**
   * Obtiene la URL de descarga prefirmada para un archivo aprobado.
   */
  async getDownloadUrl(fileId: string): Promise<{
    success: boolean;
    data: {
      downloadUrl: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    };
  }> {
    return apiFetch(`/api/library/files/${encodeURIComponent(fileId)}/download`);
  },

  /**
   * Vota si un archivo es útil (toggle).
   */
  async toggleHelpful(fileId: string): Promise<{
    success: boolean;
    data: { helpfulCount: number; hasVoted: boolean };
  }> {
    return apiFetch(`/api/library/files/${encodeURIComponent(fileId)}/helpful`, {
      method: 'POST',
    });
  },

  /**
   * Envía un reporte sobre un archivo.
   */
  async reportFile(
    fileId: string,
    reason: LibraryReportReason,
    note?: string
  ): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/library/files/${encodeURIComponent(fileId)}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason, note }),
    });
  },

  /**
   * Modifica la metadata de un archivo propio.
   */
  async updateMyUpload(
    fileId: string,
    data: { title?: string; description?: string; professorIds?: string[] }
  ): Promise<{ success: boolean; data: LibraryFileUser }> {
    return apiFetch(`/api/library/my-uploads/${encodeURIComponent(fileId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  /**
   * Elimina un archivo propio.
   */
  async deleteMyUpload(fileId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/library/my-uploads/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    });
  },
};

export const adminLibraryApi = {
  /**
   * Obtiene la cola de materiales pendientes de moderación.
   */
  async getPendingFiles(): Promise<{
    success: boolean;
    data: { files: AdminLibraryFile[]; total: number };
  }> {
    return apiFetch('/api/admin/library/pending');
  },

  /**
   * Aprueba un archivo de la biblioteca.
   */
  async approveFile(fileId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/approve`, {
      method: 'POST',
    });
  },

  /**
   * Rechaza un archivo de la biblioteca indicando el motivo.
   */
  async rejectFile(
    fileId: string,
    rejectionReason: string
  ): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejectionReason }),
    });
  },

  /**
   * Lista los reportes enviados por estudiantes.
   */
  async getReports(status?: 'open' | 'dismissed' | 'actioned'): Promise<{
    success: boolean;
    data: { reports: AdminLibraryReport[]; total: number };
  }> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return apiFetch(`/api/admin/library/reports${qs}`);
  },

  /**
   * Desestima un reporte.
   */
  async dismissReport(reportId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/library/reports/${encodeURIComponent(reportId)}/dismiss`, {
      method: 'POST',
    });
  },

  /**
   * Toma acción sobre un reporte (remueve el archivo asociado).
   */
  async actionReport(
    reportId: string,
    rejectionReason?: string
  ): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/library/reports/${encodeURIComponent(reportId)}/action`, {
      method: 'POST',
      body: JSON.stringify({ rejectionReason }),
    });
  },

  /**
   * Lista el catálogo completo de archivos para administradores.
   */
  async getCatalog(params?: {
    status?: string;
    subjectId?: string;
    kind?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    success: boolean;
    data: {
      files: AdminLibraryFile[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.subjectId) qs.set('subjectId', params.subjectId);
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.search) qs.set('search', params.search);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));

    const query = qs.toString();
    return apiFetch(`/api/admin/library/files${query ? `?${query}` : ''}`);
  },

  /**
   * Obtiene la URL de vista previa prefirmada para administradores (en cualquier estado).
   */
  async getPreviewUrl(fileId: string): Promise<{
    success: boolean;
    data: { previewUrl: string; mimeType: string; filename: string };
  }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/preview-url`);
  },

  /**
   * Consulta la identidad del uploader (requiere ticket de reautenticación).
   */
  async getUploaderIdentity(
    fileId: string,
    reauthTicket: string
  ): Promise<{
    success: boolean;
    data: {
      uploader: {
        id: string;
        name: string;
        email: string;
        createdAt: string;
        status: string;
      };
    };
  }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/uploader`, {
      method: 'POST',
      body: JSON.stringify({ reauthTicket }),
    });
  },

  /**
   * Suspende la cuenta del autor de un archivo (requiere reauth).
   */
  async suspendAuthor(
    fileId: string,
    reauthTicket: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/library/files/${encodeURIComponent(fileId)}/suspend-author`, {
      method: 'POST',
      body: JSON.stringify({ reauthTicket, reason }),
    });
  },

  /**
   * Prueba la conexión de lectura/escritura/borrado con Cloudflare R2 (requiere reauth).
   */
  async testStorage(reauthTicket: string): Promise<{
    success: boolean;
    data: StorageTestReport;
  }> {
    return apiFetch('/api/admin/library/test-storage', {
      method: 'POST',
      body: JSON.stringify({ reauthTicket }),
    });
  },
};

