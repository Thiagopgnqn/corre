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

type GoogleIdApi = NonNullable<Window['google']>['accounts']['id'];

interface ActiveGoogleCallbacks {
  token?: object;
  onSuccess: (credential: string) => void;
  onError: (errorMsg: string) => void;
}

let initializedClientId: string | null = null;
let activeCallbacks: ActiveGoogleCallbacks | null = null;
const renderedContainerClientIds = new WeakMap<HTMLElement, string>();

/**
 * Reinicia las guardas globales del módulo (exclusivo para tests unitarios).
 */
export function __resetGoogleLoginButtonForTesting(): void {
  initializedClientId = null;
  activeCallbacks = null;
}

/**
 * Inicializa Google Identity Services una sola vez por clientId y renderiza el botón
 * una sola vez por montaje de contenedor, delegando siempre a los callbacks más recientes.
 */
export function syncGoogleGisButton(params: {
  clientId: string;
  container: HTMLElement;
  googleId: GoogleIdApi;
  onSuccess: (credential: string) => void;
  onError: (errorMsg: string) => void;
  token?: object;
}): { initializedNow: boolean; renderedNow: boolean } {
  const { clientId, container, googleId, onSuccess, onError, token } = params;

  activeCallbacks = { token, onSuccess, onError };

  let initializedNow = false;
  if (initializedClientId !== clientId) {
    googleId.initialize({
      client_id: clientId,
      callback: (response: { credential: string }) => {
        if (!response.credential) {
          activeCallbacks?.onError('No se recibió el token de autenticación de Google');
          return;
        }
        activeCallbacks?.onSuccess(response.credential);
      },
      error_callback: (err: any) => {
        console.error('[Google GIS Error]', err);
        activeCallbacks?.onError('Error al autenticar con Google. Por favor intentá nuevamente.');
      },
    });
    initializedClientId = clientId;
    initializedNow = true;
  }

  const prevClientId = renderedContainerClientIds.get(container);
  let renderedNow = false;

  if (prevClientId && prevClientId !== clientId) {
    container.innerHTML = '';
  }

  if (prevClientId !== clientId || container.childNodes.length === 0) {
    const calculatedWidth = Math.max(200, Math.min(320, container.offsetWidth || 280));
    googleId.renderButton(container, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: calculatedWidth,
      locale: 'es',
    });
    renderedContainerClientIds.set(container, clientId);
    renderedNow = true;
  }

  return { initializedNow, renderedNow };
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const instanceTokenRef = useRef<object>({});

  const [scriptLoaded, setScriptLoaded] = useState<boolean>(
    () => typeof window !== 'undefined' && Boolean(window.google?.accounts?.id)
  );
  const [loadError, setLoadError] = useState(false);
  const [buttonRendered, setButtonRendered] = useState(false);
  const clientId =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GOOGLE_CLIENT_ID
      : undefined;

  // Mantener los callbacks activos sincronizados y tolerar desmontaje/remontaje en StrictMode
  useEffect(() => {
    const token = instanceTokenRef.current;
    activeCallbacks = {
      token,
      onSuccess: (credential: string) => onSuccessRef.current(credential),
      onError: (errorMsg: string) => onErrorRef.current(errorMsg),
    };
    return () => {
      if (activeCallbacks?.token === token) {
        activeCallbacks = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!clientId) {
      return;
    }

    // Si el script ya existe en window
    if (window.google?.accounts?.id) {
      setScriptLoaded(true);
      return;
    }

    const handleLoad = () => setScriptLoaded(true);
    const handleExistingError = () => setLoadError(true);

    // Cargar script oficial de Google Identity Services
    const existingScript = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]'
    ) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad);
      existingScript.addEventListener('error', handleExistingError);
      return () => {
        existingScript.removeEventListener('load', handleLoad);
        existingScript.removeEventListener('error', handleExistingError);
      };
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = handleLoad;
    script.onerror = () => {
      setLoadError(true);
      onErrorRef.current(
        'No se pudo conectar con los servidores de Google (posible bloqueador de anuncios o conexión inestable). Podés ingresar con correo y contraseña.'
      );
    };
    document.head.appendChild(script);
  }, [clientId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!scriptLoaded || !window.google?.accounts?.id || !container || !clientId) {
      return;
    }

    const prevClientId = renderedContainerClientIds.get(container);
    if (prevClientId && prevClientId !== clientId) {
      setButtonRendered(false);
    }

    try {
      syncGoogleGisButton({
        clientId,
        container,
        googleId: window.google.accounts.id,
        onSuccess: (credential: string) => onSuccessRef.current(credential),
        onError: (errorMsg: string) => onErrorRef.current(errorMsg),
        token: instanceTokenRef.current,
      });
    } catch (err: any) {
      console.error('[Google Button Render Error]', err);
      setLoadError(true);
      return;
    }

    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;
    let trackedIframe: HTMLIFrameElement | null = null;

    const markRendered = () => {
      if (cancelled) return;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      setButtonRendered(true);
    };

    const onIframeLoad = () => markRendered();

    const attachIframeReadyListener = (): boolean => {
      const iframe = container.querySelector('iframe');
      if (iframe) {
        if (trackedIframe !== iframe) {
          if (trackedIframe) {
            trackedIframe.removeEventListener('load', onIframeLoad);
          }
          trackedIframe = iframe;
          iframe.addEventListener('load', onIframeLoad, { once: true });
        }
        if (!fallbackTimer) {
          fallbackTimer = setTimeout(markRendered, 180);
        }
        return true;
      }
      if (container.childNodes.length > 0 && !fallbackTimer) {
        fallbackTimer = setTimeout(markRendered, 180);
        return true;
      }
      return false;
    };

    if (!attachIframeReadyListener() && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        if (attachIframeReadyListener() && trackedIframe && observer) {
          observer.disconnect();
          observer = null;
        }
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    safetyTimer = setTimeout(markRendered, 500);

    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (safetyTimer) clearTimeout(safetyTimer);
      if (observer) observer.disconnect();
      if (trackedIframe) {
        trackedIframe.removeEventListener('load', onIframeLoad);
      }
    };
  }, [scriptLoaded, clientId]);

  if (!clientId) {
    // Si no está configurado el client ID (ej. dev local inicial), mostrar aviso discreto manteniendo los 44px fijos
    return (
      <div className="h-[44px] min-h-[44px] w-full relative overflow-hidden">
        <div className="absolute inset-0 px-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-amber-300 text-xs flex items-center gap-2 overflow-hidden">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          <span className="truncate">
            VITE_GOOGLE_CLIENT_ID no configurado. Iniciá sesión con email y contraseña.
          </span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-[44px] min-h-[44px] w-full relative overflow-hidden">
        <div className="absolute inset-0 px-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 text-xs flex items-center justify-center text-center overflow-hidden">
          <span className="truncate">
            No se pudo cargar el botón de Google. Podés continuar con email y contraseña.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[44px] min-h-[44px] w-full relative">
      <div
        aria-hidden={buttonRendered}
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${
          buttonRendered ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="h-10 w-full max-w-[320px] rounded-lg bg-slate-900/80 border border-slate-800 animate-pulse flex items-center justify-center text-xs text-slate-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          <span>Cargando Google...</span>
        </div>
      </div>
      <div
        ref={containerRef}
        className={`absolute inset-0 transition-opacity duration-200 flex items-center justify-center w-full max-w-full overflow-hidden [&>div]:max-w-full [&_iframe]:max-w-full ${
          disabled ? 'opacity-40 pointer-events-none' : ''
        } ${buttonRendered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
    </div>
  );
};

