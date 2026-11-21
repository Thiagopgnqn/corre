// Configurar entorno aislado en memoria ANTES de importar módulos del servidor (CERO conexión a Neon)
import './setupTestEnv.js';

import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

async function main() {
  const { env } = await import('../src/config/env.js');
  const { createApp } = await import('../src/app.js');
  const { DrizzleReviewsStore, InMemoryReviewsStore, setActiveReviewsStore } = await import(
    '../src/modules/reviews/reviews.store.js'
  );
  const { InMemoryUserStateStore } = await import('../src/modules/user-state/userState.store.js');
  const {
    parseProfessorName,
    compareProfessorParsed,
    analyzeProfessorNames,
  } = await import('../src/modules/professors/professorNormalizer.js');
  const { setLiveUserResolverForTesting } = await import('../src/middlewares/auth.middleware.js');

  console.log('======================================================================');
  console.log(' 🧪 TESTS DE RESEÑAS DE PROFESORES, PRIVACIDAD, MODERACIÓN Y RANKING');
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

  // ---------------------------------------------------------------------------
  // 1. NORMALIZACIÓN Y COMPARACIÓN DE NOMBRES DE PROFESORES
  // ---------------------------------------------------------------------------
  console.log('📌 1. Normalización y Detección de Posibles Duplicados');

  const pBottaFull = parseProfessorName('Botta, Oscar Ernesto');
  const pBottaSwapped = parseProfessorName('Oscar, Botta');
  const pBottaExactSwap = parseProfessorName('Botta, Oscar');

  assert(
    pBottaSwapped.normalizedKey === pBottaExactSwap.normalizedKey &&
      pBottaSwapped.normalizedKey === 'botta oscar',
    'Insensibilidad al orden exacto: "Oscar, Botta" y "Botta, Oscar" producen la misma normalizedKey'
  );

  const cmpBotta = compareProfessorParsed(pBottaFull, pBottaSwapped);
  assert(
    cmpBotta?.kind === 'proposed_same' && cmpBotta.confidence === 'high',
    'Caso "Botta, Oscar Ernesto" vs "Oscar, Botta" se propone como el mismo docente (alta confianza)'
  );

  const cmpDifferentGiven = compareProfessorParsed(
    parseProfessorName('Romero, Rubén Aníbal'),
    parseProfessorName('Romero, María Soledad')
  );
  assert(
    cmpDifferentGiven?.kind === 'same_surname_diff_given',
    'Mismo apellido con nombres distintos ("Romero, Rubén Aníbal" vs "Romero, María Soledad") NO se propone unificar'
  );

  const cmpContradictoryMiddle = compareProfessorParsed(
    parseProfessorName('Romero, Rubén Aníbal'),
    parseProfessorName('Romero, Ruben Orlando')
  );
  assert(
    cmpContradictoryMiddle?.kind === 'same_surname_diff_given',
    'Mismo apellido y primer nombre pero segundo nombre contradictorio ("Rubén Aníbal" vs "Ruben Orlando") se mantiene separado'
  );

  const pWeirdMulti = parseProfessorName('Zanatta, Valentin; Santiago');
  assert(
    pWeirdMulti.anomalies.some((a) => a.includes('separador múltiple')),
    'Detección de formato raro con separador ";" ("Zanatta, Valentin; Santiago")'
  );

  const sim = analyzeProfessorNames([
    'Botta, Oscar Ernesto',
    'Oscar, Botta',
    'García, Alfredo',
    'Garcia, Alfredo',
  ]);
  assert(
    sim.uniqueProfessors.length === 3 && sim.exactMerges.length === 1,
    'Unifica automáticamente diferencias de tilde ("García, Alfredo" / "Garcia, Alfredo") y deja separados casos dudosos para revisión'
  );

  // ---------------------------------------------------------------------------
  // PREPARAR SERVIDOR EXPRESS CON STORE EN MEMORIA (CERO CONEXIÓN A NEON)
  // ---------------------------------------------------------------------------
  const store = new InMemoryReviewsStore();
  const testApp = createApp({ reviewsStore: store });
  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://localhost:${port}`;

  function makeToken(user: {
    id: string;
    email: string;
    role: 'user' | 'admin';
    selectedPlanId?: string | null;
    emailVerified?: boolean;
  }) {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        selectedPlanId:
          'selectedPlanId' in user ? user.selectedPlanId : store.defaultPlanId,
        emailVerified: user.emailVerified ?? true,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  async function api(
    method: string,
    endpoint: string,
    token?: string,
    body?: any,
    includeCsrf: boolean = true,
    extraCookie?: string
  ) {
    const headers: Record<string, string> = {};
    if (includeCsrf) headers['X-Requested-With'] = 'XMLHttpRequest';
    const cookies = [token ? `accessToken=${token}` : '', extraCookie || ''].filter(Boolean);
    if (cookies.length > 0) headers['Cookie'] = cookies.join('; ');

    const fetchOptions: RequestInit = {
      method,
      headers,
    };
    if (method !== 'GET' && method !== 'HEAD' && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(`${baseUrl}${endpoint}`, fetchOptions);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data, rawText: text };
  }

  try {
    // Sembrar catálogo de prueba (12 materias)
    const subjects = Array.from({ length: 12 }, (_, idx) =>
      store.seedSubject({
        codeInPlan: idx + 1,
        name: `Materia Prueba ${idx + 1}`,
        shortName: `MP${idx + 1}`,
        level: Math.ceil((idx + 1) / 3),
      })
    );

    const profBotta1 = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Botta, Oscar Ernesto',
    });
    const profBotta2 = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Oscar, Botta',
    });
    const profPastTerm = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Lazarte, Marcelo Máximo',
    });
    const profVeteran = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Romoli, Irene Esther',
    });
    const profOneFiveStar = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Valero, Matías',
    });
    const profUnrelated = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Docente Otra Materia, Juan',
    });

    // Asignaciones en comisiones:
    // - profBotta1 dicta Materia 1 en período actual (2026 1C)
    store.seedCommissionTeaching({
      professorId: profBotta1.id,
      subjectId: subjects[0].id,
      termLabel: '2026 1C',
      isCurrent: true,
    });
    // - profBotta2 dicta Materia 2 en período actual (2026 1C)
    store.seedCommissionTeaching({
      professorId: profBotta2.id,
      subjectId: subjects[1].id,
      termLabel: '2026 1C',
      isCurrent: true,
    });
    // - profPastTerm dictó Materia 3 SOLO en un período anterior no actual (2025 2C, isCurrent: false)
    store.seedCommissionTeaching({
      professorId: profPastTerm.id,
      subjectId: subjects[2].id,
      termLabel: '2025 2C',
      isCurrent: false,
    });
    // - profVeteran dicta todas las materias 1..12 (útil para pruebas de ranking, anonimato >= 5 y límite diario)
    for (const s of subjects) {
      store.seedCommissionTeaching({
        professorId: profVeteran.id,
        subjectId: s.id,
        termLabel: '2026 1C',
        isCurrent: true,
      });
    }
    // - profOneFiveStar dicta Materia 1
    store.seedCommissionTeaching({
      professorId: profOneFiveStar.id,
      subjectId: subjects[0].id,
      termLabel: '2026 1C',
      isCurrent: true,
    });
    // - profUnrelated solo dicta Materia 12
    store.seedCommissionTeaching({
      professorId: profUnrelated.id,
      subjectId: subjects[11].id,
      termLabel: '2026 1C',
      isCurrent: true,
    });

    const studentA = {
      id: crypto.randomUUID(),
      email: 'alumno.secreto.a@frc.utn.edu.ar',
      role: 'user' as const,
    };
    const studentB = {
      id: crypto.randomUUID(),
      email: 'alumno.secreto.b@frc.utn.edu.ar',
      role: 'user' as const,
    };
    const studentC = {
      id: crypto.randomUUID(),
      email: 'alumno.secreto.c@frc.utn.edu.ar',
      role: 'user' as const,
    };
    const adminUser = {
      id: crypto.randomUUID(),
      email: 'admin.moderador@frc.utn.edu.ar',
      role: 'admin' as const,
    };

    const tokenA = makeToken(studentA);
    const tokenB = makeToken(studentB);
    const tokenC = makeToken(studentC);
    const tokenAdmin = makeToken(adminUser);

    const testUsersMap = new Map<string, any>();
    testUsersMap.set(studentA.id, { ...studentA, status: 'active', emailVerified: true });
    testUsersMap.set(studentB.id, { ...studentB, status: 'active', emailVerified: true });
    testUsersMap.set(studentC.id, { ...studentC, status: 'active', emailVerified: true });
    testUsersMap.set(adminUser.id, { ...adminUser, status: 'active', emailVerified: true });
    setLiveUserResolverForTesting(async (id: string) => testUsersMap.get(id) || null);

    const adminReauthCookie = `admin_reauth_token=${jwt.sign(
      { purpose: 'admin-reauth', userId: adminUser.id, adminEmail: adminUser.email },
      env.JWT_SECRET,
      { expiresIn: '10m' }
    )}`;

    // Progreso de studentA:
    // Materia 1: aprobada, Materia 2: cursando (NO elegible), Materia 3: regularizada, Materia 4: promocionada, Materia 5: pendiente
    store.seedUserProgress(studentA.id, subjects[0].id, 'aprobada', 8);
    store.seedUserProgress(studentA.id, subjects[1].id, 'cursando');
    store.seedUserProgress(studentA.id, subjects[2].id, 'regularizada');
    store.seedUserProgress(studentA.id, subjects[3].id, 'promocionada', 9);
    store.seedUserProgress(studentA.id, subjects[4].id, 'pendiente');

    // Progreso de studentB: Materia 2 aprobada
    store.seedUserProgress(studentB.id, subjects[1].id, 'aprobada', 7);

    // -------------------------------------------------------------------------
    // 2. ELEGIBILIDAD (TODOS LOS PERÍODOS + VÍNCULO HISTÓRICO + RECHAZOS)
    // -------------------------------------------------------------------------
    console.log('\n📌 2. Elegibilidad en Backend (Todos los Períodos y Vínculos Históricos)');

    const resUnauth = await api('GET', '/api/professors');
    assert(resUnauth.status === 401, 'Rutas protegidas rechazan acceso sin sesión (401)');

    const resNoCsrf = await api(
      'POST',
      '/api/reviews',
      tokenA,
      { professorId: profBotta1.id, subjectId: subjects[0].id, overall: 5 },
      false
    );
    assert(resNoCsrf.status === 403, 'Mutaciones sin cabecera CSRF X-Requested-With son rechazadas (403)');

    // 2.1 No puedo reseñar una materia en estado "pendiente" o "cursando"
    const resNotTakenPending = await api('POST', '/api/reviews', tokenA, {
      professorId: profVeteran.id,
      subjectId: subjects[4].id, // pendiente
      overall: 4,
    });
    assert(
      resNotTakenPending.status === 403 &&
        resNotTakenPending.data?.code === 'SUBJECT_NOT_COMPLETED',
      'Rechaza reseñar profesor en materia con estado "pendiente" (403)'
    );

    const resNotTakenCursando = await api('POST', '/api/reviews', tokenA, {
      professorId: profBotta2.id,
      subjectId: subjects[1].id, // cursando
      overall: 4,
    });
    assert(
      resNotTakenCursando.status === 403 &&
        resNotTakenCursando.data?.code === 'SUBJECT_NOT_COMPLETED',
      'Rechaza reseñar profesor en materia con estado "cursando" (403)'
    );

    // 2.2 No puedo reseñar un profesor que NO dicta la materia aunque el alumno la haya aprobado
    const resNotTeaching = await api('POST', '/api/reviews', tokenA, {
      professorId: profUnrelated.id,
      subjectId: subjects[0].id, // studentA la aprobó, pero profUnrelated solo dicta Materia 12
      overall: 5,
    });
    assert(
      resNotTeaching.status === 403 &&
        resNotTeaching.data?.code === 'PROFESSOR_DOES_NOT_TEACH_SUBJECT',
      'Rechaza reseñar un profesor que no dicta ni dictó esa materia (403)'
    );

    // 2.3 Puedo reseñar un profesor que dictó la materia en un período ANTERIOR no actual (2025 2C)
    const resPastTerm = await api('POST', '/api/reviews', tokenA, {
      professorId: profPastTerm.id,
      subjectId: subjects[2].id, // regularizada + dictada en 2025 2C (isCurrent: false)
      overall: 5,
      clarity: 5,
      comment: 'Excelente docente cuando la cursé el año pasado.',
      academicYear: 2025,
      term: '2C',
    });
    assert(
      resPastTerm.status === 201,
      'Permite reseñar profesor que dictó la materia en un período anterior no vigente (todos los períodos)'
    );

    // 2.3b Materia en estado "libre" permite reseñar al docente (Ajuste Libre/Recursada)
    const profLibre = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Profesor Cursada Libre, Test',
    });
    store.seedCommissionTeaching({
      professorId: profLibre.id,
      subjectId: subjects[4].id,
      termLabel: '2026 1C',
      isCurrent: true,
    });
    store.seedUserProgress(studentB.id, subjects[4].id, 'libre');
    const resLibreReview = await api('POST', '/api/reviews', tokenB, {
      professorId: profLibre.id,
      subjectId: subjects[4].id,
      overall: 4,
      clarity: 4,
      comment: 'Quedé libre pero el profesor explica muy bien los conceptos.',
    });
    assert(
      resLibreReview.status === 201,
      'Permite reseñar profesor si el alumno cursó y quedó en estado "libre" en esa materia'
    );

    // 2.4 Vínculo manual de profesor "histórico" por Admin (Ajuste #1)
    const nonAdminHist = await api('POST', '/api/admin/professors', tokenA, {
      displayName: 'Profesor Jubilado, Carlos',
      subjectId: subjects[3].id,
    });
    assert(nonAdminHist.status === 403, 'Usuario común no puede acceder a endpoints /api/admin/* (403)');

    const adminCreateHist = await api('POST', '/api/admin/professors', tokenAdmin, {
      displayName: 'Profesor Jubilado, Carlos',
    });
    const histProfId = adminCreateHist.data?.data?.professor?.id;
    assert(
      adminCreateHist.status === 201 && Boolean(histProfId),
      'Admin puede registrar un profesor histórico'
    );

    const beforeLink = await api('POST', '/api/reviews', tokenA, {
      professorId: histProfId,
      subjectId: subjects[3].id,
      overall: 4,
    });
    assert(beforeLink.status === 403, 'Antes del vínculo manual, el profesor histórico no es reseñable en la materia');

    const linkRes = await api(
      'POST',
      `/api/admin/professors/${histProfId}/subjects`,
      tokenAdmin,
      {
        planId: store.defaultPlanId,
        subjectId: subjects[3].codeInPlan,
        note: 'Titular histórico cátedra 2022-2024',
      }
    );
    assert(linkRes.status === 201, 'Admin vincula manualmente al profesor histórico con la materia');

    const afterLink = await api('POST', '/api/reviews', tokenA, {
      professorId: histProfId,
      subjectId: subjects[3].id, // promocionada por studentA
      overall: 4,
      comment: 'Gran recuerdo de sus clases teóricas.',
    });
    assert(
      afterLink.status === 201,
      'Tras el vínculo histórico de admin, quien aprobó/promocionó la materia puede reseñarlo'
    );

    // -------------------------------------------------------------------------
    // 3. UNICIDAD POR (USUARIO, PROFESOR, MATERIA) Y PERMISOS DE AUTOR
    // -------------------------------------------------------------------------
    console.log('\n📌 3. Unicidad (usuario, profesor, materia) y Permisos de Edición/Borrado');

    const revBotta1 = await api('POST', '/api/reviews', tokenA, {
      professorId: profBotta1.id,
      subjectId: subjects[0].id,
      overall: 5,
      clarity: 5,
      treatment: 5,
      wouldRecommend: true,
      comment: 'Explica súper claro los temas prácticos.',
      academicYear: 2025,
      term: '1C',
    });
    assert(revBotta1.status === 201, 'Primera reseña para (studentA, Botta, Materia 1) se crea con éxito');

    const revBottaDup = await api('POST', '/api/reviews', tokenA, {
      professorId: profBotta1.id,
      subjectId: subjects[0].id,
      overall: 3,
    });
    assert(
      revBottaDup.status === 409 && revBottaDup.data?.code === 'DUPLICATE_REVIEW',
      'Impide segunda reseña para el mismo (usuario, profesor, materia) con 409 Conflict'
    );

    const revIdBotta1 = revBotta1.data.data.id;
    const editByOther = await api('PUT', `/api/reviews/${revIdBotta1}`, tokenB, {
      overall: 1,
      comment: 'Intento editar reseña ajena',
    });
    assert(editByOther.status === 403, 'Otro usuario no puede editar una reseña ajena (403)');

    const delByOther = await api('DELETE', `/api/reviews/${revIdBotta1}`, tokenB);
    assert(delByOther.status === 403, 'Otro usuario no puede borrar una reseña ajena (403)');

    // -------------------------------------------------------------------------
    // 4. FUSIÓN DE PROFESORES ("Botta, Oscar Ernesto" + "Oscar, Botta")
    // -------------------------------------------------------------------------
    console.log('\n📌 4. Fusión y Renombrado de Profesores');

    // studentB reseña a "Oscar, Botta" (profBotta2) en Materia 2
    const revBotta2 = await api('POST', '/api/reviews', tokenB, {
      professorId: profBotta2.id,
      subjectId: subjects[1].id,
      overall: 4,
      wouldRecommend: true,
      comment: 'Muy ordenado en las clases de la comisión.',
    });
    assert(revBotta2.status === 201, 'studentB reseña a "Oscar, Botta" antes de la fusión');

    const mergeRes = await api(
      'POST',
      '/api/admin/professors/merge',
      tokenAdmin,
      {
        sourceProfessorId: profBotta2.id,
        targetProfessorId: profBotta1.id,
      },
      true,
      adminReauthCookie
    );
    assert(
      mergeRes.status === 200 &&
        mergeRes.data?.data?.movedCommissions === 1 &&
        mergeRes.data?.data?.movedReviews === 1,
      'Fusión mueve comisiones y reseñas de "Oscar, Botta" hacia "Botta, Oscar Ernesto"'
    );

    const bottaDetail = await api('GET', `/api/professors/${profBotta1.id}`, tokenA);
    assert(
      bottaDetail.status === 200 &&
        bottaDetail.data?.data?.professor?.reviewCount === 2 &&
        bottaDetail.data?.data?.professor?.subjects?.length === 2,
      'Tras fusionar, "Botta, Oscar Ernesto" consolida las 2 materias y las 2 reseñas'
    );

    // Verificar que buscar por el alias fusionado "Oscar, Botta" en /ratings resuelve al docente unificado
    const batchAlias = await api(
      'GET',
      `/api/professors/ratings?names=${encodeURIComponent('Oscar, Botta')}`,
      tokenA
    );
    assert(
      batchAlias.status === 200 &&
        batchAlias.data?.data?.byId?.[profBotta1.id]?.reviewCount === 2,
      'Consulta por nombre antiguo "Oscar, Botta" resuelve mediante alias al profesor unificado'
    );

    const renameRes = await api(
      'PATCH',
      `/api/admin/professors/${profBotta1.id}`,
      tokenAdmin,
      { displayName: 'Botta, Oscar Ernesto' }
    );
    assert(renameRes.status === 200, 'Admin puede renombrar display_name de un profesor');

    // -------------------------------------------------------------------------
    // 5. ANONIMATO ESTRICTO Y UMBRAL DE 5 RESEÑAS PARA PERÍODO DE CURSADA
    // -------------------------------------------------------------------------
    console.log('\n📌 5. Anonimato Estricto (Sin autor, Solo Mes/Año, Período Oculto si < 5 Reseñas)');

    // Botta tiene 2 reseñas (< 5): no debe exponer academicYear ni term ni userId/email
    const bottaReviewsUnder5 = await api('GET', `/api/professors/${profBotta1.id}/reviews`, tokenB);
    const rawJsonUnder5 = bottaReviewsUnder5.rawText;
    const itemsUnder5 = bottaReviewsUnder5.data?.data?.items || [];

    assert(
      !rawJsonUnder5.includes(studentA.id) &&
        !rawJsonUnder5.includes(studentA.email) &&
        !rawJsonUnder5.includes(studentB.id) &&
        !rawJsonUnder5.includes(studentB.email) &&
        !rawJsonUnder5.includes('"userId"') &&
        !rawJsonUnder5.includes('"createdAt"'),
      'La API pública JAMÁS expone userId, email ni timestamps exactos createdAt/updatedAt'
    );

    assert(
      itemsUnder5.length === 2 &&
        itemsUnder5.every(
          (it: any) =>
            /^\d{4}-\d{2}$/.test(it.publishedMonthYear) &&
            it.academicYear === null &&
            it.term === null &&
            it.attendedPeriod === null
        ),
      'Con menos de 5 reseñas, muestra solo mes/año de publicación y oculta el período de cursada (null)'
    );

    // -------------------------------------------------------------------------
    // 6. FILTRO DE CONTENIDO (HTML, DATOS PERSONALES, INSULTOS)
    // -------------------------------------------------------------------------
    console.log('\n📌 6. Filtro de Contenido y Sanitizado');

    const badEmail = await api('POST', '/api/reviews', tokenA, {
      professorId: profVeteran.id,
      subjectId: subjects[0].id,
      overall: 4,
      comment: 'Escríbanle a profe.particular@gmail.com para consultas',
    });
    assert(
      badEmail.status === 400 && badEmail.data?.code === 'PERSONAL_DATA_EMAIL',
      'Bloquea comentarios con emails (datos personales)'
    );

    const badPhone = await api('POST', '/api/reviews', tokenA, {
      professorId: profVeteran.id,
      subjectId: subjects[0].id,
      overall: 4,
      comment: 'Su celular personal es +54 9 351 456-7890',
    });
    assert(
      badPhone.status === 400 && badPhone.data?.code === 'PERSONAL_DATA_PHONE',
      'Bloquea comentarios con números de teléfono'
    );

    const badLink = await api('POST', '/api/reviews', tokenA, {
      professorId: profVeteran.id,
      subjectId: subjects[0].id,
      overall: 4,
      comment: 'Miren https://sitio-externo.com/fotos',
    });
    assert(
      badLink.status === 400 && badLink.data?.code === 'PERSONAL_DATA_LINK',
      'Bloquea comentarios con enlaces externos'
    );

    const badInsult = await api('POST', '/api/reviews', tokenA, {
      professorId: profVeteran.id,
      subjectId: subjects[0].id,
      overall: 1,
      comment: 'Es un pelotudo que no explica nada',
    });
    assert(
      badInsult.status === 400 && badInsult.data?.code === 'OFFENSIVE_LANGUAGE',
      'Bloquea comentarios con insultos evidentes explicando el motivo'
    );

    const htmlSanitized = await api('POST', '/api/reviews', tokenA, {
      professorId: profVeteran.id,
      subjectId: subjects[0].id,
      overall: 5,
      comment: '<script>alert("xss")</script><b>Muy buena</b> explicación de computadoras.',
    });
    assert(
      htmlSanitized.status === 201 &&
        !htmlSanitized.data.data.comment.includes('<script>') &&
        !htmlSanitized.data.data.comment.includes('<b>') &&
        htmlSanitized.data.data.comment.includes('computadoras'),
      'Sanitiza etiquetas HTML sin falsos positivos en palabras académicas ("computadoras")'
    );

    // -------------------------------------------------------------------------
    // 7. TOPE DIARIO DE 10 RESEÑAS NUEVAS POR USUARIO
    // -------------------------------------------------------------------------
    console.log('\n📌 7. Tope Diario de 10 Reseñas por Usuario');

    const prolificUser = {
      id: crypto.randomUUID(),
      email: 'prolifico@frc.utn.edu.ar',
      role: 'user' as const,
    };
    const tokenProlific = makeToken(prolificUser);
    for (const s of subjects) {
      store.seedUserProgress(prolificUser.id, s.id, 'aprobada', 9);
    }

    let createdCount = 0;
    for (let i = 0; i < 10; i++) {
      const r = await api('POST', '/api/reviews', tokenProlific, {
        professorId: profVeteran.id,
        subjectId: subjects[i].id,
        overall: 5,
        academicYear: 2025,
        term: '1C',
      });
      if (r.status === 201) createdCount++;
    }
    assert(createdCount === 10, 'Permite publicar hasta 10 reseñas nuevas en el día');

    const eleventh = await api('POST', '/api/reviews', tokenProlific, {
      professorId: profVeteran.id,
      subjectId: subjects[10].id,
      overall: 5,
    });
    assert(
      eleventh.status === 429 && eleventh.data?.code === 'DAILY_REVIEW_LIMIT_REACHED',
      'Bloquea la reseña N° 11 del mismo usuario en 24h con 429 Too Many Requests'
    );

    // Ahora profVeteran tiene 11 reseñas (>= 5): verificar que el período de cursada SÍ se muestra
    const veteranReviewsOver5 = await api(
      'GET',
      `/api/professors/${profVeteran.id}/reviews`,
      tokenA
    );
    const hasPeriodVisible = veteranReviewsOver5.data?.data?.items?.some(
      (it: any) => it.academicYear === 2025 && it.term === '1C' && it.attendedPeriod === '2025 · 1C'
    );
    assert(
      hasPeriodVisible,
      'Con >= 5 reseñas publicadas, el período de cursada sí puede mostrarse sin riesgo de desanonimizar'
    );

    // -------------------------------------------------------------------------
    // 8. MODERACIÓN: OCULTAMIENTO AUTOMÁTICO CON 3 REPORTES + PANEL ADMIN
    // -------------------------------------------------------------------------
    console.log('\n📌 8. Moderación, Auto-Ocultamiento con 3 Reportes y Acciones de Admin');

    // Reportar la reseña revIdBotta1 con 3 usuarios distintos
    const rep1 = await api('POST', `/api/reviews/${revIdBotta1}/report`, tokenA, {
      reason: 'otra',
      note: 'Primer reporte',
    });
    assert(rep1.status === 201 && rep1.data.data.autoHidden === false, '1° reporte registrado (sigue publicada)');

    const rep1Dup = await api('POST', `/api/reviews/${revIdBotta1}/report`, tokenA, {
      reason: 'otra',
    });
    assert(rep1Dup.status === 409, 'Un mismo usuario no puede reportar dos veces la misma reseña (409)');

    const rep2 = await api('POST', `/api/reviews/${revIdBotta1}/report`, tokenB, {
      reason: 'falsa o spam',
    });
    assert(rep2.status === 201 && rep2.data.data.autoHidden === false, '2° reporte registrado (sigue publicada)');

    const rep3 = await api('POST', `/api/reviews/${revIdBotta1}/report`, tokenC, {
      reason: 'ofensiva',
      note: 'Tercer reporte que alcanza el umbral',
    });
    assert(
      rep3.status === 201 && rep3.data.data.autoHidden === true,
      'Al recibir 3 reportes abiertos, la reseña pasa automáticamente a status "hidden"'
    );

    const bottaAfterAutoHide = await api('GET', `/api/professors/${profBotta1.id}`, tokenA);
    assert(
      bottaAfterAutoHide.data.data.professor.reviewCount === 1,
      'La reseña auto-ocultada deja de mostrarse y se descuentan los agregados del profesor'
    );

    // Cola de moderación de Admin (tampoco debe exponer email/userId del autor)
    const modQueue = await api('GET', '/api/admin/reviews/reports', tokenAdmin);
    assert(
      modQueue.status === 200 &&
        modQueue.data.data.openReports.length === 3 &&
        modQueue.data.data.hiddenReviews.some((h: any) => h.id === revIdBotta1) &&
        !modQueue.rawText.includes(studentA.email),
      'Admin consulta reportes abiertos y reseñas ocultas sin exponer identidad del autor'
    );

    // Admin restaura la reseña ("Restaurar")
    const restoreRes = await api(
      'PATCH',
      `/api/admin/reviews/${revIdBotta1}/status`,
      tokenAdmin,
      { status: 'published' }
    );
    const bottaAfterRestore = await api('GET', `/api/professors/${profBotta1.id}`, tokenA);
    assert(
      restoreRes.status === 200 && bottaAfterRestore.data.data.professor.reviewCount === 2,
      'Admin puede Restaurar la reseña y sus estadísticas se recalculan inmediatamente'
    );

    // Nuevo reporte abierto y prueba de "Descartar reporte" + "Ocultar"
    const targetRev2Id = revBotta2.data.data.id;
    const repOnRev2 = await api('POST', `/api/reviews/${targetRev2Id}/report`, tokenC, {
      reason: 'otra',
    });
    const reportToDismissId = repOnRev2.data.data.reportId;
    const dismissRes = await api(
      'PATCH',
      `/api/admin/reviews/reports/${reportToDismissId}`,
      tokenAdmin,
      { status: 'dismissed' }
    );
    assert(dismissRes.status === 200, 'Admin puede Descartar un reporte abierto');

    const manualHideRes = await api(
      'PATCH',
      `/api/admin/reviews/${revIdBotta1}/status`,
      tokenAdmin,
      { status: 'hidden' }
    );
    assert(manualHideRes.status === 200, 'Admin puede Ocultar manualmente una reseña');

    // -------------------------------------------------------------------------
    // 9. UMBRAL DE 3 RESEÑAS Y RANKING CON PROMEDIO BAYESIANO
    // -------------------------------------------------------------------------
    console.log('\n📌 9. Umbral de 3 Reseñas ("Pocas reseñas") y Promedio Bayesiano');

    // profOneFiveStar recibe 1 sola reseña de 5 estrellas
    store.seedUserProgress(studentB.id, subjects[0].id, 'aprobada', 9);
    const oneStar5Res = await api('POST', '/api/reviews', tokenB, {
      professorId: profOneFiveStar.id,
      subjectId: subjects[0].id,
      overall: 5,
      comment: 'Única reseña de 5 estrellas.',
    });
    assert(oneStar5Res.status === 201, 'Profesor recibe una única reseña de 5.0 estrellas');

    // profVeteran ya tiene 11 reseñas de 5.0; completemos hasta 40 reseñas con promedio ~4.8 (32 de 5 y 8 de 4 = 192/40 = 4.80)
    const currentVetReviews = Array.from(store.reviewsMap.values()).filter(
      (r) => r.professorId === profVeteran.id && r.status === 'published'
    ).length;

    const neededFor40 = 40 - currentVetReviews;
    for (let i = 0; i < neededFor40; i++) {
      const uId = crypto.randomUUID();
      const tkn = makeToken({
        id: uId,
        email: `extra_${i}@frc.utn.edu.ar`,
        role: 'user',
      });
      store.seedUserProgress(uId, subjects[0].id, 'aprobada', 8);
      const stars = i < 8 ? 4 : 5; // 8 reseñas de 4★ y el resto de 5★ -> 32*5 + 8*4 = 192 / 40 = 4.80 exacto
      await api('POST', '/api/reviews', tkn, {
        professorId: profVeteran.id,
        subjectId: subjects[0].id,
        overall: stars,
      });
    }

    const rankingRes = await api('GET', '/api/professors?sort=rating', tokenA);
    const rankedList = rankingRes.data?.data?.professors || [];

    const itemOneFive = rankedList.find((p: any) => p.id === profOneFiveStar.id);
    const itemVeteran48 = rankedList.find((p: any) => p.id === profVeteran.id);
    const itemZero = rankedList.find((p: any) => p.id === profUnrelated.id);

    assert(
      itemZero?.ratingStatus === 'sin_resenas' &&
        itemZero?.hasReliableAverage === false &&
        itemZero?.averageOverall === null,
      'Con 0 reseñas: estado "sin_resenas" y averageOverall = null'
    );

    assert(
      itemOneFive?.reviewCount === 1 &&
        itemOneFive?.ratingStatus === 'pocas_resenas' &&
        itemOneFive?.hasReliableAverage === false &&
        itemOneFive?.averageOverall === 5,
      'Con < 3 reseñas (1 reseña): estado "pocas_resenas" y promedio provisorio = 5'
    );

    assert(
      itemVeteran48?.reviewCount === 40 &&
        itemVeteran48?.ratingStatus === 'confiable' &&
        itemVeteran48?.hasReliableAverage === true &&
        itemVeteran48?.averageOverall === 4.8,
      'Con >= 3 reseñas (40 reseñas): estado "confiable" y muestra promedio firme 4.8'
    );

    const idxVeteran = rankedList.findIndex((p: any) => p.id === profVeteran.id);
    const idxOneFive = rankedList.findIndex((p: any) => p.id === profOneFiveStar.id);
    assert(
      idxVeteran !== -1 && idxOneFive !== -1 && idxVeteran < idxOneFive,
      `Ranking Bayesiano: 40 reseñas de 4.8 (score ${itemVeteran48?.bayesianScore}) supera a 1 reseña de 5.0 (score ${itemOneFive?.bayesianScore})`
    );

    // =========================================================================
    // 10. SCRIPT CLI merge-professors Y ARCHIVO merges.json
    // =========================================================================
    console.log('\n📌 10. Script CLI merge-professors y Validación de merges.json');

    const fs = await import('fs');
    const {
      validateMergeConfig,
      resolveInputFilePath,
      loadOfflineProfessorSnapshots,
      resolveSnapshotByQuery,
    } = await import('../src/scripts/mergeProfessors.js');

    const mergesJsonPath = resolveInputFilePath('merges.json');
    const mergesConfig = validateMergeConfig(
      JSON.parse(fs.readFileSync(mergesJsonPath, 'utf8'))
    );

    assert(
      mergesConfig.merges.length === 13 && mergesConfig.renames.length === 0,
      'merges.json contiene los 13 pares de fusión solicitados y 0 renombres activos'
    );

    const mentionsArrua = mergesConfig.merges.some(
      (p) =>
        p.keep.toLowerCase().includes('arrua') ||
        p.keep.toLowerCase().includes('arrúa') ||
        p.remove.toLowerCase().includes('arrua') ||
        p.remove.toLowerCase().includes('arrúa')
    );
    assert(!mentionsArrua, 'merges.json deja afuera a "Arrua, Karina" y "Arrúa, Ruth Carina"');

    const { snapshots } = loadOfflineProfessorSnapshots();
    const allPairsResolved = mergesConfig.merges.every((pair) => {
      const k = resolveSnapshotByQuery(snapshots, pair.keep);
      const r = resolveSnapshotByQuery(snapshots, pair.remove);
      return Boolean(k.match && r.match && k.match.id !== r.match.id);
    });
    assert(
      allPairsResolved,
      'Los 13 pares { keep, remove } de merges.json resuelven sin ambigüedad en el catálogo'
    );

    const zanattaRes = resolveSnapshotByQuery(snapshots, 'Zanatta, Valentin; Santiago');
    const dagostinoRes = resolveSnapshotByQuery(snapshots, 'D´Agostino, José Luis');
    assert(
      zanattaRes.match?.subjects.some((s) => s.subjectCode === 24) === true &&
        zanattaRes.match?.commissions.some((c) => c.commissionCode === '4K2') === true,
      'Inspección de "Zanatta, Valentin; Santiago" localiza Legislación (24) comisión 4K2'
    );
    assert(
      dagostinoRes.match?.subjects.some((s) => s.subjectCode === 36) === true &&
        dagostinoRes.match?.commissions.some((c) => c.commissionCode === '5K4') === true,
      'Inspección de "D´Agostino, José Luis" localiza Proyecto Final (36) comisión 5K4'
    );

    let rejectedSelfMerge = false;
    try {
      validateMergeConfig({
        merges: [{ keep: 'Botta, Oscar Ernesto', remove: 'Botta, Oscar Ernesto' }],
        renames: [],
      });
    } catch {
      rejectedSelfMerge = true;
    }
    assert(rejectedSelfMerge, 'validateMergeConfig rechaza par inválido con keep === remove');

    // =========================================================================
    // 11. REGISTRO DE CURSADAS (ENROLLMENTS), RECOMENDACIONES Y ATTENDED_DECLARED
    // =========================================================================
    console.log('\n📌 11. Registro de Cursadas (Enrollments), Recomendaciones y Attended Declared');

    // Sembrar una comisión para la Materia 1 con el profesor Botta
    const seededComm1 = store.seedCommission({
      subjectId: subjects[0].id,
      code: '1K1',
      turno: 'mañana',
      academicYear: 2026,
      term: '1C',
      isCurrent: true,
      professorIds: [profBotta1.id],
    });

    // Sembrar una comisión para la Materia 2
    const seededComm2 = store.seedCommission({
      subjectId: subjects[1].id,
      code: '1K2',
      turno: 'tarde',
      academicYear: 2026,
      term: '1C',
      isCurrent: true,
      professorIds: [profBotta2.id],
    });

    // 11.1 Opciones de inscripción para la materia
    const resOpts = await api('GET', `/api/enrollments/options/${subjects[0].id}`, tokenA);
    assert(resOpts.status === 200, 'GET /api/enrollments/options/:id devuelve 200');
    const optsData = resOpts.data?.data || resOpts.data;
    assert(
      optsData.commissions.some((c: any) => c.id === seededComm1.id),
      'Las opciones de comisiones incluyen la comisión sembrada 1K1'
    );
    assert(
      optsData.professors.some((p: any) => p.professorId === profBotta1.id),
      'Las opciones de docentes de la materia incluyen al profesor Botta'
    );

    // 11.2 Validaciones 400: comisión ajena y docente que no dicta la materia
    const resBadComm = await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenA,
      {
        commissionId: seededComm2.id, // Pertenece a Materia 2, no a Materia 1
      }
    );
    assert(
      resBadComm.status === 400,
      'Rechaza con 400 registrar una comisión que pertenece a otra materia'
    );

    const resBadProf = await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenA,
      {
        academicYear: 2026,
        term: '1C',
        professorIds: [profUnrelated.id], // profUnrelated solo dicta Materia 12
      }
    );
    assert(
      resBadProf.status === 400,
      'Rechaza con 400 registrar un docente que no pertenece a la materia'
    );

    // 11.3 Cursada con comisión: autocompleta docentes automáticamente
    const resEnrComm = await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenA,
      {
        commissionId: seededComm1.id,
      }
    );
    assert(resEnrComm.status === 200, 'PUT /api/enrollments/:subjectId crea la cursada exitosamente (200)');
    const enrA1 = resEnrComm.data?.data || resEnrComm.data;
    assert(
      enrA1.commissionId === seededComm1.id &&
        enrA1.professors.length === 1 &&
        enrA1.professors[0].professorId === profBotta1.id,
      'La cursada con comisión autocompleta al docente asociado a dicha comisión'
    );

    // 11.4 Cursada manual de un período no cargado
    const resEnrManual = await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenA,
      {
        academicYear: 2023,
        term: '2C',
        professorIds: [profBotta1.id],
      }
    );
    assert(resEnrManual.status === 200, 'Crea cursada manual de un ciclo anterior no cargado');
    const enrA2 = resEnrManual.data?.data || resEnrManual.data;
    assert(
      enrA2.academicYear === 2023 && enrA2.term === '2C' && enrA2.source === 'manual',
      'La cursada manual conserva el año 2023 y cuatrimestre 2C indicados'
    );

    // 11.5 Recursadas permitidas y rechazo de duplicado exacto (409)
    const resListA = await api('GET', '/api/enrollments', tokenA);
    const listAData = resListA.data?.data || resListA.data;
    assert(
      listAData.enrollments.filter((e: any) => e.subjectId === subjects[0].id).length === 2,
      'Se permiten múltiples cursadas por materia (recursadas en distintos períodos)'
    );

    const resDup = await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenA,
      {
        academicYear: 2023,
        term: '2C',
        professorIds: [profBotta1.id],
      }
    );
    assert(
      resDup.status === 409,
      'Rechaza con 409 registrar dos veces el mismo período para un usuario en la misma materia'
    );

    // 11.6 Aislamiento estricto entre usuarios
    const resBUpdate = await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenB,
      {
        enrollmentId: enrA1.id,
        academicYear: 2025,
      }
    );
    assert(resBUpdate.status === 404, 'Usuario B no puede modificar cursadas de Usuario A (404)');

    const resBDelete = await api('DELETE', `/api/enrollments/${enrA1.id}`, tokenB);
    assert(resBDelete.status === 404, 'Usuario B no puede eliminar cursadas de Usuario A (404)');

    const resListB = await api('GET', '/api/enrollments', tokenB);
    const listBData = resListB.data?.data || resListB.data;
    assert(
      !listBData.enrollments.some((e: any) => e.id === enrA1.id),
      'El listado de Usuario B no incluye cursadas de Usuario A'
    );

    // 11.7 Recomendaciones activas, descarte (dismiss) y marca de visto
    const resRecsInitial = await api('GET', '/api/me/reviewable', tokenA);
    const initialEligible = resRecsInitial.data?.data?.eligible || resRecsInitial.data?.eligible || [];
    const recBotta = initialEligible.find(
      (e: any) => e.professorId === profBotta1.id && e.subjectId === subjects[0].id
    );
    assert(
      recBotta && recBotta.recommended === true && recBotta.dismissed === false,
      'El docente con cursada registrada aparece como recomendado para reseñar'
    );

    const resDismiss = await api(
      'POST',
      '/api/me/reviewable/dismiss',
      tokenA,
      { professorId: profBotta1.id, subjectId: subjects[0].id }
    );
    assert(resDismiss.status === 200, 'POST /api/me/reviewable/dismiss responde 200');

    const resRecsAfterDismiss = await api('GET', '/api/me/reviewable', tokenA);
    const afterDismissEligible =
      resRecsAfterDismiss.data?.data?.eligible || resRecsAfterDismiss.data?.eligible || [];
    const recBottaDismissed = afterDismissEligible.find(
      (e: any) => e.professorId === profBotta1.id && e.subjectId === subjects[0].id
    );
    assert(
      recBottaDismissed && recBottaDismissed.dismissed === true,
      'Tras descartar con "Ahora no", la recomendación figura como dismissed = true'
    );

    const resSeen = await api('POST', '/api/me/reviewable/seen', tokenA, {});
    assert(resSeen.status === 200, 'POST /api/me/reviewable/seen responde 200');

    // 11.8 attended_declared recalculado dinámicamente y anonimato público
    // Student C aprueba Materia 1 y registra cursada con profBotta1
    store.seedUserProgress(studentC.id, subjects[0].id, 'aprobada', 10);
    const resEnrC = await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenC,
      {
        commissionId: seededComm1.id,
      }
    );
    assert(resEnrC.status === 200, 'Usuario C registra cursada exitosamente (200)');
    const enrC1 = resEnrC.data?.data || resEnrC.data;

    const resCreateReview = await api(
      'POST',
      '/api/reviews',
      tokenC,
      {
        professorId: profBotta1.id,
        subjectId: subjects[0].id,
        overall: 5,
        comment: 'Docente excelente y muy claro con las explicaciones.',
      }
    );
    assert(resCreateReview.status === 201, 'Usuario C publica reseña exitosamente (201)');
    const createdRevId = (resCreateReview.data?.data || resCreateReview.data?.review || resCreateReview.data).id;

    // Usuario B consulta la ficha pública de profBotta1
    const resPublicProf = await api('GET', `/api/professors/${profBotta1.id}`, tokenB);
    const publicReviews = resPublicProf.data?.data?.reviewsPage?.items || [];
    const publicReview = publicReviews.find((r: any) => r.id === createdRevId);
    assert(publicReview, 'La reseña es visible públicamente en el perfil del docente');
    assert(
      publicReview.attendedDeclared === true,
      'attendedDeclared es true porque el usuario tiene cursada registrada con este docente'
    );
    assert(
      !publicReview.userId && !publicReview.email && !publicReview.userEmail && !publicReview.author,
      'La API pública NUNCA expone id, email ni datos identificatorios del autor'
    );
    assert(
      typeof publicReview.publishedMonthYear === 'string' &&
        /^\d{4}-\d{2}$/.test(publicReview.publishedMonthYear),
      `La fecha pública solo expone mes y año ("${publicReview.publishedMonthYear}"), sin hora ni segundos`
    );

    // Usuario C elimina su cursada en la Materia 1
    await api('DELETE', `/api/enrollments/${enrC1.id}`, tokenC);

    // Usuario B vuelve a consultar la ficha pública
    const resPublicProfAfterDel = await api('GET', `/api/professors/${profBotta1.id}`, tokenB);
    const revAfterDel = (
      resPublicProfAfterDel.data?.data?.reviewsPage?.items || []
    ).find((r: any) => r.id === createdRevId);
    assert(
      revAfterDel && revAfterDel.attendedDeclared === false,
      'Al borrar la cursada, attendedDeclared se recalcula dinámicamente a false'
    );

    // Usuario C vuelve a registrar la cursada con profBotta1
    await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenC,
      {
        commissionId: seededComm1.id,
      }
    );

    const resPublicProfRecreated = await api('GET', `/api/professors/${profBotta1.id}`, tokenB);
    const revRecreated = (
      resPublicProfRecreated.data?.data?.reviewsPage?.items || []
    ).find((r: any) => r.id === createdRevId);
    assert(
      revRecreated && revRecreated.attendedDeclared === true,
      'Al volver a crear la cursada, attendedDeclared se recalcula dinámicamente a true'
    );

    // 11.9 mergeProfessors: reasignación de enrollments y recálculo de attended_declared
    const profMergeSource = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Botta, Oscar E.',
    });
    const seededCommMerge = store.seedCommission({
      subjectId: subjects[0].id,
      code: '1K9',
      turno: 'noche',
      academicYear: 2022,
      term: '1C',
      isCurrent: false,
      professorIds: [profMergeSource.id],
    });
    await api(
      'PUT',
      `/api/enrollments/${subjects[0].id}`,
      tokenC,
      {
        commissionId: seededCommMerge.id,
        academicYear: 2022,
        term: '1C',
      }
    );

    const targetMerged = await store.mergeProfessors(profMergeSource.id, profBotta1.id);
    assert(
      targetMerged.targetProfessor.id === profBotta1.id,
      'mergeProfessors fusiona exitosamente profMergeSource en profBotta1'
    );
    const resPublicTarget = await api('GET', `/api/professors/${profBotta1.id}`, tokenB);
    const revTarget = (
      resPublicTarget.data?.data?.reviewsPage?.items || []
    ).find((r: any) => r.id === createdRevId);
    assert(
      revTarget && revTarget.attendedDeclared === true,
      'Tras mergeProfessors, attendedDeclared se mantiene correctamente recalculado'
    );

    // 11.10 Filtro subjectId de GET /api/professors con código numérico vs UUID vs code E-/X-
    const elective301 = store.seedSubject({
      codeInPlan: 301,
      name: 'Backend de Aplicaciones',
      shortName: 'Backend de Aplicaciones',
      level: 3,
      kind: 'electiva',
    });
    const profElective = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Elective, Docente Prueba',
    });
    store.seedCommissionTeaching({
      professorId: profElective.id,
      subjectId: elective301.id,
      termLabel: '2026 2C',
      isCurrent: true,
    });

    const filterByNumCore = await api('GET', `/api/professors?subjectId=${subjects[0].codeInPlan}`, tokenA);
    const filterByNumElective = await api('GET', '/api/professors?subjectId=301', tokenA);
    const filterByUuidElective = await api('GET', `/api/professors?subjectId=${elective301.id}`, tokenA);
    const filterByFormattedCode = await api('GET', '/api/professors?subjectId=E-301', tokenA);

    assert(
      filterByNumCore.status === 200 &&
        (filterByNumCore.data?.data?.professors || []).some((p: any) => p.id === profBotta1.id),
      'GET /api/professors?subjectId=1 (codeInPlan numérico) devuelve docentes de Materia 1'
    );
    assert(
      filterByNumElective.status === 200 &&
        (filterByNumElective.data?.data?.professors || []).some((p: any) => p.id === profElective.id) &&
        filterByUuidElective.status === 200 &&
        (filterByUuidElective.data?.data?.professors || []).some((p: any) => p.id === profElective.id) &&
        filterByFormattedCode.status === 200 &&
        (filterByFormattedCode.data?.data?.professors || []).length === 0,
      'GET /api/professors acepta id numérico (301) y UUID de electiva, pero rechaza "E-301"'
    );

    // 11.11 Usuario con selectedPlanId = null y exclusión de plan draft como fallback
    const nullPlanUser = {
      id: crypto.randomUUID(),
      email: 'sin.plan.reviews@frc.utn.edu.ar',
      role: 'user' as const,
      selectedPlanId: null as string | null,
    };
    testUsersMap.set(nullPlanUser.id, {
      ...nullPlanUser,
      status: 'active',
      emailVerified: true,
    });
    const nullPlanToken = makeToken(nullPlanUser);

    store.seedUserProgress(nullPlanUser.id, subjects[0].id, 'aprobada', 9);
    const nullProfs = await api('GET', '/api/professors', nullPlanToken);
    const nullEnroll = await api('GET', '/api/enrollments', nullPlanToken);
    const nullReviewable = await api('GET', '/api/me/reviewable', nullPlanToken);
    const nullCreateRev = await api('POST', '/api/reviews', nullPlanToken, {
      professorId: profBotta1.id,
      subjectId: subjects[0].id,
      academicYear: 2026,
      term: '1C',
      overall: 5,
      comment: 'Excelente cursada con usuario cuyo JWT tiene selectedPlanId null.',
    });
    assert(
      nullProfs.status === 200 &&
        nullEnroll.status === 200 &&
        nullReviewable.status === 200 &&
        nullCreateRev.status === 201,
      'Usuario con selectedPlanId = null opera /api/professors (200), /api/enrollments (200), /api/me/reviewable (200) y POST /api/reviews (201)',
      `statuses=${nullProfs.status}/${nullEnroll.status}/${nullReviewable.status}/${nullCreateRev.status}`
    );

    const isolatedDraftFirst = new InMemoryReviewsStore();
    const draftFacId = crypto.randomUUID();
    const draftPlanId = crypto.randomUUID();
    const pubPlanId = crypto.randomUUID();
    isolatedDraftFirst.seedPlan(draftPlanId, draftFacId, {
      status: 'draft',
      isActive: true,
    });
    isolatedDraftFirst.seedUserPlan(nullPlanUser.id, null);

    const onlyDraftResolved = await isolatedDraftFirst.resolvePlanContext(nullPlanUser.id, null);
    assert(
      onlyDraftResolved === null,
      'InMemoryReviewsStore.resolvePlanContext NO elige un plan draft (aunque isActive sea true)'
    );

    isolatedDraftFirst.seedPlan(pubPlanId, draftFacId, {
      status: 'published',
      isActive: true,
    });
    const fallbackPubResolved = await isolatedDraftFirst.resolvePlanContext(nullPlanUser.id, null);
    assert(
      fallbackPubResolved?.planId === pubPlanId &&
        fallbackPubResolved?.facultyId === draftFacId,
      'InMemoryReviewsStore.resolvePlanContext salta el plan draft y elige el plan published por defecto'
    );

    let defaultFinderCalls = 0;
    const drizzleStoreFallback = new DrizzleReviewsStore({
      getUserSelectedPlanId: async () => null,
      findDefaultPlan: async () => {
        defaultFinderCalls++;
        return {
          plan: { id: pubPlanId } as any,
          career: { facultyId: draftFacId } as any,
        };
      },
    });
    const drizzleResolved = await drizzleStoreFallback.resolvePlanContext(nullPlanUser.id, null);
    assert(
      defaultFinderCalls === 1 &&
        drizzleResolved?.planId === pubPlanId &&
        drizzleResolved?.facultyId === draftFacId,
      'DrizzleReviewsStore.resolvePlanContext delega en findDefaultPublishedPlan cuando selectedPlanId es null'
    );

    const drizzleNoPublished = new DrizzleReviewsStore({
      getUserSelectedPlanId: async () => null,
      findDefaultPlan: async () => null,
    });
    const drizzleNullResolved = await drizzleNoPublished.resolvePlanContext(nullPlanUser.id, null);
    assert(
      drizzleNullResolved === null,
      'DrizzleReviewsStore.resolvePlanContext devuelve null cuando findDefaultPublishedPlan no encuentra planes publicados'
    );

    // -------------------------------------------------------------------------
    // 12. TRAMO 2C PARTE C: MODERACIÓN MULTI-PLAN EN RESEÑAS (/reports, /all, /api/admin/reviews)
    // -------------------------------------------------------------------------
    console.log('\n📌 12. Moderación multi-plan con contexto carrera/plan y filtros');
    const cIsiId = crypto.randomUUID();
    const cIndId = crypto.randomUUID();
    const pIsiMultiId = crypto.randomUUID();
    const pIndMultiId = crypto.randomUUID();
    store.seedPlan(pIsiMultiId, store.defaultFacultyId, {
      careerId: cIsiId,
      careerCode: 'ISI',
      careerName: 'Ingeniería en Sistemas de Información',
      planName: 'Plan 2023',
      facultyName: 'UTN FRC',
      year: 2023,
      status: 'published',
      isActive: true,
      careerStatus: 'published',
    });
    store.seedPlan(pIndMultiId, store.defaultFacultyId, {
      careerId: cIndId,
      careerCode: 'IND',
      careerName: 'Ingeniería Industrial',
      planName: 'Plan 2023',
      facultyName: 'UTN FRC',
      year: 2023,
      status: 'draft',
      isActive: true,
      careerStatus: 'published',
    });
    const sIsiMulti = store.seedSubject({
      codeInPlan: 401,
      name: 'Inteligencia Artificial',
      planId: pIsiMultiId,
    });
    const sIndMulti = store.seedSubject({
      codeInPlan: 402,
      name: 'Estudio del Trabajo',
      planId: pIndMultiId,
    });
    const profMultiMod = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Multiplan, Moderacion Docente',
    });
    const modStudentId = crypto.randomUUID();
    const revIsiMulti = await store.createReview({
      userId: modStudentId,
      professorId: profMultiMod.id,
      subjectId: sIsiMulti.id,
      academicYear: 2026,
      term: '1C',
      overall: 4,
      clarity: 4,
      treatment: 4,
      availability: 4,
      difficulty: 3,
      wouldRecommend: true,
      comment: 'Reseña ISI multiplan para moderación.',
      attendedDeclared: true,
    });
    const revIndMulti = await store.createReview({
      userId: modStudentId,
      professorId: profMultiMod.id,
      subjectId: sIndMulti.id,
      academicYear: 2026,
      term: '1C',
      overall: 2,
      clarity: 2,
      treatment: 2,
      availability: 2,
      difficulty: 4,
      wouldRecommend: false,
      comment: 'Reseña IND multiplan oculta y reportada.',
      attendedDeclared: true,
    });
    await store.setReviewStatus(revIndMulti.id, 'hidden');
    await store.createReport({
      reviewId: revIndMulti.id,
      reporterUserId: studentB.id,
      reason: 'ofensiva',
      note: 'Reporte IND multiplan',
    });

    const queueInd = await api(
      'GET',
      `/api/admin/reviews/reports?careerId=${cIndId}&planId=${pIndMultiId}`,
      tokenAdmin
    );
    const allIndFromReviewsRoute = await api(
      'GET',
      `/api/admin/reviews/all?careerId=${cIndId}`,
      tokenAdmin
    );
    const allIndFromAdminController = await api(
      'GET',
      `/api/admin/reviews?planId=${pIndMultiId}`,
      tokenAdmin
    );
    const allIsiFromAdminController = await api(
      'GET',
      `/api/admin/reviews?careerId=${cIsiId}`,
      tokenAdmin
    );

    const openRepInd = (queueInd.data?.data?.openReports || [])[0];
    const hiddenInd = (queueInd.data?.data?.hiddenReviews || [])[0];
    const catalogInd1 = (allIndFromReviewsRoute.data?.data?.items || [])[0];
    const catalogInd2 = (allIndFromAdminController.data?.data?.items || [])[0];
    const catalogIsi = (allIsiFromAdminController.data?.data?.items || [])[0];

    assert(
      queueInd.status === 200 &&
        (queueInd.data?.data?.openReports || []).length === 1 &&
        openRepInd?.careerCode === 'IND' &&
        openRepInd?.review?.planName === 'Plan 2023' &&
        (queueInd.data?.data?.hiddenReviews || []).length === 1 &&
        hiddenInd?.careerCode === 'IND' &&
        allIndFromReviewsRoute.status === 200 &&
        (allIndFromReviewsRoute.data?.data?.items || []).length === 1 &&
        catalogInd1?.id === revIndMulti.id &&
        catalogInd1?.careerCode === 'IND' &&
        allIndFromAdminController.status === 200 &&
        (allIndFromAdminController.data?.data?.items || []).length === 1 &&
        catalogInd2?.id === revIndMulti.id &&
        catalogInd2?.planName === 'Plan 2023' &&
        catalogInd2?.facultyName === 'UTN FRC' &&
        allIsiFromAdminController.status === 200 &&
        (allIsiFromAdminController.data?.data?.items || []).length === 1 &&
        catalogIsi?.id === revIsiMulti.id &&
        catalogIsi?.careerCode === 'ISI',
      'Reviews admin (/reports, /all y /api/admin/reviews) exponen metadatos carrera/plan y filtran por careerId/planId'
    );

    // -------------------------------------------------------------------------
    // 13. TRAMO 2C PARTE D: DOCENTES DESDE ADMIN DESACOPLADOS DE selectedPlanId
    // -------------------------------------------------------------------------
    console.log('\n📌 13. Parte D: Crear/vincular docentes en planB con admin selectedPlanId=planA');
    const facOtherId = crypto.randomUUID();
    const pIndOtherFacId = crypto.randomUUID();
    store.seedPlan(pIndOtherFacId, facOtherId, {
      careerId: crypto.randomUUID(),
      careerCode: 'IND-B',
      careerName: 'Ingeniería Industrial Regional B',
      planName: 'Plan 2023 Regional B',
      facultyName: 'UTN FRBA',
      year: 2023,
      status: 'published',
      isActive: true,
      careerStatus: 'published',
    });
    const sIndOtherFac = store.seedSubject({
      codeInPlan: 501,
      name: 'Gestión de Calidad Regional B',
      planId: pIndOtherFacId,
    });
    const sIndSameCodeAsIsi = store.seedSubject({
      codeInPlan: subjects[0].codeInPlan,
      name: 'Química General IND',
      planId: pIndMultiId,
    });

    // Admin con selectedPlanId = pIsiMultiId (planA) crea docente directamente en pIndMultiId (planB)
    const tokenAdminPlanA = makeToken({
      ...adminUser,
      selectedPlanId: pIsiMultiId,
    });
    store.seedUserPlan(adminUser.id, pIsiMultiId);

    const createInPlanB = await api('POST', '/api/admin/professors', tokenAdminPlanA, {
      displayName: 'Gomez, Industrial Docente',
      planId: pIndMultiId,
      subjectId: sIndSameCodeAsIsi.id,
      note: 'Docente histórico de Industrial',
    });
    const createdProfBId = createInPlanB.data?.data?.professor?.id as string | undefined;
    const isLinkedToIndSub =
      createdProfBId &&
      store.historicalLinks.some(
        (l) => l.professorId === createdProfBId && l.subjectId === sIndSameCodeAsIsi.id
      );
    const isLinkedToIsiSub =
      createdProfBId &&
      store.historicalLinks.some(
        (l) => l.professorId === createdProfBId && l.subjectId === subjects[0].id
      );
    assert(
      createInPlanB.status === 201 &&
        createInPlanB.data?.data?.linkedSubject?.id === sIndSameCodeAsIsi.id &&
        Boolean(isLinkedToIndSub) &&
        !isLinkedToIsiSub,
      'POST /api/admin/professors con planId/subjectId de planB vincula en planB aunque el admin tenga selectedPlanId=planA'
    );

    // Vincular docente existente a materia de pIndMultiId por UUID sin usar selectedPlanId
    const linkCrossPlan = await api(
      'POST',
      `/api/admin/professors/${profBotta1.id}/subjects`,
      tokenAdminPlanA,
      {
        planId: pIndMultiId,
        subjectId: sIndMulti.id,
        note: 'Vínculo multiplan por UUID',
      }
    );
    const profListPlanB = await api('GET', `/api/admin/professors?planId=${pIndOtherFacId}`, tokenAdminPlanA);

    // Validaciones negativas: mismatch plan/materia (400), numeric sin planId (400), otra facultad (400)
    const createPlanMismatch = await api('POST', '/api/admin/professors', tokenAdminPlanA, {
      displayName: 'Mismatch, Docente',
      planId: pIsiMultiId,
      subjectId: sIndSameCodeAsIsi.id,
    });
    const linkPlanMismatch = await api(
      'POST',
      `/api/admin/professors/${profBotta1.id}/subjects`,
      tokenAdminPlanA,
      {
        planId: pIsiMultiId,
        subjectId: sIndMulti.id,
      }
    );
    const linkNumericNoPlan = await api(
      'POST',
      `/api/admin/professors/${profBotta1.id}/subjects`,
      tokenAdminPlanA,
      {
        subjectId: 1,
      }
    );
    const linkCrossFaculty = await api(
      'POST',
      `/api/admin/professors/${profBotta1.id}/subjects`,
      tokenAdminPlanA,
      {
        planId: pIndOtherFacId,
        subjectId: sIndOtherFac.id,
      }
    );

    assert(
      linkCrossPlan.status === 201 &&
        linkCrossPlan.data?.data?.subject?.id === sIndMulti.id &&
        profListPlanB.status === 200 &&
        !(profListPlanB.data?.data?.professors || []).some((p: any) => p.id === profBotta1.id) &&
        createPlanMismatch.status === 400 &&
        linkPlanMismatch.status === 400 &&
        linkNumericNoPlan.status === 400 &&
        linkCrossFaculty.status === 400,
      'POST /subjects vincula en planB, GET /professors?planId filtra por facultad y rechaza con 400 mismatch plan/materia, numérico sin planId o cruce de facultades',
      `statuses=${linkCrossPlan.status}/${profListPlanB.status}/${createPlanMismatch.status}/${linkPlanMismatch.status}/${linkNumericNoPlan.status}/${linkCrossFaculty.status}`
    );

    // -------------------------------------------------------------------------
    // 14. ACTUALIZACIÓN ATÓMICA DE ESTADO DE MATERIA AL GUARDAR CURSADA
    // -------------------------------------------------------------------------
    console.log('\n📌 14. Actualización automática y atómica del estado al guardar cursada');

    const enrollStudent = {
      id: crypto.randomUUID(),
      email: 'cursada.estado@frc.utn.edu.ar',
      role: 'user' as const,
    };
    testUsersMap.set(enrollStudent.id, {
      ...enrollStudent,
      status: 'active',
      emailVerified: true,
      selectedPlanId: store.defaultPlanId,
    });
    const tokenEnroll = makeToken(enrollStudent);

    const subPromo = store.seedSubject({
      codeInPlan: 701,
      name: 'Materia Promo Directa',
      shortName: 'MPD',
      level: 2,
    });
    const subReg = store.seedSubject({
      codeInPlan: 702,
      name: 'Materia Regular Directa',
      shortName: 'MRD',
      level: 2,
    });
    const subAprob = store.seedSubject({
      codeInPlan: 703,
      name: 'Materia Ya Aprobada',
      shortName: 'MYA',
      level: 2,
    });
    const subLibreCheck = store.seedSubject({
      codeInPlan: 704,
      name: 'Materia Cursando y Libre',
      shortName: 'MCL',
      level: 2,
    });
    const subEditCycle = store.seedSubject({
      codeInPlan: 705,
      name: 'Materia Edición y Borrado',
      shortName: 'MEB',
      level: 2,
    });
    const subRevGate = store.seedSubject({
      codeInPlan: 706,
      name: 'Materia Habilitación Reseña',
      shortName: 'MHR',
      level: 3,
    });
    const subRevPromo = store.seedSubject({
      codeInPlan: 707,
      name: 'Materia Habilitación Promo',
      shortName: 'MHP',
      level: 3,
    });

    const profEnrollGate = await store.createOrResolveProfessor({
      facultyId: store.defaultFacultyId,
      displayName: 'Docente Gate Reseñas, Lucía',
    });
    store.seedCommissionTeaching({
      professorId: profEnrollGate.id,
      subjectId: subRevGate.id,
      termLabel: '2026 1C',
      isCurrent: true,
    });
    store.seedCommissionTeaching({
      professorId: profEnrollGate.id,
      subjectId: subRevPromo.id,
      termLabel: '2026 1C',
      isCurrent: true,
    });

    // 14.1 Promoción sobre materia sin estado -> promocionada
    const resPromoNew = await api('PUT', `/api/enrollments/${subPromo.id}`, tokenEnroll, {
      academicYear: 2026,
      term: '1C',
      status: 'promocionada',
      professorIds: [],
    });
    const progPromoNew = (await store.getUserSubjectProgressMap(enrollStudent.id)).get(subPromo.id);
    assert(
      resPromoNew.status === 200 &&
        resPromoNew.data?.data?.subjectStatus === 'promocionada' &&
        progPromoNew?.status === 'promocionada',
      'Promoción sobre materia sin estado actualiza progreso a "promocionada" e incluye subjectStatus'
    );

    // 14.2 Regularización sobre materia sin estado -> regularizada
    const resRegNew = await api('PUT', `/api/enrollments/${subReg.id}`, tokenEnroll, {
      academicYear: 2026,
      term: '1C',
      status: 'regularizada',
      professorIds: [],
    });
    const progRegNew = (await store.getUserSubjectProgressMap(enrollStudent.id)).get(subReg.id);
    assert(
      resRegNew.status === 200 &&
        resRegNew.data?.data?.subjectStatus === 'regularizada' &&
        progRegNew?.status === 'regularizada',
      'Regularización sobre materia sin estado actualiza progreso a "regularizada" e incluye subjectStatus'
    );

    // 14.3 Materia ya aprobada (nota 9) + cursada regularizada -> sigue aprobada (nota intacta)
    store.seedUserProgress(enrollStudent.id, subAprob.id, 'aprobada', 9);
    const resAprobPlusReg = await api('PUT', `/api/enrollments/${subAprob.id}`, tokenEnroll, {
      academicYear: 2024,
      term: '1C',
      status: 'regularizada',
      professorIds: [],
    });
    const progAfterAprobReg = (await store.getUserSubjectProgressMap(enrollStudent.id)).get(subAprob.id);
    assert(
      resAprobPlusReg.status === 200 &&
        resAprobPlusReg.data?.data?.subjectStatus === 'aprobada' &&
        progAfterAprobReg?.status === 'aprobada' &&
        progAfterAprobReg?.grade === 9,
      'Materia ya aprobada + cursada regularizada NO baja de estado y conserva nota 9'
    );

    // 14.4 Materia ya aprobada (nota 9) + cursada promocionada -> pasa a promocionada (nota conservada)
    const resAprobPlusPromo = await api('PUT', `/api/enrollments/${subAprob.id}`, tokenEnroll, {
      academicYear: 2025,
      term: '1C',
      status: 'promocionada',
      professorIds: [],
    });
    const progAfterAprobPromo = (await store.getUserSubjectProgressMap(enrollStudent.id)).get(subAprob.id);
    assert(
      resAprobPlusPromo.status === 200 &&
        resAprobPlusPromo.data?.data?.subjectStatus === 'promocionada' &&
        progAfterAprobPromo?.status === 'promocionada' &&
        progAfterAprobPromo?.grade === 9,
      'Materia aprobada + cursada promocionada sube a "promocionada" conservando nota 9'
    );

    // 14.5 Cursada cursando o libre -> estado sin cambios
    const resCursandoOnly = await api('PUT', `/api/enrollments/${subLibreCheck.id}`, tokenEnroll, {
      academicYear: 2025,
      term: '1C',
      status: 'cursando',
      professorIds: [],
    });
    const resLibreOnly = await api('PUT', `/api/enrollments/${subLibreCheck.id}`, tokenEnroll, {
      academicYear: 2025,
      term: '2C',
      status: 'libre',
      professorIds: [],
    });
    const progLibreCheck = (await store.getUserSubjectProgressMap(enrollStudent.id)).get(subLibreCheck.id);
    assert(
      resCursandoOnly.status === 200 &&
        resCursandoOnly.data?.data?.subjectStatus === 'pendiente' &&
        resLibreOnly.status === 200 &&
        resLibreOnly.data?.data?.subjectStatus === 'pendiente' &&
        progLibreCheck === undefined,
      'Cursada cursando y cursada libre sobre materia sin estado devuelven subjectStatus="pendiente" sin modificar progreso'
    );

    // 14.6 Editar cursada existente de cursando a regularizada -> sube el estado
    const resCreateCursando = await api('PUT', `/api/enrollments/${subEditCycle.id}`, tokenEnroll, {
      academicYear: 2026,
      term: '1C',
      status: 'cursando',
      professorIds: [],
    });
    const editEnrollmentId = resCreateCursando.data?.data?.id as string;
    const resEditToReg = await api('PUT', `/api/enrollments/${subEditCycle.id}`, tokenEnroll, {
      enrollmentId: editEnrollmentId,
      academicYear: 2026,
      term: '1C',
      status: 'regularizada',
      professorIds: [],
    });
    const progAfterEditToReg = (await store.getUserSubjectProgressMap(enrollStudent.id)).get(subEditCycle.id);
    assert(
      resCreateCursando.status === 200 &&
        resCreateCursando.data?.data?.subjectStatus === 'pendiente' &&
        resEditToReg.status === 200 &&
        resEditToReg.data?.data?.subjectStatus === 'regularizada' &&
        progAfterEditToReg?.status === 'regularizada',
      'Editar cursada existente de cursando a regularizada sube el estado de la materia a regularizada'
    );

    // 14.7 Editar cursada hacia libre o borrar cursada -> estado NO se revierte
    const resEditToLibre = await api('PUT', `/api/enrollments/${subEditCycle.id}`, tokenEnroll, {
      enrollmentId: editEnrollmentId,
      academicYear: 2026,
      term: '1C',
      status: 'libre',
      professorIds: [],
    });
    const resDeleteEnrKeepState = await api('DELETE', `/api/enrollments/${editEnrollmentId}`, tokenEnroll);
    const progAfterDel = (await store.getUserSubjectProgressMap(enrollStudent.id)).get(subEditCycle.id);
    assert(
      resEditToLibre.status === 200 &&
        resEditToLibre.data?.data?.subjectStatus === 'regularizada' &&
        resDeleteEnrKeepState.status === 200 &&
        progAfterDel?.status === 'regularizada',
      'Editar cursada existente a libre o borrarla NO revierte el estado ya alcanzado'
    );

    // 14.8 Materia de otro plan -> 404 y no escribe ni cursada ni progreso
    const enrollmentsCountBeforeOther = Array.from(store.enrollmentsMap.values()).filter(
      (e) => e.userId === enrollStudent.id && e.subjectId === sIndMulti.id
    ).length;
    const resOtherPlan = await api('PUT', `/api/enrollments/${sIndMulti.id}`, tokenEnroll, {
      academicYear: 2026,
      term: '1C',
      status: 'promocionada',
      professorIds: [],
    });
    const enrollmentsCountAfterOther = Array.from(store.enrollmentsMap.values()).filter(
      (e) => e.userId === enrollStudent.id && e.subjectId === sIndMulti.id
    ).length;
    const progOtherPlan = (await store.getUserSubjectProgressMap(enrollStudent.id)).get(sIndMulti.id);
    assert(
      resOtherPlan.status === 404 &&
        enrollmentsCountBeforeOther === 0 &&
        enrollmentsCountAfterOther === 0 &&
        progOtherPlan === undefined,
      'Materia de otro plan devuelve 404 y no escribe ni cursada ni progreso'
    );

    // 14.9 Efecto en reseñas: cursada libre NO habilita; regularizada/promocionada SÍ habilitan
    const resGateLibre = await api('PUT', `/api/enrollments/${subRevGate.id}`, tokenEnroll, {
      academicYear: 2025,
      term: '1C',
      status: 'libre',
      professorIds: [],
    });
    const revbleAfterLibre = await api('GET', '/api/me/reviewable', tokenEnroll);
    const isEligibleAfterLibre = (revbleAfterLibre.data?.data?.eligible || []).some(
      (e: any) => e.subjectId === subRevGate.id && e.professorId === profEnrollGate.id
    );
    const postRevAfterLibre = await api('POST', '/api/reviews', tokenEnroll, {
      professorId: profEnrollGate.id,
      subjectId: subRevGate.id,
      overall: 4,
    });
    assert(
      resGateLibre.status === 200 &&
        resGateLibre.data?.data?.subjectStatus === 'pendiente' &&
        !isEligibleAfterLibre &&
        postRevAfterLibre.status === 403 &&
        postRevAfterLibre.data?.code === 'SUBJECT_NOT_COMPLETED',
      'Con cursada "libre" (sin docente), la materia NO aparece en /api/me/reviewable y POST /api/reviews rechaza con 403'
    );

    const resGateReg = await api('PUT', `/api/enrollments/${subRevGate.id}`, tokenEnroll, {
      enrollmentId: resGateLibre.data?.data?.id,
      academicYear: 2025,
      term: '1C',
      status: 'regularizada',
      professorIds: [],
    });
    const revbleAfterReg = await api('GET', '/api/me/reviewable', tokenEnroll);
    const isEligibleAfterReg = (revbleAfterReg.data?.data?.eligible || []).some(
      (e: any) => e.subjectId === subRevGate.id && e.professorId === profEnrollGate.id
    );
    const postRevAfterReg = await api('POST', '/api/reviews', tokenEnroll, {
      professorId: profEnrollGate.id,
      subjectId: subRevGate.id,
      overall: 5,
      comment: 'Habilitado por regularizar la cursada.',
    });

    const resGatePromo = await api('PUT', `/api/enrollments/${subRevPromo.id}`, tokenEnroll, {
      academicYear: 2026,
      term: '1C',
      status: 'promocionada',
      professorIds: [],
    });
    const revbleAfterPromo = await api('GET', '/api/me/reviewable', tokenEnroll);
    const isEligibleAfterPromo = (revbleAfterPromo.data?.data?.eligible || []).some(
      (e: any) => e.subjectId === subRevPromo.id && e.professorId === profEnrollGate.id
    );
    const postRevAfterPromo = await api('POST', '/api/reviews', tokenEnroll, {
      professorId: profEnrollGate.id,
      subjectId: subRevPromo.id,
      overall: 5,
      comment: 'Habilitado por promocionar la cursada.',
    });
    assert(
      resGateReg.status === 200 &&
        resGateReg.data?.data?.subjectStatus === 'regularizada' &&
        isEligibleAfterReg &&
        postRevAfterReg.status === 201 &&
        resGatePromo.status === 200 &&
        resGatePromo.data?.data?.subjectStatus === 'promocionada' &&
        isEligibleAfterPromo &&
        postRevAfterPromo.status === 201,
      'Tras regularizar o promocionar cursada, la materia aparece en /api/me/reviewable y POST /api/reviews acepta (201)'
    );

    // 14.10 Integración con ambos almacenes inyectados (GET /api/state refleja nuevo estado)
    const pairedReviewsStore = new InMemoryReviewsStore();
    const pairedUserStateStore = new InMemoryUserStateStore();
    const pairedPlanId = pairedReviewsStore.defaultPlanId;
    const pairedFacId = pairedReviewsStore.defaultFacultyId;
    pairedUserStateStore.seedPlan({
      id: pairedPlanId,
      name: 'Plan Integrado',
      facultyId: pairedFacId,
      totalLevels: 5,
      status: 'published',
      isActive: true,
      careerStatus: 'published',
    });
    const pSub1 = pairedReviewsStore.seedSubject({
      codeInPlan: 801,
      name: 'Integrada Promo',
      planId: pairedPlanId,
    });
    const pSub2 = pairedReviewsStore.seedSubject({
      codeInPlan: 802,
      name: 'Integrada Aprobada',
      planId: pairedPlanId,
    });
    pairedUserStateStore.seedSubject({
      id: pSub1.id,
      planId: pairedPlanId,
      codeInPlan: 801,
    });
    pairedUserStateStore.seedSubject({
      id: pSub2.id,
      planId: pairedPlanId,
      codeInPlan: 802,
    });

    const pairedUserId = crypto.randomUUID();
    pairedReviewsStore.seedUserPlan(pairedUserId, pairedPlanId);
    pairedUserStateStore.seedUser(pairedUserId, pairedPlanId);
    testUsersMap.set(pairedUserId, {
      id: pairedUserId,
      email: 'paired.stores@frc.utn.edu.ar',
      role: 'user',
      status: 'active',
      emailVerified: true,
      selectedPlanId: pairedPlanId,
    });
    const pairedToken = makeToken({
      id: pairedUserId,
      email: 'paired.stores@frc.utn.edu.ar',
      role: 'user',
      selectedPlanId: pairedPlanId,
    });
    await pairedUserStateStore.upsertSubjectProgress(pairedUserId, pSub2.id, 'aprobada', '8');

    const pairedApp = createApp({
      reviewsStore: pairedReviewsStore,
      userStateStore: pairedUserStateStore,
    });
    const pairedServer = http.createServer(pairedApp);
    await new Promise<void>((resolve) => pairedServer.listen(0, resolve));
    const pairedPort = (pairedServer.address() as { port: number }).port;
    const pairedApi = async (method: string, ep: string, body?: any) => {
      const headers: Record<string, string> = {
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: `accessToken=${pairedToken}`,
      };
      const opts: RequestInit = { method, headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const r = await fetch(`http://localhost:${pairedPort}${ep}`, opts);
      const t = await r.text();
      return { status: r.status, data: t ? JSON.parse(t) : null };
    };

    try {
      const putPairedPromo = await pairedApi('PUT', `/api/enrollments/${pSub1.id}`, {
        academicYear: 2026,
        term: '1C',
        status: 'promocionada',
        professorIds: [],
      });
      const putPairedRegOnAprob = await pairedApi('PUT', `/api/enrollments/${pSub2.id}`, {
        academicYear: 2025,
        term: '1C',
        status: 'regularizada',
        professorIds: [],
      });
      const statePaired = await pairedApi('GET', '/api/state');
      assert(
        putPairedPromo.status === 200 &&
          putPairedPromo.data?.data?.subjectStatus === 'promocionada' &&
          putPairedRegOnAprob.status === 200 &&
          putPairedRegOnAprob.data?.data?.subjectStatus === 'aprobada' &&
          statePaired.status === 200 &&
          statePaired.data?.data?.progress?.['801']?.status === 'promocionada' &&
          statePaired.data?.data?.progress?.['802']?.status === 'aprobada' &&
          statePaired.data?.data?.progress?.['802']?.grade === 8,
        'Con reviewsStore + userStateStore inyectados, GET /api/state refleja promocionada y respeta aprobada (nota 8) sin bajar'
      );
    } finally {
      await new Promise<void>((resolve) => pairedServer.close(() => resolve()));
      setActiveReviewsStore(store);
    }

    // 14.11 Atomicidad en memoria: si falla upsertSubjectProgress, no queda la cursada ni cambia el progreso
    const atomicReviewsStore = new InMemoryReviewsStore();
    const failingUserStateStore = new InMemoryUserStateStore();
    const atomicPlanId = atomicReviewsStore.defaultPlanId;
    const atomicFacId = atomicReviewsStore.defaultFacultyId;
    failingUserStateStore.seedPlan({
      id: atomicPlanId,
      name: 'Plan Atómico',
      facultyId: atomicFacId,
      totalLevels: 5,
      status: 'published',
      isActive: true,
      careerStatus: 'published',
    });
    const aSub = atomicReviewsStore.seedSubject({
      codeInPlan: 901,
      name: 'Materia Atomicidad',
      planId: atomicPlanId,
    });
    failingUserStateStore.seedSubject({
      id: aSub.id,
      planId: atomicPlanId,
      codeInPlan: 901,
    });
    const atomicUserId = crypto.randomUUID();
    atomicReviewsStore.seedUserPlan(atomicUserId, atomicPlanId);
    failingUserStateStore.seedUser(atomicUserId, atomicPlanId);
    testUsersMap.set(atomicUserId, {
      id: atomicUserId,
      email: 'atomic.fail@frc.utn.edu.ar',
      role: 'user',
      status: 'active',
      emailVerified: true,
      selectedPlanId: atomicPlanId,
    });
    const atomicToken = makeToken({
      id: atomicUserId,
      email: 'atomic.fail@frc.utn.edu.ar',
      role: 'user',
      selectedPlanId: atomicPlanId,
    });

    await failingUserStateStore.upsertSubjectProgress(atomicUserId, aSub.id, 'cursando', null);
    failingUserStateStore.upsertSubjectProgress = async () => {
      throw new Error('Falla simulada al guardar subject_progress');
    };

    const atomicApp = createApp({
      reviewsStore: atomicReviewsStore,
      userStateStore: failingUserStateStore,
    });
    const atomicServer = http.createServer(atomicApp);
    await new Promise<void>((resolve) => atomicServer.listen(0, resolve));
    const atomicPort = (atomicServer.address() as { port: number }).port;
    const atomicApi = async (method: string, ep: string, body?: any) => {
      const headers: Record<string, string> = {
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: `accessToken=${atomicToken}`,
      };
      const opts: RequestInit = { method, headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const r = await fetch(`http://localhost:${atomicPort}${ep}`, opts);
      const t = await r.text();
      return { status: r.status, data: t ? JSON.parse(t) : null };
    };

    try {
      const resAtomicFail = await atomicApi('PUT', `/api/enrollments/${aSub.id}`, {
        academicYear: 2026,
        term: '1C',
        status: 'promocionada',
        professorIds: [],
      });
      const enrListAfterFail = await atomicApi('GET', '/api/enrollments');
      const stateAfterFail = await atomicApi('GET', '/api/state');
      const revProgAfterFail = (await atomicReviewsStore.getUserSubjectProgressMap(atomicUserId)).get(aSub.id);
      assert(
        resAtomicFail.status === 500 &&
          atomicReviewsStore.enrollmentsMap.size === 0 &&
          (enrListAfterFail.data?.data?.enrollments || []).length === 0 &&
          stateAfterFail.data?.data?.progress?.['901']?.status === 'cursando' &&
          revProgAfterFail?.status === 'cursando',
        'Atomicidad: si falla el guardado del progreso (500), hace rollback de la cursada y no cambia el progreso'
      );
    } finally {
      await new Promise<void>((resolve) => atomicServer.close(() => resolve()));
      setActiveReviewsStore(store);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO BACKEND: ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error fatal en tests de reseñas:', err);
  process.exit(1);
});
