/**
 * Cel-shading toolkit: banded toon ramps, normal-extruded ink outlines, and
 * the palette everything else draws from.
 *
 * The look is toy-plastic: few, wide bands; saturated mid-tones; a warm key
 * and a cool bounce so shadowed sides read blue rather than grey; and a
 * constant-width dark outline on every silhouette. Outlines are extruded
 * along the vertex normal in view space and scaled by depth, which keeps them
 * the same thickness on screen whether the runner is under the camera or a
 * building is 300 units away -- a plain scaled inverted hull would balloon on
 * large geometry and vanish on small.
 */
MR.shading = (function () {

  const PALETTE = {
    ink: 0x1b1633,

    skyTop: 0x2b3fa8,
    skyBot: 0x8fd6ff,

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
   * silhouette reads as untreated flat-shaded geometry.
   */
  const INK = {
    character: 0.020,
    hazard: 0.034,
    prop: 0.032,
    scenery: 0.090,
    banner: 0.045,
  };

  const ramps = new Map();

  /**
   * A `steps`-band greyscale ramp used as MeshToonMaterial.gradientMap.
   * Nearest filtering is what makes the bands hard instead of smeared.
   */
  function ramp(steps) {
    if (ramps.has(steps)) return ramps.get(steps);
    const data = new Uint8Array(steps * 4);
    for (let i = 0; i < steps; i++) {
      // Bias the darkest band up so shadows stay colourful, never muddy.
      const t = 0.42 + 0.58 * (i / Math.max(1, steps - 1));
      const v = Math.round(t * 255);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    ramps.set(steps, tex);
    return tex;
  }

  /** Standard toon material. `steps` 2 for props, 3 for characters. */
  function toon(color, steps) {
    return new THREE.MeshToonMaterial({
      color,
      gradientMap: ramp(steps || 3),
    });
  }

  /** Unlit flat colour -- for road paint, HUD-ish world bits, skybox. */
  function flat(color, opts) {
    return new THREE.MeshBasicMaterial(Object.assign({ color }, opts || {}));
  }

  // `thickness` is a WORLD-space extrusion in units, not a multiplier. An
  // earlier version scaled purely by view depth with a fat constant, which
  // extruded a 0.07-unit forearm by 0.12 units -- the runner rendered as a
  // solid black blob and buildings grew slab-sided edges. Keeping the base in
  // world units means a part can never be swallowed by its own outline; the
  // small depth term only stops distant silhouettes from thinning to nothing.
  const OUTLINE_VS = `
    uniform float thickness;
    void main() {
      vec3 n = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float depth = clamp(-mv.z, 1.0, 120.0);
      mv.xyz += n * thickness * (0.85 + 0.022 * depth);
      gl_Position = projectionMatrix * mv;
    }`;

  const OUTLINE_FS = `
    uniform vec3 oColor;
    void main() { gl_FragColor = vec4(oColor, 1.0); }`;

  /** @param thickness world units of extrusion (see OUTLINE_VS). */
  function outlineMaterial(thickness, color) {
    return new THREE.ShaderMaterial({
      uniforms: {
        thickness: { value: thickness === undefined ? INK.character : thickness },
        oColor: { value: new THREE.Color(color === undefined ? PALETTE.ink : color) },
      },
      vertexShader: OUTLINE_VS,
      fragmentShader: OUTLINE_FS,
      side: THREE.BackSide,
    });
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

  /** Vertical two-stop sky, drawn on the inside of a large sphere. */
  function skyDome(radius, top, bottom) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(top === undefined ? PALETTE.skyTop : top) },
        bottom: { value: new THREE.Color(bottom === undefined ? PALETTE.skyBot : bottom) },
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vH = normalize(wp.xyz).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; varying float vH;
        void main() {
          // Banded, not smooth -- the sky is cel-shaded too.
          float t = clamp(vH * 1.15 + 0.18, 0.0, 1.0);
          t = floor(t * 6.0) / 6.0;
          gl_FragColor = vec4(mix(bottom, top, t), 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * The lighting rig. Toon materials band on top of real lights, so the key
   * direction decides where the terminator falls -- keep it high and slightly
   * camera-left so the runner's front stays lit while the trailing leg darkens.
   */
  function lights(scene) {
    const key = new THREE.DirectionalLight(0xfff4e0, 2.15);
    key.position.set(-6, 12, 6);

    const bounce = new THREE.DirectionalLight(0x86b4ff, 0.7);
    bounce.position.set(5, 2, -8);

    const amb = new THREE.AmbientLight(0xbcd0ff, 0.55);

    scene.add(key, bounce, amb);
    return { key, bounce, amb };
  }

  return { PALETTE, INK, ramp, toon, flat, outlineMaterial, outlined, skyDome, lights };
})();
