import { useState, useEffect } from 'react';

export interface DeviceCapabilities {
  /** Pantalla móvil (< 768px, consistente con Tailwind md) */
  isMobile: boolean;
  /** Dispositivo puramente táctil sin puntero fino (mouse) */
  isTouch: boolean;
  /** Teléfono en orientación horizontal con poca altura (< 500px) */
  isShortLandscape: boolean;
}

const MOBILE_MEDIA_QUERY = '(max-width: 767.98px)';
const TOUCH_MEDIA_QUERY = '(hover: none) and (pointer: coarse)';
const SHORT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';

function getSnapshot(): DeviceCapabilities {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return {
      isMobile: false,
      isTouch: false,
      isShortLandscape: false,
    };
  }

  return {
    isMobile: window.matchMedia(MOBILE_MEDIA_QUERY).matches,
    isTouch: window.matchMedia(TOUCH_MEDIA_QUERY).matches,
    isShortLandscape: window.matchMedia(SHORT_LANDSCAPE_QUERY).matches,
  };
}

/**
 * Hook reactivo para consultar capacidades del dispositivo y breakpoints clave.
 * Usar preferentemente clases de Tailwind (md:, lg:) para layout;
 * usar este hook para cambios de comportamiento lógico (ej. modales vs sheets).
 */
export function useDeviceCapabilities(): DeviceCapabilities {
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>(getSnapshot);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mqlMobile = window.matchMedia(MOBILE_MEDIA_QUERY);
    const mqlTouch = window.matchMedia(TOUCH_MEDIA_QUERY);
    const mqlLandscape = window.matchMedia(SHORT_LANDSCAPE_QUERY);

    const updateSnapshot = () => {
      setCapabilities({
        isMobile: mqlMobile.matches,
        isTouch: mqlTouch.matches,
        isShortLandscape: mqlLandscape.matches,
      });
    };

    updateSnapshot();

    const addListener = (mql: MediaQueryList) => {
      if (mql.addEventListener) {
        mql.addEventListener('change', updateSnapshot);
      } else {
        mql.addListener(updateSnapshot);
      }
    };

    const removeListener = (mql: MediaQueryList) => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', updateSnapshot);
      } else {
        mql.removeListener(updateSnapshot);
      }
    };

    addListener(mqlMobile);
    addListener(mqlTouch);
    addListener(mqlLandscape);

    // Soporte adicional a resize para navegadores antiguos
    window.addEventListener('resize', updateSnapshot);

    return () => {
      removeListener(mqlMobile);
      removeListener(mqlTouch);
      removeListener(mqlLandscape);
      window.removeEventListener('resize', updateSnapshot);
    };
  }, []);

  return capabilities;
}

/**
 * Hook booleano directo para saber si la vista actual es móvil (< 768px)
 */
export function useIsMobile(): boolean {
  const { isMobile } = useDeviceCapabilities();
  return isMobile;
}

