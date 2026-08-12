import type { WorkspacePanelInspection } from "../../workspace/dockview-workspace";
import type { TerminalIslandObservation } from "../../workspace/terminal-island";
import type {
  PanelPlacement,
  WorkspacePanelSpec,
  WorkspaceSnapshot,
} from "../../workspace/workspace";

export interface WorkspaceDiagnostics {
  mounts: number;
  layouts: number;
  updates: number;
  unmounts: number;
  duplicateDisposals: number;
  liveRoots: number;
  liveHosts: number;
  subscriptions: number;
  observers: number;
  listeners: number;
  terminalIslands: number;
  ownedDom: number;
}

export interface WorkspaceTestBridge {
  upsert(spec: WorkspacePanelSpec): void;
  remove(id: string): Promise<void>;
  move(id: string, placement: PanelPlacement): void;
  resize(id: string, size: { width?: number; height?: number }): void;
  activate(id: string): void;
  save(): WorkspaceSnapshot;
  restore(snapshot: WorkspaceSnapshot, panels: readonly WorkspacePanelSpec[]): boolean;
  subscribeLayout(): void;
  unsubscribeLayout(): void;
  resetLayoutEvents(): void;
  layoutEvents(): number;
  appendTerminal(id: string, text: string): void;
  focusTerminal(id: string): void;
  scrollTerminal(id: string, scrollTop: number): void;
  panel(id: string): WorkspacePanelInspection | null;
  terminal(id: string): TerminalIslandObservation | null;
  diagnostics(): WorkspaceDiagnostics;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __darkflowWorkspace: WorkspaceTestBridge;
  }
}
