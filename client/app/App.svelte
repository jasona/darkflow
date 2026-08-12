<script lang="ts">
  import type { ShellBootstrap } from "./bootstrap-transaction.ts";
  import type { Session } from "../runtime/session.ts";

  let { session, shell }: { session: Session; shell: ShellBootstrap } = $props();
</script>

<main data-testid="phase2-shell" data-session-id={session.sessionId}>
  <h1>{shell.gameName ? `Darkflow - ${shell.gameName}` : "Darkflow"}</h1>
  <p>Phase 2 integration shell</p>
  <div data-testid="phase2-content-host"></div>
</main>
