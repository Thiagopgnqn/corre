# Guía de Verificación Manual — Etapa 2 (Tramo 2A + Paso 2 + Tramo 2B)

Esta guía documenta cómo ejecutar de forma segura sobre una **rama temporal de Neon** (nunca producción ni R2 real):
1. Las migraciones locales hasta `0014_subject_display_code` usando **únicamente** `db:migrate`.
2. El script manual de verificación Drizzle real ([`verifyImportNeon.ts`](../server/src/scripts/verifyImportNeon.ts)).
3. La prueba manual en navegador sobre `/#admin` → **Carreras** subiendo el borrador `.xlsx` de **Ingeniería Industrial (Plan 2023)**.

> [!CAUTION]
> **No ejecutes nada de esta guía contra la base de producción ni uses credenciales reales de envío de correo o almacenamiento.**
> - Confirmá siempre que el **host** de `DATABASE_URL` y `DIRECT_URL` pertenezca a tu rama temporal de Neon.
> - En Etapa 2 (`Tramo 2B`), el botón **`Publicar`** permanece **deshabilitado** intencionalmente hasta el `Tramo 2C/2D`.

---

## 1. Crear rama temporal en Neon y configurar `server/.env` local

1. En la consola de **Neon**, creá una rama temporal a partir de tu estado actual (por ejemplo, `test-etapa2`).
2. Copiá las dos URLs de conexión de esa **rama temporal**:
   - **Pooled** (`-pooler`) → `DATABASE_URL`
   - **Direct** (sin `-pooler`) → `DIRECT_URL`
3. **Control obligatorio anti-producción:** compará el endpoint (`ep-...`) del host en ambas URLs contra tu base de producción. Si coincide o tenés dudas, **abortá** antes de continuar.
4. En `server/.env` (archivo ignorado por Git), dejá **solo** variables locales de desarrollo (sin correo real, sin OAuth de producción y sin R2):

```env
NODE_ENV=development
PORT=4000
CLIENT_ORIGIN=http://localhost:5173

# Cadena pooled y directa EXCLUSIVAMENTE DE TU RAMA TEMPORAL DE NEON
DATABASE_URL=postgresql://usuario:clave@ep-rama-temporal-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://usuario:clave@ep-rama-temporal.us-east-2.aws.neon.tech/neondb?sslmode=require

# Secretos ficticios solo para desarrollo local (>= 16 caracteres)
JWT_SECRET=dev_local_jwt_secret_key_minimo_16_chars
REFRESH_SECRET=dev_local_refresh_secret_minimo_16_chars
VERIFICATION_CODE_PEPPER=dev_local_pepper_secret_minimo_16_chars
CONTACT_EMAIL=contacto@stack.local
```

> [!WARNING]
> **Omití por completo** `EMAIL_PROVIDER`, `RESEND_API_KEY`, `BREVO_API_KEY`, `ADMIN_NOTIFICATION_EMAIL`, `GOOGLE_CLIENT_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET`.
> Con `NODE_ENV=development` y esas variables omitidas, `MailerService` usa el modo consola (`provider: 'dev-console'`) sin enviar correos reales a usuarios copiados en la rama temporal, y `getR2Service()` usa `MemoryMockR2Service` en memoria sin tocar Cloudflare R2.

---

## 2. Aplicar migraciones solo vía `db:migrate` (hasta `0014`)

> [!IMPORTANT]
> Nunca ejecutes archivos `.sql` de `server/drizzle/` manualmente: eso desincroniza la tabla interna `drizzle.__drizzle_migrations` e invalida la prueba.

1. Compilá el backend y corré la primera pasada del migrador:

```powershell
npm --prefix server run build
npm --prefix server run db:migrate
```

2. Verificá en el SQL Editor de tu rama temporal de Neon:

```sql
SELECT id, hash, created_at
FROM "drizzle"."__drizzle_migrations"
ORDER BY created_at ASC;
```

   - Si venías de Etapa 1 (`0013` aplicada), esta corrida aplica `0014_subject_display_code`.
   - El journal completo (`0000` a `0014`) contiene **`15` filas** y la última fila debe mostrar `created_at = 1793740000000`.
3. Ejecutá una segunda vez `npm --prefix server run db:migrate` para confirmar idempotencia (debe finalizar sin aplicar cambios adicionales y mantener exactamente `15` filas).

---

## 3. Correr el script manual `verifyImportNeon.ts`

El script [`server/src/scripts/verifyImportNeon.ts`](../server/src/scripts/verifyImportNeon.ts) **nunca forma parte de `npm test`**. Usa el almacén real [`DrizzlePlanImportStore`](../server/src/modules/admin/planImport.service.ts) contra Postgres/Neon, exige confirmación explícita (`ALLOW_DESTRUCTIVE_TEST=1` + `--host-ok=<host>`), escribe únicamente registros temporales aislados con prefijo `__VERIFY_IMPORT_<runId>__` y limpia todo en `finally` (incluso si falla algún `assert`).

1. Primer paso (detección segura de host sin credenciales):

```powershell
$env:ALLOW_DESTRUCTIVE_TEST = "1"
npm --prefix server run verify:import-neon
```

   El script imprime únicamente el hostname de `DATABASE_URL` (y `DIRECT_URL` si existe), sin usuario ni contraseña, y sale con código `1` indicándote el argumento exacto `-- --host-ok=<host>`.

2. Verificá visualmente que `<host>` pertenezca a tu rama temporal (nunca producción) y ejecutalo con confirmación explícita:

```powershell
npm --prefix server run verify:import-neon -- --host-ok=<host>
Remove-Item Env:ALLOW_DESTRUCTIVE_TEST -ErrorAction SilentlyContinue
```

3. Qué verifica automáticamente contra Neon real:
   - **`[1/6]` Vista previa (`previewPlanImport`):** lee la plantilla `"Ingeniería Ficticia"` sin insertar filas (`0` escrituras en `careers`, `study_plans`, `shared_subjects` ni `admin_audit_log`) y detecta sugerencia compartida (`Dibujo Técnico`) sin autovincular (`selectedDecision: null`).
   - **`[2/6]` Creación en `draft` (`confirmPlanImport`):** crea el plan en borrador (`10` materias, `12` correlativas, `2` reglas especiales, `4` acrónimos, `1` `shared_subject` vinculada + `9` nuevas) y valida `getAdminPlanDetail`.
   - **`[3/6]` Re-importación idempotente (`existing_draft_plan`):** confirma `toCreateCodes: 0`, `toUpdateCodes: 10`, `toRemoveCodes: 0` y preserva exactamente los **`10/10` UUIDs** de materias y sus `sharedSubjectId`.
   - **`[4/6]` Protección de planes `published`:** comprueba que tanto `previewPlanImport` como `confirmPlanImport` rechazan con HTTP `409` (`PLAN_NOT_DRAFT`) al intentar importar sobre un plan publicado.
   - **`[5/6]` Rollback ACID en PostgreSQL:** fuerza un error real de foreign key en `replacePlanPrerequisites` tras haber insertado carrera, plan y materias dentro de la transacción y verifica que PostgreSQL revierte el lote completo (`0` registros huérfanos).
   - **`[6/6]` Eliminación de borrador (`deleteAdminDraftPlan`):** elimina el `draft`, verifica cascada sobre `study_plans`, `subjects`, `plan_special_rules` y `acronyms`, elimina las `9` `shared_subjects` huérfanas y **preserva** la `shared_subject` compartida con el plan par.
   - **`finally`:** elimina cualquier registro con prefijo `__VERIFY_IMPORT_<runId>__` y verifica `0` residuos antes de cerrar el pool.

---

## 4. Levantado local y verificación UI en `/#admin` → `Carreras`

### 4.1 Levantar servidores y preparar usuario admin de prueba

1. En dos terminales desde la raíz del repo:

```powershell
# Terminal 1 (backend)
npm --prefix server run dev

# Terminal 2 (frontend)
npm run dev
```

2. Abrí `http://localhost:5173`, registrá un usuario de prueba con email y contraseña (la contraseña hace falta porque `AdminReauthModal` solicita reautenticación reciente antes de importar o borrar borradores).
3. El código de verificación aparece en la consola de Terminal 1 (`dev-console`), o podés verificarlo y darle rol `admin` en esa rama temporal desde terminal:

```powershell
npm --prefix server run verify-user -- --email tu-usuario-de-prueba@ejemplo.com
npm --prefix server run make-admin -- --email tu-usuario-de-prueba@ejemplo.com
```

4. Volvé a iniciar sesión en `http://localhost:5173` para obtener sesión con rol `'admin'` y navegá a `http://localhost:5173/#admin` → pestaña **Carreras**.

### 4.2 Flujo manual paso a paso con Ingeniería Industrial (`artifacts/industrial/industrial-plan-2023.xlsx`)

> [!NOTE]
> El archivo local `artifacts/industrial/industrial-plan-2023.xlsx` está excluido del repositorio mediante `.gitignore` (`artifacts/`).
> Alcance acordado de esta primera carga de Industrial: **sin** materia `"Gestión Industrial"`, **sin** título intermedio y **sin** PPS (`200` horas previas a Proyecto Final no modeladas).

1. **Descargar plantilla oficial:**
   - Hacé clic en **`Descargar plantilla (.xlsx)`** (`GET /api/admin/plans/template`) y verificá que descarga `plantilla-plan-estudio.xlsx` con la hoja `Instrucciones`.
2. **Subir `.xlsx` de Industrial y ejecutar vista previa:**
   - Seleccioná la facultad existente (donde reside Sistemas).
   - En **`Modo de destino`**, elegí **`Nueva carrera + primer plan (draft)`**.
   - Completá **`Nombre de la carrera`** (`Ingeniería Industrial`) y **`Código de carrera`** (`IIND`).
   - Cargá el archivo local `artifacts/industrial/industrial-plan-2023.xlsx`.
   - Pulsá **`Ejecutar vista previa (solo lectura)`**.
   - Verificá en el resumen de vista previa:
     - Resultado: **`Válido para importar`** (`0` errores, `0` advertencias).
     - Contenido esperado: **`56 materias · 222 correlativas`** (`42` obligatorias + `14` electivas; `101` regulares + `121` aprobadas) y **`6 hojas · 328 filas`**, `0` reglas especiales y `0` acrónimos.
3. **Verificar sugerencias compartidas sin autovínculo y recalculo de firma:**
   - En la sección **Materias compartidas (misma facultad · sin autovínculo)**, revisá las sugerencias detectadas contra materias existentes de la misma facultad (Sistemas) y confirmá que **ninguna viene preseleccionada ni autovinculada** (`Decisión explícita` sin vínculo salvo elección manual tuya).
   - Si cambiás una decisión explícita después de correr la vista previa, verificá que aparezca el botón **`Recalcular vista previa y hash (cambió la configuración o vínculos)`** antes de poder confirmar.
4. **Confirmar creación del borrador:**
   - Pulsá **`Confirmar importación en draft`**, completá la reautenticación en `AdminReauthModal` y verificá que el plan queda listado con estado `draft`.
5. **Inspeccionar detalle solo lectura:**
   - En el listado de planes, pulsá **`Inspeccionar`** sobre `IIND · Plan 2023` (`GET /api/admin/plans/:id`).
   - Confirmá la estructura por niveles (`1` a `5`), los **`10`** créditos electivos requeridos (`5` slots equivalentes), título final **`Ingeniero/a Industrial`**, ausencia de título intermedio/PPS, correlativas e integridad de materias.
6. **Verificar aislamiento del catálogo público (sin exponer el `draft`):**
   - Copiá el UUID del plan `draft` recién creado y verificá desde PowerShell (sin cookies):

```powershell
# Reemplazá <DRAFT_PLAN_ID> por el UUID del borrador de Industrial
Invoke-WebRequest -Uri "http://localhost:4000/api/catalog/plans/<DRAFT_PLAN_ID>" -SkipHttpErrorCheck | Select-Object StatusCode, Content
Invoke-RestMethod -Uri "http://localhost:4000/api/catalog/careers" | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri "http://localhost:4000/api/catalog/plans/current" | Select-Object -ExpandProperty data | Select-Object -ExpandProperty plan | Format-List
```

   - Resultados esperados:
     - `/api/catalog/plans/<DRAFT_PLAN_ID>` devuelve HTTP **`404`** (`Plan de estudio no encontrado`).
     - `/api/catalog/careers` y `/api/catalog/plans/current` continúan devolviendo únicamente **Ing. en Sistemas de Información (Plan 2023)** con sus **`60`** materias intactas.
7. **Probar re-importación idempotente sobre el `draft`:**
   - Pulsá **`Re-importar`** en la fila del borrador de Industrial, volvé a cargar exactamente el mismo `industrial-plan-2023.xlsx` y ejecutá **`Ejecutar vista previa (solo lectura)`**.
   - Confirmá en **Diferencias sobre el draft existente** que muestra: **`Crear: 0 · Actualizar: 56 · Quitar: 0`**, y confirmá la re-importación verificando que no se duplicaron materias ni correlativas.
8. **Comprobar botón `Publicar` deshabilitado y limpiar borrador:**
   - Verificá que **`Publicar`** figura visible pero **deshabilitado** con el aviso de que se habilitará en Tramo 2C/2D.
   - Pulsá **`Eliminar`** → **`Eliminar borrador`** (`AdminReauthModal`) y confirmá que el borrador de Industrial desaparece del listado sin afectar el plan publicado de Sistemas.
