// Configurar entorno aislado en memoria ANTES de importar módulos del servidor (CERO conexión a Neon)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_super_seguro_de_al_menos_32_caracteres_2026';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://offline:offline@localhost:5432/offline_test';

import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

async function main() {
  const { env } = await import('../src/config/env.js');
  const { createApp } = await import('../src/app.js');
  const { InMemoryReviewsStore } = await import('../src/modules/reviews/reviews.store.js');
  const {
    parseProfessorName,
    compareProfessorParsed,
    analyzeProfessorNames,
  } = await import('../src/modules/professors/professorNormalizer.js');

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
  }) {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        selectedPlanId: user.selectedPlanId ?? store.defaultPlanId,
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
    includeCsrf: boolean = true
  ) {
    const headers: Record<string, string> = {};
    if (includeCsrf) headers['X-Requested-With'] = 'XMLHttpRequest';
    if (token) headers['Cookie'] = `accessToken=${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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

    const mergeRes = await api('POST', '/api/admin/professors/merge', tokenAdmin, {
      sourceProfessorId: profBotta2.id,
      targetProfessorId: profBotta1.id,
    });
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
        itemOneFive?.averageOverall === null,
      'Con < 3 reseñas (1 reseña): estado "pocas_resenas" y no muestra promedio como dato firme (averageOverall = null)'
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
