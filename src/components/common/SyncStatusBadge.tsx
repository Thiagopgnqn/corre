import React from 'react';
import { Check, Loader2, CloudAlert } from 'lucide-react';

export type SyncStatus = 'saved' | 'saving' | 'error' | 'offline';

interface SyncStatusBadgeProps {
  status: SyncStatus;
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ status }) => {
  if (status === 'saving') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium animate-pulse">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        <span className="hidden sm:inline">Guardando...</span>
      </div>
    );
  }

  if (status === 'error' || status === 'offline') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
        <CloudAlert className="w-3.5 h-3.5 text-amber-400" />
        <span className="hidden sm:inline">Sin conexión, reintentando</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/60 border border-slate-700/50 text-slate-400 text-xs font-medium">
      <Check className="w-3.5 h-3.5 text-emerald-400" />
      <span className="hidden sm:inline">Guardado</span>
    </div>
  );
};
