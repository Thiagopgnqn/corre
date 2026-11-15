import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  GraduationCap,
  Info,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  adminApi,
  type AdminPlanDetailResponse,
  type AdminPlanImportConfirmResponse,
  type AdminPlanImportTargetMode,
  type AdminPlanOverviewItem,
  type AdminPlanPreviewResponse,
  type AdminPlansOverviewResponse,
  type AdminSharedSubjectDecision,
} from '../../../api/admin.api';
import { AdminReauthModal } from '../AdminReauthModal';
import { AdminPlanReadOnlyViewer } from './AdminPlanReadOnlyViewer';
import {
  PUBLISH_DISABLED_REASON,
  arrayBufferToBase64,
  buildPreviewStateSignature,
  getPlanStatusBadgeStyle,
  normalizeSharedDecisionMap,
  serializeSharedDecisionsForApi,
} from './adminCareersHelpers';

const MAX_PLAN_XLSX_BYTES = 5 * 1024 * 1024;

export const AdminCareersTab: React.FC = () => {
  const [overview, setOverview] = useState<AdminPlansOverviewResponse | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published' | 'archived'>('all');
  const [facultyFilter, setFacultyFilter] = useState<string>('all');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);

  // Detail modal/section
  const [selectedDetail, setSelectedDetail] = useState<AdminPlanDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Delete draft confirmation modal state
  const [draftToDelete, setDraftToDelete] = useState<AdminPlanOverviewItem | null>(null);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);

  // Import wizard form state
  const [targetMode, setTargetMode] = useState<AdminPlanImportTargetMode>('new_career_and_plan');
  const [facultyId, setFacultyId] = useState('');
  const [careerId, setCareerId] = useState('');
  const [careerName, setCareerName] = useState('');
  const [careerCode, setCareerCode] = useState('');
  const [planId, setPlanId] = useState('');

  const [fileName, setFileName] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [fileSizeBytes, setFileSizeBytes] = useState(0);

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<AdminPlanPreviewResponse | null>(null);
  const [previewedSignature, setPreviewedSignature] = useState<string | null>(null);
  const [sharedDecisionsMap, setSharedDecisionsMap] = useState<
    Record<number, AdminSharedSubjectDecision | null>
  >({});
  const [showAllSharedRows, setShowAllSharedRows] = useState(false);

  const [isImporting, setIsImporting] = useState(false);
  const [lastConfirmResult, setLastConfirmResult] =
    useState<AdminPlanImportConfirmResponse | null>(null);

  // Reauth modal pattern (same as AdminScheduleTab / AdminUsersTab)
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [reauthTitle, setReauthTitle] = useState('Acción sensible');
  const [reauthDesc, setReauthDesc] = useState('');

  const executeWithReauth = (title: string, desc: string, action: () => Promise<void>) => {
    setReauthTitle(title);
    setReauthDesc(desc);
    setPendingAction(() => action);
    setReauthOpen(true);
  };

  const handleReauthSuccess = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    try {
      await action();
    } catch (err: any) {
      if (err?.code === 'REAUTH_REQUIRED') {
        executeWithReauth(reauthTitle, reauthDesc, action);
        return;
      }
      setErrorMsg(err?.message || 'Error al ejecutar la acción.');
    }
  };

  const fetchPlans = useCallback(async () => {
    setIsLoadingOverview(true);
    try {
      const res = await adminApi.listPlans();
      if (res.success && res.data) {
        setOverview(res.data);
        setFacultyId((prev) => prev || res.data.faculties[0]?.id || '');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al cargar el listado de carreras y planes.');
    } finally {
      setIsLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const facultyCareers = useMemo(() => {
    if (!overview) return [];
    return overview.careers.filter((c) => !facultyId || c.facultyId === facultyId);
  }, [overview, facultyId]);

  const facultyDraftPlans = useMemo(() => {
    if (!overview) return [];
    return overview.plans.filter(
      (p) => p.status === 'draft' && (!facultyId || p.facultyId === facultyId)
    );
  }, [overview, facultyId]);

  const filteredPlans = useMemo(() => {
    if (!overview) return [];
    return overview.plans.filter((p) => {
      if (facultyFilter !== 'all' && p.facultyId !== facultyFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      return true;
    });
  }, [overview, facultyFilter, statusFilter]);

  const serializedDecisions = useMemo(
    () => serializeSharedDecisionsForApi(sharedDecisionsMap),
    [sharedDecisionsMap]
  );

  const currentSignature = useMemo(
    () =>
      buildPreviewStateSignature({
        fileBase64,
        facultyId,
        targetMode,
        careerId,
        careerName,
        careerCode,
        planId,
        decisions: serializedDecisions,
      }),
    [fileBase64, facultyId, targetMode, careerId, careerName, careerCode, planId, serializedDecisions]
  );

  const isPreviewStale = Boolean(previewResult && previewedSignature !== currentSignature);

  const handleDownloadTemplate = async () => {
    setErrorMsg(null);
    setIsDownloadingTemplate(true);
    try {
      const { blob, fileName: dlName } = await adminApi.downloadPlanTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = dlName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSuccessMsg(`Plantilla descargada: ${dlName}`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo descargar la plantilla .xlsx.');
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleInspectPlan = async (plan: AdminPlanOverviewItem) => {
    setErrorMsg(null);
    setIsLoadingDetail(true);
    try {
      const res = await adminApi.getPlanDetail(plan.id);
      if (res.success && res.data) {
        setSelectedDetail(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al cargar el detalle de solo lectura del plan.');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handlePrefillDraftReimport = (plan: AdminPlanOverviewItem) => {
    setFacultyId(plan.facultyId);
    setTargetMode('existing_draft_plan');
    setPlanId(plan.id);
    setPreviewResult(null);
    setPreviewedSignature(null);
    setSharedDecisionsMap({});
    setLastConfirmResult(null);
    setSuccessMsg(
      `Modo configurado para actualizar el borrador "${plan.careerCode} · ${plan.name}". Seleccioná el archivo .xlsx y ejecutá la vista previa.`
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setErrorMsg(null);
    setSuccessMsg(null);
    setLastConfirmResult(null);
    setPreviewResult(null);
    setPreviewedSignature(null);
    setSharedDecisionsMap({});

    if (!file) {
      setFileName('');
      setFileBase64('');
      setFileSizeBytes(0);
      return;
    }

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setErrorMsg('Solo se admiten archivos con extensión .xlsx.');
      e.target.value = '';
      return;
    }

    if (file.size === 0 || file.size > MAX_PLAN_XLSX_BYTES) {
      setErrorMsg('El archivo .xlsx debe estar entre 1 byte y 5 MB.');
      e.target.value = '';
      return;
    }

    try {
      const buf = await file.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      setFileName(file.name);
      setFileBase64(b64);
      setFileSizeBytes(file.size);
    } catch {
      setErrorMsg('No se pudo leer el archivo seleccionado en el navegador.');
    }
  };

  const buildRequestPayload = (withHash?: string) => ({
    facultyId,
    targetMode,
    ...(targetMode === 'existing_career_new_plan' ? { careerId } : {}),
    ...(targetMode === 'new_career_and_plan'
      ? { careerName: careerName.trim(), careerCode: careerCode.trim().toUpperCase() }
      : {}),
    ...(targetMode === 'existing_draft_plan' ? { planId } : {}),
    fileName,
    fileBase64,
    ...(serializedDecisions.length > 0 ? { sharedSubjectDecisions: serializedDecisions } : {}),
    ...(withHash ? { previewHash: withHash } : {}),
  });

  const validateWizardInputs = (): string | null => {
    if (!facultyId) return 'Seleccioná una facultad destino.';
    if (targetMode === 'new_career_and_plan') {
      if (careerName.trim().length < 2) return 'Ingresá el nombre de la carrera nueva.';
      if (!/^[A-Za-z0-9_-]{2,20}$/.test(careerCode.trim())) {
        return 'El código de carrera debe tener 2 a 20 caracteres alfanuméricos, guiones o guiones bajos.';
      }
    } else if (targetMode === 'existing_career_new_plan') {
      if (!careerId) return 'Seleccioná una carrera existente.';
    } else if (targetMode === 'existing_draft_plan') {
      if (!planId) return 'Seleccioná un plan en estado draft para actualizar.';
    }
    if (!fileName || !fileBase64) return 'Seleccioná un archivo .xlsx para analizar.';
    return null;
  };

  const handleRunPreview = async (useCurrentDecisions: boolean) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLastConfirmResult(null);

    const validationErr = validateWizardInputs();
    if (validationErr) {
      setErrorMsg(validationErr);
      return;
    }

    setIsPreviewing(true);
    try {
      const decisionsToSend = useCurrentDecisions ? serializedDecisions : undefined;
      const res = await adminApi.previewPlanImport({
        ...buildRequestPayload(),
        sharedSubjectDecisions: decisionsToSend,
      });

      if (res.success && res.data) {
        const nextMap = useCurrentDecisions
          ? sharedDecisionsMap
          : normalizeSharedDecisionMap(res.data.sharedSubjectSuggestions || []);
        const nextDecisions = serializeSharedDecisionsForApi(nextMap);
        const sig = buildPreviewStateSignature({
          fileBase64,
          facultyId,
          targetMode,
          careerId,
          careerName,
          careerCode,
          planId,
          decisions: nextDecisions,
        });
        setSharedDecisionsMap(nextMap);
        setPreviewResult(res.data);
        setPreviewedSignature(sig);
        if (res.data.valid) {
          setSuccessMsg(
            `Vista previa validada (solo lectura). Hash: ${res.data.previewHash.slice(0, 12)}…`
          );
        } else {
          setErrorMsg(
            `El archivo contiene ${res.data.errors.length} error(es) bloqueante(s) de validación.`
          );
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al generar la vista previa del plan.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleSharedDecisionChange = (subjectCode: number, sharedSubjectId: string) => {
    setSharedDecisionsMap((prev) => ({
      ...prev,
      [subjectCode]: sharedSubjectId
        ? { subjectCode, action: 'link_existing', sharedSubjectId }
        : { subjectCode, action: 'create_new' },
    }));
  };

  const runConfirmImport = async () => {
    if (!previewResult || !previewResult.valid || isPreviewStale) return;
    setIsImporting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await adminApi.confirmPlanImport(buildRequestPayload(previewResult.previewHash));
      if (res.success && res.data) {
        setLastConfirmResult(res.data);
        setSuccessMsg(
          `Plan importado en borrador (${res.data.careerCode} · ${res.data.counts.subjects} materias, ${res.data.counts.linkedExistingShared} shared vinculados, ${res.data.counts.createdNewShared} propios 1:1).`
        );
        await fetchPlans();
      }
    } catch (err: any) {
      if (err?.code === 'REAUTH_REQUIRED') {
        executeWithReauth(
          'Confirmar importación de plan en borrador',
          'Necesitás reautenticarte para confirmar e impactar el plan en base de datos en estado draft.',
          runConfirmImport
        );
        return;
      }
      setErrorMsg(err?.message || 'No se pudo confirmar la importación del plan.');
    } finally {
      setIsImporting(false);
    }
  };

  const requestConfirmImport = () => {
    if (!previewResult?.valid || isPreviewStale) return;
    if ((previewResult.draftDiff?.blockedRemovalCodes.length ?? 0) > 0) {
      setErrorMsg(
        'Hay materias eliminadas que tienen referencias en Biblioteca y bloquean esta re-importación.'
      );
      return;
    }
    executeWithReauth(
      'Confirmar importación de plan (draft)',
      `Se persistirá "${previewResult.targetSummary.careerCode} — ${
        previewResult.normalizedPlan?.plan.name || fileName
      }" en estado borrador (sin publicar ni afectar alumnos activos).`,
      runConfirmImport
    );
  };

  const runDeleteDraft = async (plan: AdminPlanOverviewItem) => {
    setIsDeletingDraft(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await adminApi.deleteDraftPlan(plan.id);
      if (res.success) {
        setDraftToDelete(null);
        if (selectedDetail?.plan.id === plan.id) {
          setSelectedDetail(null);
        }
        setSuccessMsg(res.message || `Borrador "${plan.name}" eliminado correctamente.`);
        await fetchPlans();
      }
    } catch (err: any) {
      if (err?.code === 'REAUTH_REQUIRED') {
        executeWithReauth(
          'Eliminar borrador de plan',
          `Reautenticate para eliminar el borrador "${plan.careerCode} · ${plan.name}".`,
          () => runDeleteDraft(plan)
        );
        return;
      }
      setDraftToDelete(null);
      setErrorMsg(err?.message || 'No se pudo eliminar el borrador del plan.');
    } finally {
      setIsDeletingDraft(false);
    }
  };

  const visibleSuggestions = useMemo(() => {
    const all = previewResult?.sharedSubjectSuggestions || [];
    if (showAllSharedRows) return all;
    return all.filter(
      (s) => s.candidates.length > 0 || sharedDecisionsMap[s.subjectCode]?.action === 'link_existing'
    );
  }, [previewResult, showAllSharedRows, sharedDecisionsMap]);

  const canConfirmImport = Boolean(
    previewResult?.valid &&
      !isPreviewStale &&
      !isPreviewing &&
      !isImporting &&
      (previewResult?.draftDiff?.blockedRemovalCodes.length ?? 0) === 0
  );

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white">Carreras y Planes de Estudio</h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              Tramo 2B · Borradores
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Administrá borradores de planes de estudio (.xlsx), validá reglas y vínculos compartidos en modo solo lectura e importá en estado{' '}
            <span className="text-amber-300 font-mono">draft</span>. La publicación para alumnos se habilitará tras completar la etapa multi-plan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={isDownloadingTemplate}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-white border border-slate-700 transition-colors"
          >
            {isDownloadingTemplate ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4 text-emerald-400" />
            )}
            Descargar plantilla (.xlsx)
          </button>

          <button
            type="button"
            onClick={fetchPlans}
            disabled={isLoadingOverview}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-medium text-slate-200 border border-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingOverview ? 'animate-spin' : ''}`} />
            Recargar
          </button>
        </div>
      </div>

      {/* Feedback Notifications */}
      {errorMsg && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start justify-between gap-3 text-xs text-red-300">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-400 hover:text-red-200 font-semibold"
          >
            Cerrar
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-start justify-between gap-3 text-xs text-emerald-300">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-400 hover:text-emerald-200 font-semibold"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Existing Plans List */}
      <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">Planes registrados</h3>
            <p className="text-xs text-slate-400">
              Listado por facultad con estado, conteos estructurales e inspección en solo lectura.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={facultyFilter}
              onChange={(e) => setFacultyFilter(e.target.value)}
              aria-label="Filtrar por facultad"
              className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">Todas las facultades</option>
              {overview?.faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              aria-label="Filtrar por estado"
              className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">Todos los estados</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        {isLoadingOverview && !overview ? (
          <div className="flex items-center justify-center py-10 text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando planes de estudio...
          </div>
        ) : filteredPlans.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 border border-slate-800 rounded-xl bg-slate-950/40">
            No hay planes que coincidan con los filtros seleccionados.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-800 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3.5 py-2.5 font-medium">Carrera / Plan</th>
                  <th className="px-3.5 py-2.5 font-medium">Facultad</th>
                  <th className="px-3.5 py-2.5 font-medium">Estado</th>
                  <th className="px-3.5 py-2.5 font-medium">Conteos</th>
                  <th className="px-3.5 py-2.5 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 bg-slate-950/30">
                {filteredPlans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-slate-900/40">
                    <td className="px-3.5 py-3 align-top">
                      <div className="font-semibold text-white">
                        {plan.careerCode} · {plan.careerName}
                      </div>
                      <div className="text-slate-300 mt-0.5">
                        {plan.name} <span className="text-slate-500">(Año {plan.year})</span>
                      </div>
                    </td>
                    <td className="px-3.5 py-3 align-top text-slate-300">
                      <div>{plan.facultyName}</div>
                      <div className="text-[11px] text-slate-500">{plan.institutionName}</div>
                    </td>
                    <td className="px-3.5 py-3 align-top">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getPlanStatusBadgeStyle(
                          plan.status
                        )}`}
                      >
                        {plan.status}
                      </span>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {plan.activeUsersCount} usuario(s)
                      </div>
                    </td>
                    <td className="px-3.5 py-3 align-top text-slate-300 space-y-0.5">
                      <div>{plan.subjectCount} materias · {plan.rulesCount} reglas</div>
                      <div className="text-[11px] text-slate-400">
                        {plan.acronymsCount} siglas · {plan.sharedSubjectsCount} shared
                      </div>
                    </td>
                    <td className="px-3.5 py-3 align-top">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleInspectPlan(plan)}
                          disabled={isLoadingDetail}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5 text-indigo-400" />
                          Inspeccionar
                        </button>

                        {plan.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => handlePrefillDraftReimport(plan)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-medium transition-colors"
                          >
                            <UploadCloud className="w-3.5 h-3.5" />
                            Re-importar
                          </button>
                        )}

                        <button
                          type="button"
                          disabled
                          aria-disabled="true"
                          title={PUBLISH_DISABLED_REASON}
                          data-testid={`publish-plan-btn-${plan.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/50 text-slate-500 border border-slate-800 cursor-not-allowed opacity-60"
                        >
                          <Lock className="w-3 h-3" />
                          Publicar
                        </button>

                        {plan.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => setDraftToDelete(plan)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 font-medium transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2">
          <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>
            El botón <strong>Publicar</strong> permanece deshabilitado hasta el Tramo 2C/2D (cuando los alumnos puedan elegir entre múltiples carreras/planes publicados).
          </span>
        </div>
      </section>

      {/* Read-Only Plan Detail Inspection */}
      {isLoadingDetail && (
        <div className="p-6 bg-slate-900/70 border border-slate-800 rounded-2xl flex items-center justify-center gap-2 text-xs text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando inspección estructural del plan...
        </div>
      )}

      {selectedDetail && !isLoadingDetail && (
        <AdminPlanReadOnlyViewer
          catalog={selectedDetail}
          title={`Inspección del plan: ${selectedDetail.career.code} — ${selectedDetail.plan.name}`}
          subtitle={`${selectedDetail.adminMeta.institutionName} · ${selectedDetail.adminMeta.facultyName}`}
          planStatus={selectedDetail.adminMeta.planStatus}
          activeUsersCount={selectedDetail.adminMeta.activeUsersCount}
          sharedBindings={selectedDetail.adminMeta.sharedSubjectBindings}
          onClose={() => setSelectedDetail(null)}
        />
      )}

      {/* Import Wizard (.xlsx -> Preview -> Shared Match -> Confirm Draft) */}
      <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-5">
        <div className="space-y-1 border-b border-slate-800 pb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            Importar o actualizar plan desde Excel (.xlsx)
          </h3>
          <p className="text-xs text-slate-400">
            Paso 1: elegí el destino y ejecutá la vista previa de solo lectura. Paso 2: revisá errores/advertencias y vínculos compartidos. Paso 3: confirmá con reautenticación (se guarda en{' '}
            <span className="font-mono text-amber-300">draft</span>).
          </p>
        </div>

        {/* Target & File Form */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <label className="space-y-1.5">
            <span className="text-slate-300 font-medium block">Facultad</span>
            <select
              value={facultyId}
              onChange={(e) => {
                setFacultyId(e.target.value);
                setCareerId('');
                setPlanId('');
              }}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
            >
              {!overview?.faculties.length && <option value="">Sin facultades disponibles</option>}
              {overview?.faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-slate-300 font-medium block">Modo de destino</span>
            <select
              value={targetMode}
              onChange={(e) => {
                setTargetMode(e.target.value as AdminPlanImportTargetMode);
                setLastConfirmResult(null);
              }}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="new_career_and_plan">Nueva carrera + primer plan (draft)</option>
              <option value="existing_career_new_plan">Nuevo plan en carrera existente (draft)</option>
              <option value="existing_draft_plan">Actualizar borrador (draft) existente</option>
            </select>
          </label>

          {targetMode === 'new_career_and_plan' && (
            <>
              <label className="space-y-1.5">
                <span className="text-slate-300 font-medium block">Nombre de la carrera</span>
                <input
                  type="text"
                  value={careerName}
                  onChange={(e) => setCareerName(e.target.value)}
                  placeholder="Ej: Ingeniería Industrial"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-slate-300 font-medium block">Código de carrera</span>
                <input
                  type="text"
                  value={careerCode}
                  onChange={(e) => setCareerCode(e.target.value.toUpperCase())}
                  placeholder="Ej: IIND"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white uppercase font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </label>
            </>
          )}

          {targetMode === 'existing_career_new_plan' && (
            <label className="space-y-1.5">
              <span className="text-slate-300 font-medium block">Carrera existente</span>
              <select
                value={careerId}
                onChange={(e) => setCareerId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Seleccionar carrera...</option>
                {facultyCareers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name} ({c.status})
                  </option>
                ))}
              </select>
            </label>
          )}

          {targetMode === 'existing_draft_plan' && (
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-slate-300 font-medium block">Plan draft a actualizar</span>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Seleccionar plan draft...</option>
                {facultyDraftPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.careerCode} · {p.name} (Año {p.year})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="space-y-1.5 md:col-span-2 lg:col-span-2">
            <span className="text-slate-300 font-medium block">Archivo Excel (.xlsx, máx. 5 MB)</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
              className="block w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer bg-slate-950 border border-slate-800 rounded-xl p-1"
            />
            {fileName && (
              <div className="text-[11px] text-slate-400">
                Archivo listo: <span className="text-slate-200 font-medium">{fileName}</span> (
                {(fileSizeBytes / 1024).toFixed(1)} KB)
              </div>
            )}
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => handleRunPreview(false)}
            disabled={isPreviewing || isImporting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors"
          >
            {isPreviewing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            Ejecutar vista previa (solo lectura)
          </button>

          {isPreviewStale && (
            <button
              type="button"
              onClick={() => handleRunPreview(true)}
              disabled={isPreviewing || isImporting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold text-amber-200 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isPreviewing ? 'animate-spin' : ''}`} />
              Recalcular vista previa y hash (cambió la configuración o vínculos)
            </button>
          )}
        </div>

        {/* Preview Validation & Diff Result */}
        {previewResult && (
          <div className="space-y-5 pt-3 border-t border-slate-800">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="text-slate-400">Resultado</div>
                <div
                  className={`font-bold mt-0.5 ${
                    previewResult.valid ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {previewResult.valid
                    ? 'Válido para importar'
                    : `${previewResult.errors.length} error(es)`}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="text-slate-400">Contenido</div>
                <div className="font-semibold text-white mt-0.5">
                  {previewResult.stats.subjectsCount} materias ·{' '}
                  {previewResult.stats.prerequisitesCount} correlativas
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="text-slate-400">Hojas / Filas</div>
                <div className="font-semibold text-white mt-0.5">
                  {previewResult.stats.sheetCount} hojas · {previewResult.stats.totalRowsProcessed}{' '}
                  filas
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="text-slate-400">Preview Hash</div>
                <div
                  className="font-mono text-[11px] text-indigo-300 truncate mt-0.5"
                  title={previewResult.previewHash}
                >
                  {previewResult.previewHash}
                </div>
              </div>
            </div>

            {previewResult.errors.length > 0 && (
              <div className="border border-red-500/30 bg-red-500/5 rounded-xl p-4 space-y-2">
                <div className="text-xs font-bold text-red-300 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  Errores bloqueantes ({previewResult.errors.length})
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1.5 text-xs">
                  {previewResult.errors.map((err, idx) => (
                    <div
                      key={`${err.sheet}-${err.row}-${idx}`}
                      className="px-3 py-2 rounded-lg bg-slate-950/70 border border-red-500/20 text-red-200"
                    >
                      <span className="font-mono text-red-300">
                        [{err.sheet} · fila {err.row}
                        {err.field ? ` · ${err.field}` : ''}]
                      </span>{' '}
                      {err.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {previewResult.warnings.length > 0 && (
              <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4 space-y-2">
                <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Advertencias ({previewResult.warnings.length})
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 text-xs">
                  {previewResult.warnings.map((w, idx) => (
                    <div
                      key={`${w.sheet}-${w.row}-${idx}`}
                      className="px-3 py-2 rounded-lg bg-slate-950/70 border border-amber-500/20 text-amber-200"
                    >
                      <span className="font-mono text-amber-300">
                        [{w.sheet} · fila {w.row}]
                      </span>{' '}
                      {w.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {previewResult.draftDiff && (
              <div className="border border-slate-800 rounded-xl p-4 bg-slate-950/50 space-y-2 text-xs">
                <div className="font-bold text-white">Diferencias sobre el draft existente</div>
                <div className="flex flex-wrap gap-3">
                  <span className="text-emerald-300">
                    Crear: <strong>{previewResult.draftDiff.toCreateCodes.length}</strong>
                  </span>
                  <span className="text-sky-300">
                    Actualizar: <strong>{previewResult.draftDiff.toUpdateCodes.length}</strong>
                  </span>
                  <span className="text-amber-300">
                    Quitar: <strong>{previewResult.draftDiff.toRemoveCodes.length}</strong>
                  </span>
                </div>
                {previewResult.draftDiff.blockedRemovalCodes.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300">
                    No podés quitar los códigos [
                    {previewResult.draftDiff.blockedRemovalCodes.join(', ')}] porque tienen material o referencias asociadas en Biblioteca.
                  </div>
                )}
              </div>
            )}

            {/* Shared Subjects Explicit Decisions Table */}
            {previewResult.sharedSubjectSuggestions.length > 0 && (
              <div className="border border-slate-800 rounded-xl p-4 bg-slate-950/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Link2 className="w-4 h-4 text-indigo-400" />
                      Materias compartidas (misma facultad · sin autovínculo)
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Las coincidencias son solo sugerencias. Por defecto cada materia nueva crea su propia{' '}
                      <span className="font-mono">shared_subject</span> 1:1 salvo que elijas vincularla explícitamente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAllSharedRows((prev) => !prev)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200"
                  >
                    {showAllSharedRows
                      ? 'Mostrar solo sugerencias / vínculos'
                      : `Ver todas (${previewResult.sharedSubjectSuggestions.length})`}
                  </button>
                </div>

                {visibleSuggestions.length === 0 ? (
                  <div className="text-xs text-slate-400 py-2">
                    No se detectaron coincidencias previas en esta facultad; todas las materias crearán su shared subject 1:1 propio.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-800/80 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/70 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="px-3 py-2 font-medium">Materia entrante</th>
                          <th className="px-3 py-2 font-medium">Coincidencias detectadas</th>
                          <th className="px-3 py-2 font-medium">Decisión explícita</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {visibleSuggestions.map((sugg) => {
                          const currentVal =
                            sharedDecisionsMap[sugg.subjectCode]?.action === 'link_existing'
                              ? sharedDecisionsMap[sugg.subjectCode]?.sharedSubjectId || ''
                              : '';
                          return (
                            <tr key={sugg.subjectCode} className="hover:bg-slate-900/30">
                              <td className="px-3 py-2.5 align-top">
                                <div className="font-medium text-white">
                                  {sugg.displayCode || sugg.subjectCode} · {sugg.subjectName}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  norm: {sugg.normalizedName}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 align-top space-y-1">
                                {sugg.candidates.length === 0 ? (
                                  <span className="text-[11px] text-slate-500">Sin sugerencias</span>
                                ) : (
                                  sugg.candidates.map((cand) => (
                                    <div key={cand.sharedSubjectId} className="text-[11px]">
                                      <span
                                        className={`inline-block px-1.5 py-0.5 rounded mr-1.5 font-mono text-[10px] ${
                                          cand.confidence === 'low' || cand.matchType === 'similar'
                                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                            : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                        }`}
                                      >
                                        {cand.matchType || 'exact'} / {cand.confidence || 'high'}
                                      </span>
                                      <span className="text-slate-200">{cand.displayName}</span>{' '}
                                      <span className="text-slate-500">
                                        ({cand.linkedPlanLabels.join(', ') || cand.stableCode})
                                      </span>
                                    </div>
                                  ))
                                )}
                              </td>
                              <td className="px-3 py-2.5 align-top min-w-[240px]">
                                <select
                                  value={currentVal}
                                  onChange={(e) =>
                                    handleSharedDecisionChange(sugg.subjectCode, e.target.value)
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                                >
                                  <option value="">Crear materia compartida propia (1:1)</option>
                                  {sugg.candidates.map((cand) => (
                                    <option key={cand.sharedSubjectId} value={cand.sharedSubjectId}>
                                      Vincular: {cand.displayName} [{cand.stableCode}]
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Read-Only Plan Structure Preview */}
            {previewResult.normalizedPlan && (
              <AdminPlanReadOnlyViewer
                catalog={previewResult.normalizedPlan}
                title={`Vista previa normalizada: ${previewResult.targetSummary.careerCode} — ${previewResult.normalizedPlan.plan.name}`}
                subtitle={`${previewResult.targetSummary.institutionName} · ${previewResult.targetSummary.facultyName}`}
                planStatus={previewResult.targetSummary.planStatus}
                sharedSuggestions={previewResult.sharedSubjectSuggestions}
                sharedDecisions={sharedDecisionsMap}
              />
            )}

            {/* Final Confirm Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-xs text-slate-400">
                {isPreviewStale ? (
                  <span className="text-amber-300 font-medium">
                    Modificaste parámetros o vínculos compartidos: recalculá la vista previa para actualizar el previewHash antes de confirmar.
                  </span>
                ) : previewResult.valid ? (
                  <span>
                    La importación exige reautenticación reciente y se guardará exclusivamente en estado{' '}
                    <strong className="text-amber-300">draft</strong>.
                  </span>
                ) : (
                  <span className="text-red-300">
                    Corregí los errores bloqueantes del Excel y volvé a ejecutar la vista previa.
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={requestConfirmImport}
                disabled={!canConfirmImport}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white transition-colors"
              >
                {isImporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Confirmar importación en draft
              </button>
            </div>
          </div>
        )}

        {lastConfirmResult && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 space-y-1">
            <div className="font-bold text-emerald-300">
              Importación persistida ({lastConfirmResult.careerCode} · {lastConfirmResult.status})
            </div>
            <div>
              Plan ID: <span className="font-mono">{lastConfirmResult.planId}</span> · Hash:{' '}
              <span className="font-mono">{lastConfirmResult.previewHash.slice(0, 16)}…</span>
            </div>
          </div>
        )}
      </section>

      {/* Delete Draft Modal */}
      {draftToDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">Eliminar borrador de plan</h4>
            <p className="text-xs text-slate-300">
              ¿Querés eliminar el borrador{' '}
              <strong>
                {draftToDelete.careerCode} · {draftToDelete.name}
              </strong>
              ? Solo se permite si no tiene usuarios, material de biblioteca, reseñas ni horarios asociados.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDraftToDelete(null)}
                disabled={isDeletingDraft}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() =>
                  executeWithReauth(
                    'Eliminar borrador de plan',
                    `Confirmá tu identidad para eliminar el draft "${draftToDelete.careerCode} · ${draftToDelete.name}".`,
                    () => runDeleteDraft(draftToDelete)
                  )
                }
                disabled={isDeletingDraft}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white"
              >
                {isDeletingDraft && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Eliminar borrador
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reauth Modal */}
      <AdminReauthModal
        isOpen={reauthOpen}
        onClose={() => {
          setReauthOpen(false);
          setPendingAction(null);
        }}
        onSuccess={handleReauthSuccess}
        actionTitle={reauthTitle}
        description={reauthDesc}
      />
    </div>
  );
};
