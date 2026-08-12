<script lang="ts">
  import type { Readable } from "svelte/store";
  import type { PanelState } from "./workspace";

  let { panelId }: { panelId: string; state: Readable<PanelState> } = $props();
</script>

<section class="workspace-placeholder" data-panel-id={panelId} data-workspace-owned="true">
  <h2>Panel placeholder</h2>
  <p>Information panels arrive in a later Phase 2 step.</p>
</section>

<style>
  .workspace-placeholder {
    box-sizing: border-box;
    height: 100%;
    padding: 1rem;
  }
</style>
