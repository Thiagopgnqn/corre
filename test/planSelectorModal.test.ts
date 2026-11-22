import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Institution } from '../src/api/catalog.api.ts';
import { BottomSheet, getActiveLayersCount } from '../src/components/common/BottomSheet.tsx';

// CareerContext importa audio.ts, que lee localStorage al cargar el módulo en Node
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
    writable: true,
    configurable: true,
  });
}

const {
  PlanSelectorModalView,
  PLAN_SELECTOR_DIALOG_LABEL,
  PLAN_SELECTOR_DEFAULT_SUBTITLE,
  PLAN_SELECTOR_MANDATORY_SUBTITLE,
  shouldCloseOnPlanSelectorKeyDown,
  shouldCloseOnPlanSelectorOverlayClick,
  executePlanSelection,
  isPlanSelectorDismissible,
  getPlanSelectorSubtitle,
  acquirePlanSelectorScrollLock,
  restorePlanSelectorFocus,
} = await import('../src/components/common/PlanSelectorModal.tsx');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SAMPLE_INSTITUTIONS: Institution[] = [
  {
    id: 'inst-1',
    name: 'Universidad Demo',
    code: 'UD',
    faculties: [
      {
        id: 'fac-1',
        name: 'Facultad Regional Demo',
        code: 'FRD',
        careers: [
          {
            id: 'career-1',
            name: 'Ingeniería Demo',
            code: 'ID',
            plans: [
              {
                id: 'plan-a',
                name: 'Plan A',
                year: 2024,
                config: {
                  requiredElectiveCredits: 20,
                  defaultMinPassingGrade: 6,
                },
              },
              {
                id: 'plan-b',
                name: 'Plan B',
                year: 2025,
                config: {
                  requiredElectiveCredits: 16,
                  defaultMinPassingGrade: 6,
                },
              },
            ],
          },
        ],
      },
    ],
  },
];

function findElements(
  node: React.ReactNode,
  predicate: (el: React.ReactElement<Record<string, unknown>>) => boolean
): Array<React.ReactElement<Record<string, unknown>>> {
  const results: Array<React.ReactElement<Record<string, unknown>>> = [];
  const walk = (current: React.ReactNode) => {
    if (current === null || current === undefined || typeof current === 'boolean') return;
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }
    if (React.isValidElement(current)) {
      const el = current as React.ReactElement<Record<string, unknown>>;
      if (predicate(el)) {
        results.push(el);
      }
      if (el.props && 'children' in el.props) {
        walk(el.props.children as React.ReactNode);
      }
      if (el.props && 'footer' in el.props && el.props.footer) {
        walk(el.props.footer as React.ReactNode);
      }
    }
  };
  walk(node);
  return results;
}

function getTextContent(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    return getTextContent(props.children as React.ReactNode);
  }
  return '';
}

describe('PlanSelectorModal — Cierre, accesibilidad, mismo plan, foco, scroll-lock y modo obligatorio', () => {
  it('1. Modo con plan activo (escritorio): expone role="dialog", aria-modal, aria-label y cierra por X, Cancelar, overlay y Escape sin tocar plan ni servidor', () => {
    let closeCalls = 0;
    let updateCalls = 0;
    let reloadCalls = 0;

    const props = {
      isOpen: true,
      isMobile: false,
      institutions: SAMPLE_INSTITUTIONS,
      loading: false,
      switchingId: null,
      currentPlanId: 'plan-a',
      canClose: true,
      onClose: () => {
        closeCalls += 1;
      },
      onSelectPlan: (planId: string) => {
        void executePlanSelection({
          planId,
          currentPlanId: 'plan-a',
          updateSelectedPlan: async () => {
            updateCalls += 1;
            return { success: true };
          },
          reloadServerState: async () => {
            reloadCalls += 1;
          },
          onClose: () => {
            closeCalls += 1;
          },
        });
      },
    };

    const html = renderToStaticMarkup(React.createElement(PlanSelectorModalView, props));
    assert.match(html, /role="dialog"/, 'Debe declarar role="dialog"');
    assert.match(html, /aria-modal="true"/, 'Debe declarar aria-modal="true"');
    assert.match(
      html,
      new RegExp(`aria-label="${PLAN_SELECTOR_DIALOG_LABEL}"`),
      'Debe declarar aria-label accesible en el diálogo'
    );
    assert.match(
      html,
      /aria-label="Cerrar selector de carreras y planes"/,
      'Debe renderizar botón X con aria-label'
    );
    assert.match(html, /min-w-\[44px\] min-h-\[44px\]/, 'Botón X debe tener objetivo táctil >= 44x44px');
    assert.match(html, />Cancelar</, 'Debe renderizar botón Cancelar');

    const tree = PlanSelectorModalView(props);

    // (a) Cierre por botón X
    const closeButtons = findElements(
      tree,
      (el) => el.type === 'button' && el.props['aria-label'] === 'Cerrar selector de carreras y planes'
    );
    assert.equal(closeButtons.length, 1, 'Debe haber exactamente 1 botón X visible');
    (closeButtons[0].props.onClick as () => void)();
    assert.equal(closeCalls, 1, 'Click en X debe cerrar el modal');

    // (b) Cierre por botón Cancelar
    const cancelButtons = findElements(
      tree,
      (el) => el.type === 'button' && getTextContent(el).trim() === 'Cancelar'
    );
    assert.equal(cancelButtons.length, 1, 'Debe haber exactamente 1 botón Cancelar visible');
    (cancelButtons[0].props.onClick as () => void)();
    assert.equal(closeCalls, 2, 'Click en Cancelar debe cerrar el modal');

    // (c) Cierre por click en overlay, pero NO al clickear dentro del diálogo
    const overlays = findElements(
      tree,
      (el) => el.props['data-testid'] === 'plan-selector-overlay'
    );
    assert.equal(overlays.length, 1, 'Debe existir el overlay del modal');
    const overlayEl = overlays[0];
    const overlayNodeRef = { id: 'overlay' };
    const innerNodeRef = { id: 'inner' };

    (overlayEl.props.onClick as (e: unknown) => void)({
      target: innerNodeRef,
      currentTarget: overlayNodeRef,
    });
    assert.equal(closeCalls, 2, 'Click en un hijo interno NO debe cerrar por overlay');

    const dialogs = findElements(tree, (el) => el.props.role === 'dialog');
    assert.equal(dialogs.length, 1);
    let stopped = false;
    (dialogs[0].props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: () => {
        stopped = true;
      },
    });
    assert.equal(stopped, true, 'El contenedor dialog debe detener la propagación del click');

    (overlayEl.props.onClick as (e: unknown) => void)({
      target: overlayNodeRef,
      currentTarget: overlayNodeRef,
    });
    assert.equal(closeCalls, 3, 'Click directo sobre el fondo oscuro (overlay) debe cerrar el modal');

    // (d) Cierre por Escape
    assert.equal(shouldCloseOnPlanSelectorKeyDown('Escape', true), true, 'Escape debe cerrar cuando canClose=true');
    assert.equal(shouldCloseOnPlanSelectorKeyDown('Enter', true), false, 'Otras teclas no deben disparar cierre');

    // Ninguna acción de cierre debe modificar plan ni rehidratar
    assert.equal(updateCalls, 0, 'Cerrar no debe llamar a updateSelectedPlan');
    assert.equal(reloadCalls, 0, 'Cerrar no debe llamar a reloadServerState');
  });

  it('2. Elegir el mismo plan activo cierra sin llamar a updateSelectedPlan ni reloadServerState; elegir otro plan sí actualiza y recarga', async () => {
    let closeCalls = 0;
    const updatedPlans: string[] = [];
    let reloadCalls = 0;

    const pendingPromises: Array<Promise<unknown>> = [];

    const triggerSelection = (planId: string) => {
      const p = executePlanSelection({
        planId,
        currentPlanId: 'plan-a',
        updateSelectedPlan: async (id) => {
          updatedPlans.push(id);
          return { success: true };
        },
        reloadServerState: async () => {
          reloadCalls += 1;
        },
        onClose: () => {
          closeCalls += 1;
        },
      });
      pendingPromises.push(p);
      return p;
    };

    const tree = PlanSelectorModalView({
      isOpen: true,
      isMobile: false,
      institutions: SAMPLE_INSTITUTIONS,
      loading: false,
      switchingId: null,
      currentPlanId: 'plan-a',
      canClose: true,
      onClose: () => {
        closeCalls += 1;
      },
      onSelectPlan: (planId) => {
        void triggerSelection(planId);
      },
    });

    // Click en el botón del plan ya activo ("Seleccionado")
    const selectedButtons = findElements(
      tree,
      (el) => el.type === 'button' && getTextContent(el).trim() === 'Seleccionado'
    );
    assert.equal(selectedButtons.length, 1, 'El plan activo debe ofrecer botón clickeable "Seleccionado"');
    (selectedButtons[0].props.onClick as () => void)();
    const sameResult = await pendingPromises[0];

    assert.equal(sameResult, 'same-plan-closed');
    assert.equal(closeCalls, 1, 'Elegir el mismo plan debe cerrar el modal');
    assert.deepEqual(updatedPlans, [], 'Elegir el mismo plan NO debe llamar a updateSelectedPlan');
    assert.equal(reloadCalls, 0, 'Elegir el mismo plan NO debe llamar a reloadServerState');

    // Click en el botón de otro plan ("Elegir plan")
    const switchButtons = findElements(
      tree,
      (el) => el.type === 'button' && getTextContent(el).trim() === 'Elegir plan'
    );
    assert.equal(switchButtons.length, 1, 'El otro plan debe mostrar "Elegir plan"');
    (switchButtons[0].props.onClick as () => void)();
    const switchResult = await pendingPromises[1];

    assert.equal(switchResult, 'switched');
    assert.deepEqual(updatedPlans, ['plan-b'], 'Elegir otro plan sí llama a updateSelectedPlan con ese id');
    assert.equal(reloadCalls, 1, 'Elegir otro plan sí llama a reloadServerState');
    assert.equal(closeCalls, 2, 'Elegir otro plan cierra el modal al completar');
  });

  it('3. Modo obligatorio sin plan activo: muestra "Elegí tu carrera para continuar", oculta X y Cancelar, y NO cierra por overlay ni Escape', () => {
    assert.equal(isPlanSelectorDismissible(null), false);
    assert.equal(isPlanSelectorDismissible(undefined), false);
    assert.equal(isPlanSelectorDismissible('plan-a', true), false);
    assert.equal(isPlanSelectorDismissible('plan-a'), true);
    assert.equal(getPlanSelectorSubtitle(false), PLAN_SELECTOR_MANDATORY_SUBTITLE);
    assert.equal(getPlanSelectorSubtitle(true), PLAN_SELECTOR_DEFAULT_SUBTITLE);

    let closeCalls = 0;

    // Escritorio obligatorio
    const desktopProps = {
      isOpen: true,
      isMobile: false,
      institutions: SAMPLE_INSTITUTIONS,
      loading: false,
      switchingId: null,
      currentPlanId: null,
      canClose: false,
      onClose: () => {
        closeCalls += 1;
      },
      onSelectPlan: () => {},
    };

    const desktopHtml = renderToStaticMarkup(React.createElement(PlanSelectorModalView, desktopProps));
    assert.ok(
      desktopHtml.includes(PLAN_SELECTOR_MANDATORY_SUBTITLE),
      'Debe explicar por qué es obligatorio: "Elegí tu carrera para continuar"'
    );
    assert.equal(
      desktopHtml.includes('Cerrar selector de carreras y planes'),
      false,
      'Modo obligatorio en escritorio NO debe renderizar botón X'
    );
    assert.equal(
      desktopHtml.includes('>Cancelar<'),
      false,
      'Modo obligatorio en escritorio NO debe renderizar botón Cancelar'
    );

    const desktopTree = PlanSelectorModalView(desktopProps);
    const overlays = findElements(
      desktopTree,
      (el) => el.props['data-testid'] === 'plan-selector-overlay'
    );
    assert.equal(overlays.length, 1);
    const overlayRef = { id: 'overlay' };
    (overlays[0].props.onClick as (e: unknown) => void)({
      target: overlayRef,
      currentTarget: overlayRef,
    });
    assert.equal(closeCalls, 0, 'Modo obligatorio NO debe cerrarse al clickear el overlay');
    assert.equal(
      shouldCloseOnPlanSelectorOverlayClick(overlayRef, overlayRef, false),
      false
    );
    assert.equal(
      shouldCloseOnPlanSelectorKeyDown('Escape', false),
      false,
      'Modo obligatorio NO debe cerrarse con tecla Escape'
    );

    // Móvil obligatorio
    const mobileProps = {
      ...desktopProps,
      isMobile: true,
    };
    const mobileTree = PlanSelectorModalView(mobileProps);
    const bottomSheets = findElements(mobileTree, (el) => el.type === BottomSheet);
    assert.equal(bottomSheets.length, 1, 'Modo obligatorio móvil debe delegar en BottomSheet');
    assert.equal(bottomSheets[0].props.dismissible, false, 'BottomSheet debe quedar no cerrable');
    assert.equal(bottomSheets[0].props.hideCloseButton, true, 'BottomSheet debe ocultar botón X');
    assert.equal(bottomSheets[0].props.footer, undefined, 'BottomSheet no debe renderizar footer Cancelar');
    assert.equal(bottomSheets[0].props.subtitle, PLAN_SELECTOR_MANDATORY_SUBTITLE);

    const mobileHtml = renderToStaticMarkup(React.createElement(PlanSelectorModalView, mobileProps));
    assert.ok(mobileHtml.includes(PLAN_SELECTOR_MANDATORY_SUBTITLE));
    assert.equal(mobileHtml.includes('aria-label="Cerrar panel"'), false);
    assert.equal(mobileHtml.includes('>Cancelar<'), false);
  });

  it('4. Render móvil con plan activo: BottomSheet muestra botón X accesible (w-11 h-11), botón Cancelar y target >= 48px', () => {
    let closeCalls = 0;
    let updateCalls = 0;

    const mobileProps = {
      isOpen: true,
      isMobile: true,
      institutions: SAMPLE_INSTITUTIONS,
      loading: false,
      switchingId: null,
      currentPlanId: 'plan-a',
      canClose: true,
      onClose: () => {
        closeCalls += 1;
      },
      onSelectPlan: () => {
        updateCalls += 1;
      },
    };

    const mobileHtml = renderToStaticMarkup(React.createElement(PlanSelectorModalView, mobileProps));
    assert.match(mobileHtml, /role="dialog"/, 'BottomSheet móvil debe declarar role="dialog"');
    assert.match(mobileHtml, /aria-modal="true"/, 'BottomSheet móvil debe declarar aria-modal="true"');
    assert.match(
      mobileHtml,
      /aria-label="Cerrar panel"/,
      'Render móvil debe incluir botón de cerrar (X) visible y accesible'
    );
    assert.match(mobileHtml, /w-11 h-11/, 'Botón X móvil debe mantener tamaño táctil >= 44x44px');
    assert.match(mobileHtml, />Cancelar</, 'Render móvil debe incluir botón Cancelar en footer');
    assert.match(mobileHtml, /min-h-\[48px\]/, 'Botones de plan móviles deben medir >= 48px');

    const mobileTree = PlanSelectorModalView(mobileProps);
    const cancelButtons = findElements(
      mobileTree,
      (el) => el.type === 'button' && getTextContent(el).trim() === 'Cancelar'
    );
    assert.equal(cancelButtons.length, 1);
    (cancelButtons[0].props.onClick as () => void)();
    assert.equal(closeCalls, 1);

    const bottomSheets = findElements(mobileTree, (el) => el.type === BottomSheet);
    assert.equal(bottomSheets[0].props.dismissible, true);
    (bottomSheets[0].props.onClose as () => void)();
    assert.equal(closeCalls, 2);
    assert.equal(updateCalls, 0);
  });

  it('5. Scroll-lock: bloquea scroll al abrir y restaura document.body.style.overflow aunque el modal se desmonte estando abierto', () => {
    const originalDocument = (globalThis as { document?: unknown }).document;
    const fakeDocument = {
      body: {
        style: {
          overflow: 'auto',
        },
      },
    };
    (globalThis as { document?: unknown }).document = fakeDocument;

    try {
      const initialLayers = getActiveLayersCount();
      const release = acquirePlanSelectorScrollLock('plan-selector-test-unmount');
      assert.equal(fakeDocument.body.style.overflow, 'hidden', 'Debe bloquear el scroll del body al abrir');
      assert.equal(getActiveLayersCount(), initialLayers + 1);

      // Simular desmontaje abrupto estando abierto (sin ejecutar onClose)
      release();
      assert.equal(
        fakeDocument.body.style.overflow,
        'auto',
        'Al desmontar estando abierto debe restaurar el overflow original del body'
      );
      assert.equal(getActiveLayersCount(), initialLayers);

      // Idempotente ante doble liberación
      release();
      assert.equal(fakeDocument.body.style.overflow, 'auto');
      assert.equal(getActiveLayersCount(), initialLayers);
    } finally {
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  });

  it('6. Restauración de foco: devuelve el foco al trigger conectado o al chip del plan si el ítem de UserMenu se desmontó', () => {
    let triggerFocused = 0;
    let chipFocused = 0;

    const connectedTrigger = {
      isConnected: true,
      focus: () => {
        triggerFocused += 1;
      },
    } as unknown as HTMLElement;

    const detachedUserMenuItem = {
      isConnected: false,
      focus: () => {
        triggerFocused += 1;
      },
    } as unknown as HTMLElement;

    const planChipFallback = {
      isConnected: true,
      focus: () => {
        chipFocused += 1;
      },
    } as unknown as HTMLElement;

    const restoredPrimary = restorePlanSelectorFocus(connectedTrigger, planChipFallback);
    assert.equal(restoredPrimary, connectedTrigger);
    assert.equal(triggerFocused, 1);
    assert.equal(chipFocused, 0, 'Si el trigger original sigue montado, no usa el fallback');

    const restoredFallback = restorePlanSelectorFocus(detachedUserMenuItem, planChipFallback);
    assert.equal(restoredFallback, planChipFallback);
    assert.equal(triggerFocused, 1, 'No intenta enfocar un botón de menú ya desmontado');
    assert.equal(chipFocused, 1, 'Debe devolver el foco al chip del plan cuando el trigger previo se desmontó');

    const originalDocument = (globalThis as { document?: unknown }).document;
    const fakeBody = { isConnected: true, focus: () => {} } as unknown as HTMLElement;
    (globalThis as { document?: unknown }).document = { body: fakeBody };
    try {
      const restoredFromBody = restorePlanSelectorFocus(fakeBody, planChipFallback);
      assert.equal(restoredFromBody, planChipFallback);
      assert.equal(chipFocused, 2, 'Si activeElement quedó en document.body, enfoca el chip del plan');
    } finally {
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  });

  it('7. Regresión estructural: PlanSelectorModal fuera de </header>, createPortal a document.body y safe-area superior en BottomSheet', () => {
    const navbarContent = fs.readFileSync(
      path.join(rootDir, 'src/components/common/Navbar.tsx'),
      'utf8'
    );
    const headerCloseIdx = navbarContent.indexOf('</header>');
    const modalIdx = navbarContent.indexOf('<PlanSelectorModal');
    assert.ok(headerCloseIdx !== -1, 'Navbar debe contener </header>');
    assert.ok(modalIdx > headerCloseIdx, 'PlanSelectorModal debe renderizarse FUERA y después de </header>');
    assert.match(navbarContent, /fallbackFocusRef=\{planChipRef\}/, 'Navbar debe pasar planChipRef como foco de respaldo');

    const modalContent = fs.readFileSync(
      path.join(rootDir, 'src/components/common/PlanSelectorModal.tsx'),
      'utf8'
    );
    assert.match(modalContent, /createPortal\(/, 'PlanSelectorModal debe usar createPortal');
    assert.match(modalContent, /document\.body/, 'createPortal debe montar en document.body');

    const sheetContent = fs.readFileSync(
      path.join(rootDir, 'src/components/common/BottomSheet.tsx'),
      'utf8'
    );
    assert.match(sheetContent, /dismissible = true/, 'BottomSheet debe mantener dismissible = true por defecto');
    assert.match(sheetContent, /env\(safe-area-inset-top/, 'BottomSheet debe respetar safe-area superior para no quedar tapado por el notch');
  });
});
