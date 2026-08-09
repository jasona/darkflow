/** Outbound Core.Hello payload (docs/gmcp-core.md:23-29). */
export interface CoreHello {
  client: string;
  version: string;
  width: number;
  height: number;
}

/** Core.Supports array or object payload (docs/gmcp-core.md:54-62). */
export type CoreSupportsPayload = string[] | Record<string, string | number>;
