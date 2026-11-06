# Contrato de API: Biblioteca de Material de Estudio ("Stack")

Este documento especifica el contrato HTTP real y verificado entre el backend Node.js (`server/src/modules/library/library.routes.ts` y `server/src/modules/admin/admin.routes.ts`) y el cliente frontend (`src/api/library.api.ts`).

---

## 1. Endpoints de Estudiantes (`/api/library/*`)

Todos los endpoints requieren sesión activa (`requireAuth`) y correo electrónico verificado (`requireVerifiedEmail`).
Todas las mutaciones (`POST`, `PATCH`, `DELETE`) exigen la cabecera `X-Requested-With` (`csrfProtection`).

| Método | Ruta | Query / Params | Body | Auth / Reauth | Descripción |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/library/terms-status` | - | - | Sesión + Email | Consulta si el usuario aceptó los términos vigentes. |
| `POST` | `/api/library/accept-terms` | - | `{ version?: string }` | Sesión + Email + CSRF | Registra la aceptación de los términos de la biblioteca. |
| `GET` | `/api/library/subjects` | `?planId=uuid` | - | Sesión + Email | Listado de materias con conteo de archivos aprobados. Alias: `/subjects-summary`. |
| `GET` | `/api/library/files` | `?subjectId=uuid&kind=...&year=2024&term=1C&professorId=uuid&hasSolution=true&search=...&sort=recent&page=1&pageSize=20` | - | Sesión + Email | Catálogo de materiales aprobados con filtros y paginación. Alias: `/subjects/:subjectId/files`. |
| `GET` | `/api/library/files/:id` | `:id` (UUID de archivo) | - | Sesión + Email | Detalle público de un material aprobado. |
| `POST` | `/api/library/uploads/init` | - | Ver schema abajo | Sesión + Email + CSRF | Reserva cuota e inicializa subida a R2, devuelve URL prefirmada PUT. |
| `POST` | `/api/library/uploads/:id/complete` | `:id` (UUID de archivo) | `{ fileId?: string }` | Sesión + Email + CSRF | Valida stream de R2, calcula hash SHA-256 y pasa a moderación (`pending`). |
| `GET` | `/api/library/files/:id/download` | `:id` (UUID de archivo) | - | Sesión + Email | Retorna URL prefirmada GET de 5 min con Content-Disposition attachment. |
| `POST` | `/api/library/files/:id/helpful` | `:id` (UUID de archivo) | - | Sesión + Email + CSRF | Conmuta (toggle) voto útil del estudiante sobre el material. |
| `POST` | `/api/library/files/:id/report` | `:id` (UUID de archivo) | `{ reason: string, note?: string }` | Sesión + Email + CSRF | Envía denuncia comunitaria sobre un material. |
| `GET` | `/api/library/my-uploads` | `?peek=1` (opcional) | - | Sesión + Email | Lista aportes del usuario con estado y uso de cuota. `?peek=1` no consume novedades. |
| `PATCH` | `/api/library/my-uploads/:id` | `:id` (UUID de archivo) | Ver schema abajo | Sesión + Email + CSRF | Edita metadata de un aporte propio (`pending` o `approved`). |
| `DELETE` | `/api/library/my-uploads/:id` | `:id` (UUID de archivo) | - | Sesión + Email + CSRF | Elimina físicamente el material propio en R2 y en la base de datos. |

---

### Detalle de Payloads y Respuestas (Estudiantes)

#### `GET /api/library/terms-status`
```json
{
  "success": true,
  "data": {
    "accepted": true,
    "version": "1.0",
    "acceptedAt": "2026-11-02T18:00:00.000Z",
    "currentVersion": "1.0"
  }
}
```

#### `POST /api/library/accept-terms`
Body: `{ "version": "1.0" }`
```json
{
  "success": true,
  "data": {
    "accepted": true,
    "version": "1.0",
    "acceptedAt": "2026-11-02T19:00:00.000Z"
  }
}
```

#### `GET /api/library/subjects` (o `/api/library/subjects-summary`)
```json
{
  "success": true,
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Análisis Matemático I",
      "codeInPlan": 101,
      "level": 1,
      "kind": "integradora",
      "approvedFilesCount": 14
    }
  ]
}
```

#### `POST /api/library/uploads/init`
Body:
```json
{
  "subjectId": "11111111-1111-4111-8111-111111111111",
  "kind": "parcial",
  "academicYear": 2024,
  "term": "1C",
  "examInstance": "1er Parcial",
  "hasSolution": true,
  "title": "Primer Parcial 1C 2024 Turno Noche con resolución",
  "description": "Incluye ejercicios prácticos y justificación teórica.",
  "originalFilename": "parcial1-2024.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 2450000,
  "professorIds": ["22222222-2222-4222-8222-222222222222"],
  "acceptTerms": true
}
```
*Validaciones de metadata adicionales:*
- `academicYear`: número entero entre 2000 y el año actual. Si es menor a 2000 o futuro, devuelve 400 `INVALID_METADATA`.
- `term`: valores permitidos `'1C'`, `'2C'`, `'A'` o vacío. Cualquier otro valor devuelve 400 `INVALID_METADATA`.

Respuesta exitosa:
```json
{
  "success": true,
  "data": {
    "fileId": "33333333-3333-4333-8333-333333333333",
    "uploadUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/library/3333.pdf?X-Amz-...",
    "storageKey": "library/33333333-3333-4333-8333-333333333333.pdf",
    "expiresInSeconds": 600
  }
}
```

Códigos de error específicos:
- `429 LIMIT_PENDING_UPLOADS`: Se alcanzó el tope de 30 archivos en estado `pending` o `uploading`.
- `429 LIMIT_STORAGE_QUOTA`: El tamaño solicitado excede los 300 MB totales del usuario.
- `429 LIMIT_RATE_EXCEEDED`: Límite defensivo de 120 llamadas a `/uploads/init` en 10 minutos excedido. Incluye cabecera HTTP `Retry-After: <segundos>`.

#### `POST /api/library/uploads/:id/complete`
Respuesta exitosa:
```json
{
  "success": true,
  "data": {
    "success": true,
    "file": {
      "id": "33333333-3333-4333-8333-333333333333",
      "status": "pending",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    "message": "Tu archivo quedó en revisión; te avisaremos en \"Mis aportes\" cuando esté publicado."
  }
}
```

En caso de duplicado de archivo por hash criptográfico (concurrente o preexistente):
```json
{
  "success": false,
  "code": "DUPLICATE_FILE",
  "error": "Ya existe un archivo idéntico en el sistema."
}
```

En caso de saturación del semáforo de validación en Node (máx 3 concurrentes, timeout 10 s):
```json
{
  "success": false,
  "code": "LIBRARY_BUSY",
  "error": "El servicio de procesamiento de archivos se encuentra ocupado. Reintentá en unos segundos."
}
```
*(Incluye cabecera HTTP `Retry-After: 2`)*.

#### `GET /api/library/my-uploads?peek=1`
*(Nota: la lista `uploads` omite automáticamente cualquier archivo en estado `uploading` que no haya sido completado).*

Respuesta:
```json
{
  "success": true,
  "data": {
    "uploads": [
      {
        "id": "33333333-3333-4333-8333-333333333333",
        "title": "Primer Parcial 1C 2024",
        "status": "approved",
        "rejectionReason": null,
        "sizeBytes": 2450000,
        "downloadCount": 12,
        "helpfulCount": 5
      }
    ],
    "quota": {
      "usedBytes": 2450000,
      "maxBytes": 314572800,
      "pendingCount": 1,
      "maxPending": 30
    },
    "hasStatusUpdates": false
  }
}
```

---

## 2. Endpoints de Administración (`/api/admin/library/*`)

Todas las rutas requieren rol `admin` (`requireAdmin`), rate limiter específico de administración (`adminRateLimiter`) y CSRF en mutaciones. Las acciones críticas exigen reautenticación reciente (`requireRecentReauth`).

| Método | Ruta | Query / Params | Body | Reauth | Descripción |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/admin/library/stats` | - | - | No | Métricas de archivos aprobados, pendientes, reportes y bytes en R2. |
| `GET` | `/api/admin/library/pending` | - | - | No | Cola de moderación con materiales en estado `pending`. |
| `GET` | `/api/admin/library/files` | `?status=all&subjectId=uuid&kind=...&search=...&page=1&pageSize=20` | - | No | Catálogo general de archivos para administración. |
| `GET` | `/api/admin/library/files/:id/preview-url` | `:id` (UUID) | - | No | Genera URL firmada temporal para previsualizar documento en iframe/img. |
| `PATCH` | `/api/admin/library/files/:id/approve` | `:id` (UUID) | - | No | Aprueba y publica el material en el catálogo público. |
| `PATCH` | `/api/admin/library/files/:id/reject` | `:id` (UUID) | `{ reason: string }` | No | Rechaza el material comunicando el motivo al estudiante en sus aportes. |
| `PATCH` | `/api/admin/library/files/:id/remove` | `:id` (UUID) | `{ reason?: string }` | **Sí** | Oculta / da de baja un material publicado por infracción. |
| `GET` | `/api/admin/library/files/:id/uploader` | `:id` (UUID) | - | **Sí** | Consulta la identidad del uploader y registra `library.view_uploader`. |
| `POST` | `/api/admin/library/files/:id/suspend-author`| `:id` (UUID) | `{ reason: string }` | **Sí** | Suspende la cuenta del autor y audita `library.suspend_author`. |
| `GET` | `/api/admin/library/reports` | `?status=open` | - | No | Lista denuncias comunitarias de la biblioteca. |
| `PATCH` | `/api/admin/library/reports/:id` | `:id` (UUID) | `{ status: "open" \| "dismissed" \| "actioned" }` | No | Actualiza el estado de resolución de un reporte. |
| `POST` | `/api/admin/library/files/:id/resend-admin-notification` | `:id` (UUID) | - | No | Reenvía manualmente el aviso de material pendiente a los administradores. |
| `POST` | `/api/admin/library/test-storage` | - | - | **Sí** | Prueba conexión R2 (subida, lectura, borrado de un objeto) sin tocar datos reales. |

---

### Detalle de Payloads y Respuestas (Administración)

#### `POST /api/admin/library/test-storage`
Respuesta:
```json
{
  "success": true,
  "data": {
    "success": true,
    "isMock": false,
    "steps": {
      "upload": { "ok": true, "message": "Subida exitosa (PUT)" },
      "read": { "ok": true, "message": "Lectura exitosa (GET) coincidente" },
      "delete": { "ok": true, "message": "Borrado exitoso (DELETE)" }
    },
    "message": "Conexión con Cloudflare R2 verificada exitosamente (3 de 3 pasos completados)."
  }
}
```

#### `GET /api/admin/library/files/:id/uploader`
Respuesta:
```json
{
  "success": true,
  "data": {
    "hasUploader": true,
    "uploader": {
      "id": "44444444-4444-4444-8444-444444444444",
      "email": "estudiante@ejemplo.frc.utn.edu.ar",
      "status": "active",
      "role": "user",
      "createdAt": "2026-03-01T12:00:00.000Z"
    }
  }
}
```
#### `POST /api/admin/library/files/:id/resend-admin-notification`
Respuesta exitosa:
```json
{
  "success": true,
  "message": "Aviso reenviado correctamente a los administradores.",
  "notifiedAt": "2026-11-02T21:40:00.000Z"
}
```
Si el archivo ya no está en estado pendiente:
```json
{
  "success": false,
  "error": "Solo se pueden reenviar avisos para archivos en estado pendiente de revisión."
}
```

---

## 3. Extensiones de Esquema y Notificaciones en Respuestas de Admin

Los objetos de archivo en respuestas de administración (`GET /api/admin/library/pending` y `GET /api/admin/library/files`) incluyen timestamps que reflejan el estado del ciclo de avisos por correo:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "title": "Primer Parcial Turno Noche",
  "status": "pending",
  "adminNotifiedAt": "2026-11-02T21:30:00.000Z",
  "uploaderNotifiedAt": null
}
```

- `adminNotifiedAt`: Fecha y hora en que se envió el aviso de material para revisar a los administradores (`null` si está pendiente de primer envío o en cola de reintento).
- `uploaderNotifiedAt`: Fecha y hora en que se notificó al estudiante el resultado de la moderación (aprobación o rechazo), garantizando que solo se envíe una vez.

### 3.1 Envíos Agrupados y Debouncing (Event-Driven Timer)

Para evitar la saturación de correos en subidas múltiples de archivos o revisiones masivas por parte del administrador:
- **Avisos al Administrador**: Al completarse subidas (`/uploads/:id/complete`), los archivos entran en cola de notificación. Un timer de único disparo (`setTimeout(..., cooldown).unref()`) con debouncing (`LIBRARY_ADMIN_NOTIFY_COOLDOWN_SECONDS`, por defecto 120 s) procesa la cola al expirar la ventana sin mantener el event-loop ni la base despierta. Al arrancar el servidor se ejecuta una única verificación no bloqueante para rescatar pendientes no notificados si hubo reinicio. Si un usuario sube varios archivos en tanda, se envía un único correo consolidado con el listado completo de archivos.
- **Avisos al Estudiante**: Cuando el administrador aprueba o rechaza múltiples archivos de un estudiante, las acciones se agrupan por usuario (`LIBRARY_ADMIN_NOTIFY_COOLDOWN_SECONDS`). El temporizador consolida las decisiones y despacha un solo correo con todos los archivos aprobados y/o un único correo con los rechazados y sus respectivos motivos.

---

## 4. Tabla Unificada de Códigos de Error (`/api/library/*` y `/api/admin/library/*`)

La siguiente tabla resume todos los códigos de error unificados devueltos en las respuestas JSON `{ success: false, code: '...', error: '...' }`:

| Status HTTP | Código (`code`) | Condición en la que se devuelve | Reintento / Backoff del Cliente | Mensaje de Usuario Recomendado |
| :---: | :--- | :--- | :--- | :--- |
| **403** | `TERMS_REQUIRED` | El usuario no aceptó los Términos de la Biblioteca (`termsAcceptedAt` nulo). | No reintentar automáticamente. Abrir diálogo/modal de aceptación de términos. | "Debés aceptar los Términos de la Biblioteca antes de subir tu primer archivo." |
| **429** | `TOO_MANY_REJECTIONS` | El usuario acumuló $\ge$ `LIBRARY_MAX_REJECTIONS_THRESHOLD` (por defecto 20) rechazos en `LIBRARY_REJECTIONS_WINDOW_DAYS` (por defecto 7 días). Anti-spam. | No reintentar inmediatamente. Esperar a que expire la ventana o contactar soporte. | "Tu cuenta acumuló demasiados archivos rechazados recientemente. La subida de nuevos materiales está temporalmente pausada." |
| **429** | `LIMIT_PENDING_UPLOADS` | El usuario superó el cupo máximo de archivos simultáneos pendientes de moderación (`LIBRARY_MAX_PENDING_UPLOADS`, 30). | No reintentar de inmediato. Esperar moderación de archivos pendientes. | "Alcanzaste el cupo máximo de 30 archivos pendientes de revisión. Por favor aguardá a que sean moderados para subir más." |
| **429** | `LIMIT_STORAGE_QUOTA` | El espacio ocupado por el usuario excede la cuota total de 500 MB (`LIBRARY_MAX_STORAGE_PER_USER_BYTES`). | No reintentar automáticamente. Liberar espacio borrando aportes previos desde Mis Aportes. | "Alcanzaste el espacio total permitido de 500 MB en la Biblioteca. Podés gestionar tus aportes anteriores en Mis Aportes." |
| **404** | `UPLOAD_NOT_FOUND_OR_EXPIRED` | El registro de subida no existe en la BD, expiró por inactividad (> 6h) o pertenece a otro usuario. | No reintentar con el mismo ID. Reinicializar el flujo desde `/uploads/init`. | "La sesión de subida expiró o no fue encontrada. Por favor volvé a seleccionar el archivo para subirlo nuevamente." |
| **400** | `UPLOAD_ALREADY_REJECTED` | En `/uploads/:id/complete`, el archivo ya fue evaluado y marcado como `rejected`. | No reintentar. El archivo fue rechazado por el sistema. | "Este archivo ya fue rechazado por el sistema de moderación y no puede completarse." |
| **400** | `UPLOAD_NOT_ACTIVE` | En `/uploads/:id/complete`, el archivo se encuentra en estado inactivo (`hidden` o `removed`). | No reintentar. La sesión ya no es válida. | "El archivo se encuentra inactivo y no puede completarse." |
| **400** | `INVALID_STATUS` | En `/uploads/:id/complete`, el estado del archivo no permite completarlo (diferente a `uploading` o `approved`). | No reintentar automáticamente. Informar inconsistencia. | "El archivo no se encuentra en estado de carga." |
| **409** | `DUPLICATE_FILE` | El archivo calculado por SHA-256 ya existe en la materia (o catálogo activo). | No reintentar. El material ya está en la biblioteca. | "Este archivo ya se encuentra en la Biblioteca para esta materia. ¡Muchas gracias de todos modos por colaborar!" |
| **410** | `FILE_CONTENT_PURGED` | En `/files/:id/preview` o `/files/:id/download`, el archivo fue rechazado (`rejected`) o eliminado (`removed`), y su binario fue encolado para borrado físico de R2. | No reintentar. El binario físico ya no existe en el almacenamiento. | "El contenido físico de este archivo fue purgado tras su rechazo o remoción." |
| **410** | `FILE_NOT_AVAILABLE` | En `/files/:id/download`, el archivo no está en estado `approved` (revisión, rechazado u oculto). | No reintentar. Archivo no público. | "Este archivo ya no se encuentra disponible para descarga." |
| **429** | `LIMIT_HOURLY_DOWNLOADS` | El estudiante superó el límite de descargas por hora configurado (`LIBRARY_MAX_HOURLY_DOWNLOADS`). | Aplicar backoff respetando la cabecera HTTP `Retry-After`. | "Alcanzaste el límite de descargas por hora. Por favor aguardá unos minutos antes de volver a descargar." |
| **400** | `INVALID_METADATA` | Validación de campos (año académico fuera de rango 2000-actual, cuatrimestre inválido, título < 3 caracteres). | Corregir los campos señalados en el formulario y reenviar. | "Por favor verificá los datos ingresados: año o cuatrimestre inválidos." |
| **400** | `FILE_SIZE_EXCEEDED` | El tamaño del archivo declarado supera los topes máximos por tipo (30 MB parciales/apuntes, 100 MB libros). | No reintentar con el mismo binario. Optimizar o comprimir el archivo. | "El archivo excede el tamaño máximo permitido para este tipo de material." |


