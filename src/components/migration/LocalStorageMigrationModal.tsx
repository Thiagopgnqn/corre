import React, { useState } from 'react';
import {
  loadUserState,
  loadSettings,
  loadBasket,
  loadAssignedElectives,
  loadScheduleDrafts,
  loadScheduleSelections,
  clearCareerData,
} from '../../utils/storage';
import { userStateApi } from '../../api/userState.api';
import { CloudUpload, CheckCircle2, AlertTriangle, Loader2, Trash2, ArrowRight } from 'lucide-react';

interface LocalStorageMigrationModalProps {
  onSuccess: () => void;
  onDismiss: () => void;
}

export const LocalStorageMigrationModal: React.FC<LocalStorageMigrationModalProps> = ({
  onSuccess,
  onDismiss,
}) => {
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCleanupPrompt, setShowCleanupPrompt] = useState(false);

  // Analizar datos presentes en localStorage
  const localUserState = loadUserState();
  const localSettings = loadSettings();
  const localBasket = loadBasket();
  const localAssignedElectives = loadAssignedElectives(localUserState);
  const localDrafts = loadScheduleDrafts();
  const localSelections = loadScheduleSelections();

  const subjectsCount = Object.keys(localUserState).length;
  const approvedCount = Object.values(localUserState).filter(
    (s) => s.status === 'aprobada' || s.status === 'promocionada'
  ).length;
  const takingCount = Object.values(localUserState).filter(
    (s) => s.status === 'cursando'
  ).length;

  const handleImport = async () => {
    setIsImporting(true);
    setError(null);

    try {
      const payload = {
        version: '2.1',
        exportDate: new Date().toISOString(),
        userState: localUserState,
        settings: localSettings,
        basket: localBasket,
        assignedElectives: localAssignedElectives,
        scheduleDrafts: localDrafts,
        scheduleSelections: localSelections,
      };

      const res = await userStateApi.importLegacyData(payload);
      if (res.success) {
        setShowCleanupPrompt(true);
      } else {
        setError('No se pudieron importar los datos.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error al conectar con el servidor.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFinish = (clearLocal: boolean) => {
    if (clearLocal) {
      clearCareerData();
    }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl max-w-lg w-full p-6 sm:p-7 shadow-2xl relative text-slate-100 overflow-hidden">
        {/* Glow corner */}
        <div className="absolute top-0 right-0 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        {!showCleanupPrompt ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <CloudUpload className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  Datos encontrados en este navegador
                </h3>
                <p className="text-xs text-slate-400">
                  Detectamos tu progreso anterior guardado localmente
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-300 mb-4 leading-relaxed">
              Tu cuenta en la nube está vacía. ¿Querés importar automáticamente las materias, notas, electivas y horarios que tenías configurados en este dispositivo?
            </p>

            {/* Preview cards */}
            <div className="grid grid-cols-3 gap-2.5 mb-5 p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 text-center">
              <div>
                <div className="text-xl font-bold text-white">{subjectsCount}</div>
                <div className="text-[11px] text-slate-400">Materias</div>
              </div>
              <div>
                <div className="text-xl font-bold text-emerald-400">{approvedCount}</div>
                <div className="text-[11px] text-slate-400">Aprobadas</div>
              </div>
              <div>
                <div className="text-xl font-bold text-blue-400">{takingCount}</div>
                <div className="text-[11px] text-slate-400">Cursando</div>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onDismiss}
                disabled={isImporting}
                className="px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
              >
                Empezar de cero
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={isImporting}
                className="px-5 py-2.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Importando...</span>
                  </>
                ) : (
                  <>
                    <span>Importar a mi cuenta</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  ¡Importación exitosa!
                </h3>
                <p className="text-xs text-slate-400">
                  Tus datos ya están sincronizados en tu cuenta
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-300 mb-5 leading-relaxed">
              ¿Querés limpiar la copia guardada en el almacenamiento local de este navegador para liberar espacio? (Tus datos ya están guardados de forma segura en la base de datos).
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleFinish(false)}
                className="px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
              >
                Conservar copia local
              </button>
              <button
                type="button"
                onClick={() => handleFinish(true)}
                className="px-5 py-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Limpiar local y continuar</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
