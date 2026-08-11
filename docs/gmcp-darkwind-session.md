# Darkwind.Session GMCP Protocol Specification

This document specifies the `Darkwind.Session.Recovered` message emitted by
the Darkwind server after session recovery events. It is not advertised in the
client support set; handlers register for it directly.

## Package Overview

| Message                      | Direction        | Purpose                                                                                        |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `Darkwind.Session.Recovered` | Server -> Client | Notify the client that the player's session was recovered after switch, link-dead, or takeover |

## Darkwind.Session.Recovered

Direction: `Server -> Client`

Sent when the server restores an existing player session instead of starting a
fresh login flow. Current Darkflow handlers ignore the payload and use the
message as a signal to re-run character-attached UI initialization
(`public/js/tutorial-manager.js`, `public/js/visual-effects-manager.js`,
`public/js/login-theme-manager.js`).

### Schema

The server builds the payload in `send_session_recovered`
(`darkwind-nextgen/codebase/secure/daemons/telopt_d.c:4574-4590`):

```json
{
  "mode": "switch",
  "playerName": "Gandalf",
  "recoveredAt": 1783612800,
  "previousCharacter": "Bilbo"
}
```

For modes other than `"switch"`, `previousCharacter` is omitted:

```json
{
  "mode": "linkdead",
  "playerName": "Gandalf",
  "recoveredAt": 1783612800
}
```

```json
{
  "mode": "takeover",
  "playerName": "Gandalf",
  "recoveredAt": 1783612800
}
```

### Fields

| Field               | Type   | Required | Notes                                                       |
| ------------------- | ------ | -------- | ----------------------------------------------------------- |
| `mode`              | string | Yes      | Recovery reason: `"switch"`, `"linkdead"`, or `"takeover"`  |
| `playerName`        | string | No       | Player name after recovery                                  |
| `recoveredAt`       | number | No       | Unix timestamp when recovery completed                      |
| `previousCharacter` | string | No       | Present only when `mode === "switch"`; prior character name |

### Server Behavior

Recovery is triggered from player session management with the modes above
(`darkwind-nextgen/codebase/secure/player.c:3793,3796,3817`). The package
constant is defined in `gmcp_defs.h:465`.

## Transport

```text
Darkwind.Session.Recovered {"mode":"linkdead","playerName":"Gandalf","recoveredAt":1783612800}
```

See also [Client coordination](gmcp-darkwind-client.md) for subscription and
terminal geometry messages in the same session-boundary family.
