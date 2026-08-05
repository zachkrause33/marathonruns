/**
 * Chase camera: low, tight, and behind the shoulder.
 *
 * The reference framing is a runner filling roughly the lower third of the
 * screen with the road converging above them -- close enough that lane
 * changes feel like body movement, high enough to read three lanes and the
 * next two gates. Every dynamic term (FOV, height, shake, roll) is small on
 * purpose: at this distance a large camera move reads as a bug, not energy.
 *
 * Perceived speed is the hard problem. Pace only varies 5:30 -> 4:20 per mile,
 * a 21% change in ground speed, which is barely legible on its own. The FOV
 * widening, the slight drop and pull-in, and the roll into lane changes are
 * what turn that 21% into something the player can feel -- the distance math
 * stays honest and the camera does the selling.
 */
MR.Camera = (function () {
  const K = MR.K;

  const BASE_FOV = 66;
  const MAX_FOV_KICK = 11;
  // Low and close: the runner should fill roughly a third of frame height.
  // The first pass sat at 3.0 up / 6.55 back and the character read as a
  // distant sprite -- fine for a top-down racer, wrong for this genre.
  const BASE_Y = 2.28;
  const BASE_BACK = 5.10;
  const LOOK_AHEAD = 8.0;

  function create(aspect) {
    const cam = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 1200);

    const s = {
      camera: cam,
      x: 0,          // smoothed lateral follow
      shake: 0,
      roll: 0,
      kick: 0,       // forward punch on landing/impact
      fov: BASE_FOV,
    };

    /**
     * @param dt  real seconds
     * @param p   { z, x, y, speed, lean, airborne, duck01 }
     */
    s.update = function (dt, p) {
      // Lateral follow lags the runner so a lane change is a movement the
      // camera reacts to rather than one it performs simultaneously.
      const followLag = 1 - Math.pow(0.0016, dt);
      s.x += (p.x * 0.72 - s.x) * followLag;

      // Speed 0..1 across the honest pace band.
      const lo = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.START_PACE;
      const hi = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;
      const sp01 = Math.max(0, Math.min(1, (p.speed - lo) / (hi - lo)));

      const targetFov = BASE_FOV + MAX_FOV_KICK * Math.pow(sp01, 1.25) + s.kick * 7;
      s.fov += (targetFov - s.fov) * (1 - Math.pow(0.005, dt));

      // Camera drops and tucks in as pace rises -- ground rushes past closer.
      const back = BASE_BACK - sp01 * 0.55;
      const hgt = BASE_Y - sp01 * 0.22 - (p.duck01 || 0) * 0.30;

      s.shake = Math.max(0, s.shake - dt * 3.6);
      s.kick = Math.max(0, s.kick - dt * 4.2);

      const sh = s.shake * s.shake;
      const jitterX = (Math.random() - 0.5) * sh * 0.55;
      const jitterY = (Math.random() - 0.5) * sh * 0.42;

      // A tiny vertical trail on jumps: the camera does not fully follow the
      // arc, which is what makes a jump feel like leaving the ground.
      const airTrail = (p.y || 0) * 0.42;

      cam.position.set(
        s.x + jitterX,
        hgt + airTrail + jitterY,
        p.z - back
      );

      s.roll += ((p.lean || 0) * -0.055 - s.roll) * (1 - Math.pow(0.004, dt));

      const look = new THREE.Vector3(
        s.x * 0.55,
        1.22 + (p.y || 0) * 0.30 - (p.duck01 || 0) * 0.22,
        p.z + LOOK_AHEAD
      );
      cam.lookAt(look);
      cam.rotation.z += s.roll + jitterX * 0.02;

      if (Math.abs(cam.fov - s.fov) > 0.01) {
        cam.fov = s.fov;
        cam.updateProjectionMatrix();
      }
    };

    s.impact = function (amount) {
      s.shake = Math.min(1.4, s.shake + (amount === undefined ? 1 : amount));
      s.kick = Math.min(1, s.kick + 0.55);
    };

    s.land = function () { s.shake = Math.min(1.4, s.shake + 0.22); };

    s.resize = function (aspect) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    };

    s.reset = function () {
      s.x = 0; s.shake = 0; s.roll = 0; s.kick = 0; s.fov = BASE_FOV;
    };

    return s;
  }

  return { create, BASE_FOV };
})();
