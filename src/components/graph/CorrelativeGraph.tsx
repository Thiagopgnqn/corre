import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
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
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { ELECTIVES } from '../../data/electives';
import { getSubjectStatus, ALL_SUBJECTS_MAP } from '../../utils/correlativas';
import { SubjectNode } from './SubjectNode';
import { SubjectDrawer } from './SubjectDrawer';
import type { SubjectNodeData } from './SubjectNode';
import type { Subject, SubjectStatus } from '../../types/career';

const nodeTypes = {
  subjectNode: SubjectNode,
};

interface NodeContextMenuState {
  subjectId: number;
  x: number;
  y: number;
}

export const CorrelativeGraph: React.FC = () => {
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
  } = useCareer();

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
      className="relative w-full h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-4.25rem)] bg-slate-950 overflow-hidden"
    >
      {/* Top Floating Controls & Legend */}
      <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-20 flex flex-wrap items-center gap-2 pointer-events-none max-w-[calc(100vw-1.5rem)]">
        <div
          data-tour="graph-controls"
          className="pointer-events-auto bg-slate-900/90 backdrop-blur-md p-1.5 sm:p-2 sm:px-3 rounded-xl border border-slate-800 shadow-xl flex flex-wrap items-center gap-2 sm:gap-3 text-xs"
        >
          {/* Edge Legend */}
          <div data-tour="edge-legend" className="flex items-center gap-2">
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

          <div className="h-3 w-[1px] bg-slate-800 hidden sm:block" />

          {/* Electives toggle */}
          <button
            onClick={() => setShowElectivesInGraph(!showElectivesInGraph)}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              showElectivesInGraph
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/80'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>{showElectivesInGraph ? 'Ocultar Electivas' : 'Ver Electivas'}</span>
          </button>

          {/* Active selection badge */}
          {selectedSubjectId && (
            <button
              onClick={() => setSelectedSubjectId(null)}
              className="px-2 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium flex items-center gap-1 hover:bg-indigo-500/30 whitespace-nowrap shrink-0"
              title="Limpiar selección"
            >
              <span>Foco activo</span>
              <X className="w-3 h-3 shrink-0" />
            </button>
          )}
        </div>
      </div>

      {/* React Flow Graph */}
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
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.5}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        className="bg-slate-950"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="#1e293b"
          className="bg-slate-950"
        />
        <Controls
          className="!bg-slate-900/90 !border !border-slate-800 !rounded-xl !overflow-hidden !shadow-2xl fill-slate-300"
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

      {/* Menú contextual (click derecho sobre una materia en el mapa) */}
      {contextMenu && contextSubject && (
        <div
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          role="menu"
          className="fixed z-50 w-56 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 shadow-2xl py-1.5 text-xs divide-y divide-slate-800/80"
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
