# Dev harness

The game itself is a single `index.html` with no build step and no dependencies
beyond three.js from a CDN. Nothing here is needed to play or ship it — these
are the tools used to verify changes.

    npm install          # playwright only
    npx playwright install chromium

| tool | purpose |
|---|---|
| `tools/profile.mjs` | Scripted gameplay run. Reports draw calls and CPU cost as p50/p95/p99/max, and **fails** if any shader program compiles during play. |
| `tools/shots.mjs` | Reproducible capture set, one fresh page per shot at a fixed date and fixed frame count. |
| `tools/difficulty.mjs` | Plays the full marathon at several skill levels and reports each against the world record. Guards the thing that makes the game a test rather than a coin flip. |
| `tools/imagediff.mjs` | Per-pixel gate between two capture directories. Exits non-zero if any pixel moved. |
| `tools/gait.mjs` | Side-on capture of the runner's stride cycle at jog and sprint pace. |
| `tools/sheet.mjs` | Stitches a directory of frames into one labelled contact sheet. |

All of them drive the game through `window.MR`, which `index.html` exposes
**only** when loaded with `?debug`. The shipped page exposes nothing.

## Why these particular measurements

**Lazy shader compilation is a gameplay bug here, not just a stuttering one.**
`renderer.info.programs` grows the first time a material/lighting/shadow
combination is drawn. A 700ms stall mid-race corrupts the clock, and the clock
is the score in a daily game where players compare times. `profile.mjs` gates
`programsCompiledDuringPlay` at 0.

**Median frame time hides hitches.** A healthy p50 coexists happily with a p99
that ruins a run, so everything is reported as a distribution.

**Determinism is verified at two levels.** `shots.mjs` prints a fingerprint of
simulation state (position, camera basis, pace, combo, hits) per shot; those are
bit-identical across runs, which is what actually matters for a daily game whose
seed and clock must be fair. Pixels are a weaker guarantee: under software GL
they carry a noise floor of roughly mean 2/255 across ~9% of subpixels, because
swiftshader is multithreaded and tiles are not bit-stable across processes. So
`imagediff.mjs` gates on a tolerance rather than equality. On a real GPU, run it
with `--maxmean=0 --maxpct=0`.

**Captures must be isolated to be comparable.** Reusing one page across shots
leaks particle age, ring-pool state and grade accumulation forward, so two
identical runs differ and any pixel gate becomes noise. `shots.mjs` gives each
shot a fresh page, a fixed clock (so the daily seed is stable) and a fixed
number of fixed-`dt` frames.

**GPU frame time is deliberately not reported.** This harness is normally run
against software GL, where absolute fps is meaningless. Draw calls, triangle
counts and program counts are hardware-independent, so those are what we gate
on. Real fps still needs a real device.

**The chase camera hides the animation it is pointed at.** Knee bend, arm swing
and lean all happen in the sagittal plane, which is exactly the plane the game
camera looks down — from behind, a flailing gait and a good one look the same.
`gait.mjs` parks a camera beside the runner and drives `animateRunner` directly
at a fixed pace, because pace is emergent (combo, fatigue, grade) and cannot be
pinned by poking state. That framing is what showed the upper arm swinging as
widely as the thigh.

**A skill sweep is only as honest as its bot.** Two independent bugs made this
lie. Its LCG (`rnd*1103515245+12345 & 0x7fffffff`) overflowed 2^53, lost integer
precision and collapsed to a sequence that never returned a value under 0.04, so
every skill tier played identically to `perfect`. And the bot only ever looked at
`lane±1`, while a car spans two lanes — from the far side the sole escape is two
lanes across, which it scored as impossible. Cars were 15 of its 16 stumbles.
Both are fixed; treat a suspiciously flat tier spread as a bug in here first.

## Offline / sandboxed use

If the jsDelivr CDN is unreachable, point the harness at a local three.js:

    npm pack three@0.160.1 && tar xzf three-0.160.1.tgz
    node tools/profile.mjs --three=./package
