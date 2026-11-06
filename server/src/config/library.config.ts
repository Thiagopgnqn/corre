/**
 * Constantes y límites de configuración para la Biblioteca de Material de Estudio.
 * Todas las restricciones de tamaño, cuotas y formatos están centralizadas aquí.
 */

export const LIBRARY_CONFIG = {
  /** Tamaño máximo permitido para archivos PDF (25 MB) */
  MAX_PDF_SIZE_BYTES: 25 * 1024 * 1024,

  /** Tamaño máximo permitido para imágenes JPG, PNG, WebP (10 MB) */
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,

  /** Tamaño máximo absoluto permitido por cualquier archivo individual (25 MB) */
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,

  /**
   * Máximo de archivos en estado pendiente de moderación simultáneos por usuario.
   * Default: 30 (configurable vía LIBRARY_MAX_PENDING_UPLOADS).
   */
  MAX_PENDING_UPLOADS: Number(process.env.LIBRARY_MAX_PENDING_UPLOADS) || 30,

  /** Cuota total acumulada en almacenamiento por usuario (300 MB en archivos activos) */
  MAX_USER_QUOTA_BYTES: 300 * 1024 * 1024,

  /** Límite de descargas permitidas por usuario por hora (protección anti-scraping) */
  MAX_HOURLY_DOWNLOADS: 60,

  /** Tiempo de validez de la URL firmada de subida PUT (10 minutos) */
  PRESIGNED_PUT_EXPIRES_SECONDS: 10 * 60,

  /** Tiempo de validez de la URL firmada de descarga GET (5 minutos) */
  PRESIGNED_GET_EXPIRES_SECONDS: 5 * 60,

  /** Tiempo de validez de la URL de previsualización para administradores (10 minutos) */
  PRESIGNED_PREVIEW_EXPIRES_SECONDS: 10 * 60,

  /** Tiempo máximo para validación en streaming de PDFs (15 segundos) */
  STREAMING_TIMEOUT_MS: 15_000,

  /** Versión actual de los términos y condiciones de la biblioteca */
  CURRENT_TERMS_VERSION: 'v1.0',

  /** Umbral de reportes generales para auto-ocultamiento preventivo */
  AUTO_HIDE_GENERAL_REPORTS_THRESHOLD: 3,

  /** Umbral de reportes de derechos de autor para auto-ocultamiento preventivo prioritario */
  AUTO_HIDE_COPYRIGHT_REPORTS_THRESHOLD: 2,

  /** Tipos MIME estrictamente permitidos en la biblioteca */
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ] as const,

  /** Extensiones de archivo permitidas (en minúsculas) */
  ALLOWED_EXTENSIONS: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'] as const,

  /** Umbral de almacenamiento en bytes a partir del cual se dispara alerta en admin (8 GB) */
  STORAGE_WARNING_THRESHOLD_BYTES: 8 * 1024 * 1024 * 1024,

  /** Máximo de notificaciones individuales por email a administradores por hora antes de agrupar en resumen */
  NOTIFY_ADMIN_MAX_PER_HOUR: 15,

  /** Tope global diario de emails a usuarios sobre aportes para preservar la cuota del proveedor */
  NOTIFY_USERS_MAX_PER_DAY: 150,

  /** Límite anti-scripts para /uploads/init (default: 120 llamadas cada 10 minutos por usuario) */
  UPLOAD_INIT_RATE_LIMIT_MAX: Number(process.env.LIBRARY_UPLOAD_INIT_RATE_LIMIT_MAX) || 120,

  /** Ventana de tiempo del rate limit de /uploads/init (default: 10 minutos en ms) */
  UPLOAD_INIT_RATE_LIMIT_WINDOW_MS:
    Number(process.env.LIBRARY_UPLOAD_INIT_RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000,

  /** Tiempo de expiración para filas 'uploading' abandonadas sin completar (default: 30 minutos) */
  UPLOADING_EXPIRATION_MINUTES: Number(process.env.LIBRARY_UPLOADING_EXPIRATION_MINUTES) || 30,

  /** Período de enfriamiento para consolidar emails al admin (default: 120 segundos / 2 minutos) */
  get ADMIN_NOTIFY_COOLDOWN_SECONDS(): number {
    if (overrideCooldownSeconds !== null) return overrideCooldownSeconds;
    return Number(process.env.LIBRARY_ADMIN_NOTIFY_COOLDOWN_SECONDS ?? 120);
  },

  /** Umbral anti-spam: máximo de rechazos en la ventana antes de bloqueo temporal (default: 20; 0 desactiva) */
  MAX_REJECTIONS_THRESHOLD:
    process.env.LIBRARY_MAX_REJECTIONS_THRESHOLD !== undefined
      ? Number(process.env.LIBRARY_MAX_REJECTIONS_THRESHOLD)
      : 20,

  /** Ventana de días para el recuento de rechazos anti-spam (default: 7 días) */
  REJECTIONS_WINDOW_DAYS: Number(process.env.LIBRARY_REJECTIONS_WINDOW_DAYS) || 7,

  /** Concurrencia máxima de validaciones streaming simultáneas en el servidor (Render) */
  SEMAPHORE_CONCURRENCY: 3,

  /** Tiempo máximo de espera en cola del semáforo antes de responder 503 LIBRARY_BUSY (10 segundos) */
  SEMAPHORE_TIMEOUT_MS: 10_000,

  /** Año académico mínimo aceptado para parciales y exámenes */
  ACADEMIC_YEAR_MIN: 2000,
};

export type AllowedMimeType = (typeof LIBRARY_CONFIG.ALLOWED_MIME_TYPES)[number];

let overrideCooldownSeconds: number | null = null;

export function setAdminNotifyCooldownOverride(seconds: number | null): void {
  overrideCooldownSeconds = seconds;
}
