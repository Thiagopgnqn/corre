import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  X,
  UploadCloud,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Check,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Plus,
  Info,
} from 'lucide-react';
import { libraryApi } from '../../api/library.api';
import {
  LIBRARY_CONFIG,
  type LibraryFileKind,
  type LibraryTerm,
} from '../../types/library';
import {
  type BatchFileItem,
  parseFilenameSuggestions,
  applyDefaultYearTerm,
  validateBatchItem,
  UploadQueueCoordinator,
} from '../../utils/libraryUploadLogic';

interface SubjectItem {
  id: string; // UUID
  name: string;
  codeInPlan: number;
  level: number;
}

interface UploadMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialSubjectId?: string;
  subjects: SubjectItem[];
  onOpenTerms?: () => void;
}

const RECENT_YEARS = [2026, 2025, 2024, 2023, 2022];

export const UploadMaterialModal: React.FC<UploadMaterialModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialSubjectId,
  subjects,
  onOpenTerms,
}) => {
  // Materia común al lote
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');

  // Lote de archivos
  const [items, setItems] = useState<BatchFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Defaults de año y cuatrimestre para el lote
  const currentYear = new Date().getFullYear();
  const [defaultYear, setDefaultYear] = useState<number>(currentYear);
  const [defaultTerm, setDefaultTerm] = useState<LibraryTerm>('1C');

  // Términos
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [hasAcceptedTermsInProfile, setHasAcceptedTermsInProfile] = useState<boolean>(false);

  // Cupos y cuota
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [maxPending, setMaxPending] = useState<number>(30);
  const [usedBytes, setUsedBytes] = useState<number>(0);
  const [maxBytes, setMaxBytes] = useState<number>(LIBRARY_CONFIG.MAX_USER_QUOTA_BYTES);

  // Coordinador y estado de subida
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [overallStats, setOverallStats] = useState({
    totalBytes: 0,
    uploadedBytes: 0,
    percent: 0,
    completedCount: 0,
    totalCount: 0,
  });
  const [isSuccessAll, setIsSuccessAll] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Tarjetas colapsadas/expandidas en mobile ("Más datos")
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const coordinatorRef = useRef<UploadQueueCoordinator | null>(null);

  // 1. Cargar términos y cuotas al abrir
  useEffect(() => {
    if (isOpen) {
      libraryApi
        .getTermsStatus()
        .then((res) => {
          if (res.success && res.data?.accepted) {
            setHasAcceptedTermsInProfile(true);
            setAcceptedTerms(true);
          }
        })
        .catch(() => {});

      libraryApi
        .peekMyUploads()
        .then((res) => {
          if (res.success && res.data) {
            if (res.data.pendingCount !== undefined) setPendingCount(res.data.pendingCount);
            if (res.data.maxPending !== undefined) setMaxPending(res.data.maxPending);
            if (res.data.usedBytes !== undefined) setUsedBytes(res.data.usedBytes);
            if (res.data.maxBytes !== undefined) setMaxBytes(res.data.maxBytes);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // 2. Preselección de materia si se pasa initialSubjectId
  useEffect(() => {
    if (subjects.length > 0) {
      if (initialSubjectId) {
        const found = subjects.find(
          (s) => s.id === initialSubjectId || String(s.codeInPlan) === String(initialSubjectId)
        );
        if (found) {
          setSelectedSubjectId(found.id);
          return;
        }
      }
      if (!selectedSubjectId && subjects[0]) {
        setSelectedSubjectId(subjects[0].id);
      }
    }
  }, [initialSubjectId, subjects, selectedSubjectId]);

  // Manejo de ítems en el coordinador
  const handleItemCoordinatorChange = useCallback((updatedItem: BatchFileItem) => {
    setItems((prev) => prev.map((it) => (it.id === updatedItem.id ? updatedItem : it)));
  }, []);

  const handleOverallProgress = useCallback(
    (stats: {
      totalBytes: number;
      uploadedBytes: number;
      percent: number;
      completedCount: number;
      totalCount: number;
    }) => {
      setOverallStats(stats);
      if (stats.totalCount > 0 && stats.completedCount === stats.totalCount) {
        setIsSuccessAll(true);
        setIsUploading(false);
        if (onSuccess) onSuccess();
      }
    },
    [onSuccess]
  );

  // Instanciar coordinador
  useEffect(() => {
    coordinatorRef.current = new UploadQueueCoordinator({
      maxConcurrentPuts: 3,
      maxConcurrentCompletes: 2,
      maxRetries: 4,
      backoffDelays: [1000, 2000, 4000, 8000],
      onItemChange: handleItemCoordinatorChange,
      onOverallProgress: handleOverallProgress,
    });
  }, [handleItemCoordinatorChange, handleOverallProgress]);

  // Cupo restante de subidas pendientes
  const availableSlots = Math.max(0, maxPending - pendingCount);

  // Agregar archivos con sugerencias inteligentes
  const processFilesToAdd = (files: FileList | File[]) => {
    setGlobalError(null);
    const newItems: BatchFileItem[] = [];

    const fileArray = Array.from(files);
    // Verificamos si supera el cupo de moderación
    const currentTotal = items.length + fileArray.length;
    if (currentTotal > availableSlots) {
      setGlobalError(
        `Solo podés subir hasta ${availableSlots} archivo${
          availableSlots === 1 ? '' : 's'
        } más (cupo de moderación: 30 aportes pendientes).`
      );
    }

    const sub = subjects.find((s) => s.id === selectedSubjectId);
    const subName = sub ? sub.name : '';

    for (const f of fileArray) {
      const suggestions = parseFilenameSuggestions(f.name);
      const uniqueId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Si el nombre no tenía año inferido, usamos defaultYear
      const finalYear = suggestions.academicYear ?? defaultYear;
      const finalTerm = suggestions.term ?? defaultTerm;

      // Si el título inferido es muy escueto, le damos formato útil
      let finalTitle = suggestions.cleanTitle;
      if (!finalTitle || finalTitle.length < 4) {
        if (suggestions.kind === 'parcial') {
          finalTitle = `${suggestions.examInstance || '1° Parcial'} ${subName} (${finalYear} - ${finalTerm})`.trim();
        } else if (suggestions.kind === 'final') {
          finalTitle = `Examen Final ${subName} (${finalYear})`.trim();
        } else {
          finalTitle = `${f.name.replace(/\.[^/.]+$/, '')} ${subName}`.trim();
        }
      }

      newItems.push({
        id: uniqueId,
        file: f,
        title: finalTitle.slice(0, 120),
        kind: suggestions.kind,
        academicYear: finalYear,
        term: finalTerm,
        examInstance: suggestions.examInstance,
        hasSolution: suggestions.hasSolution,
        description: '',
        status: 'idle',
        progress: 0,
        retryCount: 0,
      });
    }

    setItems((prev) => [...prev, ...newItems]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFilesToAdd(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFilesToAdd(e.target.files);
      // Resetea el valor para permitir volver a seleccionar el mismo archivo si se borró
      e.target.value = '';
    }
  };

  const removeItem = (id: string) => {
    if (isUploading && coordinatorRef.current) {
      coordinatorRef.current.cancelItem(id);
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
    setExpandedCards((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateItemField = <K extends keyof BatchFileItem>(
    id: string,
    field: K,
    value: BatchFileItem[K]
  ) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        return { ...it, [field]: value };
      })
    );
  };

  const toggleExpand = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Botón "Aplicar a todos" con confirmación
  const handleApplyDefaultsToAll = () => {
    if (items.length === 0) return;
    const ok = window.confirm(
      `¿Deseás aplicar el año ${defaultYear} y cuatrimestre ${defaultTerm} a los ${items.length} archivos del lote? Esto reemplazará los valores actuales.`
    );
    if (ok) {
      setItems((prev) => applyDefaultYearTerm(prev, defaultYear, defaultTerm, true));
    }
  };

  // Cambio en año o cuatrimestre por defecto: solo rellena los que estén vacíos (null / undefined)
  const handleDefaultYearChange = (year: number) => {
    setDefaultYear(year);
    setItems((prev) => applyDefaultYearTerm(prev, year, undefined, false));
  };

  const handleDefaultTermChange = (term: LibraryTerm) => {
    setDefaultTerm(term);
    setItems((prev) => applyDefaultYearTerm(prev, undefined, term, false));
  };

  // Cálculo de archivos válidos e inválidos
  const validationMap = useMemo(() => {
    const map = new Map<string, { valid: boolean; error?: string }>();
    for (const it of items) {
      map.set(it.id, validateBatchItem(it, selectedSubjectId));
    }
    return map;
  }, [items, selectedSubjectId]);

  const validItems = useMemo(() => {
    return items.filter((it) => validationMap.get(it.id)?.valid && it.status !== 'done');
  }, [items, validationMap]);

  const validTotalSizeBytes = useMemo(() => {
    return validItems.reduce((acc, it) => acc + it.file.size, 0);
  }, [validItems]);

  const validTotalSizeMb = (validTotalSizeBytes / (1024 * 1024)).toFixed(1);

  // Iniciar subida con el coordinador
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validItems.length === 0) {
      setGlobalError('No hay archivos válidos para subir en este lote.');
      return;
    }
    if (!acceptedTerms) {
      setGlobalError('Debés aceptar los términos de uso y derechos de autor.');
      return;
    }

    setIsUploading(true);
    setGlobalError(null);

    // Si aún no aceptó términos en perfil, registramos en backend
    if (!hasAcceptedTermsInProfile) {
      try {
        await libraryApi.acceptTerms();
        setHasAcceptedTermsInProfile(true);
      } catch (termsErr) {
        console.warn('Aviso al registrar términos:', termsErr);
      }
    }

    if (coordinatorRef.current) {
      coordinatorRef.current.setQueue(items, selectedSubjectId);
      coordinatorRef.current.start();
    }
  };

  const handleRetryFailed = () => {
    if (coordinatorRef.current) {
      coordinatorRef.current.retryFailed();
      setIsUploading(true);
    }
  };

  const resetAll = () => {
    if (isUploading && coordinatorRef.current) {
      coordinatorRef.current.cancelAll();
    }
    setItems([]);
    setIsSuccessAll(false);
    setIsUploading(false);
    setGlobalError(null);
    setOverallStats({
      totalBytes: 0,
      uploadedBytes: 0,
      percent: 0,
      completedCount: 0,
      totalCount: 0,
    });
  };

  const handleClose = () => {
    if (isUploading) {
      const confirmClose = window.confirm(
        'Hay subidas en curso. Si cerrás el modal se cancelarán las transferencias activas. ¿Deseás salir?'
      );
      if (!confirmClose) return;
      if (coordinatorRef.current) {
        coordinatorRef.current.cancelAll();
      }
    }
    resetAll();
    onClose();
  };

  const hasFailedItems = items.some((it) => it.status === 'error');
  const allDoneCount = items.filter((it) => it.status === 'done').length;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden"
    >
      <div className="w-full max-w-2xl max-h-[92dvh] sm:max-h-[90vh] bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col my-0 sm:my-4">
        {/* HEADER */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 id="upload-modal-title" className="text-sm sm:text-base font-bold text-white">
                Subir Material de Estudio
              </h2>
              <p className="text-[11px] text-slate-400">
                Subida múltiple · PDF hasta 25 MB · Fotos hasta 10 MB
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar ventana"
            className="p-2 min-h-[44px] min-w-[44px] rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* CUPOS Y CUOTA BANNER */}
        <div className="px-5 py-2.5 bg-slate-950/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0">
          <div className="flex items-center gap-2 text-slate-300">
            <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>
              Cupo de moderación:{' '}
              <strong className={availableSlots <= 5 ? 'text-amber-400' : 'text-slate-100'}>
                {availableSlots} de {maxPending} disponibles
              </strong>
            </span>
          </div>
          <div className="text-slate-400">
            Espacio restante:{' '}
            <strong className="text-slate-200">
              {Math.max(0, (maxBytes - usedBytes) / (1024 * 1024)).toFixed(0)} MB
            </strong>
          </div>
        </div>

        {/* CONTENIDO PRINCIPAL */}
        {isSuccessAll ? (
          <div className="p-8 text-center space-y-4 overflow-y-auto flex-1">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <Check className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-white">¡Lote enviado con éxito!</h3>
              <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                Tus <strong className="text-white">{allDoneCount}</strong> archivos ingresaron a la{' '}
                <span className="text-amber-400 font-semibold">cola de moderación</span>. Serán revisados por el equipo y publicados a la brevedad.
              </p>
            </div>
            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400 max-w-md mx-auto text-left flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                Podés seguir el estado de tus aportes en tiempo real desde{' '}
                <strong className="text-slate-200">&ldquo;Mis Aportes&rdquo;</strong>.
              </span>
            </div>
            <div className="pt-3 flex justify-center gap-3">
              <button
                type="button"
                onClick={resetAll}
                className="px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center"
              >
                Subir otro lote
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2.5 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer flex items-center justify-center"
              >
                Listo, volver al catálogo
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
            {/* SELECCIÓN DE MATERIA COMÚN */}
            <div>
              <label
                htmlFor="upload-subject-select"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                Materia del lote <span className="text-rose-400">*</span>
              </label>
              <select
                id="upload-subject-select"
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                disabled={isUploading}
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.level ? `${sub.level}° - ` : ''}{sub.name}
                  </option>
                ))}
              </select>
            </div>

            {/* DROPZONE MÚLTIPLE */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!isUploading) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => {
                if (!isUploading) fileInputRef.current?.click();
              }}
              className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-indigo-400 bg-indigo-500/10'
                  : items.length > 0
                  ? 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                  : 'border-slate-700 hover:border-indigo-500/60 bg-slate-950/50'
              } ${isUploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div className="space-y-2 py-1">
                <UploadCloud className="w-8 h-8 text-indigo-400 mx-auto" />
                <p className="text-xs font-semibold text-slate-200">
                  Arrastrá tus archivos acá o tocalos para seleccionarlos
                </p>
                <p className="text-[11px] text-slate-400">
                  Podés elegir varios parciales, resúmenes o finales a la vez
                </p>
                <div className="pt-1">
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl bg-indigo-600/25 text-indigo-300 font-bold text-xs border border-indigo-500/40 shadow-sm">
                    <Plus className="w-4 h-4" />
                    <span>Elegir archivo o foto</span>
                  </span>
                </div>
              </div>
            </div>

            {/* CONTROLES POR DEFECTO PARA EL LOTE (AÑO Y CUATRIMESTRE) */}
            {items.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Valores por defecto para el lote</span>
                  <button
                    type="button"
                    onClick={handleApplyDefaultsToAll}
                    disabled={isUploading}
                    className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 min-h-[44px] px-2 py-1 rounded hover:bg-slate-800/60 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Aplicar a todos
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Selector de Año por Defecto + Chips */}
                  <div>
                    <label
                      htmlFor="default-year-input"
                      className="block text-[11px] font-medium text-slate-400 mb-1"
                    >
                      Año por defecto (rellena campos vacíos)
                    </label>
                    <input
                      id="default-year-input"
                      type="number"
                      min={2000}
                      max={2030}
                      value={defaultYear}
                      onChange={(e) => handleDefaultYearChange(Number(e.target.value))}
                      disabled={isUploading}
                      className="w-full px-2.5 py-1.5 min-h-[44px] rounded-xl bg-slate-900 border border-slate-700 text-base sm:text-xs text-white"
                    />
                    {/* Chips de años recientes para móvil */}
                    <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1">
                      {RECENT_YEARS.map((y) => (
                        <button
                          key={y}
                          type="button"
                          onClick={() => handleDefaultYearChange(y)}
                          disabled={isUploading}
                          className={`px-2.5 py-1 min-h-[44px] text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 ${
                            defaultYear === y
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                          }`}
                        >
                          {y}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Cuatrimestre por Defecto */}
                  <div>
                    <label
                      htmlFor="default-term-select"
                      className="block text-[11px] font-medium text-slate-400 mb-1"
                    >
                      Cuatrimestre por defecto
                    </label>
                    <select
                      id="default-term-select"
                      value={defaultTerm}
                      onChange={(e) => handleDefaultTermChange(e.target.value as LibraryTerm)}
                      disabled={isUploading}
                      className="w-full px-2.5 py-1.5 min-h-[44px] rounded-xl bg-slate-900 border border-slate-700 text-base sm:text-xs text-white"
                    >
                      <option value="1C">1° Cuatrimestre</option>
                      <option value="2C">2° Cuatrimestre</option>
                      <option value="A">Anual</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* LISTADO DE TARJETAS POR ARCHIVO */}
            {items.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                  <span>Archivos en el lote ({items.length})</span>
                  <button
                    type="button"
                    onClick={() => addMoreInputRef.current?.click()}
                    disabled={isUploading}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 min-h-[44px] px-2 py-1 rounded cursor-pointer disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Agregar más archivos
                  </button>
                  <input
                    ref={addMoreInputRef}
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>

                <div className="space-y-2.5">
                  {items.map((item, idx) => {
                    const validation = validationMap.get(item.id);
                    const isExpanded = expandedCards.has(item.id);
                    const isPdf =
                      item.file.type === 'application/pdf' ||
                      item.file.name.toLowerCase().endsWith('.pdf');

                    return (
                      <div
                        key={item.id}
                        className={`p-3.5 rounded-2xl border transition-all ${
                          item.status === 'done'
                            ? 'bg-emerald-950/20 border-emerald-500/40'
                            : item.status === 'error'
                            ? 'bg-rose-950/25 border-rose-500/40'
                            : !validation?.valid
                            ? 'bg-slate-950/80 border-amber-500/40'
                            : 'bg-slate-950/60 border-slate-800'
                        }`}
                      >
                        {/* Fila Cabecera: Icono, Nombre original, Tamaño y Botón Borrar */}
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5 text-indigo-400">
                              {isPdf ? (
                                <FileText className="w-4 h-4" />
                              ) : (
                                <ImageIcon className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-white truncate" title={item.file.name}>
                                #{idx + 1} · {item.file.name}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            aria-label={`Quitar archivo ${item.file.name}`}
                            className="p-2 min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Campos Principales: Título y Tipo */}
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div className="sm:col-span-2">
                            <label
                              htmlFor={`title-${item.id}`}
                              className="block text-[11px] font-medium text-slate-400 mb-1"
                            >
                              Título descriptivo <span className="text-rose-400">*</span>
                            </label>
                            <input
                              id={`title-${item.id}`}
                              type="text"
                              maxLength={120}
                              value={item.title}
                              onChange={(e) => updateItemField(item.id, 'title', e.target.value)}
                              disabled={isUploading}
                              className="w-full px-2.5 py-2 min-h-[44px] rounded-xl bg-slate-900 border border-slate-700 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`kind-${item.id}`}
                              className="block text-[11px] font-medium text-slate-400 mb-1"
                            >
                              Tipo
                            </label>
                            <select
                              id={`kind-${item.id}`}
                              value={item.kind}
                              onChange={(e) =>
                                updateItemField(item.id, 'kind', e.target.value as LibraryFileKind)
                              }
                              disabled={isUploading}
                              className="w-full px-2.5 py-2 min-h-[44px] rounded-xl bg-slate-900 border border-slate-700 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                            >
                              <option value="parcial">Parcial</option>
                              <option value="final">Final</option>
                              <option value="apunte">Apunte</option>
                              <option value="resumen">Resumen</option>
                              <option value="tp">Trabajo Práctico</option>
                              <option value="guia">Guía</option>
                              <option value="otro">Otro</option>
                            </select>
                          </div>
                        </div>

                        {/* Datos de Examen (si es Parcial o Final) */}
                        {['parcial', 'final'].includes(item.kind) && (
                          <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <div>
                              <label
                                htmlFor={`year-${item.id}`}
                                className="block text-[10px] font-medium text-slate-400 mb-0.5"
                              >
                                Año <span className="text-rose-400">*</span>
                              </label>
                              <input
                                id={`year-${item.id}`}
                                type="number"
                                min={2000}
                                max={2030}
                                value={item.academicYear ?? ''}
                                onChange={(e) =>
                                  updateItemField(
                                    item.id,
                                    'academicYear',
                                    e.target.value ? Number(e.target.value) : null
                                  )
                                }
                                disabled={isUploading}
                                className="w-full px-2 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-base sm:text-xs text-white"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`term-${item.id}`}
                                className="block text-[10px] font-medium text-slate-400 mb-0.5"
                              >
                                Cuatrimestre
                              </label>
                              <select
                                id={`term-${item.id}`}
                                value={item.term ?? '1C'}
                                onChange={(e) =>
                                  updateItemField(item.id, 'term', e.target.value as LibraryTerm)
                                }
                                disabled={isUploading}
                                className="w-full px-2 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-base sm:text-xs text-white"
                              >
                                <option value="1C">1C</option>
                                <option value="2C">2C</option>
                                <option value="A">Anual</option>
                              </select>
                            </div>

                            <div className="col-span-2 sm:col-span-1">
                              <label
                                htmlFor={`inst-${item.id}`}
                                className="block text-[10px] font-medium text-slate-400 mb-0.5"
                              >
                                Instancia
                              </label>
                              <input
                                id={`inst-${item.id}`}
                                type="text"
                                value={item.examInstance ?? ''}
                                onChange={(e) => updateItemField(item.id, 'examInstance', e.target.value)}
                                disabled={isUploading}
                                placeholder="1° Parcial..."
                                className="w-full px-2 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-base sm:text-xs text-white"
                              />
                            </div>
                          </div>
                        )}

                        {/* Checkbox Resolución */}
                        <div className="mt-2.5 flex items-center justify-between">
                          <label className="inline-flex items-center gap-2 cursor-pointer min-h-[44px]">
                            <input
                              type="checkbox"
                              checked={item.hasSolution}
                              onChange={(e) => updateItemField(item.id, 'hasSolution', e.target.checked)}
                              disabled={isUploading}
                              className="w-4 h-4 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-900"
                            />
                            <span className="text-xs text-slate-300 font-medium">
                              Incluye resolución
                            </span>
                          </label>

                          {/* Botón "Más datos" para mobile */}
                          <button
                            type="button"
                            onClick={() => toggleExpand(item.id)}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 min-h-[44px] px-2 py-1 cursor-pointer"
                          >
                            <span>{isExpanded ? 'Menos datos' : 'Más datos'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {/* Sección Colapsable: Descripción / Comentarios */}
                        {isExpanded && (
                          <div className="mt-2 pt-2 border-t border-slate-800/80">
                            <label
                              htmlFor={`desc-${item.id}`}
                              className="block text-[10px] font-medium text-slate-400 mb-1"
                            >
                              Descripción o notas (opcional)
                            </label>
                            <textarea
                              id={`desc-${item.id}`}
                              rows={2}
                              maxLength={500}
                              value={item.description}
                              onChange={(e) => updateItemField(item.id, 'description', e.target.value)}
                              disabled={isUploading}
                              placeholder="Cátedra, temas, notas adicionales..."
                              className="w-full px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-base sm:text-xs text-white resize-none"
                            />
                          </div>
                        )}

                        {/* Estado y Progreso del Ítem */}
                        {item.status !== 'idle' && (
                          <div className="mt-2.5 pt-2 border-t border-slate-800/60" aria-live="polite">
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="flex items-center gap-1.5 text-slate-300">
                                {item.status === 'init' && (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                                    Preparando subida...
                                  </>
                                )}
                                {item.status === 'uploading' && (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                                    Transfiriendo archivo...
                                  </>
                                )}
                                {item.status === 'completing' && (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                                    Validando seguridad...
                                  </>
                                )}
                                {item.status === 'done' && (
                                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5" />
                                    Subido a moderación
                                  </span>
                                )}
                                {item.status === 'error' && (
                                  <span className="text-rose-400 font-semibold flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    {item.error || 'Error'}
                                  </span>
                                )}
                                {item.status === 'cancelled' && (
                                  <span className="text-slate-400">Cancelado</span>
                                )}
                              </span>
                              <span className="font-mono text-slate-400">{item.progress}%</span>
                            </div>

                            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full transition-all duration-200 ${
                                  item.status === 'done'
                                    ? 'bg-emerald-500'
                                    : item.status === 'error'
                                    ? 'bg-rose-500'
                                    : 'bg-indigo-500'
                                }`}
                                style={{ width: `${item.progress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Error de validación local (no bloquea al resto) */}
                        {!validation?.valid && item.status === 'idle' && (
                          <p className="mt-2 text-[11px] text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {validation?.error}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ACEPTACIÓN DE TÉRMINOS */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  disabled={isUploading}
                  className="w-5 h-5 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900 mt-0.5 shrink-0"
                />
                <span className="text-xs text-slate-300 leading-snug">
                  Acepto los términos de la Biblioteca y declaro que estos archivos son material legítimo de estudio, no infringen derechos de autor comerciales ni contienen datos privados.
                </span>
              </label>
              {onOpenTerms && (
                <div className="pl-7">
                  <button
                    type="button"
                    onClick={onOpenTerms}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline inline-flex items-center gap-1 cursor-pointer min-h-[44px]"
                  >
                    Leer Términos de Uso y Política de Propiedad Intelectual
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* BARRA DE PROGRESO GLOBAL DURANTE SUBIDA */}
            {isUploading && (
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2" aria-live="polite">
                <div className="flex items-center justify-between text-xs text-slate-200">
                  <span className="font-semibold flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    Subiendo lote ({overallStats.completedCount}/{overallStats.totalCount} completados)
                  </span>
                  <span className="font-mono font-bold text-indigo-300">
                    {overallStats.percent}%
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
                    style={{ width: `${overallStats.percent}%` }}
                  />
                </div>
              </div>
            )}

            {/* ERROR GLOBAL O FALLIDOS */}
            {globalError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{globalError}</span>
              </div>
            )}

            {hasFailedItems && !isUploading && (
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 flex items-center justify-between gap-3">
                <div className="text-xs text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Algunos archivos fallaron durante la subida.</span>
                </div>
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  className="px-3 py-1.5 min-h-[44px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reintentar fallidos
                </button>
              </div>
            )}

            {/* ACCIONES FIJAS AL PIE CON SAFE AREA */}
            <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-md flex items-center justify-end gap-3 p-3.5 sm:p-4 -mx-4 -mb-4 sm:-mx-5 sm:-mb-5 border-t border-slate-800 shadow-lg pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))]">
              <button
                type="button"
                onClick={handleClose}
                disabled={isUploading}
                className="px-4 py-2.5 min-h-[44px] text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-40 flex items-center justify-center"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isUploading || validItems.length === 0 || !acceptedTerms}
                className="px-5 py-2.5 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Subiendo ({overallStats.percent}%)...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    {validItems.length > 0
                      ? `Subir ${validItems.length} archivo${
                          validItems.length === 1 ? '' : 's'
                        } (${validTotalSizeMb} MB)`
                      : 'Elegí archivos válidos'}
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
