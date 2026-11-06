import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  UploadCloud,
  FileText,
  ShieldCheck,
  ChevronRight,
  ArrowRight,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { libraryApi } from '../../api/library.api';
import { UploadMaterialModal } from './UploadMaterialModal';
import { SubjectLibraryView } from './SubjectLibraryView';
import { MyUploadsView } from './MyUploadsView';
import { LibraryTermsPage } from './LibraryTermsPage';
import { useAuth } from '../../context/AuthContext';
import { useCareer } from '../../context/CareerContext';
import { LibraryWelcomeModal } from './LibraryWelcomeModal';
import { shouldShowLibraryWelcome, markLibraryWelcomeSeen } from '../../utils/libraryCommunityLogic';

interface SubjectItem {
  id: string; // UUID
  name: string;
  codeInPlan: number;
  level: number;
  kind?: string;
  approvedFilesCount?: number;
}

interface LibraryHomeProps {
  initialSubjectId?: string | null;
  initialSubView?: 'home' | 'my-uploads' | 'terms';
}

export const LibraryHome: React.FC<LibraryHomeProps> = ({
  initialSubjectId,
  initialSubView = 'home',
}) => {
  // Navigation sub-view inside library: 'catalog' | 'subject' | 'my-uploads' | 'terms'
  const [subView, setSubView] = useState<'catalog' | 'subject' | 'my-uploads' | 'terms'>(
    initialSubView === 'my-uploads'
      ? 'my-uploads'
      : initialSubView === 'terms'
      ? 'terms'
      : initialSubjectId
      ? 'subject'
      : 'catalog'
  );

  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<SubjectItem | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<number | 'all' | 'electives'>('all');

  // Novelty notification for My Uploads
  const [hasNovelty, setHasNovelty] = useState<boolean>(false);

  // Upload modal
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [uploadTargetSubjectId, setUploadTargetSubjectId] = useState<string | undefined>(undefined);

  // Cartel de bienvenida comunitario (C1)
  const { user } = useAuth();
  const { isTutorialOpen } = useCareer();
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(() =>
    shouldShowLibraryWelcome({ isTutorialOpen, userId: user?.id })
  );

  // Si el tutorial está abierto o se activa, el cartel de bienvenida no debe mostrarse.
  // Al navegar o si no está marcado como visto, lo activa en cualquier subvista.
  useEffect(() => {
    if (isTutorialOpen && showWelcomeModal) {
      setShowWelcomeModal(false);
    } else if (!isTutorialOpen && !showWelcomeModal) {
      if (shouldShowLibraryWelcome({ isTutorialOpen, userId: user?.id })) {
        setShowWelcomeModal(true);
      }
    }
  }, [isTutorialOpen, showWelcomeModal, user?.id, subView]);

  const handleCloseWelcome = () => {
    markLibraryWelcomeSeen(user?.id);
    setShowWelcomeModal(false);
  };

  const handleWelcomeUpload = () => {
    handleCloseWelcome();
    handleOpenUpload();
  };

  // Load subjects summary & novelty check
  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [sumRes, myUpRes] = await Promise.all([
        libraryApi.getSubjectsSummary(),
        libraryApi.peekMyUploads().catch(() => null),
      ]);

      if (sumRes.success && sumRes.data) {
        setSubjects(sumRes.data);
      }

      if (myUpRes && myUpRes.success && myUpRes.data) {
        setHasNovelty(Boolean(myUpRes.data.hasStatusUpdates));
      }
    } catch (err: any) {
      console.error('Error cargando biblioteca:', err);
      setError(err?.message || 'Error al conectar con la biblioteca.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Listen to initialSubjectId or URL changes
  useEffect(() => {
    if (initialSubjectId && subjects.length > 0) {
      const found = subjects.find(
        (s) => s.id === initialSubjectId || String(s.codeInPlan) === String(initialSubjectId)
      );
      if (found) {
        setSelectedSubject(found);
        setSubView('subject');
      }
    }
  }, [initialSubjectId, subjects]);

  const handleSelectSubject = (s: SubjectItem) => {
    setSelectedSubject(s);
    setSubView('subject');
    if (typeof window !== 'undefined') {
      window.location.hash = `library/${s.codeInPlan}`;
    }
  };

  const handleBackToCatalog = () => {
    setSelectedSubject(null);
    setSubView('catalog');
    if (typeof window !== 'undefined') {
      window.location.hash = 'library';
    }
  };

  const handleOpenMyUploads = () => {
    setSubView('my-uploads');
    setHasNovelty(false);
    if (typeof window !== 'undefined') {
      window.location.hash = 'library/my-uploads';
    }
  };

  const handleOpenTerms = () => {
    setSubView('terms');
    if (typeof window !== 'undefined') {
      window.location.hash = 'library/terms';
    }
  };

  const handleOpenUpload = (subjectId?: string) => {
    setUploadTargetSubjectId(subjectId || selectedSubject?.id);
    setIsUploadOpen(true);
  };

  // Filtered subjects
  const filteredSubjects = subjects.filter((s) => {
    if (levelFilter === 'electives') {
      if (s.kind !== 'electiva' && s.level > 5) return true;
      if (s.kind !== 'electiva') return false;
    } else if (levelFilter !== 'all') {
      if (s.level !== levelFilter) return false;
    }

    if (search.trim()) {
      const query = search.toLowerCase();
      const matchName = s.name.toLowerCase().includes(query);
      const matchCode = String(s.codeInPlan).includes(query);
      return matchName || matchCode;
    }

    return true;
  });

  // Calculate totals
  const totalApprovedFiles = subjects.reduce((acc, s) => acc + (s.approvedFilesCount || 0), 0);

  // Render Sub-Views inside the unified Library Container
  if (subView === 'terms') {
    return (
      <>
        <LibraryTermsPage onBack={handleBackToCatalog} />
        <LibraryWelcomeModal
          isOpen={showWelcomeModal}
          onClose={handleCloseWelcome}
          onOpenUpload={handleWelcomeUpload}
          onOpenTerms={handleOpenTerms}
        />
      </>
    );
  }

  if (subView === 'my-uploads') {
    return (
      <>
        <MyUploadsView
          onBack={handleBackToCatalog}
          onOpenUpload={() => handleOpenUpload()}
        />
        <UploadMaterialModal
          isOpen={isUploadOpen}
          onClose={() => setIsUploadOpen(false)}
          onSuccess={() => {
            loadData();
          }}
          initialSubjectId={uploadTargetSubjectId}
          subjects={subjects}
          onOpenTerms={handleOpenTerms}
        />
        <LibraryWelcomeModal
          isOpen={showWelcomeModal}
          onClose={handleCloseWelcome}
          onOpenUpload={handleWelcomeUpload}
          onOpenTerms={handleOpenTerms}
        />
      </>
    );
  }

  if (subView === 'subject') {
    return (
      <>
        {selectedSubject ? (
          <SubjectLibraryView
            subject={selectedSubject}
            onBack={handleBackToCatalog}
            onOpenUpload={() => handleOpenUpload(selectedSubject.id)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-12 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          </div>
        )}
        <UploadMaterialModal
          isOpen={isUploadOpen}
          onClose={() => setIsUploadOpen(false)}
          onSuccess={() => {
            loadData();
          }}
          initialSubjectId={selectedSubject?.id}
          subjects={subjects}
          onOpenTerms={handleOpenTerms}
        />
        <LibraryWelcomeModal
          isOpen={showWelcomeModal}
          onClose={handleCloseWelcome}
          onOpenUpload={handleWelcomeUpload}
          onOpenTerms={handleOpenTerms}
        />
      </>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-3.5 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-8 min-w-0 w-full max-w-full">
      {/* Hero Header */}
      <div data-tour="library-header" className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-gradient-to-br from-indigo-950/60 via-slate-900/80 to-slate-950 p-4 sm:p-8 border border-indigo-500/20 shadow-2xl min-w-0 w-full max-w-full">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5 sm:gap-6 w-full min-w-0">
          <div className="space-y-2 sm:space-y-3 max-w-2xl w-full min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-400/25 text-indigo-300 text-xs font-semibold">
              <BookOpen className="w-4 h-4 text-amber-400" />
              Biblioteca Colaborativa de Material
            </div>
            <h1 className="text-xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight break-words">
              Material de Estudio para tu carrera
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed break-words">
              Exámenes parciales y finales, resoluciones, apuntes y resúmenes compartidos por y para estudiantes de Ingeniería en Sistemas de Información.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto shrink-0 min-w-0">
            {/* Mis Aportes Button */}
            <button
              type="button"
              onClick={handleOpenMyUploads}
              className="relative px-3 sm:px-4 py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm w-full sm:w-auto min-h-[44px]"
            >
              <FolderOpen className="w-4 h-4 text-indigo-400" />
              <span>Mis Aportes</span>
              {hasNovelty && (
                <span
                  title="Tenés actualizaciones en el estado de tus aportes"
                  className="w-2 h-2 rounded-full bg-amber-400 ring-2 ring-slate-950 animate-pulse"
                />
              )}
            </button>

            {/* Subir Material Button */}
            <button
              type="button"
              onClick={() => handleOpenUpload()}
              className="px-3 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer w-full sm:w-auto min-h-[44px]"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Subir Material</span>
            </button>
          </div>
        </div>

        {/* Bottom Banner Stats */}
        <div className="mt-5 sm:mt-6 pt-4 sm:pt-5 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-400 gap-3 w-full min-w-0">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <strong className="text-white font-mono">{totalApprovedFiles}</strong> materiales aprobados
            </span>
            <span className="hidden sm:inline-block text-slate-600">•</span>
            <span className="hidden sm:flex items-center gap-1.5 text-slate-400">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              Moderación humana obligatoria antes de publicar
            </span>
          </div>

          <button
            type="button"
            onClick={handleOpenTerms}
            className="text-[11px] text-indigo-300 hover:text-white underline inline-flex items-center gap-1 cursor-pointer"
          >
            Términos de uso y DMCA
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Level Filters & Search */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full min-w-0 max-w-full">
          {/* Level Filter Tabs con scroll horizontal suave, snap-x mandatory, pe-6 y fade lateral */}
          <div className="relative flex-1 min-w-0 max-w-full">
            <div className="w-full min-w-0 max-w-full overflow-x-auto pb-1.5 scrollbar-none snap-x snap-mandatory scroll-smooth flex items-center gap-1.5 px-0.5 pe-6">
              {[
                { id: 'all', label: 'Todas las materias' },
                { id: 1, label: '1° Año' },
                { id: 2, label: '2° Año' },
                { id: 3, label: '3° Año' },
                { id: 4, label: '4° Año' },
                { id: 5, label: '5° Año' },
                { id: 'electives', label: 'Electivas' },
              ].map((lvl) => (
                <button
                  key={String(lvl.id)}
                  type="button"
                  onClick={() => setLevelFilter(lvl.id as any)}
                  className={`px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center justify-center shrink-0 snap-start ${
                    levelFilter === lvl.id
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800/80'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
            {/* Indicador sutil de gradiente (fade) en el borde derecho en mobile */}
            <div className="pointer-events-none absolute right-0 top-0 bottom-1.5 w-6 bg-gradient-to-l from-slate-950 via-slate-950/70 to-transparent sm:hidden" />
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72 shrink-0 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por materia o código..."
              className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl bg-slate-950 border border-slate-800 text-base sm:text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Subjects Grid */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <p className="text-xs">Cargando materias de la carrera...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={loadData}
              className="px-3 py-1 bg-rose-900 hover:bg-rose-800 rounded-lg text-white font-medium"
            >
              Reintentar
            </button>
          </div>
        ) : filteredSubjects.length === 0 ? (
          <div className="text-center py-16 px-4 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
            <FileText className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-xs text-slate-400">No se encontraron materias con el filtro seleccionado.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredSubjects.map((sub) => {
              const count = sub.approvedFilesCount || 0;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => handleSelectSubject(sub)}
                  className="p-4 rounded-2xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/40 transition-all text-left flex flex-col justify-between space-y-3 group cursor-pointer shadow-sm"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800">
                        #{sub.codeInPlan}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-400">
                        {sub.kind === 'electiva' ? 'Electiva' : `Nivel ${sub.level}`}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors leading-snug break-words">
                      {sub.name}
                    </h3>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <span
                      className={`font-semibold ${
                        count > 0 ? 'text-indigo-400' : 'text-slate-500'
                      }`}
                    >
                      {count} {count === 1 ? 'material' : 'materiales'}
                    </span>
                    <span className="text-slate-500 group-hover:text-slate-300 flex items-center gap-1 text-[11px] font-medium">
                      Ver carpeta
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      <UploadMaterialModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={() => {
          loadData();
        }}
        initialSubjectId={uploadTargetSubjectId}
        subjects={subjects}
        onOpenTerms={handleOpenTerms}
      />

      {/* Cartel de bienvenida comunitario (C1) */}
      <LibraryWelcomeModal
        isOpen={showWelcomeModal}
        onClose={handleCloseWelcome}
        onOpenUpload={handleWelcomeUpload}
        onOpenTerms={handleOpenTerms}
      />
    </div>
  );
};
