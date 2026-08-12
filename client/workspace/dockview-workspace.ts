import "./dockview-styles.js";

import {
  createDockview,
  type IContentRenderer,
  type ITabRenderer,
  type Parameters as DockviewParameters,
  type TabPartInitParameters,
} from "dockview";
import { mount, unmount } from "svelte";
import { writable, type Writable } from "svelte/store";
import { LifecycleDiagnostics } from "./lifecycle-diagnostics";
import type {
  PanelPlacement,
  PanelState,
  Workspace,
  WorkspacePanelSpec,
  WorkspaceRendererDefinition,
  WorkspaceRendererRegistry,
  WorkspaceSnapshot,
} from "./workspace";

interface PanelRecord {
  readonly id: string;
  kind: string;
  state: Writable<PanelState>;
  title: string;
}

interface DockviewPanelLike {
  api: {
    moveTo(options: {
      group: unknown;
      position: "top" | "bottom" | "left" | "right" | "center";
    }): void;
    setSize(size: { width?: number; height?: number }): void;
    setTitle(title: string): void;
    setActive(): void;
  };
  group: unknown;
}

const disposedWorkspaceError = new Error("Workspace has been disposed.");
let rootSequence = 0;

export interface WorkspacePanelInspection {
  active: boolean;
  bounds: { height: number; left: number; top: number; width: number };
  floating: boolean;
  groupId: string | null;
  groupIndex: number;
  mountCount: number;
  panelIndex: number;
  rootIdentity: string;
  title: string;
}

export interface WorkspaceInspector {
  inspectPanel(id: string): WorkspacePanelInspection | null;
}

class WorkspaceTabRenderer implements ITabRenderer {
  readonly element = document.createElement("span");
  #titleSubscription: { dispose(): void } | undefined;

  constructor(private readonly panelId: string) {
    this.element.dataset.panelDragHandle = "true";
    this.element.dataset.panelId = panelId;
  }

  init(parameters: TabPartInitParameters): void {
    this.element.textContent = parameters.title;
    this.#titleSubscription = parameters.api.onDidTitleChange(({ title }) => {
      this.element.textContent = title;
    });
  }

  update(parameters: DockviewParameters): void {
    if (typeof parameters.title === "string") {
      this.element.textContent = parameters.title;
    }
  }

  dispose(): void {
    this.#titleSubscription?.dispose();
    this.#titleSubscription = undefined;
    this.element.remove();
  }
}

class SvelteDockviewRenderer implements IContentRenderer {
  readonly element = document.createElement("div");
  #disposed = false;
  #mounted = false;
  #root: Record<string, unknown> | undefined;
  #unmountPromise: Promise<void> | undefined;

  constructor(
    private readonly panelId: string,
    private readonly definition: WorkspaceRendererDefinition,
    private readonly state: Writable<PanelState>,
    private readonly diagnostics: LifecycleDiagnostics,
    private readonly onDisposed: (renderer: SvelteDockviewRenderer) => void,
  ) {
    this.element.dataset.workspaceOwned = "true";
    this.element.dataset.workspaceRootId = panelId;
    this.element.style.height = "100%";
    this.diagnostics.registerHost(this.element);
  }

  init(): void {
    if (this.#disposed || this.#root) {
      return;
    }

    this.#root = mount(this.definition.component, {
      target: this.element,
      props: { panelId: this.panelId, state: this.state },
    });
    this.element.dataset.workspaceRootId = `${this.panelId}-${++rootSequence}`;
    this.#mounted = true;
    this.diagnostics.mountRoot(this.panelId, this.element);
  }

  dispose(): void {
    if (this.#disposed) {
      this.diagnostics.recordDuplicateDisposal();
      return;
    }

    this.#disposed = true;
    if (!this.#root) {
      this.#finishDispose();
      this.#unmountPromise = Promise.resolve();
      return;
    }

    this.#unmountPromise = this.diagnostics.trackUnmount(
      unmount(this.#root).then(
        () => this.#finishDispose(),
        (error: unknown) => {
          this.#finishDispose();
          throw error;
        },
      ),
    );
  }

  whenDisposed(): Promise<void> {
    return this.#unmountPromise ?? Promise.resolve();
  }

  #finishDispose(): void {
    if (this.#mounted) {
      this.diagnostics.unmountRoot(this.panelId);
    }
    this.diagnostics.unregisterHost(this.element);
    this.element.remove();
    this.onDisposed(this);
  }
}

/**
 * The only Dockview-aware implementation. The public workspace contract stays
 * vendor-neutral in workspace.ts.
 */
export function createWorkspace(
  host: HTMLElement,
  registry: WorkspaceRendererRegistry,
  diagnostics = new LifecycleDiagnostics(),
): Workspace & WorkspaceInspector {
  const records = new Map<string, PanelRecord>();
  const renderers = new Map<string, SvelteDockviewRenderer>();
  const pendingUnmounts = new Set<Promise<void>>();
  const layoutSubscribers = new Set<(snapshot: WorkspaceSnapshot) => void>();
  let disposed = false;
  let disposePromise: Promise<void> | undefined;
  let suppressLayoutEvents = true;

  const api = createDockview(host, {
    createTabComponent: ({ id }) => new WorkspaceTabRenderer(id),
    createComponent: ({ id, name }) => {
      const record = records.get(id);
      const definition = registry[name];

      if (!record || !definition) {
        throw new Error(`No workspace renderer is registered for panel '${id}' of kind '${name}'.`);
      }

      const renderer = new SvelteDockviewRenderer(
        id,
        definition,
        record.state,
        diagnostics,
        (disposedRenderer) => {
          if (renderers.get(id) === disposedRenderer) {
            renderers.delete(id);
          }
        },
      );
      renderers.set(id, renderer);
      return renderer;
    },
    dndStrategy: "pointer",
    floatingGroupDragHandle: "titlebar",
    keyboardNavigation: true,
  });

  const annotateFloatingTitlebars = () => {
    const floatingPanels = api.panels.filter((panel) => panel.api.location.type === "floating");
    const titlebars = host.querySelectorAll<HTMLElement>(".dv-floating-titlebar");
    for (const [index, titlebar] of [...titlebars].entries()) {
      titlebar.dataset.floatingDragHandle = "true";
      const panel = floatingPanels[index];
      if (panel) {
        titlebar.dataset.panelId = panel.group.activePanel?.id ?? panel.id;
      } else {
        delete titlebar.dataset.panelId;
      }
    }
  };
  const emitLayout = () => {
    annotateFloatingTitlebars();
    if (disposed || suppressLayoutEvents) {
      return;
    }

    const snapshot: WorkspaceSnapshot = { layout: api.toJSON(), version: 1 };
    for (const listener of layoutSubscribers) {
      listener(snapshot);
    }
  };
  const releaseLayoutListener = diagnostics.trackResource("listener");
  const layoutListener = api.onDidLayoutChange(emitLayout);
  const layoutHost = () => {
    diagnostics.recordLayout();
    api.layout(host.clientWidth, host.clientHeight, true);
  };
  const releaseResizeObserver = diagnostics.trackResource("observer");
  const resizeObserver = new ResizeObserver(() => {
    if (!disposed) {
      layoutHost();
    }
  });
  resizeObserver.observe(host);
  requestAnimationFrame(() => {
    suppressLayoutEvents = false;
  });

  const suppressLayoutEventsForFrame = () => {
    suppressLayoutEvents = true;
    requestAnimationFrame(() => {
      suppressLayoutEvents = false;
    });
  };

  const assertUsable = () => {
    if (disposed) {
      throw disposedWorkspaceError;
    }
  };

  const trackUnmount = (renderer: SvelteDockviewRenderer | undefined) => {
    if (!renderer) {
      return;
    }

    const pending = renderer.whenDisposed();
    pendingUnmounts.add(pending);
    void pending.then(
      () => pendingUnmounts.delete(pending),
      () => pendingUnmounts.delete(pending),
    );
  };

  const waitForUnmounts = async () => {
    while (pendingUnmounts.size > 0) {
      await Promise.all([...pendingUnmounts]);
    }
    await diagnostics.whenIdle();
  };

  const preserveOwnedFocus = (operation: () => void) => {
    const focused = document.activeElement;
    const ownedFocus =
      focused instanceof HTMLElement && host.contains(focused) ? focused : undefined;
    operation();
    if (!ownedFocus) {
      return;
    }

    const restoreFocus = () => {
      if (ownedFocus.isConnected && document.activeElement !== ownedFocus) {
        ownedFocus.focus({ preventScroll: true });
      }
    };
    restoreFocus();
    queueMicrotask(restoreFocus);
    requestAnimationFrame(restoreFocus);
  };

  const makeRecord = (spec: WorkspacePanelSpec): PanelRecord => ({
    id: spec.id,
    kind: spec.kind,
    state: writable(spec.state),
    title: spec.title,
  });

  const updateRecord = (record: PanelRecord, spec: WorkspacePanelSpec) => {
    if (record.kind !== spec.kind) {
      throw new Error(`Panel '${spec.id}' cannot change renderer kind while it is mounted.`);
    }

    record.title = spec.title;
    record.state.set(spec.state);
    diagnostics.updateRoot();
  };

  const rendererMode = (spec: WorkspacePanelSpec): "always" | "onlyWhenVisible" => {
    const definition = registry[spec.kind];
    if (!definition) {
      throw new Error(`No workspace renderer is registered for kind '${spec.kind}'.`);
    }

    return definition.preserveDomWhenHidden || spec.kind === "terminal"
      ? "always"
      : "onlyWhenVisible";
  };

  const panelOptions = (spec: WorkspacePanelSpec) => ({
    component: spec.kind,
    id: spec.id,
    ...(spec.size?.height !== undefined ? { initialHeight: spec.size.height } : {}),
    ...(spec.size?.width !== undefined ? { initialWidth: spec.size.width } : {}),
    renderer: rendererMode(spec),
    tabComponent: "workspace-tab",
    title: spec.title,
  });

  const addPanel = (spec: WorkspacePanelSpec): void => {
    const options = panelOptions(spec);
    const placement = spec.placement;

    if (placement?.kind === "floating") {
      api.addPanel({
        ...options,
        floating: {
          height: placement.bounds.height,
          width: placement.bounds.width,
          x: placement.bounds.left,
          y: placement.bounds.top,
        },
      });
      queueMicrotask(annotateFloatingTitlebars);
      return;
    }

    if (placement?.kind === "grid" && placement.referencePanelId) {
      api.addPanel({
        ...options,
        position: {
          direction: placement.direction ?? "within",
          referencePanel: placement.referencePanelId,
        },
      });
      queueMicrotask(annotateFloatingTitlebars);
      return;
    }

    if (placement?.kind === "grid" && placement.direction && placement.direction !== "within") {
      api.addPanel({ ...options, position: { direction: placement.direction } });
      queueMicrotask(annotateFloatingTitlebars);
      return;
    }

    api.addPanel(options);
    queueMicrotask(annotateFloatingTitlebars);
  };

  const applyPlacement = (panel: DockviewPanelLike, placement: PanelPlacement): void => {
    if (placement.kind === "floating") {
      api.addFloatingGroup(panel as never, {
        height: placement.bounds.height,
        width: placement.bounds.width,
        x: placement.bounds.left,
        y: placement.bounds.top,
      });
      panel.api.setActive();
      return;
    }

    if (placement.referencePanelId) {
      const reference = api.getPanel(placement.referencePanelId);
      if (!reference) {
        throw new Error(`Cannot place panel: '${placement.referencePanelId}' does not exist.`);
      }

      panel.api.moveTo({
        group: reference.group,
        position:
          placement.direction === "above"
            ? "top"
            : placement.direction === "below"
              ? "bottom"
              : placement.direction === "left"
                ? "left"
                : placement.direction === "right"
                  ? "right"
                  : "center",
      });
      panel.api.setActive();
      return;
    }

    if (placement.direction && placement.direction !== "within") {
      const group = api.addGroup({ direction: placement.direction });
      panel.api.moveTo({ group, position: "center" });
      panel.api.setActive();
    }
  };

  const inspectPanel = (id: string): WorkspacePanelInspection | null => {
    const panel = api.getPanel(id);
    if (!panel) {
      return null;
    }

    const root = renderers.get(id)?.element;
    const group = panel.group;
    const groupBounds = group.api.boundingBox;
    const hostBounds = host.getBoundingClientRect();
    const rootBounds = root?.getBoundingClientRect();
    const bounds = groupBounds
      ? {
          height: groupBounds.height,
          left: hostBounds.left + groupBounds.left,
          top: hostBounds.top + groupBounds.top,
          width: groupBounds.width,
        }
      : rootBounds;
    return {
      active: api.activePanel?.id === id,
      bounds: {
        height: bounds?.height ?? 0,
        left: bounds?.left ?? 0,
        top: bounds?.top ?? 0,
        width: bounds?.width ?? 0,
      },
      floating: panel.api.location.type === "floating",
      groupId: group.id,
      groupIndex: api.groups.indexOf(group),
      mountCount: diagnostics.mountCount(id),
      panelIndex: group.panels.indexOf(panel),
      rootIdentity: root?.dataset.workspaceRootId ?? "",
      title: panel.title ?? "",
    };
  };

  return {
    addOrUpdatePanel(spec) {
      assertUsable();
      const existingRecord = records.get(spec.id);
      if (existingRecord) {
        updateRecord(existingRecord, spec);
        const panel = api.getPanel(spec.id);
        if (!panel) {
          addPanel(spec);
          return;
        }

        panel.api.setTitle(spec.title);
        if (spec.size) {
          panel.api.setSize(spec.size);
        }
        if (spec.placement) {
          preserveOwnedFocus(() => {
            applyPlacement(panel as unknown as DockviewPanelLike, spec.placement!);
          });
        }
        if (spec.size || spec.placement) {
          layoutHost();
        }
        return;
      }

      records.set(spec.id, makeRecord(spec));
      addPanel(spec);
    },

    activatePanel(id) {
      assertUsable();
      const panel = api.getPanel(id);
      if (panel) {
        preserveOwnedFocus(() => panel.api.setActive());
      }
    },

    async removePanel(id) {
      assertUsable();
      const panel = api.getPanel(id);
      if (!panel) {
        records.delete(id);
        return;
      }

      const renderer = renderers.get(id);
      api.removePanel(panel);
      trackUnmount(renderer);
      queueMicrotask(annotateFloatingTitlebars);
      await waitForUnmounts();
      records.delete(id);
    },

    save() {
      assertUsable();
      return { layout: api.toJSON(), version: 1 };
    },

    restore(snapshot, panels) {
      assertUsable();
      if (snapshot.version !== 1 || !isObject(snapshot.layout)) {
        suppressLayoutEventsForFrame();
        api.clear();
        for (const renderer of renderers.values()) {
          trackUnmount(renderer);
        }
        return false;
      }

      try {
        suppressLayoutEventsForFrame();
        for (const spec of panels) {
          const record = records.get(spec.id);
          if (record) {
            updateRecord(record, spec);
          } else {
            records.set(spec.id, makeRecord(spec));
          }
        }
        preserveOwnedFocus(() => {
          api.fromJSON(snapshot.layout as never, { reuseExistingPanels: true });
          layoutHost();
        });
        queueMicrotask(annotateFloatingTitlebars);
        return true;
      } catch {
        suppressLayoutEventsForFrame();
        api.clear();
        for (const renderer of renderers.values()) {
          trackUnmount(renderer);
        }
        return false;
      }
    },

    subscribeLayout(listener) {
      assertUsable();
      layoutSubscribers.add(listener);
      return () => layoutSubscribers.delete(listener);
    },

    dispose() {
      if (disposePromise) {
        return disposePromise;
      }

      disposed = true;
      layoutSubscribers.clear();
      api.dispose();
      layoutListener.dispose();
      releaseLayoutListener();
      resizeObserver.disconnect();
      releaseResizeObserver();
      for (const renderer of renderers.values()) {
        trackUnmount(renderer);
      }
      disposePromise = waitForUnmounts().finally(() => {
        host.replaceChildren();
      });
      return disposePromise;
    },
    inspectPanel,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
