import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';

export interface VerifiedGoogleUser {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  emailVerified: boolean;
}

export type GoogleTokenVerifier = (credential: string) => Promise<VerifiedGoogleUser>;

let customVerifier: GoogleTokenVerifier | null = null;

/**
 * Permite inyectar un verificador simulado para pruebas de integración/unitarias.
 */
export function setGoogleVerifierForTesting(verifier: GoogleTokenVerifier | null) {
  customVerifier = verifier;
}

/**
 * Verifica un ID token emitido por Google Identity Services
 */
export async function verifyGoogleCredential(credential: string): Promise<VerifiedGoogleUser> {
  if (customVerifier) {
    return customVerifier(credential);
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID no configurado en el servidor');
  }

  const client = new OAuth2Client(clientId);

  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: clientId,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('No se pudo extraer el payload del token de Google');
  }

  // Validar emisor
  const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!payload.iss || !validIssuers.includes(payload.iss)) {
    throw new Error(`Emisor del token de Google no válido: ${payload.iss}`);
  }

  // Validar expiración
  const nowInSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowInSec) {
    throw new Error('El token de Google ha expirado');
  }

  if (!payload.sub) {
    throw new Error('El token de Google no contiene identificador único (sub)');
  }

  if (!payload.email) {
    throw new Error('El token de Google no contiene correo electrónico');
  }

  if (payload.email_verified !== true) {
    throw new Error('La dirección de correo de Google no se encuentra verificada');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    emailVerified: true,
  };
}

