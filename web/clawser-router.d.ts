export interface PanelDef {
  id: string;
  btn: string;
  label: string;
}

export interface ParsedRoute {
  route: string;
  wsId?: string;
  convId?: string;
  panel?: string;
  wshSession?: {
    sessionId: string;
    token: string;
    mode: string;
    host: string;
  };
}

export const PANELS: Readonly<Record<string, PanelDef>>;
export const PANEL_NAMES: Set<string>;

export function isPanelRendered(panelName: string): boolean;
export function resetRenderedPanels(): void;
export function parseHash(): ParsedRoute;
export function navigate(route: string, wsId?: string, convId?: string, panel?: string): void;
export function showView(viewId: 'viewHome' | 'viewWorkspace'): void;
export function getActivePanel(): string;
export function updateRouteHash(): void;
export function activatePanel(panelName: string): void;
export function initRouterListeners(): void;
