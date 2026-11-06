import React from 'react';
import { ExternalLink, Code2 } from 'lucide-react';
import { CREATOR_NAME, CREATOR_URL, resolveCreatorUrl } from '../../config/brand';

export interface CreatorCreditProps {
  variant?: 'inline' | 'card';
  creatorName?: string;
  creatorUrl?: string | null;
  className?: string;
}

export const CreatorCredit: React.FC<CreatorCreditProps> = ({
  variant = 'inline',
  creatorName = CREATOR_NAME,
  creatorUrl = CREATOR_URL,
  className = '',
}) => {
  const validUrl = resolveCreatorUrl(creatorUrl);

  if (variant === 'card') {
    return (
      <div
        data-testid="creator-credit-card"
        className={`w-full min-w-0 max-w-full rounded-2xl bg-slate-950/70 border border-slate-800/90 p-3.5 sm:p-4 flex items-center justify-between gap-3 ${className}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0 text-indigo-400">
            <Code2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Desarrollo y Diseño
            </p>
            <div className="text-xs sm:text-sm text-slate-200 font-medium flex flex-wrap items-center gap-1 break-words">
              <span>Hecho por</span>
              {validUrl ? (
                <a
                  href={validUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Visitar el sitio web de ${creatorName} (se abre en una nueva pestaña)`}
                  className="min-h-[44px] px-1.5 -mx-1 inline-flex items-center gap-1.5 font-bold text-indigo-300 hover:text-indigo-200 underline decoration-indigo-500/50 underline-offset-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-lg cursor-pointer"
                >
                  <span>{creatorName}</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                </a>
              ) : (
                <span className="font-bold text-white">{creatorName}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="creator-credit-inline"
      className={`w-full min-w-0 max-w-full flex flex-wrap items-center justify-center text-center text-xs text-slate-300 leading-relaxed break-words ${className}`}
    >
      {validUrl ? (
        <a
          href={validUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Hecho por ${creatorName} — Visitar sitio web (se abre en una nueva pestaña)`}
          className="min-h-[44px] px-3 py-2 inline-flex flex-wrap items-center justify-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-xl cursor-pointer"
        >
          <span>Hecho por</span>
          <span className="font-semibold text-indigo-300 hover:text-indigo-200 underline decoration-indigo-500/40 underline-offset-4">
            {creatorName}
          </span>
          <ExternalLink className="w-3 h-3 shrink-0 text-indigo-400/80" />
        </a>
      ) : (
        <span className="min-h-[44px] px-3 py-2 inline-flex flex-wrap items-center justify-center gap-1 text-xs text-slate-300">
          <span>Hecho por</span>
          <span className="font-semibold text-slate-100">{creatorName}</span>
        </span>
      )}
    </div>
  );
};

