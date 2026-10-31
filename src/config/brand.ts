/**
 * Identidad de marca y configuración central de Stack.
 * Modificar estos valores actualiza los textos, metadatos y tokens de toda la aplicación.
 */

export const APP_NAME = 'Stack';

export const APP_TAGLINE = 'Tu carrera, materia a materia';

export const APP_DESCRIPTION =
  'Seguí tu carrera, tus correlativas, tus horarios y las reseñas de profesores en un solo lugar.';

/**
 * URL canónica absoluta del sitio en producción.
 * Usada para metadatos Open Graph, Twitter cards y enlaces canónicos.
 * Si cambia el dominio, debe actualizarse este valor y los meta tags en index.html.
 */
export const SITE_URL = 'https://corre-ten.vercel.app';

/**
 * Paleta de colores oficial de la marca Stack
 */
export const BRAND_COLORS = {
  /** Índigo vibrante institucional */
  indigo: '#2A2E8A',
  /** Índigo profundo para fondos oscuros */
  indigoDeep: '#171A52',
  /** Ámbar de acento para la barra superior del logo y llamadas a la acción */
  amber: '#FFB938',
  /** Blanco azulado para bloques del isotipo y tipografías */
  slateLight: '#F4F5FB',
  /** Fondo base de la app */
  background: '#090D16',
} as const;

export type BrandColorName = keyof typeof BRAND_COLORS;

