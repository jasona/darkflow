import assert from "node:assert/strict";
import test from "node:test";

const controllers = await import("../public/js/session-compat/controllers.js");

function createGmcpHarness() {
  const handlers = new Map();
  return {
    on(packageName, callback) {
      const list = handlers.get(packageName) || [];
      list.push(callback);
      handlers.set(packageName, list);
    },
    off(packageName, callback) {
      handlers.set(packageName, (handlers.get(packageName) || []).filter((item) => item !== callback));
    },
    dispatch(packageName, payload) {
      for (const callback of [...(handlers.get(packageName) || [])]) callback(payload, packageName);
    },
    count(packageName) {
      return (handlers.get(packageName) || []).length;
    },
  };
}

test("controller lifecycle owns GMCP and external listeners idempotently", () => {
  controllers.resetControllerCompatBridgeForTests();
  const gmcp = createGmcpHarness();
  const target = new EventTarget();
  const seen = [];
  const lifecycle = controllers.createControllerLifecycle("fixture");

  const scopedGmcp = lifecycle.bindGmcp(gmcp);
  scopedGmcp.on("Test.Package", (payload) => seen.push(payload));
  lifecycle.listen(target, "fixture", () => seen.push("event"));

  gmcp.dispatch("Test.Package", "before");
  target.dispatchEvent(new Event("fixture"));
  assert.deepEqual(seen, ["before", "event"]);
  assert.equal(gmcp.count("Test.Package"), 1);

  lifecycle.dispose();
  lifecycle.dispose();
  gmcp.dispatch("Test.Package", "after");
  target.dispatchEvent(new Event("fixture"));

  assert.deepEqual(seen, ["before", "event"]);
  assert.equal(gmcp.count("Test.Package"), 0);
  assert.equal(controllers.getControllerLifecycleDiagnostics().activeControllers, 0);
});

test("a snapshotted GMCP callback is guarded after disposal", () => {
  controllers.resetControllerCompatBridgeForTests();
  const seen = [];
  const lifecycle = controllers.createControllerLifecycle("snapshot");
  const guarded = lifecycle.guard(() => seen.push("late"));
  lifecycle.dispose();
  guarded();
  assert.deepEqual(seen, []);
});
