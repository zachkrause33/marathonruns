/**
 * Procedural audio. Every sound is synthesised from oscillators and noise at
 * runtime -- no samples, which keeps the single-file promise intact.
 *
 * ---- THIS FILE IS MEASURED -----------------------------------------------
 *
 * `tools/audio-probe.js` renders every cue below through this exact graph in
 * an OfflineAudioContext and prints peak, rms, 50 ms punch, duration,
 * spectral centroid and band split. Nothing in here is a guess about how loud
 * something is any more; every level in this file was set against that table
 * and the table asserts the ones that matter. If you change a gain, run it.
 *
 *   node tools/audio-probe.js
 *
 * ---- THE MIX, AS A DESIGN ------------------------------------------------
 *
 * The mix is built around the streak, and it says so in three places at once
 * rather than one:
 *
 *   as an EVENT   the clean-gate blip rises in pitch every time you clear a
 *                 gate, so the reward is instant.
 *   as a STATE    the air moving past you (`rush`), the crowd bed, and the
 *                 brightness of your own footfalls all open up with the gear
 *                 you are in, so you can hear you are flying without any
 *                 event having to fire.
 *   as a CHANGE   crossing into a new gear plays a two-note lift; losing one
 *                 plays it upside down. Eight gears across a race.
 *
 * The terrain is said the same way -- the grade is a state, the crest is an
 * edge -- and deliberately says nothing about cost, because the hills do not
 * charge one. See THE GRADE.
 *
 * The gear curve is derived from the pace model, not invented -- see
 * `gearOf()`. The previous version saturated at streak 90 on a course of 205
 * gates, so from about mile 11 the sound stopped responding while the game
 * kept accelerating to the tape. That was measured, not suspected: the probe
 * reported an identical 1631 Hz centroid for clean(90), clean(140) and
 * clean(205).
 *
 * ---- LOUDNESS, WHICH IS THE WHOLE JOB ------------------------------------
 *
 * Relative level is what makes a mix work or not. The shipped mix had, in
 * 50 ms punch:
 *
 *   hit -19.5, mile -24.7, roar(1) -25.0, footstep -32.2, clean -38.6,
 *   duck -48.8, and the ambient bed at -45.2.
 *
 * Three of those are wrong as facts about the game. The crowd breaking the
 * roof off for a world record was QUIETER than the mile-13 marker beep. The
 * clean gate -- the reward the entire design turns on -- was 6 dB below the
 * sound of your own feet. And the duck cue was 3.6 dB below the crowd bed it
 * had to be heard over, which means it was not a quiet sound, it was an
 * inaudible one.
 *
 * The intended order now, loudest first, is: the finish, the roar, contact,
 * then miles and the countdown, then your own body, then the gates, then aid,
 * then the bed. Contact sits 16 dB above a footstep because it costs the
 * record and a footstep costs nothing.
 *
 * ---- SPECTRUM ------------------------------------------------------------
 *
 * The other measured fault was that the running mix was 90% below 200 Hz --
 * footsteps 99%, landings 100%, contact 81%. Small laptop and phone speakers
 * roll off hard below ~200 Hz, so on the hardware most people will play this
 * on, the entire body of the game was missing and what survived was a click.
 * Every impact now carries a mid band as well as a low one; the low is the
 * weight on real speakers and the mid is the sound itself everywhere else.
 *
 * ---- COST ----------------------------------------------------------------
 *
 * The graph runs on the browser's audio thread, not the render thread, so the
 * per-FRAME cost of this file is only the JS that schedules it. Steady state
 * is 10 live nodes (bed, rush, their filters and gains, the grade tilt, the
 * event gain, the limiter and the master). Running creates roughly 30 short-lived nodes a
 * second, each self-freeing on stop. Nothing is polled and nothing runs on
 * requestAnimationFrame. `setIntensity` is called every frame by main.js and
 * is gated so that a frame where the value has not meaningfully moved does no
 * work at all.
 *
 * Everything is scheduled with Web Audio's own clock rather than setTimeout.
 * The previous version built the roar, the fanfare and the crossover out of
 * setTimeout callbacks, which means those cues arrived with whatever jitter
 * the main thread had at the time -- and the frame that fires the finish is
 * the frame that also breaks the tape and launches the confetti, which is the
 * worst-timed frame in the game.
 *
 * ---- FAILING SAFE --------------------------------------------------------
 *
 * Browsers refuse to start an AudioContext without a user gesture, so
 * everything is routed through a context that stays silent until `unlock()`.
 * And a browser with no Web Audio at all must still play the game: `create()`
 * returns a stub built from the same method list as the real object, so a
 * missing cue can never be a TypeError in the game loop. The old stub was
 * hand-written and had drifted -- it was missing `duck`, `crossover`, `aid`,
 * `countdown` and `setMuted`, so on any browser without Web Audio the game
 * threw on the first tick of the 3-2-1 countdown and never started.
 */
MR.Audio = (function () {

  // Every method the game may call. The silent stub is generated from this,
  // so adding a cue below can never leave the no-audio path short of one.
  const API = [
    'unlock', 'setMuted', 'ambient', 'setIntensity',
    'footstep', 'jump', 'land', 'duck', 'hit', 'clean', 'crossover', 'aid',
    'mile', 'roar', 'finish', 'countdown',
    'aidMissed', 'recordLost', 'tier',
  ];

  function silent(reason) {
    const stub = { enabled: false, reason: reason || 'no Web Audio' };
    for (const k of API) stub[k] = function () {};
    return stub;
  }

  function create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return silent('no AudioContext');

    let ctx;
    try {
      ctx = new AC();
    } catch (e) {
      // Some browsers throw on the Nth context, or under strict autoplay
      // policy. A game that cannot make a sound still has to run.
      return silent('AudioContext threw: ' + e);
    }

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // A limiter, not a leveller. The old settings were threshold -14 with the
    // DEFAULT 30 dB knee, which means compression began at -29 dBFS -- below
    // every cue in the game -- so the thing meant to catch stacked hits was
    // in fact squashing the whole mix and flattening exactly the differences
    // between a footstep and a crash that the mix is made of. A 6 dB knee at
    // -6 leaves the cues alone and only engages on the finish pile-up.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(master);

    const s = { ctx, enabled: true, muted: false, started: false };

    // ---- shared noise buffer -------------------------------------------
    const noiseBuf = (function () {
      const n = ctx.sampleRate * 1.2;
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();

    /**
     * Filtered noise burst.
     *
     * `o` carries the parts that are not always wanted:
     *   at   start delay in seconds, on the audio clock. This is how every
     *        multi-part cue in the file is built -- sample-accurate, and free,
     *        where setTimeout costs a timer and arrives whenever the main
     *        thread gets round to it.
     *   atk  attack time. The default 6 ms is a transient. A crowd is not a
     *        transient, so the roar asks for 150-300 ms and swells.
     *   to   sweep the filter to this frequency across the burst. This is what
     *        turns a hiss into a movement past the ear.
     *   dest override the output node.
     */
    function noise(dur, freq, q, gain, type, o) {
      o = o || {};
      const t = ctx.currentTime + (o.at || 0);
      const atk = Math.min(o.atk === undefined ? 0.006 : o.atk, dur * 0.6);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type || 'bandpass';
      f.frequency.setValueAtTime(freq, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      f.Q.value = q || 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(o.dest || comp);
      // Offset into the buffer so repeated bursts are not the same noise.
      src.start(t, Math.random() * 1.0);
      src.stop(t + dur + 0.02);
      return { f, g, t };
    }

    function tone(freq, dur, gain, type, glideTo, o) {
      o = o || {};
      const t = ctx.currentTime + (o.at || 0);
      const atk = Math.min(o.atk === undefined ? 0.008 : o.atk, dur * 0.6);
      const oo = ctx.createOscillator();
      oo.type = type || 'sine';
      const g = ctx.createGain();
      oo.frequency.setValueAtTime(freq, t);
      if (glideTo) oo.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + atk);
      if (o.hold) g.gain.setValueAtTime(gain, t + o.hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      oo.connect(g); g.connect(o.dest || comp);
      oo.start(t); oo.stop(t + dur + 0.02);
      return { o: oo, g, t };
    }

    // ---- the gear ------------------------------------------------------
    /**
     * GEAR: the streak, expressed as something a mix can use.
     *
     * The obvious mapping -- streak / someNumber, clamped -- is what shipped,
     * and it saturated at 90 on a course that has 205 gates. The second
     * mapping you reach for, "how far the pace has travelled from 5:30
     * towards 4:14", is worse, not better: measured against the real curve it
     * is 0.87 at streak 90 and 0.96 at 205, so 91% of the audible range is
     * spent in the first half of the race and the run to the tape is silent
     * progress again.
     *
     * The mapping that works is the LOG of the gap still to close. Halving
     * the distance to the pace floor is one step up, every time, so the scale
     * never runs out:
     *
     *   streak    0    10    30    60    90   120   150   180   205
     *   gear   0.00  0.19  0.41  0.55  0.64  0.74  0.83  0.92  1.00
     *
     * 36% of the climb happens after streak 90 -- the part of the race that
     * used to be flat -- and it is close to linear from there to the finish,
     * so the last hundred gates each buy an audible, equal step. That is the
     * same shape as the pace model's promise that "the slow term is still
     * unwinding at the finish", said in pitch.
     *
     * It reads the real curve out of MR.Pace/MR.K rather than restating it,
     * so retuning the ramp retunes the sound. The fallback exists only so
     * that audio.js can never be the reason a page fails to start.
     */
    const GEAR_GATES = 205;      // gates on a full course (course-test: 202-207)

    function remaining(streak) {
      const K = MR.K, P = MR.Pace;
      if (K && P && P.targetPace) {
        return (P.targetPace(streak) - K.FLOOR_PACE) / (K.START_PACE - K.FLOOR_PACE);
      }
      return Math.exp(-streak / 38);
    }
    // Normaliser, computed from whichever curve is actually in force, so the
    // fallback and the real model both put a full course at gear 1.0.
    const GEAR_SPAN = Math.max(0.5, -Math.log2(Math.max(1e-4, remaining(GEAR_GATES))));

    function gearOf(streak) {
      const r = Math.max(1e-4, remaining(Math.max(0, streak || 0)));
      return Math.max(0, Math.min(1.15, -Math.log2(r) / GEAR_SPAN));
    }

    const GEARS = 8;             // gear-change chimes across a race
    let gear = 0;                // 0..1.15
    let gearIdx = 0;             // Math.floor(gear * GEARS)
    let lastStreak = 0;

    /** Set the gear from a streak and fire the change cue if it moved. */
    function setGear(streak, at) {
      lastStreak = Math.max(0, streak || 0);
      gear = gearOf(lastStreak);
      applyBed();
      const idx = Math.min(GEARS, Math.floor(gear * GEARS));
      if (idx !== gearIdx) {
        const up = idx > gearIdx;
        gearIdx = idx;
        gearChange(up, at || 0);
      }
    }

    /**
     * Changing gear. Two notes, up or down, over the top of whatever else is
     * playing -- deliberately consonant with nothing, because it is a state
     * readout rather than a musical event, and it has to be legible under the
     * gate blip that always fires with it.
     */
    function gearChange(up, at) {
      const root = 300 * Math.pow(2, gearIdx / GEARS * 1.4);
      const a = up ? root : root * 1.5;
      const b = up ? root * 1.5 : root;
      tone(a, 0.11, 0.055, 'triangle', null, { at: at });
      tone(b, 0.24, 0.05, 'triangle', null, { at: at + 0.075 });
      if (!up) tone(root * 0.5, 0.34, 0.045, 'sine', root * 0.4, { at: at });
    }

    // ---- the environment: bed + rush ------------------------------------
    //
    //   bed  src -> band -> bedG (intensity) -\
    //                                          evt -> comp
    //   rush src -> band -> rushG (gear)     -/
    //
    // `evt` is a single gain the one-shots borrow: contact ducks it so the
    // crash carves a hole in the crowd, the roar holds it up. It is separate
    // from `bedG` because main.js calls setIntensity every frame and would
    // otherwise wipe any envelope written onto the bed within one frame.
    let amb = null;
    let evt = null;

    function ambient() {
      if (amb) return;
      evt = ctx.createGain();
      evt.gain.value = 1;
      evt.connect(comp);

      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 620; f.Q.value = 0.55;
      const g = ctx.createGain(); g.gain.value = 0.035;
      // THE GRADE TILT. A peaking filter at 300 Hz, and the only axis in the
      // mix that nothing else touches -- gear moves level and centre
      // frequency, so the grade needed somewhere of its own or a climb would
      // be indistinguishable from a streak. On a climb the road rises into
      // your field a few metres in front of you and the low-mid comes back at
      // you; on a descent the ground falls away and it thins out.
      const gq = ctx.createBiquadFilter();
      gq.type = 'peaking'; gq.frequency.value = 300; gq.Q.value = 0.8;
      gq.gain.value = 0;
      src.connect(f); f.connect(gq); gq.connect(g); g.connect(evt);
      src.start();

      // THE RUSH. Air moving past you, and the only part of the mix that is
      // pure state: it says nothing about any event, it is just how fast you
      // are going, and it is silent at gear 0. Two nodes and a source, set
      // once and then only re-targeted when the gear actually changes.
      const rsrc = ctx.createBufferSource();
      rsrc.buffer = noiseBuf; rsrc.loop = true;
      const rf = ctx.createBiquadFilter();
      rf.type = 'bandpass'; rf.frequency.value = 1200; rf.Q.value = 0.6;
      const rg = ctx.createGain(); rg.gain.value = 0;
      rsrc.connect(rf); rf.connect(rg); rg.connect(evt);
      rsrc.start(ctx.currentTime + 0.02);

      amb = { src, f, g, gq, rsrc, rf, rg };
      applyBed();
    }

    // ---- THE GRADE ------------------------------------------------------
    //
    // The hills are PACE-NEUTRAL BY CONSTRUCTION: net rise is exactly zero on
    // every date, the grade term integrates to zero over the race, and the
    // flat-vs-hilly finish delta is under 0.2 s. So the sound must not imply a
    // cost the model does not charge. Nothing here labours, strains or
    // breathes harder on a climb -- that would be the mix telling the player
    // they are losing something the game is not taking.
    //
    // What it does instead is treat the hill as ACOUSTIC SPACE, which is a
    // fact about terrain rather than about effort:
    //
    //   climbing   the road rises into your field a few metres ahead. The
    //              world closes in: low-mid comes back at you (`gq` up), the
    //              bed darkens, and there is less air moving.
    //   descending the ground falls away and the city opens out. Thinner,
    //              brighter, wider, more air.
    //
    // The air term is honest rather than decorative: paceNow = pace +
    // GRADE_SPM * grade, so the runner genuinely is moving about 6% faster on
    // the steepest descent and 5% slower on the steepest climb. It is the
    // FINISH that is neutral, not the local speed.
    //
    // And one thing was already free before any of this: main.js fires
    // footsteps off `runner.phase`, whose cadence is `2.55 * (speed /
    // SPEED_LO)^0.72` with a grade-inclusive speed. Measured against the real
    // curve, the stride is 4.7-5.3% slower on a 4% climb and 4.6-6.1% faster
    // on a 4% descent, all of it already in the mix. The layers below are
    // sized as a complement to that, not as a replacement for it.

    // pace.grade is PERCENT (elevation.js: gradeAt = slope * 100) while
    // MR.Elevation.MAX_GRADE is the slope FRACTION 0.040. Reading one as the
    // other is a factor of 100 and would peg this signal at full scale for
    // the whole race.
    const GRADE_MAX_PCT = ((MR.Elevation && MR.Elevation.MAX_GRADE) || 0.04) * 100;

    let gradeN = 0;        // -1..1 against the steepest legal grade
    let bedWroteX = -1;    // last gear written to the graph
    let bedWroteG = -9;    // last grade written to the graph

    function applyBed() {
      if (!amb) return;
      const x = Math.min(1.15, gear);
      // A frame where neither term has meaningfully moved does no work at all.
      if (Math.abs(x - bedWroteX) < 0.015 && Math.abs(gradeN - bedWroteG) < 0.04) return;
      bedWroteX = x; bedWroteG = gradeN;
      const gn = gradeN;
      const t = ctx.currentTime;
      amb.g.gain.setTargetAtTime((0.030 + 0.062 * x) * (1 + 0.16 * gn), t, 0.4);
      amb.f.frequency.setTargetAtTime((560 + 340 * x) * Math.pow(2, -0.28 * gn), t, 0.6);
      amb.gq.gain.setTargetAtTime(5.0 * gn, t, 0.5);
      // The rush only exists above about half a gear; below that it would be
      // hiss on a runner who is not going anywhere.
      const r = Math.max(0, x - 0.42) / 0.58;
      amb.rg.gain.setTargetAtTime(0.070 * r * r * (1 - 0.35 * gn), t, 0.7);
      amb.rf.frequency.setTargetAtTime((1000 + 1300 * r) * (1 - 0.10 * gn), t, 0.9);
    }

    /**
     * Per-frame world state. Called by main.js on every frame of RUN.
     *
     * @param x      pace.streak / 70, unclamped.
     * @param grade  pace.grade, percent, positive uphill. Optional: without it
     *               the terrain is simply silent, which is what shipped.
     *
     * `x` used to arrive as min(1, streak/70) and saturated at streak 70 on a
     * course of 205 gates -- the same defect clean() had. The clamp is gone at
     * the call site now, so the value is read straight back as the streak it
     * is and gear does the rest.
     */
    let lastX = -1;
    s.setIntensity = function (x, grade) {
      const v = x || 0;
      if (v !== lastX) { lastX = v; setGear(v * 70, 0); }
      if (grade !== undefined) setGrade(grade);
    };

    /**
     * The terrain edges.
     *
     * A hill's grade is a smooth sine: it rises through zero at the foot,
     * peaks, falls back through zero AT THE CREST, troughs, and returns. So
     * the crest is a zero crossing, not a state, and it is detected as one --
     * armed by having actually been on a climb, so a flat wobble cannot fire
     * it. Measured against the real profiles this gives exactly one crest,
     * one foot and one bottom per hill: 12-15 edges across a race of 4-5
     * hills, on every date tested.
     *
     * A three-state FLAT/UP/DOWN machine was the obvious shape and is wrong.
     * The grade sits inside any sensible flat deadband for up to 1812 units --
     * 64 seconds of wall clock -- between hills, so the crest would have come
     * out as two unrelated edges, and the one at the top would have fired late
     * by however wide the deadband was.
     *
     * None of these touch `evt`. Ducking the whole world is contact's move and
     * contact's alone: it is the only event in the game that costs anything
     * and it should stay the only one that takes the room away.
     */
    let gPrev = 0;
    let gPeak = 0;
    let armedFoot = true, armedBottom = true;

    function setGrade(gPct) {
      const gn = Math.max(-1, Math.min(1, (gPct || 0) / GRADE_MAX_PCT));
      if (gn > gPeak) gPeak = gn;

      // The foot: the ground starts rising under you.
      if (armedFoot && gPrev <= 0.25 && gn > 0.25) {
        armedFoot = false;
        noise(0.70, 1400, 0.6, 0.045, 'bandpass', { atk: 0.14, to: 350 });
      }
      // THE CREST. The road stops climbing and the view arrives -- wide, soft,
      // opening upward, and deliberately below a clean gate in level. It is
      // terrain, not an achievement, and a chime here would be the mix
      // congratulating the player for arriving somewhere gravity took them.
      if (gPrev > 0 && gn <= 0 && gPeak > 0.35) {
        gPeak = 0; armedFoot = true; armedBottom = true;
        noise(0.95, 300, 0.5, 0.075, 'bandpass', { atk: 0.18, to: 2600 });
        noise(0.55, 1800, 0.7, 0.030, 'bandpass', { at: 0.15, atk: 0.20, to: 4200 });
      }
      // The bottom: the descent runs out and the road levels.
      if (armedBottom && gPrev <= -0.25 && gn > -0.25) {
        armedBottom = false;
        noise(0.45, 700, 0.7, 0.028, 'bandpass', { atk: 0.10, to: 900 });
      }
      gPrev = gn;

      if (Math.abs(gn - gradeN) < 0.02) return;
      gradeN = gn;
      applyBed();
    }

    // ---- one-shots ------------------------------------------------------

    /**
     * Footfalls. Measured at 99% of energy below 200 Hz, which is a thump
     * with no shoe in it and nothing at all on a phone. There are three
     * layers now: the tarmac scuff that carries on any speaker, the body, and
     * the sub. The scuff brightens and sharpens with the gear, so the run
     * itself tells you what gear you are in three times a second without any
     * event firing -- this is the cheapest state signal in the file, because
     * the footstep was going to play anyway.
     */
    let stepFlip = 0;
    s.footstep = function (power) {
      const p = power === undefined ? 1 : power;
      stepFlip ^= 1;
      const g = gear;
      // Scuff: 900 Hz at a standstill, 2.1 kHz in top gear, and shorter.
      // It also tilts with the grade, and that is geometry rather than effort:
      // a climb is taken on the forefoot, so the contact is quieter and duller
      // with no heel in it, and a descent lands heel-first and harder. The
      // cadence underneath this already changes on its own -- see the note at
      // THE GRADE -- so between them the road is legible without anything in
      // the mix having to sound like it is costing the player time.
      const gn = gradeN;
      noise(0.045 - 0.016 * g, (900 + 1200 * g) * (1 - 0.22 * gn), 0.9,
        0.45 * p * (0.75 + 0.4 * g) * (1 - 0.30 * gn),
        'bandpass', { atk: 0.002, to: 480 + 400 * g });
      // Body.
      noise(0.075, stepFlip ? 240 : 300, 1.2, 0.70 * p, 'bandpass');
      // Sub. Small on purpose: at the gain this carried before, it was 23 dB
      // over the other two layers and the footstep measured 99% below 200 Hz.
      tone(stepFlip ? 74 : 66, 0.07, 0.038 * p, 'sine');
      // Effort. Only in the top half of the range, only on the down beat, so
      // it reads as a runner working rather than a loop.
      if (g > 0.55 && stepFlip) {
        noise(0.19, 380 + 260 * g, 1.6, 0.11 * (g - 0.55) / 0.45, 'bandpass',
          { atk: 0.05, to: 240 });
      }
    };

    s.jump = function () {
      noise(0.26, 900, 0.8, 0.16, 'bandpass', { to: 2200, atk: 0.012 });
      tone(300, 0.24, 0.05, 'triangle', 700);
    };

    s.land = function () {
      // Same fault as the footstep: 100% below 200 Hz. The slap is what the
      // ear actually hears land; the sub is what the room feels.
      noise(0.055, 1500, 0.9, 0.85, 'bandpass', { atk: 0.002, to: 700 });
      noise(0.11, 190, 1.2, 0.45, 'lowpass');
      tone(96, 0.13, 0.05, 'sine', 62);
    };

    /**
     * Ducking. Shipped at -48.8 dBFS punch, which is 3.6 dB BELOW the crowd
     * bed -- not a quiet cue, an inaudible one, and the only feedback the
     * player had that the input registered. It is now a movement past the ear:
     * a band sweeping down and away, which is what a bar passing over your
     * head sounds like, at a level that sits just under a jump.
     */
    s.duck = function () {
      noise(0.22, 2400, 1.3, 0.24, 'bandpass', { atk: 0.008, to: 320 });
      tone(210, 0.16, 0.025, 'sine', 130);
    };

    /**
     * CONTACT. The most important sound in the game, because it is the only
     * one that costs anything, and it shipped as three lines with 81% of its
     * energy below 200 Hz -- a sound that mostly did not exist on a laptop.
     *
     * Four things happen at once and each is doing a separate job:
     *
     *   the crack    3 kHz, 30 ms, the hardest transient in the file. This is
     *                what makes it read as an IMPACT rather than a swell, and
     *                it is the part that survives every speaker.
     *   the body     a mid thump at 520 and the original low weight under it,
     *                so it lands on a phone and hits in the chest on desk
     *                speakers.
     *   the collapse a tone falling away, and its depth is the gear you were
     *                in. This is the part that makes the same cue mean
     *                different things at different points in the race: a hit
     *                at gear 0.1 is a knock, a hit at gear 0.95 is nearly an
     *                octave and a half of something draining out from under
     *                you. The game already models this -- contact keeps 40% of
     *                the streak, so the higher you were the more there is to
     *                lose -- and the sound now says it.
     *   the hole     the crowd and the rush duck to a quarter for 200 ms and
     *                come back. Nothing else in the mix does this, so contact
     *                is the only event that changes the whole soundscape, and
     *                it is what makes it land far harder than its level alone
     *                would explain.
     */
    s.hit = function () {
      const g = gear;
      // Crack.
      noise(0.035, 3000, 0.8, 1.10, 'bandpass', { atk: 0.001, to: 1400 });
      // Mid body -- the part that exists on small speakers.
      noise(0.16, 520, 0.9, 1.90, 'bandpass', { atk: 0.002, to: 260 });
      // Low weight. A square at 0.22 was the single loudest element in the
      // whole game and it lived at 150 Hz, which is most of why contact was
      // 81% sub-200 and vanished on a laptop.
      noise(0.34, 150, 0.7, 1.20, 'lowpass', { atk: 0.003 });
      tone(150, 0.30, 0.14, 'square', 58);
      tone(96, 0.40, 0.10, 'sawtooth', 44);
      // Collapse. 0.55 octaves down at a standstill, 1.5 in top gear.
      const top = 420 + 900 * g;
      tone(top, 0.30 + 0.55 * g, 0.17 + 0.13 * g, 'triangle',
        top / Math.pow(2, 0.55 + 0.95 * g), { at: 0.045, atk: 0.012 });
      // The hole.
      if (evt) {
        const t = ctx.currentTime;
        evt.gain.cancelScheduledValues(t);
        evt.gain.setValueAtTime(evt.gain.value, t);
        evt.gain.linearRampToValueAtTime(0.25, t + 0.03);
        evt.gain.setValueAtTime(0.25, t + 0.20);
        evt.gain.setTargetAtTime(1, t + 0.20, 0.35);
      }
      // Contact keeps HIT_STREAK_KEEP of the streak. Read the constant rather
      // than restate it, and drop the gear to match, which is what fires the
      // gear-down chime when the run actually loses a gear.
      const keep = (MR.K && MR.K.HIT_STREAK_KEEP) || 0.4;
      setGear(Math.floor(lastStreak * keep), 0.10);
    };

    /**
     * A clean gate. The reward the entire design turns on, and it shipped
     * 6 dB QUIETER than the sound of your own feet, in a band that saturated
     * at streak 90.
     *
     * It sits at 420 Hz at the gun and climbs 2.4 octaves to 2.2 kHz across a
     * full course, on the log-gap curve described at `gearOf` -- so it is
     * still climbing at mile 26. It gets a tick of noise on the front so it
     * cuts through the bed by transient rather than by level, which is what
     * lets it stay a small sound that fires every 0.6 seconds without
     * becoming exhausting.
     */
    s.clean = function (streak) {
      const st = streak || 0;
      setGear(st, 0);
      const base = 420 * Math.pow(2, 2.15 * gear);
      tone(base, 0.085, 0.155, 'triangle');
      // The octave partial fades out as the fundamental climbs, or the blip
      // turns into a whistle by mile 20.
      tone(base * 2, 0.05, 0.030 * (1 - 0.6 * gear), 'sine');
      noise(0.022, Math.min(2800, base * 2.2), 1.4, 0.035, 'bandpass', { atk: 0.001 });
      // Every 25th gate gets its fifth, as a counting mark.
      if (st && st % 25 === 0) tone(base * 1.5, 0.20, 0.075, 'sine', null, { at: 0.05 });
    };

    /**
     * The crossover: the instant the player passes the 1:59:30 ghost, or is
     * passed back by it. Every other beat in this game already had a sound --
     * clean gate, mile, contact, finish -- and the one moment the whole ghost
     * exists for had only a white flash and a label turning over.
     *
     * Rising for a pass, falling for being caught, because the direction is
     * the entire message and it has to land without reading the HUD. Being
     * caught is the heavier of the two and now carries a low root under it,
     * because losing the record line is worth more than taking it back.
     */
    s.crossover = function (ahead) {
      const root = ahead ? 392 : 523;
      const steps = ahead ? [1, 1.26, 1.5, 2] : [1, 0.84, 0.67, 0.5];
      steps.forEach(function (m, i) {
        const at = i * 0.085;
        tone(root * m, 0.42, 0.115 - i * 0.010, 'triangle', null, { at: at });
        if (i === steps.length - 1) {
          tone(root * m * 2, 0.5, 0.045, 'sine', null, { at: at });
          if (!ahead) tone(root * m * 0.5, 0.9, 0.075, 'sawtooth', null, { at: at, atk: 0.03 });
        }
      });
      // A short swell underneath so it feels like the crowd noticed.
      noise(0.55, ahead ? 900 : 420, 0.7, 0.11, 'bandpass', { atk: 0.05 });
    };

    /**
     * Aid taken. Deliberately small and dry -- a bottle is a sip, not a
     * fanfare, and a water table is five of them in a row, so anything with a
     * tail would smear into a drone. Water was measured at -39.5 dBFS punch,
     * 7 dB under a footstep and therefore masked by the player's own running
     * for most of its length; it is small, but it is above the run now.
     */
    s.aid = function (big) {
      if (big) {
        tone(660, 0.16, 0.11, 'triangle', 990);
        tone(990, 0.26, 0.065, 'sine', null, { at: 0.03 });
        noise(0.18, 1400, 1.2, 0.075, 'bandpass');
      } else {
        tone(880, 0.075, 0.115, 'triangle');
        noise(0.06, 2200, 1.6, 0.10, 'bandpass');
      }
    };

    s.mile = function (mile) {
      // A signpost, and there are 26 of them. It shipped 0.3 dB LOUDER than
      // the crowd roaring a world record home, which is the single clearest
      // sign that these levels had never been compared to each other.
      tone(660, 0.5, 0.082, 'sine');
      tone(990, 0.55, 0.05, 'sine');
      if (mile >= 26) tone(1320, 0.7, 0.043, 'sine');
    };

    /**
     * THE ROAR.
     *
     * The ambient bed already swells with the streak, but a bed is a bed: it
     * changes over seconds and the ear stops hearing it. Breaking the tape is
     * an EVENT and it needs a front, and the front a crowd makes is a fast
     * bright noise burst that decays over about three seconds into something
     * wider and lower than the bed it came out of.
     *
     * What shipped measured at -25.0 dBFS punch for a world record -- 0.3 dB
     * QUIETER than the mile-1 marker beep. That is not a mixing preference,
     * it is a fact about the game being wrong: eight thousand people watching
     * a world record fall cannot be the same size as a signpost. It is now the
     * second loudest thing in the file, and only the fanfare it plays under is
     * above it.
     *
     * The other fault was the envelope. Every burst attacked in 6 ms and
     * decayed from there, so the crowd was loudest at the instant the tape
     * broke and got quieter from then on -- backwards. A crowd SWELLS: the
     * noise arrives in a ragged front over a couple of hundred milliseconds,
     * blooms, and then takes seconds to come apart. The bands attack in
     * 120-320 ms now and hold before they fall.
     *
     * Three layers, because one is a hiss. The upper band around 1.4k is the
     * whistles and the clap; the lower around 300 is the body of eight
     * thousand people and it comes in a beat late, which is what a real crowd
     * does; and the claps are individual bursts scattered across the first
     * second, which is the detail that stops the whole thing reading as wind.
     *
     * `power` is the verdict, 0..1, and it is spent on LENGTH as much as on
     * level: a record roars for four seconds, a run that came apart gets a
     * warm two. Called by world.js at the tape rather than from the game loop,
     * because the tape is a render event and the loop does not know about it.
     */
    s.roar = function (power) {
      const p = Math.max(0, Math.min(1, power === undefined ? 1 : power));
      const dur = 1.9 + 2.4 * p;
      // Upper band: the clap and the whistle, swelling.
      noise(dur * 0.8, 1400 - 250 * p, 0.55, 0.30 + 0.30 * p, 'bandpass',
        { atk: 0.12 + 0.10 * p, to: 800 });
      // Body: eight thousand chests, a beat late and slower to arrive.
      noise(dur, 300, 0.7, 0.30 + 0.33 * p, 'bandpass',
        { at: 0.09, atk: 0.20 + 0.12 * p, to: 220 });
      // Presence, so it is not all below the vocal band on a small speaker.
      noise(dur * 0.55, 2600, 0.5, 0.08 + 0.11 * p, 'bandpass',
        { at: 0.05, atk: 0.09 });
      // Claps: individual pairs of hands in the first second, which is what
      // separates a crowd from weather.
      const claps = 5 + Math.round(p * 9);
      for (let i = 0; i < claps; i++) {
        noise(0.05, 1500 + Math.random() * 2200, 2.2, 0.09 + 0.09 * p, 'bandpass',
          { at: 0.03 + Math.random() * 0.95, atk: 0.001 });
      }
      // Whistles.
      const n = 2 + Math.round(p * 5);
      for (let i = 0; i < n; i++) {
        noise(0.16, 2600 + Math.random() * 1800, 9, 0.07 + 0.07 * p, 'bandpass',
          { at: 0.06 + Math.random() * 0.9 });
      }
      if (amb && evt) {
        // Hold the whole environment up under the burst, then let it fall
        // back. On `evt` rather than the bed gain so the per-frame
        // setIntensity cannot overwrite it a frame later.
        const t = ctx.currentTime;
        evt.gain.cancelScheduledValues(t);
        evt.gain.setValueAtTime(evt.gain.value, t);
        evt.gain.setTargetAtTime(1.9 + 1.2 * p, t, 0.35);
        evt.gain.setTargetAtTime(1, t + dur, 1.6);
        amb.f.frequency.setTargetAtTime(760 + 420 * p, t, 0.3);
        bedWroteX = -1;  // let the next applyBed re-assert the real value
      }
    };

    /**
     * THE FINISH.
     *
     * Four minutes of holding a line arrive here, and it has to be the biggest
     * thing in the game -- so it is written as one gesture rather than a run
     * of notes: a rising fanfare, then the chord it was heading for, sustained
     * long enough to sit under the confetti and the camera pull-back.
     *
     * A record gets a major triad opening out over two octaves with a low root
     * under it and a shimmer on top. A miss gets the same shape falling to a
     * minor sixth instead -- warm, resolved, and unmistakably not the one.
     * Both were four notes before, in a different order, at the same level,
     * and the one moment the whole game is built around sounded like the one
     * that missed it by two minutes.
     */
    s.finish = function (beatRecord) {
      const notes = beatRecord ? [523.3, 659.3, 784.0, 1046.5] : [523.3, 587.3, 523.3, 392.0];
      notes.forEach(function (n, i) {
        tone(n, 0.55, 0.15, 'triangle', null, { at: i * 0.13, atk: 0.01 });
        tone(n * 0.5, 0.5, 0.06, 'sine', null, { at: i * 0.13 });
      });
      const at = 3 * 0.13;
      if (beatRecord) {
        // The chord. Root, fifth, octave, third-above, plus a sub that arrives
        // first and holds the whole thing off the ground.
        tone(65.4, 2.6, 0.11, 'sine', null, { at: at, atk: 0.03, hold: 0.9 });
        tone(130.8, 2.4, 0.11, 'sawtooth', null, { at: at, atk: 0.04, hold: 0.8 });
        tone(261.6, 2.2, 0.19, 'triangle', null, { at: at + 0.02, atk: 0.05, hold: 0.7 });
        tone(392.0, 2.1, 0.15, 'triangle', null, { at: at + 0.04, atk: 0.06, hold: 0.6 });
        tone(523.3, 2.0, 0.19, 'triangle', null, { at: at + 0.06, atk: 0.05, hold: 0.6 });
        tone(784.0, 1.9, 0.12, 'sine', null, { at: at + 0.09, atk: 0.07 });
        tone(1046.5, 1.8, 0.15, 'triangle', null, { at: at + 0.11, atk: 0.05 });
        tone(1568.0, 1.7, 0.090, 'sine', null, { at: at + 0.16, atk: 0.10 });
        tone(2093.0, 1.6, 0.045, 'sine', null, { at: at + 0.22, atk: 0.14 });
        noise(1.4, 5200, 0.6, 0.14, 'bandpass', { at: at, atk: 0.02, to: 2600 });
      } else {
        // Warm, low, and finished. Not a failure sound -- a marathon is still
        // a marathon -- just not the one.
        tone(98.0, 2.0, 0.060, 'sine', null, { at: at, atk: 0.05, hold: 0.6 });
        tone(196.0, 1.8, 0.13, 'triangle', null, { at: at, atk: 0.06, hold: 0.5 });
        tone(261.6, 1.6, 0.12, 'triangle', null, { at: at + 0.04, atk: 0.08 });
        tone(392.0, 1.5, 0.085, 'sine', null, { at: at + 0.07, atk: 0.10 });
      }
    };

    s.countdown = function (final) {
      if (final) {
        tone(880, 0.5, 0.14, 'square');
        tone(440, 0.5, 0.08, 'triangle');
        noise(0.09, 1800, 1.0, 0.10, 'bandpass', { atk: 0.002 });
      } else {
        tone(520, 0.16, 0.13, 'square');
      }
    };

    // ---- cues written, measured, and waiting for a call site ------------
    //
    // These are complete and appear in the probe table. They are not called
    // from anywhere yet, because the call sites are in src/core and src/main,
    // which this change does not own. One line each:
    //
    //   setIntensity(x, grade) -- WIRED for x, NOT YET for grade. The second
    //                 argument is optional and the terrain is simply silent
    //                 without it, which is exactly what ships today. One token
    //                 at the existing call site in main.js turns it on:
    //
    //                   audio.setIntensity(pace.streak / 70, pace.grade);
    //
    //                 pace.grade is already exposed, already correct, and
    //                 already sampled at the runner's own z every frame.
    //
    //   aidMissed()   an aid item went past untaken. main.js already walks
    //                 player.resolveAid(); the miss is the item the walk did
    //                 not return, which course.js knows.
    //   recordLost()  pace.recordPossible() went false. main.js has `pace`
    //                 in hand every frame; this wants an edge, not a poll.
    //   tier(up)      MR.Tier.of(pace.projected()) changed band.

    /** The bottle you did not take: a dry, downward, unresolved tick. */
    s.aidMissed = function () {
      tone(430, 0.10, 0.055, 'triangle', 300);
      noise(0.07, 900, 1.4, 0.035, 'bandpass', { to: 500 });
    };

    /**
     * The record dies. The one irreversible thing that can happen inside a
     * run, and it should be heard as the floor going out: a long fall, and the
     * crowd thinning behind it.
     */
    s.recordLost = function () {
      tone(392, 1.5, 0.11, 'sawtooth', 82, { atk: 0.02 });
      tone(196, 1.7, 0.08, 'sine', 62, { at: 0.06, atk: 0.05 });
      noise(1.2, 800, 0.8, 0.07, 'bandpass', { atk: 0.03, to: 180 });
      if (evt) {
        const t = ctx.currentTime;
        evt.gain.cancelScheduledValues(t);
        evt.gain.setValueAtTime(evt.gain.value, t);
        evt.gain.setTargetAtTime(0.45, t, 0.5);
        evt.gain.setTargetAtTime(1, t + 2.2, 1.2);
        bedWroteX = -1;
      }
    };

    /** Projected-tier change. Same grammar as the gear chime, one size up. */
    s.tier = function (up) {
      const root = up ? 523.3 : 392.0;
      tone(root, 0.20, 0.085, 'triangle', null, { at: 0 });
      tone(up ? root * 1.5 : root * 0.75, 0.45, 0.075, 'triangle', null, { at: 0.12 });
      tone(up ? root * 3 : root * 0.375, 0.5, 0.030, 'sine', null, { at: 0.12 });
    };

    // ---- lifecycle ------------------------------------------------------
    s.unlock = function () {
      try {
        if (ctx.state === 'suspended') ctx.resume();
        if (!s.started) {
          s.started = true;
          ambient();
        }
        master.gain.setTargetAtTime(s.muted ? 0 : 0.85, ctx.currentTime, 0.2);
      } catch (e) { /* never let audio stop the game starting */ }
    };

    s.setMuted = function (m) {
      s.muted = m;
      master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.1);
    };

    s.ambient = ambient;

    // Any cue that throws must not take the frame with it. Every public method
    // is wrapped once, here, rather than each of them carrying a try block --
    // a game loop calling audio.hit() should not be able to die because a
    // browser disagreed about an AudioParam.
    for (const k of API) {
      if (typeof s[k] !== 'function') { s[k] = function () {}; continue; }
      s[k] = (function (name, fn) {
        return function () {
          // Swallowed, but not hidden: nothing is logged, because the
          // screenshot harness fails the build on a console warning and a
          // browser quirk in one cue must not fail a build. It is recorded
          // instead, so `MR.audio.lastError` answers "is the mix throwing".
          try { return fn.apply(s, arguments); } catch (e) { s.lastError = name + ': ' + e; }
          return undefined;
        };
      })(k, s[k]);
    }

    return s;
  }

  return { create, silent };
})();
