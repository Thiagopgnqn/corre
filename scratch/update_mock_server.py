import json
import os

target_path = r'C:\Users\msgar\.gemini\antigravity\brain\bbbcea45-94e2-4984-ab70-c1fbef39a5f5\scratch\test_server.py'

server_code = """import http.server
import socketserver
import json
import os
import urllib.parse

PORT = 8080
DIRECTORY = os.path.abspath('dist')

class MockServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/' or path == '/index.html':
            index_path = os.path.join(DIRECTORY, 'index.html')
            with open(index_path, 'r', encoding='utf-8') as f:
                content = f.read()

            injection = \"\"\"
<script>
try {
  localStorage.setItem('mi_carrera_tutorial_completed_v1', 'true');
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('graph_view')) {
    localStorage.setItem('ui_mobile_graph_view', sp.get('graph_view'));
  }
} catch(e) {}
</script>
</head>\"\"\"
            content = content.replace('</head>', injection)
            data = content.encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        if path.startswith('/api/me'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "user": {
                    "id": "mock-student-1",
                    "email": "estudiante@utn.edu.ar",
                    "role": "user",
                    "emailVerified": True,
                    "selectedPlanId": "2023"
                }
            }).encode('utf-8'))
            return

        if path.startswith('/api/state'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "data": {
                    "subjects": {
                        "101": { "status": "aprobada", "grade": 8 },
                        "102": { "status": "cursando" },
                        "103": { "status": "regularizada" }
                    },
                    "assignedElectives": {},
                    "semesterBasket": [104, 105],
                    "settings": {
                        "includeAnalistaTrack": True,
                        "colorBlindMode": False,
                        "compactView": False
                    },
                    "scheduleSelections": {
                        "102": "1K01"
                    },
                    "scheduleDrafts": []
                }
            }).encode('utf-8'))
            return

        if path.startswith('/api/professors/ratings'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({ "success": True, "data": { "byId": {}, "byNormalizedName": {} } }).encode('utf-8'))
            return

        if path.startswith('/api/professors/reviewable'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "data": {
                    "eligible": [
                        {
                            "professorId": "p-1",
                            "professorName": "García, Juan",
                            "subjectId": "101",
                            "subjectName": "Análisis Matemático I",
                            "userSubjectStatus": "aprobada",
                            "recommended": True,
                            "alreadyReviewed": False,
                            "enrollmentAcademicYear": 2024,
                            "enrollmentTerm": "1C"
                        }
                    ],
                    "blocked": [],
                    "myReviews": [],
                    "dailyLimit": { "remainingToday": 5, "maxPerDay": 5 }
                }
            }).encode('utf-8'))
            return

        if path.startswith('/api/professors/queue'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({ "success": True, "data": { "openReports": [] } }).encode('utf-8'))
            return

        if path.startswith('/api/professors/'):
            # Professor detail
            prof_id = path.split('/')[3] if len(path.split('/')) > 3 else "p-1"
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "data": {
                    "professor": {
                        "id": prof_id,
                        "displayName": "García, Juan",
                        "subjects": ["Análisis Matemático I", "Álgebra y Geometría Analítica"],
                        "averageOverall": 4.5,
                        "averageClarity": 4.6,
                        "averageTreatment": 4.7,
                        "averageAvailability": 4.2,
                        "averageDifficulty": 3.8,
                        "recommendationRate": 92,
                        "totalReviews": 14
                    },
                    "reviewsPage": {
                        "reviews": [
                            {
                                "id": "r-1",
                                "professorId": prof_id,
                                "overall": 5,
                                "clarity": 5,
                                "treatment": 5,
                                "availability": 4,
                                "difficulty": 4,
                                "wouldRecommend": True,
                                "comment": "Excelente profesor, explica con gran claridad y paciencia.",
                                "publishedLabel": "Hace 2 meses",
                                "subjectName": "Análisis Matemático I",
                                "academicYear": 2024,
                                "term": "1C",
                                "helpfulCount": 8,
                                "unhelpfulCount": 0
                            }
                        ],
                        "total": 1,
                        "page": 1,
                        "pageSize": 8
                    },
                    "thresholds": {
                        "showProvisionalAverageBelowThreshold": True,
                        "minReviewsThreshold": 3
                    }
                }
            }).encode('utf-8'))
            return

        if path.startswith('/api/professors'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "data": {
                    "professors": [
                        {
                            "id": "p-1",
                            "displayName": "García, Juan",
                            "subjects": ["Análisis Matemático I", "Álgebra y Geometría Analítica"],
                            "averageOverall": 4.5,
                            "totalReviews": 14,
                            "recommendationRate": 92
                        },
                        {
                            "id": "p-2",
                            "displayName": "Pérez, Carlos",
                            "subjects": ["Algoritmos y Estructuras de Datos"],
                            "averageOverall": 4.2,
                            "totalReviews": 9,
                            "recommendationRate": 85
                        },
                        {
                            "id": "p-3",
                            "displayName": "Rodríguez, María",
                            "subjects": ["Sistemas y Organizaciones"],
                            "averageOverall": 4.8,
                            "totalReviews": 22,
                            "recommendationRate": 98
                        }
                    ]
                }
            }).encode('utf-8'))
            return

        if path.startswith('/api/library/subjects-summary'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "data": [
                    { "id": "s-101", "name": "Análisis Matemático I", "codeInPlan": 101, "level": 1, "approvedFilesCount": 12 },
                    { "id": "s-102", "name": "Álgebra y Geometría Analítica", "codeInPlan": 102, "level": 1, "approvedFilesCount": 8 },
                    { "id": "s-103", "name": "Algoritmos y Estructuras de Datos", "codeInPlan": 103, "level": 1, "approvedFilesCount": 15 },
                    { "id": "s-201", "name": "Análisis Matemático II", "codeInPlan": 201, "level": 2, "approvedFilesCount": 6 }
                ]
            }).encode('utf-8'))
            return

        if path.startswith('/api/library/my-uploads'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "data": {
                    "files": [
                        {
                            "id": "f-1",
                            "title": "Primer Parcial Resuelto - Tema A",
                            "description": "Ejercicios 1 a 4 con desarrollo paso a paso.",
                            "status": "approved",
                            "kind": "parcial",
                            "sizeBytes": 2450000,
                            "createdAt": "2024-05-10T12:00:00Z",
                            "downloadCount": 35,
                            "helpfulCount": 14
                        },
                        {
                            "id": "f-2",
                            "title": "Resumen Unidad 2: Matrices y Determinantes",
                            "description": "Fórmulas y ejemplos resueltos.",
                            "status": "pending",
                            "kind": "resumen",
                            "sizeBytes": 1150000,
                            "createdAt": "2024-06-01T15:30:00Z",
                            "downloadCount": 0,
                            "helpfulCount": 0
                        }
                    ],
                    "usedBytes": 3600000,
                    "maxBytes": 314572800,
                    "hasStatusUpdates": False
                }
            }).encode('utf-8'))
            return

        if path.startswith('/api/library/files'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "data": {
                    "files": [
                        {
                            "id": "f-1",
                            "title": "Primer Parcial Resuelto 2024 (Tema 1)",
                            "description": "Límites, derivadas y estudio de funciones.",
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
                            "professorNames": ["García, Juan"]
                        }
                    ],
                    "total": 1
                }
            }).encode('utf-8'))
            return

        if path.startswith('/api/library/terms-status'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({ "success": True, "data": { "accepted": True } }).encode('utf-8'))
            return

        if path.startswith('/api/enrollments'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "data": {
                    "commissions": [
                        {
                            "id": "comm-1",
                            "name": "1K01",
                            "shift": "Mañana",
                            "periodLabel": "2024 - 1C",
                            "professors": [{ "professorId": "p-1", "displayName": "García, Juan" }]
                        }
                    ],
                    "professors": [
                        { "professorId": "p-1", "displayName": "García, Juan" }
                    ]
                }
            }).encode('utf-8'))
            return

        if path.startswith('/api/'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({ "success": True, "data": [] }).encode('utf-8'))
            return

        super().do_GET()

    def do_POST(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({ "success": True }).encode('utf-8'))

    def do_PUT(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({ "success": True }).encode('utf-8'))

    def do_DELETE(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({ "success": True }).encode('utf-8'))

# Allow port reuse
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), MockServerHandler) as httpd:
    print(f"Serving mock at port {PORT}")
    httpd.serve_forever()
"""

with open(target_path, 'w', encoding='utf-8') as f:
    f.write(server_code)
print("Updated test_server.py successfully")

