/**
 * Boot, game loop, and state machine.
 *
 * URL parameters, all of which exist so the game can be inspected without a
 * human at the keyboard:
 *   ?date=YYYY-MM-DD  run a specific day's course instead of today's
 *   ?bot=1            autopilot that runs a near-perfect line
 *   ?bot=0.9          autopilot that deliberately misses 10% of gates
 *   ?skip=SECONDS     fast-forward this many race seconds before rendering
 *   ?debug=1          FPS and draw-call readout
 *   ?nocount=1        skip the countdown
 *   ?nosave=1         play without writing to the save
 *   ?polish=0         run the character animation with the polish terms off
 *
 * `?polish` is the animation A/B, and it is a scalar rather than a switch so
 * the two versions can also be crossfaded to find where a term stops helping.
 * Every term added by the animation-polish work is scaled by
 * MR.Runner.POLISH, which means ONE build renders both the old cycle and the
 * new one. A checked-in "before" screenshot goes stale the first time
 * something else on the character changes; this cannot.
 */
(function () {
  const K = MR.K;
  const Pace = MR.Pace;

  const params = new URLSearchParams(location.search);
  const dateKey = params.get('date') || MR.rng.dateKey();
  const botParam = params.get('bot');
  const BOT = botParam !== null;
  const BOT_SKILL = BOT ? (botParam === '1' || botParam === '' ? 1 : parseFloat(botParam)) : 0;
  const DEBUG = params.get('debug') === '1';
  const SKIP = parseFloat(params.get('skip') || '0');
  const NOCOUNT = params.get('nocount') === '1' || BOT;
  // Inspecting the game should not be able to overwrite a real player's best.
  const NOSAVE = params.get('nosave') === '1';
  // Guarded, because this reads a knob on another module: absent the polish
  // work the parameter is simply inert rather than a boot failure.
  if (params.has('polish') && MR.Runner && 'POLISH' in MR.Runner) {
    const v = parseFloat(params.get('polish'));
    if (isFinite(v)) MR.Runner.POLISH = Math.max(0, Math.min(1, v));
  }
  // The two mechanics under test. Same shape as ?polish, same reason -- one
  // build renders both courses -- and read BEFORE Course.generate below,
  // because they change what is generated and not only how it is drawn. Both
  // clamp themselves; see the accessors at the foot of course.js.
  if (params.has('narrow')) MR.Course.NARROW = params.get('narrow') || 1;
  if (params.has('ramp')) MR.Course.RAMP = params.get('ramp') || 1;

  // ---- renderer ---------------------------------------------------------
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9fdcff, 90, 235);

  MR.shading.lights(scene);

  const course = MR.Course.generate(dateKey);
  if (!course.valid.ok) console.error('COURSE INVALID', course.valid.errors);

  const world = MR.World.create(course);
  scene.add(world.group);

  // The rideable roofs, as plain placeholder solids. One draw call for the
  // whole course and an empty group when no ramp was generated, so at ?ramp=0
  // -- which is every default run -- this costs nothing at all.
  const ramps = MR.Ramp.create(course);
  scene.add(ramps.group);

  const runner = MR.Runner.create();
  scene.add(runner.group);

  // The 1:59:30 record, on the road rather than in the corner of the screen.
  // It is a pure marker: it reads pace.ghostMiles() and draws it, and nothing
  // below ever asks it a question that could change a race number.
  const ghost = MR.Ghost.create();
  scene.add(ghost.group);

  const cam = MR.Camera.create(window.innerWidth / window.innerHeight);
  const controls = MR.Controls.create(canvas);
  const audio = MR.Audio.create();
  const hud = MR.HUD.create(document.getElementById('ui'));
  hud.setDate(dateKey);
  hud.setCourse(course);
  hud.showPerf(DEBUG);

  // The road profile is the course's, so the camera and the pace model read
  // the same ground the generator proved solvable against.
  const elev = course.elevation || MR.Elevation.FLAT;
  cam.setElevation(elev);
  ghost.setElevation(elev);
  const eProof = elev.validate();
  if (!eProof.ok) console.error('ELEVATION INVALID', eProof.errors);

  const player = MR.Player.create();
  let pace = Pace.create(elev);

  // Collision thresholds must stay honest against the visuals; shout in the
  // console rather than let a retune silently make the game unfair.
  const audit = MR.Collision.audit();
  if (!audit.ok) console.warn('COLLISION AUDIT', audit.notes);

  // ---- state ------------------------------------------------------------
  const IDLE = 0, COUNT = 1, RUN = 2, DONE = 3;
  let state = IDLE;
  let doneAt = 0;      // wall-clock at the tape, for the run-out ease
  let endTimer = 0;    // the held end card; cleared on reset so it cannot
                       // arrive over a run that has already restarted
  let countT = 0;
  let lastStep = 0;
  let mileShown = 0;
  // Edge detectors for the two cues that mark a change of situation rather
  // than an event. Neither has anything else on screen at the moment it
  // happens, which is why they are worth a sound: the record going out of
  // reach is silent today, and so is dropping a rung of the ladder.
  let recordGone = false;
  let tierIdx = -1;
  // WHERE the contacts happened, not just how many. `pace` counts hits and
  // that is all the readout needs while running, but the finish card asks a
  // question a count cannot answer -- which city did this run go wrong in --
  // and answering it means re-running the race with one city's mistakes
  // erased. Gate z is the key because it is stable, unique per gate and is
  // already what every other part of the game indexes a gate by.
  let hitAt = [];

  function reset() {
    clearTimeout(endTimer);
    // Re-read the save before every run, not once at boot: a second run in the
    // same session has to chase the streak the first one just set.
    hud.setMemory(MR.Store.summary(dateKey));
    hud.reset();
    pace = Pace.create(elev);
    player.reset();
    world.reset();
    cam.reset();
    controls.clear();
    mileShown = 0;
    lastStep = 0;
    recordGone = false;
    tierIdx = -1;
    hitAt = [];
    runner.phase = 0;
    ghost.reset();
    hud.hideEnd();
    world.update(0);
  }

  function begin() {
    reset();
    audio.unlock();
    hud.showStart(false);
    if (NOCOUNT) { state = RUN; hud.countdown(null); }
    else { state = COUNT; countT = 0; }
  }

  hud.onStart(begin);
  hud.onAgain(begin);
  controls.onAny = () => audio.unlock();

  // ---- autopilot --------------------------------------------------------
  // Plays the course by reading the same gate data the renderer draws, so it
  // exercises the real systems rather than a parallel simulation.
  const bot = {
    gate: 0,
    plannedLane: 1,
    planned: false,
    acted: false,
    seen: 0,
  };

  function botThink() {
    // Advance past gates already resolved.
    while (bot.gate < course.gates.length && course.gates[bot.gate].z < pace.units - 1) {
      bot.gate++; bot.planned = false; bot.acted = false;
    }
    const g = course.gates[bot.gate];
    if (!g) return;

    const dist = g.z - pace.units;
    const speed = pace.speed();

    if (!bot.planned && dist < 46) {
      bot.planned = true;
      bot.seen++;
      // Deliberate miss, for exercising the failure paths.
      const miss = BOT_SKILL < 1 && (bot.seen % Math.max(2, Math.round(1 / (1 - BOT_SKILL))) === 0);

      // Prefer staying put, then the nearest lane; CLEAR beats an action; and
      // a lane carrying aid beats the same lane without it.
      //
      // The aid term is not decoration. Aid is deliberately placed in the
      // hardest legal lane and half the pool is placed to rescue a broken run,
      // so it is the mechanic that decides how forgiving this game is -- and
      // until now no automated run had ever collected a single item. A
      // 16-contact bot run took 0 of 14, which meant the comeback path was
      // measured only by tools/simulate.js modelling it, never by the game
      // playing it. A verification harness that cannot exercise a mechanic is
      // not verifying that mechanic.
      //
      // Aid is taken on lane match alone (player.resolveAid), so wanting an
      // item means being in its lane when z passes it. The lane commit below
      // fires at 34 units out, comfortably before any item between here and
      // the gate.
      const order = [player.lane, player.lane - 1, player.lane + 1, 0, 1, 2]
        .filter((l, i, a) => l >= 0 && l <= 2 && a.indexOf(l) === i);
      // Items still ahead of the runner and no further than this gate.
      const wants = [];
      for (const it of (course.aid || [])) {
        if (it.z <= pace.units) continue;
        if (it.z > g.z) break;
        wants.push(it.lane);
      }
      let best = null, bestScore = -Infinity;
      order.forEach(function (l, i) {
        // A RIDEABLE BLOCK IS NOT A WALL TO THIS BOT. `gate.ramp` names the
        // lane whose roof is a running surface, and a harness that cannot
        // exercise a mechanic is not verifying that mechanic -- which is
        // precisely why the aid term below exists, after a 16-contact bot run
        // collected 0 of 14 items and nobody noticed for a month.
        if (g.lanes[l] === K.BLOCK && g.ramp !== l) return;
        // Order position is the existing tie-break, kept intact: a lane earlier
        // in `order` wins whenever nothing else separates two candidates.
        let score = (g.lanes[l] === K.CLEAR ? 100 : 0) - i;
        // Aid outranks a clear lane, deliberately. The bot handles JUMP and
        // DUCK reliably -- the timing below is derived from the arc, not
        // hand-tuned -- so detouring through an item costs an action it could
        // have avoided and not a contact. Verified: bot=1 still finishes with
        // 0 hits. If that ever stops being true, this is the term to lower,
        // because a bot that breaks its streak fetching a bottle is measuring
        // the wrong thing.
        if (wants.indexOf(l) >= 0) score += 150;
        // Take the ramp when there is one, so every automated run that has one
        // available rides it and the frames, the finish times and the fairness
        // audit are all measured with the mechanic switched on rather than
        // routed around. This outranks aid deliberately: the question this pass
        // is asking is what the roof costs, and a bot that prefers a bottle
        // would answer a different one.
        if (g.ramp === l) score += 220;
        if (score > bestScore) { bestScore = score; best = l; }
      });
      if (best === null) best = player.lane;
      if (miss) {
        const bad = [0, 1, 2].find((l) => g.lanes[l] === K.BLOCK);
        bot.plannedLane = bad !== undefined ? bad : best;
      } else {
        bot.plannedLane = best;
      }
      bot.acted = false;
    }

    // Lane change: commit early so the move has settled by the gate.
    // ...but never off a roof. Leaving a rideable train sideways is a fall and
    // costs the streak (player.resolveDeck), so the commitment the mechanic
    // asks of a human is one the bot has to make too -- otherwise the harness
    // would measure a version of the ramp that has no downside.
    //
    // ---- AND NEVER SIDEWAYS INTO SOMETHING THAT IS STANDING THERE ---------
    //
    // The bot plans off the gate table, which is exactly what solvable()
    // proves, and until flanks became solid that was the whole of what a lane
    // meant. It is not any more: a BLOCK train is one gate carrying up to 17.9
    // units of vehicle, and this bot steers 26 units past a gate line towards
    // one 34 units ahead -- straight through the flank of the lorry the gate
    // it has already passed left standing in the lane. Measured over four
    // races with the flank solid and this line as it was: 137 contacts, and a
    // finish of 2:08:47 against 1:57:55. Every frame this project photographs
    // is bot-driven, so a bot that drives into lorries does not merely score
    // badly, it makes the whole shot library a picture of a broken run.
    //
    // The fix is not to give the lane up -- validate() guarantees the room to
    // wait (see its LANE_TRANSIT clause) -- it is to WAIT. The plan is
    // unchanged; only the step is held, and only while something is actually
    // in the lane being stepped into. A rideable train is not something to
    // wait for, it is the destination. With this, the same four races take 0
    // contacts and finish at 1:57:55, which is the number before flanks were
    // solid: reading the road costs nothing.
    if (bot.planned && player.lane !== bot.plannedLane && dist < 34
        && player.laneT >= 0.55 && !player.ramp) {
      const next = player.lane + (player.lane < bot.plannedLane ? 1 : -1);
      // A point test would be exact -- every span starts at a gate line, and
      // the bot is always past that line when it steers for the next gate -- so
      // the extra unit is float slack, and it is the same slack the same
      // decision uses in tools/mechanics.js so the tool and the game are one
      // model rather than two.
      const solid = course.occupiedAt
        ? (course.occupiedAt(pace.units, next) || course.occupiedAt(pace.units + 1, next))
        : null;
      if (!solid || (solid.ride && next === bot.plannedLane)) {
        controls.push(player.lane < bot.plannedLane ? 'right' : 'left');
      }
    }

    // Action timing, derived from the arc rather than hand-tuned: aim to be
    // comfortably inside the clear window when z crosses the gate.
    if (bot.planned && !bot.acted && player.lane === bot.plannedLane) {
      const kind = g.lanes[bot.plannedLane];
      const miss = BOT_SKILL < 1 && (bot.seen % Math.max(2, Math.round(1 / (1 - BOT_SKILL))) === 0);
      if (!miss) {
        if (kind === K.JUMP && dist < speed * 0.30) { controls.push('jump'); bot.acted = true; }
        else if (kind === K.DUCK && dist < speed * 0.16) { controls.push('duck'); bot.acted = true; }
      }
    }
  }

  // ---- loop -------------------------------------------------------------
  let last = performance.now();
  let fps = 60, fpsAcc = 0, fpsN = 0;
  let lastFlash = 0;   // edge-detect the ghost crossover for its audio cue

  function frame(now) {
    requestAnimationFrame(frame);

    let dt = (now - last) / 1000;
    last = now;
    const raw = Math.max(0, dt);   // true wall time, before the clamp below
    // Clamp so an alt-tab or a GC pause cannot teleport the runner through a
    // gate; better to lose a little race time than to skip collision.
    //
    // The lower bound is not defensive padding: on a slow boot the first rAF
    // timestamp can predate `last`, giving a NEGATIVE dt. That ran the whole
    // simulation backwards for a frame -- the race clock opened at -0.75s and
    // -0.0023 miles, and the camera springs integrated in reverse and threw
    // the view sideways. Time in this game only ever moves forward.
    dt = Math.max(0, Math.min(dt, 1 / 25));

    // Accumulate RAW wall time, never the clamped dt. Using the clamped value
    // made this counter mathematically incapable of reading below 25: once a
    // frame ran longer than the 1/25 clamp, every frame contributed exactly
    // 0.04 and fpsN/fpsAcc pinned at 25 however bad it really was. It reported
    // "27fps" on frames that were genuinely far slower, and reported 60 when a
    // short sampling window happened to catch only fast frames -- which sent a
    // performance investigation chasing biomes that were never the variable.
    fpsAcc += raw; fpsN++;
    if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

    controls.tick(dt);

    if (state === COUNT) {
      const prev = Math.ceil(3 - countT);
      countT += dt;
      const c = Math.ceil(3 - countT);
      if (c !== prev && c > 0) audio.countdown(false);
      if (countT >= 3) {
        hud.countdown(null);
        audio.countdown(true);
        state = RUN;
      } else {
        hud.countdown(String(Math.max(1, c)));
      }
    }

    if (state === RUN) {
      if (BOT) botThink();
      player.handle(controls);

      const before = pace.units;
      pace.update(dt);
      const after = pace.units;

      player.update(dt, after - before);

      // The second running surface, BEFORE the gates. Order is load-bearing:
      // the ramp's own gate line sits at the foot of its tailgate, so the mount
      // has to be established on the same step the gate resolves or the game
      // records the runner colliding with the lorry he is running up.
      const deck = player.resolveDeck(course, before, after);
      if (deck && deck.hit) {
        pace.onHit();
        hitAt.push(deck.z);
        cam.impact(1);
        hud.flashBroken();
      }

      // Resolve gates crossed this step.
      const results = player.resolveGates(course, before, after);
      for (const r of results) {
        if (r.clean) {
          pace.onClean();
          audio.clean(pace.streak);
        } else {
          pace.onHit();
          hitAt.push(r.gate.z);
          cam.impact(1);
          hud.flashBroken();
        }
      }

      // Aid taken this step. Streak only -- pace still has one source.
      //
      // resolveAid walks the index past every item the runner drew level with
      // and returns only the ones whose lane matched, so the difference is the
      // count that went by untaken. That is the one event in the run which is
      // pure loss and has nothing to mark it: no contact, no flash, the streak
      // simply fails to go up. Hence a sound and nothing else -- a toast here
      // would be scolding, and the readout is being cut, not grown.
      const aidIdxBefore = player.aidIdx;
      let aidTaken = 0;
      for (const item of player.resolveAid(course, before, after)) {
        pace.onAid(item.gain);
        audio.aid(item.kind === 'banana');
        aidTaken++;
        if (item.kind === 'banana') hud.toastAid('FUEL', '+' + item.gain + ' STREAK');
      }
      if (player.aidIdx - aidIdxBefore > aidTaken) audio.aidMissed();

      // Player events -> audio.
      for (const e of player.drainEvents()) {
        if (e === 'bounce') cam.impact(1.35);
        else if (e === 'trip') cam.impact(0.55);
        else if (e === 'jump') audio.jump();
        else if (e === 'land') { audio.land(); cam.land(); }
        else if (e === 'duck') audio.duck();
        else if (e === 'hit') audio.hit();
      }

      // Footsteps locked to the run cycle, not to a timer.
      if (!player.airborne) {
        const ph = runner.phase;
        if (ph < lastStep) audio.footstep(1);
        else if (lastStep < 0.5 && ph >= 0.5) audio.footstep(0.85);
        lastStep = ph;
      }

      // Mile splits.
      if (pace.splits.length > mileShown) {
        const sp = pace.splits[pace.splits.length - 1];
        mileShown = pace.splits.length;
        const d = sp.time - sp.mile * K.RECORD_PACE;
        hud.toast(`MILE ${sp.mile}`, `${Pace.clock(sp.time)}  ·  ${Pace.delta(d)} vs record`);
        audio.mile(sp.mile);
      }

      // Unclamped, deliberately. The old min(1, ...) saturated at streak 70 on
      // a course of 205 gates, so the mix stopped responding around mile 11 of
      // 26 -- the same defect the audio probe found in clean(), which had gone
      // flat at streak 90. audio.setIntensity reads a value above 1.0 as the
      // raw streak/70 and keeps climbing.
      // The second argument is the road's grade, and without it the terrain
      // layer of the mix is silent -- the hills are audible only through
      // cadence, which falls out of a grade-inclusive speed for free.
      audio.setIntensity(pace.streak / 70, pace.grade);

      // The record slipping out of reach, and the ladder moving under you.
      // Both are changes of situation rather than events, both are currently
      // silent, and both are edges -- fired once at the crossing, never held.
      if (!recordGone && !pace.recordPossible()) { recordGone = true; audio.recordLost(); }
      const tNow = MR.Tier.of(pace.projected()).i;
      if (tierIdx >= 0 && tNow !== tierIdx) audio.tier(tNow < tierIdx);
      tierIdx = tNow;

      if (pace.finished) {
        state = DONE;
        doneAt = performance.now();
        // Fold the result into the save FIRST, because the only moment at
        // which "did this beat your best today" can be answered is before the
        // best today becomes this run. Store.record returns that comparison
        // and never throws, so a browser with no usable localStorage produces
        // the same finish screen minus the memory.
        const saved = NOSAVE ? null : MR.Store.record(dateKey, {
          time: pace.finishTime,
          streak: pace.bestStreak,
          tier: MR.Tier.of(pace.finishTime).name,
        });
        // HOLD THE CARD. The tape breaks, the confetti fires, the crowd
        // roars and the camera pulls up into its hero shot -- and all of that
        // used to play behind a full-screen results panel that appeared on the
        // very same frame. The ending was being built and then covered up.
        //
        // 2.6s is the length of the flourish the world and camera play out
        // (tape swing 1.8s, confetti fall, camera settle), so the card arrives
        // as the celebration lands rather than instead of it.
        audio.finish(pace.finishTime < K.RECORD_SECONDS);
        clearTimeout(endTimer);
        // hitAt is copied rather than handed over: `reset()` empties this array
        // for the next run, and the card is still on screen when RUN IT AGAIN
        // is pressed.
        const where = hitAt.slice();
        endTimer = setTimeout(function () { hud.showEnd(pace, saved, where); }, 2600);
      }
    }

    // ---- present --------------------------------------------------------
    world.update(pace.units, player.lane);
    if (world.fogColor) {
      scene.fog.color.copy(world.fogColor);
      renderer.setClearColor(world.fogColor);
    }

    // Past the tape the race clock stops but pace.speed() does not, so the
    // runner kept sprinting on the spot through the entire celebration. Ease
    // the cadence out instead of cutting it: a runner who crosses a line
    // decelerates, and a stride that halts on one frame reads as a freeze.
    const strideSpeed = state === DONE
      ? pace.speed() * Math.max(0, 1 - (performance.now() - doneAt) / 2200)
      : pace.speed();

    // The grade at the runner, -1..1 against the steepest legal one. It only
    // pitches the trunk; the stride slows on the climb and quickens on the
    // descent for free, because cadence already falls out of `speed`.
    const grade = elev.gradeNorm(pace.units);

    runner.update(dt, {
      speed: strideSpeed,
      grade,
      air01: player.airborne ? Math.sin(Math.min(1, player.airT) * Math.PI) : 0,
      duck01: player.duck01,
      trip: player.tripT,
      bounce: player.bounce,
      lean: player.lean,
      stumble: player.stumble,
    });
    // ELEVATION IS ADDED HERE AND NOWHERE UPSTREAM. `player.y` is, and stays,
    // the height above the LOCAL road surface -- which is what lets
    // collision.js keep testing y >= 0.84 and duck01 >= 0.90 against a flat
    // zero, and is the single finding the whole hill feature rests on.
    // ...and `player.surface` is added in the same breath and for the same
    // reason: it is the height of the GROUND under the runner, which on a
    // rideable roof is 2.80 and everywhere else is zero. player.y stays height
    // above whatever he is standing on, so collision.js keeps testing against a
    // flat zero on a hill AND on a lorry.
    runner.group.position.set(player.x,
      player.y + player.surface + elev.at(pace.units), pace.units);

    cam.update(dt, {
      z: pace.units, x: player.x, y: player.y, surface: player.surface,
      speed: pace.speed(),
      // The flat speed, for the top-gear latch alone. A descent must not fire
      // the gear flourish or the permanent rumble: speed you did not earn is
      // not another gear. See camera.js's header.
      gearSpeed: pace.streakSpeed(),
      lean: player.lean, duck01: player.duck01,
    });

    // After the camera, never before: the ghost's tag is placed against this
    // frame's lens (position, fov, aspect), and a frame of lag there shows up
    // as the tag swimming during a lane change.
    ghost.update(dt, { pace, camera: cam.camera, playerX: player.x });

    // The crossover is the moment the whole ghost exists for, so it gets a
    // sound like every other beat in the race. Ghost owns the detection (it
    // fires on the sign change, not on a distance threshold); this only
    // watches the flash going from cold to hot and reads the direction off
    // the gap it just crossed.
    if (state === RUN && ghost.flash > 0.85 && lastFlash <= 0.85) {
      audio.crossover(ghost.gap <= 0);
    }
    lastFlash = ghost.flash;

    hud.update(pace, DEBUG ? { fps, draws: renderer.info.render.calls } : null);
    renderer.render(scene, cam.camera);
  }

  // ---- resize -----------------------------------------------------------
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    cam.resize(w / h);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  // ---- expose for automated inspection ----------------------------------
  // Screenshot and critic tooling drives the real game through this rather
  // than a stub, so anything it reports is true of the shipped build.
  MR.game = {
    get state() { return state; },
    get pace() { return pace; },
    get player() { return player; },
    // Where this run made contact, in gate z. The finish card's chapter line
    // is computed from it, and a list that silently disagreed with pace.hits
    // would put a wrong city on the card with nothing to catch it -- so the
    // harness is given the same array the card is given.
    get hitAt() { return hitAt; },
    course, world, runner, ghost, cam, hud, audio, renderer, scene,
    begin,
    fps: () => fps,
    ready: false,
  };

  reset();
  world.update(0);

  if (SKIP > 0) {
    // Advance the simulation without rendering, so a screenshot can be taken
    // deep into the race instead of always at the start line.
    begin();
    state = RUN;
    const step = 1 / 60;
    for (let t = 0; t < SKIP; t += step) {
      if (BOT) botThink();
      player.handle(controls);
      controls.tick(step);
      const b = pace.units;
      pace.update(step);
      player.update(step, pace.units - b);
      // Same order as the live loop, and for the same reason. A fast-forward
      // that skipped this would photograph the runner standing in mid-air where
      // a roof should be, or record a mount as a collision.
      const fd = player.resolveDeck(course, b, pace.units);
      if (fd && fd.hit) { pace.onHit(); hitAt.push(fd.z); }
      for (const r of player.resolveGates(course, b, pace.units)) {
        // Recorded here as well as in the live loop. This fast-forward exists
        // so tooling can photograph the game deep into a race, and a debug
        // path that quietly drops a fact the finish card is computed from
        // would make the card lie on exactly the runs the harness inspects.
        if (r.clean) pace.onClean(); else { pace.onHit(); hitAt.push(r.gate.z); }
      }
      player.drainEvents();
      if (pace.finished) break;
    }
    world.update(pace.units, player.lane);
  } else if (BOT) {
    begin();
  }

  MR.game.ready = true;
  requestAnimationFrame(frame);
})();
