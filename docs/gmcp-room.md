# Room GMCP Protocol Support

Darkflow advertises `Room 1`. Room messages feed the room panel, the generic
cross-MUD map, the Darkwind map fallback, speedwalk verification, room media,
and synchronized room features such as the shared jukebox.

## Messages

| Message | Direction | Client behavior |
| --- | --- | --- |
| `Room.Info` | Server -> Client | Merge current-room metadata and update map state |
| `Room.Players` | Server -> Client | Replace the current room player list |
| `Room.AddPlayer` | Server -> Client | Append one player to the room list |
| `Room.RemovePlayer` | Server -> Client | Remove one player by name |

## Room.Info

```json
{
  "num": "450359962737049",
  "name": "Temple Yard",
  "area": "Darkwind",
  "environment": "outside, city",
  "coords": { "x": 0, "y": 0, "z": 0 },
  "exits": {
    "north": "450359962737050",
    "south": "closed"
  }
}
```

| Field | Notes |
| --- | --- |
| `num` or `id` | Stable room identity; `num` is used to detect room changes |
| `name` | Room panel title |
| `area` or `zone` | Area identity for map grouping |
| `environment`, `terrain`, or `env` | Terrain label; aliases are normalized |
| `coords` | Optional `{x,y,z}` object; copied to `coord_x`, `coord_y`, `coord_z` |
| `exits` | Direction -> destination id or non-numeric state label |
| `exit_states` | Optional explicit direction -> unavailable-state label |
| `details` | Optional room tags retained by mapping implementations |

The Darkwind server uses an empty string as the LPC/JSON sentinel when
`coords`, `exits`, or `details` has no value. `Room.Players` likewise sends an
empty string when no other players are present. Clients accept those wire
values as empty state without rewriting the received payload.

When an `exits` value is a non-numeric string, Darkflow also treats it as an
exit state. The room panel displays that direction as unavailable with the
state in its tooltip. Numeric or otherwise usable destinations are rendered as
buttons that send the direction as a normal game command.

Each `Room.Info` is passed to the generic local map even while
`Darkwind.MapData2` is active. This keeps a ready fallback for servers or rooms
where MapData2 cannot provide an authoritative current-room payload.

## Player List Messages

`Room.Players` carries the complete array:

```json
[
  { "name": "nacho", "fullname": "Nacho the Bold" }
]
```

`Room.AddPlayer` carries one player object. `Room.RemovePlayer` accepts either
a player-name string or an object with `name`. The room panel displays
`fullname` when present and falls back to `name`.

## Update Semantics

`Room.Info` is merged into the previous room object so partial updates retain
known fields. A changed `num` clears the current room-image panel until a new
`Darkwind.Room.Image` arrives. The player list is maintained separately by the
three player messages above.
