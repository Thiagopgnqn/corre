import React from 'react';
import { Lock, Sparkles, Clock, CheckCircle2, Award, PlayCircle } from 'lucide-react';
import type { SubjectStatus } from '../../types/career';

interface StatusBadgeProps {
  status: SubjectStatus;
  grade?: number;
  size?: 'sm' | 'md' | 'lg';
  showGrade?: boolean;
}

export const STATUS_CONFIG: Record<
  SubjectStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    textColor: string;
    bgColor: string;
    borderColor: string;
    glowColor: string;
  }
> = {
  bloqueada: {
    label: 'Bloqueada',
    icon: Lock,
    textColor: 'text-slate-400',
    bgColor: 'bg-slate-900/80',
    borderColor: 'border-slate-700/60',
    glowColor: '',
  },
  disponible: {
    label: 'Disponible',
    icon: Sparkles,
    textColor: 'text-emerald-400',
    bgColor: 'bg-emerald-950/70',
    borderColor: 'border-emerald-500/50',
    glowColor: 'shadow-[0_0_12px_rgba(16,185,129,0.35)]',
  },
  cursando: {
    label: 'Cursando',
    icon: PlayCircle,
    textColor: 'text-cyan-400',
    bgColor: 'bg-cyan-950/70',
    borderColor: 'border-cyan-500/50',
    glowColor: 'shadow-[0_0_12px_rgba(6,182,212,0.35)]',
  },
  regularizada: {
    label: 'Regularizada',
    icon: Clock,
    textColor: 'text-amber-400',
    bgColor: 'bg-amber-950/70',
    borderColor: 'border-amber-500/50',
    glowColor: 'shadow-[0_0_10px_rgba(245,158,11,0.25)]',
  },
  aprobada: {
    label: 'Aprobada',
    icon: CheckCircle2,
    textColor: 'text-green-400',
    bgColor: 'bg-green-950/70',
    borderColor: 'border-green-500/50',
    glowColor: 'shadow-[0_0_12px_rgba(34,197,94,0.35)]',
  },
  promocionada: {
    label: 'Promocionada',
    icon: Award,
    textColor: 'text-purple-300',
    bgColor: 'bg-purple-950/70',
    borderColor: 'border-purple-500/50',
    glowColor: 'shadow-[0_0_14px_rgba(168,85,247,0.4)]',
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  grade,
  size = 'md',
  showGrade = true,
}) => {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3.5 py-1.5 gap-2 font-medium',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border transition-all duration-300 ${config.bgColor} ${config.textColor} ${config.borderColor} ${config.glowColor} ${sizeClasses[size]}`}
    >
      <Icon className={iconSizes[size]} />
      <span>{config.label}</span>
      {showGrade && grade !== undefined && (status === 'aprobada' || status === 'promocionada') && (
        <span className="ml-1 px-1.5 py-0.2 rounded bg-black/40 text-white font-bold border border-white/10">
          {grade}
        </span>
      )}
    </span>
  );
};
