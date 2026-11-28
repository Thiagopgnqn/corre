import React from 'react';
import { createPortal } from 'react-dom';
import { Lock, ArrowRight, X } from 'lucide-react';
import { useAuth, type OpenLoginOptions } from '../../context/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BottomSheet } from '../common/BottomSheet';

export interface LoginPromptModalViewProps {
  isOpen: boolean;
  isMobile: boolean;
  onClose: () => void;
  actionLabel: string;
  description?: string;
  returnToHash?: string;
  onOpenLogin: (options?: OpenLoginOptions) => void;
}

export const LoginPromptModalView: React.FC<LoginPromptModalViewProps> = ({
  isOpen,
  isMobile,
  onClose,
  actionLabel,
  description,
  returnToHash,
  onOpenLogin,
}) => {
  const headline = `Iniciá sesión para ${actionLabel}`;
  const resolvedDescription =
    description ||
    'Creá una cuenta gratuita o ingresá para guardar tu progreso, descargar material y publicar reseñas.';

  const handleProceedLogin = (mode: 'login' | 'register') => {
    onClose();
    onOpenLogin({ returnToHash, mode });
  };

  const actionsContent = (
    <div className="space-y-2.5 pt-2">
      <button
        type="button"
        onClick={() => handleProceedLogin('login')}
        className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-gradient-to-r from-[#2A2E8A] to-[#171A52] hover:from-[#353AA8] hover:to-[#1E2269] text-white text-sm font-semibold border border-indigo-400/30 shadow-lg shadow-[#171A52]/50 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
      >
        <span>Iniciar sesión</span>
        <ArrowRight className="w-4 h-4 text-amber-400 shrink-0" />
      </button>

      <button
        type="button"
        onClick={() => handleProceedLogin('register')}
        className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-semibold border border-slate-700 transition-colors cursor-pointer"
      >
        Crear cuenta gratis
      </button>

      <button
        type="button"
        onClick={onClose}
        className="w-full min-h-[44px] px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/40 text-xs font-medium transition-colors cursor-pointer"
      >
        Seguir explorando sin cuenta
      </button>
    </div>
  );

  if (isMobile) {
    const sheetNode = (
      <BottomSheet isOpen={isOpen} onClose={onClose} title={headline}>
        <div className="space-y-3 py-2">
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{resolvedDescription}</p>
          {actionsContent}
        </div>
      </BottomSheet>
    );
    return typeof document !== 'undefined' && document.body
      ? createPortal(sheetNode, document.body)
      : sheetNode;
  }

  if (!isOpen) return null;

  const modalNode = (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={headline}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700/80 p-6 text-slate-100 shadow-2xl relative"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar aviso"
          className="absolute top-3.5 right-3.5 w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3 pr-10 mb-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-snug">{headline}</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{resolvedDescription}</p>
          </div>
        </div>

        {actionsContent}
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modalNode, document.body)
    : modalNode;
};

export interface LoginPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionLabel: string;
  description?: string;
  returnToHash?: string;
}

export const LoginPromptModal: React.FC<LoginPromptModalProps> = (props) => {
  const { openLogin } = useAuth();
  const isMobile = useIsMobile();
  return <LoginPromptModalView {...props} isMobile={isMobile} onOpenLogin={openLogin} />;
};
