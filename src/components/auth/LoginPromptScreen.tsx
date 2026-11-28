import React from 'react';
import { BarChart3, CalendarDays, Compass, Kanban, Lock, Sparkles, ArrowRight } from 'lucide-react';
import { useAuth, type OpenLoginOptions } from '../../context/AuthContext';

export type ProtectedPromptView = 'stats' | 'schedule' | 'kanban' | 'planner' | 'electives';

export const LOGIN_PROMPT_COPY: Record<
  ProtectedPromptView,
  {
    headline: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  stats: {
    headline: 'Iniciá sesión para ver tus estadísticas académicas',
    description:
      'Registrate o ingresá con tu cuenta para seguir tu promedio, porcentaje de avance, horas semanales y camino crítico.',
    icon: BarChart3,
  },
  schedule: {
    headline: 'Iniciá sesión para armar tus horarios',
    description:
      'Ingresá con tu cuenta para seleccionar comisiones, detectar superposiciones horarias y guardar propuestas de cursada.',
    icon: CalendarDays,
  },
  kanban: {
    headline: 'Iniciá sesión para organizar tu cursada en el tablero',
    description:
      'Ingresá con tu cuenta para mover materias por estado, cargar notas y sincronizar tu progreso en la nube.',
    icon: Kanban,
  },
  planner: {
    headline: 'Iniciá sesión para planificar tu cuatrimestre',
    description:
      'Ingresá con tu cuenta para armar tu canasta cuatrimestral, estimar carga horaria y proyectar tus próximas cursadas.',
    icon: Compass,
  },
  electives: {
    headline: 'Iniciá sesión para elegir tus materias electivas',
    description:
      'Ingresá con tu cuenta para distribuir créditos electivos por nivel y seguir el requisito de tu plan.',
    icon: Sparkles,
  },
};

export interface LoginPromptScreenViewProps {
  view: ProtectedPromptView;
  onOpenLogin: (options?: OpenLoginOptions) => void;
  onBackToMap?: () => void;
}

export const LoginPromptScreenView: React.FC<LoginPromptScreenViewProps> = ({
  view,
  onOpenLogin,
  onBackToMap,
}) => {
  const copy = LOGIN_PROMPT_COPY[view];
  const Icon = copy.icon;
  const returnToHash = `#${view}`;

  return (
    <div className="flex-1 flex items-center justify-center p-4 sm:p-8 min-h-[calc(100dvh-10rem)]">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center relative">
          <Icon className="w-7 h-7 text-indigo-400" />
          <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-slate-950 border border-slate-700 flex items-center justify-center">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
          </span>
        </div>

        <h2 className="text-lg sm:text-xl font-bold text-white mb-2">{copy.headline}</h2>
        <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mb-6">{copy.description}</p>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => onOpenLogin({ returnToHash, mode: 'login' })}
            className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-gradient-to-r from-[#2A2E8A] to-[#171A52] hover:from-[#353AA8] hover:to-[#1E2269] text-white text-sm font-semibold border border-indigo-400/30 shadow-lg shadow-[#171A52]/50 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <span>Iniciar sesión</span>
            <ArrowRight className="w-4 h-4 text-amber-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => onOpenLogin({ returnToHash, mode: 'register' })}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            Crear cuenta gratis
          </button>

          {onBackToMap && (
            <button
              type="button"
              onClick={onBackToMap}
              className="w-full min-h-[44px] px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/40 text-xs font-medium transition-colors cursor-pointer"
            >
              Volver al Mapa de Correlativas
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export interface LoginPromptScreenProps {
  view: ProtectedPromptView;
  onBackToMap?: () => void;
}

export const LoginPromptScreen: React.FC<LoginPromptScreenProps> = ({ view, onBackToMap }) => {
  const { openLogin } = useAuth();
  return <LoginPromptScreenView view={view} onOpenLogin={openLogin} onBackToMap={onBackToMap} />;
};
