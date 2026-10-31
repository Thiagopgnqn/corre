import React from 'react';
import { APP_NAME } from '../../config/brand';

export interface BrandLogoProps {
  /**
   * Variante de visualización:
   * - 'symbol': únicamente el isotipo vectorial (S de bloques).
   * - 'full': isotipo + palabra "Stack".
   * @default 'full'
   */
  variant?: 'symbol' | 'full';

  /**
   * Tamaño del logotipo:
   * - 'sm': ideal para botones compactos o barras reducidas.
   * - 'md': tamaño estándar de barra de navegación (h-8 o h-9).
   * - 'lg': ideal para pantallas de autenticación o tarjetas.
   * - 'xl': tamaño prominente para banners de bienvenida.
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';

  /**
   * Clases CSS opcionales adicionales para el contenedor
   */
  className?: string;

  /**
   * Clase CSS opcional para el texto "Stack" en variante full
   */
  textClassName?: string;

  /**
   * Si es true, oculta el texto en pantallas angostas (< 640px)
   * útil para el navbar responsivo
   */
  responsiveText?: boolean;
}

const SIZE_CONFIG = {
  sm: {
    symbolSize: 'w-7 h-7',
    textSize: 'text-base',
    gap: 'gap-2',
    rounded: 'rounded-lg',
  },
  md: {
    symbolSize: 'w-8 h-8 sm:w-9 sm:h-9',
    textSize: 'text-lg sm:text-xl',
    gap: 'gap-2.5',
    rounded: 'rounded-xl',
  },
  lg: {
    symbolSize: 'w-12 h-12 sm:w-14 sm:h-14',
    textSize: 'text-2xl sm:text-3xl',
    gap: 'gap-3',
    rounded: 'rounded-2xl',
  },
  xl: {
    symbolSize: 'w-16 h-16 sm:w-20 sm:h-20',
    textSize: 'text-4xl sm:text-5xl',
    gap: 'gap-4',
    rounded: 'rounded-3xl',
  },
} as const;

/**
 * Componente oficial de isotipo vectorial de Stack.
 * Proporciona escalabilidad nítida sin perder detalle a cualquier resolución.
 */
export const StackSymbol: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="stack-bg-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2A2E8A" />
          <stop offset="100%" stopColor="#171A52" />
        </linearGradient>
      </defs>
      {/* Fondo con bordes redondeados armónicos */}
      <rect width="512" height="512" rx="96" fill="url(#stack-bg-grad)" />

      {/* Bloques inferiores y centrales en blanco azulado */}
      <g fill="#F4F5FB">
        <rect x="136" y="140" width="44" height="116" rx="12" />
        <rect x="332" y="256" width="44" height="116" rx="12" />
        <rect x="136" y="234" width="240" height="44" rx="12" />
        <rect x="136" y="350" width="240" height="44" rx="12" />
      </g>

      {/* Barra superior de acento en ámbar */}
      <rect x="136" y="118" width="240" height="44" rx="12" fill="#FFB938" />
      <rect x="136" y="140" width="24" height="22" fill="#FFB938" />
    </svg>
  );
};

/**
 * Componente de marca oficial <BrandLogo />
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'full',
  size = 'md',
  className = '',
  textClassName = '',
  responsiveText = false,
}) => {
  const config = SIZE_CONFIG[size];

  return (
    <div
      role="img"
      aria-label={APP_NAME}
      className={`inline-flex items-center ${config.gap} shrink-0 select-none ${className}`}
    >
      <div
        className={`${config.symbolSize} ${config.rounded} shrink-0 shadow-md shadow-[#171A52]/50 flex items-center justify-center overflow-hidden transition-transform duration-200 hover:scale-[1.03]`}
      >
        <StackSymbol />
      </div>

      {variant === 'full' && (
        <span
          className={`font-black tracking-tight text-white ${config.textSize} leading-none ${
            responsiveText ? 'hidden sm:inline-block' : 'inline-block'
          } ${textClassName}`}
        >
          {APP_NAME}
        </span>
      )}
    </div>
  );
};

