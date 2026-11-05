/**
 * Reglas de disponibilidad para el Armador de Horarios.
 *
 * El armador de horarios solo se encuentra disponible en pantallas de escritorio
 * o tablets en horizontal (ancho >= 1024px). En celulares o tablets en vertical,
 * se bloquea su montaje y se presenta una pantalla de aviso accesible.
 */

export const SCHEDULE_MIN_DESKTOP_WIDTH = 1024;
export const SCHEDULE_TABLET_SHORT_SIDE_MIN = 600;

export type ScheduleAvailability = 'available' | 'wider-needed' | 'desktop-only';

/**
 * Función pura que evalúa la disponibilidad del armador a partir de las dimensiones de la pantalla.
 *
 * @param width Ancho visible en px (CSS pixels)
 * @param height Alto visible en px (CSS pixels)
 * @returns 'available' | 'wider-needed' | 'desktop-only'
 */
export function getScheduleAvailability(width: number, height: number): ScheduleAvailability {
  if (width >= SCHEDULE_MIN_DESKTOP_WIDTH) {
    return 'available';
  }

  const shortSide = Math.min(width, height);
  if (shortSide >= SCHEDULE_TABLET_SHORT_SIDE_MIN) {
    return 'wider-needed';
  }

  return 'desktop-only';
}

/**
 * Devuelve el mensaje explicativo oficial según el motivo de indisponibilidad.
 */
export function getScheduleUnavailableMessage(
  availability: 'wider-needed' | 'desktop-only'
): string {
  if (availability === 'wider-needed') {
    return 'El armador de horarios necesita una pantalla más ancha. Si estás en una tablet, girala en horizontal; si estás en una computadora, agrandá la ventana o bajá el zoom del navegador.';
  }
  return 'El armador de horarios solo está disponible en computadora, porque necesita una pantalla grande para comparar comisiones y ver la semana completa. Entrá a Stack desde una PC para usarlo.';
}

