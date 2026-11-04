import React, { useEffect, useRef, useState, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Clase CSS adicional para el contenedor del sheet */
  className?: string;
  /** Altura máxima en porcentaje de dvh (por defecto 88) */
  maxHeightDvh?: number;
  /** Desactivar el botón X de cierre visible (por defecto false) */
  hideCloseButton?: boolean;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Pila global de capas activas para soportar sheets y modales anidados
const activeSheetStack: string[] = [];
let originalBodyOverflow = '';

export function getActiveLayersCount(): number {
  return activeSheetStack.length;
}

export function isTopLayer(id: string): boolean {
  return activeSheetStack[activeSheetStack.length - 1] === id;
}

export function registerLayer(id: string): number {
  if (typeof document !== 'undefined') {
    if (activeSheetStack.length === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  }
  const idx = activeSheetStack.indexOf(id);
  if (idx === -1) {
    activeSheetStack.push(id);
  }
  return activeSheetStack.indexOf(id);
}

export function unregisterLayer(id: string): void {
  const idx = activeSheetStack.indexOf(id);
  if (idx !== -1) {
    activeSheetStack.splice(idx, 1);
  }
  if (typeof document !== 'undefined') {
    if (activeSheetStack.length === 0) {
      document.body.style.overflow = originalBodyOverflow;
      originalBodyOverflow = '';
    }
  }
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className = '',
  maxHeightDvh = 88,
  hideCloseButton = false,
}) => {
  const generatedId = useId();
  const titleId = `bottom-sheet-title-${generatedId}`;
  const sheetRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Estado para el gesto de arrastre táctil (swipe down to close)
  const [dragOffset, setDragOffset] = useState(0);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);

  // 1. Gestión de capas anidadas y bloqueo global de scroll
  const [layerIndex, setLayerIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const idx = registerLayer(generatedId);
    setLayerIndex(idx);

    return () => {
      unregisterLayer(generatedId);
    };
  }, [isOpen, generatedId]);

  // 1. Gestión de foco: guardar foco previo y devolverlo al cerrar
  useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;

      // Enfocar el primer elemento interactivo o el sheet tras el render
      const timer = setTimeout(() => {
        if (!sheetRef.current) return;
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length > 0) {
          focusable[0]?.focus();
        } else {
          sheetRef.current.focus();
        }
      }, 50);

      return () => clearTimeout(timer);
    } else if (previousActiveElementRef.current) {
      previousActiveElementRef.current.focus?.();
    }
  }, [isOpen]);

  // 2. Trampa de foco (Focus Trap) y tecla Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Si hay capas anidadas, solo la capa superior responde a Escape y a la trampa de foco
      if (!isTopLayer(generatedId)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        if (!sheetRef.current) return;
        const focusables = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !sheetRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !sheetRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, generatedId]);

  // 4. Swipe to close mediante Pointer Events en la cabecera / drag-handle
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Solo inicia el gesto si se presiona el botón principal
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    // Solo permitimos arrastrar hacia abajo
    if (deltaY > 0) {
      setDragOffset(deltaY);
    } else {
      setDragOffset(0);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);

    // Si se arrastró más de 75px hacia abajo, cerramos; sino volvemos a 0
    if (dragOffset > 75) {
      onClose();
    }
    setDragOffset(0);
  };

  const handlePointerCancel = () => {
    isDraggingRef.current = false;
    setDragOffset(0);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          style={{ zIndex: `calc(var(--z-sheet) + ${layerIndex * 10})` }}
          className="fixed inset-0 flex flex-col justify-end pointer-events-auto pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]"
        >
          {/* Backdrop con tap para cerrar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 bg-black/75 backdrop-blur-sm cursor-pointer"
          />

          {/* Panel Bottom Sheet */}
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: dragOffset }}
            exit={{ y: '100%' }}
            transition={{
              type: 'spring',
              damping: 28,
              stiffness: 300,
              mass: 0.8,
            }}
            style={{
              maxHeight: `${maxHeightDvh}dvh`,
              touchAction: 'pan-y',
            }}
            className={`relative w-full rounded-t-3xl bg-slate-900 border-t border-slate-700/80 shadow-2xl flex flex-col overflow-hidden outline-none ${className}`}
          >
            {/* Cabecera interactiva con Handle para arrastrar */}
            <div
              ref={handleRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className="w-full pt-3 pb-2 px-4 cursor-grab active:cursor-grabbing select-none shrink-0 flex flex-col items-center border-b border-slate-800/80 bg-slate-900/90"
            >
              {/* Barra / Píldora de arrastre táctil */}
              <div
                aria-hidden="true"
                className="w-12 h-1.5 rounded-full bg-slate-600/80 hover:bg-slate-500 transition-colors mb-2"
              />

              {/* Título y botón cerrar */}
              <div className="w-full flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {title && (
                    <h2
                      id={titleId}
                      className="text-base font-bold text-white tracking-tight truncate"
                    >
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>
                  )}
                </div>

                {!hideCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar panel"
                    className="w-11 h-11 -mr-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors flex items-center justify-center cursor-pointer shrink-0 active:scale-95"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Contenido scrolleable con overscroll-behavior: contain para iOS */}
            <div
              style={{ overscrollBehavior: 'contain' }}
              className="flex-1 overflow-y-auto px-4 py-3 text-slate-200"
            >
              {children}
            </div>

            {/* Footer sticky dentro del sheet (resiste teclado virtual) */}
            {footer && (
              <div className="shrink-0 border-t border-slate-800/90 bg-slate-900/95 px-4 py-3 safe-area-pb">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

