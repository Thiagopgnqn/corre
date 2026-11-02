import { useState, useEffect } from 'react';

/**
 * Detecta si el dispositivo del usuario es puramente táctil sin puntero fino (mouse)
 * utilizando las media queries oficiales CSS: (hover: none) and (pointer: coarse).
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(hover: none) and (pointer: coarse)');
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches);

    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, []);

  return isTouch;
}

