import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  UploadCloud,
  FileText,
  Download,
  ThumbsUp,
  Flag,
  CheckCircle2,
  Search,
  Loader2,
  Check,
  X,
} from 'lucide-react';
import { libraryApi } from '../../api/library.api';
import type {
  LibraryFilePublic,
  LibraryFileKind,
  LibraryReportReason,
} from '../../types/library';

interface SubjectInfo {
  id: string; // UUID
  name: string;
  codeInPlan: number;
  level: number;
  modality?: string;
}

interface SubjectLibraryViewProps {
  subject: SubjectInfo;
  onBack: () => void;
  onOpenUpload: () => void;
}

export const SubjectLibraryView: React.FC<SubjectLibraryViewProps> = ({
  subject,
  onBack,
  onOpenUpload,
}) => {
  const [files, setFiles] = useState<LibraryFilePublic[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeKindTab, setActiveKindTab] = useState<string>('todos');
  const [search, setSearch] = useState<string>('');
  const [onlyWithSolution, setOnlyWithSolution] = useState<boolean>(false);
  const [sort, setSort] = useState<'recent' | 'downloads' | 'helpful'>('recent');

  // Report modal state
  const [reportingFile, setReportingFile] = useState<LibraryFilePublic | null>(null);
  const [reportReason, setReportReason] = useState<LibraryReportReason>('derechos_de_autor');
  const [reportNote, setReportNote] = useState<string>('');
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
  const [reportSuccess, setReportSuccess] = useState<boolean>(false);

  // Downloading feedback state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchFiles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const kindParam = activeKindTab !== 'todos' ? (activeKindTab as LibraryFileKind) : undefined;
      const res = await libraryApi.listFiles({
        subjectId: subject.id,
        kind: kindParam,
        search: search.trim() || undefined,
        hasSolution: onlyWithSolution ? true : undefined,
        sort,
      });

      if (res.success && res.data) {
        setFiles(res.data.files);
        setTotal(res.data.total);
      }
    } catch (err: any) {
      console.error('Error al cargar materiales:', err);
      setError(err?.message || 'Error al obtener los materiales de la materia.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [subject.id, activeKindTab, search, sort, onlyWithSolution]);

  const handleDownload = async (file: LibraryFilePublic) => {
    setDownloadingId(file.id);
    try {
      const res = await libraryApi.getDownloadUrl(file.id);
      if (res.success && res.data?.downloadUrl) {
        // Increment local download count
        setFiles((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, downloadCount: f.downloadCount + 1 } : f))
        );
        // Trigger browser download
        const a = document.createElement('a');
        a.href = res.data.downloadUrl;
        a.download = res.data.filename || file.originalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err: any) {
      alert(err?.message || 'Error al descargar el archivo.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleToggleHelpful = async (file: LibraryFilePublic) => {
    try {
      const res = await libraryApi.toggleHelpful(file.id);
      if (res.success && res.data) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id
              ? {
                  ...f,
                  helpfulCount: res.data.helpfulCount,
                  hasVotedHelpful: res.data.hasVoted,
                }
              : f
          )
        );
      }
    } catch (err: any) {
      alert(err?.message || 'Error al registrar tu voto.');
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportingFile) return;

    setIsSubmittingReport(true);
    try {
      await libraryApi.reportFile(reportingFile.id, reportReason, reportNote.trim() || undefined);
      setReportSuccess(true);
      setTimeout(() => {
        setReportingFile(null);
        setReportSuccess(false);
        setReportNote('');
      }, 1500);
    } catch (err: any) {
      alert(err?.message || 'Error al enviar reporte.');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const kindBadge = (k: LibraryFileKind) => {
    switch (k) {
      case 'parcial':
        return <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold text-[11px] uppercase">Parcial</span>;
      case 'final':
        return <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-semibold text-[11px] uppercase">Final</span>;
      case 'apunte':
        return <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold text-[11px] uppercase">Apunte</span>;
      case 'resumen':
        return <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold text-[11px] uppercase">Resumen</span>;
      case 'tp':
        return <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold text-[11px] uppercase">TP</span>;
      case 'guia':
        return <span className="px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 font-semibold text-[11px] uppercase">Guía</span>;
      default:
        return <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold text-[11px] uppercase">Otro</span>;
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-3.5 sm:px-6 py-4 sm:py-6 space-y-6 min-w-0 w-full max-w-full">
      {/* Header */}
      <div className="border-b border-slate-800 pb-5 space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a todas las materias
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                #{subject.codeInPlan}
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Nivel {subject.level}
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                {total} {total === 1 ? 'material aprobado' : 'materiales aprobados'}
              </span>
            </div>
            <h1 className="text-xl sm:text-3xl font-extrabold text-white tracking-tight break-words">
              {subject.name}
            </h1>
          </div>

          <button
            type="button"
            onClick={onOpenUpload}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 cursor-pointer self-start sm:self-auto"
          >
            <UploadCloud className="w-4 h-4" />
            Subir material de esta materia
          </button>
        </div>
      </div>

      {/* Kind Filter Tabs */}
      <div className="w-full min-w-0 max-w-full overflow-x-auto pb-1 scrollbar-none snap-x flex items-center gap-1.5 px-0.5">
        {[
          { id: 'todos', label: 'Todos' },
          { id: 'parcial', label: 'Parciales' },
          { id: 'final', label: 'Finales' },
          { id: 'resumen', label: 'Resúmenes' },
          { id: 'apunte', label: 'Apuntes' },
          { id: 'tp', label: 'TPs' },
          { id: 'guia', label: 'Guías' },
          { id: 'otro', label: 'Otros' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveKindTab(tab.id)}
            className={`px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center justify-center shrink-0 snap-start ${
              activeKindTab === tab.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter and Sort Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800 text-xs">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título o palabras clave..."
            className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-base sm:text-xs"
          />
        </div>

        <div className="flex items-center gap-3 justify-between sm:justify-end">
          {/* Solution toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 whitespace-nowrap">
            <input
              type="checkbox"
              checked={onlyWithSolution}
              onChange={(e) => setOnlyWithSolution(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-700 text-emerald-500 bg-slate-950 focus:ring-emerald-500"
            />
            <span className="text-[11px] font-medium">Solo con resolución</span>
          </label>

          {/* Sort */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[11px]">Orden:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="px-3 py-2 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none"
            >
              <option value="recent">Más recientes</option>
              <option value="downloads">Más descargados</option>
              <option value="helpful">Más útiles</option>
            </select>
          </div>
        </div>
      </div>

      {/* Files Grid */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <p className="text-xs">Cargando materiales aprobados...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchFiles}
            className="px-3 py-1 bg-rose-900 hover:bg-rose-800 rounded-lg text-white font-medium"
          >
            Reintentar
          </button>
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-20 px-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-white">No se encontraron materiales</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              No hay archivos aprobados para esta materia con los filtros seleccionados.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenUpload}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
          >
            Sé el primero en aportar
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {files.map((file) => {
            const isPdf = file.mimeType === 'application/pdf';
            const sizeLabel = `${(file.sizeBytes / (1024 * 1024)).toFixed(2)} MB`;

            return (
              <div
                key={file.id}
                className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2.5">
                  {/* Top Badges */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {kindBadge(file.kind)}

                      {file.academicYear && (
                        <span className="text-[11px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                          {file.academicYear} {file.term ? `· ${file.term}` : ''}
                        </span>
                      )}

                      {file.examInstance && (
                        <span className="text-[11px] text-slate-300 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                          {file.examInstance}
                        </span>
                      )}

                      {file.hasSolution && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold border border-emerald-500/25">
                          <CheckCircle2 className="w-3 h-3" />
                          Con resolución
                        </span>
                      )}
                    </div>

                    {/* Report Menu */}
                    <button
                      type="button"
                      onClick={() => setReportingFile(file)}
                      className="text-slate-500 hover:text-slate-300 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Reportar material"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-sm font-bold text-white leading-snug break-words">
                      {file.title}
                    </h3>
                    {file.description && (
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2 break-words">
                        {file.description}
                      </p>
                    )}
                  </div>

                  {/* Professors tags if present */}
                  {file.professorNames && file.professorNames.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
                      <span className="text-[10px] text-slate-500">Cátedra:</span>
                      {file.professorNames.map((name, i) => (
                        <span
                          key={i}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-950 text-indigo-300 border border-indigo-500/20"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer: Anonymous author, stats & actions */}
                <div className="pt-3 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="text-slate-500 italic">Subido por un estudiante</span>
                    <span className="font-mono text-slate-500">
                      {isPdf ? 'PDF' : 'Imagen'} · {sizeLabel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    {/* Helpful Vote Button */}
                    <button
                      type="button"
                      onClick={() => handleToggleHelpful(file)}
                      className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                        file.hasVotedHelpful
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : 'bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-800'
                      }`}
                      title={file.hasVotedHelpful ? 'Quitar voto útil' : 'Marcar como útil'}
                    >
                      <ThumbsUp className={`w-3.5 h-3.5 ${file.hasVotedHelpful ? 'text-amber-400' : ''}`} />
                      <span>{file.helpfulCount > 0 ? file.helpfulCount : 'Es útil'}</span>
                    </button>

                    {/* Download Button */}
                    <button
                      type="button"
                      onClick={() => handleDownload(file)}
                      disabled={downloadingId === file.id}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
                    >
                      {downloadingId === file.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Descargando...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          <span>Descargar ({file.downloadCount})</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Report Modal */}
      {reportingFile && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
          <form
            onSubmit={handleSubmitReport}
            className="w-full max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Flag className="w-4 h-4 text-rose-400" />
                Reportar Material
              </h3>
              <button
                type="button"
                onClick={() => setReportingFile(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reportSuccess ? (
              <div className="p-6 text-center space-y-2">
                <Check className="w-8 h-8 text-emerald-400 mx-auto" />
                <p className="text-xs font-bold text-white">¡Reporte enviado!</p>
                <p className="text-[11px] text-slate-400">
                  El equipo de moderación revisará el material denunciado a la brevedad.
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-300">
                  Estás reportando: <strong className="text-white">&ldquo;{reportingFile.title}&rdquo;</strong>
                </p>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Motivo del reporte <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value as LibraryReportReason)}
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white"
                  >
                    <option value="derechos_de_autor">Infracción de derechos de autor comercial</option>
                    <option value="contenido_inapropiado">Contenido inapropiado u ofensivo</option>
                    <option value="incorrecto_o_enganoso">Material incorrecto o de otra materia</option>
                    <option value="duplicado">Material duplicado o repetido</option>
                    <option value="otro">Otro motivo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Detalle o aclaración <span className="text-slate-500">(opcional)</span>
                  </label>
                  <textarea
                    rows={3}
                    maxLength={300}
                    value={reportNote}
                    onChange={(e) => setReportNote(e.target.value)}
                    placeholder="Explicá brevemente por qué considerás que debe removerse..."
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setReportingFile(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingReport}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    {isSubmittingReport ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Enviar Reporte
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  );
};
