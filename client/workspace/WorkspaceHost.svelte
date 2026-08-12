<script lang="ts">
  import { onMount } from "svelte";
  import type { CharacterProfileId } from "../model/ids";
  import { createWorkspace } from "./dockview-workspace";
  import PlaceholderPanel from "./PlaceholderPanel.svelte";
  import { loadCharacterWorkspace, saveCharacterWorkspace } from "./persistence";
  import TerminalPanel from "./TerminalPanel.svelte";
  import { focusTerminalIsland } from "./terminal-island";
  import type { Workspace, WorkspacePanelSpec, WorkspaceSnapshot } from "./workspace";

  let { characterProfileId }: { characterProfileId: CharacterProfileId } = $props();

  const terminal: WorkspacePanelSpec = {
    id: "terminal",
    kind: "terminal",
    title: "Terminal",
    state: {},
  };
  const placeholder: WorkspacePanelSpec = {
    id: "panel-placeholder",
    kind: "placeholder",
    title: "Panels",
    state: {},
    placement: { kind: "grid", direction: "right", referencePanelId: terminal.id },
  };

  let host: HTMLElement;
  let workspace: Workspace | undefined;
  let status = $state("Loading workspace...");
  let placeholderOpen = $state(true);

  function openPlaceholder(): void {
    workspace?.addOrUpdatePanel(placeholder);
    workspace?.activatePanel(placeholder.id);
    placeholderOpen = true;
  }

  function focusTerminal(): void {
    workspace?.activatePanel(terminal.id);
    focusTerminalIsland(terminal.id);
  }

  function closePlaceholder(): void {
    if (!workspace) return;
    void workspace.removePanel(placeholder.id).then(() => {
      placeholderOpen = false;
    });
  }

  onMount(() => {
    const currentWorkspace = createWorkspace(host, {
      placeholder: { component: PlaceholderPanel },
      terminal: { component: TerminalPanel, preserveDomWhenHidden: true },
    });
    workspace = currentWorkspace;
    currentWorkspace.addOrUpdatePanel(terminal);
    currentWorkspace.addOrUpdatePanel(placeholder);

    const loaded = loadCharacterWorkspace(localStorage, characterProfileId);
    const containsTerminal =
      loaded.success &&
      loaded.snapshot !== null &&
      JSON.stringify(loaded.snapshot.layout).includes(`"${terminal.id}"`);
    const restored =
      containsTerminal && currentWorkspace.restore(loaded.snapshot, [terminal, placeholder]);
    if (!loaded.success) {
      status = loaded.message;
    } else if (restored) {
      status = "Workspace restored";
      placeholderOpen = JSON.stringify(loaded.snapshot.layout).includes(placeholder.id);
    } else if (loaded.snapshot !== null) {
      status = "Saved workspace could not be restored; using the default layout.";
    } else {
      status = loaded.message;
    }
    currentWorkspace.addOrUpdatePanel(terminal);
    if (!restored) currentWorkspace.addOrUpdatePanel(placeholder);

    let pending: WorkspaceSnapshot | undefined;
    let timer: number | undefined;
    const flush = () => {
      if (!pending) return;
      const result = saveCharacterWorkspace(localStorage, characterProfileId, pending);
      pending = undefined;
      timer = undefined;
      status = result.success ? "Workspace saved" : result.message;
    };
    const scheduleSave = (snapshot: WorkspaceSnapshot) => {
      pending = snapshot;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(flush, 75);
    };
    const unsubscribe = currentWorkspace.subscribeLayout(scheduleSave);
    const flushOnLeave = () => flush();
    document.addEventListener("visibilitychange", flushOnLeave);
    window.addEventListener("pagehide", flushOnLeave);

    return () => {
      document.removeEventListener("visibilitychange", flushOnLeave);
      window.removeEventListener("pagehide", flushOnLeave);
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
      flush();
      workspace = undefined;
      void currentWorkspace.dispose();
    };
  });
</script>

<section class="workspace-shell" aria-label="Workspace" data-testid="phase2-workspace">
  <div class="workspace-controls" aria-label="Panels">
    <strong>Panels</strong>
    <button type="button" onclick={focusTerminal}>Focus terminal</button>
    {#if placeholderOpen}
      <button type="button" onclick={closePlaceholder}>Close panel</button>
    {:else}
      <button type="button" onclick={openPlaceholder}>Open panel</button>
    {/if}
  </div>
  <p class="workspace-status" data-testid="workspace-status">{status}</p>
  <div bind:this={host} class="workspace-host" data-testid="workspace-host"></div>
</section>

<style>
  .workspace-shell {
    display: grid;
    gap: 0.75rem;
    height: min(60vh, 48rem);
    min-height: 25rem;
    margin-top: 1.5rem;
  }

  .workspace-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .workspace-status {
    color: var(--df-muted, #8b949e);
  }

  .workspace-host {
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border-color, #30363d);
    border-radius: 0.5rem;
  }
</style>
