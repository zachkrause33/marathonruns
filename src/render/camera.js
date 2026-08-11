/**
 * Chase camera: low, tight, and behind the shoulder.
 *
 * The reference framing (Subway Surfers, Temple Run) puts the character at
 * roughly a third of frame height with the road opening out above them --
 * close enough that a lane change is body movement, high enough that the next
 * two gates still read. The first pass sat at 3.0 up / 6.55 back and the
 * runner was a distant sprite at a quarter of frame height; this sits at
 * 2.05 / 4.35 and fills about a third, dropping to 1.64 / 3.73 at full pace.
 *
 * Perceived speed is the hard problem and this file owns all of it. Ground
 * speed only moves 21.8 -> 27.7 units/sec across the whole race, because
 * 5:30/mi to 4:20/mi really is only 21%, and the distance maths is not
 * negotiable. So the camera multiplies that 21% instead of faking it:
 *
 *   - a widen-and-close (FOV out, camera in) as pace rises. Peripheral
 *     geometry sweeps far faster while the runner stays the same size on
 *     screen, which is the strongest speed cue available without touching
 *     the simulation.
 *   - the camera drops toward the road at pace, so nearby tarmac is closer
 *     to the lens and its angular rate climbs much faster than 21%.
 *   - a stride bob locked to the same cadence formula the runner uses, so
 *     the whole frame quickens with the footfalls.
 *   - a top-gear band: the last quarter of the pace range gets extra FOV and
 *     a permanent low rumble, so "finding another gear" is a state change and
 *     not just a slightly bigger number.
 *   - surge, from the derivative of pace. Measured on the smoothed signal this
 *     file actually uses, streak-driven acceleration reaches +0.70 u/s^2 and a
 *     hit -1.33 (7,460 samples of real play) -- NOT the ~4 this line used to
 *     claim, which is where a normaliser 4.5x too large came from. The camera
 *     trails and widens while you are gaining, and closes in and narrows while
 *     a hit bleeds the pace away.
 *
 * Every effect is bounded so it can never hide the next gate: shake is a
 * damped oscillation rather than per-frame noise (noise reads as static and
 * makes obstacles unreadable), the punish state *narrows* FOV, and the mile
 * and gear flourishes only ever show more of the road, never less.
 *
 * ...with exactly one exception, and it is at the end of the race where there
 * is no gate left to hide: after the tape the camera leaves the chase
 * altogether, arcs round to three-quarter FRONT and holds on the runner's face
 * with a long lens. See THE CELEBRATION below. It is the only shot in this
 * game that has ever pointed at the front of anything.
 */
MR.Camera = (function () {
  const K = MR.K;

  // ---- framing ----------------------------------------------------------
  // The FOV *swing* is the cue, not the absolute value: past about 74 degrees
  // vertical the far road collapses into a band and gates stop being readable
  // early enough to react to, which is a bug however fast it feels. So the
  // steady range is 61 -> 72 and the clamp exists only to stop stacked
  // transients (gear + duck + landing kick) from ever getting there.
  //
  // THE FLOOR WENT 58 -> 61, AND THE SWING ONLY PAID A FIFTH FOR IT.
  //
  // 58 was the narrowest lens in the game and it sat exactly where the game is
  // slowest, so the runner was most magnified -- and therefore lowest in the
  // frame -- in the opening minute, which is the first thing anyone ever sees.
  // A player on an iPhone reported it as "feet slightly caught off at the
  // bottom" and they were right: at 390x844 and race-second 240 the lowest row
  // of his shoe was drawn 20px INSIDE the opaque readout panel, and at the start
  // line 24px. See tools/footroom.js, which is the assertion that now says so.
  //
  // Measured on that sweep, one degree of vertical field is worth 6.0px of
  // clearance at 844px of frame height. Three degrees of floor is 18 of them.
  //
  // The floor is not the cue and the swing is, so the swing is what had to be
  // protected: 10.5 -> 8.5 keeps 81% of it, and the TOP of the band widens by a
  // degree (68.5 -> 69.5) rather than narrowing, because wider only ever shows
  // more road. The alternative priced against this was a floor of 64 with a
  // swing of 4.5 -- same pixels, 57% of the cue gone -- and it was rejected on
  // that number rather than on taste.
  const BASE_FOV = 61;
  const SPEED_FOV = 8.5;         // widening across the honest pace band
  const GEAR_FOV = 2.5;          // extra, only in the top of the band
  const FOV_MIN = 48, FOV_MAX = 76;

  // Height is set by a sightline, not by taste.
  //
  // The road in the player's own lane only rises above their own head on
  // screen beyond d > 6.96 / (camY - 1.60), where 1.60 is the runner's crown
  // and 4.35 the chase distance. At the old BASE_Y of 2.05 -- which the pace
  // drop below took to 1.70 at race pace, a mere 0.10 above the crown -- that
  // put the horizon of usable information at 62 units. Gates are 24-46 units
  // apart, so the runner's own body was hiding the next one to two gates in
  // the lane they were standing in. Playtest verdict, exactly: "it's hard to
  // see what is in front of you."
  //
  // 2.62 landed ~2.30 at full pace, which brought that sightline in to about 10
  // units -- the road immediately ahead is visible again -- and dropped the
  // runner from 47% down the frame to roughly 65%, which is also where the
  // Subway Surfers and Sonic references put theirs (see reference/).
  //
  // That fixed the near road. It did not fix the FAR road, and the same
  // playtest sentence came back a second time about a different distance:
  // "when there are so many obstacles back to back it makes it a tad tough to
  // see what's ahead of you." Hence the raise below.
  //
  // THE VALUE ITSELF LIVES IN constants.js, and moving it there was not
  // tidiness. elevation.js derives the maximum steepness of a crest from the
  // eye height -- a lower camera sees less of the far side of a rise -- and it
  // runs headless in tools/ where this file does not exist. The dependency is
  // silent and it goes as the square. Retune the camera by changing
  // K.CAM_BASE_Y and the hill cap follows; Elevation.validate() ray-marches
  // the result at generation and fails the course if it does not.
  // 2.62 became 3.10 in constants.js, and the derivation for it is there
  // because elevation.js reads the same number. The short version: road at
  // distance d sits atan(eye / d) below the horizon, so raising the eye
  // stretches the whole road down the frame in proportion -- the 25-to-150
  // band, which is everything the player can still do something about, goes
  // from 4.75 degrees to 5.64, +18.7%, measured over twenty-two frames of a
  // real race. It does NOT push the already-committed road off the bottom of
  // the frame -- that band grows by the same scaling. The road as a whole takes
  // frame from the sky, and the future's share of it rises.
  const BASE_Y = K.CAM_BASE_Y;
  const BASE_BACK = K.CAM_BASE_BACK;
  const LOOK_Y = 1.16;
  // 8.0 -> 11.0, and it is the other half of the same move.
  //
  // Raising the eye without moving the aim point pitches the camera DOWN, which
  // hands the gain straight back: the frame centre was already looking at road
  // 18.5 units ahead, and a lower aim from a higher eye looks at road nearer
  // still. Pushing the look point out re-levels it, so the eye height buys frame
  // for the far road instead of buying more of the runner's own shadow.
  //
  // It also drops the runner in frame, which is where the reference framing puts
  // him (see the header): measured, his feet go from -0.572 to -0.700 in NDC
  // while his overall size barely moves, 0.2388 of frame height to 0.2330.
  //
  // Not larger than 11.0. The aim point is what the mile flourish, the jump arc
  // and the finish run-in all modulate from, and past about twelve units the
  // horizon sits high enough that the top-gear FOV widening starts putting sky
  // where the road ahead should be.
  const LOOK_AHEAD = 11.0;

  // ...AND THE AIM POINT NOW SCALES WITH PACE, WHICH IS THE HALF R2 DID NOT DO.
  //
  // 11.0 was tuned against a race being run -- the upper half of the pace band,
  // where R2's twenty-two frames were taken. Held constant, the same 11.0 aims
  // the start line at road the runner will not reach for half a second longer,
  // and the whole cost is paid at the bottom of the frame: the lens is level,
  // the runner hangs low in it, and at the narrow end of the FOV swing his feet
  // go under the readout.
  //
  // The read window in shoot.js already scales with speed for exactly this
  // reason -- readWindowAt is actionWindowAt + CAM_BASE_BACK, and the action
  // window is a distance the runner covers in a fixed TIME, not a fixed
  // distance. The aim point is the same kind of quantity and was the only one
  // held still. Ground speed runs 21.8 -> 28.3 u/s, a factor of 1.30, and
  // 11.0 / 1.30 is 8.5; 7.5 is one further step, taken deliberately, because
  // the start line is also where there is least worth looking at ahead.
  //
  // THE TOP OF THE BAND IS BIT-IDENTICAL. At drive = 1 this yields 11.0, and the
  // pre-existing -drive * 0.5 below then takes it to 10.5, which is exactly what
  // shipped. So everything R2 measured was measured on framing this does not
  // move -- and it could not have moved it in any case, because BLANKS casts its
  // rays from the camera's POSITION, and an aim point cannot move a position.
  //
  // Measured rather than argued. The 25-to-150 band -- the whole undecided
  // future of the run -- subtends 4.712 degrees before this change and 4.721
  // after at the start line, 5.015 and 4.984 at pace. R2's +18.7% is intact,
  // because an angle between two rays from one point cannot be changed by
  // turning the head. What IS spent is the band's share of the FRAME: 0.0745 ->
  // 0.0706 of frame height at the start, 0.0599 -> 0.0588 at mile 11. Most of
  // even that is the wider lens above rather than the aim.
  const LOOK_AHEAD_LO = 7.5;

  // THE SLIDE DOES NOT MOVE THE CAMERA. Not off the centreline, not into a
  // bank, and not much up or in.
  //
  // It used to do all three. A sidestep off the centreline, a three-and-a-half
  // degree roll, a 1.20 lift and a hard look-down were each added trying to
  // make the slide read as feet-first rather than as kneeling -- and none of
  // them worked. What actually fixed that was in the runner, not here: the
  // head had to leave the silhouette (crown 1.313 -> 0.707 in runner.js). The
  // camera work was left behind after the real fix landed.
  //
  // Measured against the jump, which is the same kind of event and the state
  // the player is comparing it to, the leftovers cost:
  //
  //             jump    slide
  //   aim       2.5deg  16.5deg     6.7x
  //   lateral   0.03    0.37        11x
  //   pull-in   0.06    0.61        10x
  //
  // Portrait's horizontal field is about 30 degrees, so a 16.5 degree swing is
  // over half of everything the player can see moving at the exact moment they
  // are committed and cannot respond -- and the next gate moves with it. The
  // player's report was simply "when I jump the camera doesn't change but when
  // I slide it does", which is the same observation from the other end.
  //
  // What survives is the pair that serve the pose rather than decorate it: a
  // small lift and a small step back, because the feet-first slide really is
  // nearly a metre longer along the travel axis than a run and would otherwise
  // crowd the bottom of the frame.
  //
  // THE LIFT WAS THE WRONG SIGN. The sentence above is right about the problem
  // and picked the remedy that makes it worse.
  //
  // Raising the eye while the aim point stays put steepens the depression angle
  // to the RUNNER faster than it steepens it to the AIM, because he is 5.1 units
  // away and the aim is 16.1: d(theta_runner - theta_aim)/d(height) is +4.82
  // degrees per unit, positive, and positive means DOWN the frame. So every
  // hundredth of lift pushed the figure further into the readout it was added to
  // keep him out of. Traced on the shipped build at 390x844, through one slide:
  // the camera climbs 3.07 -> 3.41 and the lowest row of the figure goes 60px
  // inside the panel, against 20px running.
  //
  // What actually answers "the pose is longer and closer to the lens" is
  // distance, and that is the other half of the pair -- which was sized at 0.14
  // and left to do the whole job alone. SLIDE_BACK now does it: it shrinks the
  // figure for the length of the slide without moving the eye height, without
  // pitching the lens down, and therefore without touching the sightline for the
  // one second the player is committed and cannot respond. That last clause is
  // why this is a step back and not a bigger aim term: the file already tried
  // -1.05 and -3.2 on the aim and they threw the far road out of frame.
  const SLIDE_UP = 0.0;          // was 0.34, and it was pointing the wrong way
  const SLIDE_BACK = 0.80;       // pull BACK, framing the longer pose

  // ---- THE CELEBRATION: THE ONE SHOT IN THIS GAME THAT HAS A FRONT --------
  //
  // Measured before it was designed. The runner's face owns ZERO PIXELS in 48
  // of 48 frames of play (tools/resolve.js), zero at the start panel -- which
  // is a DOM dialog over the same astern view -- and zero at the finish, whose
  // camera drifts 1.6 units off the centreline and stays BEHIND him. A whole
  // character pass built a face, two eyes with catchlights, brows that furrow
  // on effort, an open mouth and a jaw, and no player has ever seen any of it.
  //
  // So this term takes the camera round to the front. It is the only place in
  // the game where that is allowed, and the reasons it is allowed here are the
  // reasons every other flourish in this file is bounded:
  //
  //   NOTHING IS LEFT TO READ. RUNOUT (world.js) is derived from where the
  //     course's last gate actually is, the tape is behind him, and pace.js has
  //     already frozen the clock. A camera that hides the road cannot cost a
  //     player anything when there is no road left to run.
  //   IT CANNOT TOUCH THE RESULT. Everything below reads p.z, the runner's x
  //     and the world's finale verdict; it writes only to the lens. The pace
  //     model, the save and tools/simulate.js are untouched by construction.
  //   IT IS ONE MOVE, NOT A CUT. The path is polar about the runner and every
  //     term is a continuous blend of the chase camera's OWN position, so at
  //     weight 0 the shot is bit-for-bit the one that shipped.
  //
  // ---- the path, and why it has a pinch in it ----------------------------
  //
  // The chute is narrow. The finish grandstands stand at x = +/-4.30
  // (FSTAND_X), the tape posts at +/-4.05 and the arch legs at +/-6.75, so a
  // camera that swings round on a constant radius from twelve units astern
  // passes THROUGH a grandstand at the broadside quarter of the arc. CEL_PINCH
  // is what stops it: the radius is pulled in hardest exactly where the
  // azimuth is broadside and released again as the camera comes to the front,
  // which both keeps the lens inside the barriers and reads as a swoop rather
  // than as a turntable. Measured on the shipped path, the largest lateral
  // excursion from the runner is 3.63 units; taken with the mirror below (see
  // celSide) that puts the worst absolute case at 3.63 on a centre-lane finish
  // and 1.94 from either outer lane -- inside the track's own half-width of
  // 3.75, and 0.67 clear of the stands at their tightest.
  //
  // The lens goes the other way from every other flourish here: it NARROWS,
  // past FOV_MIN, to CEL_FOV. That is deliberate and it is the one exemption
  // in the file. A narrow lens is what a portrait close-up wants -- it holds
  // the head at a readable size without putting the camera inside the
  // character, and it compresses the crowd and the arch behind him instead of
  // bending them round the frame edge. FOV_MIN exists to stop stacked
  // transients from making the road unreadable; there is no road.
  const CEL_HOLD = 0.80;    // seconds the astern tape-break plays on its own
  const CEL_SWING = 1.80;   // seconds of arc, astern -> three-quarter front
  const CEL_AZ = 2.60;      // radians travelled, 0 = dead astern
  const CEL_R = 3.15;       // hero radius, and the face size falls out of it
  const CEL_PINCH = 2.40;   // radius pulled in while broadside -- see above
  const CEL_Y = 1.02;       // hero eye height: below his chest, looking up
  const CEL_AIM_Y = 0.74;   // ...and the aim, which sets where he sits in frame
  const CEL_FOV = 40;       // a long lens, deliberately outside [FOV_MIN, MAX]

  // The honest band, in world units/sec. Derived rather than typed in, so a
  // pace retune moves the camera response with it.
  const SPEED_LO = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.START_PACE;
  const SPEED_HI = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;

  /**
   * Which side of him the ending happens on: -1 if the camera should sweep to
   * -x, +1 to +x. See the block over celSide in update().
   *
   * Exported because runner.js needs the SAME answer -- the finish pose turns
   * his head toward the lens, and a head that turns the wrong way in half of
   * all finishes is worse than one that does not turn at all. Two copies of
   * this rule would have been one edit away from exactly that, so main.js
   * reads it from here and hands it to the runner.
   */
  function celSideFor(x) { return (x || 0) > 0.05 ? -1 : 1; }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  // Two incommensurate sines: shake that is smooth in time. Per-frame
  // Math.random() jitter looks like video static at 60fps and genuinely hides
  // obstacles; a wobble of the same amplitude reads twice as heavy and stays
  // readable because the eye can track it.
  function wobble(t, seed) {
    return Math.sin(t * 33.7 + seed) * 0.62 + Math.sin(t * 18.3 + seed * 2.7) * 0.38;
  }

  /**
   * Framing is aspect-dependent because three's FOV is vertical: a phone in
   * portrait sees barely a third of the horizontal angle a laptop does. The
   * lateral lag that reads as weight on a wide screen throws the runner onto
   * the edge of a portrait frame, so narrow screens follow harder, sit further
   * back, and bank less.
   *
   * ---- back USED TO GO THE OTHER WAY, AND IT CUT THE RUNNER IN HALF -------
   *
   * It read 1.18 - 0.18 * wide, so a desktop sat 15% CLOSER than a phone. The
   * three terms around it are all lateral -- follow, lookX and roll answer to
   * how far the runner swings across a frame -- and back was written as
   * though it were a fourth lateral term. It is not. The FOV is VERTICAL, so
   * back is the one term in this function that decides how far down the frame
   * the figure sits, and pulling in on a wide screen pushes him toward the
   * bottom edge of a frame that has fewer pixels below him to begin with.
   *
   * How far: at 4.35 units the feet sit atan(3.02/4.35) = 34.8 degrees below
   * horizontal against a half-field of 29, so THEY ARE OUTSIDE THE FRUSTUM. Not
   * under the HUD -- off the bottom of the picture. Swept over 48 stride phases
   * at 844x390 the lowest row of the shoe lands at 391 in a 390px frame, and at
   * 1280x800 at 804 in an 800px frame, at every pace including the fastest.
   *
   * This has been visible in six of shoot.js's eight shots since the day the
   * chase camera was written. shots/03-mid.png is committed to this
   * repository with the runner cut off mid-thigh by the readout panel, and it
   * has been through several reviews. It went unseen for the same reason the
   * mile signs did: every assertion in the suite starts from the WORLD, and
   * nothing had ever asked where a world object lands relative to the screen
   * furniture drawn on top of it.
   *
   * So the sign is corrected, and the pull-back gets its OWN ramp rather than
   * borrowing the lateral one.
   *
   * `wide` saturates at aspect 1.35, so a 16:10 desktop and a landscape phone
   * are the same number to it -- and they are not the same problem. Both are
   * wide; only one is SHORT. At 1280x800 the readout is 11% of the frame and
   * the feet miss by 25px; at 844x390 it is 24% of the frame and they miss by
   * 105. A single saturating term either under-serves the phone or shrinks the
   * desktop runner to a sprite to pay for it, and the first draft of this fix
   * did the second: it took him to about 110px, which is the very figure the
   * roadmap records this project having wrongly assumed for a year.
   *
   * So `deep` is a second ramp that starts where `wide` has already finished,
   * and it is the only thing the pull-back reads. 1280x800 gets +0.18 of it,
   * 844x390 gets +0.53.
   *
   * ASPECT IS A PROXY HERE AND THAT IS WORTH SAYING. What actually governs this
   * is the frame's HEIGHT IN PIXELS against a readout measured in pixels -- the
   * runner's angular depression is unchanged by aspect, so the collision is
   * between a constant fraction of frame height and a constant pixel block.
   * This function is only handed the aspect, and widening its signature means
   * changing main.js, which this pass does not own. The height-sensitive half
   * of the fix is therefore in style.css, where the readout can simply stop
   * being a fixed pixel block on a short frame. The two halves are independent
   * and neither needs to know about the other.
   *
   * ---- THE READOUT'S OWN CLAIM, WHICH IS THE THING ASPECT WAS STANDING IN FOR
   *
   * The paragraph above is right about the diagnosis and then declines the cure
   * on the grounds of file ownership. The bill came in. Measured on the shipped
   * build, `back` was 1.180 on EVERY portrait frame -- 320x568, 390x844,
   * 620x1344 and 920x1363 alike -- because both ramps above saturate to zero
   * below aspect 0.55 and 1.30. So the runner's lowest point sat at the same
   * fraction of frame height on all four, 0.8937 in the winded state, and the
   * whole of footroom's answer was decided by the other two terms:
   *
   *     clearance = (1 - f) * H  -  P
   *
   * f is set here and is height-blind; H is the frame; P is what the readout
   * takes at the bottom. (1-f)*H is LINEAR IN H and P is a pixel constant with
   * two media-query steps in it, so clearance falls as the frame gets shorter
   * and crosses the gate at about 640px of height. Measured: 320x568 failed
   * eleven combinations at +5.0px worst, 390x844 failed two at +10.5, and every
   * frame taller than that passed with 60px to spare. THE DEFECT IS AT THE
   * SHORT END AND ALWAYS WAS -- a taller viewport can never surface it, and no
   * amount of the aspect ramps above can see it, because 320x568 (aspect 0.563)
   * and 1280x800 (aspect 1.600) are the SAME difficulty to within 0.0003 and
   * sit at opposite ends of the only axis this function could read.
   *
   * What ranks them correctly is the readout's claim as a FRACTION of the
   * frame, (P + margin) / H, which is one number carrying H, P, every media
   * query, the safe-area inset and any future change to the plate. main.js now
   * measures it off the live element and hands it over. It is not a proxy for
   * anything; it is the left-hand side of the inequality.
   *
   * BASE_ROOM IS MEASURED, NOT CHOSEN. 0.107 is what the base framing supplies:
   * at back = 1.18 the winded figure's lowest point sits at f = 0.8937, so
   * 1 - f = 0.1063 of the frame is what there is. The ramp therefore starts
   * exactly where the framing runs out and not at a round number near it. The
   * f-against-back curve it is fitted to was swept on the running page at three
   * portrait heights and agrees to four decimal places across all of them,
   * which is the evidence that f really is height-independent and this really
   * is the whole mechanism.
   *
   * MAX, NOT PLUS, AND THAT IS THE WHOLE CARE IN THIS CHANGE. `deep` already
   * pulls back on wide-and-short frames and was tuned against 844x390 and
   * 1280x800 with numbers in the paragraphs above. Adding a second pull-back on
   * top of it would double-count exactly the way the 13px of standoff in
   * style.css double-counted the safe-area inset for two passes. Taking the
   * larger of the two means the new term is IDENTICALLY ZERO wherever the old
   * one already does the job: 1280x800 keeps back = 1.3633 and 844x390 keeps
   * 1.708, bit for bit, and only the two frames that actually fail move.
   *
   * The cost is stated rather than hidden. The runner is 8.9% smaller at
   * 320x568 and 7.6% smaller at 390x844 -- 149px to 136px and 222px to 205px
   * crown-to-sole. It buys 24px of clearance in the worst state at both. None
   * of it comes out of the middle of the frame, which is the one thing the HUD
   * layout rule protects: pulling back shows MORE road, not less, and the FOV,
   * the eye height and the aim point are all untouched.
   */
  // The clearance the camera holds for itself, in CSS px, in the WORST state --
  // which is the winded tail after a contact, because it narrows the lens by
  // five degrees and magnifies the figure. tools/footroom.js gates at 12 (a 2px
  // border, a 6px blur and 4px of raster slack); this is double, and the
  // doubling is the room for a stride phase, a state or a plate revision that
  // was not on the sweep when the ramp was fitted.
  const FOOT_MARGIN = 24;
  // What the base framing supplies, measured. See above -- do not round it.
  const BASE_ROOM = 0.107;
  const CROWD_SPAN = 0.065;   // saturates where `deep` has taken over anyway
  const CROWD_PULL = 0.20;    // fitted to the swept f-against-back curve

  // ---- THE DECK FILTER MAY LAG, BUT ONLY BY WHAT THE FRAMING CAN PAY -------
  //
  // How far above the ground the runner is ACTUALLY standing on the eye is ever
  // allowed to sit, in world units. See the note over s.dk for what the filter
  // is and why it exists; this is the bound on it, and it is derived rather
  // than chosen.
  //
  // s.dk is added to the eye AND to the aim, so it cannot change the pitch --
  // that is the whole reason the deck term was written that way, and it holds.
  // The cost of it is that the entire lag is then spent on ONE quantity: how
  // far down the frame the runner sits. He stands on p.surface while the lens
  // is framed for s.dk, so every unit of (s.dk - p.surface) is a unit of eye
  // height added over his head with nothing anywhere compensating for it.
  //
  // Measured on the running page rather than argued -- runner held on flat
  // road, dk offset on its own, nothing else moved. One unit of lag costs
  // 124-133 CSS px of footroom at 390x844, 81-88 at 320x568, 96-111 at
  // 1280x800 and 42-45 at 844x390.
  //
  // THE CLEARANCE IT IS SPENT OUT OF IS THE WORST INSTANT OF A DISMOUNT, NOT A
  // SETTLED FRAME, and that distinction is worth 0.09 units. Priced against a
  // settled sample the budget looked like (43.3 - FOOT_MARGIN) / 133 = 0.145,
  // and 0.15 measured back at only 18.4 px of clearance -- because the settled
  // frame is one stride phase and the dismount sweeps all of them. Priced
  // instead against the whole event with the lag bounded to zero, the floor is
  // 31.6 px at 390x844 at the slow end of the band, where a unit costs 120: so
  // the budget is (31.6 - FOOT_MARGIN) / 120 = 0.063 units, and this is that
  // rounded down. 320x568 is the next tightest and allows 0.111, so the phone
  // in portrait sets it.
  //
  // ---- AND THE STEP THE SMOOTHING WAS INSURING AGAINST DOES NOT EXIST ------
  //
  // The note over s.dk says the filter is a little slower than the 0.50 s fall
  // so the eye settles into the landing rather than tracking it exactly. But
  // player.js never drops the runner off a cliff: it eases surface down as
  // fallFrom * (1 - t*t) over FALL_TIME -- zero vertical speed at the lip,
  // accelerating, exactly zero at the end. The discontinuity had already been
  // removed at the source, and the filter was paying for insurance against it
  // with the runner's feet. Traced at 390x844 through one dismount from a 2.80
  // deck: the runner is back on the road while the eye is still 1.15 above it,
  // and the lowest row of his shoe lands 104 px INSIDE the readout panel --
  // which on an 844 px frame is off the bottom of the picture.
  //
  // What the smoothing does still earn is the UPWARD steps, which are real: a
  // sideways mount onto the middle of a ramp sets surface from course.deckAt in
  // a single frame. So the ease is untouched in that direction and this bound
  // is one-sided. Off a deck p.surface is 0 and s.dk is 0, so on every frame of
  // a race that never meets a lorry this changes nothing at all.
  const DK_LAG = 0.06;

  function frameFor(aspect, bottomPx, heightPx) {
    const wide = clamp01((aspect - 0.55) / 0.80);   // 0 = phone portrait, 1 = desktop
    const deep = clamp01((aspect - 1.30) / 0.90);   // 0 = anything taller than 4:3
    // Zero when main.js has nothing to hand over -- during boot, before the HUD
    // exists, and for anything that drives this module without a page. That is
    // the shipped behaviour before this term, so the fallback is the old code.
    const need = (bottomPx > 0 && heightPx > 0)
      ? (bottomPx + FOOT_MARGIN) / heightPx
      : 0;
    const crowd = clamp01((need - BASE_ROOM) / CROWD_SPAN);
    return {
      follow: 0.95 - 0.17 * wide,
      lookX: 0.85 - 0.30 * wide,
      back: 1.18 + Math.max(0.55 * deep, CROWD_PULL * crowd),
      roll: 0.70 + 0.30 * wide,
    };
  }

  /**
   * ---- HILLS: TWO TERMS, AND THEY ARE DELIBERATELY NOT THE SAME ONE --------
   *
   * The camera samples the road profile TWICE, once under itself and once
   * under its look point, and the whole pitch behaviour falls out of the fact
   * that those two points are 12 units apart:
   *
   *   on a constant grade   both rise together, so the camera climbs the road
   *                         with the horizon held where it belongs
   *   cresting              E(look) < E(cam), so the camera pitches DOWN and
   *                         the far road falls away
   *   into a climb          E(look) > E(cam), so it pitches UP and the road
   *                         fills the frame
   *
   * The camera also sits BASE_BACK behind the runner, so at a crest it is
   * momentarily still on the near flank and the runner rises in frame -- which
   * is what cresting a hill looks like from behind.
   *
   * Nothing else in this file changes. Every effect it owns already keys off
   * `speed`, and `speed` is grade-inclusive, so the FOV, the pull-in, the
   * cadence-locked bob and the trail all quicken on a descent for free. The one
   * signal that must NOT is the top-gear latch: it reads sp01 from the smoothed
   * speed, and a steep descent would fire the one-shot flourish and the
   * permanent rumble spuriously. main.js therefore hands `speed` (grade-
   * inclusive) and `gearSpeed` (flat, from pace.streakSpeed) separately.
   */
  function create(aspect, bottomPx, heightPx) {
    const cam = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 1200);
    const look = new THREE.Vector3();   // hoisted: this runs 60x a second
    // The course's road profile, handed over by main.js once the course
    // exists. Flat until then, and flat for anything that never sets it.
    let elev = MR.Elevation.FLAT;

    const s = {
      camera: cam,
      fr: frameFor(aspect, bottomPx, heightPx),
      x: 0, vx: 0,     // lateral follow, sprung so a lane change whips
      roll: 0,
      fov: BASE_FOV,

      t: 0,            // clock for the wobble functions
      stride: 0,       // stride phase, mirrors the runner's cadence
      primed: false,   // first frame snaps the speed filter
      sp: SPEED_LO,    // smoothed ground speed, grade included
      gsp: SPEED_LO,   // smoothed STREAK speed, grade removed -- top gear only
      drive: 0,        // 0..1 pace within the honest band, shaped
      accel: 0,        // smoothed d(speed)/dt -- the surge signal

      shake: 0,        // trauma, 0..1
      punch: 0,        // one-shot impact roll
      lurch: 0,        // one-shot impact sidestep
      winded: 0,       // long tail after a hit: the camera loses its nerve
      dip: 0, dipV: 0, // sprung landing compression
      kick: 0,         // short FOV punch (landing)

      pDuck: 0,        // last frame's duck01, for edge-detecting slide entry
      // ---- the second running surface ------------------------------------
      //
      // THE PROBLEM, STATED BEFORE THE FIX. The resting eye is K.CAM_BASE_Y,
      // 3.10 above the road, and it aims at LOOK_Y, 1.16 above the road. Put
      // the runner on a 2.80 roof and his feet are at 2.80 and his crown at
      // 4.58, so the eye sits 1.48 BELOW his head while pointing at a spot 1.64
      // below his feet -- the lens is looking at the flank of the lorry he is
      // standing on, with the runner cropped off the top of the frame and no
      // road visible at all.
      //
      // The fix is the one this file already uses for hills, and deliberately
      // so: the terrain terms add elev.at() to the eye and to the aim, and the
      // deck is the same kind of quantity one lane wide. It is added to BOTH,
      // so the pitch of the lens is unchanged and every framing number this
      // file was tuned against still holds -- the whole shot simply rises with
      // the ground, which is what cresting a hill already does.
      //
      // IT READS THE RUNNER'S OWN SURFACE, NOT THE COURSE. Sampling the deck
      // under the LENS (which is 4.35 back, and during a mount is still on the
      // road) would pitch the camera up at the truck for the length of the
      // tailgate and then snap. Sampling under the RUNNER means the shot rides
      // with him, and the smoothing below is what absorbs a step in the surface
      // -- a sideways mount onto the middle of a ramp sets it in one frame.
      //
      // THE SENTENCE THAT USED TO END THIS PARAGRAPH WAS WRONG AND IT COST THE
      // RUNNER HIS FEET. It read that the filter is deliberately a little
      // slower than the 0.50 s fall, so the eye settles into the landing rather
      // than tracking it exactly. There is no cut to settle: player.js already
      // eases the surface down as a curve with zero vertical speed at the lip,
      // so the only thing the extra slowness bought was an eye left hanging
      // over a runner who had already landed. The lag is now bounded at the one
      // place it is spent -- see DK_LAG, which is measured in the CSS pixels of
      // footroom it costs.
      dk: 0,           // smoothed surface height under the runner

      mile: -1,        // last whole mile crossed
      mileT: 0,
      gearT: 0, gearArmed: true,
      finish: 0,
      // Seconds since the tape, in REAL time, and the celebration's whole
      // clock. Kept here rather than read off world.finale.since so the move
      // survives a world built without a game around it (course-test.js) and
      // so a screenshot harness can drive it by pumping dt like everything
      // else in this file.
      cel: 0,
      celW: 0,         // 0..1 blend into the front shot; exposed for tooling
    };

    /**
     * @param dt  real seconds
     * @param p   { z, x, y, speed, lean, duck01 }
     */
    s.update = function (dt, p) {
      // A long frame must not be allowed to detonate the springs -- and the
      // first frame can arrive with a *negative* dt, because the rAF timestamp
      // is the moment the frame began, which on a slow boot is earlier than
      // the clock main.js took when it started. Integrating a spring backwards
      // through 1.5 seconds throws the camera tens of units sideways, and the
      // recovery is slow enough to be caught by a screenshot.
      const d = dt > 0 ? Math.min(dt, 1 / 25) : 0;
      s.t += d;

      // ---- speed signals -------------------------------------------------
      // Smoothing is deliberately slow: pace itself eases, and an unsmoothed
      // derivative would make the camera twitch on every pace step.
      // The first frame snaps instead of easing, or ?skip= would start every
      // deep-race screenshot with a phantom 6 u/s surge that never happens in
      // a real run.
      const first = !s.primed;
      if (first) { s.primed = true; s.sp = p.speed; s.gsp = p.gearSpeed || p.speed; }
      const prev = s.sp;
      s.sp += (p.speed - s.sp) * (1 - Math.pow(0.02, d));
      const rawAccel = d > 0 ? (s.sp - prev) / d : 0;
      s.accel += (rawAccel - s.accel) * (1 - Math.pow(0.05, d));
      // The STREAK's speed, with the hill taken back out. Only the top-gear
      // latch reads it -- see the header: finding another gear is something an
      // unbroken line buys, never something pointing downhill buys.
      s.gsp += ((p.gearSpeed === undefined ? p.speed : p.gearSpeed) - s.gsp)
        * (1 - Math.pow(0.02, d));

      const sp01 = clamp01((s.sp - SPEED_LO) / (SPEED_HI - SPEED_LO));
      const gear01 = clamp01((s.gsp - SPEED_LO) / (SPEED_HI - SPEED_LO));
      // Most of a good run is spent in the upper half of the band, so bias the
      // response there: the difference the player should feel is between
      // "quick" and "flat out", not between the start line and mile 3.
      const drive = Math.pow(sp01, 0.85);
      const gear = smoothstep(0.70, 0.99, gear01);    // the top-gear state
      // Kept for impact(): pace *is* the streak, so how fast the runner was
      // going when they hit something is an honest measure of how much the
      // hit just cost them. See impact().
      s.drive = drive;
      // +/- 1 over the range the pace ease can actually produce -- and the
      // single divisor of 3.2 was not that range.
      //
      // Measured on this signal, 7,460 samples of real play at bot=0.85: the
      // camera's own smoothed accel reaches +0.702 gaining and -1.327 losing.
      // Against a divisor of 3.2 that capped the ACCELERATION cue at 0.219 of
      // full while a hit reached 0.415 -- so the effect named "surge" was
      // barely half the size of its opposite, and the header's claim that
      // streak-driven acceleration is "up to ~4 u/s^2" is out by 5.7x. That
      // wrong number is where 3.2 came from.
      //
      // The two sides are not symmetric in the game either, so they should not
      // share a divisor: gaining pace is the streak easing a target, losing it
      // is a contact dumping the streak at once.
      //
      // Only the gaining side is renormalised here, and the restraint is
      // deliberate rather than timid. Surge on the way up WIDENS the FOV and
      // trails the camera back -- both reveal more road, so a bigger value
      // cannot hide a gate. On the way down it narrows and closes in, which
      // is the one direction that can, it already stacks with `winded` at
      // -5.0 FOV, and this project fails builds over hazards a player could
      // not see. Making the punish cue 2.4x stronger is a difficulty change
      // and wants a playtest, not an arithmetic fix.
      const SURGE_UP = 0.70;      // measured ceiling, gaining
      const surge = s.accel >= 0
        ? Math.min(1, s.accel / SURGE_UP)
        : Math.max(-1, s.accel / 3.2);

      // ---- one-shot beats ------------------------------------------------
      // Mile marker: a short lift and pull-back, so the milestone is a breath
      // in the camera and not only a line of HUD text.
      const mileNow = Math.floor(p.z / K.UNITS_PER_MILE);
      if (s.mile < 0) s.mile = mileNow;                // fresh start or ?skip=
      else if (mileNow > s.mile) { s.mile = mileNow; s.mileT = 1; }
      s.mileT = Math.max(0, s.mileT - d * 0.95);

      // Top gear: fire once when the pace floor is essentially reached, and
      // re-arm only if a hit drags the run back out of it. This is the moment
      // the 21% is supposed to feel like a different race.
      if (first) s.gearArmed = gear01 < 0.93;           // no flourish for ?skip=
      else if (s.gearArmed && gear01 > 0.93) { s.gearArmed = false; s.gearT = 1; }
      if (!s.gearArmed && gear01 < 0.72) s.gearArmed = true;
      s.gearT = Math.max(0, s.gearT - d * 1.15);

      // Going to ground. The held slide pose is the hard thing to read from
      // behind and it always will be -- the legs point down the view axis --
      // so the entry is where the state gets named, and it has to arrive as an
      // event rather than as a shape that fades in. This is the same spring
      // the landing uses, fired on the way DOWN: the camera drops with the
      // body and rebounds, and the FOV kick throws the near road outward for a
      // few frames. Fired on the edge, not held, so it cannot stack with a
      // second duck or leave the camera sitting low over a gate.
      const duckNow = p.duck01 || 0;
      if (duckNow > 0.18 && s.pDuck <= 0.18) {
        // Kept, but a third of its old size. The entry beat is the slide's
        // analogue of the jump's landing beat, and the jump gets exactly one
        // such beat -- so this gets one, of comparable weight, and the pose
        // itself is then left alone.
        s.dipV -= 1.4;
        s.kick = Math.min(1, s.kick + 0.12);
      }
      s.pDuck = duckNow;

      // ---- the finish ------------------------------------------------------
      /**
       * THE ONLY PLACE THE CAMERA IS ALLOWED TO ABANDON THE CHASE, and it now
       * does it in two movements instead of one.
       *
       * The old term fired only once the runner was ON the line, pulled back
       * 3.4 units, lifted 1.7 and NARROWED the lens by nine degrees. Measured
       * on the shipped frame, that put the camera 8.5 units behind a finish
       * arch 13.5 units wide with a portrait horizontal field of about 30
       * degrees: half-width in frame at the tape was 2.6 units against a tape
       * that spans 8.1 and posts at 4.05. The arch, the tape, both its posts
       * and every piece of the celebration were outside the frame at the exact
       * moment they happened, and narrowing the lens was making it worse. The
       * comment in this file said the term "fires into a scene with nothing in
       * it to look at"; the truer version is that it could not have looked at
       * it.
       *
       * So:
       *   RUN-IN   over the last RUNOUT units of clear tarmac -- a number
       *            world.js derives from where the course's last gate actually
       *            is, so this can never begin while a gate is still to be
       *            read -- the camera falls back and rises to about fourteen
       *            units, which is what a 4.4-unit half-width needs in
       *            portrait. It also WIDENS. Both of those only ever show more
       *            road, which is the rule this file already holds every
       *            flourish to.
       *   TAPE     once the line is crossed it keeps going, higher and wider,
       *            and drifts laterally so the shot is three-quarter rather
       *            than dead astern -- a symmetrical shot down an empty road
       *            reads as a pause, and this is the opposite of a pause.
       *
       * The verdict rides it too. A record pulls further, rises higher and
       * leans harder than a run that came apart, because the camera should be
       * saying the same thing the crowd and the confetti are saying.
       */
      const fin0 = MR.game && MR.game.world && MR.game.world.finale;
      const runIn = fin0 ? fin0.run : 0;
      const glory = fin0 && fin0.record ? 1 : (fin0 ? fin0.chase * 0.45 : 0);
      // WHICH SIDE THE ENDING HAPPENS ON, AND IT IS NOT A CONSTANT ANY MORE.
      //
      // The drift below used to be a flat +1.1 to +1.6 whatever lane the runner
      // finished in, and the arc that now follows it made that a real problem
      // rather than an untidiness: the grandstands stand at x = +/-4.30 and the
      // outer lane centre is +2.50, so a camera pushed a further 3.6 out on the
      // same side flies through a stand full of spectators. (The old drift
      // already put the lens at 3.6 -- over the shoulder, outside the track's
      // own 3.75 half-width -- on a right-lane finish; nothing measured it
      // because nothing had ever asked where that camera was in absolute x.)
      //
      // So the ending goes to the side with room. It is still not random and
      // still not a chase -- it is a mirror, decided once by the lane he
      // crossed the line in, so a given run frames identically every replay --
      // and it holds the lens inside the barriers from every finishing lane:
      // measured, the largest excursion over all three is 3.63, against a
      // track half-width of 3.75 and stands at 4.30.
      const celSide = celSideFor(p.x);
      // Squared: nothing happens for the first half of the run-in, then the
      // camera lets go. A linear fall-back starts drifting while the player is
      // still running and reads as the game losing interest.
      const runE = runIn * runIn;
      if (p.z >= K.TOTAL_UNITS - 0.25) s.finish = Math.min(1, s.finish + d / 1.2);
      const fin = s.finish * s.finish * (3 - 2 * s.finish);
      // Seconds since the tape, handed over by main.js rather than accumulated
      // here. It is deliberately NOT integrated from `d`: d is clamped to 1/25
      // so a long frame cannot detonate the springs above, and a parametric
      // camera path integrated through that clamp plays at 28% speed on a 7fps
      // machine while the results card, on a real timer, arrives a third of the
      // way through the move. One clock, unclamped, shared with the pose in
      // runner.js -- see the note over celClock in main.js.
      s.cel = p.celT || 0;
      // The celebration weight. Zero for the whole race and for the first
      // CEL_HOLD seconds after the tape, so the break, the confetti and the
      // wide astern shot all play exactly as they did before this pass.
      const cel01 = clamp01((s.cel - CEL_HOLD) / CEL_SWING);
      // Smootherstep, not smoothstep: this one drives an azimuth through 149
      // degrees and the second derivative is visible at both ends of a move
      // that large. 6t^5-15t^4+10t^3 leaves the astern shot and arrives at the
      // hero shot with zero acceleration as well as zero velocity.
      const cw = cel01 * cel01 * cel01 * (cel01 * (cel01 * 6 - 15) + 10);
      s.celW = cw;
      // Widen with the pull so the arch (13.5 wide, 14.7 tall) clears the frame
      // edges rather than being cropped by them.
      // Tuned by measuring the frame, not by feel. At the tape the camera is
      // 8.2 units back with a 73-degree lens: half the frame width there is
      // 3.5 units, so the tape (which spans 8.1) crosses the WHOLE frame at
      // chest height and its two halves whip out past the edges when it goes,
      // while the runner still stands 15% of the frame tall. Pulling far
      // enough to see both posts needs fourteen units and puts the runner at
      // 8% -- a diagram of a finish rather than a finish. The wide shot is
      // worth having, so it arrives AFTER the break instead of instead of it.
      const finFov = runE * 3.0 + fin * 3.0;
      const finBack = (runE * 4.3 + fin * 3.2 * (1 + 0.25 * glory)) * s.fr.back;
      const finUp = runE * 1.2 + fin * (2.4 + 1.0 * glory);

      // ---- decays ---------------------------------------------------------
      s.shake = Math.max(0, s.shake - d * 2.1);
      s.punch = Math.max(0, s.punch - d * 3.4);
      s.winded = Math.max(0, s.winded - d * 0.45);
      s.kick = Math.max(0, s.kick - d * 4.2);

      // Landing compression, as a spring rather than a decay so it rebounds.
      s.dipV += (-s.dip * 340 - s.dipV * 24) * d;
      s.dip += s.dipV * d;

      // ---- lateral --------------------------------------------------------
      // Underdamped on purpose (zeta ~0.6): the camera arrives at the new lane
      // slightly late and overshoots a hair, which is the weight the old
      // exponential follow was missing.
      const tgtX = p.x * s.fr.follow + s.lurch;
      if (first) s.x = tgtX;        // a real race starts centred; ?skip= may not
      s.vx += ((tgtX - s.x) * 200 - s.vx * 17) * d;
      s.x += s.vx * d;
      s.lurch -= s.lurch * Math.min(1, d * 5.0);

      // ---- stride ---------------------------------------------------------
      // Same cadence curve as the runner so the bob lands on the footfalls.
      // Cadence rises ~16% across the band; on its own that is nothing, but
      // under a camera that is also lower and wider it is the difference
      // between a jog and a hunt.
      // The deck under the runner. Snapped on the first frame for the same
      // reason the speed filter is: ?skip= can start a shot with the runner
      // already on a roof, and easing up to it would photograph the camera
      // halfway through a move that never happened in a real run.
      const dkTarget = p.surface || 0;
      if (first) s.dk = dkTarget;
      else {
        s.dk += (dkTarget - s.dk) * (1 - Math.pow(0.004, d));
        // One-sided, and Math.min for the same reason the crowd term above is a
        // Math.max: it is IDENTICALLY the shipped line everywhere the shipped
        // line already framed him, and can only bite while the ground is
        // leaving from under his feet. See DK_LAG.
        s.dk = Math.min(s.dk, dkTarget + DK_LAG);
      }

      const air = clamp01((p.y || 0) / 1.2);
      const cadence = 2.55 * Math.pow(s.sp / 22, 0.72);
      s.stride = (s.stride + d * cadence) % 1;
      const ph = s.stride * Math.PI * 2;
      const bobAmp = (0.020 + 0.026 * drive) * (1 - air) * (1 - fin);
      const bobY = -Math.abs(Math.sin(ph)) * bobAmp;        // fall on footfall
      const bobX = Math.sin(ph) * bobAmp * 0.55;
      // A footfall also eats a little of the gap: the camera surges in on the
      // drive phase and drifts back on the float. Tiny, but it turns a smooth
      // dolly into something being pushed by legs.
      const bobZ = Math.sin(ph * 2) * (0.014 + 0.030 * drive) * (1 - air) * (1 - fin);

      // ---- shake ----------------------------------------------------------
      // Trauma squared, plus a permanent tremble at top gear: at the pace
      // floor the frame should never be completely still.
      const tr = s.shake * s.shake;
      const rumble = gear * 0.045 * (1 - fin);
      const shX = wobble(s.t, 0.0) * (tr * 0.20 + rumble);
      const shY = wobble(s.t, 1.7) * (tr * 0.16 + rumble * 0.7);
      const shR = wobble(s.t, 3.1) * (tr * 0.030 + rumble * 0.10);

      // ---- placement ------------------------------------------------------
      const duck = p.duck01 || 0;

      // Closer and lower with pace; the ground is what sells it, so the drop
      // is worth more than the pull-in. Surge trails the camera while the
      // streak is buying speed and reels it in while a hit bleeds it away.
      const back = BASE_BACK * s.fr.back
        - drive * 0.62
        + surge * 0.30
        // Pull BACK in a slide rather than closing in: the feet-first pose is
        // nearly a metre longer along the travel axis than a run, so closing
        // in put the figure 87% down the frame with its legs clipped off the
        // bottom edge. This term has read `- duck * 0.55` under a comment
        // saying it backed off -- `back` is subtracted from p.z, so a negative
        // coefficient closes IN, and it had been closing in by 0.55 the whole
        // time. Now it does what the comment always said.
        + duck * SLIDE_BACK
        - s.gearT * s.gearT * 0.45
        + s.mileT * 0.45
        + s.winded * 0.28
        + bobZ
        + finBack;

      // The pace drop is halved from 0.41. Dropping toward the road is a good
      // speed cue, but it was spending the sightline computed above at exactly
      // the moment the player is fastest and most needs to read ahead -- the
      // camera was lowest, and the gates tightest, on the same stretch.
      const hgt = BASE_Y
        - drive * 0.20
        // A slide RAISES the camera instead of lowering it -- the feet-first
        // pose extends back along the travel axis, so dropping with it pushed
        // the runner off the bottom of the frame. Enough to keep him framed,
        // and no more: at the old 1.20 this alone was twice the jump's whole
        // vertical travel.
        + duck * SLIDE_UP
        + (p.y || 0) * 0.30            // keeps a third of the arc -- see aim
        + s.dip
        + s.mileT * 0.24
        + s.winded * 0.12
        + bobY + shY
        + finUp
        // The road under the LENS, which is BASE_BACK behind the runner.
        + elev.at(p.z - back)
        // ...and the roof under the RUNNER, if he is on one. See `dk`.
        + s.dk;

      // The lateral drift at the tape: a slow swing off the centreline so the
      // finish is seen from three-quarters and the stands on one side crowd
      // the frame. Fixed direction rather than random -- the finish should look
      // the same in every replay and every screenshot.
      cam.position.set(s.x + bobX + shX + celSide * fin * (1.1 + 0.5 * glory),
        hgt, p.z - back);

      // ---- aim ------------------------------------------------------------
      // The look point follows the jump arc *more* than the camera does, so
      // the camera pitches up as the runner rises: the road falls away in
      // frame, which is what leaving the ground actually looks like. The old
      // 0.42/0.30 split had the camera chasing the arc and cancelled it.
      // The slide's aim terms are deliberately small. They used to be -1.05 and
      // -3.2, which between them pitched the camera down hard enough to throw
      // the far road out of frame for the length of the slide. They now do just
      // enough to acknowledge that the body went down.
      // The aim point rises with the pull so the arch and the bunting are in
      // the upper third rather than off the top, and it draws IN toward the
      // runner at the tape -- the run-in is a wide shot of a place, the tape is
      // a shot of a person arriving in it.
      // The aim point's own z, hoisted out so the road under it can be sampled.
      // The gap between this and (p.z - back) is what makes the camera pitch
      // with the grade; see the header.
      //
      // LOOK_AHEAD_LO at the start line, LOOK_AHEAD at the pace floor. Read
      // off drive, which is the same shaped pace signal the FOV, the pull-in
      // and the cadence all key off, so the whole frame opens out together as
      // the run comes up to speed instead of the lens doing it alone. It also
      // means the ?skip= snap still holds without a new special case: drive
      // comes from s.sp, and s.sp is snapped on the first frame.
      const ahead = LOOK_AHEAD_LO + (LOOK_AHEAD - LOOK_AHEAD_LO) * drive;
      const lookZ = p.z + ahead - duck * 0.90 + (p.y || 0) * 1.1 - drive * 0.5
        - runE * 1.8 - fin * 5.0;
      look.set(
        // At the tape the aim goes onto the runner himself rather than onto
        // the damped follow point. The lateral drift below moves the CAMERA,
        // and without this the whole finish -- arch, tape, backdrop -- slid to
        // whichever frame edge the last lane change had left the follow on.
        s.x * s.fr.lookX * (1 - fin) + (p.x || 0) * fin,
        LOOK_Y + (p.y || 0) * 0.50 - duck * 0.30 - drive * 0.22
          + runE * 1.1 + fin * 1.3
          + elev.at(lookZ)
          // The SAME term as the eye, not a sampled one. Adding the deck to the
          // eye alone would pitch the lens down by atan(2.80 / 16.1) = 9.9
          // degrees for the whole ride, which is a third of a portrait frame's
          // horizontal field spent looking at the roof he is standing on.
          + s.dk,
        lookZ
      );

      // ---- and round to the front ------------------------------------------
      //
      // Everything above produced the chase camera's own position and aim, and
      // this converts that position into POLAR COORDINATES ABOUT THE RUNNER and
      // walks it round. Doing it in polar rather than lerping the two cartesian
      // endpoints is the whole of why it reads as a move: the straight line
      // from twelve units astern to three units in front passes 2.1 units from
      // his head, so a cartesian blend is a camera flying through the subject
      // while the aim whips to keep up. An arc is a camera walking round him.
      //
      // It also means the start of the arc is not a number in this file. It is
      // wherever the chase camera happens to be -- which still carries the
      // lateral drift, the last of the shake and the tape-break pull -- so
      // there is no frame at which anything jumps.
      if (cw > 0) {
        const px = p.x || 0, pz = p.z;
        // The ground he is standing on, added to both the eye and the aim for
        // the reason the hill terms already are: it moves the whole shot, not
        // the pitch. Flat at the finish today; correct if that ever changes.
        const gy = elev.at(pz) + s.dk;
        const dx0 = cam.position.x - px, dz0 = cam.position.z - pz;
        const r0 = Math.sqrt(dx0 * dx0 + dz0 * dz0);
        // Azimuth measured from DEAD ASTERN, in the frame celSide mirrors into
        // -- so it is always "toward the middle of the road" and the sweep has
        // one unambiguous direction. The chase camera at this point is always
        // astern (dz0 < 0) and always a little to the celSide side of him (the
        // tape-break drift is 1.1 to 1.6 and the follow can only move it by
        // 0.13), so a0 is a small positive angle. Everything below stays in the
        // mirrored frame and is multiplied back out at the position write,
        // which is the one place the sign can be got wrong.
        const a0 = Math.atan2(celSide * dx0, -dz0);
        // The radius arrives ahead of the azimuth (the 0.30 exponent), so the
        // camera has already closed most of the distance by the time it is
        // broadside. That is what keeps the arc inside the barriers, and it is
        // also the shape of the move: come in, then come round.
        const rw = Math.pow(cw, 0.30);
        // The HEIGHT comes down faster still, and that was measured off a frame
        // rather than reasoned. Eased on rw, the lens is 3.15 up at the
        // broadside quarter of the arc and looking down on the top of his cap
        // -- which is where the raised-arms gesture happens, so the one beat
        // the pose exists for was being photographed from above. 0.20 puts the
        // same instant at 2.11 and the shot on his chest.
        const hw = Math.pow(cw, 0.20);
        const az = a0 + (CEL_AZ - a0) * cw;
        const rr = (r0 + (CEL_R - r0) * rw) - CEL_PINCH * 4 * cw * (1 - cw);
        cam.position.set(
          px + celSide * Math.sin(az) * rr,
          cam.position.y + ((CEL_Y + gy) - cam.position.y) * hw,
          pz - Math.cos(az) * rr
        );
        // The aim goes onto the runner himself. CEL_AIM_Y is BELOW the eye, so
        // the lens tips up at him -- and it is low enough to hold his feet
        // clear of the readout panel, which on a 390x844 phone is a quarter of
        // the frame. See the measured framing in tools/celebrate.js.
        // THE AIM ARRIVES ON `rw`, NOT ON `cw`, AND THAT IS A COMPOSITION FIX
        // RATHER THAN A TASTE ONE. The chase aim at the tape sits at y 3.56 --
        // LOOK_Y plus the run-in and break lifts, which exist to get the arch
        // and the bunting into frame. Blended out linearly it is still at 1.39
        // when the camera has closed to 2.7 units, so the figure hangs below
        // the frame centre at the exact moment he is largest, and his legs go
        // 238 px inside the opaque readout panel. Arriving on the same eased
        // weight the RADIUS uses keeps the aim ahead of the approach, and the
        // lowest row of the figure stays clear of the panel through the whole
        // move -- measured, and printed by tools/celebrate.js.
        look.set(
          look.x + (px - look.x) * rw,
          look.y + ((CEL_AIM_Y + gy) - look.y) * rw,
          look.z + (pz - look.z) * rw
        );
      }
      cam.lookAt(look);

      // Roll: the lean term is the body, the camera's own lateral velocity is
      // the whip that outlasts it. Old value was 0.055 * lean -- barely two
      // degrees, below the threshold of being felt at all. This peaks around
      // seven, which is a bank; the response is fast because a lane change is
      // over in 0.16s and a slow filter would smooth the whole event away.
      const whip = Math.max(-1, Math.min(1, s.vx / 20));
      const rollTgt = -((p.lean || 0) * 0.16 + whip * 0.07) * s.fr.roll * (1 - fin);
      s.roll += (rollTgt - s.roll) * (1 - Math.pow(0.00002, d));
      // No bank on the slide. It was three and a half degrees of tilt bought to
      // break the frame's bilateral symmetry, back when that was believed to be
      // why the pose read as kneeling. It was not, and the horizon rolling
      // under a committed player is exactly the kind of camera movement a jump
      // never asks them to absorb.
      cam.rotation.z += s.roll + shR - s.punch * 0.055;

      // ---- fov ------------------------------------------------------------
      // Widening while pulling in keeps the runner the same size on screen and
      // accelerates everything around them. The winded term narrows instead,
      // so a hit reads as the world closing in -- and, importantly, a punished
      // player can still see the gate they have to make.
      const targetFov = BASE_FOV
        + SPEED_FOV * drive
        + GEAR_FOV * gear
        + s.gearT * 5.0
        + surge * 3.5
        + duck * 1.0            // was 2.5 -- the jump's own air term is 1.6
        + air * 1.6
        + s.kick * 6
        - s.winded * 5.0
        - s.mileT * 1.5
        + finFov;
      // Fast toward a wider frame, slower back: gaining speed should feel
      // immediate, losing it should feel like it is being taken away.
      const fovRate = targetFov > s.fov ? 0.02 : 0.12;
      const fovGoal = Math.max(FOV_MIN, Math.min(FOV_MAX, targetFov));
      if (first) s.fov = fovGoal;                       // ?skip= starts settled
      else s.fov += (fovGoal - s.fov) * (1 - Math.pow(fovRate, d));

      // The celebration lens is crossfaded ON TOP of the chase lens rather
      // than folded into targetFov, and that is not tidiness. s.fov is a
      // stateful filter whose slow half (0.12, a 0.47s time constant) exists
      // so that losing speed feels like it is being taken away -- driving a
      // 34-degree narrowing through it would smear the push-in over half the
      // shot. cw is already smootherstep-shaped, so this needs no filter of
      // its own, and at cw = 0 the output is s.fov exactly.
      const fovOut = s.fov + (CEL_FOV - s.fov) * cw;
      if (Math.abs(cam.fov - fovOut) > 0.01) {
        cam.fov = fovOut;
        cam.updateProjectionMatrix();
      }
    };

    /**
     * Contact. This costs the player their record, so it gets the whole
     * vocabulary: a lurch, heavy damped shake, and a two-second winded tail
     * where the camera sits back, lifts, and narrows while the pace bleeds.
     *
     * Weighted by current pace, which is the only honest read on streak length
     * the camera has: 4:20/mi means ~170 clean gates in a row, and losing that
     * should not land the same as clipping the second gate of the race.
     */
    s.impact = function (amount) {
      const a = (amount === undefined ? 1 : amount) * (0.6 + 0.7 * s.drive);
      s.shake = Math.min(1.5, s.shake + 1.15 * a);
      s.punch = Math.min(1.2, s.punch + 0.9 * a);
      s.winded = Math.min(1, s.winded + 0.85 * a);
      s.dipV -= 5.5 * a;
      s.kick = Math.min(1, s.kick + 0.3 * a);
      // Knocked off the racing line. The side alternates with the clock so a
      // player who hits three gates in a mile does not see the same canned
      // stagger three times.
      s.lurch = (Math.sin(s.t * 12.9) >= 0 ? 1 : -1) * 0.42 * a;
    };

    /** Landing: compression into the road, then a rebound. Heavier at pace. */
    s.land = function () {
      const w = 0.8 + 0.4 * s.drive;
      s.dipV -= 3.6 * w;
      s.shake = Math.min(1.5, s.shake + 0.30 * w);
      s.kick = Math.min(1, s.kick + 0.35);
    };

    /** The course's road profile. Handed over by main.js once it exists. */
    s.setElevation = function (e) { elev = e || MR.Elevation.FLAT; };

    // `bottomPx` is what the readout has taken at the bottom of the frame, from
    // hud.bottomClaim(). Omitted or null keeps the claim already in force rather
    // than dropping to zero -- a resize that happens to land while the plate is
    // mid-transition must not hand the whole crowd term back for a frame.
    s.claim = (bottomPx > 0) ? bottomPx : 0;
    s.resize = function (aspect, bottomPx, heightPx) {
      cam.aspect = aspect;
      if (bottomPx > 0) s.claim = bottomPx;
      s.fr = frameFor(aspect, s.claim, heightPx);
      cam.updateProjectionMatrix();
    };

    s.reset = function () {
      s.x = 0; s.vx = 0; s.roll = 0; s.fov = BASE_FOV;
      s.t = 0; s.stride = 0; s.primed = false;
      s.sp = SPEED_LO; s.gsp = SPEED_LO; s.drive = 0; s.accel = 0;
      s.shake = 0; s.punch = 0; s.lurch = 0; s.winded = 0;
      s.dip = 0; s.dipV = 0; s.kick = 0;
      s.pDuck = 0; s.dk = 0;
      s.mile = -1; s.mileT = 0; s.gearT = 0; s.gearArmed = true; s.finish = 0;
      s.cel = 0; s.celW = 0;
      cam.fov = BASE_FOV;
      cam.updateProjectionMatrix();
    };

    return s;
  }

  return { create, BASE_FOV, celSideFor };
})();
