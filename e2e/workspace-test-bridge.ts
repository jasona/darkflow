export type { WorkspacePanelInspection as PanelObservation } from "../client/phase0/workspace/dockview-workspace";
export type { TerminalIslandObservation as TerminalObservation } from "../client/phase0/workspace/terminal-island";
export type {
  WorkspaceDiagnostics,
  WorkspaceTestBridge,
} from "../client/phase0/workspace/workspace-test-bridge";
export type {
  PanelPlacement,
  PanelState,
  WorkspacePanelSpec as PanelSpec,
  WorkspaceSnapshot,
} from "../client/phase0/workspace/workspace";

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
