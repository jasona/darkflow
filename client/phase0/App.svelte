<script lang="ts">
  let count = $state(0);
</script>

<main style="font-family: system-ui, sans-serif; padding: 2rem;">
  <h1>Darkflow Phase 0 harness</h1>
  <p>Isolated Svelte 5 entry point for the multi-connection UI build pipeline.</p>
  <button type="button" onclick={() => count++}>
    Clicks: {count}
  </button>
</main>
