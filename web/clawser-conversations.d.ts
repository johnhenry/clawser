export interface ConversationMeta {
  id: string;
  name?: string;
  created?: number;
  lastUsed?: number;
  [key: string]: unknown;
}

export function loadConversations(wsId: string): Promise<ConversationMeta[]>;
export function updateConversationMeta(wsId: string, convId: string, updates: Partial<ConversationMeta>): Promise<void>;
export function generateConvId(): string;
