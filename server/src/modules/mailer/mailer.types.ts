export interface SendVerificationCodeInput {
  to: string;
  code: string;
  recipientName?: string;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  recipientName?: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
  provider?: string;
}

export interface IMailerAdapter {
  sendVerificationCode(input: SendVerificationCodeInput): Promise<SendResult>;
  sendEmail(input: SendEmailInput): Promise<SendResult>;
}

