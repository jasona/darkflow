<script lang="ts">
  import type { TypiaProofResult } from "./typia-proof";

  let { proof }: { proof: TypiaProofResult } = $props();
</script>

<main style="font-family: system-ui, sans-serif; padding: 2rem;">
  <h1>Darkflow Phase 0 harness</h1>
  <p>Isolated Svelte 5 entry point for the multi-connection UI build pipeline.</p>
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
