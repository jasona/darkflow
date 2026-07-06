# Fishing Mini-Game — ElevenLabs SFX Prompts

Nine sound effects for the Darkflow fishing mini-game. The client already
maps these keys to the filenames below (`public/js/sound-manager.js`), and
missing files fail gracefully — so each mp3 can be dropped into
`public/assets/sounds/` whenever it's ready, with no code changes.

Loudness guidance: match the perceived level of the existing
`quest-accept.mp3` / `combat-hit.mp3` one-shots. The fishing category plays
during a focused mini-game, so err slightly quieter than combat — nothing
should startle. The reel loop is played at 60% volume by the client, but
still master it quiet; it sits under everything for the whole fight.

| Key | File | Type |
|---|---|---|
| fishing/cast | fishing-cast.mp3 | one-shot |
| fishing/splash | fishing-splash.mp3 | one-shot |
| fishing/hook | fishing-hook.mp3 | one-shot |
| fishing/reel | fishing-reel.mp3 | seamless loop |
| fishing/tension | fishing-tension.mp3 | one-shot |
| fishing/catch | fishing-catch.mp3 | one-shot |
| fishing/pristine | fishing-pristine.mp3 | one-shot (layered over catch) |
| fishing/snap | fishing-snap.mp3 | one-shot |
| fishing/slack | fishing-slack.mp3 | one-shot |

---

## fishing-cast.mp3 — line cast
Played the moment the player releases the cast button.

> Fishing rod cast: a quick whip of a flexible rod through air, whoosh of
> line paying out, ending in a small distant "ploop" as the lure lands in
> water. Bright, satisfying, outdoorsy.

Duration: ~1.2s. One-shot. The ploop at the end matters — it sells the
bobber landing.

## fishing-splash.mp3 — bite splash
Played when a fish strikes the bobber (the "!" reaction moment). It's the
attention-getter, so it should cut through, but keep it short.

> Sudden small water splash: a fish striking at the surface of a calm lake,
> sharp initial slap of water with a few droplets falling back. Crisp and
> close, no ambience tail.

Duration: ~0.6s. One-shot. Sharp transient at the very start (the player is
being asked to react to this sound).

## fishing-hook.mp3 — hook set
Played on the hook-set tap, right before the fight starts.

> Fishing hook set: a taut line snapping tight with a short "zip" of line
> tension and a subtle low thud, like yanking a rod back firmly. Punchy,
> under half a second.

Duration: ~0.4s. One-shot.

## fishing-reel.mp3 — reel loop (SEAMLESS LOOP)
Loops for the whole fight (5–20 seconds). Must loop seamlessly: no fade-in,
no fade-out, identical amplitude and tone at the first and last sample. Aim
for a steady texture with no one-off events in it.

> Fishing reel being cranked steadily: rhythmic mechanical clicking of a
> spinning reel with faint line tension whine, even and continuous,
> no beginning or end, uniform loop texture.

Duration: 2–4s loop. Master quiet — it underlays the tension creak and the
outcome sounds. Even cranking rhythm; any hitch in the rhythm will be
audible every loop.

## fishing-tension.mp3 — tension creak
Played once each time line tension crosses into the danger zone (can fire a
few times per fight).

> Fishing line under dangerous strain: a rising creak of stretched
> monofilament line and flexing rod, tense and ominous, like a rope about
> to break, ending abruptly without release.

Duration: ~0.8s. One-shot. Should read as a warning, not a payoff — end it
unresolved.

## fishing-catch.mp3 — catch fanfare
Played when the fish is landed, with the trophy card pop-in.

> Cheerful catch success: a fish hauled out of water with a splash and a
> short bright musical flourish, two or three ascending notes, rustic and
> playful, banjo or marimba feel, not orchestral.

Duration: ~1.5s. One-shot. This is the most-heard reward sound in the
feature — pleasant on the hundredth repeat beats impressive once.

## fishing-pristine.mp3 — pristine sparkle
Layered ON TOP of fishing-catch.mp3 when the catch is pristine quality
(rare). It plays simultaneously, so it must not fight the fanfare.

> Magical sparkle shimmer: delicate glittering chime cascade, airy and
> high-pitched, fading out like fairy dust settling. No low end.

Duration: ~1.5s. One-shot. High-frequency content only (the catch fanfare
owns the mids/lows).

## fishing-snap.mp3 — line snap
Played when tension maxes out and the line breaks (paired with a screen
shake). The failure sting.

> Fishing line snapping: a sharp crack of breaking line with a springy
> recoil twang of the rod whipping back, followed by a beat of deflated
> silence. Abrupt and dry.

Duration: ~0.8s. One-shot. The transient should hit hard — the screen
shakes on this sound.

## fishing-slack.mp3 — fish escapes
Played when the line goes slack and the fish wriggles off (soft failure —
gentler than the snap).

> A fish slipping away underwater: a soft "bloop" and diminishing wet
> wriggle, with a sad little downward two-note whistle or slide. Wry, not
> dramatic.

Duration: ~1.0s. One-shot. Should feel like "aww, so close", not a punishment.
