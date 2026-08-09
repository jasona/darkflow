/** Loosely typed window layout/update node (docs/gmcp-darkwind-window.md:68-145). */
export interface DarkwindWindowLayoutNode {
  type?: string;
  id?: string;
  style?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Darkwind.Window.Open inbound payload (docs/gmcp-darkwind-window.md:31-66). */
export interface DarkwindWindowOpen {
  id: string;
  type?: string;
  title?: string;
  closable?: boolean | number;
  width?: string | number;
  height?: string | number;
  dock?: string;
  order?: number;
  defaultFloatW?: number;
  defaultFloatH?: number;
  defaultFloatX?: number;
  defaultFloatY?: number;
  defaultBelowPanel?: string;
  defaultSnapLeft?: boolean;
  defaultSnapTop?: boolean;
  defaultSnapRight?: boolean;
  defaultSnapBottom?: boolean;
  layout: DarkwindWindowLayoutNode;
  [key: string]: unknown;
}

/** Darkwind.Window.Update inbound payload (docs/gmcp-darkwind-window.md:197-207). */
export interface DarkwindWindowUpdate {
  id: string;
  updates: DarkwindWindowLayoutNode[];
  [key: string]: unknown;
}

/** Darkwind.Window.Close inbound payload (docs/gmcp-darkwind-window.md:241-244). */
export interface DarkwindWindowClose {
  id: string;
  [key: string]: unknown;
}

/** Darkwind.Window.Submit outbound payload (docs/gmcp-darkwind-window.md:255-264). */
export interface DarkwindWindowSubmit {
  id: string;
  button: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

/** Darkwind.Window.Action outbound payload (docs/gmcp-darkwind-window.md:280-284). */
export interface DarkwindWindowAction {
  id: string;
  button: string;
  [key: string]: unknown;
}

/** Darkwind.Window.Closed outbound payload (docs/gmcp-darkwind-window.md:293-296). */
export interface DarkwindWindowClosed {
  id: string;
  [key: string]: unknown;
}
