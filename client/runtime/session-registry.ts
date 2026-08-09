import type { CharacterProfileId } from "../model/ids.ts";
import {
  DuplicateLiveSessionError,
  type SessionDescriptor,
  type SessionRegistry,
} from "../model/session-contract.ts";

/** Creates a one-live-session-per-character registry backed by an in-memory map. */
export function createSessionRegistry(): SessionRegistry {
  const liveSessions = new Map<CharacterProfileId, SessionDescriptor>();

  return {
    lookupByCharacter(characterProfileId) {
      return liveSessions.get(characterProfileId);
    },

    claim(descriptor) {
      const existing = liveSessions.get(descriptor.characterProfileId);
      if (existing !== undefined) {
        throw new DuplicateLiveSessionError(descriptor.characterProfileId, existing.sessionId);
      }
      liveSessions.set(descriptor.characterProfileId, descriptor);
    },

    release(sessionId, characterProfileId) {
      const existing = liveSessions.get(characterProfileId);
      if (existing === undefined || existing.sessionId !== sessionId) {
        return false;
      }
      liveSessions.delete(characterProfileId);
      return true;
    },
  };
}
