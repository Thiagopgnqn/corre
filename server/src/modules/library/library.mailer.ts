import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { users, userSettings, libraryFiles, subjects } from '../../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { defaultMailer } from '../mailer/mailer.service.js';
import { LIBRARY_CONFIG } from '../../config/library.config.js';

// ---------------------------------------------------------------------------
// 1. Sanitización y Escape de Seguridad
// ---------------------------------------------------------------------------

/**
 * Escapa caracteres especiales en HTML para prevenir ataques XSS o inyección HTML.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Elimina saltos de línea (\r, \n) de los asuntos para prevenir Email Header Injection.
 */
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 2. Control de Tasa (Rate Limiting) y Resumen Horario en Memoria
// ---------------------------------------------------------------------------

interface HourlyAdminTracker {
  windowStart: number;
  count: number;
  lastSummarySentAt: number;
}

const adminHourlyTracker: HourlyAdminTracker = {
  windowStart: Date.now(),
  count: 0,
  lastSummarySentAt: 0,
};

interface DailyUserTracker {
  dayStart: number;
  count: number;
}

const userDailyTracker: DailyUserTracker = {
  dayStart: new Date().setUTCHours(0, 0, 0, 0),
  count: 0,
};

/** Registro en memoria para inspección en tests */
export interface SentNotificationLog {
  type: 'admin_pending' | 'admin_summary' | 'uploader_approved' | 'uploader_rejected';
  to: string[];
  subject: string;
  html: string;
  text: string;
  fileId?: string;
  timestamp: Date;
}

export const mockSentNotifications: SentNotificationLog[] = [];

export function clearMockSentNotifications(): void {
  mockSentNotifications.length = 0;
  adminHourlyTracker.count = 0;
  adminHourlyTracker.lastSummarySentAt = 0;
  userDailyTracker.count = 0;
}

// ---------------------------------------------------------------------------
// 3. Destinatarios de Administración
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Destinatarios Mock para Tests
// ---------------------------------------------------------------------------
let mockAdminRecipients: string[] | null = null;

export function setMockAdminRecipients(emails: string[] | null): void {
  mockAdminRecipients = emails;
}

/**
 * Obtiene la lista de emails de administración para avisos.
 * Prioriza ADMIN_NOTIFICATION_EMAIL (separadas por coma); si no existe,
 * busca administradores activos y verificados en la base de datos.
 */
export async function getAdminNotificationRecipients(): Promise<string[]> {
  if (mockAdminRecipients && mockAdminRecipients.length > 0) {
    return mockAdminRecipients;
  }

  if (env.ADMIN_NOTIFICATION_EMAIL && env.ADMIN_NOTIFICATION_EMAIL.trim().length > 0) {
    const raw = env.ADMIN_NOTIFICATION_EMAIL.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (raw.length > 0) return Array.from(new Set(raw));
  }

  // Fallback: usuarios con role='admin', status='active' y email verificado
  try {
    const adminRows = await db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          eq(users.role, 'admin'),
          eq(users.status, 'active'),
          sql`${users.emailVerifiedAt} IS NOT NULL`
        )
      );

    return adminRows.map((r) => r.email.toLowerCase().trim()).filter(Boolean);
  } catch (err) {
    console.warn('[LibraryMailer] No se pudieron consultar admins en base de datos:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 4. Plantillas HTML y Texto Plano
// ---------------------------------------------------------------------------

const STACK_BRAND = {
  name: 'Stack',
  colorIndigo: '#4f46e5',
  colorDark: '#171A52',
  colorAmber: '#f59e0b',
  colorBg: '#0f172a',
  colorCard: '#1e293b',
  colorText: '#f8fafc',
  colorMuted: '#94a3b8',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Template (a): Aviso al Administrador sobre nuevo material para revisar.
 * REGLA ESTRICTA DE PRIVACIDAD: Nunca incluye el email ni la identidad del autor.
 */
export function buildAdminNewMaterialEmail(data: {
  title: string;
  subjectName: string;
  kind: string;
  academicYear?: number | null;
  term?: string | null;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
  pendingCount?: number;
}): { subject: string; html: string; text: string } {
  const safeTitle = escapeHtml(data.title);
  const safeSubject = escapeHtml(data.subjectName);
  const safeKind = escapeHtml(data.kind.toUpperCase());
  const yearTerm = [data.academicYear, data.term].filter(Boolean).join(' - ');
  const safeYearTerm = yearTerm ? escapeHtml(yearTerm) : 'No especificado';
  const sizeFormatted = formatBytes(data.sizeBytes);
  const dateFormatted = data.createdAt.toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' });
  const appOrigin = env.CLIENT_ORIGIN || 'https://corre-ten.vercel.app';
  const adminUrl = `${appOrigin}/#admin`;

  const subject = sanitizeSubject('Nuevo material para revisar en Stack');

  const text = `
Nuevo material para revisar en Stack
==================================================

Se ha subido un nuevo recurso a la Biblioteca y quedó en espera de moderación.

Detalles del archivo:
- Título: ${data.title}
- Materia: ${data.subjectName}
- Tipo: ${data.kind.toUpperCase()}
- Año / Cuatrimestre: ${yearTerm || 'No especificado'}
- Tamaño: ${sizeFormatted}
- Formato: ${data.mimeType}
- Fecha y hora: ${dateFormatted}

Ingresá al Panel de Administración de Stack para revisar la previsualización y aprobar o rechazar este material:
${adminUrl}

(La identidad del estudiante autor puede ser consultada con auditoría exclusivamente desde el panel).

--
Stack - Plataforma Colaborativa de Ingeniería en Sistemas
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden;">
    <tr>
      <td style="padding: 24px 28px; background: linear-gradient(135deg, #171A52 0%, #1e1b4b 100%); border-bottom: 1px solid #312e81;">
        <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">Stack</span>
        <span style="margin-left: 8px; font-size: 11px; font-weight: 700; background-color: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 8px; border-radius: 9999px;">Biblioteca • Moderación</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 28px;">
        <h1 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #ffffff;">Nuevo material pendiente de revisión</h1>
        <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.5; color: #cbd5e1;">
          Un estudiante aportó un nuevo archivo a la Biblioteca de Material de Estudio. Para que esté disponible en el catálogo público, requiere aprobación humana previa.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0b0f19; border: 1px solid #1f2937; border-radius: 12px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #94a3b8; width: 140px;">Título:</td>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; font-weight: 600; color: #ffffff;">${safeTitle}</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #94a3b8;">Materia:</td>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; font-weight: 600; color: #ffffff;">${safeSubject}</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #94a3b8;">Tipo de material:</td>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; font-weight: 600; color: #818cf8;">${safeKind}</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #94a3b8;">Año / Término:</td>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #cbd5e1;">${safeYearTerm}</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #94a3b8;">Tamaño:</td>
            <td style="padding: 14px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #cbd5e1;">${sizeFormatted} (${escapeHtml(data.mimeType)})</td>
          </tr>
          <tr>
            <td style="padding: 14px 16px; font-size: 13px; color: #94a3b8;">Fecha y hora:</td>
            <td style="padding: 14px 16px; font-size: 13px; color: #cbd5e1;">${dateFormatted}</td>
          </tr>
        </table>

        <p style="margin: 0 0 20px 0; font-size: 13px; line-height: 1.5; color: #94a3b8;">
          Podés inspeccionar la vista previa del documento, comprobar la resolución o descartar infracciones ingresando a la cola de moderación del panel:
        </p>

        <p style="margin: 0 0 24px 0; font-size: 13px; word-break: break-all; background-color: #0b0f19; padding: 12px 16px; border-radius: 8px; border: 1px solid #1f2937; font-family: monospace; color: #a5b4fc;">
          ${adminUrl}
        </p>

        <div style="background-color: rgba(30, 27, 75, 0.4); border-left: 3px solid #6366f1; padding: 10px 14px; border-radius: 4px; font-size: 12px; color: #a5b4fc;">
          <strong>Privacidad estudiantil:</strong> Los datos del autor se mantienen confidenciales y no se incluyen en este correo. Podés consultar la identidad de forma auditada desde el panel si fuera necesario.
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 16px 28px; background-color: #0b0f19; border-top: 1px solid #1f2937; font-size: 11px; color: #64748b; text-align: center;">
        Stack • Plataforma colaborativa para Ingeniería en Sistemas de Información (UTN FRC)
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Template (a-resumen): Resumen horario cuando se supera el tope de subidas.
 */
export function buildAdminHourlySummaryEmail(data: {
  pendingCount: number;
  newCountInHour: number;
}): { subject: string; html: string; text: string } {
  const subject = sanitizeSubject(`Nuevo material para revisar en Stack (${data.pendingCount} pendientes)`);
  const appOrigin = env.CLIENT_ORIGIN || 'https://corre-ten.vercel.app';
  const adminUrl = `${appOrigin}/#admin`;

  const text = `
Resumen de Moderación - Stack
==================================================

Se recibieron ${data.newCountInHour} nuevos archivos para moderar en la última hora.
Actualmente hay un total de ${data.pendingCount} materiales pendientes de revisión.

Revisá la cola de moderación en el panel de administración:
${adminUrl}

--
Stack - Plataforma Colaborativa de Ingeniería en Sistemas
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #f8fafc;">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 28px;">
    <tr>
      <td>
        <h1 style="font-size: 18px; color: #ffffff; margin-top: 0;">Resumen horario: ${data.pendingCount} archivos pendientes</h1>
        <p style="font-size: 14px; color: #cbd5e1; line-height: 1.5;">
          Se registraron ${data.newCountInHour} nuevas subidas en la última hora que superaron el límite de avisos individuales.
        </p>
        <p style="font-size: 13px; color: #94a3b8;">
          Ingresá a la cola de moderación para revisarlos:
        </p>
        <p style="font-family: monospace; background: #0b0f19; padding: 12px; border-radius: 8px; border: 1px solid #1f2937; color: #a5b4fc;">
          ${adminUrl}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Template (b): Aviso de aprobación al estudiante uploader.
 */
export function buildUploaderApprovedEmail(data: {
  title: string;
  subjectName: string;
}): { subject: string; html: string; text: string } {
  const safeTitle = escapeHtml(data.title);
  const safeSubject = escapeHtml(data.subjectName);
  const appOrigin = env.CLIENT_ORIGIN || 'https://corre-ten.vercel.app';
  const libraryUrl = `${appOrigin}/#library`;

  const subject = sanitizeSubject('Tu aporte fue aprobado en Stack');

  const text = `
¡Tu material ya está disponible en Stack!
==================================================

Hola:

El material que compartiste ha sido revisado y aprobado por el equipo de administración:

- Título: ${data.title}
- Materia: ${data.subjectName}

Ya se encuentra publicado en el catálogo público de la Biblioteca para que todos los estudiantes de la carrera puedan consultarlo y utilizarlo para estudiar.

Podés ingresar a la Biblioteca en cualquier momento:
${libraryUrl}

¡Muchas gracias por colaborar con la comunidad!

--
Stack - Tu carrera, materia a materia
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden;">
    <tr>
      <td style="padding: 24px 28px; background: linear-gradient(135deg, #171A52 0%, #1e1b4b 100%); border-bottom: 1px solid #312e81;">
        <span style="font-size: 20px; font-weight: 800; color: #ffffff;">Stack</span>
        <span style="margin-left: 8px; font-size: 11px; font-weight: 700; background-color: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 8px; border-radius: 9999px;">Aporte Aprobado</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 28px;">
        <h1 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #ffffff;">¡Tu material ya está disponible para toda la comunidad!</h1>
        <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
          Buenas noticias: el equipo de moderación revisó y aprobó el material que compartiste en la Biblioteca de Stack.
        </p>

        <div style="background-color: #0b0f19; border: 1px solid #1f2937; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
          <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #ffffff;">${safeTitle}</p>
          <p style="margin: 0; font-size: 13px; color: #818cf8;">Materia: <strong>${safeSubject}</strong></p>
        </div>

        <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; color: #94a3b8;">
          Tu aporte ayuda a cientos de estudiantes a preparar sus exámenes y avanzar en la carrera. Podés ver tus materiales publicados o consultar la Biblioteca aquí:
        </p>

        <p style="margin: 0 0 24px 0; font-size: 13px; word-break: break-all; background-color: #0b0f19; padding: 12px 16px; border-radius: 8px; border: 1px solid #1f2937; font-family: monospace; color: #a5b4fc;">
          ${libraryUrl}
        </p>

        <p style="margin: 0; font-size: 13px; color: #cbd5e1; font-weight: 600;">
          ¡Muchas gracias por colaborar con Stack!
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 16px 28px; background-color: #0b0f19; border-top: 1px solid #1f2937; font-size: 11px; color: #64748b; text-align: center;">
        Podés desactivar estas notificaciones desde el Menú de tu Cuenta en la plataforma.
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Template (c): Aviso de rechazo al estudiante uploader con el motivo correspondiente.
 */
export function buildUploaderRejectedEmail(data: {
  title: string;
  subjectName: string;
  rejectionReason: string;
}): { subject: string; html: string; text: string } {
  const safeTitle = escapeHtml(data.title);
  const safeSubject = escapeHtml(data.subjectName);
  const safeReason = escapeHtml(data.rejectionReason);
  const appOrigin = env.CLIENT_ORIGIN || 'https://corre-ten.vercel.app';
  const uploadsUrl = `${appOrigin}/#library/my-uploads`;

  const subject = sanitizeSubject('Tu aporte necesita cambios en Stack');

  const text = `
Tu aporte necesita cambios en Stack
==================================================

Hola:

Te escribimos en relación al material que subiste a la Biblioteca de Stack:
- Título: ${data.title}
- Materia: ${data.subjectName}

Durante la revisión, el equipo de administración indicó el siguiente motivo por el cual no pudo ser publicado en su estado actual:

Motivo:
${data.rejectionReason}

Podés corregir las observaciones (por ejemplo, asegurarte de que sea legible, que corresponda a la materia adecuada o que no contenga información privada) y volver a subirlo desde la sección "Mis Aportes":
${uploadsUrl}

Agradecemos mucho tu predisposición para colaborar con la comunidad.

--
Stack - Tu carrera, materia a materia
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden;">
    <tr>
      <td style="padding: 24px 28px; background: linear-gradient(135deg, #171A52 0%, #1e1b4b 100%); border-bottom: 1px solid #312e81;">
        <span style="font-size: 20px; font-weight: 800; color: #ffffff;">Stack</span>
        <span style="margin-left: 8px; font-size: 11px; font-weight: 700; background-color: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 8px; border-radius: 9999px;">Revisión de Aporte</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 28px;">
        <h1 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #ffffff;">Tu material no pudo ser publicado en su estado actual</h1>
        <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
          Revisamos tu archivo <strong>&ldquo;${safeTitle}&rdquo;</strong> para <strong>${safeSubject}</strong>. Para mantener la calidad y el cumplimiento de las normas de la Biblioteca, se requiere atender el siguiente motivo:
        </p>

        <div style="background-color: rgba(244, 63, 94, 0.1); border-left: 4px solid #f43f5e; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
          <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 700; color: #fda4af; text-transform: uppercase;">Motivo indicado por moderación:</p>
          <p style="margin: 0; font-size: 13.5px; line-height: 1.5; color: #ffffff;">${safeReason}</p>
        </div>

        <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; color: #94a3b8;">
          Podés realizar las correcciones necesarias y cargar nuevamente el archivo desde la pestaña <strong>&ldquo;Mis Aportes&rdquo;</strong>:
        </p>

        <p style="margin: 0 0 24px 0; font-size: 13px; word-break: break-all; background-color: #0b0f19; padding: 12px 16px; border-radius: 8px; border: 1px solid #1f2937; font-family: monospace; color: #a5b4fc;">
          ${uploadsUrl}
        </p>

        <p style="margin: 0; font-size: 13px; color: #cbd5e1;">
          ¡Muchas gracias por tu tiempo y predisposición para sumar a la comunidad!
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 16px 28px; background-color: #0b0f19; border-top: 1px solid #1f2937; font-size: 11px; color: #64748b; text-align: center;">
        Podés desactivar estas notificaciones desde el Menú de tu Cuenta en la plataforma.
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// 5. Función de Reintentos con Espera Creciente (Backoff Exponencial)
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendWithRetry(
  sendFn: () => Promise<{ success: boolean; error?: string }>,
  maxAttempts = 3,
  initialDelayMs = 300
): Promise<{ success: boolean; error?: string }> {
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await sendFn();
      if (res.success) {
        return { success: true };
      }
      lastError = res.error || 'Fallo desconocido';
    } catch (err: any) {
      lastError = err?.message || String(err);
    }

    if (attempt < maxAttempts) {
      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  return { success: false, error: lastError };
}

// ---------------------------------------------------------------------------
// 6. Despachadores de Notificaciones (Lógica de Negocio y Exclusiones)
// ---------------------------------------------------------------------------

export interface InMemoryAdminPendingData {
  id: string;
  title: string;
  subjectName?: string;
  kind: any;
  academicYear?: number | null;
  term?: any;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
  adminNotifiedAt?: Date | null;
}

export interface InMemoryUploaderData {
  title: string;
  subjectName: string;
  uploaderUserId?: string | null;
  userEmail: string;
  userStatus?: string;
  notifyLibraryEmail?: boolean;
  uploaderNotifiedAt?: Date | null;
}

/**
 * (a) Notifica a los administradores que hay nuevo material en estado 'pending'.
 * Aplica tope horario de 10 mails/hora; al superarlo, envía un mail resumen agrupado.
 */
export async function notifyAdminNewPendingFile(
  fileId: string,
  inMemoryData?: InMemoryAdminPendingData
): Promise<boolean> {
  try {
    let title: string;
    let subjectName: string;
    let kind: any;
    let academicYear: number | null | undefined;
    let term: any;
    let sizeBytes: number;
    let mimeType: string;
    let createdAt: Date;

    if (inMemoryData) {
      if (inMemoryData.adminNotifiedAt) return false;
      title = inMemoryData.title;
      subjectName = inMemoryData.subjectName || 'Materia';
      kind = inMemoryData.kind;
      academicYear = inMemoryData.academicYear;
      term = inMemoryData.term;
      sizeBytes = inMemoryData.sizeBytes;
      mimeType = inMemoryData.mimeType;
      createdAt = inMemoryData.createdAt;
    } else {
      // 1. Obtener datos del archivo de PostgreSQL
      const [file] = await db
        .select({
          id: libraryFiles.id,
          title: libraryFiles.title,
          kind: libraryFiles.kind,
          academicYear: libraryFiles.academicYear,
          term: libraryFiles.term,
          sizeBytes: libraryFiles.sizeBytes,
          mimeType: libraryFiles.mimeType,
          status: libraryFiles.status,
          createdAt: libraryFiles.createdAt,
          adminNotifiedAt: libraryFiles.adminNotifiedAt,
          subjectId: libraryFiles.subjectId,
        })
        .from(libraryFiles)
        .where(eq(libraryFiles.id, fileId))
        .limit(1);

      if (!file || file.status !== 'pending' || file.adminNotifiedAt) {
        return false;
      }

      // 2. Obtener nombre de la materia
      const [sub] = await db
        .select({ name: subjects.name })
        .from(subjects)
        .where(eq(subjects.id, file.subjectId))
        .limit(1);

      title = file.title;
      subjectName = sub?.name || 'Materia';
      kind = file.kind;
      academicYear = file.academicYear;
      term = file.term;
      sizeBytes = Number(file.sizeBytes);
      mimeType = file.mimeType;
      createdAt = file.createdAt;
    }

    // 3. Obtener destinatarios de administración
    const recipients = await getAdminNotificationRecipients();
    if (recipients.length === 0) {
      console.warn('[LibraryMailer] No hay destinatarios de administración configurados ni administradores activos.');
      return false;
    }

    // 4. Rate limit horario para administradores (máx 10 mails individuales por hora)
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    if (now - adminHourlyTracker.windowStart > oneHour) {
      adminHourlyTracker.windowStart = now;
      adminHourlyTracker.count = 0;
    }

    adminHourlyTracker.count++;

    let emailContent: { subject: string; html: string; text: string };

    if (adminHourlyTracker.count > LIBRARY_CONFIG.NOTIFY_ADMIN_MAX_PER_HOUR) {
      // Si ya enviamos el resumen en la última hora, suprimimos el email para no saturar
      if (now - adminHourlyTracker.lastSummarySentAt < oneHour) {
        if (!inMemoryData) {
          await db
            .update(libraryFiles)
            .set({ adminNotifiedAt: new Date() })
            .where(eq(libraryFiles.id, fileId));
        } else {
          inMemoryData.adminNotifiedAt = new Date();
        }
        return true;
      }

      // Conteo de pendientes totales
      let pendingCount = adminHourlyTracker.count;
      if (!inMemoryData) {
        try {
          const [pendingCountRes] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(libraryFiles)
            .where(eq(libraryFiles.status, 'pending'));
          if (pendingCountRes?.count) pendingCount = pendingCountRes.count;
        } catch {
          // ignore in fallback
        }
      }

      emailContent = buildAdminHourlySummaryEmail({
        pendingCount,
        newCountInHour: adminHourlyTracker.count,
      });

      adminHourlyTracker.lastSummarySentAt = now;
    } else {
      emailContent = buildAdminNewMaterialEmail({
        title,
        subjectName,
        kind,
        academicYear,
        term,
        sizeBytes,
        mimeType,
        createdAt,
      });
    }

    // 5. Enviar con reintentos
    const result = await sendWithRetry(async () => {
      return defaultMailer.sendEmail({
        to: recipients,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }, 3);

    // Registro para tests
    mockSentNotifications.push({
      type: adminHourlyTracker.count > LIBRARY_CONFIG.NOTIFY_ADMIN_MAX_PER_HOUR ? 'admin_summary' : 'admin_pending',
      to: recipients,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      fileId,
      timestamp: new Date(),
    });

    if (result.success) {
      if (!inMemoryData) {
        await db
          .update(libraryFiles)
          .set({ adminNotifiedAt: new Date() })
          .where(eq(libraryFiles.id, fileId));
      } else {
        inMemoryData.adminNotifiedAt = new Date();
      }
      return true;
    } else {
      console.warn(`[LibraryMailer] Falló el envío de aviso al admin para archivo ${fileId} tras 3 intentos:`, result.error);
      return false;
    }
  } catch (err: any) {
    console.error('[LibraryMailer] Error no fatal enviando notificación al admin:', err?.message || err);
    return false;
  }
}

/**
 * (b) Notifica al usuario que su archivo fue aprobado.
 */
export async function notifyUploaderFileApproved(
  fileId: string,
  inMemoryData?: InMemoryUploaderData
): Promise<boolean> {
  try {
    let title: string;
    let subjectName: string;
    let userEmail: string;

    if (inMemoryData) {
      if (inMemoryData.uploaderNotifiedAt || !inMemoryData.uploaderUserId) return false;
      if (inMemoryData.userStatus === 'suspended') return false;
      if (inMemoryData.notifyLibraryEmail === false) return false;
      title = inMemoryData.title;
      subjectName = inMemoryData.subjectName;
      userEmail = inMemoryData.userEmail;
    } else {
      const [file] = await db
        .select({
          id: libraryFiles.id,
          title: libraryFiles.title,
          status: libraryFiles.status,
          uploaderUserId: libraryFiles.uploaderUserId,
          uploaderNotifiedAt: libraryFiles.uploaderNotifiedAt,
          subjectId: libraryFiles.subjectId,
        })
        .from(libraryFiles)
        .where(eq(libraryFiles.id, fileId))
        .limit(1);

      if (!file || file.status !== 'approved' || file.uploaderNotifiedAt || !file.uploaderUserId) {
        return false;
      }

      // Verificar estado del usuario y preferencias
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, file.uploaderUserId))
        .limit(1);

      if (!user || user.status === 'suspended') {
        return false;
      }

      // Verificar preferencia notify_library_email
      const [settings] = await db
        .select({ notifyLibraryEmail: userSettings.notifyLibraryEmail })
        .from(userSettings)
        .where(eq(userSettings.userId, user.id))
        .limit(1);

      if (settings && settings.notifyLibraryEmail === false) {
        // El usuario desactivó la notificación
        return false;
      }

      const [sub] = await db
        .select({ name: subjects.name })
        .from(subjects)
        .where(eq(subjects.id, file.subjectId))
        .limit(1);

      title = file.title;
      subjectName = sub?.name || 'Materia';
      userEmail = user.email;
    }

    // Tope diario de notificaciones a usuarios
    const today = new Date().setUTCHours(0, 0, 0, 0);
    if (userDailyTracker.dayStart !== today) {
      userDailyTracker.dayStart = today;
      userDailyTracker.count = 0;
    }

    if (userDailyTracker.count >= LIBRARY_CONFIG.NOTIFY_USERS_MAX_PER_DAY) {
      console.warn('[LibraryMailer] Tope diario de notificaciones a usuarios alcanzado. Preservando cuota para verificación.');
      return false;
    }

    userDailyTracker.count++;

    const emailContent = buildUploaderApprovedEmail({
      title,
      subjectName,
    });

    const result = await sendWithRetry(async () => {
      return defaultMailer.sendEmail({
        to: userEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }, 3);

    mockSentNotifications.push({
      type: 'uploader_approved',
      to: [userEmail],
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      fileId,
      timestamp: new Date(),
    });

    if (result.success) {
      if (!inMemoryData) {
        await db
          .update(libraryFiles)
          .set({ uploaderNotifiedAt: new Date() })
          .where(eq(libraryFiles.id, fileId));
      } else {
        inMemoryData.uploaderNotifiedAt = new Date();
      }
      return true;
    } else {
      console.warn(`[LibraryMailer] Falló aviso de aprobación a ${userEmail} tras 3 intentos:`, result.error);
      return false;
    }
  } catch (err: any) {
    console.error('[LibraryMailer] Error no fatal enviando aviso de aprobación:', err?.message || err);
    return false;
  }
}

/**
 * (c) Notifica al usuario que su archivo fue rechazado con el motivo correspondiente.
 */
export async function notifyUploaderFileRejected(
  fileId: string,
  reason: string,
  inMemoryData?: InMemoryUploaderData
): Promise<boolean> {
  try {
    let title: string;
    let subjectName: string;
    let userEmail: string;

    if (inMemoryData) {
      if (inMemoryData.uploaderNotifiedAt || !inMemoryData.uploaderUserId) return false;
      if (inMemoryData.userStatus === 'suspended') return false;
      if (inMemoryData.notifyLibraryEmail === false) return false;
      title = inMemoryData.title;
      subjectName = inMemoryData.subjectName;
      userEmail = inMemoryData.userEmail;
    } else {
      const [file] = await db
        .select({
          id: libraryFiles.id,
          title: libraryFiles.title,
          status: libraryFiles.status,
          uploaderUserId: libraryFiles.uploaderUserId,
          uploaderNotifiedAt: libraryFiles.uploaderNotifiedAt,
          subjectId: libraryFiles.subjectId,
        })
        .from(libraryFiles)
        .where(eq(libraryFiles.id, fileId))
        .limit(1);

      if (!file || file.uploaderNotifiedAt || !file.uploaderUserId) {
        return false;
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, file.uploaderUserId))
        .limit(1);

      if (!user || user.status === 'suspended') {
        return false;
      }

      const [settings] = await db
        .select({ notifyLibraryEmail: userSettings.notifyLibraryEmail })
        .from(userSettings)
        .where(eq(userSettings.userId, user.id))
        .limit(1);

      if (settings && settings.notifyLibraryEmail === false) {
        return false;
      }

      const [sub] = await db
        .select({ name: subjects.name })
        .from(subjects)
        .where(eq(subjects.id, file.subjectId))
        .limit(1);

      title = file.title;
      subjectName = sub?.name || 'Materia';
      userEmail = user.email;
    }

    const today = new Date().setUTCHours(0, 0, 0, 0);
    if (userDailyTracker.dayStart !== today) {
      userDailyTracker.dayStart = today;
      userDailyTracker.count = 0;
    }

    if (userDailyTracker.count >= LIBRARY_CONFIG.NOTIFY_USERS_MAX_PER_DAY) {
      console.warn('[LibraryMailer] Tope diario alcanzado.');
      return false;
    }

    userDailyTracker.count++;

    const emailContent = buildUploaderRejectedEmail({
      title,
      subjectName,
      rejectionReason: reason,
    });

    const result = await sendWithRetry(async () => {
      return defaultMailer.sendEmail({
        to: userEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }, 3);

    mockSentNotifications.push({
      type: 'uploader_rejected',
      to: [userEmail],
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      fileId,
      timestamp: new Date(),
    });

    if (result.success) {
      if (!inMemoryData) {
        await db
          .update(libraryFiles)
          .set({ uploaderNotifiedAt: new Date() })
          .where(eq(libraryFiles.id, fileId));
      } else {
        inMemoryData.uploaderNotifiedAt = new Date();
      }
      return true;
    } else {
      console.warn(`[LibraryMailer] Falló aviso de rechazo a ${userEmail} tras 3 intentos:`, result.error);
      return false;
    }
  } catch (err: any) {
    console.error('[LibraryMailer] Error no fatal enviando aviso de rechazo:', err?.message || err);
    return false;
  }
}
