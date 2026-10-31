import type { IMailerAdapter, SendVerificationCodeInput, SendResult } from '../mailer.types.js';
import { buildVerificationEmail } from '../templates/verificationEmail.js';

export class ResendAdapter implements IMailerAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly fromName: string
  ) {}

  async sendVerificationCode(input: SendVerificationCodeInput): Promise<SendResult> {
    try {
      const template = buildVerificationEmail(input.code);
      const from = this.fromName ? `${this.fromName} <${this.fromAddress}>` : this.fromAddress;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: template.subject,
          html: template.html,
          text: template.text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[Mailer] Error enviando correo vía Resend (HTTP ${response.status})`);
        return {
          success: false,
          provider: 'resend',
          error: `Resend HTTP ${response.status}: ${errorText.slice(0, 120)}`,
        };
      }

      return { success: true, provider: 'resend' };
    } catch (err: any) {
      console.error('[Mailer] Excepción de red al enviar correo vía Resend');
      return {
        success: false,
        provider: 'resend',
        error: err?.message || 'Error de red en Resend',
      };
    }
  }
}

