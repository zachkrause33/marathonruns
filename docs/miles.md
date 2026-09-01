# Miles

The character bible. Every brief that touches the runner, the cameras that
look at him, or any word he says must carry this file, the same way every
brief carries the build-every-angle rule. He has a name now; this is what the
name means.

The owner's instruction, verbatim: *"Now that he has a name, he needs a
personality and needs to be the focal point of the game. Rework and examine
every level of detail of him and every interaction he has. Analyze ways to do
this before and after the race. Find ways for the camera to look at him. He
needs to be a work class runner but also someone we can build the game
around."*

---

## 1. Who he is

Miles is a world-class marathoner. Not a mascot, not a cartoon — his world is
Boston, Tokyo and Berlin, and his whole life is one number: 1:59:30. What
makes him a character is a professional's obsession rendered small:

- **Ritual.** He does the same things at every start line: checks the laces,
  bounces on his toes, shakes out his hands, checks the watch, stares down
  the road. The ritual is comfort and the ritual is personality. It never
  varies, because that is what rituals are.
- **The watch.** His signature prop. A runner's watch, checked before the gun
  and — devastatingly — after a near miss. When Miles looks at his wrist, he
  is asking the only question he ever asks.
- **Quiet swagger.** He knows he is good. It shows as economy, not celebration:
  a nod, a slow exhale, arms up only when the record actually falls. He is
  never goofy. The game's world is real cities; he is a real athlete.
- **Resolve.** A near miss does not break him. He checks the watch, looks up
  the road, and the panel says TOMORROW. The daily loop IS his character arc.

**The voice.** One terse line a day, in the masthead voice the game already
speaks. Never chatty, never punctuated with exclamation marks, city-aware
before the race and result-aware after it. Examples of register:

- Before, Boston: `RIGHT ON HEREFORD. LEFT ON BOYLSTON.`
- Before, Tokyo: `THE MOAT, THEN THE NEON. FAST ROAD.`
- After a record: `THAT'S THE ONE.`
- After a near miss: `ONE SECOND. TOMORROW.`
- After a rough day: `THE ROAD WON TODAY.`

## 2. What he looks like

Reference grade is the owner's four screenshots (Subway Surfers, Talking Tom,
the pizza scooter, the tater-tot villain): characters with faces that emote,
kit with layers, and one silhouette-defining prop each.

Everything below is built on all sides — the standing rule applies to Miles
more than to anything else in the game, because the cameras in section 4
orbit him deliberately: *"All angles must be built and as you can still see
them."*

- **Face**: pupils that can track a point (including the lens), lids that
  blink on a natural cadence, brows that raise (surprise, effort) and knit
  (focus, disappointment), and four mouth states — line (focus), open
  (breathing hard), smile (the nod after a win), grimace (the wall).
- **Hair** under the cap, visible at the temples and the nape.
- **Kit**: singlet with contrast trim over the shorts with a side stripe;
  crew socks; two-tone running shoes with a real sole line; the race watch on
  the left wrist; the 26.2 bib pinned at four corners. The cap carries his
  mark so the silhouette is ownable.
- The existing joint verification discipline in runner.js (measured, not
  eyeballed) applies to every new part.

## 3. When he is alive

- **The portrait idle** (start panel): Miles front-and-centre, facing the
  lens. He breathes, blinks, shifts weight, glances around — and once in a
  while looks straight into the camera. The Talking Tom lesson: idle time is
  where a character lives.
- **The ritual** (countdown): laces, toe bounce, hand shake, watch check,
  the stare down the road, then the settle into the start stance.
- **During the race**: no new camera, but body language — head drops and
  elbows rise in the Kick, shoulders sag below the energy knee, the stumble
  machinery already exists.
- **The tape, acted by result**:
  - Record — chest through the tape, arms up, the smile.
  - Near miss (within ~15s) — runs through, slows, hands on head, then the
    watch check. The most important acting in the game: it is the owner's
    own experience of missing by one second, rendered.
  - Ordinary finish — hands on knees, breathing, then straightens.
- **The locked day**: he faces the camera, settled. His day is done too.

## 4. Where the camera looks at him

The chase camera never leaves the road mid-race — one contact ends a record
attempt, and stealing the player's view would buy drama with unfairness
(rule 4). So the camera looks at Miles exactly when the player has nothing to
lose:

1. **The walk-on.** Pre-gun, the camera sits low on the road ahead, facing
   him through the ritual. At the gun it swings 180 degrees past his shoulder
   into the chase position. One orchestrated move per run, and the only
   cinematic the game allows itself.
2. **The portrait idle** behind the start panel, framed like a character
   select: him, not UI wallpaper.
3. **The finish orbit.** The existing celebration camera, extended to hold
   his face while the result-acting plays.
4. **Never** a mid-race cutaway. The Kick is dramatized with body language,
   speed, and the crowd — not with the lens.

## 5. What this is built around

"Someone we can build the game around" means Miles is the fixed point and
everything else varies: the city changes daily, the course changes daily, the
result changes daily — Miles and his ritual are the constant the player
returns to. Features that extend him later should extend the SAME character:
kit variants earned by records, the crowd chanting his name at the tape, the
share card carrying his silhouette. Nothing that would make him goofy;
everything that makes him more specifically himself.
