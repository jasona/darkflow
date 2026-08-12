import { mount } from "svelte";
import App from "./App.svelte";
import { hmrProbe } from "./hmr-probe";
import { runTypiaProof } from "./typia-proof";
import LifecyclePanel from "./workspace/LifecyclePanel.svelte";
import TerminalPanel from "../workspace/TerminalPanel.svelte";
import { createWorkspace } from "../workspace/dockview-workspace";
import { LifecycleDiagnostics } from "../workspace/lifecycle-diagnostics";
import {
  appendTerminalIsland,
  focusTerminalIsland,
  inspectTerminalIsland,
  scrollTerminalIsland,
} from "../workspace/terminal-island";
import type { WorkspaceTestBridge } from "./workspace/workspace-test-bridge";
import type { PanelPlacement, WorkspacePanelSpec, WorkspaceSnapshot } from "../workspace/workspace";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Phase 0 harness requires a #app element");
}

const proof = runTypiaProof();
mount(App, { target, props: { proof, hmrProbe } });

const workspaceHost = document.querySelector<HTMLElement>('[data-testid="workspace-host"]');
const workspaceStatus = document.querySelector<HTMLElement>('[data-testid="workspace-status"]');
if (!workspaceHost || !workspaceStatus) {
  throw new Error("Phase 0 workspace harness requires its host and status elements");
}
const workspaceStatusElement = workspaceStatus;

const diagnostics = new LifecycleDiagnostics();
const workspace = createWorkspace(
  workspaceHost,
  {
    lifecycle: { component: LifecyclePanel },
    terminal: { component: TerminalPanel, preserveDomWhenHidden: true },
  },
  diagnostics,
);
const panelSpecs = new Map<string, WorkspacePanelSpec>();
const disposedWorkspaceMessage = "Workspace has been disposed.";
let disposed = false;
let lastSnapshot: WorkspaceSnapshot | undefined;
let fixtureSequence = 0;
let layoutEvents = 0;
let unsubscribeLayout: (() => void) | undefined;

function assertBridgeUsable(): void {
  if (disposed) {
    throw new Error(disposedWorkspaceMessage);
  }
}

function requirePanelSpec(id: string): WorkspacePanelSpec {
  assertBridgeUsable();
  const spec = panelSpecs.get(id);
  if (!spec) {
    throw new Error(`Panel '${id}' does not exist.`);
  }
  return spec;
}

function updatePanelLayout(
  id: string,
  update: { placement?: PanelPlacement; size?: { width?: number; height?: number } },
): void {
  const current = requirePanelSpec(id);
  const stored: WorkspacePanelSpec = {
    ...current,
    ...(update.placement ? { placement: update.placement } : {}),
    ...(update.size ? { size: update.size } : {}),
  };
  const operation: WorkspacePanelSpec = {
    id: current.id,
    kind: current.kind,
    state: current.state,
    title: current.title,
    ...(update.placement ? { placement: update.placement } : {}),
    ...(update.size ? { size: update.size } : {}),
  };
  panelSpecs.set(id, stored);
  workspace.addOrUpdatePanel(operation);
}

const bridge: WorkspaceTestBridge = {
  upsert(spec) {
    assertBridgeUsable();
    panelSpecs.set(spec.id, spec);
    workspace.addOrUpdatePanel(spec);
  },
  async remove(id) {
    assertBridgeUsable();
    await workspace.removePanel(id);
    panelSpecs.delete(id);
  },
  move(id, placement) {
    updatePanelLayout(id, { placement });
  },
  resize(id, size) {
    updatePanelLayout(id, { size });
  },
  activate(id) {
    workspace.activatePanel(id);
  },
  save() {
    assertBridgeUsable();
    return workspace.save();
  },
  restore(snapshot, panels) {
    assertBridgeUsable();
    const restored = workspace.restore(snapshot, panels);
    panelSpecs.clear();
    if (restored) {
      for (const panel of panels) {
        panelSpecs.set(panel.id, panel);
      }
    }
    return restored;
  },
  subscribeLayout() {
    unsubscribeLayout?.();
    layoutEvents = 0;
    unsubscribeLayout = workspace.subscribeLayout(() => {
      layoutEvents += 1;
    });
  },
  unsubscribeLayout() {
    unsubscribeLayout?.();
    unsubscribeLayout = undefined;
  },
  resetLayoutEvents() {
    layoutEvents = 0;
  },
  layoutEvents() {
    return layoutEvents;
  },
  appendTerminal: appendTerminalIsland,
  focusTerminal: focusTerminalIsland,
  scrollTerminal: scrollTerminalIsland,
  panel: workspace.inspectPanel,
  terminal: inspectTerminalIsland,
  diagnostics() {
    const snapshot = diagnostics.snapshot();
    return {
      mounts: snapshot.mounts,
      layouts: snapshot.layouts,
      updates: snapshot.updates,
      unmounts: snapshot.unmounts,
      duplicateDisposals: snapshot.duplicateDisposals,
      liveRoots: snapshot.liveRoots,
      liveHosts: snapshot.liveHosts,
      subscriptions: snapshot.liveSubscriptions,
      observers: snapshot.liveObservers,
      listeners: snapshot.liveListeners,
      terminalIslands: snapshot.liveTerminalIslands,
      ownedDom: document.querySelectorAll('[data-workspace-owned="true"]').length,
    };
  },
  dispose() {
    if (!disposed) {
      disposed = true;
      workspaceStatusElement.textContent = "Workspace disposed";
    }
    unsubscribeLayout?.();
    unsubscribeLayout = undefined;
    return workspace.dispose();
  },
};

window.__darkflowWorkspace = bridge;

function setWorkspaceStatus(message: string): void {
  workspaceStatusElement.textContent = message;
}

async function runControl(action: string): Promise<void> {
  if (action === "add-lifecycle" || action === "add-terminal") {
    const kind = action === "add-terminal" ? "terminal" : "lifecycle";
    const id = `${kind}-fixture-${++fixtureSequence}`;
    bridge.upsert({
      id,
      kind,
      title: `${kind === "terminal" ? "Terminal" : "Lifecycle"} fixture ${fixtureSequence}`,
      state: kind === "terminal" ? { buffer: "Darkflow terminal fixture\n" } : { value: id },
    });
    setWorkspaceStatus(`Added ${id}`);
    return;
  }

  if (action === "save") {
    lastSnapshot = bridge.save();
    setWorkspaceStatus("Layout saved");
    return;
  }

  if (action === "restore") {
    if (!lastSnapshot) {
      setWorkspaceStatus("Save a layout before restoring");
      return;
    }
    const restored = bridge.restore(lastSnapshot, [...panelSpecs.values()]);
    setWorkspaceStatus(restored ? "Layout restored" : "Layout restore rejected");
    return;
  }

  if (action === "dispose") {
    await bridge.dispose();
  }
}

for (const control of document.querySelectorAll<HTMLButtonElement>("[data-workspace-action]")) {
  control.addEventListener("click", () => {
    const action = control.dataset.workspaceAction;
    if (!action) {
      return;
    }
    void runControl(action).catch((error: unknown) => {
      setWorkspaceStatus(error instanceof Error ? error.message : String(error));
    });
  });
}
