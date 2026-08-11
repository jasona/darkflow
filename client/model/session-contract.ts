import type { CharacterProfileId, ServerProfileId, SessionId } from "./ids.ts";

/** Ephemeral runtime session identity and parent profile references. */
export interface SessionDescriptor {
  sessionId: SessionId;
  serverProfileId: ServerProfileId;
  characterProfileId: CharacterProfileId;
}

/** Typed error raised when a character profile already has a live session claim. */
export class DuplicateLiveSessionError extends Error {
  readonly code = "duplicate-live-session" as const;
  readonly characterProfileId: CharacterProfileId;
  readonly existingSessionId: SessionId;

  constructor(characterProfileId: CharacterProfileId, existingSessionId: SessionId) {
    super(`Character profile ${characterProfileId} already has live session ${existingSessionId}`);
    this.name = "DuplicateLiveSessionError";
    this.characterProfileId = characterProfileId;
    this.existingSessionId = existingSessionId;
  }
}

/**
 * One-live-session-per-character registry contract implemented in Step 10.
 * Claim succeeds only when no live session exists for the character; release
 * removes only the matching session/character pair.
 */
export interface SessionRegistry {
  /** Returns the live session for a character profile, if any. */
  lookupByCharacter(characterProfileId: CharacterProfileId): SessionDescriptor | undefined;

  /**
   * Claims a live session for the character profile.
   * @throws DuplicateLiveSessionError when the character is already claimed.
   */
  claim(descriptor: SessionDescriptor): void;

  /**
   * Releases a live session claim when the IDs match.
   * @returns true when a matching claim was removed.
   */
  release(sessionId: SessionId, characterProfileId: CharacterProfileId): boolean;
}
