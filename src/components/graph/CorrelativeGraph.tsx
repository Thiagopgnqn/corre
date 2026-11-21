import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  PlayCircle,
  RotateCcw,
  Sparkles,
  Users,
  X,
  Maximize2,
  GitBranch,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BottomSheet } from '../common/BottomSheet';
import { buildGraphViewStructure } from '../../utils/planViewSelectors';
import { SubjectNode } from './SubjectNode';
import { SubjectDrawer } from './SubjectDrawer';
import { SubjectListView } from './SubjectListView';
import type { SubjectNodeData } from './SubjectNode';
import type { Subject, SubjectStatus } from '../../types/career';

export const DEFAULT_MOBILE_GRAPH_VIEW: 'lista' | 'mapa' = 'lista';

const nodeTypes = {
  subjectNode: SubjectNode,
};

interface NodeContextMenuState {
  subjectId: number;
  x: number;
  y: number;
}


const FitViewButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { fitView } = useReactFlow();
  return (
    <button
      type="button"
      onClick={() => fitView({ padding: 0.18, duration: 400 })}
      className={className}
      title="Ajustar vista para ver todo el grafo"
      aria-label="Ver todo el grafo"
    >
      <Maximize2 className="w-3.5 h-3.5 shrink-0" />
      <span className="hidden sm:inline">Ver todo</span>
    </button>
  );
};

const TutorialSampleSubjectCameraSync: React.FC<{
  sampleSubjectId: number;
  nodes: Node[];
}> = ({ sampleSubjectId, nodes }) => {
  const { isTutorialOpen, currentTutorialStep } = useCareer();
  const { setCenter } = useReactFlow();

  useEffect(() => {
    if (!isTutorialOpen) return;
    // Paso 4 (índice 3: interactive-click): garantizar que la materia de ejemplo esté centrada en pantalla
    if (currentTutorialStep !== 3) return;
    const targetNode = nodes.find((n) => Number(n.id) === sampleSubjectId);
    if (!targetNode) return;

    const timer = setTimeout(() => {
      const el = document.querySelector('[data-tour="sample-subject"]');
      if (el instanceof HTMLElement) {
        const r = el.getBoundingClientRect();
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (r.left >= 8 && r.right <= w - 8 && r.top >= 60 && r.bottom <= h - 72) {
          return;
        }
      }
      setCenter(targetNode.position.x + 115, targetNode.position.y + 110, {
        zoom: 0.78,
        duration: 0,
      });
    }, 10);

    return () => clearTimeout(timer);
  }, [isTutorialOpen, currentTutorialStep, sampleSubjectId, nodes, setCenter]);

  return null;
};

const CorrelativeGraphContent: React.FC = () => {
  const {
    activeState,
    selectedSubjectId,
    setSelectedSubjectId,
    setStatusModalSubjectId,
    updateSubjectStatus,
    openEnrollmentModal,
    showElectivesInGraph,
    setShowElectivesInGraph,
    settings,
    assignedElectives,
    isSimulationMode,
    coreSubjects,
    electives,
    subjectsById,
    planConfig,
  } = useCareer();

  const isMobile = useIsMobile();
  const [mobileGraphView, setMobileGraphView] = useState<'lista' | 'mapa'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ui_mobile_graph_view');
      if (saved === 'mapa' || saved === 'lista') return saved;
    }
    return DEFAULT_MOBILE_GRAPH_VIEW;
  });

  const handleSetMobileGraphView = (view: 'lista' | 'mapa') => {
    setMobileGraphView(view);
    if (typeof window !== 'undefined') {
      localStorage.setItem('ui_mobile_graph_view', view);
    }
  };

  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(null);
  const [isLegendSheetOpen, setIsLegendSheetOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', closeMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  // Active focus is either hovered node or selected node
  const focusedId = hoveredNodeId ?? selectedSubjectId;

  const graphStructure = useMemo(
    () =>
      buildGraphViewStructure({
        planConfig,
        coreSubjects,
        electives,
        activeState,
        includeIntermediateTrack: settings.includeAnalistaTrack,
        showElectivesInGraph,
        assignedElectives,
        screenWidth: typeof window !== 'undefined' ? window.innerWidth : 390,
      }),
    [
      planConfig,
      coreSubjects,
      electives,
      activeState,
      settings.includeAnalistaTrack,
      showElectivesInGraph,
      assignedElectives,
    ]
  );

  const {
    activeSubjects,
    initialViewport,
    dynamicTranslateExtent,
    isDegreeComplete,
    sampleSubjectId,
  } = graphStructure;

  // Compute upstream (prerequisites) and downstream (unlocked) dependency sets
  const { upstreamSet, downstreamSet } = useMemo(() => {
    const upstream = new Set<number>();
    const downstream = new Set<number>();

    if (!focusedId) return { upstreamSet: upstream, downstreamSet: downstream };

    const subjectMap = new Map<number, Subject>();
    activeSubjects.forEach((s) => subjectMap.set(s.id, s));

    // Trace upstream (prerequisites)
    function traceUp(id: number) {
      const s = subjectMap.get(id);
      if (!s) return;
      const prereqs = [...s.regularPrereqs, ...s.approvedPrereqs];
      prereqs.forEach((pId) => {
        if (!upstream.has(pId)) {
          upstream.add(pId);
          traceUp(pId);
        }
      });
    }

    // Trace downstream (dependents)
    function traceDown(id: number) {
      activeSubjects.forEach((s) => {
        const prereqs = [...s.regularPrereqs, ...s.approvedPrereqs];
        if (prereqs.includes(id) && !downstream.has(s.id)) {
          downstream.add(s.id);
          traceDown(s.id);
        }
      });
    }

    traceUp(focusedId);
    traceDown(focusedId);

    return { upstreamSet: upstream, downstreamSet: downstream };
  }, [focusedId, activeSubjects]);

  // Generate React Flow nodes from computed graph layout
  const nodesWithSampleSubject = useMemo(() => {
    return graphStructure.nodesLayout.map((item) => {
      const { subject, status, grade, id, position } = item;
      const isSelected = selectedSubjectId === subject.id;
      const isHovered = hoveredNodeId === subject.id;
      const isPrereqHighlight = upstreamSet.has(subject.id);
      const isUnlockHighlight = downstreamSet.has(subject.id);
      const isFocused = focusedId === subject.id;

      // Dim when something is focused and this node is not part of the active path
      const isDimmed = Boolean(
        focusedId && !isFocused && !isPrereqHighlight && !isUnlockHighlight
      );

      const nodeData: SubjectNodeData = {
        subject,
        status,
        grade,
        levelLabel: planConfig?.levelLabel,
        isSelected,
        isHovered,
        isPrereqHighlight,
        isUnlockHighlight,
        isDimmed,
        isSampleSubject: subject.id === sampleSubjectId,
        onOpenStatusModal: setStatusModalSubjectId,
      };

      return {
        id,
        type: 'subjectNode',
        position,
        data: nodeData,
      } as Node;
    });
  }, [
    graphStructure.nodesLayout,
    planConfig?.levelLabel,
    selectedSubjectId,
    hoveredNodeId,
    upstreamSet,
    downstreamSet,
    focusedId,
    sampleSubjectId,
    setStatusModalSubjectId,
  ]);

  const currentEdges = useMemo(() => {
    return graphStructure.edgesLayout.map((edge) => {
      const reqId = Number(edge.source);
      const subjectId = Number(edge.target);

      const isConnectedToFocus = Boolean(
        focusedId &&
        ((focusedId === subjectId && upstreamSet.has(reqId)) ||
          (focusedId === reqId && downstreamSet.has(subjectId)) ||
          (upstreamSet.has(subjectId) && upstreamSet.has(reqId)) ||
          (downstreamSet.has(subjectId) && downstreamSet.has(reqId)))
      );

      const isDimmed = Boolean(focusedId && !isConnectedToFocus);

      if (edge.type === 'regular') {
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated: isConnectedToFocus,
          style: {
            stroke: isConnectedToFocus ? '#fbbf24' : isDimmed ? '#334155' : '#d97706',
            strokeWidth: isConnectedToFocus ? 2.5 : 1.2,
            strokeDasharray: '5,5',
            opacity: isDimmed ? 0.15 : 0.85,
          },
        } as Edge;
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: isConnectedToFocus,
        style: {
          stroke: isConnectedToFocus ? '#34d399' : isDimmed ? '#334155' : '#059669',
          strokeWidth: isConnectedToFocus ? 2.5 : 1.5,
          opacity: isDimmed ? 0.15 : 0.85,
        },
      } as Edge;
    });
  }, [graphStructure.edgesLayout, focusedId, upstreamSet, downstreamSet]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setContextMenu(null);
      const id = Number(node.id);
      setSelectedSubjectId(selectedSubjectId === id ? null : id);
    },
    [selectedSubjectId, setSelectedSubjectId]
  );

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const id = Number(node.id);
    const maxW = typeof window !== 'undefined' ? window.innerWidth - 250 : event.clientX;
    const maxH = typeof window !== 'undefined' ? window.innerHeight - 290 : event.clientY;
    setContextMenu({
      subjectId: id,
      x: Math.max(12, Math.min(event.clientX, maxW)),
      y: Math.max(64, Math.min(event.clientY, maxH)),
    });
  }, []);

  const onNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    setHoveredNodeId(Number(node.id));
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const contextSubject = contextMenu ? subjectsById.get(contextMenu.subjectId) : null;

  const handleContextQuickStatus = (status: SubjectStatus, needsGrade = false) => {
    if (!contextMenu) return;
    const subId = contextMenu.subjectId;
    setContextMenu(null);
    if (needsGrade) {
      setStatusModalSubjectId(subId);
    } else {
      updateSubjectStatus(subId, status, undefined, { source: 'map_context' });
    }
  };

  return (
    <div
      data-tour="graph-canvas"
      className="relative w-full h-[calc(100dvh-var(--app-header-height,3.5rem)-var(--mobile-nav-height)-env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-var(--app-header-height,4rem))] bg-slate-950 overflow-hidden flex flex-col"
    >
      {/* Top Floating Controls & View Switcher */}
      <div
        className={
          isMobile && mobileGraphView === 'lista'
            ? 'relative px-2 pt-2 pb-1 z-[var(--z-graph-controls)] flex items-center justify-between gap-2 shrink-0'
            : 'absolute top-2 inset-x-2 sm:top-4 sm:left-4 sm:right-auto z-[var(--z-graph-controls)] flex items-center justify-between sm:justify-start gap-2 pointer-events-none'
        }
      >
        <div
          data-tour="graph-controls"
          className="pointer-events-auto bg-slate-900/90 backdrop-blur-md p-1 sm:p-2 sm:px-3 rounded-2xl border border-slate-800 shadow-xl flex flex-wrap sm:flex-nowrap items-center gap-1 sm:gap-3 text-xs w-full sm:w-auto max-w-full"
        >
          {/* Segmented Switcher en Mobile: Lista | Mapa */}
          {isMobile && (
            <div className="inline-flex rounded-xl bg-slate-950 p-0.5 border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => handleSetMobileGraphView('lista')}
                className={`min-h-[44px] min-w-[44px] px-2 sm:px-2.5 py-1 rounded-lg font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  mobileGraphView === 'lista'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Ver lista de materias"
                aria-label="Ver lista de materias"
              >
                <span className="min-[360px]:hidden">📋</span>
                <span className="hidden min-[360px]:inline">📋 Lista</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetMobileGraphView('mapa')}
                className={`min-h-[44px] min-w-[44px] px-2 sm:px-2.5 py-1 rounded-lg font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  mobileGraphView === 'mapa'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Ver mapa de correlativas"
                aria-label="Ver mapa de correlativas"
              >
                <span className="min-[360px]:hidden">🗺️</span>
                <span className="hidden min-[360px]:inline">🗺️ Mapa</span>
              </button>
            </div>
          )}

          {/* Edge Legend (Desktop inline / Mobile botón que abre Sheet de Leyenda) */}
          <div data-tour="edge-legend" className="hidden sm:flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1.5 font-medium text-amber-400 whitespace-nowrap">
              <span className="w-4 sm:w-5 h-0 border-t-2 border-dashed border-amber-400 inline-block" />
              <span>Regular</span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="flex items-center gap-1.5 font-medium text-emerald-400 whitespace-nowrap">
              <span className="w-4 sm:w-5 h-0 border-t-2 border-emerald-400 inline-block" />
              <span>Aprobada</span>
            </span>
          </div>

          <button
            type="button"
            data-tour="edge-legend"
            onClick={() => setIsLegendSheetOpen(true)}
            className="sm:hidden min-h-[44px] min-w-[44px] px-2 py-1 rounded-lg font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 flex items-center justify-center gap-1 cursor-pointer text-xs transition-colors shrink-0"
            title="Ver leyenda de correlativas y estados"
            aria-label="Ver leyenda de correlativas"
          >
            <GitBranch className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Leyenda</span>
          </button>

          <FitViewButton className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-0 px-2 sm:px-2.5 py-1 rounded-lg font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 flex items-center justify-center gap-1 cursor-pointer text-xs transition-colors shrink-0" />

          {graphStructure.showElectivesToggle && (
            <>
              <div className="h-3 w-[1px] bg-slate-800 hidden sm:block" />

              {/* Electives toggle */}
              <button
                type="button"
                onClick={() => setShowElectivesInGraph(!showElectivesInGraph)}
                className={`min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-0 px-2 sm:px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                  showElectivesInGraph
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/80'
                }`}
                title={showElectivesInGraph ? 'Ocultar Electivas' : 'Ver Electivas'}
                aria-label={showElectivesInGraph ? 'Ocultar Electivas' : 'Ver Electivas'}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{showElectivesInGraph ? 'Ocultar Electivas' : 'Ver Electivas'}</span>
              </button>
            </>
          )}

          {/* Active selection badge */}
          {selectedSubjectId && (
            <button
              type="button"
              onClick={() => setSelectedSubjectId(null)}
              className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-0 px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium flex items-center justify-center gap-1 hover:bg-indigo-500/30 whitespace-nowrap shrink-0 cursor-pointer"
              title="Limpiar selección"
            >
              <span>Foco</span>
              <X className="w-3 h-3 shrink-0" />
            </button>
          )}
        </div>
      </div>

      {/* Render Mode: Mobile List vs Interactive Canvas Graph */}
      {isMobile && mobileGraphView === 'lista' ? (
        <div className="flex-1 min-h-0 pt-1 flex flex-col overflow-hidden">
          <SubjectListView
            subjects={activeSubjects}
            activeState={activeState}
            onSelectSubject={(id) => setSelectedSubjectId(id)}
            selectedSubjectId={selectedSubjectId}
            isSimulationActive={isSimulationMode}
            sampleSubjectId={sampleSubjectId}
          />
        </div>
      ) : (
        <ReactFlow
          nodes={nodesWithSampleSubject}
          edges={currentEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onPaneClick={() => {
            setContextMenu(null);
            setSelectedSubjectId(null);
          }}
          fitView={!isMobile || isDegreeComplete}
          defaultViewport={isMobile ? initialViewport : undefined}
          fitViewOptions={{ padding: 0.15 }}
          minZoom={isMobile ? 0.35 : 0.2}
          maxZoom={1.5}
          translateExtent={dynamicTranslateExtent}
          nodeClickDistance={5}
          paneClickDistance={5}
          nodesDraggable={!isMobile}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          className="bg-slate-950 flex-1"
        >
          <TutorialSampleSubjectCameraSync
            sampleSubjectId={sampleSubjectId}
            nodes={nodesWithSampleSubject}
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.5}
            color="#1e293b"
            className="bg-slate-950"
          />
          <Controls
            showInteractive={false}
            className="!left-auto !right-3 !top-auto !w-auto !max-w-max !bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+0.75rem)] md:!bottom-4 md:!left-4 md:!right-auto z-[var(--z-graph-controls)] !bg-slate-900/90 !border !border-slate-800 !rounded-xl !overflow-hidden !shadow-2xl fill-slate-300"
          />
          <MiniMap
            nodeColor={(n) => {
              const data = n.data as unknown as SubjectNodeData;
              switch (data.status) {
                case 'aprobada':
                  return '#22c55e';
                case 'promocionada':
                  return '#a855f7';
                case 'regularizada':
                  return '#f59e0b';
                case 'cursando':
                  return '#06b6d4';
                case 'disponible':
                  return '#10b981';
                default:
                  return '#334155';
              }
            }}
            maskColor="rgba(11, 15, 25, 0.75)"
            className="!bg-slate-900/90 !border !border-slate-800 !rounded-xl !overflow-hidden !shadow-xl !bottom-4 !right-4 hidden sm:block"
          />
        </ReactFlow>
      )}

      {/* Menú contextual (click derecho sobre una materia en el mapa) */}
      {contextMenu && contextSubject && (
        <div
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          role="menu"
          className="fixed z-[var(--z-modal)] w-56 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 shadow-2xl py-1.5 text-xs divide-y divide-slate-800/80"
        >
          <div className="px-3 py-2">
            <span className="font-mono text-[10px] text-slate-400">
              #{contextSubject.code} · Nivel {contextSubject.level}
            </span>
            <p className="font-bold text-white truncate">{contextSubject.name}</p>
          </div>

          <div className="py-1">
            <button
              type="button"
              onClick={() => handleContextQuickStatus('cursando')}
              className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-cyan-300 font-semibold flex items-center gap-2 cursor-pointer"
            >
              <PlayCircle className="w-3.5 h-3.5 text-cyan-400" />
              <span>Marcar Cursando</span>
            </button>
            <button
              type="button"
              onClick={() => handleContextQuickStatus('regularizada')}
              className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-amber-300 font-semibold flex items-center gap-2 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Marcar Regularizada</span>
            </button>
            <button
              type="button"
              onClick={() => handleContextQuickStatus('aprobada', true)}
              className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-emerald-300 font-semibold flex items-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Aprobada / Promocionada...</span>
            </button>
            <button
              type="button"
              onClick={() => handleContextQuickStatus('disponible')}
              className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Restablecer pendiente</span>
            </button>
          </div>

          <div className="py-1">
            <button
              type="button"
              disabled={isSimulationMode}
              title={isSimulationMode ? 'No disponible en modo simulación' : undefined}
              onClick={() => {
                if (isSimulationMode) return;
                const subId = contextMenu.subjectId;
                setContextMenu(null);
                openEnrollmentModal(subId);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-indigo-300 font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                {isSimulationMode
                  ? 'Comisión (No disponible en modo simulación)'
                  : 'Indicar comisión / docentes'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                const subId = contextMenu.subjectId;
                setContextMenu(null);
                setSelectedSubjectId(subId);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 flex items-center gap-2 cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              <span>Abrir detalle lateral</span>
            </button>
          </div>
        </div>
      )}

      {/* Drawer with details for selected node */}
      <SubjectDrawer />

      {/* Sheet de Leyenda de Correlativas en Mobile */}
      <BottomSheet
        isOpen={isLegendSheetOpen}
        onClose={() => setIsLegendSheetOpen(false)}
        title="Leyenda de Correlativas"
        maxHeightDvh={75}
      >
        <div className="space-y-4 text-xs text-slate-300 pb-2">
          <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/60 space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Líneas del Mapa
            </h3>
            <div className="flex items-center gap-3">
              <span className="w-8 h-0 border-t-2 border-dashed border-amber-400 inline-block shrink-0" />
              <div>
                <div className="font-bold text-amber-400">Regularizada requerida</div>
                <div className="text-[11px] text-slate-400">
                  Necesitás tener la cursada regularizada para poder cursar la correlativa.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-8 h-0 border-t-2 border-emerald-400 inline-block shrink-0" />
              <div>
                <div className="font-bold text-emerald-400">Aprobada requerida</div>
                <div className="text-[11px] text-slate-400">
                  Exige tener la materia previa aprobada con final o promoción.
                </div>
              </div>
            </div>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};

export const CorrelativeGraph: React.FC = () => {
  return (
    <ReactFlowProvider>
      <CorrelativeGraphContent />
    </ReactFlowProvider>
  );
};
