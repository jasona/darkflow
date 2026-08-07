import type { Component } from "svelte";
import type { Readable } from "svelte/store";

export type PanelState = Record<string, unknown>;

export type PanelPlacement =
  | {
      kind: "grid";
      direction?: "left" | "right" | "above" | "below" | "within";
      referencePanelId?: string;
    }
  | {
      kind: "floating";
      bounds: { left: number; top: number; width: number; height: number };
    };

export interface WorkspacePanelSpec {
  id: string;
  kind: string;
  title: string;
  state: PanelState;
  placement?: PanelPlacement;
  size?: { width?: number; height?: number };
}

export interface WorkspaceSnapshot {
  version: 1;
  layout: unknown;
}

export interface WorkspaceRendererProps {
  panelId: string;
  state: Readable<PanelState>;
}

export interface WorkspaceRendererDefinition {
  component: Component<WorkspaceRendererProps>;
  preserveDomWhenHidden?: boolean;
}

export type WorkspaceRendererRegistry = Readonly<Record<string, WorkspaceRendererDefinition>>;

export interface Workspace {
  addOrUpdatePanel(spec: WorkspacePanelSpec): void;
  removePanel(id: string): Promise<void>;
  save(): WorkspaceSnapshot;
  restore(snapshot: WorkspaceSnapshot, panels: readonly WorkspacePanelSpec[]): boolean;
  dispose(): Promise<void>;
}
