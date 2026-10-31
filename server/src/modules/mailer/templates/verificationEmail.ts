export interface EmailTemplateContent {
  subject: string;
  html: string;
  text: string;
}

export function buildVerificationEmail(code: string): EmailTemplateContent {
  const subject = `Tu código de verificación de Stack: ${code}`;

  const text = `Hola,

Tu código de verificación de Stack es:

${code}

Este código vence en 10 minutos.

Si no intentaste crear una cuenta en Stack ni solicitaste este código, por favor ignorá este mensaje.

Saludos,
El equipo de Stack`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090D16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Plus Jakarta Sans', Helvetica, Arial, sans-serif; color: #F4F5FB;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #090D16; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #171A52; border: 1px solid rgba(42, 46, 138, 0.6); border-radius: 20px; padding: 36px 28px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.4);">
          <tr>
            <td>
              <h1 style="margin: 0 0 6px 0; font-size: 28px; font-weight: 900; color: #FFFFFF; letter-spacing: -0.5px;">
                Stack
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 13px; font-weight: 600; color: #FFB938; letter-spacing: 0.5px; text-transform: uppercase;">
                Tu carrera, materia a materia
              </p>

              <div style="background-color: #0E1236; border: 1px solid #2A2E8A; border-radius: 14px; padding: 24px 16px; margin: 16px 0 24px 0;">
                <p style="margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #CBD5E1; font-weight: 700;">
                  Tu código de verificación
                </p>
                <div style="font-family: 'JetBrains Mono', Consolas, Monaco, monospace; font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #FFB938; padding: 6px 0;">
                  ${code}
                </div>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #94A3B8;">
                  Válido por los próximos 10 minutos
                </p>
              </div>

              <p style="margin: 0 0 16px 0; font-size: 13px; color: #E2E8F0; line-height: 1.5; text-align: left;">
                Ingresá este código en la pantalla de verificación para confirmar que esta dirección te pertenece y activar tu cuenta en Stack.
              </p>

              <p style="margin: 0 0 24px 0; font-size: 12px; color: #94A3B8; line-height: 1.4; text-align: left; border-top: 1px solid rgba(42, 46, 138, 0.5); padding-top: 16px;">
                Si no intentaste crear una cuenta en Stack ni solicitaste este código, podés ignorar este mensaje de forma segura.
              </p>

              <p style="margin: 0; font-size: 11px; color: #64748B;">
                Stack · Tu carrera, materia a materia
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
