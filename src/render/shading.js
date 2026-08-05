/**
 * Cel-shading toolkit: banded toon ramps, normal-extruded ink outlines, the
 * atmosphere (sky dome + aerial perspective), and the palette everything else
 * draws from.
 *
 * The look is toy-plastic: few, wide bands; saturated mid-tones; a warm key
 * and a cool bounce so shadowed sides read blue rather than grey; and a
 * constant-width dark outline on every silhouette. Outlines are extruded
 * along the vertex normal in view space and scaled by depth, which keeps them
 * the same thickness on screen whether the runner is under the camera or a
 * building is 300 units away -- a plain scaled inverted hull would balloon on
 * large geometry and vanish on small.
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
    building: [0xf6f0e4, 0xffd9a0, 0xc9dcff, 0xffc2cf, 0xbdf0d8],
    accent: 0xffe45e,
  };

  /**
   * Outline weights in world units, by what the object is. Small parts need a
   * thin line or the fill disappears; large scenery needs a heavy one or the
   * silhouette reads as untreated flat-shaded geometry. The number is the
   * width at the camera; OUTLINE_VS grows it with depth (see there).
   */
  const INK = {
    character: 0.021,
    hazard: 0.036,
    prop: 0.030,
    scenery: 0.090,
    banner: 0.045,
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
   */
  function ramp(steps) {
    if (ramps.has(steps)) return ramps.get(steps);
    const n = Math.max(2, steps);
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      // Bias the darkest band up so shadows stay colourful, never muddy.
      const v = 0.42 + 0.58 * k;
      const cool = (1 - k) * (1 - k) * 0.26;   // strongest in the deepest band
      const rgb = [v * (1 - cool * 1.05), v * (1 - cool * 0.40), v * (1 + cool * 0.70)];
      for (let c = 0; c < 3; c++) {
        data[i * 4 + c] = Math.round(Math.max(0, Math.min(1, rgb[c])) * 255);
      }
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    ramps.set(steps, tex);
    return tex;
  }

  // One shared function object so every toon material hashes to the same
  // program cache key -- otherwise each material would compile its own copy.
  const GRAD_GREY = 'return vec3( texture2D( gradientMap, coord ).r );';
  const GRAD_RGB = 'return texture2D( gradientMap, coord ).rgb;';
  function patchToonRamp(shader) {
    if (shader.fragmentShader.indexOf(GRAD_GREY) >= 0) {
      shader.fragmentShader = shader.fragmentShader.replace(GRAD_GREY, GRAD_RGB);
    }
  }

  /** Standard toon material. `steps` 2 for props, 3 for characters. */
  function toon(color, steps) {
    const m = new THREE.MeshToonMaterial({
      color,
      gradientMap: ramp(steps || 3),
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
  // fogColor is stored already encoded, because three mixes fog AFTER the
  // colour-space conversion -- matching that is what keeps an outline fading
  // into exactly the same haze as the surface it wraps.
  const FOG_NEAR = 26;
  const FOG_FAR = 190;

  const fogU = {
    inkFogColor: { value: new THREE.Color(1, 1, 1) },
    inkFogNear: { value: FOG_NEAR },
    inkFogFar: { value: FOG_FAR },
  };
  let fogHex = -1;

  function syncFog(fog) {
    if (!fog) return;
    const hex = fog.color.getHex();
    if (hex === fogHex && fogU.inkFogNear.value === fog.near) return;
    fogHex = hex;
    fogU.inkFogColor.value.setRGB(encode(fog.color.r), encode(fog.color.g), encode(fog.color.b));
    fogU.inkFogNear.value = fog.near;
    fogU.inkFogFar.value = fog.far;
    // A ShaderMaterial only re-uploads on demand; there are a handful of
    // cached outline materials so flagging them all is free.
    outlineMats.forEach(function (m) { m.uniformsNeedUpdate = true; });
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

  /** @param thickness world units of extrusion (see OUTLINE_VS). */
  function outlineMaterial(thickness, color) {
    const t = thickness === undefined ? INK.character : thickness;
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
   */
  function outlined(geometry, material, thickness) {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(geometry, material);
    const line = new THREE.Mesh(geometry, outlineMaterial(thickness));
    line.renderOrder = -1;
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
    const N = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');

    let s = 0x2f6f2b1d;
    const rnd = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

    const puffs = [];
    for (let i = 0; i < 15; i++) {
      const cx = rnd() * N, cy = rnd() * N;
      const w = N * (0.045 + rnd() * 0.070);
      const n = 4 + Math.floor(rnd() * 4);
      const lobes = [];
      for (let j = 0; j < n; j++) {
        const u = n === 1 ? 0.5 : j / (n - 1);
        lobes.push({
          x: (u - 0.5) * w * 2.1 + (rnd() - 0.5) * w * 0.35,
          y: (rnd() - 0.5) * w * 0.30,
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
          g.fillStyle = 'rgba(92,92,92,1)';
          for (const l of p.lobes) {
            g.beginPath();
            g.arc(bx + l.x, by + l.y + l.r * 0.34, Math.max(1, l.r), 0, 6.2832);
            g.fill();
          }
          g.fillStyle = 'rgba(255,255,255,1)';
          for (const l of p.lobes) {
            g.beginPath();
            g.arc(bx + l.x, by + l.y - l.r * 0.06, Math.max(1, l.r * 0.96), 0, 6.2832);
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
    uniform sampler2D cloudMap;
    uniform float time;
    varying vec3 vWorld;
    ${LIN2SRGB}
    void main() {
      vec3 d = normalize(vWorld - cameraPosition);
      float h = d.y;

      float t = clamp(h * 1.45 + 0.06, 0.0, 1.0);

      // Cel steps, blended part-way and antialiased: a hard floor() turns any
      // residual curvature back into an arc, but a pure gradient loses the
      // poster look the rest of the game is drawn in.
      float b = t * 5.0;
      float aa = fwidth(b) * 0.6 + 0.002;
      float stepped = (floor(b) + smoothstep(0.5 - aa, 0.5 + aa, fract(b))) / 5.0;
      vec3 col = mix(bottom, top, mix(t, stepped, 0.62));

      // Sun: broad bloom, one quantised corona ring, hard disc. Drawn before
      // the clouds so cover can pass in front of it.
      float sd = max(dot(d, sunDir), 0.0);
      col += glowColor * (pow(sd, 5.0) * 0.16 + pow(sd, 180.0) * 0.55);
      col = mix(col, mix(glowColor, sunColor, 0.5), smoothstep(0.9962, 0.9970, sd) * 0.6);
      col = mix(col, sunColor, smoothstep(0.99885, 0.99905, sd));

      // Horizon haze. Zero exactly at h = 0 so the sky meets the fogged ground
      // with no step, peaking a few degrees above it.
      float hz = smoothstep(0.0, 0.05, h) * exp(-max(h, 0.0) * 9.0);
      col = mix(col, mix(bottom, vec3(1.0), 0.42), hz * 0.85);

      // Clouds ride a virtual plane overhead, so they converge toward the
      // horizon the way real ones do instead of being pasted on the dome.
      vec2 uv = d.xz / max(h, 0.05) * 0.30 + vec2(time * 0.006, time * 0.0015);
      vec4 cl = texture2D(cloudMap, uv);
      float cover = cl.a * smoothstep(0.06, 0.22, h);
      vec3 lit = mix(vec3(1.0), bottom, 0.12);
      vec3 shd = mix(bottom, top, 0.42);
      col = mix(col, mix(shd, lit, smoothstep(0.35, 0.65, cl.r)), cover);

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
        // Up-and-forward on the camera's left, matching the key light so the
        // lit side of the runner points back at the visible sun.
        sunDir: { value: new THREE.Vector3(-0.52, 0.40, 0.76).normalize() },
        cloudMap: { value: clouds() },
        time: { value: 0 },
      },
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
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

  // ---- lighting ----------------------------------------------------------

  /**
   * The lighting rig. Toon materials band on top of real lights, so the key
   * direction decides where the terminator falls -- keep it high and slightly
   * camera-left so the runner's front stays lit while the trailing leg darkens.
   * The bounce is deliberately cool and the ambient only just strong enough to
   * keep the darkest ramp band from closing up: between them they are what
   * gives shaded faces a blue cast rather than a grey one.
   */
  function lights(scene) {
    // Matches skyDome's sunDir so the drawn sun and the shading agree.
    const key = new THREE.DirectionalLight(0xfff4e0, 2.05);
    key.position.set(-7.5, 6.0, 11.0);

    const bounce = new THREE.DirectionalLight(0x7fa8ff, 0.75);
    bounce.position.set(6, 2, -9);

    const amb = new THREE.AmbientLight(0xa8c4ff, 0.50);

    scene.add(key, bounce, amb);

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

    return { key, bounce, amb };
  }

  return {
    PALETTE, INK, ramp, toon, flat, outlineMaterial, outlined, skyDome, lights,
    clouds, syncFog,
  };
})();
