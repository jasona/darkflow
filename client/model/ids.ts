import type { tags } from "typia";

/** Runtime-validated UUID string tag consumed by Typia structural validators. */
export type UuidString = string & tags.Format<"uuid">;

declare const serverProfileIdBrand: unique symbol;
declare const characterProfileIdBrand: unique symbol;
declare const configSetIdBrand: unique symbol;
declare const sessionIdBrand: unique symbol;

/** Stable identifier for a persisted server profile. */
export type ServerProfileId = UuidString & {
  readonly [serverProfileIdBrand]: true;
};

/** Stable identifier for a persisted character profile. */
export type CharacterProfileId = UuidString & {
  readonly [characterProfileIdBrand]: true;
};

/** Stable identifier for a shared configuration set. */
export type ConfigSetId = UuidString & { readonly [configSetIdBrand]: true };

/** Ephemeral identifier for a live runtime session. */
export type SessionId = UuidString & { readonly [sessionIdBrand]: true };

/** Injected UUID source used by tests and future profile builders. */
export type UuidFactory = () => UuidString;

/** Constructs a server-profile scoped ID from an injected factory. */
export function createServerProfileId(factory: UuidFactory): ServerProfileId {
  return factory() as ServerProfileId;
}

/** Constructs a character-profile scoped ID from an injected factory. */
export function createCharacterProfileId(factory: UuidFactory): CharacterProfileId {
  return factory() as CharacterProfileId;
}

/** Constructs a configuration-set scoped ID from an injected factory. */
export function createConfigSetId(factory: UuidFactory): ConfigSetId {
  return factory() as ConfigSetId;
}

/** Constructs a runtime-session scoped ID from an injected factory. */
export function createSessionId(factory: UuidFactory): SessionId {
  return factory() as SessionId;
}

/** Creates a deterministic UUID factory for tests. */
export function createSequentialUuidFactory(prefix = "00000000-0000-4000-8000-"): UuidFactory {
  let counter = 0;
  return () => {
    counter += 1;
    const suffix = counter.toString(16).padStart(12, "0");
    return `${prefix}${suffix}` as UuidString;
  };
}
