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
 * 1. IT MUST NEVER READ AS A HAZARD. Every solid thing in this game wears an
 *    ink outline, so the ghost's outlines are stripped rather than recoloured:
 *    the absence of ink is the loudest "not real" signal the art direction
 *    has, and it halves the character's draw calls into the bargain. On top of
 *    that it is translucent, it is a single cool colour with no vest red
 *    anywhere on it, and it runs the outside lane rather than the middle one
 *    where the eye is hunting for gates.
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
  // Halfway between that lane and the kerb. Derived rather than typed, so the
  // pending track-narrowing work carries the ghost with it instead of leaving
  // it running along the verge.
  const WIDE_X = (HOME_X - K.TRACK_HALF_WIDTH) * 0.5;

  // The ghost never varies -- it IS record pace, by definition. Feeding the
  // rig a constant is also the cheapest way to sell the pass: at the crossover
  // the player's cadence is visibly quicker than the record's, which is the
  // whole story of the race told by two pairs of legs.
  const SPEED = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.RECORD_PACE;

  // World.VIEW is 210 and the haze closes at 190. Past that the body is a
  // smudge whatever we do to it, so it dematerialises and the tag takes over.
  const HAZE = 190;
  const HEAD_Y = MR.Runner.HEIGHT + 0.16;

  // ---- how it looks -----------------------------------------------------

  // Periwinkle: cool, mid-value, and the one hue the game does not already
  // spend. It has to survive two opposite backgrounds -- the dark slate road
  // up close and the pale fog at the vanishing point -- so it sits between
  // them in value rather than at either end. Nothing else on the road is this
  // colour, and in particular it is none of amber/cyan/red, which are the
  // three colours that mean "obstacle".
  const COOL = 0x8fa4ff;
  const HOT = new THREE.Color(0xffffff);

  const NEAR_ALPHA = 0.34;   // right beside you: unmistakably not solid
  const FAR_ALPHA = 0.90;    // seven pixels tall in haze: take every bit

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

    // One material for the whole body, so a per-frame opacity or colour change
    // is a single write rather than fourteen.
    const mat = S.toon(COOL, 3);
    mat.transparent = true;
    mat.opacity = NEAR_ALPHA;
    mat.depthWrite = false;   // an X-ray read: limbs show through each other
    mat.fog = false;          // see the header -- haze must not eat the marker
    mat.needsUpdate = true;

    // Reuse the real rig rather than authoring a second character: it is
    // procedural, it already animates from ground speed, and any future work
    // on the runner's silhouette lands on the ghost for free.
    const body = MR.Runner.create();
    // Off the player's beat, so two runners side by side at the crossover read
    // as two runners rather than as one figure and its reflection.
    body.phase = 0.37;

    const ink = [];
    body.group.traverse(function (o) {
      if (!o.isMesh) return;
      // shading.outlined() tags its own shell; the raw ShaderMaterial test is
      // the belt to that braces. Recolouring the outline is not an option --
      // those materials are cached and shared with the player.
      const par = o.parent;
      const isInk = (par && par.userData && par.userData.line === o)
        || (o.material && o.material.isShaderMaterial);
      if (isInk) ink.push(o); else o.material = mat;
    });
    for (const m of ink) if (m.parent) m.parent.remove(m);

    group.add(body.group);

    const texRide = tagTexture('RECORD', COOL_CSS, -1);
    const texFar = tagTexture('UP THE ROAD', COOL_CSS, 1);
    const texRear = tagTexture('BEHIND YOU', AHEAD_CSS, 0);

    // Two sprites rather than one that swaps texture: the hand-off from "over
    // its head" to "pinned in the corner" happens while both are on screen, so
    // it has to be a cross-fade or it reads as a glitch.
    const tagWorld = sprite(texRide);
    const tagRear = sprite(texRear);
    group.add(tagWorld, tagRear);

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
     * @param st { pace, camera, playerX }
     */
    s.update = function (dt, st) {
      const pace = st.pace;
      const cam = st.camera;
      const z = pace.units;
      const gz = pace.ghostMiles() * K.UNITS_PER_MILE;
      const gap = gz - z;
      s.z = gz;

      // The crossover. Detected on the sign change rather than on a threshold,
      // so it fires exactly once and exactly where the record is beaten. The
      // primed flag is why ?skip= past mile 20 does not open with a phantom
      // celebration -- same trick the camera plays with its speed filter.
      if (!s.primed) { s.primed = true; s.gap = gap; s.x = HOME_X; }
      else if (s.gap > 0 && gap <= 0) s.flash = 1;
      s.gap = gap;
      s.flash = Math.max(0, s.flash - dt / 1.7);

      // ---- lateral -------------------------------------------------------
      // No course-solving: it holds one lane for twenty-six miles. The single
      // exception is the pass, where the player arriving in its lane would put
      // two bodies inside each other -- so it eases toward the kerb, over
      // about a second, and eases back. A drift, not a dodge.
      const crowded = Math.abs((st.playerX || 0) - HOME_X) < 1.3 && Math.abs(gap) < 30;
      s.x += ((crowded ? WIDE_X : HOME_X) - s.x) * (1 - Math.pow(0.35, dt));

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
      alpha = Math.min(1, alpha + s.flash * 0.5 + level * 0.10);

      const bodyOn = ahead > 1.2 && alpha > 0.02;
      body.group.visible = bodyOn;
      if (bodyOn) {
        mat.opacity = alpha;
        mat.color.set(COOL).lerp(HOT, s.flash * 0.75);
        body.update(dt, { speed: SPEED });
        body.group.position.set(s.x, 0, gz);
      }

      // ---- tag -----------------------------------------------------------
      // Hand over to the pinned tag as the ghost slides past the lens. Gated on
      // the player having genuinely passed it: at the gun the two are level and
      // the ghost is technically behind the camera, which is not the same thing.
      const passed = gap < -1;
      const rear = passed ? clamp01((11 - ahead) / 9) : 0;
      const pulse = 1 + 0.5 * s.flash;

      tagWorld.material.opacity = 1 - rear;
      tagWorld.visible = tagWorld.material.opacity > 0.02;
      if (tagWorld.visible) {
        // Past the haze the tag's height on screen stops carrying information,
        // so it stops moving and says so instead.
        const beyond = gap > HAZE;
        tagWorld.material.map = beyond ? texFar : texRide;
        const tz = beyond ? z + HAZE : gz;
        // Size attenuation is off, so a sprite's world footprint grows with
        // depth. Scaling the offset by depth too is what keeps the tail the
        // same distance above the head at three units and at a hundred.
        const depth = Math.max(4, tz - camZ);
        tagWorld.scale.set(TAG_SIZE * TAG_ASPECT * pulse, TAG_SIZE * pulse, 1);
        tagWorld.position.set(s.x, HEAD_Y + depth * TAG_SIZE * pulse * 0.5, tz);
      }

      tagRear.material.opacity = rear * 0.95;
      tagRear.visible = tagRear.material.opacity > 0.02;
      if (tagRear.visible) {
        // Placed off the camera's own basis rather than in world space: there
        // is no world position behind the lens that can be drawn, so the only
        // honest thing left is to park it at a fixed corner of the frame, on
        // the side of the road the ghost is on.
        cam.updateMatrixWorld();
        const e = cam.matrixWorld.elements;
        _r.set(e[0], e[1], e[2]);
        _u.set(e[4], e[5], e[6]);
        _v.set(-e[8], -e[9], -e[10]);
        const d = 6;
        const tan = Math.tan(cam.fov * Math.PI / 360);
        // Lane 0 is screen-right for this camera, which is where the ghost went.
        const nx = 0.58, ny = -0.58;
        tagRear.scale.set(TAG_SIZE * TAG_ASPECT * pulse * 0.86, TAG_SIZE * pulse * 0.86, 1);
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
      tagWorld.material.map = texRide;
    };

    /** Signed gap in world units, for tooling that wants to assert on it. */
    s.gapUnits = function () { return s.gap; };

    return s;
  }

  return { create, SPEED, HAZE };
})();
