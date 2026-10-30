import React, { useState, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Star, X } from 'lucide-react';
import {
  formatRatingDecimal,
  getStarAriaLabel,
  handleStarRatingKeyDown,
} from '../../utils/professorRatingsLogic';

interface StarRatingProps {
  value: number;
  onChange?: (nextValue: number) => void;
  readOnly?: boolean;
  maxStars?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  label?: string;
  allowClear?: boolean;
  onClear?: () => void;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<StarRatingProps['size']>, string> = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-5 h-5',
  lg: 'w-7 h-7',
};

export const StarRating: React.FC<StarRatingProps> = ({
  value,
  onChange,
  readOnly = false,
  maxStars = 5,
  size = 'md',
  label = 'Calificación en estrellas',
  allowClear = false,
  onClear,
  className = '',
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const stars = Array.from({ length: maxStars }, (_, idx) => idx + 1);
  const sizeClass = SIZE_CLASSES[size];

  // Modo solo lectura (soporta relleno fraccionario suave)
  if (readOnly || !onChange) {
    const safeVal = Math.max(0, Math.min(maxStars, value || 0));
    const ariaText =
      safeVal > 0
        ? `Valoración: ${formatRatingDecimal(safeVal, 1)} de ${maxStars} estrellas`
        : 'Sin calificación';

    return (
      <div
        role="img"
        aria-label={ariaText}
        className={`inline-flex items-center gap-0.5 ${className}`}
      >
        {stars.map((star) => {
          const fillRatio = Math.max(0, Math.min(1, safeVal - (star - 1)));
          return (
            <span key={star} className="relative inline-flex shrink-0">
              <Star className={`${sizeClass} text-slate-700`} strokeWidth={2} />
              {fillRatio > 0 && (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${Math.round(fillRatio * 100)}%` }}
                >
                  <Star
                    className={`${sizeClass} text-amber-400 fill-amber-400`}
                    strokeWidth={2}
                  />
                </span>
              )}
            </span>
          );
        })}
      </div>
    );
  }

  // Modo interactivo accesible por teclado (WAI-ARIA radiogroup)
  const displayValue = hoveredStar !== null ? hoveredStar : value;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, starIndex: number) => {
    const current = value > 0 ? value : starIndex;
    const next = handleStarRatingKeyDown(e.key, current, 1, maxStars);
    if (next !== null) {
      e.preventDefault();
      onChange(next);
      const nextBtn = buttonRefs.current[next - 1];
      nextBtn?.focus();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && allowClear && onClear) {
      e.preventDefault();
      onClear();
    }
  };

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div
        role="radiogroup"
        aria-label={label}
        onMouseLeave={() => setHoveredStar(null)}
        className="inline-flex items-center gap-1"
      >
        {stars.map((star, idx) => {
          const isFilled = star <= displayValue;
          const isSelected = Math.round(value) === star;
          const isFocusable = value > 0 ? isSelected : star === 1;

          return (
            <motion.button
              key={star}
              ref={(el) => {
                buttonRefs.current[idx] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={getStarAriaLabel(star, maxStars)}
              tabIndex={isFocusable ? 0 : -1}
              whileHover={shouldReduceMotion ? undefined : { scale: 1.15 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}
              transition={{ duration: 0.14 }}
              onMouseEnter={() => setHoveredStar(star)}
              onClick={() => onChange(star)}
              onKeyDown={(e) => handleKeyDown(e, star)}
              className="p-0.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer transition-colors"
            >
              <Star
                className={`${sizeClass} transition-colors ${
                  isFilled
                    ? 'text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.35)]'
                    : 'text-slate-600 hover:text-slate-400'
                }`}
                strokeWidth={2}
              />
            </motion.button>
          );
        })}
      </div>

      {allowClear && value > 0 && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Quitar puntaje de ${label}`}
          title="Dejar sin responder"
          className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

