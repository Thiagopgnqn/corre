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
Respuesta:
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

#### `POST /api/library/uploads/:id/complete`
Respuesta:
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

#### `GET /api/library/my-uploads?peek=1`
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
      "maxBytes": 314572800
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
Si el usuario eliminó su cuenta con desvinculación de autoría (`deleteFiles: false`):
```json
{
  "success": true,
  "data": {
    "hasUploader": false,
    "message": "El archivo es anónimo o su autor dio de baja su cuenta conservando los materiales aportados."
  }
}
```

