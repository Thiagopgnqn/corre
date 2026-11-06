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
    // Si no coincide con palabras clave específicas, por omisión en biblioteca UTN
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
  onOverallProgress?: (stats: {
    totalBytes: number;
    uploadedBytes: number;
    percent: number;
    completedCount: number;
    totalCount: number;
  }) => void;
}

export class UploadQueueCoordinator {
  private maxConcurrentPuts: number;
  private maxConcurrentCompletes: number;
  private maxRetries: number;
  private backoffDelays: number[];
  private api: NonNullable<UploadQueueCoordinatorOptions['api']>;
  private onItemChange?: (item: BatchFileItem) => void;
  private onOverallProgress?: UploadQueueCoordinatorOptions['onOverallProgress'];

  private items: Map<string, BatchFileItem> = new Map();
  private subjectId: string = '';
  private activePuts = 0;
  private activeCompletes = 0;
  private isProcessing = false;
  private isCancelledAll = false;

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
  }

  public setQueue(items: BatchFileItem[], subjectId: string): void {
    this.subjectId = subjectId;
    this.items.clear();
    for (const item of items) {
      this.items.set(item.id, { ...item });
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
    const code = err?.code || '';
    if (status === 429 || status === 503) return true;
    if (code === 'STORAGE_NETWORK_ERROR' || code === 'FETCH_ERROR') return true;
    if (err?.message && /network|fetch|timeout|cors|temporarily unavailable/i.test(err.message)) {
      return true;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, ms));
  }

  private updateItem(id: string, patch: Partial<BatchFileItem>): BatchFileItem {
    const current = this.items.get(id);
    if (!current) throw new Error(`Item ${id} no encontrado`);
    const updated = { ...current, ...patch };
    this.items.set(id, updated);
    if (this.onItemChange) {
      this.onItemChange(updated);
    }
    this.notifyOverall();
    return updated;
  }

  private notifyOverall(): void {
    if (!this.onOverallProgress) return;
    const all = Array.from(this.items.values());
    const totalCount = all.length;
    let completedCount = 0;
    let totalBytes = 0;
    let uploadedBytes = 0;

    for (const it of all) {
      const sz = it.file.size;
      totalBytes += sz;
      if (it.status === 'done') {
        completedCount++;
        uploadedBytes += sz;
      } else if (it.status === 'uploading' || it.status === 'completing') {
        uploadedBytes += (sz * (it.progress || 0)) / 100;
      }
    }

    const percent = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
    this.onOverallProgress({
      totalBytes,
      uploadedBytes: Math.round(uploadedBytes),
      percent,
      completedCount,
      totalCount,
    });
  }

  /**
   * Inicia el procesamiento ordenado de la cola respetando los límites de concurrencia.
   */
  public async start(): Promise<void> {
    this.isCancelledAll = false;
    this.isProcessing = true;
    await this.pumpQueue();
  }

  private async pumpQueue(): Promise<void> {
    if (this.isCancelledAll) return;

    // Busca ítems 'idle' mientras haya cupo para PUT (max 3 concurrentes)
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
      // Lanzamos la subida individual sin await para permitir concurrencia
      this.processItem(nextItem.id).finally(() => {
        this.activePuts--;
        this.checkAllDone();
        this.pumpQueue();
      });
    }

    this.checkAllDone();
  }

  private checkAllDone(): void {
    const all = Array.from(this.items.values());
    const pending = all.some((it) => ['idle', 'init', 'uploading', 'completing'].includes(it.status));
    if (!pending && this.activePuts === 0 && this.activeCompletes === 0) {
      this.isProcessing = false;
    }
  }

  private async processItem(id: string): Promise<void> {
    let item = this.items.get(id);
    if (!item || item.status !== 'idle' || this.isCancelledAll) return;

    const controller = new AbortController();
    item = this.updateItem(id, {
      abortController: controller,
      error: undefined,
      errorCode: undefined,
    });

    let attempt = item.retryCount;
    let success = false;

    while (attempt <= this.maxRetries && !success && !this.isCancelledAll) {
      if (controller.signal.aborted) {
        this.updateItem(id, { status: 'cancelled' });
        return;
      }

      try {
        // PASO 1: Init Just-In-Time
        this.updateItem(id, { status: 'init', progress: 5 });

        const mimeType =
          item.file.type ||
          (item.file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

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

        const { fileId, uploadUrl } = initRes.data;
        item = this.updateItem(id, { fileId, status: 'uploading', progress: 10 });

        if (controller.signal.aborted) {
          await this.cleanUpFileOnServer(fileId);
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

        if (controller.signal.aborted) {
          await this.cleanUpFileOnServer(fileId);
          this.updateItem(id, { status: 'cancelled' });
          return;
        }

        // PASO 3: Esperar turno para Complete (máximo 2 concurrentes)
        item = this.updateItem(id, { status: 'completing', progress: 88 });
        await this.waitForCompleteSlot();

        if (controller.signal.aborted) {
          this.activeCompletes--;
          await this.cleanUpFileOnServer(fileId);
          this.updateItem(id, { status: 'cancelled' });
          return;
        }

        try {
          await this.api.completeUpload(fileId);
          success = true;
          this.updateItem(id, { status: 'done', progress: 100 });
        } finally {
          this.activeCompletes--;
        }
      } catch (err: any) {
        if (controller.signal.aborted) {
          if (item?.fileId) {
            await this.cleanUpFileOnServer(item.fileId);
          }
          this.updateItem(id, { status: 'cancelled' });
          return;
        }

        attempt++;
        const isRetriable = this.isRetriableError(err);

        if (isRetriable && attempt <= this.maxRetries && !this.isCancelledAll) {
          const delayIndex = Math.min(attempt - 1, this.backoffDelays.length - 1);
          const delayMs = this.backoffDelays[delayIndex] ?? 1000;
          this.updateItem(id, {
            retryCount: attempt,
            error: `Reintentando en ${(delayMs / 1000).toFixed(0)}s (intento ${attempt}/${this.maxRetries})...`,
          });
          await this.sleep(delayMs);
        } else {
          // Error definitivo
          const msg =
            err?.code === 'DUPLICATE_FILE'
              ? 'Este archivo ya se encuentra en la biblioteca (duplicado detectado por firma SHA-256).'
              : err?.code === 'LIMIT_STORAGE_QUOTA' || err?.code === 'QUOTA_EXCEEDED'
              ? 'Superaste tu cuota de almacenamiento disponible.'
              : err?.code === 'LIMIT_PENDING_UPLOADS'
              ? 'Alcanzaste el cupo máximo de 30 aportes en revisión.'
              : err?.message || 'Error al procesar el archivo.';

          this.updateItem(id, {
            status: 'error',
            error: msg,
            errorCode: err?.code,
            retryCount: attempt,
          });
          return;
        }
      }
    }
  }

  private async waitForCompleteSlot(): Promise<void> {
    while (this.activeCompletes >= this.maxConcurrentCompletes) {
      await this.sleep(50);
    }
    this.activeCompletes++;
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
   * Cancela un archivo individual. Si ya tenía fileId en el backend,
   * llama a DELETE /api/library/my-uploads/:id en segundo plano.
   */
  public async cancelItem(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;

    if (item.abortController) {
      item.abortController.abort();
    }

    const fileId = item.fileId;
    this.updateItem(id, { status: 'cancelled' });

    if (fileId) {
      await this.cleanUpFileOnServer(fileId);
    }
    this.pumpQueue();
  }

  /**
   * Cancela la totalidad de la cola de subidas.
   */
  public async cancelAll(): Promise<void> {
    this.isCancelledAll = true;
    const cleanups: Promise<void>[] = [];

    for (const [id, item] of this.items.entries()) {
      if (['init', 'uploading', 'completing', 'idle'].includes(item.status)) {
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
    this.isProcessing = false;
  }

  /**
   * Reintenta únicamente los archivos con estado 'error' o 'cancelled',
   * preservando íntegramente sus títulos y metadatos editados.
   */
  public retryFailed(): void {
    for (const [id, item] of this.items.entries()) {
      if (item.status === 'error' || item.status === 'cancelled') {
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
    this.start();
  }
}
