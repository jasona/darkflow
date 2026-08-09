import type { EffectiveConfigurationSnapshot } from "../configuration/snapshot.ts";

/** Mutable per-session runtime flags and effective-configuration reference. */
export interface SessionRuntimeState {
  getEffectiveConfiguration(): EffectiveConfigurationSnapshot;
  setEffectiveConfiguration(snapshot: EffectiveConfigurationSnapshot): void;
  isLoggedIntoCharacter(): boolean;
  markCharacterVitalsReceived(): void;
  resetCharacterVitals(): void;
  markConnected(): { reason: "login" | "reconnect" };
}

/** Creates mutable session runtime state for login detection and configuration. */
export function createSessionRuntimeState(
  initial: EffectiveConfigurationSnapshot,
): SessionRuntimeState {
  let effectiveConfiguration = initial;
  let loggedIntoCharacter = false;
  let hasConnectedBefore = false;

  return {
    getEffectiveConfiguration() {
      return effectiveConfiguration;
    },

    setEffectiveConfiguration(snapshot) {
      effectiveConfiguration = snapshot;
    },

    isLoggedIntoCharacter() {
      return loggedIntoCharacter;
    },

    markCharacterVitalsReceived() {
      loggedIntoCharacter = true;
    },

    resetCharacterVitals() {
      loggedIntoCharacter = false;
    },

    markConnected() {
      if (hasConnectedBefore) {
        return { reason: "reconnect" as const };
      }
      hasConnectedBefore = true;
      return { reason: "login" as const };
    },
  };
}
