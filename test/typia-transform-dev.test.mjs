import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const validRoom = {
  id: 1,
  name: "Town Square",
  area: "Midgar",
  exits: [{ direction: "north", destination: 2 }],
};

test("Typia validators execute through Vite development SSR", async (t) => {
  const server = await createServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    hmr: false,
    watch: null,
  });
  t.after(async () => {
    await server.close();
  });

  const ssr = server.environments.ssr;
  assert.ok(isRunnableDevEnvironment(ssr));

  const validators = await ssr.runner.import("/phase0/gmcp-validators.ts");
  const proofModule = await ssr.runner.import("/phase0/typia-proof.ts");

  const minimal = validators.validateRoomInfo(validRoom);
  assert.equal(minimal.success, true);
  assert.deepEqual(minimal.data, validRoom);

  const withTerrain = validators.validateRoomInfo({
    ...validRoom,
    terrain: "urban",
  });
  assert.equal(withTerrain.success, true);
  assert.deepEqual(withTerrain.data, { ...validRoom, terrain: "urban" });

  const idString = validators.validateRoomInfo({ ...validRoom, id: "1" });
  assert.equal(idString.success, false);
  assert.deepEqual(idString.errors, [
    {
      path: "$input.id",
      expected: "number",
      value: "1",
    },
  ]);

  const unknownMood = validators.validateRoomInfo({
    ...validRoom,
    mood: "cheerful",
  });
  assert.equal(unknownMood.success, true);

  const badExit = validators.validateRoomInfo({
    ...validRoom,
    exits: [{ direction: 5, destination: 2 }],
  });
  assert.equal(badExit.success, false);
  assert.deepEqual(badExit.errors, [
    {
      path: "$input.exits[0].direction",
      expected: "string",
      value: 5,
    },
  ]);

  const parsedValid = validators.parseRoomInfo(JSON.stringify(validRoom));
  assert.equal(parsedValid.success, true);
  assert.deepEqual(parsedValid.data, validRoom);

  const parsedIdString = validators.parseRoomInfo(
    JSON.stringify({ ...validRoom, id: "1" }),
  );
  assert.equal(parsedIdString.success, false);
  assert.deepEqual(parsedIdString.errors, [
    {
      path: "$input.id",
      expected: "number",
      value: "1",
    },
  ]);

  assert.throws(
    () => validators.parseRoomInfo("{"),
    (error) => error instanceof SyntaxError,
  );

  const proof = proofModule.runTypiaProof();
  assert.equal(proof.ok, true);

  const svelteFixturePath = path.join(
    repoRoot,
    "client",
    "phase0",
    "__fixtures__",
    "typia-not-transformed.svelte",
  );
  const transformed = await server.transformRequest(svelteFixturePath);
  assert.ok(transformed?.code, "Svelte fixture must compile");
  assert.match(transformed.code, /createValidate/);
});
