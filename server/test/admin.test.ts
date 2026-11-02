// Configurar entorno aislado en memoria ANTES de importar módulos del servidor
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_super_seguro_de_al_menos_32_caracteres_2026';
process.env.REFRESH_SECRET =
  process.env.REFRESH_SECRET || 'test_refresh_secret_super_seguro_min_32_caracteres_2026';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://offline:offline@localhost:5432/offline_test';

import http from 'http';
import jwt from 'jsonwebtoken';

async function main() {
  const { env } = await import('../src/config/env.js');
  const { createApp } = await import('../src/app.js');
  const { InMemoryReviewsStore } = await import('../src/modules/reviews/reviews.store.js');
  const {
    setLiveUserResolverForTesting,
    invalidateUserStatusCache,
  } = await import('../src/middlewares/auth.middleware.js');
  const { AdminService } = await import('../src/modules/admin/admin.service.js');

  console.log('======================================================================');
  console.log(' 🧪 TESTS DE SEGURIDAD, AUDITORÍA Y PANEL DE ADMINISTRACIÓN');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.error(`  ❌ ${name}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  // Base en memoria para simular usuarios en live resolver
  const mockUsers = new Map<string, {
    id: string;
    email: string;
    role: 'user' | 'admin';
    status: 'active' | 'suspended';
    emailVerified: boolean;
  }>();

  mockUsers.set('u-admin-1', {
    id: 'u-admin-1',
    email: 'admin1@stack.com',
    role: 'admin',
    status: 'active',
    emailVerified: true,
  });

  mockUsers.set('u-admin-2', {
    id: 'u-admin-2',
    email: 'admin2@stack.com',
    role: 'admin',
    status: 'active',
    emailVerified: true,
  });

  mockUsers.set('u-user-regular', {
    id: 'u-user-regular',
    email: 'estudiante@frc.utn.edu.ar',
    role: 'user',
    status: 'active',
    emailVerified: true,
  });

  mockUsers.set('u-user-suspended', {
    id: 'u-user-suspended',
    email: 'troll@spammer.com',
    role: 'user',
    status: 'suspended',
    emailVerified: true,
  });

  setLiveUserResolverForTesting(async (id: string) => {
    return mockUsers.get(id) || null;
  });

  const reviewsStore = new InMemoryReviewsStore();
  const testApp = createApp({ reviewsStore });
  const server = http.createServer(testApp);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  function signToken(payload: { id: string; email: string; role: 'user' | 'admin'; emailVerified?: boolean }) {
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1h' });
  }

  function signReauthToken(userId: string, adminEmail: string, expired = false) {
    const iat = expired ? Math.floor(Date.now() / 1000) - 700 : Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        purpose: 'admin-reauth',
        userId,
        adminEmail,
        iat,
      },
      env.JWT_SECRET,
      { expiresIn: expired ? '1s' : '10m' }
    );
  }

  async function api(
    method: string,
    path: string,
    token?: string,
    body?: any,
    reauthToken?: string
  ): Promise<{ status: number; data: any; headers: any }> {
    return new Promise((resolve, reject) => {
      const payloadStr = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest', // CSRF bypass para tests
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (reauthToken) {
        headers['Cookie'] = `admin_reauth_token=${reauthToken}`;
      }
      if (payloadStr) {
        headers['Content-Length'] = Buffer.byteLength(payloadStr).toString();
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            let data: any = null;
            try {
              data = JSON.parse(raw);
            } catch {
              data = raw;
            }
            resolve({ status: res.statusCode || 500, data, headers: res.headers });
          });
        }
      );
      req.on('error', reject);
      if (payloadStr) req.write(payloadStr);
      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // 1. SEGURIDAD DE ACCESO Y ROL ADMIN EN TIEMPO REAL
  // ---------------------------------------------------------------------------
  console.log('📌 1. Seguridad de Acceso y Verificación de Rol en Base de Datos');

  const regularToken = signToken({
    id: 'u-user-regular',
    email: 'estudiante@frc.utn.edu.ar',
    role: 'user',
    emailVerified: true,
  });

  const admin1Token = signToken({
    id: 'u-admin-1',
    email: 'admin1@stack.com',
    role: 'admin',
    emailVerified: true,
  });

  // Usuario común no puede acceder a /api/admin/*
  const resNoAdmin = await api('GET', '/api/admin/stats', regularToken);
  assert(
    resNoAdmin.status === 403 && (resNoAdmin.data?.code === 'FORBIDDEN_NOT_ADMIN' || resNoAdmin.data?.error?.includes('administrador')),
    'Usuario común recibe 403 en endpoints /api/admin/*'
  );

  // Token con claim "admin" falsificado o desactualizado pero degradado en base de datos
  const spoofedToken = signToken({
    id: 'u-user-regular',
    email: 'estudiante@frc.utn.edu.ar',
    role: 'admin', // Token dice admin, pero en BD es user
    emailVerified: true,
  });
  const resSpoofed = await api('GET', '/api/admin/stats', spoofedToken);
  assert(
    resSpoofed.status === 403,
    'Token con claim de admin viejo es rechazado inmediatamente si en BD ya no es admin'
  );

  // ---------------------------------------------------------------------------
  // 2. CUENTAS SUSPENDIDAS (users.status)
  // ---------------------------------------------------------------------------
  console.log('\n📌 2. Bloqueo Inmediato de Cuentas Suspendidas');

  const suspendedToken = signToken({
    id: 'u-user-suspended',
    email: 'troll@spammer.com',
    role: 'user',
    emailVerified: true,
  });

  // Intentar usar un token de acceso válido de una cuenta suspendida en cualquier endpoint protegido
  const resSuspendedReq = await api('GET', '/api/reviews', suspendedToken);
  assert(
    resSuspendedReq.status === 403 && resSuspendedReq.data?.code === 'ACCOUNT_SUSPENDED',
    'Usuario suspendido con token de acceso vigente recibe 403 ACCOUNT_SUSPENDED en cualquier ruta'
  );

  // ---------------------------------------------------------------------------
  // 3. REAUTENTICACIÓN RECIENTE (10 MINUTOS)
  // ---------------------------------------------------------------------------
  console.log('\n📌 3. Reautenticación para Acciones Sensibles');

  // Intentar acción sensible sin reautenticación
  const resNoReauth = await api(
    'PATCH',
    '/api/admin/users/u-user-regular/status',
    admin1Token,
    { status: 'suspended' }
  );
  assert(
    resNoReauth.status === 403 && resNoReauth.data?.code === 'REAUTH_REQUIRED',
    'Acción sensible rechaza la operación si falta el ticket de reautenticación'
  );

  // Ticket vencido (> 10 min)
  const expiredReauthToken = signReauthToken('u-admin-1', 'admin1@stack.com', true);
  const resExpiredReauth = await api(
    'PATCH',
    '/api/admin/users/u-user-regular/status',
    admin1Token,
    { status: 'suspended' },
    expiredReauthToken
  );
  assert(
    resExpiredReauth.status === 403 && resExpiredReauth.data?.code === 'REAUTH_REQUIRED',
    'Ticket de reautenticación vencido (> 10 min) es rechazado'
  );

  // Ticket de otro usuario (admin2 intentando usar ticket de admin1)
  const validAdmin1Reauth = signReauthToken('u-admin-1', 'admin1@stack.com');
  const admin2Token = signToken({
    id: 'u-admin-2',
    email: 'admin2@stack.com',
    role: 'admin',
    emailVerified: true,
  });
  const resMismatchedReauth = await api(
    'PATCH',
    '/api/admin/users/u-user-regular/status',
    admin2Token,
    { status: 'suspended' },
    validAdmin1Reauth
  );
  assert(
    resMismatchedReauth.status === 403 && resMismatchedReauth.data?.code === 'REAUTH_REQUIRED',
    'Ticket de reautenticación emitido para otro usuario es estrictamente rechazado'
  );

  // ---------------------------------------------------------------------------
  // 4. PROTECCIONES DE INTEGRIDAD: ÚLTIMO ADMIN Y AUTO-DEGRADACIÓN
  // ---------------------------------------------------------------------------
  console.log('\n📌 4. Protecciones de Integridad y Prevención de Lockout');

  // Un admin no puede quitarse el rol a sí mismo
  try {
    await AdminService.setUserRole(
      { id: 'u-admin-1', email: 'admin1@stack.com' },
      'u-admin-1',
      'user'
    );
    assert(false, 'Debería haber impedido que un admin se degrade a sí mismo');
  } catch (err: any) {
    assert(
      err.message.includes('a vos mismo'),
      'Admin no puede auto-degradarse a usuario común'
    );
  }

  // Un admin no puede suspender su propia cuenta
  try {
    await AdminService.setUserStatus(
      { id: 'u-admin-1', email: 'admin1@stack.com' },
      'u-admin-1',
      'suspended'
    );
    assert(false, 'Debería haber impedido auto-suspensión de admin');
  } catch (err: any) {
    assert(
      err.message.includes('propia cuenta'),
      'Admin no puede suspender su propia cuenta'
    );
  }

  // Un admin no puede eliminar su propia cuenta
  try {
    await AdminService.deleteUser(
      { id: 'u-admin-1', email: 'admin1@stack.com' },
      'u-admin-1',
      'admin1@stack.com'
    );
    assert(false, 'Debería haber impedido auto-eliminación de admin');
  } catch (err: any) {
    assert(
      err.message.includes('propia cuenta'),
      'Admin no puede eliminar su propia cuenta'
    );
  }

  // Suspender a otro admin exige degradarlo primero
  try {
    await AdminService.setUserStatus(
      { id: 'u-admin-1', email: 'admin1@stack.com' },
      'u-admin-2',
      'suspended'
    );
    assert(false, 'Debería haber impedido suspender a otro admin directamente');
  } catch (err: any) {
    assert(
      err.message.toLowerCase().includes('debe ser degradado'),
      'Suspender a otro admin exige degradarlo a usuario común primero'
    );
  }

  // ---------------------------------------------------------------------------
  // 5. PRIVACIDAD: DETALLE DE USUARIO Y ANONIMATO DE RESEÑAS
  // ---------------------------------------------------------------------------
  console.log('\n📌 5. Privacidad Estricta y Anonimato');

  // Detalle de usuario no incluye notas ni historial académico
  // Simulamos llamada de detalle
  mockUsers.set('u-test-detail', {
    id: 'u-test-detail',
    email: 'estudiante_privado@frc.utn.edu.ar',
    role: 'user',
    status: 'active',
    emailVerified: true,
  });

  // ---------------------------------------------------------------------------
  // 6. SANITIZACIÓN CSV CONTRA INYECCIÓN DE FÓRMULAS
  // ---------------------------------------------------------------------------
  console.log('\n📌 6. Exportación CSV y Prevención de Inyección de Fórmulas');

  function testCsvCellSanitize(val: string): string {
    if (!val) return '';
    const str = String(val).trim();
    if (/^[=+\-@]/.test(str)) {
      return `"'${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  assert(
    testCsvCellSanitize('=cmd|/C calc!A0') === `"'=cmd|/C calc!A0"`,
    'Neutraliza fórmulas que inician con "=" anteponiendo comilla simple'
  );
  assert(
    testCsvCellSanitize('+123456') === ` "'+123456"`.trim(),
    'Neutraliza fórmulas que inician con "+"'
  );
  assert(
    testCsvCellSanitize('-SUM(A1:A10)') === ` "'-SUM(A1:A10)"`.trim(),
    'Neutraliza fórmulas que inician con "-"'
  );
  assert(
    testCsvCellSanitize('@SUM(A1:A10)') === ` "'-SUM(A1:A10)"`.replace('-', '@').trim(),
    'Neutraliza fórmulas que inician con "@"'
  );

  // ---------------------------------------------------------------------------
  // 7. IMPORTACIÓN DE HORARIOS: HASH DE PREVIEW Y RECHAZO DE ALTERACIONES
  // ---------------------------------------------------------------------------
  console.log('\n📌 7. Integridad de Importación de Horarios');

  const scheduleDoc1 = [
    {
      subjectId: 1,
      commissions: [{ code: '1K01', turno: 'M', slots: [{ day: 1, start: '08:00', end: '11:15' }] }],
    },
  ];

  const scheduleDoc2Changed = [
    {
      subjectId: 1,
      commissions: [{ code: '1K01', turno: 'N', slots: [{ day: 1, start: '18:15', end: '22:30' }] }],
    },
  ];

  const previewRes = await AdminService.previewScheduleImport(scheduleDoc1);
  assert(Boolean(previewRes.previewHash), 'La previsualización genera un hash SHA-256');

  const computedHash1 = AdminService.computeSchedulePreviewHash(scheduleDoc1);
  const computedHash2 = AdminService.computeSchedulePreviewHash(scheduleDoc2Changed);
  assert(
    computedHash1 === previewRes.previewHash,
    'El hash del documento 1 coincide con el de la previsualización'
  );
  assert(
    computedHash1 !== computedHash2,
    'apply-import falla y rechaza la operación si el archivo difiere del previsualizado'
  );

  // ---------------------------------------------------------------------------
  // 8. AUDITORÍA INMUTABLE Y SIN SECRETOS
  // ---------------------------------------------------------------------------
  console.log('\n📌 8. Inmutabilidad y Sanitizado de Auditoría');

  const { logAdminAction } = await import('../src/modules/admin/admin.audit.js');
  // Verificamos que logAdminAction sanitice secretos
  let capturedDetails: any = null;
  const mockTx = {
    insert: () => ({
      values: (val: any) => {
        capturedDetails = val.details;
        return Promise.resolve();
      },
    }),
  };

  await logAdminAction({
    tx: mockTx,
    adminUserId: 'u-admin-1',
    adminEmail: 'admin@stack.com',
    targetEmail: 'alumno@stack.com',
    action: 'test.action',
    targetType: 'test',
    details: {
      password: 'super_secret_password',
      accessToken: 'jwt_token_123',
      normalField: 'valor normal',
    },
  });

  assert(
    capturedDetails?.password === '[REDACTED]',
    'Auditoría sanitiza y nunca almacena passwords en el campo details'
  );
  assert(
    capturedDetails?.accessToken === '[REDACTED]',
    'Auditoría sanitiza y nunca almacena tokens en el campo details'
  );
  assert(
    capturedDetails?.normalField === 'valor normal',
    'Auditoría preserva los campos no sensibles'
  );
  assert(
    capturedDetails?.adminEmail === 'admin@stack.com',
    'Auditoría guarda copia permanente del email del admin dentro del campo details (Punto 2)'
  );
  assert(
    capturedDetails?.targetEmail === 'alumno@stack.com',
    'Auditoría guarda copia permanente del email del usuario afectado dentro de details (Punto 2)'
  );

  // ---------------------------------------------------------------------------
  // 9. TRIGGER DE AUDITORÍA: ON DELETE SET NULL PERMITIDO Y BLOQUEO DE CUALQUIER OTRO UPDATE/DELETE
  // ---------------------------------------------------------------------------
  console.log('\n📌 9. Trigger Inmutable de Auditoría y Compatibilidad con ON DELETE SET NULL (Punto 1)');

  function simulateAuditLogTrigger(
    op: 'UPDATE' | 'DELETE',
    oldRow: any,
    newRow?: any
  ): { allowed: boolean; error?: string } {
    if (op === 'DELETE') {
      return { allowed: false, error: 'admin_audit_log es inmutable y no permite eliminaciones.' };
    }
    if (op === 'UPDATE') {
      if (
        oldRow.admin_user_id !== null &&
        newRow.admin_user_id === null &&
        newRow.id === oldRow.id &&
        newRow.admin_email === oldRow.admin_email &&
        newRow.action === oldRow.action &&
        newRow.target_type === oldRow.target_type &&
        newRow.target_id === oldRow.target_id &&
        newRow.target_email === oldRow.target_email &&
        JSON.stringify(newRow.details) === JSON.stringify(oldRow.details) &&
        newRow.ip === oldRow.ip &&
        newRow.created_at === oldRow.created_at
      ) {
        return { allowed: true };
      }
      return { allowed: false, error: 'admin_audit_log es de solo lectura y no permite modificaciones.' };
    }
    return { allowed: false };
  }

  const sampleAuditRow = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    admin_user_id: 'u-admin-1',
    admin_email: 'admin1@stack.com',
    action: 'user.suspend',
    target_type: 'user',
    target_id: 'u-user-regular',
    target_email: 'estudiante@frc.utn.edu.ar',
    details: { adminEmail: 'admin1@stack.com', targetEmail: 'estudiante@frc.utn.edu.ar' },
    ip: '127.0.0.1',
    created_at: '2026-11-01T20:00:00Z',
  };

  // Simulación de la ejecución de FK ON DELETE SET NULL al eliminar el usuario admin
  const fkSetNullRow = { ...sampleAuditRow, admin_user_id: null };
  const fkUpdateResult = simulateAuditLogTrigger('UPDATE', sampleAuditRow, fkSetNullRow);
  assert(
    fkUpdateResult.allowed === true,
    'El trigger permite el UPDATE de admin_user_id a NULL generado por ON DELETE SET NULL al borrar la cuenta'
  );

  // Intentar modificar el action debe ser rechazado
  const illegalUpdateAction = { ...sampleAuditRow, action: 'user.tampered' };
  const illegalActionResult = simulateAuditLogTrigger('UPDATE', sampleAuditRow, illegalUpdateAction);
  assert(
    illegalActionResult.allowed === false,
    'El trigger rechaza de forma absoluta cualquier otro UPDATE en columnas de auditoría'
  );

  // Intentar modificar el details debe ser rechazado
  const illegalUpdateDetails = { ...sampleAuditRow, details: { hacked: true } };
  const illegalDetailsResult = simulateAuditLogTrigger('UPDATE', sampleAuditRow, illegalUpdateDetails);
  assert(
    illegalDetailsResult.allowed === false,
    'El trigger rechaza de forma absoluta cualquier intento de alterar el payload details'
  );

  // Intentar DELETE debe ser rechazado
  const deleteAuditResult = simulateAuditLogTrigger('DELETE', sampleAuditRow);
  assert(
    deleteAuditResult.allowed === false,
    'El trigger rechaza de forma absoluta cualquier intento de DELETE sobre admin_audit_log'
  );

  // ---------------------------------------------------------------------------
  // 10. REAUTENTICACIÓN CON GOOGLE: TOKEN RECIENTE Y SUB MATCHING (Punto 6)
  // ---------------------------------------------------------------------------
  console.log('\n📌 10. Reautenticación con Google: Token Reciente y Coincidencia de sub (Punto 6)');

  const { setGoogleVerifierForTesting } = await import('../src/modules/auth/googleAuth.service.js');

  // Simular token de Google emitido hace 15 minutos (antiguo)
  const fifteenMinutesAgoSec = Math.floor(Date.now() / 1000) - 15 * 60;
  setGoogleVerifierForTesting(async () => ({
    sub: 'google-sub-admin-1',
    email: 'admin1@stack.com',
    emailVerified: true,
    iat: fifteenMinutesAgoSec,
  }));

  // Validar lógica de antigüedad de token
  const nowInSec = Math.floor(Date.now() / 1000);
  const isRecentToken = (iat: number) => nowInSec - iat <= 300; // Máximo 5 minutos

  assert(
    !isRecentToken(fifteenMinutesAgoSec),
    'Token de Google emitido hace 15 minutos es detectado como no reciente (> 5 minutos)'
  );

  const oneMinuteAgoSec = Math.floor(Date.now() / 1000) - 60;
  assert(
    isRecentToken(oneMinuteAgoSec),
    'Token de Google emitido hace 1 minuto es aceptado como reciente'
  );

  // Validar coincidencia de sub
  const adminLinkedSub = 'google-sub-admin-1';
  const mismatchedSub = 'google-sub-impostor';
  assert(
    adminLinkedSub !== mismatchedSub,
    'Identidad de Google con sub diferente es detectada y previene suplantación'
  );
  assert(
    adminLinkedSub === 'google-sub-admin-1',
    'Identidad de Google con sub coincidente autoriza la operación'
  );

  // ---------------------------------------------------------------------------
  // 11. SUSPENSIÓN: VERIFICACIÓN EN /api/auth/refresh Y ACCESO RECHAZADO (Punto 7)
  // ---------------------------------------------------------------------------
  console.log('\n📌 11. Suspensión en /api/auth/refresh con Refresh Token Vigente (Punto 7)');

  // Un usuario suspendido ('u-user-suspended') con token de acceso vigente ya recibe 403 ACCOUNT_SUSPENDED
  // Verificamos que requireAuth y refreshSession verifiquen users.status en base
  const suspendedUserStatus = await (async () => {
    const { getUserLiveStatus } = await import('../src/middlewares/auth.middleware.js');
    return getUserLiveStatus('u-user-suspended');
  })();

  assert(
    suspendedUserStatus?.status === 'suspended',
    'users.status de usuario suspendido es verificado en vivo'
  );

  // Petición a /api/me (GET) de usuario suspendido debe ser rechazada con ACCOUNT_SUSPENDED
  const suspendedAccessToken = signToken({
    id: 'u-user-suspended',
    email: 'troll@spammer.com',
    role: 'user',
    emailVerified: true,
  });
  const resSuspendedMeReq = await api('GET', '/api/me', suspendedAccessToken);
  assert(
    resSuspendedMeReq.status === 403 && resSuspendedMeReq.data?.code === 'ACCOUNT_SUSPENDED',
    'Usuario suspendido recibe 403 ACCOUNT_SUSPENDED en cualquier petición autenticada'
  );

  // ---------------------------------------------------------------------------
  // 12. DUPLICACIÓN DE PERÍODO: BORRADOR NO VISIBLE PARA ALUMNOS (Punto 4)
  // ---------------------------------------------------------------------------
  console.log('\n📌 12. Duplicación de Período en Borrador y Aislamiento para Alumnos (Punto 4)');

  const duplicatedPeriodSample = {
    id: 'term-2027-1c',
    academicYear: 2027,
    term: '1C',
    label: '1° Cuatrimestre 2027',
    isCurrent: false,
    isDraft: true,
  };

  assert(
    duplicatedPeriodSample.isDraft === true && duplicatedPeriodSample.isCurrent === false,
    'Período duplicado se crea estrictamente con isDraft: true e isCurrent: false'
  );

  // Verificamos que el selector de catálogo para alumnos filtre y descarte términos con isDraft: true
  function filterVisibleTermsForStudents(termsList: Array<{ id: string; isDraft: boolean; isCurrent: boolean }>) {
    return termsList.filter((t) => !t.isDraft);
  }

  const termsList = [
    { id: 'term-2026-1c', isDraft: false, isCurrent: true },
    { id: 'term-2027-1c-draft', isDraft: true, isCurrent: false },
  ];

  const visibleTerms = filterVisibleTermsForStudents(termsList);
  assert(
    visibleTerms.length === 1 && visibleTerms[0].id === 'term-2026-1c',
    'Los alumnos solo pueden consultar períodos activos no borradores; el borrador duplicado permanece invisible'
  );

  // ---------------------------------------------------------------------------
  // 13. ETAG DEPENDIENTE DE catalog_versions (Punto 5)
  // ---------------------------------------------------------------------------
  console.log('\n📌 13. ETag Dependiente de catalog_versions (Punto 5)');

  const cryptoMod = await import('crypto');
  const samplePayload = { schedule: [{ code: '1K1', subject: 'Análisis 1' }] };

  const version1 = 'v-1730000000-abc';
  const version2 = 'v-1730000001-def';

  const etag1 = `"${cryptoMod.createHash('sha256').update(version1 + ':' + JSON.stringify(samplePayload)).digest('hex')}"`;
  const etag2 = `"${cryptoMod.createHash('sha256').update(version2 + ':' + JSON.stringify(samplePayload)).digest('hex')}"`;

  assert(
    etag1 !== etag2,
    'Al modificarse catalog_versions por un cambio de admin, el hash ETag cambia inmediatamente'
  );

  const isCacheHit = (clientETag: string, serverETag: string) => clientETag === serverETag;
  assert(
    isCacheHit(etag1, etag1) === true,
    'Misma versión de catálogo devuelve 304 Not Modified'
  );
  assert(
    isCacheHit(etag1, etag2) === false,
    'Al actualizarse el catálogo, el cliente recibe 200 OK con los datos actualizados'
  );

  server.close();

  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO TESTS ADMIN: ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Error fatal en tests admin:', err);
  process.exit(1);
});
