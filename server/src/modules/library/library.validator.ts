import crypto from 'crypto';
import { Readable } from 'stream';
import { LIBRARY_CONFIG, AllowedMimeType } from '../../config/library.config.js';

export interface StreamValidationResult {
  sha256: string;
  totalBytes: number;
  detectedMimeType: AllowedMimeType | null;
  hasDangerousPdfMarks: boolean;
  dangerousMarkFound?: string;
  isValid: boolean;
  error?: string;
}

/** Firmas binarias (magic numbers) requeridas al inicio del archivo */
const MAGIC_SIGNATURES: Record<AllowedMimeType, (header: Buffer) => boolean> = {
  'application/pdf': (buf) => buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/jpeg': (buf) =>
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/png': (buf) =>
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a,
  'image/webp': (buf) =>
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP',
};

/** Marcas y acciones potencialmente peligrosas en especificación PDF */
const DANGEROUS_PDF_MARKS = [
  '/JavaScript',
  '/JS',
  '/Launch',
  '/EmbeddedFile',
  '/OpenAction',
] as const;

/**
 * Valida un archivo leyendo su flujo en partes (streaming) con límite de tiempo y bajo consumo de memoria.
 * Calcula el hash SHA-256 en tiempo real y detecta firmas maliciosas en documentos PDF.
 */
export async function validateFileStream(
  stream: NodeJS.ReadableStream,
  declaredMimeType: AllowedMimeType,
  declaredSizeBytes: number
): Promise<StreamValidationResult> {
  const hash = crypto.createHash('sha256');
  let totalBytes = 0;
  let headerBuffer = Buffer.alloc(0);
  let tailBuffer = Buffer.alloc(0);
  let hasDangerousPdfMarks = false;
  let dangerousMarkFound: string | undefined;

  const isPdf = declaredMimeType === 'application/pdf';

  return new Promise<StreamValidationResult>((resolve, reject) => {
    let completed = false;

    // Límite de tiempo estricto para evitar ataques de DoS o streams lentos
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        if ('destroy' in stream && typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
        resolve({
          sha256: '',
          totalBytes,
          detectedMimeType: null,
          hasDangerousPdfMarks: false,
          isValid: false,
          error: 'Tiempo de validación del archivo excedido (timeout).',
        });
      }
    }, LIBRARY_CONFIG.STREAMING_TIMEOUT_MS);

    stream.on('data', (chunk: Buffer | string) => {
      if (completed) return;

      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      hash.update(buf);

      // Guardar primeros 64 bytes para verificación de magic numbers
      if (headerBuffer.length < 64) {
        headerBuffer = Buffer.from(Buffer.concat([headerBuffer, buf]).subarray(0, 64));
      }

      // Si es PDF, escanear en streaming buscando marcas peligrosas
      if (isPdf) {
        // Concatenar el remanente del chunk anterior para no perder palabras cortadas entre chunks
        const combined = tailBuffer.length > 0 ? Buffer.concat([tailBuffer, buf]) : buf;
        const combinedStr = combined.toString('latin1');

        for (const mark of DANGEROUS_PDF_MARKS) {
          if (combinedStr.includes(mark)) {
            hasDangerousPdfMarks = true;
            dangerousMarkFound = mark;
            break;
          }
        }

        // Mantener últimos 64 bytes para el siguiente chunk
        tailBuffer = Buffer.from(buf.subarray(Math.max(0, buf.length - 64)));
      }
    });

    stream.on('end', () => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);

      const calculatedSha256 = hash.digest('hex');

      // 1. Validar que el magic number corresponda con el tipo MIME declarado
      const validator = MAGIC_SIGNATURES[declaredMimeType];
      if (!validator || !validator(headerBuffer)) {
        return resolve({
          sha256: calculatedSha256,
          totalBytes,
          detectedMimeType: null,
          hasDangerousPdfMarks,
          isValid: false,
          error: `El contenido real del archivo no coincide con la firma requerida para ${declaredMimeType}.`,
        });
      }

      // 2. Validar marcas peligrosas en PDF
      if (isPdf && hasDangerousPdfMarks) {
        return resolve({
          sha256: calculatedSha256,
          totalBytes,
          detectedMimeType: declaredMimeType,
          hasDangerousPdfMarks: true,
          dangerousMarkFound,
          isValid: false,
          error: `El documento PDF contiene elementos ejecutables o scripts no permitidos (${dangerousMarkFound}).`,
        });
      }

      // 3. Validar coincidencia de tamaño
      if (totalBytes !== declaredSizeBytes) {
        return resolve({
          sha256: calculatedSha256,
          totalBytes,
          detectedMimeType: declaredMimeType,
          hasDangerousPdfMarks,
          isValid: false,
          error: `El tamaño real transferido (${totalBytes} bytes) difiere del declarado (${declaredSizeBytes} bytes).`,
        });
      }

      resolve({
        sha256: calculatedSha256,
        totalBytes,
        detectedMimeType: declaredMimeType,
        hasDangerousPdfMarks: false,
        isValid: true,
      });
    });

    stream.on('error', (err) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Sanitiza texto de títulos y descripciones:
 * Elimina tags HTML, normaliza espacios y trunca a la longitud máxima.
 */
export function sanitizeLibraryText(text: string, maxLength: number): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '') // Elimina etiquetas HTML
    .replace(/[\r\n\t]+/g, ' ') // Normaliza saltos de línea y tabulaciones
    .trim()
    .slice(0, maxLength);
}

/**
 * Filtro preventivo básico de insultos graves o PII obvia
 */
export function checkLibraryProfanity(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const prohibited = ['hdp', 'pelotudo', 'mierda', 'estafador', 'puto', 'forro'];
  return prohibited.some((w) => lower.includes(w));
}

