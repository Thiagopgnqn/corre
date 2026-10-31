import type { IMailerAdapter, SendVerificationCodeInput, SendResult } from '../mailer.types.js';
import { buildVerificationEmail } from '../templates/verificationEmail.js';

export class BrevoAdapter implements IMailerAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly fromName: string
  ) {}

  async sendVerificationCode(input: SendVerificationCodeInput): Promise<SendResult> {
    try {
      const template = buildVerificationEmail(input.code);

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          sender: {
            name: this.fromName,
            email: this.fromAddress,
          },
          to: [
            {
              email: input.to,
              name: input.recipientName || undefined,
            },
          ],
          subject: template.subject,
          htmlContent: template.html,
          textContent: template.text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[Mailer] Error enviando correo vía Brevo (HTTP ${response.status})`);
        return {
          success: false,
          provider: 'brevo',
          error: `Brevo HTTP ${response.status}: ${errorText.slice(0, 120)}`,
        };
      }

      return { success: true, provider: 'brevo' };
    } catch (err: any) {
      console.error('[Mailer] Excepción de red al enviar correo vía Brevo');
      return {
        success: false,
        provider: 'brevo',
        error: err?.message || 'Error de red en Brevo',
      };
    }
  }
}

