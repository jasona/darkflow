/**
 * Session-installed lifecycle ownership for legacy GMCP-bound controllers.
 * The bridge is installed before app.js loads. A local fallback keeps the
 * legacy bootstrap path usable when Phase 1 session creation fails.
 *
 * @typedef {Object} ControllerScope
 * @property {(kind: string, disposer: () => void) => () => void} own
 * @property {(callback: () => void, delayMs: number) => () => void} setTimeout
 * @property {(callback: () => void, delayMs: number) => () => void} setInterval
 * @property {(callback: (timestamp: number) => void) => () => void} requestAnimationFrame
 * @property {() => void} dispose
 *
 * @typedef {Object} ControllerCompatBridge
 * @property {(onDisposeStart: () => void) => ControllerScope} createScope
 * @property {() => Object} getDiagnostics
 * @property {(() => Object)=} getControllerDiagnostics
 */

const CONTROLLER_BRIDGE_SLOT = '__darkflowPhase1ControllerBridge';
const CONTROLLER_REGISTRY_SLOT = '__darkflowPhase1ControllerRegistry';

/** @type {ControllerCompatBridge | null} */
let bridge = null;

function getControllerRegistry() {
  if (typeof window === 'undefined') {
    if (!globalThis[CONTROLLER_REGISTRY_SLOT]) {
      globalThis[CONTROLLER_REGISTRY_SLOT] = { sequence: 0, active: new Map() };
    }
    return globalThis[CONTROLLER_REGISTRY_SLOT];
  }
  if (!window[CONTROLLER_REGISTRY_SLOT]) {
    window[CONTROLLER_REGISTRY_SLOT] = { sequence: 0, active: new Map() };
  }
  return window[CONTROLLER_REGISTRY_SLOT];
}

function getInstalledBridge() {
  if (bridge) return bridge;
  if (typeof window !== 'undefined' && window[CONTROLLER_BRIDGE_SLOT]) {
    return window[CONTROLLER_BRIDGE_SLOT];
  }
  return null;
}

function setInstalledBridge(nextBridge) {
  bridge = nextBridge;
  if (typeof window === 'undefined') return;
  if (nextBridge === null) delete window[CONTROLLER_BRIDGE_SLOT];
  else window[CONTROLLER_BRIDGE_SLOT] = nextBridge;
}

/** Installs the active session-backed controller lifecycle bridge. */
export function installControllerCompatBridge(nextBridge) {
  nextBridge.getControllerDiagnostics = getControllerLifecycleDiagnostics;
  setInstalledBridge(nextBridge);
}

/** Clears the bridge for isolated tests and failed bootstrap cleanup. */
export function resetControllerCompatBridgeForTests() {
  setInstalledBridge(null);
}

function createLocalScope(onDisposeStart) {
  let disposed = false;
  const entries = [];

  function own(_kind, disposer) {
    if (disposed) {
      disposer();
      return () => {};
    }
    const entry = { disposer, released: false };
    entries.push(entry);
    return () => {
      if (entry.released || disposed) return;
      entry.released = true;
      try { disposer(); } catch (error) { console.error('Controller cleanup failed', error); }
    };
  }

  return {
    own,
    setTimeout(callback, delayMs) {
      let release = () => {};
      const timer = globalThis.setTimeout(() => {
        if (disposed) return;
        release();
        callback();
      }, delayMs);
      release = own('timer', () => globalThis.clearTimeout(timer));
      return release;
    },
    setInterval(callback, delayMs) {
      const timer = globalThis.setInterval(() => {
        if (!disposed) callback();
      }, delayMs);
      return own('timer', () => globalThis.clearInterval(timer));
    },
    requestAnimationFrame(callback) {
      if (typeof globalThis.requestAnimationFrame !== 'function') return () => {};
      let release = () => {};
      const frame = globalThis.requestAnimationFrame((timestamp) => {
        if (disposed) return;
        release();
        callback(timestamp);
      });
      release = own('animationFrame', () => globalThis.cancelAnimationFrame(frame));
      return release;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      onDisposeStart();
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (entry.released) continue;
        entry.released = true;
        try { entry.disposer(); } catch (error) { console.error('Controller cleanup failed', error); }
      }
    },
  };
}

/**
 * Creates one idempotent lifecycle for a legacy controller.
 * @param {string} name
 * @param {(() => void)=} onDispose
 */
export function createControllerLifecycle(name, onDispose) {
  const registry = getControllerRegistry();
  const id = ++registry.sequence;
  let disposed = false;
  const activeBridge = getInstalledBridge();
  const markDisposed = () => {
    if (disposed) return;
    disposed = true;
    registry.active.delete(id);
  };
  const scope = activeBridge
    ? activeBridge.createScope(markDisposed)
    : createLocalScope(markDisposed);

  function guard(callback) {
    return function guardedControllerCallback(...args) {
      if (disposed) return undefined;
      return callback.apply(this, args);
    };
  }

  const lifecycle = {
    name,
    get disposed() { return disposed; },
    guard,
    own(kind, disposer) {
      return scope.own(kind, disposer);
    },
    onGmcp(gmcp, packageName, callback) {
      const guarded = guard(callback);
      gmcp.on(packageName, guarded);
      return scope.own('subscription', () => gmcp.off(packageName, guarded));
    },
    bindGmcp(gmcp) {
      const registrations = new Map();
      return new Proxy(gmcp, {
        get(target, property) {
          if (property === 'on') {
            return (packageName, callback) => {
              let byCallback = registrations.get(packageName);
              if (!byCallback) {
                byCallback = new Map();
                registrations.set(packageName, byCallback);
              }
              const release = lifecycle.onGmcp(target, packageName, callback);
              byCallback.set(callback, release);
              return release;
            };
          }
          if (property === 'off') {
            return (packageName, callback) => {
              const byCallback = registrations.get(packageName);
              const release = byCallback && byCallback.get(callback);
              if (release) {
                byCallback.delete(callback);
                release();
                if (byCallback.size === 0) registrations.delete(packageName);
                return;
              }
              target.off(packageName, callback);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, property, value) {
          return Reflect.set(target, property, value, target);
        },
      });
    },
    listen(target, type, listener, options) {
      if (!target || typeof target.addEventListener !== 'function') return () => {};
      const guarded = guard(listener);
      target.addEventListener(type, guarded, options);
      return scope.own('listener', () => target.removeEventListener(type, guarded, options));
    },
    ownObserver(observer) {
      if (!observer || typeof observer.disconnect !== 'function') return () => {};
      return scope.own('observer', () => observer.disconnect());
    },
    setTimeout(callback, delayMs) {
      return scope.setTimeout(guard(callback), delayMs);
    },
    setInterval(callback, delayMs) {
      return scope.setInterval(guard(callback), delayMs);
    },
    requestAnimationFrame(callback) {
      return scope.requestAnimationFrame(guard(callback));
    },
    dispose() {
      if (disposed) return;
      markDisposed();
      scope.dispose();
    },
  };

  if (onDispose) scope.own('teardown', onDispose);
  registry.active.set(id, lifecycle);
  return lifecycle;
}

/**
 * Starts one lifecycle-backed controller initialization.
 * Returning the existing disposer makes repeated init calls harmless.
 *
 * @param {Object} owner
 * @param {string} name
 * @param {Object} gmcp
 * @param {(scopedGmcp: Object, lifecycle: Object) => void} setup
 * @param {(() => void)=} onDispose
 */
export function installControllerLifecycle(owner, name, gmcp, setup, onDispose) {
  if (owner._controllerLifecycle) return owner._controllerLifecycle.dispose;

  const lifecycle = createControllerLifecycle(name, () => {
    owner._controllerLifecycle = null;
    if (onDispose) onDispose();
  });
  owner._controllerLifecycle = lifecycle;

  try {
    setup(lifecycle.bindGmcp(gmcp), lifecycle);
  } catch (error) {
    lifecycle.dispose();
    throw error;
  }
  return lifecycle.dispose;
}

/** Disposes a controller previously started with installControllerLifecycle. */
export function disposeControllerLifecycle(owner) {
  if (owner && owner._controllerLifecycle) owner._controllerLifecycle.dispose();
}

/** Returns controller and session lifecycle diagnostics for tests/debugging. */
export function getControllerLifecycleDiagnostics() {
  const activeBridge = getInstalledBridge();
  const registry = getControllerRegistry();
  return {
    activeControllers: registry.active.size,
    activeControllerNames: Array.from(registry.active.values(), (item) => item.name).sort(),
    session: activeBridge && typeof activeBridge.getDiagnostics === 'function'
      ? activeBridge.getDiagnostics()
      : null,
  };
}
