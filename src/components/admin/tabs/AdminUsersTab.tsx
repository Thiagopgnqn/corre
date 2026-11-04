import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  Shield,
  UserX,
  UserCheck,
  CheckCircle2,
  XCircle,
  Send,
  LogOut,
  Trash2,
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  AlertTriangle,
  BookOpen,
  MessageSquare,
  X,
} from 'lucide-react';
import {
  adminApi,
  type AdminUserListItem,
  type AdminUserDetail,
} from '../../../api/admin.api';
import { AdminReauthModal } from '../AdminReauthModal';
import { useAuth } from '../../../context/AuthContext';

export const AdminUsersTab: React.FC = () => {
  const { user: currentAdmin } = useAuth();

  // State: List & Filters
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [verifiedFilter, setVerifiedFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // State: Detail Drawer
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // State: Reauth & Confirmations
  const [reauthModalOpen, setReauthModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [reauthTitle, setReauthTitle] = useState('Acción sensible');
  const [reauthDesc, setReauthDesc] = useState('');

  // State: Delete Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AdminUserListItem | null>(null);
  const [confirmEmailInput, setConfirmEmailInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchUsers = useCallback(async (page = 1) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.listUsers({
        page,
        pageSize: 20,
        search,
        role: roleFilter,
        status: statusFilter,
        emailVerified: verifiedFilter,
      });
      if (res.success && res.data) {
        setUsers(res.data.users || []);
        const p = res.data.pagination || {
          page: (res.data as any).page || 1,
          pageSize: (res.data as any).pageSize || (res.data as any).limit || 20,
          total: (res.data as any).total ?? 0,
          totalPages: (res.data as any).totalPages || 1,
        };
        setPagination(p);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al obtener usuarios');
    } finally {
      setIsLoading(false);
    }
  }, [search, roleFilter, statusFilter, verifiedFilter]);

  useEffect(() => {
    fetchUsers(1);
  }, [fetchUsers]);

  // Load User Detail when selected
  useEffect(() => {
    if (!selectedUserId) {
      setUserDetail(null);
      return;
    }
    const loadDetail = async () => {
      setIsLoadingDetail(true);
      try {
        const res = await adminApi.getUser(selectedUserId);
        if (res.success && res.data) {
          setUserDetail(res.data);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Error al cargar detalles del usuario.');
      } finally {
        setIsLoadingDetail(false);
      }
    };
    loadDetail();
  }, [selectedUserId]);

  // Helper to execute sensitive actions requiring reauth
  const executeWithReauth = (
    title: string,
    desc: string,
    action: () => Promise<void>
  ) => {
    setReauthTitle(title);
    setReauthDesc(desc);
    setPendingAction(() => action);
    setReauthModalOpen(true);
  };

  const handleReauthSuccess = async () => {
    if (pendingAction) {
      try {
        await pendingAction();
      } catch (err: any) {
        setErrorMsg(err?.message || 'Error al ejecutar la acción.');
      } finally {
        setPendingAction(null);
      }
    }
  };

  // Actions
  const handleVerifyEmail = async (userId: string) => {
    try {
      const res = await adminApi.verifyUserEmail(userId);
      setSuccessMsg(res.message);
      fetchUsers(pagination.page);
      if (selectedUserId === userId) {
        const d = await adminApi.getUser(userId);
        if (d.success) setUserDetail(d.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo verificar el correo.');
    }
  };

  const handleResendCode = async (userId: string) => {
    try {
      const res = await adminApi.resendVerificationCode(userId);
      setSuccessMsg(res.message);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo reenviar el código.');
    }
  };

  const handleRevokeSessions = async (userId: string) => {
    try {
      const res = await adminApi.revokeUserSessions(userId);
      setSuccessMsg(res.message);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudieron revocar las sesiones.');
    }
  };

  const handleToggleStatus = (targetUser: AdminUserListItem) => {
    const isSuspended = targetUser.status === 'suspended';
    const newStatus = isSuspended ? 'active' : 'suspended';

    if (newStatus === 'suspended') {
      executeWithReauth(
        `Suspender cuenta de ${targetUser.email}`,
        'La suspensión revocará inmediatamente todas las sesiones del usuario y bloqueará todo acceso a Stack.',
        async () => {
          const res = await adminApi.setUserStatus(targetUser.id, 'suspended');
          setSuccessMsg(res.message);
          fetchUsers(pagination.page);
          if (selectedUserId === targetUser.id) {
            const d = await adminApi.getUser(targetUser.id);
            if (d.success) setUserDetail(d.data);
          }
        }
      );
    } else {
      adminApi.setUserStatus(targetUser.id, 'active').then((res) => {
        setSuccessMsg(res.message);
        fetchUsers(pagination.page);
        if (selectedUserId === targetUser.id) {
          adminApi.getUser(targetUser.id).then((d) => d.success && setUserDetail(d.data));
        }
      }).catch((err) => {
        setErrorMsg(err?.message || 'Error al reactivar la cuenta.');
      });
    }
  };

  const handleChangeRole = (targetUser: AdminUserListItem) => {
    const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
    const actionLabel = newRole === 'admin' ? 'Promover a Administrador' : 'Degradar a Usuario Común';

    executeWithReauth(
      `${actionLabel}: ${targetUser.email}`,
      `Esta acción modificará los privilegios de acceso al sistema y al panel de administración.`,
      async () => {
        const res = await adminApi.setUserRole(targetUser.id, newRole);
        setSuccessMsg(`Rol actualizado correctamente a "${res.role}".`);
        fetchUsers(pagination.page);
        if (selectedUserId === targetUser.id) {
          const d = await adminApi.getUser(targetUser.id);
          if (d.success) setUserDetail(d.data);
        }
      }
    );
  };

  const initiateDelete = (targetUser: AdminUserListItem) => {
    setUserToDelete(targetUser);
    setConfirmEmailInput('');
    setDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (!userToDelete) return;
    if (confirmEmailInput.trim().toLowerCase() !== userToDelete.email.trim().toLowerCase()) {
      setErrorMsg('El correo ingresado no coincide.');
      return;
    }

    setDeleteModalOpen(false);
    executeWithReauth(
      `Eliminar definitivamente a ${userToDelete.email}`,
      'ADVERTENCIA: Esta acción es permanente e irreversible. Se eliminará la cuenta y todos sus datos.',
      async () => {
        setIsDeleting(true);
        try {
          await adminApi.deleteUser(userToDelete.id, confirmEmailInput);
          setSuccessMsg(`Usuario ${userToDelete.email} eliminado definitivamente.`);
          if (selectedUserId === userToDelete.id) {
            setSelectedUserId(null);
          }
          fetchUsers(pagination.page);
        } finally {
          setIsDeleting(false);
          setUserToDelete(null);
        }
      }
    );
  };

  const exportUrl = adminApi.getExportUsersCsvUrl({
    search,
    role: roleFilter,
    status: statusFilter,
  });

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-between gap-3 text-xs text-red-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between gap-3 text-xs text-emerald-300">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Filter & Search Bar */}
      <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Buscar usuario por correo electrónico..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="all">Rol: Todos</option>
            <option value="user">Solo Usuarios</option>
            <option value="admin">Solo Administradores</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="all">Estado: Todos</option>
            <option value="active">Activos</option>
            <option value="suspended">Suspendidos</option>
          </select>

          {/* Email Verified Filter */}
          <select
            value={verifiedFilter}
            onChange={(e) => setVerifiedFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="all">Verificación: Todos</option>
            <option value="true">Email Verificado</option>
            <option value="false">Sin Verificar</option>
          </select>

          {/* Export CSV Button */}
          <a
            href={exportUrl}
            download
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors"
            title="Exportar usuarios a CSV con sanitización contra inyección de fórmulas"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            <span>Exportar CSV</span>
          </a>
        </div>
      </div>

      {/* Users Table / List */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Usuario</th>
                <th className="py-3 px-4">Rol</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Última Actividad</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-2" />
                    Cargando usuarios...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No se encontraron usuarios coincidentes.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isCurrentAdmin = u.id === currentAdmin?.id;
                  const isSuspended = u.status === 'suspended';

                  return (
                    <tr
                      key={u.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        selectedUserId === u.id ? 'bg-indigo-950/20' : ''
                      }`}
                    >
                      {/* Email & Identity */}
                      <td className="py-3.5 px-4 font-medium text-white flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0">
                          {u.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate flex items-center gap-1.5">
                            <span>{u.email}</span>
                            {isCurrentAdmin && (
                              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded font-normal">
                                Vos
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                            {u.identities?.some((i) => i.provider === 'google') && (
                              <span className="text-amber-400/80">Google</span>
                            )}
                            {u.identities?.some((i) => i.provider === 'local' || i.provider === 'password') && (
                              <span>Contraseña</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="py-3.5 px-4">
                        {u.role === 'admin' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-semibold">
                            <Shield className="w-3 h-3" /> Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px]">
                            Usuario
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        {isSuspended ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30 text-[11px] font-semibold">
                            <UserX className="w-3 h-3" /> Suspendido
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px]">
                            <UserCheck className="w-3 h-3" /> Activo
                          </span>
                        )}
                      </td>

                      {/* Email Verification */}
                      <td className="py-3.5 px-4">
                        {u.emailVerified ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Verificado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-400 text-[11px]">
                            <XCircle className="w-3.5 h-3.5" /> Sin verificar
                          </span>
                        )}
                      </td>

                      {/* Last Seen */}
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {u.lastSeenAt
                          ? new Date(u.lastSeenAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Nunca'}
                      </td>

                      {/* Action buttons */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedUserId(u.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                            title="Ver detalles de actividad"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {!isCurrentAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(u)}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  isSuspended
                                    ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                                    : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                                }`}
                                title={isSuspended ? 'Reactivar cuenta' : 'Suspender cuenta'}
                              >
                                {isSuspended ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleChangeRole(u)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                                title={u.role === 'admin' ? 'Degradar a usuario' : 'Hacer administrador'}
                              >
                                <Shield className="w-4 h-4" />
                              </button>

                              {u.role !== 'admin' && (
                                <button
                                  type="button"
                                  onClick={() => initiateDelete(u)}
                                  className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors cursor-pointer"
                                  title="Eliminar usuario definitivamente"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Total: <span className="font-semibold text-white">{pagination?.total ?? 0}</span> usuarios
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={(pagination?.page ?? 1) <= 1 || isLoading}
              onClick={() => fetchUsers((pagination?.page ?? 1) - 1)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Página {pagination?.page ?? 1} de {Math.max(1, pagination?.totalPages ?? 1)}
            </span>
            <button
              type="button"
              disabled={(pagination?.page ?? 1) >= (pagination?.totalPages ?? 1) || isLoading}
              onClick={() => fetchUsers((pagination?.page ?? 1) + 1)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Side Drawer: User Activity Details (strictly NO grades / academic progress) */}
      {selectedUserId && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full p-6 flex flex-col justify-between overflow-y-auto shadow-2xl">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-400" />
                  Detalle de Usuario
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedUserId(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {isLoadingDetail || !userDetail ? (
                <div className="py-16 text-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-400 mb-2" />
                  Cargando información...
                </div>
              ) : (
                <div className="mt-5 space-y-6">
                  {/* Account Metadata */}
                  <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Correo:</span>
                      <span className="font-semibold text-white">{userDetail.email}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Rol:</span>
                      <span className="font-medium text-amber-300 uppercase text-[11px]">
                        {userDetail.role}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Estado de cuenta:</span>
                      <span
                        className={`font-semibold ${
                          userDetail.status === 'suspended' ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {userDetail.status === 'suspended' ? 'Suspendida' : 'Activa'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Email Verificado:</span>
                      <span className="font-medium text-white">
                        {userDetail.emailVerified ? 'Sí (verificado)' : 'No verificado'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Fecha de Registro:</span>
                      <span className="text-slate-300">
                        {new Date(userDetail.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Última Conexión:</span>
                      <span className="text-slate-300">
                        {userDetail.lastSeenAt
                          ? new Date(userDetail.lastSeenAt).toLocaleString()
                          : 'Nunca'}
                      </span>
                    </div>
                  </div>

                  {/* Activity Counters (Privacy Preserved: NO subject grades) */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                      Actividad en la Plataforma
                    </h4>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 text-center">
                        <BookOpen className="w-4 h-4 text-indigo-400 mx-auto mb-1" />
                        <span className="text-lg font-bold text-white block">
                          {userDetail.counters?.enrollmentsCount ?? 0}
                        </span>
                        <span className="text-[10px] text-slate-400">Cursadas</span>
                      </div>
                      <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 text-center">
                        <MessageSquare className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                        <span className="text-lg font-bold text-white block">
                          {userDetail.counters?.reviewsCount ?? 0}
                        </span>
                        <span className="text-[10px] text-slate-400">Reseñas</span>
                      </div>
                      <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 text-center">
                        <AlertTriangle className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                        <span className="text-lg font-bold text-white block">
                          {userDetail.counters?.reportsSubmittedCount ?? 0}
                        </span>
                        <span className="text-[10px] text-slate-400">Reportes</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 italic">
                      Por políticas de privacidad, las notas individuales y el avance detallado de la carrera no son accesibles para administradores.
                    </p>
                  </div>

                  {/* Admin Direct Actions on Selected User */}
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Acciones Administrativas
                    </h4>

                    {!userDetail.emailVerified && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleVerifyEmail(userDetail.id)}
                          className="flex-1 py-2 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Verificar Email Manual</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResendCode(userDetail.id)}
                          className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          title="Reenviar código de 6 dígitos"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRevokeSessions(userDetail.id)}
                      className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5 text-amber-400" />
                      <span>Revocar todas las sesiones activas</span>
                    </button>

                    {userDetail.id !== currentAdmin?.id && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(userDetail)}
                          className={`w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                            userDetail.status === 'suspended'
                              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
                          }`}
                        >
                          {userDetail.status === 'suspended' ? (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Reactivar Cuenta</span>
                            </>
                          ) : (
                            <>
                              <UserX className="w-3.5 h-3.5" />
                              <span>Suspender Cuenta (Exige Reauth)</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleChangeRole(userDetail)}
                          className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                        >
                          <Shield className="w-3.5 h-3.5" />
                          <span>
                            {userDetail.role === 'admin'
                              ? 'Degradar a Usuario Común'
                              : 'Promover a Administrador'}
                          </span>
                        </button>

                        {userDetail.role !== 'admin' && (
                          <button
                            type="button"
                            onClick={() => initiateDelete(userDetail)}
                            className="w-full py-2 px-3 bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Eliminar Usuario Definitivamente...</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSelectedUserId(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors mt-6 cursor-pointer"
            >
              Cerrar Detalle
            </button>
          </div>
        </div>
      )}

      {/* Delete User Modal Confirmation */}
      {deleteModalOpen && userToDelete && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-red-500/40 rounded-2xl p-6 shadow-2xl text-slate-100">
            <div className="flex items-center gap-3 text-red-400 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Eliminar Usuario</h3>
                <p className="text-xs text-red-300">Esta acción no se puede deshacer</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Vas a eliminar la cuenta de <span className="font-bold text-white">{userToDelete.email}</span>. Para confirmar, escribí el correo del usuario a continuación:
            </p>

            <input
              type="text"
              autoFocus
              value={confirmEmailInput}
              onChange={(e) => setConfirmEmailInput(e.target.value)}
              placeholder={userToDelete.email}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-red-500 mb-4"
            />

            <div className="flex justify-end gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  isDeleting ||
                  confirmEmailInput.trim().toLowerCase() !== userToDelete.email.trim().toLowerCase()
                }
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-lg cursor-pointer"
              >
                {isDeleting ? 'Eliminando...' : 'Continuar a Reautenticación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reauthentication Modal */}
      <AdminReauthModal
        isOpen={reauthModalOpen}
        onClose={() => setReauthModalOpen(false)}
        onSuccess={handleReauthSuccess}
        actionTitle={reauthTitle}
        description={reauthDesc}
      />
    </div>
  );
};
