/**
 * The record ghost: 1:59:30 put on the road.
 *
 * Until now the record existed only as a number in the corner of the screen,
 * which is the one place a race is never actually decided. Sonic Forces Speed
 * Battle puts its rivals on the track ahead of you with a floating name tag,
 * and that is the model here: the ghost is a runner travelling the course at
 * exactly RECORD_PACE, so "you are 1:52 down" stops being a split and becomes
 * a figure up the road that you spend twenty miles reeling in.
 *
 * The shape of the race is what makes this worth doing at all. A flawless run
 * peaks 131 world units behind the ghost around mile 6, closes the gap all the
 * way through the middle third, draws level at mile 20.6, and finishes 66
 * units clear. Because the camera sees ~210 units, that means the ghost is on
 * screen for four fifths of a good race and the crossover happens in plain
 * sight -- at the pass the two are closing at only 1.4 units/sec, so they run
 * shoulder to shoulder for the best part of ten seconds.
 *
 * IT IS A MARKER, NOT A RACER. Nothing in this file reads or writes anything
 * the simulation owns: it takes pace.ghostMiles() and draws it. No collision,
 * no streak, no clock.
 *
 * ---- the three problems, and what they cost ----
 *
 * 1. IT MUST NEVER READ AS A HAZARD -- BUT IT HAS TO READ AS SOMETHING. This
 *    used to be solved by stripping the ink outright, on the argument that in
 *    a scene where every solid thing wears a black line the absence of one is
 *    the loudest available "not real". The argument is right about the signal
 *    and wrong about the cost, and an art review put the cost plainly: with no
 *    line, no depth sorting and fourteen translucent primitives blending
 *    through each other, the most narratively important object in the game --
 *    the world record, personified -- rendered as a blue smear and read as a
 *    rendering fault. A marker nobody can identify is not a marker.
 *
 *    So the ink comes back, in the ghost's own colour rather than in black.
 *    That keeps the whole of the original signal: black ink means SOLID, and
 *    nothing else in the scene has a pale cool rim. What it adds is the one
 *    thing a translucent figure cannot generate for itself, which is an edge.
 *    A hard rim around a see-through fill is also simply what a ghost looks
 *    like, and it is the reading the tag, the lane and the colour were already
 *    asking for.
 *
 *    The rim is drawn by this file rather than by shading.outlined(): the
 *    shared outline materials are cached, opaque and shared with the player,
 *    and this one has to fade with the body it wraps or it would still be
 *    hanging in the haze after the ghost had dissolved.
 *
 * 1b. AND IT MUST NOT BLEND WITH ITSELF. The fill wrote no depth, on the
 *    argument that an X-ray read lets limbs show through each other. What it
 *    actually did was let the FAR ones paint over the NEAR ones, because
 *    nothing rejected them -- an arm behind the chest drew on top of it
 *    whenever the sort order fell that way, which is the "internal
 *    self-overlap" the review saw. Writing depth costs nothing here (the parts
 *    are convex and disjoint) and turns fourteen stacked lumps into a body
 *    with an inside and an outside. Everything behind the ghost still shows
 *    through it, which is the part of the X-ray read that was ever worth
 *    having.
 *
 * 2. IT IS TINY EXACTLY WHEN THE GAP MATTERS MOST. At the 131-unit peak the
 *    body is seven pixels tall against pale haze. So two things run backwards
 *    from intuition here: the body carries NO fog (it is an instrument, not
 *    scenery -- aerial perspective would erase it precisely when the player
 *    needs to judge the gap), and it gets MORE opaque with distance, not less.
 *    The "is that an obstacle?" risk only exists up close; the "can I see it
 *    at all?" problem only exists far away, so each end of the range is tuned
 *    for its own failure.
 *
 * 3. MOST OF THE TIME IT IS OFF SCREEN, IN BOTH DIRECTIONS. Handled with a
 *    floating tag rather than more HUD, so the answer stays on the road:
 *      - riding the ghost while it is in view, tail pointing at its head;
 *      - clamped to the haze wall with an up-chevron once it is further away
 *        than the player could ever see, because past 190 units the tag's
 *        screen position stops meaning anything and it would be a lie to keep
 *        moving it;
 *      - pinned low and to the side, reading BEHIND YOU, once it has slipped
 *        past the camera and cannot be shown at all.
 *    The tag has size attenuation off, so it is the same size on screen from
 *    three units away or a hundred and ninety. Its POSITION carries the
 *    distance; its legibility never does.
 *
 * That division of labour is also the answer to traffic. The body is depth
 * tested like everything else, so a block train in its lane hides it for a
 * second or two -- which is what chasing someone through traffic looks like,
 * and is far less alarming than a runner composited on top of solid geometry.
 * The tag is not depth tested and never goes away, so the position read
 * survives even while the body does not.
 */
MR.Ghost = (function () {
  const K = MR.K;
  const S = MR.shading;

  // ---- where it runs ----------------------------------------------------

  // The outside lane, deliberately not the middle. The centre of the road is
  // where the player's eye lives and where the next gate resolves, and a
  // translucent figure parked there is the one placement that could cost
  // someone a gate.
  const HOME_X = K.LANE_X[0];
  // Derived rather than typed, so the pending track-narrowing work carries the
  // ghost's station with it instead of leaving it running along the verge.
  const LANE_W = K.LANE_X[1] - K.LANE_X[0];

  // The ghost never varies -- it IS record pace, by definition. Feeding the
  // rig a constant is also the cheapest way to sell the pass: at the crossover
  // the player's cadence is visibly quicker than the record's, which is the
  // whole story of the race told by two pairs of legs.
  const SPEED = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.RECORD_PACE;

  // World.VIEW is 210 and the haze closes at 190. Past that the body is a
  // smudge whatever we do to it, so it dematerialises and the tag takes over.
  const HAZE = 190;
  const HEAD_Y = MR.Runner.HEIGHT + 0.16;

  // ---- the band the tag may not enter, and why there is no tag left -------
  //
  // Kept in short because the reasoning outlived the object and the next
  // overlay will need it.
  //
  // A plate rode over the ghost's head. It was an instrument -- depthTest off,
  // renderOrder 900, no fog, in front of the scene unconditionally -- and it
  // was the one thing in the game exempt from the rule that nothing may hide a
  // hazard, and exempt from the assertions too: not being in the world group,
  // crossings() never returned it, so neither LOW, HIDES nor BLANKS had ever
  // looked at it.
  //
  // What it did, measured at two-frame resolution through miles 18-21: at lift
  // 0.5 its bottom edge sat on the ghost's head at HEAD_Y 1.76, which is 1.04
  // BELOW the 2.80 top of a BLOCK -- and a point under the eye, seen from the
  // eye, projects onto road far beyond it. Worse, there was no far edge, since
  // the plate's top passed eye height once the ghost was past ~16 units and its
  // sightline then never came down at all. Whole gate lines at 44 and 70 units
  // painted out, all three lanes at once; one gate 100% covered at 96 units and
  // STILL at 45, coming clear only at 17, inside the commit point with the lane
  // already chosen.
  //
  // It was fixed with a derived lift floor, and then deleted, because the rail
  // in hud.js prints every fact it carried -- see the note above tagRear. The
  // deletion refunds what the fix cost: 7.6 points of overlap with the mile
  // banners, and the tag's height as a gap cue below 85 units.
  //
  // PAINTS in shoot.js stays. It tests the PROPERTY -- any depthTest:false
  // material landing after the opaque pass -- not this object, so the next
  // overlay is caught the day it lands rather than the day somebody photographs
  // it. There is currently nothing for it to find, which is the correct state
  // for an assertion and not a reason to remove it.

  // ---- how it looks -----------------------------------------------------

  // Periwinkle: cool, mid-value, and the one hue the game does not already
  // spend. It has to survive two opposite backgrounds -- the dark slate road
  // up close and the pale fog at the vanishing point -- so it sits between
  // them in value rather than at either end. Nothing else on the road is this
  // colour, and in particular it is none of amber/cyan/red, which are the
  // three colours that mean "obstacle".
  const COOL = 0x8fa4ff;
  const HOT = new THREE.Color(0xffffff);

  const NEAR_ALPHA = 0.42;   // right beside you: unmistakably not solid
  const FAR_ALPHA = 0.90;    // seven pixels tall in haze: take every bit

  // ---- the rim ----------------------------------------------------------
  //
  // An inverted hull, the same device the rest of the game inks with, but
  // owned here because it has to do two things shading.js's shared materials
  // cannot: carry the body's own alpha, and never fog. Both follow from the
  // ghost being an instrument rather than scenery -- see point 2 below.
  //
  // Thinner than the character weight (0.014). The line is constant-width on
  // screen by design, so at the 131-unit peak, where the body is seven pixels
  // tall, a full-weight rim would be most of the ghost; at 0.009 it stays a
  // rim at every distance in the range and the body it wraps stays visible
  // inside it.
  const RIM_W = 0.009;
  // Pale enough to read against the dark road up close and against the haze at
  // depth, and a clear step off the fill so the edge exists at all. It is the
  // one bright cool line in the game; nothing else can be mistaken for it.
  const RIM = 0xdfe7ff;

  // Linear working value -> what an sRGB framebuffer expects. A raw
  // ShaderMaterial gets none of three's colour-space includes, so the
  // conversion has to be done to the uniform by hand or the rim sits a stop
  // darker than everything around it.
  function encode(v) {
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function rimMaterial() {
    const c = new THREE.Color(RIM);
    return new THREE.ShaderMaterial({
      uniforms: {
        thickness: { value: RIM_W },
        rimColor: { value: new THREE.Color(encode(c.r), encode(c.g), encode(c.b)) },
        rimAlpha: { value: NEAR_ALPHA },
      },
      // The depth term is what keeps the line the same weight on screen from
      // three units away to a hundred and ninety; a plain scaled hull balloons
      // on the torso and vanishes on the fingers.
      vertexShader: `
        uniform float thickness;
        void main() {
          vec3 n = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.xyz += n * thickness * clamp(0.75 + 0.05 * (-mv.z), 0.90, 3.6);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 rimColor;
        uniform float rimAlpha;
        void main() { gl_FragColor = vec4(rimColor, rimAlpha); }`,
      side: THREE.BackSide,
      transparent: true,
      // Reads depth, never writes it, and draws AFTER every fill. That order is
      // the whole difference between a rim and a fog. The first attempt put the
      // shells ahead of the body the way shading.js does, which is right for an
      // opaque character and wrong for a see-through one: with nothing in the
      // depth buffer yet, every shell in the rig drew -- including the fourteen
      // behind the body -- and then showed straight through the translucent
      // fill, so the ghost came out as a pale haze with a figure somewhere in
      // it. Drawn last against a depth buffer the fills have already written,
      // a shell survives only where there is no nearer body in front of it:
      // around the outside of the figure, and along the edge of any near limb
      // that crosses a far one. Which is exactly a silhouette.
      depthWrite: false,
    });
  }

  // ---- the tag ----------------------------------------------------------
  // Drawn to match the HUD's own language: hard rectangle, hairline border,
  // tabular figures, uppercase micro-cap. It is a broadcast name-super, not a
  // game bubble, because that is what the rest of this game's typography is.

  const TAG_W = 384, TAG_H = 208, PLATE_H = 148, WING = 34;
  const TAG_ASPECT = TAG_W / TAG_H;
  // Sprite scale is in per-unit-of-depth terms once size attenuation is off,
  // so this is a fraction of the viewport height: ~6% at the base FOV.
  const TAG_SIZE = 0.086;

  const FAM = 'ui-sans-serif, system-ui, -apple-system, Arial, sans-serif';
  const PLATE = 'rgba(14, 18, 48, 0.88)';
  const HAIR = 'rgba(255, 253, 245, 0.22)';
  const COOL_CSS = '#8fa4ff';
  const AHEAD_CSS = '#4dfba0';   // matches the HUD: green means beating it

  /** Letter-spaced small caps. Canvas letterSpacing is too new to rely on. */
  function caps(g, text, cx, y, px, color) {
    g.font = '800 ' + px + 'px ' + FAM;
    g.fillStyle = color;
    const sp = px * 0.17;
    let w = -sp;
    for (const ch of text) w += g.measureText(ch).width + sp;
    let x = cx - w / 2;
    for (const ch of text) { g.fillText(ch, x, y); x += g.measureText(ch).width + sp; }
  }

  /**
   * @param cap   the micro-label above the time
   * @param color cap colour
   * @param wing  -1 tail below the plate, +1 chevron above it, 0 neither
   */
  function tagTexture(cap, color, wing) {
    const c = document.createElement('canvas');
    c.width = TAG_W; c.height = TAG_H;
    const g = c.getContext('2d');
    const top = wing > 0 ? TAG_H - PLATE_H : 0;
    const bot = top + PLATE_H;

    g.fillStyle = PLATE;
    g.fillRect(0, top, TAG_W, PLATE_H);

    // The wing is what turns a floating rectangle into a label that belongs to
    // something: down, it points at the head under it; up, it points at road
    // the player cannot see yet.
    if (wing) {
      g.beginPath();
      if (wing < 0) {
        g.moveTo(TAG_W / 2 - WING, bot); g.lineTo(TAG_W / 2 + WING, bot);
        g.lineTo(TAG_W / 2, bot + WING * 0.9);
      } else {
        g.moveTo(TAG_W / 2 - WING, top); g.lineTo(TAG_W / 2 + WING, top);
        g.lineTo(TAG_W / 2, top - WING * 0.9);
      }
      g.closePath(); g.fill();
    }

    g.strokeStyle = HAIR; g.lineWidth = 4;
    g.strokeRect(2, top + 2, TAG_W - 4, PLATE_H - 4);
    // A bar of the ghost's own colour down the leading edge, exactly as the
    // HUD panels wear the accent -- it is what ties tag to body at a glance.
    g.fillStyle = COOL_CSS;
    g.fillRect(0, top, 7, PLATE_H);

    g.textAlign = 'left'; g.textBaseline = 'middle';
    caps(g, cap, TAG_W / 2 + 3, top + 36, 25, color);

    g.textAlign = 'center';
    g.fillStyle = '#fffdf5';
    // Fit rather than trust the metrics, the same way the race bib does: a
    // machine without the preferred family must not overflow the plate.
    let px = 78;
    do {
      g.font = '900 ' + px + 'px ' + FAM;
      px -= 2;
    } while (px > 28 && g.measureText(K.RECORD_LABEL).width > TAG_W * 0.80);
    g.fillText(K.RECORD_LABEL, TAG_W / 2 + 3, top + 100);

    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  function sprite(map) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthTest: false,     // an instrument: never occluded by scenery
      depthWrite: false,
      sizeAttenuation: false,
      fog: false,
      toneMapped: false,
    }));
    sp.renderOrder = 900;
    // Positioned by hand every frame, including deliberately off to one side;
    // three's sprite culling would fight that.
    sp.frustumCulled = false;
    sp.scale.set(TAG_SIZE * TAG_ASPECT, TAG_SIZE, 1);
    return sp;
  }

  // ---------------------------------------------------------------------

  function create() {
    const group = new THREE.Group();

    // The road profile, handed over by main.js. The ghost's own arithmetic is
    // untouched by hills -- ghostMiles() is raceTime / RECORD_PACE and race
    // time is grade-neutral by construction -- so this is only ever used to
    // DRAW the record holder on the same road the player is running.
    let elev = MR.Elevation.FLAT;
    const elevAt = function (zz) { return elev.at(zz); };

    // One material for the whole body, so a per-frame opacity or colour change
    // is a single write rather than fourteen.
    const mat = S.toon(COOL, 3);
    mat.transparent = true;
    mat.opacity = NEAR_ALPHA;
    // Depth IS written -- see point 1b in the header. Without it the far half
    // of the body paints over the near half and the figure has no inside.
    mat.depthWrite = true;
    mat.fog = false;          // see the header -- haze must not eat the marker
    mat.needsUpdate = true;

    const rim = rimMaterial();

    // Reuse the real rig rather than authoring a second character: it is
    // procedural, it already animates from ground speed, and any future work
    // on the runner's silhouette lands on the ghost for free.
    const body = MR.Runner.create({ skin: false });
    // Off the player's beat, so two runners side by side at the crossover read
    // as two runners rather than as one figure and its reflection.
    body.phase = 0.37;

    body.group.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      // shading.outlined() tags its own shell; the raw ShaderMaterial test is
      // the belt to that braces. The shells are REPLACED rather than removed:
      // they are already built, already parented and already share their
      // fill's geometry, so re-materialling them costs nothing and a deformed
      // bib or a posed limb carries its rim with it for free. The shared
      // material must not be touched -- it is cached and the player is using
      // it -- so each shell is handed the ghost's own.
      const par = o.parent;
      if ((par && par.userData && par.userData.line === o) || o.material.isShaderMaterial) {
        o.material = rim;
        o.visible = true;
        // After every fill. See the material -- the depth the fills write is
        // what turns fourteen overlapping hulls into one outline.
        o.renderOrder = 1;
        return;
      }
      // Anything already transparent is not a lit body part. Today that is the
      // contact shadow, which the rig drives by writing its own opacity every
      // frame -- overwrite the material and the blob turns into a flat quad.
      // It is left alone deliberately: the ghost is the one thing on the road
      // whose exact position the player has to judge, and a shadow is how you
      // read where a body's feet are. Tinted rather than darkened, so it
      // belongs to the ghost instead of pretending it blocks the sun.
      if (o.material.transparent) {
        if (o.material.color) o.material.color.set(COOL).multiplyScalar(0.42);
        return;
      }
      o.material = mat;
    });
    group.add(body.group);

    /**
     * THE WORLD PLATE IS GONE, AND WHAT KILLED IT WAS THE RAIL.
     *
     * A plate rode over the ghost's head reading RECORD / 1:59:30, or UP THE
     * ROAD past the haze. Reported from a phone: unnecessary, already listed
     * on the side, and blocking the animation. Checked against the shipped
     * readout, every fact it carried is printed twice more already --
     *
     *   the word RECORD      the projection plate, top left
     *   1:59:30              the projection plate's own subline
     *   UP THE ROAD / BEHIND YOU / LEVEL   the rail's trend, hud.js
     *   the gap              the rail, in seconds, live
     *   WHERE the ghost is   railGhost, a marker on the rail's own scale
     *
     * -- and the one thing left, which lane the ghost is running in, is
     * carried by the ghost's BODY whenever that is close enough for the lane
     * to matter. So the plate was three duplications and an occluder.
     *
     * This is also the cheapest possible resolution of the defect the PAINTS
     * assertion was written for: the plate had to be lifted clear of the
     * hazard band, and that lift cost 7.6 points of overlap with the mile
     * banners and took the tag's height out of service as a gap cue below 85
     * units. Deleting it refunds both. PAINTS stays -- it tests the property,
     * not this object, so the next overlay is still caught the day it lands.
     *
     * The corner tag stays. It appears only when the ghost is behind you,
     * which is the winning state and worth marking, and it sits at a frame
     * corner rather than over the road.
     */
    const texRear = tagTexture('BEHIND YOU', AHEAD_CSS, 0);
    const tagRear = sprite(texRear);
    group.add(tagRear);

    const s = {
      group,
      body,
      x: HOME_X,
      gap: 0,          // ghost minus player, in world units
      flash: 0,        // one-shot, fired the instant the player goes past
      primed: false,   // first frame seeds the state instead of reacting to it
      z: 0,
    };

    const _v = new THREE.Vector3();  // hoisted: this runs 60x a second
    const _r = new THREE.Vector3();
    const _u = new THREE.Vector3();

    /**
     * @param dt real seconds
     * @param st { pace, camera, playerX, celT, stand, launch }
     *
     * `stand` and `launch` are the start line, handed down from main.js so the
     * record holder leaves on the same gun as the player. See the block at
     * body.update below.
     */
    s.update = function (dt, st) {
      const pace = st.pace;
      const cam = st.camera;
      const z = pace.units;
      const gz = pace.ghostMiles() * K.UNITS_PER_MILE;
      const gap = gz - z;
      s.z = gz;
      // ghostMiles() clamps at the line, so on any run slower than 1:59:30 the
      // record finishes first and then sits at 26.2 while the player comes in.
      // Everything below has to know that, or the ghost spends the last minute
      // of a bad race running on the spot in the finish chute and then throws a
      // celebration when the player finally reaches it.
      const running = gz < K.TOTAL_UNITS - 0.01;

      // The crossover. Detected on the sign change rather than on a threshold,
      // so it fires exactly once and exactly where the record is beaten. The
      // primed flag is why ?skip= past mile 20 does not open with a phantom
      // celebration -- same trick the camera plays with its speed filter.
      if (!s.primed) { s.primed = true; s.gap = gap; s.x = HOME_X; }
      else if (running && s.gap > 0 && gap <= 0) s.flash = 1;
      s.gap = gap;
      s.flash = Math.max(0, s.flash - dt / 2.1);

      // ---- lateral -------------------------------------------------------
      // No course-solving and no reading of gates: for twenty-odd miles the
      // ghost simply holds the outside lane.
      //
      // What it does do is take station for the pass. A record holder would
      // hold their own line, and with the player out on the opposite lane the
      // overtake would then happen across the full width of the road -- at
      // three units from the lens that is a lateral angle of over 60 degrees,
      // so the moment the record actually changes hands would happen off the
      // edge of the frame. So inside the last forty units the ghost eases to
      // the lane off the player's inside shoulder, which puts the pass in the
      // middle of the screen from any lane and can never end with two bodies
      // in the same strip of road. It is a fiction, and it is the fiction this
      // whole feature exists to deliver.
      const px = st.playerX || 0;
      const post = Math.abs(px) > 0.6 ? px - Math.sign(px) * LANE_W : HOME_X;
      const close = 1 - smoothstep(22, 44, Math.abs(gap));
      s.x += ((HOME_X + (post - HOME_X) * close) - s.x) * (1 - Math.pow(0.30, dt));

      // Belt to that brace. However lazily the drift is easing, and whatever
      // the player does with the last second before the pass, the two are
      // never allowed to overlap while they are level. The push is toward the
      // station rather than away from the current overlap, so it always agrees
      // with the direction the drift was already going.
      const clear = LANE_W * 0.72;
      if (Math.abs(gap) < 9 && Math.abs(s.x - px) < clear) {
        s.x = px + (post < px ? -clear : clear);
      }

      // ---- body ----------------------------------------------------------
      const camZ = cam.position.z;
      const ahead = gz - camZ;          // depth in front of the lens

      // Denser the further off it is; see the header. The extra term keeps it
      // from blinking out at the haze wall.
      let alpha = NEAR_ALPHA + (FAR_ALPHA - NEAR_ALPHA) * smoothstep(14, 100, gap);
      alpha *= 1 - smoothstep(HAZE - 34, HAZE, gap);
      // Shoulder to shoulder is the moment the whole feature exists for, so it
      // gets a lift of its own on top of the crossover flash.
      const level = 1 - smoothstep(5, 22, Math.abs(gap));
      alpha = Math.min(1, alpha + s.flash * 0.55 + level * 0.10);

      // Once the record is home there is no body to draw -- only the tag, left
      // standing over the finish line where it crossed.
      const bodyOn = running && ahead > 1.2 && alpha > 0.02;
      body.group.visible = bodyOn;
      if (bodyOn) {
        mat.opacity = alpha;
        mat.color.set(COOL).lerp(HOT, s.flash * 0.85);
        // The rim rides a little ahead of the fill and tops out solid. Up
        // close that is the whole point -- a hard edge round a see-through
        // body is what says "ghost" rather than "smudge" -- and far out it is
        // most of what is left to see, since a seven-pixel figure is very
        // nearly all edge. It still dies with the body at the haze wall, which
        // is why it cannot use the shared, opaque, cached ink material.
        rim.uniforms.rimAlpha.value = Math.min(1, alpha * 1.45 + 0.10);
        // ---- IT TOES THE LINE TOO -------------------------------------------
        //
        // The owner, after the player was fixed: "The ghost runner also needs to
        // stand still until it starts." Two figures on the start line, one
        // correctly still and one still jogging, is worse than when both were
        // wrong -- the difference is what draws the eye.
        //
        // Nothing is authored here. `stand` is the same pose blend and `launch`
        // the same stride ramp main.js hands the player, off the same clock on
        // the same frame, because the two are starting the same race on the same
        // gun. What was worth checking rather than assuming is that a CONSTANT
        // speed still ramps: cadence in runner.js is 2.55 * (speed / SPEED_LO)^
        // 0.72, a power of the value it is handed and not of where that value
        // came from, so SPEED * 0 is cadence 0 and the ghost's stride phase
        // freezes exactly as the player's does.
        //
        // The two ramps are also the same SHAPE, which is the part that decides
        // whether they look like one gun or two. The ghost runs record pace and
        // the player starts at 5:30, so at any equal fraction of the launch the
        // ghost's cadence is a constant 1.1449x the player's -- the ratio does
        // not move across the ramp, so both reach their own full rate on the same
        // frame. The 14% it keeps is the contrast this file already wants: the
        // record's legs and the player's legs are never turning over together.
        //
        // The phase offset survives it. `body.phase` is seeded to 0.37 so the two
        // do not read as one figure and its reflection; a frozen phase holds that
        // seed through the countdown and the cycle resumes on it, so the offset
        // costs nothing and is not re-derived here.
        //
        // NOTHING ABOVE OR BELOW THIS LINE MOVES. This is a rendering change:
        // gz, gap, s.x, the crossover flash and ghostMiles are all untouched.
        body.update(dt, {
          speed: SPEED * (st.launch === undefined ? 1 : st.launch),
          stand: st.stand || 0,
        });
        // The ghost runs the same road. Its own maths is untouched -- ghostMiles
        // is raceTime / RECORD_PACE and race time is grade-neutral by
        // construction -- so this is the record holder being DRAWN on the
        // profile, nothing more.
        body.group.position.set(s.x, elevAt(gz), gz);
      }

      // ---- tag -----------------------------------------------------------
      // Hand over to the pinned tag as the ghost slides past the lens. Gated on
      // the player having genuinely passed it: at the gun the two are level and
      // the ghost is technically behind the camera, which is not the same thing.
      const passed = gap < -1;
      const rear = passed ? clamp01((11 - ahead) / 9) : 0;
      const pulse = 1 + 0.55 * s.flash;
      const tan = Math.tan(cam.fov * Math.PI / 360);

      // AND IT STANDS DOWN FOR THE CELEBRATION.
      //
      // This plate is parked on the camera's own basis, at a fixed corner of
      // the frame, because there is no world position behind the lens that can
      // be drawn. That reasoning holds for every shot this game had when it was
      // written, and all of them look down the road from astern. The finish
      // celebration does not: it leaves the chase and arcs round to
      // three-quarter FRONT, and a plate pinned to a corner of THAT frame is
      // pinned to a corner of the runner -- measured, it lands across his shin
      // in the held shot, which is the one moment the game shows his face.
      //
      // A corner of the frame is only empty while the frame is pointed at the
      // road. So the plate follows the same rule hud.celebrate already applies
      // to the top-left column: once the camera leaves the chase, it clears
      // out. Nothing is lost -- the rail under the road carries the same gap,
      // in the same words, for the whole celebration, and the finish card is
      // 3.1s behind it.
      const standDown = 1 - smoothstep(0, 0.35, st.celT || 0);
      tagRear.material.opacity = rear * 0.96 * standDown;
      tagRear.visible = tagRear.material.opacity > 0.02;
      if (tagRear.visible) {
        // Placed off the camera's own basis rather than in world space: there
        // is no world position behind the lens that can be drawn, so the only
        // honest thing left is to park it at a fixed corner of the frame, on
        // the side of the road the ghost went out on.
        cam.updateMatrixWorld();
        const e = cam.matrixWorld.elements;
        _r.set(e[0], e[1], e[2]);
        _u.set(e[4], e[5], e[6]);
        _v.set(-e[8], -e[9], -e[10]);
        const d = 6;
        tagRear.scale.set(TAG_SIZE * TAG_ASPECT * pulse, TAG_SIZE * pulse, 1);
        // Corner placement in normalised device coords, then backed out into
        // world units. Derived from the sprite's own footprint rather than
        // typed in, because a portrait phone is three times wider in NDC for
        // the same sprite and a hard-coded 0.70 would hang it off the edge.
        // World -x is screen RIGHT for a camera looking down +z, which is the
        // side lane 0 is on. The rail and the split card own the bottom middle.
        const hw = tagRear.scale.x / (2 * tan * cam.aspect);
        const hh = tagRear.scale.y / (2 * tan);
        const nx = Math.min(0.70, 1 - hw - 0.03);
        const ny = -Math.min(0.62, 1 - hh - 0.15);
        tagRear.position.copy(cam.position)
          .addScaledVector(_v, d)
          .addScaledVector(_r, nx * d * tan * cam.aspect)
          .addScaledVector(_u, ny * d * tan);
      }
    };

    s.reset = function () {
      s.primed = false;
      s.gap = 0;
      s.flash = 0;
      s.x = HOME_X;
      body.phase = 0.37;
      mat.opacity = NEAR_ALPHA;
      mat.color.set(COOL);
      rim.uniforms.rimAlpha.value = NEAR_ALPHA;
    };

    /** Signed gap in world units, for tooling that wants to assert on it. */
    s.gapUnits = function () { return s.gap; };

    s.setElevation = function (e) { elev = e || MR.Elevation.FLAT; };

    return s;
  }

  return { create, SPEED, HAZE };
})();
