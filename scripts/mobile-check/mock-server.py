"""
Mock HTTP Server para verificación y capturas móviles (CDP).
Sirve los archivos generados en dist/ y emula los endpoints de la API con respuestas fieles al backend.
Cada endpoint documenta con comentario el archivo de server/src que lo define.
Sin dependencias externas ni servicios en la nube.
"""

import http.server
import socketserver
import json
import os
import urllib.parse

import sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
DIRECTORY = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.abspath('dist')

class MockServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # SPA entrypoint: inject default local preferences (evitar modals innecesarios de onboarding)
        if path == '/' or path == '/index.html':
            index_path = os.path.join(DIRECTORY, 'index.html')
            if os.path.exists(index_path):
                with open(index_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                injection = """
<script>
try {
  localStorage.setItem('mi_carrera_tutorial_completed_v1', 'true');
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('graph_view')) {
    localStorage.setItem('ui_mobile_graph_view', sp.get('graph_view'));
  }
} catch(e) {}
</script>
</head>"""
                content = content.replace('</head>', injection)
                data = content.encode('utf-8')

                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        # 1. Health check
        # server/src/app.ts:95 -> instance.get('/api/health')
        if path == '/api/health':
            self.send_json({"status": "ok", "environment": "test", "timestamp": "2026-11-05T18:00:00Z"})
            return

        # 2. Auth Endpoint
        # server/src/modules/auth/auth.routes.ts:85 -> router.get('/me', requireAuth, AuthController.me)
        # server/src/app.ts:104 -> instance.get('/api/me', requireAuth, AuthController.me)
        if path.startswith('/api/auth/me') or path.startswith('/api/me'):
            if path == '/api/me/reviewable':
                # server/src/app.ts:106 -> instance.get('/api/me/reviewable')
                self.send_json({
                    "success": True,
                    "data": {
                        "eligible": [
                            {
                                "professorId": "p-1",
                                "professorName": "García, Juan Carlos",
                                "subjectId": "1",
                                "subjectName": "Análisis Matemático I",
                                "userSubjectStatus": "aprobada",
                                "recommended": True,
                                "alreadyReviewed": False,
                                "enrollmentAcademicYear": 2024,
                                "enrollmentTerm": "1C"
                            },
                            {
                                "professorId": "p-2",
                                "professorName": "Prof. Dra. De la Colina Argañaraz, María de las Mercedes",
                                "subjectId": "21",
                                "subjectName": "Comunicaciones y Redes de Datos",
                                "userSubjectStatus": "cursando",
                                "recommended": True,
                                "alreadyReviewed": False,
                                "enrollmentAcademicYear": 2026,
                                "enrollmentTerm": "1C"
                            }
                        ],
                        "blocked": [],
                        "myReviews": [],
                        "dailyLimit": {"remainingToday": 5, "maxPerDay": 5}
                    }
                })
                return

            self.send_json({
                "success": True,
                "user": {
                    "id": "mock-admin-1",
                    "email": "estudiante@alumnos.frc.utn.edu.ar",
                    "role": "admin",
                    "emailVerified": True,
                    "selectedPlanId": "2023"
                }
            })
            return

        # 3. User State Endpoint
        # server/src/modules/user-state/userState.routes.ts:27 -> router.get('/state', getUserState)
        # server/src/modules/user-state/userState.controller.ts:26 -> getUserState
        if path.startswith('/api/state') or path.startswith('/api/user-state'):
            self.send_json({
                "success": True,
                "data": {
                    "selectedPlanId": "2023",
                    "hasSavedData": True,
                    "settings": {
                        "minPassingGrade": 4,
                        "colorBlindMode": False,
                        "defaultView": "map",
                        "tutorialCompleted": True,
                        "statsIncludeElectives": False
                    },
                    "progress": {
                        "1": {"status": "aprobada", "grade": 8},
                        "2": {"status": "aprobada", "grade": 7},
                        "3": {"status": "aprobada", "grade": 6},
                        "4": {"status": "aprobada", "grade": 9},
                        "5": {"status": "aprobada", "grade": 7},
                        "6": {"status": "aprobada", "grade": 8},
                        "7": {"status": "aprobada", "grade": 7},
                        "8": {"status": "aprobada", "grade": 8},
                        "9": {"status": "aprobada", "grade": 7},
                        "10": {"status": "aprobada", "grade": 6},
                        "11": {"status": "aprobada", "grade": 8},
                        "12": {"status": "aprobada", "grade": 9},
                        "13": {"status": "aprobada", "grade": 7},
                        "14": {"status": "aprobada", "grade": 8},
                        "15": {"status": "aprobada", "grade": 7},
                        "16": {"status": "aprobada", "grade": 8},
                        "17": {"status": "aprobada", "grade": 7},
                        "18": {"status": "cursando"},
                        "19": {"status": "aprobada", "grade": 7},
                        "20": {"status": "aprobada", "grade": 7},
                        "21": {"status": "cursando"},
                        "22": {"status": "aprobada", "grade": 7},
                        "23": {"status": "aprobada", "grade": 7}
                    },
                    "progressByUuid": {},
                    "assignedElectives": {"1": [], "2": [], "3": [], "4": [], "5": []},
                    "basket": [18, 21],
                    "scheduleSelections": {"21": "3K2"},
                    "scheduleProposals": [
                        {
                            "id": "draft-1",
                            "name": "Propuesta 1 - Turno Tarde/Noche",
                            "scheduleTermId": "t1",
                            "selections": {"21": "3K2"},
                            "createdAt": 1730700000000,
                            "updatedAt": 1730700000000
                        }
                    ],
                    "enrollments": [
                        {
                            "id": "enr-1",
                            "subjectId": 21,
                            "subjectCode": 21,
                            "commissionCode": "3K2",
                            "professorId": "p-2",
                            "status": "cursando",
                            "academicYear": 2026,
                            "term": "1C"
                        }
                    ],
                    "examAttempts": [
                        {"id": "ea-1", "subjectId": "1", "subjectCode": 1, "date": "2024-07-15", "grade": 2, "isPassed": False, "notes": "Aplazo 1"},
                        {"id": "ea-2", "subjectId": "9", "subjectCode": 9, "date": "2025-02-20", "grade": 3, "isPassed": False, "notes": "Aplazo 2"}
                    ]
                }
            })
            return

        # 4. Schedule proposals
        # server/src/modules/user-state/userState.routes.ts:28 -> router.get('/schedule/proposals')
        # server/src/modules/user-state/userState.controller.ts:645 -> getScheduleProposals
        if path.startswith('/api/schedule/proposals'):
            self.send_json({
                "success": True,
                "data": [
                    {
                        "id": "draft-1",
                        "name": "Propuesta 1 - Turno Tarde/Noche",
                        "scheduleTermId": "t1",
                        "selections": {"21": "3K2"},
                        "createdAt": 1730700000000,
                        "updatedAt": 1730700000000
                    }
                ]
            })
            return

        # 5. Enrollments
        # server/src/modules/enrollments/enrollments.routes.ts:19 -> router.get('/', listUserEnrollments)
        if path.startswith('/api/enrollments'):
            self.send_json({
                "success": True,
                "data": [
                    {
                        "id": "enr-1",
                        "subjectId": 21,
                        "subjectCode": 21,
                        "commissionCode": "3K2",
                        "professorId": "p-2",
                        "status": "cursando",
                        "academicYear": 2026,
                        "term": "1C"
                    }
                ]
            })
            return

        # 6. Professors & Ratings
        # server/src/modules/professors/professors.routes.ts:67 -> router.get('/ratings', getRatingsBatch)
        if path.startswith('/api/professors/ratings'):
            # Caso raro: si se solicita 'empty=true' simulamos retorno de array vacío
            if 'empty' in qs:
                self.send_json({"success": True, "data": []})
                return

            self.send_json({
                "success": True,
                "data": {
                    "byId": {
                        "p-1": {
                            "id": "p-1",
                            "displayName": "García, Juan Carlos",
                            "normalizedName": "garcia, juan carlos",
                            "reviewCount": 7,
                            "averageOverall": 4.6,
                            "hasReliableAverage": True,
                            "ratingStatus": "confiable"
                        },
                        "p-2": {
                            "id": "p-2",
                            "displayName": "Prof. Dra. De la Colina Argañaraz, María de las Mercedes",
                            "normalizedName": "de la colina arganaraz, maria de las mercedes",
                            "reviewCount": 14,
                            "averageOverall": 4.8,
                            "hasReliableAverage": True,
                            "ratingStatus": "confiable"
                        }
                    },
                    "byNormalizedName": {
                        "garcia, juan carlos": {
                            "id": "p-1",
                            "displayName": "García, Juan Carlos",
                            "reviewCount": 7,
                            "averageOverall": 4.6,
                            "hasReliableAverage": True
                        },
                        "de la colina arganaraz, maria de las mercedes": {
                            "id": "p-2",
                            "displayName": "Prof. Dra. De la Colina Argañaraz, María de las Mercedes",
                            "reviewCount": 14,
                            "averageOverall": 4.8,
                            "hasReliableAverage": True
                        }
                    },
                    "thresholds": {"minReviewsForReliableAverage": 3}
                }
            })
            return

        # server/src/modules/professors/professors.routes.ts:37 -> router.get('/', listProfessors)
        if path == '/api/professors':
            self.send_json({
                "success": True,
                "data": {
                    "professors": [
                        {
                            "id": "p-1",
                            "displayName": "García, Juan Carlos",
                            "normalizedName": "garcia, juan carlos",
                            "reviewCount": 7,
                            "averageOverall": 4.6,
                            "averageClarity": 4.5,
                            "recommendPercent": 92,
                            "ratingStatus": "confiable",
                            "hasReliableAverage": True,
                            "subjects": [{"id": "1", "name": "Análisis Matemático I", "code": 1}]
                        },
                        {
                            "id": "p-2",
                            "displayName": "Prof. Dra. De la Colina Argañaraz, María de las Mercedes",
                            "normalizedName": "de la colina arganaraz, maria de las mercedes",
                            "reviewCount": 14,
                            "averageOverall": 4.8,
                            "averageClarity": 4.7,
                            "recommendPercent": 95,
                            "ratingStatus": "confiable",
                            "hasReliableAverage": True,
                            "subjects": [{"id": "21", "name": "Comunicaciones y Redes de Datos", "code": 21}]
                        }
                    ],
                    "thresholds": {"minReviewsForReliableAverage": 3}
                }
            })
            return

        # server/src/modules/professors/professors.routes.ts:81 -> router.get('/:id', getProfessorDetail)
        if path.startswith('/api/professors/') and not path.endswith('/reviews'):
            prof_id = path.replace('/api/professors/', '')
            self.send_json({
                "success": True,
                "data": {
                    "professor": {
                        "id": prof_id,
                        "displayName": "García, Juan Carlos" if prof_id == "p-1" else "Prof. Dra. De la Colina Argañaraz, María de las Mercedes",
                        "reviewCount": 7 if prof_id == "p-1" else 14,
                        "averageOverall": 4.6 if prof_id == "p-1" else 4.8,
                        "hasReliableAverage": True,
                        "ratingStatus": "confiable"
                    },
                    "reviews": []
                }
            })
            return

        # server/src/modules/professors/professors.routes.ts:106 -> router.get('/:id/reviews', getProfessorReviews)
        if path.startswith('/api/professors/') and path.endswith('/reviews'):
            self.send_json({
                "success": True,
                "data": {
                    "items": [],
                    "total": 0,
                    "page": 1,
                    "pageSize": 10,
                    "totalPages": 0
                }
            })
            return

        # 7. Library API Endpoints
        # server/src/modules/library/library.routes.ts:14 -> router.get('/status', getStatus)
        # server/src/modules/library/library.controller.ts:7 -> getStatus
        if path == '/api/library/status':
            self.send_json({
                "success": True,
                "data": {
                    "enabled": True,
                    "userApprovedMaterialsCount": 2,
                    "canUpload": True
                }
            })
            return

        # server/src/modules/library/library.routes.ts:15 -> router.get('/subjects', getSubjects)
        # server/src/modules/library/library.controller.ts:30 -> getSubjects
        if path == '/api/library/subjects':
            self.send_json({
                "success": True,
                "data": [
                    {"id": "s-1", "codeInPlan": 1, "name": "Análisis Matemático I", "level": 1, "approvedFilesCount": 5},
                    {"id": "s-2", "codeInPlan": 2, "name": "Álgebra y Geometría Analítica", "level": 1, "approvedFilesCount": 3},
                    {"id": "s-21", "codeInPlan": 21, "name": "Comunicaciones y Redes de Datos", "level": 3, "approvedFilesCount": 4}
                ]
            })
            return

        # server/src/modules/library/library.routes.ts:16 -> router.get('/files', searchMaterials)
        # Mock download file
        if path == '/mock-file.pdf':
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Disposition', 'attachment; filename="mock-material.pdf"')
            self.end_headers()
            self.wfile.write(b'%PDF-1.4 mock pdf content')
            return

        # server/src/modules/library/library.controller.ts -> getDownloadUrl
        if '/download' in path:
            self.send_json({
                "success": True,
                "data": {
                    "downloadUrl": "/mock-file.pdf",
                    "fileName": "mock-material.pdf"
                }
            })
            return

        # server/src/modules/library/library.controller.ts:58 -> searchMaterials
        if path.startswith('/api/library/files') or path.startswith('/api/library/materials'):
            mock_items = [
                {
                    "id": "lib-1",
                    "title": "Primer Parcial Resuelto 2024 (Tema 1)",
                    "description": "Límites, continuidad y derivadas con desarrollos detallados paso a paso.",
                    "mimeType": "application/pdf",
                    "kind": "parcial",
                    "sizeBytes": 2450000,
                    "academicYear": 2024,
                    "term": "1C",
                    "examInstance": "1° Parcial",
                    "hasSolution": True,
                    "downloadCount": 42,
                    "helpfulCount": 18,
                    "hasVotedHelpful": False,
                    "professorNames": ["García, Juan Carlos"],
                    "createdAt": "2024-05-10T12:00:00Z"
                },
                {
                    "id": "lib-2",
                    "title": "Resumen Completo Teórico y Práctico con Demostraciones de Teoremas de Continuidad y Derivabilidad",
                    "description": "Apunte exhaustivo elaborado por estudiantes de la cátedra con gráficos explicativos y ejercicios resueltos.",
                    "mimeType": "application/pdf",
                    "kind": "apunte",
                    "sizeBytes": 8900000,
                    "academicYear": 2025,
                    "term": "2C",
                    "examInstance": "Teórico",
                    "hasSolution": False,
                    "downloadCount": 115,
                    "helpfulCount": 54,
                    "hasVotedHelpful": True,
                    "professorNames": ["Prof. Dra. De la Colina Argañaraz, María de las Mercedes"],
                    "createdAt": "2025-06-15T15:30:00Z"
                }
            ]
            self.send_json({
                "success": True,
                "data": {
                    "items": mock_items,
                    "files": mock_items,
                    "total": 2,
                    "page": 1,
                    "pageSize": 20,
                    "totalPages": 1
                }
            })
            return

        # server/src/modules/library/library.routes.ts:18 -> router.get('/my-uploads', getMyUploads)
        # server/src/modules/library/library.controller.ts:142 -> getMyUploads
        if path.startswith('/api/library/my-uploads'):
            self.send_json({
                "success": True,
                "data": {
                    "uploads": [
                        {
                            "id": "lib-my-1",
                            "subjectId": "1",
                            "title": "Mis Apuntes de Análisis Matemático I",
                            "kind": "apunte",
                            "academicYear": 2024,
                            "term": "1C",
                            "status": "approved",
                            "sizeBytes": 3200000,
                            "downloadCount": 14,
                            "helpfulCount": 5,
                            "createdAt": "2026-11-01T10:00:00Z"
                        }
                    ],
                    "quota": {
                        "usedBytes": 3200000,
                        "maxBytes": 524288000,
                        "pendingCount": 1,
                        "maxPending": 30
                    },
                    "hasStatusUpdates": False
                }
            })
            return

        # server/src/modules/library/library.routes.ts:13 -> router.post('/terms-status', getTermsStatus)
        if path.startswith('/api/library/terms-status'):
            self.send_json({"success": True, "data": {"accepted": True}})
            return

        # 8. Admin API Endpoints
        # server/src/modules/admin/admin.routes.ts:12 -> router.get('/reauth/status', reauthStatus)
        # server/src/modules/admin/admin.controller.ts:92 -> reauthStatus
        if path == '/api/admin/reauth/status':
            self.send_json({"success": True, "authenticated": True})
            return

        # server/src/modules/admin/admin.routes.ts:13 -> router.get('/stats', getStats)
        # server/src/modules/admin/admin.controller.ts:103 -> getStats
        if path.startswith('/api/admin/stats') or path.startswith('/api/admin/overview'):
            self.send_json({
                "success": True,
                "data": {
                    "overview": {
                        "totalUsers": 1420,
                        "newUsersInRange": 85,
                        "activeUsersCount": 1390,
                        "suspendedUsersCount": 30,
                        "totalEnrollments": 4820,
                        "totalReviews": 890,
                        "pendingReportsCount": 2
                    },
                    "library": {
                        "approvedCount": 340,
                        "pendingCount": 4,
                        "rejectedCount": 12,
                        "totalBytes": 1024 * 1024 * 850
                    },
                    "charts": {
                        "signupsByDay": [{"date": "2026-11-01", "count": 12}, {"date": "2026-11-02", "count": 18}],
                        "activeUsersByDay": [{"date": "2026-11-01", "count": 250}, {"date": "2026-11-02", "count": 310}]
                    }
                }
            })
            return

        # server/src/modules/admin/admin.routes.ts:14 -> router.get('/users', listUsers)
        # server/src/modules/admin/admin.controller.ts:138 -> listUsers
        if path.startswith('/api/admin/users'):
            self.send_json({
                "success": True,
                "data": {
                    "users": [
                        {
                            "id": "mock-admin-1",
                            "email": "estudiante@alumnos.frc.utn.edu.ar",
                            "role": "admin",
                            "status": "active",
                            "emailVerified": True,
                            "lastSeenAt": "2026-11-04T18:00:00Z",
                            "identities": [{"provider": "google"}]
                        },
                        {
                            "id": "mock-user-2",
                            "email": "companero@alumnos.frc.utn.edu.ar",
                            "role": "user",
                            "status": "active",
                            "emailVerified": True,
                            "lastSeenAt": "2026-11-04T12:00:00Z",
                            "identities": [{"provider": "local"}]
                        }
                    ],
                    "pagination": {"page": 1, "pageSize": 20, "total": 2, "totalPages": 1}
                }
            })
            return

        # server/src/modules/admin/admin.routes.ts:23 -> router.get('/terms', listTerms)
        # server/src/modules/admin/admin.controller.ts:274 -> listTerms
        if path.startswith('/api/admin/terms'):
            self.send_json({
                "success": True,
                "data": [
                    {"id": "t1", "name": "1C 2026", "year": 2026, "isDefault": True}
                ]
            })
            return

        # server/src/modules/reviews/reviews.routes.ts:324 -> router.get('/reviews', listAdminReviews)
        # server/src/modules/admin/admin.controller.ts:694 -> listAdminReviews
        if path.startswith('/api/admin/reviews'):
            self.send_json({
                "success": True,
                "data": {
                    "items": [
                        {
                            "id": "rev-1",
                            "professorName": "García, Juan Carlos",
                            "subjectCode": "01",
                            "subjectName": "Análisis Matemático I",
                            "overall": 5,
                            "comment": "Excelente docente, explica muy claro.",
                            "status": "published",
                            "authorEmail": "autor.prueba@alumnos.frc.utn.edu.ar",
                            "publishedMonthYear": "Nov 2026"
                        }
                    ],
                    "total": 1,
                    "page": 1,
                    "totalPages": 1
                }
            })
            return

        # server/src/modules/admin/admin.library.controller.ts:7 -> listPendingFiles
        if path.startswith('/api/admin/library/pending') or path.startswith('/api/admin/library/files'):
            self.send_json({"success": True, "data": []})
            return

        # server/src/modules/admin/admin.routes.ts:37 -> router.get('/audit-logs', listAuditLogs)
        # server/src/modules/admin/admin.controller.ts:730 -> listAuditLogs
        if path.startswith('/api/admin/audit'):
            self.send_json({
                "success": True,
                "data": {
                    "logs": [
                        {
                            "id": "log-1",
                            "adminUserId": "mock-admin-1",
                            "adminEmail": "estudiante@alumnos.frc.utn.edu.ar",
                            "action": "library.approve",
                            "targetType": "file",
                            "targetId": "lib-1",
                            "ipAddress": "190.183.21.4",
                            "createdAt": "2026-11-04T18:30:00Z"
                        }
                    ],
                    "pagination": {"page": 1, "pageSize": 25, "total": 1, "totalPages": 1}
                }
            })
            return

        # Generic API Fallback
        if path.startswith('/api/'):
            self.send_json({"success": True, "data": []})
            return

        # Static file delivery (SPA routing: fallback to /index.html)
        local_path = self.translate_path(self.path)
        if not os.path.exists(local_path) or os.path.isdir(local_path):
            self.path = '/index.html'

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/library/uploads/init':
            import time
            file_id = f"mock-file-{int(time.time() * 1000)}"
            self.send_json({
                "success": True,
                "data": {
                    "fileId": file_id,
                    "uploadUrl": f"/mock-r2-upload/{file_id}",
                    "storageKey": f"uploads/mock/{file_id}.pdf",
                    "maxSizeBytes": 26214400,
                    "headers": {"Content-Type": "application/pdf"}
                }
            })
            return

        if path.startswith('/api/library/uploads/') and path.endswith('/complete'):
            parts = path.split('/')
            file_id = parts[4] if len(parts) >= 5 else "mock-file-1"
            self.send_json({
                "success": True,
                "data": {
                    "id": file_id,
                    "status": "pending",
                    "title": "Aporte recibido en moderación"
                }
            })
            return

        if path == '/api/library/terms/accept':
            self.send_json({"success": True, "data": {"accepted": True}})
            return

        self.send_json({"success": True, "data": {}})

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith('/mock-r2-upload/'):
            length = int(self.headers.get('Content-Length', 0))
            if length > 0:
                self.rfile.read(min(length, 65536))
            self.send_response(200)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return

        self.send_json({"success": True, "data": {}})

    def do_PATCH(self):
        self.send_json({"success": True, "data": {}})

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/library/my-uploads/'):
            parts = path.split('/')
            file_id = parts[4] if len(parts) >= 5 else "mock-file-1"
            self.send_json({"success": True, "data": {"deleted": True, "fileId": file_id}})
            return

        self.send_json({"success": True, "data": {}})

    def send_json(self, data, code=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def run():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), MockServerHandler) as httpd:
        print(f"Mock server running on port {PORT}")
        httpd.serve_forever()

if __name__ == '__main__':
    run()
