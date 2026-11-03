export type LibraryFileKind =
  | 'parcial'
  | 'final'
  | 'apunte'
  | 'resumen'
  | 'tp'
  | 'guia'
  | 'otro';

export type LibraryTerm = '1C' | '2C' | 'A';

export type LibraryFileStatus =
  | 'uploading'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'hidden'
  | 'removed';

export type LibraryReportReason =
  | 'derechos_de_autor'
  | 'contenido_inapropiado'
  | 'incorrecto_o_enganoso'
  | 'duplicado'
  | 'otro';

export interface LibraryFilePublic {
  id: string;
  subjectId: string;
  kind: LibraryFileKind;
  academicYear: number | null;
  term: LibraryTerm | null;
  examInstance: string | null;
  hasSolution: boolean;
  title: string;
  description: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  downloadCount: number;
  helpfulCount: number;
  hasVotedHelpful?: boolean;
  professorNames?: string[];
  createdAt: string;
}

export interface LibraryFileUser extends LibraryFilePublic {
  status: LibraryFileStatus;
  rejectionReason: string | null;
  updatedAt: string;
}

export interface LibrarySubjectSummary {
  id: string;
  name: string;
  codeInPlan: number;
  level: number;
  kind?: string;
  approvedFilesCount: number;
}

export interface LibraryMyUploadsResponse {
  files: LibraryFileUser[];
  usedBytes: number;
  maxBytes: number;
  hasStatusUpdates: boolean;
}

export interface UploadInitPayload {
  subjectId: string;
  kind: LibraryFileKind;
  academicYear?: number;
  term?: LibraryTerm;
  examInstance?: string;
  hasSolution?: boolean;
  title: string;
  description?: string;
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
  professorIds?: string[];
  acceptTerms?: boolean;
}

export interface UploadInitResponse {
  fileId: string;
  uploadUrl: string;
  storageKey: string;
  maxSizeBytes: number;
  headers: Record<string, string>;
}

export interface LibraryFilterParams {
  subjectId?: string;
  kind?: LibraryFileKind;
  academicYear?: number;
  term?: LibraryTerm;
  examInstance?: string;
  professorId?: string;
  search?: string;
  sort?: 'recent' | 'downloads' | 'helpful';
  page?: number;
  pageSize?: number;
}

export interface AdminLibraryFile extends LibraryFileUser {
  storageKey: string;
  sha256: string | null;
  uploaderUserId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  adminNotifiedAt?: string | null;
  uploaderNotifiedAt?: string | null;
  reportsCount?: number;
  subjectName?: string;
}

export interface AdminLibraryReport {
  id: string;
  fileId: string;
  reporterUserId: string;
  reason: LibraryReportReason;
  note: string | null;
  status: 'open' | 'dismissed' | 'actioned';
  createdAt: string;
  file?: {
    id: string;
    title: string;
    kind: LibraryFileKind;
    subjectId: string;
    status: LibraryFileStatus;
  };
}

export interface StorageTestStep {
  name: string;
  success: boolean;
  message?: string;
}

export interface StorageTestReport {
  success: boolean;
  step: 'put' | 'get' | 'delete' | 'complete';
  message: string;
  stepsCompleted: StorageTestStep[];
  details?: Record<string, unknown>;
}

export const LIBRARY_CONFIG = {
  MAX_PDF_SIZE_BYTES: 25 * 1024 * 1024, // 25 MB
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_USER_QUOTA_BYTES: 300 * 1024 * 1024, // 300 MB
  CURRENT_TERMS_VERSION: 'v1.0',
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ],
} as const;
