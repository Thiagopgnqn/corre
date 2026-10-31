export interface SendVerificationCodeInput {
  to: string;
  code: string;
  recipientName?: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
  provider?: string;
}

export interface IMailerAdapter {
  sendVerificationCode(input: SendVerificationCodeInput): Promise<SendResult>;
}

