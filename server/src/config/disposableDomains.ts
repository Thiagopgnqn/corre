/**
 * Lista de dominios de correo electrónico temporales / descartables conocidos.
 * Se bloquean durante el registro con contraseña para evitar multicuentas y cuentas fantasma.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'airmail.news',
  'burnermail.io',
  'crazymailing.com',
  'discard.email',
  'disposablemail.com',
  'dispostable.com',
  'emailondeck.com',
  'fakemailgenerator.com',
  'getairmail.com',
  'generator.email',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'inboxkitten.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spambog.com',
  'temp-mail.org',
  'temp-mail.ru',
  'tempmail.com',
  'tempmail.net',
  'tempmailaddress.com',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

/**
 * Verifica si un email pertenece a un proveedor de correo descartable conocido.
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  const domain = email.trim().split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

