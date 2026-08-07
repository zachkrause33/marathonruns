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

  const player = MR.Player.create();
  let pace = Pace.create();

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

  function reset() {
    clearTimeout(endTimer);
    // Re-read the save before every run, not once at boot: a second run in the
    // same session has to chase the streak the first one just set.
    hud.setMemory(MR.Store.summary(dateKey));
    hud.reset();
    pace = Pace.create();
    player.reset();
    world.reset();
    cam.reset();
    controls.clear();
    mileShown = 0;
    lastStep = 0;
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

      // Prefer staying put, then the nearest lane; CLEAR beats an action.
      const order = [player.lane, player.lane - 1, player.lane + 1, 0, 1, 2]
        .filter((l, i, a) => l >= 0 && l <= 2 && a.indexOf(l) === i);
      let best = null;
      for (const l of order) {
        if (g.lanes[l] === K.BLOCK) continue;
        if (best === null) best = l;
        if (g.lanes[l] === K.CLEAR) { best = l; break; }
      }
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
    if (bot.planned && player.lane !== bot.plannedLane && dist < 34 && player.laneT >= 0.55) {
      controls.push(player.lane < bot.plannedLane ? 'right' : 'left');
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

      // Resolve gates crossed this step.
      const results = player.resolveGates(course, before, after);
      for (const r of results) {
        if (r.clean) {
          pace.onClean();
          audio.clean(pace.streak);
        } else {
          pace.onHit();
          cam.impact(1);
          hud.flashBroken();
        }
      }

      // Aid taken this step. Streak only -- pace still has one source.
      for (const item of player.resolveAid(course, before, after)) {
        pace.onAid(item.gain);
        audio.aid(item.kind === 'banana');
        if (item.kind === 'banana') hud.toastAid('FUEL', '+' + item.gain + ' STREAK');
      }

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

      audio.setIntensity(Math.min(1, pace.streak / 70));

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
        endTimer = setTimeout(function () { hud.showEnd(pace, saved); }, 2600);
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

    runner.update(dt, {
      speed: strideSpeed,
      air01: player.airborne ? Math.sin(Math.min(1, player.airT) * Math.PI) : 0,
      duck01: player.duck01,
      trip: player.tripT,
      bounce: player.bounce,
      lean: player.lean,
      stumble: player.stumble,
    });
    runner.group.position.set(player.x, player.y, pace.units);

    cam.update(dt, {
      z: pace.units, x: player.x, y: player.y,
      speed: pace.speed(), lean: player.lean, duck01: player.duck01,
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
      for (const r of player.resolveGates(course, b, pace.units)) {
        if (r.clean) pace.onClean(); else pace.onHit();
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
