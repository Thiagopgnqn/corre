import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  UploadCloud,
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  HardDrive,
  Trash2,
  Edit2,
  Loader2,
  AlertTriangle,
  Download,
  ThumbsUp,
} from 'lucide-react';
import { libraryApi } from '../../api/library.api';
import type { LibraryFileUser, LibraryMyUploadsResponse } from '../../types/library';

interface MyUploadsViewProps {
  onBack: () => void;
  onOpenUpload: () => void;
}

export const MyUploadsView: React.FC<MyUploadsViewProps> = ({ onBack, onOpenUpload }) => {
  const [data, setData] = useState<LibraryMyUploadsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editingFile, setEditingFile] = useState<LibraryFileUser | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  // Delete modal state
  const [deletingFile, setDeletingFile] = useState<LibraryFileUser | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const fetchMyUploads = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // GET /my-uploads (sin peek) marca las novedades como vistas en el servidor
      const res = await libraryApi.getMyUploads();
      if (res.success && res.data) {
        setData(res.data);
      }
    } catch (err: any) {
      console.error('Error cargando aportes:', err);
      setError(err?.message || 'Error al cargar tus archivos subidos.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMyUploads();
  }, []);

  const handleStartEdit = (file: LibraryFileUser) => {
    setEditingFile(file);
    setEditTitle(file.title);
    setEditDescription(file.description || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFile || !editTitle.trim()) return;

    setIsSavingEdit(true);
    try {
      await libraryApi.updateMyUpload(editingFile.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
      });
      setEditingFile(null);
      await fetchMyUploads();
    } catch (err: any) {
      alert(err?.message || 'Error al actualizar el material.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingFile) return;

    setIsDeleting(true);
    try {
      await libraryApi.deleteMyUpload(deletingFile.id);
      setDeletingFile(null);
      await fetchMyUploads();
    } catch (err: any) {
      alert(err?.message || 'Error al eliminar el material.');
    } finally {
      setIsDeleting(false);
    }
  };

  const usedMb = data ? (data.usedBytes / (1024 * 1024)).toFixed(1) : '0';
  const maxMb = data ? (data.maxBytes / (1024 * 1024)).toFixed(0) : '300';
  const usagePercent = data && data.maxBytes > 0 ? Math.min(100, Math.round((data.usedBytes / data.maxBytes) * 100)) : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver a la Biblioteca
          </button>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white">Mis Aportes</h1>
          <p className="text-xs text-slate-400">
            Administrá tus archivos compartidos y consultá el estado de la moderación.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenUpload}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 cursor-pointer self-start sm:self-auto"
        >
          <UploadCloud className="w-4 h-4" />
          Subir nuevo material
        </button>
      </div>

      {/* Quota Progress Card */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-indigo-400" />
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              Cuota de Almacenamiento Personal
            </h2>
          </div>
          <span className="text-xs font-mono font-bold text-slate-300">
            {usedMb} MB / {maxMb} MB ({usagePercent}%)
          </span>
        </div>

        <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              usagePercent > 90
                ? 'bg-rose-500'
                : usagePercent > 70
                ? 'bg-amber-400'
                : 'bg-gradient-to-r from-indigo-500 to-indigo-400'
            }`}
            style={{ width: `${usagePercent}%` }}
          />
        </div>

        <p className="text-[11px] text-slate-400">
          Cada estudiante dispone de 300 MB de espacio total. Los archivos rechazados o eliminados liberan cuota de forma inmediata.
        </p>
      </div>

      {/* Files List */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-3">
          <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
          <p className="text-xs">Cargando tus aportes...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchMyUploads}
            className="px-3 py-1 bg-rose-900 hover:bg-rose-800 rounded-lg text-white font-medium"
          >
            Reintentar
          </button>
        </div>
      ) : !data || data.files.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-white">Todavía no subiste ningún material</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Compartí tus exámenes parciales, resúmenes o apuntes para ayudar a la comunidad estudiantil.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenUpload}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
          >
            Subir mi primer archivo
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {data.files.map((file) => {
            const sizeLabel = `${(file.sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
            return (
              <div
                key={file.id}
                className="p-4 sm:p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-2 min-w-0 flex-1">
                  {/* Status Badge + Metadata */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {file.status === 'approved' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                        <CheckCircle2 className="w-3 h-3" />
                        Aprobado (Público)
                      </span>
                    )}
                    {file.status === 'pending' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">
                        <Clock className="w-3 h-3" />
                        En revisión
                      </span>
                    )}
                    {file.status === 'rejected' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/25">
                        <XCircle className="w-3 h-3" />
                        Rechazado
                      </span>
                    )}

                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase">
                      {file.kind}
                    </span>

                    <span className="text-[11px] text-slate-500">
                      {sizeLabel} · {new Date(file.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-sm font-bold text-white leading-snug break-words">
                      {file.title}
                    </h3>
                    {file.description && (
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2 break-words">
                        {file.description}
                      </p>
                    )}
                  </div>

                  {/* Rejection Reason notice if rejected */}
                  {file.status === 'rejected' && file.rejectionReason && (
                    <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-rose-300">Motivo del rechazo:</span>{' '}
                        <span>{file.rejectionReason}</span>
                      </div>
                    </div>
                  )}

                  {/* Public Stats if approved */}
                  {file.status === 'approved' && (
                    <div className="flex items-center gap-4 text-xs text-slate-400 pt-0.5">
                      <span className="inline-flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5 text-indigo-400" />
                        {file.downloadCount} descargas
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <ThumbsUp className="w-3.5 h-3.5 text-amber-400" />
                        {file.helpfulCount} votos útiles
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(file)}
                    className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Editar título y descripción"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeletingFile(file)}
                    className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-rose-950/30 hover:bg-rose-950/60 text-rose-400 hover:text-rose-300 border border-rose-500/25 transition-colors cursor-pointer"
                    title="Eliminar material"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Modal */}
      {editingFile && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-white">Editar Material</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Título</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={120}
                required
                className="w-full px-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Descripción (opcional)
              </label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-base sm:text-xs text-white resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingFile(null)}
                className="px-4 py-2.5 min-h-[44px] text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl flex items-center justify-center"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingEdit || !editTitle.trim()}
                className="px-5 py-2.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center"
              >
                {isSavingEdit ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Modal */}
      {deletingFile && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">¿Eliminar material?</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Estás a punto de eliminar <strong className="text-white">&ldquo;{deletingFile.title}&rdquo;</strong>. Esta acción borrará el archivo permanentemente de la plataforma y liberará tu cuota de almacenamiento.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingFile(null)}
                disabled={isDeleting}
                className="px-4 py-2.5 min-h-[44px] text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl flex items-center justify-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-5 py-2.5 min-h-[44px] bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center justify-center"
              >
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar archivo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

