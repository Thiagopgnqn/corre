import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Plus,
  Copy,
  CheckCircle2,
  AlertTriangle,
  User,
  Trash2,
  Archive,
  UploadCloud,
  Search,
  Loader2,
  X,
} from 'lucide-react';
import {
  adminApi,
  type AdminTerm,
  type AdminCommissionItem,
  type CommissionImpactSummary,
  type ScheduleImportPreview,
} from '../../../api/admin.api';
import { AdminReauthModal } from '../AdminReauthModal';
import { CORE_SUBJECTS } from '../../../data/plan2023';

const DAYS_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const AdminScheduleTab: React.FC = () => {
  const subjects = CORE_SUBJECTS;

  // State: Terms
  const [terms, setTerms] = useState<AdminTerm[]>([]);
  const [selectedTermId, setSelectedTermId] = useState<string>('');
  const [isLoadingTerms, setIsLoadingTerms] = useState(false);

  // State: Commissions
  const [commissions, setCommissions] = useState<AdminCommissionItem[]>([]);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [searchCommission, setSearchCommission] = useState('');
  const [isLoadingComms, setIsLoadingComms] = useState(false);

  // Notifications
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [newTermModalOpen, setNewTermModalOpen] = useState(false);
  const [duplicateTermModalOpen, setDuplicateTermModalOpen] = useState(false);
  const [commissionFormModalOpen, setCommissionFormModalOpen] = useState(false);
  const [editingCommission, setEditingCommission] = useState<Partial<AdminCommissionItem> | null>(null);

  // Impact & Retire/Delete Modal
  const [impactModalOpen, setImpactModalOpen] = useState(false);
  const [impactTarget, setImpactTarget] = useState<AdminCommissionItem | null>(null);
  const [impactData, setImpactData] = useState<CommissionImpactSummary | null>(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState(false);

  // Schedule Import Modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importPreview, setImportPreview] = useState<ScheduleImportPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isApplyingImport, setIsApplyingImport] = useState(false);

  // Reauth Modal
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [reauthTitle, setReauthTitle] = useState('');
  const [reauthDesc, setReauthDesc] = useState('');

  // Form states for new term
  const [newTermName, setNewTermName] = useState('');
  const [newTermYear, setNewTermYear] = useState<number>(new Date().getFullYear());
  const [newTermDraft, setNewTermDraft] = useState(false);

  // Form states for duplicate term
  const [dupName, setDupName] = useState('');
  const [dupYear, setDupYear] = useState<number>(new Date().getFullYear());

  // Form states for commission edit
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formShift, setFormShift] = useState<'M' | 'T' | 'N'>('M');
  const [formClassroom, setFormClassroom] = useState('');
  const [formProfessor, setFormProfessor] = useState('');
  const [formSlots, setFormSlots] = useState<
    Array<{ day: number; start: string; end: string; classroom?: string }>
  >([{ day: 1, start: '08:00', end: '12:00' }]);

  const fetchTerms = useCallback(async () => {
    setIsLoadingTerms(true);
    try {
      const res = await adminApi.listTerms();
      if (res.success && res.data) {
        const termList = Array.isArray(res.data) ? res.data : [];
        setTerms(termList);
        if (!selectedTermId && termList.length > 0) {
          const defaultTerm = termList.find((t) => t.isDefault) || termList[0];
          setSelectedTermId(defaultTerm.id);
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al obtener períodos.');
    } finally {
      setIsLoadingTerms(false);
    }
  }, [selectedTermId]);

  useEffect(() => {
    fetchTerms();
  }, [fetchTerms]);

  const fetchCommissions = useCallback(async () => {
    if (!selectedTermId) return;
    setIsLoadingComms(true);
    try {
      const res = await adminApi.listCommissions(selectedTermId, {
        subjectId: subjectFilter || undefined,
        search: searchCommission || undefined,
      });
      if (res.success && res.data) {
        setCommissions(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al obtener comisiones.');
      setCommissions([]);
    } finally {
      setIsLoadingComms(false);
    }
  }, [selectedTermId, subjectFilter, searchCommission]);

  useEffect(() => {
    fetchCommissions();
  }, [fetchCommissions]);

  const executeWithReauth = (title: string, desc: string, action: () => Promise<void>) => {
    setReauthTitle(title);
    setReauthDesc(desc);
    setPendingAction(() => action);
    setReauthOpen(true);
  };

  const handleReauthSuccess = async () => {
    if (pendingAction) {
      try {
        await pendingAction();
      } catch (err: any) {
        setErrorMsg(err?.message || 'Error al ejecutar la acción.');
      } finally {
        setPendingAction(null);
      }
    }
  };

  // ── Term Actions ──
  const handleCreateTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTermName.trim()) return;
    try {
      const res = await adminApi.createTerm({
        name: newTermName.trim(),
        year: Number(newTermYear),
        isDraft: newTermDraft,
      });
      if (res.success) {
        setSuccessMsg(`Período "${res.data.name}" creado con éxito.`);
        setNewTermModalOpen(false);
        setNewTermName('');
        await fetchTerms();
        setSelectedTermId(res.data.id);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al crear período.');
    }
  };

  const handleDuplicateTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dupName.trim() || !selectedTermId) return;
    try {
      const slug = `${dupYear}-${dupName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const res = await adminApi.duplicateTerm(selectedTermId, {
        newTermId: slug,
        newName: dupName.trim(),
        newYear: Number(dupYear),
      });
      if (res.success) {
        setSuccessMsg(`Período duplicado con éxito en borrador: "${res.data.name}".`);
        setDuplicateTermModalOpen(false);
        setDupName('');
        await fetchTerms();
        setSelectedTermId(res.data.id);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al duplicar período.');
    }
  };

  const handleSetDefaultTerm = async (termId: string) => {
    try {
      const res = await adminApi.setTermDefault(termId);
      if (res.success) {
        setSuccessMsg(`Período "${res.data.name}" establecido como predeterminado.`);
        await fetchTerms();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al cambiar período predeterminado.');
    }
  };

  // ── Commission Actions ──
  const handleOpenNewCommission = () => {
    setEditingCommission(null);
    setFormSubjectId(subjects[0]?.id ? String(subjects[0].id) : '');
    setFormCode('');
    setFormShift('M');
    setFormClassroom('');
    setFormProfessor('');
    setFormSlots([{ day: 1, start: '08:00', end: '12:00' }]);
    setCommissionFormModalOpen(true);
  };

  const handleOpenEditCommission = (comm: AdminCommissionItem) => {
    setEditingCommission(comm);
    setFormSubjectId(comm.subjectId);
    setFormCode(comm.code);
    setFormShift(comm.shift);
    setFormClassroom(comm.classroom || '');
    setFormProfessor(comm.professorName || '');
    setFormSlots(
      comm.scheduleSlots && comm.scheduleSlots.length > 0
        ? comm.scheduleSlots
        : [{ day: 1, start: '08:00', end: '12:00' }]
    );
    setCommissionFormModalOpen(true);
  };

  const handleSaveCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSubjectId || !formCode.trim()) {
      setErrorMsg('Seleccioná la materia e indicá el código de la comisión.');
      return;
    }

    // Validar cada franja horaria: start < end, formato HH:MM
    for (const slot of formSlots) {
      if (!slot.start || !slot.end || slot.start >= slot.end) {
        setErrorMsg('Cada franja horaria debe tener una hora de inicio anterior a la hora de fin.');
        return;
      }
      if (slot.start < '07:00' || slot.end > '23:30') {
        setErrorMsg('Los horarios deben ubicarse entre las 07:00 y las 23:30.');
        return;
      }
    }

    try {
      const payload = {
        id: editingCommission?.id,
        termId: selectedTermId,
        subjectId: formSubjectId,
        code: formCode.trim().toUpperCase(),
        shift: formShift,
        classroom: formClassroom.trim() || null,
        professorName: formProfessor.trim() || null,
        scheduleSlots: formSlots,
      };

      const res = await adminApi.saveCommission(payload);
      if (res.success) {
        setSuccessMsg(`Comisión ${res.data.code} guardada con éxito.`);
        setCommissionFormModalOpen(false);
        fetchCommissions();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al guardar la comisión.');
    }
  };

  // ── Impact & Retire/Delete Actions ──
  const handleOpenImpact = async (comm: AdminCommissionItem) => {
    setImpactTarget(comm);
    setImpactData(null);
    setImpactModalOpen(true);
    setIsLoadingImpact(true);
    try {
      const res = await adminApi.previewCommissionImpact(comm.id);
      if (res.success) {
        setImpactData(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al consultar impacto de la comisión.');
      setImpactModalOpen(false);
    } finally {
      setIsLoadingImpact(false);
    }
  };

  const handleRetireCommission = async () => {
    if (!impactTarget) return;
    try {
      const res = await adminApi.retireCommission(impactTarget.id);
      setSuccessMsg(res.message);
      setImpactModalOpen(false);
      fetchCommissions();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al dar de baja la comisión.');
    }
  };

  const handleDeleteCommission = async () => {
    if (!impactTarget) return;
    try {
      const res = await adminApi.deleteCommission(impactTarget.id);
      setSuccessMsg(res.message);
      setImpactModalOpen(false);
      fetchCommissions();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al eliminar la comisión.');
    }
  };

  // ── Schedule Import Actions ──
  const handlePreviewImport = async () => {
    if (!importJsonText.trim()) {
      setErrorMsg('Pegá el contenido JSON o cargá un archivo primero.');
      return;
    }

    try {
      const parsed = JSON.parse(importJsonText);
      setIsLoadingPreview(true);
      setErrorMsg(null);
      const res = await adminApi.previewScheduleImport(parsed);
      if (res.success && res.data) {
        setImportPreview(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'JSON inválido o estructura no reconocida.');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleApplyImport = () => {
    if (!importPreview || !importJsonText) return;

    executeWithReauth(
      'Importación masiva de horarios',
      `Esta acción sobrescribirá las comisiones del catálogo con los datos verificados del archivo (Hash: ${importPreview.previewHash.substring(0, 10)}...).`,
      async () => {
        setIsApplyingImport(true);
        try {
          const parsed = JSON.parse(importJsonText);
          const res = await adminApi.applyScheduleImport(importPreview.previewHash, parsed);
          setSuccessMsg(res.message);
          setImportModalOpen(false);
          setImportJsonText('');
          setImportPreview(null);
          await fetchTerms();
          fetchCommissions();
        } finally {
          setIsApplyingImport(false);
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Mobile Notice: Read-only on mobile devices */}
      <div className="md:hidden p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl flex items-start gap-2.5 text-xs text-amber-300">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold">Vista de solo lectura en dispositivos móviles</p>
          <p className="text-amber-200/80 text-[11px] mt-0.5">
            La creación, edición y descarte de comisiones o carga de archivos de horarios está optimizada para realizarse desde una computadora.
          </p>
        </div>
      </div>
      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-between text-xs text-red-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Bar: Term Selector & Global Catalog Actions */}
      <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Left: Term selector & details */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold text-white">Período Académico:</span>
          </div>

          <select
            value={selectedTermId}
            onChange={(e) => setSelectedTermId(e.target.value)}
            disabled={isLoadingTerms}
            className="bg-slate-950 border border-slate-800 text-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:border-indigo-500"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.year}) {t.isDefault ? '★ Predeterminado' : ''} {t.isDraft ? '📝 Borrador' : ''}
              </option>
            ))}
          </select>

          {/* Term Badges */}
          {selectedTermId && (
            <div className="flex items-center gap-1.5">
              {terms.find((t) => t.id === selectedTermId)?.isDefault && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">
                  Predeterminado
                </span>
              )}
              {terms.find((t) => t.id === selectedTermId)?.isDraft && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                  Borrador
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {selectedTermId && !terms.find((t) => t.id === selectedTermId)?.isDefault && (
            <button
              type="button"
              onClick={() => handleSetDefaultTerm(selectedTermId)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
            >
              Hacer Predeterminado
            </button>
          )}

          <button
            type="button"
            onClick={() => setDuplicateTermModalOpen(true)}
            disabled={!selectedTermId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
            title="Duplicar comisiones de este período a un nuevo ciclo"
          >
            <Copy className="w-3.5 h-3.5 text-indigo-400" />
            <span>Duplicar Período...</span>
          </button>

          <button
            type="button"
            onClick={() => setNewTermModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>Nuevo Período</span>
          </button>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Importar JSON...</span>
          </button>
        </div>
      </div>

      {/* Commissions Filter & Toolbar */}
      <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Buscar por comisión o docente..."
              value={searchCommission}
              onChange={(e) => setSearchCommission(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Subject Filter */}
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 max-w-xs"
          >
            <option value="">Todas las materias</option>
            {subjects.map((s) => (
              <option key={s.id} value={String(s.id)}>
                #{s.code} {s.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleOpenNewCommission}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Comisión</span>
        </button>
      </div>

      {/* Commissions Table */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Comisión</th>
                <th className="py-3 px-4">Materia</th>
                <th className="py-3 px-4">Turno</th>
                <th className="py-3 px-4">Docente</th>
                <th className="py-3 px-4">Horarios</th>
                <th className="py-3 px-4">Aula</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoadingComms ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-2" />
                    Cargando comisiones...
                  </td>
                </tr>
              ) : commissions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No hay comisiones registradas para este período y filtro.
                  </td>
                </tr>
              ) : (
                commissions.map((c) => {
                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        c.isRetired ? 'opacity-60 bg-slate-950/40' : ''
                      }`}
                    >
                      {/* Code */}
                      <td className="py-3 px-4 font-bold text-white">
                        <span className="px-2 py-1 bg-slate-800 rounded-lg text-slate-200 border border-slate-700">
                          {c.code}
                        </span>
                      </td>

                      {/* Subject */}
                      <td className="py-3 px-4 font-medium text-white max-w-[200px] truncate">
                        {c.subjectName || `Materia #${c.subjectId}`}
                      </td>

                      {/* Shift */}
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            c.shift === 'M'
                              ? 'bg-amber-500/20 text-amber-300'
                              : c.shift === 'T'
                              ? 'bg-sky-500/20 text-sky-300'
                              : 'bg-indigo-500/20 text-indigo-300'
                          }`}
                        >
                          {c.shift === 'M' ? 'Mañana' : c.shift === 'T' ? 'Tarde' : 'Noche'}
                        </span>
                      </td>

                      {/* Professor */}
                      <td className="py-3 px-4 text-slate-300">
                        {c.professorName ? (
                          <div className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <span>{c.professorName}</span>
                          </div>
                        ) : (
                          <span className="text-amber-400/80 italic text-[11px]">
                            Sin asignar
                          </span>
                        )}
                      </td>

                      {/* Slots */}
                      <td className="py-3 px-4 text-slate-300">
                        {c.scheduleSlots && c.scheduleSlots.length > 0 ? (
                          <div className="space-y-0.5">
                            {c.scheduleSlots.map((s, idx) => (
                              <div key={idx} className="text-[11px] font-mono text-slate-300">
                                {DAYS_NAMES[s.day]}: {s.start} - {s.end}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Sin horarios</span>
                        )}
                      </td>

                      {/* Classroom */}
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                        {c.classroom || '—'}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        {c.isRetired ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            <Archive className="w-3 h-3" /> Dada de baja
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" /> Activa
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditCommission(c)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                            title="Editar comisión"
                          >
                            Editar
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenImpact(c)}
                            className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors cursor-pointer"
                            title="Dar de baja o eliminar..."
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal: Impact Preview & Retirement / Safe Deletion ── */}
      {impactModalOpen && impactTarget && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100">
            <div className="flex items-start gap-3.5 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Impacto en Alumnos</h3>
                <p className="text-xs text-slate-400">Comisión {impactTarget.code}</p>
              </div>
            </div>

            {isLoadingImpact || !impactData ? (
              <div className="py-10 text-center text-slate-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-400 mb-2" />
                Analizando alumnos inscriptos...
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Alumnos cursando actualmente:</span>
                    <span className="font-bold text-white">{impactData.activeEnrollmentsCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Historial histórico de cursadas:</span>
                    <span className="font-bold text-white">{impactData.historyEnrollmentsCount}</span>
                  </div>
                </div>

                {impactData.hasEnrolledStudents ? (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200">
                    <p className="font-semibold mb-1">Recomendación: Dar de baja (Retirar)</p>
                    <p className="text-[11px] leading-relaxed">
                      Esta comisión tiene alumnos registrados. Si la eliminás físicamente, se perderán las cursadas guardadas de esos usuarios. Darla de baja oculta la comisión de la oferta actual sin borrar el historial.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300">
                    <p className="font-semibold mb-1">Sin alumnos asociados</p>
                    <p className="text-[11px]">
                      Ningún usuario ha seleccionado esta comisión. Es seguro eliminarla físicamente.
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setImpactModalOpen(false)}
                    className="px-3 py-2 text-slate-400 hover:text-white"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    onClick={handleRetireCommission}
                    className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-semibold rounded-xl"
                  >
                    Dar de baja (Preserva historial)
                  </button>

                  {!impactData.hasEnrolledStudents && (
                    <button
                      type="button"
                      onClick={handleDeleteCommission}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl"
                    >
                      Eliminar definitivamente
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: Commission Form (Create / Edit) with Slot Validation ── */}
      {commissionFormModalOpen && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100 my-8">
            <h3 className="text-base font-bold text-white mb-4">
              {editingCommission ? `Editar Comisión ${editingCommission.code}` : 'Nueva Comisión'}
            </h3>

            <form onSubmit={handleSaveCommission} className="space-y-4 text-xs">
              {/* Subject */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Materia</label>
                <select
                  value={formSubjectId}
                  onChange={(e) => setFormSubjectId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      #{s.code} {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Code & Shift */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Código (ej. 1K1, 3K2)</label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="1K1"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white uppercase focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Turno</label>
                  <select
                    value={formShift}
                    onChange={(e) => setFormShift(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="M">Mañana</option>
                    <option value="T">Tarde</option>
                    <option value="N">Noche</option>
                  </select>
                </div>
              </div>

              {/* Classroom & Professor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Aula / Salón</label>
                  <input
                    type="text"
                    value={formClassroom}
                    onChange={(e) => setFormClassroom(e.target.value)}
                    placeholder="Aula 104"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Docente Asignado</label>
                  <input
                    type="text"
                    value={formProfessor}
                    onChange={(e) => setFormProfessor(e.target.value)}
                    placeholder="Botta, Oscar"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Schedule Slots with Validation */}
              <div className="pt-2 border-t border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-slate-300">Franjas Horarias</span>
                  <button
                    type="button"
                    onClick={() =>
                      setFormSlots([...formSlots, { day: 1, start: '08:00', end: '12:00' }])
                    }
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    + Agregar Franja
                  </button>
                </div>

                <div className="space-y-2">
                  {formSlots.map((slot, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800">
                      <select
                        value={slot.day}
                        onChange={(e) => {
                          const updated = [...formSlots];
                          updated[idx].day = Number(e.target.value);
                          setFormSlots(updated);
                        }}
                        className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2 py-1 text-xs"
                      >
                        <option value={1}>Lunes</option>
                        <option value={2}>Martes</option>
                        <option value={3}>Miércoles</option>
                        <option value={4}>Jueves</option>
                        <option value={5}>Viernes</option>
                        <option value={6}>Sábado</option>
                      </select>

                      <input
                        type="time"
                        value={slot.start}
                        onChange={(e) => {
                          const updated = [...formSlots];
                          updated[idx].start = e.target.value;
                          setFormSlots(updated);
                        }}
                        className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2 py-1 text-xs"
                      />
                      <span>a</span>
                      <input
                        type="time"
                        value={slot.end}
                        onChange={(e) => {
                          const updated = [...formSlots];
                          updated[idx].end = e.target.value;
                          setFormSlots(updated);
                        }}
                        className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2 py-1 text-xs"
                      />

                      {formSlots.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setFormSlots(formSlots.filter((_, i) => i !== idx))}
                          className="p-1 text-red-400 hover:text-red-300 ml-auto"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCommissionFormModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl"
                >
                  Guardar Comisión
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Duplicate Term ── */}
      {duplicateTermModalOpen && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100">
            <h3 className="text-base font-bold text-white mb-2">Duplicar Período en Borrador</h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Crea un nuevo período copiando todas las comisiones, docentes y horarios actuales. El nuevo ciclo se creará en modo borrador para revisión.
            </p>

            <form onSubmit={handleDuplicateTerm} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre del nuevo ciclo</label>
                <input
                  type="text"
                  required
                  value={dupName}
                  onChange={(e) => setDupName(e.target.value)}
                  placeholder="ej. 2do Cuatrimestre 2026"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Año académico</label>
                <input
                  type="number"
                  required
                  value={dupYear}
                  onChange={(e) => setDupYear(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDuplicateTermModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl"
                >
                  Duplicar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: New Term ── */}
      {newTermModalOpen && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100">
            <h3 className="text-base font-bold text-white mb-4">Crear Nuevo Período Académico</h3>

            <form onSubmit={handleCreateTerm} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre</label>
                <input
                  type="text"
                  required
                  value={newTermName}
                  onChange={(e) => setNewTermName(e.target.value)}
                  placeholder="ej. 1er Cuatrimestre 2027"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Año</label>
                <input
                  type="number"
                  required
                  value={newTermYear}
                  onChange={(e) => setNewTermYear(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newTermDraft}
                  onChange={(e) => setNewTermDraft(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-indigo-600"
                />
                <span>Crear en modo Borrador (oculto a alumnos)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewTermModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl"
                >
                  Crear Período
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Schedule JSON Import with SHA-256 Preview & Apply ── */}
      {importModalOpen && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
          <div className="relative w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100 my-8">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-400" />
              Importación Masiva de Horarios
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Pegá el JSON exportado con la oferta de comisiones. Se verificará su integridad mediante hash SHA-256 antes de aplicar los cambios.
            </p>

            <div className="space-y-4 text-xs">
              <textarea
                rows={7}
                value={importJsonText}
                onChange={(e) => {
                  setImportJsonText(e.target.value);
                  setImportPreview(null);
                }}
                placeholder='[ { "termId": "2026-1c", "commissions": [...] } ]'
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-indigo-500"
              />

              {!importPreview ? (
                <button
                  type="button"
                  onClick={handlePreviewImport}
                  disabled={isLoadingPreview || !importJsonText.trim()}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                >
                  {isLoadingPreview ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>Previsualizar y Generar Hash SHA-256</span>
                  )}
                </button>
              ) : (
                <div className="space-y-3 p-4 bg-slate-950 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="font-semibold text-slate-300">Integridad Hash SHA-256:</span>
                    <span className="font-mono text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {importPreview.previewHash.substring(0, 16)}...
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Períodos detectados:</span>
                      <span className="font-bold text-white">{importPreview.totalTerms}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Comisiones a procesar:</span>
                      <span className="font-bold text-white">{importPreview.totalCommissions}</span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleApplyImport}
                      disabled={isApplyingImport}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                    >
                      {isApplyingImport ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <span>Aplicar Importación (Exige Reautenticación)</span>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reauth Modal */}
      <AdminReauthModal
        isOpen={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={handleReauthSuccess}
        actionTitle={reauthTitle}
        description={reauthDesc}
      />
    </div>
  );
};
