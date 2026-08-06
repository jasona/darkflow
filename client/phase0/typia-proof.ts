import { parseRoomInfo, validateRoomInfo } from "./gmcp-validators";

/** Summary of one Typia proof assertion for browser and Node consumers. */
export interface TypiaProofCase {
  name: string;
  passed: boolean;
}

/** Aggregated Typia transform proof result for harness and CI consumers. */
export interface TypiaProofResult {
  ok: boolean;
  cases: TypiaProofCase[];
}

const validRoom = {
  id: 1,
  name: "Town Square",
  area: "Midgar",
  exits: [{ direction: "north", destination: 2 }],
};

/** Runs the compact Typia validator proof suite shared by browser and Node entry points. */
export function runTypiaProof(): TypiaProofResult {
  const cases: TypiaProofCase[] = [
    {
      name: "valid minimal room",
      passed: validateRoomInfo(validRoom).success,
    },
    {
      name: "valid room with terrain",
      passed: validateRoomInfo({ ...validRoom, terrain: "urban" }).success,
    },
    {
      name: "id string fails",
      passed: !validateRoomInfo({ ...validRoom, id: "1" }).success,
    },
    {
      name: "unknown mood passes",
      passed: validateRoomInfo({ ...validRoom, mood: "cheerful" }).success,
    },
    {
      name: "bad exit direction fails",
      passed: !validateRoomInfo({
        ...validRoom,
        exits: [{ direction: 5, destination: 2 }],
      }).success,
    },
    {
      name: "parse valid json",
      passed: parseRoomInfo(JSON.stringify(validRoom)).success,
    },
    {
      name: "parse id string fails",
      passed: !parseRoomInfo(JSON.stringify({ ...validRoom, id: "1" })).success,
    },
    {
      name: "parse malformed json throws",
      passed: (() => {
        try {
          parseRoomInfo("{");
          return false;
        } catch (error) {
          return error instanceof SyntaxError;
        }
      })(),
    },
  ];

  return {
    ok: cases.every((testCase) => testCase.passed),
    cases,
  };
}
