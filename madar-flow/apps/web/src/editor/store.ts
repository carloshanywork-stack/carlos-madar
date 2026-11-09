import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type { WorkflowGraph } from '../api';
import { metaFor } from './node-catalog';

export interface MadarNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  disabled?: boolean;
  notes?: string;
}

export type MadarNode = Node<MadarNodeData>;

export const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#64748b' },
  style: { strokeWidth: 1.8, stroke: '#64748b' },
};

export function graphToFlow(graph: WorkflowGraph): { nodes: MadarNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: 'madar',
      position: node.position,
      data: {
        label: node.name,
        nodeType: node.type,
        typeVersion: node.typeVersion,
        parameters: node.parameters,
        disabled: node.disabled ?? false,
        notes: node.notes,
      },
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      ...defaultEdgeOptions,
    })),
  };
}

export function flowToGraph(nodes: MadarNode[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      typeVersion: node.data.typeVersion || 1,
      name: node.data.label || node.data.nodeType,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      parameters: node.data.parameters ?? {},
      disabled: node.data.disabled || undefined,
      notes: node.data.notes || undefined,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    })),
  };
}

interface EditorState {
  nodes: MadarNode[];
  edges: Edge[];
  revision: number;
  editSeq: number;
  dirty: boolean;
  selectedNodeId: string | null;
  conflict: boolean;
  lastSavedAt: string | null;
  hydrate: (graph: WorkflowGraph, revision: number) => void;
  onNodesChange: (changes: NodeChange<MadarNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: string, position: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Partial<MadarNodeData>) => void;
  removeNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  markSaved: (revision: number, seq: number, savedAt: string) => void;
  setConflict: (conflict: boolean) => void;
}

let nodeSequence = 1;

export const useEditorStore = create<EditorState>((set, get) => ({
  nodes: [],
  edges: [],
  revision: 1,
  editSeq: 0,
  dirty: false,
  selectedNodeId: null,
  conflict: false,
  lastSavedAt: null,

  hydrate: (graph, revision) => {
    const flow = graphToFlow(graph);
    set({
      nodes: flow.nodes,
      edges: flow.edges,
      revision,
      editSeq: 0,
      dirty: false,
      selectedNodeId: null,
      conflict: false,
      lastSavedAt: null,
    });
  },

  onNodesChange: (changes) => {
    const meaningful = changes.some(
      (change) =>
        change.type === 'position' ||
        change.type === 'remove' ||
        change.type === 'add' ||
        change.type === 'replace',
    );
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      ...(meaningful ? { dirty: true, editSeq: state.editSeq + 1 } : {}),
    }));
  },

  onEdgesChange: (changes) => {
    const meaningful = changes.some(
      (change) => change.type === 'remove' || change.type === 'add' || change.type === 'replace',
    );
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      ...(meaningful ? { dirty: true, editSeq: state.editSeq + 1 } : {}),
    }));
  },

  onConnect: (connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;

    const state = get();
    const duplicate = state.edges.some(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
        (edge.targetHandle ?? null) === (connection.targetHandle ?? null),
    );
    if (duplicate) return;

    set({
      edges: addEdge({ ...connection, ...defaultEdgeOptions }, state.edges),
      dirty: true,
      editSeq: state.editSeq + 1,
    });
  },

  addNode: (type, position) => {
    const state = get();
    const meta = metaFor(type);
    const sameType = state.nodes.filter((node) => node.data.nodeType === type).length + 1;
    const id = `node_${Date.now().toString(36)}_${nodeSequence++}`;
    const node: MadarNode = {
      id,
      type: 'madar',
      position,
      data: {
        label: `${meta.label} ${sameType}`,
        nodeType: type,
        typeVersion: 1,
        parameters: structuredClone(meta.defaults),
        disabled: false,
      },
    };
    set({
      nodes: [...state.nodes, node],
      selectedNodeId: id,
      dirty: true,
      editSeq: state.editSeq + 1,
    });
  },

  updateNodeData: (id, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
      dirty: true,
      editSeq: state.editSeq + 1,
    }));
  },

  removeNode: (id) => {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
      edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      dirty: true,
      editSeq: state.editSeq + 1,
    }));
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  markSaved: (revision, seq, savedAt) => {
    set((state) => ({
      revision,
      lastSavedAt: savedAt,
      dirty: state.editSeq !== seq,
    }));
  },

  setConflict: (conflict) => set({ conflict }),
}));
