/**
 * Cel-shading toolkit: banded toon ramps, normal-extruded ink outlines, the
 * atmosphere (sky dome + aerial perspective), the contact shadow, and the
 * palette everything else draws from.
 *
 * The look is toy-plastic: few, wide bands; saturated mid-tones; a warm key
 * and a cool bounce so shadowed sides read blue rather than grey; and a
 * strong contact shadow grounding anything that stands on the road.
 *
 * OUTLINE POLICY, because it is the one place this build knowingly disagrees
 * with its own references. Subway Surfers and Sonic Forces -- the stated art
 * target -- use NO ink lines at all. They read as toys through saturated flat
 * colour, a wide soft light/shade step, chunky proportions and a contact
 * shadow; silhouettes separate on colour contrast, not on a black rim. An
 * earlier version of this file inked everything, which flattened depth (a
 * constant-width line ignores distance the way nothing else in the frame
 * does) and turned the skyline into a sheet of stickers.
 *
 * The line is therefore kept only where it buys GAMEPLAY readability -- the
 * player, the rivals and the hazards, which have to be picked out instantly
 * at distance and while moving -- and at about two thirds of its old weight.
 * Everything else (props, scenery, banners) is INK weight 0 and separates on
 * colour, band contrast and haze instead. See INK below; the weights are the
 * single control, so restoring lines anywhere is a one-number change.
 *
 * Where a line does survive it is extruded along the vertex normal in view
 * space and scaled by depth, which keeps it the same thickness on screen
 * whether the runner is under the camera or a rival is 60 units away -- a
 * plain scaled inverted hull would balloon on large geometry and vanish on
 * small.
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
    accent: 0xffe45e,

    // Contact-shadow tint. Deliberately a deep blue-violet rather than black:
    // it has to sit on grass, tarmac and sand across six biomes, and a neutral
    // black blob reads as a hole in every one of them.
    contact: 0x241d3d,
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
  const INK = {
    character: 0.014,   // was 0.021 -- kept, lightened
    hazard: 0.025,      // was 0.036 -- kept, lightened
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
  function ramp(steps, floor) {
    const base = floor === undefined ? 0.31 : floor;
    const key = steps + '/' + base;
    if (ramps.has(key)) return ramps.get(key);
    const n = Math.max(2, steps);
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      // Bias the darkest band up so shadows stay colourful, never muddy, and
      // curve the ramp so the mid band sits nearer the shadow than the light:
      // an evenly spaced ramp puts the terminator's wide middle band close to
      // full brightness and the form stops reading. 0.31 is as low as this can
      // go before the ambient can no longer keep a shaded red vest from
      // reading as brown.
      const v = base + (1 - base) * Math.pow(k, 1.22);
      // Cool the dark end. Pushed too far this desaturates the base colour to
      // blue-grey instead of shading it, so it falls off fast toward the light.
      // The exponent is what keeps a 3-band ramp's MIDDLE band only slightly
      // cool: cooling the terminator as hard as the core shadow tints the
      // whole object blue rather than tinting its shadow.
      const cool = Math.pow(1 - k, 1.55) * 0.38;
      const rgb = [v * (1 - cool * 1.05), v * (1 - cool * 0.40), v * (1 + cool * 0.72)];
      for (let c = 0; c < 3; c++) {
        data[i * 4 + c] = Math.round(Math.max(0, Math.min(1, rgb[c])) * 255);
      }
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
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

  /** Standard toon material. `steps` 2 for props, 3 for characters. */
  function toon(color, steps, floor) {
    const m = new THREE.MeshToonMaterial({
      color,
      gradientMap: ramp(steps || 3, floor),
    });
    m.onBeforeCompile = patchToonRamp;
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
  const OUTLINE_VS = `
    uniform float thickness;
    varying float vDepth;
    void main() {
      vec3 n = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mv.z;
      mv.xyz += n * thickness * clamp(0.75 + 0.05 * vDepth, 0.90, 3.6);
      gl_Position = projectionMatrix * mv;
    }`;

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
  function outlineMaterial(thickness, color) {
    const t = thickness === undefined ? INK.character : thickness;
    if (!(t > 0)) return hiddenInkMaterial();
    const c = color === undefined ? PALETTE.ink : color;
    const key = t + '/' + c;
    let m = outlineMats.get(key);
    if (m) return m;
    m = new THREE.ShaderMaterial({
      uniforms: {
        thickness: { value: t },
        oColor: { value: displayColor(c) },
        inkFogColor: fogU.inkFogColor,
        inkFogNear: fogU.inkFogNear,
        inkFogFar: fogU.inkFogFar,
      },
      vertexShader: OUTLINE_VS,
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
    const line = new THREE.Mesh(geometry, outlineMaterial(t));
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
    for (let i = 0; i < 9; i++) {
      const cx = rnd() * N, cy = rnd() * N;
      const w = N * (0.075 + rnd() * rnd() * 0.170);
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
  const SKY_FS = `
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

      // Cel steps, blended part-way and antialiased with fwidth: a bare
      // floor() aliases into a staircase wherever the band edge is not exactly
      // horizontal.
      //
      // SIX steps became FOUR when t was re-ranged above, and the two changes
      // have to be read together. The count is over the whole 0..1 range while
      // the art direction at the top of this file is about how many bands are
      // IN FRAME: at the old ramp the visible sky spanned t 0.06 to 0.68 and
      // showed about four of the six, and re-ranging t to reach 1.0 inside the
      // frame would have shown all six. Four keeps the frame looking the way it
      // was tuned to look.
      //
      // It was ALSO tried as a fix for far-band edge density and is not one:
      // six steps at the new ramp measured 36.9% on 02-early and four measured
      // 37.1%, i.e. no effect. The small far-band edge rise this pass does
      // carry comes from the sky simply having more contrast in it, not from
      // the number of band edges. Recorded here because the first draft of this
      // comment claimed the opposite.
      float b = t * 4.0;
      float aa = fwidth(b) * 0.6 + 0.002;
      float stepped = (floor(b) + smoothstep(0.5 - aa, 0.5 + aa, fract(b))) / 4.0;
      vec3 col = mix(bottom, top, mix(t, stepped, 0.85));

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
      // not, and the parallax between them gives the sky depth for free.
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
      vec4 lo = texture2D(cloudMap, p * 0.125 + vec2(0.41 - time * 0.0022, 0.63));
      col = mix(col, mix(col, lit, 0.55), smoothstep(0.34, 0.88, lo.a) * reach * 0.38);

      vec4 hi = texture2D(cloudMap, p * 0.300 + vec2(time * 0.0055, 0.0));
      col = mix(col, mix(shd, lit, smoothstep(0.35, 0.65, hi.r)), smoothstep(0.30, 0.82, hi.a) * reach);

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
        // looking down +z, and the elevation is low (~14 degrees) because the
        // chase camera is pitched down: anything higher leaves the frame.
        sunDir: { value: new THREE.Vector3(0.42, 0.25, 0.87).normalize() },
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
    // Along skyDome's sunDir so the drawn sun and the shading agree, but
    // lifted: at the sun's true 14-degree elevation the terminator ran across
    // the runner's waist and the legs went dark.
    const key = new THREE.DirectionalLight(0xfff2d8, 2.30);
    key.position.set(7.0, 9.0, 11.0);

    // Aimed back down the camera axis on purpose: the player is seen from
    // behind, so without this the one surface that matters most -- the
    // runner's back -- would sit in the ramp's darkest band for the whole
    // race. Half its old strength; the hemisphere took over the rest, and
    // this is now only doing the job the hemisphere cannot, which is putting
    // SOME light on a surface pointing straight at the camera.
    const bounce = new THREE.DirectionalLight(0x86aeff, 0.42);
    bounce.position.set(-6, 2, -9);

    // Cool sky over a warm ground, which is the whole trick: it puts a
    // warm/cool split across every curved or angled surface for the price of
    // one light, and that split is most of what makes the references' shading
    // read as coloured rather than as grey applied at different strengths.
    const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x4a4030, 0.55);

    // Kept, but only as a floor -- just enough that nothing in the frame can
    // reach zero and turn into a black hole in a saturated picture.
    const amb = new THREE.AmbientLight(0xa8c4ff, 0.10);

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
