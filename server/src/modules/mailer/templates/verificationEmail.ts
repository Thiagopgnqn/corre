export interface EmailTemplateContent {
  subject: string;
  html: string;
  text: string;
}

export function buildVerificationEmail(code: string): EmailTemplateContent {
  const subject = `Tu código de verificación para Mi Carrera: ${code}`;

  const text = `Hola,

Tu código de verificación para Mi Carrera es:

${code}

Este código vence en 10 minutos.

Si no intentaste crear una cuenta en Mi Carrera ni solicitaste este código, por favor ignorá este mensaje.

Saludos,
El equipo de Mi Carrera`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px 24px; text-align: center;">
          <tr>
            <td>
              <div style="display: inline-block; width: 48px; height: 48px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 12px; line-height: 48px; font-size: 24px; margin-bottom: 16px;">
                🎓
              </div>
              <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
                Mi Carrera
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8;">
                Verificación de correo electrónico
              </p>

              <div style="background-color: #020617; border: 1px solid #334155; border-radius: 12px; padding: 24px 16px; margin: 16px 0 24px 0;">
                <p style="margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #818cf8; font-weight: 700;">
                  Tu código de 6 dígitos
                </p>
                <div style="font-family: 'JetBrains Mono', Consolas, Monaco, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; padding: 4px 0;">
                  ${code}
                </div>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b;">
                  Válido por los próximos 10 minutos
                </p>
              </div>

              <p style="margin: 0 0 16px 0; font-size: 13px; color: #cbd5e1; line-height: 1.5; text-align: left;">
                Ingresá este código en la pantalla de verificación para confirmar que esta dirección te pertenece y activar tu cuenta.
              </p>

              <p style="margin: 0 0 24px 0; font-size: 12px; color: #64748b; line-height: 1.4; text-align: left; border-top: 1px solid #1e293b; padding-top: 16px;">
                Si no intentaste crear una cuenta en Mi Carrera ni solicitaste este código, podés ignorar este mensaje de forma segura.
              </p>

              <p style="margin: 0; font-size: 11px; color: #475569;">
                Mi Carrera · UTN ISI Plan 2023
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

