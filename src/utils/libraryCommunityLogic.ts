/**
 * Utilidades y lógica de negocio pura para los Carteles de Comunidad de la Biblioteca:
 * 1. Cartel de Bienvenida (C1): verificación de primera visita, localStorage y coexistencia con el tutorial.
 * 2. Cartel de Descarga (C2): constantes de duración (10s), posicionamiento sobre la nav bar móvil y helpers.
 */

export const DOWNLOAD_TOAST_DURATION_MS = 10000;
export const DOWNLOAD_TOAST_MOBILE_BOTTOM_STYLE =
  'calc(var(--mobile-nav-height, 4rem) + env(safe-area-inset-bottom, 0px) + 12px)';
export const DOWNLOAD_TOAST_DESKTOP_BOTTOM_STYLE = '24px';

// Textos canónicos oficiales de los carteles de comunidad (Item 1)
export const COMMUNITY_TEXTS = {
  welcome: {
    title: 'La Biblioteca la hacemos entre todos',
    body:
      'Esto es una comunidad de estudiantes y va a ir creciendo con lo que aportemos cada uno. Si rendiste algo hace poco, tomate unos minutos y subí aunque sea 1 archivo: un parcial, un final, un resumen, un apunte, lo que tengas a mano, de cualquier materia. Con que cada uno ponga uno, la Biblioteca deja de estar vacía y le sirve a todos.',
    notePrefix:
      'Todo archivo se revisa antes de publicarse y se muestra como “Subido por un estudiante”. Subí solo material que puedas compartir. Más info en los ',
    noteLinkText: 'Términos',
    noteSuffix: '.',
    primaryButton: 'Subir un archivo',
    secondaryButton: 'Ahora no',
  },
  download: {
    title: '¡Listo, ya se está descargando!',
    body:
      'Este material lo subió otro estudiante. Si tenés algo para compartir, subí aunque sea 1 archivo de lo que tengas a mano y ayudá a que la Biblioteca siga creciendo.',
    primaryButton: 'Subir un archivo',
    closeLabel: 'Cerrar aviso',
  },
} as const;

export function getLibraryWelcomeStorageKey(userId?: string | null): string {
  return `stack:library-welcome-seen:${userId ? userId.trim() : 'anon'}`;
}

export interface ShouldShowWelcomeParams {
  isTutorialOpen: boolean;
  userId?: string | null;
  storage?: { getItem: (key: string) => string | null } | null;
}

/**
 * Determina si debe mostrarse el cartel de bienvenida a la biblioteca.
 * Regla:
 * - NO se muestra si el tutorial interactivo está activo.
 * - NO se muestra si la clave correspondiente en localStorage ya está en 'true'.
 * - SÍ se muestra en la primera visita.
 */
export function shouldShowLibraryWelcome({
  isTutorialOpen,
  userId,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
}: ShouldShowWelcomeParams): boolean {
  if (isTutorialOpen) {
    return false;
  }
  if (!storage) {
    return false;
  }
  const key = getLibraryWelcomeStorageKey(userId);
  const seen = storage.getItem(key);
  return seen !== 'true';
}

/**
 * Marca en localStorage que el usuario ya vio el cartel de bienvenida.
 */
export function markLibraryWelcomeSeen(
  userId?: string | null,
  storage: { setItem: (key: string, value: string) => void } | null = typeof localStorage !== 'undefined'
    ? localStorage
    : null
): void {
  if (!storage) return;
  const key = getLibraryWelcomeStorageKey(userId);
  storage.setItem(key, 'true');
}
