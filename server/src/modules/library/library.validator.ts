import crypto from 'crypto';
import { Readable } from 'stream';
import { LIBRARY_CONFIG, AllowedMimeType } from '../../config/library.config.js';
import { PdfSecurityScanner, type PdfScanResult } from './pdfSecurityScanner.js';

export interface StreamValidationResult {
  sha256: string;
  totalBytes: number;
  detectedMimeType: AllowedMimeType | null;
  hasDangerousPdfMarks: boolean;
  dangerousMarkFound?: string;
  technicalReason?: string;
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

/**
 * Valida un archivo leyendo su flujo en partes (streaming) con límite de tiempo y bajo consumo de memoria.
 * Calcula el hash SHA-256 en tiempo real e inspecciona estructuralmente documentos PDF (fail-closed).
 */
export async function validateFileStream(
  stream: NodeJS.ReadableStream,
  declaredMimeType: AllowedMimeType,
  declaredSizeBytes: number
): Promise<StreamValidationResult> {
  const hash = crypto.createHash('sha256');
  let totalBytes = 0;
  let headerBuffer = Buffer.alloc(0);

  const isPdf = declaredMimeType === 'application/pdf';
  const pdfScanner = isPdf ? new PdfSecurityScanner() : null;
  let pendingMagicChunks: Buffer[] = [];
  let pendingMagicBytes = 0;
  let pdfHeaderVerified: boolean | null = null;

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

      // Si es PDF y tiene firma válida, alimentar el escáner estructural en streaming
      if (isPdf && pdfScanner) {
        if (pdfHeaderVerified === true) {
          pdfScanner.feed(buf);
        } else if (pdfHeaderVerified === null) {
          if (pendingMagicChunks.length === 0 && buf.length >= 5) {
            pdfHeaderVerified = MAGIC_SIGNATURES['application/pdf'](buf);
            if (pdfHeaderVerified) {
              pdfScanner.feed(buf);
            }
          } else if (buf.length > 0) {
            pendingMagicChunks.push(buf);
            pendingMagicBytes += buf.length;
            if (pendingMagicBytes >= 5) {
              const initial = Buffer.concat(pendingMagicChunks);
              pendingMagicChunks = [];
              pdfHeaderVerified = MAGIC_SIGNATURES['application/pdf'](initial);
              if (pdfHeaderVerified) {
                pdfScanner.feed(initial);
              }
            }
          }
        }
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
          hasDangerousPdfMarks: false,
          isValid: false,
          error: `El contenido real del archivo no coincide con la firma requerida para ${declaredMimeType}.`,
        });
      }

      // 2. Validar seguridad estructural en PDF (fail-closed)
      if (isPdf) {
        let scanResult: PdfScanResult;
        try {
          scanResult = pdfScanner
            ? pdfScanner.finish()
            : {
                isSafe: false,
                category: 'unverifiable',
                reasonCode: 'MISSING_SCANNER',
                userMessage:
                  'No pudimos verificar la seguridad de este PDF. Volvé a exportarlo o imprimilo a PDF desde tu navegador y subilo de nuevo.',
              };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unexpected validator error';
          scanResult = {
            isSafe: false,
            category: 'unverifiable',
            reasonCode: 'VALIDATOR_EXCEPTION',
            technicalDetail: msg,
            userMessage:
              'No pudimos verificar la seguridad de este PDF. Volvé a exportarlo o imprimilo a PDF desde tu navegador y subilo de nuevo.',
          };
        }

        if (!scanResult.isSafe) {
          const reasonCode = scanResult.reasonCode ?? 'UNVERIFIABLE_PDF';
          const technicalDetail = scanResult.technicalDetail;
          const technicalReason = technicalDetail
            ? `${reasonCode} (${technicalDetail})`
            : reasonCode;

          console.warn(
            `[LibraryValidator] PDF rechazado: categoria=${scanResult.category ?? 'unverifiable'} motivo=${reasonCode} detalle=${technicalDetail ?? 'n/a'} bytes=${totalBytes}`
          );

          return resolve({
            sha256: calculatedSha256,
            totalBytes,
            detectedMimeType: declaredMimeType,
            hasDangerousPdfMarks: scanResult.category === 'dangerous',
            dangerousMarkFound: technicalDetail,
            technicalReason,
            isValid: false,
            error:
              scanResult.userMessage ||
              'No pudimos verificar la seguridad de este PDF. Volvé a exportarlo o imprimilo a PDF desde tu navegador y subilo de nuevo.',
          });
        }
      }

      // 3. Validar coincidencia de tamaño
      if (totalBytes !== declaredSizeBytes) {
        return resolve({
          sha256: calculatedSha256,
          totalBytes,
          detectedMimeType: declaredMimeType,
          hasDangerousPdfMarks: false,
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

