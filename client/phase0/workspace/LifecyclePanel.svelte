<script lang="ts">
  import { onMount } from "svelte";
  import type { Readable } from "svelte/store";
  import { findLifecycleDiagnostics } from "../../workspace/lifecycle-diagnostics";
  import type { PanelState } from "../../workspace/workspace";

  let { panelId, state: panelState }: { panelId: string; state: Readable<PanelState> } = $props();
  let element: HTMLElement;
  let serializedState = $state("{}");

  onMount(() => {
    const diagnostics = findLifecycleDiagnostics(element);
    const releaseSubscription = diagnostics?.trackResource("subscription");
    const releaseListener = diagnostics?.trackResource("listener");
    const releaseObserver = diagnostics?.trackResource("observer");
    const unsubscribe = panelState.subscribe((value) => {
      serializedState = JSON.stringify(value);
    });
    const observer = new ResizeObserver(() => undefined);
    const onClick = () => undefined;

    observer.observe(element);
    element.addEventListener("click", onClick);

    return () => {
      element.removeEventListener("click", onClick);
      observer.disconnect();
      unsubscribe();
      releaseListener?.();
      releaseObserver?.();
      releaseSubscription?.();
    };
  });
</script>

<section
  bind:this={element}
  class="phase0-lifecycle-panel"
  data-panel-id={panelId}
  data-workspace-owned="true"
>
  <h2>Lifecycle panel</h2>
  <output data-testid="lifecycle-state">{serializedState}</output>
</section>
