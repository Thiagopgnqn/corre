import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, Mail, ChevronRight } from 'lucide-react';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_DESCRIPTION,
  CONTACT_EMAIL,
} from '../../config/brand';
import { BrandLogo } from './BrandLogo';
import { CreatorCredit } from './CreatorCredit';
import { BottomSheet } from './BottomSheet';
import { useIsMobile } from '../../hooks/useIsMobile';

export interface AboutStackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTerms?: () => void;
}

export const AboutStackModal: React.FC<AboutStackModalProps> = ({
  isOpen,
  onClose,
  onNavigateTerms,
}) => {
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isOpen || isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMobile, onClose]);

  if (!isOpen) return null;

  const handleOpenTerms = (e: React.MouseEvent) => {
    e.preventDefault();
    onClose();
    if (onNavigateTerms) {
      onNavigateTerms();
    } else if (typeof window !== 'undefined') {
      window.location.hash = 'library/terms';
    }
  };

  const content = (
    <div className="space-y-3.5 text-slate-200 min-w-0 max-w-full">
      {/* Identidad de la app */}
      <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/90 flex items-start gap-3.5 min-w-0">
        <div className="shrink-0 mt-0.5">
          <BrandLogo variant="symbol" size="md" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
            {APP_NAME}
          </h3>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-wide mt-0.5">
            {APP_TAGLINE}
          </p>
          <p className="text-xs text-slate-300 leading-relaxed mt-1.5 break-words">
            {APP_DESCRIPTION}
          </p>
        </div>
      </div>

      {/* Constancia de autoría */}
      <CreatorCredit variant="card" />

      {/* Enlaces útiles: Términos de la Biblioteca y Mail de Contacto */}
      <div className="space-y-2 pt-0.5">
        <a
          href="#library/terms"
          onClick={handleOpenTerms}
          className="w-full min-h-[48px] px-3.5 py-2.5 rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/70 flex items-center justify-between gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0 text-indigo-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs sm:text-sm font-semibold text-white break-words">
                Términos y Condiciones de la Biblioteca
              </div>
              <div className="text-[11px] text-slate-400 break-words">
                Normas de convivencia, privacidad y derechos de autor
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </a>

        <a
          href={`mailto:${CONTACT_EMAIL}`}
          aria-label={`Enviar correo de contacto a ${CONTACT_EMAIL}`}
          className="w-full min-h-[48px] px-3.5 py-2.5 rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/70 flex items-center justify-between gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400">
              <Mail className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-slate-400">
                Contacto y soporte oficial
              </div>
              <div className="text-xs sm:text-sm font-semibold text-white break-all">
                {CONTACT_EMAIL}
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </a>
      </div>
    </div>
  );

  const modalNode = isMobile ? (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={`Acerca de ${APP_NAME}`}
      subtitle={APP_TAGLINE}
      maxHeightDvh={88}
    >
      <div className="py-1">{content}</div>
    </BottomSheet>
  ) : (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-stack-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-[var(--z-modal-elevated)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden text-slate-100"
      >
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 id="about-stack-modal-title" className="text-base font-bold text-white">
              Acerca de {APP_NAME}
            </h2>
            <p className="text-xs text-slate-400">{APP_TAGLINE}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana Acerca de Stack"
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">{content}</div>

        <div className="px-5 py-3.5 border-t border-slate-800/80 bg-slate-950/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalNode, document.body);
  }

  return modalNode;
};

