import assert from "node:assert/strict";
import test from "node:test";
import typia from "typia";
import { TYPIA_NO_TRANSFORM_SENTINEL } from "./typia-sentinel.mjs";

const noTransformPattern = /no transform has been configured\./;

test("Typia createValidate throws the no-transform sentinel without ttsc", () => {
  assert.throws(
    () => typia.createValidate(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, noTransformPattern);
      return true;
    },
  );
});

test("Typia json.createValidateParse throws the no-transform sentinel without ttsc", () => {
  assert.throws(
    () => typia.json.createValidateParse(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, noTransformPattern);
      return true;
    },
  );
});

test("sentinel constant matches the live package message", () => {
  let message = "";
  try {
    typia.createValidate();
  } catch (error) {
    assert.ok(error instanceof Error);
    message = error.message;
  }
  assert.ok(message.includes(TYPIA_NO_TRANSFORM_SENTINEL));
});
