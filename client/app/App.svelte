<script lang="ts">
  import { untrack } from "svelte";
  import type { ShellBootstrap } from "./bootstrap-transaction.ts";
  import type { Session, SessionConnectionSnapshot } from "../runtime/session.ts";
  import type { TransportEndpoint, TransportName } from "../transport/types.ts";

  let {
    endpoint,
    session,
    shell,
  }: { endpoint: TransportEndpoint; session: Session; shell: ShellBootstrap } = $props();

  let snapshot = $state<SessionConnectionSnapshot>(untrack(() => session.getConnectionSnapshot()));
  let host = $state(untrack(() => endpoint.host));
  let port = $state(untrack(() => endpoint.port));
  let protocol = $state<TransportName>(untrack(() => endpoint.protocol));
  let everConnected = $state(false);
  let now = $state(Date.now());
  let shellRoot = $state<HTMLElement>();
  let retryButton = $state<HTMLButtonElement>();

  const reconnectVisible = $derived(
    everConnected &&
      snapshot.state !== "connected" &&
      snapshot.reconnect?.userDisconnected !== true &&
      ["connecting", "scheduled", "idle"].includes(snapshot.reconnect?.status ?? ""),
  );
  const secondsUntilRetry = $derived(
    snapshot.reconnect?.nextAttemptAt
      ? Math.max(0, Math.ceil((snapshot.reconnect.nextAttemptAt - now) / 1000))
      : 0,
  );
  const connectionStatus = $derived.by(() => {
    const transport = snapshot.reconnect?.transport ?? protocol;
    if (snapshot.state === "connecting") return `Connecting via ${transport}`;
    if (snapshot.state === "connected") return `Connected via ${transport}`;
    if (snapshot.reconnect?.status === "scheduled") return "Disconnected. Retry scheduled.";
    return "Disconnected";
  });

  $effect(() => {
    session.setConnectionEndpoint(endpoint);
    const unsubscribe = session.subscribeConnection((next) => {
      snapshot = next;
      if (next.state === "connected") everConnected = true;
    });
    if (shell.shouldAutoConnect) session.connect();
    return unsubscribe;
  });

  $effect(() => {
    if (!reconnectVisible || snapshot.reconnect?.status !== "scheduled") return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (!reconnectVisible) return;
    const previousFocus = document.activeElement;
    queueMicrotask(() => retryButton?.focus());
    return () => {
      queueMicrotask(() => {
        const restoreTarget =
          previousFocus instanceof HTMLElement && previousFocus.isConnected
            ? previousFocus
            : shellRoot;
        restoreTarget?.focus();
      });
    };
  });

  function connect(event: SubmitEvent): void {
    event.preventDefault();
    const next: TransportEndpoint = {
      host: host.trim() || "localhost",
      port: port.trim() || "4242",
      protocol,
    };
    host = next.host;
    port = next.port;
    session.setConnectionEndpoint(next);
    persistProtocol(protocol);
    if (snapshot.reconnect?.status === "scheduled") session.retryConnection();
    else session.connect();
  }

  function persistProtocol(value: TransportName): void {
    try {
      localStorage.setItem("darkflow-protocol", value);
    } catch {
      // Private browsing and quota failures leave the current selection usable.
    }
  }

  function reconnectDetail(): string {
    const parts: string[] = [];
    if (snapshot.reconnect?.status === "scheduled") {
      parts.push(`Next attempt in ${secondsUntilRetry}s`);
    }
    if (snapshot.reconnect?.attempt) parts.push(`attempt ${snapshot.reconnect.attempt}`);
    if (snapshot.reconnect?.transport) parts.push(`via ${snapshot.reconnect.transport}`);
    return parts.join("; ");
  }
</script>

<main
  bind:this={shellRoot}
  data-testid="phase2-shell"
  data-session-id={session.sessionId}
  tabindex="-1"
>
  <h1>{shell.gameName ? `Darkflow - ${shell.gameName}` : "Darkflow"}</h1>
  <p>Phase 2 integration shell</p>

  <form class="connection-form" aria-label="Connection" onsubmit={connect}>
    {#if !shell.zorkOnly}
      <label>
        Host
        <input aria-label="Host" bind:value={host} autocomplete="url" />
      </label>
      <label>
        Port
        <input
          aria-label="Port"
          type="number"
          min="1"
          max="65535"
          value={port}
          oninput={(event) => (port = event.currentTarget.value)}
        />
      </label>
      <label>
        Protocol
        <select
          aria-label="Connection protocol"
          bind:value={protocol}
          onchange={(event) => persistProtocol(event.currentTarget.value as TransportName)}
        >
          <option value="ws">WebSocket</option>
          <option value="wss">Secure WebSocket</option>
          <option value="telnet">Telnet proxy</option>
          <option value="telnets">Secure telnet proxy</option>
        </select>
      </label>
    {:else}
      <p>Darkwind connection</p>
    {/if}

    {#if snapshot.state === "connected"}
      <button type="button" onclick={() => session.disconnect()}>Disconnect</button>
    {:else}
      <button type="submit" disabled={snapshot.state === "connecting"}>
        {snapshot.state === "connecting" ? "Connecting..." : "Connect"}
      </button>
    {/if}
  </form>

  <p role="status" aria-live="polite">{connectionStatus}</p>
  <div data-testid="phase2-content-host"></div>
</main>

{#if reconnectVisible}
  <div class="reconnect-overlay">
    <div
      class="reconnect-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="reconnect-title"
      aria-describedby="reconnect-detail"
    >
      <h2 id="reconnect-title">
        {snapshot.reconnect?.status === "connecting" ? "Reconnecting..." : "Connection lost"}
      </h2>
      <p id="reconnect-detail">
        {snapshot.reconnect?.status === "idle" ? "Automatic reconnect is off." : reconnectDetail()}
      </p>
      <div class="reconnect-actions">
        <button
          bind:this={retryButton}
          type="button"
          disabled={snapshot.reconnect?.status === "connecting"}
          onclick={() => session.retryConnection()}>Retry now</button
        >
        <button type="button" onclick={() => session.disconnect()}>Stop trying</button>
      </div>
    </div>
  </div>
{/if}

<style>
  main {
    box-sizing: border-box;
    min-height: 100vh;
    padding: 1rem;
  }

  .connection-form,
  .reconnect-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
  }

  label {
    display: grid;
    gap: 0.25rem;
  }

  .reconnect-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(0 0 0 / 65%);
  }

  .reconnect-dialog {
    box-sizing: border-box;
    width: min(28rem, 100%);
    padding: 1.25rem;
    border: 1px solid var(--border-color, #30363d);
    border-radius: 0.5rem;
    background: var(--bg-secondary, #161b22);
  }
</style>
