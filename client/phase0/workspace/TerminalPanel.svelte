<script lang="ts">
  import { onMount } from "svelte";
  import type { Readable } from "svelte/store";
  import { createTerminalIsland, type TerminalIsland } from "./terminal-island";
  import type { PanelState } from "./workspace";

  let { panelId, state }: { panelId: string; state: Readable<PanelState> } = $props();
  let host: HTMLElement;
  let island: TerminalIsland | undefined;
  let previousBuffer: string | undefined;
  let previousAppend: unknown;

  function bufferFromState(value: PanelState): string | undefined {
    const candidate = value.buffer ?? value.output ?? value.text;

    if (typeof candidate === "string") {
      return candidate;
    }

    if (Array.isArray(candidate) && candidate.every((line) => typeof line === "string")) {
      return candidate.join("\n");
    }

    return undefined;
  }

  function updateTerminal(value: PanelState): void {
    const buffer = bufferFromState(value);
    if (buffer !== undefined && buffer !== previousBuffer) {
      island?.replace(buffer);
      previousBuffer = buffer;
    }

    const append = value.append;
    if (typeof append === "string" && append !== previousAppend) {
      island?.append(append);
      previousAppend = append;
    }
  }

  onMount(() => {
    island = createTerminalIsland(host, panelId);
    const unsubscribe = state.subscribe(updateTerminal);

    return () => {
      unsubscribe();
      island?.dispose();
      island = undefined;
    };
  });
</script>

<section
  bind:this={host}
  class="phase0-terminal-panel"
  data-panel-id={panelId}
  data-workspace-owned="true"
></section>

<style>
  .phase0-terminal-panel {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
</style>
