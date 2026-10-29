import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { errorHandler } from './middlewares/error.middleware.js';

export const app = express();

// Confianza total en proxies inversos encadenados (Vercel -> Render)
// Permite que req.ip y req.protocol reflejen la IP y protocolo del cliente real
app.set('trust proxy', true);

// 1. Cabeceras de seguridad
app.use(
  helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: false,
  })
);

// 2. CORS (útil para dev local o llamadas directas con credenciales)
app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origin (ej. server-to-server, curl, Vercel rewrite interno)
      if (!origin) return callback(null, true);

      try {
        const originUrl = new URL(origin).origin;
        const clientUrl = new URL(env.CLIENT_ORIGIN).origin;
        if (originUrl === clientUrl || env.NODE_ENV === 'development') {
          return callback(null, true);
        }
      } catch {
        // Ignorar
      }
      callback(new Error(`CORS no permitido para el origen: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-App-Client'],
  })
);

// 3. Parsers de body y cookies
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 4. Endpoint de salud para Render (y frontend ping)
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// 5. Rutas de Autenticación
app.use('/api/auth', authRouter);

// 6. Manejador de 404 para rutas no existentes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Ruta no encontrada: ${req.method} ${req.baseUrl}`,
  });
});

// 7. Manejador centralizado de errores
app.use(errorHandler);

// Iniciar servidor si se ejecuta directamente
if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    console.log(`🚀 Servidor backend escuchando en puerto ${env.PORT} (${env.NODE_ENV})`);
    console.log(`🌐 CLIENT_ORIGIN configurado: ${env.CLIENT_ORIGIN}`);
    console.log(`🩺 Health check: http://localhost:${env.PORT}/api/health`);
  });
}

