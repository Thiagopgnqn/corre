import React, { useMemo, useState } from 'react';
import { BookOpen, Eye, Layers, Link2, Search, ShieldCheck, X } from 'lucide-react';
import type { ActivePlanCatalog, Subject } from '../../../types/career';
import type {
  AdminPlanSharedBindingItem,
  AdminSharedSubjectDecision,
  AdminSharedSubjectSuggestion,
} from '../../../api/admin.api';
import {
  formatModalityLabel,
  formatSubjectCodeLabel,
  getPlanStatusBadgeStyle,
  groupCatalogSubjectsByLevel,
} from './adminCareersHelpers';

interface AdminPlanReadOnlyViewerProps {
  catalog: ActivePlanCatalog;
  title?: string;
  subtitle?: string;
  planStatus?: string;
  activeUsersCount?: number;
  sharedBindings?: AdminPlanSharedBindingItem[];
  sharedSuggestions?: AdminSharedSubjectSuggestion[];
  sharedDecisions?: Record<number, AdminSharedSubjectDecision | null>;
  onClose?: () => void;
}

export const AdminPlanReadOnlyViewer: React.FC<AdminPlanReadOnlyViewerProps> = ({
  catalog,
  title,
  subtitle,
  planStatus,
  activeUsersCount,
  sharedBindings,
  sharedSuggestions,
  sharedDecisions,
  onClose,
}) => {
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const subjectMap = useMemo(
    () => new Map<number, Subject>(catalog.subjects.map((s) => [s.id, s])),
    [catalog.subjects]
  );

  const acronymsBySubjectCode = useMemo(() => {
    const out = new Map<number, string[]>();
    for (const [acronym, code] of Object.entries(catalog.acronyms || {})) {
      const list = out.get(code) || [];
      list.push(acronym);
      out.set(code, list);
    }
    return out;
  }, [catalog.acronyms]);

  const bindingByCode = useMemo(() => {
    const map = new Map<number, AdminPlanSharedBindingItem>();
    for (const b of sharedBindings || []) {
      map.set(b.codeInPlan, b);
    }
    return map;
  }, [sharedBindings]);

  const suggestionByCode = useMemo(() => {
    const map = new Map<number, AdminSharedSubjectSuggestion>();
    for (const s of sharedSuggestions || []) {
      map.set(s.subjectCode, s);
    }
    return map;
  }, [sharedSuggestions]);

  const levelGroups = useMemo(
    () => groupCatalogSubjectsByLevel(catalog.subjects),
    [catalog.subjects]
  );

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return levelGroups
      .filter((g) => selectedLevel === 'all' || g.level === selectedLevel)
      .map((group) => ({
        level: group.level,
        subjects: group.subjects.filter((s) => {
          if (!q) return true;
          const acronyms = (acronymsBySubjectCode.get(s.id) || []).join(' ').toLowerCase();
          return (
            s.name.toLowerCase().includes(q) ||
            (s.shortName || '').toLowerCase().includes(q) ||
            String(s.id).includes(q) ||
            (s.code || '').toLowerCase().includes(q) ||
            acronyms.includes(q)
          );
        }),
      }))
      .filter((g) => g.subjects.length > 0);
  }, [levelGroups, selectedLevel, searchQuery, acronymsBySubjectCode]);

  const config = catalog.plan.config;
  const primaryInter = config.intermediateDegrees?.[0];
  const acronymEntries = Object.entries(catalog.acronyms || {}).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  const renderSharedColumn = (subId: number) => {
    const binding = bindingByCode.get(subId);
    if (binding) {
      if (binding.sharedSubjectId && binding.stableCode) {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            <Link2 className="w-3 h-3" />
            {binding.stableCode} · {binding.linkedPlansCount} plan(es)
          </span>
        );
      }
      return <span className="text-[11px] text-slate-500">Propia (1:1)</span>;
    }

    const decision = sharedDecisions?.[subId];
    const sugg = suggestionByCode.get(subId);
    if (decision?.action === 'link_existing' && decision.sharedSubjectId) {
      const candidate = sugg?.candidates.find((c) => c.sharedSubjectId === decision.sharedSubjectId);
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
          <Link2 className="w-3 h-3" />
          Vincular: {candidate?.stableCode || candidate?.displayName || decision.sharedSubjectId}
        </span>
      );
    }
    return <span className="text-[11px] text-slate-500">Nueva propia (1:1)</span>;
  };

  return (
    <div
      data-testid="admin-plan-readonly-viewer"
      className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Eye className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">
              {title || `${catalog.career.name} — ${catalog.plan.name}`}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
              Solo lectura
            </span>
            {planStatus && (
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getPlanStatusBadgeStyle(
                  planStatus
                )}`}
              >
                {planStatus}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {subtitle ||
              `${catalog.career.code} · Plan ${catalog.plan.year} · Inspección estructural por ${config.levelLabel.toLowerCase()} (solo lectura)`}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Cerrar inspección de plan"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Config Metadata Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <div className="text-slate-400">Estructura</div>
          <div className="text-white font-semibold mt-0.5">
            {config.totalLevels} {config.levelLabel}(s) · {catalog.subjects.length} materias
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Nota mínima: {config.defaultMinPassingGrade}
          </div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <div className="text-slate-400">Electivas y Grado</div>
          <div className="text-white font-semibold mt-0.5">
            {config.requiredElectiveCredits} créditos ({config.electiveSlotsEquivalent} slots)
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate" title={config.finalDegreeTitle}>
            {config.finalDegreeTitle || 'Título final estándar'}
          </div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <div className="text-slate-400">PPS</div>
          <div className="text-white font-semibold mt-0.5">
            {config.ppsRequirement
              ? `Ref. código ${config.ppsRequirement.referenceSubjectCode}`
              : 'Sin PPS configurada'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
            {config.ppsRequirement?.label || 'No aplica'}
          </div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <div className="text-slate-400">Título intermedio</div>
          <div className="text-white font-semibold mt-0.5 truncate" title={primaryInter?.name}>
            {primaryInter ? primaryInter.name : 'No configurado'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {primaryInter
              ? `Hito: ${primaryInter.specialRuleSubjectCode ?? '—'} · Electivas: ${
                  primaryInter.requiredElectiveCredits ?? 0
                } cr.`
              : activeUsersCount !== undefined
              ? `Usuarios activos: ${activeUsersCount}`
              : 'Sin trayecto intermedio'}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedLevel('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              selectedLevel === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Todos ({catalog.subjects.length})
          </button>
          {levelGroups.map((g) => (
            <button
              key={g.level}
              type="button"
              onClick={() => setSelectedLevel(g.level)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                selectedLevel === g.level
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {config.levelLabel} {g.level} ({g.subjects.length})
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar materia, código o sigla..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Grouped Levels Table */}
      {filteredGroups.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-400 border border-slate-800 rounded-xl bg-slate-950/40">
          No hay materias que coincidan con el filtro aplicado.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => (
            <div
              key={group.level}
              className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40"
            >
              <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs">
                <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  {config.levelLabel} {group.level}
                </span>
                <span className="text-slate-400">{group.subjects.length} materias</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/50 text-slate-400 border-b border-slate-800/80">
                    <tr>
                      <th className="px-3 py-2 font-medium">Código</th>
                      <th className="px-3 py-2 font-medium">Materia</th>
                      <th className="px-3 py-2 font-medium">Tipo / Cursado</th>
                      <th className="px-3 py-2 font-medium">Correlativas</th>
                      <th className="px-3 py-2 font-medium">Shared Subject</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {group.subjects.map((sub) => {
                      const acronyms = acronymsBySubjectCode.get(sub.id) || [];
                      return (
                        <tr key={sub.id} className="hover:bg-slate-900/40">
                          <td className="px-3 py-2.5 align-top whitespace-nowrap">
                            <div className="font-mono font-semibold text-white">
                              {sub.code || sub.id}
                            </div>
                            <div className="text-[10px] text-slate-500">ID interno #{sub.id}</div>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <div className="font-medium text-slate-100">{sub.name}</div>
                            <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span>Corto: {sub.shortName}</span>
                              {acronyms.length > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                                  {acronyms.join(', ')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 align-top space-y-1">
                            <div className="flex flex-wrap items-center gap-1">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  sub.isElective
                                    ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                                    : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                }`}
                              >
                                {sub.isElective ? `Electiva (${sub.credits ?? 0} cr.)` : 'Obligatoria'}
                              </span>
                              {sub.isIntegrator && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  Integradora
                                </span>
                              )}
                              {sub.isOptionalTrack && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                  Trayecto: {sub.trackKey || 'opcional'}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {formatModalityLabel(sub.modality)} · {sub.weeklyHours}h/sem
                              {sub.contraCuatrimestral ? ' · Contracuatrimestral' : ''}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 align-top space-y-1 text-[11px]">
                            {sub.regularPrereqs.length === 0 && sub.approvedPrereqs.length === 0 ? (
                              <span className="text-slate-500">Sin correlativas</span>
                            ) : (
                              <>
                                {sub.regularPrereqs.length > 0 && (
                                  <div className="text-amber-300">
                                    Regulares:{' '}
                                    <span className="font-mono">
                                      {sub.regularPrereqs
                                        .map((c) => formatSubjectCodeLabel(c, subjectMap))
                                        .join(', ')}
                                    </span>
                                  </div>
                                )}
                                {sub.approvedPrereqs.length > 0 && (
                                  <div className="text-emerald-300">
                                    Aprobadas:{' '}
                                    <span className="font-mono">
                                      {sub.approvedPrereqs
                                        .map((c) => formatSubjectCodeLabel(c, subjectMap))
                                        .join(', ')}
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-3 py-2.5 align-top">{renderSharedColumn(sub.id)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Special Rules & Acronyms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-950/40 space-y-2">
          <div className="font-semibold text-white flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Reglas especiales ({catalog.rules.length})
          </div>
          {catalog.rules.length === 0 ? (
            <p className="text-slate-400">Este plan no declara reglas especiales.</p>
          ) : (
            <ul className="space-y-2">
              {catalog.rules.map((r) => (
                <li
                  key={`${r.subjectCode}-${r.ruleType}`}
                  className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800/80 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">
                      {typeof r.subjectCode === 'number'
                        ? `Materia ${formatSubjectCodeLabel(r.subjectCode, subjectMap)} (#${r.subjectCode})`
                        : 'Regla general del plan'}
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300">
                      {r.ruleType}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">{r.description}</div>
                  {Object.keys(r.params || {}).length > 0 && (
                    <div className="text-[10px] font-mono text-slate-500">
                      {JSON.stringify(r.params)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-slate-800 rounded-xl p-4 bg-slate-950/40 space-y-2">
          <div className="font-semibold text-white flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-sky-400" />
            Acrónimos y siglas ({acronymEntries.length})
          </div>
          {acronymEntries.length === 0 ? (
            <p className="text-slate-400">Sin acrónimos declarados.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {acronymEntries.map(([sigla, code]) => (
                <span
                  key={sigla}
                  className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300"
                >
                  <strong className="text-white">{sigla}</strong> →{' '}
                  {formatSubjectCodeLabel(code, subjectMap)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
