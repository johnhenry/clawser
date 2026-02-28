export interface TextSegment {
  type: 'text';
  content: string;
}

export interface RefSegment {
  type: 'ref';
  agent: string;
  content: string;
}

export type Segment = TextSegment | RefSegment;

export function parseAgentRefs(prompt: string): Segment[];
export function hasAgentRefs(prompt: string): boolean;

export function executeAgentRef(
  agentDef: Record<string, unknown>,
  message: string,
  opts?: {
    providers?: unknown;
    browserTools?: unknown;
    mcpManager?: unknown;
    onLog?: (msg: string) => void;
    onStream?: (chunk: unknown) => void;
    createEngine?: () => unknown;
    visited?: Set<string>;
    depth?: number;
  },
): Promise<{ response: string; usage?: Record<string, unknown> }>;

export function processAgentRefs(
  prompt: string,
  opts: Record<string, unknown>,
  visited?: Set<string>,
  depth?: number,
): Promise<{ prompt: string; refs: Array<{ agent: string; response: string }> }>;

export function filterToolsForAgent(
  allTools: Array<Record<string, unknown>>,
  toolConfig: { mode: string; list?: string[] },
): Array<Record<string, unknown>>;
