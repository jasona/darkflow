<script lang="ts">
  import type { Writable } from "svelte/store";
  import type { TypiaProofResult } from "./typia-proof";

  let { proof, hmrProbe }: { proof: TypiaProofResult; hmrProbe: Writable<string> } = $props();
</script>

<main>
  <h1>Darkflow Phase 0 harness</h1>
  <p>Isolated Svelte 5 entry point for the multi-connection UI build pipeline.</p>
  <span data-testid="hmr-probe">{$hmrProbe}</span>
  <section data-testid="typia-proof" data-typia-ok={String(proof.ok)}>
    <h2>Typia proof</h2>
    <p>Status: {proof.ok ? "ok" : "failed"}</p>
    <ul>
      {#each proof.cases as testCase (testCase.name)}
        <li data-passed={String(testCase.passed)}>
          {testCase.name}: {testCase.passed ? "pass" : "fail"}
        </li>
      {/each}
    </ul>
  </section>

  <section aria-labelledby="workspace-heading">
    <h2 id="workspace-heading">Workspace lifecycle spike</h2>
    <div class="workspace-controls" aria-label="Workspace fixture controls">
      <button type="button" data-workspace-action="add-lifecycle">Add lifecycle panel</button>
      <button type="button" data-workspace-action="add-terminal">Add terminal panel</button>
      <button type="button" data-workspace-action="save">Save layout</button>
      <button type="button" data-workspace-action="restore">Restore layout</button>
      <button type="button" data-workspace-action="dispose">Dispose workspace</button>
    </div>
    <p data-testid="workspace-status" aria-live="polite">Workspace ready</p>
    <div class="workspace-host dockview-theme-dark" data-testid="workspace-host"></div>
  </section>
</main>

<style>
  main {
    box-sizing: border-box;
    font-family: system-ui, sans-serif;
    padding: 2rem;
  }

  .workspace-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .workspace-host {
    height: 68vh;
    min-height: 420px;
    min-width: 320px;
    overflow: hidden;
    resize: both;
  }
</style>
