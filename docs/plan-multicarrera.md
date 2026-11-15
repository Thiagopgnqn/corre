# Plan Maestro Multi-Carrera / Multi-Plan — Stack (Auditoría y Etapa 1A)

> **Estado:** Etapa 1A completada y migración `0008` validada por el usuario en rama de Neon con datos reales. **Parte 1B-1**, correcciones (`code`/`0010`/`0011`/`0012`/`specialRule`), **Parte 1B-2 Grupo 1** (helpers puros + oráculo), **Migración `0013`**, **Tanda 2a** (`StatsDashboard`, `Navbar`, `UserMenu`, `tutorialSteps`, `TutorialSpotlight`, más `SubjectDrawer` y `QuickStatusModal`), **verificaciones pre-Tanda-2b** (`df61517`) y **Tanda 2b** (`src/utils/planViewSelectors.ts` + `CorrelativeGraph`, `SubjectListView`, `SubjectNode`, `KanbanBoard`, `SemesterPlanner`, `ElectivesPicker`, `OnboardingModal`, `SearchModal`) completados en rama local `multicarrera` (sin push, sin tocar Neon ni R2 reales, **detenido tras Tanda 2b** antes de Tanda 2c).  
> **Rama verificada:** `multicarrera` (creada desde `master` en commit `bbbf257`; Biblioteca ya integrada en esa base mediante `0dbc5c1` y soporte de libres/intentos en `c126d81`).  
> **Migraciones SQL:** base `0007_enrollment_status_and_exam_attempts.sql` -> `0008_multicarrera_and_shared_subjects.sql` (validada en Neon) -> `0009_isi_plan_pps_config.sql` -> `0010_isi_plan_short_names.sql` -> `0011_isi_plan_integrator_subjects.sql` -> `0012_isi_plan_special_rules_descriptions.sql` -> `0013_isi_plan_intermediate_and_pps_copy.sql` (0009–0013 pendientes de despliegue en Neon producción; idempotentes y con bump condicional de `catalog_versions` via CTE).

Este documento funciona como memoria compartida de arquitectura, auditoría técnica, decisiones de diseño y plan por etapas (1 a 5) para transformar **Stack** de una aplicación acoplada a **Ing. en Sistemas de Información – Plan 2023 (UTN FRC)** en una plataforma multi-carrera y multi-plan administrable desde `/#admin`, sin pérdida de datos para usuarios actuales ni mutaciones sobre datos reales en entorno de prueba.

---

## 1. Inventario de lugares fijos para Sistemas (Plan 2023 / UTN FRC)

### 1.1 Frontend: datos estáticos, lógica pura y estado

| Archivo | Elemento / comportamiento hardcoded |
|---|---|
| `src/data/plan2023.ts` | Catálogo estático `CORE_SUBJECTS`, `REQUIRED_ELECTIVE_CREDITS_TOTAL = 20`, `REQUIRED_ANALISTA_ELECTIVE_CREDITS = 4`, `ELECTIVE_SLOTS_EQUIVALENT = 7`. |
| `src/data/electives.ts` | Listado estático `ELECTIVES` exclusivo de Sistemas Plan 2023. |
| `src/data/acronyms.ts` | Mapa estático `ACRONYM_TO_ID` con siglas de materias de Sistemas. |
| `src/data/schedule.ts` y `src/data/schedule.json` | `SAMPLE_SCHEDULES` y `DEFAULT_SCHEDULES` embebidos para Sistemas (337 comisiones, 29 slots reservados de electivas). |
| `src/data/subjectAliases.ts` | Alias estáticos de materias de Sistemas para importación/parseo de horarios. |
| `src/data/tutorialSteps.ts` | Copys fijos del Plan 2023: `"las 5 columnas representan los años de la carrera (1° a 5° año)"`, `"Total 20 cr"`, `"título de Ingeniero/a"`, `"Título Intermedio de Analista"`, `"Seminario Integrador (99)"`, `"4 créditos de electivas"`. |
| `src/types/career.ts` | `CareerProgress` expone campos fijos `isAnalistaEligible`, `missingForAnalista`, `isPPSEligible`; `Subject.level` asume niveles `1–5`. |
| `src/utils/correlativas.ts` | Importa `CORE_SUBJECTS` y `ELECTIVES` estáticos; `canRenderSeminario` fija rango `[1..23]`; `canRenderProyectoFinal` fija IDs `36` y `99`; `isPPSEligible` fija ID `36`; `checkAnalistaTitle` fija `1..23`, `99` y `>= 4` créditos; `calculateProgressBreakdown` toma por defecto `electiveSlotsEquivalent = 7` y `requiredElectiveCredits = 20`. |
| `src/utils/criticalPath.ts` | L8–9 importa `CORE_SUBJECTS` estático y excluye/incluye `s.id !== 99` mediante `includeAnalistaTrack`. |
| `src/utils/storage.ts` | Claves en `localStorage` no segmentadas por `planId`; `INITIAL_ASSIGNED_ELECTIVES` y `sanitizeAssignedElectives` fijan años `1..5`; `exportCareerToJson` escribe `plan: 'Plan 2023 ISI UTN'`. |
| `src/context/CareerContext.tsx` | Consume `/api/catalog/plans/current` solo para leer `plan.name`, ignorando materias/correlativas/reglas/siglas/configuración del backend y calculando con `CORE_SUBJECTS` y `ELECTIVES` estáticos; `addElectiveToYear` limita años a `1..5`. |

### 1.2 Frontend: componentes de UI

| Archivo | Elemento / comportamiento hardcoded |
|---|---|
| `src/components/common/Navbar.tsx` | L288, L402, L732 textos fijos `"Analista (99)"` / `"Título Analista (99)"`; interruptor `includeAnalistaTrack` siempre renderizado sin verificar si el plan tiene título intermedio. |
| `src/components/common/PlanSelectorModal.tsx` | L97 compara por nombre (`const isCurrent = p.name === currentPlanName;`), lo que colisiona si dos carreras tienen un plan llamado `"Plan 2023"`; no advierte que el progreso es independiente por plan ni pide confirmación antes de cambiar. |
| `src/components/common/SearchModal.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos. |
| `src/components/onboarding/OnboardingModal.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos. |
| `src/components/kanban/KanbanBoard.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos. |
| `src/components/planner/SemesterPlanner.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos. |
| `src/components/electives/ElectivesPicker.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos y distribuye en años fijos. |
| `src/components/graph/CorrelativeGraph.tsx` | Usa `CORE_SUBJECTS` / `ELECTIVES`, filtra `s.id !== 99`, fija `levelCounts: {1..5}` e itera `for (let y=1; y<=5; y++)`. |
| `src/components/graph/SubjectDrawer.tsx` | L514–534 fija `selectedSubject.id === 36`, `"Materias previas del plan (1 a 35 + Electivas)"` y `"Proyecto Final"`. |
| `src/components/stats/StatsDashboard.tsx` | Usa `CORE_SUBJECTS` / `ELECTIVES`, filtra `s.id !== 99` y muestra tarjetas/textos fijos: `"Título Intermedio: Analista Universitario de Sistemas"`, `"Materias 1 a 23:"`, `"Seminario Integrador (99):"`, `"Requisito de 20 créditos alcanzado"`, `"Logros desbloqueados automáticamente al avanzar en el plan 2023."` y `"Habilitación PPS"` (`isPPSEligible`). |
| `src/components/schedule/ScheduleBuilder.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos. |
| `src/components/schedule/ScheduleWeeklyGrid.tsx` | L49–120 define `SUBJECT_SHORT_NAMES` hardcoded para IDs `1..36`, `99`, `401..514`; L129 referencia `// Recreos estándar UTN`. |
| `src/components/schedule/ScheduleSummaryPanel.tsx` | L65 exporta texto fijo `'📅 MI HORARIO DE CURSADA — UTN ISI (Plan 2023)\n'`. |
| `src/components/professors/ProfessorsDirectory.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos. |
| `src/components/library/LibraryHome.tsx` | L178, L287, L352–360 texto fijo `"Ingeniería en Sistemas de Información"`, filtro `level > 5` y botones fijos de años `1..5`. |
| `src/components/library/LibraryTermsPage.tsx` | L62 texto fijo `"para la comunidad estudiantil de Ingeniería en Sistemas de Información"`. |
| `src/components/admin/tabs/AdminScheduleTab.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos. |
| `src/components/admin/tabs/AdminReviewsTab.tsx` | Importa `CORE_SUBJECTS` / `ELECTIVES` estáticos. |

> **Nota positiva en marca:** `index.html`, `src/config/brand.ts` y `server/src/modules/mailer/templates/verificationEmail.ts` ya usan marca genérica **Stack** sin referencias hardcoded a Sistemas.

### 1.3 Backend, scripts y correos

| Archivo | Elemento / comportamiento hardcoded o sin filtro de plan |
|---|---|
| `server/src/modules/admin/admin.service.ts` | L457 `getStats()` fija `adminsCount: 1`; L468 fija `totalSubjects: 45`; L724 `getUserDetail()` usa fallback `let planName = 'Plan 2023'`. |
| `server/src/modules/admin/admin.controller.ts` | L801–911 `createCareer` / `createPlan` legacy asignan config fija `{ requiredElectiveCredits: 20, defaultMinPassingGrade: 4 }` y `isActive: true` sin cargar materias/reglas/siglas; `createSchedule` solo incrementa versión de catálogo y audita sin cargar horarios reales. |
| `server/src/modules/catalog/catalog.controller.ts` | L253–264 `getSchedule` usa año por defecto `2026` y su fallback `isCurrent` no filtra por `eq(scheduleTerms.facultyId, career.facultyId)`; L518–527 `updateSelectedPlan` permite elegir planes sin validar si están publicados. |
| `server/src/app.ts` | L110 `/api/me/reviewable` acepta `req.query.planId` en lugar de imponer el plan activo del usuario. |
| `server/src/modules/enrollments/enrollments.routes.ts` | L17 y L30 aceptan `req.query.planId` arbitrario. |
| `server/src/modules/library/library.controller.ts` | L29 toma `(req.query.planId as string) || req.user?.selectedPlanId` sin impedir consulta cross-plan no autorizada. |
| `server/src/modules/professors/professors.routes.ts` | L32, L59, L77, L97 aceptan `req.query.planId` sin validar que coincida con el plan activo del usuario. |
| `server/src/modules/reviews/reviews.store.ts` | L714 vs L729 `getSubjectByIdOrCode` filtra por `planId` cuando recibe `codeInPlan` numérico, pero omite `eq(subjects.planId, planId)` cuando recibe un UUID de materia; `InMemoryReviewsStore` siembra por defecto una sola facultad/plan. |
| `server/src/modules/user-state/userState.controller.ts` | L410, L414, L485, L839, L861 (`updateElectives`, `updateBasket`, `importData`) eliminan registros por `userId` sin filtrar por `planId`; L1131–1137 `saveExamAttempt` omite `planId` al buscar por UUID. |
| `server/src/modules/library/library.mailer.ts` | L201, L269, L334, L414, L450 incluyen textos fijos `"Ingeniería en Sistemas"` / `"UTN FRC"`. |
| `server/src/scripts/importScheduleDb.ts` | L109–113 acepta `--faculty` y `--plan` pero ignora `--plan` y toma `studyPlans.isActive = true LIMIT 1`. |
| `server/src/scripts/seed.ts`, `server/seed-data/plan2023-catalog.json`, `server/tools/generateSeedData.ts` | Upsert de plan único basado en `plan2023-catalog.json` con `intermediateDegrees` (`analista`, `specialRuleSubjectCode: 99`) y `specialRules` (`approved_range` `1..23` para `99`, `all_previous_core_approved` para `36` excluyendo `analista`), sin poblar `status` ni `sharedSubjectId`. |

---

## 2. Auditoría del esquema de base de datos y brechas multi-carrera

El esquema en `server/src/db/schema.ts` ya posee la columna vertebral jerárquica correcta:
`institutions -> faculties -> careers -> study_plans -> subjects / subject_prerequisites / plan_special_rules / acronyms`, además de `professors` por facultad y `schedule_terms -> commissions -> commission_slots / commission_professors`.

Sin embargo, faltan piezas clave para soportar múltiples carreras y carga desde admin sin tocar código:

1. **Ciclo de vida (Borrador / Publicado / Archivado) en `careers` y `study_plans`:**
   - Hoy solo existe `isActive` booleano. Falta una columna `status` (`'draft' | 'published' | 'archived'`, default `'draft'` para cargas nuevas y backfill a `'published'` para Sistemas Plan 2023 existente) manteniendo `isActive` sincronizado por compatibilidad aditiva.
   - Los endpoints públicos de catálogo y selección de plan deben listar/permitir exclusivamente planes con `status = 'published'`.
2. **Configuración estructurada por plan (`study_plans.config`):**
   - Formalizar contrato JSONB + valores por defecto claros para todo plan:
     - `requiredElectiveCredits`: créditos de electivas requeridos para el título principal (ej. `20`, o `0` si el plan no tiene electivas).
     - `electiveSlotsEquivalent`: peso/equivalencia de electivas en estadísticas generales (ej. `7` en Sistemas, `0` si no aplica bloque equivalente).
     - `totalLevels` / `levelLabel` (ej. `5` y `"año"`, soportando carreras de 3, 4, 5 o 6 años/niveles).
     - `defaultMinPassingGrade`: nota mínima aprobatoria (ej. `4` o `6`).
     - `intermediateDegrees` (opcional, `[]` si la carrera no tiene título intermedio): arreglo de `{ key, name, requiredElectiveCredits?, specialRuleSubjectCode? }`. El interruptor y las tarjetas de título intermedio **solo** aplican cuando el plan define al menos un título intermedio y la regla especial asociada.
     - `ppsRequirement` (única fuente de verdad para PPS, `null` si el plan no tiene PPS): `{ referenceSubjectCode: number } | null`. No se usa un segundo campo paralelo (`ppsSubjectCode` eliminado de `schema.ts` y payloads). El motor evalúa `checkEligibility` sobre la materia referenciada del plan activo; si `ppsRequirement` es `null` o no está definido, el plan no tiene PPS (`isPPSEligible = false` y la UI oculta la tarjeta).
     - `shortTag` / etiqueta para exportaciones (reemplazando `"UTN ISI (Plan 2023)"`).
3. **Reglas especiales genéricas (`plan_special_rules`):**
   - Deben parametrizar completamente reglas por códigos del plan (`codeInPlan` / `subjectId`), por ejemplo:
     - `approved_range`: requiere entre `N` y `M` materias aprobadas de un rango/lista del plan (ej. `"Seminario: 1 a 23 aprobadas"`).
     - `all_previous_core_approved`: requiere todas las obligatorias previas aprobadas hasta cierto nivel o excluyendo tracks/códigos opcionales (ej. `"Proyecto Final"` excluyendo track intermedio).
     - `min_credits`: requiere mínimo de créditos acumulados.
4. **Identificación estable de materias y siglas en `subjects`:**
   - Asegurar código estable de plantilla (`codeInPlan` / `externalCode`) único por `plan_id` para que re-importar el mismo plan actualice en forma idempotente en lugar de duplicar materias.
   - Permitir sigla corta (`shortName`) y alias por materia en catálogo para nutrir `ScheduleWeeklyGrid`, buscador y chips sin mapas hardcoded.
5. **Pertenencia de usuario al plan (`users.selected_plan_id`):**
   - La columna ya existe, pero:
     - Debe garantizarse que todos los usuarios actuales queden vinculados a **Ing. en Sistemas de Información – Plan 2023 (UTN FRC)**.
     - Registro y login Google deben requerir o resolver válidamente un `selectedPlanId` publicado (manteniendo retrocompatibilidad en clientes que no lo envíen todavía si hay un único plan publicado o fallback explícito).
6. **Períodos horarios por facultad / plan (`schedule_terms` y `commissions`):**
   - Un período horario (`faculty_id`, `academic_year`, `term`) pertenece a una facultad, mientras cada `commission` apunta a un `subject_id` (y por tanto pertenece unívocamente a un `study_plan`).
   - El resolver `getSchedule` debe filtrar `schedule_terms` siempre por la `faculty_id` de la carrera del plan activo del usuario y devolver únicamente las comisiones cuyas materias pertenecen a ese `plan_id`.

---

## 3. Auditoría de estado del usuario y aislamiento entre planes

### 3.1 Cómo se persiste hoy el estado del usuario
- **Estados de materias (`user_subject_states`), notas/intentos (`exam_attempts`), electivas asignadas y canasta:** ya referencian `subject_id` (UUID de fila en `subjects`, la cual pertenece a un único `plan_id`) + `user_id`. Esto es favorable porque distintas carreras tendrán `subject_id` distintos.
- **Cursadas (`enrollments`) y reseñas (`reviews`):** vinculadas a `subject_id` (y `professors.id` por facultad en reseñas).
- **Puntos rotos / con riesgo de colisión entre planes:**
  1. `user_settings`: su clave primaria actual es solo `user_id` (y tiene columna fija `include_analista_track`). Si un usuario cambia de carrera/plan y ajusta sus preferencias (ej. ocultar un track intermedio o configurar preferencias del grafo), sobrescribiría la configuración de su primer plan. **Estrategia de migración segura (sin cambiar la PK de golpe):**
     - **Paso 1 (Etapa 1A):** agregar columna `plan_id` **nullable** en `user_settings` (FK -> `study_plans.id`).
     - **Paso 2 (Etapa 1A):** hacer backfill de todas las filas existentes al `id` de Sistemas Plan 2023 (o `users.selected_plan_id` si ya existe), manteniendo integridad sin romper escrituras previas.
     - **Paso 3 (Etapa 1A):** crear índice único compuesto `(user_id, plan_id)` y adaptar la aplicación/consultas para leer/escribir por `(user_id, plan_id)`.
     - **Paso 4 (paso posterior explícito tras validar en rama Neon):** una vez verificado en producción/staging que no hay filas con `plan_id IS NULL` ni clientes viejos dependientes de la PK simple, retirar en migración posterior explícita la PK vieja solo-`user_id` y promover `(user_id, plan_id)` (eventualmente retirando `include_analista_track` legacy si ya no se usa).
  2. `schedule_selections` (`uq_user_schedule_selection`) y `schedule_proposals`: están indexados solo por `(user_id, schedule_term_id)` sin `plan_id`. En una misma facultad y cuatrimestre (`schedule_term_id` compartido), cambiar de carrera mezclaría o borraría la propuesta horaria del otro plan.
  3. **Borrados sin filtro de `planId` en `userState.controller.ts`:** `updateElectives`, `updateBasket` e `importData` eliminan registros filtrando únicamente por `userId`. Si un usuario tiene progreso en Plan A y guarda cambios en Plan B, **perdería el progreso de electivas/canasta/materias del Plan A**.
  4. **Consultas cross-plan sin autorización:** `app.ts` (`/api/me/reviewable`), `enrollments.routes.ts`, `library.controller.ts`, `professors.routes.ts` aceptan `?planId=` desde query string; y `reviews.store.ts` (`getSubjectByIdOrCode`) + `userState.controller.ts` (`saveExamAttempt`) aceptan un UUID de `subjectId` sin exigir `subjects.planId === req.user.selectedPlanId`.
  5. **Otros bugs detectados en backend:** `admin.service.ts` fija `adminsCount: 1`, `totalSubjects: 45` y `planName = 'Plan 2023'`; `catalog.controller.ts` no filtra `scheduleTerms` por `facultyId` en `getSchedule`, usa año `2026` por defecto, y `updateSelectedPlan` no valida que el plan exista **y** esté en estado publicado.
  6. **`localStorage` en frontend (`src/utils/storage.ts`):** las claves no incluyen `planId`, por lo que en modo invitado o migración inicial mezclarían estados de carreras distintas.

### 3.2 Regla de aislamiento obligatorio (Etapa 1A)
- Toda lectura y escritura de estado académico, horarios, reseñas, cursadas y biblioteca del usuario autenticado se acota en el **backend** exclusivamente a `req.user.selectedPlanId` (salvo endpoints explícitos de `/api/admin/*`).
- Todos los endpoints que reciben `planId`, `subjectId` o cualquier UUID de entidad del plan deben verificar que pertenezcan al plan activo del usuario (`req.user.selectedPlanId`), rechazando con `403`/`404` cualquier acceso a otro plan.
- Al cambiar de plan (`PATCH /api/catalog/me/plan` o equivalente, validando existencia y estado `published`), el progreso anterior **no se borra**: cada tabla de configuración/selección/propuesta queda particionada por `(user_id, plan_id)`.
- Requisito de prueba obligatorio en Etapa 1A: suite con **DOS planes** (Plan A y Plan B) que demuestre que guardar cambios en `updateElectives`, `updateBasket`, `importData` o borrar registros en Plan B deja intacto el 100% de los datos en Plan A.

---

## 4. Diseño de Biblioteca y "Materia compartida dentro de la facultad" (Ajuste al Plan)

### 4.1 Situación actual e invariante de Cloudflare R2
- En `server/src/modules/library/library.service.ts` (L356, L2270), la clave en R2 se construye como:
  ```text
  storageKey = `library/${fileId}${ext}`
  ```
- **Resultado crítico:** las claves de objetos en Cloudflare R2 **no contienen** `subjectId`, `planId`, `careerId` ni `facultyId`. No hace falta mover, copiar ni renombrar ningún objeto ya almacenado en R2.

### 4.2 Modelo de materia compartida dentro de la misma facultad
Para que materias equivalentes entre carreras o planes de una **misma facultad** (por ejemplo, *Análisis Matemático I*, *Álgebra y Geometría Analítica* o *Física I* en UTN FRC) compartan apuntes, parciales y finales sin duplicar archivos ni colapsar por homonimias automáticas:

1. **Nueva entidad `shared_subjects`:**
   - Campos: `id` (UUID), `faculty_id` (FK a `faculties`), `stable_code` (código estable alfanumérico/slug), `normalized_name` (nombre normalizado sin tildes ni puntuación), `display_name`, `created_at`, `updated_at`.
   - **Restricción única:** `UNIQUE (faculty_id, stable_code)` (NO única por `normalized_name`).
   - **Índice de sugerencia:** índice **NO único** sobre `(faculty_id, normalized_name)`, utilizado únicamente como heurística de sugerencia al administrador.
2. **Vínculo en `subjects` (nunca automático por nombre):**
   - Nueva columna nullable `shared_subject_id` (FK -> `shared_subjects.id`) en `subjects`.
   - **Regla estricta de vinculación:** **nunca** se vinculan materias por nombre de forma automática. Durante el dry-run de la carga de planes (Etapa 2), el backend solo **sugiere** coincidencias posibles dentro de la misma facultad; cada vínculo a un `shared_subject_id` existente (o la creación de uno nuevo) debe ser **confirmado explícitamente por el admin**.
   - **Excepción única:** el backfill idempotente de la migración `0008` crea una `shared_subject` **1 a 1** por cada materia existente de Sistemas Plan 2023 (generando su `stable_code` a partir del código estable de la materia en el plan).
3. **Vínculo e historial de origen en `library_files` y cuotas estrictamente POR USUARIO:**
   - Agregar `shared_subject_id` (FK -> `shared_subjects.id`) y metadatos de origen `source_subject_id` / `source_plan_id` (backfilled desde `library_files.subject_id` actual).
   - **Lo que SÍ se agrupa por `shared_subject_id`:** listado público de archivos de la materia, contadores de material disponible por materia, filtros de Biblioteca de esa materia y detección de duplicados por hash `SHA-256`.
   - **Cuotas y límites estrictamente POR USUARIO (NUNCA por materia compartida):** todos los límites vigentes —`25 MB` por PDF, `10 MB` por imagen, `300 MB` de espacio total por usuario, `5` subidas por día, `10` archivos pendientes y `60` descargas por hora— se evalúan exclusivamente por `user_id`. Un usuario de la carrera B jamás queda limitado o bloqueado por el volumen, cantidad diaria o descargas de usuarios de la carrera A aunque compartan `shared_subject_id` (verificado con tests dedicados).
   - **Etiqueta informativa sin romper privacidad:** la ficha pública del archivo muestra el origen académico (ej. *"Aportado en Ing. en Sistemas (Plan 2023)"* cuando proviene de otra carrera/plan de la facultad) conservando siempre el anonimato del autor (`"Subido por un estudiante"`, jamás exponiendo nombre, legajo ni email en rutas no-admin).
   - **Validación de pertenencia:** el usuario solo puede listar, descargar o subir material para materias pertenecientes a su **plan activo** (`subjects.plan_id === req.user.selectedPlanId`), pero al hacerlo ve y aporta al repositorio de su `shared_subject_id` dentro de su facultad.
4. **Límites y alcance futuro (fuera de esta iteración):**
   - El compartimiento entre **distintas facultades** (ej. dos regionales distintas) queda **fuera de alcance** por ahora para evitar diferencias de programa/cátedra; se documenta explícitamente como mejora futura.

### 4.3 Pregunta abierta de diseño: ¿unificar también reseñas en materias compartidas?
- **Estado actual planificado (Etapas 1–4):** `professors` ya es único por facultad, mientras que `reviews` sigue exigiendo que el usuario haya regularizado/aprobado/promocionado la `subjects.id` específica de **su plan** (y asociándose a esa `subject_id`).
- **Pros de unificar reseñas por `shared_subject_id` en el futuro:** concentra opiniones cuando un mismo docente dicta la misma materia de ciclo básico para varias ingenierías, evitando perfiles fragmentados.
- **Contras:** diferentes carreras pueden tener distintos programas analíticos, profundidad o régimen de aprobación aunque el nombre coincida, y un admin podría requerir gestión granular de equivalencias antes de fusionar reseñas.
- **Decisión propuesta:** mantener `reviews` ligadas a `subjects.id` (validado contra `planId` activo) en Etapas 1–4 y conservar `professors` por facultad; evaluar unificación opcional en un filtro posterior en UI/backend una vez operen varias carreras.

---

## 5. Riesgos para usuarios actuales (Sistemas Plan 2023) y estado de línea base

### 5.1 Riesgos y mitigaciones

| Riesgo | Impacto en usuarios actuales | Mitigación |
|---|---|---|
| **Migración parcial de `users.selected_plan_id` o `user_settings`** | Usuarios antiguos ven pantalla de elegir plan o pierden su flag `include_analista_track`. | Migración SQL idempotente asigna `selected_plan_id` de Sistemas Plan 2023 (marcado `status = 'published'`) a todo usuario con `NULL` y migra `user_settings` existentes a `(user_id, plan_id)`. |
| **Pérdida silenciosa de progreso al cambiar de plan** | Al usar `updateElectives` / `updateBasket` / `importData` o `schedule_selections` sin `plan_id`, se borran datos de Sistemas al probar otra carrera. | Acotar todo `DELETE` y clave de `schedule_selections` / `schedule_proposals` / `user_settings` por `(user_id, plan_id)`, con tests dedicados de aislamiento cross-plan. |
| **Diferencias numéricas en estadísticas o elegibilidad de Sistemas** | Cambio involuntario en cálculo de promedio, créditos de electivas (`20`), bloque equivalente (`7`), regla `99` (`1..23`) o `36` (`PPS` / `Proyecto Final`). | Suite de regresión en Etapa 1 que compara salida byte-a-byte / estructura exacta para Sistemas Plan 2023 contra la línea base actual. |
| **Ruptura de URLs / claves R2 en Biblioteca** | Archivos históricos dejan de encontrarse o descargarse. | Cero cambios en `storageKey` de R2 (`library/${fileId}${ext}`); backfill aditivo de `shared_subjects` y `library_files.shared_subject_id`. |
| **Inyección o DoS en subida de Excel desde admin** | Fórmulas maliciosas, archivos enormes o ciclos en correlativas cuelgan el servidor. | Validación de `.xlsx` por extensión + firma ZIP, límite `5 MB`, lectura exclusiva de valores sin evaluar fórmulas ni macros, detección DFS de ciclos, límite de filas, `requireAdmin` + `requireRecentReauth` + `adminRateLimiter` + `adminAuditLog`. |
| **Despublicación o borrado accidental de plan con alumnos** | Estudiantes quedan huérfanos sin plan activo. | Prohibir borrado/despublicación con usuarios activos sin confirmación explícita informando la cantidad exacta de usuarios afectados en `/#admin`. |

### 5.2 Línea base real verificada y auditoría de seguridad (Paso Previo)

#### A. Origen de rama y verificación de entorno de tests
- **Historial Git (`git log --oneline --graph --decorate -n 15`):** `multicarrera` nació de `master` en el commit `bbbf257` (*"suba masiva de archivos"*). La Biblioteca (migración `0005_library_material.sql`, `0006_library_notifications.sql`, `library.service.ts`) ya estaba integrada en `master` desde `0dbc5c1` (*"Merge pull request #1 from Thiagopgnqn/biblioteca"*), y `0007_enrollment_status_and_exam_attempts.sql` desde `c126d81`. Última migración existente confirmada: `0007`.
- **Aislamiento de credenciales (`.env` / Neon / R2):**
  - Verificado en el repositorio y entorno de ejecución: no existen archivos `.env`, `server/.env`, `server/.env.test` ni `.env.local` (solo `.env.example` y `server/.env.example`), ni variables `DATABASE_URL`, `DIRECT_URL` o `R2_*` definidas en el shell.
  - Los 12 archivos de test en `test/*.test.ts` operan sobre código cliente/estático o mocks sin base de datos ni R2 real.
  - En `npm --prefix server test` (`reviews.test.ts`, `authVerification.test.ts`, `admin.test.ts`, `library.test.ts`), los suites fijan `NODE_ENV = 'test'` y `DATABASE_URL = 'postgresql://offline:offline@localhost:5432/offline_test'`, utilizando stores en memoria (`InMemoryReviewsStore`, `InMemoryLibraryService`, `MemoryMockR2Service`). Solo `server/test/integration.test.ts` (exclusivo de `npm --prefix server run test:neon`, no incluido en `test`) usa PostgreSQL real.
  - **Riesgo técnico detectado a endurecer en Etapa 1A:** `server/src/config/env.ts` (L4) invoca `dotenv.config()` al cargarse el módulo; si existiera un `.env` local y un test usara `import` estáticos (como `library.test.ts`), ESM evalúa `env.ts` antes de las líneas top-level `process.env.*`. Se corregirá en Etapa 1A omitiendo `dotenv.config()` cuando `NODE_ENV === 'test'` o pasando imports a dinámicos.

#### B. Builds de línea base (`server` y raíz)
Tras instalar dependencias del backend con `npm --prefix server ci` (`203 packages`, `server/node_modules` ignorado por `.gitignore`):
- **`npm --prefix server run build` (`tsc`):** ✅ **COMPILÓ OK** (código de salida `0`).
- **`npm run build` (`tsc -b && vite build`):** ✅ **COMPILÓ OK** (código de salida `0`, `2606` módulos transformados).

#### C. Línea base real de tests (antes y después de sanear rutas y entorno de test)

**Backend (`npm --prefix server test`):** ejecuta la suite de backend sobre stores en memoria (sin Postgres ni R2):
- *Línea base inicial pre-reparación:* `186` pasaron, `9` fallaron + aborto fatal en `library.test.ts` (por `env.ts` evaluando `dotenv.config()` / defaults antes del setup en ESM).
- **Línea base saneada (pre-1A, tras aislar setup en `server/test/setupTestEnv.ts` y saltear `dotenv.config()` cuando `NODE_ENV === 'test'`):** **`320` aserciones originales pasaron, `0` fallaron** (`reviews.test.ts`: `85/0`, `authVerification.test.ts`: `51/0` + `1` test nuevo de falla obligatoria en producción sin variables requeridas -> `52/0`, `admin.test.ts`: `37/0`, `library.test.ts`: `147/0` llegando hasta su resumen final sin warnings espurios de `REFRESH_SECRET`).
- **Con la nueva suite de Etapa 1A (`server/test/multicarreraIsolation.test.ts`, `25` aserciones en memoria):** **`346` pasaron, `0` fallaron** (`server/test/integration.test.ts` sigue reservado para `npm --prefix server run test:neon`).

**Frontend (`npm test`):** ejecuta 12 archivos en cadena:
- **Antes de corregir rutas (`c:/Users/msgar/OneDrive/Escritorio/codigos/corre`):**
  - `scheduleLayout.test.ts`: **0 pasaron, 6 fallaron** (`ENOENT`).
  - `mobileFrontend.test.ts`: **4 pasaron, 33 fallaron** (`ENOENT` por ruta de otra máquina).
- **Después de corregir únicamente `rootDir` relativo al archivo con `fileURLToPath(import.meta.url)` en [scheduleLayout.test.ts](file:///c:/Users/PC/Desktop/correlativas/test/scheduleLayout.test.ts) y [mobileFrontend.test.ts](file:///c:/Users/PC/Desktop/correlativas/test/mobileFrontend.test.ts) (sin tocar aserciones):** **`npm test` completo PASÓ con código de salida `0`:**
  1. `test/correlativas.test.ts`: ✅ **pasó** (runner propio; `106` llamadas `assert` en código).
  2. `test/scheduleImport.test.ts`: ✅ **pasó** (runner propio; `84` llamadas `assert` en código; `337` comisiones, `29` slots reservados).
  3. `test/reviewsFrontend.test.ts`: ✅ **pasó** (runner propio; `75` llamadas `assert` en código).
  4. `test/authFrontend.test.ts`: ✅ **pasó** (runner propio; `19` llamadas `assert` en código; `4` bloques verificados).
  5. `test/brand.test.ts`: ✅ **`33` pasaron, `0` fallaron**.
  6. `test/scheduleLayout.test.ts`: ✅ **`6` pasaron, `0` fallaron**.
  7. `test/adminFrontend.test.ts`: ✅ **pasó** (`6` secciones en verde; `24` llamadas `assert` en código).
  8. `test/libraryFrontend.test.ts`: ✅ **`31` pasaron, `0` fallaron**.
  9. `test/mobileFrontend.test.ts`: ✅ **`37` pasaron, `0` fallaron**.
  10. `test/apiContract.test.ts`: ✅ **`2` pasaron, `0` fallaron**.
  11. `test/scheduleAvailability.test.ts`: ✅ **`13` pasaron, `0` fallaron**.
  12. `test/tutorialLayout.test.ts`: ✅ **`12` pasaron, `0` fallaron**.
- **Resumen frontend al cierre de Etapa 1A:** **12 / 12 archivos en verde**.
- **Línea base actualizada al inicio de Etapa 1B (Parte 1B-1, commits `1825d4e` y `53b8db1`):**
  - **Frontend (`npm test`):** **13 / 13 archivos en verde** (agregando `test/plan2023Oracle.test.ts`: `15` aserciones en `1825d4e`, ampliado a **`23` aserciones sobre `20` escenarios congelados** en `53b8db1` cubriendo correlativas, electivas, promedio, Seminario 99 bordes, Proyecto Final 36, Analista, PPS habilitado/bloqueado y ruta crítica).
  - **Backend (`npm --prefix server test`):** **`346` pasaron, `0` fallaron**.
  - **Builds:** **`npm run build` OK** (`tsc -b && vite build`) y **`npm --prefix server run build` OK** (`tsc`).

#### D. Auditoría de dependencias (`xlsx`, `drizzle-orm`, `zod`) y decisión aprobada para Etapa 2
- **Versión instalada en Etapa 1A (sin modificar `package.json` de dependencias):** `xlsx@0.18.5`, `drizzle-orm@0.40.1` (`^0.40.0`), `drizzle-kit@0.30.6` (`^0.30.4`), `zod@3.25.76` (`^3.24.2`).
- **`xlsx@0.18.5` (aplica en Etapa 2 — decisión cerrada):**
  - `GHSA-4r6h-8v6p-xvw6` (**Prototype Pollution in sheetJS**, `<0.19.3`, high) y `GHSA-5pgg-2g8v-p4x9` (**SheetJS ReDoS**, `<0.20.2`, high), ambos sin parche en npmjs.com.
  - **Decisión aprobada para Etapa 2 (Ajuste 1):** en `server/`, reemplazar directamente `"xlsx"` en `server/package.json` por `"file:./vendor/xlsx-0.20.3.tgz"` (sin alias y sin ninguna copia `0.18.5` en `server/`), descargado desde `cdn.sheetjs.com`, versionado en Git (`server/vendor/xlsx-0.20.3.tgz`, verificado sin exclusiones en `.gitignore`/`.gitattributes` e integridad en `server/package-lock.json`), validado contra `mergeProfessors.ts`, `migrateProfessors.ts` y simulación de build limpio de Render. La raíz mantiene `xlsx@0.18.5` **solo** en `devDependencies` para `scripts/importSchedule.ts` y `test/scheduleImport.test.ts` (confirmando que `vite build` / `dist/` no empaqueta `xlsx`). En tiempo de ejecución, el parser combina: límite `5 MB`, firma ZIP (`PK`), tope `10` hojas y `2000` filas, lectura exclusiva de valores sin fórmulas ni macros, objetos sin prototipo / whitelist de columnas, aislamiento en `worker_threads` sin secretos (`env: {}`), `resourceLimits`, timeout `5000 ms` y concurrencia global máxima de **1 importación o vista previa simultánea**.
- **Análisis de `npm audit` en `server/` para `drizzle-orm` y `zod` (NO actualizados en 1A; decisión: quedan para un cambio aparte DESPUÉS de desplegar multicarrera):**
  - **`drizzle-orm <0.45.2` (`GHSA-gpj5-g38j-94v9`, high — SQL injection via improperly escaped SQL identifiers):** inspeccionado todo `server/src/`, existen **0 llamadas** a `sql.identifier` ni `sql.raw`; todas las expresiones `sql\`...\`` referencian columnas tipadas de Drizzle o valores parametrizados (y un literal estático `FOR UPDATE`). **No se dispara con el uso actual del código**. Se mantiene `drizzle-orm` (`0.40.1`) y `drizzle-kit` (`0.30.6`) congelados durante todo el desarrollo y despliegue inicial de multicarrera; **su actualización queda explícitamente postergada para un cambio aparte DESPUÉS de desplegar** (evitando cambios de formato del journal antes del lanzamiento).
  - **`zod <4.6.6` (`GHSA-mrhx-c7xc-m3w5`, high — memory exhaustion validating oversized constrained collections):** en endpoints HTTP de `server/src/modules/`, los únicos `z.array(...)` se encuentran en `enrollments.schemas.ts` con topes explícitos (`professorIds` `.max(15)`, `professorNames` `.max(15)`, `keys` `.max(500)`), todos autenticados (`requireAuth`), con rate limiter y tope global `express.json({ limit: '10mb' })` en `server/src/app.ts` (los demás `z.array` pertenecen al script CLI offline `mergeProfessors.ts`). Aunque el riesgo queda acotado a usuarios autenticados y payloads `<= 10 MB`, su actualización a Zod `4.x` (cambio mayor) **NO se realiza antes del despliegue de multicarrera; queda para un cambio aparte DESPUÉS de desplegar**.
  - **`esbuild <=0.24.2` / `drizzle-kit` (moderate):** dependencia de desarrollo transitiva vía `@esbuild-kit/esm-loader` usada por `drizzle-kit`, no expuesta en tiempo de ejecución en producción (`npm start`).

---

## 6. Plan de implementación por etapas (1A, 1B, 2, 3, 4 y 5)

> Cada etapa termina con un **commit dedicado en `multicarrera`** (sin `git push`), reporte de archivos modificados y resultados reales de tests/builds, y **freno esperando aprobación**.

### ETAPA 1A – Base de datos, aislamiento cross-plan y generalización de backend
**Objetivos:**
- Migración SQL aditiva e idempotente `server/drizzle/0008_multicarrera_and_shared_subjects.sql` (+ actualización de `server/src/db/schema.ts` y `server/drizzle/meta/_journal.json`):
  - Agregar `status` (`'draft' | 'published' | 'archived'`) a `careers` y `study_plans`, backfilling los registros actuales de Sistemas Plan 2023 a `'published'`.
  - Estandarizar `study_plans.config` (créditos de electivas requeridos, `electiveSlotsEquivalent`, `totalLevels`, `levelLabel`, `intermediateDegree` opcional, `ppsRequirement` opcional, `shortTag`) y columnas en `subjects` (`short_name`, `shared_subject_id`).
  - Crear `shared_subjects` con unicidad `UNIQUE (faculty_id, stable_code)` e índice **NO único** `(faculty_id, normalized_name)`; agregar `shared_subject_id`, `source_subject_id`, `source_plan_id` a `library_files`. Backfill **1 a 1** idempotente de las materias existentes de Sistemas Plan 2023 y sus archivos en Biblioteca (sin tocar claves `library/${fileId}${ext}` de R2).
  - Backfill de `users.selected_plan_id` a Ing. en Sistemas Plan 2023 para todo usuario existente sin plan asignado.
  - **`user_settings` sin cambiar PK de golpe:** agregar `plan_id` **nullable**, backfillear al plan de Sistemas Plan 2023 / `users.selected_plan_id`, y crear índice único `(user_id, plan_id)`. Documentar explícitamente el paso posterior futuro para retirar la PK legacy una vez validado en rama de Neon.
  - Agregar `plan_id` nullable + backfill + índices por `(user_id, plan_id, schedule_term_id)` en `schedule_selections` y `schedule_proposals`.
- **Blindaje cross-plan obligatorio en backend:**
  - `updateElectives`, `updateBasket`, `importData` y cualquier borrado actúan **solo** sobre `req.user.selectedPlanId`.
  - Todos los endpoints que reciban `planId`, `subjectId` o UUIDs de cursadas/intentos/reseñas/materias verifican pertenencia al plan activo del usuario (`req.user.selectedPlanId`).
  - Corregir bugs detectados: `adminsCount` y `totalSubjects` reales en `admin.service.ts` (y fallback de `planName` desde BD), filtro obligatorio por `facultyId` y año dinámico en `getSchedule` (`catalog.controller.ts`), y validación de existencia + estado `'published'` en `updateSelectedPlan`.
- **Biblioteca por materia compartida + cuotas por usuario:**
  - Agrupar listado, contadores y detección de duplicados `SHA-256` por `shared_subject_id`, manteniendo **todas las cuotas y límites por usuario** (`user_id`), nunca compartidos entre usuarios de distintas carreras.
- **Saneamiento de tests de backend preexistentes:**
  - Evitar que `server/src/config/env.ts` lea `.env` cuando `NODE_ENV === 'test'` y corregir `server/test/library.test.ts` (`REFRESH_SECRET` + imports dinámicos tras configurar env mock) para dejar el suite backend 100% en verde.
- **Tests obligatorios de Etapa 1A:**
  - Test de migración de usuarios existentes hacia Sistemas Plan 2023 conservando datos y configuración.
  - Test con **DOS planes (Plan A y Plan B)** demostrando que `updateElectives`, `updateBasket`, `importData` y borrados en Plan B no alteran ni pierden datos en Plan A, y que endpoints rechazan UUIDs/`planId` ajenos al plan activo.
  - Test de Biblioteca compartida intra-facultad: usuario de carrera B no queda limitado por cuotas/subidas de usuario de carrera A, ni ve identidad del autor.

**Archivos principales a tocar / crear:**
- `server/drizzle/0008_multicarrera_and_shared_subjects.sql` (nuevo)
- `server/drizzle/meta/_journal.json`
- `server/src/db/schema.ts`
- `server/src/config/env.ts`
- `server/src/app.ts`
- `server/src/modules/auth/auth.service.ts`, `auth.schemas.ts`
- `server/src/modules/catalog/catalog.controller.ts`, `catalog.routes.ts`
- `server/src/modules/user-state/userState.controller.ts`
- `server/src/modules/enrollments/enrollments.routes.ts`, `enrollments.service.ts`
- `server/src/modules/professors/professors.routes.ts`
- `server/src/modules/reviews/reviews.store.ts`, `reviews.service.ts`
- `server/src/modules/library/library.controller.ts`, `library.service.ts`, `library.mailer.ts`
- `server/src/modules/admin/admin.service.ts`, `admin.controller.ts`
- `server/src/scripts/seed.ts`, `server/seed-data/plan2023-catalog.json`
- `server/test/library.test.ts` y nuevos tests de migración/aislamiento dos-planes (`server/test/multicarreraIsolation.test.ts`).

---

### ETAPA 1B – Generalización del motor y estado frontend
**Objetivos:**
- Generalizar el motor puro y reglas de negocio en frontend para consumir dinámicamente el catálogo y reglas del plan activo (`study_plans.config`, `plan_special_rules`, `subjects`, `acronyms`), eliminando IDs fijos (`99`, `36`, `1..23`, `7`, `20`) y supuestos de 5 años en la lógica:
  - `src/types/career.ts`, `src/types/library.ts`
  - `src/utils/correlativas.ts` (evaluador genérico de `approved_range`, `all_previous_core_approved` —`min_credits` no existe todavía en el motor—, títulos intermedios opcionales)
  - `src/utils/criticalPath.ts`
  - `src/utils/storage.ts` (claves de `localStorage` segmentadas por `planId` + migración automática no destructiva del `localStorage` legado hacia el plan actual de Sistemas Plan 2023)
  - `src/context/CareerContext.tsx`, `src/api/catalog.api.ts`, `src/api/userState.api.ts` (lectura completa de materias, correlativas, siglas y config del plan activo).
- Agregar suite de **regresión para Sistemas Plan 2023** que garantice resultados idénticos al comportamiento original (mismas materias, correlativas, elegibilidades, camino crítico, estadísticas y exportaciones).

**Archivos principales a tocar / crear:**
- `src/types/career.ts`, `src/types/library.ts`
- `src/utils/correlativas.ts`, `src/utils/criticalPath.ts`, `src/utils/storage.ts`
- `src/context/CareerContext.tsx`
- `src/api/catalog.api.ts`, `src/api/userState.api.ts`
- `test/correlativas.test.ts` (ampliación con regresión Plan 2023 + segundo plan dinámico) y tests de migración de `storage.ts`.

---

### ETAPA 2 – Carga de plan de estudios desde el admin *(plan aprobado por tramos 2A–2D en rama `etapa2`)*
**Prerrequisito cerrado:** mitigación SheetJS `0.20.3` vendored en `server/vendor/xlsx-0.20.3.tgz` + worker aislado (ver Sección 5.2 D y Sección 10).

**Objetivos (ver detalle operativo y ajustes 1–9 en Sección 10):**
- Plantilla `.xlsx` descargable desde `/#admin` (hojas: `"Plan"`, `"Materias"`, `"Correlativas"`, `"Reglas"`, `"Acrónimos"`, `"Instrucciones"`, con fila de ejemplo neutral y notas de ayuda).
- Backend admin (rutas `/api/admin/plans/*`, con `/plans/template` registrada estrictamente antes que `/plans/:id`):
  - `GET /api/admin/plans/template` (descarga `.xlsx` generado).
  - `POST /api/admin/plans/preview` (dry-run en `worker_threads` sin escrituras y con lock global de concurrencia `1`: conteo de materias/correlativas/reglas, **solo sugerencias** de equivalencia contra `shared_subjects` existentes de la facultad sin vincular jamás automáticamente, cálculo de `previewHash(archivo + decisiones)`, errores bloqueantes con hoja y fila —duplicados, ciclos DFS, destinos inexistentes, campos vacíos, niveles inválidos, tipos de regla no soportados por `correlativas.ts`— y avisos).
  - `POST /api/admin/plans/import` (recibe el archivo `.xlsx` original + decisiones del admin + `previewHash`, re-parsea y re-valida todo del lado servidor bajo el mismo worker y lock, verifica el `previewHash(archivo + decisiones)`, ejecuta una única transacción todo-o-nada dejando el plan en estado `draft`, actualización idempotente por `code_in_plan`, vinculación únicamente de `shared_subjects` confirmados o creación `1:1`, y auditoría resumida en `admin_audit_log` sin almacenar archivo crudo).
  - `GET /api/admin/plans`, `GET /api/admin/plans/:id`, `DELETE /api/admin/plans/:id` (solo `draft`, bloqueado ante referencias en BD/Biblioteca) y acciones de ciclo de vida (`publish`, `unpublish`, `archive` en Tramo 2D; ver Sección 10).
  - **CONDICIÓN BLOQUEANTE DE ETAPA 2 (Biblioteca y borrado en cascada):** en `server/src/db/schema.ts`, `library_files.subject_id` es `NOT NULL` con `ON DELETE CASCADE` hacia `subjects(id)`. Al implementar `delete` de planes/materias en Etapa 2 queda **obligatoriamente prohibido** eliminar planes `published`/`archived` o borradores que tengan filas en `library_files` (u otras tablas dependientes).
  - Seguridad estricta: `requireAdmin`, `requireRecentReauth` en escrituras, `adminRateLimiter`, `csrfProtection`, límite `5 MB`, worker sin acceso a secretos (`env: {}`), `resourceLimits`, timeout `5000 ms`, límite `1` proceso concurrente (`409`/`429`), validación estricta de cada celda sin fórmulas ni macros, y auditoría resumida.
- Documentar los nuevos endpoints en `docs/api-multicarrera.md`.
- Frontend (Tramo 2B): nueva pestaña `"Carreras"` en `AdminDashboard.tsx` (descarga plantilla, subida, vista previa con errores/avisos, selector explícito para confirmar `shared_subjects`, confirmación y tabla/árbol de solo lectura para visualizar correlativas sin refactorizar `CorrelativeGraph.tsx`).
- Resiliencia de estado multi-plan (`user_settings` PK `(user_id, plan_id)` vía migración `0015` en 2 despliegues), corrección de los bloqueantes del panel admin (a–d) y ciclo de vida `publish`/`unpublish`/`archive` (Tramos 2C–2D).

**Archivos principales a tocar / crear:**
- `server/vendor/xlsx-0.20.3.tgz`, `server/package.json`, `server/package-lock.json`
- `server/drizzle/0014_subject_display_code.sql`, `server/drizzle/0015_*.sql`, `server/drizzle/meta/_journal.json`, `server/src/db/schema.ts`
- `server/src/modules/admin/planImport.rules.ts`, `planImport.template.ts`, `planImport.worker.ts`, `planImport.parser.ts`, `planImport.service.ts` (nuevos)
- `server/src/modules/admin/admin.controller.ts`, `admin.routes.ts`, `admin.service.ts`
- `src/api/admin.api.ts`, `src/components/admin/AdminDashboard.tsx`, `src/components/admin/tabs/AdminCareersTab.tsx` (nuevo, Tramo 2B)
- `docs/api-multicarrera.md` (Tramo 2B/2D)
- `server/test/planImport.test.ts` (nuevo), `test/apiContract.test.ts`, `test/correlativas.test.ts` y tests frontend/DB por tramo.

---

### ETAPA 3 – Carga de horarios, comisiones y profesores desde el admin
**Objetivos:**
- Definir plantilla `.xlsx` canónica de horarios independiente de Sistemas (manteniendo intacto el importador legacy actual para Sistemas Plan 2023):
  - Hojas `"Período"`, `"Comisiones"`, `"Slots"` (`LUN`..`SAB`, `HH:MM`, aula opcional, `anual`/`1C`/`2C`), `"Docentes"` (con rol opcional).
- Unificación y desambiguación de profesores **por facultad**:
  - Reutilizar `professorNormalizer.ts` / `professorResolver.ts` y lógica de `mergeProfessors.ts`.
  - En vista previa: separar coincidencias exactas (vinculación automática), coincidencias dudosas (el admin elige manualmente vincular a docente existente o crear nuevo; nunca autounificar ante duda) y docentes nuevos; preservar intactas las reseñas históricas.
- Dry-run (validando materia inexistente en el plan, solapamientos de slots dentro de la misma comisión, horas inválidas / fin menor a inicio, períodos) + confirmación en una única transacción con reautenticación, auditoría, límites de tamaño/formato y rate limit (usando el mismo parser endurecido y aislado).
- Corregir `importScheduleDb.ts` para respetar `--plan` cuando se invoque por CLI.
- Frontend en pestaña `"Carreras"` -> sección `"Horarios"` por plan/período: descarga de plantilla canónica, preview, selector interactivo para resolver docentes dudosos, listado de períodos cargados y confirmación.
- Tests con fixture completo de una **segunda carrera ficticia**, validando además que `scheduleLogic` (armador de horarios, detector de choques y sugeridor de combinaciones) funciona correctamente con un plan distinto a Sistemas.

**Archivos principales a tocar / crear:**
- `docs/api-multicarrera.md` (actualización con endpoints de importación de horarios)
- `server/src/modules/admin/scheduleImport.parser.ts`, `scheduleImport.service.ts` (nuevos)
- `server/src/modules/admin/admin.controller.ts`, `admin.routes.ts`
- `server/src/scripts/importScheduleDb.ts`
- `src/api/admin.api.ts`
- `src/components/admin/tabs/AdminCareersTab.tsx` y subcomponentes de preview/resolución de docentes
- `src/components/admin/tabs/AdminScheduleTab.tsx` (mantener herramientas existentes sin romperlas)
- `server/test/scheduleCanonImport.test.ts` (nuevo) y tests frontend de armador con fixture multi-carrera.

---

### ETAPA 4 – Experiencia del usuario multi-carrera
**Objetivos:**
- Registro / primer ingreso (email y Google): selección de carrera/plan entre los planes `published`. Usuarios actuales permanecen en Sistemas Plan 2023 y disponen de cambio de plan en `UserMenu` / perfil.
- Flujo seguro de cambio de plan en `PlanSelectorModal.tsx`: **comparar por `plan.id` (no por `plan.name`)**, explicar claramente que el progreso es por plan y no se mezcla ni se pierde, exigir confirmación explícita y recargar estado aislado del nuevo plan (incluyendo namespace por `planId` en `localStorage`).
- Generalizar todas las pantallas y textos visibles de usuario: Mapa (`CorrelativeGraph`), `SubjectDrawer`, `SubjectListView`, `KanbanBoard`, `SemesterPlanner`, `ElectivesPicker`, `StatsDashboard`, `ScheduleBuilder` / `ScheduleWeeklyGrid` / `ScheduleSummaryPanel`, `ProfessorsDirectory`, `LibraryHome` / `SubjectLibraryView` / `LibraryTermsPage`, `Navbar`, `SearchModal`, `OnboardingModal` y `tutorialSteps.ts`. Eliminar textos fijos de `"Sistemas"` / `"Plan 2023"`.
- Biblioteca compartida intra-facultad en UI y backend: mostrar materiales de la materia compartida en la facultad con etiqueta informativa de origen académico cuando aplique, manteniendo anonimato absoluto de autores y cuotas por usuario; corregir textos de `library.mailer.ts` para usar datos reales de carrera/facultad.
- Reseñas: mantener profesores únicos por facultad y validar en backend que el usuario tenga la materia regularizada/aprobada/promocionada dentro de su plan activo.
- Verificar diseño mobile intacto (barra inferior de 5 destinos: Mapa, Biblioteca, Profesores, Estadísticas, Más; Armador solo PC/tablet; panel Admin orientado a escritorio).

**Archivos principales a tocar / crear:**
- `src/components/auth/AuthScreen.tsx`
- `src/components/common/Navbar.tsx`, `UserMenu.tsx`, `PlanSelectorModal.tsx`, `SearchModal.tsx`
- `src/components/graph/CorrelativeGraph.tsx`, `SubjectDrawer.tsx`, `SubjectListView.tsx`
- `src/components/kanban/KanbanBoard.tsx`
- `src/components/planner/SemesterPlanner.tsx`
- `src/components/electives/ElectivesPicker.tsx`
- `src/components/stats/StatsDashboard.tsx`
- `src/components/schedule/ScheduleBuilder.tsx`, `ScheduleWeeklyGrid.tsx`, `ScheduleSummaryPanel.tsx`
- `src/components/professors/ProfessorsDirectory.tsx`, `ReviewFormModal.tsx`
- `src/components/library/LibraryHome.tsx`, `SubjectLibraryView.tsx`, `UploadMaterialModal.tsx`, `MyUploadsView.tsx`, `LibraryTermsPage.tsx`
- `src/components/onboarding/OnboardingModal.tsx`
- `src/data/tutorialSteps.ts`
- `src/components/admin/tabs/AdminReviewsTab.tsx`
- `server/src/modules/library/library.service.ts`, `library.mailer.ts`.

---

### ETAPA 5 – Cierre, contratos y verificación integral
**Objetivos:**
- Actualizar/ampliar `test/apiContract.test.ts` para que falle automáticamente si el frontend invoca cualquier ruta `/api/*` inexistente en Express (incluyendo las nuevas rutas multi-carrera y admin de etapas 1–4).
- Ejecutar suite completa de frontend y backend (`npm test`, `npm run build`, `npm --prefix server test`, `npm --prefix server run build`), contando e informando la cantidad real de tests vs la línea base inicial.
- Completar y revisar `README.md`, `docs/api-multicarrera.md` y actualizar el estado final en `docs/plan-multicarrera.md`.
- Entregar al usuario el listado exacto de pasos manuales para producción/staging (migraciones en rama de Neon en orden explícito incluido retiro posterior de PK legacy de `user_settings`, verificación de seed/backfill, variables de entorno si hubiera nuevas, validaciones post-deploy sin tocar nunca credenciales).

**Archivos principales a tocar / crear:**
- `test/apiContract.test.ts`
- `README.md`
- `docs/api-multicarrera.md`
- `docs/plan-multicarrera.md`.

---

## 7. Estado completado de Etapa 1A y guía de prueba / limpieza en rama de Neon

### 7.1 Resumen de implementación en Etapa 1A
- **Aislamiento de entorno de test (`237fdcf`):** `server/test/setupTestEnv.ts` inicializa `NODE_ENV='test'` y variables en memoria antes de evaluar `env.ts`; `env.ts` solo saltea `dotenv.config()` cuando `NODE_ENV === 'test'` y conserva falla obligatoria en producción (validado en `authVerification.test.ts`). `server/tsconfig.json` / `server/dist/` excluyen `server/test/` de la compilación de despliegue.
- **Migración `0008` y esquema (`f48312f`, `cb744fc`):** `server/drizzle/0008_multicarrera_and_shared_subjects.sql`, `meta/_journal.json`, `schema.ts` y `seed.ts`. Todas las columnas/tablas son aditivas e idempotentes (`careers.status`, `study_plans.status`, `shared_subjects` con `UNIQUE(faculty_id, stable_code)`, índice no único `idx_shared_subjects_faculty_norm`, backfill 1-a-1 de `subjects.shared_subject_id`, backfill de `library_files.(shared_subject_id, source_subject_id, source_plan_id)` sin tocar `storage_key`, backfill de `users.selected_plan_id` y columnas/índices por plan en `user_settings`, `schedule_selections` y `schedule_proposals`). En `cb744fc` todos los `11` bloques `DO $$ ... ADD CONSTRAINT ... EXCEPTION` pasaron a capturar `duplicate_object OR duplicate_table` (PostgreSQL puede lanzar `duplicate_table` `42P07` en constraints `UNIQUE` como `uq_shared_subjects_faculty_code` al re-ejecutar).
- **Catálogo, Auth y Admin (`3c9170e`):** filtro `status = 'published'` en catálogo público y `PUT /api/me/plan` (con fallback seguro en `auth.service.ts`), resolución de `schedule_terms` por `facultyId` + año dinámico en `catalog.controller.ts`, y conteos reales (`adminsCount`, `totalSubjects`, fallback `planName`) en `admin.service.ts`.
- **Blindaje cross-plan y Biblioteca compartida (`61b214b`):**
  - `auth.middleware.ts` incluye `selectedPlanId` vivo del usuario.
  - Endpoints de usuario (`app.ts`, `userState.*`, `enrollments.*`, `professors.routes.ts`, `reviews.*`, `library.*`) ignoran cualquier `?planId=` externo y usan `req.user.selectedPlanId`, devolviendo `404` ante materias/comisiones/cursadas/reseñas/propuestas/períodos/exámenes/archivos ajenos al plan activo.
  - `userState.helpers.ts` + `userState.store.ts` aíslan `user_settings` (`extraSettings.perPlan[planId]`), `schedule_selections` (`selectionsByPlan[planId]`), `electives`, `basket`, `progress`, `scheduleProposals`, `examAttempts` e `importPlanBundle` por `(userId, planId)`.
  - `library.service.ts` agrupa catálogo, conteos y detección `SHA-256` por `shared_subject_id` dentro del plan activo manteniendo anonimato de autor y cuotas estrictamente por `user_id`.
- **Tests (`db6f882`, `35627e8`):** `server/test/multicarreraIsolation.test.ts` (`25` aserciones sobre SQL `0008` y doble ejecución simulando `duplicate_table` en `UNIQUE` y `duplicate_object` en `CHECK`/`FK`, helpers, aislamiento HTTP dos-planes UserState/Reviews/Enrollments/Professors y Biblioteca compartida + cuotas por usuario).

### 7.2 Qué se verificó en memoria vs qué NO se pudo verificar aquí
- **Verificado en este entorno:** compilación TypeScript frontend (`tsc -b && vite build`) y backend (`tsc`), `12/12` archivos frontend (`npm test`) y `346/0` aserciones backend exclusivamente sobre `InMemory*` stores (`InMemoryUserStateStore`, etc.), `MemoryMockR2Service` y helpers puros (`userState.helpers.ts`). **NO existen hoy tests ejecutados contra `DrizzleUserStateStore` ni contra PostgreSQL/Neon.**
- **NO verificado aquí (requiere prueba del usuario):** ejecución real de `0008_multicarrera_and_shared_subjects.sql` contra PostgreSQL / Neon, lectura/escritura real contra Cloudflare R2, envío SMTP real, comportamiento transaccional real de `DrizzleUserStateStore` y verificación visual/end-to-end contra base real.

### 7.3 Orden paso a paso para probar `0008` en una rama de Neon
> No ejecutar contra `master` / producción ni guardar credenciales en `.env` dentro del repo.

1. **Crear rama aislada en Neon** desde el snapshot actual de producción/staging (por consola de Neon o `neon branches create --name test-0008`). Copiar `DATABASE_URL` y `DIRECT_URL` **de esa rama temporal** solo en variables de sesión de terminal.
2. **Registrar conteos previos en la rama de Neon (`psql`):**
   ```sql
   SELECT COUNT(*) AS users_total, COUNT(*) FILTER (WHERE selected_plan_id IS NULL) AS users_no_plan FROM users;
   SELECT COUNT(*) AS subjects_total FROM subjects;
   SELECT COUNT(*) AS library_files_total FROM library_files;
   SELECT COUNT(*) AS settings_total FROM user_settings;
   SELECT COUNT(*) AS sched_sel_total FROM schedule_selections;
   SELECT COUNT(*) AS sched_prop_total FROM schedule_proposals;
   ```
3. **Ejecutar la migración `0008`** (con `DIRECT_URL` apuntando a la rama de prueba):
   - Vía app/Drizzle: `npm --prefix server run build` y luego `npm --prefix server run db:migrate`.
   - O vía `psql`: `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f server/drizzle/0008_multicarrera_and_shared_subjects.sql`.
4. **Probar idempotencia (segunda ejecución sin errores ni duplicados):**
   - Correr `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f server/drizzle/0008_multicarrera_and_shared_subjects.sql` una **segunda vez** y confirmar salida sin error.
5. **Verificar integridad post-`0008` en Neon (`psql`):**
   ```sql
   -- 1. Planes publicados y config de ISI 2023
   SELECT c.code, sp.year, sp.status, sp.config FROM study_plans sp JOIN careers c ON c.id = sp.career_id;
   -- 2. Backfill 1-a-1 de shared_subjects (debe dar orphaned = 0 y mismo conteo que subjects)
   SELECT COUNT(*) FILTER (WHERE shared_subject_id IS NULL) AS subjects_sin_shared, COUNT(*) AS subjects_total FROM subjects;
   SELECT COUNT(*) AS shared_subjects_total FROM shared_subjects;
   -- 3. Biblioteca backfill sin tocar storage_key
   SELECT COUNT(*) AS lib_total,
          COUNT(*) FILTER (WHERE shared_subject_id IS NULL) AS lib_sin_shared,
          COUNT(*) FILTER (WHERE source_plan_id IS NULL) AS lib_sin_source_plan
   FROM library_files WHERE subject_id IS NOT NULL;
   -- 4. Usuarios y estado por plan sin nulls
   SELECT COUNT(*) FILTER (WHERE selected_plan_id IS NULL) AS users_sin_plan FROM users;
   SELECT COUNT(*) FILTER (WHERE plan_id IS NULL) AS settings_sin_plan FROM user_settings;
   SELECT COUNT(*) FILTER (WHERE plan_id IS NULL) AS sched_sel_sin_plan FROM schedule_selections;
   SELECT COUNT(*) FILTER (WHERE plan_id IS NULL) AS sched_prop_sin_plan FROM schedule_proposals;
   ```
6. **Eliminar la rama temporal de Neon** al finalizar la validación.

### 7.4 Condiciones bloqueantes (antes de publicar un segundo plan / Etapa 2) y limpieza posterior

> [!CAUTION]
> **CONDICIÓN BLOQUEANTE antes de publicar un segundo plan (`user_settings` PK y `DrizzleUserStateStore`):**
> En `server/src/db/schema.ts`, `user_settings.user_id` sigue siendo `PRIMARY KEY` (solo existe `uq_user_settings_user_plan` como índice único adicional sobre `(user_id, plan_id)`), por lo que PostgreSQL solo admite **una fila física por usuario**.
> - **Qué hace hoy `DrizzleUserStateStore` al pasar de Plan A a Plan B:**
>   - **Lectura (`getUserSettings(userId)` + `extractPlanSettings(settingsRow, planId)` en `userState.helpers.ts`):** `DrizzleUserStateStore.getUserSettings` lee `WHERE user_id = userId LIMIT 1`. Si el usuario tiene guardados ajustes de Plan A y cambia a Plan B sin datos previos en B, `extractPlanSettings` busca `extraSettings.perPlan[planB]`; al no encontrarlo y ver `settingsRow.planId === planA` (`!== planB`), devuelve los valores por defecto + `notifyLibraryEmail` compartido a nivel usuario (no falla ni mezcla los ajustes por plan de A en B, salvo `notifyLibraryEmail` o una fila legada sin `plan_id`).
>   - **Escritura (`upsertUserSettings` e `importPlanBundle` en `userState.store.ts`):** consultan la única fila `WHERE user_id = userId LIMIT 1` y llaman a `mergePlanSettings(existing, planB, incoming)`: cuando `existingRow.planId` (`planA`) difiere de `planB` y aún no estaba respaldado, se guarda un snapshot de A en `extraSettings.perPlan[planA]`, se escribe `planB` en `extraSettings.perPlan[planB]`, se combinan claves generales de `extraSettings` y se devuelve `planId = planB` junto con las columnas top-level pobladas para `planB`. Luego `DrizzleUserStateStore` ejecuta `UPDATE user_settings SET plan_id = planB, ... WHERE user_id = userId`. Es decir: en writes secuenciales **no falla por PK ni borra A** (A queda dentro del JSON `extraSettings.perPlan[planA]`), pero **sí sobrescribe `plan_id` y las columnas SQL top-level de la única fila** para apuntar al último plan guardado (además, la inserción inicial usa check-then-insert no atómico y comparte `notifyLibraryEmail` entre planes).
> - **Cobertura actual de tests:** todos los tests de aislamiento de Etapa 1A en `server/test/multicarreraIsolation.test.ts` cubren **exclusivamente** `InMemoryUserStateStore` y `userState.helpers.ts`; **NO cubren `DrizzleUserStateStore` contra PostgreSQL**.
> - **Plan obligatorio antes de habilitar un segundo plan `status = 'published'`:**
>   1. **Código (`DrizzleUserStateStore`):** migrar `getUserSettings`/`upsertUserSettings`, `getScheduleSelection`/`upsertScheduleSelection` e `importPlanBundle` para operar en filas separadas por `(user_id, plan_id)` y `(user_id, plan_id, schedule_term_id)` con `onConflictDoUpdate` (y backfill de `extraSettings.perPlan` / `selectionsByPlan` si existiera).
>   2. **Migración propia posterior (`0010_*` o posterior)** una vez verificado en Neon que `0` filas tienen `plan_id IS NULL`:
>      ```sql
>      -- Solo cuando ya existan 0 filas con plan_id IS NULL y DrizzleUserStateStore haya pasado a múltiples filas por plan:
>      ALTER TABLE "user_settings" ALTER COLUMN "plan_id" SET NOT NULL;
>      ALTER TABLE "user_settings" DROP CONSTRAINT "user_settings_pkey";
>      ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id", "plan_id");
>
>      ALTER TABLE "schedule_selections" ALTER COLUMN "plan_id" SET NOT NULL;
>      DROP INDEX IF EXISTS "uq_user_schedule_selection";
>      ```
>   3. **Tests reales contra `DrizzleUserStateStore`/PostgreSQL:** validar lectura, escritura e importación intercalada entre Plan A y Plan B directamente sobre el store de Drizzle en rama de pruebas antes de publicar cualquier segundo plan.

> [!CAUTION]
> **CONDICIÓN BLOQUEANTE de Etapa 2 (Biblioteca y borrado en cascada `ON DELETE CASCADE`):**
> En `server/src/db/schema.ts`, `library_files.subject_id` es `NOT NULL` con `ON DELETE CASCADE` apuntando a `subjects(id)`. Si en Etapa 2 un administrador elimina un plan o una materia (`subjects`) vinculada por `shared_subject_id` a otros planes, PostgreSQL borrará en cascada archivos compartidos por otras carreras y dejará objetos huérfanos en R2. Antes de habilitar borrado de planes o materias en Etapa 2 se debe **prohibir el borrado cuando existan archivos en `library_files`** o **reasignar transaccionalmente `library_files.subject_id`** a otra materia vinculada al mismo `shared_subject_id` (y gestionar R2 si no queda ninguna) antes del `DELETE`.

> [!CAUTION]
> **CONDICIONES BLOQUEANTES del Panel de Administración antes de publicar un segundo plan / Etapa 2 (a–d):**
> Además del store real de `user_settings` y el borrado seguro de `library_files`, los siguientes 4 puntos del panel de administración quedan diferidos explícitamente y son bloqueantes antes de publicar un segundo plan:
> - **(a) Colas de moderación multi-plan:** las colas de moderación de Biblioteca y de reseñas deben mostrar la carrera y el plan de cada materia (evitando ambigüedad cuando distintos planes compartan códigos o nombres).
> - **(b) Creación y vinculación de docentes (`AdminReviewsTab` / backend):** crear docentes y vincularlos a materias desde administración debe enviar el `planId` o el UUID de la materia de forma explícita, y el servidor debe validar que la materia pertenece al plan indicado, sin depender de `users.selected_plan_id`.
> - **(c) Desacoples preexistentes en pestaña Horarios (`AdminScheduleTab`):** hoy existen desacoples entre cliente y servidor (`{ name, year, isDraft }` vs `{ facultyId, academicYear, term }`; `String(s.id)` vs UUID de materia); se rehacen integralmente en Etapa 3.
> - **(d) Alcance por facultad de los períodos horarios:** los períodos de horarios son por facultad, por lo que `setCurrentTerm` afecta a todas las carreras de esa facultad (debe comunicarse/modelarse explícitamente antes de operar múltiples carreras en una misma facultad).

- **Dependencias (`drizzle-orm`, `drizzle-kit`, `zod`):** su actualización NO forma parte de Etapa 1A ni de Etapa 1B; queda explícitamente diferida para un cambio separado **DESPUÉS de desplegar** multicarrera, con verificación específica de compatibilidad del journal de migraciones en rama de Neon.

---

## 8. Decisiones cerradas y preguntas abiertas de Etapa 1B-1

### 8.1 Regla de PPS (`ppsRequirement`) y migración `0009`
- **Fuente única de verdad en `study_plans.config`:** `ppsRequirement: { referenceSubjectCode: number } | null`. Se elimina `ppsSubjectCode` de `schema.ts` y de los payloads para evitar dos fuentes de verdad.
- El motor genérico evalúa `checkEligibility(referenceSubject, userState)` sobre la materia referenciada del plan activo (reproduciendo exactamente `isPPSEligible` actual). Cuando `ppsRequirement` es `null` o ausente, el plan no define PPS (`isPPSEligible: false` y la UI no muestra la tarjeta).
- **Migración `0009_isi_plan_pps_config.sql` (solo datos, aditiva e idempotente):** completa únicamente `ppsRequirement: { referenceSubjectCode: 36 }` para `ISI Plan 2023` sin pisar claves existentes.
- **Defaults neutros en backend (`normalizePlanConfig`):** `requiredElectiveCredits: 0`, `defaultMinPassingGrade: 4`, `electiveSlotsEquivalent: 0`, `totalLevels`: máximo nivel presente en las materias del plan (mínimo `1`), `levelLabel: 'Año'`, `intermediateDegrees: []`, `ppsRequirement: null`, sin valores hardcoded de Sistemas.

### 8.2 Auditoría de `seed.ts`, migraciones y Render (solo lectura)
- `server/src/scripts/seed.ts` **NO se ejecuta** ni en el build de Render (`render.yaml`: `buildCommand: npm install && npm run build && npm run db:migrate`) ni en el arranque (`startCommand: npm run start` -> `node dist/app.js`; tampoco aparece en `server/src/app.ts`). Solo se invoca manualmente mediante `npm --prefix server run seed`.
- **Advertencia si se corre manualmente `seed.ts`:** líneas `144–148` hacen `.set({ config: catalog.studyPlan.config, ... })` (reemplazo completo de `config`, no merge SQL). Por eso `server/seed-data/plan2023-catalog.json` debe mantenerse alineado con `0008`/`0009`, o en el futuro convertir el upsert manual de `seed.ts` en merge no destructivo.
- **Migraciones en Render / arranque:** `db:migrate` se ejecuta **tanto** en el `buildCommand` de `render.yaml` como de forma no bloqueante al iniciar `server/src/app.ts` cuando `process.env.NODE_ENV !== 'test'`.

### 8.3 Pregunta abierta de producto para el dueño del proyecto *(no implementar en 1B-1)*
- **Tarjeta `"Habilitación PPS"` en `StatsDashboard` (`36` vs `514`):** hoy `StatsDashboard` renderiza la tarjeta `"Habilitación PPS"` leyendo `computedProgress.isPPSEligible`, el cual evalúa las correlativas de cursado de la materia **`36` (*Proyecto Final*)** (`regularPrereqs: [25, 26, 30]`, `approvedPrereqs: [12, 20, 23]`) y **NO** las de la electiva **`514` (*Práctica Profesional Supervisada*)** (`regularPrereqs: [30]`, `approvedPrereqs: [20, 19]`). En Etapa 1B se mantiene **exactamente** el comportamiento actual mediante `ppsRequirement: { referenceSubjectCode: 36 }`. Queda pendiente confirmar con el dueño del proyecto si corresponde seguir apuntando a `36` o migrarlo en el futuro a `514` (o a una regla distinta).

### 8.4 Resumen de cierre PARTE 1B-1 (commits y línea base)
- **Oráculo congelado (`1825d4e`, `53b8db1`):** `test/fixtures/plan2023Oracle.json` + `test/plan2023Oracle.test.ts` (`20` escenarios / `23` aserciones, incluyendo bordes del Seminario `99`, habilitación PPS `36`, promedio sin promociones y planificación de electivas bloqueadas).
- **Backend catálogo neutro y migración `0009` (`647cb4e`):** `server/src/modules/catalog/{planConfig.helpers.ts,catalog.store.ts,catalog.controller.ts}`, `server/src/db/schema.ts`, `server/seed-data/plan2023-catalog.json`, `server/drizzle/0009_isi_plan_pps_config.sql`, `server/drizzle/meta/_journal.json` y `server/test/catalogConfigAndSecurity.test.ts` (`20/0` aserciones). Único campo de PPS: `ppsRequirement: { referenceSubjectCode: number } | null` (eliminado `ppsSubjectCode`).
- **Motor puro parametrizado (`8d765aa`):** `src/types/career.ts`, `src/utils/correlativas.ts` y `src/utils/criticalPath.ts` consumen `ActivePlanCatalog` sin constantes de Sistemas (`20`, `7`, `36`, `99`, `1..23`, `4`) ni imports estáticos.
- **Carga dinámica, caché, cold start y `localStorage` por plan (`fb7f9d1`):**
  - `src/api/catalog.api.ts`: caché por `planId` validado contra `GET /api/catalog/version`, timeout/reintentos exponenciales con aviso de cold start de Render (`wakingDelayMs`), y rechazo bloqueante ante error sin caché (nunca cae a Sistemas ni al caché de otro plan).
  - `src/utils/storage.ts`: namespace `::plan:${planId}`, migración idempotente copy-not-delete (`migrateLegacyLocalStorageToPlan` conserva claves originales), y `getSampleStudentForPlan` / `exportCareerToJson` dinámicos.
  - `src/context/CareerContext.tsx` y `src/App.tsx`: exponen el catálogo activo, cartel de cold start `"El servidor está despertando, puede tardar hasta 1 minuto"` y pantalla bloqueante con `"Reintentar"`.
- **Migración mínima de UI y fixtures (`041f36a`):** los `14` componentes consumidores leen catálogo/config desde `CareerContext` (`StatsDashboard` oculta la tarjeta `'pps'` si `!planConfig?.ppsRequirement`). Los archivos estáticos `plan2023.ts`, `electives.ts`, `acronyms.ts`, `subjectAliases.ts` salieron de `src/data/` hacia `test/fixtures/`.
- **Suite de tests migrada + nueva (`77b5247`, ajuste `ac68328`):** `test/plan2023Oracle.test.ts` ejecuta el motor nuevo sobre `server/seed-data/plan2023-catalog.json` en orden seed y en orden DB (`level ASC, codeInPlan ASC`); `test/multicarreraEngine.test.ts` valida plan ficticio de 3 niveles sin PPS/Analista/reglas, migración/aislamiento de `storage.ts`, caché/refresh/503/no-fallback de `catalog.api.ts`, descarte de cachés viejos frente a `CATALOG_CACHE_SCHEMA = 2` (`src/api/catalog.api.ts`) y ausencia total de imports estáticos de Sistemas en `src/`.
- **Línea base al cerrar 1B-1 + ajuste de caché:** frontend `14/14` archivos en verde (`plan2023Oracle` `23`, `multicarreraEngine` `6`), backend `366/0` (`reviews 85`, `authVerification 52`, `admin 37`, `library 147`, `multicarreraIsolation 25`, `catalogConfigAndSecurity 20`), ambos builds (`tsc -b && vite build` y `tsc`) OK.
- **Pendiente para PARTE 1B-2:** adaptar componentes visuales (columnas dinámicas según `totalLevels` y `levelLabel`, título intermedio desde `intermediateDegrees`, selector/cabeceras dinámicas sin strings fijos de `"Sistemas"` / `"Plan 2023"`, preservando visualmente Plan 2023 ISI).

### 8.5 Orden obligatorio de despliegue (Backend primero -> Frontend después)
1. **Desplegar primero el backend (`server/` en Render)** incluyendo la ejecución de `npm run db:migrate` (que aplica `0008` y `0009`) y esperar a que el servicio esté **Live** (`/api/health` y `/api/catalog/plans/current` respondiendo con el contrato nuevo).
2. **Recién cuando el backend está Live, desplegar el frontend en Vercel.**
3. **Motivo:**
   - El frontend de Etapa 1B requiere el payload enriquecido de `/api/catalog/plans/:planId` (`career`, `config` normalizado con `ppsRequirement`, `totalLevels`, `levelLabel`, `shortTag`, `intermediateDegrees`, `subjects[].shortName`, `rules`, `acronyms`) y `/api/catalog/version`. Si el frontend se desplegara antes que el backend + migración `0009`, recibiría un `config` sin `ppsRequirement` (ocultando la tarjeta de PPS en ISI 2023) o sin los campos normalizados.
   - El backend nuevo es 100% aditivo y retrocompatible con el frontend anterior mientras dura el despliegue en Vercel.

### 8.6 Plan corto de PARTE 1B-2 (Componentes visuales y textos dinámicos)
1. **Componentes a tocar y origen de datos:**
   - `src/components/common/Navbar.tsx`: mostrar switch de título intermedio solo si `planConfig?.intermediateDegrees?.length > 0`; textos desde `intermediateDegrees[0]` (`name`, `specialRuleSubjectCode`, `requiredElectiveCredits`); nombre de archivo de exportación desde `planConfig?.shortTag || currentPlanName`.
   - `src/components/common/UserMenu.tsx`: eliminar default `'Plan 2023'` y usar `planConfig?.shortTag || activePlan?.plan.name || currentPlanName`.
   - `src/components/common/PlanSelectorModal.tsx`: comparar selección actual por `selectedPlanId === plan.id` (no por `plan.name`).
   - `src/components/graph/CorrelativeGraph.tsx` y `src/components/graph/SubjectListView.tsx`: reemplazar columnas/bucles `[1..5]` y etiquetas fijas `{level}° Año` por `totalLevels` y `{level}° {levelLabel}` desde `CareerContext`.
   - `src/components/graph/SubjectDrawer.tsx`: reemplazar comparaciones fijas `99`/`36` y textos estáticos por lookup en `planRules` (`rule.subjectCode === selectedSubject.id`) y `selectedSubject.name` / `rule.description` (conservando el copy exacto en ISI 2023).
   - `src/components/kanban/KanbanBoard.tsx`, `src/components/electives/ElectivesPicker.tsx`, `src/components/onboarding/OnboardingModal.tsx`: reemplazar `[1, 2, 3, 4, 5]` por `1..totalLevels` y `levelLabel`; usar `requiredElectiveCredits` del contexto y niveles sugeridos reales de las electivas del plan (ocultando electivas si `requiredElectiveCredits === 0 && electives.length === 0`).
   - `src/components/stats/StatsDashboard.tsx`: reemplazar `[1..5]` por `1..totalLevels` + `levelLabel`; meta de electivas desde `requiredElectiveCredits`; hito y tarjeta de título intermedio condicionados a `planConfig?.intermediateDegrees?.length > 0 && settings.includeAnalistaTrack` leyendo `primaryDegree.name`, total del rango de su regla (en vez de `23`), `specialRuleSubjectCode` (en vez de `99`) y `primaryDegree.requiredElectiveCredits` (en vez de `4`); pie de logros desde `planConfig?.shortTag || activePlan?.plan.name`.
   - `src/components/schedule/ScheduleSummaryPanel.tsx`: encabezado copiado y nombre de `.ics` desde `planConfig?.shortTag || activePlan?.plan.name` en lugar de `UTN ISI (Plan 2023)`.
   - `src/components/library/LibraryHome.tsx` y `src/components/library/LibraryTermsPage.tsx`: reemplazar `"Ingeniería en Sistemas de Información"` fijo por `activeCareer?.name || 'tu carrera'`.
   - `vite.config.ts`: agregar proxy local `/api` -> `http://localhost:4000` para desarrollo local.
2. **Tutorial (`src/data/tutorialSteps.ts` y `src/components/tutorial/TutorialSpotlight.tsx`):**
   - `getAvailableTutorialSteps(isScheduleAvailable, planConfig?)` aceptará `planConfig` opcional (retrocompatible con tests existentes): oculta `'analista-switch'` si `intermediateDegrees.length === 0`, oculta `'electives-tour'` si `requiredElectiveCredits <= 0`, e interpola `totalLevels`, `levelLabel`, `requiredElectiveCredits` y datos de `intermediateDegrees[0]`.
3. **Nombres cortos en `ScheduleWeeklyGrid.tsx`:**
   - `getSubjectShortName(id, fullName, shortNameFromCatalog?)` prioriza `subject.shortName` proveniente del catálogo activo, conservando `SUBJECT_SHORT_NAMES` solo como fallback/compatibilidad con `test/scheduleImport.test.ts` y truncando `fullName` a 22 caracteres si faltara.
4. **Verificación mobile:**
   - Mantener intactos los 5 destinos de `mobilePrimaryNav`, breakpoints, `BottomSheet` y `ScheduleUnavailableNotice`; verificar con `test/mobileFrontend.test.ts` (`37`), `test/scheduleAvailability.test.ts` (`13`), `test/tutorialLayout.test.ts` (`12`), `test/scheduleLayout.test.ts` (`6`) y cobertura adicional en `test/multicarreraEngine.test.ts`.

---

## 9. Prerrequisitos y verificaciones previas a PARTE 1B-2 (Puntos A–E)

### 9.1 Convención de versión del catálogo en migraciones SQL (Punto A)
- **Regla obligatoria para toda migración futura que cambie datos de catálogo** (`study_plans`, `subjects`, `plan_special_rules`, `subject_correlatives`, `subject_acronyms`, etc.):
  1. Incrementar `catalog_versions` (`id = 'default'`) **en la misma sentencia SQL** mediante un CTE (`WITH upd AS (...) ... WHERE EXISTS (SELECT 1 FROM upd)`), de modo que la segunda ejecución (sin filas afectadas) sea un **no-op puro** tanto en las tablas de catálogo como en `catalog_versions`.
  2. Insertar la fila `'default'` de forma idempotente (`INSERT ... ON CONFLICT ("id") DO NOTHING`) cuando `EXISTS (SELECT 1 FROM upd)` por si una base nueva aún no ejecutó `bumpCatalogVersion()`.
  3. Mantener exactamente el mismo formato de versión generado por `bumpCatalogVersion()`: `'v-' || <epoch_ms> || '-' || <6_hex>` (`'v-' || (FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint)::text || '-' || SUBSTRING(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6)`).
  4. **No** usar `MAX(updated_at)` ni inferencias implícitas dentro de `getCatalogVersion()`.
- `server/drizzle/0009_isi_plan_pps_config.sql` quedó actualizada (`450fb25`) con esta convención y cubierta en `server/test/catalogConfigAndSecurity.test.ts` (simulando 2 corridas con fila `'default'` existente y sin fila previa).

### 9.2 Validación estricta de forma del catálogo (Punto B)
- En `src/api/catalog.api.ts` (`e52ed94`), `isValidPlanCatalogShape` verifica el contrato completo antes de usar o cachear cualquier respuesta (y al leer del caché): `career` (`id`, `name`, `code`, `facultyId`), `plan` (`config.totalLevels >= 1`, `config.levelLabel`, `defaultMinPassingGrade`, `requiredElectiveCredits`, `electiveSlotsEquivalent`, `intermediateDegrees`, `ppsRequirement`), cada elemento de `subjects` (con `shortName` no vacío y listas de correlativas), `rules` y `acronyms`.
- Ante un payload malformado o incompleto (ej. backend sin desplegar aún), `loadPlanCatalogSmart` lanza `CatalogShapeError` (*"El servidor está desactualizado o devolvió un plan de estudios incompleto..."*), no reintenta como error transitorio ni pisa caché previo válido, y `CareerContext` limpia `activePlan` para renderizar exclusivamente la pantalla de error con `"Reintentar"`.

### 9.3 Eliminación de horarios estáticos y estados de error/vacío (Punto C)
- Se eliminaron `src/data/schedule.ts` y `src/data/schedule.json` del bundle de producción (`a095583`).
- `SAMPLE_SCHEDULES` se trasladó exclusivamente a `test/fixtures/schedule.ts` (usado por `test/correlativas.test.ts`).
- `test/scheduleImport.test.ts`, `scripts/importSchedule.ts`, `server/src/scripts/importScheduleDb.ts`, `server/src/scripts/mergeProfessors.ts` y `server/src/scripts/migrateProfessors.ts` apuntan ahora a `server/seed-data/schedule.json` como fuente única.
- **Origen y vigencia de `server/seed-data/schedule.json`:** fue generado por `scripts/importSchedule.ts` (commit `13f4393`, `29/10/2026`) a partir de `data-source/*.xlsx` y contiene **337 comisiones**, **29 franjas reservadas de electivas** y **71 grupos materia/término** (`term`: `A`, `1C`, `2C`). Las planillas de origen y el JSON **no incluyen año calendario**; al ejecutarse `server/src/scripts/importScheduleDb.ts` sin flags, su default es `academicYear = 2026`, `term = '1C'`.
- **Runtime multi-carrera (`CareerContext`, `ScheduleBuilder`, `ScheduleUnavailableNotice`):**
  - Se eliminaron todos los guards `career.code === 'ISI' && year === 2023` en `src/`. `migrateLegacyLocalStorageToPlan` controla una clave global `STORAGE_KEY_LEGACY_MIGRATED_PREFIX` para copiar las claves pre-multicarrera una única vez al primer plan cargado y nunca en planes posteriores.
  - `CareerContext` separa `serverSchedules` de `customSchedules` (importados manualmente por JSON) y expone `scheduleStatus`, `scheduleError` y `retryLoadSchedule`.
  - Si falla `/api/catalog/schedule`, `ScheduleBuilder` renderiza `ScheduleUnavailableNotice` con motivo `'backend-error'` y botón **`Reintentar`**; si el servidor responde éxito con lista vacía (plan sin cuatrimestre publicado aún), renderiza `'no-schedule'` informándolo con acceso a `"Volver al mapa"` e importación local JSON.
  - `test/multicarreraEngine.test.ts` verifica la ausencia de `src/data/schedule.{ts,json}` y prohíbe imports estáticos (`data/schedule`, `data/plan2023`, etc.) o checks `career.code === 'ISI'` / `isIsi2023` en `src/`.

### 9.4 Auditoría previa a PARTE 1B-2 (Puntos D1–D4, solo diseño — pendiente de ejecución)

#### D1. Plan de helpers puros de textos, oráculo baseline ISI 2023 y textos NO derivables del payload actual
- **Estrategia propuesta para 1B-2:**
  1. Antes de editar componentes de texto, crear un módulo puro (ej. `src/utils/planText.ts`) con helpers sin efectos secundarios que reciban `activePlan` (`career`, `plan`, `config`, `rules`, `subjectsById`) y generen encabezados, subtítulos, etiquetas de niveles, títulos intermedios y textos de reglas especiales.
  2. Agregar un snapshot / oráculo de textos para **ISI Plan 2023** que congele carácter a carácter los strings actuales antes de refactorizar componentes, garantizando cero regresión visual ni de copy para Sistemas.
- **Textos actuales en `src/` que NO pueden derivarse al 100% del catálogo actual (`GET /api/catalog/plans/:planId`) sin fallback neutro o ampliación futura de `config`:**
  1. `"Graduación (Título Ingeniero/a)"` / `"Requisitos para el Título de Ingeniero/a"` (`StatsDashboard.tsx:141, 540`) y `"Para el título de Ingeniero/a..."` (`tutorialSteps.ts:117`): el payload actual no incluye un campo `finalDegreeTitle` (para otras carreras podría ser Licenciatura, Tecnicatura, Ingeniería, etc.; en 1B-2 requiere copy neutro genérico si la carrera/plan no corresponde o incorporar `finalDegreeTitle` opcional más adelante).
  2. Sigla institucional `"UTN"` / `"UTN FRC"` / `"UTN ISI (Plan 2023)"` en `ScheduleSummaryPanel.tsx:65` (encabezado copiado al portapapeles), `ScheduleSummaryPanel.tsx:170` (`horarios-utn-YYYY-MM-DD.ics`), `ElectivesPicker.tsx:179` (`"...sugerencias académicas de la UTN"`) y `ScheduleWeeklyGrid.tsx:129` (`Recreos estándar UTN`): el payload de `/api/catalog/plans/:planId` expone `career` y `plan.config.shortTag` (`"ISI · Plan 2023"`), pero **no** expone `institution.code` ni `faculty.code`. En 1B-2 pueden derivarse desde `planConfig.shortTag` / `activeCareer.name` (con slug neutro para `.ics`), salvo que se agregue `institution`/`faculty` al endpoint en Etapa 2.
  3. `"Cargar demo (3er año)"` / `"Cargar demo: Alumno de 3er año"` (`Navbar.tsx:474, 840`, `OnboardingModal.tsx:135`): la referencia específica a `"3er año"` viene del algoritmo de muestra en `getSampleStudentForPlan` (`storage.ts`), que hoy genera un demo dinámico según `totalLevels` pero su etiqueta UI sigue fija en `"3er año"`.
  4. Etiquetas combinadas de reglas en `StatsDashboard.tsx:153, 658` (`"Materias 1 a 23 + Seminario Integrador 99 + 4 créditos de electivas"` y contador fijo `{23 - missing}`): hoy asumen que el título intermedio exige exactamente materias `1..23`; derivarlo al 100% requiere leer `rule.params.fromCode..toCode` (si la regla en otro plan es `approved_range`) o bien usar `rule.description` de `planRules` para otros tipos de reglas.
  5. Título `"Habilitación PPS"` (`StatsDashboard.tsx:163`): `ppsRequirement` hoy solo contiene `{ referenceSubjectCode }`, sin campo `label`/`description`, por lo que el rótulo `"Habilitación PPS"` queda como convención fija mientras exista `ppsRequirement`.
  6. Textos de `tutorialSteps.ts` (`L35`, `L117`, `L130`) y `SubjectDrawer.tsx` (`L516-531`): los nombres de materia (`"Proyecto Final"`, `"Seminario Integrador"`) sí se derivan por `rule.subjectCode` -> `subjectsById.get(code)?.name`, pero las explicaciones académicas contextuales solo son derivables si se interpola `totalLevels`, `levelLabel`, `requiredElectiveCredits`, `intermediateDegrees[0]` y `rule.description`.

#### D2. Comparación `SUBJECT_SHORT_NAMES` vs `shortName` del catálogo de Sistemas (43 diferencias sobre 60 materias)
El catálogo `server/seed-data/plan2023-catalog.json` define `60` materias; `SUBJECT_SHORT_NAMES` (`src/components/schedule/ScheduleWeeklyGrid.tsx`) tiene `59` entradas (`301` ausente). Se detectaron **43 diferencias** (entre abreviaturas de grilla vs nombres completos, más desalineaciones de ID en electivas `401–408` y `501–514`):

| ID | `SUBJECT_SHORT_NAMES` (grilla actual) | `shortName` en catálogo (`plan2023-catalog.json`) |
|---|---|---|
| `1` | `Análisis Mat. 1` | `Análisis Matemático 1` |
| `2` | `Álgebra y Geom.` | `Álgebra y Geometría Analítica` |
| `5` | `Lógica y Estruct.` | `Lógica y Estructuras Discretas` |
| `6` | `Algoritmos (AED)` | `Algoritmos y Estructuras de Datos` |
| `7` | `Arquitectura (ACO)` | `Arquitectura de Computadoras` |
| `8` | `Sist. y Procesos (SPN)` | `Sistemas y Procesos de Negocio` |
| `9` | `Análisis Mat. 2` | `Análisis Matemático 2` |
| `11` | `Ing. y Sociedad` | `Ingeniería y Sociedad` |
| `13` | `Sintaxis (SSL)` | `Sintaxis y Semántica de los Lenguajes` |
| `14` | `Paradigmas (PPR)` | `Paradigmas de Programación` |
| `16` | `Análisis de Sistemas` | `Análisis de Sistemas de Información` |
| `17` | `Probabilidad y Est.` | `Probabilidad y Estadísticas` |
| `20` | `Desarrollo Software (DDS)` | `Desarrollo de Software` |
| `21` | `Com. de Datos` | `Comunicación de Datos` |
| `23` | `Diseño de Sist. (DSI)` | `Diseño de Sistemas de Información` |
| `25` | `Calidad de Software` | `Ingeniería y Calidad de Software` |
| `26` | `Redes de Datos (RDA)` | `Redes de Datos` |
| `29` | `Automatización (TPA)` | `Tecnologías para la Automatización` |
| `30` | `Admin. de Sistemas` | `Administración de Sistemas de Información` |
| `35` | `Seguridad en Sistemas` | `Seguridad en los Sistemas de Información` |
| `99` | `Seminario Integrador` | `Seminario Integrador (Analista)` |
| `301` | *(no está)* | `Backend de Aplicaciones` |
| `401` | `Gerenciamiento Proyectos` | `Green Software` |
| `402` | `Arquitectura Software` | `Gestión Industrial de la Producción` |
| `403` | `Testing de Software` | `Gestión de la Mejora de los Procesos` |
| `404` | `Seguridad en Redes` | `Desarrollo y Operaciones DevOps` |
| `405` | `Aplic. con Objetos (DAO)` | `Desarrollo de Aplicaciones con Objetos` |
| `406` | `Gobierno de TI` | `Comunicación Multimedial en el Desarrollo de Sistemas de Información` |
| `407` | `Bioinformática` | `Arquitectura de Software` |
| `408` | `Interfaces y UIX` | `Experiencia e Interfaces de Usuario (UI/UX)` |
| `501` | `Criptografía Aplicada` | `Desarrollo de Tecnologías Blockchain` |
| `502` | `Auditoría de Sistemas` | `Creatividad e Innovación en Ingeniería` |
| `503` | `Cloud Computing` | `Auditoría de SI/TI` |
| `504` | `DevOps & CI/CD` | `Gerenciamiento Estratégico` |
| `505` | `Arquitecturas Cloud Nativas` | `Consultoría en Negocios Digitales` |
| `506` | `Deep Learning` | `Emprendimientos Tecnológicos` |
| `507` | `Decisiones (DEC)` | `Decisiones en Escenarios Complejos` |
| `508` | `Procesamiento Lenguaje Natural` | `Testing de Software` |
| `509` | `Seguridad SW (SDS)` | `Seguridad en el Desarrollo de Software` |
| `510` | `Big Data` | `Integración de Aplicaciones en Entorno Web` |
| `511` | `Software Libre (ISFA)` | `Ingeniería de Software de fuentes abiertas/libres` |
| `513` | `Entornos Virtuales` | `Creatividad y Desarrollo de Entornos Virtuales` |
| `514` | `PPS` | `Práctica Profesional Supervisada` |

- **Regla para 1B-2:** en `ScheduleWeeklyGrid`, `getSubjectShortName` **no** debe caer a un diccionario hardcoded por ID (que mostraría nombres de Sistemas si otra carrera comparte códigos `1..N` o `401..514`): debe leer `subject.shortName` del catálogo activo y, si faltara o superara el límite visual, truncar exclusivamente el `fullName` de la materia del catálogo activo (`SUBJECT_SHORT_NAMES` puede conservarse solo como fixture/compatibilidad en `test/scheduleImport.test.ts` o actualizarse tras decisión del dueño del proyecto).

#### D3. Biblioteca (`LibraryHome` y `LibraryTermsPage`) y revisión legal
- Verificado que el nombre exacto en `server/seed-data/plan2023-catalog.json` (`L11`) y `server/tools/generateSeedData.ts` (`L29`) es **`"Ingeniería en Sistemas de Información"`**, idéntico carácter por carácter al texto de `LibraryHome.tsx:287` y `LibraryTermsPage.tsx:62`.
- En `LibraryTermsPage.tsx` (`L62`), cualquier generalización multi-carrera del texto de Términos y Condiciones queda sujeta a **revisión legal pendiente** antes de aplicarse en producción.

#### D4. `vite.config.ts` (`server.proxy`)
- Confirmado que `vite.config.ts` (`L1-8`) solo configura `plugins: [react(), tailwindcss()]`. El bloque `server.proxy` (`/api -> http://localhost:4000`) que se agregará en 1B-2 aplica únicamente al servidor de desarrollo de Vite (`npm run dev`); `vite build` y el despliegue productivo en Vercel (que usa `vercel.json`) no se ven afectados.

### 9.5 Ajustes previos a PARTE 1B-2 (Puntos 1–6)

1. **Configuración para textos en migración `0009`, esquema y normalizador (Puntos 1 y 6):**
   - `server/drizzle/0009_isi_plan_pps_config.sql` ampliada con `finalDegreeTitle: "Ingeniero/a"` y `ppsRequirement: { "referenceSubjectCode": 36, "label": "Habilitación PPS" }` para `ISI Plan 2023` (alineado también en `server/seed-data/plan2023-catalog.json`).
   - Idempotencia mediante merge a izquierda tanto a nivel raíz como dentro de `ppsRequirement` (claves existentes ganan en ambos niveles), actualizando únicamente cuando falta `finalDegreeTitle`, `ppsRequirement` objeto válido, `ppsRequirement.referenceSubjectCode` o `ppsRequirement.label`. La CTE de `catalog_versions` solo inserta/actualiza `'default'` si `upd` modificó filas, usando el mismo formato de `bumpCatalogVersion()` (`v-<ms>-<6hex>`; default inicial `'v1.0.0'` en `getCatalogVersion()`).
   - `normalizePlanConfig` / `normalizePpsRequirement` (`server/src/modules/catalog/planConfig.helpers.ts`) preservan `finalDegreeTitle` y `ppsRequirement.label` solo si existen como strings no vacíos en la base; de lo contrario quedan `undefined` (sin inventar textos de Sistemas ni agregar otros campos a `ppsRequirement`).

2. **Metadatos aditivos de facultad/institución y `CATALOG_CACHE_SCHEMA = 3` (Punto 2):**
   - `catalog.helpers.ts`, `catalog.store.ts`, `catalog.controller.ts` y `planConfig.helpers.ts` enriquecen `GET /api/catalog/plans/:planId` (y `/current`) de forma aditiva con `career.facultyName`, `career.facultyCode`, `career.institutionName` y `career.institutionCode`, manteniendo intactos `id`, `name`, `code` y `facultyId`.
   - `src/api/catalog.api.ts` eleva `CATALOG_CACHE_SCHEMA` de `2` a `3` (descartando entradas cacheadas con esquema anterior) y extiende `isValidPlanCatalogShape` para validar que `facultyName`, `institutionName`, `facultyCode`, `institutionCode`, `finalDegreeTitle` y `ppsRequirement.label`, cuando están presentes (no null), sean strings no vacíos (sin requerir su presencia obligatoria).

3. **Protección de claves legadas en `localStorage` y `LocalStorageMigrationModal` (Punto 3):**
   - `src/utils/storage.ts` incorpora `STORAGE_KEY_LEGACY_PLAN_ID = 'mi_carrera_legacy_plan_id_v1'` y `hasUnmigratedLegacyLocalStorage()`.
   - `migrateLegacyLocalStorageToPlan` **no** auto-migra claves sin sufijo al primer plan que cargue: la migración automática solo ocurre cuando `STORAGE_KEY_LEGACY_PLAN_ID === planId`. Si falta `STORAGE_KEY_LEGACY_PLAN_ID` (datos pre-multicarrera) o corresponde a otro plan, no copia nada y devuelve `migrated: false`.
   - `CareerContext.tsx` y `LocalStorageMigrationModal.tsx`: cuando el servidor no tiene progreso guardado (`!d.hasSavedData`) y existen datos con alcance del plan activo **o** claves legadas sin migrar (`hasUnmigratedLegacyLocalStorage()`), el modal muestra el destino exacto (`activeCareer.name — currentPlanName`), advierte verificar antes de importar datos pre-multicarrera y recién aplica `migrateLegacyLocalStorageToPlan(planId, undefined, { force: true })` cuando el usuario confirma explícitamente.

4. **Auditoría de `SUBJECT_SHORT_NAMES`, `shortName` y campo `code` del payload (Punto 4, solo lectura):**
   - Se detectan **43 diferencias** entre `SUBJECT_SHORT_NAMES` (`src/components/schedule/ScheduleWeeklyGrid.tsx`) y `plan2023-catalog.json`: `21` abreviaturas de troncales/seminario + `7` abreviaturas de electivas de la misma materia, `1` electiva ausente (`301`) y **`14` electivas desfasadas donde el ID en la grilla apunta a otra materia distinta del catálogo y del seed** (`401, 402, 403, 404, 406, 407, 501, 502, 503, 504, 505, 506, 508, 510`, ninguna presente en `server/seed-data/schedule.json`, que solo contiene `405, 408, 507, 509, 511`).
   - Hoy `formatPlanCatalogPayload` (`server/src/modules/catalog/planConfig.helpers.ts:232-233`) emite `code: s.shortName` y `shortName: s.shortName`: en el frontend `subject.shortName` solo se valida en `catalog.api.ts:140` (`ScheduleWeeklyGrid` aún no lo lee), mientras que `subject.code` se muestra como `#{subject.code}` en 14 componentes y se envía como `subjectId` en `ProfessorsDirectory.tsx:607,814` (donde `reviews.store.ts:707` espera `codeInPlan` numérico o `uuid`). Pendiente de definición al iniciar 1B-2.

5. **Protección de `server/seed-data/schedule.json` en `scripts/importSchedule.ts` (Punto 5):**
   - `npm run import:schedule` (`scripts/importSchedule.ts`) sigue operativo tras la eliminación de `src/data/schedule.json`, pero por defecto escribe en `artifacts/schedule.generated.json` (y reporte en `artifacts/import-report.generated.md`, dentro de `artifacts/` ignorado por git). Solo sobrescribe `server/seed-data/schedule.json` cuando se pasa explícitamente `--write-seed` (o `writeSeed: true`). `test/scheduleImport.test.ts` valida ahora `importAllSchedules({ writeOutput: false })` de punta a punta y la protección del seed.

6. **Línea base verificada tras Puntos 1–6 (antes del paquete de correcciones):**
   - **Backend (`npm --prefix server test`):** `370/0` (`reviews 85`, `authVerification 52`, `admin 37`, `library 147`, `multicarreraIsolation 25`, `catalogConfigAndSecurity 24`) + `tsc` OK.
   - **Frontend (`npm test`):** `14/14` archivos en verde (`plan2023Oracle 23`, `multicarreraEngine 9`, `scheduleImport` end-to-end) + `tsc -b && vite build` (`2601` módulos) OK.

### 9.6 Paquete de correcciones previo a PARTE 1B-2 (5 commits, sin cambios visuales ni de copy)

1. **Campo `code` del payload (`formatSubjectDisplayCode`) + filtro `ProfessorsDirectory` + `CATALOG_CACHE_SCHEMA = 4` (commit `3c4fcab`):**
   - `formatPlanCatalogPayload` (`server/src/modules/catalog/planConfig.helpers.ts`) ahora formatea `code` con la regla exacta de los fixtures (`test/fixtures/plan2023.ts` y `test/fixtures/electives.ts`): obligatorias (`kind !== 'electiva'`) -> `String(codeInPlan)`, electivas nuevas `[408, 512, 513, 514]` -> `'X-' + codeInPlan`, resto de electivas (`301`, `401..407`, `501..511`) -> `'E-' + codeInPlan`.
   - `src/components/professors/ProfessorsDirectory.tsx` (desktop `L607` y mobile `L814`) envía `String(sub.id)` en vez de `String(sub.code)` para no romper el filtro `subjectId` de electivas en `GET /api/professors`.
   - `src/api/catalog.api.ts` eleva `CATALOG_CACHE_SCHEMA = 4` para invalidar caches locales que guardaron `code = shortName`.
   - `test/plan2023Oracle.test.ts` reconstruye las `60` materias UI desde el payload real formateado y compara campo por campo contra los fixtures; `server/test/reviews.test.ts` (sección `11.10`) cubre `subjectId` numérico, electiva (`301`), UUID y `'E-301'`.

2. **Auditoría de `subjects.short_name` y migración `0010_isi_plan_short_names.sql` (commit `b710567`):**
   - Verificado que en backend/API/UI ninguna pantalla de reseñas o inscripciones renderiza `shortName` / `subjectShortName`; el único consumidor visual futuro será `ScheduleWeeklyGrid.tsx`.
   - Nueva migración idempotente solo de datos `server/drizzle/0010_isi_plan_short_names.sql` (actualiza las `28` materias alineadas donde `short_name = name` con los valores de `SUBJECT_SHORT_NAMES`, deja intactas las `14` electivas desfasadas y la `301`, e incrementa `catalog_versions` via CTE solo si `UPDATE` tocó filas), junto con actualización equivalente en `server/seed-data/plan2023-catalog.json` y prueba de doble corrida + conservación de ediciones manuales en `server/test/catalogConfigAndSecurity.test.ts`.

3. **Proxy de desarrollo en `vite.config.ts` (commit `3aecbd3`):**
   - Agregado `server.proxy['/api'] -> http://localhost:4000` (`changeOrigin: true`) únicamente para desarrollo local; confirmado `npm run build` sin alteraciones de producción.

4. **Protección contra sobreescritura en hidratación (`src/utils/careerHydrationGuard.ts`, commit `5cb3f8e`):**
   - Extraído coordinador puro e integrado en `CareerContext.tsx` (incluyendo guardia `canSyncServerState` también en `applySimulation` y `canPersistScopedStorage` en efectos locales).
   - `test/multicarreraEngine.test.ts` prueba `(a)` cero auto-sync antes de hidratar `userStateApi.getState()`, `(b)` bloqueo sin sobreescritura vacía cuando falla el catálogo o `getState()`, y `(c)` reseteo sincrónico y descarte de respuestas tardías al cambiar Plan A -> Plan B o cerrar sesión.

5. **Documentación (`docs/prueba-manual-multicarrera.md` y `docs/plan-multicarrera.md`):**
   - `docs/prueba-manual-multicarrera.md` actualizado con chequeo obligatorio anti-producción del host de `DATABASE_URL`, migración `0010`, proxy ya configurado en `vite.config.ts`, `schema: 4`, prueba con cuenta local paralela, verificación desktop/mobile, badges `#1`/`#E-301`/`#X-408`, filtro de profesores y limpieza obligatoria (`server/.env` + rama Neon).
   - **Línea base actual verificada tras el paquete de correcciones (sin empezar 1B-2):**
     - **Backend (`npm --prefix server test`):** **`378` pasaron, `0` fallaron** (`reviews 87`, `authVerification 52`, `admin 37`, `library 147`, `multicarreraIsolation 25`, `catalogConfigAndSecurity 30`) + `npm --prefix server run build` OK (`tsc`).
     - **Frontend (`npm test`):** **`14 / 14` archivos en verde** (`plan2023Oracle 24`, `multicarreraEngine 13`, `scheduleImport` end-to-end, etc.) + `npm run build` OK (`tsc -b && vite build`, `2602` módulos).

### 9.7 Auditoría completa de claves de `Subject`, migración `0011` (`is_integrator`) y freno previo a PARTE 1B-2

1. **Test por `Object.keys` sobre las 60 materias (`test/plan2023Oracle.test.ts`):**
   - Detectó dos claves presentes en `test/fixtures/plan2023.ts` que faltaban en el payload: `isIntegrator` (materias `16, 23, 99, 30, 36`) y `specialRule` (materias `99, 36`).
2. **Corrección de `isIntegrator` (`63fe84b`):**
   - Columna `is_integrator boolean NOT NULL DEFAULT false` agregada en `server/src/db/schema.ts`, migración aditiva e idempotente `server/drizzle/0011_isi_plan_integrator_subjects.sql` (sentencia separada `ADD COLUMN IF NOT EXISTS` + CTE para marcar `[16, 23, 30, 36, 99]` de ISI 2023 con `WHERE is_integrator = false` + bump condicional de `catalog_versions`), actualización de `plan2023-catalog.json`, `generateSeedData.ts`, `seed.ts`, `catalog.store.ts`, `formatPlanCatalogPayload` (campo aditivo opcional `isIntegrator: true`) y `CATALOG_CACHE_SCHEMA = 5` validando `isIntegrator` booleano opcional en `src/api/catalog.api.ts`.
3. **Freno en la condición para seguir (hallazgo `specialRule`):**
   - `SubjectDrawer.tsx` (`L508, L518`) y `QuickStatusModal.tsx` (`L361, L383, L385`) hoy leen `subject.specialRule` para mostrar las tarjetas/avisos de regla especial en `99` y `36`.
   - En el catálogo actual del backend (`formatPlanCatalogPayload`), `subject.specialRule` no existe (las reglas vienen en `plan.rules[]` y con redacción distinta a la de los fixtures), por lo que en el entorno local esa sección no se renderiza. Se frena antes de iniciar 1B-2 para definir si se deriva en frontend desde `plan.rules[]` / config o si se proyecta/alinea en payload.
4. **Línea base verificada tras `0011` (`63fe84b`):**
   - **Backend (`npm --prefix server test`):** **`383` pasaron, `0` fallaron** (`reviews 87`, `authVerification 52`, `admin 37`, `library 147`, `multicarreraIsolation 25`, `catalogConfigAndSecurity 35`) + `tsc` OK.
   - **Frontend (`npm test`):** **`14 / 14` archivos en verde** (`plan2023Oracle 24`, `multicarreraEngine 13`) + `tsc -b && vite build` OK.

### 9.8 Migración `0012` (`specialRule`), `CATALOG_CACHE_SCHEMA = 6`, `SubjectDrawer` por `ruleType` y PARTE 1B-2 — Grupo 1

1. **Resolución de `specialRule` (`b345fb5`):**
   - Diagnóstico previo confirmó que ningún otro flujo funcional lee `plan_special_rules.description` (`admin.controller.ts` solo hace `count(*)`, `correlativas.ts` evalúa `ruleType`/`params`), que ninguna materia de ISI 2023 tiene más de una regla y que `isElective` nunca se compara con `=== undefined` ni `'isElective' in s`.
   - Nueva migración idempotente solo de datos `server/drizzle/0012_isi_plan_special_rules_descriptions.sql` (`idx: 12`): actualiza `plan_special_rules.description` de ISI Plan 2023 (`99` `approved_range` y `36` `all_previous_core_approved`) a los textos exactos de `test/fixtures/plan2023.ts` con condición `psr."description" IS DISTINCT FROM td."description"` y bump CTE condicional en `catalog_versions`. Alineados `server/seed-data/plan2023-catalog.json` y `server/tools/generateSeedData.ts`.
   - `formatPlanCatalogPayload` (`server/src/modules/catalog/planConfig.helpers.ts`) proyecta `specialRule` opcional en cada materia a partir de `rules[]` (uniendo con `' / '` si hubiera varias reglas).
   - `src/api/catalog.api.ts` eleva `CATALOG_CACHE_SCHEMA = 6` y valida que `subjects[].specialRule`, cuando existe y no es `null`, sea string no vacío.
   - `test/plan2023Oracle.test.ts` vacía `FIXTURE_TO_PAYLOAD_KEY_EXCEPTIONS` (`{}` — **0 excepciones** de claves contra los fixtures en las 60 materias).
   - `server/test/catalogConfigAndSecurity.test.ts` incorpora prueba de doble corrida y estado parcial para `0012` + aserciones HTTP sobre `specialRule` en `/api/catalog/plans/current`.

2. **Refactor de `SubjectDrawer.tsx` por `ruleType` (`239525f`):**
   - `SubjectDrawer.tsx` (`renderSpecialRuleSection`) deja de consultar `selectedSubject.id === 36` o `canRenderProyectoFinal` y pasa a usar `resolveSpecialRuleView(selectedSubject, activePlan, activeState, settings.includeAnalistaTrack)` desde `src/utils/planText.ts`, evaluando cualquier materia que posea regla `all_previous_core_approved` en `plan.rules` y quitando la mención del trayecto opcional excluido cuando está desactivado, con paridad exacta de textos para `36` y `99`. `QuickStatusModal.tsx` ya leía `subject.specialRule` sin IDs fijos.

3. **PARTE 1B-2 — Grupo 1 (`src/utils/planText.ts` + `test/planText.test.ts`, sin tocar otros componentes visuales):**
   - Módulo puro `src/utils/planText.ts` con helpers para títulos finales, etiquetas PPS, título intermedio (toggle, tooltip, subtítulo, requisitos y rangos desde `intermediateDegrees[0]` + `approved_range`), `levelLabel` / `totalLevels`, botón/año de demo (`Math.ceil(totalLevels / 2)` -> `3er año`), encabezado portapapeles, nombre `.ics` (`horarios-<institutionCode>-YYYY-MM-DD.ics` o fallback `horarios-cursada-YYYY-MM-DD.ics`), dominio UID, grilla horaria (`getScheduleShortSubjectName` lee solo `shortName` del catálogo y si falta/vacío trunca `name` a `<= 22` caracteres sin diccionario por ID), `LibraryHome` / `LibraryTermsPage` (sustituyendo únicamente el nombre de la carrera) y `buildPlanTutorialSteps`.
   - `test/planText.test.ts` congela carácter por carácter los copys actuales de Sistemas 2023 y verifica fallbacks neutros sin filtración de `UTN`/`ISI`/`Sistemas`/`Analista`/`3er año` sobre una carrera ficticia (`Licenciatura en Biotecnología`, `4` cuatrimestres).

4. **Textos o convenciones NO derivables al 100% desde `career` / `plan.config` / `rules` / `subjects` actuales (listados para decisión del usuario antes de Grupo 2):**
   - `StatsDashboard.tsx:641` (`"Título Intermedio: Analista Universitario de Sistemas"`) y `StatsDashboard.tsx:152` (`"Título Intermedio: Analista Universitario"`): el catálogo en DB/seed (`plan2023-catalog.json`, `0008`) define `intermediateDegrees[0].name = "Analista Universitario en Sistemas"` (`"en Sistemas"` vs `"de Sistemas"` en el card de L641, y forma acortada en L152). Además `Navbar.tsx` (`"Analista (99)"`, `"Título Analista (99)"`) y `tutorialSteps.ts:128` (`"Título Intermedio de Analista"`) dependen hoy de tomar la primera palabra (`"Analista"`) salvo que se agregue un campo opcional `shortLabel` en `intermediateDegrees[0]`.
   - `StatsDashboard.tsx:164` (`"Cumplís los requisitos para cursar la Práctica Profesional"`): `ppsRequirement` actual solo tiene `{ referenceSubjectCode, label }`, sin `description`; si otra carrera llama distinto a su práctica final (ej. Pasantía/Residencia), mantendría la frase `"la Práctica Profesional"` salvo agregar `description` opcional o copy neutro.
   - `ElectivesPicker.tsx:179` (`"...son solo sugerencias académicas de la UTN."`): la preposición/artículo `"de la"` funciona para `"UTN"`, `"UNC"`, `"UBA"`, etc., pero una institución masculina (ej. `"ITBA"`) requeriría artículo neutro (`"según sugerencias académicas del plan (UTN)"` o convención en Grupo 2).
   - `ScheduleWeeklyGrid.tsx:129-138` (`RECREOS` `"Recreos estándar UTN"`): la grilla de recreos (`09:30–09:40`, `12:50–13:15 Cambio de turno`, etc.) es propia de UTN FRC y no viaja en `/api/catalog/*` ni en `/api/catalog/schedule`.
   - `StatsDashboard.tsx:385` (`"* Las electivas no tienen carga horaria definida, por eso este valor no las incluye"`): asume modelo de ISI 2023 con electivas de `weeklyHours = 0`; si un plan futuro tuviera electivas con horas semanales > 0, convendría verificar si aplica.
   - `LibraryTermsPage.tsx:62` (referencia a `"Ingeniería en Sistemas de Información"` en texto legal de Términos y Condiciones): helper `getLibraryTermsIntroParagraph` reemplaza únicamente el nombre de carrera sin alterar el cuerpo legal; su aplicación en UI sigue sujeta a confirmación del usuario en Grupo 2 (§9.4 D3).

5. **Línea base verificada tras Parte 1B-2 Grupo 1:**
   - **Backend (`npm --prefix server test`):** **`389` pasaron, `0` fallaron** (`reviews 87`, `authVerification 52`, `admin 37`, `library 147`, `multicarreraIsolation 25`, `catalogConfigAndSecurity 41`) + `npm --prefix server run build` OK (`tsc`).
   - **Frontend (`npm test`):** **`15 / 15` archivos en verde** (`plan2023Oracle 24/0` con `0` excepciones de claves, `multicarreraEngine 13/0`, `planText 4/0`) + `npm run build` OK (`tsc -b && vite build`, `2603` módulos).

---

### 9.9 Migración 0013 y PARTE 1B-2 — Grupo 2 (Tanda 2a)

1. **Decisiones cerradas aplicadas en Grupo 2 / Migración `0013`:**
   - **1) Título intermedio (`0013`):** verificado mediante búsqueda completa en el repositorio que `intermediateDegrees[0].name` no es leído en paneles admin, envíos de mail ni endpoints distintos al catálogo normalizado. La migración `0013_isi_plan_intermediate_and_pps_copy.sql` hace merge a izquierda en `intermediateDegrees[0]` incorporando `"shortLabel": "Analista"` y `"shortTitle": "Analista Universitario"`, actualiza `"Analista Universitario en Sistemas"` -> `"Analista Universitario de Sistemas"` (preservando nombres custom editados desde admin) y conserva cualquier elemento `[1..]`. Fallbacks neutros en `planText.ts`: `shortLabel` usa la primera palabra de `name`; `shortTitle` usa `name`.
   - **2) Descripción PPS (`0013`):** `0013` agrega `"description": "Cumplís los requisitos para cursar la Práctica Profesional"` en `ppsRequirement` mediante merge a izquierda sin pisar claves existentes; el fallback neutro en `planText.ts` es `"Cumplís los requisitos académicos exigidos por el plan"`.
   - **3) Artículo femenino en `ElectivesPicker`:** queda registrada la limitación conocida de `"de la ${institutionCode}"` (`"de la UTN"`), adecuada para instituciones con artículo femenino; si en el futuro se incorpora una institución de artículo masculino (ej. `"ITBA"`), requerirá campo/convención de artículo antes de publicarla.
   - **4) `RECREOS` en `ScheduleWeeklyGrid.tsx`:** queda anotado explícitamente para **Etapa 3** (plantilla horaria por facultad, junto con el esquema de turnos de UTN FRC) ya que los recreos estándar UTN forman parte de la grilla horaria institucional y no del catálogo mínimo actual.
   - **5) Exclusión de electivas en `careerPercentageByHours` (`evaluatePlanProgress`):** verificado por diseño en `src/utils/correlativas.ts` (`totalWeeklyHours` y `approvedWeeklyHours` suman únicamente sobre `activeCoreSubjects`, mientras `electives` solo acumulan créditos en su propio bucle aun si alguna electiva tiene `weeklyHours > 0`). En `StatsDashboard.tsx` la nota al pie se condicionó a `electives.length > 0` (`getWeeklyHoursElectiveFootnote(electives.length)`), con test unitario explícito en `test/multicarreraEngine.test.ts`.
   - **6) `LibraryTermsPage.tsx`:** queda anotada para revisión explícita de copy legal antes de introducir cualquier sustitución de carrera en Tanda 2b/2c.

2. **Tanda 2a completada (sin alterar textos ni diseño en ISI Plan 2023):**
   - `src/components/stats/StatsDashboard.tsx`: iteración dinámica por `getLevelNumbers(planConfig)`, tarjeta y hito de título intermedio condicionados a `primaryIntermediateDegree && settings.includeAnalistaTrack`, tarjeta PPS vía `ppsRequirement`, créditos electivos protegidos contra división por cero y todos los textos vía `planText.ts`.
   - `src/components/common/Navbar.tsx`: los 3 toggles del título intermedio condicionados a `primaryIntermediateDegree`, etiqueta del demo calculada desde `allSubjects` y textos vía `planText.ts`.
   - `src/components/common/UserMenu.tsx`: eliminación del default `'Plan 2023'` y fallback neutro `'Plan de estudio'` desde `useCareer()`.
   - `src/data/tutorialSteps.ts`, `src/components/tutorial/TutorialSpotlight.tsx` y `src/context/CareerContext.tsx`: textos neutros en `TUTORIAL_STEPS` derivados dinámicamente mediante `buildPlanTutorialSteps(getAvailableTutorialSteps(...), activePlan)` (manteniendo las 17 entradas en la definición base y sincronizando el conteo en `nextTutorialStep` y `goToTutorialStep`).
   - Confirmado que `src/components/graph/SubjectDrawer.tsx` y `src/components/common/QuickStatusModal.tsx` ya operaban por `ruleType`/`subject.specialRule` vía `resolveSpecialRuleView`.
   - Agregado en `test/planText.test.ts` el chequeo estático sobre los 7 archivos de Tanda 2a garantizando `0` textos fijos de Sistemas y `0` códigos de materia `99`/`36` (fuera de los literales CSS/SVG/RGB documentados).

3. **Línea base verificada tras Migración 0013 (commit `49432f9`) y Tanda 2a:**
   - **Backend (`npm --prefix server test`):** **`393` pasaron, `0` fallaron** (`reviews 87`, `authVerification 52`, `admin 37`, `library 147`, `multicarreraIsolation 25`, `catalogConfigAndSecurity 45`) + `npm --prefix server run build` OK (`tsc`).
   - **Frontend (`npm test`):** **`15 / 15` archivos en verde** (`plan2023Oracle 24/0`, `multicarreraEngine 13/0`, `planText 5/0`) + `npm run build` OK (`tsc -b && vite build`, `2603` módulos).
   - **Estado:** detenido tras **Tanda 2a**, antes de **Tanda 2b** y **Tanda 2c**.

---

### 9.10 Verificaciones previas y PARTE 1B-2 — Grupo 2 (Tanda 2b)

1. **Verificaciones pre-Tanda-2b (commit `df61517`):**
   - **1) Demo "3er año" (`getSampleStudentForPlan` en `src/utils/storage.ts`):** se detectó que la heurística anterior por módulo (`idx % 3` / `idx % 4`) **no** reproducía materia por materia el estado exacto de `getSample3rdYearStudent()` (escenario `03-sample-3rd-year-no-fails-in-gpa` del oráculo), y que ni la función anterior ni la actual almacenaban fechas (`date`). Se reescribió `getSampleStudentForPlan(plan)` sin hardcodear códigos ni `'ISI'`, reproduciendo exactamente las 21 materias y `assignedElectives` (`{ 1: [], 2: [], 3: [301], 4: [404], 5: [] }`) en ISI Plan 2023 (test de paridad agregado en `test/plan2023Oracle.test.ts`: `plan2023Oracle` pasa de 24 a **25/0**).
   - **2) Recorrido del tutorial (`computeNextTutorialStep`, `computePrevTutorialStep`, `clampTutorialStep`):** los tests previos cubrían los 17 pasos estáticos (`correlativas.test.ts`), el filtro desktop 17 / mobile 16 (`scheduleAvailability.test.ts`), layout (`tutorialLayout.test.ts`, `mobileFrontend.test.ts`) y la generación neutra sin electivas ni título intermedio (`planText.test.ts`), pero no había prueba pura del avance/retroceso/clamp paso a paso. Se extrajeron los tres helpers puros en `src/utils/planText.ts` conectados a `CareerContext.tsx` y se testearon sobre ISI Plan 2023 (17 desktop / 16 mobile) y sobre un plan de 3 niveles sin título intermedio ni electivas (15 desktop / 14 mobile).

2. **Tanda 2b completada (selectores puros en `src/utils/planViewSelectors.ts` + 8 componentes, sin alterar diseño ni regex mobile):**
   - `buildGraphViewStructure` -> `src/components/graph/CorrelativeGraph.tsx`: columnas/niveles dinámicos vía `getLevelNumbers(planConfig)` y `levelLabel`, botón de electivas condicionado a `showElectivesToggle` (`electives.length > 0 || requiredElectiveCredits > 0`), `sampleSubjectId` dinámico (sin fallback fijo a materia `1`).
   - `buildSubjectListViewStructure` -> `src/components/graph/SubjectListView.tsx`: agrupación dinámica por niveles (`1..totalLevels`) con rótulos `getLevelOrdinalTabLabel` e invocación explícita de `checkEligibility` sin niveles fijos `1..5`.
   - `buildSubjectNodeViewModel` -> `src/components/graph/SubjectNode.tsx`: badges derivados del objeto `Subject` (`#code`, `N<level>`/`<levelLabel> <assignedYear>`, `INT`, `ELECT`, horas, créditos, nota).
   - `buildKanbanBoardStructure` -> `src/components/kanban/KanbanBoard.tsx`: subtítulo y rango de niveles parametrizados (`getKanbanBoardSubtitle`, `getKanbanLevelsRangeTag`), filtros y agrupamiento "Por Nivel" generados desde `getLevelNumbers(planConfig)` sin `1..5` fijos.
   - `buildSemesterPlannerStructure` -> `src/components/planner/SemesterPlanner.tsx`: cálculo de disponibles/canasta/carga horaria y toggle `"Incluir Electivas"` condicionado a `showIncludeElectivesToggle`.
   - `buildElectivesPickerStructure` -> `src/components/electives/ElectivesPicker.tsx`: niveles 1..`totalLevels` dinámicos en chips, tarjetas, select y modales; niveles sugeridos derivados de `electives` (`suggestedLevels`, sin `[3, 4, 5]` fijos); textos vía `planText.ts` y estado vacío cuando `!hasElectivesBlock`.
   - `buildOnboardingModalStructure` -> `src/components/onboarding/OnboardingModal.tsx`: niveles dinámicos `1..totalLevels` (`defaultGradeByLevel` sin objeto inicial `{ 1..5 }`) y botón demo vía `getDemoOnboardingLabel(planConfig)`.
   - `buildSearchModalStructure` -> `src/components/common/SearchModal.tsx`: filtros de nivel `1..totalLevels` en desktop/mobile y placeholder dinámico desde `subjects` + `acronyms` del plan activo vía `getSearchModalDesktopPlaceholder`.
   - Tests añadidos en `test/planText.test.ts` (**`8/0`**): (a) paridad completa de los 8 selectores entre el payload normalizado `ISI_PLAN` y los fixtures de 60 materias (`CORE_SUBJECTS`, `ELECTIVES`, `ACRONYM_TO_ID`), (b) validación estructural neutra sobre un plan ficticio de 3 cuatrimestres sin título intermedio ni electivas (`showElectivesToggle === false`, `showIncludeElectivesToggle === false`, `hasElectivesBlock === false`, `suggestedLevelGroups.length === 0`, `0` menciones de `Analista`/`UTN`/`Sistemas`/`Ingeniero`/`4°`/`5°`/`Año`), (c) auditoría estática extendida a los 16 archivos de Tanda 2a + Tanda 2b + `planViewSelectors.ts` sin literales académicos fijos ni códigos `99`/`36` (con allowlist documentada de clases Tailwind/RGBA/decimales). Todos los tests regex existentes (`mobileFrontend.test.ts`, `scheduleAvailability.test.ts`, `tutorialLayout.test.ts`, `scheduleLayout.test.ts`) pasan sin modificaciones.

3. **Referencias restantes a Sistemas fuera de Tanda 2a/2b (pendientes de Tanda 2c / Etapa 3):**
   - `src/components/schedule/ScheduleSummaryPanel.tsx` (`L65`, `L151`, `L170`): `'UTN ISI (Plan 2023)'`, `'@micarrera.utn'`, `'horarios-utn-...'` -> **Tanda 2c** (helpers ya listos en `planText.ts`).
   - `src/components/schedule/ScheduleWeeklyGrid.tsx` (`L67–L107`, `L129–L138`): diccionario `SUBJECT_SHORT_NAMES` por ID -> **Tanda 2c** (`getScheduleShortSubjectName`); y `RECREOS` `'Recreos estándar UTN'` -> **Etapa 3** (grilla horaria institucional por facultad).
   - `src/components/library/LibraryHome.tsx` (`L287`) y `src/components/library/LibraryTermsPage.tsx` (`L62`, `L77`): menciones a `'Ingeniería en Sistemas de Información'` -> **Tanda 2c** (sujeto a revisión de copy legal en Términos).
   - `src/utils/libraryUploadLogic.ts` (`L101`): comentario `'por omisión en biblioteca UTN'` -> limpieza menor en **Tanda 2c**.
   - Identificadores internos de compatibilidad (`includeAnalistaTrack`, `isAnalistaEligible`, `missingForAnalista`, `canRenderSeminario`, `checkAnalistaTitle`, `id: 'analista-switch'`, `[data-tour="analista-button"]` y alias legacy en `correlativas.ts` / `storage.ts` / `types/career.ts` / `tutorialLayout.ts`): nombres de propiedades de contratos internos sin exposición en textos visibles de UI.

4. **Línea base verificada tras `df61517` y Tanda 2b (aprobada):**
   - **Backend (`npm --prefix server test`):** **`393` pasaron, `0` fallaron** (`reviews 87`, `authVerification 52`, `admin 37`, `library 147`, `multicarreraIsolation 25`, `catalogConfigAndSecurity 45`) + `npm --prefix server run build` OK (`tsc`).
   - **Frontend (`npm test`):** **`15 / 15` archivos en verde** (`plan2023Oracle 25/0`, `multicarreraEngine 13/0`, `planText 8/0`, `mobileFrontend 37/0`, `scheduleAvailability 13/0`, `tutorialLayout 12/0`, `scheduleLayout 6/0`, `brand 33/0`, `libraryFrontend 31/0`, `apiContract 2/0`, más `correlativas`, `scheduleImport`, `reviewsFrontend`, `authFrontend`, `adminFrontend`) + `npm run build` OK (`tsc -b && vite build`).

---

### 9.11 Corrección de nombre oficial del título intermedio (Commit 1)

1. **Actualización a `"Analista Universitario de Sistemas de Información"`:**
   - Reemplazado en `server/drizzle/0013_isi_plan_intermediate_and_pps_copy.sql` (ampliando la condición para actualizar tanto el legado `'Analista Universitario en Sistemas'` como el intermedio `'Analista Universitario de Sistemas'`, manteniendo idempotencia, preservando nombres personalizados distintos y disparando la CTE de `catalog_versions` solo cuando hay filas modificadas), `server/seed-data/plan2023-catalog.json`, `server/tools/generateSeedData.ts` y los fixtures/tests correspondientes (`test/correlativas.test.ts`, `test/planText.test.ts`, `server/test/catalogConfigAndSecurity.test.ts`).
   - Se conservan sin cambios `shortLabel` (`"Analista"`) y `shortTitle` (`"Analista Universitario"`).
   - **Única diferencia visible intencional respecto de producción:** en `StatsDashboard`, la tarjeta de requisitos del título intermedio pasa a mostrar `"Título Intermedio: Analista Universitario de Sistemas de Información"` (en producción mostraba `"Título Intermedio: Analista Universitario de Sistemas"`). Documentado también en `docs/prueba-manual-multicarrera.md`.
   - Además se incorpora `getScheduleIcsProdId()` en `src/utils/planText.ts` junto con la cobertura de `getScheduleIcsUidDomain`, `getScheduleIcsProdId` y `getScheduleIcsFilename`.

---

### 9.12 PARTE 1B-2 — Grupo 2 (Tanda 2c, Commit 2)

1. **Selectores puros agregados en `src/utils/planViewSelectors.ts` (7 funciones puras):**
   - `buildScheduleWeeklyGridSubjectLabel`: resuelve etiquetas cortas de materia exclusivamente mediante `getScheduleShortSubjectName` + `subjectsById` del catálogo (sin diccionarios por ID).
   - `buildScheduleSummaryExportMetadata`: centraliza `clipboardHeader`, `icsProdId`, `icsUidDomain` e `icsFilename` desde `activePlan`.
   - `buildScheduleBuilderStructure`: encapsula el armado de materias habilitadas/disponibles, electivas asignadas, mapa de horarios/nombres y carga horaria seleccionada.
   - `buildLibraryHomeStructure`: deriva cantidad de niveles, `hasElectives`, descripción del hero y pestañas de filtro (`Todas las materias`, niveles `1°..N° <levelLabel>`, `Electivas` condicional).
   - `isPlanSelected`: compara identidad del plan activo estrictamente por `plan.id` (no por nombre visible).
   - `buildProfessorsDirectoryStructure`: genera lista ordenada y opciones `<level>° · <name>` por materia del plan activo.
   - `buildAdminPlanSubjectOptions`: construye opciones `#<code> <name>` a partir de `coreSubjects` del plan activo.

2. **Componentes y utilidades refactorizados (10 archivos de Tanda 2c):**
   - `src/components/schedule/ScheduleWeeklyGrid.tsx`: eliminado `SUBJECT_SHORT_NAMES` (`Record<number, string>`); re-exporta `getScheduleShortSubjectName as getSubjectShortName`; recibe `subjectsById` por prop desde `ScheduleBuilder.tsx` (sin importar `CareerContext` ni disparar `audio.ts` en entorno Node) y delega en `buildScheduleWeeklyGridSubjectLabel`. Se preserva `PLURAL_DAYS_MAP` y el comentario de `RECREOS` queda anotado para Etapa 3.
   - `src/components/schedule/ScheduleSummaryPanel.tsx`: conecta `useCareer().activePlan` y `buildScheduleSummaryExportMetadata(activePlan)` para portapapeles y `.ics` (preservando `@micarrera.utn`, `PRODID:-//Stack//Armador de Horarios//ES` y `horarios-utn-YYYY-MM-DD.ics` en ISI 2023).
   - `src/components/schedule/ScheduleBuilder.tsx`: adopta `buildScheduleBuilderStructure` y pasa `subjectsById` a las dos instancias de `<ScheduleWeeklyGrid />`.
   - `src/components/library/LibraryHome.tsx`: adopta `buildLibraryHomeStructure`, sustituye niveles `[1, 2, 3, 4, 5]` fijos y pasa `career={activeCareer}` a `<LibraryTermsPage />`.
   - `src/components/library/LibraryTermsPage.tsx`: reemplaza únicamente el párrafo introductorio mediante `getLibraryTermsIntroParagraph(career, APP_NAME)` (sin importar `CareerContext` en SSR/Node), manteniendo intactos las cláusulas legales y `CONTACT_EMAIL`.
   - `src/components/common/PlanSelectorModal.tsx`: determina el plan seleccionado mediante `isPlanSelected(p.id, activePlan?.plan.id)` sin sumar diálogos ni flujos de Etapa 4.
   - `src/components/professors/ProfessorsDirectory.tsx`: adopta `buildProfessorsDirectoryStructure(allSubjects)` conservando los `<option>` claveados por `sub.id`.
   - `src/components/admin/tabs/AdminScheduleTab.tsx` y `src/components/admin/tabs/AdminReviewsTab.tsx`: usan `buildAdminPlanSubjectOptions(subjects)` en selectores de materias sin reescribir endpoints administrativos.
   - `src/utils/libraryUploadLogic.ts`: reemplazo de comentario residual `"biblioteca UTN"` por `"la biblioteca comunitaria"`.

3. **Relevamiento del alcance actual del Panel de Administración (solo informe, sin cambios en backend):**
   - **Acciones globales (todas las facultades/planes, sin filtro por `planId`/`facultyId`):** `AdminOverviewTab` (`GET /api/admin/stats`), `AdminUsersTab` (`/api/admin/users/*`), `AdminAuditTab` (`/api/admin/audit-logs`), `AdminLibraryTab` (`/api/admin/library/*`: pendientes, catálogo, reportes, aprobación/rechazo/baja/suspensión de autor), cola de moderación (`GET /api/admin/reviews/reports`), listado de reseñas (`GET /api/admin/reviews` y `/reviews/all`), ocultar/restaurar reseña, resolver reporte y suspender autor de reseña. En listados de reseñas y biblioteca se muestra `subjectName`/`subjectCode` sin etiqueta de carrera/plan.
   - **Horarios (`AdminScheduleTab` y `/api/admin/terms|commissions|schedules`):** `schedule_terms` opera a nivel **`facultyId`** (`setCurrentScheduleTerm` desmarca el resto de la misma facultad afectando a todas las carreras/planes de esa facultad; `duplicateScheduleTerm` clona un término origen; `listTerms` lista todos los términos globales). `commissions` y `createCommission`/`editCommission`/`retireCommission`/`deleteCommission` operan por `termId`/`commissionId`/`subjectId` (UUID) sin validar coincidencia contra el plan activo del admin. Se observa además un desacople preexistente entre los selects del frontend (`codeInPlan` vía `String(s.id)` y `{ name, year }`) y los controladores (`UUID` en `subjects.id` y `{ facultyId, academicYear, term }`).
   - **Docentes (`AdminReviewsTab` y `ReviewsService`):** `adminListProfessors` / `duplicates` operan sobre la **`facultyId` del plan activo del admin** (`resolvePlanContext(adminUserId, req.user?.selectedPlanId)`); `adminMergeProfessors` exige igual `facultyId` pero consolida comisiones/reseñas/ofertas de todos los planes de esa facultad; `adminCreateHistoricalProfessor` resuelve `resolvePlanContext(adminUserId)` en DB (`users.selected_plan_id`) para buscar `codeInPlan` al vincular materia (riesgo si el estado cliente difiere tras cambiar de plan).

4. **Tests y línea base tras cierre completo de Tanda 2c / Etapa 1B-2:**
   - `test/planText.test.ts` ampliado a **11/0**: auditoría estática extendida a los **26** archivos (`Tanda 2a + 2b + 2c + planViewSelectors.ts + tutorialSteps.ts`), paridad de selectores Tanda 2c sobre payload normalizado ISI 2023, estructura neutra en plan de 3 cuatrimestres sin título intermedio ni electivas, y prueba de equivalencia exacta de `buildAdminPlanSubjectOptions` respecto al código previo de `AdminScheduleTab` y `AdminReviewsTab`.
   - `test/scheduleImport.test.ts` actualizado con fixture histórico congelado (`test/fixtures/subjectShortNames.ts`, `59` claves de `8c28227`), paridad `100%` en las `41` materias presentes en `server/seed-data/schedule.json` y enumeración explícita de las `15` diferencias esperadas (`301` + `14` electivas reasignadas `401–404, 406–407, 501–506, 508, 510`) sobre las `60` materias del catálogo normalizado.
   - **Backend (`npm --prefix server test`):** **`399` pasaron, `0` fallaron** (`reviews 87`, `authVerification 52`, `admin 37`, `library 147`, `multicarreraIsolation 25`, `catalogConfigAndSecurity 51`) + `npm --prefix server run build` OK (`tsc`).
   - **Frontend (`npm test`):** **`15 / 15` archivos en verde** (`plan2023Oracle 25`, `multicarreraEngine 13`, `planText 11`, `scheduleLayout 6`, `mobileFrontend 37`, `apiContract 2`, `scheduleAvailability 13`, `tutorialLayout 12` + 7 suites standalone en verde incluyendo `scheduleImport`) + `npm run build` OK (`tsc -b && vite build`, `2604` módulos).
   - **Panel de admin / Etapa 2:** las `4` condiciones bloqueantes (`a`–`d`) del panel de administración quedan documentadas en la sección **7.4** sin modificarse en esta etapa.

5. **Hallazgo bloqueante detectado en el ensayo manual (`_journal.json` de migraciones `0011`–`0013`) y corrección:**
   - **Qué pasó:** en el ensayo sobre la rama de Neon copiada de producción, `npm --prefix server run db:migrate` aplicó hasta `0010` (`drizzle.__drizzle_migrations` terminó en `id = 11`, `created_at = 1793700000000`) y reportó éxito (`exit 0`), pero **omitió `0011` (`subjects.is_integrator`), `0012` y `0013`**.
   - **Causa y por qué ocurría igual en Render:** las entradas `0011`–`0013` en `server/drizzle/meta/_journal.json` tenían `"when"` en abril 2026 (`1776729600000`–`1776902400000`), menor que `0010` (`1793700000000`) y también menor que `0007` (`1793670000000`, estado actual de producción en Render). `drizzle-orm` (`PgDialect.migrate`) consulta solo `ORDER BY created_at DESC LIMIT 1` antes de la transacción única y aplica únicamente filas donde `Number(lastDbMigration.created_at) < migration.folderMillis`. Por eso, tanto en la rama copiada como al desplegar en Render desde `0007`, `0008`–`0010` se aplicaban y `0011`–`0013` quedaban silenciosamente salteadas.
   - **Corrección aplicada (`c04fbb9`, commit propio):** en `server/drizzle/meta/_journal.json` se corrigieron únicamente los `"when"` de `0011`, `0012` y `0013` a `1793710000000`, `1793720000000` y `1793730000000` (ninguna base real había aplicado `0011`–`0013` vía `migrate`).
   - **Blindaje en tests (`server/test/catalogConfigAndSecurity.test.ts` sección `1f`):** verifica que todos los `"when"` del journal sean estrictamente crecientes en orden del arreglo, correspondencia exacta `1:1` entre `.sql` y `_journal.json`, y simulación exacta del criterio `drizzle-orm` desde `0007`, desde `0010` y desde base vacía. Se demostró que falla con el journal previo (`c5d321f`) y pasa completo con el corregido. La guarda en tiempo de ejecución (`server/src/db/migrationGuard.ts`) quedó implementada en `db:migrate` (aborta con `exit 1`) y en `app.ts` (`console.error` visible sin abortar el arranque).

---

## 10. Etapa 2 — Decisiones aprobadas, tramos (2A–2D) y línea base inicial

### 10.1 Línea base de arranque en rama `etapa2` (desde `master` `7bdf590`)
- **Estado desplegado en producción (Etapa 1):** migraciones `0008` a `0013` aplicadas en Neon/Render (último `when` del journal: `1793730000000` en `0013_isi_plan_intermediate_and_pps_copy`).
- **Tests y builds de partida:** Frontend **`15 / 15` archivos en verde**; Backend **`423` pasaron, `0` fallaron**; ambos builds (`npm run build` y `npm --prefix server run build`) OK.
- **Organización por tramos:** **Tramo 2A** (SheetJS 0.20.3 vendored + migración `0014` `display_code` + plantilla/parser en worker + servicio/endpoints backend), **Tramo 2B** (Frontend `"Carreras"` en `/#admin` + vista previa solo lectura), **Tramo 2C** (Desbloqueo real de `DrizzleUserStateStore` y migración `0015` de `user_settings` + `schedule_selections` en 2 despliegues), **Tramo 2D** (Corrección de bloqueantes admin `a–d`, ciclo de vida `publish`/`unpublish`/`archive` y documentación `docs/api-multicarrera.md`). Cada tramo frena al completar sus commits lógicos y tests esperando aprobación.

### 10.2 Decisiones y ajustes aprobados (1–9)
1. **SheetJS (`server/` vs raíz):** En `server/package.json` se reemplaza `"xlsx": "^0.18.5"` por `"xlsx": "file:./vendor/xlsx-0.20.3.tgz"` sin alias y sin ninguna copia de `0.18.5` en `server/`. `server/vendor/xlsx-0.20.3.tgz` queda versionado en Git (`.gitignore`/`.gitattributes` verificados sin exclusiones), validado con `mergeProfessors.ts`, `migrateProfessors.ts` y compilación/instalación limpia aislada de `server/` (`NODE_ENV=production`). La raíz conserva `xlsx@0.18.5` únicamente en `devDependencies` para `scripts/importSchedule.ts` y `test/scheduleImport.test.ts`; se verifica que `vite build` (`dist/`) no incluya `xlsx`.
2. **Parser en `worker_threads` + lock de concurrencia:** Todo parseo de `.xlsx` corre en `worker_threads` con `resourceLimits`, timeout explícito (`5000 ms`, `worker.terminate()`), `env: {}` sin secretos y límite global de **1 importación o vista previa simultánea** (rechaza concurrentes con HTTP `409`/`429`). Prevalidaciones previas obligatorias: extensión `.xlsx`, tamaño `<= 5 MB`, firma ZIP (`PK\x03\x04`), rechazo de macros VBA, máximo `10` hojas y `2000` filas, lectura solo de valores sin evaluación de fórmulas y copia a objetos sin prototipo (`Object.create(null)`).
3. **Tipos de `plan_special_rules` reconciliados con `src/utils/correlativas.ts`:** Verificado en `evaluateSpecialRule` (`src/utils/correlativas.ts`): el motor actual **solo** evalúa `'approved_range'` (`{ fromCode, toCode }`) y `'all_previous_core_approved'` (`{ excludeTrackKeys? }`). **`min_credits` no existe hoy en `correlativas.ts`** (ni en sus tipos ni en el evaluador). El importador acepta exclusivamente `['approved_range', 'all_previous_core_approved']` y rechaza cualquier otro tipo (incluido `min_credits`) como error bloqueante hasta que se implemente y pruebe en el motor en un cambio aparte. Test de paridad obligatorio entre constantes del importador y `evaluateSpecialRule`.
4. **Confirmación validada con archivo crudo (`POST /api/admin/plans/import`):** El endpoint recibe nuevamente el archivo `.xlsx` original + las decisiones del admin (vínculos a `shared_subjects` y destino facultad/carrera/plan) + `previewHash`. El servidor re-parsea y re-valida el archivo completo, recalcula `previewHash(archivo + decisiones)` y rechaza con error ante cualquier discrepancia. No se acepta ningún plan pre-parseado desde el navegador. `admin_audit_log` guarda únicamente un resumen (hash, facultad, carrera/plan y conteos), nunca bytes ni payload del archivo.
5. **Sin refactor de `CorrelativeGraph.tsx` en Etapa 2:** Se descarta tocar `CorrelativeGraph.tsx` (componente acoplado a layout `Dagre` + estado de alumno). En Tramo 2B, el detalle del plan en admin usa un componente nuevo de solo lectura en formato tabla/árbol por nivel usando datos normalizados del plan.
6. **Secuencia de migración `0015` (Tramo 2C, `when: 1793750000000`):** Primero se despliega el código actualizado de `DrizzleUserStateStore` y se verifica en rama Neon `0` filas con `plan_id IS NULL` en `user_settings` y `schedule_selections` (nota: con la PK compuesta vieja `user_id`, ese código previo no podía escribir 2 filas; si hubiera rollback tras aplicar `0015`, el código viejo con una sola PK asumía `LIMIT 1`). Recién en un segundo despliegue se aplica `0015` (PK compuesta `(user_id, plan_id)` en `user_settings` y ajuste de índice en `schedule_selections`) tras verificar `0` nulos en Neon. Las nuevas migraciones siguen estrictamente el patrón aditivo e idempotente con CTE sobre `catalog_versions` (`id = 'default'`) solo cuando cambian filas reales (`0014` con `when: 1793740000000`; `0015` con `when: 1793750000000`).
7. **Semántica de ciclo de vida de planes (`draft` / `published` / `archived`, Tramo 2D):**
   - `draft -> published`: exige al menos 1 materia, reglas válidas y `shared_subjects` vinculados sin huérfanos en el plan.
   - `published -> draft` (despublicar): **solo si tiene `0` usuarios con ese `selected_plan_id`**.
   - `published -> archived` (archivar): permitido aun con usuarios activos. Un plan `archived` queda oculto en el selector público y registro para nuevos usuarios, pero **sigue devolviéndose en el catálogo/estado para los usuarios que ya lo tienen seleccionado**.
8. **Orden de rutas Express y contrato API:** `GET /api/admin/plans/template` se registra estrictamente **antes** que `GET /api/admin/plans/:id`. Se eliminan los stubs rotos `POST /api/admin/careers` y `POST /api/admin/plans`. `test/apiContract.test.ts` verifica contrato y orden de rutas.
9. **Cierre por tramo:** Ningún archivo bajo `server/src/` importa fuera de `server/` (`server/tools/generateSeedData.ts` queda excluido de `tsconfig.json` y `dist/` como herramienta dev que lee `test/fixtures/`). Toda verificación reporta cifras exactas reales post-último cambio.

### 10.3 Estado implementado — Tramo 2A + Ajustes `a)–g)` (frenado antes de Tramo 2B por auditoría `d)`)

- **SheetJS `0.20.3` vendored (`4faf3c1`):** `server/vendor/xlsx-0.20.3.tgz` (`2409319` bytes, SHA-256 `8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8`) reemplaza por completo `xlsx@0.18.5` en `server/package.json` (`"xlsx": "file:vendor/xlsx-0.20.3.tgz"`) y `server/package-lock.json`. Compilación limpia aislada de `server/` (`NODE_ENV=production`) verificada y `vite build` sin `xlsx` en `dist/assets/`.
- **Migración `0014` (`db878f8`, paridad `a95af0b`):** `server/drizzle/0014_subject_display_code.sql` (`when: 1793740000000`) agrega `subjects.display_code varchar(32)` de forma aditiva/idempotente, puebla `E-`/`X-` exclusivamente en ISI 2023 y `code_in_plan::text` en el resto, y actualiza `catalog_versions` (`id = 'default'`) solo si modificó filas. `formatSubjectDisplayCode` desacopla por completo los prefijos `E-`/`X-` para planes no-ISI. Paridad exacta carácter por carácter verificada en `test/multicarreraEngine.test.ts` sobre las `60` materias de ISI 2023 más valores `displayCode` personalizados.
- **Plantilla, worker y reglas (`60a4ae0` + ajustes `a`, `c`, `e`: `8156f86`, `bb4a6f0`, `c2387ed`):** `planImport.rules.ts`, `planImport.template.ts`, `planImport.worker.ts` y `planImport.parser.ts` implementan la plantilla neutra `"Plan Ingeniería Ficticia 2026"` (`5` niveles, `8` obligatorias, `2` electivas, título intermedio, PPS e integradora final, cero datos de Sistemas/Industrial), evaluada también contra el motor real `correlativas.ts` (`test/multicarreraEngine.test.ts`). Hoja `Instrucciones` con columna concreta `Ejemplo` en todas las columnas; hoja `Reglas` con columnas simples (`Desde código`, `Hasta código`, `Trayectos excluidos`, `Descripción` opcional con texto por defecto); coherencia estricta `Modalidad`/`Contra-cuatrimestral`; bloqueo de claves `__proto__`/`constructor`/`prototype` en encabezados y celdas; prevalidaciones (`5 MB`, `.xlsx`, `PK\x03\x04`, sin macros ni fórmulas, máx. `10` hojas / `2000` filas), detección de ciclos DFS, lock global = 1 (`409`), `worker_threads` con `resourceLimits`, timeout `5000 ms` y aislamiento estricto de secretos (`env: {}` en JS compilado). Paridad de reglas verificada en `test/correlativas.test.ts` (únicamente `approved_range` y `all_previous_core_approved`; `min_credits` bloqueado).
- **Servicio, endpoints y matching intra-facultad (`a67c02a` + ajuste `g`: `b3b0be7`):** `planImport.service.ts`, `admin.controller.ts` y `admin.routes.ts` implementan `GET /api/admin/plans` (enriquecido), `GET /api/admin/plans/template` (antes de `/:id`), `POST /api/admin/plans/preview` (estrictamente solo lectura con preservación de vínculos cruzados previos en re-subida `draft`), `POST /api/admin/plans/import` (`requireRecentReauth`, validación estricta de `previewHash`, creación/actualización idempotente `draft`, auditoría resumida sin archivo), `GET /api/admin/plans/:id` (inclusive `draft`) y `DELETE /api/admin/plans/:id` (`requireRecentReauth`, bloqueo si hay referencias o plan no `draft`). Eliminados `POST /api/admin/careers` y `POST /api/admin/plans`. Normalización romano-arábiga (`I`..`XX` <-> `1`..`20`, `exact`/`high`) y detección conservadora `similar`/`low` (plurales/variantes léxicas con bloqueo estricto cuando difiere cualquier número de nivel), sin autovincular jamás.
- **Hallazgo de auditoría `d)` en `src/utils/correlativas.ts` (freno previo a Tramo 2B):**
  - El motor actual **no soporta completamente** el caso `(i)` (título intermedio **sin** materia hito especial: al omitir `specialRuleSubjectCode` no hay `plan_special_rules` con `approved_range`, `missingCoreIds = []` y `checkAnalistaTitle` devuelve `eligible: true` con `0` materias aprobadas) ni el caso `(ii)` (subconjunto **no contiguo** de obligatorias: `evaluateSpecialRule` `'approved_range'` filtra `s.id >= fromCode && s.id <= toCode` sin excepciones ni lista discreta).
  - Sí soporta `(iii)` (título intermedio sin créditos de electivas), switch en `Navbar.tsx` sin materias `isOptionalTrack`, e `isPPSEligible` apuntando tanto a obligatorias como a electivas (nota: solo verifica `regularPrereqs`/`approvedPrereqs`, no `plan.rules` del destino).
  - Por decisión de etapa, **se frena antes del Tramo 2B y no se modifica aún `src/utils/correlativas.ts`** a la espera de aprobación del cambio mínimo de motor/plantilla propuesto para `(i)` y `(ii)`.
- **Línea base actualizada tras ajustes `a)–g)` de Tramo 2A:**
  - Frontend (`npm test`): **`15 / 15` archivos en verde** (`apiContract`, `correlativas`, `plan2023Oracle` `25`, `multicarreraEngine` `16`, `planText` `11`, entre otros) + `npm run build` OK (`tsc -b && vite build`).
  - Backend (`npm --prefix server test`): **`482` pasaron, `0` fallaron** (`reviews 92`, `authVerification 59`, `admin 37`, `library 149`, `multicarreraIsolation 28`, `catalogConfigAndSecurity 63`, `planImport 54`) + `npm --prefix server run build` OK (`tsc`).
  - Próximo hito inicial superado y aprobado: **Tramo 2A aprobado** (línea base verificada `frontend 15/15`, `backend 482/0`; SHA-256 del tarball `server/vendor/xlsx-0.20.3.tgz` verificado contra descarga independiente).
- **10.4. Paso 2 reducido (título intermedio) y reglas invariantes (aprobado):**
  - El plan oficial de la primera carrera real (**Ingeniería Industrial UTN FRC**) modela su título intermedio con **1 materia hito de trayecto opcional** (*Gestión Industrial*) + regla `approved_range` de `1` a `25` + `0` créditos de electivas del título, cubierto íntegramente por el modelo actual sin ampliar el esquema.
  - **Cambios aplicados (Paso 2 reducido):**
    - `checkAnalistaTitle` (`src/utils/correlativas.ts`): un título intermedio sin ningún criterio evaluable devuelve `eligible: false` (antes devolvía `true` con `0` aprobadas); sin cambios para Sistemas (oráculo 25/25 intacto).
    - Importador (`server/src/modules/admin/planImport.worker.ts` y plantilla `planImport.template.ts`): rechaza como error bloqueante un título intermedio sin criterio evaluable (`(materia hito existente + Trayecto opcional = SI + regla approved_range) || créditos electivas título > 0`), valida que la materia hito exista en `Materias`, tenga `Trayecto opcional = SI`, coincida con `Clave trayecto intermedio` si se declara, y tenga su regla `approved_range` en `Reglas`.
  - **Invariante documentado (`isPPSEligible`):** `isPPSEligible` NO cambia de significado; evalúa únicamente correlativas (`regularPrereqs` y `approvedPrereqs`) de la materia de referencia (obligatoria o electiva), sin evaluar `plan.rules` (en Sistemas la `36` tiene `all_previous_core_approved` que la tarjeta PPS no exige; cambiarlo rompería escenarios `05–07` del oráculo).
  - **Alcance de motor con título estilo Industrial y materia obligatoria final sin regla especial:**
    - `approved_range` (`evaluateSpecialRule`) filtra `!s.isElective && s.id !== rule.subjectCode && s.id >= fromCode && s.id <= toCode`, por lo que cuenta solo obligatorias del rango excluyendo la materia hito.
    - Con interruptor de trayecto opcional apagado (`includeAnalistaTrack = false`), `getActiveCoreSubjects` oculta la materia hito del mapa (`CorrelativeGraph` / `buildGraphViewStructure`), la excluye del numerador y denominador de `evaluatePlanProgress` y la excluye de `calculateCriticalPath`.
    - Una materia obligatoria con correlativas explícitas y sin regla especial (como Proyecto Final de Industrial) funciona sin cambios (`getSubjectStatus`, `canRenderProyectoFinal`, `isDegreeEligible`, `SubjectDrawer`).
  - **Diferidos hasta que un plan real los necesite** (motivo: Ingeniería Industrial UTN FRC queda cubierto por el modelo actual de materia hito + `approved_range`):
    - `requiredSubjectCodes` en `PlanIntermediateDegree` / motor.
    - `requiredSubjectRange` (rango con códigos excluidos) en `PlanIntermediateDegree` / motor.
    - Nuevas columnas de la hoja `Plan` en la plantilla de importación para listas o rangos con exclusiones de título intermedio.
    - Cambio del subtítulo mobile (`getIntermediateDegreeMobileSubtitle` en `src/utils/planText.ts`).
    - Cambio del paso `'analista-switch'` del tutorial (`buildPlanTutorialSteps` en `src/utils/planText.ts`).
- **10.5. Endurecimiento de seguridad `2(a)–(c)` (commit `dc90572`, 7/7 suites backend en verde y `68/0` en `planImport.test.ts`):**
  - **Zip bombs (`2a`):** `inspectZipBombLimits` en `server/src/modules/admin/planImport.worker.ts` inspecciona el Directorio Central EOCD/ZIP64 y descomprime por entrada con `zlib.inflateRawSync(..., { maxOutputLength })` antes de `XLSX.read` (límites en `planImport.rules.ts`: 256 entradas, 20 MB/entrada, 32 MB totales, relación máxima 100x si el tamaño descomprimido supera 2 MB). Responde con `PlanImportUncompressedLimitError` (`PLAN_IMPORT_UNCOMPRESSED_LIMIT`, HTTP `413`), mantiene el servidor vivo y libera el lock.
  - **Aislamiento del worker compilado (`2b`):** probado directamente contra `dist/modules/admin/planImport.{parser,worker}.js` verificando `env: {}` (variables sensibles `JWT_SECRET`, `DATABASE_URL`, `REFRESH_SECRET`, `ADMIN_REAUTH_SECRET` inaccesibles), `resourceLimits` (`maxOldGenerationSizeMb: 128`, `maxYoungGenerationSizeMb: 32`) aplicados al `Worker` y captura controlada `PlanImportWorkerError` ante OOM (`ERR_WORKER_OUT_OF_MEMORY`).
  - **Lock ante errores no controlados (`2c`):** `withPlanImportLock` garantiza liberación en `finally` también ante excepciones imprevistas del almacén/servidor (HTTP `500` controlado y siguiente preview libre).
- **10.6. Tramo 2B completado — Frontend `"Carreras"` en `/#admin`:**
  - `src/api/admin.api.ts`: endpoints `listPlans`, `getPlanDetail`, `getPlanTemplateDownloadUrl`, `downloadPlanTemplate`, `previewPlanImport`, `confirmPlanImport` y `deleteDraftPlan`.
  - `src/components/admin/AdminDashboard.tsx`: pestaña `'careers'` (`"Carreras"`).
  - `src/components/admin/tabs/AdminPlanReadOnlyViewer.tsx` + `adminCareersHelpers.ts`: inspección estructural por nivel en modo solo lectura (sin importar ni refactorizar `CorrelativeGraph`), reglas especiales, trayecto opcional/título intermedio, acrónimos y vínculos compartidos.
  - `src/components/admin/tabs/AdminCareersTab.tsx`: listado filtrado, descarga de plantilla `.xlsx`, asistente de importación y re-importación de borradores (`draftDiff`), matcher compartido sin auto-vinculación en planes nuevos con invalidación automática de firma (`isPreviewStale`) al modificar archivo/destino/decisiones, eliminación de borradores y reautenticación vía `AdminReauthModal`; botón `Publicar` visible pero deshabilitado hasta Tramo 2C/2D.
- **10.7. Estado actual:** **Tramo 2B cerrado** -> pendiente de avanzar hacia **Tramo 2C/2D** (catálogo multi-plan, publicación y selección de carrera/plan por el estudiante).
