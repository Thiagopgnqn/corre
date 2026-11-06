import React, { useEffect, useRef } from 'react';
import { BookOpen, UploadCloud, X, Users } from 'lucide-react';
import { BottomSheet } from '../common/BottomSheet';
import { useIsMobile } from '../../hooks/useIsMobile';
import { COMMUNITY_TEXTS } from '../../utils/libraryCommunityLogic';

interface LibraryWelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenUpload: () => void;
  onOpenTerms?: () => void;
}

export const LibraryWelcomeModal: React.FC<LibraryWelcomeModalProps> = ({
  isOpen,
  onClose,
  onOpenUpload,
  onOpenTerms,
}) => {
  const isMobile = useIsMobile();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Foco accesible al abrir en escritorio
  useEffect(() => {
    if (isOpen && !isMobile) {
      const timer = setTimeout(() => {
        closeBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isMobile]);

  // Tecla Escape para cerrar en escritorio
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMobile, onClose]);

  if (!isOpen) return null;

  const handleUploadClick = () => {
    onClose();
    onOpenUpload();
  };

  const handleTermsClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onClose();
    if (onOpenTerms) {
      onOpenTerms();
    } else if (typeof window !== 'undefined') {
      window.location.hash = 'library/terms';
    }
  };

  const actionButtons = (
    <div className="flex flex-col-reverse min-[480px]:flex-row min-[480px]:items-center justify-end gap-2.5 w-full">
      <button
        type="button"
        onClick={onClose}
        className="w-full min-[480px]:w-auto px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer border border-slate-800/80"
      >
        {COMMUNITY_TEXTS.welcome.secondaryButton}
      </button>

      <button
        type="button"
        onClick={handleUploadClick}
        className="w-full min-[480px]:w-auto px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
      >
        <UploadCloud className="w-4 h-4" />
        <span>{COMMUNITY_TEXTS.welcome.primaryButton}</span>
      </button>
    </div>
  );

  const modalBody = (
    <div className="space-y-4 sm:space-y-5 text-slate-100">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0 shadow-inner mt-0.5">
          <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-400" />
        </div>
        <div className="space-y-1 min-w-0 flex-1">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-bold uppercase tracking-wider">
            <Users className="w-3 h-3 text-indigo-400" />
            Comunidad Estudiantil
          </div>
          <h2
            id="library-welcome-title"
            className="text-base sm:text-xl font-extrabold text-white tracking-tight leading-tight break-words"
          >
            {COMMUNITY_TEXTS.welcome.title}
          </h2>
        </div>
      </div>

      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed break-words">
        {COMMUNITY_TEXTS.welcome.body}
      </p>

      {/* Nota chica legal con link a Términos */}
      <p className="text-[11px] sm:text-xs text-slate-400 leading-normal border-l-2 border-indigo-500/50 pl-2.5 py-0.5 break-words">
        {COMMUNITY_TEXTS.welcome.notePrefix}
        <a
          href="#library/terms"
          onClick={handleTermsClick}
          className="text-indigo-400 hover:text-indigo-300 underline font-semibold transition-colors cursor-pointer"
        >
          {COMMUNITY_TEXTS.welcome.noteLinkText}
        </a>
        {COMMUNITY_TEXTS.welcome.noteSuffix}
      </p>

      {/* Botones de acción accesibles (en escritorio van dentro del cuerpo; en mobile van en el footer fijo del BottomSheet) */}
      {!isMobile && (
        <div className="pt-2 border-t border-slate-800/80">
          {actionButtons}
        </div>
      )}
    </div>
  );

  // En celular: renderizar dentro de BottomSheet con swipe to close y botones fijos en footer
  if (isMobile) {
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title="Bienvenida a la Biblioteca"
        maxHeightDvh={85}
        footer={actionButtons}
      >
        <div className="pb-2">{modalBody}</div>
      </BottomSheet>
    );
  }

  // En escritorio: modal centrado accesible con backdrop
  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-welcome-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Botón de cierre superior (X) accesible >= 44x44 */}
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar bienvenida"
          className="absolute top-4 right-4 min-w-[44px] min-h-[44px] rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {modalBody}
      </div>
    </div>
  );
};
