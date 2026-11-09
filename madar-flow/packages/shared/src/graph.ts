export interface Position {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  type: string;
  typeVersion: number;
  name: string;
  position: Position;
  parameters: Record<string, unknown>;
  disabled?: boolean;
  notes?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };
