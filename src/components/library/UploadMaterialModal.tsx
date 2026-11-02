import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { libraryApi } from '../../api/library.api';
import { LIBRARY_CONFIG, type LibraryFileKind, type LibraryTerm } from '../../types/library';

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
  initialSubjectId?: string; // UUID or codeInPlan string
  subjects: SubjectItem[];
  onOpenTerms?: () => void;
}

export const UploadMaterialModal: React.FC<UploadMaterialModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialSubjectId,
  subjects,
  onOpenTerms,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Form fields
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [kind, setKind] = useState<LibraryFileKind>('parcial');
  const [academicYear, setAcademicYear] = useState<number>(new Date().getFullYear());
  const [term, setTerm] = useState<LibraryTerm>('1C');
  const [examInstance, setExamInstance] = useState<string>('1° Parcial');
  const [hasSolution, setHasSolution] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);

  // Upload state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStep, setUploadStep] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill subject if initialSubjectId is provided
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

  // Auto-generate title suggestion when subject, kind, year, instance change (if user hasn't typed custom)
  useEffect(() => {
    if (!title || title.startsWith('Parcial') || title.startsWith('Final') || title.startsWith('Resumen') || title.startsWith('Apunte')) {
      const sub = subjects.find((s) => s.id === selectedSubjectId);
      const subName = sub ? sub.name : '';
      if (kind === 'parcial') {
        setTitle(`${examInstance} ${subName} (${academicYear} - ${term})`.trim());
      } else if (kind === 'final') {
        setTitle(`Examen Final ${subName} (${academicYear})`.trim());
      } else if (kind === 'resumen') {
        setTitle(`Resumen completo ${subName}`.trim());
      } else if (kind === 'apunte') {
        setTitle(`Apuntes de clase ${subName}`.trim());
      } else if (kind === 'tp') {
        setTitle(`Trabajo Práctico ${subName}`.trim());
      } else if (kind === 'guia') {
        setTitle(`Guía de ejercicios ${subName}`.trim());
      }
    }
  }, [selectedSubjectId, kind, academicYear, term, examInstance, subjects]);

  if (!isOpen) return null;

  const validateAndSetFile = (selectedFile: File) => {
    setFileError(null);

    const isPdf = selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf');
    const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type) ||
      /\.(jpe?g|png|webp)$/i.test(selectedFile.name);

    if (!isPdf && !isImage) {
      setFileError('Formato no permitido. Solo se aceptan documentos PDF o imágenes (PNG, JPEG, WEBP).');
      return;
    }

    if (isPdf && selectedFile.size > LIBRARY_CONFIG.MAX_PDF_SIZE_BYTES) {
      setFileError(
        `El PDF supera el límite de 25 MB (tamaño actual: ${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB).`
      );
      return;
    }

    if (isImage && selectedFile.size > LIBRARY_CONFIG.MAX_IMAGE_SIZE_BYTES) {
      setFileError(
        `La imagen supera el límite de 10 MB (tamaño actual: ${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB).`
      );
      return;
    }

    setFile(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setFileError('Debes seleccionar un archivo para subir.');
      return;
    }
    if (!selectedSubjectId) {
      setSubmitError('Debes seleccionar una materia.');
      return;
    }
    if (!title.trim()) {
      setSubmitError('El título del material es obligatorio.');
      return;
    }
    if (!acceptedTerms) {
      setSubmitError('Debes aceptar los términos de uso y derechos de autor.');
      return;
    }

    setIsUploading(true);
    setSubmitError(null);
    setUploadProgress(0);

    try {
      // Paso 1: Iniciar subida y obtener URL prefirmada
      setUploadStep('Preparando subida...');
      const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

      const initRes = await libraryApi.initUpload({
        subjectId: selectedSubjectId,
        kind,
        academicYear: ['parcial', 'final'].includes(kind) ? academicYear : undefined,
        term: ['parcial', 'final'].includes(kind) ? term : undefined,
        examInstance: ['parcial', 'final'].includes(kind) ? examInstance : undefined,
        hasSolution,
        title: title.trim(),
        description: description.trim() || undefined,
        originalFilename: file.name,
        sizeBytes: file.size,
        mimeType,
      });

      const { fileId, uploadUrl } = initRes.data;

      // Paso 2: Subida directa a Cloudflare R2 vía PUT con Content-Type idéntico
      setUploadStep('Transfiriendo archivo...');
      await libraryApi.uploadDirectToR2(uploadUrl, file, mimeType, (pct) => {
        setUploadProgress(pct);
      });

      // Paso 3: Confirmación y verificación de seguridad
      setUploadStep('Validando seguridad y procesando...');
      await libraryApi.completeUpload(fileId);

      setIsSuccess(true);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.error('Error al subir material:', err);
      let msg = err?.message || 'Error inesperado durante la subida.';
      if (err?.code === 'DUPLICATE_FILE') {
        msg = 'Este archivo ya se encuentra en la biblioteca (se detectó un contenido idéntico por firma digital).';
      } else if (err?.code === 'QUOTA_EXCEEDED') {
        msg = 'Superaste tu cuota de almacenamiento disponible (máximo 300 MB por usuario).';
      }
      setSubmitError(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setFileError(null);
    setTitle('');
    setDescription('');
    setHasSolution(false);
    setAcceptedTerms(false);
    setIsSuccess(false);
    setUploadProgress(0);
    setSubmitError(null);
  };

  const handleClose = () => {
    if (isUploading) return;
    resetForm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">Subir Material de Estudio</h2>
              <p className="text-[11px] text-slate-400">PDFs hasta 25 MB o Imágenes hasta 10 MB</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success View */}
        {isSuccess ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <Check className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-white">¡Material enviado con éxito!</h3>
              <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                Tu aporte ingresó a la <span className="text-amber-400 font-semibold">cola de moderación</span>. Será revisado por el equipo y publicado en el catálogo público a la brevedad.
              </p>
            </div>
            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400 max-w-md mx-auto text-left flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                Podés seguir el estado de aprobación de tu material en cualquier momento desde la pestaña <strong className="text-slate-200">&ldquo;Mis Aportes&rdquo;</strong>.
              </span>
            </div>
            <div className="pt-2 flex justify-center gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
              >
                Subir otro archivo
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
              >
                Listo, volver al catálogo
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
            {/* File Dropzone */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Archivo binario (PDF o Imagen) <span className="text-rose-400">*</span>
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-indigo-400 bg-indigo-500/10'
                    : file
                    ? 'border-emerald-500/50 bg-emerald-950/20'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-950/40'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      validateAndSetFile(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />

                {file ? (
                  <div className="flex items-center justify-between text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                        {file.type === 'application/pdf' ? (
                          <FileText className="w-5 h-5" />
                        ) : (
                          <ImageIcon className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate max-w-[280px] sm:max-w-xs">
                          {file.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {(file.size / (1024 * 1024)).toFixed(2)} MB · {file.type || 'Documento'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                      className="text-xs text-rose-400 hover:text-rose-300 font-medium px-2 py-1 rounded bg-rose-950/40 border border-rose-500/30"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <UploadCloud className="w-8 h-8 text-indigo-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-200">
                      Arrastrá tu archivo acá o <span className="text-indigo-400 underline">buscalo en tu dispositivo</span>
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Formatos soportados: PDF (hasta 25 MB), PNG, JPEG, WEBP (hasta 10 MB)
                    </p>
                  </div>
                )}
              </div>
              {fileError && (
                <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {fileError}
                </p>
              )}
            </div>

            {/* Materia y Tipo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Materia <span className="text-rose-400">*</span>
                </label>
                <select
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.level ? `${sub.level}° - ` : ''}{sub.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Tipo de Material <span className="text-rose-400">*</span>
                </label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as LibraryFileKind)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="parcial">Examen Parcial</option>
                  <option value="final">Examen Final</option>
                  <option value="apunte">Apunte de Clase</option>
                  <option value="resumen">Resumen de Materia</option>
                  <option value="tp">Trabajo Práctico</option>
                  <option value="guia">Guía de Ejercicios</option>
                  <option value="otro">Otro Material</option>
                </select>
              </div>
            </div>

            {/* Conditional Exam Fields */}
            {['parcial', 'final'].includes(kind) && (
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Año</label>
                    <input
                      type="number"
                      min={2000}
                      max={2030}
                      value={academicYear}
                      onChange={(e) => setAcademicYear(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Cuatrimestre</label>
                    <select
                      value={term}
                      onChange={(e) => setTerm(e.target.value as LibraryTerm)}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                    >
                      <option value="1C">1° Cuatrimestre</option>
                      <option value="2C">2° Cuatrimestre</option>
                      <option value="A">Anual</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Instancia</label>
                    <input
                      type="text"
                      value={examInstance}
                      onChange={(e) => setExamInstance(e.target.value)}
                      placeholder="1° Parcial, Recuperatorio..."
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasSolution}
                    onChange={(e) => setHasSolution(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-900"
                  />
                  <span className="text-xs text-slate-300 font-medium">
                    Incluye la resolución de los ejercicios
                  </span>
                </label>
              </div>
            )}

            {/* Title & Description */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Título descriptivo <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Primer Parcial Resuelto - Tema 1 (2024)"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Descripción o comentarios adicionales <span className="text-slate-500">(opcional)</span>
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Aclaraciones sobre el tema, unidades abarcadas o cátedra..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
            </div>

            {/* Terms Checkbox */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900 mt-0.5"
                />
                <span className="text-xs text-slate-300 leading-snug">
                  Acepto los términos de la Biblioteca y declaro que este archivo es material legítimo de estudio, no infringe derechos de autor comerciales ni contiene datos privados.
                </span>
              </label>
              {onOpenTerms && (
                <div className="pl-6">
                  <button
                    type="button"
                    onClick={onOpenTerms}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    Leer Términos de Uso y Política de Propiedad Intelectual
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Progress Bar during upload */}
            {isUploading && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    {uploadStep}
                  </span>
                  <span className="font-mono font-bold text-indigo-300">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-amber-400 transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Submit Error */}
            {submitError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isUploading}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isUploading || !file || !acceptedTerms}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Subiendo...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    Subir a Moderación
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

