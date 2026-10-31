import React, { useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            error_callback?: (error: any) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number | string;
              locale?: string;
            }
          ) => void;
          prompt?: () => void;
        };
      };
    };
  }
}

interface GoogleLoginButtonProps {
  onSuccess: (credential: string) => void;
  onError: (errorMsg: string) => void;
  disabled?: boolean;
  mode?: 'login' | 'register';
}

export const GoogleLoginButton: React.FC<GoogleLoginButtonProps> = ({
  onSuccess,
  onError,
  disabled,
  mode = 'login',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) {
      return;
    }

    // Si el script ya existe en window
    if (window.google?.accounts?.id) {
      setScriptLoaded(true);
      return;
    }

    // Cargar script oficial de Google Identity Services
    const existingScript = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]'
    ) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener('load', () => setScriptLoaded(true));
      existingScript.addEventListener('error', () => setLoadError(true));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => {
      setLoadError(true);
      onError(
        'No se pudo conectar con los servidores de Google (posible bloqueador de anuncios o conexión inestable). Podés ingresar con correo y contraseña.'
      );
    };
    document.head.appendChild(script);
  }, [clientId, onError]);

  useEffect(() => {
    if (!scriptLoaded || !window.google?.accounts?.id || !containerRef.current || !clientId) {
      return;
    }

    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential: string }) => {
          if (!response.credential) {
            onError('No se recibió el token de autenticación de Google');
            return;
          }
          onSuccess(response.credential);
        },
        error_callback: (err: any) => {
          console.error('[Google GIS Error]', err);
          onError('Error al autenticar con Google. Por favor intentá nuevamente.');
        },
      });

      // Limpiar contenedor antes de renderizar
      containerRef.current.innerHTML = '';

      window.google.accounts.id.renderButton(containerRef.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 320,
        locale: 'es',
      });
    } catch (err: any) {
      console.error('[Google Button Render Error]', err);
      setLoadError(true);
    }
  }, [scriptLoaded, clientId, onSuccess, onError, mode]);

  if (!clientId) {
    // Si no está configurado el client ID (ej. dev local inicial), mostrar aviso discreto
    return (
      <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-amber-300 text-xs flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
        <span>VITE_GOOGLE_CLIENT_ID no configurado. Iniciá sesión con email y contraseña.</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 text-xs text-center">
        No se pudo cargar el botón de Google. Podés continuar con email y contraseña.
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center justify-center min-h-[44px] relative">
      {!scriptLoaded && (
        <div className="h-10 w-full max-w-[320px] rounded-lg bg-slate-900/80 border border-slate-800 animate-pulse flex items-center justify-center text-xs text-slate-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          <span>Cargando Google...</span>
        </div>
      )}
      <div
        ref={containerRef}
        className={`transition-opacity duration-200 flex justify-center w-full ${
          disabled ? 'opacity-40 pointer-events-none' : ''
        } ${scriptLoaded ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}
      />
    </div>
  );
};

