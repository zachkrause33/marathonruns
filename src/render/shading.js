/**
 * Shading toolkit: soft gradient ramps, the atmosphere (sky dome + aerial
 * perspective), the contact shadow, and the palette everything else draws
 * from. The ink-outline machinery is still here and fully wired, at weight 0
 * everywhere -- see INK.
 *
 * THE LOOK IS SOFT NOW, NOT TOON. The owner, verbatim: "I don't like the
 * 'toon' look." and "I want my game to look like this game... It looks more
 * life like." (reference/citylook-*.jpg). What that means mechanically:
 *
 *   - the ramp is a continuous curve, not bands -- see ramp(). The warm key /
 *     cool shadow structure SURVIVES, because the reference's lifelike
 *     quality is colour-in-shadow, not grey-in-shadow;
 *   - no ink on anything, character and hazards included -- the reference
 *     carries no outlines and hazard legibility is owned by the contrast
 *     gate in tools/shoot.js, which still fails the build at 1.25x/0.22;
 *   - the sky is one continuous gradient with painterly clouds;
 *   - a strong contact shadow still grounds everything on the road (the
 *     reference uses exactly this device under its cars).
 *
 * The outline machinery is kept, not deleted: outlined() still builds the
 * shell and INK is still the single control, so a line anywhere can be
 * restored as a one-number change if a measurement ever asks for one. Where
 * a shell would draw, it is extruded along the vertex normal in view space
 * and scaled by depth (see outlineVS).
 *
 * COLOUR SPACE, because it bites every shader in here: the renderer is in
 * SRGBColorSpace and ColorManagement is on, so a THREE.Color built from a hex
 * holds LINEAR values and three's own materials convert to display space in
 * `colorspace_fragment`. A raw ShaderMaterial gets no such include, so every
 * shader below converts explicitly. Skipping that is what made the old sky sit
 * a stop darker than the fogged ground and show a hard seam at the horizon.
 */
MR.shading = (function () {

  const PALETTE = {
    ink: 0x1b1633,

    skyTop: 0x2b3fa8,
    skyBot: 0x8fd6ff,

    sun: 0xfff8d8,
    sunGlow: 0xffd98a,

    runnerSkin: 0xffc79a,
    runnerVest: 0xff4d5e,
    runnerShort: 0x2b2f52,
    runnerShoe: 0xfff2e0,
    runnerHair: 0x3a2b46,

    road: 0x50557d,
    roadEdge: 0xf2f4ff,
    laneLine: 0xfff6d8,

    jump: 0xffb020,   // low block
    duck: 0x37d6ff,   // overhead bar
    block: 0xff3b6b,  // impassable

    ground: 0x63c96b,

    // Building tints, picked at random per block. These carry most of the
    // load now that scenery has no outline: a skyline separates from the road
    // and from itself on HUE, so the set is spread right round the wheel
    // rather than being five variations on cream. Two pales are kept because
    // a wall of saturated blocks reads as noise -- the references alternate
    // vivid facades with light ones, and the light ones are what let the
    // vivid ones look vivid.
    //
    // They are all lighter than they look here, on purpose. A facade is a
    // vertical face, so it lives in the ramp's dark band and takes only half
    // the hemisphere fill: a tint picked by eye from a swatch lands about 40%
    // darker once it is on a wall, and the first pass at this list -- chosen
    // at full brightness -- turned the skyline into slabs. Nothing is allowed
    // near the road's own value (~0x50557d) either, or it merges with the
    // tarmac as soon as the haze reaches it.
    building: [
      0xff9c7a,  // coral
      0x6fd8e8,  // teal
      0xffcf62,  // mustard
      0xc0a4f4,  // violet
      0x7ee0a4,  // mint
      0xfff1dc,  // cream
      0xffabcb,  // candy pink
      0xd8e6f5,  // pale steel
    ],
    /**
     * THE WORLD'S GOLD. It shares a hex with the HUD's `--accent` and it is
     * NOT the same token, and that distinction has been read the wrong way
     * round once already, so here is the measurement.
     *
     * `src/ui/style.css` says colour carries meaning and nothing else, and
     * names `--accent` as the speed engine -- the fuel gauge, the rail fill,
     * tomorrow's road. A review counted 0xffe45e appearing 43 times in
     * world.js, on spectator shirts and streetlamps and bunting, plus the
     * runner's TRIM through this entry, and concluded the accent was not a
     * closed set and the claim was false.
     *
     * COUNTING SOURCE HEX IS THE WRONG INSTRUMENT, and the same lesson as the
     * 110px runner: an authored colour is not a screen colour. Everything the
     * world paints this with is LIT -- toon ramp, hemisphere fill, then fog --
     * and comes out somewhere else. Counted on shipped frames at 390x844,
     * canvas alone with the UI hidden, pixels equal to #ffe45e:
     *
     *   skip  40    0 at +/-8      317 at +/-26
     *   skip 120    0 at +/-8      166 at +/-26
     *   skip 185    0 at +/-8       23 at +/-26
     *
     * **Zero, at every gameplay skip.** The nearest yellow the world renders
     * is (239,212,87), 16 per channel off. Masked at +/-30 the entire frame
     * holds 78 near-accent pixels and every one of them is the RUNNER'S
     * headband and shoe midsoles -- 0.02% of the frame against the HUD's own
     * 1.3% to 5.1%. Not one spectator shirt, lamp, cable, sign or bunting
     * flag in the game comes that close.
     *
     * So the claim is not falsified in the channel that decides it, and the
     * fix the review asked for -- repaint 43 props -- would move numbers that
     * are already zero.
     *
     * THE ONE REAL COLLISION IS AT THE TAPE, and it is recorded rather than
     * removed: the finish confetti is unlit, so it paints (255,228,94)
     * exactly, 1,327 pixels of it at the finish. That is the only place in
     * the game where the world puts the HUD's accent on screen, it lasts as
     * long as the celebration does, and gold confetti at a record IS "what
     * you are buying". Anything unlit added here in future will land on the
     * hex exactly, which is the thing to watch.
     */
    accent: 0xffe45e,

    // Contact-shadow tint. Deliberately a deep blue-violet rather than black:
    // it has to sit on grass, tarmac and sand across six biomes, and a neutral
    // black blob reads as a hole in every one of them.
    // Warmed a step for the citylook pass: a third fresh reader read the
    // runner-and-ghost shadow trail as 'a blue centerline stripe'. Still
    // violet-of-neutral so a blob never reads as a hole, but no longer the
    // bluest thing on the tarmac.
    contact: 0x2c2532,
  };

  /**
   * Outline weights in WORLD UNITS, by what the object is. Zero means no line
   * at all, and costs nothing -- see outlineMaterial() and outlined(), which
   * both short-circuit on it. The number is the width at the camera;
   * OUTLINE_VS grows it with depth (see there).
   *
   * The references carry no ink whatsoever (see the outline policy at the top
   * of the file), so every non-zero weight here has to earn itself back in
   * READABILITY. Two classes do:
   *
   *   character  the player and the rivals. The runner has to stay legible
   *              against a road that is sometimes close to its own value,
   *              while both are moving. Thin, because the limbs are ~0.07
   *              units across and anything heavier starts eating the fill.
   *   hazard     jump blocks, duck bars, impassable walls. This is the one
   *              class of object the player LOSES the race by misreading, and
   *              it is read at 30-50 units out where the fill is a few pixels
   *              tall and the haze has already taken half its contrast.
   *
   * Everything else is 0. Props, scenery and banners are set dressing: the
   * line bought them nothing that saturated colour, the band step and the
   * aerial perspective do not already do, while costing a second draw call
   * each and painting a constant-width black rim that flattened exactly the
   * depth the haze was there to create.
   */
  /**
   * ALL ZERO NOW. The owner rejected the toon look outright ("I don't like
   * the 'toon' look"), and the ink was half of it -- the reference frames in
   * reference/citylook-*.jpg carry no outline on anything, character and
   * hazards included. Separation is carried by the soft shading, the colour
   * system and the contrast gate instead, and tools/shoot.js still fails the
   * build if a hazard stops clearing 1.25x luminance or 0.22 saturation
   * against its road -- measured after this change, every variant's margin
   * WIDENED, because the ink was dark edging that dragged the area-mean down.
   *
   * The machinery all survives: outlined() still builds and parents a shell
   * (invisible, zero draws), so restoring a line anywhere is still the
   * one-number change this comment has always promised.
   */
  const INK = {
    character: 0,       // was 0.014 -- dropped with the toon look
    hazard: 0,          // was 0.025 -- dropped with the toon look
    prop: 0,            // was 0.030 -- dropped
    scenery: 0,         // was 0.090 -- dropped
    banner: 0,          // was 0.045 -- dropped
  };

  // Linear working value -> what the sRGB framebuffer expects. Used wherever a
  // colour is handed to a raw ShaderMaterial pre-converted rather than being
  // converted per fragment.
  function encode(v) {
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  function displayColor(src) {
    const c = new THREE.Color(src);
    return new THREE.Color(encode(c.r), encode(c.g), encode(c.b));
  }

  // GLSL twin of the above, for shaders that must mix in linear first.
  const LIN2SRGB = `
    vec3 lin2srgb(vec3 c) {
      vec3 hi = pow(max(c, vec3(0.0)), vec3(0.41666)) * 1.055 - vec3(0.055);
      vec3 lo = c * 12.92;
      return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
    }`;

  // ---- toon ramps -------------------------------------------------------

  const ramps = new Map();

  /**
   * A `steps`-band ramp used as MeshToonMaterial.gradientMap. Nearest
   * filtering is what makes the bands hard instead of smeared.
   *
   * The ramp is coloured, not grey: the dark band is pushed toward blue so a
   * shadowed side reads as "in shade" rather than "same paint, less light",
   * which is what separates cel shading from flat lambert. three's stock
   * gradient lookup only reads the red channel, so patchToonRamp() below
   * widens it to rgb -- if that patch ever fails to apply the red channel
   * still carries a sensible luminance and the look degrades to greyscale.
   *
   * This ramp plus the hemisphere in lights() is now the whole of the shading
   * on anything without an outline, so it is deliberately harder than it was.
   * A ramp tuned to sit politely underneath a black rim reads as unshaded the
   * moment the rim comes off: both numbers below were pulled apart when the
   * scenery lines were dropped, the floor down and the cool up, so that a
   * building's lit side and its shaded side are two colours rather than two
   * strengths of one.
   */
  /**
   * `floor` is the darkest band, and it exists because ONE class of object in
   * this game is not decoration.
   *
   * 0.31 is right for scenery: it is as low as the shading can go before the
   * ambient stops keeping a shaded red vest from reading as brown, and it is
   * what makes a building's lit and shaded sides two colours rather than two
   * strengths of one. But a HAZARD is read as a flat silhouette at forty to
   * ninety units, and its read face points at the camera -- away from the key
   * light -- so at a 0.31 floor it is lit almost entirely by the blue bounce
   * and the hemisphere. Measured through the contrast audit: the JUMP kerb's
   * amber is authored at S 0.73 and rendered at S 0.34, and every BLOCK lands
   * between 1.1x and 1.6x the centre lane's luminance when the reference sits
   * at 2.1x to 2.56x. The chroma the whole readability system depends on was
   * being spent on form shading nobody looks at.
   *
   * Raising the floor raises the COLOURED diffuse term against a fixed
   * additive ambient, so it lifts value and saturation together, which is
   * exactly the axis the measurement says is short. Form survives because the
   * band above it is unchanged.
   */
  /**
   * ============ THE RAMP IS CONTINUOUS NOW. THE BANDS ARE GONE. ============
   *
   * The owner, verbatim: "I don't like the 'toon' look." That is the whole of
   * the reason. The banded ramp -- and the ink that partnered it -- WAS the
   * toon look, so this function now returns a smooth curve and every material
   * in the game goes soft through the one place they all already read.
   *
   * WHAT SURVIVES, deliberately: the `floor` (a shadow that cannot reach
   * black), and the COOL TERM -- shadows tinted blue rather than grey. Those
   * two are not toon devices, they are the painterly half of the reference
   * look (citylook-*.jpg shades every facade warm-to-cool, never light-to-
   * dark-grey), and they are why this is a curve through the old ramp's
   * endpoints rather than a plain lambert.
   *
   * THE SHOULDER, and why the curve is not pow(k, 1.22) smoothed. A surface
   * needs dotNL only ~0.9 to reach full brightness, so everything within ~25
   * degrees of facing the key -- the road, roofs, the runner's lit side --
   * stays where the old TOP BAND put it, and the whole gradient happens on
   * the lower half of the sphere. Measured on the flat road (dotNL 0.566
   * against this key): top band 1.00 -> 0.95, i.e. scene exposure is nearly
   * unmoved, while a hazard's camera-facing read face RISES slightly (its
   * floor now blends up instead of sitting pinned) -- which is the direction
   * the contrast gate wants. Verified through tools/shoot.js, not assumed.
   *
   * `steps` is accepted and ignored: every caller keeps working, and all the
   * old 2-step and 3-step materials now share one texture per floor.
   */
  function ramp(steps, floor) {
    // The default floor rose 0.31 -> 0.38 and the cool term eased 0.38 ->
    // 0.30 when the key light flipped behind the camera: a facade's road face
    // now sees no directional light at all, and at the old numbers a whole
    // flank of the street washed out to pale blue-grey. The reference keeps
    // its shaded facades warm and only a step down; hazards are unaffected
    // (their propLit floor is 0.62) and the road is a lit flat-up surface.
    const base = floor === undefined ? 0.38 : floor;
    const key = 'soft/' + base;
    if (ramps.has(key)) return ramps.get(key);
    const n = 160;
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      // Soft shoulder: full brightness from dotNL ~0.92 up, smooth roll-off
      // below. smoothstep keeps both ends of the curve tangent-flat, so there
      // is no residual band edge anywhere for the eye to find.
      const t = Math.max(0, Math.min(1, k / 0.92));
      const lit = Math.pow(t * t * (3 - 2 * t), 1.1);
      const v = base + (1 - base) * lit;
      // The cool term is unchanged from the banded ramp: shadows stay
      // COLOURED. It falls off fast toward the light so only the shaded half
      // takes the blue, exactly as before -- but it now arrives as a
      // continuous temperature shift across the form, which is the reference
      // frames' own shading.
      // 0.30 -> 0.21 for the citylook pass: at 0.30 a whole shaded facade
      // flank rendered blue-grey, and the reference keeps its shaded walls
      // WARM (measured: the shaded cream flank in citylook-twin-buses renders
      // #a8985f -- darker and a touch cooler than the lit side, never blue).
      // The temperature shift survives; it just stops overpowering the paint.
      const cool = Math.pow(1 - k, 1.55) * 0.21;
      const rgb = [v * (1 - cool * 1.05), v * (1 - cool * 0.40), v * (1 + cool * 0.72)];
      for (let c = 0; c < 3; c++) {
        data[i * 4 + c] = Math.round(Math.max(0, Math.min(1, rgb[c])) * 255);
      }
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
    // Linear, not Nearest: Nearest was what made the bands hard, and the whole
    // point of this pass is that there are no bands to keep hard.
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    ramps.set(key, tex);
    return tex;
  }

  // three's stock gradient lookup returns vec3(texel.r), throwing away the
  // colour in the ramp. This swaps in an rgb version.
  //
  // It replaces the #include LINE, not the resolved chunk body: onBeforeCompile
  // runs BEFORE resolveIncludes, so the shader it hands you still says
  // "#include <gradientmap_pars_fragment>" and a patch written against the
  // expanded source silently matches nothing -- which is exactly how the first
  // attempt shipped a ramp whose blue was never read.
  //
  // One shared function object, so every toon material hashes to the same
  // program cache key instead of compiling its own copy.
  const GRAD_INCLUDE = '#include <gradientmap_pars_fragment>';
  const GRAD_RGB = [
    '#ifdef USE_GRADIENTMAP',
    '  uniform sampler2D gradientMap;',
    '#endif',
    'vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {',
    '  float dotNL = dot( normal, lightDirection );',
    '  vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );',
    '  #ifdef USE_GRADIENTMAP',
    '    return texture2D( gradientMap, coord ).rgb;',
    '  #else',
    '    vec2 fw = fwidth( coord ) * 0.5;',
    '    return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );',
    '  #endif',
    '}',
  ].join('\n');

  function patchToonRamp(shader) {
    shader.fragmentShader = shader.fragmentShader.replace(GRAD_INCLUDE, GRAD_RGB);
  }

  /**
   * ================== THE SPECULAR BAND ==================
   *
   * MeshToonMaterial HAS NO SPECULAR TERM AT ALL. Its whole lighting model is
   * a banded diffuse ramp, so there is not, and never has been, a highlight
   * anywhere on anything in this game. That is the mechanical answer to the
   * owner's "cars should feel like actual 3D objects rather than flat coloured
   * shapes", and to reflections and highlights being the first two items on
   * their list: the material could not produce one.
   *
   * WHAT THIS ADDS is a cel specular -- two hard steps on the half-vector, not
   * a Blinn falloff -- because a smooth highlight under a banded diffuse reads
   * as a smudge. It is added to outgoingLight BEFORE tone mapping and the
   * colour-space conversion, and therefore before the fog mix, so a highlight
   * fades into the haze at exactly the rate the surface under it does. A spec
   * that stayed crisp at 150 units would undo the aerial perspective the whole
   * depth read rests on.
   *
   * IT IS PER-VERTEX OPT-IN, VIA aGloss, and that is the part that makes it
   * safe. Every hazard variant is ONE merged geometry under ONE shared
   * material, so without a per-part control the choice would be "every surface
   * on the vehicle is glossy" or "none is" -- and a glossy tyre is worse than
   * no highlight at all. merge() bakes a per-part scalar exactly as it already
   * bakes aWave for the crowd, so glass and chrome can be wet, paint
   * semi-gloss and rubber, cloth and skin flat, at no cost in draws, meshes or
   * materials. A geometry that never asks for the attribute reads 0 through
   * WebGL's disabled-array default and is bit-identical to before.
   *
   * WHERE THE BAND LANDS, worked out rather than dialled in, because the two
   * thresholds decide whether this is free or whether it moves the contrast
   * gate. In view space the key light sits at roughly (-0.44, 0.57, -0.69) and
   * the eye at (0, 0, 1), so the half-vector is about (-0.56, 0.72, 0.39). For
   * the axis-aligned faces this fleet is built from:
   *
   *   roof, normal +y                 N.H = 0.72
   *   the +x flank                    N.H = 0.56
   *   the rear face, at the camera    N.H = 0.39
   *   a roof-to-flank chamfer         N.H = 0.91
   *   a roof-to-rear chamfer          N.H = 0.79
   *   a tyre, normals sweeping y-z    N.H peaks at 0.82
   *
   * SHEEN at 0.62 and CORE at 0.78 therefore light the roof, both chamfers and
   * the top of every cylinder, and leave the flanks and THE WHOLE REAR FACE
   * dark. That last one is the important one: the contrast audit photographs
   * every variant down the game's own sightline, where the rear face is most
   * of what it can see, so this cannot inflate the number the build gates on.
   * The roof is in that shot only as a grazing sliver. Measured, not assumed --
   * the per-variant before/after is in the report.
   *
   * It is also why the chamfers this pass adds to the fleet and this band are
   * one change and not two: a box has no surface at 45 degrees, so before the
   * chamfers existed the only thing a shoulder highlight could have landed on
   * was the roof. The reference's cars carry their brightest line exactly on
   * that turn, and now so do ours.
   *
   * COST: no draw calls, no meshes, no materials, four extra floats a vertex
   * on the geometries that opt in, and about a dozen fragment instructions on
   * one material. The loop is over NUM_DIR_LIGHTS rather than reading
   * directionalLights[0] -- the key light is index 0 only because of scene
   * insertion order, and an assumption like that is exactly the kind this
   * project keeps a corrections list for.
   */
  /**
   * TUNED DOWN HARD FROM THE FIRST BUILD, against the orbit sheet rather than
   * against the derivation. The thresholds above are right about WHERE the band
   * lands; the first strengths (0.16 sheen, 0.42 core) were wrong about how much
   * to put there by roughly a factor of three, and the reason is worth keeping.
   *
   * A specular term reads as "shiny" on a curved surface because only a thin
   * strip of it is ever lit. On a FLAT face the whole face is at one normal, so
   * the band does not sweep across it -- it switches the entire panel on. This
   * fleet is flat panels, so at the azimuths where a flank aligns with the
   * half-vector, 0.42 of extra light did not put a highlight on the taxi, it
   * turned the taxi white: measured on the orbit sheet, flank luminance went
   * 133.4 to 177.3 and the front 139.6 to 192.4, and the body lost its hue.
   *
   * So the sheen is now barely more than a lift, and the core is a real but
   * small highlight. What still reads clearly is exactly what should: the 45
   * degree chamfers, which are narrow by construction, and the cylinders --
   * tyres, lamps, scaffold tubes -- where the band genuinely does sweep.
   */
  const SPEC_SHEEN = 0.66;
  const SPEC_CORE = 0.80;

  const SPEC_VS_DECL = [
    'attribute float aGloss;',
    'varying float vGloss;',
  ].join('\n');

  const SPEC_FS_DECL = 'varying float vGloss;';

  // No backticks anywhere in the GLSL comments below -- see CLAUDE.md rule 5.
  const SPEC_FS_BODY = [
    '#if NUM_DIR_LIGHTS > 0',
    '  if (vGloss > 0.0) {',
    '    vec3 sN = normalize(normal);',
    '    vec3 sV = normalize(vViewPosition);',
    '    vec3 spec = vec3(0.0);',
    '    for (int si = 0; si < NUM_DIR_LIGHTS; si++) {',
    '      vec3 sH = normalize(directionalLights[si].direction + sV);',
    '      float nh = max(dot(sN, sH), 0.0);',
    // fwidth is zero across a flat face, so the band is hard there and only
    // antialiases where the surface actually curves -- which is what a cel
    // highlight wants. The small constant keeps a flat face from aliasing
    // against its own neighbour at a grazing angle.
    // SMOOTH NOW, NOT STEPPED. The two hard thresholds above were the cel
    // highlight, tuned to sit under a banded diffuse; with the ramp
    // continuous a stepped highlight was the last banded thing in the frame.
    // A pow falloff puts a broad low sheen and a tight hot core in the same
    // places the derivation above worked out -- chamfers, cylinders, glass at
    // grazing angles -- and, unlike the steps, it cannot switch a whole flat
    // panel on at once: the core is ~0.02 by ten degrees off peak.
    '      float sheen = pow(nh, 8.0);',
    '      float core = pow(nh, 60.0);',
    // FRESNEL, and it is what makes this usable on a fleet made of flat panels.
    //
    // The failure it fixes, measured on the orbit sheet: at the azimuth where a
    // flank or a window turns to face the lens, that face fills much of the
    // frame AND sits at one constant normal, so a threshold it crosses switches
    // the whole panel white at once. The taxi's side glass went to a flat sheet
    // of near-white the moment the camera reached the flank.
    //
    // Real reflectance rises toward grazing angles and is weakest face-on,
    // which is precisely the opposite weighting -- so applying it suppresses the
    // case that broke and strengthens the case the reference actually shows,
    // which is a highlight along a roof and a shoulder seen edge-on. The floor
    // keeps a face-on surface from going completely matte, because a windscreen
    // straight ahead is not a hole.
    '      float ndv = max(dot(sN, sV), 0.0);',
    '      float fres = mix(0.22, 1.0, pow(1.0 - ndv, 1.6));',
    // The sheen is the wide, weak step that says "this material is not chalk";
    // the core is the small hot one that reads as an actual reflection. Both
    // are scaled by the light's own colour, so the highlight is warm under the
    // key and cool under the bounce rather than being a white sticker.
    '      spec += directionalLights[si].color * fres * (sheen * 0.14 + core * 0.55);',
    '    }',
    // THE HIGHLIGHT IS TINTED BY THE SURFACE, and that is a chroma decision
    // rather than a physical one. A dielectric's specular really is the light's
    // own colour -- but a white additive term is, by construction, the fastest
    // way to the neutral axis there is, and this build gates on the area-mean
    // saturation of every hazard. Measured: an untinted highlight took the taxi
    // from S 0.531 to 0.401 and the refuse truck from 0.556 to 0.412, dropping
    // both off a target they had been clearing -- the same arithmetic that the
    // fleet's colour note records for cream and that GLASS_FLASH ran into an
    // hour earlier. Three doors into one room.
    //
    // Mixing 70% of the surface hue back in keeps the highlight bright while
    // leaving it on its own side of neutral. It is also the more honest look
    // for this renderer: everything here is saturated toy plastic, and coloured
    // plastic has a coloured sheen. The divide normalises out VALUE and keeps
    // only hue, so a dark panel gets the same strength of highlight as a light
    // one rather than a proportionally dimmer one.
    '    float mx = max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.001));',
    '    vec3 specTint = mix(vec3(1.0), diffuseColor.rgb / mx, 0.70);',
    '    outgoingLight += spec * specTint * vGloss;',
    '  }',
    '#endif',
  ].join('\n');

  function patchToonSpec(shader) {
    patchToonRamp(shader);
    shader.vertexShader = SPEC_VS_DECL + '\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvGloss = aGloss;'
    );
    shader.fragmentShader = SPEC_FS_DECL + '\n' + shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      SPEC_FS_BODY + '\n\t#include <opaque_fragment>'
    );
  }

  /**
   * Standard toon material. `steps` 2 for props, 3 for characters.
   *
   * `spec` opts the material into the cel specular above. It is a distinct
   * shared function object rather than a closure per material, so every specular
   * toon material still hashes to ONE program: three's default
   * customProgramCacheKey is onBeforeCompile.toString(), and a fresh closure per
   * material would compile a fresh shader per material.
   */
  function toon(color, steps, floor, spec) {
    const m = new THREE.MeshToonMaterial({
      color,
      gradientMap: ramp(steps || 3, floor),
    });
    m.onBeforeCompile = spec ? patchToonSpec : patchToonRamp;
    return m;
  }

  /** Unlit flat colour -- for road paint, HUD-ish world bits, skybox. */
  function flat(color, opts) {
    return new THREE.MeshBasicMaterial(Object.assign({ color }, opts || {}));
  }

  // ---- aerial perspective ------------------------------------------------
  //
  // Distance haze is the depth cue this game leans on hardest: the world spawns
  // scenery 210 units ahead, and without haze a building simply appears at full
  // contrast. scene.fog does the work for three's own materials, but the
  // outline pass is a raw ShaderMaterial, so it needs the same numbers fed to
  // it by hand. These uniform objects are SHARED by every outline material, so
  // one write per frame updates all of them.
  //
  // inkFogColor is stored already encoded for display, because three's own
  // materials mix fog AFTER the colour-space conversion. Matching that is what
  // keeps an outline fading into exactly the same haze as the surface it wraps
  // rather than into a darker version of it.
  // The curve matters as much as the range. At near=26 the haze started
  // eating colour out of a building only 30 units away, which is why the
  // midground used to read as grey no matter what tint it was given; the
  // references keep everything in the first third of the depth fully
  // saturated and then let go quickly, so near went out to 45 with far left
  // alone -- a crisp near field and a steeper fade behind it.
  //
  // Then aerial perspective lost an argument to gameplay. At 45/190 a
  // gate 150 units out was 72% washed into the haze, while World spawns
  // hazards 210 units ahead -- so the far half of the spawn window was scenery
  // the player could not read, and planning was limited to the next gate. In a
  // game where one contact costs the record, the player has to be able to see
  // two or three gates out and choose a line.
  //
  // Pushed to 60/300: a gate at 100 units goes 38% -> 17% hazed and one at 150
  // goes 72% -> 37%, while anything past 200 still sits deep enough in the
  // haze to read as distance. The depth cue survives; the far half of the
  // spawn window becomes usable.
  //
  // THEN THE FAR PLANE WAS MEASURED AND IT NEVER COMPLETED. Nothing spawns
  // past VIEW = 210, and at 210 units a far of 300 gives a fog factor of only
  // (210-60)/(300-60) = 0.625 -- so the most distant object on screen still
  // carried 37.5% of its own colour and chroma, and props POPPED IN at visible
  // contrast instead of condensing out of the haze. Every reference frame has a
  // fully dissolved far plane (Tom Gold Run's pyramid measures S=0.073, which is
  // the sky's own saturation). far = 215 puts the spawn distance at fog factor
  // 0.95 and closes that hole.
  //
  // The gameplay argument above is preserved because it was never about the far
  // plane. Gates are committed to at 26-90 units: at 60/215 a gate at 90 sits at
  // 0.19 hazed (was 0.13) and one at 120 at 0.39 (was 0.25) -- the read window
  // is materially unchanged and the depth cue behind it is much stronger. What
  // is given up is planning against a gate 150+ units out, which the racing line
  // (ROUTE_FAR = 124) and the route rings now do far better than a silhouette in
  // haze ever did.
  const FOG_NEAR = 60;
  const FOG_FAR = 215;

  const fogU = {
    inkFogColor: { value: new THREE.Color(1, 1, 1) },
    inkFogNear: { value: FOG_NEAR },
    inkFogFar: { value: FOG_FAR },
  };

  // The same haze colour the ground fades into, kept in LINEAR working space
  // for the sky shader -- which mixes in linear and converts once at the end,
  // so it cannot use the display-encoded copy above. Shared by value object
  // with every sky material, exactly like the ink uniforms.
  //
  // This exists because the horizon used to fade to WHITE. That is the single
  // largest measured colour defect in the frame: the sky is 8-31% of the
  // picture and 22-77% of clarity.js's far band, and it was rendering at
  // S 0.105-0.248 against a non-sky frame of 0.271-0.367 and a reference sky
  // of 0.54-0.69. Fading to the biome's own fog colour instead is not a
  // compromise between chroma and the seam -- it is strictly better at BOTH,
  // because the ground fades to precisely this value, so the horizon now
  // matches by construction in all six biomes and eighteen city palettes
  // rather than in whichever one the fixed white was chosen against.
  const skyHazeU = { value: new THREE.Color(1, 1, 1) };
  const skyMats = [];

  let fogHex = -1;

  function syncFog(fog) {
    if (!fog) return;
    // getHex() quantises to 8 bits, so a per-frame biome cross-fade only trips
    // this on the handful of frames where the haze visibly moves.
    const hex = fog.color.getHex();
    if (hex === fogHex && fogU.inkFogNear.value === fog.near && fogU.inkFogFar.value === fog.far) return;
    fogHex = hex;
    fogU.inkFogColor.value.setRGB(encode(fog.color.r), encode(fog.color.g), encode(fog.color.b));
    fogU.inkFogNear.value = fog.near;
    fogU.inkFogFar.value = fog.far;
    // fog.color is already linear (a THREE.Color built from a hex under
    // ColorManagement), which is what the sky shader wants -- no encode() here,
    // and that asymmetry with inkFogColor above is the whole reason the two are
    // kept as separate uniforms rather than one shared value.
    skyHazeU.value.copy(fog.color);
    // A ShaderMaterial only re-uploads on demand; there are a handful of
    // cached outline materials so flagging them all is free.
    outlineMats.forEach(function (m) { m.uniformsNeedUpdate = true; });
    for (let i = 0; i < skyMats.length; i++) skyMats[i].uniformsNeedUpdate = true;
  }

  // ---- ink outlines ------------------------------------------------------

  // `thickness` is a WORLD-space extrusion in units, not a multiplier. An
  // earlier version scaled purely by view depth with a fat constant, which
  // extruded a 0.07-unit forearm by 0.12 units -- the runner rendered as a
  // solid black blob and buildings grew slab-sided edges. Keeping the base in
  // world units means a part can never be swallowed by its own outline.
  //
  // The depth term is what holds screen width constant, and the old 0.022/unit
  // was far too weak: a hazard 40 units out drew a sub-pixel line while the
  // same hazard at 10 units drew two. 0.05/unit tracks true screen-constant
  // width for this camera; the clamp at 3.6 stops a distant crowd capsule --
  // four pixels tall -- from being eaten by its own outline. Beyond that the
  // haze has taken over anyway.
  /**
   * THE INK SHELL HAS TO MOVE WITH WHAT IT OUTLINES.
   *
   * This used to be a fixed string reading straight from `position`, and the
   * comment on outlined() below claimed silhouette and fill "can never drift
   * apart". That is true of anything animated by moving the GROUP and false of
   * everything animated in the vertex shader -- which, in this game, is every
   * spectator in every grandstand and now every tree. The shell stayed in the
   * rest pose while the body it wrapped jumped out of it, so the crowd has
   * been outlined in a static ghost of itself since the wave shipped, and the
   * foliage would have been the same the moment the wind was added.
   *
   * It is not only a look. The ink is drawn as a back-face shell AT the
   * silhouette, which is exactly where a displaced fill differs from its rest
   * pose -- so a static shell sits on top of the moving edge and HIDES the
   * motion. Measured on RIVERSIDE, the most heavily planted leg in the game,
   * a full sway moved 0.55% of the frame with the shell rigid.
   *
   * So the displacement is injected here as well, from the same source string
   * the fill material uses -- passed through rather than copied, because two
   * hand-kept copies of a vertex program is the defect this file already has a
   * note about elsewhere.
   */
  function outlineVS(chunk) {
    return `
    uniform float thickness;
    ${chunk ? chunk.decl : ''}
    varying float vDepth;
    void main() {
      vec3 transformed = vec3(position);
      ${chunk ? chunk.body : ''}
      vec3 n = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
      vDepth = -mv.z;
      mv.xyz += n * thickness * clamp(0.75 + 0.05 * vDepth, 0.90, 3.6);
      gl_Position = projectionMatrix * mv;
    }`;
  }

  // Ink fades into the haze slightly ahead of the surface it wraps (the 0.82
  // exponent). Distant scenery therefore loses its hard black edge before it
  // loses its shape, which is what stops the far skyline reading as a sheet of
  // stickers floating in fog.
  const OUTLINE_FS = `
    uniform vec3 oColor;
    uniform vec3 inkFogColor;
    uniform float inkFogNear;
    uniform float inkFogFar;
    varying float vDepth;
    void main() {
      float f = smoothstep(inkFogNear, inkFogFar, vDepth);
      gl_FragColor = vec4(mix(oColor, inkFogColor, pow(f, 0.82)), 1.0);
    }`;

  // Outline materials are immutable and there are only a handful of distinct
  // (thickness, colour) pairs, so they are cached: hundreds of pooled scenery
  // objects used to carry hundreds of identical ShaderMaterials.
  const outlineMats = new Map();

  // An INK weight of 0 has to mean "no line", not "a line of zero width" --
  // a zero extrusion leaves the shell exactly coincident with the fill and
  // z-fights it into a shimmering mess. Callers pass a weight straight out of
  // INK without checking, so the check lives here: weight 0 hands back one
  // shared material with visible=false, which WebGLRenderer.projectObject
  // filters out before it ever reaches a draw call. Zero draws, zero state
  // changes, and every caller keeps working untouched.
  let hiddenInk = null;
  function hiddenInkMaterial() {
    if (!hiddenInk) {
      hiddenInk = new THREE.MeshBasicMaterial();
      hiddenInk.visible = false;
      hiddenInk.name = 'ink/none';
    }
    return hiddenInk;
  }

  /**
   * @param thickness world units of extrusion (see OUTLINE_VS). 0 or less
   *        returns a shared invisible material -- see above.
   */
  /**
   * @param chunk optional { key, decl, body, uniforms } describing a vertex
   *        displacement the outlined geometry also carries on its fill. Keyed
   *        into the shared cache so one shell material is built per (weight,
   *        colour, displacement) rather than per mesh.
   */
  function outlineMaterial(thickness, color, chunk) {
    const t = thickness === undefined ? INK.character : thickness;
    if (!(t > 0)) return hiddenInkMaterial();
    const c = color === undefined ? PALETTE.ink : color;
    const key = t + '/' + c + '/' + (chunk ? chunk.key : '-');
    let m = outlineMats.get(key);
    if (m) return m;
    const uniforms = {
      thickness: { value: t },
      oColor: { value: displayColor(c) },
      inkFogColor: fogU.inkFogColor,
      inkFogNear: fogU.inkFogNear,
      inkFogFar: fogU.inkFogFar,
    };
    // The SHARED uniform objects, not copies: the shell and the fill have to
    // read the same clock or the outline lags its own body by a frame.
    if (chunk && chunk.uniforms) {
      for (const k in chunk.uniforms) uniforms[k] = chunk.uniforms[k];
    }
    m = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: outlineVS(chunk),
      fragmentShader: OUTLINE_FS,
      side: THREE.BackSide,
    });
    outlineMats.set(key, m);
    return m;
  }

  /**
   * Wrap a mesh in its own outline shell. Returns a Group holding both, so
   * animating the group moves silhouette and fill together and they can never
   * drift apart.
   *
   * A fill material that displaces vertices in its own vertex shader announces
   * that on `userData.vertexChunk`, and the shell is built with the same
   * displacement -- see outlineVS. Without that the two DO drift apart, in the
   * one way this sentence did not cover.
   *
   * At INK weight 0 the shell mesh is still built and still parented, but it
   * is switched off. That is on purpose: callers hold on to
   * `group.userData.line` and scale or reposition it alongside the fill (a
   * pooled building does exactly this every time it is claimed), so removing
   * the object would turn a weight change into a crash. An invisible child is
   * one matrix update per frame and no draw call.
   */
  function outlined(geometry, material, thickness) {
    const t = thickness === undefined ? INK.character : thickness;
    const g = new THREE.Group();
    const fill = new THREE.Mesh(geometry, material);
    const line = new THREE.Mesh(geometry,
      outlineMaterial(t, undefined, material && material.userData && material.userData.vertexChunk));
    line.renderOrder = -1;
    line.visible = t > 0;
    g.add(line, fill);
    g.userData.fill = fill;
    g.userData.line = line;
    return g;
  }

  // ---- sky ---------------------------------------------------------------

  /**
   * Cloud sheet, drawn once into a tiling canvas. Clouds have to be a texture
   * rather than shader noise: the sky covers a third of the frame and this has
   * to hold 60fps under SwiftShader, where a two-octave noise per sky pixel is
   * not affordable but one mipmapped fetch is.
   *
   * Red channel carries the shading mask (lit top vs shaded underside), alpha
   * carries coverage. The seed is fixed, because the sky must be identical for
   * every player on the same day just like the course is.
   */
  let cloudTex = null;
  function clouds() {
    if (cloudTex) return cloudTex;
    // 1024 rather than 512: one tile is stretched across most of the visible
    // sky, so at 512 the clouds were magnified past their own texels and the
    // hard cel edge turned into a soft airbrushed smudge.
    const N = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');

    let s = 0x2f6f2b1d;
    const rnd = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

    // Few and large, with a wide size spread. A dense field of small puffs
    // tiles visibly -- the eye finds the grid immediately once the same shape
    // shows up four times across the frame.
    const puffs = [];
    for (let i = 0; i < 12; i++) {
      const cx = rnd() * N, cy = rnd() * N;
      // Larger, lower cumulus: a reader read the old field as 'small,
      // wispy, high' against the reference's big soft bank at the horizon.
      const w = N * (0.105 + rnd() * rnd() * 0.225);
      const n = 4 + Math.floor(rnd() * 4);
      const lobes = [];
      for (let j = 0; j < n; j++) {
        const u = n === 1 ? 0.5 : j / (n - 1);
        lobes.push({
          x: (u - 0.5) * w * 2.1 + (rnd() - 0.5) * w * 0.35,
          y: (rnd() - 0.5) * w * 0.26,
          // Taper the ends so a cluster of circles reads as one cloud.
          r: w * (0.40 + rnd() * 0.45) * (1.0 - Math.abs(u - 0.5) * 1.1),
        });
      }
      puffs.push({ cx, cy, lobes });
    }

    // Nine copies so shapes crossing a tile edge wrap instead of being cut.
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (const p of puffs) {
          const bx = p.cx + ox * N, by = p.cy + oy * N;
          g.fillStyle = 'rgba(70,70,70,1)';
          for (const l of p.lobes) {
            g.beginPath();
            g.arc(bx + l.x, by + l.y + l.r * 0.40, Math.max(1, l.r), 0, 6.2832);
            g.fill();
          }
          g.fillStyle = 'rgba(255,255,255,1)';
          for (const l of p.lobes) {
            g.beginPath();
            g.arc(bx + l.x, by + l.y - l.r * 0.10, Math.max(1, l.r * 0.92), 0, 6.2832);
            g.fill();
          }
        }
      }
    }

    cloudTex = new THREE.CanvasTexture(cv);
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    cloudTex.generateMipmaps = true;
    cloudTex.minFilter = THREE.LinearMipmapLinearFilter;
    cloudTex.magFilter = THREE.LinearFilter;
    return cloudTex;
  }

  const SKY_VS = `
    varying vec3 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;

  /**
   * The gradient is taken from the direction the EYE is looking, normalised in
   * the fragment shader. The old version normalised the dome's own vertex
   * position and quantised it hard, so every band followed a latitude ring of
   * a 24x16 sphere sitting off to one side of the camera -- which is exactly
   * the curved dark arcs the sky was criticised for. Eye-relative direction
   * plus fwidth-softened steps removes the geometry from the result entirely.
   */
  /**
   * THE CLOUD DRIFT, WHICH IS WIND SPEED OVER CLOUD HEIGHT AND NOTHING ELSE.
   *
   * p in SKY_FS is d.xz/h, which is exactly a position on a plane one unit
   * above the eye. A sheet at height H under a crosswind v therefore crosses p
   * at v/H per second -- so this constant is not a tuning knob in arbitrary
   * units, it is metres per second divided by metres, and it can be set from
   * the sky instead of from taste. 10 m/s under low cumulus based at 750 m is
   * 0.0133, which is what this is.
   *
   * The far sheet takes 0.55 of it in the SAME direction, which is the near
   * sheet sitting at 55% of the far sheet's altitude. See the sample sites.
   *
   * ==== THE BRIEF SAID THE CLOUDS WERE TOO SLOW TO PERCEIVE. THEY WERE NOT.
   *
   * Measured on the live page at the top 8% of a 420x860 frame, before any
   * change: 5.47 px/s, i.e. 0.478 deg/s, i.e. 3.1 frame widths of travel
   * across a four-minute race. The premise that a 182-second texture repeat
   * means an imperceptible sky is a unit error -- what a viewer sees is an
   * ANGULAR rate, and the repeat period of the texture does not appear in it.
   * At 1500 m the shipped sheets were a 27 m/s gale.
   *
   * What was actually wrong is a parallax defect, which is squarely on brief:
   *
   *   far  (S 0.125)  o = 0.41 - t*0.0022   ->  dp/dt = +0.01760
   *   near (S 0.300)  o =        t*0.0055   ->  dp/dt = -0.01833
   *
   * Opposite signs at 96% of the same magnitude. Two sheets sliding THROUGH
   * each other is not depth, and the comment at the sample site claimed it as
   * "the parallax between them gives the sky depth for free". It gave shear.
   *
   * So the far sheet is turned around to agree with the near one -- the near
   * one keeps the direction it shipped with, so the sky still travels the way
   * it always did -- and the rate comes down from a gale to a breeze. They
   * still beat against each other at 0.45 of the near rate, which is what
   * keeps the composite CHANGING SHAPE rather than scrolling as a rigid sheet;
   * losing that was the one real thing the counter-motion was buying.
   *
   * Result, same instrument: 5.47 -> 4.00 px/s, and every frame of it now
   * going the same way. This is the rare item where the honest fix REDUCES a
   * number in a task about adding motion, and it is recorded plainly so that
   * nobody re-raises "the clouds are too slow" from the texture constant.
   *
   * NOT time-compressed. TIME_SCALE runs the RACE at 30x and the sky must not
   * take it: the sun does not move, so clouds at 30x read as time-lapse under
   * a pinned sun. Authored against the player's wall clock instead.
   */
  const CLOUD_DRIFT = 0.0133;

  const SKY_FS = `
    #define CLOUD_DRIFT ${CLOUD_DRIFT.toFixed(5)}
    uniform vec3 top;
    uniform vec3 bottom;
    uniform vec3 sunColor;
    uniform vec3 glowColor;
    uniform vec3 sunDir;
    uniform vec3 hazeColor;
    uniform sampler2D cloudMap;
    uniform float time;
    varying vec3 vWorld;
    ${LIN2SRGB}
    void main() {
      vec3 d = normalize(vWorld - cameraPosition);
      float h = d.y;

      // Bands are driven by height over the camera's HORIZONTAL forward axis,
      // not by elevation angle. Elevation isolines are cones around the eye
      // and project to curves -- that is the arcing the old sky was criticised
      // for, and moving the maths off the dome's vertices only shrank the arcs
      // rather than removing them. Every isoline here is instead a plane
      // through the eye containing the horizon direction, and such a plane
      // always projects to a straight line parallel to the horizon itself, at
      // any camera yaw, pitch or roll. Using plain world z instead of fwd
      // leaves the bands converging on the x-axis vanishing point, which tilts
      // them a visible 8 degrees off the horizon when the chase camera turns.
      vec3 back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
      vec3 fwd = normalize(vec3(-back.x, 0.0, -back.z));
      float sy = d.y / max(dot(d, fwd), 0.30);

      // The gradient has to climb inside the band this camera can SEE. The
      // chase eye sits at 3.10 looking at 1.16 eleven units ahead, so the view
      // centre is 7.2 degrees below level and a 58 degree frame reaches only
      // 21.8 degrees above it -- sy runs 0 to about 0.40, never further. At the
      // old 1.55 that put the top of the frame at t = 0.68, so the deep blue at
      // the top of every biome palette was NEVER ON SCREEN and the visible sky
      // was the pale bottom stop plus a bit. The pale bottom is correct and
      // stays: world.js pairs it with the biome fog (sky[1] 0xc6e8ff against
      // fog 0xcfe6f2) so the horizon meets the fogged ground. What was wrong is
      // that the sky never left it. 3.20 reaches t = 1.0 at 13 degrees, so the
      // top third of the visible band is the palette's own deep stop and
      // everything below it climbs twice as fast as before.
      //
      // Swept against the six shipped biome sky/fog pairs: 2.55 gives a mean
      // visible-sky saturation of 0.232 and 4.00 gives 0.260, but 4.00 flattens
      // the top 40% of the band into one block of the deep stop and loses the
      // gradient the cel steps are there to show. 3.20 takes 0.251 of that and
      // keeps the ramp.
      float t = clamp(sy * 3.20 + 0.07, 0.0, 1.0);

      // The cel steps are gone with the rest of the toon look: the reference
      // sky (citylook-*.jpg) is one continuous gradient with painterly cumulus
      // on it, and the four hard bands were the one place the sky still said
      // "toon" after the ramp went soft. The t ramp above already carries the
      // depth of colour the steps were re-quantising.
      vec3 col = mix(bottom, top, t);

      // Sun: broad bloom, two quantised corona steps, hard disc -- a poster
      // sun, not a lens flare. Drawn before the clouds so cover passes in
      // front of it.
      float sd = max(dot(d, sunDir), 0.0);
      col += glowColor * pow(sd, 8.0) * 0.20;
      col = mix(col, mix(glowColor, sunColor, 0.35), smoothstep(0.99680, 0.99700, sd) * 0.65);
      // Over 1.0 on purpose: the core clips to white so it reads as a light
      // source rather than as a cream circle painted on the sky.
      col = mix(col, sunColor * 1.25, smoothstep(0.99845, 0.99862, sd));

      // Horizon haze. Zero exactly at the horizon so the sky meets the fogged
      // ground with no step, peaking a few degrees above it. Driven by the
      // same straight-line coordinate as the bands so its thickness is even
      // across the frame.
      //
      // It fades to hazeColor -- the LIVE scene fog colour -- and not, as it
      // used to, to a fixed 42% white. Measured on the shipped frame, that
      // white put the band just above the horizon at S 0.039 while the same
      // band in the reference holds S 0.511; it was washing out exactly the
      // rows the far road, the mile banners and the spawn edge are read
      // against. Fading to the fog colour is what the seam actually wants:
      // every fogged surface in the frame converges on this value, so the
      // horizon is now continuous by construction in every biome instead of in
      // none of them.
      // The weight came down 0.85 -> 0.60 with the change of target. Fading to
      // WHITE needed to be strong to hide a seam it was itself creating, since
      // white is not where the ground ends up; fading to the ground's own
      // colour needs only enough to soften the join, and every 0.05 of it is
      // chroma spent on a band the reference keeps at S 0.511.
      float hz = smoothstep(0.0, 0.055, sy) * exp(-max(sy, 0.0) * 8.0);
      col = mix(col, hazeColor, hz * 0.60);

      // Clouds ride a virtual plane overhead, so they converge toward the
      // horizon the way real ones do instead of being pasted on the dome.
      // Two layers at different scales and drift speeds: one sheet repeats
      // obviously across a 47-degree field, two beating against each other do
      // not.
      //
      // The two sheets used to drift in OPPOSITE directions at 96% of the same
      // magnitude, which is a shear rather than the depth this comment claimed.
      // A feature holds a fixed texture coordinate, so with offset o and scale
      // S it crosses the cloud plane at dp/dt = -(do/dt)/S; both sample sites
      // below are now signed so that rate is negative for both, and the far
      // sheet is held to 0.55 of the near one. The derivation of the rate
      // itself, and the measurement that refuted the brief that opened it, are
      // on CLOUD_DRIFT.
      vec2 p = d.xz / max(h, 0.035);
      float r = length(p);
      // Nothing survives out where one texel spans a degree of sky -- without
      // this the last few degrees above the horizon boil into grey stipple.
      float reach = (1.0 - smoothstep(2.4, 5.6, r)) * smoothstep(0.07, 0.24, h);

      // COVER, and it is the number that decides whether this is a blue sky
      // with clouds in it or an overcast lid.
      //
      // The cloud canvas is drawn as filled circles, so its alpha is 1 over a
      // core and then carries a wide antialiased-plus-magnified skirt once one
      // tile is stretched across the sky. Sampled raw, that skirt is what puts
      // cloud over essentially the whole visible band -- and a 60% alpha of a
      // near-white is a wash, not a cloud. Shaping alpha through a step keeps
      // the cores at full strength, drops the skirts, and gives back the blue
      // between them. The references are perhaps a fifth cloud by area; this
      // is the control that sets ours. Applied at both sheets below.

      // The shaded half is derived from the LIT cloud colour, not from the sky
      // top uniform: tying it to that painted navy blobs into a pale blue sky,
      // which read as holes rather than as cloud.
      //
      // Both stops carry more of the sky than they used to (0.10 -> 0.30), and
      // the shaded half is now mixed against the LOCAL sky rather than the
      // bottom stop. That is not a style preference, it is the arithmetic of
      // coverage. A white cloud is right -- the reference's own clouds measure
      // S 0.154 -- but the reference shows perhaps a fifth of its sky as cloud
      // while the reach term below puts ours over essentially all of it: its
      // smoothstep on h saturates at 0.24 and this camera never looks above
      // h = 0.371, so coverage is total across the whole visible band. At
      // 100% coverage the cloud colour IS the sky colour, so a 0.10 white was
      // not painting clouds on a blue sky, it was painting the sky white.
      vec3 lit = mix(vec3(1.0), bottom, 0.30);
      vec3 shd = mix(lit * 0.58, col, 0.42);

      // The far sheet gets aerial perspective of its own: pale and flat, with
      // no shaded half at all. Giving it the same underside as the near sheet
      // painted grey streaks across a light sky that read as smudge.
      //
      // Its weight came down (0.80/0.55 -> 0.55/0.38) because at the old figure
      // it was not a cloud layer at all: lo.a covers most of the tile, so it
      // acted as a flat 44% wash toward near-white over the WHOLE visible sky.
      // Switching it off outright was measured at +0.085 mean saturation in the
      // top tenth of the frame, the largest single term in the sky; this keeps
      // the parallax it was added for and gives most of that back.
      vec4 lo = texture2D(cloudMap, p * 0.125 + vec2(0.41 + time * CLOUD_DRIFT * 0.55 * 0.125, 0.63));
      col = mix(col, mix(col, lit, 0.55), smoothstep(0.26, 0.78, lo.a) * reach * 0.48);

      vec4 hi = texture2D(cloudMap, p * 0.300 + vec2(time * CLOUD_DRIFT * 0.300, 0.0));
      col = mix(col, mix(shd, lit, smoothstep(0.35, 0.65, hi.r)), smoothstep(0.22, 0.70, hi.a) * reach);

      gl_FragColor = vec4(lin2srgb(col), 1.0);
    }`;

  /** Vertical two-stop sky with sun, horizon glow and drifting cel clouds. */
  function skyDome(radius, top, bottom) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(top === undefined ? PALETTE.skyTop : top) },
        bottom: { value: new THREE.Color(bottom === undefined ? PALETTE.skyBot : bottom) },
        sunColor: { value: new THREE.Color(PALETTE.sun) },
        glowColor: { value: new THREE.Color(PALETTE.sunGlow) },
        // Up-and-forward, matching the key light so the lit side of the runner
        // points back at the visible sun. World +x is SCREEN LEFT for a camera
        // looking down +z. The z flipped with the key light: the sun is now
        // BEHIND the camera, where every citylook reference frame keeps it --
        // no frame in the set shows a sun disc, and a street lit from behind
        // the viewer is what their facades' lighting says. The disc still
        // exists for any framing that turns (the finish celebration looks
        // back down the road and picks it up).
        sunDir: { value: new THREE.Vector3(0.27, 0.82, -0.49).normalize() },
        // Shared value object, so one syncFog() write moves every sky in the
        // scene -- and so a dome built before the first syncFog still picks the
        // colour up rather than being stuck on the constructor's guess.
        hazeColor: skyHazeU,
        cloudMap: { value: clouds() },
        time: { value: 0 },
      },
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    skyMats.push(mat);
    // 32x24 rather than 24x16: the fragment maths is geometry-independent, but
    // a coarse sphere still interpolates world position across wide facets and
    // the sun disc would visibly wobble as it crossed one.
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), mat);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    mesh.onBeforeRender = function () {
      mat.uniforms.time.value = performance.now() * 0.001;
    };
    return mesh;
  }

  // ---- contact shadow ----------------------------------------------------
  //
  // Every reference frame grounds its character with a soft dark blob under
  // the feet, and it is doing more work than it looks like: without it a
  // figure drawn over a road has nothing tying it to a specific point on that
  // road, and at this camera angle it reads as floating a foot in the air.
  // It is also the cheapest depth cue in the game -- one alpha-blended quad.
  //
  // Deliberately NOT a real shadow. No lights cast, no shadow map, no depth
  // pass: SwiftShader cannot afford a 1024 map at 60fps and the toy look does
  // not want an accurate one anyway. A fake blob that is always directly under
  // the object is what the references draw.

  let blobTex = null;

  /**
   * The falloff, drawn once into a canvas and shared by every shadow. Alpha
   * carries the shape; rgb is left white so the material's own `color` is the
   * only thing tinting it.
   *
   * The profile is a SOLID CORE with a smooth rim, not a plain radial
   * gradient. A linear or squared falloff thins evenly from the middle and
   * reads as a smudge under the character; what the references draw is an
   * almost flat dark ellipse that gives up quickly at its edge, because that
   * is what a body-sized occluder close to the ground actually casts. Held
   * full out to 30% of the radius, then smoothstepped to nothing.
   *
   * The canvas is only 96px: it is never seen larger than a couple of hundred
   * screen pixels and it is magnified with linear filtering, so the smooth
   * part of the profile costs nothing to resolve.
   */
  function blobTexture() {
    if (blobTex) return blobTex;
    const N = 96;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    const img = g.createImageData(N, N);
    const d = img.data;
    const c = (N - 1) / 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x - c) / c, dy = (y - c) / c;
        const r = Math.sqrt(dx * dx + dy * dy);
        const u = Math.max(0, Math.min(1, (r - 0.30) / 0.70));
        const a = 1 - u * u * (3 - 2 * u);
        const i = (y * N + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    blobTex = new THREE.CanvasTexture(cv);
    blobTex.colorSpace = THREE.SRGBColorSpace;
    blobTex.generateMipmaps = false;
    blobTex.minFilter = blobTex.magFilter = THREE.LinearFilter;
    blobTex.wrapS = blobTex.wrapT = THREE.ClampToEdgeWrapping;
    return blobTex;
  }

  /**
   * A soft contact shadow: one ground-facing quad with a radial falloff,
   * meant to be parented to a character or a prop so it travels with it.
   *
   * CONTRACT
   *   const sh = S.contactShadow(0.42);     // radius in WORLD UNITS
   *   runner.root.add(sh);                  // parent at the object's ORIGIN
   *
   *   sh.position.y            already 0.015 -- just clear of the road, whose
   *                            paint sits at 0.006. Set it to the GROUND
   *                            height under the object, not to the object's
   *                            own height: the shadow stays on the road while
   *                            the runner jumps, so when the parent lifts,
   *                            subtract the lift back off here. Never let the
   *                            result reach 0; below the tarmac it is depth-
   *                            rejected and vanishes with no other symptom.
   *   sh.scale.setScalar(k)    k MULTIPLIES the radius asked for, so 1 is the
   *                            size requested and no caller has to remember
   *                            the number. Growing and fading it with jump
   *                            height makes the jump read twice as high.
   *   sh.material.opacity      0..1 fade. Each shadow gets its own material
   *                            (the texture and the geometry are shared), so
   *                            writing this affects only that one object.
   *   sh.visible = false       switch it off; costs nothing while hidden.
   *
   * The quad already lies flat in XZ facing +Y, so it needs no rotation from
   * the caller. It is unlit, writes no depth (overlapping shadows blend
   * instead of z-fighting) and is fogged like everything else, which is what
   * makes a distant prop's shadow fade into the haze at the same rate as the
   * prop standing on it.
   *
   * CAVEATS: it inherits the parent's rotation, so parent it to a node that
   * stays upright -- the runner's root, not its leaning torso -- or the blob
   * tips up off the road and gives the trick away. And do not dispose its
   * geometry or its map; both are shared with every other shadow in the game.
   *
   * @param radius  world units to the blob's visible edge. Default 0.42,
   *                about right for the player.
   * @param opts    {opacity, color} -- both optional, both also settable on
   *                the returned mesh's material afterwards.
   */
  function contactShadow(radius, opts) {
    const r = radius === undefined ? 0.42 : radius;
    const o = opts || {};
    const mat = new THREE.MeshBasicMaterial({
      map: blobTexture(),
      color: o.color === undefined ? PALETTE.contact : o.color,
      transparent: true,
      // Measured against the road rather than guessed: at 0.5 the core came
      // out only 25% darker than the tarmac under it, which is a smudge, not
      // a shadow, and the runner still read as floating. 0.72 lands the core
      // about 40% down, which is where the references sit. Anything on light
      // ground wants less -- pass it in.
      opacity: o.opacity === undefined ? 0.72 : o.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      // EVERY CONTACT SHADOW IN THIS GAME WAS COSTING TWO DRAW CALLS, and the
      // reason is three's, not ours. WebGLRenderer.renderObject reads:
      //
      //   transparent && side === DoubleSide && !forceSinglePass
      //     -> render BackSide, then render FrontSide
      //
      // so a transparent double-sided material is submitted TWICE, with a
      // needsUpdate flag set between the two halves. Measured on the live page
      // at 08-level, which is the peak-draw shot: 18 hazard blobs, 16 of them
      // in frustum, and hiding them took the frame from 297 draws to 265 --
      // exactly 2 per blob, not 1. Draw calls are the binding constraint in
      // this game (297 against a working ceiling near 400) and this was 11% of
      // the peak frame spent rendering the same flat quad twice.
      //
      // The split exists so that a transparent SOLID sorts its own back faces
      // before its front ones. This is a single flat quad: its two faces are
      // coplanar, so the second pass draws the same pixels at the same depth
      // and can never change the image. forceSinglePass keeps DoubleSide's
      // culling behaviour -- the blob is still visible from underneath, which
      // matters on the bridge deck -- and submits it once.
      //
      // Verified as an A/B on the running page rather than reasoned about:
      // pixels identical, draws 297 -> 265.
      forceSinglePass: true,
    });
    const mesh = new THREE.Mesh(shadowGeo(r), mat);
    mesh.position.y = 0.015;
    // After the water plane, which is the other transparent thing on the
    // ground, so a shadow on the bridge deck is never sorted underneath it.
    mesh.renderOrder = 2;
    mesh.userData.radius = r;
    return mesh;
  }

  // The radius is baked into the geometry so that `scale` stays free for the
  // caller to use as a plain multiplier. PlaneGeometry is built in XY, so it
  // is rotated flat here, once, rather than on every mesh -- which is also
  // what lets scale.x/scale.z mean what a caller expects.
  //
  // Cached by radius: there are only ever a handful of distinct sizes (the
  // player, the rivals, whatever props take one), and 4 vertices each is far
  // cheaper than the alternative of an off-by-a-factor-of-2r scale contract.
  const shadowGeos = new Map();
  function shadowGeo(r) {
    const key = Math.round(r * 1000);
    let g = shadowGeos.get(key);
    if (!g) {
      g = new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2);
      shadowGeos.set(key, g);
    }
    return g;
  }

  // ---- lighting ----------------------------------------------------------

  /**
   * The lighting rig. Toon materials band on top of real lights, so the key
   * direction decides where the terminator falls -- keep it high and slightly
   * camera-left so the runner's front stays lit while the trailing leg darkens.
   * The bounce is deliberately cool and the ambient only just strong enough to
   * keep the darkest ramp band from closing up: between them they are what
   * gives shaded faces a blue cast rather than a grey one.
   *
   * The SHAPE OF THE FILL is the other half of losing the outlines, and it is
   * where most of the work went. Fill light is what collapses a banded ramp:
   * a unit of ambient adds equally to the lit face and the shaded one, so it
   * shrinks the ratio between them. The old rig spent 1.25 of its ~3.3 units
   * of exposure on flat fill -- fine under a black rim, because the rim was
   * doing the separating, but with no rim a building read as one flat slab of
   * colour whichever way its faces pointed.
   *
   * So the flat ambient is gone, replaced by a hemisphere. That is not a
   * cosmetic swap. A hemisphere's contribution falls off with normal.y, which
   * means:
   *
   *   - the road, the shoulder and every prop's top face take the full sky
   *     fill on top of a full key, and stay bright and saturated;
   *   - the vertical faces around them -- buildings, walls, barriers, and the
   *     runner's own back -- take roughly half of it;
   *
   * and the gap between those two is the play surface separating from its
   * surroundings without a single colour being changed. It is also free
   * ambient occlusion: undersides go to the warm ground term instead of the
   * cool sky one, so a hazard's overhang darkens and warms on its own.
   *
   * Net effect on a plain box, top face against camera-facing face: the two
   * used to sit at a display ratio of about 0.78 -- a step you had to look
   * for. They now sit near 0.66, which reads as shading. Total exposure on a
   * flat-lit road is within 2% of where it was, so nothing else has to move.
   */
  function lights(scene) {
    // THE KEY COMES FROM BEHIND THE CAMERA NOW. It used to sit ahead of the
    // runner (z +11), which under the banded ramp barely mattered -- most
    // things landed in one band or another regardless -- but under the soft
    // ramp it meant every surface facing the LENS sat in cool bounce light:
    // the facades, the hazard read faces, the runner's back -- the entire
    // picture the player looks at was the unlit side of the world. Every
    // citylook reference frame is lit the other way: the street the camera
    // looks down is in sun, one flank of it warmer than the other, and no
    // sun disc is ever in frame. Flipping z puts the warm key on exactly the
    // faces the player reads, and the hazard-contrast margins WIDEN with it
    // (read faces climb off the ramp floor) -- verified through shoot.js.
    // Along skyDome's sunDir, lifted for the terminator on the runner's legs.
    // Elevation rose ~35 -> ~55 degrees for the redraft: the reference's
    // shadows are short and its roofs, bonnets and the road itself carry the
    // sun. At the old low sun the flipped key raked the street and the
    // vehicles' top surfaces never reached the highlight the reference puts
    // there.
    // A touch more golden for the citylook pass (reader: 'golden-hour
    // building tones' in the reference against our 'grayish-brick').
    const key = new THREE.DirectionalLight(0xffeeca, 2.30);
    key.position.set(5.0, 15.0, -9.0);

    // The fill flips with it: it now aims DOWN the camera axis from behind
    // the far side of the scene, so the faces pointing away from the lens --
    // the ones the key just left -- keep a cool floor instead of going dead.
    // Same colour and strength as before; only the axis changed.
    const bounce = new THREE.DirectionalLight(0x86aeff, 0.42);
    bounce.position.set(-6, 2, 9);

    // Cool sky over a warm ground, which is the whole trick: it puts a
    // warm/cool split across every curved or angled surface for the price of
    // one light, and that split is most of what makes the references' shading
    // read as coloured rather than as grey applied at different strengths.
    // Sky term eased toward neutral for the citylook pass: at 0xbcd8ff a
    // shaded cream facade rendered pale blue-grey; the reference keeps its
    // shaded walls warm (see the ramp's cool note).
    const hemi = new THREE.HemisphereLight(0xc6d6e2, 0x4a4030, 0.55);

    // Kept, but only as a floor -- just enough that nothing in the frame can
    // reach zero and turn into a black hole in a saturated picture.
    const amb = new THREE.AmbientLight(0xb8c4d8, 0.10);

    scene.add(key, bounce, hemi, amb);

    // Haze range is a look decision, so it lives with the rest of the look.
    // main.js owns the fog COLOUR (it cross-fades per biome); the distances
    // have to sit inside World.VIEW = 210 or scenery pops into frame at full
    // contrast, which is the "no aerial perspective" complaint.
    if (scene.fog) {
      scene.fog.near = FOG_NEAR;
      scene.fog.far = FOG_FAR;
    }

    // The outline pass carries its own copy of the fog, and scene.onBeforeRender
    // is the one hook guaranteed to run exactly once per frame before anything
    // is drawn. Chain rather than overwrite in case something else wants it.
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, sc, camera, target) {
      syncFog(sc.fog);
      if (prev) prev.call(this, renderer, sc, camera, target);
    };
    syncFog(scene.fog);

    return { key, bounce, hemi, amb };
  }

  return {
    PALETTE, INK, ramp, toon, flat, outlineMaterial, outlined, skyDome, lights,
    clouds, syncFog, contactShadow,
  };
})();
