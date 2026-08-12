export type { WorkspacePanelInspection as PanelObservation } from "../client/workspace/dockview-workspace";
export type { TerminalIslandObservation as TerminalObservation } from "../client/workspace/terminal-island";
export type {
  WorkspaceDiagnostics,
  WorkspaceTestBridge,
} from "../client/phase0/workspace/workspace-test-bridge";
export type {
  PanelPlacement,
  PanelState,
  WorkspacePanelSpec as PanelSpec,
  WorkspaceSnapshot,
} from "../client/workspace/workspace";

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
