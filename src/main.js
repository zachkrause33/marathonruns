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
 *   ?nosave=1         play without the save: reads nothing, writes nothing,
 *                     and the record-broken daily lockout never engages
 *   ?polish=0         run the character animation with the polish terms off
 *   ?effort=0         the game before the pool, the guard and the surge zones
 *   ?surge=POLICY     which zones the autopilot elects: all (default), none,
 *                     hold1, hold2, late, every2. Named to match the policies
 *                     tools/simulate.js sweeps, so the game and the sweep are
 *                     one model. Inert without ?bot=.
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
  // ...and the two from roadmap 68, on the same contract. ?tempo=0 takes the
  // directional mats off the road and ?roof=0 takes the cones and the paired
  // decks off the vehicles; at zero neither draws from a seeded stream, so the
  // course is the one the generator built before either existed. A flag that
  // cannot be reached from a URL is a flag nobody will ever A/B.
  if (params.has('tempo')) MR.Course.TEMPO = params.get('tempo') || 1;
  if (params.has('roof')) MR.Course.ROOF = params.get('roof') || 1;
  // ...and the third, which is the biggest of them. ?effort=0 returns the game
  // exactly as it was before the pool, the guard and the surge zones existed:
  // no zones are planned, no stream is drawn, the pace floor goes back to 4:14
  // and the course is BIT-IDENTICAL. Read here, before Course.generate, for
  // the same reason the other two are -- course.js asks MR.Pace.EFFORT whether
  // to plan zones at all, so this line decides what road gets built.
  if (params.has('effort')) MR.Pace.EFFORT = params.get('effort') || 1;
  const EFFORT = MR.Pace.EFFORT > 0;
  // ?joy=0..1 forces the finish verdict the celebration pose blends on. Same
  // shape and same reason as ?polish: ONE build photographs both ends of the
  // gesture, and the losing version does not need a deliberately broken run to
  // be looked at -- which is exactly how a losing-run animation goes unchecked.
  // Null means "read it off the result", which is every real game.
  const JOY = params.has('joy') ? parseFloat(params.get('joy')) : null;
  const JOY_FORCED = JOY !== null && isFinite(JOY);

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

  // The rideable roofs used to be a separate placeholder solid added here.
  // They are not a separate object any more: a rideable train is BLOCK v0 with
  // its tail open, built and cast by world.js, so it arrives with the world
  // above and costs nothing extra to place.

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
  const IDLE = 0, COUNT = 1, RUN = 2, DONE = 3, PAUSED = 4;
  let state = IDLE;
  // Whether the countdown now running is a RESUME rather than the start of a
  // race. The two are the same three seconds and the same sound deliberately --
  // this game already owns a countdown and a second one would be a second
  // thing to learn -- but they end differently: a start releases the runner off
  // the line, a resume takes the pause panel down.
  let resuming = false;
  let btnShown = false;   // edge detector for the pause button; see the loop
  let doneAt = 0;      // wall-clock at the tape, for the run-out ease
  let endTimer = 0;    // the held end card; cleared on reset so it cannot
                       // arrive over a run that has already restarted
  let showCard = null; // ...and the same card, callable early on any input
  let celClock = 0;    // seconds since the tape -- see the celebration below
  let countT = 0;
  let lastStep = 0;
  let mileShown = 0;
  // Edge detectors for the two cues that mark a change of situation rather
  // than an event. Neither has anything else on screen at the moment it
  // happens, which is why they are worth a sound: the record going out of
  // reach is silent today, and so is dropping a rung of the ladder.
  let recordGone = false;
  let tierIdx = -1;
  // Whether the "you just ran past a bottle that would have helped" cue has
  // already spoken this run. See the block that sets it for why it is an edge
  // and not a per-item reaction.
  let aidNagged = false;
  // TANK FULL is told once per full episode, not once per wasted coin.
  let tankToldOf = false;
  // ---- WHAT HIS BODY SAYS ABOUT THE RUN HE JUST FINISHED ------------------
  //
  // One number, 0..1, because the finish pose is one blend between two ends of
  // the same gesture -- see the celebration block in runner.js. The camera move
  // is IDENTICAL at every value of it, and that is the design rather than an
  // economy: most runs are not record runs, and a celebration only the best
  // players ever see is a celebration most players never see. Finishing a
  // marathon is the accomplishment; the verdict changes what he DOES, not
  // whether the game turns round and looks at him.
  //
  //   1.00  the record went. Both arms up, head back, a roar.
  //   0.85  an all-time best.
  //   0.70  a personal best today.
  //   else  where the run landed on the ladder, top rung 0.60 down to 0.
  //
  // At 0 it is the spent finisher: hands to the head, shoulders down, eyes
  // squeezed shut and a mouth gasping. Which is also a celebration -- it is
  // what the last third of a real finish line looks like.
  let finishJoy = 0;
  // WHERE the contacts happened, not just how many. `pace` counts hits and
  // that is all the readout needs while running, but the finish card asks a
  // question a count cannot answer -- which city did this run go wrong in --
  // and answering it means re-running the race with one city's mistakes
  // erased. Gate z is the key because it is stable, unique per gate and is
  // already what every other part of the game indexes a gate by.
  let hitAt = [];

  // ---- THE STANDING START -------------------------------------------------
  //
  // The owner: "Before the game starts and it counts down from 3-2-1 the player
  // is running in place. That's not realistic. Make it so he is standing still
  // and then starts running when the time goes off."
  //
  // ONE clock, 1 at the line and 0 in full stride, and it drives THREE things
  // that arrive at different rates. That split is the whole of the transition,
  // because a single crossfade from a held pose to a running one is a dissolve
  // and what this moment wants is an event.
  //
  //   THE POSE, over the full LAUNCH. runner.js blends its standing pose out
  //     against the cycle, smoothstepped so it leaves the line and reaches full
  //     stride with no corner at either end.
  //   THE STRIDE, over LAUNCH_SPEED, which is less than half as long. The ground
  //     speed handed to the runner and the camera is this clock, not the pace
  //     model's: cadence in runner.js is a power of speed, so zero speed FREEZES
  //     the stride phase instead of turning it over under a motionless body, and
  //     the phase then opens from a standstill rather than resuming wherever the
  //     countdown left it. The legs come up to rate faster than the body comes
  //     out of the pose, which is what an acceleration looks like and is also
  //     the honest order: a runner's legs go first.
  //   THE DRIVE, free. runner.js and camera.js both carry a surge signal -- a
  //     smoothed derivative of ground speed -- and in this game's whole life
  //     neither had ever seen a step, because pace only ever eases. A start
  //     hands both of them 0 to 21.8 u/s. They saturate, and lean, hip
  //     extension, knee drive, toe-off and the camera's own trail-back all come
  //     up to full and decay over about a second and a half, on constants that
  //     were measured for exactly this and never had a moment to fire in.
  //
  // WHAT IT COSTS, stated rather than hidden: pace.js starts the race at
  // START_PACE on the frame the gun goes, so for the length of LAUNCH_SPEED the
  // world is moving faster than the legs are turning over and the feet skate.
  // That is a consequence of the pace model, not of this ramp -- there is no
  // value of these two constants that makes a runner who is stationary at t=0
  // and travelling at 21.8 u/s at t=0 not skate. LAUNCH_SPEED is short for that
  // reason and no other.
  let standT = 1;
  const LAUNCH = 0.72;        // seconds for the pose to leave the line
  const LAUNCH_SPEED = 0.34;  // ...and for the stride to reach full rate

  // ---- THE DAILY LOCKOUT --------------------------------------------------
  //
  // The owner: "You can play the game as many times as you want until you
  // break the record. After that you wait until the next day." So retries stay
  // unlimited on every other day, and the one thing that closes today is
  // 1:59:30 falling on it -- recorded by the store as the date row's `rec`
  // latch, which is keyed by the SAME dateKey that seeds the course, so the
  // lockout and the road roll over on the same UTC midnight by construction.
  //
  // Bypassed for every automated boot, not just for ?nosave=: nosave reads and
  // writes nothing (so the gate suite can never see a locked page), and ?bot=
  // drives pages the harnesses own -- a bot that broke the record and then
  // locked the harness out of the course it was measuring would take the whole
  // suite with it on its best run.
  // ?skip= is in the list for the same reason: it is a harness door (it force
  // -starts a race below begin()'s guard), and a skipped race on a locked page
  // would be a tool measuring a panel instead of a run.
  const LOCKOUT = !NOSAVE && !BOT && !(SKIP > 0);
  let locked = false;

  /**
   * Re-read the save and redraw everything that hangs off it: the memory
   * plates, the history tab, and whether today's start button still exists.
   * Under ?nosave= this passes null everywhere -- reads nothing, shows
   * nothing, locks nothing.
   */
  function refreshDaily() {
    const sum = NOSAVE ? null : MR.Store.summary(dateKey);
    hud.setMemory(sum);
    hud.setHistory(sum);
    locked = !!(LOCKOUT && sum && sum.done);
    hud.setLocked(locked ? { time: sum.doneTime, dateKey: dateKey } : null);
  }

  function reset() {
    clearTimeout(endTimer);
    showCard = null;
    // Re-read the save before every run, not once at boot: a second run in the
    // same session has to chase the streak the first one just set.
    refreshDaily();
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
    aidNagged = false;
    tankToldOf = false;
    finishJoy = 0;
    celClock = 0;
    hitAt = [];
    runner.phase = 0;
    standT = 1;
    resuming = false;
    controls.enabled = true;
    ghost.reset();
    hud.hideEnd();
    hud.showPause(false);
    btnShown = false;
    hud.showPauseBtn(false);
    hud.celebrate(false);
    audio.setPaused(false);
    world.update(0);
  }

  function begin() {
    // Today is won and closed. Every path that starts a run funnels through
    // here -- the start button, RUN IT AGAIN, RESTART THIS RUN -- so this is
    // the one door the lockout has to hold. It routes back to the start
    // panel, which is showing the completed state rather than a button.
    if (locked) { hud.hideEnd(); hud.showStart(true); return; }
    reset();
    audio.unlock();
    hud.showStart(false);
    // No countdown means no start line: ?bot= and ?nocount= exist so a harness
    // can enter the race directly, and a harness that entered it standing still
    // would photograph and measure a launch instead of a run. Every tool in this
    // project drives the game through one of those two, so releasing the clock
    // here is what keeps the standing start out of every number they report.
    if (NOCOUNT) { state = RUN; standT = 0; hud.countdown(null); }
    else { state = COUNT; countT = 0; }
  }

  // ---- PAUSE, AND WHAT IT IS NOT ALLOWED TO BE ----------------------------
  //
  // The owner asked for a pause button. This game is a daily time attack on a
  // deterministic date-seeded course against a 1:59:30 ghost, and one contact
  // ends a record attempt -- so the resource every decision in it spends is
  // TIME TO READ THE ROAD, and a naive pause hands that resource out for free:
  // stop on the frame a gate resolves into three lanes, study it for as long as
  // you like, resume with the answer. Three things close that, and they are
  // three because no one of them closes it alone.
  //
  //   THE PANEL IS OPAQUE. #pausePanel is a solid fill where the other two
  //     panels are 0.9 -- see its note in style.css. You cannot study a frame
  //     you cannot see, and this is the only one of the three that removes the
  //     information rather than the time to use it.
  //   THE RESUME COUNTDOWN RUNS BEHIND IT. Reusing the start's 3-2-1 was the
  //     obvious move and it is the wrong one done the obvious way: a countdown
  //     over a revealed, frozen world IS three more seconds of free look, and a
  //     bigger gift than the pause itself. So the panel stays up for the whole
  //     of it and the world reappears on the same frame it starts moving.
  //   NO INPUT IS BUFFERED ACROSS IT. controls.enabled is false from the moment
  //     the game is paused until the gun, and controls.js drops rather than
  //     queues while it is false. A player who worked out the answer on a still
  //     frame cannot pre-load the swipe; they have to see the road again first.
  //
  // WHAT IS LEFT, because it is worth stating and not worth hiding: a player
  // can still THINK about a frame they had already been shown for as long as
  // they like. Taking that back needs the race to resume some distance behind
  // where it stopped, and a rewind means unwinding pace.units, player.gateIdx
  // and player.aidIdx together or double-counting a gate -- which is a change to
  // the scoring path, and this is not a pass that should be touching the
  // scoring path. It is on the roadmap.
  function pause() {
    if (state !== RUN) return;
    state = PAUSED;
    controls.enabled = false;
    controls.clear();
    btnShown = false;
    hud.showPauseBtn(false);
    hud.showPause(true, pace);
    audio.setPaused(true);
  }

  function resume() {
    if (state !== PAUSED) return;
    state = COUNT;
    countT = 0;
    resuming = true;
    // The bed comes back over the countdown rather than on the frame the panel
    // lifts. It carries no information about the road -- it is crowd and air,
    // gated on the streak, which has not moved -- and a race that resumes in
    // silence and then snaps to full level reads as an audio fault.
    audio.setPaused(false);
  }

  hud.onStart(begin);
  hud.onAgain(begin);
  hud.onPause(pause);
  hud.onResume(resume);
  hud.onRestart(begin);
  // Escape and P, from controls.js, which keeps them out of the buffered verbs
  // for the reasons in its own note. One key, both directions.
  controls.onPause = function () {
    if (state === RUN) pause();
    else if (state === PAUSED) resume();
  };
  // A tab going into the background already froze this game, because rAF stops
  // -- but it froze it SILENTLY and mid-gate, and handed the player the road
  // back with no warning and whatever was left of their reaction time. Routing
  // it through the same pause closes that: they come back to a panel and a
  // countdown. Guarded on BOT because every automated run in this project drives
  // a page a harness owns, and a harness that ever reported itself hidden would
  // pause the run it is measuring.
  document.addEventListener('visibilitychange', function () {
    if (!BOT && document.visibilityState === 'hidden' && state === RUN) pause();
  });
  // Any input during the celebration ends the hold and brings the card up now.
  // The alternative to this is a player who has seen the ending once being made
  // to sit through it on every subsequent run, which is how a celebration
  // becomes a cutscene -- see the note on the 4.9s hold below.
  controls.onAny = () => {
    audio.unlock();
    if (state === DONE && showCard) showCard();
  };

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

  /**
   * ---- THE AUTOPILOT CAN SEE SURGE ZONES, AND UNTIL IT COULD, NOTHING ------
   *
   * This block is the single highest-risk thing in the effort build and it is
   * worth saying why in the file rather than only in the roadmap. A surge is
   * elected BY BEING IN THE MARKED LANE. A bot that scores lanes on CLEAR, aid
   * and ramp -- which is every bot this project had -- therefore takes the
   * marked lane only by coincidence, runs the whole course at the unsurged
   * floor, and reports, truthfully and uselessly, that the mechanic changed
   * nothing. tools/risk.js printed exactly that: six policies, spread 0.0 s,
   * after the pool and the zones had shipped. The instrument was not wrong; it
   * was blind, which is worse, because a blind instrument agrees with you.
   *
   * So the bot gets a LINE POLICY, named to match tools/simulate.js's POLICIES
   * so the game and the sweep are one model rather than two.
   *
   * IT USED TO BE A SPEND POLICY and the difference is the whole of this pass.
   * A segment bought guard or surge, the policies were about WHICH ZONES TO
   * ELECT, and the strategy was an allocation across a race. The owner removed
   * the surge -- "One speed system" -- so the pool has one spend again and the
   * allocation is gone with it. docs/risk-reward.md is the standing warning
   * about that: before the pool had two rival uses, six policies finished at
   * 1:58:03 with a spread of 0.0 seconds, because there was nothing to decide.
   *
   * What replaces it is the LINE: at nearly every gate the player weighs what
   * a lane costs in ACTIONS against what it pays in TEMPO. That is a decision
   * far more often than four times a race, and it is a different KIND of
   * decision -- local and repeated rather than global and allocated. Whether
   * it carries the strategy is not asserted here; tools/simulate.js sweeps
   * these policies and prints the spread, and a spread near zero would mean
   * this pass had undone roadmap 66.
   *
   *   all     the derived weights below. The default, and the same argument
   *           the ramp term uses: every frame this project photographs is
   *           bot-driven, so the default line must have the mechanic ON.
   *   ignore  mats are invisible; route on clearance and aid alone. The A/B
   *           partner, and NOT the same thing as ?effort=0 -- this one still
   *           runs the mat-spaced course.
   *   green   chase a lift hard, ignore a drag.
   *   red     avoid a drag hard, ignore a lift.
   *   safe    take a lift only when it costs no action, never pay for one.
   *   greedy  chase a lift and flee a drag above everything but the ramp.
   *
   * ?line= is read once, here, and never per frame.
   */
  /**
   * What a mat is worth to the bot, in hundredths of an action avoided -- the
   * clear-lane term below is 100, so one unit here is one hundredth of one
   * action. An action costs P(fluff) x a contact, about 2 to 4 race seconds at
   * the skill this game is tuned around; tools/tempo.js --section worth
   * measures what a mat is worth in the same currency. Both mat steps halved
   * when the owner asked for a smaller one, so these halve with them rather
   * than being re-picked.
   */
  const LINE_W = {
    // ---- MEASURED, NOT DERIVED, AND THE DERIVATION UNDERSHOT ------------
    //
    // The per-mark arithmetic says a lift over the median 53-unit mark is
    // worth about 1.5 race seconds and a drag about 2.3, against an action's 2
    // to 4 -- which puts them at roughly a half and three quarters of an
    // action, so +50 and -85. tools/playthrough.js then ran the six policies
    // end to end in the real page and the GREEDY line, at +170 / -200, came in
    // 20 seconds ahead of those weights.
    //
    // The gap is CHAINING and the myopic sum cannot see it: holding the green
    // lane through this gate is also what leaves the runner in position for
    // the next mark, and marks are laid at decisions, which cluster. A weight
    // set from one mark's worth systematically undervalues a mat for the same
    // reason a greedy path is not a shortest path.
    //
    // So the default sits near the measured optimum rather than near the
    // arithmetic, and the arithmetic is written down as the thing it corrects.
    all:    { lift: 100, drag: -140 },
    ignore: { lift: 0, drag: 0 },
    green:  { lift: 60, drag: 0 },
    red:    { lift: 0, drag: -160 },
    safe:   { lift: 17, drag: -67, clearOnly: true },
    greedy: { lift: 170, drag: -200 },
  }[(params.get('line') || 'all').toLowerCase()] || { lift: 17, drag: -67 };
  /**
   * ---- AND THE BACKWARD MAT IS ANNOUNCED FOR THE SAME REASON -------------
   *
   * The tempo paint does not exist in the renderer yet either (see the art
   * commission in docs/roadmap.md entry 68), and of the two directions only one
   * of them can take a run: a forward mat the player never noticed costs them
   * nothing, while a backward mat they could not see is a slow-down outside
   * their control, which rule 4 calls a build failure rather than a difficulty
   * setting.
   *
   * SO ONLY THE BACKWARD ONES ARE ANNOUNCED. That is not economy of code, it is
   * the same split the fairness rule makes: the cue exists to cover the
   * exposure, and the lift has none. It also keeps the toast quiet -- 2.5 of
   * these a course against 9.3 mats.
   *
   * TEMPO_LOOK is READ_NEAR plus a lane change, which is exactly the ground the
   * player needs to read the cue and leave the lane: Course.READ_NEAR is the
   * commit point measured from the lens and LANE_TRANSIT is what the swerve
   * covers. Derived rather than typed, so a retune of the jump arc or the chase
   * distance moves it.
   */
  const TEMPO_LOOK = MR.Course.READ_NEAR + MR.Course.LANE_TRANSIT;
  let matToldOf = null;

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
      // ---- AND IT WAS READING THE WRONG RULE ------------------------------
      //
      // This block used to say "aid is taken on lane match alone, so wanting
      // an item means being in its lane when z passes it", and collect every
      // item between the runner and the gate line. Both halves went stale when
      // aid became GUARDED (roadmap 50) and nothing re-read them:
      //
      //   * player.resolveAid pays a guarded item to a runner who was in
      //     item.lane WHEN GATE item.gate RESOLVED. It is a receipt off
      //     s.lastGate, not a lane match on the road.
      //   * generateAid places the item at g.z + 2*halfZ + AID_SETBACK -- that
      //     is, always PAST its own gate line, standing behind the obstacle it
      //     hangs off. So `it.z > g.z` was true for the very item this gate
      //     was about, and the loop broke out before ever seeing it.
      //
      // The bot therefore steered for items belonging to gates it had already
      // passed and could no longer be paid for. Measured on the real page: 5
      // of the 14 road items on today's course. Reading the shipped rule
      // instead -- want item.lane at gate item.gate -- takes it to 12.
      //
      // Same expression tools/risk.js has always used (aid[ai].gate === gi),
      // which is why that harness collected and this one did not.
      const order = [player.lane, player.lane - 1, player.lane + 1, 0, 1, 2]
        .filter((l, i, a) => l >= 0 && l <= 2 && a.indexOf(l) === i);
      // The lanes that would be paid for AT THIS GATE. Roof items are excluded
      // deliberately: they are bought by being on the deck, which the ramp term
      // below already steers for, and wanting one on the road is wanting
      // something that cannot be collected from there.
      const wants = [];
      for (const it of (course.aid || [])) {
        if (it.gate === bot.gate && !it.roof) wants.push(it.lane);
      }
      // ---- AND THE TRAILS, WHICH ARE THE ABUNDANCE PASS'S OWN MECHANIC ----
      //
      // Loose pickups (trails and clusters, collected by lane match) between
      // here and the next gate. Roadmap 67's lesson again: a bot that cannot
      // see a mechanic reports that the mechanic changes nothing, and every
      // frame this project photographs is bot-driven. The weight is a
      // TIE-BREAK, deliberately under the clear-lane term and the mat terms:
      // a trail lane is entered when it is free, and a trail is never worth
      // an action or a drag to this bot -- the arc term above (+150) is the
      // one that pays actions for aid, exactly as the receipt rule prices it.
      const trailN = [0, 0, 0];
      for (const it of (course.aid || [])) {
        if (it.roof || it.gate != null) continue;
        if (it.z <= g.z || it.z > g.z + 50) continue;
        trailN[it.lane]++;
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
        score += Math.min(trailN[l], 5) * 8;
        // Take the ramp when there is one, so every automated run that has one
        // available rides it and the frames, the finish times and the fairness
        // audit are all measured with the mechanic switched on rather than
        // routed around. This outranks aid deliberately: the question this pass
        // is asking is what the roof costs, and a bot that prefers a bottle
        // would answer a different one.
        if (g.ramp === l) score += 220;
        // ---- AND THE MATS, WHICH IS THE SAME BLINDNESS ONE MECHANIC ON ----
        //
        // Roadmap 67's whole lesson: a bot that cannot see a mechanic reports,
        // truthfully, that the mechanic changes nothing. Every bot in this
        // project scored CLEAR, aid, ramp and then the marked lane, and each
        // term had to be added the day its mechanic landed or the harness
        // measured a version of the game with that mechanic routed around.
        //
        // WEIGHTS, AND THE FIRST DERIVATION OF THEM WAS WRONG. They were set
        // below the clear-lane term (100) on the argument that "a mat is worth
        // seconds and a contact is worth tens of them", which compares the mat
        // to the WRONG THING: taking a hurdle lane is not taking a contact, it
        // is taking an ACTION, and an action is cleared far more often than
        // not. The honest currency is expected cost.
        //
        // The clear-lane term is 100, so one unit here is one hundredth of an
        // action avoided. An action costs P(fluff) x the cost of a contact --
        // about 2 to 4 race seconds at the skill this game is tuned around --
        // against a drag's measured 5.0 and a lift's 1.9 (tools/tempo.js
        // --section worth). So a drag is worth about one and a half actions
        // and a lift about six tenths of one:
        //
        //     drag  -150      eating one costs more than clearing a hurdle
        //     lift   +55      worth a detour, not worth an action
        //
        // The sign of that first number is the whole mechanic. At -72 the bot
        // preferred a CLEAR lane with a drag in it over a JUMP lane without
        // one, which is the coasting decision the backward mat exists to make
        // expensive -- the harness would have been demonstrating the mat while
        // declining to use it.
        //
        // It is a FIXED weight against a skill-dependent cost, and that is
        // stated rather than hidden: at 30% fluff an action really is worth
        // more than a drag and eating it would be right. A bot that
        // conditioned on its own fluff rate would be measuring a player who
        // knows their own error rate, which is not a player.
        //
        // Read at the GATE LINE rather than over the mark, because that is
        // where the lane is chosen and where this bot commits.
        if (course.tempoAt) {
          const m = course.tempoAt(g.z, l);
          // `clearOnly` is the SAFE policy: it takes a lift that happens to be
          // in a clear lane and never pays an action for one, which is the
          // cautious line and a real policy rather than a weaker default.
          if (m && !(LINE_W.clearOnly && m.dir > 0 && g.lanes[l] !== K.CLEAR)) {
            score += m.dir > 0 ? LINE_W.lift : LINE_W.drag;
          }
        }
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

    // PAUSED stops the world, not just the clock. Every integrator below is
    // stepped with this instead of dt, so the springs, the stride phase, the
    // hood, the ghost's tag and the celebration clock all hold where they were
    // rather than settling while the game is stopped. pace.update is not called
    // at all, so the race clock and the distance are frozen at their source.
    const sdt = state === PAUSED ? 0 : dt;

    if (state === COUNT) {
      const prev = Math.ceil(3 - countT);
      countT += dt;
      const c = Math.ceil(3 - countT);
      if (c !== prev && c > 0) audio.countdown(false);
      if (countT >= 3) {
        hud.countdown(null);
        audio.countdown(true);
        state = RUN;
        // The gun. On a resume this is the frame the world reappears AND the
        // frame it starts moving -- the two are the same frame on purpose, so
        // the countdown never doubles as a free look. See pause() above.
        if (resuming) {
          resuming = false;
          hud.showPause(false);
          controls.enabled = true;
        }
      } else {
        hud.countdown(String(Math.max(1, c)));
      }
    }

    // The launch, released only once the race is actually running. See standT.
    if (state === RUN && standT > 0) standT = Math.max(0, standT - dt / LAUNCH);
    // The pose blend, smoothstepped at both ends.
    const stand01 = standT * standT * (3 - 2 * standT);
    // ...and the stride ramp, which is the same clock read against a shorter
    // window, so the legs reach full rate while the body is still coming out of
    // the standing pose.
    const gu = Math.min(1, (1 - standT) * (LAUNCH / LAUNCH_SPEED));
    const launch = gu * gu * (3 - 2 * gu);

    // The button exists only while there is a race to stop: not over either
    // panel, not during either countdown, and not after the tape. Edge-detected
    // rather than written every frame, for the reason hud.js keeps a whole
    // `cache` object: this loop runs sixty times a second and a classList write
    // per frame is style invalidation per frame for a class that changes four
    // times in a race.
    if ((state === RUN) !== btnShown) { btnShown = state === RUN; hud.showPauseBtn(btnShown); }

    if (state === RUN) {
      if (BOT) botThink();
      player.handle(controls);

      // ---- THE ELECTION, AND IT HAPPENS BEFORE THE STEP -------------------
      //
      // Before pace.update, because the surge decides which FLOOR this step is
      // run toward and a step cannot be run at a pace that is chosen after it.
      // Resolved off pace.units -- where the runner is now -- and player.lane,
      // which player.handle has already served this frame, so a swipe into the
      // marked lane takes effect on the step the player made it.
      if (EFFORT) {
        // ...and the mat, in the same breath and for the same reason: it shifts
        // the target this step is run toward, so it has to be read before the
        // step and not after it. No fuel test -- a mat costs nothing to run on.
        // What it costs is the lane, and the player has already chosen that.
        const mat = player.resolveTempo(course, pace.units);
        pace.tempo = mat ? mat.dir : 0;
      }

      const before = pace.units;
      pace.update(dt);
      const after = pace.units;

      player.update(dt, after - before);

      // The second running surface, BEFORE the gates. Order is load-bearing:
      // the ramp's own gate line sits at the foot of its tailgate, so the mount
      // has to be established on the same step the gate resolves or the game
      // records the runner colliding with the lorry he is running up.
      // ---- WHAT A CONTACT COSTS IS NOW A QUESTION, NOT A CONSTANT ---------
      //
      // pace.onHit() returns 'guard' when a segment paid for the contact and
      // 'hit' when nothing did, and the two must not look the same. The
      // PHYSICAL event is identical either way -- the runner still bounces,
      // still trips, still stumbles, and the camera still takes the impact --
      // because a guard that swallowed the collision would read as the game
      // failing to register it. What the guard buys is the CONSEQUENCE: the
      // streak survives, the seconds are not added, and the engine plate does
      // not flash broken, because nothing broke.
      function charge(z, shake) {
        const how = pace.onHit();
        cam.impact(shake);
        if (how === 'guard') { hud.flashGuard(); audio.aid(false); return; }
        hitAt.push(z);
        hud.flashBroken();
      }

      const deck = player.resolveDeck(course, before, after);
      if (deck && deck.hit) charge(deck.z, 1);

      // Resolve gates crossed this step.
      const results = player.resolveGates(course, before, after);
      for (const r of results) {
        if (r.clean) {
          pace.onClean();
          audio.clean(pace.streak);
        } else {
          charge(r.gate.z, 1);
        }
      }

      // Aid taken this step. Streak only -- pace still has one source.
      const aidIdxBefore = player.aidIdx;
      const aidTook = player.resolveAid(course, before, after);
      for (const item of aidTook) {
        // ---- A PICKUP IS A SIP NOW, SO THE TOAST MOVES TO THE SEGMENT -----
        //
        // Aid arrives in trails and arcs -- five or six items inside a second
        // -- and a toast per item is a strobe, not a message. The event worth
        // words is the one the pickup ECONOMY defines: a whole guard segment
        // completing, which is when the collecting actually bought something.
        // The per-item channel is the audio blip and the pop, which scale
        // with abundance the way a toast cannot.
        //
        // Read the tank BEFORE the pour, so the card can tell "it went in"
        // from "there was nowhere to put it". A wasted pickup is the price of
        // hoarding and the player has to be told it happens -- once per full
        // episode, not once per coin, or the cap reads as a scold.
        const segBefore = pace.segments();
        const roomBefore = pace.pool < MR.Pace.EFFORT_CFG.POOL_MAX;
        pace.onAid(item.gain);
        audio.aid(item.kind === 'banana');
        if (EFFORT) {
          if (pace.segments() > segBefore) {
            hud.toastAid('GUARD', '+1');
            // A completed segment proves the player is collecting, so the
            // missed cue below is allowed to speak again. See its note.
            aidNagged = false;
          } else if (!roomBefore && !tankToldOf) {
            tankToldOf = true;
            hud.toastAid('TANK FULL', 'WASTED');
          }
        } else if (item.kind === 'banana') {
          hud.toastAid('FUEL', '+' + item.gain + ' STREAK');
        }
        if (roomBefore) tankToldOf = false;
      }

      // ---- THE DECLINED BOTTLE, AND WHY THIS RULE HAD TO CHANGE -----------
      //
      // This line used to read `if (passed > taken) audio.aidMissed()`, under a
      // comment calling a passed item "the one event in the run which is pure
      // loss and has nothing to mark it". Both halves of that were true of the
      // aid placement it was written against, and roadmap 50 has just made both
      // false.
      //
      // A bottle now stands BEHIND an obstacle, in that obstacle's own lane, at
      // a gate that always leaves some other lane clear. Measured by
      // tools/aid.js on the shipped course: items costing the cheapest line
      // nothing went 56.5% -> 0%, and four natural-line bots went from
      // collecting 64.4% to 0%. So declining is now the ORDINARY outcome and
      // very often the correct one -- the free lane is right there, and the
      // only way to the bottle is over or under the thing in front of it. Left
      // alone, this cue would have fired for very nearly every bottle in the
      // race, which turns a meaningful sound into a nag and, worse, nags the
      // player for making the right decision.
      //
      // Nor is it "pure loss" any more, and that is the deeper change: a passed
      // bottle is now a PRICE DECLINED, not an opportunity fumbled.
      //
      // WHAT THE CUE MEANS NOW. There is still one case worth a sound, and
      // pace.js already defines it exactly. onAid grants
      // min(streak + gain, gatesSeen, AID_CEILING) - streak, so a bottle is
      // worth EXACTLY ZERO to a flawless runner -- their streak already equals
      // the gates they have passed. The quantity below is that arithmetic, not
      // a threshold invented here, which is why it cannot drift away from what
      // the bottle would actually have paid.
      //
      // So the cue fires only when the bottle really would have bought
      // something back, at half its face value or better -- i.e. on a run that
      // has already come apart, which is the run the rescue half of the aid
      // pool exists for. It cannot fire on a clean line at all.
      //
      // AND ONCE, NOT EVERY TIME. A broken run passes fourteen of these. The
      // informative event is the FIRST one -- "there is help on this road and
      // you are running past it" -- and the fourteenth is scolding. This is the
      // same edge-not-held shape recordLost and the tier cues above already
      // use, and it re-arms when the player takes an item, because taking one
      // is proof they can see them.
      if (player.aidIdx - aidIdxBefore > aidTook.length && !aidNagged) {
        let worth = 0, face = 0;
        for (let i = aidIdxBefore; i < player.aidIdx; i++) {
          const item = course.aid[i];
          if (!item || aidTook.indexOf(item) >= 0) continue;
          // pace.onAid's own bounds, so the two can never disagree about what a
          // bottle is worth to this run at this moment.
          const paid = Math.max(0, Math.min(pace.streak + item.gain,
            pace.gatesSeen, K.AID_CEILING) - pace.streak);
          if (paid > worth) { worth = paid; face = item.gain; }
        }
        if (face > 0 && worth >= face * 0.5) { aidNagged = true; audio.aidMissed(); }
      }
      // ...and under EFFORT the arithmetic above is answering a question that
      // no longer exists: onAid does not grant streak, so `paid` is always
      // zero and the cue could never fire.
      //
      // WITH AID ABUNDANT THE CUE NARROWS AGAIN, for the same reason it
      // narrowed when roadmap 50 made declining ordinary: hundreds of
      // pickups pass every race, most of them in lanes the player rightly
      // declined, and a cue that fires on "you passed some" is a nag about
      // normal play. The one state worth a sound is EXPOSED AND PASSING
      // FUEL: no whole segment in hand -- the next contact costs the streak
      // -- while collectable pickups go by. Once, not every time; re-armed
      // when a segment completes (above), because completing one is proof
      // the player can see the trail.
      if (EFFORT && player.aidIdx - aidIdxBefore > aidTook.length && !aidNagged
          && pace.segments() < 1) {
        aidNagged = true;
        audio.aidMissed();
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

      // ---- THE BACKWARD MAT IS ANNOUNCED, AND ONLY THE BACKWARD ONE -----
      //
      // A zone nag stood here too and went with the surge. This one stays, and
      // the split is the fairness rule rather than economy: of the two mat
      // directions only one can take a run. A green mat the player never
      // noticed costs them nothing; a red one they could not see is a slow-down
      // outside their control, which rule 4 calls a build failure rather than a
      // difficulty setting. The paint now exists -- world.js draws both -- so
      // this is belt and braces over a channel that already works, kept because
      // removing a fairness cue is not something to do casually and the reader
      // test that would license it is about the paint, not about the toast.
      if (EFFORT && course.tempoAhead) {
        const m = course.tempoAhead(pace.units, TEMPO_LOOK);
        if (m && m !== matToldOf && m.dir < 0) {
          matToldOf = m;
          // It names the lane that is SLOW and the lane that is open, because
          // those are the two facts the decision turns on and the second is the
          // one the generator guarantees. course.js proves that lane is not
          // BLOCK at any gate in the mark and holds no vehicle, so this cue can
          // never point the player somewhere they cannot go.
          hud.toastAid('SLOW ' + ['LEFT', 'CENTRE', 'RIGHT'][m.lane],
                       'OPEN ' + ['LEFT', 'CENTRE', 'RIGHT'][m.open]);
        }
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
          // The history row's facts. The city names today's road on the
          // history tab; `record` is the fact the daily lockout keys off,
          // decided here because this file owns RECORD_SECONDS and the store
          // deliberately does not. Same comparison the celebration uses.
          city: course.settings && course.settings.length ? course.settings[0].name : '',
          record: pace.finishTime <= K.RECORD_SECONDS,
        });
        // The save just changed; the panels that hang off it follow, and if
        // the record fell this is the moment today locks -- the finish card's
        // RUN IT AGAIN relabels and routes back to the completed start panel.
        if (saved) refreshDaily();
        // See finishJoy above. Read here, once, off the result that is now a
        // fact -- never off the projection, which is still twitching a quarter
        // of a second before the line.
        const rung = MR.Tier.of(pace.finishTime);
        const rungs = MR.Tier.LADDER.length - 1;
        finishJoy = JOY_FORCED ? Math.max(0, Math.min(1, JOY))
          : pace.finishTime <= K.RECORD_SECONDS ? 1 : Math.max(
          saved && saved.allTimeBest && !saved.firstEver ? 0.85 : 0,
          saved && saved.beatToday && !saved.firstToday ? 0.70 : 0,
          0.60 * (1 - rung.i / rungs));

        // HOLD THE CARD. The tape breaks, the confetti fires, the crowd
        // roars and the camera pulls up into its hero shot -- and all of that
        // used to play behind a full-screen results panel that appeared on the
        // very same frame. The ending was being built and then covered up.
        //
        // 2.6s WAS the length of that flourish. It is not any more: the camera
        // now leaves the chase entirely and comes round to the front of him
        // (see the celebration block in camera.js), which is 0.80s of held
        // astern break, 1.80s of arc, and a hold on his face. The card is what
        // covers that up, so the card moves.
        //
        // 4.9s is not a free number and it is worth saying what pays for it:
        // the HUD readout is still on screen through all of it with the race
        // clock stopped on the finish time, so a player who only wants the
        // number already has the number. Anyone who wants the card sooner can
        // touch the screen -- see controls.onAny below, which ends the hold on
        // any input rather than making them wait out an animation twice.
        audio.finish(pace.finishTime < K.RECORD_SECONDS);
        // Clear the top-left column out of the shot. See hud.celebrate.
        hud.celebrate(true);
        clearTimeout(endTimer);
        // hitAt is copied rather than handed over: `reset()` empties this array
        // for the next run, and the card is still on screen when RUN IT AGAIN
        // is pressed.
        const where = hitAt.slice();
        showCard = function () {
          clearTimeout(endTimer);
          showCard = null;
          hud.showEnd(pace, saved, where);
        };
        endTimer = setTimeout(function () { if (showCard) showCard(); }, 4900);
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
    // ...and at the other end of the race the same argument runs backwards:
    // `launch` is 0 at the start line and 1 for every other frame of the game,
    // so this is the ground speed the CHARACTER is travelling at rather than the
    // one the pace model is charging for. The two disagree exactly twice in a
    // race, once at each end, and both disagreements are the truth.
    const strideSpeed = (state === DONE
      ? pace.speed() * Math.max(0, 1 - (performance.now() - doneAt) / 2200)
      : pace.speed()) * launch;

    // Seconds since the tape, which is the celebration's clock in runner.js AND
    // in camera.js. Real time, not race time: the race clock has stopped, and
    // this drives an animation rather than a result.
    //
    // Accumulated from `raw` rather than read off performance.now(), and both
    // halves of that matter. RAW, because the celebration is a parametric path
    // and not a spring -- the 1/25 clamp above exists to stop a long frame
    // detonating an integrator, and applying it here would make the whole move
    // play at 28% speed on the 7fps SwiftShader harness while the card, on a
    // real setTimeout, arrived a third of the way through it. ACCUMULATED,
    // because a screenshot harness that pumps rAF with a synthetic clock then
    // owns this clock too, which is what makes the framing measurable.
    if (state === DONE) celClock += raw;
    const celT = celClock;
    // A pause during the celebration is not reachable -- the button is gone the
    // moment the tape breaks -- so `raw` above needs no gate of its own.

    // The grade at the runner, -1..1 against the steepest legal one. It only
    // pitches the trunk; the stride slows on the climb and quickens on the
    // descent for free, because cadence already falls out of `speed`.
    const grade = elev.gradeNorm(pace.units);

    runner.update(sdt, {
      speed: strideSpeed,
      // 1 at the line, 0 in full stride. Zero for the whole race, which is what
      // lets runner.js apply the standing pose as an override after the cycle
      // has posed rather than threading a ninth state through forty joints.
      stand: stand01,
      grade,
      air01: player.airborne ? Math.sin(Math.min(1, player.airT) * Math.PI) : 0,
      duck01: player.duck01,
      trip: player.tripT,
      bounce: player.bounce,
      lean: player.lean,
      stumble: player.stumble,
      // The finish. Both are zero for the whole race, so every term they drive
      // is provably inert until the tape -- the same discipline MR.Runner.POLISH
      // runs on, and tools/envelope.js holds the eight play silhouettes to it.
      celT: celT,
      joy: finishJoy,
      // Which side the camera will be on when it arrives. Read from camera.js
      // rather than recomputed, so the head cannot turn away from the lens.
      celSide: MR.Camera.celSideFor(player.x),
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

    cam.update(sdt, {
      z: pace.units, x: player.x, y: player.y, surface: player.surface,
      // The same launch-scaled speed the runner is handed, and for the same
      // reason: the camera's framing, its cadence-locked bob and its surge cue
      // are all statements about how fast the runner is going, and at the start
      // line he is going nowhere. Nothing in the framing moves for it -- both
      // the pull-in and the look-ahead read `drive`, which is clamped at zero
      // from START_PACE downward -- so what this actually buys is a bob that
      // stops bobbing under a body with no footfalls, and a camera that trails
      // back off the line when he goes.
      speed: pace.speed() * launch,
      // The flat speed, for the top-gear latch alone. A descent must not fire
      // the gear flourish or the permanent rumble: speed you did not earn is
      // not another gear. See camera.js's header.
      gearSpeed: pace.streakSpeed() * launch,
      lean: player.lean, duck01: player.duck01,
      // The finish, on the same clock the runner's pose runs on. Zero for the
      // whole race, so every celebration term in camera.js is inert until the
      // tape and the shipped chase framing is untouched by construction.
      celT: celT,
    });

    // After the camera, never before: the ghost's tag is placed against this
    // frame's lens (position, fov, aspect), and a frame of lag there shows up
    // as the tag swimming during a lane change.
    // The same two launch numbers the runner and the camera are handed, on the
    // same frame: the record holder is starting the same race on the same gun,
    // so it stands on the line and leaves it with the player rather than jogging
    // through the countdown beside a runner who is not.
    ghost.update(sdt, {
      pace, camera: cam.camera, playerX: player.x, celT,
      stand: stand01, launch,
    });

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
  /**
   * The camera is told what the readout took, because it is the only file that
   * cannot work it out and the only one that can answer for it.
   *
   * camera.js frames the runner so his lowest point sits at a fixed FRACTION of
   * frame height; #railWrap claims a fixed number of PIXELS at the bottom. Which
   * of the two wins is decided by (P + margin) / H, and neither file can see
   * that number on its own -- the camera had been inferring it from the aspect
   * ratio, which ranks 320x568 and 1280x800 at opposite ends of its only axis
   * when they are in fact the same difficulty to three decimal places. See THE
   * READOUT'S OWN CLAIM in camera.js.
   *
   * MEASURED HERE, NOT EVERY FRAME. The plate's height is fixed by the
   * stylesheet and does not move during a race -- tools/footroom.js gates that,
   * three nowrap rules and two fixed row heights enforce it, and it was
   * re-checked against the longest strings the game can print and against
   * deliberate overflow: 51, 75, 81 and 54px at the four viewports, unchanged in
   * every case. So this is read where the layout can actually change -- a
   * resize, an orientation change, and once when the webfont settles -- and the
   * camera holds it still in between. A framing term that re-derived itself
   * per frame would be a camera that could creep mid-race off a HUD reflow,
   * which is a worse defect than the one being fixed.
   */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    cam.resize(w / h, hud.bottomClaim(), h);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  // The plate is sized in px by the stylesheet, so a late webfont cannot change
  // its height -- but the baseline-aligned row inside it can shift a pixel or
  // two, and this costs nothing. Guarded: document.fonts is absent on nothing
  // this game supports, and a rejected promise here must not take the race with
  // it.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(resize).catch(() => { });
  }
  // The camera was created before the HUD existed, so the first claim it ever
  // saw was zero. Take the real one now that there is a plate to measure.
  resize();

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
    // The celebration clock, and it is SETTABLE. A harness that pumps rAF owns
    // every other clock in this file, and would own this one too except that a
    // page opened at ?skip=250 is already several real seconds past the tape
    // before the harness can take the pump -- so without a rewind, a tool can
    // only ever photograph whichever instant of a 2.6-second move the boot
    // happened to land on. That is the exact failure tools/stride.js shipped:
    // a measurement sweep taken at whatever state the page was left in.
    get celT() { return celClock; },
    set celT(v) { celClock = Math.max(0, +v || 0); },
    // The launch clock, and SETTABLE for exactly the reason celT is: the moment
    // this pass has to be photographed -- at the line, at the gun, one second
    // after -- is three quarters of a second long, and a harness that can only
    // wait for it photographs whichever instant its own frame rate lands on.
    // 1 is the start line, 0 is full stride.
    get stand() { return standT; },
    set stand(v) { standT = Math.max(0, Math.min(1, +v || 0)); },
    pause, resume,
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
    // ...and he is already running by definition: this branch exists to put the
    // page deep into a race, and every one of those races began some minutes
    // ago. Set explicitly rather than left to begin(), because ?skip= is legal
    // without ?bot= and would otherwise open a mid-race screenshot on a runner
    // stepping off the start line.
    standT = 0;
    const step = 1 / 60;
    for (let t = 0; t < SKIP; t += step) {
      if (BOT) botThink();
      player.handle(controls);
      controls.tick(step);
      // ---- THE FAST-FORWARD RESOLVES THE SAME FACTS THE LIVE LOOP DOES ----
      //
      // It did not, and the omission was invisible until the pool existed.
      // This loop had never called resolveAid or resolveSurge, so a
      // fast-forwarded race collected NOTHING and elected NOTHING -- which
      // under EFFORT means every ?skip= frame in the shot library shows an
      // empty FUEL gauge and an unsurged runner, whatever the bot did, and
      // every tool that plays the game by skipping would have reported the
      // mechanic doing nothing. That is the same blindness that made
      // tools/risk.js print six policies at a 0.0 s spread, one layer down.
      //
      // Before pace.update, in the live loop's order and for the live loop's
      // reason: the surge decides which floor this step runs toward.
      if (EFFORT) {
        // The mat too, in the live loop's order. A fast-forward that skipped it
        // would report the mechanic doing nothing on exactly the runs the
        // harness inspects -- which is the defect the note above records for
        // the surge, one mechanic later.
        const mat = player.resolveTempo(course, pace.units);
        pace.tempo = mat ? mat.dir : 0;
      }
      const b = pace.units;
      pace.update(step);
      player.update(step, pace.units - b);
      // Same order as the live loop, and for the same reason. A fast-forward
      // that skipped this would photograph the runner standing in mid-air where
      // a roof should be, or record a mount as a collision.
      const fd = player.resolveDeck(course, b, pace.units);
      // A guarded contact is not a hit and must not leave a hit marker: the
      // live loop's charge() already draws that line, and the fast-forward has
      // to draw it in the same place or a skipped race and a played one
      // disagree about what happened.
      if (fd && fd.hit && pace.onHit() !== 'guard') hitAt.push(fd.z);
      for (const r of player.resolveGates(course, b, pace.units)) {
        // Recorded here as well as in the live loop. This fast-forward exists
        // so tooling can photograph the game deep into a race, and a debug
        // path that quietly drops a fact the finish card is computed from
        // would make the card lie on exactly the runs the harness inspects.
        if (r.clean) pace.onClean();
        else if (pace.onHit() !== 'guard') hitAt.push(r.gate.z);
      }
      // And the bottles, which fill the pool that everything above spends.
      for (const item of player.resolveAid(course, b, pace.units)) pace.onAid(item.gain);
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
