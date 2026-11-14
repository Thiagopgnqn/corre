import path from 'path';
import { Worker } from 'node:worker_threads';
import {
  PLAN_IMPORT_MAX_BYTES,
  PLAN_IMPORT_WORKER_TIMEOUT_MS,
} from './planImport.rules.js';
import type { ParsePlanWorkbookResult, PlanImportIssue } from './planImport.types.js';

export class PlanImportConcurrencyError extends Error {
  readonly statusCode = 409;
  readonly code = 'PLAN_IMPORT_IN_PROGRESS';

  constructor(message = 'Ya hay una importación o vista previa de plan en curso. Esperá a que termine e intentá de nuevo.') {
    super(message);
    this.name = 'PlanImportConcurrencyError';
  }
}

export class PlanImportTimeoutError extends Error {
  readonly statusCode = 408;
  readonly code = 'PLAN_IMPORT_TIMEOUT';

  constructor(timeoutMs: number) {
    super(`El procesamiento del archivo .xlsx superó el límite de ${timeoutMs} ms y fue cancelado.`);
    this.name = 'PlanImportTimeoutError';
  }
}

let activePlanImportOperation = false;

/**
 * Enforces a global concurrency limit of 1 active plan import / preview at a time.
 */
export async function withPlanImportLock<T>(fn: () => Promise<T>): Promise<T> {
  if (activePlanImportOperation) {
    throw new PlanImportConcurrencyError();
  }
  activePlanImportOperation = true;
  try {
    return await fn();
  } finally {
    activePlanImportOperation = false;
  }
}

export function isPlanImportLocked(): boolean {
  return activePlanImportOperation;
}

const ZIP_LOCAL_HEADER_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

export function hasZipMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return (
    buffer[0] === ZIP_LOCAL_HEADER_MAGIC[0] &&
    buffer[1] === ZIP_LOCAL_HEADER_MAGIC[1] &&
    buffer[2] === ZIP_LOCAL_HEADER_MAGIC[2] &&
    buffer[3] === ZIP_LOCAL_HEADER_MAGIC[3]
  );
}

export function hasRawZipVbaMacroArtifact(buffer: Buffer): boolean {
  // OOXML macro-enabled parts consistently contain xl/vbaProject.bin or vbaProject.bin in headers/entries.
  return buffer.toString('latin1').toLowerCase().includes('vbaproject.bin');
}

function makeFailedParseResult(errors: PlanImportIssue[]): ParsePlanWorkbookResult {
  return {
    valid: false,
    errors,
    warnings: [],
    stats: {
      sheetCount: 0,
      totalRowsProcessed: 0,
      subjectsCount: 0,
      coreSubjectsCount: 0,
      electiveSubjectsCount: 0,
      prerequisitesCount: 0,
      specialRulesCount: 0,
      acronymsCount: 0,
      maxLevel: 0,
    },
    data: null,
  };
}

export interface ParsePlanWorkbookOptions {
  fileName: string;
  buffer: Buffer;
  /** Internal callers already inside `withPlanImportLock` can set true to avoid re-entering the mutex. */
  lockAlreadyHeld?: boolean;
  timeoutMs?: number;
  artificialWorkerDelayMs?: number;
}

function resolveWorkerSpec(): { workerUrl: URL; execArgv: string[] } {
  const isTsRuntime = import.meta.url.endsWith('.ts');
  const workerUrl = new URL(
    isTsRuntime ? './planImport.worker.ts' : './planImport.worker.js',
    import.meta.url
  );
  if (!isTsRuntime) {
    return { workerUrl, execArgv: [] };
  }

  // When running under tsx, preserve preflight/import flags while stripping inline --eval/-e flags if any.
  const filteredExecArgv: string[] = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i];
    if (arg === '--eval' || arg === '-e') {
      i++;
      continue;
    }
    if (arg.startsWith('--eval=') || arg.startsWith('-e=')) {
      continue;
    }
    filteredExecArgv.push(arg);
  }
  return { workerUrl, execArgv: filteredExecArgv };
}

function executeInIsolatedWorker(
  buffer: Buffer,
  timeoutMs: number,
  artificialDelayMs?: number
): Promise<ParsePlanWorkbookResult> {
  return new Promise((resolve, reject) => {
    const { workerUrl, execArgv } = resolveWorkerSpec();
    const worker = new Worker(workerUrl, {
      workerData: {
        fileBytes: new Uint8Array(buffer),
        ...(artificialDelayMs ? { artificialDelayMs } : {}),
      },
      env: {}, // Isolate worker completely from process secrets (DATABASE_URL, JWT_SECRET, etc.)
      execArgv,
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32,
      },
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => undefined);
      reject(new PlanImportTimeoutError(timeoutMs));
    }, timeoutMs);
    timer.unref?.();

    worker.once('message', (msg: ParsePlanWorkbookResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.unref();
      resolve(msg);
    });

    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => undefined);
      reject(err);
    });

    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`El worker de importación finalizó inesperadamente (código ${code}).`));
      }
    });
  });
}

/**
 * Validates pre-conditions (.xlsx extension, <= 5 MB, ZIP PK signature, no raw VBA project)
 * and executes Excel parsing inside an isolated Worker thread with memory limits, no secrets,
 * strict timeout and global single-flight concurrency lock.
 */
export async function parsePlanWorkbookBuffer(
  options: ParsePlanWorkbookOptions
): Promise<ParsePlanWorkbookResult> {
  const cleanName = path.basename(options.fileName || '').trim();
  if (!cleanName.toLowerCase().endsWith('.xlsx')) {
    return makeFailedParseResult([
      {
        sheet: 'Archivo',
        row: 0,
        message: 'Solo se admiten archivos con extensión .xlsx.',
      },
    ]);
  }

  if (!Buffer.isBuffer(options.buffer) || options.buffer.length === 0) {
    return makeFailedParseResult([
      {
        sheet: 'Archivo',
        row: 0,
        message: 'El archivo está vacío o es inválido.',
      },
    ]);
  }

  if (options.buffer.length > PLAN_IMPORT_MAX_BYTES) {
    return makeFailedParseResult([
      {
        sheet: 'Archivo',
        row: 0,
        message: `El archivo supera el tamaño máximo permitido de ${Math.round(PLAN_IMPORT_MAX_BYTES / (1024 * 1024))} MB.`,
      },
    ]);
  }

  if (!hasZipMagicBytes(options.buffer)) {
    return makeFailedParseResult([
      {
        sheet: 'Archivo',
        row: 0,
        message: 'El archivo no tiene una firma ZIP/OOXML válida (se esperaba cabecera PK).',
      },
    ]);
  }

  if (hasRawZipVbaMacroArtifact(options.buffer)) {
    return makeFailedParseResult([
      {
        sheet: 'Archivo',
        row: 0,
        message: 'Se detectaron artefactos de macros VBA (vbaProject.bin) no permitidos.',
      },
    ]);
  }

  const timeoutMs = options.timeoutMs ?? PLAN_IMPORT_WORKER_TIMEOUT_MS;
  const runParse = () =>
    executeInIsolatedWorker(options.buffer, timeoutMs, options.artificialWorkerDelayMs);

  if (options.lockAlreadyHeld) {
    return runParse();
  }
  return withPlanImportLock(runParse);
}
