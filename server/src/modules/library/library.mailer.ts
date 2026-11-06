import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { users, userSettings, libraryFiles, subjects } from '../../db/schema.js';
import { eq, and, sql, isNull, isNotNull, inArray, asc } from 'drizzle-orm';
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
// 2. Control de Tasa (Rate Limiting) y Resumen Horario en Memoria (Safety Caps)
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
  resetMailerTimers();
}

// ---------------------------------------------------------------------------
// 3. Destinatarios de Administración
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

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface LibraryFileNotificationItem {
  id: string;
  title: string;
  subjectName: string;
  kind: string;
  academicYear?: number | null;
  term?: string | null;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
}

/**
 * Template (a): Aviso al Administrador sobre nuevo material para revisar (individual).
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
}): { subject: string; html: string; text: string } {
  const safeTitle = escapeHtml(data.title);
  const safeSubject = escapeHtml(data.subjectName);
  const safeKind = escapeHtml(data.kind.toUpperCase());
  const yearTermParts: string[] = [];
  if (data.academicYear) yearTermParts.push(String(data.academicYear));
  if (data.term) yearTermParts.push(data.term);
  const safeYearTerm = yearTermParts.length > 0 ? escapeHtml(yearTermParts.join(' - ')) : 'No especificado';
  const sizeFormatted = formatBytes(data.sizeBytes);
  const dateFormatted = data.createdAt.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Cordoba',
  });

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
- Año / Cuatrimestre: ${safeYearTerm}
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
 * Template (a-resumen / lote): Resumen consolidado para administradores con hasta 15 archivos.
 */
export function buildAdminBatchSummaryEmail(items: LibraryFileNotificationItem[]): {
  subject: string;
  html: string;
  text: string;
} {
  const count = items.length;
  if (count === 1) {
    const item = items[0];
    return buildAdminNewMaterialEmail({
      title: item.title,
      subjectName: item.subjectName,
      kind: item.kind,
      academicYear: item.academicYear,
      term: item.term,
      sizeBytes: item.sizeBytes,
      mimeType: item.mimeType,
      createdAt: item.createdAt,
    });
  }

  const subject = sanitizeSubject(`[Stack] ${count} nuevos materiales para revisar en la Biblioteca`);
  const appOrigin = env.CLIENT_ORIGIN || 'https://corre-ten.vercel.app';
  const adminUrl = `${appOrigin}/#admin`;

  const displayedItems = items.slice(0, 15);
  const remainingCount = count - displayedItems.length;

  const rowsText = displayedItems
    .map(
      (it, idx) =>
        `${idx + 1}. "${it.title}" - Materia: ${it.subjectName} (${it.kind.toUpperCase()}${
          it.academicYear ? ` ${it.academicYear}` : ''
        }${it.term ? `-${it.term}` : ''}) [${formatBytes(it.sizeBytes)}]`
    )
    .join('\n');

  const text = `
Nuevos materiales pendientes de moderación - Stack
==================================================

Se cargaron ${count} nuevos archivos en la Biblioteca y se encuentran en espera de revisión:

${rowsText}
${remainingCount > 0 ? `\n... y ${remainingCount} materiales más en la cola de moderación.` : ''}

Revisá los archivos y aprobá o rechazá desde el panel de administración:
${adminUrl}

(La identidad de los estudiantes autores se mantiene confidencial y solo es consultable de forma auditada desde el panel).

--
Stack - Plataforma Colaborativa de Ingeniería en Sistemas
`.trim();

  const rowsHtml = displayedItems
    .map(
      (it) => `
    <tr>
      <td style="padding: 10px 14px; border-bottom: 1px solid #1f2937; font-size: 13px; font-weight: 600; color: #ffffff;">
        ${escapeHtml(it.title)}
      </td>
      <td style="padding: 10px 14px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #818cf8;">
        ${escapeHtml(it.subjectName)}
      </td>
      <td style="padding: 10px 14px; border-bottom: 1px solid #1f2937; font-size: 12px; color: #94a3b8; text-transform: uppercase;">
        ${escapeHtml(it.kind)}
      </td>
      <td style="padding: 10px 14px; border-bottom: 1px solid #1f2937; font-size: 12px; color: #cbd5e1;">
        ${it.academicYear || '-'}${it.term ? ` (${it.term})` : ''}
      </td>
      <td style="padding: 10px 14px; border-bottom: 1px solid #1f2937; font-size: 12px; color: #94a3b8;">
        ${formatBytes(it.sizeBytes)}
      </td>
    </tr>`
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #f8fafc;">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 620px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden;">
    <tr>
      <td style="padding: 24px 28px; background: linear-gradient(135deg, #171A52 0%, #1e1b4b 100%); border-bottom: 1px solid #312e81;">
        <span style="font-size: 20px; font-weight: 800; color: #ffffff;">Stack</span>
        <span style="margin-left: 8px; font-size: 11px; font-weight: 700; background-color: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 8px; border-radius: 9999px;">Moderación • Lote</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 28px;">
        <h1 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #ffffff;">${count} nuevos materiales pendientes de revisión</h1>
        <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.5; color: #cbd5e1;">
          Se completó la carga de ${count} nuevos recursos en la Biblioteca que requieren revisión y moderación antes de su publicación:
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0b0f19; border: 1px solid #1f2937; border-radius: 12px; margin-bottom: 20px; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px solid #1f2937; background-color: #161f30;">
              <th style="padding: 8px 14px; text-align: left; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Título</th>
              <th style="padding: 8px 14px; text-align: left; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Materia</th>
              <th style="padding: 8px 14px; text-align: left; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Tipo</th>
              <th style="padding: 8px 14px; text-align: left; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Año</th>
              <th style="padding: 8px 14px; text-align: left; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Tamaño</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        ${remainingCount > 0 ? `<p style="margin: 0 0 20px 0; font-size: 13px; font-weight: 600; color: #fbbf24;">... y ${remainingCount} materiales más en la cola de moderación.</p>` : ''}

        <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; color: #94a3b8;">
          Revisá la previsualización y aprobá o rechazá desde la cola de moderación:
        </p>

        <p style="margin: 0 0 24px 0; font-size: 13px; word-break: break-all; background-color: #0b0f19; padding: 12px 16px; border-radius: 8px; border: 1px solid #1f2937; font-family: monospace; color: #a5b4fc;">
          ${adminUrl}
        </p>

        <div style="background-color: rgba(30, 27, 75, 0.4); border-left: 3px solid #6366f1; padding: 10px 14px; border-radius: 4px; font-size: 12px; color: #a5b4fc;">
          <strong>Privacidad estudiantil:</strong> Los datos de los autores se mantienen confidenciales y no se incluyen en este correo. Podés consultar las identidades de forma auditada desde el panel si fuera necesario.
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
 * Template (b): Aviso de aprobación al estudiante uploader (individual).
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
 * Template (b-lote): Aviso de aprobación al estudiante para múltiples aportes.
 */
export function buildUploaderGroupedApprovedEmail(
  items: Array<{ title: string; subjectName: string }>
): { subject: string; html: string; text: string } {
  if (items.length === 1) {
    return buildUploaderApprovedEmail(items[0]);
  }

  const count = items.length;
  const subject = sanitizeSubject(`Tus ${count} aportes fueron aprobados en Stack`);
  const appOrigin = env.CLIENT_ORIGIN || 'https://corre-ten.vercel.app';
  const libraryUrl = `${appOrigin}/#library`;

  const displayed = items.slice(0, 15);
  const remaining = count - displayed.length;

  const rowsText = displayed.map((it, idx) => `${idx + 1}. ${it.title} (${it.subjectName})`).join('\n');
  const text = `
¡Tus materiales ya están disponibles en Stack!
==================================================

Hola:

El equipo de administración revisó y aprobó ${count} materiales que compartiste en la Biblioteca:

${rowsText}
${remaining > 0 ? `\n... y ${remaining} materiales más.` : ''}

Ya se encuentran publicados en el catálogo público para que todos los estudiantes puedan consultarlos.

Podés ingresar a la Biblioteca en cualquier momento:
${libraryUrl}

¡Muchas gracias por colaborar con la comunidad!

--
Stack - Tu carrera, materia a materia
`.trim();

  const rowsHtml = displayed
    .map(
      (it) => `
    <li style="margin-bottom: 8px;">
      <strong style="color: #ffffff;">${escapeHtml(it.title)}</strong>
      <span style="color: #818cf8;"> — ${escapeHtml(it.subjectName)}</span>
    </li>`
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #f8fafc;">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden;">
    <tr>
      <td style="padding: 24px 28px; background: linear-gradient(135deg, #171A52 0%, #1e1b4b 100%); border-bottom: 1px solid #312e81;">
        <span style="font-size: 20px; font-weight: 800; color: #ffffff;">Stack</span>
        <span style="margin-left: 8px; font-size: 11px; font-weight: 700; background-color: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 8px; border-radius: 9999px;">Aportes Aprobados</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 28px;">
        <h1 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #ffffff;">¡Tus materiales ya están disponibles para toda la comunidad!</h1>
        <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
          Buenas noticias: el equipo de moderación revisó y aprobó ${count} materiales que compartiste en la Biblioteca de Stack:
        </p>

        <div style="background-color: #0b0f19; border: 1px solid #1f2937; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
          <ul style="margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 13.5px;">
            ${rowsHtml}
          </ul>
          ${remaining > 0 ? `<p style="margin: 12px 0 0 0; font-size: 12px; font-weight: 600; color: #34d399;">... y ${remaining} materiales más.</p>` : ''}
        </div>

        <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; color: #94a3b8;">
          Tus aportes ayudan a cientos de estudiantes a preparar sus exámenes y avanzar en la carrera. Podés ver tus materiales publicados aquí:
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
 * Template (c): Aviso de rechazo al estudiante uploader (individual).
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

Podés corregir las observaciones y volver a subirlo desde la sección "Mis Aportes":
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

/**
 * Template (c-lote): Aviso de rechazo al estudiante para múltiples aportes.
 */
export function buildUploaderGroupedRejectedEmail(
  items: Array<{ title: string; subjectName: string; rejectionReason: string }>
): { subject: string; html: string; text: string } {
  if (items.length === 1) {
    return buildUploaderRejectedEmail(items[0]);
  }

  const count = items.length;
  const subject = sanitizeSubject(`Observaciones sobre tus ${count} aportes en Stack`);
  const appOrigin = env.CLIENT_ORIGIN || 'https://corre-ten.vercel.app';
  const uploadsUrl = `${appOrigin}/#library/my-uploads`;

  const displayed = items.slice(0, 15);
  const remaining = count - displayed.length;

  const rowsText = displayed
    .map(
      (it, idx) =>
        `${idx + 1}. ${it.title} (${it.subjectName})\n   Motivo: ${it.rejectionReason}`
    )
    .join('\n\n');

  const text = `
Tus aportes necesitan cambios en Stack
==================================================

Hola:

Te escribimos en relación a los ${count} materiales que subiste a la Biblioteca de Stack:

${rowsText}
${remaining > 0 ? `\n... y ${remaining} materiales más.` : ''}

Podés corregir las observaciones y volver a subirlos desde la sección "Mis Aportes":
${uploadsUrl}

Agradecemos mucho tu predisposición para colaborar con la comunidad.

--
Stack - Tu carrera, materia a materia
`.trim();

  const rowsHtml = displayed
    .map(
      (it) => `
    <div style="background-color: #0b0f19; border: 1px solid #1f2937; border-left: 3px solid #f43f5e; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px;">
      <p style="margin: 0 0 4px 0; font-size: 13.5px; font-weight: 700; color: #ffffff;">
        ${escapeHtml(it.title)} <span style="font-size: 12px; font-weight: normal; color: #818cf8;">(${escapeHtml(it.subjectName)})</span>
      </p>
      <p style="margin: 0; font-size: 12.5px; color: #fda4af;">
        <strong>Motivo:</strong> ${escapeHtml(it.rejectionReason)}
      </p>
    </div>`
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #f8fafc;">
  <table align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden;">
    <tr>
      <td style="padding: 24px 28px; background: linear-gradient(135deg, #171A52 0%, #1e1b4b 100%); border-bottom: 1px solid #312e81;">
        <span style="font-size: 20px; font-weight: 800; color: #ffffff;">Stack</span>
        <span style="margin-left: 8px; font-size: 11px; font-weight: 700; background-color: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 8px; border-radius: 9999px;">Revisión de Aportes</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 28px;">
        <h1 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 700; color: #ffffff;">Tus materiales no pudieron ser publicados en su estado actual</h1>
        <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
          Revisamos ${count} archivos que aportaste. Para mantener la calidad y el cumplimiento de las normas de la Biblioteca, se requiere atender los siguientes motivos:
        </p>

        <div style="margin-bottom: 24px;">
          ${rowsHtml}
          ${remaining > 0 ? `<p style="margin: 12px 0 0 0; font-size: 12px; font-weight: 600; color: #fda4af;">... y ${remaining} materiales más con observaciones.</p>` : ''}
        </div>

        <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; color: #94a3b8;">
          Podés realizar las correcciones necesarias y cargar nuevamente los archivos desde la pestaña <strong>&ldquo;Mis Aportes&rdquo;</strong>:
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
// 5. Reintentos y Fuente de Datos Desacoplada (DB vs InMemory)
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

export interface PendingUploaderFileItem {
  fileId: string;
  uploaderUserId: string;
  userEmail: string;
  userStatus: string;
  notifyLibraryEmail: boolean;
  status: 'approved' | 'rejected';
  title: string;
  subjectName: string;
  rejectionReason?: string | null;
}

export interface IMailerDataSource {
  getPendingAdminFiles(): Promise<LibraryFileNotificationItem[]>;
  markAdminNotified(fileIds: string[]): Promise<void>;
  getPendingUploaderFiles(): Promise<PendingUploaderFileItem[]>;
  markUploaderNotified(fileIds: string[]): Promise<void>;
}

let mailerDataSource: IMailerDataSource | null = null;

export function setMailerDataSource(source: IMailerDataSource | null): void {
  mailerDataSource = source;
}

// ---------------------------------------------------------------------------
// 6. Lógica de Agrupación y Procesamiento de Lotes (Debounced & Cron)
// ---------------------------------------------------------------------------

let lastAdminUploadTimestamp = 0;
let adminBatchDebounceTimer: NodeJS.Timeout | null = null;
let lastUploaderActionTimestamp = 0;
let uploaderBatchDebounceTimer: NodeJS.Timeout | null = null;

export function resetMailerTimers(): void {
  if (adminBatchDebounceTimer) {
    clearTimeout(adminBatchDebounceTimer);
    adminBatchDebounceTimer = null;
  }
  if (uploaderBatchDebounceTimer) {
    clearTimeout(uploaderBatchDebounceTimer);
    uploaderBatchDebounceTimer = null;
  }
  lastAdminUploadTimestamp = 0;
  lastUploaderActionTimestamp = 0;
  adminHourlyTracker.count = 0;
  adminHourlyTracker.lastSummarySentAt = 0;
  userDailyTracker.count = 0;
}

export function recordUploadCompleted(): void {
  lastAdminUploadTimestamp = Date.now();
  const cooldownMs = LIBRARY_CONFIG.ADMIN_NOTIFY_COOLDOWN_SECONDS * 1000;
  if (cooldownMs === 0) {
    void processPendingAdminNotifications({ force: true }).catch(() => {});
  } else {
    if (adminBatchDebounceTimer) clearTimeout(adminBatchDebounceTimer);
    adminBatchDebounceTimer = setTimeout(() => {
      void processPendingAdminNotifications({ force: true }).catch(() => {});
    }, cooldownMs);
    if (typeof adminBatchDebounceTimer.unref === 'function') {
      adminBatchDebounceTimer.unref();
    }
  }
}

export function recordUploaderAction(): void {
  lastUploaderActionTimestamp = Date.now();
  const cooldownMs = LIBRARY_CONFIG.ADMIN_NOTIFY_COOLDOWN_SECONDS * 1000;
  if (cooldownMs === 0) {
    void processPendingUploaderNotifications({ force: true }).catch(() => {});
  } else {
    if (uploaderBatchDebounceTimer) clearTimeout(uploaderBatchDebounceTimer);
    uploaderBatchDebounceTimer = setTimeout(() => {
      void processPendingUploaderNotifications({ force: true }).catch(() => {});
    }, cooldownMs);
    if (typeof uploaderBatchDebounceTimer.unref === 'function') {
      uploaderBatchDebounceTimer.unref();
    }
  }
}

/**
 * Procesa todos los archivos en 'pending' con admin_notified_at IS NULL y envía
 * un único email resumen al administrador.
 */
export async function processPendingAdminNotifications(options?: {
  force?: boolean;
}): Promise<boolean> {
  if (!mailerDataSource) return false;

  const now = Date.now();
  const cooldownMs = LIBRARY_CONFIG.ADMIN_NOTIFY_COOLDOWN_SECONDS * 1000;
  if (!options?.force && cooldownMs > 0 && now - lastAdminUploadTimestamp < cooldownMs) {
    return false;
  }

  try {
    const items = await mailerDataSource.getPendingAdminFiles();
    if (!items || items.length === 0) return false;

    // Safety cap horario
    const oneHour = 60 * 60 * 1000;
    if (now - adminHourlyTracker.windowStart > oneHour) {
      adminHourlyTracker.windowStart = now;
      adminHourlyTracker.count = 0;
    }
    if (!options?.force && adminHourlyTracker.count >= LIBRARY_CONFIG.NOTIFY_ADMIN_MAX_PER_HOUR) {
      console.warn('[LibraryMailer] Safety cap alcanzado para avisos a administradores.');
      return false;
    }

    const recipients = await getAdminNotificationRecipients();
    if (recipients.length === 0) {
      console.warn('[LibraryMailer] No hay destinatarios de administración configurados.');
      return false;
    }

    const emailContent = buildAdminBatchSummaryEmail(items);
    const result = await sendWithRetry(async () => {
      return defaultMailer.sendEmail({
        to: recipients,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }, 3);

    mockSentNotifications.push({
      type: items.length > 1 ? 'admin_summary' : 'admin_pending',
      to: recipients,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      fileId: items[0]?.id,
      timestamp: new Date(),
    });

    if (result.success) {
      adminHourlyTracker.count++;
      const ids = items.map((f) => f.id);
      await mailerDataSource.markAdminNotified(ids);
      return true;
    } else {
      console.warn('[LibraryMailer] Falló el envío de resumen admin. Queda sin marcar para el próximo ciclo.');
      return false;
    }
  } catch (err: any) {
    console.error('[LibraryMailer] Error procesando notificaciones pendientes a admin:', err?.message || err);
    return false;
  }
}

/**
 * Procesa todos los archivos aprobados o rechazados con uploader_notified_at IS NULL,
 * agrupándolos por estudiante y por resultado.
 */
export async function processPendingUploaderNotifications(options?: {
  force?: boolean;
}): Promise<boolean> {
  if (!mailerDataSource) return false;

  try {
    const items = await mailerDataSource.getPendingUploaderFiles();
    if (!items || items.length === 0) return false;

    // Agrupar por uploaderUserId y por status ('approved' | 'rejected')
    const groups = new Map<string, PendingUploaderFileItem[]>();
    for (const item of items) {
      const key = `${item.uploaderUserId}:${item.status}`;
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    }

    let anySent = false;
    const today = new Date().setUTCHours(0, 0, 0, 0);
    if (userDailyTracker.dayStart !== today) {
      userDailyTracker.dayStart = today;
      userDailyTracker.count = 0;
    }

    for (const group of groups.values()) {
      if (group.length === 0) continue;
      const first = group[0];
      const fileIds = group.map((g) => g.fileId);

      // Exclusiones: suspendido o notifyLibraryEmail false
      if (first.userStatus === 'suspended' || first.notifyLibraryEmail === false) {
        await mailerDataSource.markUploaderNotified(fileIds);
        continue;
      }

      // Safety cap diario
      if (!options?.force && userDailyTracker.count >= LIBRARY_CONFIG.NOTIFY_USERS_MAX_PER_DAY) {
        console.warn('[LibraryMailer] Safety cap diario de usuarios alcanzado.');
        continue;
      }

      let emailContent: { subject: string; html: string; text: string };
      if (first.status === 'approved') {
        emailContent = buildUploaderGroupedApprovedEmail(
          group.map((g) => ({ title: g.title, subjectName: g.subjectName }))
        );
      } else {
        emailContent = buildUploaderGroupedRejectedEmail(
          group.map((g) => ({
            title: g.title,
            subjectName: g.subjectName,
            rejectionReason: g.rejectionReason || 'El archivo no cumple con las pautas de publicación.',
          }))
        );
      }

      const result = await sendWithRetry(async () => {
        return defaultMailer.sendEmail({
          to: first.userEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      }, 3);

      mockSentNotifications.push({
        type: first.status === 'approved' ? 'uploader_approved' : 'uploader_rejected',
        to: [first.userEmail],
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        fileId: first.fileId,
        timestamp: new Date(),
      });

      if (result.success) {
        userDailyTracker.count++;
        await mailerDataSource.markUploaderNotified(fileIds);
        anySent = true;
      } else {
        console.warn(
          `[LibraryMailer] Falló aviso a ${first.userEmail}. Queda sin marcar para reintentar en el próximo ciclo.`
        );
      }
    }

    return anySent;
  } catch (err: any) {
    console.error('[LibraryMailer] Error procesando notificaciones pendientes a usuarios:', err?.message || err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 7. Funciones Wrapper de Compatibilidad
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
 * Notifica a administradores. Si hay mailerDataSource, registra el evento y dispara
 * la consolidación.
 */
export async function notifyAdminNewPendingFile(
  fileId: string,
  inMemoryData?: InMemoryAdminPendingData
): Promise<boolean> {
  recordUploadCompleted();
  if (mailerDataSource) {
    return processPendingAdminNotifications({ force: true });
  }

  // Fallback si no se configuró mailerDataSource
  try {
    const recipients = await getAdminNotificationRecipients();
    if (recipients.length === 0) return false;

    let title = inMemoryData?.title || 'Material';
    let subjectName = inMemoryData?.subjectName || 'Materia';
    let kind = inMemoryData?.kind || 'parcial';
    let academicYear = inMemoryData?.academicYear;
    let term = inMemoryData?.term;
    let sizeBytes = inMemoryData?.sizeBytes || 0;
    let mimeType = inMemoryData?.mimeType || 'application/pdf';
    let createdAt = inMemoryData?.createdAt || new Date();

    if (!inMemoryData) {
      const [f] = await db
        .select()
        .from(libraryFiles)
        .where(eq(libraryFiles.id, fileId))
        .limit(1);
      if (!f || f.status !== 'pending' || f.adminNotifiedAt) return false;
      title = f.title;
      kind = f.kind;
      academicYear = f.academicYear;
      term = f.term;
      sizeBytes = Number(f.sizeBytes);
      mimeType = f.mimeType;
      createdAt = f.createdAt;
      const [s] = await db.select().from(subjects).where(eq(subjects.id, f.subjectId)).limit(1);
      subjectName = s?.name || 'Materia';
    }

    const emailContent = buildAdminNewMaterialEmail({
      title,
      subjectName,
      kind,
      academicYear,
      term,
      sizeBytes,
      mimeType,
      createdAt,
    });

    const result = await sendWithRetry(async () => {
      return defaultMailer.sendEmail({
        to: recipients,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }, 3);

    mockSentNotifications.push({
      type: 'admin_pending',
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
    }
    return false;
  } catch (err: any) {
    console.error('[LibraryMailer] Fallo en notifyAdminNewPendingFile fallback:', err?.message || err);
    return false;
  }
}

export async function notifyUploaderFileApproved(
  fileId: string,
  inMemoryData?: InMemoryUploaderData
): Promise<boolean> {
  recordUploaderAction();
  if (mailerDataSource) {
    return processPendingUploaderNotifications({ force: true });
  }

  // Fallback directo
  try {
    let userEmail = inMemoryData?.userEmail;
    let title = inMemoryData?.title || 'Material';
    let subjectName = inMemoryData?.subjectName || 'Materia';

    if (!inMemoryData) {
      const [f] = await db.select().from(libraryFiles).where(eq(libraryFiles.id, fileId)).limit(1);
      if (!f || f.uploaderNotifiedAt || !f.uploaderUserId) return false;
      const [u] = await db.select().from(users).where(eq(users.id, f.uploaderUserId)).limit(1);
      if (!u || u.status === 'suspended') return false;
      const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, u.id)).limit(1);
      if (settings && settings.notifyLibraryEmail === false) return false;
      const [s] = await db.select().from(subjects).where(eq(subjects.id, f.subjectId)).limit(1);
      title = f.title;
      subjectName = s?.name || 'Materia';
      userEmail = u.email;
    } else {
      if (inMemoryData.uploaderNotifiedAt || !inMemoryData.uploaderUserId) return false;
      if (inMemoryData.userStatus === 'suspended' || inMemoryData.notifyLibraryEmail === false) return false;
    }

    if (!userEmail) return false;

    const emailContent = buildUploaderApprovedEmail({ title, subjectName });
    const result = await sendWithRetry(async () => {
      return defaultMailer.sendEmail({
        to: userEmail!,
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
    }
    return false;
  } catch (err: any) {
    console.error('[LibraryMailer] Fallo en notifyUploaderFileApproved fallback:', err?.message || err);
    return false;
  }
}

export async function notifyUploaderFileRejected(
  fileId: string,
  reason: string,
  inMemoryData?: InMemoryUploaderData
): Promise<boolean> {
  recordUploaderAction();
  if (mailerDataSource) {
    return processPendingUploaderNotifications({ force: true });
  }

  // Fallback directo
  try {
    let userEmail = inMemoryData?.userEmail;
    let title = inMemoryData?.title || 'Material';
    let subjectName = inMemoryData?.subjectName || 'Materia';

    if (!inMemoryData) {
      const [f] = await db.select().from(libraryFiles).where(eq(libraryFiles.id, fileId)).limit(1);
      if (!f || f.uploaderNotifiedAt || !f.uploaderUserId) return false;
      const [u] = await db.select().from(users).where(eq(users.id, f.uploaderUserId)).limit(1);
      if (!u || u.status === 'suspended') return false;
      const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, u.id)).limit(1);
      if (settings && settings.notifyLibraryEmail === false) return false;
      const [s] = await db.select().from(subjects).where(eq(subjects.id, f.subjectId)).limit(1);
      title = f.title;
      subjectName = s?.name || 'Materia';
      userEmail = u.email;
    } else {
      if (inMemoryData.uploaderNotifiedAt || !inMemoryData.uploaderUserId) return false;
      if (inMemoryData.userStatus === 'suspended' || inMemoryData.notifyLibraryEmail === false) return false;
    }

    if (!userEmail) return false;

    const emailContent = buildUploaderRejectedEmail({ title, subjectName, rejectionReason: reason });
    const result = await sendWithRetry(async () => {
      return defaultMailer.sendEmail({
        to: userEmail!,
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
    }
    return false;
  } catch (err: any) {
    console.error('[LibraryMailer] Fallo en notifyUploaderFileRejected fallback:', err?.message || err);
    return false;
  }
}
