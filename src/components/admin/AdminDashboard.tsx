import React, { useState } from 'react';
import {
  Shield,
  Activity,
  Users,
  Calendar,
  MessageSquare,
  FileText,
  ArrowLeft,
  Lock,
  BookOpen,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AdminOverviewTab } from './tabs/AdminOverviewTab';
import { AdminUsersTab } from './tabs/AdminUsersTab';
import { AdminScheduleTab } from './tabs/AdminScheduleTab';
import { AdminReviewsTab } from './tabs/AdminReviewsTab';
import { AdminLibraryTab } from './tabs/AdminLibraryTab';
import { AdminAuditTab } from './tabs/AdminAuditTab';
import { AdminErrorBoundary } from './AdminErrorBoundary';
import { APP_NAME } from '../../config/brand';

export type AdminTab = 'overview' | 'users' | 'schedule' | 'reviews' | 'library' | 'audit';

interface AdminDashboardProps {
  onNavigateHome: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigateHome }) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Control estricto de rol en render: jamás renderizar contenido para no-admins
  if (user?.role !== 'admin') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
        <Lock className="w-12 h-12 text-red-500 mb-3" />
        <h2 className="text-lg font-bold text-white mb-1">Acceso Restringido</h2>
        <p className="text-xs text-slate-400 max-w-sm mb-4">
          Esta sección requiere una cuenta con rol de administrador activo.
        </p>
        <button
          type="button"
          onClick={onNavigateHome}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold"
        >
          Volver a la aplicación
        </button>
      </div>
    );
  }

  const tabsConfig = [
    { id: 'overview', label: 'Resumen', icon: Activity },
    { id: 'users', label: 'Usuarios', icon: Users },
    { id: 'schedule', label: 'Horarios y Catálogo', icon: Calendar },
    { id: 'reviews', label: 'Docentes y Reseñas', icon: MessageSquare },
    { id: 'library', label: 'Biblioteca', icon: BookOpen },
    { id: 'audit', label: 'Auditoría', icon: FileText },
  ] as const;

  return (
    <div className="flex-1 flex flex-col bg-[#0b0f19] text-slate-100 min-h-screen">
      {/* Top Admin Bar */}
      <header className="bg-slate-900/90 border-b border-slate-800/80 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left: Branding & Back Button */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={onNavigateHome}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-xs font-semibold cursor-pointer border border-slate-700"
                title="Volver a la vista principal de la carrera"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Volver</span>
              </button>

              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold text-xs shrink-0">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h1 className="text-sm font-bold text-white flex items-center gap-2 leading-tight">
                    {APP_NAME} <span className="text-amber-400 font-semibold text-xs">Admin</span>
                  </h1>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {user.email}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Security Badge */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Rol Admin Verificado
              </span>
            </div>
          </div>

          {/* Tab Navigation */}
          <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto pb-2 scrollbar-none">
            {tabsConfig.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as AdminTab)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-1">
        <AdminErrorBoundary key={activeTab}>
          {activeTab === 'overview' && <AdminOverviewTab />}
          {activeTab === 'users' && <AdminUsersTab />}
          {activeTab === 'schedule' && <AdminScheduleTab />}
          {activeTab === 'reviews' && <AdminReviewsTab />}
          {activeTab === 'library' && <AdminLibraryTab />}
          {activeTab === 'audit' && <AdminAuditTab />}
        </AdminErrorBoundary>
      </main>
    </div>
  );
};

export default AdminDashboard;

