import { db } from '../../db/index.js';
import { adminAuditLog } from '../../db/schema.js';

export interface LogAdminActionOptions {
  tx?: any;
  adminUserId?: string | null;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetEmail?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'reauthtoken',
  'secret',
  'jwt_secret',
  'code',
  'codehash',
  'code_hash',
  'authorization',
  'cookie',
  'cookies',
]);

function sanitizeDetails(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(sanitizeDetails);
  }

  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const lowerKey = k.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(lowerKey)) {
      cleaned[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      cleaned[k] = sanitizeDetails(v);
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

/**
 * Registra una acción administrativa en admin_audit_log de forma inmutable.
 * Puede operar dentro de una transacción activa o con la conexión global.
 */
export async function logAdminAction(options: LogAdminActionOptions): Promise<void> {
  const runner = options.tx || db;
  // Copia permanente de emails dentro de details para preservar el contexto si una cuenta se elimina (Punto 2)
  const detailsWithEmails: Record<string, unknown> = {
    ...options.details,
    adminEmail: options.adminEmail,
    ...(options.targetEmail ? { targetEmail: options.targetEmail } : {}),
  };
  const sanitized = sanitizeDetails(detailsWithEmails);

  try {
    await runner.insert(adminAuditLog).values({
      adminUserId: options.adminUserId || null,
      adminEmail: options.adminEmail,
      action: options.action,
      targetType: options.targetType,
      targetId: options.targetId || null,
      targetEmail: options.targetEmail || null,
      details: sanitized,
      ip: options.ip || null,
    });
  } catch (err) {
    console.error(`[AUDIT ERROR] No se pudo escribir registro de auditoría "${options.action}":`, err);
  }
}

