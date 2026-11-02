import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { env } from '../config/env.js';
import { LIBRARY_CONFIG } from '../config/library.config.js';

export interface PresignedUploadParams {
  key: string;
  mimeType: string;
  sizeBytes: number;
  expiresInSeconds?: number;
}

export interface PresignedDownloadParams {
  key: string;
  filename: string;
  mimeType: string;
  expiresInSeconds?: number;
}

export interface HeadObjectResult {
  exists: boolean;
  sizeBytes: number;
  mimeType: string;
}

export interface StorageTestResult {
  success: boolean;
  isMock: boolean;
  steps: {
    upload: { ok: boolean; message: string };
    read: { ok: boolean; message: string };
    delete: { ok: boolean; message: string };
  };
  errorStep?: 'upload' | 'read' | 'delete';
  message: string;
}

export interface IR2StorageService {
  getPresignedUploadUrl(params: PresignedUploadParams): Promise<string>;
  getPresignedDownloadUrl(params: PresignedDownloadParams): Promise<string>;
  headObject(key: string): Promise<HeadObjectResult>;
  getObjectStream(key: string): Promise<NodeJS.ReadableStream>;
  deleteObject(key: string): Promise<boolean>;
  testConnection(): Promise<StorageTestResult>;
  // Métodos auxiliares para testing
  putObjectDirect?(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  hasObjectDirect?(key: string): boolean;
}

/**
 * Implementación de almacenamiento Cloudflare R2 vía API compatible con S3.
 * Utiliza presigned URLs con restricciones estrictas de tipo y tamaño.
 * Configura requestChecksumCalculation y responseChecksumValidation en 'WHEN_REQUIRED'
 * para compatibilidad total con Cloudflare R2.
 */
export class CloudflareR2Service implements IR2StorageService {
  private client: S3Client;
  private bucket: string;

  constructor(accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string) {
    this.bucket = bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async getPresignedUploadUrl(params: PresignedUploadParams): Promise<string> {
    const expiresIn = params.expiresInSeconds || LIBRARY_CONFIG.PRESIGNED_PUT_EXPIRES_SECONDS;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.mimeType,
      ContentLength: params.sizeBytes,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getPresignedDownloadUrl(params: PresignedDownloadParams): Promise<string> {
    const expiresIn = params.expiresInSeconds || LIBRARY_CONFIG.PRESIGNED_GET_EXPIRES_SECONDS;
    const safeFilename = params.filename.replace(/["\r\n\\]/g, '_');

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(safeFilename)}"`,
      ResponseContentType: params.mimeType,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const res = await this.client.send(command);
      return {
        exists: true,
        sizeBytes: Number(res.ContentLength || 0),
        mimeType: res.ContentType || 'application/octet-stream',
      };
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return { exists: false, sizeBytes: 0, mimeType: '' };
      }
      throw err;
    }
  }

  async getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const res = await this.client.send(command);
    if (!res.Body) {
      throw new Error(`Cuerpo vacío al obtener objeto R2: ${key}`);
    }
    return res.Body as NodeJS.ReadableStream;
  }

  async deleteObject(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (err) {
      console.warn(`[R2] Error al eliminar objeto ${key}:`, err);
      return false;
    }
  }

  async putObjectDirect(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ContentLength: buffer.length,
    });
    await this.client.send(command);
  }

  async testConnection(): Promise<StorageTestResult> {
    const testKey = `_healthcheck/probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const testPayload = Buffer.from(`Stack R2 Health Probe ${new Date().toISOString()}`, 'utf-8');
    const steps: StorageTestResult['steps'] = {
      upload: { ok: false, message: 'Pendiente' },
      read: { ok: false, message: 'Pendiente' },
      delete: { ok: false, message: 'Pendiente' },
    };

    // Paso 1: Subida de prueba
    try {
      const putCommand = new PutObjectCommand({
        Bucket: this.bucket,
        Key: testKey,
        Body: testPayload,
        ContentType: 'text/plain; charset=utf-8',
        ContentLength: testPayload.length,
      });
      await this.client.send(putCommand);
      steps.upload = { ok: true, message: `Subida exitosa de objeto de prueba (${testPayload.length} bytes).` };
    } catch (err: any) {
      steps.upload = { ok: false, message: `Fallo al subir objeto de prueba: ${err.message || String(err)}` };
      return {
        success: false,
        isMock: false,
        steps,
        errorStep: 'upload',
        message: 'No se pudo subir el archivo de prueba a Cloudflare R2. Verificá permisos de escritura y credenciales.',
      };
    }

    // Paso 2: Lectura / Comprobación
    try {
      const head = await this.headObject(testKey);
      if (!head.exists || head.sizeBytes !== testPayload.length) {
        throw new Error(`Objeto no verificado (existe: ${head.exists}, tamaño: ${head.sizeBytes})`);
      }
      steps.read = { ok: true, message: `Lectura y verificación de metadatos HEAD correcta (${head.sizeBytes} bytes).` };
    } catch (err: any) {
      steps.read = { ok: false, message: `Fallo al leer objeto de prueba: ${err.message || String(err)}` };
      // Limpieza de contingencia
      await this.deleteObject(testKey);
      return {
        success: false,
        isMock: false,
        steps,
        errorStep: 'read',
        message: 'El objeto fue subido pero falló la verificación de lectura en Cloudflare R2.',
      };
    }

    // Paso 3: Borrado
    try {
      const deleted = await this.deleteObject(testKey);
      if (!deleted) {
        throw new Error('El comando DeleteObject reportó fallo.');
      }
      steps.delete = { ok: true, message: 'Eliminación del objeto de prueba completada con éxito.' };
    } catch (err: any) {
      steps.delete = { ok: false, message: `Fallo al eliminar objeto de prueba: ${err.message || String(err)}` };
      return {
        success: false,
        isMock: false,
        steps,
        errorStep: 'delete',
        message: 'El objeto fue subido y leído, pero falló la eliminación. Verificá permisos de borrado.',
      };
    }

    return {
      success: true,
      isMock: false,
      steps,
      message: 'Conexión y permisos con Cloudflare R2 verificados correctamente (subida, lectura y borrado).',
    };
  }
}

/**
 * Simulador de R2 en memoria para desarrollo local y tests automatizados.
 * Permite ejecutar validaciones completas de streaming, magic numbers y cuotas sin costos de red.
 */
export class MemoryMockR2Service implements IR2StorageService {
  private storage = new Map<string, { buffer: Buffer; mimeType: string; sizeBytes: number }>();

  async getPresignedUploadUrl(params: PresignedUploadParams): Promise<string> {
    return `https://mock-r2.local/upload/${encodeURIComponent(params.key)}?expires=${params.expiresInSeconds || 600}&ct=${encodeURIComponent(params.mimeType)}&cl=${params.sizeBytes}`;
  }

  async getPresignedDownloadUrl(params: PresignedDownloadParams): Promise<string> {
    return `https://mock-r2.local/download/${encodeURIComponent(params.key)}?file=${encodeURIComponent(params.filename)}&expires=${params.expiresInSeconds || 300}`;
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    const item = this.storage.get(key);
    if (!item) {
      return { exists: false, sizeBytes: 0, mimeType: '' };
    }
    return {
      exists: true,
      sizeBytes: item.sizeBytes,
      mimeType: item.mimeType,
    };
  }

  async getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    const item = this.storage.get(key);
    if (!item) {
      throw new Error(`Objeto simulado no encontrado: ${key}`);
    }
    return Readable.from(item.buffer);
  }

  async deleteObject(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  async putObjectDirect(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    this.storage.set(key, {
      buffer,
      mimeType,
      sizeBytes: buffer.length,
    });
  }

  hasObjectDirect(key: string): boolean {
    return this.storage.has(key);
  }

  clear(): void {
    this.storage.clear();
  }

  async testConnection(): Promise<StorageTestResult> {
    const testKey = `_healthcheck/probe-mock-${Date.now()}.txt`;
    const testPayload = Buffer.from('Stack Mock R2 Probe OK', 'utf-8');

    await this.putObjectDirect(testKey, testPayload, 'text/plain');
    const head = await this.headObject(testKey);
    const readOk = head.exists && head.sizeBytes === testPayload.length;
    await this.deleteObject(testKey);

    return {
      success: readOk,
      isMock: true,
      steps: {
        upload: { ok: true, message: 'Subida simulada en memoria exitosa.' },
        read: { ok: readOk, message: 'Lectura simulada en memoria exitosa.' },
        delete: { ok: true, message: 'Eliminación simulada en memoria exitosa.' },
      },
      message: 'Simulador en memoria de almacenamiento activo (entorno local / tests). Todas las operaciones operativas.',
    };
  }
}

let activeR2Service: IR2StorageService | null = null;

export function getR2Service(): IR2StorageService {
  if (activeR2Service) return activeR2Service;

  if (
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET
  ) {
    activeR2Service = new CloudflareR2Service(
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.R2_BUCKET
    );
  } else {
    // Mock transparente en desarrollo o entorno de test sin credenciales de R2
    activeR2Service = new MemoryMockR2Service();
  }

  return activeR2Service;
}

export function setR2ServiceForTesting(service: IR2StorageService | null): void {
  activeR2Service = service;
}
