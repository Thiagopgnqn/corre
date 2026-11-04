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
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { ELECTIVES } from '../../data/electives';
import { getSubjectStatus, ALL_SUBJECTS_MAP } from '../../utils/correlativas';
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
      <span>Ver todo</span>
    </button>
  );
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

  // Build the complete list of subjects to display
  const activeSubjects = useMemo(() => {
    const core = settings.includeAnalistaTrack
      ? CORE_SUBJECTS
      : CORE_SUBJECTS.filter((s) => s.id !== 99);

    if (!showElectivesInGraph) {
      return core;
    }

    const yearByElective = new Map<number, number>();
    for (let y = 1; y <= 5; y++) {
      (assignedElectives[y] || []).forEach((id) => yearByElective.set(id, y));
    }

    const electivesWithAssignedYear: Subject[] = ELECTIVES.map((el) => {
      const assignedYear = yearByElective.get(el.id);
      return {
        ...el,
        assignedYear,
      };
    });

    return [...core, ...electivesWithAssignedYear];
  }, [settings.includeAnalistaTrack, showElectivesInGraph, assignedElectives]);

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

  // Generate nodes with positions grouped in columns by level
  const currentNodes = useMemo(() => {
    const xPositions: Record<number, number> = {
      1: 50,
      2: 380,
      3: 710,
      4: 1040,
      5: 1370,
    };

    const levelCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    return activeSubjects.map((subject) => {
      const targetCol = subject.assignedYear && subject.assignedYear >= 1 && subject.assignedYear <= 5
        ? subject.assignedYear
        : subject.level;
      const colIndex = levelCounts[targetCol] || 0;
      levelCounts[targetCol] = colIndex + 1;

      const x = xPositions[targetCol] || 50;
      const y = 80 + colIndex * 155;

      const status = getSubjectStatus(subject, activeState);
      const grade = activeState[subject.id]?.grade;

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
        isSelected,
        isHovered,
        isPrereqHighlight,
        isUnlockHighlight,
        isDimmed,
        onOpenStatusModal: setStatusModalSubjectId,
      };

      return {
        id: String(subject.id),
        type: 'subjectNode',
        position: { x, y },
        data: nodeData,
      } as Node;
    });
  }, [
    activeSubjects,
    activeState,
    selectedSubjectId,
    hoveredNodeId,
    upstreamSet,
    downstreamSet,
    focusedId,
    setStatusModalSubjectId,
  ]);

  // Generate edges: dashed for regular, solid for approved
  
  // Dynamic initial viewport and translateExtent based on actual nodes
  const { initialViewport, dynamicTranslateExtent, isDegreeComplete } = useMemo(() => {
    if (currentNodes.length === 0) {
      return {
        initialViewport: { x: 50, y: 120, zoom: 0.78 },
        dynamicTranslateExtent: [[-400, -200], [3200, 2200]] as [[number, number], [number, number]],
      };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    currentNodes.forEach((n) => {
      if (n.position.x < minX) minX = n.position.x;
      if (n.position.x > maxX) maxX = n.position.x;
      if (n.position.y < minY) minY = n.position.y;
      if (n.position.y > maxY) maxY = n.position.y;
    });

    const NODE_WIDTH = 240;
    const NODE_HEIGHT = 120;
    const MARGIN_X = 300;
    const MARGIN_Y = 250;

    const dynamicTranslateExtent: [[number, number], [number, number]] = [
      [Math.round(minX - MARGIN_X), Math.round(minY - MARGIN_Y)],
      [Math.round(maxX + NODE_WIDTH + MARGIN_X), Math.round(maxY + NODE_HEIGHT + MARGIN_Y)],
    ];

    // Verificar si la carrera está completa (todas aprobadas/promocionadas y ninguna cursando)
    const cursandoNodes = currentNodes.filter((n) => {
      const data = n.data as unknown as SubjectNodeData;
      return data.status === 'cursando';
    });
    const unapprovedNodes = currentNodes.filter((n) => {
      const data = n.data as unknown as SubjectNodeData;
      return data.status !== 'aprobada' && data.status !== 'promocionada';
    });

    const isDegreeComplete = cursandoNodes.length === 0 && unapprovedNodes.length === 0;

    let targetNodes: Node[] = [];

    if (cursandoNodes.length > 0) {
      // Si las materias cursando están en años distintos, centrar en el año con más materias cursando
      // (o en el menor año si hay empate) para evitar caer en un espacio vacío entre nodos.
      const yearBuckets = new Map<number, Node[]>();
      cursandoNodes.forEach((n) => {
        const data = n.data as unknown as SubjectNodeData;
        const yr = data.subject.level || 1;
        const bucket = yearBuckets.get(yr) || [];
        bucket.push(n);
        yearBuckets.set(yr, bucket);
      });

      let bestYear = 1;
      let maxCount = -1;
      const sortedYears = Array.from(yearBuckets.keys()).sort((a, b) => a - b);
      sortedYears.forEach((yr) => {
        const count = yearBuckets.get(yr)!.length;
        if (count > maxCount) {
          maxCount = count;
          bestYear = yr;
        }
      });

      targetNodes = yearBuckets.get(bestYear) || cursandoNodes;
    } else if (unapprovedNodes.length > 0) {
      // Si no hay materias cursando, centrar en el año más bajo con materias no aprobadas
      const minYear = Math.min(
        ...unapprovedNodes.map((n) => {
          const data = n.data as unknown as SubjectNodeData;
          return data.subject.level || 1;
        })
      );
      targetNodes = unapprovedNodes.filter((n) => {
        const data = n.data as unknown as SubjectNodeData;
        return (data.subject.level || 1) === minYear;
      });
    }

    if (targetNodes.length === 0) {
      targetNodes = currentNodes.filter((n) => {
        const data = n.data as unknown as SubjectNodeData;
        return (data.subject.level || 1) === 1;
      });
    }

    let tMinX = Infinity;
    let tMaxX = -Infinity;
    let tMinY = Infinity;
    targetNodes.forEach((n) => {
      if (n.position.x < tMinX) tMinX = n.position.x;
      if (n.position.x > tMaxX) tMaxX = n.position.x;
      if (n.position.y < tMinY) tMinY = n.position.y;
    });

    const zoom = 0.78; // Texto legible de al menos 11-12px efectivos
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 390;
    const targetCenterX = (tMinX + tMaxX + NODE_WIDTH) / 2;
    const calcX = Math.round(screenWidth / 2 - targetCenterX * zoom);
    const calcY = Math.round(140 - tMinY * zoom);

    return {
      initialViewport: { x: calcX, y: calcY, zoom },
      dynamicTranslateExtent,
      isDegreeComplete,
    };
  }, [currentNodes]);

  const currentEdges = useMemo(() => {
    const edges: Edge[] = [];
    const displayedIds = new Set(activeSubjects.map((s) => s.id));

    activeSubjects.forEach((subject) => {
      // Regular prereqs: dashed amber
      subject.regularPrereqs.forEach((reqId) => {
        if (!displayedIds.has(reqId)) return;

        const isConnectedToFocus = Boolean(
          focusedId &&
          ((focusedId === subject.id && upstreamSet.has(reqId)) ||
            (focusedId === reqId && downstreamSet.has(subject.id)) ||
            (upstreamSet.has(subject.id) && upstreamSet.has(reqId)) ||
            (downstreamSet.has(subject.id) && downstreamSet.has(reqId)))
        );

        const isDimmed = Boolean(focusedId && !isConnectedToFocus);

        edges.push({
          id: `reg-${reqId}-${subject.id}`,
          source: String(reqId),
          target: String(subject.id),
          animated: isConnectedToFocus,
          style: {
            stroke: isConnectedToFocus ? '#fbbf24' : isDimmed ? '#334155' : '#d97706',
            strokeWidth: isConnectedToFocus ? 2.5 : 1.2,
            strokeDasharray: '5,5',
            opacity: isDimmed ? 0.15 : 0.85,
          },
        });
      });

      // Approved prereqs: solid emerald
      subject.approvedPrereqs.forEach((reqId) => {
        if (!displayedIds.has(reqId)) return;

        const isConnectedToFocus = Boolean(
          focusedId &&
          ((focusedId === subject.id && upstreamSet.has(reqId)) ||
            (focusedId === reqId && downstreamSet.has(subject.id)) ||
            (upstreamSet.has(subject.id) && upstreamSet.has(reqId)) ||
            (downstreamSet.has(subject.id) && downstreamSet.has(reqId)))
        );

        const isDimmed = Boolean(focusedId && !isConnectedToFocus);

        edges.push({
          id: `apr-${reqId}-${subject.id}`,
          source: String(reqId),
          target: String(subject.id),
          animated: isConnectedToFocus,
          style: {
            stroke: isConnectedToFocus ? '#34d399' : isDimmed ? '#334155' : '#059669',
            strokeWidth: isConnectedToFocus ? 2.5 : 1.5,
            opacity: isDimmed ? 0.15 : 0.85,
          },
        });
      });
    });

    return edges;
  }, [activeSubjects, focusedId, upstreamSet, downstreamSet]);

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

  const contextSubject = contextMenu ? ALL_SUBJECTS_MAP.get(contextMenu.subjectId) : null;

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
      <div className="absolute top-2 inset-x-2 sm:top-4 sm:left-4 sm:right-auto z-[var(--z-graph-controls)] flex items-center justify-between sm:justify-start gap-2 pointer-events-none">
        <div
          data-tour="graph-controls"
          className="pointer-events-auto bg-slate-900/90 backdrop-blur-md p-1.5 sm:p-2 sm:px-3 rounded-2xl border border-slate-800 shadow-xl flex items-center gap-1.5 sm:gap-3 text-xs max-w-full overflow-hidden"
        >
          {/* Segmented Switcher en Mobile: Lista | Mapa */}
          {isMobile && (
            <div className="inline-flex rounded-xl bg-slate-950 p-0.5 border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => handleSetMobileGraphView('lista')}
                className={`min-h-[38px] px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1 transition-all cursor-pointer ${
                  mobileGraphView === 'lista'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>📋 Lista</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetMobileGraphView('mapa')}
                className={`min-h-[38px] px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1 transition-all cursor-pointer ${
                  mobileGraphView === 'mapa'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🗺️ Mapa</span>
              </button>
            </div>
          )}

          {/* Edge Legend */}
          <div data-tour="edge-legend" className="hidden sm:flex items-center gap-2">
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

          <FitViewButton className="min-h-[38px] px-2.5 py-1 rounded-lg font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 flex items-center gap-1.5 cursor-pointer text-xs transition-colors shrink-0" />

          <div className="h-3 w-[1px] bg-slate-800 hidden sm:block" />

          {/* Electives toggle */}
          <button
            type="button"
            onClick={() => setShowElectivesInGraph(!showElectivesInGraph)}
            className={`min-h-[38px] px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              showElectivesInGraph
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/80'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{showElectivesInGraph ? 'Ocultar Electivas' : 'Ver Electivas'}</span>
            <span className="sm:hidden">{showElectivesInGraph ? 'Sin Electivas' : 'Electivas'}</span>
          </button>

          {/* Active selection badge */}
          {selectedSubjectId && (
            <button
              type="button"
              onClick={() => setSelectedSubjectId(null)}
              className="min-h-[38px] px-2 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium flex items-center gap-1 hover:bg-indigo-500/30 whitespace-nowrap shrink-0 cursor-pointer"
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
        <div className="flex-1 min-h-0 pt-16 flex flex-col overflow-hidden">
          <SubjectListView
            subjects={activeSubjects}
            activeState={activeState}
            onSelectSubject={(id) => setSelectedSubjectId(id)}
            selectedSubjectId={selectedSubjectId}
            isSimulationActive={isSimulationMode}
          />
        </div>
      ) : (
        <ReactFlow
          nodes={currentNodes}
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
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.5}
            color="#1e293b"
            className="bg-slate-950"
          />
          <Controls
            showInteractive={false}
            className="!bg-slate-900/90 !border !border-slate-800 !rounded-xl !overflow-hidden !shadow-2xl fill-slate-300 !bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+0.75rem)] md:!bottom-4 !right-3 md:!right-auto md:!left-4 z-[var(--z-graph-controls)]"
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
              onClick={() => {
                const subId = contextMenu.subjectId;
                setContextMenu(null);
                openEnrollmentModal(subId);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-slate-800 text-indigo-300 font-semibold flex items-center gap-2 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span>Indicar comisión / docentes</span>
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
