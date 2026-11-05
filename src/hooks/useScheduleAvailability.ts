import { useState, useEffect } from 'react';
import {
  getScheduleAvailability,
  getScheduleUnavailableMessage,
  type ScheduleAvailability,
} from '../utils/scheduleAvailability';

export interface UseScheduleAvailabilityResult {
  availability: ScheduleAvailability;
  isAvailable: boolean;
  message: string | null;
  width: number;
  height: number;
}

/**
 * Hook reactivo para evaluar si el armador de horarios puede mostrarse
 * en base a las dimensiones reales del viewport y la orientación del dispositivo.
 */
export function useScheduleAvailability(): UseScheduleAvailabilityResult {
  const [dimensions, setDimensions] = useState(() => {
    if (typeof window === 'undefined') {
      return { width: 1280, height: 800 };
    }
    return { width: window.innerWidth, height: window.innerHeight };
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateDimensions();

    window.addEventListener('resize', updateDimensions);
    window.addEventListener('orientationchange', updateDimensions);

    // Soporte adicional para matchMedia screen orientation si está soportado
    let orientationMediaQuery: MediaQueryList | null = null;
    try {
      orientationMediaQuery = window.matchMedia('(orientation: portrait)');
      orientationMediaQuery.addEventListener('change', updateDimensions);
    } catch {}

    return () => {
      window.removeEventListener('resize', updateDimensions);
      window.removeEventListener('orientationchange', updateDimensions);
      if (orientationMediaQuery) {
        try {
          orientationMediaQuery.removeEventListener('change', updateDimensions);
        } catch {}
      }
    };
  }, []);

  const availability = getScheduleAvailability(dimensions.width, dimensions.height);
  const isAvailable = availability === 'available';
  const message = !isAvailable
    ? getScheduleUnavailableMessage(availability as 'wider-needed' | 'desktop-only')
    : null;

  return {
    availability,
    isAvailable,
    message,
    width: dimensions.width,
    height: dimensions.height,
  };
}

