# Reference measurements — Temple Run

Five frames supplied by the user, cropped to the game viewport (520 × 1159)
and used as the comparison target. **All five are Temple Run; none are Subway
Surfers.** That matters for how far they should be trusted: Temple Run is a
textured, semi-realistic look, so it is a strong reference for *framing,
composition and readability* and a weak one for the toy cel-shaded art
direction this game is actually going for.

Frames: `tr-run-01/02` running, `tr-jump-01/02` mid-jump, `tr-turn-01` cornering.

## The problem with comparing frame-height fractions

Temple Run is portrait (0.45:1). This game is landscape (1.57:1). "Character
occupies N% of frame height" is therefore not comparable between them — the
same character at the same camera distance scores wildly differently just from
the aspect ratio. Two metrics below are aspect-independent and those are the
ones worth acting on.

## Measured

| Metric | Temple Run | This game | Comparable? |
|---|---|---|---|
| Character width ÷ path width at the character's depth | **20%** | **8%** | yes |
| Character width ÷ one lane width | **~60%** | **23%** | yes |
| Character height ÷ frame height (running) | 14.5% | 36% | no — aspect |
| Character centre, fraction down the frame (running) | **77%** | **52%** | partly |
| Character centre, fraction down the frame (jumping) | **50%** | — | partly |
| Vanishing point, fraction down from top | 28% | ~48% | partly |

## The finding that matters

**The track is roughly 2.5× too wide relative to the runner.** Temple Run's
character fills about 60% of a lane; ours fills 23%. This is a pure geometry
ratio — it is invariant to camera distance, so it cannot be fixed by moving
the camera in. It has to come from narrowing the track (`LANE_X`,
`TRACK_HALF_WIDTH`, and the hazard widths that match them) or from scaling the
runner up.

Narrowing the track is the safer lever: scaling the runner up 2× would break
its relationship with hazard geometry, which is tuned against the collision
thresholds in `src/game/collision.js`.

## Composition notes, in priority order

1. **The character sits low.** Temple Run keeps the running character at ~77%
   down the frame, giving the road the upper two thirds. Ours sits at ~52% —
   dead centre — which spends screen space on sky instead of on the thing the
   player has to read.
2. **A jump is a big compositional event.** The character rises from 77% to
   ~50% down the frame, and the arms fling out horizontally, roughly tripling
   the silhouette width. The pose is unmistakable at a glance. Ours tucks.
3. **Foreground occlusion on every frame.** Rocks, path edges and enemies
   break the bottom of the frame and pass close to the lens. This is most of
   where the sense of speed comes from, and this game has none.
4. **Corridor framing.** Walls, statues and vines sit close on both sides,
   making a tunnel. Our open road with distant scenery reads as much slower
   for the same ground speed.
5. **The route is telegraphed.** A line of coins shows the safe path several
   gates ahead. This game's whole mechanic is holding a clean line and it
   currently gives the player no forward read of where that line is.
6. **Two-hue palette.** Gold/tan path against teal water and sky, held for the
   entire level. Ours currently runs green ground, purple road, orange sky and
   three hazard hues at once.

## What is deliberately not copied

- Texture density. Theirs is photographic stone and moss; this game is
  flat-shaded cel by design. The lesson to take is that untextured surfaces
  need *some* variation to avoid reading as raw primitives, not that we should
  add stone textures.
- The HUD. Temple Run uses carved-gold ornamental framing. This game's readout
  is deliberately a broadcast race clock and should not converge on it.
