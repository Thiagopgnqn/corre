import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getScheduleAvailability,
  getScheduleUnavailableMessage,
  SCHEDULE_MIN_DESKTOP_WIDTH,
  SCHEDULE_TABLET_SHORT_SIDE_MIN,
} from '../src/utils/scheduleAvailability';
import { TUTORIAL_STEPS, getAvailableTutorialSteps } from '../src/data/tutorialSteps';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Parte A: Disponibilidad del Armador de Horarios y Navegación', () => {
  describe('A1. Regla pura getScheduleAvailability', () => {
    it('Móviles chicos y grandes en vertical devuelven "desktop-only"', () => {
      const portraitPhones = [
        [320, 568],
        [360, 640],
        [390, 844],
        [412, 740],
        [412, 915],
      ];
      for (const [w, h] of portraitPhones) {
        assert.equal(
          getScheduleAvailability(w, h),
          'desktop-only',
          `Teléfono vertical ${w}x${h} debe ser "desktop-only"`
        );
      }
    });

    it('Móviles en horizontal devuelven "desktop-only" (lado corto < 600)', () => {
      const landscapePhones = [
        [568, 320],
        [640, 360],
        [740, 412],
        [844, 390],
        [915, 412],
        [932, 430],
      ];
      for (const [w, h] of landscapePhones) {
        assert.equal(
          getScheduleAvailability(w, h),
          'desktop-only',
          `Teléfono horizontal ${w}x${h} debe ser "desktop-only" porque el lado corto (${Math.min(w, h)}) es < 600`
        );
      }
    });

    it('Tablets en vertical devuelven "wider-needed" (lado corto >= 600 pero ancho < 1024)', () => {
      const portraitTablets = [
        [768, 1024],
        [820, 1180],
        [800, 1280],
      ];
      for (const [w, h] of portraitTablets) {
        assert.equal(
          getScheduleAvailability(w, h),
          'wider-needed',
          `Tablet vertical ${w}x${h} debe ser "wider-needed"`
        );
      }
    });

    it('Tablets en horizontal devuelven "available" (ancho >= 1024)', () => {
      const landscapeTablets = [
        [1024, 768],
        [1180, 820],
        [1280, 800],
        [1366, 1024],
      ];
      for (const [w, h] of landscapeTablets) {
        assert.equal(
          getScheduleAvailability(w, h),
          'available',
          `Tablet horizontal ${w}x${h} debe ser "available"`
        );
      }
    });

    it('Computadoras de escritorio devuelven "available"', () => {
      const desktopScreens = [
        [1280, 800],
        [1366, 768],
        [1440, 900],
        [1536, 864],
        [1920, 1080],
      ];
      for (const [w, h] of desktopScreens) {
        assert.equal(
          getScheduleAvailability(w, h),
          'available',
          `Escritorio ${w}x${h} debe ser "available"`
        );
      }
    });

    it('Casos borde: exactamente 1023px y 1024px de ancho', () => {
      assert.equal(SCHEDULE_MIN_DESKTOP_WIDTH, 1024, 'Constante de corte debe ser 1024');
      assert.equal(SCHEDULE_TABLET_SHORT_SIDE_MIN, 600, 'Constante lado corto tablet debe ser 600');

      // 1023px en tablet (lado corto >= 600) -> wider-needed
      assert.equal(getScheduleAvailability(1023, 800), 'wider-needed');
      // 1023px en pantalla achatada (lado corto < 600) -> desktop-only
      assert.equal(getScheduleAvailability(1023, 500), 'desktop-only');
      // 1024px -> available
      assert.equal(getScheduleAvailability(1024, 600), 'available');
      assert.equal(getScheduleAvailability(1024, 768), 'available');
      assert.equal(getScheduleAvailability(1024, 1024), 'available');
    });
  });

  describe('A2. Mensajes de aviso de indisponibilidad', () => {
    it('desktop-only menciona computadora o PC y pantalla grande', () => {
      const msg = getScheduleUnavailableMessage('desktop-only');
      assert.match(msg, /computadora|PC/i, 'Mensaje debe mencionar computadora o PC');
      assert.match(msg, /pantalla grande|pantalla más grande/i, 'Mensaje debe explicar requisito de pantalla grande');
    });

    it('wider-needed sugiere pantalla más ancha y rotar la tablet a horizontal', () => {
      const msg = getScheduleUnavailableMessage('wider-needed');
      assert.match(msg, /pantalla más ancha|horizontal/i, 'Mensaje debe indicar pantalla más ancha o rotar');
      assert.match(msg, /horizontal|rotar/i, 'Mensaje debe sugerir rotar el dispositivo');
    });
  });

  describe('A3. Pantalla de aviso (ScheduleUnavailableNotice)', () => {
    it('Renderiza íconos Calendar y Monitor/Tablet, aria-live="polite", botón Volver al mapa >= 48px y soporte safe-area', () => {
      const noticePath = path.join(rootDir, 'src/components/schedule/ScheduleUnavailableNotice.tsx');
      const content = fs.readFileSync(noticePath, 'utf8');

      assert.match(content, /Calendar/, 'Debe importar ícono Calendar');
      assert.match(content, /Monitor|Tablet/, 'Debe importar ícono de Monitor o Tablet');
      assert.match(content, /aria-live="polite"/, 'El encabezado o alerta debe tener aria-live="polite"');
      assert.match(content, /Volver al mapa/, 'Debe tener botón para volver al mapa');
      assert.match(content, /min-h-\[48px\]/, 'El botón debe cumplir target táctil >= 48px');
      assert.match(content, /safe-area-p(b|t)|safe-area-inset-bottom/, 'Debe contemplar padding para safe area');
    });
  });

  describe('A4. Integración en App y navegación', () => {
    it('App.tsx bloquea el montaje de ScheduleBuilder cuando no está disponible y muestra el aviso', () => {
      const appPath = path.join(rootDir, 'src/App.tsx');
      const content = fs.readFileSync(appPath, 'utf8');

      assert.match(content, /useScheduleAvailability/, 'App debe usar useScheduleAvailability');
      assert.match(content, /ScheduleUnavailableNotice/, 'App debe importar ScheduleUnavailableNotice');
      assert.match(content, /isScheduleAvailable\s*\?\s*\(?\s*<ScheduleBuilder[\s\S]*:\s*\(?\s*<ScheduleUnavailableNotice/, 'Debe alternar entre ScheduleBuilder y el aviso según disponibilidad');
      assert.match(content, /isScheduleView\s*=\s*currentView\s*===\s*'schedule'\s*&&\s*isScheduleAvailable/, 'isScheduleView debe ser false cuando el armador no esté disponible');
    });

    it('Navbar.tsx muestra 5 botones en mobilePrimaryNav (Mapa, Biblioteca, Profesores, Estadísticas, Más)', () => {
      const navPath = path.join(rootDir, 'src/components/common/Navbar.tsx');
      const content = fs.readFileSync(navPath, 'utf8');

      // Extrae la definición de mobilePrimaryNav
      const matchPrimary = content.match(/const mobilePrimaryNav[\s\S]*?=\s*(\[[\s\S]*?\]);/);
      assert.ok(matchPrimary, 'mobilePrimaryNav debe estar definido');
      const ids = [...matchPrimary[1].matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
      assert.deepEqual(ids, ['graph', 'library', 'professors', 'stats'], 'Los 4 destinos principales de mobilePrimaryNav deben ser graph, library, professors, stats');

      // Secondary views en Más
      const matchSecondary = content.match(/const mobileSecondaryViews[\s\S]*?=\s*(\[[\s\S]*?\]);/);
      assert.ok(matchSecondary, 'mobileSecondaryViews debe estar definido');
      assert.match(matchSecondary[1], /id:\s*'schedule'[\s\S]*tag:\s*'Solo en PC'/, 'Horarios debe estar en el sheet Más con badge "Solo en PC"');
      assert.doesNotMatch(matchSecondary[1], /id:\s*'stats'/, 'Estadísticas NO debe estar en el sheet Más');

      // Botón Más se marca como activo en vistas secundarias
      assert.match(content, /\['kanban',\s*'planner',\s*'electives',\s*'schedule',\s*'admin'\]\.includes\(currentView\)/, 'Botón Más debe marcarse activo en vistas secundarias incluyendo schedule');
    });

    it('SemesterPlanner en mobile no ofrece armar horarios sino aviso accesible', () => {
      const plannerPath = path.join(rootDir, 'src/components/planner/SemesterPlanner.tsx');
      const content = fs.readFileSync(plannerPath, 'utf8');

      assert.match(content, /useScheduleAvailability/, 'SemesterPlanner debe consultar disponibilidad de horarios');
      assert.match(content, /Armador de horarios disponible desde computadora/, 'En mobile debe mostrar aviso amigable');
      assert.match(content, /isScheduleAvailable\s*\?[\s\S]*Armar horarios con esta canasta/, 'Botón de armar horarios condicionado a isScheduleAvailable');
    });

    it('Tutorial omite el paso de Horarios en mobile cuando no está disponible', () => {
      assert.equal(TUTORIAL_STEPS.length, 17, 'Tutorial completo debe tener 17 pasos en desktop');
      const stepsMobile = getAvailableTutorialSteps(false);
      assert.equal(stepsMobile.length, 16, 'Tutorial en mobile sin horarios debe tener 16 pasos');
      assert.ok(!stepsMobile.some((s) => s.targetView === 'schedule'), 'Ningún paso en mobile debe apuntar a la vista schedule');

      const stepsDesktop = getAvailableTutorialSteps(true);
      assert.equal(stepsDesktop.length, 17, 'Tutorial en desktop con horarios debe tener 17 pasos');
      assert.ok(stepsDesktop.some((s) => s.targetView === 'schedule'), 'El paso de horarios debe existir en desktop');

      const spotlightPath = path.join(rootDir, 'src/components/tutorial/TutorialSpotlight.tsx');
      const spotContent = fs.readFileSync(spotlightPath, 'utf8');
      assert.match(spotContent, /getAvailableTutorialSteps\(isScheduleAvailable\)/, 'TutorialSpotlight debe invocar getAvailableTutorialSteps con la disponibilidad reactiva');
    });
  });
});
