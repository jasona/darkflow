<script lang="ts">
  import type { Writable } from "svelte/store";
  import type { TypiaProofResult } from "./typia-proof";

  let { proof, hmrProbe }: { proof: TypiaProofResult; hmrProbe: Writable<string> } = $props();
</script>

<main style="font-family: system-ui, sans-serif; padding: 2rem;">
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
</main>
