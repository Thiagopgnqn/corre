import React from 'react';
import { Check, Loader2, CloudAlert } from 'lucide-react';

export type SyncStatus = 'saved' | 'saving' | 'error' | 'offline';

interface SyncStatusBadgeProps {
  status: SyncStatus;
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ status }) => {
  if (status === 'saving') {
    return (
      <div
        className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium animate-pulse shrink-0"
        title="Guardando cambios en Neon Cloud..."
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
        <span className="hidden lg:inline whitespace-nowrap">Guardando...</span>
      </div>
    );
  }

  if (status === 'error' || status === 'offline') {
    return (
      <div
        className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium shrink-0"
        title="Sin conexión al servidor, reintentando automáticamente..."
      >
        <CloudAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="hidden lg:inline whitespace-nowrap">Sin conexión</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 rounded-full bg-slate-800/60 border border-slate-700/50 text-slate-400 text-xs font-medium shrink-0"
      title="Todos los cambios están guardados en tu cuenta"
    >
      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      <span className="hidden lg:inline whitespace-nowrap">Guardado</span>
    </div>
  );
};
