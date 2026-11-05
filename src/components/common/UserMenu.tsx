import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCareer } from '../../context/CareerContext';
import { userStateApi } from '../../api/userState.api';
import { adminLibraryApi } from '../../api/library.api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BottomSheet } from './BottomSheet';
import {
  User as UserIcon,
  LogOut,
  Download,
  Trash2,
  ChevronDown,
  Shield,
  Loader2,
  AlertTriangle,
  Mail,
  GraduationCap,
} from 'lucide-react';

interface UserMenuProps {
  currentPlanName?: string;
  onOpenPlanSelector?: () => void;
  onNavigateAdmin?: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  currentPlanName = 'Plan 2023',
  onOpenPlanSelector,
  onNavigateAdmin,
}) => {
  const { user, logout, deleteAccount } = useAuth();
  const { settings, updateSettings } = useCareer();
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.role === 'admin') {
      adminLibraryApi
        .getPendingFiles()
        .then((res) => {
          if (res.success && res.data) {
            setPendingCount(res.data.total);
          }
        })
        .catch(() => {});
    }
  }, [user?.role]);

  // Cerrar al hacer click afuera (solo en desktop dropdown)
  useEffect(() => {
    if (isMobile) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobile]);

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

  const navigateToAdmin = () => {
    setIsOpen(false);
    if (onNavigateAdmin) {
      onNavigateAdmin();
    } else if (typeof window !== 'undefined') {
      window.location.hash = 'admin';
    }
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      {/* Botón principal del avatar - con target táctil mínimo de 44px en mobile */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center gap-1.5 sm:gap-2 p-1.5 sm:px-2.5 sm:py-1.5 min-h-[44px] min-w-[44px] rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition-all text-xs font-medium cursor-pointer shadow-sm active:scale-95"
        title={user.email}
        aria-label="Menú de usuario y cuenta"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <div className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold uppercase text-[10px] shrink-0">
          {user.email.charAt(0)}
        </div>
        <span className="max-w-[105px] truncate hidden xl:inline text-xs">{user.email}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform hidden sm:inline ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* DESKTOP: Menú flotante tradicional (hidden en mobile) */}
      {!isMobile && isOpen && (
        <div className="absolute right-0 mt-2 w-64 sm:w-72 max-w-[calc(100vw-1.5rem)] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl py-2 z-[var(--z-modal)] text-slate-200 animate-fade-in backdrop-blur-xl">
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
            {user.role === 'admin' && (
              <button
                type="button"
                onClick={navigateToAdmin}
                className="w-full px-4 py-2 text-left text-xs text-amber-300 hover:bg-amber-500/10 hover:text-amber-200 flex items-center justify-between gap-2.5 transition-colors cursor-pointer font-medium"
              >
                <div className="flex items-center gap-2.5">
                  <Shield className="w-4 h-4 text-amber-400" />
                  <span>Panel de administración</span>
                </div>
                {pendingCount !== null && pendingCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {pendingCount}
                  </span>
                )}
              </button>
            )}

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

            {/* Preferencia de Notificaciones de Biblioteca */}
            <div className="px-4 py-2 my-1 border-t border-b border-slate-800/80 bg-slate-950/40">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="text-[11.5px] text-slate-300 leading-tight">
                    Avisarme por mail sobre mis aportes a la Biblioteca
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.notifyLibraryEmail !== false}
                  onClick={() =>
                    updateSettings({ notifyLibraryEmail: settings.notifyLibraryEmail === false })
                  }
                  className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    settings.notifyLibraryEmail !== false ? 'bg-indigo-600' : 'bg-slate-700'
                  }`}
                  title="Activar/desactivar notificaciones por email de la Biblioteca"
                >
                  <span
                    className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.notifyLibraryEmail !== false ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

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

          <div className="mt-1 pt-2 pb-1 border-t border-slate-800/80 px-4 text-center">
            <span className="text-[10.5px] text-slate-400 font-medium">
              Hecho por estudiantes de la UTN
            </span>
          </div>
        </div>
      )}

      {/* MOBILE: BottomSheet de Cuenta y Sesión */}
      {isMobile && (
        <BottomSheet
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Mi Cuenta"
          subtitle={user.email}
        >
          <div className="space-y-4 py-2">
            {/* Tarjeta de información del usuario */}
            <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/90 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold uppercase text-base shrink-0">
                {user.email.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white truncate">{user.email}</p>
                  {user.role === 'admin' && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold shrink-0">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-xs text-indigo-400 font-medium">
                  <GraduationCap className="w-3.5 h-3.5" />
                  <span>{currentPlanName}</span>
                </div>
              </div>
            </div>

            {/* Acciones principales con touch targets >= 48px */}
            <div className="space-y-1.5">
              {user.role === 'admin' && (
                <button
                  type="button"
                  onClick={navigateToAdmin}
                  className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 flex items-center justify-between gap-3 text-sm font-semibold transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-amber-400 shrink-0" />
                    <span>Panel de administración</span>
                  </div>
                  {pendingCount !== null && pendingCount > 0 && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/25 text-amber-200 border border-amber-500/40">
                      {pendingCount} pend.
                    </span>
                  )}
                </button>
              )}

              {onOpenPlanSelector && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenPlanSelector();
                  }}
                  className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-200 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
                >
                  <UserIcon className="w-5 h-5 text-indigo-400 shrink-0" />
                  <span>Cambiar de Carrera / Plan</span>
                </button>
              )}

              {/* Preferencia de Notificaciones de Biblioteca */}
              <div className="min-h-[48px] px-4 py-3 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Mail className="w-5 h-5 text-indigo-400 shrink-0" />
                  <span className="text-xs text-slate-300 leading-snug">
                    Avisarme por mail sobre mis aportes a la Biblioteca
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.notifyLibraryEmail !== false}
                  onClick={() =>
                    updateSettings({ notifyLibraryEmail: settings.notifyLibraryEmail === false })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    settings.notifyLibraryEmail !== false ? 'bg-indigo-600' : 'bg-slate-700'
                  }`}
                  title="Activar/desactivar notificaciones por email de la Biblioteca"
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.notifyLibraryEmail !== false ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-200 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                {isExporting ? (
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-400 shrink-0" />
                ) : (
                  <Download className="w-5 h-5 text-slate-400 shrink-0" />
                )}
                <span>Descargar copia de seguridad</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  logout();
                }}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-200 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                <LogOut className="w-5 h-5 text-slate-400 shrink-0" />
                <span>Cerrar Sesión</span>
              </button>

              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer mt-2"
              >
                <Trash2 className="w-5 h-5 text-rose-400 shrink-0" />
                <span>Eliminar cuenta...</span>
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {/* Modal de confirmación para eliminar cuenta */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[var(--z-modal-elevated)] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
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
                className="px-4 py-2.5 min-h-[44px] text-xs font-semibold text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer flex items-center justify-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="px-4 py-2.5 min-h-[44px] text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
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
