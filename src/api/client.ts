export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  endpoint: string;
  options: RequestInit;
}> = [];

const processQueue = (error: unknown) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      apiFetch(prom.endpoint, prom.options)
        .then(prom.resolve)
        .catch(prom.reject);
    }
  });
  failedQueue = [];
};

/**
 * Cliente HTTP para comunicar con la API REST de Stack.
 * - Siempre envía credenciales (cookies HttpOnly)
 * - Incluye cabecera CSRF obligatoria 'X-Requested-With'
 * - Manejo transparente de renovación de sesión (refresh token) con reintentos
 */
export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'XMLHttpRequest');

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'include',
  };

  try {
    const response = await fetch(url, fetchOptions);

    if (response.status === 401) {
      const isAuthRoute =
        url.includes('/api/auth/login') ||
        url.includes('/api/auth/register') ||
        url.includes('/api/auth/refresh');

      if (!isAuthRoute) {
        if (!isRefreshing) {
          isRefreshing = true;

          try {
            const refreshRes = await fetch('/api/auth/refresh', {
              method: 'POST',
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
              credentials: 'include',
            });

            if (refreshRes.ok) {
              isRefreshing = false;
              processQueue(null);
              return apiFetch<T>(url, options);
            } else {
              isRefreshing = false;
              const err = new ApiError('Sesión expirada', 401, 'UNAUTHORIZED');
              processQueue(err);
              throw err;
            }
          } catch (err) {
            isRefreshing = false;
            processQueue(err);
            throw err;
          }
        }

        // Si ya hay un refresco en progreso, encolar esta petición
        return new Promise<T>((resolve, reject) => {
          failedQueue.push({ resolve, reject, endpoint, options });
        });
      }
    }

    // Manejar 204 No Content o respuestas sin body
    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage = data?.error || data?.message || `Error del servidor (${response.status})`;
      throw new ApiError(errorMessage, response.status, data?.code, data?.details);
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      (error as Error)?.message || 'Error de conexión con el servidor',
      0,
      'NETWORK_ERROR'
    );
  }
}

