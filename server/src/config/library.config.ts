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

  /** Máximo de subidas permitidas por usuario por día calendario */
  MAX_DAILY_UPLOADS: 5,

  /** Máximo de archivos en estado pendiente de moderación simultáneos por usuario */
  MAX_PENDING_UPLOADS: 10,

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
};

export type AllowedMimeType = (typeof LIBRARY_CONFIG.ALLOWED_MIME_TYPES)[number];
