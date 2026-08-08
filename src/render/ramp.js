/**
 * THE RIDEABLE ROOF, AS A DELIBERATELY PLAIN PLACEHOLDER.
 *
 * This is not art and is not trying to be. It exists so the ramp mechanic can
 * be photographed and judged as a mechanic -- a frame with the runner standing
 * on nothing proves nothing -- and so the shape the real art has to fill is
 * stated as geometry rather than as a paragraph. src/render/world.js owns the
 * fleet and is being rebuilt by another agent in this same tree; this file does
 * not touch it and must be deleted when world.js grows a real tailgate.
 *
 * ---- RULE 1: BUILT ON ALL SIDES ----------------------------------------
 *
 * Every ramp is ONE CLOSED SOLID. The profile in the (z, y) plane is the
 * silhouette of a bin lorry with its hopper down --
 *
 *     (z0, 0) -> (z0 + run, deck) -> (z1, deck) -> (z1, 0) -> close
 *
 * -- extruded across the lane and capped at both ends: six faces, twelve
 * triangles, no open back, no missing flank, no side left out because the chase
 * camera "starts" behind. The camera does not start anywhere; it goes
 * everywhere. You pass this thing at 1.70 units in the next lane, the lens
 * banks through every lane change, and the whole point of the mechanic is that
 * you also stand on top of it and look down its length.
 *
 * ---- IT FITS INSIDE THE COLLISION BOX, AND THAT IS THE CONTRACT ---------
 *
 * MR.Collision.BOX decides clearance; art never does. So every vertex here is
 * generated FROM the box -- half-width is BOX[BLOCK].halfX, the deck is
 * BOX[BLOCK].yMax, and the far face is the same
 * 2 * halfZ * (1 + 0.9 * span) expression Course.reachOf and world.js's
 * gateBoxes use. Nothing can stick out of the envelope the fairness audit casts
 * against, because there is no number in this file that is not read off it.
 *
 * ---- COST ---------------------------------------------------------------
 *
 * ONE draw call for the whole course, whatever the ramp count, because the
 * ramps are merged into a single static buffer at create time. At the measured
 * 4.09 ramps a day that is 49 triangles against a ceiling of 500,000 and one
 * draw call against a budget of roughly 400. Draw calls are the binding
 * constraint in this project, so a per-ramp mesh would have been the wrong
 * shape even though it is easier to write.
 */
MR.Ramp = (function () {

  /**
   * @param course a generated MR.Course; `course.ramps` may be empty
   * @returns { group } to be added to the scene, or an empty group
   */
  function create(course) {
    const group = new THREE.Group();
    group.name = 'ramp-placeholders';
    const ramps = (course && course.ramps) || [];
    if (!ramps.length) return { group };

    const B = MR.Collision.BOX[MR.K.BLOCK];
    const hx = B.halfX;

    const pos = [];
    const nrm = [];

    /**
     * A quad, emitted as two triangles, WOUND AND NORMALLED OUTWARD BY
     * CONSTRUCTION rather than by the author getting six orderings right.
     *
     * The first draft did it by hand and got three of the six faces backwards,
     * including the roof -- which back-face culling then deleted, so the frame
     * showed the runner standing on the tram underneath instead of on the ramp.
     * A missing face is exactly the failure rule 1 exists to prevent, and it is
     * invisible in a diff and nearly invisible in a frame.
     *
     * So the face is given the solid's centre and orients itself: take the
     * normal from the winding, and if it points back towards the middle of the
     * solid, reverse the winding and the normal together. There is no ordering
     * a caller can supply that produces an inward face.
     */
    function quad(cx, cy, cz, a, b, c, d) {
      // cross(b - a, c - a) is the right-hand normal of the winding a->b->c.
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      // Outward is away from the centre of the solid.
      const fx = (a[0] + b[0] + c[0] + d[0]) / 4 - cx;
      const fy = (a[1] + b[1] + c[1] + d[1]) / 4 - cy;
      const fz = (a[2] + b[2] + c[2] + d[2]) / 4 - cz;
      const order = (nx * fx + ny * fy + nz * fz) >= 0
        ? [a, b, c, a, c, d]
        : (nx = -nx, ny = -ny, nz = -nz, [a, d, c, a, c, b]);
      for (const p of order) {
        pos.push(p[0], p[1], p[2]);
        nrm.push(nx, ny, nz);
      }
    }

    for (const r of ramps) {
      const x = MR.K.LANE_X[r.lane];
      const xL = x - hx, xR = x + hx;
      const dy = r.deck;
      // The profile, near to far. Deliberately in the order the runner meets it.
      const p0 = r.z0;                 // the tailgate touches the road here
      const p1 = r.z0 + r.run;         // top of the slope
      const p2 = r.z1;                 // the far face, where the roof stops

      // The centroid of the solid, which is what orients every face. Only its
      // SIDE of each face matters, so the crude average of the profile is
      // enough and is exact for the two flanks and the two caps.
      const cx = x, cy = dy * 0.4, cz = (p0 + p1 + p2 + p2) / 4;

      // Sloped top (the hopper), flat roof, far face, underside, and the two
      // flanks. Six faces: this is a closed solid, and none of them is left out
      // because a chase camera is unlikely to look at it. It is stood on.
      quad(cx, cy, cz, [xL, 0, p0], [xR, 0, p0], [xR, dy, p1], [xL, dy, p1]);    // slope
      quad(cx, cy, cz, [xL, dy, p1], [xR, dy, p1], [xR, dy, p2], [xL, dy, p2]);  // roof
      quad(cx, cy, cz, [xL, dy, p2], [xR, dy, p2], [xR, 0, p2], [xL, 0, p2]);    // far face
      quad(cx, cy, cz, [xL, 0, p2], [xR, 0, p2], [xR, 0, p0], [xL, 0, p0]);      // underside
      quad(cx, cy, cz, [xR, 0, p0], [xR, 0, p2], [xR, dy, p2], [xR, dy, p1]);    // right flank
      quad(cx, cy, cz, [xL, 0, p2], [xL, 0, p0], [xL, dy, p1], [xL, dy, p2]);    // left flank
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));

    // Flat, loud and obviously unfinished. A placeholder that looks finished is
    // the thing that ships by accident.
    const mat = new THREE.MeshLambertMaterial({ color: 0xf07022, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ramp-placeholder';
    // Ramps sit on the road, and the road has hills under it. Lifting the whole
    // buffer is wrong on a slope; lifting per ramp at build time is right, and
    // the profile is flat over 35 units, so a ramp gets the elevation at its
    // own mouth. This is a placeholder's approximation and is called out as one.
    if (course.elevation) {
      // Per-ramp lift means per-ramp geometry, so it is folded into the vertex
      // buffer rather than into the transform: walk the positions and raise
      // each ramp's block by the road height at its own z0.
      const arr = geo.attributes.position.array;
      let v = 0;
      for (const r of ramps) {
        const lift = course.elevation.at(r.z0);
        for (let i = 0; i < 36; i++, v++) arr[v * 3 + 1] += lift;   // 6 quads * 6 verts
      }
      geo.attributes.position.needsUpdate = true;
    }
    geo.computeBoundingSphere();
    group.add(mesh);

    return { group };
  }

  return { create };
})();
