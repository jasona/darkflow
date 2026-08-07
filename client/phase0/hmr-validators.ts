import typia from "typia";
import type { Phase0HmrRoom } from "./hmr-protocol-fixture.ts";

export const validateHmrRoom = typia.createValidate<Phase0HmrRoom>();
