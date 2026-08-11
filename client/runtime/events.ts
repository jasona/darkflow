import type { SessionId } from "../model/ids.ts";

/** Removes a session event subscription. */
export type Unsubscribe = () => void;

/** Typed session event envelope consumed by the runtime event bus. */
export type SessionEvent<TType extends string = string, TPayload = unknown> = Readonly<{
  sessionId: SessionId;
  type: TType;
  payload: TPayload;
}>;

/** Handler invoked for one session event type. */
export type SessionEventHandler<TType extends string = string, TPayload = unknown> = (
  event: SessionEvent<TType, TPayload>,
) => void;
