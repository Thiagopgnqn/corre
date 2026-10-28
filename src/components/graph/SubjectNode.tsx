import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import {
  Lock,
  Sparkles,
  PlayCircle,
  Clock,
  CheckCircle2,
  Award,
  BookOpen,
} from 'lucide-react';
import type { Subject, SubjectStatus } from '../../types/career';

export interface SubjectNodeData {
  subject: Subject;
  status: SubjectStatus;
  grade?: number;
  isSelected?: boolean;
  isHovered?: boolean;
  isPrereqHighlight?: boolean; // Highlighted as prerequisite (upstream)
  isUnlockHighlight?: boolean; // Highlighted as dependent (downstream)
  isDimmed?: boolean;
  onOpenStatusModal?: (id: number) => void;
  [key: string]: unknown;
}

export const SubjectNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as SubjectNodeData;
  const {
    subject,
    status,
    grade,
    isSelected,
    isHovered,
    isPrereqHighlight,
    isUnlockHighlight,
    isDimmed,
    onOpenStatusModal,
  } = nodeData;

  // Status visual configurations
  const statusStyles: Record<
    SubjectStatus,
    {
      border: string;
      glow: string;
      bg: string;
      icon: React.ComponentType<{ className?: string }>;
      color: string;
    }
  > = {
    bloqueada: {
      border: 'border-slate-800/90',
      glow: '',
      bg: 'bg-slate-900/80',
      icon: Lock,
      color: 'text-slate-500',
    },
    disponible: {
      border: 'border-emerald-500/60',
      glow: 'shadow-[0_0_18px_rgba(16,185,129,0.35)] animate-pulse',
      bg: 'bg-slate-900/95',
      icon: Sparkles,
      color: 'text-emerald-400',
    },
    cursando: {
      border: 'border-cyan-500/70',
      glow: 'shadow-[0_0_18px_rgba(6,182,212,0.4)]',
      bg: 'bg-slate-900/95',
      icon: PlayCircle,
      color: 'text-cyan-400',
    },
    regularizada: {
      border: 'border-amber-500/70',
      glow: 'shadow-[0_0_16px_rgba(245,158,11,0.3)]',
      bg: 'bg-slate-900/95',
      icon: Clock,
      color: 'text-amber-400',
    },
    aprobada: {
      border: 'border-green-500/80',
      glow: 'shadow-[0_0_18px_rgba(34,197,94,0.35)]',
      bg: 'bg-slate-900/95',
      icon: CheckCircle2,
      color: 'text-green-400',
    },
    promocionada: {
      border: 'border-purple-500/80',
      glow: 'shadow-[0_0_20px_rgba(168,85,247,0.45)]',
      bg: 'bg-slate-900/95',
      icon: Award,
      color: 'text-purple-300',
    },
  };

  const style = statusStyles[status] || statusStyles.bloqueada;
  const Icon = style.icon;

  // Highlight classes
  let highlightClass = '';
  if (isSelected) {
    highlightClass = 'ring-2 ring-indigo-400 shadow-[0_0_25px_rgba(99,102,241,0.6)] scale-[1.03]';
  } else if (isPrereqHighlight) {
    highlightClass = 'ring-2 ring-cyan-400 shadow-[0_0_22px_rgba(6,182,212,0.6)] scale-[1.02]';
  } else if (isUnlockHighlight) {
    highlightClass = 'ring-2 ring-emerald-400 shadow-[0_0_22px_rgba(16,185,129,0.6)] scale-[1.02]';
  } else if (isHovered) {
    highlightClass = 'ring-1 ring-slate-400 shadow-[0_0_15px_rgba(255,255,255,0.2)]';
  }

  const dimClass = isDimmed ? 'opacity-25 grayscale-[60%] blur-[0.2px]' : 'opacity-100';

  const isElective = subject.isElective;

  return (
    <div
      className={`relative w-[230px] sm:w-[245px] rounded-xl border backdrop-blur-md transition-all duration-300 select-none cursor-pointer ${
        style.bg
      } ${
        isElective
          ? 'border-dashed border-amber-400/70 shadow-[0_0_12px_rgba(251,191,36,0.25)]'
          : style.border
      } ${style.glow} ${highlightClass} ${dimClass}`}
    >
      {/* Target Handle on the Left (prerequisites come here) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-indigo-400 !border-2 !border-slate-900 transition-transform hover:!scale-150"
      />

      <div className="p-3 flex flex-col justify-between min-h-[110px]">
        {/* Top bar: Code, Level, Modality, Status Icon */}
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 shrink-0">
              #{subject.code}
            </span>
            <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">
              N{subject.level}
            </span>
            <span className="text-[10px] font-semibold text-slate-400 bg-slate-800/60 px-1 py-0.5 rounded shrink-0">
              {subject.modality}
            </span>
            {subject.isIntegrator && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                INT
              </span>
            )}
            {isElective && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                ELECT
              </span>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenStatusModal?.(subject.id);
            }}
            className={`p-1 rounded-md hover:bg-slate-800 transition-colors shrink-0 ${style.color}`}
            title="Cambiar estado"
          >
            <Icon className="w-4 h-4" />
          </button>
        </div>

        {/* Subject Name: Fully readable, no line clipping */}
        <h3 className="font-bold text-xs sm:text-[13px] text-white leading-snug break-words my-1">
          {subject.name}
        </h3>

        {/* Bottom bar: Hours / Credits & Grade */}
        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-800/80 text-[11px]">
          <span className="text-slate-400 flex items-center gap-1 shrink-0">
            <BookOpen className="w-3 h-3 text-slate-500 shrink-0" />
            <span className="whitespace-nowrap">{subject.weeklyHours} hs</span>
            {subject.credits && (
              <span className="text-amber-400/90 font-medium whitespace-nowrap ml-0.5">({subject.credits}cr)</span>
            )}
          </span>

          {grade !== undefined && (status === 'aprobada' || status === 'promocionada') ? (
            <span
              className={`px-1.5 py-0.2 rounded font-mono font-bold text-xs whitespace-nowrap shrink-0 ${
                status === 'promocionada'
                  ? 'bg-purple-900/60 text-purple-200 border border-purple-500/40'
                  : 'bg-emerald-900/60 text-emerald-200 border border-emerald-500/40'
              }`}
            >
              Nota: {grade}
            </span>
          ) : (
            <span className={`text-[10px] capitalize font-medium whitespace-nowrap shrink-0 ${style.color}`}>
              {status}
            </span>
          )}
        </div>
      </div>

      {/* Source Handle on the Right (what this subject unlocks) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-slate-900 transition-transform hover:!scale-150"
      />
    </div>
  );
});

SubjectNode.displayName = 'SubjectNode';
