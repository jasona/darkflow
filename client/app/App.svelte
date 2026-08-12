<script lang="ts">
  import { untrack } from "svelte";
  import type { ShellBootstrap } from "./bootstrap-transaction.ts";
  import type { Session, SessionConnectionSnapshot } from "../runtime/session.ts";
  import type { TransportEndpoint, TransportName } from "../transport/types.ts";
  // @ts-expect-error Legacy UI module has no declaration file.
  import { gameTitle } from "../../public/js/brand.js";
  // @ts-expect-error Legacy UI module has no declaration file.
  import { formatUpdateMessage } from "../../public/js/desktop-integration.js";
  // @ts-expect-error Legacy UI module has no declaration file.
  import { applyTheme, BUILTIN_THEMES, DEFAULT_THEME_KEY } from "../../public/js/theme-manager.js";

  type UpdateStatus = {
    state: string;
    version?: string;
    percent?: number;
    message?: string;
  };

  type DesktopApi = {
    getInfo(): Promise<{ updateStatus?: UpdateStatus }>;
    checkForUpdates(): Promise<unknown> | unknown;
    installUpdate(): Promise<unknown> | unknown;
    onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  };

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
  let updateStatus = $state<UpdateStatus | null>(null);
  let clientVersion = $state<string | null>(null);

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
    applyTheme(BUILTIN_THEMES[shell.themeKey] ?? BUILTIN_THEMES[DEFAULT_THEME_KEY]);
    document.title = gameTitle(shell.gameName);
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

  $effect(() => {
    const desktop = (window as typeof window & { darkflowDesktop?: DesktopApi }).darkflowDesktop;
    if (desktop) {
      let disposed = false;
      const render = (status: UpdateStatus) => {
        if (!disposed) updateStatus = status;
      };
      const unsubscribe = desktop.onUpdateStatus(render);
      void desktop
        .getInfo()
        .then((info) => info.updateStatus && render(info.updateStatus))
        .catch(() => {});
      return () => {
        disposed = true;
        unsubscribe();
      };
    }

    let disposed = false;
    const fetchVersion = async () => {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        const data = (await response.json()) as { version?: string };
        if (!disposed && data.version) {
          if (clientVersion && clientVersion !== data.version)
            updateStatus = { state: "browser-update" };
          clientVersion = data.version;
        }
      } catch {
        // Version checks are advisory in browser mode.
      }
    };
    void fetchVersion();
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void fetchVersion();
      },
      5 * 60 * 1000,
    );
    return () => {
      disposed = true;
      clearInterval(timer);
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

  const updateDisplay = $derived(
    updateStatus?.state === "browser-update"
      ? { message: "A new client version is available.", action: "Refresh to update" }
      : updateStatus
        ? formatUpdateMessage(updateStatus)
        : null,
  );

  function runUpdateAction(): void {
    const desktop = (window as typeof window & { darkflowDesktop?: DesktopApi }).darkflowDesktop;
    const operation = desktop
      ? ["downloaded", "manual"].includes(updateStatus?.state ?? "")
        ? desktop.installUpdate()
        : desktop.checkForUpdates()
      : location.reload();
    Promise.resolve(operation).catch(() => {});
  }
</script>

<main
  bind:this={shellRoot}
  data-testid="phase2-shell"
  data-session-id={session.sessionId}
  tabindex="-1"
>
  <header class="app-chrome">
    <img src="/assets/brand/darkflow-icon-64.png" alt="" aria-hidden="true" />
    <div>
      <h1>{gameTitle(shell.gameName)}</h1>
      <p>Phase 2 integration shell</p>
    </div>
  </header>

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

{#if updateDisplay}
  <aside class="update-banner" data-testid="update-banner" aria-live="polite">
    <span>{updateDisplay.message}</span>
    {#if updateDisplay.action}
      <button type="button" onclick={runUpdateAction}>{updateDisplay.action}</button>
    {/if}
  </aside>
{/if}

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
    padding: clamp(1rem, 4vw, 3rem);
    background: var(--df-bg, #0d1117);
    color: var(--df-text, #c9d1d9);
  }

  .app-chrome {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .app-chrome img {
    width: 2.5rem;
    height: 2.5rem;
  }

  h1,
  p {
    margin: 0;
  }

  .app-chrome p {
    color: var(--df-muted, #8b949e);
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

  input,
  select,
  button {
    min-height: 2.5rem;
  }

  :is(input, select, button):focus-visible {
    outline: 2px solid var(--df-accent-blue, #58a6ff);
    outline-offset: 2px;
  }

  .update-banner {
    position: fixed;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 1001;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    max-width: calc(100vw - 1.5rem);
    padding: 0.75rem 1rem;
    border: 1px solid var(--df-warn, #d9931f);
    border-radius: 0.5rem;
    background: var(--df-panel, #161b22);
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

  @media (max-width: 420px) {
    .connection-form,
    .reconnect-actions {
      align-items: stretch;
      flex-direction: column;
    }

    label,
    input,
    select,
    button {
      width: 100%;
    }

    .update-banner {
      align-items: stretch;
      flex-direction: column;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }
</style>
