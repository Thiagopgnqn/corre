import React, { useEffect, useState, useRef } from 'react';
import { UploadCloud, X, Sparkles, HeartHandshake } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  DOWNLOAD_TOAST_DURATION_MS,
  DOWNLOAD_TOAST_MOBILE_BOTTOM_STYLE,
  DOWNLOAD_TOAST_DESKTOP_BOTTOM_STYLE,
  COMMUNITY_TEXTS,
} from '../../utils/libraryCommunityLogic';

interface LibraryDownloadToastProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: () => void;
}

export const LibraryDownloadToast: React.FC<LibraryDownloadToastProps> = ({
  isOpen,
  onClose,
  onUpload,
}) => {
  const isMobile = useIsMobile();
  const [isPaused, setIsPaused] = useState(false);
  const remainingTimeRef = useRef<number>(DOWNLOAD_TOAST_DURATION_MS);
  const startTimeRef = useRef<number>(Date.now());
  const timerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gestión de temporizador de 10 segundos con pausa al hover o foco
  useEffect(() => {
    if (!isOpen) {
      remainingTimeRef.current = DOWNLOAD_TOAST_DURATION_MS;
      if (timerIdRef.current) clearTimeout(timerIdRef.current);
      return;
    }

    if (isPaused) {
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
      const elapsed = Date.now() - startTimeRef.current;
      remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
    } else {
      startTimeRef.current = Date.now();
      timerIdRef.current = setTimeout(() => {
        onClose();
      }, remainingTimeRef.current);
    }

    return () => {
      if (timerIdRef.current) clearTimeout(timerIdRef.current);
    };
  }, [isOpen, isPaused, onClose]);

  if (!isOpen) return null;

  const handleUploadClick = () => {
    onClose();
    onUpload();
  };

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="Aviso de contribución comunitaria"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={() => setIsPaused(false)}
      style={{
        bottom: isMobile
          ? DOWNLOAD_TOAST_MOBILE_BOTTOM_STYLE
          : DOWNLOAD_TOAST_DESKTOP_BOTTOM_STYLE,
      }}
      className="fixed left-3 right-3 sm:left-auto sm:right-6 sm:w-[420px] max-w-[calc(100vw-1.5rem)] z-[var(--z-toast,1300)] pointer-events-auto bg-slate-900/95 backdrop-blur-xl border border-indigo-500/40 rounded-2xl p-4 sm:p-5 shadow-2xl text-slate-100 flex flex-col gap-3 animate-in slide-in-from-bottom-4 duration-200"
    >
      {/* Cabecera del cartel con badge y botón cerrar >= 44x44 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <HeartHandshake className="w-4 h-4 text-indigo-400" />
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-400" />
            Comunidad Stack
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={COMMUNITY_TEXTS.download.closeLabel}
          className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Título y Mensaje Oficial */}
      <div className="space-y-1">
        <h3 className="text-sm sm:text-base font-extrabold text-white leading-tight">
          {COMMUNITY_TEXTS.download.title}
        </h3>
        <p className="text-xs text-slate-300 leading-relaxed break-words">
          {COMMUNITY_TEXTS.download.body}
        </p>
      </div>

      {/* Botón de acción */}
      <div className="pt-1 flex items-center justify-end">
        <button
          type="button"
          onClick={handleUploadClick}
          className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <UploadCloud className="w-4 h-4" />
          <span>{COMMUNITY_TEXTS.download.primaryButton}</span>
        </button>
      </div>
    </aside>
  );
};
