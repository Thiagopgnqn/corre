import { LIBRARY_CONFIG, type LibraryFileKind, type LibraryTerm } from '../types/library';
import { libraryApi } from '../api/library.api';

export interface BatchFileItem {
  id: string; // ID local del lote (ej. temporal)
  file: File;
  title: string;
  kind: LibraryFileKind;
  academicYear: number | null;
  term: LibraryTerm | null;
  examInstance: string | null;
  hasSolution: boolean;
  description: string;
  status: 'idle' | 'init' | 'uploading' | 'completing' | 'done' | 'error' | 'cancelled';
  progress: number; // 0 - 100
  error?: string;
  errorCode?: string;
  fileId?: string; // Asignado tras initUpload exitoso
  abortController?: AbortController;
  retryCount: number;
}

export interface ParsedFilenameSuggestions {
  kind: LibraryFileKind;
  academicYear: number | null;
  term: LibraryTerm | null;
  examInstance: string | null;
  hasSolution: boolean;
  cleanTitle: string;
}

/**
 * Normaliza una cadena quitando diacríticos/acentos y pasando a minúsculas
 * para análisis de patrones seguro.
 */
function normalizeForMatch(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Extrae sugerencias inteligentes a partir del nombre del archivo:
 * - Año lectivo (entre 2000 y añoActual + 1)
 * - Cuatrimestre ('1C', '2C', 'A')
 * - Tipo de material ('parcial', 'final', 'apunte', 'resumen', 'tp', 'guia', 'otro')
 * - Instancia de examen ('1° Parcial', '2° Parcial', '3° Parcial', 'Recuperatorio', 'Examen Final')
 * - hasSolution (si contiene 'resuelto', 'solucion', 'resolucion', etc.)
 * - cleanTitle (título limpio y formateado como buen punto de partida)
 */
export function parseFilenameSuggestions(filename: string): ParsedFilenameSuggestions {
  // 1. Quitar extensión
  const dotIndex = filename.lastIndexOf('.');
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const norm = normalizeForMatch(baseName);

  const currentYear = new Date().getFullYear();

  // 2. Detección de Año (2000 .. currentYear + 1)
  let academicYear: number | null = null;
  const yearMatches = norm.match(/(?:^|\D)(20[0-2][0-9])(?:\D|$)/g);
  if (yearMatches) {
    for (const ym of yearMatches) {
      const numMatch = ym.match(/20[0-2][0-9]/);
      if (numMatch) {
        const y = parseInt(numMatch[0], 10);
        if (y >= 2000 && y <= currentYear + 1) {
          academicYear = y;
          break;
        }
      }
    }
  }

  // 3. Detección de Cuatrimestre ('1C' | '2C' | 'A')
  let term: LibraryTerm | null = null;
  if (/(?:^|\D)(?:1\s*c|1\s*cuat|1er\s*cuat|primer\s*cuat)/i.test(norm)) {
    term = '1C';
  } else if (/(?:^|\D)(?:2\s*c|2\s*cuat|2do\s*cuat|segundo\s*cuat)/i.test(norm)) {
    term = '2C';
  } else if (/(?:^|\D)(?:anual|anualidad)/i.test(norm)) {
    term = 'A';
  }

  // 4. Detección de Tipo de Material
  let kind: LibraryFileKind = 'parcial';
  if (/(?:^|\D)(?:final|examen\s*final)(?:\D|$)/i.test(norm)) {
    kind = 'final';
  } else if (/(?:^|\D)(?:resumen|sintesis)(?:\D|$)/i.test(norm)) {
    kind = 'resumen';
  } else if (/(?:^|\D)(?:apunte|apuntes|clase|teorica)(?:\D|$)/i.test(norm)) {
    kind = 'apunte';
  } else if (/(?:^|\D)(?:tp\d*|trabajo\s*practico|laboratorio|lab\d*)(?:\D|$)/i.test(norm)) {
    kind = 'tp';
  } else if (/(?:^|\D)(?:guia\d*|ejercicios|practica\d*)(?:\D|$)/i.test(norm)) {
    kind = 'guia';
  } else if (/(?:^|\D)(?:parcial|1p|2p|3p|recu|recuperatorio)(?:\D|$)/i.test(norm)) {
    kind = 'parcial';
  } else {
    // Si no coincide con palabras clave específicas, por omisión en la biblioteca comunitaria
    // se sugiere 'parcial' si hay año o 'otro' si es genérico.
    kind = academicYear ? 'parcial' : 'otro';
  }

  // 5. Detección de Instancia de Examen
  let examInstance: string | null = null;
  if (kind === 'parcial') {
    if (/(?:^|\D)(?:recu(?:peratorio)?|rec)(?:\D|$)/i.test(norm)) {
      examInstance = 'Recuperatorio';
    } else if (/(?:^|\D)(?:3\s*p(?:arcial)?|3er\s*parcial|tercer\s*parcial)(?:\D|$)/i.test(norm)) {
      examInstance = '3° Parcial';
    } else if (/(?:^|\D)(?:2\s*p(?:arcial)?|2do\s*parcial|segundo\s*parcial)(?:\D|$)/i.test(norm)) {
      examInstance = '2° Parcial';
    } else if (/(?:^|\D)(?:1\s*p(?:arcial)?|1er\s*parcial|primer\s*parcial)(?:\D|$)/i.test(norm)) {
      examInstance = '1° Parcial';
    } else {
      examInstance = '1° Parcial';
    }
  } else if (kind === 'final') {
    examInstance = 'Examen Final';
  }

  // 6. Detección de Resolución / Solución
  const hasSolution = /(?:^|[^a-z0-9])(?:resuelto|resuelta|resueltos|solucion|resolucion|soluciones|con\s*rta|con\s*respuestas?)(?:[^a-z0-9]|$)/i.test(
    norm
  );

  // 7. Generación de cleanTitle legible
  // Limpia guiones bajos y múltiples espacios/guiones
  let cleanTitle = baseName
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Capitaliza palabras para mejor legibilidad si el nombre estaba todo en minúsculas
  if (cleanTitle === cleanTitle.toLowerCase()) {
    cleanTitle = cleanTitle
      .split(' ')
      .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ''))
      .join(' ');
  }

  return {
    kind,
    academicYear,
    term,
    examInstance,
    hasSolution,
    cleanTitle: cleanTitle.slice(0, 120),
  };
}

/**
 * Aplica año y cuatrimestre por defecto a un lote de archivos:
 * - Si forceAll es false (comportamiento estándar): SOLO rellena los que tengan
 *   dichos campos vacíos (null / undefined), preservando valores manuales o inferidos.
 * - Si forceAll es true: sobrescribe todos los archivos del lote.
 */
export function applyDefaultYearTerm(
  items: BatchFileItem[],
  defaultYear?: number | null,
  defaultTerm?: LibraryTerm | null,
  forceAll: boolean = false
): BatchFileItem[] {
  return items.map((item) => {
    let newYear = item.academicYear;
    let newTerm = item.term;

    if (forceAll) {
      if (defaultYear !== undefined) newYear = defaultYear;
      if (defaultTerm !== undefined) newTerm = defaultTerm;
    } else {
      if ((newYear === null || newYear === undefined) && defaultYear !== undefined && defaultYear !== null) {
        newYear = defaultYear;
      }
      if ((newTerm === null || newTerm === undefined) && defaultTerm !== undefined && defaultTerm !== null) {
        newTerm = defaultTerm;
      }
    }

    return {
      ...item,
      academicYear: newYear,
      term: newTerm,
    };
  });
}

/**
 * Valida un archivo individual dentro de un lote.
 * Si es inválido, devuelve el error sin bloquear a los demás archivos del lote.
 */
export function validateBatchItem(
  item: {
    file: { name: string; size: number; type: string };
    title: string;
    kind: LibraryFileKind;
    academicYear: number | null;
    term?: LibraryTerm | null;
  },
  subjectId?: string
): { valid: boolean; error?: string } {
  if (!subjectId || !subjectId.trim()) {
    return { valid: false, error: 'Debes seleccionar una materia para el lote.' };
  }

  const { file, title, kind, academicYear } = item;

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage =
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    /\.(jpe?g|png|webp)$/i.test(file.name);

  if (!isPdf && !isImage) {
    return {
      valid: false,
      error: 'Formato no permitido. Solo se aceptan PDFs o imágenes (PNG, JPEG, WEBP).',
    };
  }

  if (isPdf && file.size > LIBRARY_CONFIG.MAX_PDF_SIZE_BYTES) {
    return {
      valid: false,
      error: `El PDF supera el límite de 25 MB (tamaño: ${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  if (isImage && file.size > LIBRARY_CONFIG.MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `La imagen supera el límite de 10 MB (tamaño: ${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  if (!title || !title.trim()) {
    return { valid: false, error: 'El título del archivo es obligatorio.' };
  }

  if (title.trim().length > 120) {
    return { valid: false, error: 'El título no puede superar los 120 caracteres.' };
  }

  // Año obligatorio para parciales y exámenes finales
  if (['parcial', 'final'].includes(kind)) {
    if (academicYear === null || academicYear === undefined || isNaN(academicYear)) {
      return {
        valid: false,
        error: 'El año lectivo es obligatorio para parciales y exámenes finales.',
      };
    }
    if (academicYear < 2000 || academicYear > 2030) {
      return {
        valid: false,
        error: 'El año lectivo debe estar comprendido entre 2000 y 2030.',
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------
// COORDINADOR DE SUBIDA MÚLTIPLE (UploadQueueCoordinator)
// ---------------------------------------------------------------------

export interface UploadOverallStats {
  totalBytes: number;
  uploadedBytes: number;
  percent: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  settledCount: number;
  totalCount: number;
  isFinished: boolean;
}

export interface BatchUploadSummary {
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCount: number;
  items: BatchFileItem[];
}

export interface UploadQueueCoordinatorOptions {
  maxConcurrentPuts?: number; // Tope: 3
  maxConcurrentCompletes?: number; // Tope: 2
  maxRetries?: number; // Hasta 4 intentos
  backoffDelays?: number[]; // [1000, 2000, 4000, 8000]
  api?: {
    initUpload: typeof libraryApi.initUpload;
    uploadDirectToR2: typeof libraryApi.uploadDirectToR2;
    completeUpload: typeof libraryApi.completeUpload;
    deleteMyUpload: typeof libraryApi.deleteMyUpload;
  };
  onItemChange?: (item: BatchFileItem) => void;
  onOverallProgress?: (stats: UploadOverallStats) => void;
  onBatchComplete?: (summary: BatchUploadSummary) => void;
}

const NON_RETRIABLE_ERROR_CODES = new Set([
  'LIMIT_PENDING_UPLOADS',
  'LIMIT_STORAGE_QUOTA',
  'QUOTA_EXCEEDED',
  'TOO_MANY_REJECTIONS',
  'INVALID_FILE_CONTENT',
  'DANGEROUS_PDF_CONTENT',
  'DUPLICATE_FILE',
  'UPLOAD_ABORTED',
  'TERMS_REQUIRED',
  'UPLOAD_ALREADY_REJECTED',
  'UPLOAD_NOT_ACTIVE',
  'INVALID_STATUS',
]);

/**
 * Traduce códigos y errores del flujo de subida a mensajes claros en español rioplatense.
 */
export function formatUploadErrorMessage(err: any): string {
  const code = typeof err?.code === 'string' ? err.code : '';
  const rawMsg = typeof err?.message === 'string' ? err.message.trim() : '';

  if (/pdf protegido/i.test(rawMsg)) {
    return 'PDF protegido: no pudimos verificar su contenido por seguridad. Volvé a exportarlo o imprimilo a PDF desde tu navegador y subilo de nuevo.';
  }

  if (/no pudimos verificar la seguridad de este pdf/i.test(rawMsg)) {
    return 'No pudimos verificar la seguridad de este PDF. Volvé a exportarlo o imprimilo a PDF desde tu navegador y subilo de nuevo.';
  }

  if (
    code === 'DANGEROUS_PDF_CONTENT' ||
    /acciones autom[aá]ticas|elementos ejecutables|scripts no permitidos/i.test(rawMsg)
  ) {
    return 'Este PDF contiene acciones automáticas o ejecutables bloqueadas por seguridad. Volvé a exportar el PDF o imprimilo a PDF desde tu navegador y subilo de nuevo.';
  }

  if (
    code === 'INVALID_FILE_CONTENT' ||
    /no coincide con la firma|magic number|tamañ?o real.*difiere/i.test(rawMsg)
  ) {
    return 'Este archivo no es un PDF ni una imagen válida.';
  }

  if (code === 'DUPLICATE_FILE') {
    return 'Este archivo ya se encuentra en la biblioteca (duplicado detectado por firma SHA-256).';
  }

  if (code === 'LIMIT_STORAGE_QUOTA' || code === 'QUOTA_EXCEEDED') {
    return 'Superaste tu cuota de almacenamiento disponible.';
  }

  if (code === 'LIMIT_PENDING_UPLOADS') {
    return rawMsg || 'Alcanzaste el cupo máximo de aportes en revisión.';
  }

  if (code === 'TOO_MANY_REJECTIONS') {
    return rawMsg || 'Tu cuenta alcanzó el límite temporal de rechazos. Intentá más tarde.';
  }

  if (code === 'LIMIT_RATE_EXCEEDED') {
    return 'Demasiados intentos en poco tiempo. Esperá unos minutos y volvé a intentar.';
  }

  if (
    code === 'NETWORK_ERROR' ||
    code === 'STORAGE_NETWORK_ERROR' ||
    code === 'FETCH_ERROR' ||
    /network|failed to fetch|cors|error de conexi[oó]n/i.test(rawMsg)
  ) {
    return 'No pudimos subir el archivo por un problema de conexión. Revisá tu internet y volvé a intentar.';
  }

  return rawMsg || 'Ocurrió un error al procesar el archivo.';
}

export class UploadQueueCoordinator {
  private maxConcurrentPuts: number;
  private maxConcurrentCompletes: number;
  private maxRetries: number;
  private backoffDelays: number[];
  private api: NonNullable<UploadQueueCoordinatorOptions['api']>;
  private onItemChange?: (item: BatchFileItem) => void;
  private onOverallProgress?: (stats: UploadOverallStats) => void;
  private onBatchComplete?: (summary: BatchUploadSummary) => void;

  private items: Map<string, BatchFileItem> = new Map();
  private subjectId: string = '';
  private activePuts = 0;
  private activeCompletes = 0;
  private isProcessing = false;
  private isCancelledAll = false;
  private batchPromise: Promise<BatchUploadSummary> | null = null;
  private batchResolve: ((summary: BatchUploadSummary) => void) | null = null;

  constructor(options: UploadQueueCoordinatorOptions = {}) {
    this.maxConcurrentPuts = options.maxConcurrentPuts ?? 3;
    this.maxConcurrentCompletes = options.maxConcurrentCompletes ?? 2;
    this.maxRetries = options.maxRetries ?? 4;
    this.backoffDelays = options.backoffDelays ?? [1000, 2000, 4000, 8000];
    this.api = options.api ?? {
      initUpload: libraryApi.initUpload.bind(libraryApi),
      uploadDirectToR2: libraryApi.uploadDirectToR2.bind(libraryApi),
      completeUpload: libraryApi.completeUpload.bind(libraryApi),
      deleteMyUpload: libraryApi.deleteMyUpload.bind(libraryApi),
    };
    this.onItemChange = options.onItemChange;
    this.onOverallProgress = options.onOverallProgress;
    this.onBatchComplete = options.onBatchComplete;
  }

  public setHandlers(handlers: {
    onItemChange?: (item: BatchFileItem) => void;
    onOverallProgress?: (stats: UploadOverallStats) => void;
    onBatchComplete?: (summary: BatchUploadSummary) => void;
  }): void {
    this.onItemChange = handlers.onItemChange;
    this.onOverallProgress = handlers.onOverallProgress;
    this.onBatchComplete = handlers.onBatchComplete;
  }

  public setQueue(items: BatchFileItem[], subjectId: string): void {
    this.subjectId = subjectId;
    this.items.clear();
    for (const item of items) {
      this.items.set(item.id, { ...item });
    }
    this.notifyOverall();
  }

  public syncItemsMetadata(items: BatchFileItem[], subjectId: string): void {
    this.subjectId = subjectId;
    const nextIds = new Set(items.map((it) => it.id));
    for (const id of Array.from(this.items.keys())) {
      if (!nextIds.has(id)) {
        this.items.delete(id);
      }
    }
    for (const item of items) {
      const existing = this.items.get(item.id);
      if (existing) {
        this.items.set(item.id, {
          ...existing,
          title: item.title,
          kind: item.kind,
          academicYear: item.academicYear,
          term: item.term,
          examInstance: item.examInstance,
          hasSolution: item.hasSolution,
          description: item.description,
        });
      } else {
        this.items.set(item.id, { ...item });
      }
    }
    this.notifyOverall();
  }

  public getItem(id: string): BatchFileItem | undefined {
    return this.items.get(id);
  }

  public getAllItems(): BatchFileItem[] {
    return Array.from(this.items.values());
  }

  public isBusy(): boolean {
    return this.activePuts > 0 || this.activeCompletes > 0 || this.isProcessing;
  }

  private isRetriableError(err: any): boolean {
    const status = err?.status || err?.statusCode || 0;
    const code = typeof err?.code === 'string' ? err.code : '';
    if (NON_RETRIABLE_ERROR_CODES.has(code)) return false;
    if (
      status === 400 ||
      status === 401 ||
      status === 403 ||
      status === 404 ||
      status === 409 ||
      status === 410
    ) {
      return false;
    }
    if (status === 503) return true;
    if (status === 429) {
      return !code || code === 'LIMIT_RATE_EXCEEDED';
    }
    if (code === 'NETWORK_ERROR' || code === 'STORAGE_NETWORK_ERROR' || code === 'FETCH_ERROR') {
      return true;
    }
    if (
      err?.message &&
      /network|fetch|timeout|cors|temporarily unavailable|error de conexi[oó]n/i.test(err.message)
    ) {
      return true;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, ms));
  }

  private updateItem(id: string, patch: Partial<BatchFileItem>): BatchFileItem | null {
    const current = this.items.get(id);
    if (!current) return null;
    const updated = { ...current, ...patch };
    this.items.set(id, updated);
    if (this.onItemChange) {
      this.onItemChange(updated);
    }
    this.notifyOverall();
    return updated;
  }

  public getOverallStats(): UploadOverallStats {
    const all = Array.from(this.items.values());
    const totalCount = all.length;
    let completedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;
    let settledCount = 0;
    let totalBytes = 0;
    let uploadedBytes = 0;
    let fallbackPercentSum = 0;

    for (const it of all) {
      const sz = it.file.size;
      totalBytes += sz;
      if (it.status === 'done') {
        completedCount++;
        settledCount++;
        uploadedBytes += sz;
        fallbackPercentSum += 100;
      } else if (it.status === 'error') {
        failedCount++;
        settledCount++;
        uploadedBytes += sz;
        fallbackPercentSum += 100;
      } else if (it.status === 'cancelled') {
        cancelledCount++;
        settledCount++;
        uploadedBytes += sz;
        fallbackPercentSum += 100;
      } else if (it.status === 'init' || it.status === 'uploading' || it.status === 'completing') {
        const p = Math.max(0, Math.min(100, it.progress || 0));
        uploadedBytes += (sz * p) / 100;
        fallbackPercentSum += p;
      }
    }

    const inFlightPercentCap = 100 - 1;
    let percent = 0;
    if (totalCount > 0) {
      if (settledCount === totalCount) {
        percent = 100;
      } else if (totalBytes > 0) {
        percent = Math.min(inFlightPercentCap, Math.round((uploadedBytes / totalBytes) * 100));
      } else {
        percent = Math.min(inFlightPercentCap, Math.round(fallbackPercentSum / totalCount));
      }
    }

    const isFinished =
      totalCount === 0 ||
      (settledCount === totalCount && this.activePuts === 0 && this.activeCompletes === 0);

    return {
      totalBytes,
      uploadedBytes: Math.round(uploadedBytes),
      percent,
      completedCount,
      failedCount,
      cancelledCount,
      settledCount,
      totalCount,
      isFinished,
    };
  }

  private notifyOverall(): void {
    if (!this.onOverallProgress) return;
    this.onOverallProgress(this.getOverallStats());
  }

  /**
   * Inicia el procesamiento ordenado de la cola respetando los límites de concurrencia.
   * Resuelve únicamente cuando todos los archivos alcanzan un estado terminal.
   */
  public start(): Promise<BatchUploadSummary> {
    if (this.batchPromise && this.isProcessing) {
      return this.batchPromise;
    }

    this.isCancelledAll = false;
    this.isProcessing = true;

    this.batchPromise = new Promise<BatchUploadSummary>((resolve) => {
      this.batchResolve = resolve;
    });

    this.pumpQueue();
    return this.batchPromise;
  }

  private pumpQueue(): void {
    if (!this.isCancelledAll) {
      const idleItems = Array.from(this.items.values()).filter((it) => it.status === 'idle');

      while (this.activePuts < this.maxConcurrentPuts && idleItems.length > 0 && !this.isCancelledAll) {
        const nextItem = idleItems.shift();
        if (!nextItem) break;

        // Validamos antes de arrancar
        const validation = validateBatchItem(nextItem, this.subjectId);
        if (!validation.valid) {
          this.updateItem(nextItem.id, {
            status: 'error',
            error: validation.error,
          });
          continue;
        }

        this.activePuts++;
        // Lanzamos la subida individual independiente para permitir concurrencia
        void this.processItem(nextItem.id).finally(() => {
          this.activePuts = Math.max(0, this.activePuts - 1);
          this.pumpQueue();
        });
      }
    }

    this.checkAllDone();
  }

  private checkAllDone(): void {
    const all = Array.from(this.items.values());
    const pending = all.some((it) => ['idle', 'init', 'uploading', 'completing'].includes(it.status));
    if (!pending && this.activePuts === 0 && this.activeCompletes === 0) {
      this.isProcessing = false;
      this.notifyOverall();

      const summary: BatchUploadSummary = {
        completedCount: all.filter((it) => it.status === 'done').length,
        failedCount: all.filter((it) => it.status === 'error').length,
        cancelledCount: all.filter((it) => it.status === 'cancelled').length,
        totalCount: all.length,
        items: all,
      };

      const resolve = this.batchResolve;
      this.batchResolve = null;
      this.batchPromise = null;

      if (resolve) {
        resolve(summary);
      }
      if (this.onBatchComplete) {
        this.onBatchComplete(summary);
      }
    }
  }

  private async processItem(id: string): Promise<void> {
    let item = this.items.get(id);
    if (!item || item.status !== 'idle' || this.isCancelledAll) return;

    const controller = new AbortController();
    item =
      this.updateItem(id, {
        abortController: controller,
        error: undefined,
        errorCode: undefined,
      }) ?? item;

    let attempt = item.retryCount;
    let success = false;
    let currentFileId: string | undefined = item.fileId;
    let uploadedToR2 = false;

    try {
      while (attempt <= this.maxRetries && !success && !this.isCancelledAll) {
        if (controller.signal.aborted) {
          if (currentFileId && !uploadedToR2) {
            await this.cleanUpFileOnServer(currentFileId);
          }
          this.updateItem(id, { status: 'cancelled' });
          return;
        }

        try {
          const mimeType =
            item.file.type ||
            (item.file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

          if (!uploadedToR2 || !currentFileId) {
            if (currentFileId) {
              await this.cleanUpFileOnServer(currentFileId);
              currentFileId = undefined;
            }

            // PASO 1: Init Just-In-Time
            this.updateItem(id, { status: 'init', progress: 5, fileId: undefined });

            const initRes = await this.api.initUpload({
              subjectId: this.subjectId,
              kind: item.kind,
              academicYear: ['parcial', 'final'].includes(item.kind)
                ? item.academicYear || undefined
                : undefined,
              term: ['parcial', 'final'].includes(item.kind) ? item.term || undefined : undefined,
              examInstance: ['parcial', 'final'].includes(item.kind)
                ? item.examInstance || undefined
                : undefined,
              hasSolution: item.hasSolution,
              title: item.title.trim(),
              description: item.description.trim() || undefined,
              originalFilename: item.file.name,
              sizeBytes: item.file.size,
              mimeType,
              acceptTerms: true,
            });

            currentFileId = initRes.data.fileId;
            const uploadUrl = initRes.data.uploadUrl;
            item =
              this.updateItem(id, { fileId: currentFileId, status: 'uploading', progress: 10 }) ??
              item;

            if (controller.signal.aborted || this.isCancelledAll) {
              await this.cleanUpFileOnServer(currentFileId);
              this.updateItem(id, { status: 'cancelled' });
              return;
            }

            // PASO 2: PUT a Cloudflare R2 con progreso y señal de cancelación
            await this.api.uploadDirectToR2(
              uploadUrl,
              item.file,
              mimeType,
              (percent) => {
                if (!controller.signal.aborted) {
                  const mapped = 10 + Math.round(percent * 0.75); // 10% a 85%
                  this.updateItem(id, { progress: mapped });
                }
              },
              controller.signal
            );

            uploadedToR2 = true;

            if (controller.signal.aborted || this.isCancelledAll) {
              await this.cleanUpFileOnServer(currentFileId);
              this.updateItem(id, { status: 'cancelled' });
              return;
            }
          }

          // PASO 3: Esperar turno para Complete (máximo 2 concurrentes)
          this.updateItem(id, { progress: 86 });
          const gotSlot = await this.waitForCompleteSlot(controller.signal);

          if (!gotSlot) {
            await this.cleanUpFileOnServer(currentFileId);
            this.updateItem(id, { status: 'cancelled' });
            return;
          }

          try {
            // Una vez en 'completing', el archivo no puede cancelarse
            item = this.updateItem(id, { status: 'completing', progress: 88 }) ?? item;
            await this.api.completeUpload(currentFileId);
            success = true;
            this.updateItem(id, { status: 'done', progress: 100 });
          } finally {
            this.activeCompletes = Math.max(0, this.activeCompletes - 1);
          }
        } catch (err: any) {
          const currentStatus = this.items.get(id)?.status;
          if ((controller.signal.aborted || this.isCancelledAll) && currentStatus !== 'completing') {
            if (currentFileId) {
              await this.cleanUpFileOnServer(currentFileId);
            }
            this.updateItem(id, { status: 'cancelled' });
            return;
          }

          if (!uploadedToR2 && currentFileId) {
            await this.cleanUpFileOnServer(currentFileId);
            currentFileId = undefined;
            this.updateItem(id, { fileId: undefined });
          }

          attempt++;
          const isRetriable = this.isRetriableError(err);

          if (
            isRetriable &&
            attempt <= this.maxRetries &&
            !(this.isCancelledAll && currentStatus !== 'completing')
          ) {
            const delayIndex = Math.min(attempt - 1, this.backoffDelays.length - 1);
            const delayMs = this.backoffDelays[delayIndex] ?? 1000;
            this.updateItem(id, {
              retryCount: attempt,
              error: `Reintentando en ${(delayMs / 1000).toFixed(0)}s (intento ${attempt}/${this.maxRetries})...`,
            });
            await this.sleep(delayMs);
          } else {
            // Error definitivo
            this.updateItem(id, {
              status: 'error',
              error: formatUploadErrorMessage(err),
              errorCode: err?.code,
              retryCount: attempt,
            });
            return;
          }
        }
      }

      const finalState = this.items.get(id);
      if (finalState && !['done', 'error', 'cancelled'].includes(finalState.status)) {
        if (this.isCancelledAll || controller.signal.aborted) {
          this.updateItem(id, { status: 'cancelled' });
        } else {
          this.updateItem(id, {
            status: 'error',
            error: 'No se pudo completar la subida del archivo.',
          });
        }
      }
    } catch (unexpectedErr: any) {
      const current = this.items.get(id);
      if (current && !['done', 'error', 'cancelled'].includes(current.status)) {
        this.updateItem(id, {
          status: 'error',
          error: formatUploadErrorMessage(unexpectedErr),
          errorCode: unexpectedErr?.code,
        });
      }
    }
  }

  private async waitForCompleteSlot(signal: AbortSignal): Promise<boolean> {
    while (this.activeCompletes >= this.maxConcurrentCompletes) {
      if (signal.aborted || this.isCancelledAll) {
        return false;
      }
      await this.sleep(50);
    }
    if (signal.aborted || this.isCancelledAll) {
      return false;
    }
    this.activeCompletes++;
    return true;
  }

  private async cleanUpFileOnServer(fileId?: string): Promise<void> {
    if (!fileId) return;
    try {
      await this.api.deleteMyUpload(fileId);
    } catch {
      // Ignorar errores de cleanup en cancelación de fondo
    }
  }

  /**
   * Cancela un archivo individual. No permite cancelar si ya está en 'completing' o 'done'.
   */
  public async cancelItem(id: string): Promise<boolean> {
    const item = this.items.get(id);
    if (!item || item.status === 'completing' || item.status === 'done') {
      return false;
    }

    if (item.abortController) {
      item.abortController.abort();
    }

    const fileId = item.fileId;
    this.updateItem(id, { status: 'cancelled' });

    if (fileId) {
      await this.cleanUpFileOnServer(fileId);
    }
    this.pumpQueue();
    return true;
  }

  /**
   * Remueve un archivo no activo de la cola interna.
   */
  public removeItem(id: string): boolean {
    const item = this.items.get(id);
    if (!item || item.status === 'completing') return false;
    if (['init', 'uploading'].includes(item.status)) return false;
    this.items.delete(id);
    this.notifyOverall();
    return true;
  }

  /**
   * Cancela los archivos que todavía no entraron en 'completing'.
   */
  public async cancelAll(): Promise<void> {
    this.isCancelledAll = true;
    const cleanups: Promise<void>[] = [];

    for (const [id, item] of this.items.entries()) {
      if (['init', 'uploading', 'idle'].includes(item.status)) {
        if (item.abortController) {
          item.abortController.abort();
        }
        if (item.fileId) {
          cleanups.push(this.cleanUpFileOnServer(item.fileId));
        }
        this.updateItem(id, { status: 'cancelled' });
      }
    }

    await Promise.allSettled(cleanups);
    this.checkAllDone();
  }

  /**
   * Reintenta únicamente los archivos con estado 'error',
   * preservando íntegramente sus títulos y metadatos editados.
   */
  public retryFailed(): Promise<BatchUploadSummary> {
    for (const [id, item] of this.items.entries()) {
      if (item.status === 'error') {
        this.updateItem(id, {
          status: 'idle',
          progress: 0,
          error: undefined,
          errorCode: undefined,
          retryCount: 0,
          fileId: undefined,
        });
      }
    }
    return this.start();
  }
}
