import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, X, Lock, Loader2, AlertTriangle, KeyRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { adminApi } from '../../api/admin.api';
import { GoogleLoginButton } from '../auth/GoogleLoginButton';

interface AdminReauthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  actionTitle?: string;
  description?: string;
}

export const AdminReauthModal: React.FC<AdminReauthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  actionTitle = 'Acción sensible',
  description = 'Por seguridad del sistema, necesitás confirmar tu identidad de administrador antes de continuar.',
}) => {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isGoogleOnly =
    user?.authProviders &&
    user.authProviders.includes('google') &&
    !user.authProviders.includes('local');

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMsg('Ingresá tu contraseña de administrador');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      await adminApi.reauthPassword(password);
      setPassword('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Contraseña incorrecta o no autorizada.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSuccess = async (idToken: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await adminApi.reauthGoogle(idToken);
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al validar la identidad de Google.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-slate-900 border border-amber-500/30 rounded-2xl p-6 shadow-2xl text-slate-100"
        >
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="flex items-start gap-3.5 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Confirmación de Seguridad
              </h3>
              <p className="text-xs text-amber-300/90 font-medium mt-0.5">{actionTitle}</p>
            </div>
          </div>

          <p className="text-xs text-slate-300 mb-5 leading-relaxed bg-slate-800/50 p-3 rounded-xl border border-slate-700/60">
            {description} El ticket de confirmación tiene una validez de 10 minutos.
          </p>

          {errorMsg && (
            <div className="mb-4 p-3 bg-red-500/15 border border-red-500/40 rounded-xl flex items-start gap-2.5 text-xs text-red-300 animate-shake">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isGoogleOnly ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs text-slate-400 text-center">
                Tu cuenta está asociada a Google. Confirmá tu identidad iniciando sesión nuevamente:
              </p>
              <GoogleLoginButton
                onSuccess={handleGoogleSuccess}
                onError={(err) => setErrorMsg(err)}
                disabled={isLoading}
                mode="login"
              />
            </div>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Contraseña de tu cuenta ({user?.email})
                </label>
                <div className="relative">
                  <input
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    disabled={isLoading}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
                  />
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !password}
                  className="px-4 py-2 text-xs font-semibold text-slate-900 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verificando...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>Autorizar Acción</span>
                    </>
                  )}
                </button>
              </div>

              {user?.authProviders?.includes('google') && (
                <div className="pt-3 border-t border-slate-800 flex flex-col items-center gap-2">
                  <span className="text-[11px] text-slate-500">O también podés reautenticar con:</span>
                  <GoogleLoginButton
                    onSuccess={handleGoogleSuccess}
                    onError={(err) => setErrorMsg(err)}
                    disabled={isLoading}
                    mode="login"
                  />
                </div>
              )}
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

