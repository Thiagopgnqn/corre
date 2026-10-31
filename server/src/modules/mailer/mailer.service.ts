import { env } from '../../config/env.js';
import type { IMailerAdapter, SendVerificationCodeInput, SendResult } from './mailer.types.js';
import { ResendAdapter } from './adapters/resend.adapter.js';
import { BrevoAdapter } from './adapters/brevo.adapter.js';

export class MailerService {
  private adapter: IMailerAdapter | null = null;

  constructor() {
    this.initAdapter();
  }

  private initAdapter() {
    // Parse email sender
    let fromAddress = 'noreply@stack.app';
    let fromName = env.EMAIL_FROM_NAME || 'Stack';

    if (env.EMAIL_FROM) {
      const match = env.EMAIL_FROM.match(/^(?:(.*?)<)?([^<>]+)>?$/);
      if (match) {
        if (match[1]?.trim()) fromName = match[1].trim();
        if (match[2]?.trim()) fromAddress = match[2].trim();
      } else {
        fromAddress = env.EMAIL_FROM;
      }
    }

    if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
      this.adapter = new ResendAdapter(env.RESEND_API_KEY, fromAddress, fromName);
    } else if (env.EMAIL_PROVIDER === 'brevo' && env.BREVO_API_KEY) {
      this.adapter = new BrevoAdapter(env.BREVO_API_KEY, fromAddress, fromName);
    } else {
      this.adapter = null;
    }
  }

  /**
   * Permite inyectar un adaptador mock para tests unitarios / integración.
   */
  setAdapterForTesting(adapter: IMailerAdapter | null) {
    this.adapter = adapter;
  }

  async sendVerificationCode(input: SendVerificationCodeInput): Promise<SendResult> {
    if (this.adapter) {
      const result = await this.adapter.sendVerificationCode(input);
      // En desarrollo, también imprimimos en consola como comodidad
      if (env.NODE_ENV !== 'production') {
        console.log(`\n📧 [DEV EMAIL] Código de verificación para ${input.to}: ${input.code} (vence en 10m)\n`);
      }
      return result;
    }

    // Modo desarrollo / test sin API key de proveedor configurada
    if (env.NODE_ENV !== 'production') {
      console.log(`\n📧 [DEV EMAIL CONSOLE] Código de verificación para ${input.to}: ${input.code} (vence en 10m)\n`);
      return {
        success: true,
        provider: 'dev-console',
      };
    }

    console.error('[Mailer] En producción no se pudo enviar el correo: no hay proveedor configurado.');
    return {
      success: false,
      provider: 'none',
      error: 'Proveedor de correo no disponible',
    };
  }
}

export const defaultMailer = new MailerService();

