import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  AlertTriangle,
  HardDrive,
  User,
  UserX,
  Search,
  Loader2,
  Flag,
  RefreshCw,
  Check,
  X,
} from 'lucide-react';
import { adminLibraryApi } from '../../../api/library.api';
import { AdminReauthModal } from '../AdminReauthModal';
import type {
  AdminLibraryFile,
  AdminLibraryReport,
  StorageTestReport,
} from '../../../types/library';

export const AdminLibraryTab: React.FC = () => {
  const [subTab, setSubTab] = useState<'pending' | 'reports' | 'catalog'>('pending');

  // Pending queue
  const [pendingFiles, setPendingFiles] = useState<AdminLibraryFile[]>([]);
  const [isLoadingPending, setIsLoadingPending] = useState(false);

  // Reports
  const [reports, setReports] = useState<AdminLibraryReport[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  // Catalog
  const [catalogFiles, setCatalogFiles] = useState<AdminLibraryFile[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogStatusFilter, setCatalogStatusFilter] = useState<string>('all');
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  // Storage Test State
  const [isTestingStorage, setIsTestingStorage] = useState(false);
  const [storageReport, setStorageReport] = useState<StorageTestReport | null>(null);
  const [isStorageReportOpen, setIsStorageReportOpen] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  // Reauth State
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [reauthTitle, setReauthTitle] = useState('');
  const [reauthDesc, setReauthDesc] = useState('');

  // Reject modal state
  const [rejectingFile, setRejectingFile] = useState<AdminLibraryFile | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmittingReject, setIsSubmittingReject] = useState(false);

  // Action report modal state
  const [actioningReport, setActioningReport] = useState<AdminLibraryReport | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [isSubmittingActionReport, setIsSubmittingActionReport] = useState(false);

  // Preview modal state
  const [previewData, setPreviewData] = useState<{
    url: string;
    mimeType: string;
    filename: string;
  } | null>(null);

  // Uploader Identity Modal State
  const [uploaderData, setUploaderData] = useState<{
    fileTitle: string;
    uploader: {
      id: string;
      name: string;
      email: string;
      createdAt: string;
      status: string;
    };
  } | null>(null);

  // Notification / message
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

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
        showFeedback('error', err?.message || 'Error al ejecutar la acción.');
      } finally {
        setPendingAction(null);
      }
    }
  };

  // Fetch pending files
  const fetchPending = async () => {
    setIsLoadingPending(true);
    try {
      const res = await adminLibraryApi.getPendingFiles();
      if (res.success && res.data) {
        setPendingFiles(res.data.files);
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al cargar cola de moderación.');
    } finally {
      setIsLoadingPending(false);
    }
  };

  // Fetch reports
  const fetchReports = async () => {
    setIsLoadingReports(true);
    try {
      const res = await adminLibraryApi.getReports('open');
      if (res.success && res.data) {
        setReports(res.data.reports);
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al cargar reportes.');
    } finally {
      setIsLoadingReports(false);
    }
  };

  // Fetch catalog
  const fetchCatalog = async () => {
    setIsLoadingCatalog(true);
    try {
      const res = await adminLibraryApi.getCatalog({
        status: catalogStatusFilter !== 'all' ? catalogStatusFilter : undefined,
        search: catalogSearch.trim() || undefined,
      });
      if (res.success && res.data) {
        setCatalogFiles(res.data.files);
        setCatalogTotal(res.data.total);
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al cargar catálogo de biblioteca.');
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  useEffect(() => {
    if (subTab === 'pending') fetchPending();
    else if (subTab === 'reports') fetchReports();
    else if (subTab === 'catalog') fetchCatalog();
  }, [subTab, catalogStatusFilter, catalogSearch]);

  // Test Storage Action
  const handleTestStorage = async () => {
    setIsTestingStorage(true);
    try {
      const res = await adminLibraryApi.testStorage();
      if (res.success && res.data) {
        setStorageReport(res.data);
        setIsStorageReportOpen(true);
        if (res.data.success) {
          showFeedback('success', 'Prueba de almacenamiento con R2 superada con éxito.');
        } else {
          showFeedback('error', `Prueba de R2 fallida en paso ${res.data.step}: ${res.data.message}`);
        }
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al probar conexión con R2.');
    } finally {
      setIsTestingStorage(false);
    }
  };

  // Approve File
  const handleApprove = async (fileId: string) => {
    try {
      await adminLibraryApi.approveFile(fileId);
      showFeedback('success', 'Archivo aprobado y publicado en el catálogo público.');
      fetchPending();
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al aprobar el archivo.');
    }
  };

  // Reject File submit
  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingFile || !rejectionReason.trim()) return;

    setIsSubmittingReject(true);
    try {
      await adminLibraryApi.rejectFile(rejectingFile.id, rejectionReason.trim());
      showFeedback('success', 'Archivo rechazado. Se notificó al estudiante en sus aportes.');
      setRejectingFile(null);
      setRejectionReason('');
      fetchPending();
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al rechazar el archivo.');
    } finally {
      setIsSubmittingReject(false);
    }
  };

  // Resend Admin Notification
  const handleResendNotification = async (fileId: string) => {
    setResendingId(fileId);
    try {
      const res = await adminLibraryApi.resendAdminNotification(fileId);
      if (res.success) {
        showFeedback('success', res.message || 'Aviso enviado a los administradores.');
        await fetchPending();
      } else {
        showFeedback('error', res.message || 'No se pudo enviar el aviso.');
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al reenviar aviso.');
    } finally {
      setResendingId(null);
    }
  };

  // Preview File
  const handlePreview = async (fileId: string) => {
    try {
      const res = await adminLibraryApi.getPreviewUrl(fileId);
      if (res.success && res.data) {
        setPreviewData({
          url: res.data.previewUrl,
          mimeType: res.data.mimeType,
          filename: res.data.filename,
        });
      }
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al obtener URL de vista previa.');
    }
  };

  // View Uploader Identity
  const handleViewUploader = async (file: AdminLibraryFile) => {
    executeWithReauth(
      'Consultar Identidad de Autor',
      'Esta acción revelará el correo y nombre del estudiante que subió el archivo y quedará registrada en la auditoría inmutable.',
      async () => {
        const res = await adminLibraryApi.getUploaderIdentity(file.id);
        if (res.success && res.data) {
          if (res.data.hasUploader && res.data.uploader) {
            setUploaderData({
              fileTitle: file.title,
              uploader: {
                id: res.data.uploader.id,
                name: res.data.uploader.name || res.data.uploader.email.split('@')[0],
                email: res.data.uploader.email,
                createdAt: res.data.uploader.createdAt,
                status: res.data.uploader.status,
              },
            });
          } else {
            showFeedback('error', res.data.message || 'El archivo no tiene autor asociado (cuenta eliminada o anónima).');
          }
        }
      }
    );
  };

  // Suspend Author
  const handleSuspendAuthor = async (file: AdminLibraryFile) => {
    executeWithReauth(
      'Suspender Cuenta de Autor',
      'Se bloqueará el acceso al estudiante autor de este material y se revocarán todas sus sesiones activas.',
      async () => {
        await adminLibraryApi.suspendAuthor(file.id, 'Infracción grave de pautas de la Biblioteca');
        showFeedback('success', 'Cuenta del autor suspendida con éxito.');
        fetchPending();
      }
    );
  };

  // Dismiss report
  const handleDismissReport = async (reportId: string) => {
    try {
      await adminLibraryApi.dismissReport(reportId);
      showFeedback('success', 'Reporte desestimado.');
      fetchReports();
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al desestimar reporte.');
    }
  };

  // Action report (remove material)
  const handleConfirmActionReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actioningReport) return;

    setIsSubmittingActionReport(true);
    try {
      await adminLibraryApi.actionReport(actioningReport, actionReason.trim() || undefined);
      showFeedback('success', 'Archivo removido de la plataforma y reporte marcado como accionado.');
      setActioningReport(null);
      setActionReason('');
      fetchReports();
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al accionar reporte.');
    } finally {
      setIsSubmittingActionReport(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-400" />
            Biblioteca de Material de Estudio
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Moderación de aportes, gestión de reportes de estudiantes y verificación de almacenamiento Cloudflare R2.
          </p>
        </div>

        {/* Button: Probar conexión con R2 */}
        <button
          type="button"
          onClick={() =>
            executeWithReauth(
              'Probar Conexión con Cloudflare R2',
              'Esta prueba subirá un objeto temporal de pocos bytes, comprobará su lectura y lo eliminará de inmediato para validar credenciales y permisos en producción.',
              handleTestStorage
            )
          }
          disabled={isTestingStorage}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-amber-500/30 text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
        >
          {isTestingStorage ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>Ejecutando prueba...</span>
            </>
          ) : (
            <>
              <HardDrive className="w-4 h-4 text-amber-400" />
              <span>Probar conexión con R2</span>
            </>
          )}
        </button>
      </div>

      {/* Feedback Alert */}
      {feedbackMsg && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 transition-all ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/40 border border-rose-500/30 text-rose-300'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Subtab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setSubTab('pending')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
            subTab === 'pending'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Cola de Moderación</span>
          {pendingFiles.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">
              {pendingFiles.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('reports')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
            subTab === 'reports'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <Flag className="w-4 h-4" />
          <span>Reportes de Estudiantes</span>
          {reports.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-bold text-[10px]">
              {reports.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('catalog')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
            subTab === 'catalog'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Catálogo Completo</span>
        </button>
      </div>

      {/* 1. COLA DE MODERACIÓN */}
      {subTab === 'pending' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Archivos en espera de aprobación ({pendingFiles.length})
            </h3>
            <button
              type="button"
              onClick={fetchPending}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Actualizar
            </button>
          </div>

          {isLoadingPending ? (
            <div className="text-center py-16 text-slate-400 space-y-2">
              <Loader2 className="w-7 h-7 animate-spin mx-auto text-indigo-400" />
              <p className="text-xs">Cargando cola de moderación...</p>
            </div>
          ) : pendingFiles.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <p className="text-sm font-bold text-white">Cola al día</p>
              <p className="text-xs text-slate-400">No hay materiales pendientes de revisión humana.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingFiles.map((file) => (
                <div
                  key={file.id}
                  className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 uppercase">
                        {file.kind}
                      </span>
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
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                          Con resolución
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500">
                        {(file.sizeBytes / (1024 * 1024)).toFixed(2)} MB · {file.mimeType}
                      </span>
                      {file.adminNotifiedAt ? (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1"
                          title={`Aviso enviado el ${new Date(file.adminNotifiedAt).toLocaleString()}`}
                        >
                          <Check className="w-3 h-3" /> Aviso enviado
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Aviso pendiente de reintento
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-white leading-snug break-words">
                        {file.title}
                      </h4>
                      {file.description && (
                        <p className="text-xs text-slate-400 mt-0.5 break-words">
                          {file.description}
                        </p>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                      <span>Subido el {new Date(file.createdAt).toLocaleString()}</span>
                      <span>·</span>
                      <span className="font-mono text-slate-600">ID: {file.id.slice(0, 8)}...</span>
                    </div>
                  </div>

                  {/* Moderation Actions */}
                  <div className="flex items-center gap-2 flex-wrap self-end lg:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => handleResendNotification(file.id)}
                      disabled={resendingId === file.id}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Reenviar aviso por correo a los administradores"
                    >
                      {resendingId === file.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
                      )}
                      <span>Reenviar aviso</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePreview(file.id)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Previsualizar
                    </button>

                    <button
                      type="button"
                      onClick={() => handleViewUploader(file)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      title="Ver autor (auditoría)"
                    >
                      <User className="w-3.5 h-3.5 text-indigo-400" />
                      Ver Autor
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSuspendAuthor(file)}
                      className="px-3 py-1.5 rounded-xl bg-rose-950/30 hover:bg-rose-950/60 text-rose-300 border border-rose-500/25 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      title="Suspender cuenta del autor"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      Suspender
                    </button>

                    <button
                      type="button"
                      onClick={() => setRejectingFile(file)}
                      className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Rechazar
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApprove(file.id)}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/30 flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Aprobar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. REPORTES DE ESTUDIANTES */}
      {subTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Reportes abiertos de estudiantes ({reports.length})
            </h3>
            <button
              type="button"
              onClick={fetchReports}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Actualizar
            </button>
          </div>

          {isLoadingReports ? (
            <div className="text-center py-16 text-slate-400 space-y-2">
              <Loader2 className="w-7 h-7 animate-spin mx-auto text-indigo-400" />
              <p className="text-xs">Cargando reportes...</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-2">
              <Check className="w-10 h-10 text-emerald-400 mx-auto" />
              <p className="text-sm font-bold text-white">Sin reportes pendientes</p>
              <p className="text-xs text-slate-400">No hay denuncias abiertas sobre materiales.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-300 uppercase border border-rose-500/30">
                          {report.reason.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Denunciado el {new Date(report.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-white">
                        Archivo: {report.file?.title || 'Material'}
                      </h4>
                      {report.note && (
                        <p className="text-xs text-slate-300 italic bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                          &ldquo;{report.note}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePreview(report.fileId)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Ver Archivo
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDismissReport(report.id)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                      >
                        Desestimar
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setActioningReport(report);
                          setActionReason(report.reason);
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/30"
                      >
                        Remover Archivo
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. CATÁLOGO COMPLETO */}
      {subTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Todos los materiales del catálogo ({catalogTotal})
            </h3>
            <button
              type="button"
              onClick={fetchCatalog}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Actualizar
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Buscar por título..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">Estado:</span>
              <select
                value={catalogStatusFilter}
                onChange={(e) => setCatalogStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              >
                <option value="all">Todos</option>
                <option value="approved">Aprobados</option>
                <option value="pending">Pendientes</option>
                <option value="rejected">Rechazados</option>
                <option value="removed">Removidos</option>
              </select>
            </div>
          </div>

          {isLoadingCatalog ? (
            <div className="text-center py-16 text-slate-400 space-y-2">
              <Loader2 className="w-7 h-7 animate-spin mx-auto text-indigo-400" />
              <p className="text-xs">Cargando catálogo...</p>
            </div>
          ) : catalogFiles.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-xs text-slate-400">
              No se encontraron materiales en el catálogo con los filtros actuales.
            </div>
          ) : (
            <div className="space-y-3">
              {catalogFiles.map((file) => (
                <div
                  key={file.id}
                  className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          file.status === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : file.status === 'pending'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-rose-500/20 text-rose-400'
                        }`}
                      >
                        {file.status}
                      </span>
                      <span className="text-xs font-bold text-white truncate max-w-sm">
                        {file.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {file.kind} · {(file.sizeBytes / (1024 * 1024)).toFixed(2)} MB · {file.downloadCount} descargas
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePreview(file.id)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
                      title="Previsualizar"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleViewUploader(file)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-400"
                      title="Ver autor"
                    >
                      <User className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STORAGE TEST REPORT MODAL */}
      {isStorageReportOpen && storageReport && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <HardDrive className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Informe de Conexión Cloudflare R2</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsStorageReportOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Overall status */}
              <div
                className={`p-3.5 rounded-xl border flex items-center gap-3 ${
                  storageReport.success
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                }`}
              >
                {storageReport.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                )}
                <div>
                  <p className="text-xs font-bold text-white">
                    {storageReport.success ? 'Conexión verificada exitosamente' : 'Fallo en la prueba'}
                  </p>
                  <p className="text-[11px] mt-0.5">{storageReport.message}</p>
                </div>
              </div>

              {/* 3 Steps */}
              <div className="space-y-2 pt-2">
                <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Pasos de Verificación Realizados
                </p>

                {storageReport.stepsCompleted?.map((step, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      {step.success ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <X className="w-4 h-4 text-rose-400" />
                      )}
                      <span className="font-semibold text-slate-200">{step.name}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">{step.message || 'OK'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsStorageReportOpen(false)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT MODAL */}
      {rejectingFile && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <form
            onSubmit={handleConfirmReject}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-white">Rechazar Material</h3>
            <p className="text-xs text-slate-300">
              Estás rechazando: <strong className="text-white">&ldquo;{rejectingFile.title}&rdquo;</strong>
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Motivo del rechazo <span className="text-rose-400">*</span>
              </label>
              <textarea
                rows={3}
                required
                maxLength={300}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explicá el motivo para que el estudiante pueda corregirlo..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingFile(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmittingReject || !rejectionReason.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold"
              >
                {isSubmittingReject ? 'Rechazando...' : 'Confirmar Rechazo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ACTION REPORT MODAL */}
      {actioningReport && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <form
            onSubmit={handleConfirmActionReport}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-white">Remover Archivo Denunciado</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              El archivo será removido permanentemente del catálogo público y se resolverá la denuncia.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Motivo de remoción
              </label>
              <input
                type="text"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActioningReport(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmittingActionReport}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold"
              >
                {isSubmittingActionReport ? 'Removiendo...' : 'Remover y Cerrar Reporte'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* PREVIEW MODAL */}
      {previewData && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-4xl h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950/80">
              <span className="text-xs font-bold text-white truncate max-w-md">
                {previewData.filename}
              </span>
              <button
                type="button"
                onClick={() => setPreviewData(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 bg-slate-950 flex items-center justify-center overflow-auto p-4">
              {previewData.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewData.url}
                  title="PDF Preview"
                  className="w-full h-full rounded-xl border border-slate-800"
                />
              ) : (
                <img
                  src={previewData.url}
                  alt="Vista previa"
                  className="max-w-full max-h-full object-contain rounded-xl"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* UPLOADER IDENTITY MODAL */}
      {uploaderData && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Identidad del Autor</h3>
              </div>
              <button
                type="button"
                onClick={() => setUploaderData(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] leading-snug">
              Esta consulta fue registrada en el log inmutable de auditoría del sistema con tu usuario administrador y timestamp.
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-400">
                Archivo: <strong className="text-white">&ldquo;{uploaderData.fileTitle}&rdquo;</strong>
              </p>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                <p className="text-slate-400">
                  Nombre: <strong className="text-white">{uploaderData.uploader.name}</strong>
                </p>
                <p className="text-slate-400">
                  Correo: <strong className="text-white font-mono">{uploaderData.uploader.email}</strong>
                </p>
                <p className="text-slate-400">
                  Estado de cuenta:{' '}
                  <span
                    className={`font-semibold ${
                      uploaderData.uploader.status === 'active' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {uploaderData.uploader.status}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setUploaderData(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REAUTH MODAL */}
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
