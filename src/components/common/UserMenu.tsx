import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { userStateApi } from '../../api/userState.api';
import {
  User as UserIcon,
  LogOut,
  Download,
  Trash2,
  ChevronDown,
  Shield,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface UserMenuProps {
  currentPlanName?: string;
  onOpenPlanSelector?: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  currentPlanName = 'Plan 2023',
  onOpenPlanSelector,
}) => {
  const { user, logout, deleteAccount } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await userStateApi.exportData();
      if (res.success && res.data) {
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(res.data, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', dataStr);
        downloadAnchor.setAttribute('download', `mi-carrera-backup-${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      }
    } catch (e) {
      console.error('Error exporting data:', e);
    } finally {
      setIsExporting(false);
      setIsOpen(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await deleteAccount();
    } catch (e) {
      console.error('Error deleting account:', e);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 sm:gap-2 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition-all text-xs font-medium cursor-pointer shadow-sm"
        title={user.email}
      >
        <div className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold uppercase text-[10px] shrink-0">
          {user.email.charAt(0)}
        </div>
        <span className="max-w-[105px] truncate hidden xl:inline text-xs">{user.email}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform hidden sm:inline ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 sm:w-72 max-w-[calc(100vw-1.5rem)] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl py-2 z-50 text-slate-200 animate-fade-in backdrop-blur-xl">
          {/* User info header */}
          <div className="px-4 py-2.5 border-b border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Cuenta</span>
              {user.role === 'admin' && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <Shield className="w-2.5 h-2.5" /> Admin
                </span>
              )}
            </div>
            <div className="text-sm font-semibold text-white truncate">{user.email}</div>
            <div className="text-xs text-indigo-400 mt-0.5">{currentPlanName}</div>
          </div>

          {/* Menu actions */}
          <div className="py-1">
            {onOpenPlanSelector && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenPlanSelector();
                }}
                className="w-full px-4 py-2 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <UserIcon className="w-4 h-4 text-slate-400" />
                <span>Cambiar de Carrera / Plan</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="w-full px-4 py-2 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              ) : (
                <Download className="w-4 h-4 text-slate-400" />
              )}
              <span>Descargar copia de seguridad</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
              className="w-full px-4 py-2 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 text-slate-400" />
              <span>Cerrar Sesión</span>
            </button>
          </div>

          <div className="pt-1 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full px-4 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Eliminar cuenta...</span>
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl max-w-sm w-full p-6 text-slate-100 shadow-2xl">
            <div className="flex items-center gap-3 mb-3 text-red-400">
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-white text-base">¿Eliminar cuenta?</h4>
            </div>

            <p className="text-xs text-slate-300 mb-5 leading-relaxed">
              Esta acción es irreversible. Se borrarán todas tus materias registradas, notas, horarios y configuraciones de forma permanente.
            </p>

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Eliminar Definitivamente</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

