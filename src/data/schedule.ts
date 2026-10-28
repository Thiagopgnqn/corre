import type { SubjectSchedule } from '../types/schedule';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DATOS DE HORARIOS Y COMISIONES (MUESTRA DE EJEMPLO PARA PRUEBAS)
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTA: Los siguientes datos son de ejemplo para testeo de la interfaz,
 * detección de superposiciones y combinaciones. Podés reemplazarlos o
 * importar un archivo JSON con este mismo esquema desde el botón
 * "Importar horarios" de la app.
 */
export const SAMPLE_SCHEDULES: SubjectSchedule[] = [
  // 1. Análisis Matemático I (ID 1, Nivel 1, 1C)
  {
    subjectId: 1,
    term: '1C',
    commissions: [
      {
        id: '1-1K1',
        code: '1K1',
        turno: 'mañana',
        professors: ['Lic. Roberto Gómez', 'Ing. Carlos Rossi'],
        notes: 'Comisión matutina - Aula Magna',
        slots: [
          { day: 'LUN', start: '08:00', end: '10:15', room: 'Aula 101', mode: 'presencial' },
          { day: 'MIE', start: '08:00', end: '10:15', room: 'Aula 101', mode: 'presencial' },
        ],
      },
      {
        id: '1-1K2',
        code: '1K2',
        turno: 'tarde',
        professors: ['Dra. Elena Valenzuela'],
        notes: 'Comisión vespertina',
        slots: [
          { day: 'MAR', start: '14:00', end: '16:15', room: 'Aula 102', mode: 'presencial' },
          { day: 'JUE', start: '14:00', end: '16:15', room: 'Aula 102', mode: 'presencial' },
        ],
      },
      {
        id: '1-1K3',
        code: '1K3',
        turno: 'noche',
        professors: ['Ing. Marcos Benítez', 'Lic. Andrea Solís'],
        notes: 'Comisión nocturna',
        slots: [
          { day: 'MAR', start: '18:15', end: '20:30', room: 'Aula 201', mode: 'presencial' },
          { day: 'JUE', start: '18:15', end: '20:30', room: 'Aula 201', mode: 'presencial' },
        ],
      },
    ],
  },

  // 2. Algoritmos y Estructuras de Datos (ID 6, Nivel 1, A = Anual)
  {
    subjectId: 6,
    term: 'A',
    commissions: [
      {
        id: '6-1K1',
        code: '1K1',
        turno: 'mañana',
        professors: ['Ing. Martín Palermo', 'Lic. Lucas Silva'],
        notes: 'Incluye laboratorio de computación',
        slots: [
          // LUN 10:15 a 12:30 -> Toca justo el borde de 1-1K1 (termina 10:15), excelente para probar clases consecutivas sin choque
          { day: 'LUN', start: '10:15', end: '12:30', room: 'Lab Redes 1', mode: 'presencial' },
          { day: 'MIE', start: '10:15', end: '12:30', room: 'Lab Redes 1', mode: 'presencial' },
        ],
      },
      {
        id: '6-1K2',
        code: '1K2',
        turno: 'mañana',
        professors: ['Ing. Sofía Carrizo'],
        notes: 'Comisión con choque intencional de prueba con 1-1K1',
        slots: [
          // LUN 09:00 a 12:15 -> Se pisa con 1-1K1 (08:00 a 10:15) para probar detección de choques
          { day: 'LUN', start: '09:00', end: '12:15', room: 'Lab Software', mode: 'presencial' },
          { day: 'VIE', start: '08:00', end: '10:15', room: 'Aula 204', mode: 'virtual' },
        ],
      },
      {
        id: '6-1K3',
        code: '1K3',
        turno: 'noche',
        professors: ['Ing. Fernando Torres', 'Ing. Daniel Ortega'],
        notes: 'Modalidad híbrida',
        slots: [
          { day: 'LUN', start: '18:15', end: '21:30', room: 'Lab Sistemas', mode: 'presencial' },
          { day: 'VIE', start: '18:15', end: '20:30', room: 'Zoom', mode: 'virtual' },
        ],
      },
    ],
  },

  // 3. Sistemas y Procesos de Negocio (ID 8, Nivel 1, 1C)
  {
    subjectId: 8,
    term: '1C',
    commissions: [
      {
        id: '8-1K1',
        code: '1K1',
        turno: 'mañana',
        professors: ['Lic. Patricia Morales'],
        notes: 'Viernes bloque intensivo',
        slots: [
          { day: 'VIE', start: '08:00', end: '12:15', room: 'Aula 302', mode: 'presencial' },
        ],
      },
      {
        id: '8-1K2',
        code: '1K2',
        turno: 'tarde',
        professors: ['Ing. Gabriel Medina'],
        slots: [
          { day: 'MIE', start: '14:00', end: '18:15', room: 'Aula 305', mode: 'presencial' },
        ],
      },
      {
        id: '8-1K3',
        code: '1K3',
        turno: 'noche',
        professors: ['Lic. Mariana Castro', 'Ing. Hugo Varela'],
        slots: [
          { day: 'JUE', start: '18:15', end: '22:30', room: 'Aula 301', mode: 'presencial' },
        ],
      },
    ],
  },

  // 4. Sintaxis y Semántica de los Lenguajes (ID 13, Nivel 2, 2C)
  {
    subjectId: 13,
    term: '2C',
    commissions: [
      {
        id: '13-2K1',
        code: '2K1',
        turno: 'mañana',
        professors: ['Lic. Gonzalo Vega'],
        slots: [
          { day: 'MAR', start: '08:00', end: '11:15', room: 'Aula 210', mode: 'presencial' },
          { day: 'JUE', start: '08:00', end: '10:15', room: 'Aula 210', mode: 'presencial' },
        ],
      },
      {
        id: '13-2K2',
        code: '2K2',
        turno: 'noche',
        professors: ['Ing. Cecilia Domínguez'],
        slots: [
          { day: 'MAR', start: '18:15', end: '21:30', room: 'Aula 115', mode: 'presencial' },
          { day: 'JUE', start: '18:15', end: '20:30', room: 'Aula 115', mode: 'presencial' },
        ],
      },
    ],
  },
];
