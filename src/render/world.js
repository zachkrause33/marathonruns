/**
 * The track and everything beside it.
 *
 * A marathon course is 6,293 world units long; instantiating it would mean
 * tens of thousands of meshes. Everything here is therefore pooled and
 * recycled around a moving window: road tiles, hazards, scenery, structures
 * and mile banners are claimed as they enter VIEW ahead and released as they
 * fall behind BEHIND. Pool objects are reused in place, so steady-state
 * allocation is zero and the frame time does not sawtooth.
 *
 * Two things drive almost every decision below.
 *
 *  1. READABILITY. One hit ends the record attempt, so a gate has to be
 *     solved with the eyes at 60+ units, not reacted to at 15. Every hazard
 *     therefore paints its lane: a coloured, iconised mat lies on the road in
 *     front of it, sized so it is still several pixels tall when the hazard
 *     itself is a speck. Shape carries the action (triangles = jump, rungs =
 *     duck, crosses = impassable) so the read survives colour-blindness and
 *     the fog, which is fully opaque by 235 units.
 *
 *  2. DRAW CALLS, NOT TRIANGLES, AND THE TRIANGLE FIGURES IN THIS FILE WERE
 *     WRONG FOR MONTHS. Every frame rate this project ever measured came out
 *     of SwiftShader software rendering in the screenshot harness -- 50 to 100
 *     times slower than the phone the game runs on -- and a 75,000-triangle
 *     working ceiling was built on top of those numbers, defended across three
 *     passes, and paid for by cutting real work: the far grandstands became
 *     flat bands, the last mile's crowd was thinned, tree crowns were nearly
 *     decimated. None of it was necessary. Measured properly the working
 *     ceiling is 500,000 triangles and the heaviest frame in the game is
 *     192,000. Any comment below still quoting 75k or 150k is stale; ignore it
 *     and correct it if you are editing near it.
 *
 *     What DOES bind is submissions. The sweep runs 160 to 283 draw calls
 *     against a working ceiling of about 400, and that is the number to spend
 *     carefully. Props are therefore merged into single vertex-coloured
 *     meshes -- a knot of eight spectators, a bridge tower with its cables, a
 *     whole 24-unit run of crowd barrier, a grandstand and its two hundred
 *     spectators -- so richness costs geometry, which is nearly free, instead
 *     of submissions, which are not.
 *
 * Biomes recolour the shared materials rather than swapping meshes, which is
 * what lets the palette cross-fade over a mile instead of popping at a seam.
 * But palette alone never made a place: each biome also picks the roadside
 * furniture the road tiles wear and the set pieces that get spawned beside it,
 * so THE BRIDGE actually has a bridge and RIVERSIDE actually has water.
 *
 *  3. THE CORRIDOR IS SACRED. Nothing that is not a hazard may occupy the
 *     three lanes or the air above them below OVERHEAD_Y, and nothing may
 *     stand between the camera and the next gate. That rule is what allows
 *     the landmarks at the bottom of this file to be as big as they are: they
 *     can crop the frame edge precisely because they are nowhere near the
 *     road. It is also why the rival runners are gone -- see the note where
 *     they used to be.
 *
 *  4. AND THE SKY OVER IT IS NOT DECORATION EITHER. The corridor rule is
 *     about FAIRNESS -- can the player see the next gate -- and everything
 *     that obeyed it was assumed to be free. It was not. Overhead structure
 *     cannot hide a hazard (the eye is below it and looking down), but it can
 *     and did hide the SIGNAGE, which lives in the same band: two portal
 *     spans and a lamp arc in every 24-unit tile put 12.6 crossings in every
 *     100 units of road and left 57% to 100% of every MILE sign's own panel
 *     behind something. The road tile now carries a VERGE LINE and spans
 *     nothing; see "the verge line, which replaced the overhead layer". The
 *     census is 2.0 crossings per 100 units and everything left in it is a
 *     mile banner, a footbridge, an overpass, a named landmark or the finish.
 *
 *     The rule this leaves behind: a thing that crosses the road has to be
 *     worth crossing it for, and there has to be sky on either side of it.
 */
MR.World = (function () {
  const K = MR.K;
  const S = MR.shading;
  const P = S.PALETTE;

  const VIEW = 210;      // spawn distance ahead of the runner
  const BEHIND = 34;     // release distance behind
  const TILE = 24;       // road tile length

  // ---- lane fit ---------------------------------------------------------
  // Every hazard below was drawn to fill a lane, and was authored against the
  // 2.35-unit lane the track used to have. LANE_FIT rescales those numbers to
  // whatever K.LANE_W is now, so a hazard stays exactly as wide *relative to
  // its lane* as it was drawn and a track retune can never leave one hanging
  // over its neighbour.
  //
  // It touches x ONLY. The y and z extents are what MR.Collision.BOX records
  // and audits against the jump arc and the duck pose; moving either would
  // break an agreement this file cannot see. Nothing here may change a height.
  //
  // Math.abs is LOad-BEARING, and it is what made every BLOCK render as a
  // near-black slab for as long as the flipped lane order has existed.
  // K.LANE_X is [+LANE_W, 0, -LANE_W] -- DESCENDING, because lane 0 is the
  // lane the player sees on the LEFT and screen-left is world +x for a camera
  // looking down +z (see the note in constants.js). So LANE_X[1] - LANE_X[0]
  // is -LANE_W, and every `w * LANE_FIT` below became a NEGATIVE width.
  //
  // A BoxGeometry or PlaneGeometry built with a negative width is not merely
  // the same box: it is the box MIRRORED through x = 0, which reverses the
  // winding of every triangle while leaving the authored normals alone. The
  // consequences were all invisible in a diff and all very visible on screen:
  //
  //   - the toon fill (FrontSide) drew each hazard's FAR faces and the ink
  //     shell (BackSide) drew its NEAR ones, so the shell painted the whole
  //     silhouette in 0x1b1633 ink AND depth-occluded the fill. A BLOCK, whose
  //     entire mass is hbx(), came out solid near-black -- worst of all as a
  //     train, where the slab is 6 units long and fills a third of the frame.
  //   - the caution-stripe faces (hplane) and the lane telegraph mats
  //     (1.95 * LANE_FIT) faced DOWN through the road and were culled, which
  //     is why the readability device this file is built around never drew.
  //   - the carriageway edge lines sat at 2.42 instead of 2.68.
  //
  // The magnitude was right all along, which is why the hazards were the
  // correct SIZE and only the wrong colour. Sign only.
  const LANE = Math.abs(K.LANE_X[1] - K.LANE_X[0]);
  const LANE_FIT = LANE / 2.35;

  // The widest point any hazard may reach, measured from its lane centre.
  // Anything that has to stand clear of the lanes -- an aid table, a set piece
  // -- starts from here rather than from a literal that goes stale the next
  // time the track is retuned.
  //
  // THIS IS NOW MR.Collision.BOX[*].halfX AND IT IS WRITTEN TWICE, which this
  // file otherwise refuses to do. The reason is load order: collision.js loads
  // AFTER this module (see tools/build.js), and CORRIDOR_HALF below is needed
  // at module scope. So it is duplicated and then GUARDED -- tools/shoot.js
  // compares the two in the live page and fails the build if they disagree,
  // exactly as it does for Course.HAZARD_HALF_Z.
  //
  // It used to read 1.20 * LANE_FIT + 0.25 = 1.118, described as "the DUCK
  // frame's foot, 0.50 wide at 1.20 out". That derivation was stale: measured
  // on the real geometry the DUCK frame reaches 1.148, so the constant every
  // clearance in this file is cut from was 0.03 INSIDE the widest thing it was
  // supposed to contain, and a JUMP variant carries a comment claiming 1.118 as
  // a limit it was already past. The number is now stated rather than derived,
  // and the art is checked against it instead of the other way round.
  const HAZARD_HALF = 1.12;

  // ---- the play corridor, and the one rule about it ---------------------
  // CORRIDOR_HALF is the outermost point anything the player can collide with
  // reaches: the outer lane centre plus the widest hazard. Nothing may stand
  // inside it that is not a hazard, and no set piece may put geometry between
  // the camera and the next gate -- one contact costs the record, so an
  // "atmospheric" prop that clips the runner is a bug, not decoration.
  //
  // The big cropped-by-the-frame-edge landmarks below therefore start at
  // LANDMARK_IN, which is derived from the corridor rather than typed in, and
  // anything that reaches back over the road does so above OVERHEAD_Y. That
  // height is not a guess either: the chase camera trails 4.35 units and
  // carries part of the jump arc, sweeping to about y = 3.1 through a gate,
  // and the WALL overpass has spanned the road at 8.0 since it was added.
  const CORRIDOR_HALF = Math.max(K.TRACK_HALF_WIDTH, LANE + HAZARD_HALF);
  const LANDMARK_IN = CORRIDOR_HALF + 8.0;
  const OVERHEAD_Y = 9.0;

  // ---- the finish, as a shape in distance -------------------------------
  //
  // The ending is not one moment, it is three, and they are laid out in world
  // units because that is what the player experiences -- seconds of road, not
  // a fraction of a race.
  //
  //   APPROACH  the last ~14 seconds. The stands grow, the crowd comes up off
  //             its seat, the light goes gold, the camera starts to open out.
  //             Nothing structural changes: gates are still arriving and every
  //             one of these effects only ever shows MORE road, never less.
  //   CHUTE     the last ~5 seconds, which course.js guarantees is clean road
  //             (FINISH_GRACE is 190 units). This is where the game stops
  //             asking anything of the player and starts paying them: packed
  //             stands right against the barrier, bunting overhead, the finish
  //             carpet, the tape visible at the end of it.
  //   TAPE      the line itself.
  //
  // CHUTE is deliberately SHORTER than course.js's FINISH_GRACE. The carpet
  // and the barrier crowd are the only two things in this file that sit inside
  // the last stretch of road, and both are held 40 units clear of the earliest
  // place a gate could legally be, so the closing-stretch gameplay can be
  // retuned without either of them landing under a hazard.
  const FINISH_Z = K.TOTAL_UNITS;
  const APPROACH = 400;
  const CHUTE = 150;

  // ---- biome palettes ---------------------------------------------------
  // `edge` names the roadside furniture the road tile wears; `mix` weights the
  // roadside prop lottery. Together they are what distinguishes a biome, the
  // colours only agree with it.
  // ROAD VALUE, and why these are so much lighter than tarmac.
  //
  // Measured against the reference frames: in both Subway Surfers shots the
  // surface the player runs on (crimson train roof, mint train roof) is among
  // the LIGHTEST and most saturated large masses in frame, and the eye lands
  // on it first. Ours was 0x4a4f78-0x5b5f88 slate -- the darkest, least
  // saturated large mass, and also the biggest single area on screen -- so the
  // eye went to the grass banks and the sky instead of to the road the player
  // has to read. Realistic asphalt was losing the game a readability fight it
  // did not need to be in.
  //
  // These are lifted several stops and given chroma per biome. Lane paint and
  // the hazard telegraph mats still have to sit on top of them, so nothing
  // here goes near white.
  //
  // `road` IS THE CENTRE LANE, not the average of the carriageway. Since the
  // lane banding below can only ever multiply this DOWN -- a vertex colour
  // cannot exceed 1 -- the biome road is the brightest stop of the ramp and
  // the outer lanes step off it. Each entry was therefore raised ~13% when the
  // bands went in, which is what keeps the mean carriageway value slightly
  // ABOVE the flat road it replaced. That mean is the number the earlier
  // measurement against the reference was about: the play surface has to stay
  // the lightest large mass in frame, and a banding scheme that only darkened
  // would have quietly handed the eye back to the grass.
  // BIOME_LOOK'S ROLE HAS NARROWED. It used to own the whole look; it now owns
  // only what is STRUCTURAL about a leg and is therefore true wherever the leg
  // is being run:
  //
  //   edge    which roadside furniture the road tile wears (a bridge deck has a
  //           parapet, a park has a hedge, a works site has a jersey barrier)
  //   bank    which side the shoulder is cut back on for water
  //   mix     how much BUILT / GREEN / CROWD this leg carries -- a proportion,
  //           not a style. What a building or a tree actually looks like is the
  //           setting's business, not the biome's.
  //   street  how densely a continuous street wall runs beside the road
  //   sky/ground/road/fog  KEPT ONLY AS THE FALLBACK for a course with no
  //           settings on it. Every real frame takes its palette from
  //           SETTING_LOOK and its mood shift from BIOME_MOD below.
  const BIOME_LOOK = {
    'CITY START': {
      sky: [0x2b3fa8, 0x9fdcff], ground: 0x63c96b, road: 0x5f6285, fog: 0x9fdcff,
      edge: 'barrier', street: 0.70,
      mix: { building: 1.5, tree: 1.1, grove: 0.3, crowd: 2.3, walkers: 1.1, crates: 0.8, planters: 1.0 },
    },
    // `bank` cuts the shoulder back on one side so the water can come right up
    // to the road; at full shoulder width the river sat 35 units out and read
    // as a smear on the horizon.
    'RIVERSIDE': {
      sky: [0x1f6fb8, 0xbdf0ff], ground: 0x57c7a8, road: 0x52677b, fog: 0xbdf0ff,
      edge: 'hedge', bank: -1, street: 0.26,
      mix: { building: 0.35, tree: 2.0, grove: 2.0, crowd: 1.0, walkers: 0.8, crates: 0.3, planters: 0.7 },
    },
    // Nothing stands beside a bridge deck -- the emptiness is the point, and a
    // spectator out there would be standing on the river. What the leg gets
    // instead is the span itself, which is the setting's to choose.
    'THE BRIDGE': {
      sky: [0x3a4fc0, 0xffd9a8], ground: 0x2f8fc4, road: 0x6a607b, fog: 0xffd9a8,
      edge: 'rail', street: 0,
      mix: {},
    },
    'PARKLAND': {
      sky: [0x2e8fd0, 0xcdf5c0], ground: 0x6fd46a, road: 0x5d6477, fog: 0xcdf5c0,
      edge: 'hedge', street: 0.05,
      mix: { building: 0.12, tree: 2.6, grove: 3.6, crowd: 1.1, walkers: 0.9, crates: 0.15, planters: 1.3 },
    },
    'THE WALL': {
      sky: [0x8a3a6b, 0xffb27a], ground: 0x8f9a5e, road: 0x795d6a, fog: 0xffb27a,
      edge: 'wall', street: 0.46,
      mix: { building: 1.2, tree: 0.25, crowd: 0.35, walkers: 0.3, crates: 1.1, planters: 0.25 },
    },
    'FINAL MILE': {
      sky: [0x24306e, 0xffcf6b], ground: 0x5cb46a, road: 0x656181, fog: 0xffcf6b,
      edge: 'barrier', street: 0.52,
      mix: { building: 0.7, tree: 0.7, crowd: 3.4, walkers: 0.7, crates: 0.35, planters: 0.8 },
    },
  };

  /**
   * WHAT THE BIOME DOES TO A SETTING'S PALETTE.
   *
   * The two axes are not the same thing and must not be collapsed into one
   * table. The SETTING says what colour the place is; the BIOME says what is
   * happening to the light and the ground on this leg of the race, and that is
   * true in every city: mile 20 is a low sun and a closing-in road in Tokyo
   * exactly as it is in Rome, and the deck of a bridge is over water wherever
   * the bridge happens to be.
   *
   * So each entry here is a set of PULLS applied to whatever palette the
   * setting supplied, never an absolute colour. `sky`, `fog`, `road` and
   * `ground` are `[target, amount]` mixes; `groundWater` swaps the ground for
   * the setting's own water colour, which is how one table gives twelve
   * different rivers.
   *
   * The mood arc of the race therefore survives a reskin: bright and open at
   * the start, water in the middle, a purple-and-amber wall at mile 20, gold
   * into the tape -- in whichever city the day drew.
   */
  /**
   * A PULL ON THE ROAD IS A PULL ON THE PLAY SURFACE, and that is not the same
   * kind of change as a pull on the sky.
   *
   * R1 halved every setting's `road` to land the centre lane at L = 100, and it
   * did land: measured on the frame, CITY START and THE BRIDGE come out at 94.5
   * and 95.0. But two biomes then lifted it straight back up, because both of
   * their road pulls aimed at a pale colour:
   *
   *   THE WALL     road [0xe5b1ca, 0.42]  ->  centre lane L 142.3   1.42x target
   *   FINAL MILE   road [0xffe0c0, 0.16]  ->  centre lane L 126.5   1.26x target
   *
   * That is R1 undone on the two legs the race is decided on, and it is not
   * cosmetic: it is what the hazard-contrast assertion in tools/shoot.js fires
   * on. THE WALL's road is dusty PINK and every BLOCK in the game is pink -- at
   * 142 the road came within 1.05x of the ROAD CLOSED barrier's own luminance
   * and within 0.19 of its saturation, which is a hazard invisible against the
   * tarmac on both axes at once. Measured on 04-wall before the fix: the amber
   * JUMP kerb rendered at L 136.7 on a road of L 136.6.
   *
   * The mood is not the casualty. The pull is retargeted at the SAME HUE two
   * thirds of the way down in value, so mile 20 keeps its dusty pink cast and
   * mile 26 keeps its gold one, and the surface the player reads stays where R1
   * put it. Value belongs to the road; hue belongs to the leg.
   */
  const BIOME_MOD = {
    'CITY START': {},
    'RIVERSIDE': { fog: [0xcfefff, 0.18] },
    'THE BRIDGE': { groundWater: 1, fog: [0xffd9a8, 0.30], sky: [0xffd9a8, 0.16] },
    'PARKLAND': { ground: [0x6fd46a, 0.42], fog: [0xd8f5c8, 0.20] },
    // The one leg that genuinely overrides the place. A marathon breaks people
    // at mile 20 and the light is meant to go with them, so this is the
    // strongest pull in the table by a distance.
    'THE WALL': {
      sky: [0x8a3a6b, 0.62], fog: [0xffb27a, 0.58],
      // 0x6e5560 is 0xe5b1ca at 0.483 -- same hue, half the value.
      ground: [0x8f9a5e, 0.52], road: [0x6e5560, 0.42],
    },
    'FINAL MILE': {
      // 0x7d6d5d is 0xffe0c0 at 0.49.
      sky: [0x3a2f7e, 0.34], fog: [0xffcf6b, 0.40], road: [0x7d6d5d, 0.16],
    },
  };

  // 'crates' and 'planters' are the owner's kerbside furniture (item 6). They
  // join the SAME lottery rather than being a new spawn stream, so they cost no
  // extra live props and no extra draw calls -- the loop already picks exactly
  // one kind per step, and these simply take some of the steps the others had.
  const PROP_KINDS = ['building', 'tree', 'grove', 'crowd', 'walkers', 'crates', 'planters'];

  /**
   * =============== ROAD TRAFFIC: REFUSED, WITH THE MEASUREMENT ==============
   *
   * A sixth prop kind was meant to go here -- pooled cars driving a live
   * carriageway beside the closed course, on the argument that there is no
   * background traffic in this game at all and that is the largest single gap
   * in it. That argument is correct. It is refused anyway, because there is
   * nowhere to put the carriageway, and this records the measurement so the
   * next agent does not have to take it again.
   *
   * THE BAND, measured off the live scene at four points in a race rather than
   * read off the source. Outboard from the centre line:
   *
   *   0.00 - 3.75   play carriageway. CORRIDOR_HALF.
   *   4.60          crowd barrier
   *   4.50 - 10.20  crowd knots. Centres roll TRACK_HALF_WIDTH + 1.9 + 3.4,
   *                 and a knot is about +/-1.1 wide.
   *   7.95 - 14.60  walkers. WALK_IN plus a 3.6 roll, then up to 11 units of
   *                 outward drift on top.
   *   7.50 - 26.00  trees, and groves at s.x + 10.
   *   11.35         THE WALL's hoarding, continuous, both sides, the whole leg
   *  12.20          street wall front face; buildings behind it to 43.5
   *
   * There is no continuous gap. A carriageway needs one, because a car drives
   * ALONG it -- reserving z the way the street wall opens for a landmark does
   * nothing for an object whose whole behaviour is to traverse the reservation.
   *
   * WHAT EACH BIOME OFFERS, since "put it where it earns it" was the right
   * instinct and the answer turned out to be nowhere:
   *
   *   CITY START / FINAL MILE   barrier edge. The 7.6 units between the
   *     barrier and the street wall are the only candidate, and crowd and
   *     walkers hold it. FINAL MILE additionally runs grandstands from 5.05
   *     out to 10.45 for the whole leg.
   *   THE WALL   a continuous 3.4-unit hoarding at 11.35, above the 2.7 eye.
   *     Anything behind it is invisible by construction; that is the leg's
   *     entire design.
   *   RIVERSIDE / PARKLAND   hedge edge, tree weight 2.0-2.6 and grove weight
   *     2.0-3.6. The densest planting in the game.
   *   THE BRIDGE   the deck is a ribbon. railGeo ends in a parapet at |x| =
   *     4.30 and there is open water past it. Nothing to drive on.
   *
   * The brief that commissioned this said "there is a far carriageway in some
   * biomes and a light-rail track in others". THERE IS NEITHER. The four edge
   * kinds are barrier, hedge, rail and wall; `rail` is the bridge's parapet
   * railing and `wall` is THE WALL's site hoarding. No traffic surface of any
   * kind has ever existed in this game, so traffic could not be added to one --
   * it would have had to be built, and then the band above had to be cleared
   * for it in four systems at once.
   *
   * WHAT WAS BUILT INSTEAD. The traffic went where the geometry already is:
   * the water. See SHIP_SPEED and the sail loop. That is a real answer to
   * "distant vehicles" and "water if visible" and it costs nothing in
   * fairness, because a ship is on the far side of a parapet over water the
   * player cannot reach and no camera in this game can put one between the
   * lens and a gate.
   *
   * IF THIS IS REOPENED, the cheapest honest route is not a carriageway. It is
   * an ELEVATED line -- an L-train on a viaduct at |x| ~ 16 with its deck
   * above OVERHEAD_Y. That band is above the street wall, outside every prop
   * measured above, exempt from the corridor rule by height rather than by
   * argument, and Chicago's L is already in the settings table as a landmark
   * span. It is a set piece plus a mover, not a rearrangement of the roadside.
   *
   * ======================================================================
   * REOPENED ONCE, ON TWO SPECIFIC ROUTES, AND REFUSED AGAIN. THE NUMBERS:
   * ======================================================================
   *
   * The refusal above was sent back with a fair objection: "there is no
   * continuous gap from 0 to 12.2" is a fact about the CURRENT LAYOUT, not
   * about whether traffic is possible, and the owner has authorised
   * substantial change. Two routes were named that the first pass had not
   * costed. Both were measured off the live scene. Both fail, for reasons that
   * are not the first refusal's reasons.
   *
   * ROUTE A -- A CROSS-STREET OR PARALLEL AVENUE AT |x| 16-22, IN THE CITY,
   * seen over the crowd and between the buildings. Occupancy was counted in
   * one-unit buckets out to 44, folded to |x|, over the whole 210-unit draw
   * window. At CITY START every bucket from 14 to 34 is held continuously:
   *
   *   16-17  building x3, tree x3, street wall x3, grove x1, landmark x1
   *   19-20  building x6, street wall x3, grove x2, tree x2, landmark x1
   *   21-22  building x6, tree x3, grove x3, landmark x1
   *
   * That is the first refusal's finding holding at a band it never reached,
   * and it is worse out there rather than better: the street wall stops at
   * 12.2 but the buildings BEHIND it run to 43.5 and the tree and grove
   * scatter fills everything between. There is no continuous z gap to drive
   * along, and clearing one means changing the building scatter, the tree
   * scatter and the grove scatter on every city leg at once.
   *
   * ROUTE B -- A SECOND CARRIAGEWAY ON THE BRIDGE, outboard of the parapet.
   * This one looked right and the first sample said so: on the shipped default
   * day, |x| 14 to 27 is EMPTY across the entire draw distance, which is
   * exactly the continuous gap the first refusal said did not exist. It said
   * that because it only ever looked at the city.
   *
   * Then it was measured across FOURTEEN DAYS instead of one, and the sample
   * was the thing that was wrong:
   *
   *   0 of 14 bridge days have |x| 15-22 clear across the span.
   *
   * Two blockers appear on EVERY SINGLE DAY. `abut`, the bridge abutment,
   * reaches |x| 24 and stands at both ends of every span -- it is where the
   * bridge meets the land and it is not movable by argument. And `ship`, which
   * this very file put out there as the answer to "distant vehicles", carries a
   * 34-unit hull whose box reaches back into the band from a centre at 24.
   * Per-setting bridges then take what is left: stoneArch reaches |x| 37.8,
   * bascule 29, magere 18.4, against zakim's 13.
   *
   * **stoneArch was 67.5 here and the number was a defect, not a budget.** Its
   * downstream viaduct had its arch centres stepping along the extrusion axis
   * instead of the span axis, so four arches marched across the map from -64
   * to -0.5 -- through the player's road -- while their own deck and piers
   * stayed at -34. Fixed at the geometry (see stoneArch), and the reach it
   * really wanted is 37.8. **The refusal above is unaffected**: it rests on
   * `abut` at 24 and `ship`'s 34-unit hull from a centre at 24, both of which
   * appear on every bridge day, and 37.8 still fills the same band.
   *
   * So the bridge flank is not empty either. It is full of the bridge.
   *
   * WHAT IT WOULD ACTUALLY COST, since "it is occupied" is not on its own a
   * refusal when substantial change is authorised. Three systems, not one:
   * move the ships outboard by eight units; end the causeway inside the
   * abutments and accept that it therefore does not cross the water it is
   * supposed to cross; and suppress it per setting on the five bridges that
   * reach past 18. That last one is the tell. A carriageway that exists on
   * seven cities out of twelve, on one leg out of six, ending short of both
   * banks, is not a road -- it is a prop shaped like one, and it would be
   * carrying the only unoccluded peripheral motion in the game right beside
   * the read window to do it.
   *
   * WHAT IS NOT REFUSED, and it is still the elevated line above. Every
   * measurement taken this pass strengthens it rather than weakening it: the
   * blockers found on both routes are all at or near ground level -- kerb
   * scatter, hulls, abutments, arch spans -- and an elevated deck is the one
   * band none of them reach. It also needs no z reservation from anything,
   * because nothing else is up there. It remains a set piece plus a mover.
   *
   * WHAT THE OWNER SHOULD BE ASKED, because this is the second refusal and
   * the question behind it has not actually been put to them: the reason
   * traffic keeps failing is that this course is CLOSED and every band beside
   * it is already spent on the things that make it read as a closed course --
   * crowd, barrier, planting, street wall. Traffic is not missing by oversight.
   * It is missing because a marathon shuts the road. If moving vehicles are
   * wanted badly enough to pay for them, the honest purchase is the elevated
   * line, and that is a decision about the skyline rather than about the
   * roadside.
   *
   * ======================================================================
   * THE ELEVATED LINE WAS THEN BUILT, AND REFUSED BY ITS OWN GEOMETRY.
   * ======================================================================
   *
   * Both refusals above end on the same recommendation, so it was taken. The
   * first surprise was that IT ALREADY EXISTED: MARKS.lTrack is a 48-unit
   * viaduct run over the road on CHICAGO's CITY START and RIVERSIDE, and an
   * lTrackTrain variant baked three carriages into every third chunk. So the
   * elevated line the refusals asked for had been shipping all along, and the
   * only thing missing from it was the thing that was actually wanted: motion.
   * It draws on 66 of 365 days -- CHICAGO owns one of those two legs that
   * often -- which is why neither refusal noticed it.
   *
   * The train was split into its own pooled mesh and run against the player at
   * 14 units/s. It passed everything: tools/motion.js reported it at 13.6 u/s
   * heading -z and cleared CORRIDOR, READBAND and HUE; the full gate stayed
   * green; draws and triangles did not move.
   *
   * IT WAS ALSO COMPLETELY INVISIBLE, AND SO WAS THE ONE THAT SHIPPED.
   *
   * A projected screen rect said it was on frame for its whole approach --
   * ndcY 0.33 at 133 units, opening to 0.77 by 63. That is a FRUSTUM test and
   * it is not a visibility test: it reports that the box is inside the view
   * and says nothing about the solid plate in front of it. Raycast instead,
   * sampling a 24x24 grid across the train's own screen rect and asking what
   * the camera hits FIRST along each ray:
   *
   *   0 of 576 rays, on every frame, at every distance from 133u to overhead.
   *   The occluder is set piece / lTrack -- its own deck.
   *
   * The geometry is not subtle once it is written down. The lens sits at y =
   * 2.62 on the road. The viaduct carries a solid deck plate at y 12.6 across
   * the full |x| <= 11.9 between its columns, with girders to 14.5 and a
   * parapet to 16.65. A train riding ON that deck is behind it from every
   * point of the carriageway, because the camera is underneath. Pushing the
   * train sideways at runtime shows how far outboard it would have to go:
   *
   *   world x  -3.5 (as built)   0 / 574 rays
   *   world x -11.5              0 / 576
   *   world x -15.5              0 / 576
   *   world x -19.5              0 / 576
   *   world x -23.5             28 / 575   -- 4.9%, and that is the best of it
   *
   * So there is no lateral offset at which a line over this road shows its
   * traffic, and past |x| 20 the thing doing the blocking is no longer the
   * viaduct: the top occluder at EVERY offset tested is road tile / barrier.
   * That is the first refusal's band, holding one more time, from underneath.
   * The roadside is full at ground level, and a sightline to anything beyond
   * it has to leave the road through the same full band.
   *
   * WHAT THIS MEANS FOR THE NEXT ATTEMPT, because it is not "no elevated
   * line". It is that AN ELEVATED LINE PARALLEL TO THE COURSE CANNOT CARRY
   * VISIBLE TRAFFIC, whatever height it is at, because parallel means the
   * occluder travels with the sightline. A line CROSSING the course does not
   * have that problem: the deck of a perpendicular span is at the same z as
   * the train on it, so from 80 units back the deck is nearly edge-on and the
   * train stands proud of it against the sky. That is the one option the brief
   * listed first and it is the one the measurement leaves standing.
   *
   * It would have to be paid for honestly. A crossing over the road is an
   * OVERHEAD CROSSING, which is the category R3 cut from 14.32 per 100 units
   * to 1.97 at the owner's request. The el legs already run 3.47 crossings per
   * 100 against 1.95 on days without them, so those two legs have spent the
   * sky R3 opened twice over before a single crossing is added.
   *
   * WHAT WAS DONE INSTEAD: nothing was added, and the baked train was taken
   * out. Three carriages that no camera in this game can see are triangles and
   * nothing else. This is the one case where rule 1's "prove it with a frame
   * before removing it -- and expect that proof to fail" does not fail, and
   * the proof is the ray table above rather than a look at a screenshot.
   */

  /**
   * ============================ THE SETTINGS ============================
   *
   * Twelve places, three or four of which the day's course draws (see
   * pickSettings in course.js). This table is the whole of what makes one
   * different from another: a palette, a street, a tree, and a short list of
   * SILHOUETTES keyed by which beat of the race they belong to.
   *
   * It is deliberately a data table and not twelve piles of geometry. Every
   * `k` below names a builder in MARKS, and almost every builder is a thin
   * proportioning of one of a dozen shared parametric shapes -- a lattice
   * tower, a truss span, an arcade, a shell, a terraced row. Cape Town's
   * mountain and Paris's tower are built from the same four functions; what
   * differs is the numbers. That is what keeps twelve settings affordable and
   * what keeps them looking like one game.
   *
   * WHAT IDENTIFIES A CITY IS ITS SILHOUETTE, not its detail. At the distance
   * a landmark is actually seen here -- 60 to 200 units, through fog that has
   * taken a third of the contrast -- nothing survives except the outline
   * against the sky. So each setting spends its budget on one or two shapes
   * nobody could mistake (the Opera House shells, the Colosseum's arcade, a
   * sphere on a needle, a flat-topped mountain) and takes everything else from
   * the shared vocabulary.
   *
   * FIELDS
   *   sky/fog/ground/road   the base palette. BIOME_MOD pulls these around per
   *                         leg; nothing here is ever used raw at mile 20.
   *   water                 rivers, harbours and the drop under a bridge deck.
   *   edge                  a gentle tint on the roadside furniture. Multiplies
   *                         a vertex colour, so it can only ever knock down --
   *                         everything here stays close to white on purpose.
   *   terrace               the street wall: what the buildings AT THE KERB
   *                         are. This is doing more identification work than
   *                         any single landmark, because there is one in frame
   *                         essentially always.
   *   tower                 the taller blocks set back behind them.
   *   tree                  what a tree is here.
   *   marks                 landmarks, by biome. Cycled along the leg.
   *   bridge                what THE BRIDGE is in this city.
   *
   * A setting that has nothing to say about a beat simply omits it and takes
   * the fallback, which is the generic set this file has always had.
   */
  const SETTING_LOOK = {

    BOSTON: {
      sky: [0x2a55b0, 0xc6e8ff], fog: 0xcfe6f2, ground: 0x86b45a, road: 0x626374,
      water: 0x3f7fae, edge: 0xf4ece0,
      terrace: {
        colors: [0x9c5b4a, 0xb06a52, 0x8a5040, 0xc08a68, 0xa66a58],
        trim: 0xe8dcc4, win: 0x3c4a72, roof: 'flat', roofColor: 0x5a5266,
        h: [8.5, 11.5], bay: 4.6, depth: 7.0, rows: 4, stoop: 1, bow: 1, chimney: 2,
      },
      tower: { colors: [0x6a7ea8, 0x8a92b8, 0xb8b0a0], glass: 0, crown: 'flat' },
      tree: { kind: 'round', colors: [0xe0692f, 0xd8952a, 0xc04a2a, 0xe8b13a], h: 1.05 },
      marks: {
        'CITY START': [{ k: 'citgo', x: 15 }, { k: 'spireWhite', x: 14 }, { k: 'clock', x: 14.5 }],
        'RIVERSIDE': [{ k: 'citgo', x: 16 }, { k: 'ship', x: 34, y: -0.12 }],
        'PARKLAND': [{ k: 'oak', x: 15 }, { k: 'pond', x: 27 }, { k: 'spireWhite', x: 15 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'spireWhite', x: 14 }],
        'FINAL MILE': [{ k: 'clock', x: 15.5 }, { k: 'jumbo', x: 13.5 }, { k: 'citgo', x: 15 }],
      },
      bridge: 'zakim',
    },

    LONDON: {
      sky: [0x3a63b8, 0xdae8f4], fog: 0xd6e4f0, ground: 0x5fbf6b, road: 0x616372,
      water: 0x5a8fa8, edge: 0xffe8e8,
      terrace: {
        colors: [0xe8dcc8, 0xd8c8b0, 0xc8b8a4, 0xefe4d4, 0xb8a894],
        trim: 0xfff6e8, win: 0x33405e, roof: 'parapet', roofColor: 0x4a4458,
        h: [8.5, 11.0], bay: 4.4, depth: 7.0, rows: 4, stoop: 1, chimney: 3, balcony: 1,
      },
      tower: { colors: [0x7a8ab0, 0x9aa4c0, 0xc8ccd8], glass: 1, crown: 'flat' },
      tree: { kind: 'round', colors: [0x5f7f30, 0x84a83c, 0xaad84e], h: 1.15, trunk: 0x9a9a86 },
      marks: {
        'CITY START': [{ k: 'stPauls', x: 17 }, { k: 'bigBen', x: 14 }],
        'RIVERSIDE': [{ k: 'stPauls', x: 18 }, { k: 'ship', x: 34, y: -0.12 }],
        'PARKLAND': [{ k: 'oak', x: 15 }, { k: 'pond', x: 27 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'bigBen', x: 14 }],
        'FINAL MILE': [{ k: 'bigBen', x: 14.5 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'towerBridge',
    },

    BERLIN: {
      sky: [0x2f52b0, 0xcfe2f8], fog: 0xc8dcf5, ground: 0x69c46e, road: 0x616374,
      water: 0x4f86ae, edge: 0xeef0ff,
      terrace: {
        colors: [0xe4d8c0, 0xcfc0a8, 0xdcc8a8, 0xbfb098, 0xefe6d2],
        trim: 0xfff8ec, win: 0x384464, roof: 'mansard', roofColor: 0x59607a,
        h: [10.0, 13.0], bay: 4.8, depth: 7.4, rows: 5, chimney: 2, balcony: 1,
      },
      tower: { colors: [0x8894b8, 0xa8b0cc, 0xd8dce8], glass: 1, crown: 'flat' },
      tree: { kind: 'round', colors: [0x688a2e, 0x8cb43a, 0xb0e04e], h: 1.2 },
      marks: {
        'CITY START': [{ k: 'fernsehturm', x: 22 }, { k: 'brandenburg', over: 1 }],
        'RIVERSIDE': [{ k: 'fernsehturm', x: 24 }, { k: 'ship', x: 34, y: -0.12 }],
        'PARKLAND': [{ k: 'victoryColumn', x: 16 }, { k: 'oak', x: 15 }, { k: 'pond', x: 27 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'fernsehturm', x: 20 }],
        'FINAL MILE': [{ k: 'brandenburg', over: 1 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'oberbaum',
    },

    CHICAGO: {
      sky: [0x1f3fa0, 0xa8cfe8], fog: 0xa8cde0, ground: 0x63b46a, road: 0x616377,
      water: 0x3f7fa8, edge: 0xe4e8f4,
      terrace: {
        colors: [0x9a8f7e, 0x8a8070, 0xa8998a, 0x7c7466, 0xb0a494],
        trim: 0xd8cfc0, win: 0x2f3a58, roof: 'flat', roofColor: 0x4e4a5c,
        h: [9.0, 12.0], bay: 4.6, depth: 7.0, rows: 4, stoop: 1, chimney: 1,
      },
      tower: { colors: [0x2f3550, 0x3a4160, 0x4a5270], glass: 1, crown: 'antenna' },
      tree: { kind: 'round', colors: [0x5c8028, 0x7fa838, 0xa4d848], h: 1.0 },
      marks: {
        'CITY START': [{ k: 'willis', x: 20 }, { k: 'lTrack', over: 1, run: 48 }],
        'RIVERSIDE': [{ k: 'lTrack', over: 1, run: 48 }, { k: 'crane', x: 13 }, { k: 'willis', x: 22 }],
        'PARKLAND': [{ k: 'oak', x: 15 }, { k: 'pond', x: 27 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'willis', x: 19 }],
        'FINAL MILE': [{ k: 'willis', x: 20 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'bascule',
    },

    NEWYORK: {
      sky: [0x2b46b4, 0xbde0f8], fog: 0xbdd8ee, ground: 0x63c96b, road: 0x616376,
      water: 0x3d7ba6, edge: 0xfff0dc,
      terrace: {
        colors: [0x8f5442, 0xa6644c, 0x7c4838, 0xb87a5c, 0x96604a],
        trim: 0xe4d4bc, win: 0x35406a, roof: 'flat', roofColor: 0x4c4658,
        h: [9.5, 12.5], bay: 4.4, depth: 7.0, rows: 5, stoop: 1, tank: 1,
        fireEscape: 1, chimney: 1,
      },
      tower: { colors: [0x8a8272, 0xa89c88, 0x6f7488], glass: 0, crown: 'stepped' },
      tree: { kind: 'round', colors: [0x5c8028, 0x7fa838, 0xa4d848], h: 1.1 },
      marks: {
        'CITY START': [{ k: 'empire', x: 21 }, { k: 'clock', x: 15 }],
        'RIVERSIDE': [{ k: 'empire', x: 24 }, { k: 'ship', x: 34, y: -0.12 }],
        'PARKLAND': [{ k: 'oak', x: 15 }, { k: 'pond', x: 27 }, { k: 'empire', x: 26 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'empire', x: 20 }],
        'FINAL MILE': [{ k: 'empire', x: 20 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'verrazzano',
    },

    TOKYO: {
      sky: [0x3a3f9e, 0xffd0d8], fog: 0xffd6dc, ground: 0x5fbf7a, road: 0x666276,
      water: 0x4f8fb0, edge: 0xffe4ec,
      terrace: {
        colors: [0xdcdce4, 0xc8ccd8, 0xe8e4e0, 0xb8bcc8, 0xd0c8c8],
        trim: 0xfffdf5, win: 0x2f3856, roof: 'flat', roofColor: 0x4a4a5e,
        h: [9.0, 13.0], bay: 3.8, depth: 6.6, rows: 5, neon: 1, balcony: 2,
      },
      tower: { colors: [0xb8bcd0, 0xd0d4e0, 0x8f96b0], glass: 1, crown: 'antenna' },
      tree: { kind: 'columnar', colors: [0x4e7530, 0x74a03c, 0x9ccc4c], h: 1.0 },
      marks: {
        'CITY START': [{ k: 'skytree', x: 26 }, { k: 'neon', x: 13.5 }, { k: 'torii', over: 1 }],
        'RIVERSIDE': [{ k: 'skytree', x: 28 }, { k: 'neon', x: 14 }],
        'PARKLAND': [{ k: 'torii', over: 1 }, { k: 'pagoda', x: 16 }, { k: 'oak', x: 15 }],
        'THE WALL': [{ k: 'neon', x: 13 }, { k: 'hoarding', x: 12.6, rz: -0.16 }],
        'FINAL MILE': [{ k: 'skytree', x: 24 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'rainbow',
    },

    SYDNEY: {
      sky: [0x1f7fd0, 0xdcf4ff], fog: 0xd8f4ff, ground: 0x7fc86a, road: 0x606474,
      water: 0x2fa8d8, edge: 0xfff4e0,
      terrace: {
        colors: [0xd8b48c, 0xc49a74, 0xe8cfa8, 0xb08464, 0xefe0c4],
        trim: 0xfff8e8, win: 0x3a4468, roof: 'pitch', roofColor: 0x7f4a3a,
        h: [7.5, 9.5], bay: 4.4, depth: 7.0, rows: 3, balcony: 1, chimney: 2,
      },
      tower: { colors: [0x8fa8c8, 0xb0c4dc, 0xd8e4ee], glass: 1, crown: 'flat' },
      tree: { kind: 'palm', colors: [0x5f8a30, 0x92c040], h: 1.1 },
      marks: {
        'CITY START': [{ k: 'operaHouse', x: 19 }, { k: 'sydneyTower', x: 20 }],
        'RIVERSIDE': [{ k: 'operaHouse', x: 20 }, { k: 'ship', x: 34, y: -0.12 }],
        'PARKLAND': [{ k: 'oak', x: 15 }, { k: 'pond', x: 27 }, { k: 'sydneyTower', x: 20 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'sydneyTower', x: 18 }],
        'FINAL MILE': [{ k: 'operaHouse', x: 19 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'harbour',
    },

    PARIS: {
      sky: [0x3a58b8, 0xe2e4f2], fog: 0xe0dfe8, ground: 0x6fc274, road: 0x65636d,
      water: 0x6a94a8, edge: 0xf4f0e4,
      terrace: {
        colors: [0xe8dcc0, 0xdcceb0, 0xf0e6cc, 0xd0c0a4, 0xe4d8bc],
        trim: 0xfff8ea, win: 0x38446a, roof: 'mansard', roofColor: 0x5a6076,
        h: [10.5, 12.5], bay: 4.6, depth: 7.2, rows: 5, balcony: 2, chimney: 4,
      },
      tower: { colors: [0xc8c0ac, 0xd8d0bc, 0xb0a894], glass: 0, crown: 'flat' },
      tree: { kind: 'pollard', colors: [0x62862e, 0x8ab23c, 0xaedc4e], h: 1.1, trunk: 0xa8a894 },
      marks: {
        'CITY START': [{ k: 'eiffel', x: 24 }, { k: 'arcDeTriomphe', over: 1 }],
        'RIVERSIDE': [{ k: 'eiffel', x: 26 }, { k: 'ship', x: 34, y: -0.12 }],
        'PARKLAND': [{ k: 'eiffel', x: 26 }, { k: 'pond', x: 27 }, { k: 'oak', x: 15 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'eiffel', x: 22 }],
        'FINAL MILE': [{ k: 'arcDeTriomphe', over: 1 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'stoneArch',
    },

    VALENCIA: {
      sky: [0x1f7fd8, 0xeaf6ff], fog: 0xe8f6ff, ground: 0x8fc45f, road: 0x65636e,
      water: 0x30b0d0, edge: 0xfff8e8,
      terrace: {
        colors: [0xfff2d8, 0xf4e4c4, 0xffe8c8, 0xe8d8bc, 0xfff8e8],
        trim: 0xffffff, win: 0x3f4a70, roof: 'tile', roofColor: 0xc86a42,
        h: [8.0, 10.5], bay: 4.4, depth: 7.0, rows: 4, balcony: 1,
      },
      tower: { colors: [0xf4ecd8, 0xffffff, 0xe4dcc8], glass: 0, crown: 'flat' },
      tree: { kind: 'palm', colors: [0x6b9834, 0xa0d045], h: 1.25 },
      marks: {
        'CITY START': [{ k: 'calatravaRibs', x: 17 }, { k: 'hemisferic', x: 20 }],
        'RIVERSIDE': [{ k: 'hemisferic', x: 20 }, { k: 'calatravaRibs', x: 17 }],
        'PARKLAND': [{ k: 'calatravaRibs', x: 17 }, { k: 'pond', x: 27 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'calatravaRibs', x: 16 }],
        'FINAL MILE': [{ k: 'hemisferic', x: 20 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'harp',
    },

    AMSTERDAM: {
      sky: [0x2f5fb8, 0xd4e8f6], fog: 0xcfe6f4, ground: 0x5fc07a, road: 0x606472,
      water: 0x4f7f96, edge: 0xf0ece0,
      terrace: {
        colors: [0x7a4438, 0x8f5442, 0x64483c, 0x9c6250, 0x543c34],
        trim: 0xf4ece0, win: 0x2f3a5e, roof: 'stepgable', roofColor: 0x6a4438,
        h: [10.0, 13.0], bay: 3.2, depth: 6.4, rows: 5, hoist: 1, lean: 1,
      },
      tower: { colors: [0x8f6a58, 0xa88070, 0xc8a890], glass: 0, crown: 'flat' },
      tree: { kind: 'round', colors: [0x5f8a2e, 0x84b03a, 0xa8dc4c], h: 1.15 },
      marks: {
        'CITY START': [{ k: 'canal', x: 20, run: 40, alt: 'canalBridge', every: 3, side: -1 }, { k: 'westerkerk', x: 15 }],
        'RIVERSIDE': [{ k: 'canal', x: 20, run: 40, alt: 'canalBridge', every: 3, side: -1 }, { k: 'westerkerk', x: 16 }],
        'PARKLAND': [{ k: 'oak', x: 15 }, { k: 'pond', x: 27 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'westerkerk', x: 15 }],
        'FINAL MILE': [{ k: 'westerkerk', x: 15 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'magere',
    },

    ROME: {
      sky: [0x2a63c0, 0xffe6c0], fog: 0xffe0bc, ground: 0x8fb45a, road: 0x69626c,
      water: 0x5f9fae, edge: 0xfff0d8,
      terrace: {
        colors: [0xd8964a, 0xc8823e, 0xe8ac60, 0xb87038, 0xefc484],
        trim: 0xfff0d0, win: 0x4a4058, roof: 'tile', roofColor: 0xb05a34,
        h: [9.0, 11.5], bay: 4.6, depth: 7.2, rows: 4, balcony: 1, chimney: 2,
      },
      tower: { colors: [0xe8c48c, 0xd8a868, 0xf0dcb0], glass: 0, crown: 'flat' },
      tree: { kind: 'umbrella', colors: [0x466a24, 0x628c30, 0x88bc3c], h: 1.2 },
      marks: {
        'CITY START': [{ k: 'colosseum', x: 21 }, { k: 'aqueduct', over: 1 }],
        'RIVERSIDE': [{ k: 'colosseum', x: 22 }, { k: 'ship', x: 34, y: -0.12 }],
        'PARKLAND': [{ k: 'aqueduct', over: 1 }, { k: 'pond', x: 27 }, { k: 'oak', x: 15 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'aqueduct', over: 1 }],
        'FINAL MILE': [{ k: 'colosseum', x: 21 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'stoneArch',
    },

    CAPETOWN: {
      sky: [0x1666c8, 0xe4f2ff], fog: 0xdff0ff, ground: 0x9fb05a, road: 0x616373,
      water: 0x2f9fd8, edge: 0xfff2e4,
      // Bo-Kaap: the one street in the world painted in flat saturated blocks,
      // and the cheapest possible way to say "Cape Town" at a hundred units.
      terrace: {
        colors: [0x39c0d8, 0xf05a7a, 0x62d07a, 0xffc23a, 0x9a7bff, 0xff8a4a],
        trim: 0xffffff, win: 0x2f3a5e, roof: 'pitch', roofColor: 0xb8b0a0,
        h: [6.5, 8.0], bay: 4.4, depth: 6.6, rows: 2, stoop: 1,
      },
      tower: { colors: [0xdce4ec, 0xc8d4e0, 0xf0f4f8], glass: 1, crown: 'flat' },
      tree: { kind: 'scrub', colors: [0x7d8f38, 0x9cb04c, 0x6a8440], h: 0.9 },
      marks: {
        'CITY START': [{ k: 'tableMountain', x: 72, run: 220, side: -1 }, { k: 'clock', x: 15 }],
        'RIVERSIDE': [{ k: 'tableMountain', x: 78, run: 220, side: -1 }, { k: 'ship', x: 34, y: -0.12 }],
        'PARKLAND': [{ k: 'tableMountain', x: 72, run: 220, side: -1 }, { k: 'oak', x: 15 }],
        'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }, { k: 'tableMountain', x: 72, run: 220, side: -1 }],
        'FINAL MILE': [{ k: 'tableMountain', x: 72, run: 220, side: -1 }, { k: 'jumbo', x: 13.5 }],
      },
      bridge: 'tower',
    },
  };

  /** Palette fields a setting owes; used to build the no-settings fallback. */
  function fallbackSetting(biomeName) {
    const b = BIOME_LOOK[biomeName] || BIOME_LOOK['CITY START'];
    return {
      sky: b.sky, fog: b.fog, ground: b.ground, road: b.road,
      water: 0x2f8fc4, edge: 0xffffff,
      terrace: SETTING_LOOK.LONDON.terrace,
      tower: SETTING_LOOK.LONDON.tower,
      tree: { kind: 'cone', colors: [0x4e8a2c, 0x6fae38, 0x94d448], h: 1 },
      marks: {}, bridge: 'tower',
    };
  }

  // Scratch colours: applyBiome runs every frame and must not allocate.
  const _cA = new THREE.Color();
  const _cB = new THREE.Color();
  function lerpInto(out, a, b, t) {
    _cA.set(a); _cB.set(b);
    return out.copy(_cA).lerp(_cB, t);
  }

  // ---- canvas textures --------------------------------------------------
  // Generated at runtime -- still no assets.

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function texture(c, repeat) {
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  /** Canvas-drawn label texture, used by the mile banners. */
  function labelTexture(text, bg, fg, w, h, sub) {
    const c = canvas(w || 512, h || 128);
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    // A bright inner keyline stops the panel reading as a floating rectangle
    // at distance -- it is the frame that says "sign", not the text.
    g.strokeStyle = fg; g.lineWidth = Math.max(3, c.height * 0.045);
    g.strokeRect(c.height * 0.07, c.height * 0.07, c.width - c.height * 0.14, c.height - c.height * 0.14);
    g.fillStyle = fg;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fam = 'ui-sans-serif, system-ui, -apple-system, Arial, sans-serif';
    if (sub) {
      g.font = `900 ${Math.floor(c.height * 0.46)}px ${fam}`;
      g.fillText(text, c.width / 2, c.height * 0.40);
      g.font = `800 ${Math.floor(c.height * 0.20)}px ${fam}`;
      g.fillText(sub, c.width / 2, c.height * 0.76);
    } else {
      g.font = `900 ${Math.floor(c.height * 0.60)}px ${fam}`;
      g.fillText(text, c.width / 2, c.height / 2 + c.height * 0.03);
    }
    return texture(c);
  }

  /**
   * THE MILE MARKER'S OWN LABEL, and it is set differently from every other
   * sign in the game for one measured reason.
   *
   * `labelTexture` centres one line at 0.60 em on a 768x128 canvas. On the old
   * 9.3 x 2.1 plate that put the cap height at 0.90 world units -- four to
   * eight PIXELS in portrait at the 70-160 units where the sign is first read,
   * with 9.3 units of plate width carrying a word and a two-digit number and
   * most of it empty. The plate was the right size; the type on it was not.
   *
   * A real marathon mile marker is set the other way round: the NUMBER is the
   * object and the word is a caption. So the numeral takes 0.875 em of a 240px
   * canvas -- cap height 1.82 world units on the 2.9-unit plate, 2.01x what it
   * was -- and MILE is set small beside it. The pair is measured and centred as
   * a group, so 5 and 26.2 both sit right on a symmetric gantry.
   *
   * Same triangles, same one draw call, same texture upload. The only thing
   * that changed is where the ink went.
   */
  const MILE_TEX_W = 768, MILE_TEX_H = 240;   // 3.20, the plate's own aspect
  function mileTexture(word, num, bg, fg, sub) {
    const c = canvas(MILE_TEX_W, MILE_TEX_H);
    const g = c.getContext('2d');
    const H = c.height, W = c.width;
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // The keyline is what says "sign" rather than "floating rectangle" at
    // distance, and at this plate size it can afford to be heavier.
    g.strokeStyle = fg; g.lineWidth = Math.round(H * 0.05);
    g.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12);
    const fam = 'ui-sans-serif, system-ui, -apple-system, Arial, sans-serif';
    const numFont = `900 ${Math.round(H * 0.875)}px ${fam}`;
    const wordFont = `900 ${Math.round(H * (sub ? 0.20 : 0.26))}px ${fam}`;
    g.font = numFont;
    const numW = g.measureText(num).width;
    g.font = wordFont;
    const wordW = Math.max(g.measureText(word).width, sub ? g.measureText(sub).width : 0);
    const GAP = H * 0.11;
    const x0 = (W - (wordW + GAP + numW)) / 2;

    g.fillStyle = fg;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    if (sub) {
      g.fillText(word, x0, H * 0.41);
      g.font = `800 ${Math.round(H * 0.155)}px ${fam}`;
      g.fillText(sub, x0, H * 0.62);
    } else {
      g.fillText(word, x0, H * 0.52);
    }
    g.font = numFont;
    // Digits have no descender, so the optical centre of a numeral sits a
    // little below the box centre. 0.53 puts it on the plate's middle.
    g.fillText(num, x0 + wordW + GAP, H * 0.53);
    return texture(c);
  }

  /**
   * The lane telegraph that lies on the road ahead of a hazard.
   *
   * The icon is a SHAPE first and a colour second: solid up-triangles for
   * JUMP, stacked rungs for DUCK, crosses for BLOCK. At 90 units the mat is
   * about a dozen pixels tall, which is enough for shape but not for reading
   * a small hazard mesh -- which is exactly the distance the lane choice has
   * to be made at.
   */
  function matTexture(kind, tint, wash) {
    const c = canvas(128, 256);
    const g = c.getContext('2d');
    // A wash under the icons: the road is mid-value, the icons are bright, and
    // without this the edges of the mat vanish into it. The wash is a dark
    // version of the hazard's own hue, not neutral -- at the faded near end a
    // neutral wash read as a dirty grey smear on the tarmac.
    g.fillStyle = wash;
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = tint;
    g.fillRect(0, 0, 8, 256); g.fillRect(120, 0, 8, 256);

    for (let i = 0; i < 3; i++) {
      const cy = 42 + i * 86;
      if (kind === K.JUMP) {
        // Apex points down-canvas, which after the -90deg lay-down points
        // AWAY from the runner: a ramp read, not a "stop" read.
        g.beginPath();
        g.moveTo(64, cy + 30); g.lineTo(108, cy - 28); g.lineTo(20, cy - 28);
        g.closePath(); g.fill();
      } else if (kind === K.DUCK) {
        g.fillRect(20, cy - 30, 88, 15);
        g.fillRect(20, cy - 4, 88, 15);
        g.fillRect(20, cy + 22, 88, 15);
      } else {
        g.lineWidth = 17; g.strokeStyle = tint; g.lineCap = 'butt';
        g.beginPath();
        g.moveTo(24, cy - 30); g.lineTo(104, cy + 30);
        g.moveTo(104, cy - 30); g.lineTo(24, cy + 30);
        g.stroke();
      }
    }
    const t = texture(c, true);
    t.repeat.set(1, 5);
    return t;
  }

  /** Diagonal caution stripes for the face a hazard turns toward the player. */
  function stripeTexture(a, b) {
    const c = canvas(128, 64);
    const g = c.getContext('2d');
    g.fillStyle = a; g.fillRect(0, 0, 128, 64);
    g.fillStyle = b;
    for (let x = -64; x < 160; x += 32) {
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 + 64, 64); g.lineTo(x + 64, 64);
      g.closePath(); g.fill();
    }
    const t = texture(c, true);
    t.repeat.set(2, 1);
    return t;
  }

  /**
   * Window grid for buildings. Repeat is set per instance so windows keep a
   * constant world size no matter how the box is scaled.
   *
   * Two styles, because a punched window and a curtain wall are different
   * BUILDINGS and not different colours of the same one: `glass` gives the
   * continuous horizontal spandrel banding that says post-war office tower,
   * and it is most of what separates a Chicago block from a Roman one once
   * the tint has been applied.
   */
  function windowTexture(glass) {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    if (glass) {
      for (let ry = 0; ry < 2; ry++) {
        g.fillStyle = ry ? '#b8cfe8' : '#9fb8d8';
        g.fillRect(0, ry * 32 + 6, 64, 19);
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fillRect(0, ry * 32 + 6, 64, 3);
        g.fillStyle = 'rgba(24,20,50,0.28)';
        g.fillRect(0, ry * 32 + 23, 64, 3);
        for (let k = 0; k < 8; k++) {
          g.fillStyle = 'rgba(24,20,50,0.16)';
          g.fillRect(k * 8 + 3, ry * 32 + 6, 2, 19);
        }
      }
      return texture(c, true);
    }
    const lit = ['#ffe9a8', '#cfe4ff', '#8fa6cc', '#6f86b4'];
    for (let ry = 0; ry < 2; ry++) {
      for (let rx = 0; rx < 2; rx++) {
        g.fillStyle = lit[(rx * 2 + ry * 3) % lit.length];
        g.fillRect(rx * 32 + 7, ry * 32 + 8, 18, 15);
        g.fillStyle = 'rgba(30,25,60,0.30)';
        g.fillRect(rx * 32 + 7, ry * 32 + 8, 18, 4);
      }
    }
    return texture(c, true);
  }

  /**
   * Pale banded ripples, laid over the water plane on the bridge.
   *
   * THE CRESTS RUN ALONG THE ROAD, BECAUSE THE RIVER RUNS ACROSS IT.
   *
   * These bars used to be drawn horizontally, which put the wave crests across
   * the direction of travel and therefore the current ALONG it -- a river
   * flowing the same way as the bridge that crosses it. Two things were wrong
   * with that and only one of them is pedantry.
   *
   * The one that matters: the player is travelling at 21.8-27.7 units/s and
   * the ripple crawled at 0.485 units/s (0.014 offset/s over a 34.6-unit
   * repeat). A drift along the axis the player is already sweeping at fifty
   * times the speed is invisible by construction -- it is 1.9% of the motion
   * already in that axis. Turning the current across the road puts it on the
   * one axis the player's own travel does NOT hide, which is the same reason
   * the pavement walkers were given lateral drift rather than forward drift.
   *
   * Drawn vertically, the crests also converge on the vanishing point instead
   * of strobing past, which is what makes a flat sheet read as reaching to the
   * horizon rather than as a scrolling belt.
   */
  function rippleTexture() {
    const c = canvas(128, 128);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.30)';
    for (let i = 0; i < 7; i++) {
      const x = 8 + i * 17, h = 24 + ((i * 37) % 60);
      g.fillRect(x, ((i * 53) % 100), 4, h);
      g.fillRect(x + 7, ((i * 29) % 90) + 20, 3, h * 0.6);
    }
    return texture(c, true);
  }

  /**
   * Faint irregular patchwork for the ground and the verges. A single flat
   * colour over a 1,400-unit plane reads as coloured paper; a few percent of
   * banded variation is enough to give the eye somewhere to land without
   * breaking the cel-shaded flatness.
   */
  function groundTexture() {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    const shades = ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.07)', 'rgba(0,0,0,0.025)'];
    let s = 1337;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 14; i++) {
      g.fillStyle = shades[Math.floor(r() * shades.length)];
      g.fillRect(r() * 64 - 8, r() * 64 - 8, 10 + r() * 26, 8 + r() * 20);
    }
    return texture(c, true);
  }

  /**
   * Tarmac mottle: aggregate, a patched repair and gutter grime.
   *
   * The high-frequency joints that carry the speed cue are NOT here -- they are
   * geometry, in paintGeo, and the comment there says why a texture could not
   * do it. What is left is the low-frequency dirt a texture is genuinely good
   * at: variation too fine to model and too coarse to alias, which stops the
   * flat colour between the joints reading as coloured paper.
   *
   * Everything below is achromatic on purpose. The telegraph mats own amber,
   * cyan and pink, and they are the device the whole game's readability rests
   * on; the road is allowed value variation and no hue at all.
   */
  const ROAD_SLAB = 1.2;
  function roadSurfaceTexture() {
    const SLABS = 8, PX = 64;
    const c = canvas(128, SLABS * PX);
    const g = c.getContext('2d');
    let s = 7013;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);

    for (let i = 0; i < SLABS; i++) {
      const y0 = i * PX;
      // Slab tone, with a little jitter on top. Without the jitter eight slabs
      // read as one two-slab pattern repeated, which is a beat the eye locks on
      // to instead of an even surface.
      const t = (i & 1 ? 0.032 : 0.012) + r() * 0.020;
      g.fillStyle = 'rgba(24,18,48,' + t.toFixed(3) + ')';
      g.fillRect(0, y0, c.width, PX);
      // Aggregate. Small and low contrast, but it is what stops the middle
      // distance collapsing to dead flat colour between the joints.
      for (let k = 0; k < 30; k++) {
        g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(24,18,48,0.08)';
        g.fillRect(r() * c.width, y0 + r() * PX, 2 + r() * 8, 2 + r() * 4);
      }
    }
    // A patched repair, spanning two slabs and crossing their joints. It is the
    // one irregular mark on the map and it is what stops the 9.6-unit period
    // from reading as a tile once the eye has learned the joint rhythm.
    g.fillStyle = 'rgba(24,18,48,0.075)';
    g.fillRect(16, PX * 2 + 12, 52, PX * 2 - 20);
    g.fillStyle = 'rgba(24,18,48,0.16)';
    g.fillRect(16, PX * 2 + 12, 52, 4);
    g.fillRect(16, PX * 4 - 12, 52, 4);
    // Gutter grime, at the tarmac edge on both sides. repeat.x is 1, so u maps
    // straight onto the carriageway and these land exactly at the kerb line.
    g.fillStyle = 'rgba(24,18,48,0.10)';
    g.fillRect(0, 0, 7, c.height);
    g.fillRect(c.width - 7, 0, 7, c.height);

    const t = texture(c, true);
    // The road is the one surface seen at a grazing angle for its whole length,
    // which is precisely the case trilinear filtering handles worst. Doubling
    // anisotropy here and nowhere else is what carries the joints out to the
    // middle distance instead of losing them at thirty units.
    t.anisotropy = 8;
    return t;
  }

  /** Checker band for the finish gantry. */
  function checkerTexture() {
    const c = canvas(128, 32);
    const g = c.getContext('2d');
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = ((x + y) & 1) ? '#1b1633' : '#fffdf5';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const t = texture(c, true);
    t.repeat.set(6, 1);
    return t;
  }

  // ---- geometry merging -------------------------------------------------
  /**
   * Fold a list of transformed primitives into one vertex-coloured geometry.
   *
   * A spectator built from seven boxes as seven meshes costs seven draws and
   * there can be a hundred of them beside the road. Baking colour into the
   * vertices means a whole knot of them, or a bridge tower with its cables,
   * ships as one mesh under one shared material.
   */
  /**
   * A part may additionally carry `wave: [phase, amp]`, which merge() bakes
   * into an `aWave` vertex attribute. That is what lets one merged mesh hold a
   * grandstand whose STRUCTURE is rigid and whose SPECTATORS move: the seating
   * decks get amp 0, the bodies get amp 1, and mats.crowd displaces per vertex
   * on the GPU. Nothing is spent on it -- no extra draw, no extra triangle, no
   * per-frame CPU work -- and it is the whole difference between a crowd and a
   * pattern. The attribute is only emitted if some part asked for it, so every
   * other merged prop is byte-identical to before.
   */
  /**
   * A part may also carry `gloss`, a 0..1 scalar baked into an `aGloss` vertex
   * attribute for the cel specular in shading.js. Same trick as `wave` and for
   * the same reason: a hazard variant is ONE merged geometry under ONE shared
   * material, so without a per-part channel the only choices would be a glossy
   * whole vehicle or a matte one -- and a glossy tyre is worse than no
   * highlight at all. Glass and chrome get the wet end, paint the middle,
   * rubber and cloth and skin zero.
   *
   * Emitted only if some part asked for it, so every merged prop that has not
   * opted in is byte-identical to before and its material is not even the
   * specular one.
   */
  function merge(parts) {
    let n = 0;
    let anyWave = false;
    let anyGloss = false;
    const prepared = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (p.matrix) g.applyMatrix4(p.matrix);
      prepared.push({ g, color: p.color, wave: p.wave, gloss: p.gloss });
      if (p.wave) anyWave = true;
      if (p.gloss) anyGloss = true;
      n += g.attributes.position.count;
    }
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const wav = anyWave ? new Float32Array(n * 3) : null;
    const gls = anyGloss ? new Float32Array(n) : null;
    let o = 0;
    for (const item of prepared) {
      const g = item.g;
      const count = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      _cA.set(item.color === undefined ? 0xffffff : item.color);
      for (let i = 0; i < count; i++) {
        col[(o + i) * 3] = _cA.r;
        col[(o + i) * 3 + 1] = _cA.g;
        col[(o + i) * 3 + 2] = _cA.b;
      }
      if (wav && item.wave) {
        for (let i = 0; i < count; i++) {
          wav[(o + i) * 3] = item.wave[0];
          wav[(o + i) * 3 + 1] = item.wave[1];
          wav[(o + i) * 3 + 2] = item.wave[2] || 0;
        }
      }
      if (gls && item.gloss) {
        for (let i = 0; i < count; i++) gls[o + i] = item.gloss;
      }
      o += count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (wav) out.setAttribute('aWave', new THREE.BufferAttribute(wav, 3));
    if (gls) out.setAttribute('aGloss', new THREE.BufferAttribute(gls, 1));
    out.computeBoundingSphere();
    return out;
  }

  /**
   * Tag a part with a gloss level for the cel specular. Chainable on any of
   * the primitive helpers: gl(bx(...), GLOSS.paint).
   */
  function gl(p, g) { p.gloss = g; return p; }

  /**
   * The gloss ladder, one place, so the fleet is consistent about what a
   * material IS rather than each variant guessing.
   *
   * The numbers are ratios of the full band, not physical reflectance: 1.0 is
   * the wettest thing in the game and the rest are stated against it.
   */
  /**
   * THE LADDER IS WEIGHTED AWAY FROM THE NEUTRAL ELEMENTS, and that is the
   * third and last correction the chroma budget forced on this pass.
   *
   * Isolated by building the fleet with every gloss set to zero and measuring
   * against the same frame: the new GEOMETRY costs almost nothing in
   * saturation -- the taxi went 0.374 to 0.367 and the refuse truck 0.399 to
   * 0.363 -- and the HIGHLIGHT costs all the rest, 0.367 to 0.290 and 0.363 to
   * 0.296. The reason is not that a highlight is white; it is already tinted.
   * It is that the glossiest surfaces in the first ladder were the chrome,
   * the plates, the rims and the glass flash, which are the near-neutral
   * elements -- so the specular was brightening precisely the parts that pull
   * an area mean to the axis, and raising their weight in it.
   *
   * So chrome and glass come down and paint stays. A vehicle's bodywork is the
   * saturated part, and a highlight there costs nothing and reads as the same
   * shine. What is given up is a wet-looking window, which the glass flash band
   * is already drawing far more legibly than a specular ever did.
   */
  const GLOSS = {
    glass: 0.55,
    chrome: 0.30,  // trim, lamp cores, plates, bright rims
    // Bodywork is deliberately the LOW end and not the middle. A vehicle body
    // is mostly large flat panels, and a flat panel does not get a highlight
    // sweeping across it -- it switches on whole. Measured on the orbit sheet,
    // paint at 0.55 took the taxi's flank from L 133 to L 177 and bleached the
    // hue out of it. What carries the fleet's shine is the chamfers and the
    // cylinders, where the band is narrow because the surface turns.
    paint: 0.42,
    trim: 0.22,    // creases, bumpers, dark plastics with a sheen
    matte: 0.0,    // rubber, cloth, skin, hi-vis, anything painted-on
  };

  const _euler = new THREE.Euler();
  function part(geo, color, x, y, z, rx, ry, rz) {
    const m = new THREE.Matrix4();
    if (rx || ry || rz) m.makeRotationFromEuler(_euler.set(rx || 0, ry || 0, rz || 0));
    m.setPosition(x || 0, y || 0, z || 0);
    return { geo, color, matrix: m };
  }
  function bx(w, h, d, x, y, z, color, rx, ry, rz) {
    return part(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }
  function cyl(rt, rb, h, seg, x, y, z, color, rx, ry, rz) {
    return part(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
  }
  function cone(r, h, seg, x, y, z, color) {
    return part(new THREE.ConeGeometry(r, h, seg), color, x, y, z);
  }

  /**
   * ============ THE CHAMFERED BOX ============
   *
   * A box with all twelve edges and all eight corners cut off at 45 degrees.
   * This is the primitive that answers "they look like boxes", and it answers
   * it in two ways at once rather than one.
   *
   * SILHOUETTE. A cut corner is visibly not a square corner at gameplay
   * distance -- it is the difference between a slab and a moulded panel, and
   * it is what the reference's cars have everywhere. There is no hard 90
   * degree corner anywhere on the silhouette of any car in
   * reference/sonic-cars-closeup.png.
   *
   * SHADING, and this is the half that a stepped chamfer cannot buy. The
   * existing vRoof steps a box in twice, which the file itself describes as
   * "a square corner with a nick in it" -- and the deeper problem is that every
   * face of a stepped chamfer is still axis-aligned, so it carries the same
   * three normals the box already had and takes exactly the same band of the
   * toon ramp. A real chamfer introduces normals at 45 degrees, which land in
   * a DIFFERENT ramp band from both faces they join, so the edge reads as a
   * lit turn rather than as a join. It is also the only surface on the whole
   * vehicle that the cel specular in shading.js can put its hot core on -- see
   * the threshold derivation there. Chamfers and the highlight are one change.
   *
   * WINDING IS DERIVED, NOT WRITTEN. Every triangle is emitted in whatever
   * order is convenient and then flipped if its own normal points into the
   * solid. The shape is convex and centred on the origin, so "outward" is just
   * the centroid direction and the test is exact. This file has lost a week to
   * hand-written winding once already (see the shadow-quad note) and it
   * presents as geometry that is perfectly correct and draws nothing; deriving
   * it costs a dozen lines and cannot be got wrong.
   *
   * Normals are per-face flat, from computeVertexNormals on non-indexed
   * geometry -- smooth normals across a 45 degree chamfer would turn the hard
   * cel band back into the gradient this renderer does not have.
   *
   * COST: 44 triangles against a box's 12. At the four or five masses a vehicle
   * carries its silhouette on, that is about 150 extra triangles a variant --
   * against a budget with 300,000 spare -- and ZERO extra draw calls, because
   * it merges into the same single geometry as everything else.
   */
  function chamferGeo(w, h, d, c) {
    const hx = w / 2, hy = h / 2, hz = d / 2;
    // A chamfer may never eat more than half of the smallest dimension, or the
    // inner face inverts and the solid turns inside out.
    const k = Math.max(0.0005, Math.min(c, hx * 0.5, hy * 0.5, hz * 0.5));
    const ix = hx - k, iy = hy - k, iz = hz - k;
    const tri = [];
    function push(a, b, cc) { tri.push([a, b, cc]); }
    function quad(a, b, cc, dd) { push(a, b, cc); push(a, cc, dd); }

    // The six inset faces.
    quad([hx, -iy, -iz], [hx, iy, -iz], [hx, iy, iz], [hx, -iy, iz]);
    quad([-hx, -iy, -iz], [-hx, iy, -iz], [-hx, iy, iz], [-hx, -iy, iz]);
    quad([-ix, hy, -iz], [ix, hy, -iz], [ix, hy, iz], [-ix, hy, iz]);
    quad([-ix, -hy, -iz], [ix, -hy, -iz], [ix, -hy, iz], [-ix, -hy, iz]);
    quad([-ix, -iy, hz], [ix, -iy, hz], [ix, iy, hz], [-ix, iy, hz]);
    quad([-ix, -iy, -hz], [ix, -iy, -hz], [ix, iy, -hz], [-ix, iy, -hz]);

    // The twelve edge bevels. Four run along each axis.
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        quad([-ix, sy * hy, sz * iz], [ix, sy * hy, sz * iz],
             [ix, sy * iy, sz * hz], [-ix, sy * iy, sz * hz]);
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        quad([sx * hx, -iy, sz * iz], [sx * hx, iy, sz * iz],
             [sx * ix, iy, sz * hz], [sx * ix, -iy, sz * hz]);
      }
    }
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        quad([sx * hx, sy * iy, -iz], [sx * hx, sy * iy, iz],
             [sx * ix, sy * hy, iz], [sx * ix, sy * hy, -iz]);
      }
    }

    // The eight corner triangles.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          push([sx * hx, sy * iy, sz * iz], [sx * ix, sy * hy, sz * iz], [sx * ix, sy * iy, sz * hz]);
        }
      }
    }

    const pos = new Float32Array(tri.length * 9);
    for (let t = 0; t < tri.length; t++) {
      let [a, b, c2] = tri[t];
      // Outward test: the solid is convex about the origin, so a triangle whose
      // own normal disagrees with its centroid is wound the wrong way round.
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const cx = (a[0] + b[0] + c2[0]) / 3, cy = (a[1] + b[1] + c2[1]) / 3, cz = (a[2] + b[2] + c2[2]) / 3;
      // Compare in a normalised frame: the box is not a cube, so a raw dot
      // against the centroid is dominated by whichever axis is longest.
      if (nx * cx / (hx * hx) + ny * cy / (hy * hy) + nz * cz / (hz * hz) < 0) {
        const s = b; b = c2; c2 = s;
      }
      const o = t * 9;
      pos[o] = a[0]; pos[o + 1] = a[1]; pos[o + 2] = a[2];
      pos[o + 3] = b[0]; pos[o + 4] = b[1]; pos[o + 5] = b[2];
      pos[o + 6] = c2[0]; pos[o + 7] = c2[1]; pos[o + 8] = c2[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tri.length * 6), 2));
    return g;
  }

  /** Chamfered box as a mergeable part, in world units. */
  function cbx(w, h, d, x, y, z, color, c, rx, ry, rz) {
    return part(chamferGeo(w, h, d, c === undefined ? 0.05 : c), color, x, y, z, rx, ry, rz);
  }
  /**
   * Tag a part as crowd flesh: phase staggers it, amp scales its move, and
   * kind selects WHICH move -- see WAVE_BODY for the five.
   *
   * Phase is per FIGURE and must stay that way: the shader derives each
   * person's own rate jitter from it, so two parts of one body with different
   * phases are two bodies moving at two speeds. Behaviour goes in kind.
   */
  function wv(p, phase, amp, kind) {
    p.wave = [phase, amp === undefined ? 1 : amp, kind || 0];
    return p;
  }
  /** The five behaviours aWave.z selects. */
  const CHEER = { BODY: 0, WAVE: 1, CLAP_L: 2, CLAP_R: 3, BRACED: 4 };
  /** Low-poly blob, for canopies and anything that must not read as a box. */
  function sph(r, seg, x, y, z, color) {
    return part(new THREE.SphereGeometry(r, seg || 7, Math.max(3, (seg || 7) - 2)), color, x, y, z);
  }

  /**
   * The luminance an authored colour comes back at through this renderer's
   * shaded band, and it is NOT the order the hex suggests.
   *
   * Measured by rendering flat swatches through the contrast audit's own
   * camera: the shaded band returns (0.660R, 0.732G, 0.828B) of the authored
   * value, so Rec.601 on that is 0.197R + 0.430G + 0.094B -- green carries 60%
   * of it and blue almost none. Checked against the audit on twenty-four
   * colours; cream 0xfff2e0 predicts 175.4 and measures 175.5, BLOCK pink
   * 0xff3b6b predicts 85.7 and measures 85.4.
   *
   * It exists so a palette can be SORTED rather than trusted, which is what
   * vTree's canopy needs -- see the lobe mapping there.
   */
  function shadedL(hex) {
    return 0.197 * ((hex >> 16) & 255) + 0.430 * ((hex >> 8) & 255) + 0.094 * (hex & 255);
  }
  /** A crown palette, lightest first. */
  function canopy(c) {
    return c.slice().sort(function (x, y) { return shadedL(y) - shadedL(x); });
  }

  /** Blend two authored colours, for deriving a trim from the wall it sits on. */
  function mixHex(a, b, t) {
    const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t));
    const g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t));
    const l = Math.round((a & 255) + (((b & 255) - (a & 255)) * t));
    return (r << 16) | (g << 8) | l;
  }

  /**
   * Awning colours. NOT the facade's -- see the facade note in vTerrace. An
   * awning is a shop's canvas and the reference's are the most saturated thing
   * on its street, so this is one place the reference should be followed
   * exactly. Six, drawn per bay off the row's own seeded stream.
   *
   * DIVERGENCE, stated: the reference's awnings are STRIPED, and a stripe on a
   * 93px bay at 60 units aliases to its own mean by 100 units -- the same
   * failure the JUMP chevron block was measured at. One colour per awning, with
   * the fascia one step darker, which is the part that survives.
   */
  const AWNING = [0xd8503f, 0x2f8090, 0x3f8452, 0x9a4f7f, 0xc07a2a, 0x4f5f9a];

  // ======================================================================
  //  PARAMETRIC VOCABULARY
  //
  //  Twelve cities modelled independently would be twelve times the geometry,
  //  twelve times the build time and twelve looks that do not match. So the
  //  landmarks below are all assembled from this handful of shapes -- a
  //  lattice, an arch, an arcade, a shell, a terraced row, a truss, a tree --
  //  each taking proportions and a palette. The Eiffel Tower and the Skytree
  //  are the same function with different numbers; so are the Colosseum and a
  //  Roman aqueduct, and the Opera House and Valencia's shells.
  //
  //  CONVENTIONS, and they are the same ones the existing landmarks use:
  //    * local -x faces the road. A landmark on the far shoulder is the same
  //      mesh turned a half-turn, which is why one geometry serves both sides.
  //    * local y = 0 is the ground.
  //    * anything reaching back over the carriageway does so above OVERHEAD_Y,
  //      and its supports stand at or beyond LANDMARK_IN. Nothing here may be
  //      between the lens and the next gate -- see the corridor rule at the
  //      top of the file.
  // ======================================================================

  /** Deterministic little generator, so a builder's jitter is the same daily. */
  function lcg(seed) {
    let s = (seed | 0) || 1;
    return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }

  /**
   * Compose a sub-assembly built in its own local frame into a parent parts
   * list under a yaw + translation. This is what lets an arcade bay carry
   * canted voussoirs and still be swung round onto a curve: the two rotations
   * multiply as matrices instead of being crammed into one Euler, which is not
   * the same thing and does not give the same answer.
   */
  function placeAt(parts, sub, x, y, z, ry) {
    const m = new THREE.Matrix4().makeRotationY(ry || 0);
    m.setPosition(x || 0, y || 0, z || 0);
    for (const p of sub) {
      // wave AND gloss ride through the transform. They were both dropped
      // here, silently: a sub-assembly placed by this function lost its crowd
      // wave and its cel specular and there was nothing to notice, because
      // both attributes are only emitted when some part asks for them, so
      // losing every request simply produced a geometry with no attribute and
      // no error. It cost nothing until now only because the one caller that
      // passes waving parts is groveGeo, and groves did not move until the
      // wind was added -- at which point the densest vegetation in the game
      // would have been the one vegetation that stayed still.
      parts.push({
        geo: p.geo, color: p.color, wave: p.wave, gloss: p.gloss,
        matrix: new THREE.Matrix4().multiplyMatrices(m, p.matrix),
      });
    }
  }

  /**
   * A segmental arch, drawn as stone-sized voussoirs in the XY plane.
   *
   * The single most reused shape in the file: it is the Colosseum's arcade,
   * a Roman aqueduct, the Arc de Triomphe, a Seine bridge, the Brandenburg
   * Gate's openings and a bascule tower's portal. `rx`/`ry` are the half-span
   * and the rise, so a flat segmental arch and a tall round-headed one differ
   * only in their ratio.
   */
  function vArc(parts, o) {
    const n = o.n || 7, th = o.th || 0.9, d = o.d || 3;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * i / n, a1 = Math.PI * (i + 1) / n;
      const x0 = o.cx - o.rx * Math.cos(a0), y0 = o.cy + o.ry * Math.sin(a0);
      const x1 = o.cx - o.rx * Math.cos(a1), y1 = o.cy + o.ry * Math.sin(a1);
      parts.push(bx(Math.hypot(x1 - x0, y1 - y0) + th * 0.5, th, d,
        (x0 + x1) / 2, (y0 + y1) / 2, o.cz || 0,
        (o.alt !== undefined && (i % 2)) ? o.alt : o.color,
        0, 0, Math.atan2(y1 - y0, x1 - x0)));
    }
  }

  /**
   * A tapering four-legged lattice tower: Eiffel, the Skytree, Tokyo Tower.
   *
   * The taper is the identity. An iron tower is a curve, not a cone -- the
   * legs fall away steeply at the base and are near vertical by half height --
   * so the profile is a power law rather than a straight line, and `curve` is
   * what separates the Eiffel Tower's flare from the Skytree's needle.
   */
  function vLattice(parts, o) {
    const h = o.h, N = o.seg || 9, leg = o.leg || 0.9;
    const col = o.color, col2 = o.color2 === undefined ? col : o.color2;
    const prof = function (t) { return o.top + (o.base - o.top) * Math.pow(1 - t, o.curve || 1.8); };
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const y0 = t0 * h, y1 = t1 * h;
      const r0 = prof(t0), r1 = prof(t1);
      const len = Math.hypot(y1 - y0, r0 - r1);
      const ang = Math.atan2(r0 - r1, y1 - y0);
      const th = leg * (0.45 + 0.55 * (1 - t0));
      const rm = (r0 + r1) / 2, ym = (y0 + y1) / 2;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          parts.push(bx(th, len, th, sx * rm, ym, sz * rm, i % 2 ? col : col2,
            sz * ang, 0, -sx * ang));
        }
      }
      // Belt at the top of every bay, and an X across the two faces the road
      // can see. Without the bracing a lattice tower is four sticks; with it,
      // it is a structure, and the X is what still reads at 150 units.
      const b = o.belt || 0.28;
      for (const sz of [-1, 1]) {
        parts.push(bx(r1 * 2 + th, b, b, 0, y1, sz * r1, col2));
        parts.push(bx(b, b, r1 * 2 + th, sz * r1, y1, 0, col2));
      }
      const dh = y1 - y0, dw = r0 + r1;
      const dl = Math.hypot(dh, dw), da = Math.atan2(dh, dw);
      parts.push(bx(dl, b * 0.8, b * 0.8, 0, ym, -rm, col2, 0, 0, da));
      parts.push(bx(dl, b * 0.8, b * 0.8, 0, ym, -rm, col2, 0, 0, -da));
    }
    for (const p of (o.decks || [])) {
      parts.push(bx(p.w, p.h, p.w, 0, p.y, 0, p.c === undefined ? col2 : p.c));
      if (p.rim) parts.push(bx(p.w * 1.12, p.h * 0.3, p.w * 1.12, 0, p.y + p.h * 0.5, 0, p.rim));
    }
    if (o.mast) {
      parts.push(cyl(o.mastR || 0.22, (o.mastR || 0.22) * 2.2, o.mast, 6, 0, h + o.mast / 2, 0, col2));
    }
    // The base arches. Four of them on the Eiffel Tower and they are half of
    // why it is recognisable at a glance -- the tower reads as legs standing
    // over a void, not as a pyramid.
    if (o.arch) {
      for (const sz of [-1, 1]) {
        vArc(parts, {
          cx: 0, cy: o.arch.y, cz: sz * prof(o.arch.y / h),
          rx: prof(0) * 0.92, ry: o.arch.r, n: 6, th: o.arch.th || 0.8,
          d: o.arch.d || 0.8, color: col2,
        });
      }
    }
  }

  /**
   * A tiered arcade: a wall pierced by rows of arches, optionally swung round
   * a curve. The Colosseum, an aqueduct, a viaduct and a stone quay are all
   * this function.
   *
   * `radius` bends the run away from the road so the far ends recede, which is
   * what turns a straight arcade into an amphitheatre. The bays are built flat
   * and placed under a yaw, so the arch voussoirs stay true.
   */
  function vArcade(parts, o) {
    const n = o.bays, bw = o.bayW, tiers = o.tiers || 1;
    const R = o.radius || 0;
    const stone = o.color, stone2 = o.color2 === undefined ? o.color : o.color2;
    const rnd = lcg(o.seed || 17);
    for (let i = 0; i < n; i++) {
      const u = (i - (n - 1) / 2);
      const a = R ? (u * bw) / R : 0;
      const px = R ? R * (1 - Math.cos(a)) : 0;
      const pz = R ? R * Math.sin(a) : u * bw;
      // How many tiers this bay still stands to. A ruin is identified by its
      // BROKEN line as much as by its arches, so the height steps down away
      // from the centre when `ruin` is set.
      const keep = o.ruin
        ? Math.max(o.ruin, tiers - Math.floor(Math.abs(u) / Math.max(1, n / 5)))
        : tiers;
      const sub = [];
      for (let t = 0; t < keep; t++) {
        const y0 = o.y0 + t * o.tierH;
        sub.push(bx(o.d, o.tierH, bw, 0, y0 + o.tierH / 2, 0, t % 2 ? stone2 : stone));
        if (t < (o.openTiers === undefined ? tiers : o.openTiers)) {
          // The opening: a dark void behind a ring of voussoirs. The void is
          // what makes an arcade read as pierced rather than as a decorated
          // wall, and at distance it is the only part that survives.
          sub.push(bx(o.d * 0.5, o.tierH * 0.62, bw * 0.62, -o.d * 0.26,
            y0 + o.tierH * 0.42, 0, o.voidC || 0x4a4058));
          vArc(sub, {
            cx: 0, cy: y0 + o.tierH * 0.44, cz: 0,
            rx: bw * 0.34, ry: o.tierH * 0.26, n: 5, th: o.tierH * 0.12,
            d: o.d * 1.02, color: stone2,
          });
        }
        sub.push(bx(o.d * 1.06, o.tierH * 0.1, bw, 0, y0 + o.tierH, 0, stone2));
      }
      if (keep >= tiers && o.attic) {
        sub.push(bx(o.d, o.attic, bw, 0, o.y0 + tiers * o.tierH + o.attic / 2, 0, stone));
      }
      // Local -x is the road, so the bay is pushed out by its own depth and
      // the facade lands where the caller asked for it.
      placeAt(parts, sub, px - o.d / 2 + (o.inset || 0) + rnd() * 0.06, 0, pz, -a);
    }
  }

  /**
   * A row of terraced houses -- the STREET WALL, and the piece of geometry
   * doing the most identification work in the whole feature.
   *
   * A landmark is in frame for a few seconds every minute or two. The street
   * is in frame permanently, one row-length behind the crowd barrier, and it
   * is what the eye actually reads a city off: London's stucco parapets,
   * Amsterdam's stepped gables leaning over a canal, Boston's bow-fronted
   * brownstones, Paris's mansards, Bo-Kaap's flat saturated colour. All of
   * them are this one function with a different table.
   */
  function vTerrace(parts, t, seed) {
    const rnd = lcg(seed);
    const n = t.bays || 5, bw = t.bay, d = t.depth;
    // The facade plane. The row is built about local x = 0 with the fronts
    // toward -x, so the caller only has to know how deep it is.
    const fx = -d / 2;
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * bw;
      const h = t.h[0] + rnd() * (t.h[1] - t.h[0]);
      const col = t.colors[Math.floor(rnd() * t.colors.length)];
      const lean = t.lean ? (rnd() - 0.5) * 0.035 : 0;
      /**
       * THE BAYS STEP BACK, and this is the only depth device left in section 7
       * that survives the distance the street wall is actually read at.
       *
       * Everything else on this facade -- the awning, the shopfront band, the
       * window surrounds, the hanging sign, the balcony -- projects toward the
       * road on a plane that every bay in the row shares. So the row is one
       * unbroken plane thirty units long, and at any distance past the nearest
       * house the eye reads it as an extrusion with a pattern on it rather than
       * as a terrace of separate buildings. It is the same fault the parapet
       * comment below already names about roofs, one level up.
       *
       * A step is FREE -- the bay's side faces already exist and are simply
       * uncovered -- and it is the one thing here whose read GROWS with the
       * grazing angle instead of shrinking with distance. Because the row runs
       * along z and the camera looks along z, the uncovered face points almost
       * straight at the lens: a 0.45-unit step is a hard vertical value edge
       * the full height of the house, 9px wide at 30 units, 4.5px at 60 and
       * still 2px at 120, against a window surround that is 1-2px at 60 and
       * gone by 120. Nothing else available at this cost is legible that far.
       *
       * It only ever steps BACK. The front plane is 12.2 and the awning fascia
       * already overhangs it to 11.33 against a pavement edge of 11.75, so
       * pushing a bay toward the road would spend a margin that is doing real
       * work; receding costs nothing and reads identically.
       */
      const step = rnd() < 0.5 ? 0.30 + rnd() * 0.32 : 0;
      const sub = [];
      sub.push(bx(d, h, bw * 0.98, 0, h / 2, 0, col));
      /**
       * THE GROUND FLOOR IS A SHOP, not a stone plinth.
       *
       * `tgr-shopfronts`, measured: its ground floor is a pale cream band with
       * FULL-BAY BLUE GLAZING in it, and it is the single largest mass on the
       * facade. Ours was 1.5 units of solid trim with a door in it. A stall
       * riser, a 1.42-tall glazing band and the string course over it is the
       * same three elements the reference has, and it gives the street a light
       * band at eye level that the crowd barrier reads against.
       *
       * The glazing is derived from the setting's own window colour rather than
       * shared, so Chicago's shopfronts stay cold and Rome's stay warm.
       */
      const shop = mixHex(t.win, 0xffffff, 0.62);
      sub.push(bx(d * 1.01, 0.40, bw * 0.99, 0, 0.20, 0, t.trim));      // stall riser
      sub.push(bx(d * 1.00, 1.42, bw * 0.96, 0, 1.11, 0, shop));        // shopfront glazing
      sub.push(bx(d * 1.02, 0.22, bw, 0, 1.93, 0, t.trim));             // string course
      /**
       * THE AWNING. Two boxes: a canopy sloping out from the facade at the top
       * of the ground floor, and a fascia hanging off its front edge.
       *
       * It is the strongest single "this is a shop, not a wall" cue the
       * reference has; it sits at 2 world units, which is exactly the band the
       * camera looks through; and because it is a horizontal projecting plane it
       * catches a DIFFERENT toon band from the wall behind it -- so it reads as
       * depth rather than as paint, which is why it earns its cost in this
       * renderer and not only in the reference's.
       */
      const aw = AWNING[Math.floor(rnd() * AWNING.length)];
      sub.push(bx(0.92, 0.10, bw * 0.88, fx - 0.40, 2.20, 0, aw, 0, 0, 0.22));
      sub.push(bx(0.10, 0.34, bw * 0.88, fx - 0.82, 1.94, 0, mixHex(aw, 0, 0.30)));
      /**
       * A HANGING SIGN, one bay in three. A bracket and a board hung
       * PERPENDICULAR to the facade at awning height.
       *
       * This is the pizza-slice device in `tgr-shopfronts` and it is the only
       * item in this section that buys DEPTH rather than detail: because the
       * board is perpendicular, it crosses in front of the next building along
       * and gives the street wall a parallax it does not otherwise have.
       */
      if (i % 3 === 1) {
        sub.push(bx(0.62, 0.08, 0.08, fx - 0.31, 3.40, bw * 0.24, 0x3a3550));
        sub.push(bx(0.66, 0.78, 0.07, fx - 0.58, 3.00, bw * 0.24,
          AWNING[Math.floor(rnd() * AWNING.length)]));
      }
      /**
       * Windows, proud of the facade so they catch a different band of the toon
       * ramp than the wall does -- and now in a SURROUND of a different colour,
       * which is what every window in the reference is: a coloured glass panel
       * inside a frame that does not match it (blue glass in a pink frame on the
       * yellow facade, blue in white on the green).
       *
       * The surround is the trim where the trim is far enough from the wall in
       * value to be seen against it, and a lightened wall where it is not --
       * measured with shadedL rather than assumed, because a trim that reads on
       * London stucco is invisible on Chicago limestone. It is 0.07 proud on
       * every side, which at 60 units is 1-2px: exactly the size at which a hard
       * value edge still separates two masses. At 120 units it stops resolving
       * and merges into the window's mean, which is the correct failure mode --
       * the window gets slightly lighter with distance and nothing else happens.
       */
      const surround = Math.abs(shadedL(t.trim) - shadedL(col)) > 22
        ? t.trim : mixHex(col, 0xffffff, 0.38);
      const rows = t.rows || 4;
      for (let r = 0; r < rows; r++) {
        const wy = 2.6 + r * ((h - 3.4) / Math.max(1, rows));
        if (wy > h - 1.0) break;
        for (const sz of [-1, 1]) {
          sub.push(bx(0.18, 1.29, bw * 0.24 + 0.14, fx - 0.06, wy, sz * bw * 0.21, surround));
          sub.push(bx(0.22, 1.15, bw * 0.24, fx - 0.08, wy, sz * bw * 0.21, t.win));
          sub.push(bx(0.30, 0.16, bw * 0.30, fx - 0.10, wy + 0.68, sz * bw * 0.21, t.trim));
        }
        if (t.balcony && r < t.balcony) {
          sub.push(bx(0.34, 0.10, bw * 0.86, fx - 0.20, wy - 0.62, 0, t.trim));
          for (let k = 0; k < 7; k++) {
            sub.push(bx(0.07, 0.42, 0.07, fx - 0.24,
              wy - 0.40, -bw * 0.40 + k * (bw * 0.80 / 6), 0x3a3550));
          }
          sub.push(bx(0.30, 0.08, bw * 0.86, fx - 0.22, wy - 0.18, 0, 0x3a3550));
        }
      }
      // Door and stoop. It stands proud of the shopfront glazing, which is what
      // a shop door does, and it is what keeps the glazing band from reading as
      // one unbroken ribbon down a thirty-unit row.
      sub.push(bx(0.24, 1.7, bw * 0.26, fx - 0.12, 0.85, 0, 0x4a3a56));
      if (t.stoop) {
        for (let s = 0; s < 3; s++) {
          sub.push(bx(0.9 - s * 0.22, 0.20, bw * 0.36, fx - 0.5 + s * 0.22, 0.10 + s * 0.20, 0, t.trim));
        }
      }
      if (t.bow) {
        // A bow front: the half-round bay window that is Back Bay's signature.
        sub.push(cyl(bw * 0.30, bw * 0.30, h - 2.4, 8, fx + 0.1, (h - 2.4) / 2 + 1.6, 0, col));
        sub.push(cyl(bw * 0.33, bw * 0.33, 0.24, 8, fx + 0.1, h - 0.9, 0, t.trim));
      }
      if (t.fireEscape) {
        for (let r = 0; r < 3; r++) {
          const fy = 3.4 + r * 2.5;
          if (fy > h - 1.2) break;
          sub.push(bx(0.7, 0.10, bw * 0.7, fx - 0.42, fy, 0, 0x2f3550));
          sub.push(bx(0.08, 0.9, 0.08, fx - 0.74, fy + 0.45, bw * 0.3, 0x2f3550));
          sub.push(bx(0.9, 0.08, 0.08, fx - 0.6, fy + 1.3, -bw * 0.2, 0x2f3550, 0, 0, 0.6));
        }
      }
      if (t.neon) {
        // A stack of signboards hanging off the facade, which is what a Tokyo
        // street front is: the building is a rack for signage.
        const glow = [0xff4d7a, 0x37d6ff, 0xffe45e, 0x62f0a8, 0xff9ad5];
        for (let s = 0; s < 3; s++) {
          const sy = 3.0 + s * 2.4;
          if (sy > h - 1.0) break;
          sub.push(bx(0.7, 1.7, 0.30, fx - 0.5, sy, bw * (rnd() > 0.5 ? 0.30 : -0.30),
            glow[Math.floor(rnd() * glow.length)]));
        }
        sub.push(bx(0.5, 0.5, bw * 0.9, fx - 0.4, 2.0, 0, glow[Math.floor(rnd() * glow.length)]));
      }
      // ---- the roof, which is most of the silhouette ----
      const rc = t.roofColor;
      if (t.roof === 'pitch' || t.roof === 'tile') {
        const rh = t.roof === 'tile' ? 1.5 : 1.9;
        for (const sx of [-1, 1]) {
          sub.push(bx(d * 0.60, 0.28, bw, sx * d * 0.26, h + rh * 0.5, 0, rc, 0, 0, -sx * 0.62));
        }
        sub.push(bx(0.5, 0.30, bw, 0, h + rh, 0, rc));
        if (t.roof === 'tile') sub.push(bx(d * 1.08, 0.24, bw, 0, h + 0.06, 0, rc));
      } else if (t.roof === 'mansard') {
        // Steep slated lower slope, near-flat above: the Paris and Berlin
        // roofline, and the reason those skylines read as one grey mass with
        // dormers rather than as a row of boxes.
        for (const sx of [-1, 1]) {
          sub.push(bx(d * 0.34, 0.34, bw, sx * d * 0.36, h + 1.1, 0, rc, 0, 0, -sx * 0.95));
        }
        sub.push(bx(d * 0.62, 0.34, bw, 0, h + 2.0, 0, rc));
        sub.push(bx(d * 1.06, 0.26, bw * 1.01, 0, h + 0.1, 0, t.trim));
        sub.push(bx(0.6, 0.9, bw * 0.24, -d * 0.30, h + 1.5, 0, rc));
        sub.push(bx(0.24, 0.6, bw * 0.18, -d * 0.42, h + 1.5, 0, t.win));
      } else if (t.roof === 'stepgable') {
        // Amsterdam. The gable is on the FACADE, stepping up to a point above
        // the roofline, and a canal house is nothing else.
        const steps = 4;
        for (let s = 0; s < steps; s++) {
          const w = bw * (0.98 - s * 0.20);
          sub.push(bx(d * 0.34, 0.62, w, fx + d * 0.17, h + 0.31 + s * 0.62, 0, col));
          sub.push(bx(d * 0.38, 0.16, w * 1.02, fx + d * 0.17, h + 0.62 + s * 0.62, 0, t.trim));
        }
        sub.push(bx(d * 0.34, 0.5, bw * 0.24, fx + d * 0.17, h + 0.31 + steps * 0.62, 0, t.trim));
        for (const sx of [-1, 1]) {
          sub.push(bx(d * 0.42, 0.26, bw, sx * d * 0.24, h + 0.9, 0, rc, 0, 0, -sx * 0.8));
        }
        if (t.hoist) {
          sub.push(bx(0.9, 0.20, 0.20, fx - 0.35, h + 0.4 + steps * 0.55, 0, 0x2f2a3a));
          sub.push(bx(0.16, 0.5, 0.16, fx - 0.72, h + 0.1 + steps * 0.55, 0, 0x2f2a3a));
        }
      } else {
        // Flat, with a parapet. Two heights of parapet, because a row of
        // identical cornices reads as extrusion rather than as buildings.
        const ph = t.roof === 'parapet' ? 0.95 : 0.55;
        sub.push(bx(d * 1.04, 0.30, bw, 0, h + 0.15, 0, t.trim));
        sub.push(bx(d * 1.02, ph, bw * 0.99, 0, h + 0.3 + ph / 2, 0, rc));
        sub.push(bx(d * 1.06, 0.18, bw, 0, h + 0.3 + ph, 0, t.trim));
      }
      if (t.tank) {
        // The New York roof water tower: a cedar barrel on a steel frame, and
        // the single most portable piece of that city's skyline.
        const ty = h + 1.4;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            parts.push(bx(0.14, 2.2, 0.14, sx * 0.55, ty + 1.1, z + sz * 0.55, 0x4a3a2e));
          }
        }
        parts.push(cyl(1.0, 1.15, 2.4, 8, 0, ty + 3.4, z, 0x8a5a3c));
        parts.push(cyl(1.06, 1.06, 0.2, 8, 0, ty + 2.5, z, 0x5f4028));
        parts.push(cone(1.15, 1.1, 8, 0, ty + 5.1, z, 0x5f4028));
      }
      if (t.chimney) {
        for (let c = 0; c < t.chimney; c++) {
          parts.push(bx(0.7, 1.5 + rnd() * 0.9, 0.6,
            (rnd() - 0.5) * d * 0.5, h + 1.4, z + (rnd() - 0.5) * bw * 0.6, t.roofColor));
        }
      }
      placeAt(parts, sub, step, 0, z, lean);
    }
  }

  /**
   * A modern block: stacked setbacks, an optional glass banding, a crown.
   * Chicago's black tubes, the Empire State's wedding cake, a Tokyo office --
   * the same stack with different steps.
   */
  function vTower(parts, o) {
    const rnd = lcg(o.seed || 5);
    const steps = o.steps || 3;
    let w = o.w, d = o.d, y = 0;
    for (let s = 0; s < steps; s++) {
      const h = o.h * (o.split ? o.split[s] : (1 / steps));
      parts.push(bx(d, h, w, 0, y + h / 2, 0, o.color));
      // Spandrel bands. On a glass tower they are the whole read: a dark slab
      // with light horizontals is a curtain wall, a dark slab without them is
      // a monolith.
      const bands = Math.max(2, Math.round(h / 2.2));
      for (let b = 1; b < bands; b++) {
        parts.push(bx(d * 1.01, o.glass ? 0.34 : 0.20, w * 1.01, 0,
          y + h * b / bands, 0, o.glass ? o.band : o.color2));
      }
      parts.push(bx(d * 1.05, 0.3, w * 1.05, 0, y + h, 0, o.color2));
      y += h;
      w *= (o.taper || 0.74); d *= (o.taper || 0.74);
    }
    if (o.crown === 'stepped') {
      for (let s = 0; s < 4; s++) {
        parts.push(bx(d * (1 - s * 0.18), 1.5, w * (1 - s * 0.18), 0, y + 0.75 + s * 1.5, 0, o.color));
      }
      y += 6;
      parts.push(cyl(0.5, 1.1, 3.2, 8, 0, y + 1.6, 0, o.color2));
      parts.push(cyl(0.10, 0.24, 7.0, 6, 0, y + 6.6, 0, o.color2));
    } else if (o.crown === 'antenna') {
      for (const sx of [-1, 1]) {
        parts.push(cyl(0.10, 0.22, o.h * 0.30, 6, sx * d * 0.22, y + o.h * 0.15, 0, o.color2));
      }
    } else if (o.crown === 'pyramid') {
      parts.push(cone(Math.max(w, d) * 0.72, o.h * 0.16, 4, 0, y + o.h * 0.08, 0, o.color2));
    }
    if (o.lit) {
      for (let i = 0; i < 4; i++) {
        parts.push(bx(0.2, 0.2, 0.2, -d * 0.5, o.h * (0.3 + rnd() * 0.6), (rnd() - 0.5) * w, 0xffe45e));
      }
    }
  }

  /**
   * A shell -- a quarter-sphere with a flat back, closed by a pair of half
   * discs so it is never seen through.
   *
   * The Sydney Opera House and Valencia's Palau are both this, leaned and
   * nested. It is a quarter sphere rather than a cone because the leading edge
   * has to be a CURVE: a cone gives a straight edge and reads as a tent.
   */
  function vShell(parts, o) {
    const r = o.r, col = o.color;
    const g = new THREE.SphereGeometry(r, o.seg || 12, o.seg || 9, 0, Math.PI, 0, Math.PI / 2);
    const sub = [part(g, col, 0, 0, 0, 0, 0, 0)];
    // The flat back, both ways round, so the shell is solid from any angle the
    // player can reach without either face being culled.
    const cap = new THREE.CircleGeometry(r, o.seg || 12, 0, Math.PI);
    sub.push(part(cap, o.back === undefined ? col : o.back, 0, 0, 0.001, 0, 0, 0));
    sub.push(part(cap, o.back === undefined ? col : o.back, 0, 0, -0.001, 0, Math.PI, 0));
    const m = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(o.tilt || 0, o.yaw || 0, o.roll || 0));
    m.setPosition(o.x || 0, o.y || 0, o.z || 0);
    for (const p of sub) {
      parts.push({ geo: p.geo, color: p.color, matrix: new THREE.Matrix4().multiplyMatrices(m, p.matrix) });
    }
  }

  /**
   * A truss span: parallel chords with a zigzag web. The Harbour Bridge's
   * arch, Chicago's elevated deck and a girder bridge are all this, straight
   * or bent to a chord.
   */
  function vTruss(parts, o) {
    const n = o.n || 10, col = o.color, col2 = o.color2 === undefined ? col : o.color2;
    const y = o.curve
      ? function (t) { return o.y0 + o.rise * Math.sin(Math.PI * t); }
      : function () { return o.y0; };
    const th = o.th || 0.34;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const x0 = o.x0 + (o.x1 - o.x0) * t0, x1 = o.x0 + (o.x1 - o.x0) * t1;
      const y0 = y(t0), y1 = y(t1);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const a = Math.atan2(y1 - y0, x1 - x0);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      for (const sz of [-1, 1]) {
        parts.push(bx(len + th, th, th, mx, my, o.z + sz * o.w, col, 0, 0, a));
        parts.push(bx(len + th, th, th, mx, my - o.depth, o.z + sz * o.w, col, 0, 0, a));
        // Web. One diagonal per bay plus the vertical is enough: at the
        // distance a bridge is seen the web is a texture, not a structure.
        const dl = Math.hypot(len, o.depth);
        parts.push(bx(dl, th * 0.7, th * 0.7, mx, my - o.depth / 2, o.z + sz * o.w, col2,
          0, 0, a - Math.atan2(o.depth, len)));
        parts.push(bx(th * 0.8, o.depth, th * 0.8, x1, my - o.depth / 2, o.z + sz * o.w, col2));
      }
      parts.push(bx(th * 0.7, th * 0.7, o.w * 2, mx, my, o.z, col2));
      parts.push(bx(th * 0.7, th * 0.7, o.w * 2, mx, my - o.depth, o.z, col2));
    }
  }

  /**
   * A tree, by profile. One function, seven silhouettes.
   *
   * ============ THE LOBES WERE MAPPED TO VALUE BACKWARDS ============
   *
   * Measured against `tgr-boulevard`'s nearest foliage and `tgr-taxi-street`
   * as the control:
   *
   *                       reference          ours (authored)
   *   lit crown        (174,222,54) L 200-209   0x62c470 L 169.1
   *   mid              (126,174,54) L 155-188   0x4faf5f L 148.9
   *   shaded underside (102,138,42) L 112-123   0x3f9a52 L 129.4
   *   lit / shaded          1.70                     1.31
   *   saturation          0.67-0.76                0.50-0.59
   *   R / G (hue)         0.75-0.78                0.41-0.50
   *   bare trunk / height   23-36%                    32%
   *   lobes per crown        3-5                       4
   *
   * Three of those were already right -- lobe count, lobe size spread, bare
   * trunk fraction -- and three were wrong, one of them badly.
   *
   *   THE ORDER. This function used to hand `c[0]`, which is the DARKEST
   *   colour in every palette, to the biggest highest-volume sphere in the
   *   middle of the crown, and `c[c.length - 1]`, the lightest, to a LOW side
   *   lobe. So on a three-colour palette the darkest mass sat in the middle
   *   and the lightest sat underneath it, which is the opposite of a canopy.
   *   The palettes are now SORTED by rendered luminance and assigned by the
   *   lobe's height: lightest at the crown, mid through the body, darkest
   *   under it. Free, and it is the largest of the three.
   *
   *   THE LADDER was 1.31 lit-to-shaded against the reference's 1.70. Every
   *   palette in SETTING_LOOK now stands in roughly 1.00 : 1.31 : 1.71.
   *
   *   THE HUE was a true green at R = 0.41-0.50 of G where the reference is a
   *   chartreuse at 0.75-0.78. In a renderer whose shaded luminance is
   *   0.197R + 0.430G + 0.094B, lifting red at constant green is free
   *   luminance and free warmth, and it is the difference between foliage that
   *   reads as a lit mass and foliage that reads as a dark hole beside a
   *   bright road.
   *
   * NOT COPIED: the reference's crowns are smooth-shaded with a soft gradient
   * across each lobe and a translucent edge where the sun comes through.
   * Lobes do not buy that and are not meant to -- lobes buy OUTLINE, which is
   * the part that survives a banded ramp. The gradient's transferable
   * substitute is the 1.70 ladder, and the height ordering is what makes the
   * ladder read as a canopy rather than as noise.
   */
  function vTree(parts, o, k) {
    const c = o.colors, s = (o.h || 1) * (k || 1);
    const trunk = o.trunk === undefined ? 0xb0662e : o.trunk;
    const kind = o.kind;
    // Lightest first, so band(0) is the crown and band(2) the underside. A
    // two-colour palette collapses the bottom two, which is correct: it has one
    // fewer step to spend and the step it keeps should be at the top.
    const v = canopy(c);
    const band = function (i) { return v[Math.min(i, v.length - 1)]; };
    /**
     * WHAT MOVES IN A TREE IS THE CANOPY, AND IT MOVES AS A CANTILEVER.
     *
     * Every leaf-bearing part goes through here and every woody part does not,
     * so trunks, stems, forks and branches stay rigid while the crowns they
     * carry sway. That split is the whole illusion: a tree that translates as
     * one piece reads as a sprite being slid, and it is exactly what a
     * per-object sine would have produced.
     *
     * Amplitude is the part's own height over the tallest thing vTree builds,
     * which is a palm at 7.4. A crown lobe six units up therefore moves four
     * times as far as one at a metre and a half, which is what a springy stem
     * does, and it falls out of the geometry rather than being tuned per
     * species: the Roman pine's parasol at 8.0 is near full amplitude, the
     * fynbos scrub at 0.5 barely stirs, and both are right for what they are
     * without either being a special case. Scale cancels, so a 0.75x sapling
     * and a 1.45x mature tree sway by the same FRACTION of their own size.
     *
     * Phase carries the lobe's own local position on top of the world-space
     * term the shader adds, so lobes within one crown shear against each other
     * instead of the crown moving as a rigid ball.
     */
    const HREF = 7.4 * s;
    const lf = function (p, x, y) {
      return wv(p, y * 0.9 + x * 1.7, Math.min(1, Math.max(0, y / HREF)));
    };
    if (kind === 'palm') {
      // A palm is a bare leaning stem and a burst at the top, and the LEAN is
      // what tells it from a lamp post.
      const lean = 0.12;
      for (let i = 0; i < 5; i++) {
        parts.push(cyl(0.18 * s, 0.24 * s, 1.5 * s, 6, i * 0.28 * s, (0.75 + i * 1.4) * s, 0,
          i % 2 ? trunk : 0xa07a52, 0, 0, -lean));
      }
      const tx = 1.35 * s, ty = 7.4 * s;
      for (let f = 0; f < 7; f++) {
        const a = (f / 7) * Math.PI * 2;
        parts.push(lf(bx(3.4 * s, 0.14 * s, 0.9 * s,
          tx + Math.cos(a) * 1.5 * s, ty - 0.35 * s, Math.sin(a) * 1.5 * s,
          band(f % 2), 0, a, -0.30), Math.cos(a) * 1.5 * s, ty - 0.35 * s));
      }
      // The nut cluster is the one crown part that is not a frond, and it is
      // tagged anyway: it is carried BY the fronds, so a still cluster inside
      // a moving burst reads as a hole in the tree.
      parts.push(lf(sph(0.5 * s, 6, tx, ty, 0, 0x6a4a2c), 0, ty));
    } else if (kind === 'umbrella') {
      // The Roman stone pine: a long bare trunk and a flat wide canopy sitting
      // on top of it like a parasol.
      parts.push(cyl(0.28 * s, 0.5 * s, 6.4 * s, 6, 0, 3.2 * s, 0, trunk));
      parts.push(bx(0.4 * s, 2.4 * s, 0.4 * s, -0.8 * s, 6.4 * s, 0, trunk, 0, 0, 0.5));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 6.283;
        parts.push(lf(sph(1.9 * s, 7, Math.cos(a) * 1.9 * s, 7.4 * s, Math.sin(a) * 1.9 * s,
          band(1 + (i & 1))), Math.cos(a) * 1.9 * s, 7.4 * s));
      }
      // The parasol's own top is the lit surface; the ring under its rim is not.
      parts.push(lf(sph(2.3 * s, 7, 0, 8.0 * s, 0, band(0)), 0, 8.0 * s));
    } else if (kind === 'columnar') {
      parts.push(cyl(0.16 * s, 0.26 * s, 1.2 * s, 6, 0, 0.6 * s, 0, trunk));
      for (let i = 0; i < 4; i++) {
        // A columnar crown is a stack, so value tracks height straight up it.
        parts.push(lf(cone((1.05 - i * 0.16) * s, 2.2 * s, 7, 0, (1.9 + i * 1.35) * s, 0,
          band(3 - i)), 0, (1.9 + i * 1.35) * s));
      }
    } else if (kind === 'scrub') {
      // Fynbos: low, dense, many-crowned and never a single trunk.
      const r = lcg(31);
      for (let i = 0; i < 6; i++) {
        // Drawn in the ORDER THE SEEDED STREAM ALREADY HAD -- radius, x, y, z.
        // Hoisting x and y out to name them for lf() reorders the pulls and
        // rebuilds every fynbos bush in the game into a different shape, which
        // is a silent art change smuggled in by a motion commit.
        const rad = (0.7 + r() * 0.7) * s;
        const cx = (r() - 0.5) * 4 * s;
        const cy = (0.5 + r() * 0.5) * s;
        parts.push(lf(sph(rad, 6, cx, cy, (r() - 0.5) * 4 * s, band(i % v.length)), cx, cy));
      }
    } else if (kind === 'pollard') {
      // The Paris plane tree: a pale stubby trunk under a tight clipped ball.
      parts.push(cyl(0.30 * s, 0.42 * s, 3.0 * s, 6, 0, 1.5 * s, 0, trunk));
      for (const a of [-0.6, 0.6]) {
        parts.push(bx(0.24 * s, 1.4 * s, 0.24 * s, 0, 3.4 * s, 0, trunk, 0, 0, a));
      }
      parts.push(lf(sph(2.0 * s, 8, 0, 5.0 * s, 0, band(0)), 0, 5.0 * s));
      parts.push(lf(sph(1.5 * s, 7, -0.9 * s, 4.3 * s, 0.6 * s, band(1)), -0.9 * s, 4.3 * s));
      parts.push(lf(sph(1.4 * s, 7, 0.9 * s, 4.4 * s, -0.7 * s, band(2)), 0.9 * s, 4.4 * s));
    } else if (kind === 'round') {
      // A FORKED TRUNK. Every trunk in `tgr-taxi-street` and `tgr-boulevard`
      // splits into two or three branches before it enters the crown, and that
      // is what stops it reading as a post with a ball on it. Two leaning
      // 6-segment cylinders off the top of the stem, 24 triangles each.
      parts.push(cyl(0.20 * s, 0.34 * s, 2.6 * s, 6, 0, 1.3 * s, 0, trunk));
      parts.push(cyl(0.12 * s, 0.19 * s, 1.7 * s, 6, -0.30 * s, 3.30 * s, 0.10 * s, trunk, 0, 0, 0.30));
      parts.push(cyl(0.11 * s, 0.18 * s, 1.5 * s, 6, 0.30 * s, 3.20 * s, -0.12 * s, trunk, 0, 0, -0.34));
      // SIX LOBES, not four -- 2.0 / 1.6 / 1.5 / 1.4 / 1.2 / 0.9, a 2.2:1
      // spread against the reference's visibly clustered 3-5 per crown. The two
      // extra go LOW AND OUTBOARD, which is the only place a lobe earns
      // anything: it breaks the crown's outline against the sky.
      //
      // The two smallest are 6-segment rather than 7. At 60 units a 0.9-unit
      // lobe is nine pixels across and the segment count does not resolve; the
      // pair costs 72 triangles that way instead of 112, which is a real saving
      // for no read, and the crown is 320 triangles against 248.
      parts.push(lf(sph(2.0 * s, 8, 0, 4.40 * s, 0, band(1)), 0, 4.40 * s));
      parts.push(lf(sph(1.6 * s, 7, -1.45 * s, 4.05 * s, 0.55 * s, band(1)), -1.45 * s, 4.05 * s));
      parts.push(lf(sph(1.5 * s, 7, 1.35 * s, 4.25 * s, -0.65 * s, band(1)), 1.35 * s, 4.25 * s));
      parts.push(lf(sph(1.4 * s, 7, -1.05 * s, 3.15 * s, -0.85 * s, band(2)), -1.05 * s, 3.15 * s));
      parts.push(lf(sph(1.2 * s, 6, 0.20 * s, 5.70 * s, 0.30 * s, band(0)), 0.20 * s, 5.70 * s));
      parts.push(lf(sph(0.9 * s, 6, 1.55 * s, 3.05 * s, 0.75 * s, band(2)), 1.55 * s, 3.05 * s));
    } else {
      parts.push(cyl(0.17 * s, 0.26 * s, 1.3 * s, 6, 0, 0.65 * s, 0, trunk));
      parts.push(lf(cone(1.30 * s, 1.7 * s, 8, 0, 2.0 * s, 0, band(2)), 0, 2.0 * s));
      parts.push(lf(cone(1.05 * s, 1.5 * s, 8, 0, 2.9 * s, 0, band(1)), 0, 2.9 * s));
      parts.push(lf(cone(0.75 * s, 1.2 * s, 8, 0, 3.7 * s, 0, band(0)), 0, 3.7 * s));
    }
  }

  // ======================================================================
  //  THE LANDMARKS
  //
  //  One entry per silhouette, each a short call into the vocabulary above.
  //  A builder takes the setting's own palette so a shared shape still comes
  //  out the right colour, and returns a merged geometry: one draw call for
  //  the whole thing, exactly like the generic landmarks already here.
  //
  //  Geometries are built LAZILY, and only for the three or four settings the
  //  day actually drew. Twelve cities' worth of landmarks built eagerly would
  //  be most of a second of start-up for geometry nine tenths of which is
  //  never shown.
  //
  //  REACH. Every builder's road-facing extent is noted where it is not
  //  obvious. A mark placed at x is clamped to LANDMARK_IN (11.75), so a
  //  builder reaching -9 in local x must be given x >= 20.5 in the setting
  //  table or it would stand on the pavement.
  // ======================================================================

  /** A suspension span, straddling the deck: the generic bridge. */
  function mkSuspension(c1, c2, cable) {
    const parts = [];
    for (const sx of [-1, 1]) {
      const x = sx * 9.6;
      parts.push(bx(2.4, 30, 2.4, x, 12.5, 0, c1));
      parts.push(bx(2.9, 1.0, 2.9, x, 27.0, 0, c2));
      parts.push(bx(2.9, 1.0, 2.9, x, 16.0, 0, c2));
      parts.push(bx(3.1, 1.2, 3.1, x, -1.0, 0, 0x3a4570));
      for (let i = 0; i < 8; i++) {
        const z0 = i * 13, z1 = (i + 1) * 13;
        const y0 = 26 - Math.pow(i / 8, 1.7) * 22;
        const y1 = 26 - Math.pow((i + 1) / 8, 1.7) * 22;
        const len = Math.hypot(z1 - z0, y1 - y0);
        const ang = Math.atan2(y1 - y0, z1 - z0);
        for (const sz of [-1, 1]) {
          parts.push(bx(0.34, 0.34, len, x, (y0 + y1) / 2, sz * (z0 + z1) / 2, cable, -sz * ang));
        }
      }
    }
    parts.push(bx(21, 1.6, 2.0, 0, 26.4, 0, c1));
    parts.push(bx(21, 1.0, 1.6, 0, 21.0, 0, c2));
    return merge(parts);
  }

  const MARKS = {

    // ---- BOSTON --------------------------------------------------------
    /** The Citgo sign: a lit triangle on a frame on a Kenmore Square roof. */
    citgo: function () {
      const parts = [];
      parts.push(bx(6.0, 15.0, 9.0, 0, 7.5, 0, 0x6f5a52));
      parts.push(bx(6.4, 0.8, 9.4, 0, 15.2, 0, 0x4a3f3a));
      for (let i = 0; i < 3; i++) {
        for (const sz of [-1, 1]) {
          parts.push(bx(0.3, 2.0, 2.4, -3.05, 4.0 + i * 4.0, sz * 2.4, 0x3a4a72));
        }
      }
      // The sign itself: white ground, a red inverted triangle, a blue border.
      for (const sx of [-1, 1]) {
        parts.push(bx(0.5, 12.0, 0.5, sx * 0.0 - 1.4, 21.5, sx * 4.6, 0x3a3550));
      }
      parts.push(bx(0.6, 9.4, 9.4, -1.6, 21.0, 0, 0xf4f6ff));
      parts.push(bx(0.24, 8.4, 8.4, -1.95, 21.0, 0, 0x2f5fd0));
      parts.push(bx(0.30, 7.0, 7.0, -2.05, 21.0, 0, 0xfffdf5));
      for (let i = 0; i < 5; i++) {
        const w = 6.2 * (1 - i / 5);
        parts.push(bx(0.34, 1.24, w, -2.15, 23.6 - i * 1.24, 0, 0xef3a4a));
      }
      return merge(parts);
    },

    /** A white New England steeple. Reach -2.4. */
    spireWhite: function () {
      const parts = [];
      const W = 0xfffdf5, W2 = 0xe0dcd0, T = 0x3a4a5e;
      parts.push(bx(9.0, 7.0, 14.0, 2.0, 3.5, 0, W));
      parts.push(bx(9.6, 0.6, 14.6, 2.0, 7.2, 0, W2));
      for (const sx of [-1, 1]) {
        parts.push(bx(5.0, 2.6, 14.0, 2.0, 8.6, 0, W2, 0, 0, -sx * 0.7));
      }
      parts.push(bx(5.2, 11.0, 5.2, -2.0, 5.5, 0, W));
      parts.push(bx(5.8, 0.7, 5.8, -2.0, 11.2, 0, W2));
      parts.push(bx(4.2, 5.0, 4.2, -2.0, 14.0, 0, W));
      for (const sz of [-1, 1]) parts.push(bx(0.3, 3.0, 1.6, -4.15, 14.0, sz * 1.0, T));
      parts.push(bx(4.8, 0.6, 4.8, -2.0, 16.8, 0, W2));
      parts.push(bx(3.2, 3.6, 3.2, -2.0, 18.9, 0, W));
      parts.push(cone(2.4, 12.0, 4, -2.0, 26.8, 0, W2));
      parts.push(bx(0.22, 2.0, 0.22, -2.0, 33.6, 0, 0xffe45e));
      return merge(parts);
    },

    // ---- LONDON --------------------------------------------------------
    /** St Paul's: a drum, a dome, a lantern and a west tower. Reach -5.0. */
    stPauls: function () {
      const parts = [];
      const S = 0xe8e0cc, S2 = 0xcfc4ac, LEAD = 0x8f9aa8;
      parts.push(bx(9.0, 12.0, 22.0, 0, 6.0, 0, S));
      parts.push(bx(9.6, 0.8, 22.6, 0, 12.4, 0, S2));
      for (let i = 0; i < 6; i++) {
        parts.push(bx(0.5, 6.0, 1.0, -4.6, 6.5, -9.0 + i * 3.6, S2));
      }
      parts.push(cyl(6.2, 6.6, 8.0, 14, 0, 16.8, 0, S));
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * 6.2832;
        parts.push(cyl(0.42, 0.42, 7.0, 5, Math.cos(a) * 6.4, 16.6, Math.sin(a) * 6.4, S2));
      }
      parts.push(cyl(6.9, 6.9, 0.9, 14, 0, 21.3, 0, S2));
      parts.push(part(new THREE.SphereGeometry(6.2, 14, 8, 0, 6.2832, 0, Math.PI / 2),
        LEAD, 0, 21.6, 0));
      parts.push(cyl(1.9, 2.3, 4.0, 10, 0, 29.4, 0, S));
      parts.push(cone(1.7, 2.4, 10, 0, 32.6, 0, LEAD));
      parts.push(bx(0.22, 1.8, 0.22, 0, 34.6, 0, 0xffe45e));
      // The west towers, which is what makes the dome read as a cathedral
      // rather than as a capitol.
      for (const sz of [-1, 1]) {
        parts.push(bx(5.0, 20.0, 5.0, -0.5, 10.0, sz * 8.4, S));
        parts.push(bx(5.6, 0.7, 5.6, -0.5, 20.3, sz * 8.4, S2));
        parts.push(cyl(2.0, 2.2, 4.0, 8, -0.5, 22.6, sz * 8.4, S));
        parts.push(cone(2.0, 3.0, 8, -0.5, 26.2, sz * 8.4, LEAD));
      }
      return merge(parts);
    },

    /** The Elizabeth Tower. Reach -2.6. */
    bigBen: function () {
      const parts = [];
      const S = 0xd8c49a, S2 = 0xbca87e, ROOF = 0x4f6a58, GOLD = 0xffd85e;
      parts.push(bx(6.4, 3.0, 6.4, 0, 1.5, 0, S2));
      parts.push(bx(5.2, 26.0, 5.2, 0, 15.0, 0, S));
      for (let i = 0; i < 5; i++) {
        for (const f of [[-2.65, 0, 0.3, 1.4], [0, -2.65, 1.4, 0.3]]) {
          parts.push(bx(f[2], 3.0, f[3], f[0], 6.0 + i * 4.4, f[1], 0x4a4664));
        }
      }
      parts.push(bx(6.2, 1.0, 6.2, 0, 28.4, 0, S2));
      parts.push(bx(5.8, 5.4, 5.8, 0, 31.6, 0, S));
      // Clock faces on the two the road can see.
      for (const f of [[-2.95, 0, 0.34, 4.0], [0, -2.95, 4.0, 0.34]]) {
        parts.push(bx(f[2], 4.0, f[3], f[0], 31.6, f[1], 0xfffdf5));
        parts.push(bx(f[2] * 1.4, 4.5, f[3] * 1.4, f[0] * 1.02, 31.6, f[1] * 1.02, GOLD));
        parts.push(bx(f[2] * 1.1, 3.9, f[3] * 1.1, f[0] * 1.06, 31.6, f[1] * 1.06, 0xfffdf5));
      }
      parts.push(bx(0.28, 1.5, 0.16, -3.16, 32.2, 0, 0x2b2f52));
      parts.push(bx(0.16, 0.28, 1.2, -3.16, 31.6, 0.4, 0x2b2f52));
      parts.push(bx(6.2, 0.8, 6.2, 0, 34.6, 0, GOLD));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          parts.push(cone(0.8, 4.0, 4, sx * 2.5, 36.8, sz * 2.5, ROOF));
        }
      }
      parts.push(cone(3.9, 8.0, 4, 0, 39.0, 0, ROOF));
      parts.push(cyl(0.5, 0.9, 2.0, 6, 0, 43.8, 0, GOLD));
      parts.push(bx(0.20, 2.4, 0.20, 0, 46.0, 0, GOLD));
      return merge(parts);
    },

    /** Tower Bridge: two gothic towers along the deck and the high walkways. */
    towerBridge: function () {
      const parts = [];
      const S = 0xdcd0b4, S2 = 0xbfae8e, BLUE = 0x2f7fb8, TOP = 0x4f7f9a;
      for (const sz of [-1, 1]) {
        const z = sz * 30;
        for (const sx of [-1, 1]) {
          const x = sx * 9.6;
          parts.push(bx(5.6, 24.0, 5.6, x, 12.0, z, S));
          parts.push(bx(6.2, 1.0, 6.2, x, 3.0, z, S2));
          parts.push(bx(6.2, 0.9, 6.2, x, 18.0, z, S2));
          parts.push(bx(5.0, 6.0, 5.0, x, 24.5, z, S));
          for (const cx of [-1, 1]) {
            for (const cz of [-1, 1]) {
              parts.push(cone(1.0, 5.0, 4, x + cx * 2.4, 29.0, z + cz * 2.4, TOP));
            }
          }
          parts.push(cone(3.9, 9.0, 4, x, 32.0, z, TOP));
          parts.push(bx(0.22, 2.4, 0.22, x, 37.4, z, 0xffe45e));
          // The gothic portal: the road really does pass through the towers.
          vArc(parts, { cx: sx * 9.6, cy: 11.0, cz: z, rx: 3.6, ry: 5.0, n: 6, th: 0.7, d: 6.2, color: S2 });
        }
        // The cross member over the road, well above the overhead layer.
        parts.push(bx(24.0, 1.6, 6.0, 0, 19.6, z, S2));
      }
      // The two high walkways: the shape everybody draws.
      for (const y of [21.4, 24.6]) {
        parts.push(bx(20.0, 0.8, 4.4, 0, y, 0, S));
      }
      for (let i = 0; i < 7; i++) {
        parts.push(bx(0.5, 3.2, 4.6, 0, 23.0, -27 + i * 9, S2));
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          parts.push(bx(0.55, 0.55, 62, sx * 9.4, 22.0, 0, S2));
        }
      }
      // Suspension chains, out beyond the towers.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          for (let i = 0; i < 5; i++) {
            const t0 = i / 5, t1 = (i + 1) / 5;
            const z0 = sz * (32 + t0 * 34), z1 = sz * (32 + t1 * 34);
            const y0 = 18 - 9 * Math.sin(Math.PI * t0 * 0.9);
            const y1 = 18 - 9 * Math.sin(Math.PI * t1 * 0.9);
            const len = Math.hypot(z1 - z0, y1 - y0);
            parts.push(bx(0.5, 0.5, len, sx * 9.6, (y0 + y1) / 2, (z0 + z1) / 2, BLUE,
              -Math.atan2(y1 - y0, z1 - z0)));
          }
        }
      }
      return merge(parts);
    },

    // ---- BERLIN --------------------------------------------------------
    /** The Fernsehturm: a sphere on a needle, and nothing else is that. */
    fernsehturm: function () {
      const parts = [];
      const C = 0xe4e8f0, C2 = 0xb8bfd0;
      parts.push(cyl(3.2, 6.0, 3.0, 12, 0, 1.5, 0, C2));
      parts.push(cyl(1.5, 3.2, 34.0, 12, 0, 20.0, 0, C));
      for (let i = 0; i < 6; i++) {
        const y = 8.0 + i * 5.0;
        const r = 3.2 - (y - 3.0) / 34.0 * 1.7 + 0.30;
        parts.push(cyl(r, r, 0.3, 12, 0, y, 0, C2));
      }
      parts.push(sph(5.6, 12, 0, 39.5, 0, 0xd0d8e8));
      parts.push(cyl(5.7, 5.7, 1.1, 14, 0, 39.5, 0, 0xf4f8ff));
      parts.push(cyl(4.2, 4.2, 0.9, 14, 0, 43.4, 0, C2));
      parts.push(cyl(1.1, 1.4, 6.0, 8, 0, 47.5, 0, C));
      parts.push(cone(0.9, 22.0, 6, 0, 61.0, 0, 0xef4a5a));
      parts.push(cyl(0.16, 0.16, 6.0, 5, 0, 74.0, 0, C2));
      return merge(parts);
    },

    /** The Brandenburg Gate: the road runs through it. */
    brandenburg: function (look) {
      const parts = [];
      const S = 0xe0d4b8, S2 = 0xc2b090, DARK = 0x6a5f4e;
      for (const sx of [-1, 1]) {
        // Columns at 12.4, 16.6 and 20.8: the road takes the central opening
        // and the two flanking ones stay outside the corridor by a wide margin.
        for (const cx of [12.4, 16.6, 20.8]) {
          for (const cz of [-2.4, 2.4]) {
            parts.push(cyl(0.95, 1.15, 13.0, 10, sx * cx, 6.5, cz, S));
            parts.push(cyl(1.35, 1.35, 0.7, 10, sx * cx, 13.3, cz, S2));
            parts.push(bx(2.8, 0.6, 2.8, sx * cx, 0.3, cz, S2));
          }
        }
        parts.push(bx(12.0, 2.6, 7.6, sx * 16.6, 15.0, 0, S));
        parts.push(bx(12.6, 0.8, 8.2, sx * 16.6, 16.7, 0, S2));
      }
      // The entablature over the road. Soffit at 13.8, well clear of
      // OVERHEAD_Y and of everything the tile hangs at 10.9.
      parts.push(bx(26.0, 2.6, 7.6, 0, 15.0, 0, S));
      parts.push(bx(26.6, 0.8, 8.2, 0, 16.7, 0, S2));
      parts.push(bx(48.0, 1.0, 8.6, 0, 17.4, 0, S2));
      parts.push(bx(46.0, 3.4, 6.0, 0, 19.2, 0, S));
      // The quadriga: four horses and a chariot, in silhouette only.
      for (let i = 0; i < 4; i++) {
        const x = -4.8 + i * 3.2;
        parts.push(bx(1.5, 2.0, 3.4, x, 22.0, 0.4, DARK));
        parts.push(bx(1.0, 1.6, 1.0, x - 0.2, 23.4, 1.9, DARK, 0.4));
        parts.push(bx(0.5, 1.8, 0.5, x, 21.0, 1.4, DARK));
        parts.push(bx(0.5, 1.8, 0.5, x, 21.0, -0.8, DARK));
      }
      parts.push(bx(3.4, 2.2, 3.0, 6.6, 22.1, 0, DARK));
      parts.push(cyl(1.2, 1.2, 0.4, 10, 6.6, 21.2, 1.6, DARK, 0, 0, Math.PI / 2));
      parts.push(bx(0.7, 3.0, 0.7, 7.4, 24.2, 0, DARK));
      return merge(parts);
    },

    /** The Siegessäule: a column with a gold figure. Reach -3.2. */
    victoryColumn: function () {
      const parts = [];
      const S = 0xd8cbb0, GOLD = 0xffd24a;
      parts.push(cyl(4.6, 5.4, 2.0, 12, 0, 1.0, 0, 0xbfae90));
      parts.push(cyl(3.6, 4.0, 4.0, 12, 0, 4.0, 0, S));
      for (let i = 0; i < 3; i++) {
        parts.push(cyl(2.0 - i * 0.15, 2.1 - i * 0.15, 6.0, 12, 0, 9.0 + i * 6.0, 0, S));
        parts.push(cyl(2.2 - i * 0.15, 2.2 - i * 0.15, 0.5, 12, 0, 12.0 + i * 6.0, 0, GOLD));
        // The gilded cannon barrels set into the drums -- pure Berlin.
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * 6.2832;
          parts.push(cyl(0.28, 0.28, 4.6, 6, Math.cos(a) * (1.95 - i * 0.15), 9.0 + i * 6.0,
            Math.sin(a) * (1.95 - i * 0.15), GOLD));
        }
      }
      parts.push(cyl(3.0, 2.4, 1.6, 12, 0, 27.6, 0, S));
      parts.push(cyl(3.2, 3.2, 0.6, 12, 0, 28.7, 0, GOLD));
      parts.push(bx(1.4, 4.4, 1.4, 0, 31.2, 0, GOLD));
      parts.push(bx(0.6, 1.2, 5.6, 0.2, 33.4, 0, GOLD, 0.3));
      parts.push(bx(0.9, 3.4, 0.9, -1.0, 33.0, 0, GOLD, 0, 0, 0.5));
      return merge(parts);
    },

    /** The Oberbaumbrücke: brick towers with the U-Bahn viaduct above. */
    oberbaum: function () {
      const parts = [];
      const B = 0xa8543f, B2 = 0x86402f, S = 0xd8c8a8;
      for (const sz of [-1, 1]) {
        const z = sz * 26;
        for (const sx of [-1, 1]) {
          const x = sx * 9.6;
          parts.push(bx(5.0, 20.0, 5.0, x, 10.0, z, B));
          parts.push(bx(5.6, 0.8, 5.6, x, 15.4, z, B2));
          parts.push(bx(4.2, 4.0, 4.2, x, 21.8, z, B));
          parts.push(cone(3.2, 7.0, 6, x, 27.0, z, 0x4f5f6a));
          parts.push(bx(0.2, 2.0, 0.2, x, 31.2, z, 0xffe45e));
          vArc(parts, { cx: x, cy: 9.0, cz: z, rx: 3.2, ry: 4.4, n: 6, th: 0.6, d: 5.4, color: B2 });
        }
      }
      // The railway deck: an arcade carried over the road on the towers.
      for (const sx of [-1, 1]) {
        parts.push(bx(1.2, 4.0, 66, sx * 9.2, 19.6, 0, B));
      }
      parts.push(bx(20.0, 1.2, 66, 0, 17.6, 0, B2));
      for (let i = 0; i < 7; i++) {
        vArc(parts, { cx: 0, cy: 12.4, cz: -30 + i * 10, rx: 4.4, ry: 4.6, n: 6, th: 0.7, d: 1.2, color: B2 });
      }
      parts.push(bx(21.0, 0.9, 66, 0, 22.2, 0, S));
      return merge(parts);
    },

    // ---- CHICAGO -------------------------------------------------------
    /** Willis Tower: bundled black tubes stepping down. Reach -8.0. */
    willis: function () {
      const parts = [];
      const D = 0x272c44, D2 = 0x363d5c, BAND = 0x5a6488;
      const tube = [
        [-4.0, -4.0, 62], [0.0, -4.0, 44], [4.0, -4.0, 52],
        [-4.0, 0.0, 52], [0.0, 0.0, 78], [4.0, 0.0, 44],
        [-4.0, 4.0, 44], [0.0, 4.0, 78], [4.0, 4.0, 52],
      ];
      for (const t of tube) {
        parts.push(bx(3.9, t[2], 3.9, t[0], t[2] / 2, t[1], D));
        const n = Math.round(t[2] / 3.2);
        for (let i = 1; i < n; i++) {
          parts.push(bx(4.0, 0.34, 4.0, t[0], t[2] * i / n, t[1], BAND));
        }
        parts.push(bx(4.3, 0.5, 4.3, t[0], t[2], t[1], D2));
      }
      for (const z of [-4.0, 4.0]) {
        parts.push(cyl(0.14, 0.30, 26.0, 6, 0, 91.0, z, D2));
      }
      return merge(parts);
    },

    /**
     * The elevated L, running the length of the leg over the road.
     *
     * Laid as a RUN rather than as a point landmark: an elevated railway that
     * appears in 48-unit chunks with gaps between them is not an elevated
     * railway. The deck sits at 13.5 -- above everything the road tile hangs
     * overhead (10.9 at the tallest mast), so the two layers stack instead of
     * fighting, and the columns stand at 11.9, outside LANDMARK_IN.
     *
     * IT CARRIES NO TRAIN, AND CANNOT. There was an lTrackTrain variant that
     * baked three carriages into every third chunk; measured by raycast, 0 of
     * 576 rays from the road ever reached them, because the deck plate below
     * them is solid across |x| <= 11.9 and the lens is underneath it at y 2.62.
     * The full table, and what would have to change for an elevated line to
     * show traffic, is in the third block of the traffic refusal at the top of
     * this file. Do not put a vehicle back on this deck without reading it.
     */
    lTrack: function (look) {
      const parts = [];
      const STEEL = 0x4a5268, STEEL2 = 0x39405a, TIE = 0x5f4a38;
      const L = 48, CX = 11.9;
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const z = -L / 2 + 6 + i * 12;
          parts.push(bx(1.5, 13.0, 1.5, sx * CX, 6.5, z, STEEL));
          parts.push(bx(2.2, 0.7, 2.2, sx * CX, 0.35, z, STEEL2));
          parts.push(bx(2.6, 2.2, 0.9, sx * (CX - 1.3), 12.4, z, STEEL2, 0, 0, sx * 0.7));
        }
        // Plate girders down each side, which is what an L structure is.
        parts.push(bx(0.5, 2.2, L, sx * CX, 13.4, 0, STEEL));
        parts.push(bx(0.9, 0.4, L, sx * CX, 14.6, 0, STEEL2));
        parts.push(bx(0.9, 0.4, L, sx * CX, 12.3, 0, STEEL2));
        parts.push(bx(0.16, 1.5, L, sx * (CX - 0.6), 15.9, 0, STEEL2));
      }
      parts.push(bx(CX * 2, 0.5, L, 0, 12.6, 0, STEEL2));
      for (let i = 0; i < Math.round(L / 1.6); i++) {
        parts.push(bx(CX * 1.6, 0.24, 0.7, 0, 13.0, -L / 2 + 0.8 + i * 1.6, TIE));
      }
      for (const rx of [-4.4, -2.6, 2.6, 4.4]) {
        parts.push(bx(0.30, 0.30, L, rx, 13.3, 0, 0xa8b0c4));
      }
      return merge(parts);
    },

    /**
     * A Chicago river bascule -- seen from the deck of its neighbour.
     *
     * A raised leaf cannot go over this road: the leaves of a bascule lift
     * across the channel, which is the direction the runner is travelling. So
     * what the leg gets is the pair of ornate bridgetender houses at the deck
     * edge and the NEXT bridge downstream with its leaves up, out over the
     * water where it is unmistakable and cannot touch anything.
     */
    bascule: function () {
      const parts = [];
      const S = 0xd8cbb0, S2 = 0xb4a68a, STEEL = 0x3f4860, RUST = 0x7f4a3a;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = sx * 8.4, z = sz * 16;
          parts.push(bx(4.0, 6.0, 4.0, x, 3.0, z, S));
          parts.push(bx(4.6, 0.6, 4.6, x, 6.3, z, S2));
          parts.push(bx(3.4, 2.4, 3.4, x, 7.8, z, S));
          parts.push(cone(2.6, 3.0, 4, x, 10.5, z, 0x4f6a58));
          parts.push(bx(0.9, 1.6, 0.9, x, 1.6, z - sz * 2.2, 0x4a4664));
        }
      }
      // The raised bridge downstream. Two leaves canted up out of the water.
      for (const sz of [-1, 1]) {
        const z = 44;
        parts.push(bx(6.0, 9.0, 5.0, -26, 4.5 - 2.3, z + sz * 13, STEEL));
        parts.push(bx(3.0, 22.0, 8.0, -26 + sz * 0.0, 9.0, z + sz * 7.4, RUST, sz * 1.15));
        parts.push(bx(3.4, 4.4, 4.4, -26, 3.4, z + sz * 12.0, STEEL));
        for (let i = 0; i < 4; i++) {
          parts.push(bx(0.5, 0.5, 9.0, -26, 6.0 + i * 4.4, z + sz * (5.0 + i * 1.6), STEEL, sz * 1.15));
        }
      }
      return merge(parts);
    },

    // ---- NEW YORK ------------------------------------------------------
    /** The Empire State: setbacks and a mooring mast. Reach -7.5. */
    empire: function () {
      const parts = [];
      vTower(parts, {
        w: 15, d: 15, h: 46, steps: 3, split: [0.42, 0.34, 0.24], taper: 0.66,
        color: 0xb0a48e, color2: 0x8f8472, band: 0x6f6858, glass: 0,
        crown: 'stepped', lit: 1, seed: 9,
      });
      return merge(parts);
    },

    /** The Verrazzano: a grey steel suspension span. */
    verrazzano: function () { return mkSuspension(0x9aa4bc, 0x6f7a98, 0xd8dce8); },

    // ---- TOKYO ---------------------------------------------------------
    /** The Skytree: a lattice needle. Reach -6.5. */
    skytree: function () {
      const parts = [];
      vLattice(parts, {
        h: 62, base: 6.2, top: 1.5, curve: 2.4, seg: 10, leg: 0.85, belt: 0.24,
        color: 0xdfe4f0, color2: 0xa8b2c8,
        decks: [
          { y: 34, w: 9.0, h: 3.4, c: 0xeff2fa, rim: 0x8fa8d8 },
          { y: 50, w: 6.4, h: 2.6, c: 0xeff2fa, rim: 0x8fa8d8 },
        ],
        mast: 26, mastR: 0.55,
      });
      parts.push(cyl(2.6, 4.2, 5.0, 10, 0, 2.5, 0, 0xc8cfe0));
      return merge(parts);
    },

    /** A torii, with the road running through it. */
    torii: function () {
      const parts = [];
      const RED = 0xd93a3a, DARK = 0x2f2a3a;
      for (const sx of [-1, 1]) {
        parts.push(cyl(1.0, 1.3, 17.0, 10, sx * 12.6, 8.5, 0, RED, 0, 0, sx * 0.035));
        parts.push(cyl(1.7, 1.7, 0.9, 10, sx * 12.9, 0.45, 0, DARK));
        parts.push(bx(3.0, 0.8, 3.0, sx * 12.4, 14.2, 0, RED));
      }
      parts.push(bx(32.0, 1.0, 2.0, 0, 15.6, 0, RED));
      // The kasagi: the top rail, sweeping up at the ends. Two canted boxes
      // and a flat centre is enough for the curve at this distance.
      parts.push(bx(24.0, 1.5, 2.8, 0, 18.4, 0, DARK));
      for (const sx of [-1, 1]) {
        parts.push(bx(9.0, 1.5, 2.8, sx * 15.8, 18.9, 0, DARK, 0, 0, sx * 0.12));
      }
      parts.push(bx(38.0, 0.7, 3.2, 0, 19.5, 0, DARK));
      parts.push(bx(1.6, 3.6, 2.2, 0, 17.0, 0, RED));
      return merge(parts);
    },

    /** A five-storey pagoda. Reach -4.2. */
    pagoda: function () {
      const parts = [];
      const RED = 0xc03a3a, WOOD = 0x8f4a3a, WHITE = 0xefe6d4, ROOF = 0x3f4a5e;
      parts.push(bx(8.0, 1.2, 8.0, 0, 0.6, 0, 0xa8a090));
      for (let i = 0; i < 5; i++) {
        const y = 1.2 + i * 4.2;
        const w = 6.4 - i * 0.7;
        parts.push(bx(w, 3.0, w, 0, y + 1.5, 0, i % 2 ? WHITE : RED));
        for (const sx of [-1, 1]) {
          parts.push(cyl(0.26, 0.26, 3.0, 6, sx * w * 0.42, y + 1.5, -w * 0.42, WOOD));
          parts.push(cyl(0.26, 0.26, 3.0, 6, sx * w * 0.42, y + 1.5, w * 0.42, WOOD));
        }
        const rw = w + 3.6;
        parts.push(bx(rw, 0.5, rw, 0, y + 3.2, 0, ROOF));
        parts.push(cone(rw * 0.78, 1.5, 4, 0, y + 4.0, 0, ROOF));
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            parts.push(bx(1.6, 0.35, 1.6, sx * rw * 0.44, y + 3.5, sz * rw * 0.44, ROOF, 0, 0, -sx * 0.3));
          }
        }
      }
      parts.push(cyl(0.3, 0.5, 5.0, 6, 0, 25.0, 0, 0xffd24a));
      for (let i = 0; i < 4; i++) {
        parts.push(cyl(0.9 - i * 0.14, 0.9 - i * 0.14, 0.24, 8, 0, 24.0 + i * 1.0, 0, 0xffd24a));
      }
      return merge(parts);
    },

    /** A signage stack: the Tokyo street front as one object. Reach -2.2. */
    neon: function () {
      const parts = [];
      const glow = [0xff3a6a, 0x37d6ff, 0xffe45e, 0x62f0a8, 0xff9ad5, 0xf4f6ff];
      const r = lcg(77);
      parts.push(bx(5.0, 26.0, 9.0, 0, 13.0, 0, 0x3f4560));
      parts.push(bx(5.2, 0.6, 9.2, 0, 26.4, 0, 0x2b3050));
      for (let i = 0; i < 9; i++) {
        const y = 3.0 + i * 2.6;
        const z = (r() - 0.5) * 5.0;
        const h = 1.6 + r() * 0.9;
        parts.push(bx(1.4, h, 2.6 + r() * 2.4, -2.6, y, z, glow[Math.floor(r() * glow.length)]));
        parts.push(bx(0.34, h * 0.7, 0.34, -1.6, y, z, 0x2b3050));
      }
      // A vertical banner sign down the corner, the tallest thing on the block.
      parts.push(bx(1.0, 16.0, 2.2, -2.9, 15.0, -3.2, 0xff3a6a));
      parts.push(bx(1.2, 15.0, 0.7, -3.0, 15.0, -3.2, 0xfffdf5));
      parts.push(bx(9.0, 3.0, 0.8, 0, 28.4, 0, glow[1]));
      for (const sz of [-1, 1]) parts.push(bx(0.4, 3.4, 0.4, 0, 28.0, sz * 4.0, 0x2b3050));
      return merge(parts);
    },

    /** Rainbow Bridge: a white suspension span. */
    rainbow: function () { return mkSuspension(0xf0f4ff, 0xc8cfe0, 0xe8ecf8); },

    // ---- SYDNEY --------------------------------------------------------
    /** The Opera House: nested shells on a podium. Reach -6.5. */
    operaHouse: function () {
      const parts = [];
      const SHELL = 0xf4f2e8, SHELL2 = 0xdcd8cc, POD = 0xc8c0ae;
      parts.push(bx(16.0, 2.4, 34.0, 2.0, 1.2, 0, POD));
      parts.push(bx(17.0, 0.5, 35.0, 2.0, 2.6, 0, 0xe4dccc));
      for (let i = 0; i < 8; i++) {
        parts.push(bx(0.5, 2.4, 1.6, -5.6, 1.2, -14 + i * 4.0, 0x9a9282));
      }
      // Two clusters of three shells, each leaning back and stepping down --
      // the "sails" everybody draws, and the LEAN is what makes them sails.
      const cluster = [
        { z: -9.0, r: [8.6, 6.4, 4.0] },
        { z: 9.0, r: [7.4, 5.4, 3.2] },
      ];
      for (const c of cluster) {
        for (let i = 0; i < c.r.length; i++) {
          vShell(parts, {
            r: c.r[i], color: i % 2 ? SHELL2 : SHELL, back: 0xbfb8a8,
            x: -1.6 + i * 2.4, y: 2.4, z: c.z + i * 2.6,
            tilt: 0, yaw: -0.35, roll: -0.45, seg: 11,
          });
        }
      }
      vShell(parts, { r: 3.0, color: SHELL, back: 0xbfb8a8, x: 3.0, y: 2.4, z: -20.0, yaw: -0.4, roll: -0.5, seg: 9 });
      return merge(parts);
    },

    /** Sydney Tower: a gold bucket on a needle. Reach -3.0. */
    sydneyTower: function () {
      const parts = [];
      const C = 0xd8dce8, GOLD = 0xe8b040;
      parts.push(bx(9.0, 14.0, 9.0, 0, 7.0, 0, 0xb8bcd0));
      parts.push(cyl(1.4, 2.2, 34.0, 10, 0, 31.0, 0, C));
      for (let i = 0; i < 5; i++) {
        parts.push(cyl(1.6, 1.6, 0.4, 10, 0, 20.0 + i * 6.0, 0, 0xa8b0c8));
      }
      parts.push(cyl(4.4, 3.6, 4.4, 12, 0, 50.0, 0, GOLD));
      parts.push(cyl(4.8, 4.8, 0.7, 12, 0, 47.6, 0, 0xc08a2a));
      parts.push(cyl(3.8, 3.8, 0.6, 12, 0, 52.4, 0, 0xc08a2a));
      parts.push(cyl(1.3, 1.3, 5.0, 8, 0, 55.4, 0, C));
      parts.push(cone(0.6, 14.0, 6, 0, 64.0, 0, C));
      // The stay cables that make it read as a tower and not as a chimney.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * 6.2832 + 0.4;
        parts.push(bx(0.18, 34.0, 0.18, Math.cos(a) * 3.4, 31.0, Math.sin(a) * 3.4, 0xa8b0c8,
          Math.sin(a) * 0.06, 0, -Math.cos(a) * 0.06));
      }
      return merge(parts);
    },

    /** The Harbour Bridge: a steel through-arch over the road. */
    harbour: function () {
      const parts = [];
      const STEEL = 0x8f9aae, STEEL2 = 0x6f7a90, STONE = 0xc8bfa8;
      const sub = [];
      // Two arch trusses, one either side of the deck, springing above the
      // overhead layer and rising to 30. Built along local x and swung a
      // quarter turn so it runs up the course.
      for (const sx of [-1, 1]) {
        vTruss(sub, {
          x0: -46, x1: 46, z: sx * 8.6, w: 0.9, depth: 3.2,
          y0: 11.0, rise: 21.0, curve: 1, n: 14, th: 0.42,
          color: STEEL, color2: STEEL2,
        });
      }
      placeAt(parts, sub, 0, 0, 0, Math.PI / 2);
      // Hangers down to the deck, and the cross bracing over the crown.
      for (let i = 1; i < 14; i++) {
        const t = i / 14;
        const z = -46 + t * 92;
        const y = 11.0 + 21.0 * Math.sin(Math.PI * t) - 3.2;
        for (const sx of [-1, 1]) {
          parts.push(bx(0.30, Math.max(0.5, y - 10.2), 0.30, sx * 8.6, (y + 10.2) / 2, z, STEEL2));
        }
        if (i % 3 === 0) parts.push(bx(17.2, 0.34, 0.34, 0, y, z, STEEL2));
      }
      // The granite pylons at each end: the Harbour Bridge's other half.
      for (const sz of [-1, 1]) {
        for (const sx of [-1, 1]) {
          parts.push(bx(6.0, 24.0, 8.0, sx * 11.0, 12.0, sz * 44, STONE));
          parts.push(bx(6.8, 1.0, 8.8, sx * 11.0, 24.6, sz * 44, 0xdcd2ba));
          parts.push(bx(5.0, 3.0, 6.6, sx * 11.0, 26.6, sz * 44, STONE));
        }
      }
      return merge(parts);
    },

    // ---- PARIS ---------------------------------------------------------
    /** The Eiffel Tower. Reach -9.5, so it wants x >= 21. */
    eiffel: function () {
      const parts = [];
      vLattice(parts, {
        h: 52, base: 9.2, top: 1.0, curve: 2.2, seg: 10, leg: 1.15, belt: 0.34,
        color: 0x9a7f5e, color2: 0x7d6449,
        arch: { y: 11.0, r: 5.0, th: 0.9, d: 1.0 },
        decks: [
          { y: 12.5, w: 14.0, h: 1.3, c: 0x8f7554, rim: 0xb09a72 },
          { y: 27.0, w: 8.4, h: 1.1, c: 0x8f7554, rim: 0xb09a72 },
          { y: 46.0, w: 4.0, h: 1.4, c: 0x8f7554, rim: 0xb09a72 },
        ],
        mast: 12, mastR: 0.5,
      });
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          parts.push(bx(3.4, 0.9, 3.4, sx * 8.6, 0.45, sz * 8.6, 0x8a8272));
        }
      }
      return merge(parts);
    },

    /** The Arc de Triomphe, with the road running through it. */
    arcDeTriomphe: function () {
      const parts = [];
      const S = 0xe4d8bc, S2 = 0xc8b898, DARK = 0x9a8a70;
      for (const sx of [-1, 1]) {
        parts.push(bx(9.6, 20.0, 15.0, sx * 16.8, 10.0, 0, S));
        parts.push(bx(10.2, 1.0, 15.6, sx * 16.8, 20.4, 0, S2));
        // Relief panels: two dark rectangles a side is all the ornament that
        // survives the fog, and their rhythm is the arch's own.
        for (const sz of [-1, 1]) {
          parts.push(bx(4.4, 6.0, 0.4, sx * 19.0, 9.0, sz * 7.6, DARK));
          parts.push(bx(3.0, 3.4, 0.4, sx * 14.4, 15.0, sz * 7.6, DARK));
        }
      }
      vArc(parts, { cx: 0, cy: 9.8, rx: 12.6, ry: 7.4, n: 9, th: 1.3, d: 15.2, color: S2, alt: S });
      parts.push(bx(24.0, 3.4, 15.0, 0, 18.7, 0, S));
      parts.push(bx(45.0, 1.2, 16.0, 0, 21.0, 0, S2));
      parts.push(bx(43.0, 4.6, 14.0, 0, 23.9, 0, S));
      parts.push(bx(45.0, 1.0, 15.4, 0, 26.6, 0, S2));
      for (let i = 0; i < 7; i++) {
        parts.push(bx(1.2, 3.0, 15.4, -18 + i * 6, 23.9, 0, S2));
      }
      return merge(parts);
    },

    /** A Seine bridge: a low stone arch span with lamps and a parallel bridge. */
    stoneArch: function (look) {
      const parts = [];
      const S = 0xd8cfba, S2 = 0xbfb49c, GREEN = 0x3f6a5a;
      for (const sx of [-1, 1]) {
        // Ornament on this deck's own parapet: piers, lamps and a statue.
        for (const sz of [-1, 1]) {
          const x = sx * 5.4, z = sz * 12;
          parts.push(bx(1.8, 2.6, 2.4, x, 0.9, z, S));
          parts.push(cyl(0.22, 0.30, 4.6, 8, x, 4.4, z, GREEN));
          parts.push(sph(0.62, 8, x, 7.0, z, 0xffe45e));
          parts.push(bx(0.9, 0.9, 0.9, x, 7.6, z, GREEN));
        }
        parts.push(bx(1.4, 2.0, 3.0, sx * 5.4, 0.6, 0, S2));
        parts.push(bx(1.0, 3.2, 1.0, sx * 5.4, 3.0, 0, GREEN));
        parts.push(bx(1.6, 1.4, 1.6, sx * 5.4, 5.2, 0, GREEN));
      }
      /**
       * The next bridge downstream, which is where the arches can be seen.
       *
       * ===== THE ARCHES WERE LAID OUT ON THE UNROTATED AXIS =====
       *
       * This ran four arches THROUGH THE PLAYER'S ROAD on every day it was
       * drawn -- 51 triangles inside the corridor, `LOW` and two `HIDES`, a
       * BLOCK at 45u and a JUMP at 84u both hidden behind masonry. 72 of 365
       * days, PARIS and ROME, always on THE BRIDGE leg. It shipped because
       * `shoot.js` photographed one date.
       *
       * `vArc` builds its ring in the X-Y PLANE: `rx` is the span along x,
       * `ry` the rise in y, and `d` the extrusion along z at `cz`. So the
       * arches of a viaduct step along X, the span axis. This stepped `cz` --
       * the EXTRUSION axis -- which fans four arches sideways across 60 units
       * of thickness instead of laying them end to end.
       *
       * `placeAt` then rotates the whole sub-assembly by PI/2, which maps
       * local x to world z. Everything else in the assembly was authored for
       * that and agreed with it: the deck is 72 along local x (72 of world z),
       * and the piers are pushed to `parts` UNROTATED at world x -34, stepping
       * along world z. Only the arch centres were on the wrong axis, so they
       * marched out along world x from -64 to **-0.5** -- half a unit from the
       * centre line -- while their own deck and piers stayed at x -34.
       *
       * THE PIERS ARE THE PROOF, and they are why this is a one-word fix
       * rather than a redesign. With the centres on x the arches land at world
       * z {30, 10, -10, -30}, each spanning +/-8.6, leaving a 2.8 gap between
       * adjacent extrados -- and the piers are 3.0 deep at world z
       * {20, 0, -20}, which is exactly those gaps. The geometry was designed
       * for this layout and only the loop disagreed.
       *
       * Inner reach goes from x -0.5 to **-30.2**, outer from -67.5 to -37.8.
       * See the traffic-refusal note near the top of this file, which quoted
       * the 67.5.
       */
      const sub = [];
      for (let i = 0; i < 4; i++) {
        const z = -30 + i * 20;
        vArc(sub, { cx: z, cy: -1.4, cz: 0, rx: 8.6, ry: 5.2, n: 8, th: 1.1, d: 7.0, color: S, alt: S2 });
        if (i) parts.push(bx(7.2, 8.0, 3.0, -34, 1.0, z - 10, S2));
      }
      sub.push(bx(72, 1.4, 7.6, 0, 4.4, 0, S));
      sub.push(bx(73, 0.9, 8.4, 0, 5.4, 0, S2));
      for (let i = 0; i < 8; i++) {
        sub.push(bx(0.8, 1.5, 0.8, -28 + i * 8, 6.5, 3.4, S2));
        sub.push(bx(0.8, 1.5, 0.8, -28 + i * 8, 6.5, -3.4, S2));
      }
      placeAt(parts, sub, -34, -2.3, 0, Math.PI / 2);
      return merge(parts);
    },

    // ---- VALENCIA ------------------------------------------------------
    /** Calatrava's white ribs: a comb of parabolic arches. Reach -5.0. */
    calatravaRibs: function () {
      const parts = [];
      const W = 0xfbfbf6, W2 = 0xe0e4e4;
      parts.push(bx(13.0, 0.8, 44.0, 1.0, 0.4, 0, 0xf0f0e8));
      parts.push(bx(13.6, 0.3, 44.6, 1.0, 0.9, 0, 0xdde6e0));
      for (let i = 0; i < 15; i++) {
        const z = -20 + i * 2.86;
        const k = 1 - 0.30 * Math.abs(i - 7) / 7;
        vArc(parts, {
          cx: 1.0, cy: 1.0, cz: z, rx: 5.6 * k, ry: 13.0 * k,
          n: 8, th: 0.44, d: 0.7, color: i % 2 ? W : W2,
        });
      }
      parts.push(bx(1.0, 1.0, 44.0, 1.0, 13.6, 0, W));
      for (const sz of [-1, 1]) {
        parts.push(bx(0.7, 0.7, 44.0, -3.4, 7.0, sz * 0, W2));
      }
      // The bare white spine, which is what makes the ribs read as a building.
      parts.push(bx(4.0, 5.0, 44.0, 4.4, 2.5, 0, W));
      return merge(parts);
    },

    /** The Hemisfèric: an eye over water. Reach -8.0, wants x >= 20. */
    hemisferic: function (look) {
      const parts = [];
      const W = 0xfbfbf6, W2 = 0xdfe6e6;
      // Centred on local +4 and 30 wide rather than 42 about the origin: at
      // the table's x = 20 the old sheet reached world x = -1, i.e. across the
      // road. Same bug as the canal had; see the note there.
      parts.push(part(new THREE.PlaneGeometry(30, 46), look.water, 4, 0.02, 0, -Math.PI / 2));
      parts.push(bx(32, 0.6, 48, 4, -0.2, 0, 0xe8ece8));
      // The pupil, and its reflection: a hemisphere over an inverted one.
      parts.push(part(new THREE.SphereGeometry(8.0, 16, 9, 0, 6.2832, 0, Math.PI / 2),
        0xe8ecf0, 3.0, 0.2, 0));
      parts.push(part(new THREE.SphereGeometry(8.0, 16, 9, 0, 6.2832, Math.PI / 2, Math.PI / 2),
        0xb8c8d0, 3.0, 0.1, 0));
      parts.push(cyl(8.2, 8.2, 0.5, 16, 3.0, 0.3, 0, W2));
      // The lid: a long shallow shell over the top, which is the whole read.
      for (let i = 0; i < 10; i++) {
        const t = (i - 4.5) / 4.5;
        const w = Math.sqrt(Math.max(0.05, 1 - t * t));
        parts.push(bx(0.9, 1.0 + 12.0 * w, 2.6, 1.8 - 1.4 * (1 - w), 5.0 + 5.0 * w, t * 13.0,
          i % 2 ? W : W2, 0, 0, -t * 0.5));
      }
      parts.push(bx(1.4, 1.4, 30.0, 0.8, 13.4, 0, W));
      for (const sz of [-1, 1]) {
        parts.push(bx(1.6, 8.0, 1.6, 0.8, 4.0, sz * 15.0, W2, 0, 0, 0.2));
      }
      return merge(parts);
    },

    /**
     * A single inclined white pylon with harp cables -- Valencia's Calatrava
     * span. The pylon leans BACK ALONG THE COURSE rather than sideways, which
     * is what a real harp bridge does and what keeps every cable in one plane:
     * the whole fan is a rotation about x, so it stays true instead of being
     * approximated with a compound Euler that does not compose.
     */
    harp: function () {
      const parts = [];
      const W = 0xfbfbf6, W2 = 0xdde4e4;
      const PX = 9.8, LEAN = 0.34, H = 42;
      parts.push(bx(5.4, 4.0, 11.0, PX, 1.2, -6, W2));
      const top = [PX, 2.0 + H * Math.cos(LEAN), -H * Math.sin(LEAN)];
      parts.push(cyl(0.75, 2.4, H, 10, PX, 2.0 + H * 0.5 * Math.cos(LEAN),
        -H * 0.5 * Math.sin(LEAN), W, LEAN));
      parts.push(cyl(0.4, 0.8, 7.0, 8, top[0], top[1] + 3.3 * Math.cos(LEAN),
        top[2] - 3.3 * Math.sin(LEAN), W2, LEAN));
      for (let i = 0; i < 11; i++) {
        const t = 0.30 + i * 0.064;
        const ay = 2.0 + H * t * Math.cos(LEAN);
        const az = -H * t * Math.sin(LEAN);
        const bz = 6 + i * 6.6;
        const dy = ay - 2.2, dz = az - bz;
        const len = Math.hypot(dy, dz);
        parts.push(bx(0.22, len, 0.22, PX, (ay + 2.2) / 2, (az + bz) / 2, W2,
          Math.atan2(dz, dy)));
      }
      parts.push(bx(3.0, 1.4, 84.0, PX, 1.6, 0, W));
      return merge(parts);
    },

    // ---- AMSTERDAM -----------------------------------------------------
    /**
     * A canal running the length of the leg, with a humpback bridge on every
     * third piece. Laid as a RUN: a canal in chunks is a series of ponds.
     */
    canal: function (look, withBridge) {
      const parts = [];
      const W = look.water, QUAY = 0x8f8a7e, STONE = 0xa8a294, TREE = 0x3f8f52;
      const L = 40;
      // EVERYTHING SITS AT LOCAL x >= -8, and that is not a style choice.
      // A landmark is placed at its centre and the mesh runs toward the road
      // from there; the first version of this built the canal about local
      // x = -11 with a quay wall at -19.6, so at the table's x = 20 the near
      // wall landed at world x = 0.4 -- a stone kerb standing in the middle
      // lane. Scenery that reaches into the corridor is a hazard the collision
      // model has never heard of, which is the one bug this file must not
      // ship. The near quay now stops at -8, i.e. world 12 at x = 20, just
      // past the eight units of pavement the road tile carries.
      const C = 2.0;                    // water centre, in local x
      parts.push(part(new THREE.PlaneGeometry(15, L), W, C, 0.02, 0, -Math.PI / 2));
      for (const sx of [-1, 1]) {
        const x = C + sx * 8.0;
        parts.push(bx(1.6, 2.4, L, x, 0.4, 0, QUAY));
        parts.push(bx(2.0, 0.4, L, x, 1.5, 0, STONE));
        for (let i = 0; i < 7; i++) {
          parts.push(bx(0.24, 1.0, 0.24, x - sx * 0.7, 1.9, -L / 2 + 3 + i * 6, 0x3a3550));
        }
      }
      // Elms along the near quay and a couple of moored barges.
      for (let i = 0; i < 3; i++) {
        const tz = -L / 2 + 7 + i * 13;
        parts.push(cyl(0.26, 0.4, 3.2, 6, C - 9.4, 1.6, tz, 0x7a6a58));
        parts.push(sph(2.2, 8, C - 9.4, 5.4, tz, TREE));
        parts.push(sph(1.6, 7, C - 10.4, 4.6, tz + 1.0, 0x4fa062));
      }
      for (let i = 0; i < 2; i++) {
        const bz = -10 + i * 20;
        parts.push(bx(3.4, 1.0, 11.0, C - 4.4, 0.35, bz, 0x2f4a5e));
        parts.push(bx(3.0, 0.3, 10.4, C - 4.4, 0.9, bz, 0x6a7a5e));
        parts.push(bx(2.4, 1.4, 4.0, C - 4.4, 1.6, bz - 2.6, 0x3f6a4a));
        parts.push(bx(2.6, 0.24, 4.2, C - 4.4, 2.4, bz - 2.6, 0xefe6d4));
      }
      if (withBridge) {
        // The humpback: three shallow arches and a white balustrade.
        const sub = [];
        for (let i = 0; i < 3; i++) {
          vArc(sub, { cx: (i - 1) * 5.2, cy: 0.4, cz: 0, rx: 2.3, ry: 2.2, n: 6, th: 0.7, d: 5.0, color: STONE });
        }
        for (let i = 0; i < 9; i++) {
          const x = -8.0 + i * 2.0;
          const y = 3.4 + 1.3 * Math.cos(x / 8.0 * 1.4);
          sub.push(bx(2.2, 0.5, 5.2, x, y, 0, STONE));
          for (const sz of [-1, 1]) {
            sub.push(bx(2.2, 0.9, 0.3, x, y + 0.7, sz * 2.5, 0xf4f0e4));
          }
        }
        placeAt(parts, sub, C, 0, 0, Math.PI / 2);
      }
      return merge(parts);
    },

    canalBridge: function (look) { return MARKS.canal(look, true); },

    /** The Westerkerk tower: brick, then the blue-and-gold crown. Reach -3.0. */
    westerkerk: function () {
      const parts = [];
      const B = 0x9a6250, S = 0xdcd0b8, BLUE = 0x2f6fa8, GOLD = 0xffd24a;
      parts.push(bx(11.0, 9.0, 18.0, 3.0, 4.5, 0, B));
      for (const sx of [-1, 1]) {
        parts.push(bx(6.0, 2.6, 18.0, 3.0, 10.3, 0, 0x5f5a68, 0, 0, -sx * 0.7));
      }
      parts.push(bx(6.2, 22.0, 6.2, -2.4, 11.0, 0, B));
      parts.push(bx(6.8, 0.7, 6.8, -2.4, 22.4, 0, S));
      for (let i = 0; i < 3; i++) {
        parts.push(bx(0.4, 3.0, 1.4, -5.6, 8.0 + i * 5.0, 0, S));
      }
      parts.push(bx(5.2, 5.0, 5.2, -2.4, 25.4, 0, S));
      for (const f of [[-2.7, 0, 0.3, 2.8], [0, -2.7, 2.8, 0.3]]) {
        parts.push(bx(f[2], 2.8, f[3], -2.4 + f[0], 25.6, f[1], 0xfffdf5));
      }
      parts.push(bx(6.0, 0.7, 6.0, -2.4, 28.2, 0, GOLD));
      parts.push(cone(3.6, 3.4, 8, -2.4, 30.2, 0, BLUE));
      parts.push(cyl(2.2, 2.6, 3.4, 8, -2.4, 33.4, 0, BLUE));
      parts.push(cyl(2.8, 2.8, 0.5, 8, -2.4, 35.3, 0, GOLD));
      parts.push(cone(2.2, 4.0, 8, -2.4, 37.6, 0, BLUE));
      parts.push(cyl(0.9, 1.2, 1.6, 8, -2.4, 40.4, 0, GOLD));
      // The imperial crown on the top, which is the whole point of it.
      parts.push(cyl(1.5, 1.2, 1.4, 8, -2.4, 42.0, 0, GOLD));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * 6.2832;
        parts.push(bx(0.24, 2.2, 0.24, -2.4 + Math.cos(a) * 1.0, 43.4, Math.sin(a) * 1.0,
          0x2f5f9a, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35));
      }
      parts.push(sph(0.7, 7, -2.4, 44.8, 0, GOLD));
      return merge(parts);
    },

    /**
     * The Magere Brug: a white timber double bascule.
     *
     * Every member is either outboard of the deck rail (|x| >= 5.4) or above
     * OVERHEAD_Y, which is the rule the whole overhead layer is built on: the
     * A-frames stand off the deck edge, the crown beams cross the road at 12.9
     * and the hanger rods hang over the water, never over a lane.
     */
    magere: function () {
      const parts = [];
      const W = 0xf4f2e6, W2 = 0xdcd6c4, DARK = 0x5f5648;
      for (const sz of [-1, 1]) {
        const z = sz * 11;
        for (const sx of [-1, 1]) {
          parts.push(bx(0.9, 13.5, 0.9, sx * 5.7, 6.4, z, W, 0, 0, sx * 0.09));
          parts.push(bx(0.7, 0.7, 3.0, sx * 5.1, 12.2, z, W2));
        }
        parts.push(bx(13.0, 0.9, 1.2, 0, 12.9, z, W));
        parts.push(bx(12.0, 0.7, 0.7, 0, 11.4, z, W2));
        // The counterweight beams, canted down and away from the middle: this
        // is the shape a drawbridge has and nothing else does.
        for (const sx of [-1, 1]) {
          parts.push(bx(13.0, 0.7, 0.7, sx * 11.4, 9.4, z - sz * 3.2, W, 0, 0, sx * 0.34));
          parts.push(bx(2.0, 1.8, 1.6, sx * 17.4, 7.2, z - sz * 3.2, DARK));
          for (let i = 0; i < 4; i++) {
            parts.push(bx(0.3, 3.2, 0.3, sx * (6.6 + i * 2.6), 7.6 - i * 0.9, z - sz * 3.2, W2));
          }
        }
      }
      for (const sx of [-1, 1]) {
        parts.push(bx(0.5, 1.8, 26.0, sx * 5.0, 1.4, 0, W));
        for (let i = 0; i < 10; i++) {
          parts.push(bx(0.3, 1.4, 0.3, sx * 5.0, 1.2, -12 + i * 2.6, W2));
        }
      }
      return merge(parts);
    },

    // ---- fallbacks and remaining spans ---------------------------------
    /**
     * The Zakim: inverted-Y pylons straddling the deck with a cable fan.
     *
     * The legs stand outside the deck rail and meet ABOVE the road at 20, so
     * the one thing crossing the carriageway is the stem, eleven units clear
     * of OVERHEAD_Y. It is the shape Boston puts on its own postcards and it
     * is nothing like any other bridge in the pool.
     */
    zakim: function () {
      const parts = [];
      const W = 0xf0f2fa, W2 = 0xc4cad8, CABLE = 0xd8dce8;
      for (const sz of [-1, 1]) {
        const z = sz * 34;
        for (const sx of [-1, 1]) {
          parts.push(bx(2.0, 22.0, 2.6, sx * 8.6, 10.0, z, W, 0, 0, sx * 0.32));
          parts.push(bx(3.2, 1.0, 3.6, sx * 8.6, -0.4, z, W2));
        }
        parts.push(bx(9.0, 2.2, 3.0, 0, 20.4, z, W));
        parts.push(bx(2.6, 22.0, 2.6, 0, 32.0, z, W));
        parts.push(cone(1.9, 5.0, 4, 0, 45.4, z, W2));
        // The fan. Cables drop from the stem to the deck edge on both sides,
        // in the ZY plane, so the rotation is a single turn about x.
        for (let i = 0; i < 9; i++) {
          const ay = 26.0 + i * 2.1;
          const bzo = sz * (10 + i * 7.0);
          for (const sx of [-1, 1]) {
            const dy = ay - 2.0, dz = z - (z + bzo);
            const len = Math.hypot(dy, dz);
            parts.push(bx(0.20, len, 0.20, sx * 5.0, (ay + 2.0) / 2, z + bzo / 2, CABLE,
              Math.atan2(-bzo, dy)));
          }
        }
      }
      return merge(parts);
    },

    /** The generic span, for a setting with no bridge of its own. */
    tower: function () { return mkSuspension(0xff6a5e, 0xd8455e, 0xffe45e); },

    // ---- ROME ----------------------------------------------------------
    /** The Colosseum: a curved tiered arcade, broken at one end. Reach -9.0. */
    colosseum: function () {
      const parts = [];
      vArcade(parts, {
        bays: 15, bayW: 4.6, tiers: 3, tierH: 6.0, y0: 1.2, d: 5.0,
        radius: 34, ruin: 2, attic: 4.4, openTiers: 3, inset: -4.2,
        color: 0xe0c48c, color2: 0xc8a86c, voidC: 0x6a5540, seed: 23,
      });
      parts.push(bx(6.0, 1.2, 62.0, -6.6, 0.6, 0, 0xd8ccae));
      return merge(parts);
    },

    /** An aqueduct arch, with the road passing under it. */
    aqueduct: function () {
      const parts = [];
      const S = 0xd8c8a4, S2 = 0xbfab84;
      for (const sx of [-1, 1]) {
        parts.push(bx(7.0, 10.0, 8.0, sx * 15.8, 5.0, 0, S));
        parts.push(bx(7.6, 0.8, 8.6, sx * 15.8, 10.4, 0, S2));
        // Flanking arches, so it reads as a run of aqueduct rather than a gate.
        vArc(parts, { cx: sx * 26.0, cy: 8.0, rx: 6.0, ry: 4.6, n: 7, th: 0.9, d: 7.0, color: S2, alt: S });
        parts.push(bx(6.0, 8.0, 8.0, sx * 32.6, 4.0, 0, S));
      }
      vArc(parts, { cx: 0, cy: 9.8, rx: 13.0, ry: 8.2, n: 9, th: 1.1, d: 8.2, color: S2, alt: S });
      parts.push(bx(80.0, 2.4, 8.4, 0, 19.2, 0, S));
      parts.push(bx(81.0, 0.8, 9.2, 0, 20.8, 0, S2));
      // The channel on top, which is what an aqueduct is FOR.
      for (const sz of [-1, 1]) {
        parts.push(bx(81.0, 1.6, 1.0, 0, 22.0, sz * 3.4, S));
      }
      return merge(parts);
    },

    // ---- CAPE TOWN -----------------------------------------------------
    /**
     * Table Mountain: a flat top, a steep face and Devil's Peak beside it.
     *
     * Laid as a RUN 220 units long, because a mountain does not come and go.
     *
     * It stands at 72 units, not the 120 it was first given. At 120 the massif
     * sat 26 degrees off the camera axis and spent most of the leg outside the
     * frame entirely -- a landmark you cannot see is not a landmark. At 72 it
     * crops the shoulder of the frame the way the reference games' oversized
     * props do, and the haze at that range still reads as distance because the
     * thing is sixty units tall.
     */
    tableMountain: function () {
      const parts = [];
      const ROCK = 0x9a8f8a, ROCK2 = 0x7f7570, SCRUB = 0x6f7a52, HAZE = 0xb0a8a4;
      const L = 220;
      // The table: a long block with a hard horizontal top edge. Everything
      // about the identification is in that edge staying straight.
      parts.push(bx(52, 42, L * 0.62, 6, 21, 0, ROCK));
      parts.push(bx(56, 3.0, L * 0.63, 6, 43.5, 0, ROCK2));
      parts.push(bx(58, 1.4, L * 0.64, 6, 45.4, 0, HAZE));
      // The buttressed face toward the road: vertical gullies, which is what
      // stops a flat-topped block reading as a wall.
      for (let i = 0; i < 13; i++) {
        const z = -L * 0.30 + i * (L * 0.60 / 12);
        parts.push(bx(6.0, 34.0, 4.0, -19, 20.0, z, i % 2 ? ROCK2 : ROCK));
        parts.push(bx(3.0, 26.0, 2.4, -22, 14.0, z + 2.0, ROCK2));
      }
      // The talus and the scrub apron.
      for (let i = 0; i < 9; i++) {
        const z = -L * 0.34 + i * (L * 0.68 / 8);
        parts.push(cone(16 + (i % 3) * 5, 12 + (i % 2) * 5, 5, -20, 4, z, SCRUB));
      }
      // Devil's Peak at one end, Lion's Head at the other: the two pointed
      // ends are what make the flat middle read as a table.
      parts.push(cone(26, 44, 6, 2, 20, -L * 0.40, ROCK));
      parts.push(cone(18, 26, 6, -6, 12, -L * 0.44, SCRUB));
      parts.push(cone(20, 38, 6, 0, 18, L * 0.40, ROCK2));
      parts.push(cone(13, 18, 6, -8, 8, L * 0.44, SCRUB));
      return merge(parts);
    },
  };

  /**
   * bx() for hazard parts. Width and lateral offset follow the lane; height
   * and depth are passed straight through, because those are the numbers
   * MR.Collision.BOX mirrors and this file is not allowed to move them.
   */
  function hbx(w, h, d, x, y, z, color, rx, ry, rz) {
    return bx(w * LANE_FIT, h, d, (x || 0) * LANE_FIT, y, z, color, rx, ry, rz);
  }
  /**
   * hbx() with all twelve edges cut. The default chamfer is 0.05 -- about 3cm
   * at this game's scale -- which is a panel edge rather than a bevelled toy;
   * the masses that carry a vehicle's shoulder ask for more.
   *
   * It is deliberately a SEPARATE call rather than a flag on hbx, so every use
   * is a decision: the chamfer moves the silhouette, and a mass whose top or
   * flank is pinned to a number in MR.Collision.BOX must be chamfered
   * downward from that number, never outward past it. See the fleet.
   */
  function hcbx(w, h, d, x, y, z, color, c, rx, ry, rz) {
    return cbx(w * LANE_FIT, h, d, (x || 0) * LANE_FIT, y, z, color, c, rx, ry, rz);
  }
  /** Flat quad sized to the lane, for the striped faces hazards turn forward. */
  function hplane(w, h) {
    return new THREE.PlaneGeometry(w * LANE_FIT, h);
  }
  /**
   * A hazard part that keeps its own size and only moves with the lane. For
   * the furniture -- posts, feet, lamps -- which are objects standing at a
   * place rather than spans across it, and which read worse the thinner they
   * get.
   */
  function bxAt(w, h, d, x, y, z, color, rx, ry, rz) {
    return bx(w, h, d, (x || 0) * LANE_FIT, y, z, color, rx, ry, rz);
  }

  /**
   * ============ VEHICLE FITTINGS ============
   *
   * The four things every reference vehicle has and ours did not, measured off
   * `tgr-bus-front` at 15 units, `tgr-shopfronts` at gameplay distance and
   * `tgr-taxi-street`. Built once here so the whole fleet wears them the same
   * way and a change is one edit rather than seven.
   *
   * Every colour below was measured through the contrast audit's own camera --
   * a 2.20 x 2.20 x 1.30 box in the authored hue, rendered with the real lights
   * and the real ramp -- rather than predicted from the hex. That matters,
   * because this renderer's response is not the arithmetic anyone would guess:
   * the red channel clips at 168 on the shaded band, so 0xff and 0xa8 come back
   * the same, and green carries most of the luminance.
   *
   *   authored     rendered rgb      L      S
   *   0x8ec0ea     93,140,194     132.4  0.520   deep glass, upper band
   *   0x4f74bc     51, 84,156      82.4  0.675   deep glass, lower band  132.4/82.4 = 1.61
   *   0xa8e0e8    110,163,192     150.8  0.426   pale glass, upper band
   *   0x6f9cb8     72,113,153     105.5  0.529   pale glass, lower band  150.8/105.5 = 1.43
   *   0xe8ecf4    153,172,202     169.9  0.243   number plate
   *   0xff2b3c    168, 30, 51      74.0  0.819   tail lamp surround
   *   0xfff6e2    168,180,187     177.5  0.101   tail lamp core          177.5/74.0 = 2.40
   *   0x1e2140     18, 23, 54      25.3  0.661   tyre, cool bodies
   *   0x241a10     22, 18, 14      18.6  0.360   tyre, warm bodies
   *
   * The centre lane's tarmac is L 88-93, so a red tail lamp at L 74 is DARKER
   * than the road and cannot be drawn in red unsupported. The reference draws a
   * lamp as value in the core and hue in the surround, and that is what vLamps
   * builds.
   *
   * TWO GLASS PAIRS, AND THE REFERENCE IS WHY. Sampling `tgr-bus-front` and
   * `tgr-taxi-street` at the same scale, through the same reader:
   *
   *   bus windscreen   ( 42, 80,112)  L  72.0  S 0.627   a deep blue
   *   taxi glazing     (100,151,157)  L 136.5  S 0.364   a pale cyan
   *
   * The reference varies its glass by nearly two to one in VALUE while never
   * leaving the cool band in hue, and it puts the pale one on the yellow car.
   * That is not a stylistic accident, it is the same area-mean arithmetic this
   * whole section turns on: a deep blue window on a saturated warm body is the
   * fastest route back to the neutral axis there is, because it raises the blue
   * channel where the body has almost none. `0x98cebe` renders at (99,150,158),
   * which is the reference taxi's own glass to within two counts on every
   * channel -- so the pale pair below is not invented, it is measured, and it
   * goes on every warm body while the deep pair stays on every cool one.
   *
   * TWO TYRE BLACKS for the same reason. 0x1e2140 is a saturated dark BLUE --
   * its blue channel is three times its red -- so on a yellow car the tyres are
   * a chroma leak. A warm near-black costs nothing and plugs it. (A dark element
   * is free on saturation whatever its value, because S is a ratio and a black
   * region scales every channel of the area mean by the same factor; what a dark
   * costs is luminance alone. What is never free is a dark of the WRONG HUE.)
   */
  const GLASS_HI = 0x8ec0ea;
  const GLASS_LO = 0x4f74bc;
  const GLASS_PALE_HI = 0xa8e0e8;
  const GLASS_PALE_LO = 0x6f9cb8;
  const PLATE = 0xe8ecf4;
  const LAMP_RED = 0xff2b3c;
  const LAMP_CORE = 0xfff6e2;
  const TYRE = 0x1e2140;
  const TYRE_WARM = 0x241a10;
  // The wheel's bright half. WHEEL_RIM is deliberately a cool near-neutral
  // rather than each vehicle's own hue: a rim is the one part of a car that is
  // the same material whatever the body is painted, and the reference's four
  // vehicles all wear the same one. It is bright enough to be the second
  // brightest thing on a vehicle after the glass flash, which is what makes a
  // wheel read at 40 units instead of merging into its own arch.
  // Bright, and CHROMATIC rather than neutral -- see the note on GLASS_FLASH.
  // A rim really is the same alloy on every car, and that realism is worth less
  // here than the area mean is: a shared near-neutral on the brightest new
  // element in the fleet is the same mistake as the shared grey bumper this
  // file already refuses. Vehicles may override with `rim` on vUnder, and the
  // warm bodies do.
  const WHEEL_RIM = 0x9fb8dc;
  const WHEEL_HUB = 0xd4e4f8;
  const WHEEL_RIM_WARM = 0xd8b464;
  const WHEEL_HUB_WARM = 0xf4dc9c;
  // Front-lamp pair. Cold against the tail lamps' LAMP_RED, so the two ends of
  // a vehicle are never confused, plus the amber indicator that is the only
  // warm note on a front end.
  const LAMP_COLD = 0xb4d4ec;
  const LAMP_AMBER = 0xffa32b;

  /**
   * Glass, in two constant bands rather than one flat panel.
   *
   * Measured on the reference: the bus's windscreen is L 82.2 at the top, 66.5
   * mid and 51.1 at the bottom; the taxi's 151.6 / 130.7 / 105.9; the red car's
   * 110.8 / 83.9. Top divided by bottom is 1.61, 1.43 and 1.32 -- mean 1.45,
   * and 1.61 on the largest sample. The break sits about 55% up the glass.
   *
   * The reference gets that as a smooth reflection of a sky. Under a banded
   * toon ramp a gradient renders as a step anyway, so the step is placed
   * deliberately: GLASS_HI over GLASS_LO is 1.61 through this renderer's own
   * camera, which matches the largest reference sample to three figures.
   *
   * +12 authored triangles over the single box it replaces.
   */
  /**
   * THE THIRD BAND IS A REFLECTION, and it is the single most nameable thing
   * about glass in reference/sonic-cars-closeup.png. Every window in that image
   * is dark at the bottom and NEARLY WHITE across its upper third -- the owner's
   * note calls it out by name -- and that streak, not the tint, is what makes a
   * window read as glass rather than as a hole cut in the bodywork.
   *
   * Two bands could not do it. The 1.61 ratio between GLASS_HI and GLASS_LO is
   * measured off the reference and is right for the body of the pane, but the
   * reference's own top-to-bottom range is far wider than 1.61: the streak is a
   * separate event sitting on top of the gradient, not the top of it.
   *
   * IT IS HELD TO 16% OF THE PANE, and that number is a chroma budget rather
   * than a taste. The fleet's colour note records that a 15% cream band cost 88%
   * of a vehicle's saturation, because the area mean is what the contrast audit
   * measures and near-neutral area drags it to the axis. So the flash is NOT
   * white: it is a pale, still-cool version of its own pair, which keeps it on
   * the same side of neutral as the glass under it. On a cool body that is
   * chroma-positive outright; on a warm one it is the smallest bright element
   * that will still read.
   *
   * The whole pane carries GLOSS.glass, so it is also the one surface on the
   * vehicle that takes the specular core -- the highlight and the painted
   * reflection are doing the same job from two directions.
   */
  // BOTH OF THESE WERE NEAR-WHITE IN THE FIRST BUILD AND IT COST REAL CHROMA.
  // 0xdff4f8 renders at S 0.10, and adding it -- plus a neutral wheel rim and a
  // cold headlamp -- took the taxi's area-mean saturation from 0.531 to 0.402
  // and dropped it onto the short-of-target list it had been clearing. That is
  // the exact mechanism the fleet's colour note documents for cream, arriving
  // by a different door: the audit measures an AREA MEAN, so any bright
  // near-neutral drags it to the axis whatever the element is called.
  // These are as bright as they were and carry a hue: S 0.29 and 0.24 against
  // 0.12 and 0.10, which is the same flash for the chroma of a real reflection.
  const GLASS_FLASH = 0xb4dcff;       // for the deep pair, on cool bodies
  const GLASS_FLASH_PALE = 0xc0f0fc;  // for the pale pair, on warm bodies

  function vGlass(parts, w, h, d, x, y, z, pale) {
    const lo = h * 0.52, hi = h * 0.32, fl = h - lo - hi;
    const base = y - h / 2;
    parts.push(gl(hbx(w, lo, d, x, base + lo / 2, z,
      pale ? GLASS_PALE_LO : GLASS_LO), GLOSS.glass));
    parts.push(gl(hbx(w, hi, d, x, base + lo + hi / 2, z,
      pale ? GLASS_PALE_HI : GLASS_HI), GLOSS.glass));
    // Full width and full depth, NOT inset. Insetting it looked better in the
    // rear elevation and put a hole in the object: these glass boxes are solid,
    // and their own side faces are what vPillars below turns into the side
    // windows, so a band 4% narrow leaves a 0.03 slot of nothing down each
    // flank at exactly the height the eye is drawn to.
    parts.push(gl(hbx(w, fl, d, x, base + lo + hi + fl / 2, z,
      pale ? GLASS_FLASH_PALE : GLASS_FLASH), GLOSS.glass));
  }

  /**
   * A AND C PILLARS, replacing the full-depth slab of body colour that used to
   * stand outboard of every greenhouse.
   *
   * This is where the fleet's side glass comes from, and it costs almost
   * nothing because it was already built: the glazing is a solid box banded in
   * three, so its own +/-x faces are already glass in the right three bands. The
   * only reason no vehicle had a side window was that a pillar 0.98 to 1.26
   * deep was parked over the whole of it, flank to flank. Cutting that pillar
   * back to a real 0.24 at each end of the greenhouse uncovers the glass that
   * was there the entire time.
   *
   * It is also the correct shape: a car has an A pillar and a C pillar with
   * daylight between them, and the taper from body to greenhouse only reads as
   * a taper if something shows through the gap.
   */
  function vPillars(parts, w, h, d, x, y, z, col, gloss) {
    const pd = Math.min(0.24, d * 0.32);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(gl(hbx(w, h, pd, sx * x, y, z + sz * (d - pd) / 2, col),
          gloss === undefined ? GLOSS.paint : gloss));
      }
    }
  }

  /**
   * SIDE GLASS, because until this pass there was none anywhere in the fleet.
   *
   * Photographed rather than assumed: api.fleetSheet now takes an azimuth, and
   * at az 90 degrees every vehicle in the game was a blank painted slab. Front
   * and rear glazing existed; the flanks had not one window on any of the ten
   * variants. Under CLAUDE.md rule 1 that is a half-built object, and the flank
   * is not a hypothetical view -- a hazard in an adjacent lane passes 1.70 units
   * from the lens and is the last thing on screen before it leaves the shot.
   *
   * The pane is a thin box standing just inboard of the flank so the body's own
   * edge still draws the window frame, banded exactly like vGlass so a vehicle's
   * side and rear glazing are visibly the same material.
   */
  /**
   * `bodyW` is the width of the mass this window is cut into, and the pane is
   * placed so its outer face stands 0.005 PROUD of that flank rather than
   * inboard of it. The first build inset it by half its own thickness, which
   * buried it inside the bodywork: on the refuse truck the window was drawn,
   * merged, shipped and completely invisible, because a 0.07 pane 0.055 inside
   * a solid body never reaches the surface. It cost nothing and showed nothing,
   * which is the failure mode that does not announce itself.
   */
  function vSideGlass(parts, bodyW, z0, z1, yBot, yTop, pale, proud) {
    const hw = (bodyW * LANE_FIT) / 2;
    const t = 0.07;
    const px = hw + (proud === undefined ? 0.005 : proud) - t / 2;
    const h = yTop - yBot, zc = (z0 + z1) / 2, d = z1 - z0;
    const lo = h * 0.52, hi = h * 0.32, fl = h - lo - hi;
    for (const sx of [-1, 1]) {
      parts.push(gl(bx(t, lo, d, sx * px, yBot + lo / 2, zc,
        pale ? GLASS_PALE_LO : GLASS_LO), GLOSS.glass));
      parts.push(gl(bx(t, hi, d, sx * px, yBot + lo + hi / 2, zc,
        pale ? GLASS_PALE_HI : GLASS_HI), GLOSS.glass));
      parts.push(gl(bx(t, fl, d * 0.97, sx * px, yBot + lo + hi + fl / 2, zc,
        pale ? GLASS_FLASH_PALE : GLASS_FLASH), GLOSS.glass));
    }
  }

  /**
   * THE FRONT END, which did not exist.
   *
   * The same orbit sheet that found the blank flanks found something worse at
   * az 180: every road vehicle in the fleet had a completely featureless front.
   * No grille, no headlamps, no bumper, no number plate -- a flat rectangle of
   * body colour where the whole reason the reference's cars read as cars is a
   * dark grille with two bright lamps in it.
   *
   * This is the mirror of vBumper and vLamps, and it is deliberately built from
   * the same numbers, because a vehicle whose front and rear fittings sit at
   * different heights reads as two different objects from the two ends.
   *
   * `zFront` is the frontmost plane it may reach -- AND IT DID NOT USED TO BE.
   * The headlamp core sat at zf - 0.015 with a depth of 0.10, so it stood
   * 0.035 PROUD of the plane this comment calls a limit, on every road vehicle
   * in the fleet. Nothing measured it until MR.Collision.BOX grew a guard, and
   * then it was the single reason the tram, the taxi and the van all reported
   * a half-depth of 1.955-1.965 against a box of 1.95. Every fitting below now
   * ends at least 0.005 inside zf, and the front-to-back ordering that makes
   * the core stand proud of the lamp and the plate proud of the bumper is kept
   * by moving the whole stack back rather than by letting one piece out.
   */
  function vFront(parts, o) {
    const zf = o.zFront;
    const w = o.w;
    // The grille: the darkest thing on the front, and the element that makes a
    // front a front. Slightly inset in width so body colour frames it.
    parts.push(gl(hbx(w * 0.82, o.grilleH, 0.10, 0, o.grilleY, zf - 0.06, o.dark), GLOSS.trim));
    // Slats, as a few thin bright bars rather than a texture -- at 40 units
    // this is one dark rectangle with a sheen, and at 8 it has structure.
    const nSlat = o.slats === undefined ? 3 : o.slats;
    for (let i = 0; i < nSlat; i++) {
      const fy = o.grilleY - o.grilleH / 2 + o.grilleH * (i + 0.5) / nSlat;
      parts.push(gl(hbx(w * 0.80, o.grilleH * 0.10, 0.04, 0, fy, zf - 0.025, o.crease), GLOSS.chrome));
    }
    // Headlamps. Pale rectangles rather than the round discs the tail lamps
    // use, so front and rear are told apart instantly at any distance, with a
    // hot core exactly as vLamps builds its tail lights.
    for (const sx of [-1, 1]) {
      const px = sx * o.lampX * LANE_FIT;
      parts.push(gl(bx(o.lampW, o.lampH, 0.07, px, o.grilleY, zf - 0.055, LAMP_COLD), GLOSS.chrome));
      parts.push(gl(bx(o.lampW * 0.62, o.lampH * 0.52, 0.10, px, o.grilleY, zf - 0.06, LAMP_CORE), GLOSS.chrome));
      // The indicator, which is the one warm note on a cold front end.
      parts.push(gl(bx(o.lampW * 0.30, o.lampH * 0.42, 0.06,
        px + sx * o.lampW * 0.62, o.grilleY, zf - 0.055, LAMP_AMBER), GLOSS.chrome));
    }
    // Front bumper and plate, mirroring vBumper.
    parts.push(gl(hbx(o.bumpW, o.bumpH, 0.16, 0, o.bumpY, zf - 0.13, o.dark), GLOSS.trim));
    parts.push(gl(hbx(o.plateW || 0.58, o.bumpH * 0.48, 0.06, 0, o.bumpY, zf - 0.045, PLATE), GLOSS.chrome));
  }

  /**
   * A WHEEL THAT CAN BE SEEN, which is the one element of the reference that
   * reads identically from every angle -- the coordinator's note is right about
   * that and it is the argument for making it good.
   *
   * What was there: a near-black cylinder, sitting inside a near-black wheel
   * well, standing on a multiply shadow that darkens the road under it to 0.60.
   * Three darks on top of each other. Measured on the orbit sheet, the tyre was
   * indistinguishable from the arch it sat in at every azimuth.
   *
   * The reference's wheels are one of the HIGHEST-contrast elements on the whole
   * car: a dark tyre, a bright five-spoke rim inside it, and a brighter hub. So
   * the rim is what is added here, and it is added as a face rather than as a
   * modelled spoke set -- from any distance the game can produce, a rim is a
   * bright disc with dark notches in it, and five modelled spokes would be five
   * subpixel slivers that alias into a grey ring.
   *
   * The rim stands 0.012 proud of the tyre's outer face on BOTH sides, so it is
   * there from either flank as well as from the three-quarter views.
   */
  function vWheel(parts, x, y, z, r, w, tyre, rim, hub) {
    const rimC = rim === undefined ? WHEEL_RIM : rim;
    const hubC = hub === undefined ? (rim === undefined ? WHEEL_HUB : WHEEL_HUB_WARM) : hub;
    parts.push(gl(cyl(r, r, w, 16, x, y, z, tyre, 0, 0, Math.PI / 2), GLOSS.trim));
    for (const sx of [-1, 1]) {
      const fx = x + sx * (w / 2 + 0.012);
      parts.push(gl(cyl(r * 0.58, r * 0.58, 0.03, 12, fx, y, z, rimC, 0, 0, Math.PI / 2), GLOSS.chrome));
      parts.push(gl(cyl(r * 0.22, r * 0.22, 0.05, 8, fx, y, z, hubC, 0, 0, Math.PI / 2), GLOSS.chrome));
      // Four spoke gaps, as dark bars across the rim face. Cheaper and far more
      // legible than modelling the spokes: what survives to distance is the
      // broken-up ring, and this is the same trick the arch uses for roundness.
      for (let k = 0; k < 4; k++) {
        parts.push(gl(bx(0.035, r * 0.92, 0.02, fx, y, z, tyre, 0, 0, k * Math.PI / 4), GLOSS.matte));
      }
    }
  }

  /**
   * ============ A WHEEL YOU CAN SEE THROUGH ============
   *
   * vWheel above is a CAR wheel and is right for one: a dark tyre with a rim
   * disc at 0.58 of the radius and a hub inside it, which from any distance
   * this game can produce is a bright disc with dark notches. Put that under a
   * bicycle and you get a motorcycle, and that is not a guess -- a reader shown
   * a 1:1 crop of BLOCK v8 at 8 units, with no idea what the game is, said
   * "two people on motorcycles" and then "escort or outrider motorcyclists".
   * The riders are road cyclists.
   *
   * A bicycle wheel is MOSTLY AIR, and that is the whole of the difference. So
   * this builds the tyre as a ring of segments with the road showing between
   * them, a thin rim inside it, six spokes and a small hub -- the open wheel
   * that no motorcycle has. It is also thin: 0.055 against the car's 0.10.
   *
   * The segments are the same trick vGuard and vCrown use to get a curve out
   * of a box renderer, and the cost is 16 boxes a wheel against 11 for vWheel,
   * on a variant that is not near any budget.
   */
  function vBikeWheel(parts, x, y, z, r, tyre, rim, hub) {
    const W = 0.075;
    const N = 14;
    // TWO RINGS, and the bright one is the point. The first build made the
    // wheel open and dark, and open-and-dark is not a bicycle wheel either --
    // it is a smudge, and it cost this variant 16% of its pixels for nothing.
    // A real wheel is a dark tyre with a BRIGHT RIM immediately inside it, and
    // that bright circle is what carries to thirty-five units; the air is
    // inside the rim, where it belongs.
    for (let k = 0; k < N; k++) {
      const a = (k + 0.5) * Math.PI * 2 / N;
      const ca = Math.cos(a), sa = Math.sin(a);
      parts.push(gl(bx(W, r * 0.30, r * 0.50, x, y + ca * r, z + sa * r, tyre, a), GLOSS.trim));
      parts.push(gl(bx(W * 0.72, r * 0.20, r * 0.48, x, y + ca * r * 0.80, z + sa * r * 0.80,
        rim, a), GLOSS.chrome));
    }
    for (let k = 0; k < 3; k++) {
      parts.push(gl(bx(0.026, r * 1.50, 0.026, x, y, z, rim, k * Math.PI / 3), GLOSS.chrome));
    }
    parts.push(gl(cyl(r * 0.16, r * 0.16, W * 1.8, 8, x, y, z, hub, 0, 0, Math.PI / 2), GLOSS.chrome));
  }

  /**
   * DROP HANDLEBARS -- the one object in the world that is only ever found on
   * a road bicycle, and the second reason v8 read as a motorbike: it had a
   * straight bar with two blobs on it, which is a scooter.
   *
   * The shape is a flat top bar, a hood on each side where the hands go, and a
   * hook that turns down and back under it. Five boxes a side and the profile
   * is unmistakable from the flank and from astern.
   */
  function vDropBars(parts, x, y, z, halfW, col, grip) {
    parts.push(gl(bx(halfW * 2, 0.045, 0.05, x, y, z, col), GLOSS.chrome));
    for (const sx of [-1, 1]) {
      const bxp = x + sx * halfW;
      parts.push(gl(bx(0.05, 0.05, 0.20, bxp, y + 0.005, z + 0.10, grip), GLOSS.trim));
      parts.push(gl(bx(0.05, 0.13, 0.055, bxp, y - 0.07, z + 0.185, col), GLOSS.chrome));
      parts.push(gl(bx(0.05, 0.05, 0.17, bxp, y - 0.125, z + 0.115, col), GLOSS.chrome));
      parts.push(gl(bx(0.05, 0.05, 0.05, bxp, y - 0.115, z + 0.035, grip), GLOSS.trim));
    }
  }

  /**
   * THE ARCH FLARE, and it is the reference's most specific shape note: the
   * wheel arches are cut into the body as curved arcs, with the wheel standing
   * proud below the sill. In reference/sonic-cars-closeup.png the flare is a
   * separate raised lip standing outboard of the flank, catching its own light.
   *
   * Built as a ring of small boxes following the arc, exactly as vCrown follows
   * the bus roof -- the file's established way of getting a curve out of a box
   * renderer. It stands outboard of the flank, so it reads as a flare from the
   * flank and as a notch from behind.
   */
  /**
   * THE SAME LIP, TURNED THROUGH NINETY DEGREES, and the reason there are now
   * two of these is the reason this whole pass exists.
   *
   * vArchFlare arcs in X-Y because the old vUnder cut its opening in X-Y --
   * correctly, when a BLOCK was 1.30 deep and the rear face WAS the flank. At
   * 3.90 that is no longer true: a car's wheel opening is a hole in its SIDE,
   * a car's tail is a bumper with no arch in it at all, and an arch cut across
   * the rear face of a 3.90-long vehicle would be a slot running the whole
   * length of the underbody with the road showing through it.
   *
   * So the opening moved into the Z-Y plane (see vUnder) and the lip that
   * trims it had to move with it. The comment on vArchFlare is kept verbatim
   * above because it names exactly this mistake in the other direction, and
   * both functions survive: the short variants still cut in X-Y.
   *
   * `sx` is which flank, so the lip stands proud OUTBOARD on both -- the whole
   * point of a flare is that it catches its own light from the side, and a lip
   * on one flank would be visible as missing the moment the camera passed.
   */
  function vArchLip(parts, cx, cy, cz, r, col, segs) {
    const n = segs || 10;
    const t = 0.085;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.04 + 0.92 * (i + 0.5) / n);
      const pz = cz + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      // Tangential about x, so the ring turns as one lip: rotation.x carries
      // the y-z plane, which is the plane the arc is drawn in.
      parts.push(gl(bx(0.09, t, (Math.PI * r * 1.10) / n, cx, py, pz, col,
        -(a - Math.PI / 2)), GLOSS.paint));
    }
  }

  /**
   * A MUDGUARD -- an arc of slabs in the Y-Z plane, hugging a wheel that turns
   * about x, at the full width of the tyre it covers.
   *
   * vArchLip above draws the same arc and is NOT this: it is 0.09 wide because
   * it is a LIP standing proud of a flank, which is a car's wheel arch seen
   * edge-on. A guard is a separate object sitting OVER a wheel, and on a
   * two-wheeler it is the single most nameable thing in the rear elevation --
   * it is what turns a dark disc under a body into a wheel with something over
   * it. Measured on the gameplay-framing sheet: the moped's rear tyre owns 5.7%
   * of its pixels and reads as a smudge, because there is nothing above it to
   * say what it is.
   *
   * `a` runs the way vArchLip's does: 0 is straight ahead at +z, PI/2 is the
   * crown, PI is straight astern. Both ends are open slabs rather than a capped
   * shell, which is correct here -- a real guard is a pressing of constant
   * section and its ends are its ends -- and every slab is a solid box, so the
   * object is built from underneath and from either flank as well as from
   * behind.
   */
  function vGuard(parts, x, cy, cz, r, w, col, a0, a1, segs, gloss) {
    const n = segs || 7;
    const t = 0.055;
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i + 0.5) / n;
      parts.push(gl(bx(w, t, (Math.abs(a1 - a0) * r * 1.16) / n,
        x, cy + Math.sin(a) * r, cz + Math.cos(a) * r, col, -(a - Math.PI / 2)),
      gloss === undefined ? GLOSS.paint : gloss));
    }
  }

  function vArchFlare(parts, cx, cy, cz, r, col, segs) {
    const n = segs || 9;
    const t = 0.085;
    // The arc is in the X-Y plane, because that is the plane vUnder actually
    // cuts its opening in: the skirt is emitted as columns along x whose lower
    // edge lifts on a circle about (wheelX, spring). Arcing this in Y-Z instead
    // would have drawn a beautifully turned lip at ninety degrees to the hole
    // it was supposed to be trimming -- which is the class of mistake this file
    // keeps a corrections list for, and it was in the first draft of this
    // function.
    for (let i = 0; i < n; i++) {
      // The upper half only: an arch, not a wheel surround.
      const a = Math.PI * (0.05 + 0.90 * (i + 0.5) / n);
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      // Tangential, so the ring reads as one turned lip rather than as a row
      // of blocks: at the crown the long axis is along x, at the ends along y.
      parts.push(gl(bx((Math.PI * r * 1.10) / n, t, 0.09, px, py, cz, col, 0, 0, a - Math.PI / 2), GLOSS.paint));
    }
  }

  /**
   * Round two-part tail lamps, a pair, at +/-x.
   *
   * Discs facing the lens, not boxes: `cyl` with rx = PI/2 puts the cylinder's
   * axis along z, so what the chase camera sees is the circular cap. A near
   * white core inside a red surround measures 2.40x through this renderer,
   * against the reference's headlamp-to-body 1.3x to 3.4x, and a 0.34 lamp on a
   * 2.20 body is 15% of the width against the reference's measured 10-16%.
   *
   * `zRear` is the rearmost plane the lamp may reach -- the core sits exactly on
   * it and the surround 0.02 behind, so the core stands proud and neither
   * crosses the hazard's own half-depth.
   *
   * 32 triangles an 8-segment disc, 128 for the four.
   */
  function vLamps(parts, x, y, zRear, r, surround) {
    const hue = surround === undefined ? LAMP_RED : surround;
    for (const sx of [-1, 1]) {
      const px = sx * x * LANE_FIT;
      parts.push(cyl(r, r, 0.10, 8, px, y, zRear + 0.07, hue, Math.PI / 2));
      parts.push(cyl(r * 0.53, r * 0.53, 0.13, 8, px, y, zRear + 0.065, LAMP_CORE, Math.PI / 2));
    }
  }

  /**
   * The dark bumper at the very bottom of the body, and the pale number plate
   * on it.
   *
   * Measured on the reference: the bumper is a dark neutral at the bottom, full
   * body width, 13-15% of the face height, at 0.61x to 0.70x the luminance of
   * the road it stands on. It always carries a pale plate, which measures 1.7x
   * to 2.8x the bumper it sits on and is the lowest bright thing on the vehicle
   * -- what tells the eye where the body's bottom edge is once the contact
   * shadow has washed out. Ours is 6.5x, because our darks are darker.
   *
   * The bumper's own hue is a dark version of the vehicle's OWN body colour, not
   * a shared neutral: the contrast audit measures an area mean, so a shared grey
   * bar on seven vehicles would put 13% of neutral back into every one of them.
   *
   * +12 authored for the plate; moving and recolouring the bar is free.
   */
  function vBumper(parts, w, h, y, zRear, dark, plateW) {
    parts.push(hbx(w, h, 0.16, 0, y, zRear + 0.11, dark));
    parts.push(hbx(plateW || 0.58, h * 0.48, 0.06, 0, y, zRear + 0.03, PLATE));
  }

  /**
   * ============ THE UNDERBODY ============
   *
   * What replaced a sill, a flat arch lip and two bare cylinders, and the
   * reason it had to.
   *
   * THE DEFECT, seen at gameplay scale and not before. The old underbody was a
   * narrow sill spanning only BETWEEN the wheels, a 0.09-tall flat lip over
   * each tyre, and a cylinder about x under each. From the chase camera that
   * composites into: a straight horizontal lower edge across the whole body,
   * two dark rectangles hanging below it, and LIT ROAD in the gaps between and
   * outboard of them. That is a table. It is the owner's "they look like boxes
   * and not actual vehicles", and at 15 units it is the loudest thing about
   * the fleet.
   *
   * Two separate mistakes made it, and the file's own comments asserted the
   * opposite of both:
   *
   *   "round wheels ... the chase camera sees the curved rear tread and the
   *     bottom of the wheel is round" -- it does not. A cylinder about x, seen
   *     from behind, is viewed PERPENDICULAR to its axis, so its silhouette is
   *     the barrel: a rectangle, with a straight bottom edge. The roundness of
   *     a cylinder about x is only ever visible from the side, which is the one
   *     angle this game does not have. The tyres were rectangles the whole time.
   *   "every road vehicle here shows daylight between its underframe and the
   *     tarmac, with wheels in it" -- the reference does not. In tgr-traffic
   *     and tgr-taxi-street every vehicle's underside is a continuous DARK
   *     mass that merges into its contact shadow. Lit road is never seen
   *     through a vehicle, and seeing it is exactly what turns an underframe
   *     into a pair of legs.
   *
   * WHAT THIS BUILDS INSTEAD, and each piece answers one of those:
   *
   *   A SKIRT ACROSS THE FULL BODY WIDTH, down to a small shadow gap above the
   *     road, so the body has a bottom edge instead of a pair of posts.
   *   A REAL ARCH CUT INTO IT. The skirt is emitted as columns whose lower edge
   *     lifts along a circle over each tyre, so the body's lower outline is
   *     notched upward by a genuine curve. That is the silhouette fact the old
   *     flat lip only claimed: a straight-sided opening cannot notch anything.
   *   A WHEEL WELL behind the opening, so what is seen beside the tyre inside
   *     the arch is a dark recess rather than the road behind the vehicle.
   *   A SHADOW PANEL between the arches, so the space under the vehicle is
   *     dark. This is the piece that stops it reading as a table.
   *
   * The tyre stays a cylinder about x, because that IS its axis and the arch
   * above it is now what carries the round read -- which is how the reference
   * does it too, and it survives to distance where a tread never would.
   *
   * THE SKIRT IS THE VEHICLE'S OWN MID TONE, not its dark, and that is a
   * contrast finding rather than a styling one. Built first in each body's
   * DARK, the skirt added enough near-black area low on the object to drag the
   * bus's area mean from L 101 to L 94 and push it under the audit's 1.6x
   * target -- a colour regression bought with a shape fix, which is the trade
   * the last two passes kept making in the other direction. The crease hue
   * holds the value step against the body above it, keeps the chroma the
   * colour pass bought, and is what the reference actually shows: a bus is
   * painted down to a thin black bumper, not blacked out from the waist.
   * The dark is spent where it earns its keep instead -- inside the arch,
   * where a near-black recess is what makes the opening read as an opening.
   *
   * COST. The skirt is `cols` columns mirrored, so 2 x cols boxes; at the
   * default 26 that is ~624 triangles a vehicle, plus a 16-segment tyre pair
   * (~128) and two wells. Call it 900 against the old 130. All of it merges
   * into the variant's single geometry, so it costs ZERO extra draw calls --
   * which is the budget that actually binds here.
   */
  /**
   * ============ AND THEN THE ENVELOPE GREW, SO IT WAS REBUILT ============
   *
   * Everything above is still true and none of it is thrown away. What changed
   * is the axis the opening is cut on.
   *
   * The old build emitted the skirt as COLUMNS ALONG X and lifted each
   * column's lower edge on a circle -- so the wheel opening was an arch in the
   * X-Y plane, running the full depth of the vehicle. At 1.30 deep that is
   * exactly right, because at 1.30 deep the rear face IS the flank: there is
   * no third dimension to be wrong about.
   *
   * At 3.90 it is wrong twice over. A wheel opening cut in X-Y and extruded
   * 3.90 along z is a SLOT down the whole length of the underbody with lit
   * road showing through it -- the precise defect the header above was written
   * to kill, reintroduced by the same code that killed it. And a car's tail
   * has no wheel arch in it at all: what you see from directly behind is a
   * bumper and a valance, and the arches are on the sides.
   *
   * So the opening is now cut in Z-Y, about each axle, and only in the x band
   * the tyre occupies. That gives the reference's actual shape note -- "wheel
   * arches cut into the body as curved arcs, with the wheels protruding below
   * the sill" -- on the flank, which at 3.90 is most of what a vehicle in the
   * next lane shows. See vArchLip for the trim that follows the new arc.
   *
   * TWO AXLES, WHICH IS WHAT THE DEPTH WAS RENEGOTIATED FOR. The note that
   * used to stand here said one axle was the envelope's doing and not a
   * choice: 1.30 of depth against tyres 0.60-0.72 across left 0.04-0.10
   * between the front and rear tyre, so every car in this game was a tracked
   * vehicle. At 3.90 a 1.90 wheelbase leaves 1.30 of daylight between the
   * tyres and the question does not arise.
   *
   * COST. Three x-runs a side rather than 26 columns -- the arch is cut in z
   * now, so x needs no resolution at all beyond "is this the wheel band" --
   * and the arch runs are sliced only across the two 0.8-unit windows the
   * openings occupy. About 50 boxes a vehicle against the old 52, for four
   * wheels instead of two and an opening that is actually an opening.
   */
  function vUnder(parts, o) {
    const halfW = (o.bodyW * LANE_FIT) / 2;
    const wx = o.wheelX * LANE_FIT;                       // wheel centre, world
    const r = o.wheelR;
    const tw = o.wheelW;
    // The opening's half-width ACROSS the vehicle hugs the tyre: the tyre's
    // own half-width plus a little clearance, never the tyre's radius. An
    // opening a full diameter across is a hole with a rectangle in the middle.
    const xw = tw * (o.dual ? 1 : 0.5) + (o.archPad === undefined ? 0.09 : o.archPad);
    // The opening's radius ALONG the vehicle, which is the arc the eye reads
    // as a wheel arch. It clears the tyre it trims, so it comes off the wheel
    // radius and not off the wheel width.
    const ar = o.archR === undefined ? r + 0.12 : o.archR;
    const bot = o.skirtBot;                               // shadow gap above the road
    const top = o.skirtTop;
    // Where the arc springs from. The opening's top lands at spring + ar.
    const spring = o.spring === undefined ? bot + 0.04 : o.spring;
    const z0 = o.z0, z1 = o.z1;
    const axles = o.axles;

    // How high the skirt has been cut away at z. bot everywhere except across
    // an opening, where it follows the arc.
    function lowAt(z) {
      let low = bot;
      for (const az of axles) {
        const dz = Math.abs(z - az);
        if (dz < ar) low = Math.max(low, spring + Math.sqrt(ar * ar - dz * dz));
      }
      return low;
    }
    // A run of skirt between two x, at whatever the arch leaves of it.
    function run(xa, xb, arched) {
      if (xb - xa < 0.005) return;
      const w = xb - xa, xc = (xa + xb) / 2;
      if (!arched) {
        for (const sx of [-1, 1]) {
          parts.push(gl(bx(w, top - bot, z1 - z0, sx * xc, (top + bot) / 2, (z0 + z1) / 2, o.skirt), GLOSS.paint));
        }
        return;
      }
      // Stations: the two ends, plus a fine sampling across each opening. The
      // flat stretches between them collapse to one box each, which is why
      // this costs about what the old full-width column set cost.
      const SEG = 9;
      const st = [z0, z1];
      for (const az of axles) {
        for (let i = 0; i <= SEG; i++) st.push(az - ar + (2 * ar * i) / SEG);
      }
      const zs = st.filter((z) => z > z0 + 1e-6 && z < z1 - 1e-6).concat([z0, z1])
        .sort((a, b) => a - b);
      for (let i = 0; i < zs.length - 1; i++) {
        const a = zs[i], b = zs[i + 1];
        if (b - a < 0.004) continue;
        const low = lowAt((a + b) / 2);
        if (low >= top - 0.005) continue;
        for (const sx of [-1, 1]) {
          // 1.02 so neighbouring slices overlap a hair and the ink shell
          // cannot find a seam between them.
          parts.push(gl(bx(w, top - low, (b - a) * 1.02, sx * xc, (top + low) / 2, (a + b) / 2, o.skirt), GLOSS.paint));
        }
      }
    }
    run(0, Math.max(0, wx - xw), false);
    run(Math.max(0, wx - xw), Math.min(halfW, wx + xw), true);
    run(Math.min(halfW, wx + xw), halfW, false);

    // The recess behind each opening. Inboard of the tyre's outer face, so the
    // tyre stands in FRONT of it from the flank and what is seen beside the
    // tyre inside the arch is a dark hole rather than the road behind.
    for (const sx of [-1, 1]) {
      for (const az of axles) {
        const xi = Math.max(0, wx - xw), xo = wx + tw * 0.5 - 0.02;
        parts.push(bx(xo - xi, spring + ar, 2 * ar * 0.92, sx * (xi + xo) / 2,
          (spring + ar) / 2, az, o.under));
      }
    }
    // The shadow between the arches, which is the piece that stops the vehicle
    // reading as a table: the space under it is dark for its whole length, not
    // lit road seen between two posts. Deliberately NO panel closing the last
    // `skirtBot` above the road at the FLANKS -- that sliver is how a bus is
    // told from a tram from directly behind, and the contact quad has already
    // darkened it to 0.60 of the road.
    parts.push(bx(2 * Math.max(0.05, wx - xw * 0.2), spring + ar * 0.6, (z1 - z0) * 0.99,
      0, (spring + ar * 0.6) / 2, (z0 + z1) / 2, o.under));

    // The tyres, in front of their wells. 16 segments: the arch is what reads
    // at distance, but at 15 units the tyre is ~20px and octagons show.
    for (const sx of [-1, 1]) {
      for (const az of axles) {
        if (o.dual && az === axles[0]) {
          // Twin REAR tyres, which no other vehicle in the fleet has and which
          // a rear loader always does -- and only on the rear axle, because
          // that is where a real one carries them. Charging both axles for it
          // was never possible before: there was only one axle.
          for (const k of [-1, 1]) {
            vWheel(parts, sx * wx + k * tw * 0.56, r, az, r, tw * 0.86, o.tyre, o.rim, o.hub);
          }
        } else {
          vWheel(parts, sx * wx, r, az, r, tw, o.tyre, o.rim, o.hub);
        }
        // The lip over the opening, on BOTH flanks, standing proud of each.
        if (o.flare !== false) {
          vArchLip(parts, sx * (halfW - 0.015), spring, az, ar + 0.055, o.flareCol || o.skirt);
        }
      }
    }
  }

  /**
   * A GENUINELY CURVED CROWN, for the one vehicle whose roofline is a curve.
   *
   * `vRoof` below steps in twice, which is a chamfer: at gameplay scale it is a
   * square corner with a nick in it, and six of the fleet wear it, so it is a
   * shared feature rather than a distinguishing one. A city bus's roof is an
   * arc from flank to flank, and that arc is the single most nameable thing
   * about a bus seen from directly behind -- it is what `tgr-bus-front` and the
   * distant bus in `tgr-traffic` both read by before any of their detail
   * resolves.
   *
   * Emitted as `segs` columns whose top follows a circular arc, mirrored about
   * the centreline. 14 segments is ~336 triangles, which buys the fleet's only
   * curved roofline; the old chamfer cost 24 and bought a shape six other
   * variants already had.
   *
   * `rise` is how far the crown's centre stands above `y`, and the caller is
   * responsible for `y + rise` staying inside the 2.80 a BLOCK may reach.
   */
  function vCrown(parts, w, d, y, z, rise, segs, col) {
    const halfW = (w * LANE_FIT) / 2;
    const n = segs || 14;
    const step = halfW / n;
    for (let i = 0; i < n; i++) {
      const xc = (i + 0.5) * step;
      const t = xc / halfW;
      const h = rise * Math.sqrt(Math.max(0, 1 - t * t));
      if (h <= 0.004) continue;
      for (const sx of [-1, 1]) {
        parts.push(bx(step * 1.02, h, d * (0.94 - 0.06 * t), sx * xc, y + h / 2, z, col));
      }
    }
  }

  /**
   * A roof that steps in twice instead of ending in a square corner. The tram
   * has done this since it was built ("chamfered crown") and it is the best
   * looking thing in the old fleet; this is that, for everyone.
   *
   * `y` is the top of the header the chamfer sits on. +24 authored.
   */
  function vRoof(parts, w, d, y, z, c1, c2) {
    parts.push(hbx(w * 0.91, 0.07, d * 0.90, 0, y + 0.035, z, c1));
    parts.push(hbx(w * 0.78, 0.06, d * 0.76, 0, y + 0.10, z, c2));
  }

  /**
   * ======================= THE FIGURE KIT =======================
   *
   * Every human being in this game except the runner and the ghost is built
   * from this: the marshals, the cyclists, the trike's rider, the moped's, the
   * pavement walkers, the roadside knots, the grandstands and the finish
   * arena. One system, so a spectator and a marshal are the same animal at
   * different distances instead of two unrelated piles of boxes.
   *
   * ---- THE TIERS ARE MEASURED, NOT CHOSEN --------------------------------
   *
   * tools/people.js projects every head in the live scene through the live
   * chase camera and reports its real screen box, plus the pixels it actually
   * draws once everything in front of it has been drawn. What it found:
   *
   *   figure                    head px       eye mark   rendered
   *   BLOCK v3 marshals @8u     27.1 x 25.4     2.76 px      --
   *   BLOCK v2 trike rider @8u  21.5 x 24.5     2.75 px      --
   *   finish stand, front row   21.4 wide       3.92 px    878/frame
   *   BLOCK v8 cyclists @8u     17.0 x 14.2     2.75 px      --
   *   BLOCK v3 marshals @20u    13.9 x 12.8     1.42 px      --
   *   pavement walkers          6.8 best, 1.5-4.3 median     34/frame
   *   roadside crowd knots      10.1 best, 1.5 MEDIAN        91/frame
   *   grandstand                2.2 best, 1.0 MEDIAN         36/frame
   *
   * The eye mark is a 0.055-unit feature projected at that head's own depth.
   * Under about 1.2 px a feature lands inside one pixel and is averaged into
   * its neighbour -- a smudge, not an eye.
   *
   * SO A SPECTATOR'S FACE IS 1.5 PIXELS WIDE AND DRAWS 2.3 OF THEM. Ninety-one
   * pixels of head, shared between forty heads, is the entire budget for every
   * face in a roadside knot. There is no eye that can be put there, and the
   * owner's own instruction covers it: they can be much lower-detail because
   * they are farther away. The effort goes into silhouette and motion instead,
   * which is what survives to 90 units, and that is a better answer than a
   * face nobody can see.
   *
   *   FACE   head over ~15 px: eyes, brows, nose, mouth, ears, hair. The four
   *          hazard figures and the finish stand's front two rows.
   *   BODY   head 5-15 px: the whole articulated figure -- neck, shoulders,
   *          upper arm, forearm, hand, hips, thigh, shin, foot -- with hair
   *          and ears but no facial marks. The pavement walkers.
   *   READ   head under 5 px: head, torso, two arms, two legs, and the joints
   *          that keep the silhouette from welding into a lump. The knots and
   *          the stands.
   *
   * ---- RULE 1, AND WHY A FACE IS NOT AN EXCEPTION TO IT -------------------
   *
   * The head is a closed solid built on all sides: skull, back of skull, hair
   * over the crown and down the back, and an ear on each side. The eyes, brows,
   * nose and mouth are on the front because that is where a person's are, which
   * is anatomy and not a detail budget. Nothing here is hollow and nothing is
   * omitted because the chase camera starts behind: the cyclists ride AWAY from
   * the lens and get their faces anyway, because the pass, the lane change and
   * the finish framing all show them.
   *
   * ---- DRAW CALLS ---------------------------------------------------------
   *
   * Zero. Every figure this builds is pushed into a caller's part list and
   * merged, so a hundred people are one submission exactly as before. What it
   * costs is triangles, which is the resource this project has 296,000 spare
   * of.
   */
  const FIG = {
    // One dark for every facial mark. Not black: a pure black mark on a
    // 3-band toon ramp is the only value in the frame with no shading at all
    // and it reads as a hole punched in the head.
    ink: 0x2a2036,
    /**
     * SEVEN HAIRS AND FOUR SKINS, AND THE PAIRING IS NOT RANDOM.
     *
     * The last two entries are grey and white, and they are what carries AGE
     * -- the owner asked for varied age impression, and at 20 px of head there
     * is no wrinkle available, so age is hair colour, hairline and stoop. A
     * crowd where nobody is over thirty is a crowd that looks generated.
     */
    hair: [0x241a14, 0x4a2c18, 0x7a4a22, 0x141420, 0xb07838, 0x8a8496, 0xd6d0c4],
    skin: [0xffc79a, 0xe0a173, 0xb87a4e, 0x8a5a3c],
  };

  /**
   * A HEAD, at whatever size the caller's figure wants one.
   *
   * o.fz is which way the face points in the caller's own z: -1 is toward the
   * chase camera (a marshal facing the oncoming runner), +1 is away from it (a
   * cyclist being overtaken). Both get the same face.
   *
   * The variation the owner asked for is all here and all seeded by the
   * caller: face shape through w/h/d, eye shape through eyeH, eyebrow shape
   * through browTilt, hairstyle through style, age through the hair colour and
   * the hairline. Two figures built with the same numbers are the same person;
   * nothing else in this file is allowed to be.
   */
  function vHead(parts, o) {
    const P = o.wrap || function (p) { return p; };
    const w = o.w, h = o.h, d = o.d === undefined ? o.w * 0.92 : o.d;
    const x = o.x, y = o.y, z = o.z;
    const fz = o.fz === undefined ? -1 : o.fz;
    const front = z + fz * d / 2;
    const skin = o.skin, hair = o.hair;
    const face = o.face !== false;
    const style = (o.style || 0) % 6;

    // ---- the skull ------------------------------------------------------
    // Chamfered, because a square-cornered head is the single loudest thing
    // that says "box with a face drawn on it" -- and the chamfer is what makes
    // the crown read as round from the side and from behind.
    parts.push(P(cbx(w, h, d, x, y, z, skin, Math.min(0.075, w * 0.16)), 'head'));
    // A jaw, narrower and shorter than the skull. This is most of what face
    // SHAPE is at twenty pixels: a wide jaw is a heavy face, a narrow one is
    // a young one, and the caller varies it.
    const jw = w * (o.jaw === undefined ? 0.82 : o.jaw);
    parts.push(P(cbx(jw, h * 0.34, d * 0.90, x, y - h * 0.40, z + fz * d * 0.03, skin, 0.03), 'head'));

    // ---- ears, both sides, always ---------------------------------------
    for (const sx of [-1, 1]) {
      parts.push(P(bx(w * 0.09, h * 0.30, d * 0.24, x + sx * (w * 0.50), y - h * 0.02,
        z - fz * d * 0.04, skin), 'head'));
    }

    // ---- hair -----------------------------------------------------------
    // A cap over the crown and DOWN THE BACK, so the head is built behind as
    // well as in front. Style 5 is a receding hairline: the cap sits back off
    // the brow and the sides are kept, which at this size is the whole of
    // "this person is older" together with a grey from FIG.hair.
    const recede = style === 5 ? 0.30 : 0;
    parts.push(P(cbx(w * 1.04, h * 0.30, d * 1.05, x, y + h * 0.38,
      z - fz * d * recede * 0.5, hair, 0.04), 'head'));
    parts.push(P(bx(w * 1.03, h * 0.44, d * 0.20, x, y + h * 0.10,
      z - fz * (d * 0.46), hair), 'head'));
    if (style === 0) {
      // A fringe across the brow.
      parts.push(P(bx(w * 0.94, h * 0.14, d * 0.16, x, y + h * 0.27, front - fz * 0.01, hair), 'head'));
    } else if (style === 1) {
      // Long, down past the jaw on both sides.
      for (const sx of [-1, 1]) {
        parts.push(P(bx(w * 0.16, h * 0.62, d * 0.86, x + sx * (w * 0.50), y - h * 0.14, z, hair), 'head'));
      }
    } else if (style === 2) {
      // A bun or a topknot.
      parts.push(P(sph(w * 0.30, 6, x, y + h * 0.62, z - fz * d * 0.22, hair), 'head'));
    } else if (style === 3) {
      // Cropped: nothing but the cap, which is already there. The absence is
      // the style, and it is what stops every head having a silhouette.
      parts.push(P(bx(w * 0.90, h * 0.10, d * 0.90, x, y + h * 0.22, z, hair), 'head'));
    } else if (style === 4) {
      // A ponytail off the back -- the one style that changes the silhouette
      // from directly astern, which is the view this game spends most of its
      // time in.
      parts.push(P(bx(w * 0.22, h * 0.52, d * 0.20, x, y - h * 0.02,
        z - fz * (d * 0.62), hair), 'head'));
    }

    if (!face) return;

    // ---- the face -------------------------------------------------------
    // Everything below is authored as a fraction of the head, so one set of
    // numbers works on a 0.28 spectator and a 0.54 marshal.
    const eyeY = y + h * 0.06;
    const eyeX = w * 0.21;
    const eyeH = h * (o.eyeH === undefined ? 0.13 : o.eyeH);
    const proud = fz * 0.006;
    for (const sx of [-1, 1]) {
      // The white of the eye first, then the pupil inside it. Two marks and
      // not one, because a single dark blob at this size reads as a socket and
      // a bright surround is what makes it read as looking at something.
      parts.push(P(bx(w * 0.20, eyeH, 0.02, x + sx * eyeX, eyeY, front + proud, 0xf6f2e0), 'head'));
      parts.push(P(bx(w * 0.095, eyeH * 0.86, 0.02, x + sx * (eyeX + w * 0.02), eyeY,
        front + proud * 2, FIG.ink), 'head'));
      // The brow. Its TILT is the whole of the expression at this size --
      // outer-end-up reads as open, inner-end-down reads as set, and the
      // caller rolls it. A crowd of identical brows is a crowd of one person.
      parts.push(P(bx(w * 0.26, h * 0.075, 0.02, x + sx * eyeX, y + h * 0.20, front + proud,
        o.brow === undefined ? hair : o.brow, 0, 0, sx * (o.browTilt || 0)), 'head'));
    }
    // The nose, proud of the face, with a real depth -- it is the one feature
    // that is a SHAPE rather than a mark, and it is the one that survives to
    // the largest angle off axis, because it is still there in profile.
    parts.push(P(bx(w * 0.13, h * 0.24, d * 0.13, x, y - h * 0.05,
      front + fz * (d * 0.055), skin), 'head'));
    // The mouth. Width varies with the caller so a face can be set or open.
    parts.push(P(bx(w * (o.mouth === undefined ? 0.30 : o.mouth), h * 0.06, 0.02,
      x, y - h * 0.30, front + proud, FIG.ink), 'head'));
  }

  /**
   * ONE PERSON: head, neck, shoulders, arms with elbows, hands, torso, hips,
   * legs with knees, feet -- the list the brief asks for, at the tier the
   * measurement allows.
   *
   * Poses are given as angles, in radians, and are the whole reason this is a
   * function rather than a template. o.pose is one of the named stances at the
   * bottom of this comment, or the caller supplies its own limb angles.
   *
   *   arm[0..1]   shoulder pitch, per arm. Negative swings the hand forward.
   *   fore[0..1]  elbow bend, per arm.
   *   leg[0..1]   hip pitch, per leg.
   *   knee[0..1]  knee bend, per leg.
   *   lean        torso pitch. A crouched cyclist and an upright marshal are
   *               the same figure with a different number here.
   *
   * o.wrap(part, role) is applied to every part, so a caller can tag the whole
   * figure for the crowd wave with a different amplitude on the arms than on
   * the feet, or hand it a gloss level, or do nothing at all.
   */
  function vFigure(parts, o) {
    const P = o.wrap || function (p) { return p; };
    const S = o.h === undefined ? 1 : o.h;          // overall height scale
    const x = o.x, z = o.z, y0 = o.y || 0;
    const tier = o.tier === undefined ? 2 : o.tier; // 0 READ, 1 BODY, 2 FACE
    const fz = o.fz === undefined ? -1 : o.fz;
    const skin = o.skin, top = o.top, leg = o.legCol, shoe = o.shoe || 0x2a2230;
    const bw = (o.build === undefined ? 1 : o.build);   // body width scale
    const arm = o.arm || [0, 0], fore = o.fore || [0, 0];
    const hip = o.leg || [0, 0], knee = o.knee || [0, 0];
    const lean = o.lean || 0;

    // Proportions, as fractions of standing height. These are the numbers that
    // make a stack of boxes read as a person rather than as a snowman, and
    // they are a real figure's: the head is a seventh of the height, the hip
    // is at 0.52, the shoulder at 0.82.
    const H = 1.74 * S;
    const headW = 0.250 * S * (o.headW === undefined ? 1 : o.headW);
    const headH = 0.262 * S * (o.headH === undefined ? 1 : o.headH);
    // Kept as the reference an unleaned shoulder is trimmed back to; see shY.
    const shoulderY = y0 + H * 0.815;
    const hipY = y0 + H * 0.505;
    const shW = 0.52 * S * bw;

    // ---- legs -----------------------------------------------------------
    // Thigh and shin as two segments about a knee, so a figure can stand
    // mid-stride, sit, or drive a pedal. One slab of navy is not a pair of
    // legs and never was.
    //
    // o.legs === false draws none, and 'thigh' draws the top segment only.
    // Both exist for the riders: a cyclist's shins and feet are the MOVING
    // part on the variant's own pivot, so the static mesh must stop at the
    // knee or the leg is drawn twice and the pedalling reads as a smear.
    const thighL = H * 0.26, shinL = H * 0.24;
    const legMode = o.legs === undefined ? true : o.legs;
    for (let s = 0; s < 2 && legMode; s++) {
      const sx = s ? 1 : -1;
      const lx = x + sx * 0.122 * S * bw;
      const a = hip[s] || 0, b = (knee[s] || 0);
      // Thigh, hung from the hip and pitched.
      const tcy = hipY - Math.cos(a) * thighL / 2;
      const tcz = z + Math.sin(a) * thighL / 2 * fz;
      parts.push(P(bx(0.158 * S * bw, thighL, 0.190 * S, lx, tcy, tcz, leg, a * -fz), 'leg'));
      if (legMode === 'thigh') continue;
      // Knee to ankle.
      const kx = lx, ky = hipY - Math.cos(a) * thighL, kz = z + Math.sin(a) * thighL * fz;
      const c = a + b;
      const scy = ky - Math.cos(c) * shinL / 2;
      const scz = kz + Math.sin(c) * shinL / 2 * fz;
      parts.push(P(bx(0.132 * S * bw, shinL, 0.158 * S, kx, scy, scz, o.shin || leg, c * -fz), 'leg'));
      // Foot, flat on the ground under the ankle. A leg that ends in a shin is
      // a peg, and the foot is what puts the figure ON the pavement.
      const ay = ky - Math.cos(c) * shinL, az = kz + Math.sin(c) * shinL * fz;
      // The toe points the way the figure faces, which is the only thing that
      // tells a standing person from a person standing backwards.
      parts.push(P(bx(0.152 * S, 0.082 * S, 0.265 * S, kx, ay + 0.035 * S,
        az + fz * 0.055 * S, shoe), 'foot'));
    }

    // ---- hips and torso -------------------------------------------------
    // The hips are their own block and NARROWER than the chest. That one step
    // is most of what makes a torso read as a body: a single box from shoulder
    // to thigh is a fridge.
    parts.push(P(bx(shW * 0.80, H * 0.105, 0.235 * S, x, hipY + H * 0.045, z,
      o.hipCol || leg), 'torso'));
    const torsoH = H * 0.265;
    const tcy = hipY + H * 0.085 + Math.cos(lean) * torsoH / 2;
    const tcz = z + Math.sin(lean) * torsoH / 2 * fz;
    parts.push(P(bx(shW * 0.90, torsoH, 0.250 * S, x, tcy, tcz, top, lean * -fz), 'torso'));
    // Shoulders: a wider, shallower block on top of the chest. It is what
    // gives the figure a yoke to hang arms from, and it is the difference
    // between a person and a bottle.
    //
    // THE SHOULDER RIDES ON THE TORSO'S FAR END, not at a fixed height. The
    // first version pinned it to the upright shoulder line and let the chest
    // rotate underneath, which is fine at the 0.34 rad a spectator leans and
    // absurd at the 1.15 a road cyclist does: the head and both arms hang in
    // the air above a torso that has gone forward without them. The -0.04H
    // trim is what keeps an UNLEANED figure's shoulder at the 0.815 of height
    // a real one sits at, so nothing that was upright moved.
    const shY = hipY + H * 0.085 + Math.cos(lean) * torsoH - H * 0.04;
    const shZ = z + Math.sin(lean) * torsoH * fz;
    parts.push(P(bx(shW, H * 0.062, 0.240 * S, x, shY, shZ, o.shoulder || top), 'torso'));

    // ---- neck and head --------------------------------------------------
    const neckY = shY + H * 0.045;
    parts.push(P(bx(0.125 * S, H * 0.045, 0.125 * S, x, neckY, shZ, skin), 'head'));
    const headY = neckY + H * 0.028 + headH / 2;
    vHead(parts, {
      w: headW, h: headH, d: headW * 0.92,
      x: x, y: headY, z: shZ + (o.headZ || 0), fz: fz,
      skin: skin, hair: o.hair, style: o.style, face: tier >= 2 && o.face !== false,
      eyeH: o.eyeH, browTilt: o.browTilt, brow: o.brow, mouth: o.mouth, jaw: o.jaw,
      wrap: P,
    });

    // ---- arms -----------------------------------------------------------
    // Upper arm and forearm about an elbow, with a hand on the end. At tier 0
    // the two segments are merged into one, because a 1.5 px head does not
    // have an elbow either -- but the ARM ANGLE is kept, since that is what
    // the silhouette is made of and it costs nothing.
    const upperL = H * 0.185, foreL = H * 0.165;
    for (let s = 0; s < 2; s++) {
      const sx = s ? 1 : -1;
      const ax = x + sx * (shW / 2 - 0.048 * S);
      const a = arm[s] || 0;
      const ay0 = shY + H * 0.012;
      if (tier === 0) {
        const L = upperL + foreL;
        parts.push(P(bx(0.118 * S * bw, L, 0.128 * S,
          ax, ay0 - Math.cos(a) * L / 2,
          shZ + Math.sin(a) * L / 2 * fz, o.sleeve || top, a * -fz), 'arm'));
        continue;
      }
      const ucy = ay0 - Math.cos(a) * upperL / 2;
      const ucz = shZ + Math.sin(a) * upperL / 2 * fz;
      parts.push(P(bx(0.118 * S * bw, upperL, 0.128 * S, ax, ucy, ucz,
        o.sleeve || top, a * -fz), 'arm'));
      const ex = ax, ey = ay0 - Math.cos(a) * upperL, ez = shZ + Math.sin(a) * upperL * fz;
      const c = a + (fore[s] || 0);
      const fcy = ey - Math.cos(c) * foreL / 2, fcz = ez + Math.sin(c) * foreL / 2 * fz;
      parts.push(P(bx(0.106 * S * bw, foreL, 0.116 * S, ex, fcy, fcz,
        o.cuff || o.sleeve || top, c * -fz), 'arm'));
      // The hand. Small, and it is the thing that lets an arm END rather than
      // stop -- and the thing a paddle, a bar or a placard is held BY.
      const hy = ey - Math.cos(c) * foreL, hz = ez + Math.sin(c) * foreL * fz;
      parts.push(P(bx(0.100 * S, 0.118 * S, 0.105 * S, ex, hy - 0.050 * S, hz, skin), 'hand'));
    }
  }

  /**
   * ================== ONE SPECTATOR, FIVE THINGS THEY MIGHT BE DOING =======
   *
   * Shared by the roadside knots, the grandstands and the finish arena, so a
   * person leaning on the rail in the last mile is the same animal as one in a
   * knot at mile two rather than a separate pile of boxes that happens to be
   * the same colour.
   *
   * Everything about this is tier READ and that is measured, not assumed: see
   * the table on vFigure. The heads are 1.0 to 2.2 px in the stands and 1.5 px
   * at the median in a knot, so the entire budget goes into the SILHOUETTE
   * separating -- head, neck, shoulders, chest, hips, two legs, two arms --
   * and into MOTION, which is the only thing that survives to ninety units.
   *
   * o.r is the caller's own rng, so a knot and a stand seeded differently get
   * different people and the same knot is the same people every time.
   */
  function vSpectator(parts, o) {
    const r = o.r;
    const pick = (a) => a[Math.floor(r() * a.length)];
    const S = (o.lo === undefined ? 0.86 : o.lo) + r() * (o.hi === undefined ? 0.30 : o.hi);
    const ph = o.phase === undefined ? r() * 6.2832 : o.phase;
    // The five, dealt at random rather than by index, so two knots side by
    // side are not the same nine people in the same nine moods.
    const act = o.act === undefined ? Math.floor(r() * 5) : o.act;
    const amp = (act === 3 ? 1.35 : act === 4 ? 1.0 : 0.72 + r() * 0.34) * (o.amp || 1);
    const kind = act === 4 ? CHEER.BRACED : CHEER.BODY;

    let arm = [0, 0], fore = [0, 0], lean = 0;
    if (act === 0) { arm = [3.05, 3.05]; fore = [0.10, -0.10]; }
    else if (act === 1) { arm = [3.02, 0.35]; fore = [0.15, 0.50]; }
    else if (act === 2) { arm = [1.15, 1.15]; fore = [1.15, 1.15]; }
    else if (act === 3) { arm = [2.72, 2.72]; fore = [0.35, -0.35]; }
    else { arm = [-1.05, -1.05]; fore = [-0.35, -0.35]; lean = 0.34; }

    const before = parts.length;
    vFigure(parts, {
      x: o.x, y: o.y || 0, z: o.z, h: S, build: 0.88 + r() * 0.30,
      tier: 0, fz: o.fz === undefined ? -1 : o.fz,
      skin: pick(FIG.skin), hair: pick(FIG.hair), style: Math.floor(r() * 6),
      top: pick(o.shirts), legCol: pick(o.trousers), shoe: 0x241f2c,
      arm: arm, fore: fore, lean: lean,
      leg: act === 3 ? [-0.30, 0.30] : [(r() - 0.5) * 0.22, (r() - 0.5) * 0.22],
      knee: act === 3 ? [0.55, 0.55] : [0.05, 0.05],
      wrap: function (p, role) { p.__role = role; return p; },
    });
    // The clap is the one place a limb takes its own kind, and only the SIDE
    // can separate the pair because they share the figure's phase.
    let seen = 0;
    for (let q = before; q < parts.length; q++) {
      const role = parts[q].__role;
      const k = (act === 2 && role === 'arm') ? (seen++ < 1 ? CHEER.CLAP_L : CHEER.CLAP_R) : kind;
      wv(parts[q], ph, amp, k);
    }
    // A placard, on the ones with both arms up. It is the highest, brightest
    // and largest thing on the figure and therefore the part whose movement
    // survives furthest -- at ninety units it is the single element that says
    // SPECTATORS rather than shrubs.
    if (act === 0 && o.signs && r() < (o.placard === undefined ? 0.5 : o.placard)) {
      const py = 1.74 * S * 1.02 + (o.y || 0);
      parts.push(wv(bx(0.075, 0.42, 0.075, o.x, py + 0.16, o.z, 0x8a5a3c), ph, amp, CHEER.WAVE));
      parts.push(wv(bx(0.78, 0.50, 0.07, o.x, py + 0.56, o.z, pick(o.signs)), ph, amp, CHEER.WAVE));
    }
    return S;
  }

  /**
   * One lane's surface: a road-length quad, laid flat on the slab and tinted
   * with a vertex colour so it multiplies whatever the biome has made the road.
   *
   * The u coordinate is re-mapped onto the CARRIAGEWAY rather than onto the
   * quad. Two reasons, and the second is the one that bites: the tarmac mottle
   * has to run continuously across a band edge instead of restarting there, and
   * roadSurfaceTexture paints its gutter grime at u = 0 and u = 1 -- at the
   * quad's own uv that grime would land on every lane boundary as a dirty
   * smear, six of them, exactly where the banding needs a clean step.
   *
   * y sits at the slab's original top; the slab itself was dropped to make room.
   */
  function laneBand(cx, w, tint) {
    const g = new THREE.PlaneGeometry(w, TILE);
    const uv = g.attributes.uv;
    const full = K.TRACK_HALF_WIDTH * 2;
    for (let i = 0; i < uv.count; i++) {
      const x = cx + (uv.getX(i) - 0.5) * w;
      uv.setX(i, (x + K.TRACK_HALF_WIDTH) / full);
    }
    return part(g, tint, cx, 0.25, 0, -Math.PI / 2);
  }

  /** Vertex-coloured toon material -- the workhorse for merged props. */
  function vtoon(steps, floor, spec) {
    const m = S.toon(0xffffff, steps || 2, floor, spec);
    m.vertexColors = true;
    return m;
  }

  // ---- the crowd wave ---------------------------------------------------
  /**
   * A CROWD IS NOT A TEXTURE. IT IS A THING THAT REACTS TO YOU.
   *
   * The grandstands beside the last mile were 1,100 people who did not move,
   * and a still crowd is scenery: the eye files it with the buildings and
   * stops reading it. What makes a finish straight feel like a finish straight
   * is that the noise arrives BEFORE you do and follows you through -- a
   * stadium rises in a band that travels with the runner.
   *
   * Doing that on the CPU is impossible at this budget: it is thousands of
   * bodies, and every one of them is already merged into a single mesh
   * precisely so it costs one draw. So it is done in the vertex shader, off
   * three numbers:
   *
   *   uT    clock
   *   uZ    where the runner is, in world z
   *   uHot  0..1, how much this run has earned -- see `finale` in create().
   *         The last mile ramps it; the tape pins it; a run that came apart
   *         never gets it all the way up, and that is the point.
   *
   * and one baked attribute, aWave = (phase, amplitude), which merge() writes.
   * Amplitude 0 is structure and is not touched at all, so the seating decks,
   * the stanchions and the roof stay rigid while the bodies on them move.
   *
   * The travelling part is `near`: excitement peaks in a band around the
   * runner's own z and falls away over ~120 units, so a stand 150 units out is
   * simmering, the one you are level with is on its feet, and the transition
   * sweeps past the lens at running speed. That is the Mexican wave, and it
   * costs one subtraction per vertex.
   *
   * COST: zero draws, zero triangles, one extra shader program. The whole
   * feature is 8 bytes a vertex on the geometries that opt in.
   */
  const crowdU = {
    uT: { value: 0 },
    uZ: { value: 0 },
    uHot: { value: 0 },
  };
  /**
   * THE SWEPT VOLUME OF EACH VERTEX ANIMATION, per unit of baked aWave
   * amplitude, keyed by the chunk that produces it. Published on the api so
   * tools/motion.js can grow a bounding box by it -- shader motion never moves
   * a box, it moves the vertices inside one, so an audit of where moving
   * things GO is blind without this.
   *
   * IT IS PER CHUNK AND NOT A UNION, and the difference is not pedantry. The
   * first version published a single envelope taking the max of both across
   * every axis, on the reasoning that too large a box can only ever make an
   * assertion stricter. It made it WRONG: the crowd's lateral term is
   * 0.085*exc, at most 0.132, and the union handed it the wind's 0.40, so a
   * grandstand's swept box was inflated by half a unit inboard and the tool
   * reported CORRIDOR failures against finish stands that do not move
   * laterally at all. An assertion that fires on things that are fine is not
   * stricter, it is broken, and it gets switched off.
   */
  const WAVE_ENVELOPES = {};
  // Declarations and body are kept apart because the ink shell needs the same
  // displacement and does NOT go through the three.js include pipeline, so it
  // has to supply its own `transformed`. See outlineVS in shading.js.
  /**
   * ---- FIVE THINGS A SPECTATOR CAN BE DOING, AND ONE ENVELOPE ------------
   *
   * The wave used to be one motion: everybody lifted and everybody swayed at
   * one rate, staggered only by phase. A hundred people doing the same thing a
   * beat apart is a Mexican wave and nothing else -- it is not clapping, it is
   * not waving, and it is certainly not a crowd.
   *
   * aWave.z now names the behaviour. The magnitudes are DELIBERATELY
   * UNCHANGED: every kind uses the same vertical formula and the same lateral
   * coefficient, and what varies is RATE and DIRECTION. That is not a
   * stylistic choice, it is what keeps tools/motion.js correct -- the tool
   * grows every bounding box by WAVE_ENVELOPES times the baked amplitude, and
   * docs/roadmap.md records what happened last time an envelope was inflated
   * to cover the worst case: it reported CORRIDOR failures against finish
   * stands that do not move laterally at all, and an assertion that fires on
   * things that are fine gets switched off. A behaviour that needed a bigger
   * envelope would have to pay for it in the corridor budget; none of these
   * do, because a clap is not a bigger movement than a bounce, it is a faster
   * one in the opposite direction.
   *
   *   BODY    the default. Stand up, bounce, drift.
   *   WAVE    a raised hand or a placard, swinging half again as fast. This is
   *           the one that reads at distance, because it is the highest and
   *           furthest-travelling point on the figure.
   *   CLAP_L  a forearm that swings toward the body's centre line...
   *   CLAP_R  ...and one that swings away from it, at the same rate, so the
   *           pair meets and parts. Two kinds rather than one because they
   *           share a figure's phase and only the SIGN can separate them.
   *   BRACED  leaning on the barrier. Almost no lift and a slow rock -- the
   *           people at the front are pressed against something and the ones
   *           behind are jumping, and a crowd where those look the same is a
   *           crowd of one animation.
   *
   * ---- THE VERTICAL IS UNIFORM WITHIN A FIGURE, AND THAT IS A RULE --------
   *
   * The first draft of these kinds cut the clap's vertical to a third, on the
   * reasoning that hands clap rather than pump. It is right about hands and
   * wrong about geometry: this displaces VERTICES, so a forearm lifting by a
   * third of what its own shoulder lifts by does not bend at the elbow, it
   * COMES OFF. At the finish stand, where exc is pinned at the 1.55 cap, the
   * gap would have been 0.61 world units on a figure 1.7 tall, twelve units
   * from the lens.
   *
   * This is the same defect crowdGeo's own comment records paying for once
   * already -- legs on a lower amplitude than the body opened daylight under a
   * floating torso -- and it is the trap the brief warned about: any new
   * vertex animation has it.
   *
   * So the rule is: a kind may change RATE and DIRECTION of the lateral term,
   * and it may change the vertical only if it is applied to the WHOLE FIGURE.
   * BRACED is per-figure and may damp the lift; WAVE and the clap pair are
   * per-limb and touch nothing but x. Amplitude differences between parts of
   * one body stay small and are carried by overlapping the parts.
   *
   * ---- AND EVERY PERSON HAS THEIR OWN CLOCK RATE -------------------------
   *
   * The owner asked for the timing to be offset randomly so the crowd feels
   * organic, and phase alone does not do that: a hundred sine waves of
   * IDENTICAL FREQUENCY re-converge, so a phase-staggered crowd drifts in and
   * out of unison forever. The rate jitter is taken from the fractional part
   * of the figure's own phase, which is already random and already per-figure,
   * so it costs one fract and no extra attribute -- and because every part of
   * one body carries the same phase, a person's head, arms and legs stay on
   * that person's clock.
   */
  const WAVE_DECL = 'attribute vec3 aWave;\nuniform float uT;\nuniform float uZ;\nuniform float uHot;\n';
  const WAVE_BODY = [
    'if (aWave.y > 0.0) {',
    '  float wz = (modelMatrix * vec4(transformed, 1.0)).z - uZ;',
    // Ahead of the runner the band reaches further than behind it: a crowd
    // hears you coming, and the leading edge is the half that reads as
    // anticipation rather than as applause.
    '  float lead = wz > 0.0 ? 150.0 : 70.0;',
    '  float near = 1.0 - smoothstep(4.0, lead, abs(wz));',
    '  float exc = clamp(0.16 + 0.42 * uHot + near * (0.34 + 0.68 * uHot), 0.0, 1.55);',
    '  float jit = fract(aWave.x * 0.159154);',
    '  float b = sin(uT * (4.1 + 3.4 * exc) * (0.80 + 0.40 * jit) + aWave.x);',
    // Two terms and they say different things. The first is standing UP -- a
    // constant lift that grows with excitement, which is what turns a seated
    // block into a crowd on its feet. The second is the jumping.
    '  float vert = 0.30 * exc + (0.05 + 0.26 * exc) * abs(b);',
    '  float lat = 1.0;',
    '  float lrate = 5.7;',
    '  float k = aWave.z;',
    '  if (k > 0.5 && k < 1.5) { lrate = 8.6; }',
    // Magnitude 1.0, like every other kind. A clap wants more travel than
    // this and cannot have it: the lateral coefficient is what WAVE_ENVELOPES
    // publishes and tools/motion.js grows every crowd bounding box by, so a
    // kind that reached further would either breach the corridor unseen or
    // force the envelope up for parts that never move that far. At the cap it
    // is 0.132 each way, 0.26 of closing, and the hands are authored 0.30
    // apart so that is a clap and not a twitch.
    '  else if (k > 1.5 && k < 3.5) { lrate = 10.9; lat = k < 2.5 ? 1.0 : -1.0; }',
    '  else if (k > 3.5) { vert *= 0.22; lrate = 2.3; }',
    '  transformed.y += aWave.y * vert;',
    '  transformed.x += aWave.y * exc * 0.085 * lat * sin(uT * lrate + aWave.x * 1.73);',
    '}',
  ].join('\n');
  const WAVE_CHUNK = '#include <begin_vertex>\n' + WAVE_BODY;

  function vwave(steps, floor) {
    const m = vtoon(steps, floor);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      shader.uniforms.uT = crowdU.uT;
      shader.uniforms.uZ = crowdU.uZ;
      shader.uniforms.uHot = crowdU.uHot;
      shader.vertexShader = WAVE_DECL
        + shader.vertexShader.replace('#include <begin_vertex>', WAVE_CHUNK);
    };
    // What the ink shell has to replay so the silhouette moves with the body.
    const key = 'crowdwave/' + (steps || 2);
    m.userData.vertexChunk = { key, decl: WAVE_DECL, body: WAVE_BODY, uniforms: crowdU };
    // Read straight off WAVE_CHUNK above, at the exc cap of 1.55: the standing
    // lift 0.30*exc plus the jump (0.05 + 0.26*exc), and 0.085*exc laterally.
    WAVE_ENVELOPES[key] = {
      x: 1.55 * 0.085,
      y: 0.30 * 1.55 + (0.05 + 0.26 * 1.55),
      z: 0,
    };
    // Pinned, so this compiles once rather than being hashed off the function
    // source -- see the note on the shared ramp patch in shading.js.
    m.customProgramCacheKey = function () { return 'mr/crowdwave/' + (steps || 2); };
    return m;
  }

  // ---- the wind ---------------------------------------------------------
  /**
   * ===================== ONE WIND, AND IT IS THE SKY'S =====================
   *
   * The brief asked for flags and vegetation to move. The cheap way to do that
   * is a sine per object, and it is also the way that makes a world look
   * WRONG rather than alive: a tree nodding one way beside a pennant streaming
   * the other reads as two broken props, not as weather. Wind is a property of
   * the SCENE, so it is declared once here and every material that moves in it
   * takes its direction and its gusting from this one place.
   *
   * DIRECTION IS NOT A CHOICE. It is already committed, in shading.js, by the
   * clouds. A cloud feature holds a fixed texture coordinate, so with sample
   * offset o and scale S it crosses the cloud plane at dp/dt = -(do/dt)/S;
   * both sheets there are signed so that rate is NEGATIVE, and p is d.xz/h, so
   * the sky travels toward world -x. Anything on the ground that claims to be
   * in the same wind therefore leans toward world -x too. That agreement is
   * the entire reason this is one constant and not four: the player never
   * names it, and would notice at once if the sky and the trees disagreed.
   *
   * WHY -X IS ALSO THE LUCKY AXIS. The ripple comment above makes the argument
   * in full and it applies unchanged here: the player is sweeping z at 21.8 to
   * 27.7 units/s, so any animation along z is competing with motion fifty
   * times its size and is invisible by construction. The wind blows ACROSS the
   * road, which is the one axis the player's own travel does not hide. The
   * small z term below is decorrelation, not direction.
   *
   * A STEADY LEAN, NOT A WOBBLE. The sway term is (0.30 + 0.70*sin), which
   * never changes sign -- so every leaf and every pennant sits displaced
   * downwind and BREATHES about that offset. This is the whole difference
   * between wind and vibration, and it is why the first term is a bias rather
   * than a swing. On top of it `gust` breathes far more slowly (0.23 of the
   * sway rate) so the whole roadside surges and eases together.
   *
   * THE SPLIT BETWEEN THOSE TWO TERMS IS NOT TASTE, IT IS THE WHOLE BUDGET.
   * The bias costs lateral reach -- which is charged to the corridor standoff
   * below, and to the swept box tools/motion.js has to grow -- and it buys NO
   * motion at all, because it does not vary. The swing costs the same reach
   * and is the entire perceptible signal. The first draft ran 0.55/0.45 and
   * measured, on the live page with the world held still, 0.55% of pixels
   * changing over a HUNDRED SECONDS of clock at RIVERSIDE, the most heavily
   * planted leg in the game: about one pixel of travel on a mid-distance
   * crown. That is precisely the "technically animated, perceptually still"
   * defect this whole task exists to remove, reintroduced in a commit about
   * adding motion. Rebalancing to 0.30/0.70 buys 56% more visible movement for
   * the same peak reach, before any amplitude is spent.
   *
   * THE GUST IS A PLACE, NOT A CLOCK. Phase carries world x and z, so the
   * surge is a travelling front across the scene rather than a global pulse:
   * neighbouring trees are out of step, and 2*pi of phase spans 48 units of x
   * and 70 of z, which is the scale a hedge row and its neighbour differ over.
   * Without this every tree in the frame nods in unison, which is the single
   * most obvious way a vertex wind gives itself away.
   *
   * RATES, AND THEY ARE FREQUENCIES OF REAL THINGS.
   *
   *   foliage  2.83 rad/s = 0.45 Hz. The sway period of a street tree is
   *            about two seconds; this is that, not a number that looked
   *            right. A canopy moving faster reads as underwater.
   *   cloth   11.30 rad/s = 1.80 Hz. A pennant is a metre of light fabric and
   *            flutters roughly four times faster than a tree sways. Running
   *            both at one frequency is what makes bunting look like foliage.
   *
   * NOT TIME-COMPRESSED, for the same reason the sky is not: uT is the shared
   * wall clock (see the crowd wave), and TIME_SCALE's 30x would turn a breeze
   * into a shimmer.
   *
   * COST: zero draws, zero triangles, zero per-frame CPU -- the clock is
   * already written for the crowd and is deliberately SHARED rather than
   * duplicated, so the crowd wave and the wind can never drift apart. Two
   * extra shader programs, and 8 bytes a vertex on the geometries that opt in.
   */
  const WIND_F_LEAF = 2.83;
  const WIND_F_CLOTH = 11.30;
  /**
   * AMPLITUDE IS SIZED IN PIXELS ON THE SCREEN, NOT IN WORLD UNITS, because
   * pixels are what "perceptible" is a fact about. A tree stands 7.5 to 26
   * units off the centre line and is read at 30 to 60 units of depth, where
   * this camera resolves about 15 px per world unit; a sway authored as a
   * fraction of a crown lobe therefore lands at one or two pixels and is not
   * there at all. The figure below was raised from 0.22 to 0.40 against a
   * measured target of at least four pixels peak-to-peak on a mid-distance
   * crown -- see the rebalance note above for what the first attempt measured.
   *
   * Cloth is smaller because a pennant is smaller and, in this game, closer:
   * the bunting the player actually sees is strung over the finish chute at
   * ten to thirty units, where the same world displacement buys two to four
   * times the pixels.
   */
  const WIND_A_LEAF = 0.40;
  const WIND_A_CLOTH = 0.16;
  /**
   * The largest LATERAL displacement any wind material can produce per unit of
   * baked amplitude, which is exactly WIND_A at gust 1.0 and sway 1.0.
   *
   * It is a named constant because two places outside this function need it
   * and both of them are correctness rather than looks: the tree claim site
   * stands a crown off the corridor by its own reach, and that reach has to
   * include the wind or a swaying crown reintroduces the exact corridor breach
   * the standoff was written to fix; and tools/motion.js has to grow a
   * bounding box by it, because vertex-shader motion is invisible to a bounding
   * box. See api.WAVE_ENVELOPE, which is how the tool gets it without anybody
   * copying a number into another file.
   */
  const WIND_REACH = Math.max(WIND_A_LEAF, WIND_A_CLOTH);

  // vec3 to match the crowd's, because merge() writes ONE aWave attribute and
  // a geometry can only have one item size. The wind reads x and y and ignores
  // z; a mismatch here is a silent GL type error and a black page.
  const WIND_DECL = 'attribute vec3 aWave;\nuniform float uT;\n';

  function windBody(f, a) {
    return [
      'if (aWave.y > 0.0) {',
      '  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      '  float ph = aWave.x + wp.x * 0.13 + wp.z * 0.09;',
      '  float gust = 0.62 + 0.38 * sin(uT * ' + (f * 0.23).toFixed(4) + ' + ph * 0.6);',
      '  float sway = aWave.y * ' + a.toFixed(4) + ' * gust * (0.30 + 0.70 * sin(uT * ' + f.toFixed(4) + ' + ph));',
      '  transformed.x -= sway;',
      // Leaning is an ARC about the stem, not a slide along the ground, so the
      // tip drops as it goes over. It is a small term and it is the one that
      // stops a swaying crown looking like a crown being dragged sideways.
      '  transformed.y -= abs(sway) * 0.18;',
      '  transformed.z += aWave.y * ' + (a * 0.26).toFixed(4) + ' * gust * sin(uT * ' + (f * 0.81).toFixed(4) + ' + ph * 1.3);',
      '}',
    ].join('\n');
  }

  /**
   * Same opt-in as vwave and the same attribute: a part tagged with wv() moves,
   * a part left alone is structure and is not touched. Trunks, masts, posts and
   * bunting wire all get amplitude 0 on purpose -- the thing that sells a wind
   * is that what should be rigid stays rigid.
   */
  function vwind(steps, floor, f, a) {
    const m = vtoon(steps, floor);
    const prev = m.onBeforeCompile;
    const body = windBody(f, a);
    m.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      shader.uniforms.uT = crowdU.uT;
      shader.vertexShader = WIND_DECL
        + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + body);
    };
    const key = 'wind/' + f.toFixed(2) + '/' + a.toFixed(2);
    m.userData.vertexChunk = { key, decl: WIND_DECL, body: body, uniforms: { uT: crowdU.uT } };
    // Read straight off windBody: gust tops at 1.0 and sway at (0.30 + 0.70).
    WAVE_ENVELOPES[key] = { x: a, y: a * 0.18, z: a * 0.26 };
    // Keyed on the terms that actually vary the PROGRAM, so the two wind
    // materials compile once each rather than being hashed off function source.
    m.customProgramCacheKey = function () {
      return 'mr/wind/' + (steps || 2) + '/' + f.toFixed(2) + '/' + a.toFixed(2);
    };
    return m;
  }

  // ---- generic pool -----------------------------------------------------
  function Pool(factory, parent) {
    const free = [];
    const live = [];
    return {
      live,
      claim() {
        const o = free.pop() || factory();
        o.visible = true;
        parent.add(o);
        live.push(o);
        return o;
      },
      release(o) {
        const i = live.indexOf(o);
        if (i >= 0) live.splice(i, 1);
        o.visible = false;
        parent.remove(o);
        free.push(o);
      },
      releaseAll() {
        while (live.length) this.release(live[live.length - 1]);
      },
    };
  }

  /**
   * The racing line: one concrete lane path that survives the whole course.
   *
   * course.js already proves a path EXISTS -- generate() retries a gate until
   * `solvable()` still says yes. This walks the identical state space, keeps
   * the cheapest survivor instead of the first, and hands back the lane to be
   * in at every gate. Identical rules means the line drawn on the road is a
   * line the player can actually hold, not a suggestion that runs into a train
   * two gates later.
   *
   * Cost is lane changes first and actions second, which is the line a runner
   * would pick rather than merely a legal one: hold what you have, move only
   * when the gate makes you, and prefer the lane you can run straight through.
   *
   * It is a property of the course, so it is the same for every player on the
   * same day -- exactly like the course itself.
   */
  function racingLine(gates, startLane, startIdx) {
    if (!gates.length) return null;
    const AW = MR.Course.ACTION_WINDOW;
    const from = startIdx || 0;
    // Same state collapse as Course.solvable: lane, the action still committed
    // to, and whether that action is recent enough to conflict.
    //
    // Seeded from where the player ACTUALLY is, not from a fixed lane 1. A line
    // planned from lane 1 is always survivable, but it will happily ask a
    // player sitting in a clear lane to move for no reason, and a hint you
    // learn to ignore is worse than no hint.
    let states = [{ lane: startLane === undefined ? 1 : startLane, act: K.CLEAR, z: -1e9, cost: 0, prev: null }];

    for (let i = from; i < gates.length; i++) {
      const g = gates[i];
      const next = new Map();
      for (const s of states) {
        for (let l = 0; l < 3; l++) {
          const h = g.lanes[l];
          if (h === K.BLOCK) continue;
          if (h !== K.CLEAR && s.act !== K.CLEAR && h !== s.act && g.z - s.z < AW) continue;
          const act = h === K.CLEAR ? s.act : h;
          const az = h === K.CLEAR ? s.z : g.z;
          const tag = l + ':' + act + ':' + (g.z - az < AW ? 1 : 0);
          // Lane changes dominate; an action is a small tax; and sitting in an
          // outer lane costs a little every gate, so once a hazard has pushed
          // the line wide it drifts back to the middle instead of camping out
          // there. The middle is where a line has an escape on both sides, and
          // a hint that keeps sending the player to the edge of the road for no
          // reason is a hint they stop believing.
          const cost = s.cost + Math.abs(l - s.lane) * 12 + (h === K.CLEAR ? 0 : 1) + (l === 1 ? 0 : 2);
          const cur = next.get(tag);
          if (!cur || cost < cur.cost) next.set(tag, { lane: l, act, z: az, cost, prev: s });
        }
      }
      // Unreachable: generate() would have rejected the gate. Fail soft rather
      // than throw -- a missing line is a missing hint, not a broken race.
      if (!next.size) return null;
      states = Array.from(next.values());
    }

    let best = states[0];
    for (const s of states) if (s.cost < best.cost) best = s;

    // Backtrack only over the range actually solved. The chain is `from` links
    // long, not gates.length, so walking to index 0 dereferences null the
    // moment a replan starts mid-course. Gates already behind the player keep
    // the start lane, which costs nothing -- the ribbon is only drawn ahead.
    const lanes = new Array(gates.length);
    for (let i = gates.length - 1; i >= from; i--) { lanes[i] = best.lane; best = best.prev; }
    for (let i = 0; i < from; i++) lanes[i] = lanes[from] !== undefined ? lanes[from] : 1;
    return lanes;
  }

  /**
   * The stripe the racing line is painted with: soft-edged, with a pulse
   * running along it.
   *
   * Deliberately paint and not floating pickups. Anything hovering in a lane at
   * this camera height has to be read and then ruled out as a hazard, and the
   * entire point of the hint is to reduce what the player has to parse, not to
   * add a fifth thing on the road that looks like the other four.
   */
  let routeTex = null;
  function routeTexture() {
    if (routeTex) return routeTex;
    const c = canvas(32, 128);
    const g = c.getContext('2d');
    const img = g.createImageData(32, 128);
    for (let y = 0; y < 128; y++) {
      // Two pulses per tile and never fully dark: a line that breaks stops
      // reading as a path and starts reading as a row of objects.
      const v = y / 128;
      const flow = 0.54 + 0.46 * Math.pow(0.5 + 0.5 * Math.sin(v * Math.PI * 4 - 1.6), 2.4);
      for (let x = 0; x < 32; x++) {
        // Soft shoulders. A hard-edged stripe aliases into a dotted line at the
        // far end of the run-up, which is the end that has to carry the read.
        const u = Math.abs(x - 15.5) / 15.5;
        const core = Math.max(0, 1 - Math.pow(u, 2.6));
        const i = (y * 32 + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * core * flow);
      }
    }
    g.putImageData(img, 0, 0);
    routeTex = texture(c, true);
    return routeTex;
  }

  /**
   * A ring, for the floating half of the route hint.
   *
   * The hard stroke is under a pixel wide by 90 units, so it carries a much
   * softer halo underneath it -- that is what is actually still visible at the
   * far end of the trail, where the hint has to do its work.
   */
  let ringTex = null;
  function ringTexture() {
    if (ringTex) return ringTex;
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.strokeStyle = '#ffffff';
    g.globalAlpha = 0.34;
    g.lineWidth = 22;
    g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 9;
    g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.stroke();
    ringTex = texture(c);
    return ringTex;
  }

  function create(course) {
    const group = new THREE.Group();

    /**
     * ============ THE HILL, AND WHERE IT IS ALLOWED TO SHOW UP ============
     *
     * `EL` is the course's own elevation profile (core/elevation.js). Two rules
     * govern every use of it in this file and they are worth stating once here
     * rather than at thirty call sites:
     *
     *   1. IT IS A RENDER-TIME OFFSET AND NOTHING ELSE. The simulation places
     *      the player, the hazards and the aid at y = 0 relative to the LOCAL
     *      road surface, and collision.js tests its clearances against that
     *      flat zero. So elevation is added when a thing is drawn, never when
     *      it is decided. Every clearance threshold in the game is untouched.
     *
     *   2. IT IS APPLIED AT THE CLAIM, NOT AT THE PARTS. A pooled object is
     *      claimed once and then sits still for two hundred units, so its lift
     *      is written where its z is written -- at the six activeX.push sites
     *      below -- rather than at the ~30 individual position.set calls inside
     *      them. One line each, and a missed site is then impossible.
     *
     * `eAt` is hot: five or six calls a frame from the update loop plus one per
     * ground row. It is a loop over at most seven compactly-supported terms
     * with a single cos, about 200 ns.
     */
    const EL = course.elevation || MR.Elevation.FLAT;
    const eAt = EL.at;
    // v4: the prop lottery gained a 'walkers' entry, which moves every draw
    // after the first and so re-rolls the whole layout. Naming that is cheaper
    // than wondering later why a day's scenery moved. (v3 was the pass that
    // dropped the rival and station entries, for the same reason.)
    const rnd = MR.rng.stream(course.key, 'scenery/v5');

    // Biome spans in world units, so road tiles and set pieces can ask "where
    // am I" without reconstructing the fraction every time.
    const BI = MR.Course.BIOMES.map((b, i) => ({
      name: b.name,
      from: b.from * K.TOTAL_UNITS,
      to: (i + 1 < MR.Course.BIOMES.length ? MR.Course.BIOMES[i + 1].from : 1) * K.TOTAL_UNITS,
      // Fall back rather than hand out undefined. Every caller of lookAtZ reads
      // `.edge` or `.bank` straight off this, so a biome added to course.js
      // without a BIOME_LOOK entry used to take the whole render down on
      // `undefined.road` instead of simply looking like CITY START until
      // someone gave it a palette.
      look: BIOME_LOOK[b.name] || BIOME_LOOK['CITY START'],
    }));
    function lookAtZ(z) {
      let b = BI[0];
      for (const x of BI) if (z >= x.from) b = x;
      return b;
    }
    const BRIDGE = BI.find((b) => b.name === 'THE BRIDGE');

    // ---- the day's settings ----------------------------------------------
    /**
     * Where this race is being run, in world units, in the order it is run
     * through. course.js draws three or four of the twelve and hands them over
     * as fractions of race distance; everything below works in units, exactly
     * like BI, so a road tile or a set piece can ask "which city am I in"
     * without reconstructing the fraction.
     *
     * A course with no settings on it -- an older saved course, or a caller
     * building a world by hand -- gets one pseudo-setting carrying the old
     * per-biome palette, so this file still renders the game it used to.
     */
    const SETS = (course.settings && course.settings.length
      ? course.settings.map(function (s) {
        return {
          tag: s.tag, name: s.name,
          from: s.from * K.TOTAL_UNITS, to: s.to * K.TOTAL_UNITS,
          look: SETTING_LOOK[s.tag] || fallbackSetting('CITY START'),
        };
      })
      : [{ tag: '', name: '', from: 0, to: K.TOTAL_UNITS, look: null }]);
    const LEGACY = !(course.settings && course.settings.length);

    /**
     * THE CROSS-FADE, and why it is a distance and not a fraction.
     *
     * A setting lasts sixty to eighty seconds. The handover has to be long
     * enough that nothing snaps and short enough that the player is never in
     * two cities at once, and the honest unit for that is METRES OF ROAD, not
     * a share of the race: at race pace 190 units is about seven seconds,
     * which is two or three gates and roughly the time the fog takes to hand
     * a building over from "arriving" to "readable".
     *
     * Everything crosses on this one number -- sky, fog, ground, road, the
     * roadside tint AND the content, which dithers across the same band
     * instead of switching on a line (see settingIndexAt). Fading the palette
     * while cutting the buildings would be worse than cutting both.
     */
    const SET_FADE = 190;

    function setIndexAt(z) {
      let i = 0;
      for (let k = 0; k < SETS.length; k++) if (z >= SETS[k].from) i = k;
      return i;
    }
    /** The setting at z, ignoring the fade -- for anything that must be one. */
    function setAtZ(z) { return SETS[setIndexAt(z)]; }
    /** 0 at the boundary, 1 once the new setting owns the frame outright. */
    function setFadeAt(z) {
      const i = setIndexAt(z);
      if (!i) return 1;
      return Math.max(0, Math.min(1, (z - SETS[i].from) / SET_FADE));
    }
    /**
     * Which setting a PROP belongs to. Inside the fade band the choice is
     * dithered from the layout stream, so the two cities interleave along the
     * road over 190 units -- the old street thins out as the new one thickens,
     * which is what a cross-fade means for content that cannot be blended.
     */
    function settingIndexAt(z, r) {
      const i = setIndexAt(z);
      if (!i) return 0;
      const t = setFadeAt(z);
      return (r < t) ? i : i - 1;
    }

    // The deck is inset from the biome boundary so the abutments have room to
    // cap the ends; the water sinks over a 190-unit ramp on each side, which
    // is long enough that the ground never visibly pops down.
    const DECK_FROM = BRIDGE.from + 40;
    const DECK_TO = BRIDGE.to - 40;
    const WATER_DROP = 2.3;
    function deckLift(z) {
      if (z < DECK_FROM) return Math.max(0, 1 - (DECK_FROM - z) / 190);
      if (z > DECK_TO) return Math.max(0, 1 - (z - DECK_TO) / 190);
      return 1;
    }

    // Shared materials: recoloured per biome, never reallocated.
    const groundTex = groundTexture();
    groundTex.repeat.set(48, 48);
    const vergeTex = groundTex.clone();
    vergeTex.repeat.set(5, 4);
    vergeTex.needsUpdate = true;
    // 24 / (8 * 1.2) -- see roadSurfaceTexture for why the number has to be
    // exactly this and why the tile seam lands on a joint either way.
    const roadTex = roadSurfaceTexture();
    roadTex.repeat.set(1, TILE / (8 * ROAD_SLAB));

    const mats = {
      // vertexColors so the lane bands baked into roadGeo can multiply the
      // biome's road colour -- one draw call for three individuated lanes, and
      // the ramp follows the cross-fade without anything having to drive it.
      road: S.toon(P.road, 2),
      shoulder: S.toon(P.ground, 2),
      // THE ROAD PAINT IS LIT, AND THAT IS THE WHOLE OF THE HIERARCHY FIX.
      //
      // It was MeshBasicMaterial, i.e. unlit, i.e. drawn at its authored value
      // while everything around it went through the toon ramp. Measured with
      // tools/inkbudget.js: paint mean L 0.55 against tarmac 0.25 and a player
      // whose lit fill tops out at p95 0.65. The brightest object in the
      // gameplay band was road marking, by material choice rather than by
      // intent -- the focal point out-valued by the surface it runs on.
      //
      // Same material class as the road now, so the paint takes the same ramp
      // the road takes. Both are flat-up normals, so both land in the same
      // band and the paint-to-tarmac RATIO becomes a property of the authored
      // colours rather than of one of them being exempt from the lighting.
      // That is the point: an absolute value tuned against today's ramp is
      // wrong the moment the ramp moves, and a paint that moves with its own
      // background stays correct through any relighting.
      //
      // Cost: zero draw calls, zero triangles. paintGeo is already one merged
      // mesh per tile and this only changes which shader it is drawn with.
      //
      // WHAT IT COSTS, STATED. An unlit white is the only way to reach 3.8x
      // the tarmac, because through the ramp the brightest authorable colour
      // is white and white lands where the ramp puts it. So the markings CAN
      // NOT hold their old ratio on this material at any authored value, and
      // the ones that are load-bearing are re-authored below against the
      // tarmac rather than against a remembered number.
      paint: vtoon(2),
      prop: vtoon(2),
      // The roadside furniture gets its own material so a setting can put a
      // little of its own light on the barriers, hedges and parapets without
      // dragging every tree and spectator with it. It only ever multiplies a
      // baked vertex colour, so the tints in SETTING_LOOK all sit near white:
      // this can knock a value down, never lift one.
      edge: vtoon(2),
      // HAZARDS GET A LIFTED RAMP FLOOR, and nothing else does. A hazard's
      // read face points at the camera and therefore away from the key light,
      // so on the scenery floor of 0.31 it was lit almost entirely by the blue
      // bounce: the contrast audit measured the JUMP kerb's authored S 0.73
      // arriving at 0.34 and every BLOCK landing between 1.1x and 1.6x the
      // centre lane when the reference sits at 2.1-2.56x. See ramp() in
      // shading.js for the derivation. This is the one class of object the
      // race is lost by misreading, so it is the one class that spends its
      // shading budget on chroma rather than on form.
      // The `true` is the cel specular in shading.js. It is opted into HERE and
      // nowhere else, so the highlight exists on hazards and on nothing else in
      // the frame -- the class the owner asked about, and the class where a
      // wrong-looking highlight would cost a race rather than a screenshot.
      // Surfaces still have to ask for it per part through `gloss`; a geometry
      // that never does reads aGloss 0 and renders exactly as it did.
      propLit: vtoon(3, 0.62, true),
      // Everything that is made of people. Same toon ramp as `prop`, plus the
      // vertex wave -- see vwave() above.
      crowd: vwave(2),
      // Everything that is made of leaves, and everything that is made of
      // cloth. Same toon ramp as `prop`, plus the wind -- see vwind() above.
      // They are two materials rather than one because a canopy and a pennant
      // have genuinely different natural frequencies, which is the only thing
      // that differs between them.
      leaf: vwind(2, undefined, WIND_F_LEAF, WIND_A_LEAF),
      cloth: vwind(2, undefined, WIND_F_CLOTH, WIND_A_CLOTH),
      water: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    };

    // ---- sky + fog ------------------------------------------------------
    const sky = S.skyDome(900, P.skyTop, P.skyBot);
    sky.userData.notScenery = true;
    group.add(sky);

    // Ground plane. The pooled shoulders are only 30 units wide, so without
    // this the terrain simply stopped and the sky dome showed through as a
    // hard band across the middle of the frame. It rides with the runner so a
    // finite plane can stand in for an infinite one, and it sits below the
    // road surface so the road always wins the depth test. On the bridge it
    // drops away and becomes the river.
    //
    // IT IS THE ONE THING HILLS COST GEOMETRY. Left as the single quad it was,
    // it would slice straight across the descending road at every crest and
    // hide it -- a flat sheet through a curved surface, with the horizon drawn
    // on the wrong side of the road the player is about to run down. So it is
    // cut into strips along z and each strip's row is displaced to E(z) every
    // frame.
    //
    // The pitch is not uniform, because the eye's need for it is not. Four
    // units through the band the fog lets the player see (fog is opaque at 235,
    // and nothing spawns past VIEW = 210) puts the worst tangent kink at
    // c * 4 = 5.7e-4 * 4 = 0.0023 rad = 0.13 degrees, which is beneath
    // anything; beyond it the rows coarsen hard because a strip out at 500
    // units is behind an opaque wall of fog. 113 rows, 226 triangles, one draw
    // -- the same mesh, the same material, the same everything else.
    const GROUND_ROWS = (function () {
      const rows = [];
      for (let z = -700; z < -100; z += 100) rows.push(z);
      for (let z = -100; z <= 264; z += 4) rows.push(z);
      for (let z = 300; z <= 700; z += 50) rows.push(z);
      return rows;
    })();
    const groundMat = S.toon(P.ground, 2);
    groundMat.map = groundTex;
    mats.shoulder.map = vergeTex;
    mats.road.map = roadTex;
    mats.road.vertexColors = true;
    const groundGeo = (function () {
      const g = new THREE.BufferGeometry();
      const n = GROUND_ROWS.length;
      const pos = new Float32Array(n * 2 * 3);
      const uv = new Float32Array(n * 2 * 2);
      const idx = [];
      // Laid flat in XZ with y as height, rather than a PlaneGeometry turned on
      // its side: a row displacement is then one write to .y instead of a
      // rotation to reason about. UVs reproduce the old plane's 0..1 across
      // 1400 units, so groundTex.repeat(48, 48) tiles exactly as before.
      for (let i = 0; i < n; i++) {
        const zz = GROUND_ROWS[i];
        pos[i * 6] = -700; pos[i * 6 + 2] = zz;
        pos[i * 6 + 3] = 700; pos[i * 6 + 5] = zz;
        uv[i * 4] = 0; uv[i * 4 + 1] = (zz + 700) / 1400;
        uv[i * 4 + 2] = 1; uv[i * 4 + 3] = (zz + 700) / 1400;
        if (i) {
          const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1;
          idx.push(a, c, d, a, d, b);
        }
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      // Normals are computed ONCE, flat and upward, and are deliberately never
      // recomputed as the rows move. A 4% grade turns the true normal by 2.3
      // degrees, which is nothing in a smooth renderer and is not nothing here:
      // the toon ramp is banded, so a normal that drifts across a band boundary
      // draws a hard stripe along the hill. The ground's shape is carried by its
      // silhouette against the sky and by the road running over it, which is
      // where a flat-shaded game should carry it.
      g.computeVertexNormals();
      return g;
    })();
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.34;
    ground.renderOrder = -500;
    // Its vertices are rewritten every frame, so its bounding sphere is stale
    // by construction. It is also always in frame; there is nothing to cull.
    ground.frustumCulled = false;
    ground.userData.notScenery = true;
    group.add(ground);
    mats.ground = groundMat;

    /**
     * A ring of distant hills, riding with the runner like the ground does.
     *
     * They sit at 200 units, just inside the fog's far plane, so they arrive
     * about three-quarters dissolved -- which is exactly the read wanted: a
     * suggestion of land beyond the course rather than scenery you can
     * inspect. The forward 60 degrees is left open so nothing ever appears to
     * stand across the road at the vanishing point.
     */
    const hillsGeo = (function () {
      const parts = [];
      let s = 4242;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2;
        const forward = Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (forward < 0.52) continue;                      // keep the road open
        const rad = 190 + r() * 60;
        const h = 12 + r() * 26;
        // Baked shading: the far side of each hill is a band darker, which is
        // all a fully-fogged silhouette needs to stop reading as a flat cutout.
        parts.push(cone(24 + r() * 26, h, 5, Math.sin(a) * rad, h / 2 - 4, Math.cos(a) * rad,
          r() > 0.5 ? 0xd0d0d0 : 0xa8a8a8));
      }
      return merge(parts);
    })();
    const hillsMat = vtoon(2);
    const hills = new THREE.Mesh(hillsGeo, hillsMat);
    hills.renderOrder = -490;
    hills.frustumCulled = false;
    hills.userData.notScenery = true;
    group.add(hills);

    // Ripples ride just above the water surface and are only shown when the
    // ground is acting as a river, so still terrain never shimmers.
    const rippleTex = rippleTexture();
    rippleTex.repeat.set(26, 26);
    // 900 units of sheet over 26 repeats is 34.6 units per texture unit, so
    // this is 1.90 world units of current per second. See the write site.
    const RIPPLE_DRIFT = 0.055;
    const ripples = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({
      map: rippleTex, transparent: true, depthWrite: false,
    }));
    ripples.rotation.x = -Math.PI / 2;
    ripples.renderOrder = -480;
    ripples.visible = false;
    ripples.userData.notScenery = true;
    group.add(ripples);

    // ---- road tiles -----------------------------------------------------
    /**
     * LANE INDIVIDUATION -- three lanes as three surfaces, not one sheet.
     *
     * In the reference frames the three lanes are three physically different
     * OBJECTS: a crimson train roof, a blue-grey roof, brown ballast, at
     * different heights, values and saturations. That is why you always know
     * which lane you are in and which lane a hazard is sitting in, without ever
     * looking for a marking. Ours was a single 7.5-unit sheet of one colour and
     * carried lane identity entirely on two hairline dashes -- the nearer of
     * which the runner's own body covers from about 35 units out, which is
     * inside the distance the lane choice is actually made at.
     *
     * WHY VALUE AND HUE AND NOT HEIGHT. Lifting the centre lane was the obvious
     * way to copy the reference and it cannot be done here. Two things lie ON
     * this surface at fixed heights that this file is not allowed to move: the
     * hazard telegraph mats sit at y = 0.012 with depthWrite off, and every
     * hazard's footing is authored from y = 0. Raise one lane by anything the
     * eye would notice and that lane's mats sink into the tarmac while the
     * hazards standing in it float. So the whole step is carried in colour.
     *
     * WHY IT COSTS NOTHING. The bands are quads merged into the tile's existing
     * road mesh and tinted with VERTEX COLOURS, which multiply the material's
     * own colour -- so the ramp rides the per-biome cross-fade for free and the
     * tile is still exactly one draw call. Ten triangles a tile.
     *
     * THE RAMP, and why it is not symmetric. A vertex colour cannot exceed 1,
     * so every band is a multiply DOWN from the biome road colour (which was
     * raised to compensate -- see BIOME_LOOK). The centre lane takes the colour
     * neat and is the brightest; the two outer lanes are not merely darker than
     * it, they are different from EACH OTHER, one cooled and one warmed, in
     * both value and hue. That asymmetry is the whole point: with two matching
     * outer lanes the runner's body still leaves "left or right?" unanswered,
     * because the only band you can see past your own shoulders is one of them.
     *
     * The steps are ~10% apart in value, which is a stop the eye reads at the
     * far end of the run-up but which is an order of magnitude weaker than the
     * telegraph mats. That is deliberate: the mats own amber, cyan and pink at
     * full saturation and they are the device a race is lost by misreading.
     * These are tints of the road's own hue and must never be mistaken for a
     * fourth colour language.
     */
    const LANE_BAND = [
      0xbac7de,   // lane 0, screen LEFT  -- coolest and darkest
      0xffffff,   // lane 1, centre       -- the biome road colour, neat
      0xe8e0d4,   // lane 2, screen RIGHT -- warmed, and a stop between the two
    ];
    // The hard shoulder outside the carriageway edge lines. Knocked well down
    // so the three lanes read as the bright mass and the tarmac beyond them as
    // the frame around it -- the same job the brown ballast does in the
    // reference. It is only 1.2 units wide a side, so it costs the play surface
    // nothing in the "lightest large mass" reckoning.
    const ROAD_MARGIN = 0xd0d0d0;

    // The longitudinal marks. The lane seam is a two-level ladder -- a rail
    // that runs the whole tile and a bead that rides it every PAVE_JOINT -- and
    // the carriageway edge stays one solid bright line. See the Egypt device
    // note in paintGeo for where the numbers come from and why the two are not
    // treated the same.
    /**
     * ============ THE PAINT LADDER, AS RATIOS TO THE TARMAC ============
     *
     * Every tone below used to be an absolute hex tuned by eye against one
     * frame. They are now stated as MULTIPLES OF THE ROAD THEY LIE ON, and the
     * reason is that an absolute is only correct for the lighting it was
     * measured under. The toon ramp and the light rig are being retuned in
     * shading.js as this is written; a number tuned against today's ramp is
     * wrong tomorrow, and a number stated as a ratio to its own background is
     * not, because both sides move together.
     *
     * WHAT MAKES THE RATIO HOLD. mats.paint is now the same lit material class
     * as mats.road (see the note there), and every mark below is a flat-up quad
     * lying on a flat-up road, so paint and tarmac land in the SAME ramp band
     * and take the same key, the same sky term and the same fog. An authored
     * ratio is therefore a rendered ratio, whatever the ramp does next. When
     * the paint was unlit that was not true: the ratio also carried a factor of
     * 1/band, i.e. the paint was brighter than its own design by exactly the
     * amount the lighting dimmed everything else.
     *
     * WHY ONE REFERENCE TARMAC IS HONEST. Measured across every road tone the
     * game can show -- twelve settings plus six biome roads -- shadedL runs
     * 72.0 to 73.8, a spread of 2.5%. There is effectively one tarmac in this
     * game wearing eighteen slightly different hues, so a single reference is
     * a fair thing to divide by, and this is the median of them.
     *
     * The ratios below are against the AUTHORED tarmac. On screen the road is
     * further multiplied by its lane band (0.85-1.00), the camber (0.78-1.00)
     * and the surface texture, so the rendered ratio against the lane a mark
     * actually sits beside runs up to about 1.3x higher than the number here --
     * in the safe direction, and more so toward the outer lanes.
     */
    const ROAD_REF = 0x616373;
    /** `hex` re-valued to `k` times the reference tarmac, keeping its hue. */
    function overRoad(hex, k) {
      return tintScale(hex, k * shadedL(ROAD_REF) / shadedL(hex));
    }

    /**
     * THE TOP OF THE LADDER IS SET BY THE CHARACTER, NOT BY THE ROAD.
     *
     * These were 2.44x / 2.43x / 1.42x. Measured with tools/inkbudget.js, the
     * paint at those values was the brightest thing in the gameplay band: mean
     * L 0.55 with near-white peaks, against a player whose lit fill reaches
     * p95 0.65 and a tarmac at 0.25. The focal point was out-valued by the
     * surface it runs on, which is not something the art direction ever asked
     * for -- it was a side effect of one material being lit and the other not.
     *
     * So the top of the road's ladder is set to land AT the player's fill p95
     * rather than half a stop above it: 1.80x here renders at about 0.66
     * against the player's 0.65. That is the whole of the value fix and it is
     * one constant.
     *
     * IT IS COUPLED, AND SAYING SO IS THE POINT. If the character's ceiling
     * moves -- and shading.js owns that lever, per the clarity pass's own
     * boundary note -- this number moves with it, as a ratio, in the same
     * direction. It is not a value anybody should re-tune by eye.
     *
     * DEPARTURE, STATED. R1 verified the solid edge line at ~3.5x the RENDERED
     * tarmac against Tom Gold Run's measured 3.3-3.9, and this gives up part of
     * that. The reason to give it up: three of the four reference games put a
     * near-white extreme on their CHARACTER (p95 0.90 / 0.96 / 0.99) and we do
     * not (0.65). Matching the reference on the road while not matching it on
     * the runner is exactly what produced the inversion. The road is the half
     * this file owns, so the road is the half that moves.
     *
     * AND THE BEAD NO LONGER TIES THE EDGE LINE. At 2.43 against 2.44 an
     * interior lane seam's bead was worth the same as the carriageway
     * boundary, which inverts the road's own hierarchy: the boundary of the
     * play surface should out-value a mark inside it, and every real road on
     * earth agrees. The bead drops a clear step below.
     */
    const SEAM_RAIL = overRoad(0x8e8aa8, 1.28);
    const SEAM_BEAD = overRoad(0xfff6d8, 1.50);
    const EDGE_LINE = overRoad(0xf2f4ff, 1.80);

    // The kerb-notch period, and now the road-bead period too. Declared here
    // because paintGeo beats against it and is built first.
    const PAVE_JOINT = 2.0;

    /**
     * ================== CAMBER, ON TOP OF THE STAIRCASE ==================
     *
     * Tom Gold Run's road is not a flat colour and it is not a staircase
     * either: sampled across the carriageway at four depths it is a smooth
     * continuous dome peaking at the crown, with the edge at 0.68-0.77 of the
     * centre, twice at two depths to within half a level. It does not key to
     * lane boundaries. Ours keys to nothing else -- three flat bands, a step at
     * every seam and dead flat in between.
     *
     * Both reads are worth having and they are not in conflict, because they
     * carry different information. The staircase says WHICH LANE, which is the
     * whole game and is not being given up. The dome says ONE SURFACE, which is
     * what stops three lanes reading as three separate strips of tarmac laid
     * side by side. So the dome goes on top: keyed to |x| and not to lane
     * index, multiplied into the band each strip belongs to.
     *
     * WHY IT CANNOT BE A GRADIENT. merge() paints one flat colour per part, so
     * there is no per-vertex ramp to be had. Each band becomes five
     * constant-colour strips of LANE/5 instead, and the quantisation is fine:
     * five steps of about 4% across a lane is below the threshold the banded
     * toon ramp itself resolves, so it reads as a curve and not as more stairs.
     *
     * THE DIVISOR IS THE CARRIAGEWAY, NOT TRACK_HALF_WIDTH, and this is a
     * stated divergence from the spec that asked for it. The spec's formula
     * divides by TRACK_HALF_WIDTH (3.75) and in the next sentence asks for
     * "0.78 x 0.78 = 0.61 of the crown at the outer edge of lane 0". Those two
     * cannot both be true: the lanes only reach 2.55, so dividing by 3.75 gets
     * the outer lane edge to 0.90, not 0.78, and the combined figure to 0.70.
     * TRACK_HALF_WIDTH includes the 1.2-unit shoulder each side, which is
     * ROAD_MARGIN and is not part of the dome. Dividing by the carriageway
     * delivers the number that was actually measured against.
     *
     * Cost: 30 triangles per road tile instead of 6, and NO extra draw calls --
     * the strips merge into roadGeo exactly as the three bands did.
     */
    const CAMBER_DEPTH = 0.22;                 // 1.00 at the crown, 0.78 at the edge
    const CARRIAGE_HALF = LANE * 1.5;          // 2.55 -- three lanes, no shoulder
    const CAMBER_STRIPS = 5;
    function camber(x) {
      const t = Math.abs(x) / CARRIAGE_HALF;
      return 1 - CAMBER_DEPTH * t * t;
    }
    /**
     * Scale a tint IN sRGB BYTES, which is the space every number in this
     * section was measured in and is not the space THREE.Color works in.
     *
     * ColorManagement is on, so `new THREE.Color(hex)` holds LINEAR values and
     * multiplyScalar(0.78) darkens the linear value -- which arrives on screen
     * as 0.78^(1/2.2) = 0.89, four fifths of the step gone. The reason
     * LANE_BAND's own predictions match the frame to within 0.006 is that sRGB
     * is a power law, so scaling the BYTES by k and letting the round trip
     * cancel the exponent is what puts a factor of k on the displayed value.
     */
    function tintScale(hex, k) {
      const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 255) * k)));
      const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 255) * k)));
      const b = Math.max(0, Math.min(255, Math.round((hex & 255) * k)));
      return (r << 16) | (g << 8) | b;
    }

    const roadGeo = (function () {
      const parts = [];
      // The slab is dropped 4mm so the banded surface laid on top of it can
      // never z-fight with its own top face at the far end of the draw
      // distance. Its sides are what shows when the shoulders come off over
      // the river, so it keeps the margin tone rather than a lane tone.
      parts.push(bx(K.TRACK_HALF_WIDTH * 2, 0.5, TILE, 0, -0.004, 0, ROAD_MARGIN));
      const sw = LANE / CAMBER_STRIPS;
      for (let l = 0; l < 3; l++) {
        // K.LANE_X is descending, so this walks screen-left to screen-right and
        // LANE_BAND is indexed by the lane the PLAYER names, not by world x.
        // LANE_W is what sets the strip width; LANE_X is never differenced.
        for (let s = 0; s < CAMBER_STRIPS; s++) {
          const cx = K.LANE_X[l] - LANE / 2 + sw * (s + 0.5);
          parts.push(laneBand(cx, sw, tintScale(LANE_BAND[l], camber(cx))));
        }
      }
      return merge(parts);
    })();
    const shoulderGeo = new THREE.BoxGeometry(30, 0.42, TILE);

    // All the road paint in one merged mesh: two solid edge lines, two dashed
    // lane dividers and the carriageway joints were six-and-forty draws per
    // tile for flat quads that share a material.
    const paintGeo = (function () {
      const parts = [];
      const flat = -Math.PI / 2;

      /**
       * EXPANSION JOINTS -- the ground frequency, and the biggest single thing
       * this world was missing.
       *
       * Subway Surfers' track bed is railway sleepers: a hard perpendicular
       * stripe roughly every world unit, strobing under the player at speed. It
       * is the dominant speed cue in that game. Ours carried lane dashes every
       * twelve units -- an order of magnitude less often -- so the largest
       * surface on screen was flat colour that never changed. The camera pass
       * reported the same gap from its own side and had already been pushed to
       * the limit of what framing can do; the remaining headroom was here.
       *
       * WHY GEOMETRY AND NOT A TEXTURE, which is the obvious answer and was
       * tried first. The road is seen at a grazing angle for its entire length,
       * which is the one case trilinear filtering handles worst: the mip level
       * is picked from the LARGEST screen-space derivative, and along z that is
       * enormous, so a joint baked into the map averaged itself away within
       * twenty units and the tarmac came back flat. Anisotropic filtering is
       * exactly the fix and it is exactly what the software rasteriser this is
       * reviewed on does not have. Quads do not have the problem: they are
       * rasterised, not filtered.
       *
       * And it is close to free anyway. These fold into paintGeo, which is
       * already one merged draw per tile, so forty quads cost eighty triangles
       * and NO extra submissions. They are unlit basic-material fill over about
       * a fifth of the carriageway -- the cheapest fragment this renderer has.
       *
       * TWO FREQUENCIES, and the second is not decoration. The 1.2-unit joint
       * is the strobe and it is sub-pixel past forty units. Every fourth joint
       * is a heavier construction joint, a 4.8-unit rhythm that survives out to
       * where gates are actually read. Near field strobes, mid field pulses.
       *
       * The groove carries a lit LIP behind it, and the pair is what sells it:
       * a lone dark line reads as a stain, a dark-then-light edge reads as a
       * cut in a surface with a thickness.
       *
       * Colours are neutral and mid-value so they work as a value step on every
       * biome's road, from CITY START's lavender to THE WALL's dusty pink. No
       * chevrons: a forward-pointing triangle on the tarmac is the JUMP
       * telegraph's own icon, and nothing on the road may compete with the mats.
       */
      /**
       * ---- ONLY THE HEAVY JOINT KEEPS ITS LIP, AND HERE IS THE ARITHMETIC --
       *
       * Every joint used to be a PAIR of full-carriageway quads: a dark groove
       * and a lit lip behind it. Twenty pairs per 24-unit tile, unoccluded,
       * directly under the character. Measured with tools/inkbudget.js, the
       * merged paint mesh is 39-54% of every near-band edge in the game across
       * four race points, and 53-60% of its own near edges are horizontal --
       * which is these, not the longitudinal lines.
       *
       * The cut is affordable and that is a measurement rather than a taste.
       * Ground speed at record pace is (240 * 30) / 273.7 = 26.3 u/s, so:
       *
       *   light joint   1.2 u   ~22 Hz     0.44 u per frame at 60 fps, i.e.
       *                                    37% of its own period per frame
       *   heavy joint   4.8 u   ~5.5 Hz    the beat the eye actually resolves
       *
       * At 22 Hz individual joints are not resolvable as discrete events --
       * they are within 8 Hz of the frame rate's own Nyquist limit and read as
       * shimmer. The speed cue a player actually perceives is the 4.8-unit
       * heavy joint. So the light joints keep the groove, which is what carries
       * the beat, and give up the lip, which is what carries the brightness.
       *
       * THE LIP IS NOT DELETED, and the header's argument for it is why: a
       * lone dark line reads as a stain, a dark-then-light edge reads as a cut
       * in a surface with a thickness. That risk is real at the rhythm the eye
       * resolves, so the lip stays exactly there -- on the heavy joint, at 5.5
       * Hz, where it can be seen doing its job.
       *
       * THE JOINTS ARE NOT DELETED EITHER. They are the transverse speed cue
       * and the near band is the only place a speed cue can live. The lane
       * dashes cannot stand in: they are LONGITUDINAL, so they supply lane
       * identity and convergence, not the transverse beat that reads as ground
       * speed. All twenty grooves survive; fifteen of twenty lips do not.
       *
       * Cost: zero draw calls -- the same merged mesh -- and 30 fewer triangles
       * per tile.
       */
      const nJ = Math.round(TILE / ROAD_SLAB);
      for (let i = 0; i < nJ; i++) {
        // -TILE/2 + i*ROAD_SLAB, with TILE an exact multiple of ROAD_SLAB, so
        // the run continues into the next tile without doubling or drifting.
        const jz = -TILE / 2 + i * ROAD_SLAB;
        const heavy = (i % 4) === 0;
        parts.push(part(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, heavy ? 0.24 : 0.15),
          overRoad(heavy ? 0x272636 : 0x313040, heavy ? 0.40 : 0.50), 0, 0.004, jz, flat));
        // And the surviving lip comes down toward the tarmac. It was 1.23x the
        // road, which on twenty full-width bars a tile made it the brightest
        // large thing in the near band after the edge lines. At 1.05x it is
        // still a lit edge above a dark groove -- the pairing is what sells the
        // cut -- but it no longer competes with the marking or the runner.
        if (heavy) {
          parts.push(part(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, 0.11),
            overRoad(0x7b7a81, 1.05), 0, 0.004, jz + 0.18, flat));
        }
      }
      /**
       * ============ THE EGYPT DEVICE: A RAIL THAT CARRIES BEADS ============
       *
       * The tiled runway in tgr-egypt.png is the one piece of ground pattern in
       * the reference that survives to depth, and the reason is structural
       * rather than decorative. It is a LONGITUDINAL RAIL CARRYING PERPENDICULAR
       * BEADS. The rail converges on the vanishing point, so perspective
       * lengthens it in screen space instead of foreshortening it away; the
       * beads ride the rail and supply the beat. Measured, the beads step
       * uniformly in world depth to within 4% and about 33 of them resolve
       * individually before the period falls under four pixels.
       *
       * We had each half and neither whole. The expansion joints are
       * full-width perpendicular stripes with no rail -- sub-pixel past forty
       * units, as the note above already concedes. The lane seams are rails
       * with no beads. So the beads go on the rails, at the measured period:
       * 0.40 x the runway width, which on our 5.10-unit carriageway is 2.04,
       * and PAVE_JOINT is already 2.0 -- so the kerb notches and the road beads
       * beat together for free.
       *
       * DIVERGENCE, AND IT IS DELIBERATE. Egypt's beads are a CHROMA break --
       * blue on gold, dL 42 but dB 124. Ours cannot be. The telegraph mats own
       * amber, cyan and pink at full saturation, they are the device a race is
       * lost by misreading, and nothing on the road may compete with them. So
       * the same three-level ladder is drawn in VALUE: the rail drops well
       * below the paint it used to be, and the bead keeps the paint colour. On
       * the measured post-R1 tarmac (68 in lane 0, 91 in the centre) that is
       * road 1.00 / seam rail 1.5-2.1x / bead 2.7-3.6x, against Egypt's
       * grass 1.00 / gold rail 1.12 / cream deck 1.32 -- a wider ladder than
       * theirs, which is right, because a banded toon ramp quantises and needs
       * the extra step to survive it.
       *
       * TWO RAILS, NOT FOUR, and this is the second stated divergence. The spec
       * asked for beads on all four longitudinal lines. Built that way and
       * looked at, the carriageway edge becomes a dashed line as well, and that
       * costs two things worth more than the beat it buys. R1's verified result
       * is a solid marking at 3.5x the tarmac against Tom Gold Run's measured
       * 3.3-3.9, and the carriageway edges are what carry it; beading them
       * drops the continuous mark to 2.3x and only the beads stay in band.
       * And solid-edge / dashed-divider is the convention every real road on
       * earth uses, so the interior seams are exactly where a player already
       * expects to see a break and the boundary is exactly where they do not.
       * The edges therefore stay solid and bright, and only the two lane seams
       * become beaded rails. It also halves the cost.
       *
       * Cost: 2 rails x 12 beads per 24-unit tile = 24 quads = 48 triangles,
       * merged into paintGeo. Zero extra draw calls.
       */
      const BEAD = 0.30;
      const BEAD_STEP = PAVE_JOINT;      // 2.0 -- the kerb notch spacing
      function beads(cx, color, y) {
        const n = Math.round(TILE / BEAD_STEP);
        for (let i = 0; i < n; i++) {
          const z = -TILE / 2 + BEAD_STEP * 0.5 + i * BEAD_STEP;
          parts.push(part(new THREE.PlaneGeometry(BEAD, BEAD), color, cx, y, z, flat));
        }
      }

      // Carriageway edge lines, on the outer lane boundary rather than at the
      // tarmac edge. The shoulder beyond them carries the kerb and the aid
      // tables; painting it as road instead of as shoulder is what made three
      // lanes read as one enormous one.
      for (const sx of [-1, 1]) {
        parts.push(part(new THREE.PlaneGeometry(0.26, TILE), EDGE_LINE,
          sx * (LANE * 1.5 + 0.13), 0.006, 0, flat));
      }
      /**
       * LANE SEAMS -- continuous, and a groove rather than a dash.
       *
       * These used to be 0.16-wide dashes over half the tile. A dash is a
       * PERPENDICULAR mark: at this camera it is foreshortened to nothing by
       * forty units and it is the first thing the runner's own body covers.
       * A seam that runs the whole length of the tile is the opposite -- it is
       * the one kind of mark perspective makes MORE of, because it converges on
       * the vanishing point and so keeps a screen-space length no matter how
       * far away its far end is. That is what the reference's roof edges are
       * doing, and it is why they survive to the horizon.
       *
       * A warm-white line with a soft shadow either side, which is the same
       * dark-plus-lit pairing the expansion joints use and for the same reason:
       * a lone line reads as a stain on one surface, a line with a shadow under
       * it reads as the EDGE of a surface that has a thickness. The shadow is a
       * knocked-back road tone rather than ink -- the first pass made it near
       * black and 0.24 wide, and two of those turned the carriageway into three
       * strips separated by chasms, which is a much louder claim than the 10%
       * value steps the bands are making and drowned them.
       *
       * Total width is 0.35 against a 1.70 lane: enough to hold a pixel at the
       * far end of the run-up, narrow enough that a telegraph mat (1.41 wide,
       * centred) still clears it with room on both sides, so a gate never
       * buries the boundary the player is reading it against.
       */
      for (const lx of [-LANE / 2, LANE / 2]) {
        for (const s of [-1, 1]) {
          // 0.80x the tarmac. It was 1.19x -- brighter than the road it was
          // named the shadow of, so it read as a second grey line beside the
          // rail rather than as a shadow under it. Below the road is where a
          // shadow goes, and putting it there buys a value step for nothing.
          // Not near-black: the first pass tried that at 0.24 wide and turned
          // the carriageway into three strips separated by chasms.
          parts.push(part(new THREE.PlaneGeometry(0.11, TILE), overRoad(0x77728f, 0.80), lx + s * 0.12, 0.005, 0, flat));
        }
        parts.push(part(new THREE.PlaneGeometry(0.15, TILE), SEAM_RAIL, lx, 0.007, 0, flat));
        beads(lx, SEAM_BEAD, 0.009);
      }
      return merge(parts);
    })();

    /**
     * Kerb + pavement: without it the tarmac sits straight on grass.
     *
     * Both now carry the same high frequency the carriageway does, and the KERB
     * is the more valuable of the two. It runs the full length of the frame
     * right at the edge of the play corridor, so a notch every two units sits
     * in the player's peripheral vision for the entire race -- which is where a
     * speed cue does its work, because the centre of the frame is busy being
     * read. Geometry rather than texture here only because these are merged
     * into a tile mesh that is already being drawn: 24 little boxes cost
     * triangles, which are free, and no submissions, which are not.
     */
    function pavement(parts, sx, top, kerb, joint) {
      const x = sx * (K.TRACK_HALF_WIDTH + 4.0);
      const kx = sx * (K.TRACK_HALF_WIDTH + 0.17);
      parts.push(bx(8.0, 0.30, TILE, x, -0.16, 0, top));
      parts.push(bx(0.34, 0.34, TILE, kx, 0.0, 0, kerb));
      const n = Math.round(TILE / PAVE_JOINT);
      for (let i = 0; i < n; i++) {
        const z = -TILE / 2 + PAVE_JOINT * 0.5 + i * PAVE_JOINT;
        // A quad, not a box: the pavement is flat, so five of a box's six faces
        // were never going to be seen and this is a sixth of the vertex work.
        // The kerb notch stays a box because it has to turn the kerb's corner.
        parts.push(part(new THREE.PlaneGeometry(7.9, 0.13), joint, x, 0.005, z, -Math.PI / 2));
        parts.push(bx(0.36, 0.36, 0.09, kx, 0.0, z, joint));
      }
    }

    // ---- the verge line, which replaced the overhead layer ----------------
    /**
     * THE ROAD TILE NO LONGER SPANS THE ROAD, AND THAT IS THE POINT.
     *
     * What used to be here: two portal spans in every 24-unit tile plus a lamp
     * arc reaching to x = 1.6, on every biome. One crossing every eight units,
     * about three a second at race pace, identical in every tile of the race.
     * Measured on the shipped build with the census in the R3 brief, the whole
     * course ran 12.6 crossings per 100 units and the frame the owner
     * complained about ran 32 live at once.
     *
     * It was built deliberately, from Subway Surfers, and it was overdone:
     *
     *   "Take out some of the wires, poles, and bars. The road does not
     *    always need to be covered like Subway Surfers. It can be open."
     *
     * The measurement that settles it is the mile marker. With the birdcage
     * and the catenary in place, 57% to 100% of the MILE sign's own panel was
     * behind something at the distance it is first read, and the numeral was
     * three to eight pixels tall in portrait. Overhead structure was not
     * competing with the signage, it was standing in front of it.
     *
     * REFERENCE, and it is a different game from the one this layer came from:
     * reference/sonic-dash-downhill.png. NOTHING spans the carriageway in that
     * frame. The entire vertical vocabulary is a line of telephone poles and
     * streetlights standing IN THE VERGE, carrying wires that run ALONG the
     * road rather than across it, at roughly one pole every 15-20 units per
     * side. The depth cue survives intact -- a receding line of poles and three
     * wires converging on the vanishing point is the same perspective read the
     * cross-spans were bought for -- and the sky over the road stays empty, so
     * the Golden Gate at the vanishing point is legible at a glance.
     *
     * So the road tile now carries a VERGE LINE and nothing overhead at all.
     * Everything stands at |x| = POLE_X, which is outside CORRIDOR_HALF, and
     * nothing reaches back in past POLE_REACH, which is also outside it. The
     * tile contributes exactly ZERO crossings to api.crossings(), by
     * construction rather than by care, and tools/shoot.js re-derives that from
     * the built triangles on every run.
     *
     * What still crosses the road, and only these:
     *
     *   mile banners     every 240 units, and they are the reason for all of
     *                    this -- they now hang in open sky
     *   footbridges      every 330 units
     *   the WALL         one concrete overpass every 168 units on that leg
     *   landmark spans   a viaduct, Chicago's L, the bridge towers
     *   the finish       arch, chute bunting and tape
     *
     * That is about one crossing every 90 units of ordinary road: rare enough
     * that each one is an event, which is what a set piece is for.
     */
    // The verge line. POLE_X is where anything vertical stands and POLE_REACH
    // is the furthest in toward the centre line that any arm may come. Both are
    // derived from the corridor rather than typed, so a track retune cannot
    // quietly push a lamp head over the carriageway: the assertion in
    // tools/shoot.js would catch it, but geometry that cannot break the rule is
    // better than geometry that is checked for breaking it.
    const POLE_X = Math.max(K.TRACK_HALF_WIDTH + 1.65, CORRIDOR_HALF + 1.55);
    const POLE_REACH = CORRIDOR_HALF + 0.70;
    // Two verticals per tile per side, staggered against the other side, so a
    // pole passes the lens every six units of road with nothing over it.
    const POLE_Z = [-6, 6];

    /**
     * A wire run down the verge, converging on the vanishing point -- the hard
     * perspective line above the road that the cross-spans were originally
     * bought for, kept, and moved out of the sky over the carriageway where it
     * never belonged.
     *
     * TWO WIRES, NOT THREE, AND EACH ONE HEAVIER. Measured by ablation with
     * tools/inkbudget.js at skip 25: taking the wires out of the tile's merged
     * edge mesh drops that mesh from 40.61% of all frame edges to 36.58%. That
     * is 4.03 points of the frame bought by 792 triangles -- 6% of the mesh
     * buying 10% of its edges, and the best edges-per-triangle bargain in the
     * game, which is precisely the problem. For comparison, in the same
     * ablation the 3,696 triangles of pavement joints and kerb notches buy
     * 1.43 points and the 3,168 triangles of crowd-barrier posts buy 1.47.
     * Those two are large and quiet; this one is small and loud.
     *
     * A wire is the thinnest highest-contrast line it is possible to draw, and
     * three of them per side at 0.07 across is three sub-pixel lines competing
     * at the exact distance the mile marker is read at. Two at 0.085 keep the
     * perspective convergence -- which is the whole reason the wires exist,
     * and it needs two lines, not three, to be a convergence at all -- while
     * each surviving line is likelier to land on a whole pixel instead of
     * shimmering between two.
     *
     * NOT THE POLES. The poles are the vertical rhythm that replaced the
     * overhead spans in R3 and they are what makes the verge read as a street.
     * This is a trim of the thinnest element, not a removal of the device.
     *
     * NO FAIRNESS COST: everything here is above OVERHEAD_Y at |x| = POLE_X,
     * outside CORRIDOR_HALF, and the camera looks down, so none of it can come
     * between the lens and a hazard. tools/shoot.js re-derives that every run.
     */
    function vergeWires(parts, sx, ys, tint) {
      for (const y of ys) parts.push(bx(0.085, 0.085, TILE, sx * POLE_X, y, 0, tint));
    }

    /**
     * THE LAMP STANDARD -- the top-of-frame device, and it no longer leans over
     * the road.
     *
     * The height came off tgr-city.png and is unchanged. Two posts were fitted
     * through a common horizon there: the near post runs 548 px from head to
     * base against a carriageway 310 px wide at the same depth, i.e. THE HEAD
     * STANDS 1.77 ROAD WIDTHS UP. That is an enormous exaggeration -- no real
     * street lamp is anything like it -- and the exaggeration is the point: it
     * is what fills the top of a PORTRAIT frame instead of hugging the kerb.
     * Our tarmac is 2 * TRACK_HALF_WIDTH = 7.50, so 1.77 * 7.50 = 13.3.
     *
     * WHAT CHANGED IS THE REACH. The arm used to be a quarter ellipse from the
     * post top (5.4, 9.6) all the way in to a head at x = 1.6 -- over the
     * middle lane, 1.6 units from the centre line. It cleared OVERHEAD_Y by
     * 3.65 units so it was never a fairness problem, and that is exactly why it
     * survived: it was audited for the rule it obeyed and never counted against
     * the rule nobody was measuring. Ten live tiles put ten of those arms
     * across the sky over the carriageway at once, and they were a third of
     * every frame's crossing count.
     *
     * The arm now stops at POLE_REACH, outside CORRIDOR_HALF, so the lamp is
     * roadside furniture in the same band as the kerb and the aid tables and
     * contributes nothing to api.crossings(). Compare the streetlight on the
     * right of reference/sonic-dash-downhill.png: a short arm over its own
     * verge, and clear sky over the road beside it. The head keeps its height,
     * so the device still crops the top corner of a portrait frame -- which was
     * the job it was hired for.
     *
     * COST: 60 triangles -- post 12, arm 3 x 12, head 12. Boxes rather than a
     * ribbon, because this file has twice lost days to quads that came out
     * wound the wrong way and drew nothing.
     */
    const LAMP_POST_Y = 9.6;
    const LAMP_HEAD_Y = 13.3;    // 1.77 x the 7.50-unit tarmac
    const LAMP_SEGS = 3;
    function lampArc(parts, sx, z, post, head) {
      parts.push(bx(0.26, LAMP_POST_Y, 0.26, sx * POLE_X, LAMP_POST_Y / 2, z, post));
      const ax = POLE_X - POLE_REACH;
      const ay = LAMP_HEAD_Y - LAMP_POST_Y;
      const at = (i) => {
        const t = (i / LAMP_SEGS) * (Math.PI / 2);
        return [sx * (POLE_REACH + ax * Math.cos(t)), LAMP_POST_Y + ay * Math.sin(t)];
      };
      for (let i = 0; i < LAMP_SEGS; i++) {
        const a = at(i), b = at(i + 1);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        parts.push(bx(Math.hypot(dx, dy) + 0.14, 0.20, 0.20,
          (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z, post, 0, 0, Math.atan2(dy, dx)));
      }
      // The luminaire hangs off the end of the arm, so its top meets the head
      // height rather than straddling it. Its own half-width is inside the
      // margin POLE_REACH leaves over CORRIDOR_HALF.
      parts.push(bx(0.62, 0.26, 0.44, sx * (POLE_REACH + 0.12), LAMP_HEAD_Y - 0.13, z, head));
    }

    /**
     * A TELEGRAPH POLE, and it is what pays for the spans coming out.
     *
     * reference/sonic-dash-downhill.png fills its verge with these -- plain
     * poles with two crossarms, one every fifteen or twenty units per side,
     * carrying the wires that run along the road. They read as speed for the
     * same reason a fence does, and they cost nothing overhead because nothing
     * about them crosses anything. Set one between each pair of lamps and the
     * verge carries a vertical every six units of road, which is a denser
     * rhythm than the two spans a tile it replaces, in a place where density
     * cannot hide a sign.
     */
    function utilityPole(parts, sx, z, tint) {
      const h = 8.9;
      parts.push(bx(0.20, h, 0.20, sx * POLE_X, h / 2, z, tint));
      parts.push(bx(0.16, 0.16, 2.30, sx * POLE_X, h - 0.55, z, tint));
      parts.push(bx(0.16, 0.16, 1.60, sx * POLE_X, h - 1.45, z, tint));
    }

    /**
     * The whole verge line for a tile: a lamp and a telegraph pole on each
     * side, staggered against each other so a vertical passes the lens every
     * six units, and three wires running the length of the tile between them.
     *
     * SYMMETRIC, and that replaced a variant axis. The lamp used to alternate
     * sides tile by tile, which meant every roadside kind was built twice --
     * `barrierL` and `barrierR` -- and every pooled tile carried both. Poles on
     * both sides is what the reference does and it is what a street is, so the
     * stagger now happens WITHIN the tile and there is one geometry per kind
     * again. That is six merged tile geometries down to four.
     */
    function vergeLine(parts, post, head, wire) {
      for (const sx of [-1, 1]) {
        // Lamp on the near half one side, far half the other.
        lampArc(parts, sx, POLE_Z[sx > 0 ? 0 : 1], post, head);
        utilityPole(parts, sx, POLE_Z[sx > 0 ? 1 : 0], post);
        // Was [8.35, 7.75, 7.45]. The middle line is the one that goes: it sat
        // 0.30 under its neighbour, which is under a pixel apart by the time
        // the run has any convergence to show. The surviving pair keeps the
        // full 0.90-unit spread, so the fan is wider than it was.
        if (wire) vergeWires(parts, sx, [8.35, 7.45], wire);
      }
    }

    /**
     * Crowd-control barrier: the single strongest "this is a road race" cue.
     * The lamp standards are what give the city legs a vertical rhythm at the
     * distance where individual props have already fogged out.
     */
    function barrierParts() {
      const parts = [];
      for (const sx of [-1, 1]) {
        const x = sx * (K.TRACK_HALF_WIDTH + 0.85);
        pavement(parts, sx, 0xb9bdd6, 0xe8ecff, 0x8f93ad);
        parts.push(bx(0.10, 0.09, TILE, x, 0.92, 0, 0xf2f4ff));
        parts.push(bx(0.09, 0.07, TILE, x, 0.60, 0, 0xdfe6ff));
        for (let i = 0; i < 8; i++) {
          const z = -TILE / 2 + 1.5 + i * 3;
          parts.push(bx(0.13, 1.0, 0.13, x, 0.5, z, 0x2b2f52));
          // Sponsor-ish colour panel between posts: reads as printed hoarding.
          if (i % 2 === 0) parts.push(bx(0.06, 0.30, 2.6, x - sx * 0.03, 0.74, z + 1.5, 0xff3b6b));
        }
        for (const lz of [-TILE / 4, TILE / 4]) {
          const lx = sx * (K.TRACK_HALF_WIDTH + 2.2);
          parts.push(bx(0.22, 6.4, 0.22, lx, 3.2, lz, 0x2b2f52));
          parts.push(bx(1.9, 0.20, 0.20, lx - sx * 0.85, 6.3, lz, 0x2b2f52));
          parts.push(bx(0.8, 0.26, 0.44, lx - sx * 1.7, 6.1, lz, 0xffe45e));
          parts.push(bx(0.9, 1.1, 0.10, lx, 4.6, lz, sx > 0 ? 0x37d6ff : 0xff9ad5));
        }
      }
      // THE TRAM CATENARY IS GONE, and the wires it was bought for are not.
      //
      // What was here: two portal spans a tile, each a pair of 10-11 unit masts
      // at |x| = 6.35 with a beam and a second wire across the road, three
      // droppers hanging off it, and fifteen bunting pennants on the second
      // span. Plus three contact wires at y 9.30 running the length of the tile
      // directly over the lanes.
      //
      // The longitudinal wires were the good part -- three lines converging on
      // the vanishing point are the one hard perspective cue this scene has --
      // and they are kept, at POLE_X on the verge instead of over the lanes,
      // strung between the telegraph poles where a wire that is not a tram
      // contact wire actually belongs. Nothing is lost from the frame except
      // the part that was standing in front of the mile marker.
      //
      // The bunting went with the spans, and is better for it: it now appears
      // only in the finish chute, so the first time the player sees pennants
      // overhead in a whole race is the moment they can see the tape.
      vergeLine(parts, 0x2b2f52, 0xffe45e, 0x2b2f52);
      return parts;
    }

    /** Park/river edge: a clipped hedge, a gravel path and the odd bench. */
    function hedgeParts() {
      const parts = [];
      for (const sx of [-1, 1]) {
        const x = sx * (K.TRACK_HALF_WIDTH + 1.6);
        pavement(parts, sx, 0xd8c9a0, 0xefe3c2, 0xb0a37e);
        // ===== THE HEDGE IS CHARTREUSE NOW, LIKE EVERY OTHER LEAF =====
        //
        // It was 0x2f9f52 with a 0x49c96b cap: R = 0.296 and 0.363 of G, a
        // true emerald. The trees standing behind it on this same tile are
        // 0.72 to 0.76, because a previous pass warmed the whole vocabulary
        // to the reference's chartreuse and reordered value by height.
        //
        // The hedge was missed for the same reason the avenue was missed
        // before it, and the note twenty lines down says so in its own words:
        // it is baked into the road tile rather than pooled per setting, so
        // nothing that walks the tree palettes ever reaches it. It is the
        // largest continuous area of foliage in the game -- two rows the full
        // length of every PARKLAND and RIVERSIDE tile, nearer the lens than
        // any pooled tree -- and it was the last true green left in the
        // vegetation.
        //
        // A clipped hedge is a DENSE DARK MASS, so it takes the bottom of the
        // ladder rather than the middle: the body is a step below the
        // avenue's darkest lobe (0x5c8028) and the cap lands on the avenue's
        // own mid lobe, which is what a sunlit hedge top is.
        parts.push(bx(1.5, 0.78, TILE, x, 0.28, 0, 0x4a6a20));
        parts.push(bx(1.62, 0.16, TILE, x, 0.68, 0, 0x7fa838));
        for (let i = 0; i < 4; i++) {
          parts.push(cyl(0.10, 0.12, 0.7, 6, sx * (K.TRACK_HALF_WIDTH + 0.4), 0.35,
            -TILE / 2 + 3 + i * 6, 0xfff2e0));
        }
        const bz = sx > 0 ? -4 : 6;
        const bx0 = sx * (K.TRACK_HALF_WIDTH + 5.6);
        parts.push(bx(0.9, 0.14, 2.4, bx0, 0.46, bz, 0x8a5a3c));
        parts.push(bx(0.16, 0.62, 2.4, bx0 + sx * 0.4, 0.72, bz, 0x8a5a3c));
        parts.push(bx(0.2, 0.42, 0.2, bx0, 0.21, bz - 0.9, 0x2b2f52));
        parts.push(bx(0.2, 0.42, 0.2, bx0, 0.21, bz + 0.9, 0x2b2f52));
        // An avenue, planted on the tile so it costs no extra draw. Scattered
        // single trees never made PARKLAND feel like parkland -- a regular
        // line right at the verge does, and it is what a park boulevard is.
        //
        // THIS IS THE TREE THE PLAYER SEES MOST, and it was the one MEASUREMENTS
        // section 6 never reached. The fix to `vTree` warmed every setting's
        // palette from a true green to the reference's chartreuse and reordered
        // the lobes so value tracks height -- but the avenue is baked into the
        // road tile rather than pooled per setting, so it kept a hard-coded
        // 0x2f9f52 / 0x3fbf63 / 0x59d47a at R = 0.30-0.42 of G against the
        // reference's 0.75-0.78, on the old cold trunk 0x8a5a3c, and it kept
        // being a CONIFER. Two conifers a side on every hedge tile is a hundred
        // of them live at once, all of them nearer the lens than any pooled
        // tree, and every one contradicting the trees standing next to it.
        //
        // So it becomes the same broadleaf: a warm forked stem under a wide
        // squat crown, in the generic chartreuse ladder (76.9 / 102.5 / 132.0
        // through shadedL -- 1.00 : 1.33 : 1.72 against the reference's 1.70),
        // darkest on the low outboard lobes and lightest on the one that tops
        // the crown. 236 triangles against 72; four to a tile.
        //
        // Proportioned off the reference's own measurement rather than off the
        // cone it replaces. A bare trunk is 23-36% of tree height in
        // `tgr-boulevard` and `tgr-taxi-street`; the first draft of this tree
        // put its crown at y 3.6 on a 5.65 tree and came out at 46% -- leggy,
        // and visibly so at 20 units. The crown now starts at 1.70 of 4.70:
        // 36%, at the top of the reference's band, and it is wider than it is
        // tall (4.0 across, 3.15 deep) the way a street tree is.
        //
        // The avenue moves out from TRACK_HALF_WIDTH + 3.4 to + 4.2 so the
        // wider crown reaches exactly as far toward the road as the cone it
        // replaces: 7.95 - 2.60 = 5.35, unchanged, and 1.6 outside CORRIDOR_HALF.
        const LEAF = canopy([0x5c8028, 0x7fa838, 0xa4d848]);
        for (let i = 0; i < 2; i++) {
          const tz = -TILE / 2 + 5 + i * 12 + (sx > 0 ? 3 : 0);
          const k = i ? 1.30 : 1.05;
          const tx = sx * (K.TRACK_HALF_WIDTH + 4.2);
          parts.push(cyl(0.20 * k, 0.30 * k, 1.9 * k, 6, tx, 0.95 * k, tz, 0xb0662e));
          parts.push(cyl(0.12 * k, 0.17 * k, 1.15 * k, 6, tx - sx * 0.22 * k, 2.25 * k,
            tz + 0.08 * k, 0xb0662e, 0, 0, sx * 0.30));
          parts.push(cyl(0.11 * k, 0.16 * k, 1.05 * k, 6, tx + sx * 0.22 * k, 2.20 * k,
            tz - 0.10 * k, 0xb0662e, 0, 0, -sx * 0.34));
          parts.push(sph(1.35 * k, 7, tx, 3.05 * k, tz, LEAF[1]));
          parts.push(sph(1.00 * k, 6, tx - sx * 1.00 * k, 2.70 * k, tz + 0.42 * k, LEAF[2]));
          parts.push(sph(0.95 * k, 6, tx + sx * 1.02 * k, 2.80 * k, tz - 0.40 * k, LEAF[2]));
          parts.push(sph(0.85 * k, 6, tx + sx * 0.12 * k, 3.85 * k, tz + 0.12 * k, LEAF[0]));
        }
      }
      // PARKLAND AND RIVERSIDE GET THE OPEN SKY, and they get it outright.
      //
      // What was here: two bunting spans a tile on 10-unit poles, a cross wire
      // and eleven pennants each -- 24 pennants and four masts over every 24
      // units of a leg whose stated job is to feel open. The comment above it
      // said these legs "are meant to feel open, so they get the crossing
      // rhythm without the ironwork the city carries", which is the sentence
      // that gives the game away: a crossing rhythm IS the covering.
      //
      // No telegraph poles here either, and no wires. A park boulevard is
      // lamps and trees, the avenue already carries the trees, and this is the
      // sparsest overhead in the race by design -- PARKLAND is where the player
      // gets the longest look down the road.
      for (const sx of [-1, 1]) lampArc(parts, sx, POLE_Z[sx > 0 ? 0 : 1], 0x3a4560, 0xfff2e0);
      return parts;
    }

    /**
     * One merged geometry per roadside kind. The verge line has to be baked
     * into the tile's own merge or it is a draw call per live tile -- about a
     * dozen, on a frame that already runs 150-275.
     *
     * There used to be a second axis here: the lamp alternated sides tile by
     * tile, so `barrier` and `hedge` were each built twice and every pooled
     * tile carried both variants. The verge line is symmetric and staggers
     * within the tile instead, so the axis is gone and with it two geometries
     * and two outlined mesh pairs on every pooled tile.
     */
    const LIT_EDGES = {
      barrier: merge(barrierParts()),
      hedge: merge(hedgeParts()),
    };

    /**
     * THE WALL: concrete jersey barrier and a graffitied site hoarding. The leg
     * is meant to feel enclosed and joyless, so the roadside closes in rather
     * than opening onto crowd.
     *
     * TWO STOREYS, and the split is the whole design of this piece.
     *
     * The hoarding used to be one unbroken 6.5-unit slab running the full tile
     * at x = 11.35, on both sides, for the entire leg. That did make the road
     * feel like a trench, but it cost more than it bought: LANDMARK_IN is
     * 11.75, so every set piece and every building on this leg stood 0.4 units
     * BEHIND a wall taller than they were wide on screen. The sightline over a
     * 6.5 wall at 11.35 clears y = 6.9 at x = 12.6 and y = 9.6 at x = 20 --
     * so the mile-20 hoardings showed a strip of poster with no legs under it
     * and the skyline showed roofs with no buildings under them. Slivers, not
     * masses, on the one leg that most needs somewhere to look.
     *
     * So the boarding below stays CONTINUOUS and the storey above it goes to a
     * rhythm of bays:
     *
     *   lower  0 -> 3.4, unbroken, both sides, the whole leg. The chase camera
     *          sits at y ~2.7, so this is above eye level: the ground beyond is
     *          never visible and the corridor never actually opens. This is the
     *          part that does the boxing in, and none of it is given up.
     *   upper  3.4 -> 6.5, in 8-unit panels with a 4-unit open scaffold bay
     *          between them, staggered a half-period between the two sides so
     *          the road is never open on both flanks at once.
     *
     * What comes back through the bays is everything from y ~3.5 up: the
     * hoarding legs and the lower two thirds of their boards, the bases of the
     * blocks behind. And the broken top line is worth as much as the gaps --
     * a dead straight edge running to the vanishing point on both sides gave
     * the leg no rhythm at all, and rhythm is what a wall of this length needs
     * to keep reading as oppressive instead of merely as grey.
     */
    const wallGeo = (function () {
      const parts = [];
      // Solid upper bays, as [zFrom, zTo] within the tile. The two arrays are
      // the same pattern a half-period apart, and each tiles seamlessly with
      // its own repeat: the gap that ends at +12 is continued by the gap that
      // starts the next tile at -12.
      const BAYS = [
        [[-TILE / 2, -4], [0, 8]],           // sx = -1
        [[-8, 0], [4, TILE / 2]],            // sx = +1
      ];
      // Centres of the 4-unit openings left between them, in tile coordinates.
      const GAPS = [[-2, 10], [-10, 2]];
      for (const sx of [-1, 1]) {
        pavement(parts, sx, 0x8c8a96, 0xb0aeba, 0x6a6874);
        const x = sx * (K.TRACK_HALF_WIDTH + 0.9);
        parts.push(bx(1.0, 0.55, TILE, x, 0.27, 0, 0xc8c4cc));
        parts.push(bx(0.62, 0.55, TILE, x, 0.80, 0, 0xdedae2));
        parts.push(bx(0.70, 0.12, TILE, x, 1.10, 0, 0xffb020));

        const wx = sx * (K.TRACK_HALF_WIDTH + 7.6);
        // Lower boarding, plus the string course that reads as the joint
        // between the boarding and the scaffold standing on it.
        parts.push(bx(0.7, 3.4, TILE, wx, 1.70, 0, 0x5f5866));
        parts.push(bx(0.86, 0.22, TILE, wx, 3.51, 0, 0x453f4e));

        const bays = BAYS[sx > 0 ? 1 : 0];
        for (const [z0, z1] of bays) {
          const len = z1 - z0, cz = (z0 + z1) / 2;
          parts.push(bx(0.7, 2.85, len, wx, 5.05, cz, 0x5f5866));
          parts.push(bx(0.9, 0.4, len + 0.5, wx, 6.30, cz, 0x453f4e));
          // Fly-posted panels: the only colour on this leg, and deliberately
          // grim. One high on the panel, one on the boarding under it, so the
          // colour is spread over both storeys instead of banding.
          const tags = [0x7a1030, 0x2b6e6a, 0x6a4f8a, 0x8a6a1f];
          const t0 = (sx > 0 ? 1 : 0) + (z0 < 0 ? 0 : 2);
          parts.push(bx(0.12, 1.9, len * 0.55, wx - sx * 0.4, 5.1, cz - len * 0.12,
            tags[t0 % 4]));
          parts.push(bx(0.12, 2.2, len * 0.42, wx - sx * 0.4, 1.7, cz + len * 0.22,
            tags[(t0 + 1) % 4]));
        }
        // The open bays are not empty: scaffold standards at each panel end and
        // a lift rail across, so the line of the hoarding is still drawn at
        // full height and the gap reads as unfinished works rather than as a
        // hole somebody forgot to fill.
        for (const [z0, z1] of bays) {
          for (const pz of [z0, z1]) {
            parts.push(bx(0.30, 3.1, 0.30, wx, 5.05, pz, 0x3d3846));
          }
        }
        for (const gz of GAPS[sx > 0 ? 1 : 0]) {
          parts.push(bx(0.22, 0.22, 4.4, wx, 6.15, gz, 0x3d3846));
          parts.push(bx(0.22, 0.22, 4.4, wx, 4.55, gz, 0x3d3846));
        }
      }
      // THE BIRDCAGE CAME OFF, AND IT WAS MEASURABLY THE WORST OBJECT IN THE
      // GAME FOR THE THING THE OWNER ASKED ABOUT.
      //
      // What was here: a scaffold roof over the carriageway -- three
      // longitudinal tubes at y 9.78 running the full tile directly over the
      // lanes, two portal frames a tile at 9.52 and 10.24 spanning 22 units,
      // and a staggered board at 10.08. The argument for it was the conceit,
      // that the runner is passing through a works site, and the argument was
      // good enough that a previous pass removed the diagonal bracing and kept
      // everything else.
      //
      // Then it was measured. THE WALL carries mile 19, 20 and 21 -- mile 20 is
      // where a marathon breaks people and the course stages it deliberately --
      // and the birdcage was in front of every one of those signs. Rays from
      // the real camera to the MILE 20 panel at the distance it is first read:
      // 59 of 65 blocked at 101 units, 61 of 65 at 145, all 65 at 96. It was
      // not competing with the mile marker for attention, it was standing in
      // the way of it, and it was the reason the owner could not read MILE 24.
      //
      // The works site is still here and it is still joyless: the hoarding, the
      // standards, the lift rails and the graffiti all stand, and every one of
      // them is LATERAL. What this leg has overhead now is one concrete
      // overpass every 168 units, which is what the hand-placed comment further
      // down this file always wanted -- you pass under it in shadow and the
      // mile 20 gantry is waiting on the far side in open sky.
      // The scaffold now goes UP instead of across. A third lift standing on
      // the hoarding line, with its own top rail and a raking brace, keeps the
      // works site reading as a structure that has a top rather than a fence
      // that stops -- and every tube of it is at |x| = 11.35, further out than
      // the street lamps on any other leg.
      const TUBE = 0x8f8a9c, TUBE2 = 0x6f6a7c;
      for (const sx of [-1, 1]) {
        const wx = sx * (K.TRACK_HALF_WIDTH + 7.6);
        parts.push(bx(0.16, 0.16, TILE, wx, 9.60, 0, TUBE));
        parts.push(bx(0.13, 0.13, TILE, wx - sx * 0.55, 8.30, 0, TUBE2));
        for (const pz of [-9, -3, 3, 9]) {
          parts.push(bx(0.24, 3.3, 0.24, wx, 8.05, pz, TUBE));
        }
        // Site floodlights on the top lift, turned in toward the works. A short
        // yoke, and the only light on the grimmest leg in the race.
        for (const fz of [-6, 6]) {
          parts.push(bx(0.5, 0.20, 0.20, wx - sx * 0.35, 9.95, fz, TUBE));
          parts.push(bx(0.55, 0.42, 0.62, wx - sx * 0.72, 9.95, fz, 0xffd88a));
        }
        // Staggered boards, kept, but stacked on the lift instead of laid over
        // the road: the plank rhythm survives with nothing above the tarmac.
        parts.push(bx(0.10, 1.5, 5.2, wx - sx * 0.40, 7.35, sx > 0 ? -5 : 5, 0xc0a878));
      }
      return merge(parts);
    })();

    /** Bridge deck edge: fascia, balusters, top rail, lamp standards. */
    const railGeo = (function () {
      const parts = [];
      for (const sx of [-1, 1]) {
        const x = sx * (K.TRACK_HALF_WIDTH + 0.55);
        parts.push(bx(1.3, 0.55, TILE, sx * (K.TRACK_HALF_WIDTH + 0.35), -0.45, 0, 0x3a4570));
        parts.push(bx(0.16, 0.16, TILE, x, 1.30, 0, 0xf2f4ff));
        parts.push(bx(0.12, 0.10, TILE, x, 0.78, 0, 0xc9d4ff));
        for (let i = 0; i < 12; i++) {
          parts.push(bx(0.09, 1.3, 0.09, x, 0.65, -TILE / 2 + 1 + i * 2, 0xdfe6ff));
        }
        // THE DECK STANDARD, and it is now the whole of the bridge's overhead.
        //
        // What was here: lighting PORTALS -- a 9.7-unit column each side of the
        // deck, a beam and a second runner across the road every 12 units, plus
        // two wires at y 9.98 running the length of the tile over the lanes.
        // The argument was that the deck is the one leg with no roadside at
        // all, so a ribbon over open water has no speed without something
        // crossing it. That was the right problem and the wrong answer: a
        // suspension bridge already has the best vertical device in the game
        // standing on it, and reference/sonic-dash-downhill.png is a photograph
        // of exactly that -- the Golden Gate filling the upper third, deck
        // lamps down the parapet, and not one thing spanning the carriageway.
        //
        // So the portal becomes a standard: a tall tapered column on the
        // parapet with the lantern on top and no arm at all. Two per side per
        // tile, staggered against the other side, so a lamp passes the lens
        // every six units -- a denser beat than the portals gave, and none of
        // it over the road. The tower ahead does the rest.
        const z = POLE_Z[sx > 0 ? 0 : 1];
        parts.push(bx(0.26, 9.2, 0.26, x, 4.60, z, 0x2b2f52));
        parts.push(bx(0.40, 0.55, 0.40, x, 9.45, z, 0x2b2f52));
        parts.push(bx(0.56, 0.60, 0.56, x, 10.00, z, 0xffe45e));
        parts.push(bx(0.30, 0.34, 0.30, x, 10.42, z, 0x2b2f52));
        // A shorter parapet lamp between them, so the deck carries a vertical
        // every six units without four full standards a tile.
        const z2 = POLE_Z[sx > 0 ? 1 : 0];
        parts.push(bx(0.20, 4.6, 0.20, x, 2.30, z2, 0x2b2f52));
        parts.push(bx(0.44, 0.46, 0.44, x, 4.80, z2, 0xffe45e));
      }
      // The convergence the two over-road runners used to draw, moved out onto
      // the parapet line where the standards can honestly carry it. Two wires
      // at |x| = 4.30, which is 0.55 outside CORRIDOR_HALF.
      for (const sx of [-1, 1]) {
        const x = sx * (K.TRACK_HALF_WIDTH + 0.55);
        parts.push(bx(0.07, 0.07, TILE, x, 8.30, 0, 0x2b2f52));
        parts.push(bx(0.07, 0.07, TILE, x, 7.80, 0, 0x3a4570));
      }
      return merge(parts);
    })();

    const roadPool = Pool(function () {
      const t = new THREE.Group();
      const road = new THREE.Mesh(roadGeo, mats.road);
      road.position.y = -0.25;
      t.add(road);

      const shoulders = [];
      for (const sx of [-1, 1]) {
        const sh = new THREE.Mesh(shoulderGeo, mats.shoulder);
        sh.position.set(sx * (K.TRACK_HALF_WIDTH + 15), -0.30, 0);
        t.add(sh);
        shoulders.push(sh);
      }
      const paint = new THREE.Mesh(paintGeo, mats.paint);
      t.add(paint);

      // One of these is shown at a time; keeping all three built means a
      // biome change is a visibility flip rather than a rebuild.
      const edges = {
        rail: S.outlined(railGeo, mats.edge, S.INK.prop),
        wall: S.outlined(wallGeo, mats.edge, S.INK.prop),
      };
      for (const k in LIT_EDGES) edges[k] = S.outlined(LIT_EDGES[k], mats.edge, S.INK.prop);
      for (const k in edges) { edges[k].visible = false; t.add(edges[k]); }
      t.userData.shoulders = shoulders;
      t.userData.edges = edges;
      return t;
    }, group);

    // ---- the racing line ------------------------------------------------
    /**
     * A blue line, painted on the road, showing the lane the next few gates
     * have to be taken in.
     *
     * The whole mechanic here is holding one unbroken clean line, and until now
     * the game gave the player no forward read of where that line was: every
     * gate was solved on its own, on sight, with no way to see that the lane
     * you are about to take is the one that runs into a train two gates later.
     * Both reference runners telegraph the route several gates out with a coin
     * or ring trail. A marathon already has the perfect version of that idea --
     * real courses paint the measured shortest route on the tarmac -- so this
     * is a borrow that costs the game nothing in tone.
     *
     * Cost is one draw call, and a second for the rings below. Each is a single
     * mesh whose vertices are rewritten in place every frame as the route
     * scrolls past, so neither allocates and neither grows with the length of
     * the course.
     *
     * It hints the LANE and nothing else: which action a gate wants, and when
     * to commit to it, are still entirely the player's read.
     */
    const ROUTE_NEAR = 5;      // starts clear of the runner's own feet
    const ROUTE_FAR = 124;     // three to five gates -- as far as the fog allows
    const ROUTE_SEGS = 44;
    const ROUTE_W = 0.17;      // half-width
    const ROUTE_UV = 1 / 14;   // one texture tile per 14 units of road

    // Replanned whenever the player changes lane; the solve is ~174 gates x 3
    // states, far too cheap to be worth caching harder than this.
    let routeLane = racingLine(course.gates, 1, 0);
    let routePlannedLane = 1;
    const routeGeo = new THREE.BufferGeometry();
    const routePos = new Float32Array(ROUTE_SEGS * 6 * 3);
    const routeUvs = new Float32Array(ROUTE_SEGS * 6 * 2);
    // RGB is always 1 and only the alpha moves -- the same four-component
    // trick the ring trail uses below, and for the same reason: a fade the
    // geometry owns can be shaped, and the fog's cannot.
    const routeCol = new Float32Array(ROUTE_SEGS * 6 * 4);
    for (let i = 0; i < ROUTE_SEGS * 6; i++) {
      routeCol[i * 4] = 1; routeCol[i * 4 + 1] = 1; routeCol[i * 4 + 2] = 1;
    }
    routeGeo.setAttribute('position', new THREE.BufferAttribute(routePos, 3));
    routeGeo.setAttribute('uv', new THREE.BufferAttribute(routeUvs, 2));
    routeGeo.setAttribute('color', new THREE.BufferAttribute(routeCol, 4));
    /**
     * ============ THE LINE WAS GREEN, AND SO IS EVERY PICKUP ============
     *
     * This colour used to be 0x5ff0a6, and the comment that chose it read "the
     * one hue no hazard owns; amber, cyan and red are all spoken for, and green
     * reads go". Every clause of that is true and the conclusion is still
     * wrong, because it was checked against the HAZARD palette and never
     * against the PICKUP palette. Measured in HSV:
     *
     *   racing line   0x5ff0a6   hue 149.4   sat 0.60
     *   aid pool      0x86eec0   hue 153.5   sat 0.44
     *   bottle body   0xf6fffb   hue 153.3   sat 0.04
     *   bottle label, cap, and the aid table's cloth
     *                 0x2fd39a   hue 159.1   sat 0.78
     *
     *   JUMP 38.7    DUCK 192.3    BLOCK 345.3
     *
     * The three hazards are 33 degrees from their nearest neighbour at worst.
     * The line and the whole aid family sat inside TEN DEGREES of each other.
     * So this game had one colour meaning "follow this" and "collect this" at
     * the same time, and the only thing separating them was how much of each
     * you could see.
     *
     * That is not theoretical. A blind reader shown 1:1 crops through the chase
     * camera, asked only about the PEOPLE in them, twice volunteered a green
     * object they could not name -- and their guess at one of them was "it
     * might be a BOTTLE". They were looking at this ribbon, cut down to a
     * 7 x 13 fragment by the two figures standing in front of it, and they read
     * the game's route hint as the game's aid pickup. tools/routeread.js is the
     * instrument that came out of it.
     *
     * So the line moves and the pickups keep the green, which is the right way
     * round twice over: the pickup is a world OBJECT the player is scored on
     * touching, and the line is an affordance drawn on the road. Violet is 109
     * degrees off the aid family, 75 off DUCK and 76 off BLOCK -- the largest
     * clear band the palette has left -- it is what every map in the world
     * draws a planned route in, and it is a hue this game had no other use for.
     */
    const routeMesh = new THREE.Mesh(routeGeo, new THREE.MeshBasicMaterial({
      map: routeTexture(),
      color: 0xa87bff,          // hue 265, sat 0.52, val 1.00
      transparent: true,
      vertexColors: true,       // per-vertex ALPHA only; see updateRoute
      /**
       * 0.62 WAS TUNED AGAINST AN EMPTY ROAD, AND THE ROAD IS NOT EMPTY.
       *
       * The old note here -- "at full strength the line reads as a beam being
       * fired down the road rather than as a marking on it" -- is about the
       * ribbon on its own. Asked to rank what the eye lands on in a frame at
       * 25 units, which is READ_NEAR and the distance the lane is actually
       * chosen at, a blind reader put it SECOND of six, above the runner, and
       * put the aid pickup it shares the road with LAST:
       *
       *   "yes, things on the road out-shout the hovering object at 25u,
       *    clearly and by a lot. The violet streaks beat it decisively -- they
       *    are bigger, more saturated, higher contrast against their
       *    background, and there are several of them competing against one
       *    small item."
       *
       * A route hint is meant to be read on the way to reading something else.
       * The item it was drowning is the one tools/simulate.js says is worth two
       * extra mistakes over a record attempt, so this is not a matter of taste:
       * the hint was taking attention from the thing attention is for.
       *
       * The colour move that fixed the confusion made this worse and hid it --
       * violet on dark asphalt is a bigger value break than the mint it
       * replaced. So the hue keeps its separation from the pickups and the
       * ribbon gives back the strength it never needed.
       */
      opacity: 0.38,
      depthWrite: false,
      /**
       * FOGGED, AND THIS LINE WAS BRIEFLY THE OTHER WAY ROUND.
       *
       * The ring trail below carries fog:false with a paragraph saying its job
       * is to be legible far up the road, which is exactly where the fog is
       * taking half the contrast out of everything else. That paragraph looks
       * like it applies verbatim to the ribbon the rings were drawn on top of,
       * and this material was given the exemption on that reasoning.
       *
       * A blind reader shown the aid pickups at 8, 12 and 25 units then said
       * this, unprompted, about the exempted ribbon: "at 25u the purple streaks
       * are visually the LOUDEST thing in the frame -- considerably louder than
       * the pale bottle they share the road with. Whatever they are, they
       * compete with the small object for attention at long range."
       *
       * That is the aid item losing its own frame to the route hint at exactly
       * the distance the lane is chosen at, which is a worse failure than the
       * one the exemption was fixing. The paragraph does not transfer, and the
       * reason is that the RING TRAIL IS SPARSE AND THE RIBBON IS CONTINUOUS:
       * fourteen small marks that hold their contrast up the road read as a
       * trail, and 124 unbroken units of paint that hold theirs read as the
       * brightest object in the scene. Exempting something from aerial
       * perspective buys attention, and attention is the scarce thing the
       * pickups need.
       *
       * So the fog stays on, and the readability the exemption was after is
       * bought instead by the constant width in updateRoute -- which is the
       * axis that was actually being spent, and which costs no salience.
       */
      fog: true,
      side: THREE.DoubleSide,   // the ribbon is rebuilt every frame; not
    }));                        // depending on winding is one less way to fail
    // Below the hazard telegraph mats (5) and the finish checker (4): where the
    // line runs across a gate's own mat, the hazard has to win.
    routeMesh.renderOrder = 3;
    routeMesh.userData.notScenery = true;
    routeMesh.frustumCulled = false;   // its bounds change every frame
    routeMesh.visible = !!routeLane;
    group.add(routeMesh);

    /**
     * The floating half of the hint: a trail of rings riding the same line.
     *
     * Paint alone cannot do this job. The chase camera sits low and directly
     * behind, so the runner's own body covers the centre of the road from about
     * 35 units out all the way to the horizon -- a line painted in the lane the
     * player is already in is invisible exactly where the forward read has to
     * happen. Rings sit high enough off the tarmac to clear the head in frame,
     * which is the same answer both reference games arrived at.
     *
     * A ring is a hollow circle and nothing else in this game is round, so it
     * cannot be mistaken for a fifth kind of obstacle. It marks the LANE only:
     * which action a gate wants, and when to commit, are still the player's.
     *
     * Evenly spaced along the line and anchored to a world grid rather than
     * hung off the gates: a trail has to be a trail. Gate spacing runs 46 units
     * early and 24 late, so per-gate clusters would have left the opening miles
     * with three rings and a long nothing, which reads as a row of separate
     * markers rather than a path.
     */
    const RING_SPACE = 11;
    const RING_FROM = 10;
    // Two slots more than the fade can reach, so the far end of the trail is
    // always already at zero when the world grid shifts a new ring into it.
    // Sized to the window rather than to the fade and a ring would wink into
    // existence at a third opacity, 120 units out, every few seconds.
    const RING_N = 14;
    const RING_FADE = 122;
    // 1.30 is the one height that works: above a JUMP kerb (0.80) and clear
    // below a DUCK bar (1.41), so a ring never floats at bar height where it
    // would read as "through here". The radius is chosen the same way -- 0.36
    // is 42% of a lane, big enough to survive the fog and small enough that the
    // trail never looks like something in the way.
    const RING_Y = 1.30;
    const RING_R = 0.36;

    const ringGeo = new THREE.BufferGeometry();
    const ringPos = new Float32Array(RING_N * 6 * 3);
    const ringUvs = new Float32Array(RING_N * 6 * 2);
    const ringCol = new Float32Array(RING_N * 6 * 4);
    for (let i = 0; i < RING_N; i++) {
      // UVs and RGB never change; only the corners and the alpha do.
      const u = i * 12, c = i * 24;
      const uvq = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
      for (let k = 0; k < 12; k++) ringUvs[u + k] = uvq[k];
      for (let k = 0; k < 6; k++) { ringCol[c + k * 4] = 1; ringCol[c + k * 4 + 1] = 1; ringCol[c + k * 4 + 2] = 1; }
    }
    ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
    ringGeo.setAttribute('uv', new THREE.BufferAttribute(ringUvs, 2));
    ringGeo.setAttribute('color', new THREE.BufferAttribute(ringCol, 4));
    const ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      map: ringTexture(), color: 0x5ff0a6, transparent: true, depthWrite: false,
      vertexColors: true, side: THREE.DoubleSide,
      // The only thing in the scene exempt from aerial perspective. Its job is
      // to be legible at 100 units, which is exactly where the fog is taking
      // half the contrast out of everything else; the trail carries its own
      // distance cue in the alpha ramp below instead.
      fog: false,
    }));
    ringMesh.renderOrder = 6;   // over the telegraph mats, never under them
    ringMesh.frustumCulled = false;
    // The floating ring trail is deliberately NOT added to the scene.
    //
    // Playtest verdict: a constant line of markers hovering at head height for
    // 26 miles reads as something you are obliged to collect, and it sat in the
    // one part of the frame the player is trying to read hazards through. The
    // painted racing ribbon on the road carries the same information without
    // occupying the air. The geometry is kept so a future pass can bring it
    // back as an occasional beacon (say, only where the line must change lane)
    // rather than as a continuous chain.
    ringMesh.visible = false;

    // Sampling walks z forwards, so the gate lookup is a cursor rather than a
    // search. It rewinds at the start of each frame and costs nothing after.
    let routeCursor = 0;
    function routeX(zz) {
      const gates = course.gates;
      while (routeCursor > 0 && gates[routeCursor - 1].z >= zz) routeCursor--;
      while (routeCursor < gates.length && gates[routeCursor].z < zz) routeCursor++;
      const i = routeCursor;
      if (i >= gates.length) return K.LANE_X[routeLane[gates.length - 1]];
      const to = K.LANE_X[routeLane[i]];
      const from = i > 0 ? K.LANE_X[routeLane[i - 1]] : to;
      const gz = gates[i].z;
      const pz = i > 0 ? gates[i - 1].z : gz - 40;
      // Cross over into the new lane before the gate, never across it: by the
      // gate line the paint is already where the player has to be.
      const cross = Math.min(18, Math.max(8, (gz - pz) * 0.55));
      const t = Math.max(0, Math.min(1, (zz - (gz - cross)) / cross));
      return from + (to - from) * t * t * (3 - 2 * t);
    }

    function updateRoute(z, now) {
      if (!routeLane) return;
      const step = (ROUTE_FAR - ROUTE_NEAR) / ROUTE_SEGS;
      let z0 = z + ROUTE_NEAR;
      let x0 = routeX(z0);
      for (let i = 0; i < ROUTE_SEGS; i++) {
        const z1 = z + ROUTE_NEAR + (i + 1) * step;
        const x1 = routeX(z1);
        /**
         * THE FAR END FADES IN ALPHA, NOT IN WIDTH, and the difference is the
         * whole readability of this thing.
         *
         * What was here: a width taper to half of ROUTE_W over the run, so the
         * far end "thins into the fog rather than stopping on a cut edge". The
         * intent was right and the axis was wrong. Perspective ALREADY halves
         * this ribbon's screen width every time the distance doubles, so a
         * width taper is a second narrowing stacked on the first -- and screen
         * width is the one dimension that decides whether a strip of paint
         * reads as a strip of paint. tools/routeread.js scores exactly that,
         * as ELONGATION: bbox height over bbox width, the property that
         * separates a line from a blob. Taking width away to buy a fade spends
         * the measured quantity to pay for an unmeasured one.
         *
         * Alpha buys the same soft end and costs nothing in width. So the
         * ribbon is now a constant ROUTE_W the whole way and fades over its
         * last quarter, and it is the fade rather than the fog that decides
         * where it stops -- which is the point of the fog:false above.
         */
        const w0 = ROUTE_W, w1 = ROUTE_W;
        const fade = function (t) {
          const q = Math.max(0, (t - 0.74) / 0.26);
          return Math.max(0, 1 - q * q);
        };
        const a0 = fade(i / ROUTE_SEGS), a1 = fade((i + 1) / ROUTE_SEGS);
        const v0 = z0 * ROUTE_UV, v1 = z1 * ROUTE_UV;
        const p = i * 18, u = i * 12, cc = i * 24;
        // Vertex order below is l0, r1, r0 -- then l0, l1, r1.
        const av = [a0, a1, a0, a0, a1, a1];
        for (let k = 0; k < 6; k++) routeCol[cc + k * 4 + 3] = av[k];
        // The ribbon is PAINT: it has to lie on the road over the whole 124
        // units it reaches, or it leaves the surface at the first crest and the
        // one forward read the player has starts floating in the air.
        const ry0 = 0.010 + eAt(z0), ry1 = 0.010 + eAt(z1);
        // l0, r1, r0 -- then l0, l1, r1.
        routePos[p] = x0 - w0; routePos[p + 1] = ry0; routePos[p + 2] = z0;
        routePos[p + 3] = x1 + w1; routePos[p + 4] = ry1; routePos[p + 5] = z1;
        routePos[p + 6] = x0 + w0; routePos[p + 7] = ry0; routePos[p + 8] = z0;
        routePos[p + 9] = x0 - w0; routePos[p + 10] = ry0; routePos[p + 11] = z0;
        routePos[p + 12] = x1 - w1; routePos[p + 13] = ry1; routePos[p + 14] = z1;
        routePos[p + 15] = x1 + w1; routePos[p + 16] = ry1; routePos[p + 17] = z1;
        routeUvs[u] = 0; routeUvs[u + 1] = v0;
        routeUvs[u + 2] = 1; routeUvs[u + 3] = v1;
        routeUvs[u + 4] = 1; routeUvs[u + 5] = v0;
        routeUvs[u + 6] = 0; routeUvs[u + 7] = v0;
        routeUvs[u + 8] = 0; routeUvs[u + 9] = v1;
        routeUvs[u + 10] = 1; routeUvs[u + 11] = v1;
        z0 = z1; x0 = x1;
      }
      routeGeo.attributes.position.needsUpdate = true;
      routeGeo.attributes.uv.needsUpdate = true;
      routeGeo.attributes.color.needsUpdate = true;
      // The pulse runs forward, away from the runner, so the line leads the eye
      // down the course instead of washing back over it.
      routeTexture().offset.y = -(now * 0.45) % 1;

      // ---- rings -------------------------------------------------------
      // Anchored to a world grid, so a ring holds still on the road and slides
      // toward the runner instead of the whole trail crawling forward with the
      // camera. New ones therefore only ever appear at the far end, where the
      // alpha ramp has already faded them to nothing.
      let cz = Math.ceil((z + RING_FROM) / RING_SPACE) * RING_SPACE;
      for (let n = 0; n < RING_N; n++, cz += RING_SPACE) {
        const p = n * 18, c = n * 24;
        // Alpha falls away down the trail, so the eye is pulled to the next
        // gate first and the far end stays a suggestion, not a second read.
        const a = 0.95 * Math.max(0, 1 - Math.pow(Math.min(1, (cz - z) / RING_FADE), 2.2));
        if (a <= 0.01) { for (let v = 0; v < 18; v++) ringPos[p + v] = 0; continue; }
        const cx = routeX(cz);
        const cy = RING_Y + eAt(cz) + Math.sin(now * 1.9 + n * 1.1) * 0.045;
        routeQuad(ringPos, p, cx - RING_R, cy - RING_R, cx + RING_R, cy + RING_R, cz);
        for (let v = 0; v < 6; v++) ringCol[c + v * 4 + 3] = a;
      }
      ringGeo.attributes.position.needsUpdate = true;
      ringGeo.attributes.color.needsUpdate = true;
    }

    /** Two triangles of an axis-aligned quad in the XY plane at depth `zz`. */
    function routeQuad(arr, p, l, b, r, t, zz) {
      arr[p] = l; arr[p + 1] = b; arr[p + 2] = zz;
      arr[p + 3] = r; arr[p + 4] = b; arr[p + 5] = zz;
      arr[p + 6] = r; arr[p + 7] = t; arr[p + 8] = zz;
      arr[p + 9] = l; arr[p + 10] = b; arr[p + 11] = zz;
      arr[p + 12] = r; arr[p + 13] = t; arr[p + 14] = zz;
      arr[p + 15] = l; arr[p + 16] = t; arr[p + 17] = zz;
    }

    // ---- hazards --------------------------------------------------------
    // Visual extents are pinned to MR.Collision.BOX: JUMP tops out at 0.80,
    // the DUCK bar spans 1.41-1.83, BLOCK is 2.80 tall and 1.30 deep. Anything
    // added for readability lives outside the runner's corridor or above the
    // top of a full jump (2.05 + 1.78 = 3.83), so nothing here can make the
    // player clip something they legitimately cleared.

    /**
     * ============ THE CAUTION FACES SAY WHAT THE OBJECT IS ============
     *
     * These three diagonal-stripe faces are the largest single-colour area on
     * most hazards, and they used to carry the KIND CODE -- amber, cyan, pink
     * -- on the theory recorded at the variant header below: that a player
     * reads over / under / around from hue before the shape resolves.
     *
     * tools/kindread.js measured that theory against the other channel, on the
     * same frames, through the live chase camera, at 12, 25.35 and 40 units. A
     * nearest-centroid classifier on HUE ALONE misreads 9 of 21 variants. On
     * the SILHOUETTE PROFILE alone -- how much of the lane width the object
     * covers in each of fourteen bands from the road to 2.80 -- it misreads 2.
     * The channel the rule protected is the weaker one, and it is weaker
     * because the fleet rebuild already spent it: BLOCK v6 is orange at h 34
     * and sits inside the JUMP cluster, BLOCK v4 and v0 are at h 196 and 216
     * and sit inside the DUCK cluster. Hue stopped telling the kinds apart
     * some time ago and nothing measured it.
     *
     * So the hue is spent on the owner's ask instead, which is the thing a
     * road actually signals with:
     *
     *   DUCK   YELLOW AND BLACK diagonal -- the thing you go under. This is
     *          reference/ttgr-duckbar-yellow-black.png exactly, and the owner
     *          named it: "yellow thing to dive under... construction zone".
     *   BLOCK  RED AND WHITE -- barrier, road closed. The owner named this one
     *          too ("note red barrier"), it is the marking a real refuse truck
     *          and a real works barricade carry, and it replaces a pink that
     *          meant nothing on a road.
     *   JUMP   AMBER AND DARK -- works and cones, unchanged and already right.
     *
     * WHAT IS NOT TOUCHED, AND THIS IS THE SPLIT THAT MAKES IT SAFE. The
     * telegraph mats painted on the road keep their abstract kind hues and
     * their kind glyphs. The mat says WHAT TO DO; the object now says WHAT IT
     * IS. Those are two channels, not one, and the mat is the one this file
     * already calls "the channel the race is actually lost by misreading".
     */
    /**
     * ---- THE OWNER MOVED JUMP TO RED AND WHITE, AND A BLIND READ SAYS WHY --
     *
     * Verbatim: *"Jump obstacles should be red and white."* Taken on its own
     * that collides with the red-and-white this file gave BLOCK one pass ago,
     * and two kinds sharing a mark is a player jumping into a wall. It does not
     * collide, and the reason is that THE STRIPE WAS NEVER THE KIND CHANNEL.
     *
     * That is measured, twice, from opposite directions:
     *
     *   tools/kindread.js -- a nearest-centroid classifier on HUE alone
     *     misreads 8 to 10 of 21 variants; on the SILHOUETTE PROFILE alone it
     *     misreads 2. The kind is carried by the shape and always was.
     *   A blind reader shown six panels and asked "over, under or around?"
     *     said it in words, unprompted: *"Yellow-and-black chevrons universally
     *     mean 'physical hazard, mind this' -- but that exact striping is used
     *     both on things you duck under and on things you must not hit at all.
     *     The colour tells you the object is dangerous and tells you nothing
     *     about which way to go."*
     *
     * So the stripe is freed to say WHAT THE OBJECT IS, which is the job the
     * owner has been asking it to do all along:
     *
     *   RED AND WHITE   construction furniture -- a barrier, a board, a
     *                   hoarding, a barricade. The thing a works layout puts
     *                   across a road. It is now on the JUMP boards AND on the
     *                   two BLOCK variants that are genuinely furniture (the
     *                   ROAD CLOSED hoarding and the works barricade), because
     *                   those are the same object at two heights and a real
     *                   road marks them the same way.
     *   YELLOW AND BLACK  the thing you go under. Reserved to DUCK, which is
     *                   reference/ttgr-duckbar-yellow-black.png exactly and
     *                   which the owner named directly.
     *
     * THE COSTLIEST CONFUSION IN THE GAME WAS THE TWO YELLOWS, and this is
     * what dissolves it. The blind read: *"Both are essentially a horizontal
     * striped bar spanning the lane, held on supports... What is left in both
     * cases is a short horizontal yellow bar floating in the middle of the
     * lane. Those two want opposite answers, so mistaking them is the costliest
     * error available in this set."* JUMP v1's yellow came from its cone bar
     * and its amber face; the bar is deleted and the face is null, and the
     * whole JUMP family leaves the yellow band to DUCK.
     */
    const stripeTex = {
      jump: stripeTexture('#f0402f', '#fff6ea'),
      duck: stripeTexture('#ffc422', '#1a1206'),
      block: stripeTexture('#f0402f', '#fff6ea'),
    };
    const faceMat = {
      jump: new THREE.MeshBasicMaterial({ map: stripeTex.jump }),
      duck: new THREE.MeshBasicMaterial({ map: stripeTex.duck }),
      block: new THREE.MeshBasicMaterial({ map: stripeTex.block }),
    };

    // Lane telegraph mats. Transparent, unlit, and laid a hair above the road
    // paint so they never z-fight with the lane dashes.
    /**
     * The telegraph mat: 14 units of run-up, because the lane choice has to be
     * made 3-4 gate-lengths out, not 1.
     *
     * The end nearest the player fades to nothing through a per-vertex alpha
     * ramp. Without it the mat is informative at 60 units and then swells into
     * a screen-filling slab of saturated colour in the last quarter-second,
     * which is precisely when the player needs to see the hazard instead.
     */
    const matGeo = (function () {
      const g = new THREE.PlaneGeometry(1.95 * LANE_FIT, 16, 1, 16);
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 4);
      for (let i = 0; i < pos.count; i++) {
        // Local +Y lays down toward -Z, i.e. toward the approaching runner, so
        // the ramp runs over most of the mat's length and only the last few
        // units before the hazard reach full strength.
        const t = Math.max(0, Math.min(1, (8.0 - pos.getY(i)) / 11.0));
        const a = Math.pow(t, 1.5);
        col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1; col[i * 4 + 3] = a;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      return g;
    })();
    const matMat = {};
    matMat[K.JUMP] = new THREE.MeshBasicMaterial({ map: matTexture(K.JUMP, '#ffc23a', 'rgba(58,34,0,0.40)'), transparent: true, depthWrite: false, vertexColors: true });
    matMat[K.DUCK] = new THREE.MeshBasicMaterial({ map: matTexture(K.DUCK, '#4fdcff', 'rgba(0,36,54,0.40)'), transparent: true, depthWrite: false, vertexColors: true });
    matMat[K.BLOCK] = new THREE.MeshBasicMaterial({ map: matTexture(K.BLOCK, '#ff4f78', 'rgba(62,0,22,0.44)'), transparent: true, depthWrite: false, vertexColors: true });

    function telegraph(kind) {
      const m = new THREE.Mesh(matGeo, matMat[kind]);
      m.rotation.x = -Math.PI / 2;
      // Runs a little past the gate line so the paint shows through the open
      // gap under a DUCK bar -- colour at the exact spot of the hazard.
      m.position.set(0, 0.012, -7.2);
      m.renderOrder = 5;
      return m;
    }

    /**
     * HAZARD VARIANTS, and the line they are not allowed to cross.
     *
     * Subway Surfers never uses an abstract coloured block: its obstacles are
     * traffic lights, chevron barriers, crates and train cars. Ours were
     * coloured boxes, and the player asked for street furniture -- cones,
     * signs, detour boards -- so the same gameplay reads as a real closed road.
     *
     * Every variant below is a re-skin and nothing more. What may NOT change:
     *
     *   ENVELOPE. MR.Collision.BOX is the contract -- JUMP tops out at 0.80,
     *     the DUCK bar spans 1.41-1.83, BLOCK is 2.80 tall and 1.30 deep --
     *     and clearance is decided from player STATE against those numbers, not
     *     from these meshes. A variant that broke the envelope would wave a
     *     player through something they visibly hit. Only x is free, and only
     *     through LANE_FIT.
     *   SILHOUETTE CLASS, AND IT IS THIS ONE THAT IS THE CONTRACT. Low wide
     *     mass on the road and nothing above 0.80 for JUMP; a GAP from the road
     *     to 1.41 with a bar over it for DUCK; mass from the road past the 2.05
     *     jump apex for BLOCK. Measured, not asserted: tools/kindread.js reads
     *     the fraction of the lane width each variant covers in fourteen bands
     *     through the live chase camera, and a nearest-centroid classifier on
     *     that profile alone misreads 2 of 21 variants at 12, 25.35 and 40
     *     units. Both failures are the two thin people-hazards.
     *   COLOUR SAYS WHAT THE OBJECT IS, NOT WHICH KIND IT IS.
     *     This rule used to read "Amber JUMP, cyan DUCK, pink BLOCK, always,
     *     on the mass that carries the silhouette -- the hue is how the kind
     *     is known before the shape resolves." That was never measured, and
     *     when it was it turned out to be false: the same classifier on HUE
     *     alone misreads 8 to 10 of 21. It is false because the fleet rebuild
     *     already spent the channel -- BLOCK v6 is orange inside the JUMP
     *     cluster, BLOCK v0 and v4 are cyan inside the DUCK cluster -- and no
     *     one re-measured the rule afterwards. See stripeTex for what the hue
     *     is spent on now and for the mat/object split that keeps it safe.
     *
     * The telegraph mat and the striped face are untouched by all of this, so
     * the readability device the game depends on is identical whichever variant
     * spawns. A variant that reads as scenery is worse than no variant at all.
     */

    /**
     * Build a pooled hazard with several interchangeable bodies.
     *
     * All variants are built and parented once and switched by visibility. An
     * invisible child costs a matrix update and no draw call, so a re-skin
     * lottery is free at render time and the pool stays one pool per kind --
     * which matters, because the spawn window claims and releases by kind.
     */
    // Every hazard vocabulary registers itself here so the contrast audit at
    // the bottom of this file can walk EVERY variant, not merely the handful a
    // given frame happened to spawn.
    const HAZARD_DEFS = [];

    function hazardPool(kind, tint, defs) {
      HAZARD_DEFS.push({ kind, tint, defs });
      // The draw bag. A def's `weight` is how many tickets it holds; variants
      // are then picked by hashing into the bag, so the ratio a variant is
      // authored with is the ratio it actually spawns at, instead of being an
      // emergent property of an ad-hoc modulo. See castGates.
      const bag = [];
      defs.forEach(function (d, i) {
        for (let k = 0; k < (d.weight || 1); k++) bag.push(i);
      });
      const pool = Pool(function () {
        const g = new THREE.Group();
        const variants = [];
        for (const d of defs) {
          const vg = new THREE.Group();
          const body = S.outlined(d.geo, mats.propLit, S.INK.hazard);
          // Four of the twenty-four hazards in this game are PEOPLE -- the
          // marshals, the two cyclists, the trike's rider and the moped's --
          // and they are the only human figures the player is ever close to.
          // The tag puts them in tools/people.js beside the crowd, which is
          // the only way to compare a face at 8 units with a face at 90.
          // A variant with no skin in it contributes no heads and is silent.
          body.userData.people = 'hazard';
          vg.add(body);
          // A VARIANT MAY DECLINE THE FACE. face: null is legal and means the
          // object carries no striped board, because the stripe is now the mark
          // of construction furniture rather than a per-kind decoration -- see
          // stripeTex. Three cones and a bare vehicle both have nowhere to put
          // one, and a quad hanging in the air where a board would be is the
          // "sitting on something" defect this file has now paid for twice.
          if (d.face) {
            const f = new THREE.Mesh(hplane(d.face[0], d.face[1]), faceMat[tint]);
            f.position.set(0, d.face[2], d.face[3]);
            f.rotation.y = Math.PI;
            vg.add(f);
          }
          // The one moving part a variant is allowed: a single extra mesh on
          // its own pivot. Two would be two more draw calls per live hazard.
          if (d.moving) {
            const mv = S.outlined(d.moving, mats.propLit, S.INK.hazard);
            mv.position.set(d.pivot[0] * LANE_FIT, d.pivot[1], d.pivot[2]);
            vg.add(mv);
            vg.userData.moving = mv;
            // Where the moving part rests, so an anim that SLIDES it (see the
            // refuse truck's tailgate) has something to slide from. Reading it
            // back off the mesh would drift, because the mesh is the thing the
            // anim is writing to.
            vg.userData.pivotY = d.pivot[1];
          }
          // THE NEAR-FACE ANCHOR, AND IT IS THIS ONE LINE.
          //
          // MR.Collision.BOX spans [gate.z, gate.z + 2 * halfZ] -- see the
          // anchor note there -- so the art, which is authored about its own
          // centre exactly as it always was, is offset forward by halfZ here
          // and lands inside that box. One line, one place, and every variant
          // of every kind keeps its own authoring frame.
          //
          // It is on the VARIANT group and deliberately not on the pooled
          // group, because the telegraph mat is a sibling: the mat is painted
          // on the road in front of the hazard and its far edge is meant to
          // reach the gate line. Moving the whole object would have dragged
          // the mat forward with it and left a gap where the read is made.
          vg.position.z = (MR.Collision.BOX[kind] || { halfZ: 0 }).halfZ;
          // The footprint the contact shadow is cut to -- the variant's own
          // merged bounding box in xz, not a guess and not the collision box.
          // A tram is long and a kerb is wide and the shadow has to be both.
          //
          // The z half-extent is not enough any more. A vehicle authored with
          // its mass forward of its own centre has a shadow that is not
          // centred either, so the range is carried whole rather than as a
          // half-width about an assumed centre.
          d.geo.computeBoundingBox();
          const bb = d.geo.boundingBox;
          const hz = Math.max(0.30, (bb.max.z - bb.min.z) * 0.5);
          const cz = (bb.max.z + bb.min.z) * 0.5;
          vg.userData.foot = [
            Math.max(0.35, (bb.max.x - bb.min.x) * 0.5),
            cz - hz, cz + hz,
          ];
          vg.userData.body = body;
          // An anim without a `moving` part is legal and is the cheapest thing
          // in this file: the variant group gets a y shudder and nothing else,
          // which is what an idling diesel looks like, for no mesh and no draw.
          vg.userData.anim = d.anim || null;
          vg.visible = false;
          g.add(vg);
          variants.push(vg);
        }
        variants[0].visible = true;
        /**
         * THE CONTACT SHADOW USED TO BE BUILT HERE, AS A SECOND SYSTEM.
         *
         * Every JUMP and BLOCK got its own S.contactShadow blob parented to
         * this group -- one alpha-blended draw call each -- while
         * updateShadows() was independently writing a multiply-blended quad
         * for the same hazard into one pooled geometry. Both shipped, so the
         * tarmac under every JUMP and BLOCK in the game was darkened twice and
         * the frame paid 15 to 26 draw calls for the privilege.
         *
         * The pooled quad kept the job and inherited the two things this one
         * knew that it did not: the variant's own footprint, and no shadow
         * under a DUCK. Both are stated at updateShadows(), which is now the
         * only place a hazard shadow exists. Do not re-add one here.
         *
         * A REAL SHADOW MAP REMAINS REFUSED, WITH THE MEASUREMENT, and that is
         * the part of the old header worth keeping: a DirectionalLightShadow
         * costs +105 to +201 draw calls here and puts two of the eight shots
         * over the 400 ceiling -- 04-wall 265 to 438, 08-level 264 to 465.
         */
        g.add(telegraph(kind));
        // A hazard is the thing the audit protects, not a thing it polices: it
        // is meant to be in the corridor, and one gate hiding another is the
        // game rather than a bug. See api.crossings().
        g.userData.notScenery = true;
        g.userData.variants = variants;
        g.userData.bag = bag;
        g.userData.body = variants[0].userData.body;
        return g;
      }, group);
      // The draw bag, on the POOL rather than only on a pooled object. The
      // casting is computed for the whole course before any hazard has been
      // claimed, so it cannot borrow an object to find out what the bag is --
      // which is what api.variantPlan used to have to do.
      pool.bagOf = function () { return bag; };
      return pool;
    }

    // JUMP v0: a wide amber kerb with a cream cap. The cap is what survives the
    // fog -- a light band on a dark road at 100 units is still a light band.
    // Nothing here rises past 0.80 or reaches past halfZ 0.52.
    // Chamfered, like everything else in the vocabulary. The owner's "boxy" note
    // is not about vehicles only -- a kerb built from four raw slabs is the
    // purest example of it in the game. The cut is inward from the extents, so
    // the 0.80 ceiling and the halfZ 0.52 reach are untouched to the digit.
    // 1.00 DEEP, NOT 1.04. A JUMP box is halfZ 0.52 and the old plinths were
    // 1.04 -- exactly the box, with no room left for the striped face, which
    // was therefore parked at -0.531 and hung 0.011 OUT of the envelope on all
    // four variants. The art gives way to the box, not the other way round.
    /**
     * ============ WHAT THE ORBIT SHEET SAID ABOUT THIS ONE ============
     *
     * reference/jump-orbit-before.png. The brief for this pass claimed all six
     * JUMPs were slabs with a striped face and nothing else; that is not what
     * the sheet shows and the record should say so. v1's cones, v3's scooters,
     * v4's three moulded modules and v5's drum are through-objects and they
     * photograph as themselves from every azimuth -- v4 is the best-built
     * hazard in the game from behind.
     *
     * WHAT IS TRUE IS ABOUT THIS VARIANT AND ABOUT THE PLINTHS. At az 90, 180
     * and 270 the kerb is a plain amber rectangle with a lemon band on top:
     * four masses, no fitting, no join, nothing that says what it is made of
     * or how it got there. It is the only JUMP with nothing on any face but
     * the one carrying the caution stripes, and it is the one the sheet
     * indicts.
     *
     * SO IT IS BUILT AS WHAT IT IS: A PRECAST KERB SECTION. The body is
     * recessed to 0.88 deep and three pilasters stand out to the full 1.00 on
     * both long faces, which is a moulded panel rather than a slab; the foot
     * flares; the ends carry the connector plate a real section is bolted to
     * its neighbour by, standing 0.02 proud of the end block so it exists from
     * the flank; and reflector studs sit in the panel bays.
     *
     * NOTHING GREW. The cap is still 0.66 to 0.80, the end blocks still reach
     * 0.947, and the deepest thing on the object is still the pilaster at
     * z 0.50 against a box halfZ of 0.52 with the caution face at 0.512.
     */
    const jumpGeo = merge([
      // 0.88 deep and 0.62 tall, not 1.00 and 0.66: the body is now the
      // RECESSED panel and the pilasters below are the surface. Same silhouette
      // from directly behind, an entirely different one from anywhere else.
      gl(hcbx(2.24, 0.62, 0.88, 0, 0.31, 0, 0xffb020, 0.07), GLOSS.paint),
      // The foot flare, full depth and slightly wider, so the section sits ON
      // the road instead of being cut off by it.
      gl(hcbx(2.30, 0.14, 1.00, 0, 0.07, 0, 0xe07f12, 0.04), GLOSS.paint),
      // The fillet between panel and cap, so the cap is carried rather than
      // floating on a step.
      gl(hcbx(2.28, 0.06, 0.94, 0, 0.65, 0, 0xe07f12, 0.02), GLOSS.paint),
      // ============ THE CAP IS LEMON, NOT CREAM, ON EVERY JUMP ============
      //
      // This is the fleet's own correction, applied to the vocabulary that
      // never got it. The fleet header states the mechanism: chroma is the
      // AREA MEAN, cream renders at S 0.092, and "a 15% cream band buys 0.04x
      // of luminance and destroys 88% of the object's chroma". The fleet
      // replaced its cream with LEMON 0xfff23a -- rendered (168,177,49),
      // L 159.9, S 0.726 -- and every vehicle's margin moved.
      //
      // The JUMP cap is a bigger share of a JUMP than the fleet's band ever
      // was of a vehicle, because a JUMP is 0.80 tall and the cap is the top
      // of it seen from an elevated camera. So it was doing the same damage,
      // harder, and two of the four variants short of the 1.6x / 0.30 target
      // were JUMPs sitting under it. Measured on the shipped build, target
      // margin before and after the swap:
      //
      //   v0 kerb    +0.120 -> +0.173      v3 scooters  +0.018 -> +0.270
      //   v1 cones   -0.090 -> +0.298      v4 barriers  +0.060 -> +0.524
      //   v2 works   -0.132 -> +0.226      v5 drum      +0.101 -> +0.340
      //
      // **All six clear the target and the two that were short clear it by
      // the widest margins of the four.** The light band survives: lemon
      // renders L 159.9 against a road of 61 to 90, which is the property the
      // cap exists for, and pairwise silhouette separation at 40 units is
      // unchanged to within a point on every pair.
      //
      // It stays MATTE. A highlight belongs on the chamfers and the cylinders
      // where the surface turns, not on a flat band -- see the gloss ladder.
      gl(hcbx(2.34, 0.14, 1.00, 0, 0.73, 0, 0xfff23a, 0.04), GLOSS.matte),
      gl(hcbx(0.30, 0.80, 1.00, -1.16, 0.40, 0, 0xe07f12, 0.05), GLOSS.paint),
      gl(hcbx(0.30, 0.80, 1.00, 1.16, 0.40, 0, 0xe07f12, 0.05), GLOSS.paint),
    ].concat((function () {
      const p = [];
      // THE PILASTERS. Full 1.00 depth against a 0.88 panel, so each stands
      // 0.06 proud on the rear face and 0.06 proud on the front. The front
      // pair are behind the caution plane at every angle the game can produce
      // -- the plane is 0.796 half-wide against a body of 0.810 -- and they
      // are built anyway, because a pilaster is one box through the section
      // and half of one would cost more thought than it saves.
      for (const cx of [-0.72, 0, 0.72]) {
        p.push(gl(hcbx(0.20, 0.54, 1.00, cx, 0.33, 0, 0xe07f12, 0.04), GLOSS.paint));
      }
      // Reflector studs, in the bays between pilasters, on the REAR face where
      // they can be seen. Lemon, matte, on the ladder the cap sits on.
      for (const cx of [-0.36, 0.36]) {
        p.push(gl(hcbx(0.22, 0.11, 0.06, cx, 0.42, 0.47, 0xfff23a, 0.02), GLOSS.matte));
      }
      // The connector plate at each end -- what one precast section is bolted
      // to the next by, and the only fitting on this object that exists purely
      // for the flank. 0.969 against the end block's 0.947, so it is genuinely
      // proud, and 1.118 is the line it is nowhere near.
      for (const sx of [-1, 1]) {
        // The plate is the BODY's amber and the bolts are lemon, not the other
        // way round: at 0.66 deep and 0.44 tall a lemon plate is a third of
        // the flank and turns the end of the section into a panel. What the
        // flank wants is a fitting, so the bright is on the four bolt heads.
        p.push(gl(hcbx(0.36, 0.42, 0.62, sx * 1.16, 0.33, 0, 0xffb020, 0.04), GLOSS.paint));
        for (const bz of [-0.20, 0.20]) {
          for (const by of [0.20, 0.46]) {
            p.push(gl(cyl(0.045, 0.045, 0.09, 6, sx * 0.966, by, bz, 0xfff23a, 0, 0, Math.PI / 2), GLOSS.chrome));
          }
        }
      }
      return p;
    })()));

    /**
     * JUMP v1: THREE LARGE ORANGE CONES STANDING ON THE ROAD. Nothing between
     * them, nothing under them.
     *
     * ---- THE OWNER REJECTED THE PREVIOUS VERSION, IN FOUR CLAUSES ----------
     *
     * Verbatim: *"Cones should be individual large orange. Needs to be
     * connected to the road with no platform."* Held against what shipped,
     * that sentence names four separate faults and every one of them was real:
     *
     *   INDIVIDUAL   five cones were LINKED by a 2.30-wide cone bar across the
     *                front. Whatever a real works layout does, a bar joining
     *                the cones is the thing the eye reads, and it read as one
     *                object rather than as cones. The bar is gone.
     *   LARGE        five cones across a 2.24-wide envelope is a 0.40 foot and
     *                a 0.19 body -- at 25 units those are orange slivers. Three
     *                cones with a 0.36 foot are 1.8x the base radius and 1.6x
     *                the body radius, and each one is now a readable object
     *                instead of a picket in a fence.
     *   ORANGE       kept, and now uncontested: the bar and its lemon strip
     *                were the two brightest things on the variant and both were
     *                competing with the cones for the read.
     *   NO PLATFORM  the plinth had already gone, but each cone still stood on
     *                its own 0.40 x 0.40 moulded square weight -- a plate,
     *                sitting on the road, with the cone sitting on IT. That is
     *                the same figure-on-a-pedestal read at one fifth the scale,
     *                and it is the fault the owner has now named twice.
     *
     * ---- WHAT A CONE IS, AS ONE CONTINUOUS BODY OF REVOLUTION -------------
     *
     * The fix for "no platform" is not to delete the weight and leave the body
     * hanging: it is that the weight and the body are THE SAME SURFACE. A real
     * traffic cone is one moulding whose skirt flares out and touches the road
     * -- there is no join, and there is no plate, because the plate IS the
     * bottom of the cone.
     *
     * So the profile below is a single revolved silhouette sampled at nine
     * heights, from a 0.36 skirt sitting ON y = 0 to a rounded tip at 0.78, and
     * the flare is CURVED rather than straight: radius falls fast over the
     * first 0.09 and then slowly, which is the shape that makes a cone look
     * moulded rather than turned. Sixteen radial segments, not twelve, because
     * the owner asked for "round" in the same breath and an octagon at 25 units
     * is what "box like" means on a body of revolution.
     *
     * ENVELOPE, and art gives way to it. A JUMP box is halfX 1.12, halfZ 0.52,
     * yMax 0.80. The outer cones stand at +/-0.72 with a 0.36 skirt, so the
     * widest point is 1.08 against 1.12. The tip is 0.78 against 0.80. The
     * deepest skirt edge is 0.36 against 0.52. Nothing here is the widest,
     * tallest or deepest thing the box allows, which is the margin the audit
     * wants rather than a number squeezed up against the limit.
     *
     * THE FEET TOUCH AT THE ROAD, WHICH IS THE GAMEPLAY PROPERTY. Three skirts
     * of radius 0.36 at 0.72 apart meet exactly, edge to edge, so the row is
     * continuous along the bottom where the eye looks for a gap to run through
     * -- the one job the deleted plinth and the deleted bar were each hired for,
     * done here by the cones' own size instead of by a slab between them.
     *
     * AND IT CARRIES NO CAUTION FACE. See the def list: a cone does not have a
     * striped board on it, and the fleet's stripe now means construction
     * furniture rather than "hazard". This is the first variant in the game
     * with face: null and the pool handles it; what pays for the lost bright
     * area is stated with the measured gate margin at the def.
     */
    const jumpConeGeo = (function () {
      const parts = [];
      // Three cones, evenly across the lane, all square to the road. The
      // shallow V the five used to stand in was there to stop a straight rank
      // reading as a fence -- with three large cones there is no rank to read,
      // and staggering them in z would only spend the halfZ the skirt now wants.
      const lay = [-0.72, 0, 0.72];
      /**
       * The moulded profile: [y, radius]. y = 0 IS THE ROAD -- the first
       * sample is the skirt edge lying on the tarmac, so there is no gap under
       * this object and no plate beneath it at any point.
       */
      const PROF = [
        [0.000, 0.360],   // skirt edge, on the road
        [0.040, 0.306],   // the flare turns up hard
        [0.090, 0.262],
        [0.170, 0.232],   // and then the long taper begins
        [0.300, 0.196],
        [0.430, 0.160],
        [0.560, 0.122],
        [0.680, 0.081],
        [0.780, 0.034],   // the tip, blunt rather than needled
      ];
      const CONE_ORANGE = 0xff7a12;
      for (const cx of lay) {
        for (let i = 0; i < PROF.length - 1; i++) {
          const [y0, r0] = PROF[i], [y1, r1] = PROF[i + 1];
          // cyl(rTop, rBottom, h, seg, ...) -- so the TOP radius is the next
          // sample up and the BOTTOM is this one. Getting these the wrong way
          // round builds a cone standing on its point and still merges cleanly.
          parts.push(gl(cyl(r1, r0, y1 - y0, 16, cx, (y0 + y1) / 2, 0, CONE_ORANGE), GLOSS.paint));
        }
        /**
         * THE TWO REFLECTIVE BANDS, AND THE COLOUR THEY ARE ALLOWED TO BE.
         *
         * A real cone's bands are white, and the coordinator asked for "orange
         * with the white band". White is also what this whole fleet had to give
         * up once: MEASUREMENTS.md records a cream band costing 0.085 of
         * saturation and failing the build on a variant that had margin to
         * spare, which is why every band in the JUMP set is lemon 0xfff23a.
         *
         * These are tried as WHITE and kept only if the gate holds, because the
         * owner asked for it in plain words and "we tried lemon once on a
         * different variant" is not a measurement of this one. The number that
         * decided it is recorded at the def below. Art never overrides the gate;
         * it is allowed to ask the gate a question.
         */
        const band = function (y0, y1, over) {
          // Straddling the taper it sits on, sized off the profile so it stands
          // proud by a consistent 0.012 rather than sinking into the body at one
          // end and floating off it at the other.
          const rAt = function (y) {
            for (let i = 0; i < PROF.length - 1; i++) {
              if (y >= PROF[i][0] && y <= PROF[i + 1][0]) {
                const t = (y - PROF[i][0]) / (PROF[i + 1][0] - PROF[i][0]);
                return PROF[i][1] + t * (PROF[i + 1][1] - PROF[i][1]);
              }
            }
            return PROF[PROF.length - 1][1];
          };
          parts.push(gl(cyl(rAt(y1) + over, rAt(y0) + over, y1 - y0, 16,
            cx, (y0 + y1) / 2, 0, 0xfff6ea), GLOSS.matte));
        };
        band(0.255, 0.395, 0.012);
        band(0.530, 0.625, 0.012);
      }
      return merge(parts);
    })();

    /**
     * JUMP v2: a works trench with a low chevron barrier over it. The dark
     * trench mouth under the board is what makes this one read differently at
     * speed -- a hole rather than a lump -- while the amber frame and the
     * light cap keep it in the same family.
     *
     * THE MOUTH IS DARK AMBER AND NOT NAVY, which is the second half of the
     * contrast fix and the same area-mean rule as the cap. The fleet states
     * it plainly: "Every dark bottom is a dark version of its own vehicle's
     * hue rather than a shared neutral... one grey bumper bar on seven
     * vehicles would put 13% of neutral back into every one of them." The
     * mouth is 2.24 wide across the front of a 0.80-tall object -- the single
     * largest dark area in the JUMP vocabulary -- and it was 0x2b2f52, a
     * near-neutral navy. At 0x3d2408 it still reads as a hole, because what
     * makes a hole is the VALUE step and not the hue, and the variant's
     * saturation against the road went 0.034 to 0.170 on that change alone.
     * The cone bases in v1 were the same navy and took the same correction.
     */
    /**
     * WHAT THE ORBIT SHEET ADDED TO THAT. The mouth was a dark slab lying on
     * the road, 0 to 0.16, and a slab is a shadow rather than a hole: it reads
     * as one at az 0 only because you are looking slightly down onto a dark
     * band. From the flank it is a dark stripe and from behind it is the same
     * dark stripe. The header above argues the dark mouth is "what makes this
     * one read differently at speed", and it was carrying that on a value step
     * alone.
     *
     * So the trench is now an EXCAVATION: a rim standing proud of the road on
     * all four sides, a floor dropped below it, and a duct pair lying in the
     * bottom. That is a hole you can see into from in front, from behind and
     * from either flank, and the value step the header relies on is now the
     * inside of something rather than a painted band.
     *
     * The rim is 0.20 tall and the board's underside is 0.40, so the gap you
     * see through is unchanged and so is everything the collision box says.
     */
    const jumpWorksGeo = merge([
      // The excavation floor, dropped and darker than the rim around it.
      gl(hbx(2.06, 0.04, 0.76, 0, 0.02, 0, 0x2a1806), GLOSS.matte),
      // The rim: four sides, so the mouth has an edge and the edge has a top.
      // 0.44 and -0.44 in z against a body half-depth of 0.50 -- the rim is
      // inside the section, which is what makes the floor read as below it.
      gl(hcbx(2.30, 0.20, 0.12, 0, 0.10, 0.44, 0xe07f12, 0.03), GLOSS.paint),
      gl(hcbx(2.30, 0.20, 0.12, 0, 0.10, -0.44, 0xe07f12, 0.03), GLOSS.paint),
      gl(hcbx(0.14, 0.20, 1.00, -1.11, 0.10, 0, 0xe07f12, 0.03), GLOSS.paint),
      gl(hcbx(0.14, 0.20, 1.00, 1.11, 0.10, 0, 0xe07f12, 0.03), GLOSS.paint),
      // The dark inner walls, so what you see over the rim is the SIDE of a
      // hole and not the road with a frame on it.
      gl(hbx(2.06, 0.16, 0.06, 0, 0.08, 0.35, 0x3d2408), GLOSS.matte),
      gl(hbx(2.06, 0.16, 0.06, 0, 0.08, -0.35, 0x3d2408), GLOSS.matte),
      // The ducts in the bottom of it. Two runs along the trench, one banded,
      // which is the whole reason anyone digs one of these.
      gl(cyl(0.07, 0.07, 2.00 * LANE_FIT, 10, 0, 0.09, 0.14, 0xc26200, 0, 0, Math.PI / 2), GLOSS.trim),
      gl(cyl(0.06, 0.06, 2.00 * LANE_FIT, 10, 0, 0.08, -0.10, 0x3d2408, 0, 0, Math.PI / 2), GLOSS.trim),
      // 0.88 deep, with the stiffener ribs below standing out to 1.00 -- the
      // same construction the kerb takes, because a chevron board is a pressed
      // panel and a pressed panel has ribs. It is also the only way to put
      // anything on the rear face of a mass that already fills its own halfZ.
      gl(hcbx(2.24, 0.34, 0.88, 0, 0.57, 0, 0xffb020, 0.05), GLOSS.paint),
      gl(hcbx(2.36, 0.14, 1.00, 0, 0.73, 0, 0xfff23a, 0.04), GLOSS.matte),
      gl(hcbx(0.34, 0.80, 0.34, -1.13, 0.40, -0.32, 0xe07f12, 0.06), GLOSS.paint),
      gl(hcbx(0.34, 0.80, 0.34, 1.13, 0.40, -0.32, 0xe07f12, 0.06), GLOSS.paint),
      gl(hcbx(0.34, 0.80, 0.34, -1.13, 0.40, 0.32, 0xe07f12, 0.06), GLOSS.paint),
      gl(hcbx(0.34, 0.80, 0.34, 1.13, 0.40, 0.32, 0xe07f12, 0.06), GLOSS.paint),
    ].concat((function () {
      const p = [];
      for (const cx of [-0.70, 0, 0.70]) {
        p.push(gl(hcbx(0.18, 0.30, 1.00, cx, 0.57, 0, 0xc26200, 0.03), GLOSS.paint));
      }
      // The clamp collars where the board meets its legs. From behind this was
      // a plain amber board on four plain amber legs; the collars are what
      // make it a barrier that was carried here and bolted up rather than an
      // extruded shape. Proud in x only -- z is already at 0.49 against a
      // 0.50 ceiling on the legs themselves, and the art gives way to the box.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          p.push(gl(hcbx(0.44, 0.10, 0.34, sx * 1.13, 0.66, sz * 0.32, 0xfff23a, 0.03), GLOSS.trim));
          p.push(gl(hcbx(0.44, 0.09, 0.34, sx * 1.13, 0.26, sz * 0.32, 0xc26200, 0.03), GLOSS.trim));
        }
      }
      return p;
    })()));

    /**
     * JUMP v3: DOCKLESS KICK SCOOTERS DOWN IN THE LANE.
     *
     * The two-wheeler that earns a JUMP rather than a BLOCK, and it earns it by
     * being the one that is genuinely low. Ridden, a stand-up scooter is a
     * 2.5-tall column a third of a lane wide -- the exact shape the trike note
     * rejects a bicycle for. Dumped in the road, which is what these actually
     * are most of the time they are in anyone's way, it is a 0.45-tall object
     * lying across the lane, and that is a hurdle.
     *
     * Same construction as the cones: the PLINTH is the read and the scooters
     * are what you see once you are close enough for it to be flavour. One is
     * down flat with its bar across the lane, the second is propped against the
     * plinth at 0.79 -- under the 0.80 the collision box records, with the
     * clearance threshold at 0.84 above that.
     */
    const jumpScooterGeo = (function () {
      const parts = [
        // The shared plinth, recessed to 0.88 with pilasters at 1.00, exactly
        // as v0 and v1 now build it.
        hbx(2.24, 0.22, 0.88, 0, 0.11, 0, 0xffb020),
        hbx(2.34, 0.10, 1.00, 0, 0.27, 0, 0xfff23a),
        hbx(0.28, 0.32, 1.00, -1.16, 0.16, 0, 0xe07f12),
        hbx(0.28, 0.32, 1.00, 1.16, 0.16, 0, 0xe07f12),
      ];
      for (const cx of [-0.72, 0, 0.72]) {
        parts.push(gl(hcbx(0.18, 0.20, 1.00, cx, 0.10, 0, 0xe07f12, 0.03), GLOSS.paint));
      }
      // Down flat. Wheels are discs on their SIDE here -- a scooter on the deck
      // has its wheels lying horizontal, which is the one orientation where the
      // default cylinder axis is already right.
      parts.push(bxAt(1.28, 0.11, 0.30, -0.30, 0.38, -0.10, 0xfff23a));
      parts.push(bxAt(0.18, 0.13, 0.30, -0.98, 0.39, -0.10, 0x2b2f52));
      parts.push(cyl(0.12, 0.12, 0.07, 8, -0.72, 0.42, -0.24, 0x1e2140));
      parts.push(cyl(0.12, 0.12, 0.07, 8, 0.20, 0.42, -0.02, 0x1e2140));
      parts.push(bxAt(0.78, 0.09, 0.09, 0.58, 0.39, -0.10, 0xff7a1f));
      parts.push(bxAt(0.14, 0.09, 0.50, 0.92, 0.39, -0.10, 0x2b2f52));
      // Propped. The only vertical in the object, and it is what stops the
      // silhouette being a flat slab with a scribble on it.
      parts.push(bxAt(0.09, 0.60, 0.09, 0.83, 0.50, 0.26, 0xff7a1f, 0, 0, 0.42));
      parts.push(bxAt(0.40, 0.08, 0.09, 0.68, 0.72, 0.26, 0x2b2f52));
      // 0.62 wide at 0.80 out, NOT 0.75 at 1.13. The wider version reached
      // x = 1.19, past the 1.118 HAZARD_HALF this file derives its clearances
      // from and 0.24 further out than any other JUMP -- two hazards in
      // adjacent lanes would have interpenetrated.
      parts.push(bxAt(0.62, 0.10, 0.22, 0.80, 0.30, 0.26, 0xfff23a));
      // THE FITTINGS THE ORBIT SHEET ASKED FOR. Both scooters had a deck, two
      // wheels and a bar, and read from behind as a scribble on a slab. What a
      // dumped scooter actually shows you is its UNDERSIDE and its cockpit --
      // the stem clamp, the grips on the ends of the bar, the disc brake and
      // the folding latch -- and from the chase view of a machine lying flat
      // those are the only parts standing off the deck at all.
      // Grips on the downed scooter's bar. The bar is bxAt(...0.92...), i.e.
      // world x 0.665, and it runs along z from -0.35 to 0.15 -- so the grips
      // are cylinders on that axis at its two ends, which is why they take
      // rx = PI/2 rather than the deck's orientation.
      for (const gz of [-0.32, 0.12]) {
        parts.push(gl(cyl(0.055, 0.055, 0.14, 8, 0.92 * LANE_FIT, 0.39, gz, 0x3d2408, Math.PI / 2), GLOSS.trim));
      }
      // The stem clamp and the folding latch, both standing off the deck.
      parts.push(gl(cbx(0.16, 0.10, 0.20, 0.62, 0.42, -0.10, 0xc26200, 0.03), GLOSS.trim));
      parts.push(gl(cyl(0.05, 0.05, 0.10, 8, 0.20, 0.42, -0.02, 0xfff23a, 0, 0, Math.PI / 2), GLOSS.chrome));
      // The brake disc, on the flat scooter's rear wheel, facing up -- which
      // is the one face of it a chase camera on a crest ever sees.
      parts.push(gl(cyl(0.085, 0.085, 0.03, 10, -0.72, 0.455, -0.24, 0xfff23a), GLOSS.chrome));
      // The propped scooter's grips. Its handlebar is bxAt(0.40 ... 0.68 ...),
      // world x 0.29 to 0.69 at y 0.72, so the grips cap that span.
      for (const gx of [0.31, 0.67]) {
        parts.push(gl(cyl(0.05, 0.05, 0.11, 8, gx, 0.72, 0.26, 0x3d2408, 0, 0, Math.PI / 2), GLOSS.trim));
      }
      return merge(parts);
    })();

    /**
     * JUMP v4: LINKED WATER-FILLED BARRIERS, the moulded plastic run that
     * closes a lane at every set of roadworks in the world.
     *
     * The reason this one is worth a variant is its TOP EDGE. Every other JUMP
     * in the set carries one straight cream band across the full lane, so at
     * forty units the four of them differ only below the cap -- which is the
     * part fog and foreshortening take first. A barrier run is three separate
     * moulded units with rounded shoulders and a 0.06 gap at each joint, so
     * the light band is THREE segments with two notches in it, and that is a
     * difference in the one part of the silhouette that survives distance.
     *
     * The gaps are deliberately narrow and the sill under them is continuous.
     * The cone note in this file is the reason: three separate objects with
     * road showing between them read as things to look at rather than as a
     * lane you cannot run down, and the sill is what keeps this a lane.
     *
     * NO NAVY ANYWHERE, and that is the contrast lesson from the fleet applied
     * to a JUMP for the first time. The dark parts are dark AMBER. See the
     * note above jumpConeGeo's rebuild.
     */
    const jumpBarrierGeo = (function () {
      const parts = [
        // The continuous sill. Dark amber rather than a neutral, so the one
        // element that spans the whole lane still carries the hue.
        // 0.88 deep, with a foot block under each module standing out to
        // 1.00 -- so the run has three feet with a recess between them rather
        // than one continuous cut-off slab. Same construction as the kerb's
        // pilasters and the chevron board's ribs.
        gl(hcbx(2.28, 0.16, 0.88, 0, 0.08, 0, 0xe07f12, 0.04), GLOSS.paint),
      ];
      for (let i = 0; i < 3; i++) {
        const cx = -0.76 + i * 0.76;
        // Heavy chamfer: these are blow-moulded, and the shoulder is the
        // whole shape. 0.14 on a 0.52 module is the most the primitive will
        // take without inverting (see chamferGeo's clamp).
        parts.push(gl(hcbx(0.62, 0.52, 0.94, cx, 0.42, 0, 0xffb020, 0.13), GLOSS.paint));
        // The moulded waist, in the body's own darker hue.
        parts.push(gl(hcbx(0.66, 0.07, 0.96, cx, 0.40, 0, 0xe07f12, 0.02), GLOSS.paint));
        // The cap segment. Matte, for the reason stated on the kerb's cap.
        parts.push(gl(hcbx(0.68, 0.12, 0.96, cx, 0.72, 0, 0xfff23a, 0.03), GLOSS.matte));
      }
      // The interlock pins standing in the joints. Two of them, and they are
      // what tells you at close range that this is a linked run rather than
      // three bins in a row.
      for (const sx of [-0.38, 0.38]) {
        parts.push(gl(bxAt(0.09, 0.62, 0.16, sx, 0.45, 0, 0xe07f12), GLOSS.trim));
      }
      // THE FILL CAP AND THE DRAIN PLUG, which is the pair of fittings that
      // makes a water-filled barrier a water-filled barrier rather than a
      // moulded lump. The orbit sheet rates this variant the best-built JUMP
      // from behind and it still had no opening anywhere: you cannot fill it.
      //
      // The cap sits on the top band at 0.755-0.795 against a ceiling of 0.80,
      // and the plug is on the rear face of each module at z 0.44-0.50 against
      // a module depth of 0.94 -- both inside the envelope by construction
      // rather than by luck.
      for (let i = 0; i < 3; i++) {
        const cx = (-0.76 + i * 0.76) * LANE_FIT;
        parts.push(gl(cyl(0.075, 0.075, 0.05, 10, cx, 0.775, 0, 0xc26200), GLOSS.trim));
        parts.push(gl(cyl(0.045, 0.045, 0.03, 8, cx, 0.785, 0, 0xe07f12), GLOSS.chrome));
        for (const sz of [-1, 1]) {
          parts.push(gl(cyl(0.06, 0.06, 0.07, 8, cx, 0.28, sz * 0.465, 0xc26200, Math.PI / 2), GLOSS.trim));
        }
      }
      for (let i = 0; i < 3; i++) {
        const cx = (-0.76 + i * 0.76) * LANE_FIT;
        parts.push(gl(cbx(0.36, 0.16, 1.00, cx, 0.08, 0, 0xe07f12, 0.04), GLOSS.paint));
      }
      return merge(parts);
    })();

    /**
     * JUMP v5: A CABLE DRUM ON A CROSSING RAMP.
     *
     * The only round-topped JUMP in the set, and that is the entire design
     * argument. Four of the five others are a rectangular mass with a straight
     * or scalloped light band; a drum on its side puts a CIRCLE on the
     * skyline, which is the one silhouette primitive the vocabulary has never
     * used at this height. The telegraph mat's rungs and the striped face are
     * unchanged, so the kind read is identical -- what changes is the shape
     * that resolves first.
     *
     * Both objects are real and belong together: a rubber cable ramp across
     * the carriageway and the drum the cable came off, which is what an event
     * power run looks like from the moment it is laid to the moment it is
     * lifted.
     *
     * THE DRUM'S AXIS RUNS ALONG Z, AND THE FIRST DRAFT HAD IT ALONG X.
     * That is not a detail. A cylinder lying across the lane shows the player
     * its BARREL -- a rectangle -- and hides both flanges edge-on, so the one
     * thing this variant exists for was invisible from the chase view and only
     * appeared from the flank. Down the lane instead, the rear flange is a
     * cream disc facing the lens and the barrel is what the next lane sees.
     * Caught on the fleet sheet at az 0, not by reading the code.
     *
     * The flanges are cream on both ends and the barrel is fully wound on all
     * sides, per rule 1: you pass this at 1.70 units and the far flange is in
     * shot for as long as the near one.
     */
    const jumpDrumGeo = (function () {
      const parts = [
        // The ramp. Chamfered hard on all twelve edges, which at 0.30 tall
        // over a 1.00 depth is most of the section -- so the profile really is
        // a wedge up to a flat top rather than a slab with cut corners.
        gl(hcbx(2.24, 0.30, 1.00, 0, 0.15, 0, 0xffb020, 0.14), GLOSS.paint),
        // The cream tread strip down the middle of the ramp, which is the
        // light band this family is read by. 0.66 deep and not 0.44: at 0.44
        // the whole variant measured L 146.5 against a 1.6x target of 144.6,
        // which is 1.3% of margin on the axis that carries it. The strip is
        // the only lever here that moves L without moving the silhouette.
        gl(hcbx(2.30, 0.09, 0.66, 0, 0.325, 0, 0xfff23a, 0.03), GLOSS.matte),
        gl(hcbx(0.26, 0.34, 1.00, -1.10, 0.17, 0, 0xe07f12, 0.05), GLOSS.paint),
        gl(hcbx(0.26, 0.34, 1.00, 1.10, 0.17, 0, 0xe07f12, 0.05), GLOSS.paint),
      ];
      // The drum. Rotated PI/2 about x puts the cylinder axis along z, so the
      // radius spans x and y: the top is 0.50 + 0.26 = 0.76 against a box
      // ceiling of 0.80, and the flanges reach z 0.315 against a halfZ of
      // 0.52. Both checked by fleetExtents, neither guessed.
      const dx = 0.40;
      parts.push(gl(cyl(0.20, 0.20, 0.54, 12, dx, 0.50, 0, 0xe07f12, Math.PI / 2), GLOSS.paint));
      for (const s of [-1, 1]) {
        parts.push(gl(cyl(0.26, 0.26, 0.07, 14, dx, 0.50, s * 0.28, 0xfff23a, Math.PI / 2), GLOSS.matte));
      }
      // The wound cable: one darker ring proud of the barrel, so the drum is
      // not an empty spool.
      parts.push(gl(cyl(0.23, 0.23, 0.34, 12, dx, 0.50, 0, 0xc26200, Math.PI / 2), GLOSS.trim));
      // The coiled tail, lying flat on the ramp on the other side. Upright
      // axis, so it is a disc seen edge-on from behind and a ring from above
      // -- the crest of a hill is where that reads, and hills pitch the
      // camera down onto it.
      parts.push(gl(cyl(0.24, 0.24, 0.09, 12, -0.50, 0.345, 0.02, 0xc26200), GLOSS.trim));
      parts.push(gl(cyl(0.13, 0.13, 0.11, 10, -0.50, 0.355, 0.02, 0xffb020), GLOSS.paint));
      // THE SPINDLE BORE. A drum turns on an axle and this one was a solid
      // disc on each end: the single most recognisable feature of a cable drum
      // is the square hole through the middle of both flanges, and it is
      // visible from az 0 and az 180 alike because the axis runs down the lane.
      parts.push(gl(cyl(0.075, 0.075, 0.66, 8, dx, 0.50, 0, 0x3d2408, Math.PI / 2), GLOSS.matte));
      // A second wound layer, narrower and proud of the first, so the barrel
      // is a coil rather than one turned cylinder.
      parts.push(gl(cyl(0.245, 0.245, 0.18, 12, dx, 0.50, 0, 0xe07f12, Math.PI / 2), GLOSS.trim));
      // The chock stopping it rolling. It is on the ramp, on the drum's
      // downhill side, and it is the fitting that explains why a round object
      // is sitting still in the road.
      parts.push(gl(cbx(0.30, 0.14, 0.22, dx, 0.36, 0.34, 0xc26200, 0.04), GLOSS.paint));
      // THE CHANNEL MOUTHS. A cable ramp is a hollow section with the cable
      // running through it, and both ends of the run were solid amber. These
      // are the bores, standing 0.05 proud of each end of the ramp so the
      // opening exists from the flank, which is the only place it can be seen.
      for (const sx of [-1, 1]) {
        for (const bz of [-0.22, 0.22]) {
          parts.push(gl(cyl(0.075, 0.075, 0.13, 8, sx * 0.94, 0.15, bz, 0x3d2408, 0, 0, Math.PI / 2), GLOSS.matte));
        }
      }
      return merge(parts);
    })();

    const jumpPool = hazardPool(K.JUMP, 'jump', [
      // Every face is 0.512 now: outside the 0.50 the art reaches and inside
      // the 0.52 the box allows. They were 0.521 and 0.531.
      { geo: jumpGeo, face: [2.2, 0.62, 0.36, -0.512] },
      /**
       * THE CONES CARRY NO CAUTION FACE AT ALL, and this is the first variant
       * in the game with face: null.
       *
       * Three reasons, and the third is the one that decided it:
       *
       *   A CONE HAS NO BOARD ON IT. The stripe now means construction
       *     furniture -- barrier, board, hoarding -- and a cone is furniture
       *     that carries its own bands instead. Bolting a striped panel across
       *     three cones would rebuild the cone bar the owner just asked us to
       *     delete, in a different material.
       *   NOWHERE TO SIT. The face is centred on the lane by the pool
       *     (f.position.set(0, ...)), so it can only ever sit on something
       *     centred -- and with the bar gone the only thing on the centre line
       *     is the middle cone, whose front surface is 0.20 wide at that
       *     height. A 1.63-wide quad there is a striped mat hanging in the air
       *     between the cones, which is roadmap entry 38's defect exactly.
       *   IT IS WHAT FIXES THE COSTLIEST CONFUSION IN THE GAME. The blind read
       *     found JUMP v1 and DUCK v2 both reducing at 25 units to "a short
       *     horizontal yellow bar floating in the middle of the lane", and
       *     those two want OPPOSITE answers. The bar was one of the two yellow
       *     horizontals; this face was the other. Both are gone, and what is
       *     left of a JUMP at 25 units is three orange cones with no horizontal
       *     in them anywhere.
       *
       * THE GATE COST, MEASURED AND NOT ASSUMED: see the note in the roadmap.
       * Removing a 1.63 x 0.15 striped quad takes bright area off a variant
       * that has to hold 1.25x luminance and 0.22 saturation against the road,
       * and the three enlarged cones are what pays it back.
       */
      { geo: jumpConeGeo, face: null },
      { geo: jumpWorksGeo, face: [2.2, 0.32, 0.57, -0.512] },
      { geo: jumpScooterGeo, face: [2.2, 0.24, 0.16, -0.512] },
      { geo: jumpBarrierGeo, face: [2.2, 0.26, 0.30, -0.512] },
      { geo: jumpDrumGeo, face: [2.2, 0.22, 0.16, -0.512] },
    ]);

    /**
     * DUCK: the bar is only 0.42 tall, which is nothing at distance, so the
     * height comes from tall yellow standards rather than from anything spanning
     * the lane.
     *
     * That distinction is not cosmetic, and it constrains every variant. The
     * chase camera trails 5.1 units and carries 42% of the jump arc, so it
     * sweeps y = 1.76 to 3.14 right through a gate's lane. An earlier version
     * had a header board at 2.44 and the camera flew straight into it -- one
     * frame of full-screen yellow-and-black stripes. ABOVE THE BAR, ONLY THIN
     * MEMBERS,
     * and only out at the standards, so the worst a clip can ever be is a
     * sliver of post.
     */
    /**
     * ============ WHAT THE ORBIT SHEET SAID ABOUT THIS VOCABULARY ============
     *
     * reference/duck-orbit-before.png, five variants at az 0 / 90 / 180 / 270,
     * one scale. The finding is not the one the brief for this pass predicted
     * and it is worth writing down in both directions.
     *
     * AT az 0 the five are told apart easily -- roundels, a skirt, a round bar,
     * a boarded ledger -- and the caution face is the same on all five, which
     * is the contract. AT az 180 THREE OF THE FIVE ARE THE SAME OBJECT. v0, v1
     * and v2 photograph as one flat bar between two flat posts (cyan at the time;
     * the vocabulary is construction yellow and black now, see stripeTex), with
     * nothing on the rear of the bar, nothing on the rear of the standards, and
     * no fitting anywhere: every distinguishing feature these variants own is
     * on the face they turn toward the lens at spawn. v3 and v4 pass, because a
     * skirt and a set of banding collars are through-objects rather than
     * applied fronts.
     *
     * You pass a DUCK. The camera goes under it, banks through the lane change
     * beside it, and leaves it behind at 1.70 units -- so az 180 and az 90 are
     * both real framings and the sheet is the proof rule 1 asks for.
     *
     * WHAT THE FLANK CANNOT BE GIVEN, and this is a refusal with a number. A
     * DUCK box is halfZ 0.30. Every variant already reaches 0.292 through the
     * caution face, so the entire depth budget for new art is z in [-0.29,
     * +0.29] -- 0.58 against a post that is already 0.30 deep. There is no
     * amount of modelling that makes a 0.58-deep object read as a solid from
     * the side, and widening the box would widen what BLANKS believes every
     * gate hides. So the flank is bought the only way it can be: by putting a
     * STEP in the silhouette -- a rear leg, a transom, a bracket, a second
     * conduit -- between z 0.14 and z 0.29, where the post is not. The flank
     * stays slim on purpose and the sheet shows it staying slim.
     *
     * WHAT DOES GET BUILT is the rear and the near quarters, which had nothing
     * and had no excuse. Per variant, and the whole point is that these five
     * rear elevations are now five different objects:
     *
     *   v0  a braced portal: rear leg, tie rungs, haunches at the bar, two
     *       stiffener ribs down the back of the bar, bolted feet.
     *   v1  tube and fitting: a second ledger tube on the rear plane, transoms
     *       across the depth, a coupler at every node, a toe board.
     *   v2  the back of a sign: perimeter frame, two channel stiffeners, clip
     *       brackets, and the roundel on BOTH faces instead of the front only.
     *   v3  the mechanism: a pivot bearing through the post and out both
     *       faces, a counterweight built as a disc stack on an arm, hoods
     *       behind the lamps.
     *   v4  a second, smaller conduit on saddle brackets at z +0.21, with
     *       flange bolts at the collars.
     */
    const duckGeo = merge([
      // The bar and the standards are chamfered too. A DUCK is read as a
      // silhouette at forty units, and the cut is small enough not to touch
      // that -- what it changes is the near view, where the bar the camera
      // flies under was four flat faces meeting at square corners.
      // 0.56 deep, not 0.60/0.62. A DUCK box is halfZ 0.30 and the cap was
      // 0.62 -- 0.01 outside its own envelope, with the striped face 0.002
      // outside that again. Same correction as the JUMP plinths.
      gl(hcbx(2.30, 0.30, 0.56, 0, 1.56, 0, 0xffc422, 0.05), GLOSS.paint),
      gl(hcbx(2.36, 0.12, 0.56, 0, 1.77, 0, 0xfff0a0, 0.03), GLOSS.trim),
      // TWO STIFFENER RIBS DOWN THE BACK OF THE BAR. The bar's front is not
      // available: the caution face is 2.26 * LANE_FIT wide against a bar of
      // 2.30 * LANE_FIT, so it covers all but 0.015 of it and anything modelled
      // there is behind a plane at every angle the game can produce. The rear
      // face is 0.55 of the object's silhouette from directly behind and had
      // nothing on it at all.
      gl(hcbx(2.24, 0.09, 0.10, 0, 1.50, 0.235, 0xd18a08, 0.02), GLOSS.paint),
      gl(hcbx(2.24, 0.09, 0.10, 0, 1.66, 0.235, 0xd18a08, 0.02), GLOSS.paint),
      // The standards keep their own thickness -- only where they stand moves.
      // Scaling a 0.26 post down with the lane would have left the tall yellow
      // verticals, which are the whole distance read on a DUCK, as hairlines.
      gl(bxAt(0.26, 3.30, 0.30, -1.20, 1.65, 0, 0xffc422), GLOSS.paint),
      gl(bxAt(0.26, 3.30, 0.30, 1.20, 1.65, 0, 0xffc422), GLOSS.paint),
      bxAt(0.30, 0.26, 0.34, -1.20, 2.35, 0, 0x2b1e05),
      bxAt(0.30, 0.26, 0.34, 1.20, 2.35, 0, 0x2b1e05),
      bxAt(0.30, 0.26, 0.34, -1.20, 2.90, 0, 0x2b1e05),
      bxAt(0.30, 0.26, 0.34, 1.20, 2.90, 0, 0x2b1e05),
      bxAt(0.40, 0.22, 0.40, -1.20, 3.41, 0, 0xfff0a0),
      bxAt(0.40, 0.22, 0.40, 1.20, 3.41, 0, 0xfff0a0),
      /**
       * ---- THE FOOT IS A BASE PLATE, NOT A BLOCK, AND THE DAYLIGHT IS WHY --
       *
       * Every DUCK in this file stood each standard on a 0.50 x 0.22 x 0.50
       * dark block. Two of those is 1.00 of a 2.24-wide envelope filled in at
       * the road, and tools/kindread.js measured what it cost: bands 0 and 1 --
       * the tarmac from y 0 to 0.40, directly under the thing you are supposed
       * to see daylight beneath -- read 0.38 and 0.35 occupancy against the
       * 0.23 of the bare posts above them. THE BOTTOM OF THE GAP WAS THE MOST
       * BLOCKED PART OF IT.
       *
       * A blind reader shown six panels found exactly one cue that separates a
       * DUCK from a JUMP at distance: *"picture 6 shows road visible underneath
       * the bar and picture 1 does not; that is a subtle few-pixel difference."*
       * Those blocks were eating the only discriminator the object has.
       *
       * They are also platforms, and the owner has now banned those in general
       * terms -- *"Needs to be connected to the road with no platform"* -- said
       * about cones and meant about everything. A standard on a block is the
       * same figure-on-a-pedestal read as a cone on a plate.
       *
       * 0.30 x 0.07 x 0.34 is a real scaffold base plate: wider than the 0.26
       * post so the post is seen to STAND on something, thin enough that it is
       * a fitting rather than a plinth, and 40% less lane width at the road.
       * The dark cyan is kept -- see jumpWorksGeo for why a shared near-neutral
       * is refused on a saturated object.
       *
       * ALL FIVE VARIANTS TAKE THIS. A discriminator that works on one DUCK and
       * not the other four is not a discriminator.
       */
      bxAt(0.30, 0.07, 0.34, -1.20, 0.035, 0, 0x2b1e05),
      bxAt(0.30, 0.07, 0.34, 1.20, 0.035, 0, 0x2b1e05),
    ].concat((function () {
      // The rear half of the portal. Every member here lives between z 0.14
      // and z 0.29 -- clear of the standard's own 0.30 depth, inside the
      // 0.292 the caution face already sets -- so the flank silhouette steps
      // out below 2.42 and back in above it, and the object stops being a
      // stick from the side without the box moving a thousandth.
      const p = [];
      for (const sx of [-1, 1]) {
        p.push(gl(bxAt(0.18, 2.42, 0.15, sx * 1.20, 1.21, 0.215, 0xffc422), GLOSS.paint));
        // The tie rungs, which are what says "frame" rather than "two posts".
        for (const ry of [0.62, 2.06]) {
          p.push(gl(bxAt(0.12, 0.12, 0.42, sx * 1.20, ry, 0.08, 0xd18a08), GLOSS.trim));
        }
        // The gusset at the bar, and it is on the REAR PLANE for the reason
        // every above-bar fitting in this vocabulary is placed where it is.
        //
        // THE TEST FOR "OUT AT THE STANDARDS" IS THE STANDARD'S OWN x BAND.
        // The post spans world x 0.738 to 0.998; anything above 1.83 whose x
        // footprint lies inside that band is, by construction, no worse for a
        // camera than the post already standing there -- and the post is the
        // thing the file's own rule permits. Written as a test rather than as
        // a feel, because the header board this rule exists for was also
        // "obviously fine" until it filled the screen.
        p.push(gl(bxAt(0.20, 0.34, 0.14, sx * 1.16, 1.95, 0.22, 0xd18a08), GLOSS.paint));
        // The rear foot pad under the rear leg.
        p.push(bxAt(0.30, 0.18, 0.20, sx * 1.20, 0.09, 0.18, 0x2b1e05));
        // Hold-down bolts. Four per plate, six-sided, and they are here for
        // the crest of a hill: the camera pitches DOWN onto a base plate and
        // that is the one view in which the flattest part of a DUCK is the
        // biggest thing on screen.
        for (const bx0 of [-0.16, 0.16]) {
          for (const bz of [-0.16, 0.16]) {
            p.push(gl(cyl(0.045, 0.045, 0.07, 6,
              sx * 1.20 * LANE_FIT + bx0, 0.245, bz, 0xfff0a0), GLOSS.chrome));
          }
        }
      }
      return p;
    })()));

    /**
     * DUCK v1: a scaffold gantry over the road. Round standards on base plates,
     * a hazard-boarded ledger where the bar is, and diagonal braces above --
     * every one of them a 0.22 tube out at the standards, so the rule above
     * holds. It is the same shape as v0 built out of different stock, which is
     * the point: the distance read must not change.
     *
     * WHAT THE ORBIT SHEET FOUND. At az 180 this was indistinguishable from
     * v0 and v2: one flat bar between two flat posts. Everything that
     * made it scaffold -- the boarding, the ledger, the braces -- was either on
     * the front face or directly behind the standard that hides it.
     *
     * So the rear plane is now where the identity lives, and the identity is
     * TUBE AND FITTING. A second ledger tube runs the full span at z +0.22,
     * transoms cross the depth at each standard, and a coupler sits at every
     * node where two tubes meet. That is what a scaffold is and none of it
     * existed. From behind it is now a lattice; v0 is a plated portal and v2 is
     * a sign back, and the three no longer photograph as one object.
     *
     * TWO ENVELOPE FIXES, both this variant's, both invisible to the toolchain
     * because the DUCK y guard prints its frame and refuses to fail on it:
     * the cap ran 1.73 to 1.85 against a box top of 1.83, and the boarding ran
     * 1.39 to 1.49 against a box floor of 1.41. The 0.02 above is the direction
     * that matters -- art proud of the bar is art the player reads as headroom
     * they do not have -- and both are now on the number. This is the overhang
     * duckPipeGeo's collar note names and declines to fix.
     */
    const duckScaffoldGeo = (function () {
      const parts = [
        hbx(2.30, 0.34, 0.54, 0, 1.58, 0, 0xffc422),
        // 1.77, not 1.79: at 1.79 the cap topped out at 1.85, 0.02 outside the
        // box. Chamfered on the way down from the ceiling, never outward past
        // it, exactly as hcbx's header requires.
        hbx(2.38, 0.12, 0.56, 0, 1.77, 0, 0xfff0a0),
        // 1.46, not 1.44: at 1.44 the boarding's underside was 1.39, below the
        // 1.41 box floor. It now lands on it.
        hbx(2.24, 0.10, 0.42, 0, 1.46, 0, 0xd18a08),
        // THE REAR LEDGER, the single tube that turns a flat back into a
        // scaffold. Full span at z +0.22, which is clear of the standards' own
        // 0.30 depth and inside the 0.292 the caution face already sets.
        gl(cyl(0.075, 0.075, 2.34 * LANE_FIT, 8, 0, 1.58, 0.215, 0xd18a08, 0, 0, Math.PI / 2), GLOSS.trim),
        gl(cyl(0.075, 0.075, 2.34 * LANE_FIT, 8, 0, 1.75, 0.215, 0xd18a08, 0, 0, Math.PI / 2), GLOSS.trim),
      ];
      for (const sx of [-1, 1]) {
        const px = sx * 1.20 * LANE_FIT;
        parts.push(cyl(0.15, 0.15, 3.34, 8, px, 1.67, 0, 0xffc422));
        parts.push(cyl(0.19, 0.19, 0.16, 8, px, 2.42, 0, 0x2b1e05));
        parts.push(cyl(0.19, 0.19, 0.16, 8, px, 3.02, 0, 0x2b1e05));
        // 0.50 across, not 0.56: the plate reached 1.148 from the lane centre
        // against a box halfX of 1.12, and it was the widest thing in the game.
        // A base plate and not a block. See the note at duckGeo: the old
        // 0.50 x 0.54 foot was the most blocked part of the gap it stands in.
        parts.push(bx(0.32, 0.06, 0.36, px, 0.03, 0, 0x2b1e05));
        parts.push(bx(0.42, 0.20, 0.42, px, 3.38, 0, 0xfff0a0));
        // Kicker braces. Canted, but the cant is 0.12 and the foot is pulled
        // INSIDE the standard, because the number that matters is how far the
        // widest point reaches from the lane centre: 1.02, which is inside the
        // 1.068 the existing cap already reaches, so a runner jumping in the
        // NEXT lane cannot graze a brace on this one.
        parts.push(bx(0.15, 1.5, 0.15, sx * (1.20 * LANE_FIT - 0.02), 2.70, 0,
          0xd18a08, 0, 0, sx * 0.12));
        // THE REAR STANDARD, a second tube on the rear plane. It stops at 2.46
        // rather than running the full height: the tall pair of verticals is
        // the distance read and doubling it at 40 units would change the read
        // this vocabulary is not allowed to change.
        parts.push(gl(cyl(0.085, 0.085, 2.46, 8, px, 1.23, 0.205, 0xffc422), GLOSS.paint));
        // TRANSOMS. Short tubes crossing the depth, which is the member that
        // makes a scaffold a frame rather than two ladders, and the only thing
        // on this object that has any z extent at all from the flank.
        for (const ty of [0.52, 1.66, 2.24]) {
          parts.push(gl(cyl(0.065, 0.065, 0.40, 8, px, ty, 0.08, 0xd18a08, Math.PI / 2), GLOSS.trim));
        }
        // COUPLERS. A right-angle clamp at every node, in the near-black the
        // collars already use, so the joints read as fittings and not as tubes
        // passing through each other.
        for (const cyy of [0.52, 1.58, 1.74, 2.24]) {
          parts.push(bx(0.20, 0.17, 0.17, px, cyy, 0.205, 0x2b1e05));
        }
        // The toe board, on the rear plane at the lift.
        parts.push(gl(bx(0.26, 0.20, 0.06, px, 1.95, 0.255, 0xfff0a0), GLOSS.trim));
      }
      return merge(parts);
    })();

    /**
     * DUCK v2: a height-restriction sign gantry. The bar becomes a deeper amber
     * sign board banded top and bottom in cream, and each standard carries a
     * sign roundel. A round mark is the one shape no telegraph mat uses, so it
     * never argues with the rungs painted on the road in front of it.
     *
     * A SIGN HAS A BACK, AND IT IS NOT A SIGN. That is the whole of this
     * variant's rebuild, and it is the most literal case rule 1 has in this
     * file: the back of a road sign is a frame -- a perimeter angle, two
     * vertical channel stiffeners, and the clips that hold it to the post --
     * and it is the face you see for the second and a half after you pass it.
     * This one had a blank board, so at az 180 it was v0 and v1 exactly.
     *
     * THE ROUNDEL IS NOW ON BOTH FACES. It was at z -0.20 only, which made
     * the one mark this variant is named for a front-only decal. It is a disc
     * on a post: there is no version of it that has one side.
     *
     * ENVELOPE, same pair as v1 and the same reason nothing caught it: the top
     * band ran to 1.86 against a box ceiling of 1.83 and the bottom band to
     * 1.39 against a floor of 1.41. Both now land on the number.
     */
    const duckSignGeo = (function () {
      const parts = [
        hbx(2.30, 0.42, 0.54, 0, 1.62, 0, 0xffc422),
        // 1.78 and 1.45, not 1.81 and 1.43. See the header.
        hbx(2.38, 0.10, 0.56, 0, 1.78, 0, 0xfff0a0),
        hbx(2.38, 0.08, 0.56, 0, 1.45, 0, 0xfff0a0),
        // THE BACK OF THE BOARD. Perimeter angle top and bottom on the rear
        // plane, and two channel stiffeners standing proud of it -- the frame
        // a sign board is actually built on. All of it between z 0.22 and
        // 0.29, so the board's own 0.54 depth is untouched and the flank does
        // not grow.
        gl(hbx(2.30, 0.07, 0.08, 0, 1.735, 0.245, 0xd18a08), GLOSS.trim),
        gl(hbx(2.30, 0.07, 0.08, 0, 1.495, 0.245, 0xd18a08), GLOSS.trim),
      ];
      // The stiffeners run vertically across the board's back, inboard of the
      // standards, and they are the one place this variant puts a repeating
      // rhythm anywhere but the front.
      for (const cx of [-0.66, 0, 0.66]) {
        parts.push(gl(hbx(0.12, 0.34, 0.08, cx, 1.62, 0.245, 0x2b1e05), GLOSS.trim));
      }
      for (const sx of [-1, 1]) {
        const px = sx * 1.20 * LANE_FIT;
        parts.push(bx(0.28, 3.30, 0.28, px, 1.65, 0, 0xffc422));
        // The roundel goes on the POST, not on the bar. On the bar it had to
        // sit 0.35 in front of the gate line to clear the board -- past the
        // halfZ the collision box records -- and the striped face covered it
        // regardless. At 0.87 out it is clear of the runner's glove swing
        // (0.543) and nowhere near the lane centre the camera flies down.
        //
        // BOTH FACES, at -0.20 and +0.20, with the mounting boss between them.
        // The rear disc is the deep amber and not the cream, because the back
        // of a sign plate is not a sign: two cream discs on one post read at
        // 45 degrees as one disc drawn twice, which is a rendering fault the
        // eye reaches for before it reaches for "double-sided".
        parts.push(cyl(0.20, 0.20, 0.09, 12, px, 2.30, -0.20, 0xfff2e0, Math.PI / 2));
        parts.push(gl(cyl(0.20, 0.20, 0.09, 12, px, 2.30, 0.20, 0xd18a08, Math.PI / 2), GLOSS.paint));
        parts.push(bx(0.14, 0.14, 0.34, px, 2.30, 0, 0x2b1e05));
        // The clips that hold the board to the post: one above and one below
        // the board, on the rear plane, in the post's own x band.
        // 1.46 and 1.78, so the clips land inside 1.41-1.83 rather than
        // hanging 0.04 out of it at each end. Same discipline as the bands.
        for (const ky of [1.46, 1.78]) {
          parts.push(gl(bx(0.34, 0.10, 0.16, px, ky, 0.21, 0xfff0a0), GLOSS.trim));
        }
        parts.push(bx(0.36, 0.18, 0.36, px, 2.86, 0, 0x2b1e05));
        parts.push(bx(0.30, 0.44, 0.30, px, 3.14, 0, 0xd18a08));
        parts.push(bx(0.40, 0.24, 0.40, px, 3.44, 0, 0xfff0a0));
        // Base plate, not a block -- see duckGeo.
        parts.push(bx(0.30, 0.07, 0.34, px, 0.035, 0, 0x2b1e05));
        // The maintenance step at the foot, rear plane, so the base is a
        // fitting rather than a slab seen from behind.
        parts.push(gl(bx(0.32, 0.07, 0.14, px, 0.60, 0.20, 0xd18a08), GLOSS.trim));
      }
      return merge(parts);
    })();

    /**
     * DUCK v3: A LEVEL-CROSSING BOOM, and it is the first ASYMMETRIC duck.
     *
     * Three things constrain every variant here and it is worth restating them
     * together, because they are what makes a duck hard to vary at all:
     *
     *   NOTHING ABOVE THE BAR IN THE LANE CENTRE. The chase camera sweeps
     *     y 1.76 to 3.14 straight down a gate's lane, so the only structure
     *     that may live above 1.83 is out at the standards. The header board
     *     at 2.44 that this file already threw away is the proof. A traffic
     *     signal head standing on top of the beam was designed and rejected
     *     here for exactly that reason -- it is the same object as that board.
     *   NOTHING BELOW 1.41 ACROSS THE LANE. That is where the ducking runner
     *     goes. He is lower than this file used to think -- see the note on
     *     the corridor probe below -- but the box floor is still the floor.
     *   THE DISTANCE READ MAY NOT CHANGE. Two tall thin verticals with a bar
     *     between them, at forty units, whatever the variant.
     *
     * What is left to vary is the bar's own profile, the stock the standards
     * are made of, and the fittings out at the posts. This one spends all
     * three on being LOPSIDED: the left standard is a signal post with a
     * lamp pair and a counterweight, the right is a plain rest with a fork
     * for the boom to lie in. Every other hazard in the game is bilaterally
     * symmetric, so a silhouette whose two halves differ is a new read even
     * though the class is unchanged.
     *
     * The boom's hanging skirt sits between 1.43 and 1.61 -- inside the bar
     * band, not below it -- so the thing that makes a level crossing look like
     * a level crossing costs no clearance at all.
     */
    const duckBoomGeo = (function () {
      const parts = [
        // The beam: 1.61 to 1.83, so the skirt has room under it and the top
        // of the bar is still exactly the box ceiling.
        gl(hcbx(2.30, 0.22, 0.52, 0, 1.72, 0, 0xffc422, 0.05), GLOSS.paint),
        gl(hcbx(2.36, 0.09, 0.54, 0, 1.785, 0, 0xfff0a0, 0.03), GLOSS.trim),
      ];
      // The skirt. Alternating cream and deep amber, which is the boom's real
      // marking and is also the cheapest way to put a repeating vertical
      // rhythm in the one band the player is looking at.
      for (let i = 0; i < 7; i++) {
        const x = -0.90 + i * 0.30;
        parts.push(gl(bxAt(0.13, 0.18, 0.22, x, 1.52, 0, i % 2 ? 0xd18a08 : 0xfff0a0), GLOSS.trim));
      }
      for (const sx of [-1, 1]) {
        // 3.20 tall, not the 3.30 the other three use. The DUCK superstructure
        // was measured as the tallest thing in the game and a real occluder in
        // R2, so a new variant takes the chance to be shorter rather than
        // taller: this tops out at 3.40 against 3.48-3.56 for v0-v2.
        parts.push(gl(bxAt(0.26, 3.20, 0.30, sx * 1.20, 1.60, 0, 0xffc422), GLOSS.paint));
        parts.push(bxAt(0.30, 0.24, 0.34, sx * 1.20, 2.62, 0, 0x2b1e05));
        parts.push(gl(bxAt(0.38, 0.20, 0.38, sx * 1.20, 3.30, 0, 0xfff0a0), GLOSS.trim));
        // Base plate, not a block -- see duckGeo.
        parts.push(bxAt(0.30, 0.07, 0.34, sx * 1.20, 0.035, 0, 0x2b1e05));
        // Cabinet doors on the rear plane of each post -- the relay boxes a
        // crossing carries. Out at the standard, inside the post's own x band,
        // and below the bar so they cost no headroom argument at all.
        parts.push(gl(bxAt(0.26, 0.62, 0.10, sx * 1.20, 0.98, 0.235, 0xd18a08), GLOSS.paint));
        parts.push(gl(bxAt(0.08, 0.10, 0.06, sx * 1.20 + sx * 0.09, 0.98, 0.26, 0xfff0a0), GLOSS.chrome));
      }
      // The signal post, LEFT ONLY. The backing plate is 0.44 wide at 1.20 out
      // -- 1.088 from the lane centre against a box halfX of 1.12 -- and the
      // lamp discs face the player, axis along z, so they are round from
      // behind and edge-on discs from the next lane rather than flat squares.
      const px = -1.20 * LANE_FIT;
      parts.push(bxAt(0.44, 0.94, 0.16, -1.20, 2.06, -0.10, 0x2b1e05));
      for (const ly of [1.78, 2.34]) {
        parts.push(gl(cyl(0.15, 0.15, 0.09, 12, px, ly, -0.20, 0xfff2e0, Math.PI / 2), GLOSS.chrome));
        // THE HOOD BEHIND EACH LAMP. A signal lamp is a housing with a lens in
        // the front of it, and this had only the lens: from behind, the one
        // fitting that makes this a level crossing was a pair of pale ellipses
        // floating on a dark plate. The housing is what you actually see once
        // you are past it.
        parts.push(gl(cyl(0.13, 0.16, 0.16, 12, px, ly, 0.02, 0xd18a08, Math.PI / 2), GLOSS.paint));
      }
      // THE PIVOT BEARING, and it is the piece this variant most obviously
      // lacked. A boom turns about something. This is a hub through the left
      // standard on the beam's own axis, proud on BOTH faces, so it reads as a
      // mechanism from behind and from either flank rather than only as a
      // lopsided outline from the front.
      parts.push(gl(cyl(0.17, 0.17, 0.50, 10, px, 1.72, 0, 0x2b1e05, Math.PI / 2), GLOSS.trim));
      parts.push(gl(cyl(0.09, 0.09, 0.58, 8, px, 1.72, 0, 0xfff0a0, Math.PI / 2), GLOSS.chrome));
      // The counterweight, which is what a raised boom is balanced by and
      // which reads as mass on one side of an otherwise even frame.
      //
      // A STACK OF DISCS ON AN ARM, not a cube. Counterweights are plates you
      // add and take off, and the stack is the read; a cube at this size is a
      // lump that could be anything. The arm ties it back to the pivot, which
      // is what makes the two fittings one machine.
      parts.push(gl(bxAt(0.13, 0.96, 0.13, -1.20, 2.24, 0, 0xd18a08), GLOSS.paint));
      for (let i = 0; i < 3; i++) {
        parts.push(gl(cyl(0.17, 0.17, 0.09, 12, px, 2.72 + i * 0.11, 0, 0x2b1e05, Math.PI / 2), GLOSS.trim));
      }
      // The rest fork, RIGHT ONLY: the cradle the boom drops into.
      parts.push(gl(bxAt(0.30, 0.12, 0.36, 1.20, 1.92, 0, 0xfff0a0), GLOSS.trim));
      parts.push(gl(bxAt(0.11, 0.22, 0.36, 1.20, 2.03, 0, 0xfff0a0), GLOSS.trim));
      return merge(parts);
    })();

    /**
     * DUCK v4: A SERVICES CROSSING -- a lagged pipe run bridging the road on
     * two round columns, with a valve wheel at one of them.
     *
     * The bar is a CYLINDER for the first time. v0 is a chamfered box, v1 a
     * boarded ledger, v2 a sign board, v3 a beam with a skirt: four flat-faced
     * bars in a row, all of which take the same two toon bands across their
     * height. A round bar takes the whole ramp across its section, so it is
     * shaded as a curve rather than as a face.
     *
     * AND THAT BUYS NOTHING FROM BEHIND, which is worth writing down because
     * it was this variant's original argument and the fleet sheet refuted it.
     * The caution face every DUCK turns toward the lens sits at z -0.292, in
     * front of a bar whose own front is at -0.19 to -0.26, and it is 0.34 to
     * 0.40 tall -- so THE FACE IS THE BAR, visually, on all five variants.
     * From the flank the bar is edge-on and the near standard covers it. The
     * pipe is therefore a pass-by and overhead read, not a lane-decision one,
     * and it is built out because rule 1 says so rather than because it
     * carries the variant.
     *
     * What carries the variant at lane-decision distance is the STANDARDS:
     * round columns with flange collars against v0's square posts, a valve
     * wheel where v2 has a roundel. Measured at the size the player has it --
     * 17.77 px per world unit at 40 units in portrait -- this pair separates
     * further from v0 than any other pair in the kind, new or old.
     *
     * The pipe is 0.19 in radius about 1.62, so it fills 1.43 to 1.81 and the
     * collars that band it are held to 0.21 so they land on 1.41 and 1.83
     * exactly rather than hanging out of the box on both sides.
     *
     * Nothing crosses the lane above the bar. The elbow and the valve wheel
     * are both out at a standard, per the rule restated on v3.
     */
    const duckPipeGeo = (function () {
      const px = 1.20 * LANE_FIT;
      const parts = [
        // The lagged run. Axis along x: radius spans y and z, which is what
        // puts the whole toon ramp across a 0.38 band.
        gl(cyl(0.19, 0.19, 2.30 * LANE_FIT, 14, 0, 1.62, 0, 0xffc422, 0, 0, Math.PI / 2), GLOSS.paint),
      ];
      // Banding collars. 0.21 not 0.23: at 0.23 they reached 1.39 and 1.85,
      // which is 0.02 out of the box on both faces -- the same two-hundredths
      // v1 and v2 already carry and which nothing in the toolchain reads.
      // (Both of those are now fixed at the variants that carried them.)
      for (const cx of [-0.62, -0.21, 0.21, 0.62]) {
        parts.push(gl(cyl(0.21, 0.21, 0.10, 14, cx, 1.62, 0, 0xfff0a0, 0, 0, Math.PI / 2), GLOSS.trim));
        // Flange bolts standing off each collar, on the rear quarter. Four
        // rings of them is what a bolted pipe joint looks like from anywhere
        // that is not directly in front of it.
        for (const bz of [-0.15, 0.15]) {
          parts.push(gl(cyl(0.035, 0.035, 0.14, 6, cx * LANE_FIT, 1.76, bz, 0xfff0a0), GLOSS.chrome));
        }
      }
      // THE SECOND CONDUIT, and it is the one thing on any DUCK in this file
      // that changes the FLANK. A services crossing is never one pipe: the
      // small-bore run rides alongside the main on saddle brackets. At z +0.21
      // and 0.10 in radius it is clear of the lagged run's own 0.19 and inside
      // the 0.29 the box leaves, so from az 90 this variant shows TWO circles
      // where every other DUCK shows one rectangle -- which is the only flank
      // separation the envelope makes room for anywhere in the kind.
      //
      // It sits at y 1.50, inside the 1.41-1.83 band, so it costs no
      // clearance: the bar is already there.
      parts.push(gl(cyl(0.07, 0.07, 2.30 * LANE_FIT, 10, 0, 1.49, 0.215, 0xd18a08, 0, 0, Math.PI / 2), GLOSS.paint));
      for (const cx of [-0.62, 0, 0.62]) {
        // The saddle bracket tying the small bore to the main run.
        parts.push(gl(bx(0.10, 0.22, 0.10, cx * LANE_FIT, 1.55, 0.215, 0x2b1e05), GLOSS.trim));
      }
      for (const sx of [-1, 1]) {
        // Round columns, and shorter again than v0-v2 for the R2 reason.
        parts.push(gl(cyl(0.16, 0.16, 3.10, 10, sx * px, 1.55, 0, 0xffc422), GLOSS.paint));
        parts.push(cyl(0.21, 0.21, 0.10, 10, sx * px, 1.05, 0, 0x2b1e05));
        parts.push(cyl(0.21, 0.21, 0.10, 10, sx * px, 2.40, 0, 0x2b1e05));
        parts.push(gl(cyl(0.22, 0.22, 0.20, 10, sx * px, 3.20, 0, 0xfff0a0), GLOSS.trim));
        // Base plate, not a block -- see duckGeo.
        parts.push(bxAt(0.30, 0.07, 0.34, sx * 1.20, 0.035, 0, 0x2b1e05));
        // The column's base flange, with bolts. A round column landing on a
        // square plate with nothing between them is the join this variant had.
        parts.push(gl(cyl(0.22, 0.24, 0.13, 10, sx * px, 0.28, 0, 0xd18a08), GLOSS.paint));
        for (const a of [0, 1, 2, 3]) {
          const t = a * Math.PI / 2 + Math.PI / 4;
          parts.push(gl(cyl(0.04, 0.04, 0.08, 6, sx * px + Math.cos(t) * 0.20, 0.37,
            Math.sin(t) * 0.20, 0xfff0a0), GLOSS.chrome));
        }
        // The bracket carrying the small bore into the column.
        parts.push(gl(bx(0.30, 0.10, 0.10, sx * px, 1.49, 0.215, 0xd18a08), GLOSS.trim));
      }
      // The valve wheel, right standard, facing the player. r 0.24 at 0.868
      // out reaches 1.108 against a box halfX of 1.12.
      parts.push(gl(cyl(0.24, 0.24, 0.07, 14, px, 2.74, -0.17, 0xfff0a0, Math.PI / 2), GLOSS.chrome));
      parts.push(gl(cyl(0.08, 0.08, 0.22, 8, px, 2.74, -0.08, 0xd18a08, Math.PI / 2), GLOSS.trim));
      // The elbow, left standard: a stub rising off the column and turning
      // back on itself. Thin, and out at the post, per the rule.
      parts.push(gl(cyl(0.13, 0.13, 0.54, 10, -px, 2.90, 0, 0xd18a08), GLOSS.paint));
      parts.push(gl(cyl(0.13, 0.13, 0.30, 10, -px + 0.15, 3.14, 0, 0xd18a08, 0, 0, Math.PI / 2), GLOSS.paint));
      return merge(parts);
    })();

    const duckPool = hazardPool(K.DUCK, 'duck', [
      { geo: duckGeo, face: [2.26, 0.40, 1.62, -0.292] },
      { geo: duckScaffoldGeo, face: [2.26, 0.36, 1.58, -0.292] },
      { geo: duckSignGeo, face: [2.26, 0.34, 1.62, -0.292] },
      { geo: duckBoomGeo, face: [2.26, 0.38, 1.62, -0.292] },
      { geo: duckPipeGeo, face: [2.26, 0.34, 1.62, -0.292] },
    ]);

    /**
     * ================= THE ROAD VEHICLES =================
     *
     * The complaint that produced these was "the cars, bikes and other moving
     * obstacles need to be more realistic", and the screenshot behind it showed
     * white crates with a striped board on the front. The fix is NOT surface
     * detail -- this renderer is flat MeshToonMaterial with banded ramps and
     * extruded ink, so there is no gloss, no reflection and no texture to chase.
     * What was actually missing was SILHOUETTE AND PROPORTION, and every one of
     * the things that carries a real vehicle's read is free here:
     *
     *   ROOFLINE HEIGHT      a bus is 2.76 to the cap, a taxi 1.60 to the roof.
     *   WINDOW BAND HEIGHT   the bus's glazing sits at 1.84-2.48, the tram's at
     *                        1.14-2.00, the taxi's at 1.10-1.50. Three different
     *                        vehicles at forty units are three different bands.
     *   GREENHOUSE TAPER     the taxi's glass is 1.22 world wide on a body of
     *                        1.58. A crate has no taper; a car always does.
     *   THE GAP UNDER        every road vehicle here shows daylight between its
     *                        underframe and the tarmac, with wheels in it. The
     *                        TRAM IS THE ONE THAT DOES NOT -- its skirt reaches
     *                        the road, which is exactly how you tell a tram from
     *                        a bus from directly behind, and it costs nothing.
     *
     * Measured off reference/tgr-city.png, which has a tram, a bus and a parked
     * car in this exact idiom; the numbers are appended to MEASUREMENTS.md.
     *
     * WHAT DOES NOT CHANGE, and it is the whole of the hazard contract:
     *
     *   FOOTPRINT. MR.Collision.BOX gives BLOCK halfZ 0.65, so every main mass
     *     below lives in z = [-0.63, +0.63] and every rear-face fitting has its
     *     rear plane at exactly -0.65. Nothing reaches behind the gate line.
     *   HEIGHT. BLOCK tops out at 2.80 and nothing here exceeds it. The refuse
     *     truck's beacon lands on it exactly; everything else is under.
     *   COLOUR. Saturated and bright enough to clear the contrast gate against
     *     every lane -- that is what a realistic grey van would actually fail,
     *     and it is a measured rule rather than a hue rule. This paragraph used
     *     to say "BLOCK pink on the mass that carries the silhouette, always,
     *     because a hazard's kind is known from its hue before its shape
     *     resolves". The fleet rebuild had already broken that when this was
     *     written -- seven of the ten BLOCKs are not pink and were not pink
     *     then -- and tools/kindread.js now shows hue misreading 8 to 10 of 21
     *     variants against the silhouette profile's 2. See stripeTex.
     *   NOTHING MOVES IN X OR Z. Behaviour is one rotating or sliding CHILD and
     *     a y shudder, and no more. A hazard's lane and z are course data that
     *     course.js has already proved a path through by BFS; a vehicle is a
     *     costume on a gate and can never be a new rule.
     *
     * The caution-striped face every variant carries is now a REAR BUMPER
     * CHEVRON -- 0.22 to 0.34 tall, low on the tail -- rather than the 1.9-tall
     * board that covered most of the old truck's back. That board was the
     * "striped barrier on the front" in the complaint. Real buses, refuse trucks
     * and works vehicles all carry exactly this marking, so the kind signal
     * survives and stops being the entire object.
     */

    /**
     * ============ THE FLEET'S COLOUR, AND WHY IT WAS ALL ONE ============
     *
     * The owner rejected the first vehicle pass -- "vehicles not good enough" --
     * and the audit says why in one table. Ten BLOCK variants, one frame, area
     * means straight off `api.contrastAudit`:
     *
     *   v0 tram    (144,108,139) L 122.6 S 0.248     v5 taxi   (143,112,138) L 124.1 S 0.222
     *   v1 hoarding(173,128,146) L 143.7 S 0.258     v6 van    (154,117,140) L 130.9 S 0.240
     *   v2 trike   (178,143,160) L 155.6 S 0.199     v7 refuse (155,109,130) L 125.1 S 0.299
     *   v3 marshals(141,110,134) L 122.1 S 0.214     v8 cyclists(149,110,132) L 124.4 S 0.258
     *   v4 bus     (146,113,140) L 125.9 S 0.221     v9 moped  (158,102,128) L 121.9 S 0.351
     *
     * **Ten different vehicles inside a 12-luminance band and a 0.15 saturation
     * band, every one of them the same desaturated mauve.** No two of them
     * differed by as much as one toon band. The reference's four vehicles, for
     * comparison: taxi (255,221,0) S 1.00, bus (41,114,94) S 0.638, red car
     * (204,25,54) S 0.878, far bus (118,63,70) S 0.461. Four hues, S 0.46-1.00.
     *
     * THE MECHANISM, and it is worth writing down because it is not obvious.
     * Cream `0xfff2e0` was 32-33% of every vehicle's area -- the single largest
     * element on all of them -- and cream renders at S 0.092, the least
     * saturated thing in the palette. Chroma is measured on the AREA MEAN, not
     * on the mean of the chromas, so a saturated body averaged against a big
     * near-neutral cream lands ON the neutral axis. Modelled on the taxi:
     *
     *     saturated yellow body, no cream        L 134.4   dS +0.266
     *     the same taxi with a 15% cream band    L 137.8   dS +0.032
     *
     * **A 15% cream band buys 0.04x of luminance and destroys 88% of the
     * object's chroma.** The cream was added by the pass before this one, to
     * clear a luminance gate, and it worked -- and it flattened the fleet.
     *
     * THE RULE, in two families, because a vehicle's body and its glass must not
     * straddle the neutral axis:
     *
     *   COOL BODIES pass on saturation. Teal, cyan, blue-green with the cool
     *     glass; the mean stays on one side of neutral and dS lands at 0.4-0.5.
     *     Cream on a cool body costs only about 0.12 of dS and buys real
     *     luminance, so the tram and the trike may keep a pale band.
     *   WARM BODIES pass on both, and their glass is held to about 26% of the
     *     elevation rather than 34%, because blue glass on a yellow body is the
     *     fastest way back to neutral there is.
     *   NO CREAM ON A WARM BODY, ANYWHERE. The pale element on a warm vehicle is
     *     the number plate and the lamp cores and nothing else.
     *
     * Every dark bottom below is a dark version of its own vehicle's hue rather
     * than a shared neutral, for the same area-mean reason: one grey bumper bar
     * on seven vehicles would put 13% of neutral back into every one of them.
     *
     * BLOCK PINK IS NOT ABANDONED. It moves from "the mass that carries the
     * silhouette" to a fixed pink element in a fixed place on every BLOCK -- the
     * caution-striped chevron face each variant already turns toward the lens,
     * which is unlit, is a large fraction of the frontal area, and is measured
     * by the audit like everything else. Kind is also signalled at full strength
     * by the telegraph mat painted on the road in front, which is the channel
     * the race is actually lost by misreading. The body was a redundant second
     * copy of that signal and it was costing the entire vehicle-colour axis.
     *
     * TWO VARIANTS ARE DELIBERATELY LEFT ALONE. v1 is a ROAD CLOSED hoarding and
     * v3 is two marshals holding a barrier board across the lane: red-and-white
     * chevron on a pale ground IS the real livery of both objects, they are not
     * traffic, and the complaint was about vehicles. Both already clear the gate
     * (1.58x and 1.34x). Everything with wheels is rebuilt.
     *
     * THE HUE WHEEL, and it is chosen so no two of the eight sit next to each
     * other. Every body colour drives its OPPOSITE channel toward zero, because
     * the area mean's saturation is (max - min) / max and the cheapest chroma
     * in the whole system is a channel that is not there:
     *
     *   v0 tram     0x1e9cf0   ( 18,117,199)  L  97.4  S 0.909   blue
     *   v2 trike    0xe4ff2a   (150,186, 36)  L 158.3  S 0.807   lime
     *   v4 bus      0x00c896   (  2,146,124)  L 100.7  S 0.984   teal
     *   v5 taxi     0xffdd00   (168,161,  3)  L 145.3  S 0.981   yellow
     *   v6 van      0xff8c00   (168,101,  3)  L 110.2  S 0.981   orange
     *   v7 refuse   0xb4c800   (119,146,  3)  L 121.7  S 0.978   hi-vis green
     *   v8 cyclists 0xf03a2a   (158, 42, 36)  L  75.7  S 0.773   red kit
     *   v9 moped    0xff3b6b   (168, 42, 89)  L  85.4  S 0.748   pink
     *
     * `0xffdd00` is not a guess either: it is the reference taxi's own body,
     * measured off `tgr-taxi-street` at (228,200,12) and put through this
     * renderer's shading, which returns (168,161,3).
     */
    const TRAM_BODY = 0x1e9cf0, TRAM_DARK = 0x0c2436, TRAM_CREASE = 0x0074a8;
    const BUS_BODY = 0x00c896, BUS_DARK = 0x0e2a26, BUS_CREASE = 0x008060;
    const TAXI_BODY = 0xffdd00, TAXI_DARK = 0x2e2412, TAXI_CREASE = 0xd89800;
    const VAN_BODY = 0xff8c00, VAN_DARK = 0x35220a, VAN_CREASE = 0xc26200;
    const BIN_BODY = 0xb4c800, BIN_DARK = 0x22300a, BIN_CREASE = 0x7ab800;
    const TRIKE_BODY = 0xe4ff2a, TRIKE_DARK = 0x22300a;
    const CHROME = 0xa8e0e8;     // rendered (110,163,192) L 150.8 -- pale trim, cool bodies
    const LEMON = 0xfff23a;      // rendered (168,177, 49) L 159.9 S 0.726 -- the fleet's cream
    const KIT_A = 0xf03a2a;      // rendered (158, 42, 36) L  75.7 S 0.773
    const KIT_B = 0xffd400;      // rendered (168,154,  3) L 141.3 S 0.981
    const PINK = 0xff3b6b;       // the kind signal, kept where it is a lid or a chevron

    /**
     * BLOCK v0: A TRAM, and it is variant 0 because it is the one a TRAIN uses.
     *
     * Trains scale this body along z, so every baked feature is a horizontal
     * band that survives being stretched -- and a tram is the one road vehicle
     * that is genuinely BETTER for being stretched, because a stretched tram is
     * a two-car tram and a stretched anything else is a joke.
     *
     * THE REAR-FACE RULE. A vertex at z = -halfZ maps to -halfZ for ANY span,
     * because body.scale.z = span goes with body.position.z = (span-1)*halfZ
     * -- so a fitting whose rear plane sits exactly there stays exactly there
     * on a six-unit train. The blind, the lamps and the number plate are built
     * to that; the main masses are a little shallower so those fittings stand
     * proud of them instead of z-fighting.
     *
     * halfZ IS 1.95 NOW AND THIS FILE USED TO WRITE 0.65 IN THAT FORMULA. The
     * offset at the claim site was a literal, it was the old half-depth, and
     * it was never updated when the envelope was renegotiated -- so every
     * train in the game had been anchored 1.30 units behind its own gate line.
     * It reads MR.Collision.BOX now. See the claim site.
     *
     * It is the fleet's one cool body that keeps a pale band, and it keeps it
     * for the reason the rule allows: a destination panel on a cyan tram costs
     * about 0.12 of saturation and buys the luminance that a dark blue body
     * would otherwise have to find somewhere else.
     *
     * AND IT IS THE ONE VEHICLE THE CEILING DOES NOT BIND. A tram car is 15 m
     * and the ceiling is 3.90, but the train span multiplies THIS body and
     * only this body: at the longest train it is 17.94 units of tram, which is
     * the right answer for the object rather than a compression of it. So the
     * single car is authored at the full 3.90 and a train is a real articulated
     * set, where before a four-span train was six copies of a 1.30 cube.
     */
    const blockTramGeo = (function () {
      const parts = [
        // Skirt to the road. No wheel gap, no wheels: this is the tell.
        hbx(2.20, 0.20, 3.86, 0, 0.10, 0, TRAM_DARK),
      ];
      // Bumper 0.20-0.52 -- 13% of a 2.44 elevation, bottom edge at the skirt.
      vBumper(parts, 2.22, 0.32, 0.36, -1.95, TRAM_DARK, 0.60);
      vLamps(parts, 0.94, 0.36, -1.95, 0.15);
      parts.push(
        gl(hcbx(2.16, 0.58, 3.86, 0, 0.81, 0, TRAM_BODY, 0.06), GLOSS.paint),
        gl(hcbx(2.20, 0.06, 3.88, 0, 1.13, 0, TRAM_CREASE, 0.02), GLOSS.chrome),
        gl(hcbx(2.24, 0.12, 3.88, 0, 1.22, 0, CHROME, 0.03), GLOSS.chrome)
      );
      // Glazing 1.28-2.10, 28.8% of the elevation bbox against 21.7% before, and
      // 1.92 wide on a 2.20 body: 0.87, inside the reference's 0.75-0.91
      // greenhouse-to-body band, with a real pillar showing either side.
      vGlass(parts, 1.92, 0.82, 3.60, 0, 1.69, 0);
      // A AND C PILLARS, WHICH ON A TRAM ARE ALSO WHAT MAKES A TRAIN READ AS A
      // TRAIN. The body is what gets scaled along z for a multi-car train, so a
      // pillar pinned to each end of the greenhouse stretches with it and the
      // glazing between them becomes one long saloon window -- which is what a
      // stretched tram should look like, and is a better outcome than the
      // full-depth slab of body colour that was there, which stretched into a
      // painted flank six units long.
      vPillars(parts, 0.16, 0.82, 3.60, 1.04, 1.69, 0, TRAM_BODY);
      // ...and the door pillars between them, which is what makes 3.60 of
      // glazing read as a tram rather than as a greenhouse. Two intermediate
      // pairs at a real door spacing; they stretch with the body on a train,
      // so a four-span set gets its doors stretched apart exactly as its
      // windows do, which is what an articulated tram looks like.
      vPillars(parts, 0.14, 0.82, 1.90, 1.04, 1.69, 0, TRAM_CREASE);
      // The cab end. A tram driving away shows its front to anything it passes,
      // and on a train this is the leading car's face.
      vFront(parts, {
        zFront: 1.93, w: 2.16, dark: TRAM_DARK, crease: TRAM_CREASE,
        grilleY: 0.86, grilleH: 0.24, lampX: 0.82, lampW: 0.30, lampH: 0.20,
        bumpW: 2.22, bumpH: 0.32, bumpY: 0.36, plateW: 0.60, slats: 2,
      });
      parts.push(
        gl(hcbx(2.24, 0.16, 3.88, 0, 2.18, 0, CHROME, 0.03), GLOSS.chrome),
        gl(hcbx(2.16, 0.08, 3.86, 0, 2.30, 0, TRAM_BODY, 0.03), GLOSS.paint),
        gl(hcbx(2.02, 0.06, 3.70, 0, 2.37, 0, CHROME, 0.02), GLOSS.chrome),
        gl(hcbx(1.76, 0.04, 3.40, 0, 2.42, 0, TRAM_BODY, 0.02), GLOSS.paint),
        gl(hbx(1.06, 0.12, 0.10, 0, 2.18, -1.90, TRAM_DARK), GLOSS.trim)
      );
      return merge(parts);
    })();
    /**
     * The pantograph, and it is the `moving` child rather than part of the body
     * for one reason: the body is what a train scales, and a pantograph stretched
     * to six units is a ladder. On its own child it stays one pantograph however
     * long the tram is, and it gets a slow sway for free.
     *
     * Top of the shoe lands at 2.77 against the 2.80 the collision box records.
     */
    const blockTramPantoGeo = merge([
      bx(0.66, 0.07, 0.26, 0, 0.02, 0, TRAM_DARK),
      bx(0.09, 0.42, 0.09, -0.24, 0.20, 0.02, TRAM_DARK, 0.42),
      bx(0.09, 0.42, 0.09, 0.24, 0.20, 0.02, TRAM_DARK, 0.42),
      bx(0.96, 0.06, 0.13, 0, 0.36, -0.16, CHROME),
    ]);

    /**
     * BLOCK v1: a ROAD CLOSED hoarding on a solid plinth.
     *
     * ============ JUDGED AS A SIGN, AND STILL SHORT ============
     *
     * This is the one of the ten that is not traffic, and the temptation is to
     * exempt it: a sign IS a flat panel, its caution face is legitimately 1.70
     * tall where every other variant's is 0.20-0.52, and it is the brightest
     * thing in the fleet at 1.659x. But the gameplay-framing census at 8 units
     * says what it says:
     *
     *   face 46.6%   trim 18.2%   cream 16.0%   body 12.6%   lamp 1.1%
     *
     * -- eight parts, all of them slabs, and 1.1% of the object in the only
     * category that is a fitting rather than a mass. Every other variant in the
     * game stands on something; this one is a board on a box.
     *
     * The two things it was actually missing are structural and both were
     * measurable. **It had no frame**: the board's edge was the board, so at
     * every distance the silhouette is a rectangle with three cream bands
     * across it. And **it had no legs**: it is a free-standing hoarding, and a
     * free-standing hoarding that is not braced falls over -- which is why the
     * real thing has skids running fore and aft with ballast on them, and why
     * it is the one variant with a genuine reason to spend the depth. It used
     * 0.65 of an allowed 1.95, the largest unused envelope in the fleet.
     *
     * NOTHING HERE IS A WHEEL AND NOTHING PRETENDS TO BE A VEHICLE. The frame
     * is galvanised, so it is pale, which is what a road-closure frame is and
     * also what protects the luminance this variant clears its target on: it
     * carries 1.659x against a 1.6x target with 5.4 of L in hand, so cream and
     * its own pink do the structure and the only darks added are the skids and
     * the lamp bases.
     */
    const blockSignGeo = merge([
      // Chamfered, but the cream bands stay matte -- this is one of the two
      // variants the colour pass deliberately left in its real red-and-white
      // livery, and it is already the tightest BLOCK but one on chroma. A
      // highlight on the white would be spent making it whiter.
      gl(hcbx(2.20, 0.52, 1.30, 0, 0.26, 0, 0x2b2f52, 0.06), GLOSS.trim),
      // THE WHOLE STACK CAME DOWN 0.10, because the beacons were at 3.09
      // against a BLOCK ceiling of 2.80 -- 0.29 of hazard standing outside its
      // own collision box, on the variant that has been in the game longest.
      // Nothing had ever compared the two. The board, its bands and its cap
      // drop together so the proportions are untouched and the lamps still
      // stand proud of the cap; the object now tops out at 2.79.
      gl(hcbx(2.12, 2.00, 1.06, 0, 1.46, 0, 0xff3b6b, 0.06), GLOSS.paint),
      gl(hcbx(2.26, 0.16, 1.14, 0, 0.62, 0, 0xfff2e0, 0.04), GLOSS.matte),
      gl(hcbx(2.26, 0.16, 1.14, 0, 1.50, 0, 0xfff2e0, 0.04), GLOSS.matte),
      gl(hcbx(2.26, 0.16, 1.14, 0, 2.34, 0, 0xfff2e0, 0.04), GLOSS.matte),
      gl(hcbx(2.28, 0.24, 1.20, 0, 2.58, 0, 0xd42a55, 0.05), GLOSS.paint),
    ].concat((function () {
      const p = [];
      // ---- THE FRAME -----------------------------------------------------
      // Stiles down both edges and a rail top and bottom, standing proud of the
      // board on all four sides. The caution face is 1.49 wide at x +/-0.745
      // and is unlit and drawn in front of everything, so the stiles sit
      // outboard of it at 0.80 where they are the object's own edge -- which is
      // also the only place on a sign a frame CAN be.
      for (const sx of [-1, 1]) {
        p.push(gl(bxAt(0.10, 2.10, 1.14, sx * 1.105, 1.46, 0, 0xfff2e0), GLOSS.chrome));
        // Corner gussets, top and bottom, which is where a bolted frame is
        // stiffened and what stops the stile reading as a painted line.
        p.push(gl(bxAt(0.16, 0.16, 1.18, sx * 1.105, 2.36, 0, 0xd42a55), GLOSS.trim));
        p.push(gl(bxAt(0.16, 0.16, 1.18, sx * 1.105, 0.56, 0, 0xd42a55), GLOSS.trim));
        // ---- THE SKIDS, and the depth this variant finally spends ----------
        // A free-standing hoarding stands on skids running fore and aft with
        // ballast on them, and is braced back to the board. Without them it is
        // a board on a box, which is what the census measured. 1.86 long
        // against an allowed 1.95 of half-depth either way: this is the one
        // variant with a real reason for the length.
        p.push(gl(bxAt(0.36, 0.17, 1.86, sx * 0.76, 0.085, 0, 0x2b2f52), GLOSS.trim));
        p.push(gl(bxAt(0.42, 0.10, 0.44, sx * 0.76, 0.22, -0.72, 0xfff2e0), GLOSS.matte));
        p.push(gl(bxAt(0.42, 0.10, 0.44, sx * 0.76, 0.22, 0.72, 0xfff2e0), GLOSS.matte));
        // Ballast blocks, and the brace back to the board.
        p.push(gl(cbx(0.30, 0.26, 0.34, sx * 0.55, 0.30, -0.74, 0xd42a55, 0.04), GLOSS.paint));
        p.push(gl(cbx(0.30, 0.26, 0.34, sx * 0.55, 0.30, 0.74, 0xd42a55, 0.04), GLOSS.paint));
        p.push(gl(bx(0.09, 0.09, 0.734, sx * 0.55, 0.525, 0.73, 0xfff2e0, 1.09), GLOSS.chrome));
        /**
         * ---- THE BEACON, WHICH WAS INSIDE THE CAP ----------------------
         *
         * The lamps were two 0.30 cubes at x 0.535, y 2.49-2.79. The coping
         * they sit under is 2.28 wide -- halfX 0.825 -- and runs to y 2.70. So
         * for 0.21 of their 0.30 they were BURIED IN IT, and the census caught
         * it as the number it is: 1.1% of the object, on the only fitting the
         * variant had. Rebuilding them in place made it worse, 0.3%, which is
         * how the mechanism was found rather than guessed at.
         *
         * They move OUTBOARD to the top corners on brackets, which is where a
         * real hoarding hangs them and which is the only place on this object
         * clear of the coping. x 0.92 against a box halfX of 1.12, with the
         * dome's own 0.17 that is 1.09 -- measured with fleetExtents.
         */
        p.push(gl(bx(0.28, 0.09, 0.30, sx * 0.87, 2.40, 0, 0x2b2f52), GLOSS.trim));
        p.push(gl(bx(0.11, 0.24, 0.11, sx * 0.92, 2.50, 0, 0x2b2f52), GLOSS.trim));
        p.push(gl(cyl(0.155, 0.170, 0.20, 10, sx * 0.92, 2.68, 0, 0xffe45e), GLOSS.chrome));
        p.push(gl(cyl(0.075, 0.075, 0.21, 8, sx * 0.92, 2.68, 0, LAMP_CORE), GLOSS.chrome));
        p.push(gl(cyl(0.105, 0.145, 0.07, 10, sx * 0.92, 2.745, 0, 0x2b2f52), GLOSS.trim));
      }
      // The bottom rail and the kickboard on the plinth, which is the one
      // horizontal a hoarding always has and the only structure that lands
      // BELOW the caution face's own band.
      p.push(gl(hcbx(2.30, 0.11, 1.22, 0, 0.455, 0, 0xfff2e0, 0.03), GLOSS.chrome));
      p.push(gl(hcbx(1.90, 0.16, 1.24, 0, 0.20, 0, 0xd42a55, 0.04), GLOSS.paint));
      // THE BACK OF A SIGN IS A BRACED FRAME, not a second sign face -- the
      // correction already recorded for the DUCK roundel. Two stiffeners and a
      // diagonal, on the plane the pass and the lane change both show.
      p.push(gl(bx(0.11, 1.84, 0.10, -0.34, 1.46, 0.58, 0xfff2e0), GLOSS.chrome));
      p.push(gl(bx(0.11, 1.84, 0.10, 0.34, 1.46, 0.58, 0xfff2e0), GLOSS.chrome));
      p.push(gl(bx(1.10, 0.10, 0.09, 0, 1.46, 0.58, 0xfff2e0, 0, 0, 0.98), GLOSS.chrome));
      return p;
    })()));

    /**
     * BLOCK v2: A TRAFFIC LIGHT ON A POLE, STANDING IN A LANE.
     *
     * This slot was A CARGO TRIKE, RIDDEN. The owner was asked directly whether
     * the trike and the delivery moped failed to read as a VEHICLE or as a
     * PERSON, and answered: "Both. They either need to be fixed or removed."
     * It is removed, and what stands here instead is
     * reference/ttgr-lightpole-in-lane.png -- a signal head on a grey pole on a
     * two-tier plinth, in the middle lane, which is the reference game putting
     * a piece of road furniture where we were putting a person.
     *
     * ---- WHY FURNITURE AND NOT A BETTER RIDER ---------------------------
     *
     * Four passes of detail had already gone into that rider and the blind
     * reader still could not name it: "a stack of blocks... THAT IS THE CART
     * TALKING, NOT THE PERSON". The measurement that finally settled it is not
     * about faces at all. tools/kindread.js reads how much of the lane width
     * each variant covers in fourteen bands, and a nearest-centroid classifier
     * over that profile misreads exactly two of the twenty-one hazards in this
     * game -- BLOCK v8 and BLOCK v9, the two thin people-on-machines, both of
     * which land nearer the DUCK centroid than their own. A BLOCK that reads as
     * a DUCK is a player sliding into a wall, which rule 4 makes a build
     * failure rather than a preference. People-as-obstacle was not failing to
     * be detailed enough; it was failing to fill a lane.
     *
     * Gold Run's road hazards are almost entirely furniture and vehicles --
     * barrier, bin lorry, bus, car, traffic light, crates -- and its PEOPLE are
     * characters, never obstacles. All five reference frames agree: the only
     * figure on the carriageway in any of them is a running character in
     * ttgr-gift-crate-and-bus.png, and it is not something you can hit.
     *
     * ---- WHY THIS IS THE THIN ONE, ON PURPOSE ---------------------------
     *
     * The owner, separately: "the road does not always need to be covered."
     * Every other BLOCK is opaque from the road to 2.80 against an eye height
     * of 2.62, so a gate behind one is a gate the player cannot see. This one
     * is a 0.17 pole between a plinth and a head: it fills its lane in the eye
     * without filling it in the frame, and what shows past it is the next gate.
     *
     * THE PROFILE STILL HAS TO SAY BLOCK, and that is what the plinth is for.
     * A bare pole with a head on it is a DUCK's profile upside down. The
     * two-tier base is 1.02 across -- 60% of the lane, wider than anything on a
     * DUCK -- so the bottom bands read as mass on the road, the head reads as
     * mass above the 2.05 jump apex, and the classifier has both ends.
     *
     * ENVELOPE. BLOCK is yMin 0, yMax 2.80, halfX 1.12. The lamp housing tops
     * out at 2.72 and the plinth reaches 0.51 either side. Nothing here moves,
     * so there is no shudder to count against the ceiling.
     *
     * RULE 1. The signal faces the runner, because the runner is running at it
     * and the chase camera looks down its own +z at the hazard's -z face -- so
     * the lenses are the view the game spends its life in. The BACK is built
     * anyway and is a different object: a plain hinged door with a piano hinge
     * down one edge, a latch, the pole's own collar band, and the cable entry.
     * You pass this at 1.70 units and the flank shows both.
     */
    const blockLightGeo = (function () {
      const parts = [];
      // THE HOUSING IS A DARK SLATE, NOT A NEAR-BLACK. It was 0x27303c at
      // L 33.7 over a 0.46 x 1.00 front face -- the largest dark area on an
      // object whose gate is decided on luminance, and this variant was the
      // tightest in the game at +0.052 across the eight shots. 0x3c4450 is
      // L 48.3 and the lenses still sit 2 to 3x above it, which is what the
      // dark housing was there for.
      const HOUSE = 0x3c4450;        // the signal housing, dark slate
      const HOUSE_LIP = 0x59667a;    // one step up, for the visor lips
      // Galvanised grey, WARMED AND LIFTED. These were 0x8a93a8 / 0x5a6478 /
      // 0x6e7789 -- a cool near-neutral family on a road that is itself a cool
      // near-neutral, which is the straddle the fleet header names. Warming
      // the hue costs nothing structural and moves both axes the same way.
      const POLE = 0xd0ccc4;
      const POLE_DK = 0x8e8880;
      const PLINTH = 0xbcb6ac;
      const RED = 0xff2b3c, AMB = 0xffb020, GRN = 0x24d46a;

      // ---- THE RED-AND-WHITE WORKS BARRICADE ------------------------------
      //
      // This was not in the first draft of this variant and BOTH instruments
      // rejected that draft, which is the whole argument for having them.
      //
      //   THE GATE. A grey pole with a near-black signal head is a NEAR-NEUTRAL
      //     object. It measured L 94.8 / S 0.153 against a lane at L 88.4 /
      //     S 0.156 -- ratio 1.072 against a gate of 1.25 and dS 0.003 against
      //     a gate of 0.22, a margin of -0.142 and a failed build. The fleet
      //     header had already predicted it in as many words ("a realistic grey
      //     van would be a hazard nobody could name in time"); building the
      //     reference's own grey is how it got proved.
      //   THE PROFILE. tools/kindread.js put the bare post NEARER THE DUCK
      //     CENTROID THAN ITS OWN, at -2.721 -- worse than either of the two
      //     people-hazards this variant was built to replace. A plinth at 60%
      //     of the lane with a 0.10 pole above it is a DUCK's shape with the
      //     mass at the wrong end, and "the plinth carries the low bands" was
      //     a guess that did not survive being measured.
      //
      // So the lane is filled by the object standing in the SAME REFERENCE
      // FRAME as the traffic light: ttgr-lightpole-in-lane.png has a red and
      // white A-frame works barricade on the carriageway a few lengths beyond
      // the signal. It is also the owner's item 1 by name -- "note red barrier
      // ... construction zone pieces" -- so one addition answers the gate, the
      // profile and the brief together.
      //
      // 1.32 TALL AND NOT 0.90. Height is the whole of the profile repair: at
      // 0.90 the bands from 0.80 to 1.40 are empty on this object and empty on
      // a DUCK too, and the middle is exactly where the two kinds differ. At
      // 1.32 the barricade owns every band up to 1.35 and the classifier has
      // its answer before the pole starts.
      //
      // IT STILL DOES NOT COVER THE ROAD, which is the point of the variant.
      // Eye height is 2.62 and this tops out at 1.35, so the next gate is
      // visible over it -- against every other BLOCK in the game, which is
      // opaque to 2.80.
      // The barrier red, LIFTED from 0xe02233 (L 51.2) to 0xf0402f (L 68.5). It is
      // three of the seven segments on both boards -- 0.63 of world area on an
      // object decided by luminance -- and it is still unambiguously the red of
      // a red-and-white barrier. The caution face texture is lifted with it so
      // the painted stripes and the moulded segments stay one colour.
      const RAIL_R = 0xf0402f, RAIL_W = 0xfff6ea;
      // Two boards, not three. Alternating red and cream SEGMENTS rather than
      // a striped texture, because the caution face is the only textured quad
      // a hazard gets and it is spent on the top board's front. Five segments
      // of 0.332 across 1.66: red at both ends, which is what a real barrier
      // board does so the ends read as ends.
      for (const [by, bh] of [[0.51, 0.42], [1.09, 0.46]]) {
        // SEVEN SEGMENTS, WHITE AT BOTH ENDS -- four white to three red.
        // It was five, red at both ends, on the reasoning that red ends read
        // as ends. That was three red against two white and it cost luminance
        // this variant does not have: red renders at L 51 and this white at
        // L 176, and the gate here is decided on luminance because dS cannot
        // reach 0.22 on an object that also has to contain a grey pole and a
        // near-black lamp housing. Seven also reads as more of a barrier.
        for (let i = 0; i < 7; i++) {
          parts.push(gl(cbx(0.237, bh, 0.10, -0.711 + i * 0.237, by, -0.40,
            i % 2 ? RAIL_R : RAIL_W, 0.025), GLOSS.paint));
        }
        // The board's own back edge, one step darker, so the flank shows a
        // board with a thickness rather than a card. Rule 1: you pass this at
        // 1.70 units and the 0.10 of depth is what the flank is made of.
        parts.push(gl(cbx(1.68, 0.05, 0.11, 0, by - bh / 2 + 0.025, -0.40, POLE_DK, 0.02), GLOSS.trim));
      }
      // The two uprights, from the road to over the top board, and their feet.
      for (const ux of [-0.72, 0.72]) {
        // THE UPRIGHTS ARE RED, not the pole's grey, and that is a gate repair
        // rather than a styling choice. See the note under RAIL_R: with grey
        // uprights this variant measured S 0.168 and cleared the gate by
        // +0.041, on luminance alone, which is no margin at all across eight
        // shots and six lanes. roadmap entry 30 is explicit that the lever
        // that moves a mean-colour saturation metric is AREA OF SATURATED
        // BRIGHT and not hue, so the two largest near-neutral areas left on
        // the object -- these posts -- stop being near-neutral.
        parts.push(gl(cbx(0.13, 1.36, 0.13, ux, 0.68, -0.40, RAIL_R, 0.03), GLOSS.paint));
        parts.push(gl(cbx(0.34, 0.07, 0.30, ux, 0.035, -0.40, POLE_DK, 0.025), GLOSS.matte));
        // A splayed rear stay, so the barricade stands up in three dimensions
        // instead of being a flat sign seen edge-on from the side.
        parts.push(gl(cbx(0.09, 1.02, 0.09, ux, 0.50, -0.02, RAIL_R, 0.02, 0.32), GLOSS.paint));
        parts.push(gl(cbx(0.28, 0.06, 0.26, ux, 0.03, 0.32, POLE_DK, 0.02), GLOSS.matte));
      }

      // ---- the two-tier plinth, on the road -------------------------------
      // Chamfered, both tiers. A traffic light's base is a cast collar and the
      // reference's is visibly bevelled on every edge; two square slabs here
      // would be the "box like" the owner is objecting to, at the exact place
      // the eye checks whether a thing is standing on the road or floating.
      parts.push(gl(cbx(1.02, 0.10, 0.94, 0, 0.05, 0, PLINTH, 0.035), GLOSS.matte));
      parts.push(gl(cbx(0.78, 0.13, 0.72, 0, 0.165, 0, POLE_DK, 0.035), GLOSS.trim));
      // The cast collar the column rises out of, round rather than square.
      parts.push(gl(cyl(0.20, 0.30, 0.16, 12, 0, 0.31, 0, POLE_DK), GLOSS.trim));
      // A hazard band round the collar -- the one bright ring low on the
      // object, and the thing that says "this is in your way" at the bottom of
      // the silhouette where a BLOCK is read from.
      parts.push(gl(cyl(0.205, 0.235, 0.10, 12, 0, 0.44, 0, 0xfff23a), GLOSS.matte));

      // ---- the column -----------------------------------------------------
      // 12 segments. The owner asked for round with extensive detail, and a
      // column is the one part of this object that is a cylinder all the way
      // up; at 6 segments it is a hexagonal post with a visible seam.
      parts.push(gl(cyl(0.085, 0.105, 1.50, 12, 0, 1.24, 0, POLE), GLOSS.chrome));
      // Two collars up the column, which is what a jointed signal post has and
      // is what stops 1.50 of plain tube reading as a drawn line.
      parts.push(gl(cyl(0.115, 0.115, 0.07, 12, 0, 0.86, 0, POLE_DK), GLOSS.trim));
      parts.push(gl(cyl(0.115, 0.115, 0.07, 12, 0, 1.62, 0, POLE_DK), GLOSS.trim));
      // THE CABLE ENTRY, on the back of the column. Rule 1: from behind, a
      // plain tube is the same object at every angle, and a signal post's rear
      // is where its conduit runs.
      parts.push(gl(cbx(0.09, 1.16, 0.07, 0, 1.16, 0.115, POLE_DK, 0.02), GLOSS.trim));

      // ---- the signal head ------------------------------------------------
      // 0.46 x 1.00 x 0.26, from 1.99 to 2.72. Chamfered on all twelve edges.
      parts.push(gl(cbx(0.46, 1.00, 0.26, 0, 2.24, 0, HOUSE, 0.04), GLOSS.trim));
      // The cap and the sill, proud of the housing on every side.
      parts.push(gl(cbx(0.52, 0.07, 0.32, 0, 2.755, 0, HOUSE_LIP, 0.025), GLOSS.trim));
      parts.push(gl(cbx(0.52, 0.06, 0.32, 0, 1.71, 0, HOUSE_LIP, 0.025), GLOSS.trim));
      // THE YELLOW BACKBOARD. A standard signal fitting -- the high-visibility
      // plate a signal head is mounted on so it reads against a busy
      // background -- and here it is doing that job twice over. It is the only
      // element available that is BOTH bright and saturated (0xffd42b renders
      // L 146.9 at S 0.83; nothing else on this object is above L 120 without
      // being a near-neutral), and it is 0.86 x 1.32 at the top of the object,
      // where the profile also needed occupancy to stop reading as a pole.
      //
      // 1.10 TALL AND NOT 1.32. At 1.32 centred on 2.24 the plate spanned 1.58
      // to 2.90 and its top border sat on 2.94 -- 0.14 THROUGH the 2.80 ceiling
      // MR.Collision.BOX gives a BLOCK. Art gives way to the box; this is the
      // same correction the JUMP plinths and the caution faces already took.
      parts.push(gl(cbx(1.04, 1.10, 0.05, 0, 2.235, 0.10, 0xffd42b, 0.03), GLOSS.paint));
      // Its dark border, which is what makes a backboard a backboard.
      parts.push(gl(cbx(1.10, 0.06, 0.06, 0, 2.755, 0.10, HOUSE, 0.02), GLOSS.trim));
      parts.push(gl(cbx(1.10, 0.06, 0.06, 0, 1.715, 0.10, HOUSE, 0.02), GLOSS.trim));
      // The bracket that clamps the head to the column, both sides of it.
      parts.push(gl(cbx(0.16, 0.30, 0.16, 0, 1.84, 0.10, POLE_DK, 0.03), GLOSS.trim));

      // ---- the three lenses, and the visor over each ----------------------
      // -z is the face the chase camera sees, because the runner runs at this
      // thing in +z. So the lenses are the view the game spends its life in.
      const LENS = [[2.50, RED], [2.24, AMB], [1.98, GRN]];
      for (const [ly, col] of LENS) {
        // The lens: a short cylinder lying on z, so its rim is round from the
        // front and it has DEPTH from the flank. A painted disc on a flat
        // panel is what this used to be everywhere in the fleet.
        parts.push(gl(cyl(0.145, 0.145, 0.06, 14, 0, ly, -0.155, col, Math.PI / 2), GLOSS.chrome));
        // The bright core, a hair proud of the lens. 0.055 AND NOT 0.085: at
        // 0.085 the core is 34% of the lens area and the shipped frame showed
        // three white discs with coloured rims -- the colour is the entire
        // read on this object and the highlight was eating it. At 0.055 it is
        // 14%, which is a highlight on a red lamp rather than a lamp.
        parts.push(gl(cyl(0.055, 0.055, 0.03, 12, 0, ly, -0.190, LAMP_CORE, Math.PI / 2), GLOSS.chrome));
        // THE VISOR. A real signal wears a hood over every lens and it is the
        // single most recognisable thing about the object in silhouette --
        // three stacked shelves down the front face. Built as a half-collar
        // above the lens rather than a full ring, which is what a hood is.
        parts.push(gl(cbx(0.34, 0.055, 0.19, 0, ly + 0.135, -0.20, HOUSE_LIP, 0.02), GLOSS.trim));
        parts.push(gl(cbx(0.055, 0.13, 0.17, -0.155, ly + 0.075, -0.19, HOUSE_LIP, 0.02), GLOSS.trim));
        parts.push(gl(cbx(0.055, 0.13, 0.17, 0.155, ly + 0.075, -0.19, HOUSE_LIP, 0.02), GLOSS.trim));
      }

      // ---- THE BACK, which is a different object -------------------------
      // Rule 1. A signal head's rear is a hinged access door, and that is what
      // the camera gets for the whole of the pass and the whole lane change.
      parts.push(gl(cbx(0.38, 0.86, 0.03, 0, 2.24, 0.135, HOUSE_LIP, 0.02), GLOSS.trim));
      // The piano hinge down one edge, and the latch on the other.
      for (let i = 0; i < 5; i++) {
        parts.push(gl(cyl(0.028, 0.028, 0.12, 8, -0.185, 1.90 + i * 0.17, 0.135,
          POLE_DK, 0, 0, Math.PI / 2), GLOSS.chrome));
      }
      parts.push(gl(cbx(0.06, 0.14, 0.05, 0.185, 2.24, 0.155, POLE, 0.015), GLOSS.chrome));
      return merge(parts);
    })();

    /**
     * BLOCK v3: MARSHALS ACROSS THE LANE. The other half of the same request --
     * pedestrians crossing the road -- and the same guarantee: a fixed-lane
     * K.BLOCK, never a mover.
     *
     * The striped face is the board they hold across the lane, which is why
     * this variant can be made of people at all: a person is not a wall, but a
     * person holding a hazard-boarded barrier across a lane is, and it is what
     * a real closed course actually looks like. Left in its original colours by
     * the livery pass on purpose -- red-and-white chevron on a pale ground is
     * the real livery of a road-closure barrier, these are people rather than
     * traffic, and the variant already clears the gate at 1.34x.
     *
     * ===== SHORT OF THE 1.6x / 0.30 TARGET, AND NOW REFUSED WITH NUMBERS ====
     *
     * This variant has been on the "four short of target" list for four
     * reviews and had never been attacked. It has now. Every lever the rest of
     * this file uses was tried on the shipped build and measured; target
     * margin, where 0 is the target and the build fails below the gate:
     *
     *   as it ships                                        -0.144
     *   hi-vis LIME tabard        0xd8ff2a                  -0.166
     *   hi-vis AMBER tabard       0xffb020                  -0.196
     *   hi-vis ORANGE tabard      0xff8c00                  -0.217   gate +0.003
     *   hi-vis ORANGE tabard      0xff7a1f                  -0.222   FAILS GATE
     *   navy darks to dark-of-hue 0x4a1428 / 0x3a1a2e       -0.163
     *   navy darks to dark-of-hue 0x5c1a30                  -0.150
     *
     * **Every single change made it worse, and the most obvious one -- give
     * the marshals a real hi-vis tabard, because cream is not a hi-vis colour
     * -- FAILS THE BUILD.** All of it is one mechanism. The variant clears on
     * LUMINANCE (1.37x) and not on chroma, the largest bright area on it is
     * the cream tabard, and every hi-vis colour on earth is darker than cream.
     * So the honest tabard costs the gate the object is passing on.
     *
     * The chroma route is closed for a different reason and it is structural:
     * the object's two biggest bright areas are a WHITE BARRIER BAND and a
     * WHITE TABARD, both near-neutral by definition, and dS would have to
     * reach 0.30 against a road already at S 0.157. You cannot saturate white
     * without it stopping being white, and a road-closure barrier that is not
     * white is not a road-closure barrier.
     *
     * The lime result is worth keeping for the next person: it is WORSE than
     * cream, because the board is pink and lime is opposite it on the wheel,
     * so the area mean cancels to the neutral axis. That is the fleet
     * header's "must not straddle the neutral axis" rule showing up on an
     * object nobody had applied it to.
     *
     * REFUSED. It clears the fairness gate on every shot with +0.07 to +0.12
     * of margin, which is the number that decides whether a player can see it.
     */
    const blockCrossGeo = (function () {
      const parts = [];
      // The barrier they are holding. Deliberately BELOW chest height: at 1.55
      // it hid both hi-vis tabards and left two pale heads floating over a
      // board, which is neither a person nor a barrier. At 1.28 the pink
      // torsos read above it and the pair reads as people holding something.
      parts.push(gl(hcbx(2.16, 0.56, 0.18, 0, 0.98, -0.54, 0xff3b6b, 0.04), GLOSS.matte));
      parts.push(gl(hcbx(2.24, 0.12, 0.20, 0, 1.30, -0.54, 0xfff2e0, 0.03), GLOSS.matte));
      parts.push(gl(hcbx(2.24, 0.12, 0.20, 0, 0.66, -0.54, 0xfff2e0, 0.03), GLOSS.matte));
      /**
       * ============ THE BARRIER GETS AN UNDERSTRUCTURE ============
       *
       * Measured at gameplay framing, this variant was 28.6% cream, 24.1%
       * navy, 20.0% caution face and 12.8% pink, with NOTHING in any structural
       * category -- no fittings at all on any of the eleven parts it was made
       * of. Three stacked slabs and two stacks of boxes.
       *
       * WHERE THE STRUCTURE CAN GO IS DECIDED BY OCCLUSION, and the framing
       * tool is what makes that computable rather than a guess. The board's
       * screen band runs from its own bottom edge to its top rail; the pair of
       * marshals stand 0.70 BEHIND it, and the camera looks down, so everything
       * of them between y 0.35 and y 1.15 is behind the board for the whole
       * approach. Anything at the BOARD'S OWN z below y 0.60, by contrast, is
       * clear of it -- there is no parallax at the same depth. So the legs, the
       * feet, the bottom rail and the cones are all built there, and the pair's
       * new lower legs are built for the angles the pass shows rather than for
       * this one.
       *
       * IT IS ALSO A LUMINANCE PROBLEM. This variant clears the fairness gate
       * on luminance ALONE, at 1.365x against 1.25x, with dS 0.023 against a
       * road at S 0.157 -- and roadmap.md records a lever table in which every
       * chroma route was tried and every one made it worse, because you cannot
       * saturate a white barrier band and have it still be a road closure. So
       * the understructure is built in the two BRIGHT things this object is
       * already made of, cream and its own pink, and the only dark added is the
       * boots. Cones are the one saturated element and they are amber, which is
       * on cream's side of neutral rather than opposite it.
       */
      for (const sx of [-1, 1]) {
        // THE BARRIER'S OWN TRESTLE, and it is now unmistakably not a person.
        // These were a 0.19 x 0.62 upright with a 0.46 cream slab under it,
        // which is the size, the shape and the stance of a leg in a shoe --
        // so the object carried FOUR legs that were the barrier's and none
        // that were the marshals', and a blind reader called the whole thing a
        // flat trailer. An A-frame cannot be mistaken for a person: it splays,
        // it has a spreader across it, and it stands at the board's own depth
        // where a marshal does not.
        parts.push(gl(hbx(0.11, 0.64, 0.12, sx * 0.60, 0.32, -0.54, 0xff3b6b, 0, 0, sx * 0.16), GLOSS.matte));
        parts.push(gl(hbx(0.11, 0.64, 0.12, sx * 0.64, 0.32, -0.54, 0xff3b6b, 0, 0, -sx * 0.16), GLOSS.matte));
        parts.push(gl(hbx(0.34, 0.07, 0.10, sx * 0.62, 0.24, -0.54, 0xfff2e0), GLOSS.matte));
        parts.push(gl(hbx(0.30, 0.06, 0.30, sx * 0.62, 0.03, -0.54, 0xfff2e0), GLOSS.matte));
        // The brace back from the foot to the board, which is what stops a
        // free-standing barrier folding over -- and what the pass sees.
        parts.push(gl(bx(0.09, 0.09, 0.62, sx * 0.45, 0.34, -0.28, 0xfff2e0, 0.72), GLOSS.matte));
        // A cone at each end. The one saturated element on the object, and the
        // thing that says ROAD CLOSED before any of the lettering resolves.
        const cx = sx * 0.86;
        parts.push(gl(cyl(0.055, 0.20, 0.44, 10, cx, 0.24, -0.50, 0xff8c00), GLOSS.trim));
        parts.push(gl(cyl(0.135, 0.145, 0.09, 10, cx, 0.26, -0.50, 0xfff2e0), GLOSS.matte));
        parts.push(gl(cbx(0.40, 0.06, 0.40, cx, 0.035, -0.50, 0xff8c00, 0.03), GLOSS.trim));
      }
      // The bottom rail, which is the horizontal a barrier reads by once its
      // board is a striped rectangle and nothing else.
      parts.push(gl(hbx(1.44, 0.10, 0.14, 0, 0.30, -0.54, 0xfff2e0), GLOSS.matte));
      /**
       * The pair, rebuilt for the same reason the trike's rider was: a player
       * who ran the whole race did not report two marshals they could not make
       * out, they reported seeing nobody.
       *
       * The old torso was 0xff3b6b, the board's own colour, so from behind the
       * two figures had no edge against the thing they were holding and the
       * whole variant collapsed into "striped barrier with lumps". They are now
       * dark navy with a broad cream hi-vis tabard -- everything they are seen
       * against up there is pale. Caps are BLOCK pink so the top of each
       * silhouette still carries the hazard hue. Different heights, because two
       * identical figures read as a repeated prop.
       */
      /**
       * ============ AND A BLIND READER SAW A TRAILER ============
       *
       * Shown a 1:1 crop of this variant at 8 and 12 units, with no idea what
       * the game was, a reader wrote: "Two figures side by side on a flat
       * trailer with a red-and-white striped board across the front... Each is
       * built the same way: a crimson slab over a tan box for the head, a
       * broad pale grey-white band across the chest, navy below, and small
       * brown cubes out at the sides where hands would be... Stripped of the
       * props, the two bodies themselves are just banded blocks and I could
       * equally believe they were spectators on a viewing stand."
       *
       * Three things in that, and all three are the figures rather than the
       * barrier:
       *
       *   IT READ AS A VEHICLE. Nothing said the pair were STANDING ON THE
       *     ROAD, because their legs were four boxes packed behind a board and
       *     the whole assembly sat as one mass. They now have real legs, feet
       *     with toes pointing at the runner, and daylight between them.
       *   THE PROPS WERE CARRYING IT. Cones, board and paddle. Take them away
       *     and there was no person left -- which is exactly the test the pass
       *     is judged by, because the props are what the OTHER hazards will
       *     also have.
       *   "SMALL BROWN CUBES OUT AT THE SIDES WHERE HANDS WOULD BE" is the
       *     right description of what was there: two skin cubes floating at
       *     the rail with a rotated navy box near them. There is now an arm --
       *     shoulder, upper arm, elbow, forearm, hand -- and the hand is on
       *     the rail because the forearm put it there.
       *
       * The far marshal's outer arm is now RAISED WITH THE PALM OUT, which is
       * the gesture that means stop. It is the one thing on this variant that
       * says the pair are DIRECTING TRAFFIC rather than standing behind a
       * fence, it costs four boxes, and it is a shape no spectator makes.
       *
       * THE COLOURS DO NOT MOVE. The lever table above is the record of every
       * chroma and luminance route being tried and every one making it worse;
       * this variant clears the fairness gate on luminance alone at 1.43x and
       * the largest bright area on it is the cream tabard. So the rebuild is
       * geometry only -- the same cream, the same navy, the same pink, in the
       * same proportions, arranged as a person.
       */
      const who = [
        // MOVED OUT FROM +/-0.62 TO +/-0.85, AND THAT IS THE PADDLE'S FAULT.
        // The stop paddle's roundel is 0.76 across on a pivot at the inner
        // hand, and with the pair at 0.62 it covered one marshal's head and
        // shoulder for the whole approach -- so the object had two people on
        // it and showed one. At 0.85 they flank the paddle instead of standing
        // behind it. The outermost triangle is a raised hand at 0.97 against a
        // box halfX of 1.12; the board they hold is 1.62 wide, so the pair is
        // still inside their own barrier.
        { x: -0.85, skin: 0xffc79a, z: 0.16, h: 0.00, hair: 0x241a14, style: 3,
          stop: false, browTilt: 0.10, jaw: 0.88 },
        { x: 0.85, skin: 0xb87a4e, z: 0.44, h: -0.09, hair: 0x8a8496, style: 5,
          stop: true, browTilt: -0.12, jaw: 0.74 },
      ];
      for (const p of who) {
        const px = p.x * LANE_FIT;
        const y = p.h;
        // 1.30 of scale is a 2.26 figure, which is the same stylised
        // oversizing the rest of the fleet's people carry -- the trike's rider
        // tops out at 2.72 on a vehicle 1.28 tall. The head lands at 2.13 and
        // the cap at 2.45, inside where the old build put them.
        const MS = 1.34;
        const MH = 1.74 * MS;
        vFigure(parts, {
          x: px, y: y, z: p.z, h: MS, build: 0.96, tier: 2, fz: -1,
          skin: p.skin, hair: p.hair, style: p.style,
          // Cream hi-vis over a navy uniform: the tabard is the torso, the
          // shoulders and sleeves stay dark, which is what a tabard looks like
          // and is where the object's luminance comes from.
          top: 0xfff2e0, shoulder: 0x2b2f52, sleeve: 0x2b2f52,
          legCol: 0x2b2f52, hipCol: 0x2b2f52, shoe: 0x141a33,
          // Feet apart and planted. A marshal stands square across a lane.
          leg: [0.10, -0.10], knee: [0.04, 0.04],
          // Inner arm forward onto the rail. Outer arm either forward as well,
          // or up with the palm out.
          // THE STOP GESTURE HAS TO GO UP AND FORWARD, and the sign matters:
          // a negative angle raises the arm behind the shoulder, where the
          // body hides it. 2.30 rad puts the elbow at 2.19 and the palm at
          // 2.57, above the tabard, in front of the face, and under the
          // paddle roundel's own 2.62 ceiling.
          arm: p.stop ? [0.92, 2.30] : [0.92, 0.92],
          fore: p.stop ? [0.46, 0.15] : [0.46, 0.46],
          browTilt: p.browTilt, jaw: p.jaw, mouth: p.stop ? 0.36 : 0.26,
          wrap: function (q, role) { return role === 'foot' ? gl(q, GLOSS.trim) : q; },
        });
        const shY = y + MH * 0.085 + MH * 0.265 - MH * 0.04 + MH * 0.505;
        // One band across the tabard, in the object's own pink. A hi-vis with
        // no band is a rectangle, and this is the one place on the pair that is
        // ABOVE the board from astern and therefore always in frame.
        parts.push(gl(bx(0.66, 0.09, 0.29, px, shY - 0.30, p.z, 0xff3b6b), GLOSS.matte));
        // A second band lower down. Two bands rather than one is what a real
        // hi-vis tabard carries, and it is what stops the cream reading as a
        // plain white shirt -- which is what the blind reader called it.
        parts.push(gl(bx(0.66, 0.07, 0.29, px, shY - 0.46, p.z, 0xff3b6b), GLOSS.matte));
        // The cap, BLOCK pink, so the top of each silhouette still carries the
        // hazard hue before any of the shape resolves.
        const hy = shY + MH * 0.045 + MH * 0.028 + (0.262 * MS) / 2;
        parts.push(gl(cbx(0.36, 0.13, 0.36, px, hy + 0.145, p.z, 0xff3b6b, 0.04), GLOSS.matte));
        // The peak, forward over the brow, which is what tells a cap from a
        // helmet at twenty units and which the runner's own cap already does.
        parts.push(gl(bx(0.34, 0.055, 0.16, px, hy + 0.095, p.z - 0.24, 0xff3b6b), GLOSS.matte));
        // A radio on the chest: the small hard rectangle with a stub aerial
        // that every marshal, steward and works operative in the world wears,
        // and one of the very few props that reads as OFFICIAL at this size.
        parts.push(gl(bx(0.11, 0.16, 0.07, px - 0.24, shY - 0.20, p.z - 0.16, 0x2b2f52), GLOSS.trim));
        parts.push(gl(bx(0.025, 0.16, 0.025, px - 0.24, shY - 0.04, p.z - 0.16, 0x2b2f52), GLOSS.trim));
      }
      return merge(parts);
    })();
    /**
     * The stop paddle, on its own pivot at the marshal's INNER hand.
     *
     * IT USED TO LEAVE THE LANE, AND NOTHING SAID SO. The paddle was a 2.00
     * stick pivoted at the outer hand (x 0.665 in world) and waved through
     * +/-0.42 radians: the roundel swung to **1.865 from the lane centre**,
     * which is past the middle of the next lane along, and it was the widest
     * moving thing in the game. There was no halfX in MR.Collision.BOX to
     * measure it against, so it had never been measured at all.
     *
     * The lever arm is what does the damage -- a wave sweeps (reach x sin t)
     * sideways -- and there is no amplitude worth having at a 2.00 reach from
     * a pivot already 0.665 out. Both change: the pivot moves to the inner
     * hand and the paddle is rebuilt at 1.28 of reach, so it sweeps to 1.07
     * with the wave INTACT at +/-0.42. The roundel still lands at 2.5, which
     * is where it was, because the pivot went up as the stick came down.
     *
     * It also reads better: a paddle held up BETWEEN two marshals is what a
     * road closure looks like, and out at the shoulder it was competing with
     * the pennant line for the edge of the silhouette.
     */
    const blockPaddleGeo = merge([
      bx(0.11, 0.80, 0.11, 0, 0.40, 0, 0xfff2e0),
      cyl(0.38, 0.38, 0.10, 12, 0, 0.90, -0.07, 0xff3b6b, Math.PI / 2),
      bx(0.50, 0.14, 0.12, 0, 0.90, -0.14, 0xfff2e0),
    ]);

    /**
     * BLOCK v4: A CITY BUS. Tall, slab-sided, the tallest thing on the road, and
     * the fleet's teal one -- which is the hue the reference's own bus wears.
     *
     * Two numbers still do all the work at forty units. The GLAZING SITS HIGH --
     * 1.60 to 2.56, the top third of the object -- where the tram's is at
     * 1.28-2.10 and the taxi's at 1.20-1.70, so the three are told apart by
     * where their dark band is long before any of them resolves. And the
     * UNDERFRAME STOPS AT 0.42 with the wheels in the daylight below it: a crate
     * sits on the road, a bus stands over it.
     *
     * What is new is everything below the waist. The glass is 30% of the rear
     * elevation against 22% before, split into two constant bands at 1.61:1; the
     * sill band exists only BETWEEN the two wheels, so each tyre is seen through
     * a real opening with a lip over it and the lower outline is notched; the
     * bumper has moved from 29% up the body to the sill line, runs the full
     * width, and carries a number plate at 6.5x its own value.
     *
     * IT TAKES THE CEILING, and that is the honest consequence of there being
     * one. A real city bus is 11 m long against a saloon's 4.6, and the whole
     * derivation that set halfZ to 1.95 is "a saloon is 4.6 m and lands at
     * 3.90". So a bus wants 9.3 and cannot have it: 3.90 is a hard ceiling and
     * the only mechanism for exceeding it is the train span, which belongs to
     * the tram. The bus is therefore the most compressed object in the fleet,
     * 2.44:1 in plan where the real thing is 5.9:1 -- exactly the compression
     * its WIDTH has always carried, and applied on the same grounds. What it
     * is not is a bus the same length as a car in ELEVATION: it is 2.80 tall
     * against the taxi's 2.32, it has no bonnet and no boot, and its glazing
     * band sits where nothing else's does.
     */
    const blockBusGeo = (function () {
      const parts = [];
      // A bus stands over the road on the biggest wheels in the fleet, and its
      // skirt is the highest -- so the arch is the deepest notch here and the
      // lower outline is the least straight of the four road vehicles.
      //
      // 2.15 of wheelbase, which is the widest-set pair in the fleet and is
      // what a bus's plan actually looks like: the axles are pushed to the
      // ends, with a long overhang at neither.
      vUnder(parts, {
        bodyW: 2.20, z0: -1.90, z1: 1.90, axles: [-1.10, 1.05],
        skirtTop: 0.68, skirtBot: 0.13, spring: 0.17, archR: 0.48,
        wheelX: 0.88, wheelR: 0.36, wheelW: 0.32,
        skirt: BUS_CREASE, under: BUS_DARK, tyre: TYRE,
      });
      vBumper(parts, 2.14, 0.36, 0.86, -1.93, BUS_DARK, 0.62);
      vLamps(parts, 0.96, 0.86, -1.93, 0.16);
      // A bus front is a destination screen over a deep windscreen over a wide
      // low grille, and none of it existed. The grille sits low and wide -- a
      // bus's radiator is at the bottom, not at headlamp height -- which is
      // itself a way of telling it from the taxi and the van head-on.
      vFront(parts, {
        zFront: 1.90, w: 2.20, dark: BUS_DARK, crease: BUS_CREASE,
        grilleY: 1.20, grilleH: 0.30, lampX: 0.84, lampW: 0.30, lampH: 0.24,
        bumpW: 2.14, bumpH: 0.36, bumpY: 0.86, plateW: 0.62, slats: 4,
      });
      parts.push(
        gl(hcbx(2.20, 0.39, 3.78, 0, 1.235, 0, BUS_BODY, 0.06), GLOSS.paint),
        gl(hcbx(2.24, 0.05, 3.82, 0, 1.455, 0, BUS_CREASE, 0.02), GLOSS.chrome),
        gl(hcbx(2.26, 0.12, 3.82, 0, 1.54, 0, CHROME, 0.03), GLOSS.chrome)
      );
      // The glazing runs almost the whole length now, which is the single
      // biggest thing 3.90 buys this vehicle: a bus IS a band of glass on a
      // painted skirt, and at 1.30 deep it had a windscreen and a rear window
      // and nothing in between. The box's own flanks are the saloon windows
      // (see vPillars), 3.56 of them.
      vGlass(parts, 1.96, 0.96, 3.56, 0, 2.08, 0.02);
      vPillars(parts, 0.14, 0.96, 3.56, 1.03, 2.08, 0.02, BUS_BODY);
      // ...and two intermediate pillars, because a 3.56 sheet of unbroken glass
      // down the flank is a shop window rather than a bus. Real spacing: four
      // bays. Same call, a shorter span, so the pair lands inside the corners.
      vPillars(parts, 0.12, 0.96, 1.30, 1.03, 2.08, 0.02, BUS_BODY);
      parts.push(gl(hcbx(2.20, 0.08, 3.78, 0, 2.60, 0, BUS_BODY, 0.03), GLOSS.paint));
      // The fleet's only curved roofline, and the bus's whole read at distance.
      // Crest lands at 2.78, inside the 2.80 the collision box records -- and
      // 0.02 of that is spent on the idle shudder, which lifts the whole body
      // by 0.022 and had been quietly putting the crest over the ceiling.
      vCrown(parts, 2.20, 3.78, 2.62, 0, 0.14, 14, BUS_BODY);
      // THE ROUTE BLIND CARRIES THE BUS'S CONTRAST, so it is the size a real
      // one is. At 0.72 x 0.20 it was decoration; the underbody rebuild cost
      // the body ~1.5 of luminance and left the bus at 1.59x against the 1.6x
      // target on the finish carpet, which is the one shot where the road is
      // brightest. A destination display is the largest pale element on the
      // back of a bus and CHROME is both brighter (L 150.8) and more chromatic
      // (S 0.43) than the teal it replaces, so widening it pays the luminance
      // back and the saturation with it -- rather than paying with cream,
      // which is what flattened the fleet the last time this was needed.
      parts.push(hbx(1.24, 0.26, 0.08, 0, 2.36, -1.87, CHROME));  // route blind
      return merge(parts);
    })();

    /**
     * BLOCK v5: A TAXI, and the only LOW vehicle in the set.
     *
     * A car's read is the greenhouse: glass narrower than the body, sat on a
     * beltline crease, under a roof narrower still. 1.58 world of glass on 2.18
     * of body is 0.72, against the reference's 0.75-0.91 -- and the pillars
     * either side of it are real boxes now rather than the absence of glass.
     *
     * The glass is held to 26% of the car's elevation and not the 34% the tram
     * and the bus get, and that number is the warm-body rule: the glass hue
     * never leaves the 200-225 degree band whatever the body is, which is the
     * one thing the reference never varies, so on a yellow car every extra
     * square unit of it drags the area mean back toward neutral. 26% is where a
     * saturated yellow still clears the target on both axes.
     *
     * IT ALSO HAS TO NOT LOOK JUMPABLE, and a saloon roof at 1.81 against a
     * 2.05 jump apex plainly does. That is the same objection that made the
     * cargo trike a trike rather than a bicycle, and it is answered the same
     * way -- with something real that takes the silhouette past the apex. Here
     * it is an illuminated rank panel: one shape, narrower than the roof so the
     * taper carries up through it, top at 2.29.
     *
     * ============ AND THEN IT WAS GIVEN A LENGTH ============
     *
     * Everything above is a statement about the ELEVATION and every word of it
     * still holds: the vertical arrangement -- sill 0.56, beltline 1.24-1.33,
     * glass 1.36-1.82, roof 1.89, rank light 2.29 -- is untouched to the digit,
     * because it is what the contrast audit and the silhouette class were tuned
     * against and nothing about the depth renegotiation is an argument to move
     * it.
     *
     * What was missing was the other axis. The car was 1.30 deep on a body 1.58
     * wide: 1.20:1 in plan, which is not a saloon, it is a wardrobe. A real
     * saloon is 4.6 m long and 1.8 wide, 2.56:1. At halfZ 1.95 this one is
     * 3.86 x 1.58 = 2.44:1 and it can finally carry the things the reference
     * spends its whole length on:
     *
     *   TWO AXLES, at z -1.00 and +0.90 -- a 1.90 wheelbase, 1.30 of daylight
     *     between the tyres. In the old envelope the same wheels left 0.04.
     *   A BONNET AND A BOOT, which is what a three-box car IS. The greenhouse
     *     is 1.32 deep in the middle of a 3.86 body, so there is 1.20 of boot
     *     behind it and 1.26 of bonnet in front, and both are TILTED -- the
     *     reference's sloping bonnet is a real plane here, not a suggestion.
     *   A SHOULDER LINE DOWN THE WHOLE LENGTH. The crease and the rub strip
     *     were 1.28 long and are 3.80 now, so the flank has the one horizontal
     *     the reference never omits.
     *   SIDE GLASS THAT IS A WINDOW rather than a sliver. The greenhouse's own
     *     flanks are glass (see vPillars) and at 1.32 deep between a real A and
     *     C pillar they read as a door window at any azimuth.
     *   WHEEL ARCHES CUT IN THE FLANK, where a car's arches are. See vUnder.
     */
    const blockTaxiGeo = (function () {
      const parts = [];
      // The lowest skirt and the smallest wheels in the fleet, which is most of
      // what makes a car a car from behind: the body is close to the road and
      // the tyres barely clear it.
      vUnder(parts, {
        bodyW: 2.18, z0: -1.90, z1: 1.90, axles: [-1.00, 0.90],
        skirtTop: 0.56, skirtBot: 0.10, spring: 0.14, archR: 0.42,
        wheelX: 0.90, wheelR: 0.30, wheelW: 0.28, archPad: 0.08,
        skirt: TAXI_CREASE, under: TAXI_DARK, tyre: TYRE_WARM,
        rim: WHEEL_RIM_WARM, hub: WHEEL_HUB_WARM,
      });
      vBumper(parts, 2.12, 0.24, 0.68, -1.93, TAXI_DARK, 0.56);   // 0.56-0.80
      vLamps(parts, 0.96, 0.68, -1.93, 0.145);
      // The front end, at the +z plane, which was bare paint until this pass.
      vFront(parts, {
        zFront: 1.93, w: 2.18, dark: TAXI_DARK, crease: TAXI_CREASE,
        grilleY: 1.00, grilleH: 0.26, lampX: 0.80, lampW: 0.34, lampH: 0.20,
        bumpW: 2.12, bumpH: 0.24, bumpY: 0.68, plateW: 0.56,
      });
      parts.push(
        // The body masses are chamfered now. The chamfer cuts inward from the
        // extents, so the bounding box, the 2.80 ceiling and the lane fit are
        // all exactly what they were -- what changes is that the shoulder is a
        // lit turn instead of a corner, and that the cel specular has a surface
        // at 45 degrees to put its core on.
        gl(hcbx(2.18, 0.44, 3.80, 0, 1.02, 0, TAXI_BODY, 0.07), GLOSS.paint),
        // THE BONNET AND THE BOOT, which are the two thirds of a three-box car
        // that did not fit before. Both are TILTED planes rather than steps:
        // the reference's most specific note about its cars is a bonnet that
        // slopes away from the windscreen, and rx on a thin slab is what that
        // costs here -- 0.09 of drop over 1.30 of nose, 0.06 over the boot.
        gl(hcbx(2.16, 0.10, 1.34, 0, 1.28, 1.18, TAXI_BODY, 0.04, -0.070), GLOSS.paint),
        gl(hcbx(2.16, 0.10, 1.26, 0, 1.29, -1.22, TAXI_BODY, 0.04, 0.050), GLOSS.paint)
      );
      // THE SHOULDER LINE IS A MOULDING ON THE FLANKS, NOT A SLAB ACROSS THE
      // CAR, and that distinction did not exist at 1.30 deep.
      //
      // The crease and the black rub strip were full-width boxes 2.22 and 2.24
      // across. On a car 1.30 long that is a band you only ever see edge-on;
      // on a car 3.86 long it is a BLACK DECK covering the bonnet, the boot and
      // everything between them, and the first render of the long taxi came
      // back looking like a flatbed with a cab on it. The strip is what the
      // reference actually has -- one horizontal down each side, at the widest
      // point of the body -- so it is built as two thin verticals standing
      // proud of each flank and nothing crosses the top of the car at all.
      for (const sx of [-1, 1]) {
        const px = sx * (2.18 * LANE_FIT / 2 + 0.015);
        parts.push(gl(bx(0.05, 0.06, 3.72, px, 1.265, 0, TAXI_CREASE), GLOSS.chrome));
        parts.push(gl(bx(0.06, 0.07, 3.60, px, 1.185, 0, 0x1a1608), GLOSS.trim));
      }
      // Pale glass, and it is the reference's own. See the two-pair note at
      // vGlass: `tgr-taxi-street`'s glazing measures (100,151,157), which is
      // half again the value of the same reference's bus windscreen and is
      // exactly what a saturated yellow body needs sitting next to it.
      //
      // 1.32 DEEP, not 1.02, and that is the whole of the flank read. The
      // greenhouse is a solid box whose own +/-x faces ARE the side windows
      // (see vPillars), so its depth is the length of the door glass: at 1.02
      // on a 1.30 car it was the whole cabin, and at 1.32 on a 3.86 car it is
      // a cabin with a boot behind it and a bonnet in front.
      vGlass(parts, 1.58, 0.46, 1.32, 0, 1.59, -0.04, true);      // 1.36-1.82
      // THE PILLAR HAS TO REACH THE BODY EDGE. The first build made it 0.16
      // wide at +/-0.87, which spans 0.79 to 0.95 on a body whose flank is at
      // 1.09 -- so 0.14 of the car simply was not there at window height and
      // the greenhouse read as full width with a sliver of paint at its edge.
      // 0.30 at +/-0.94 closes it exactly, and the taper is then visible.
      //
      // It now does that as an A and a C pillar rather than as one slab down
      // the whole flank, which is what uncovers the side windows. See vPillars.
      vPillars(parts, 0.30, 0.46, 1.32, 0.94, 1.59, -0.04, TAXI_BODY);
      parts.push(
        gl(hcbx(1.44, 0.07, 1.24, 0, 1.855, -0.04, TAXI_BODY, 0.03), GLOSS.paint),  // roof
        gl(hcbx(1.22, 0.05, 1.06, 0, 1.915, -0.04, TAXI_CREASE, 0.02), GLOSS.chrome),
        // ONE roof element, not a pile, and this is the second time this file
        // has had to learn it. A sign plus a base plus a cap, each nearly as
        // wide as the roof under it, reads at gameplay scale as a second storey
        // on a truck rather than as a rank light on a car. It is now a narrow
        // stalk and one lit panel 0.86 wide against a 1.44 roof -- 60%, so the
        // taper carries on up through it and the shape stays a car with
        // something on top.
        //
        // The panel is an amber lamp rather than a cream box: 0xfff23a renders
        // at L 159.9 / S 0.726 where cream is L 175.5 / S 0.092, which is 91%
        // of the luminance for eight times the chroma.
        hbx(0.34, 0.09, 0.22, 0, 1.935, -0.04, TAXI_CREASE), // stalk 1.89-1.98
        hbx(0.86, 0.28, 0.28, 0, 2.12, -0.04, LEMON),        // rank panel 1.98-2.26
        hbx(0.90, 0.06, 0.30, 0, 2.29, -0.04, TAXI_CREASE)   // 2.26-2.32
      );
      return merge(parts);
    })();

    /**
     * BLOCK v6: A DELIVERY VAN WITH ITS BACK DOORS OPEN.
     *
     * MEASUREMENTS.md names this object by name in the BLOCK vocabulary -- "so
     * the dark interior reads as depth rather than as a hole you could pass
     * through" -- and the second half of that sentence is the whole design
     * problem. A dark rectangle in a lane is what a DUCK void looks like.
     *
     * Three things stop it being one. The opening is 1.34 world on a body of
     * 2.24, so amber frames it on both sides. Its bottom half is filled with
     * parcels, which is a lit solid exactly where a void would show road. And
     * the two door leaves are swung open, standing outboard of the flanks, so
     * the object is visibly a box that has been OPENED rather than a box with a
     * gap in it.
     *
     * THE DOORS ARE WHERE ITS GLASS IS, and that is the fix for the largest
     * single reason the fleet read as boxes: two of eight vehicles showed no
     * glass at all from the only angle the game has. A box van's rear doors are
     * half-glazed, and swung to about 23 degrees each leaf presents 0.23 world
     * of itself outboard of the body where nothing occludes it -- so the glass
     * is seen, in the two bands the rest of the fleet uses, without inventing a
     * window the vehicle does not have. The cab glazing stays for the side lanes.
     */
    const blockVanGeo = (function () {
      const parts = [];
      // A LUTON BOX ON A CAB CHASSIS, which is what the length turns this into.
      // At 1.30 deep the "box body" and the "cab" were 0.80 and 0.44 of it --
      // two slices of the same slab. At 3.90 the box is 2.44 long and the cab
      // is 1.30 in front of it, which is a real van in plan: the rear axle
      // sits under the load space and the front one under the seats.
      vUnder(parts, {
        bodyW: 2.22, z0: -1.90, z1: 1.90, axles: [-0.92, 1.00],
        skirtTop: 0.62, skirtBot: 0.14, spring: 0.16, archR: 0.45,
        wheelX: 0.92, wheelR: 0.33, wheelW: 0.30,
        skirt: VAN_CREASE, under: VAN_DARK, tyre: TYRE_WARM,
        rim: WHEEL_RIM_WARM, hub: WHEEL_HUB_WARM,
      });
      vBumper(parts, 2.12, 0.32, 0.78, -1.93, VAN_DARK, 0.60);
      vLamps(parts, 0.96, 0.78, -1.93, 0.15);
      // The van's cab is at the FRONT, so its front end is the one with the
      // most to say: a deep windscreen already exists up there for the side
      // lanes, and under it there was nothing at all.
      vFront(parts, {
        zFront: 1.92, w: 2.10, dark: VAN_DARK, crease: VAN_CREASE,
        grilleY: 1.02, grilleH: 0.26, lampX: 0.78, lampW: 0.32, lampH: 0.22,
        bumpW: 2.12, bumpH: 0.32, bumpY: 0.78, plateW: 0.60,
      });
      parts.push(
        gl(hcbx(2.22, 0.16, 2.44, 0, 1.02, -0.66, VAN_BODY, 0.04), GLOSS.paint),
        gl(hcbx(2.26, 0.06, 2.48, 0, 1.13, -0.66, VAN_CREASE, 0.02), GLOSS.chrome),
        gl(hcbx(2.24, 1.30, 2.44, 0, 1.81, -0.66, VAN_BODY, 0.07), GLOSS.paint),
        gl(hbx(2.28, 0.12, 2.48, 0, 1.34, -0.66, KIT_B), GLOSS.trim),
        gl(hcbx(2.10, 0.58, 1.30, 0, 0.89, 1.24, VAN_CREASE, 0.05), GLOSS.paint),
        // A CAB ROOF AND A LUTON OVERHANG, because at 3.90 the cab and the box
        // are separate objects and something has to join them. The first long
        // build left 0.76 of air between the top of the windscreen and the
        // bottom of the load box, and the cab read as a detached blue slab
        // parked in front of a crate. A Luton is exactly this shape: the box
        // carries on forward OVER the cab, which is where its extra load
        // volume comes from and why the type exists.
        gl(hcbx(2.08, 0.10, 1.34, 0, 1.75, 1.22, VAN_BODY, 0.03), GLOSS.paint),
        gl(hcbx(2.18, 0.66, 1.28, 0, 2.13, 1.22, VAN_BODY, 0.06), GLOSS.paint)
      );
      // Cab glass. This box is 2.04 wide on a cab of 2.10, so its own side faces
      // ARE the cab's side windows and no separate pane is needed -- adding one
      // here drew a second sheet of glass in the same place and read as a slab
      // hanging off the flank.
      vGlass(parts, 2.04, 0.52, 1.26, 0, 1.44, 1.24, true);
      // The box body's own flank windows, which a real Luton does not have --
      // so it does not get any. What it gets instead is the thing it does
      // have and nothing else in the fleet does: a curtain rail down each
      // side, one horizontal 2.30 long, which is what makes 2.44 of flat
      // amber panel read as a load box rather than as a wall.
      for (const sx of [-1, 1]) {
        parts.push(gl(bx(0.07, 0.10, 2.30, sx * (2.24 * LANE_FIT / 2 + 0.01), 2.28, -0.66, VAN_CREASE), GLOSS.chrome));
        parts.push(gl(bx(0.07, 0.08, 2.30, sx * (2.24 * LANE_FIT / 2 + 0.01), 1.20, -0.66, VAN_CREASE), GLOSS.chrome));
      }
      vRoof(parts, 2.24, 2.44, 2.46, -0.66, KIT_B, VAN_BODY);
      parts.push(
        // The load space is LIT, not black, and warm rather than blue -- a cool
        // interior on a warm body is 15% of the area spent pulling the mean back
        // to neutral. The parcels fill 73% of the opening's height for the same
        // reason the space is lit at all: what the player must never see through
        // a BLOCK is road.
        hbx(1.34, 1.22, 0.06, 0, 1.79, -1.85, 0x3a2a12),
        hbx(1.22, 0.50, 0.30, 0, 1.45, -1.72, KIT_B),
        hbx(1.00, 0.38, 0.26, 0, 1.90, -1.74, LEMON),
        hbx(1.38, 0.22, 0.09, 0, 2.29, -1.855, KIT_B)      // shutter valance
      );
      // The leaves, swung open. Half-glazed, and the glass takes the same two
      // bands as every other window in the fleet.
      //
      // THEY HINGE AT THE TAIL AND SWING FORWARD, which they could not do
      // before: a leaf 0.42 wide swung to 0.40 radians needs 0.16 of depth
      // behind its hinge, and at halfZ 0.65 there was none to give it, so the
      // pair stood at the same z as the opening and read as two flaps. The
      // hinge is on the rear corner now and the leaf reaches forward along the
      // flank, which is what an open van door does.
      for (const sx of [-1, 1]) {
        const ry = -sx * 0.40;
        parts.push(bxAt(0.42, 0.62, 0.09, sx * 1.14, 1.47, -1.76, VAN_BODY, 0, ry));
        parts.push(bxAt(0.42, 0.38, 0.09, sx * 1.14, 1.97, -1.76, GLASS_PALE_LO, 0, ry));
        parts.push(bxAt(0.42, 0.30, 0.09, sx * 1.14, 2.31, -1.76, GLASS_PALE_HI, 0, ry));
      }
      return merge(parts);
    })();

    /**
     * BLOCK v7: A REFUSE TRUCK, which is the one vehicle in the set whose most
     * characteristic feature is the part you see from behind.
     *
     * The silhouette is STEPPED, and deliberately in the direction that reads
     * from a chase camera: the hopper is aft and stops at 1.95, the packer body
     * is forward and goes to 2.59, so the tail is a low wide block with a taller
     * block standing behind it. Nothing else on this road has two roof heights.
     *
     * THE STEP HAS TO BE A VALUE STEP, not only a height one, and the first pass
     * made both halves pink and got back a flat slab with a bar across it. It
     * was then fixed with a cream packer body, which is the cream that flattened
     * the fleet. It is fixed properly now: the whole truck is hi-vis chartreuse
     * -- which is what a municipal refuse truck actually wears, and which renders
     * at L 153.6 against cream's 175.5 for seven times the chroma -- and the step
     * is carried by the orange caps, the throat and the tailgate instead.
     *
     * ITS REAR WINDOW is the packer body's inspection panel, standing 0.06 proud
     * of a face that clears the hopper cap by 0.12, so it is the one piece of
     * glass on this vehicle that the chase camera can actually see. A rear
     * loader really does carry one; this is the second half of the "two of eight
     * vehicles show no glass at all" finding.
     */
    const blockRefuseGeo = (function () {
      const parts = [];
      // TWIN REAR TYRES, which no other vehicle in the fleet has and which a
      // rear loader always does. It widens the arch into a single broad notch
      // instead of the narrow one the car and the van carry, so the refuse
      // truck differs from them along the bottom edge as well as the top.
      //
      // AND THE TWINS ARE ON THE REAR AXLE ONLY, which is where a real one
      // carries them and which was not expressible before: there was one axle,
      // so "twin rear tyres" was twin EVERY tyre. Now the front pair is single
      // and the rear pair is double, which is a difference you can see from
      // the flank and from directly behind.
      vUnder(parts, {
        bodyW: 2.24, z0: -1.88, z1: 1.88, axles: [-0.85, 1.02],
        skirtTop: 0.62, skirtBot: 0.16, spring: 0.16, archR: 0.45,
        wheelX: 0.90, wheelR: 0.33, wheelW: 0.26, archPad: 0.04, dual: true,
        skirt: BIN_CREASE, under: BIN_DARK, tyre: TYRE_WARM,
        rim: WHEEL_RIM_WARM, hub: WHEEL_HUB_WARM,
      });
      vBumper(parts, 2.12, 0.30, 0.77, -1.91, BIN_DARK, 0.58);
      vLamps(parts, 0.96, 0.77, -1.91, 0.15);
      // The cab end. A refuse truck's cab is forward of the packer body, so the
      // front is a tall flat screen over a heavy grille.
      vFront(parts, {
        zFront: 1.90, w: 2.10, dark: BIN_DARK, crease: BIN_CREASE,
        grilleY: 1.06, grilleH: 0.30, lampX: 0.80, lampW: 0.30, lampH: 0.22,
        bumpW: 2.12, bumpH: 0.30, bumpY: 0.77, plateW: 0.58, slats: 4,
      });
      // THE CAB IS A SEPARATE MASS NOW, and it is the thing the length buys
      // this vehicle. A rear loader is a cab, then a gap, then a packer body,
      // then a hopper -- three steps in the roofline along the LENGTH, and at
      // 1.30 deep all three were stacked in the same 1.30 and had to be
      // expressed as height alone. The cab is 1.10 long, 2.14 tall, and stands
      // in front of a packer body that is 2.85.
      parts.push(
        gl(hcbx(2.10, 1.34, 1.34, 0, 1.44, 1.20, BIN_BODY, 0.06), GLOSS.paint),
        gl(hcbx(2.14, 0.06, 1.38, 0, 2.14, 1.20, VAN_BODY, 0.02), GLOSS.trim)
      );
      vGlass(parts, 1.60, 0.46, 1.26, 0, 1.86, 1.24, false);   // cab screen
      parts.push(
        gl(hcbx(2.24, 0.90, 2.34, 0, 1.37, -0.70, BIN_BODY, 0.06), GLOSS.paint),
        gl(hcbx(2.26, 0.05, 2.38, 0, 1.845, -0.70, BIN_CREASE, 0.02), GLOSS.chrome),
        gl(hcbx(2.18, 0.08, 2.40, 0, 1.91, -0.70, VAN_BODY, 0.03), GLOSS.trim),
        // THE PACKER IS NARROWER THAN THE HOPPER, not merely taller than it.
        // At 2.14 on a 2.24 hopper the step was 0.05 a side -- invisible at
        // gameplay scale, so the truck read as one slab with a bar across it
        // and its outline was interchangeable with the bus's. At 1.72 the
        // shoulder is 0.26 a side and the object is visibly two masses: a low
        // wide tail with a tall narrow body standing behind it, which is what a
        // rear loader is and what nothing else on this road has.
        gl(hcbx(1.72, 0.56, 1.60, 0, 2.23, -0.34, BIN_BODY, 0.06), GLOSS.paint),  // packer 1.95-2.51
        gl(hcbx(1.78, 0.08, 1.64, 0, 2.55, -0.34, VAN_BODY, 0.03), GLOSS.trim),   // body cap
        gl(hcbx(1.54, 0.06, 1.50, 0, 2.62, -0.34, BIN_BODY, 0.02), GLOSS.paint)   // roof chamfer
      );
      // The packer body's own side windows, at the height its inspection panel
      // sits: from the flank this vehicle was a solid chartreuse wall 2.6 tall.
      // 1.62 of them now rather than 0.48, which is the flank a 3.90 vehicle
      // actually presents to the next lane.
      vSideGlass(parts, 1.72, -1.08, 0.40, 2.06, 2.42, false);
      vGlass(parts, 1.28, 0.34, 1.50, 0, 2.24, -0.34, true); // packer inspection window
      parts.push(
        hbx(1.42, 0.30, 0.06, 0, 1.22, -1.86, 0x141a33),   // the throat 1.07-1.37
        hbx(2.26, 0.14, 0.10, 0, 1.71, -1.835, VAN_BODY), // reflective band 1.64-1.78
        // Bin-lift arms, thick because at gameplay scale the 0.09 grab rails
        // they replaced were two amber slivers nobody could name. Amber survives
        // here and on the beacon and nowhere else in the fleet, because on a
        // refuse truck it means something. The reflective band above sits 0.025
        // FORWARD of them rather than sharing their rear plane: three fittings
        // all ending at exactly -0.65 and overlapping in xy is three coplanar
        // faces, and it flickered.
        bxAt(0.15, 0.90, 0.10, -0.95, 1.30, -1.86, 0xffe45e),
        bxAt(0.15, 0.90, 0.10, 0.95, 1.30, -1.86, 0xffe45e),
        hbx(1.24, 0.10, 0.16, 0, 0.99, -1.83, VAN_BODY),   // rear step
        // 2.70 rather than 2.72: the tailgate's own shudder lifts the whole
        // variant by 0.012, which had been putting the beacon's top on 2.802
        // against a 2.80 ceiling. Nothing was watching that until now.
        bx(0.18, 0.14, 0.18, 0, 2.70, -0.34, 0xffe45e)     // beacon 2.63-2.77
      );
      return merge(parts);
    })();
    /**
     * The tailgate, and it SLIDES rather than swings.
     *
     * A hinged tailgate is what a real one does and it is not available here: a
     * top-hinged panel 0.62 deep sweeps its bottom edge 0.6 units back toward
     * the lens, which is past the gate line, and a side-hinged one sweeps out
     * of the lane. A vertical slide is the one motion with no footprint at all,
     * it is what a packer plate actually does inside the hopper, and from
     * directly behind a panel rising off a dark throat is a bigger signal than
     * any rotation would be.
     */
    const blockRefuseGateGeo = merge([
      bx(1.46, 0.62, 0.09, 0, 0, 0, BIN_BODY),
      bx(1.52, 0.09, 0.13, 0, 0.33, 0.01, VAN_BODY),
      bx(1.52, 0.09, 0.13, 0, -0.33, 0.01, BIN_DARK),
    ]);

    /**
     * BLOCK v8: TWO ROAD CYCLISTS ABREAST.
     *
     * The file's standing objection to a bicycle is at blockTrikeGeo: one rider
     * is a third of a lane wide and 1.75 tall against a 2.05 jump apex, so it
     * reads as something to hurdle. Both halves of that are answered here by
     * the same thing, and it is the thing that actually blocks a road in real
     * life: A PAIR RIDING TWO ABREAST. Shoulder to shoulder they span 1.30 of
     * the 1.70 lane -- 76%, which is what the trike's pennants span -- and the
     * near rider has an arm STRAIGHT UP, the standard peloton signal for a
     * hazard ahead, which takes the silhouette to 2.55.
     *
     * THE KIT IS NOT CREAM ANY MORE and that is the whole of the colour fix
     * here. Cream sleeves on a cream jersey were 30% of this variant's area at
     * S 0.092; real cycling hi-vis is orange or chrome yellow, both of which
     * render at S 0.78, and the two riders now wear them in opposite
     * arrangements so the pair still reads as two people rather than one prop
     * mirrored. The luminance that cream was buying comes back off 0xffd400,
     * which is L 141 -- 80% of cream's, for ten times the chroma.
     *
     * ===== SHORT OF THE 1.6x / 0.30 TARGET, AND REFUSED WITH NUMBERS =====
     *
     * It needs L 97.8 against the dark lane and renders 91.3 -- short by 7%,
     * the closest miss in the game. Measured on the shipped build:
     *
     *   as it ships (cool rims)                        -0.066   S 0.460
     *   WARM rims and hubs, which is what shipped      -0.066   S 0.472
     *   tyre 0x8a5a3a warm mid                         -0.074   S 0.515
     *   tyre 0x4a2a2a warm dark                        -0.092   S 0.511
     *   tyre 0x3a1a1e warm dark                        -0.098   S 0.512
     *
     * The trade is closed in both directions. Chroma is reachable -- the tyres
     * are 0x6d76a8, a near-neutral grey-blue on the four largest curved
     * surfaces here, and warming them takes S from 0.46 to 0.51. But this
     * variant passes on LUMINANCE, every warm tyre is darker than a grey-blue
     * one, and the L it loses is worth more than the S it gains. dS would have
     * to reach 0.30 against a dark road already at S 0.315, which means an
     * object at S 0.615 -- and two of the largest remaining areas are SKIN,
     * which cannot be saturated and stay skin.
     *
     * The rims and hubs are WARM and that is the one change kept, because it
     * is this file's own stated rule -- cool pale trim on a warm body is the
     * straddle the fleet header names -- and the cyclists were the last warm
     * two-wheeler still wearing the cool set. It buys 0.012 of saturation and
     * changes no verdict. It is kept for consistency, not for the number.
     *
     * REFUSED. Gate margin +0.195, the widest of the two variants still short.
     */
    /**
     * ===== AND A BLIND READER CALLED THEM MOTORCYCLISTS =====
     *
     * Shown a 1:1 crop of this variant at 8 and 12 units through the live
     * chase camera, with no idea what the game was, a reader wrote: "Two
     * people on motorcycles, and this one I am fairly confident about... I
     * would call them escort or outrider motorcyclists running ahead of the
     * race, or possibly couriers." They are road cyclists on bicycles.
     *
     * That is a category error, not a detail complaint, and it is the same
     * failure the owner made when they looked at this game's people and asked
     * for the cops and taxi drivers to be improved. Three things caused it and
     * none of them is the paintwork:
     *
     *   THE WHEELS WERE CAR WHEELS. vWheel puts a rim disc at 0.58 of the
     *     radius inside a 0.10-wide tyre, which is correct for the fleet and
     *     is a motorcycle wheel under a bicycle. A bicycle wheel is MOSTLY
     *     AIR. See vBikeWheel: a segmented tyre with the road showing through
     *     it, six spokes, a small hub, 0.055 wide.
     *   THE BARS WERE A STRAIGHT TUBE with two blobs on it, which is a
     *     scooter. See vDropBars -- the one object in the world that is only
     *     ever found on a road bicycle.
     *   THE RIDERS SAT UP. A motorcyclist sits upright; a road cyclist is
     *     folded over the bars with their back near horizontal and their head
     *     down between their shoulders. At 17 px of head that POSTURE is the
     *     read, and it costs nothing -- it is the same boxes at other angles.
     *
     * The near rider is now crouched on the drops. The far one keeps the
     * straight arm up, which is the peloton's own signal for a hazard ahead --
     * so it is both the height the variant needs and a gesture no motorcyclist
     * makes.
     *
     * ===== SHORT OF THE 1.6x / 0.30 TARGET, AND REFUSED WITH NUMBERS =====
     *
     * It needs L 97.8 against the dark lane and renders 91.3 -- short by 7%,
     * the closest miss in the game. Measured on the shipped build:
     *
     *   as it ships (cool rims)                        -0.066   S 0.460
     *   WARM rims and hubs, which is what shipped      -0.066   S 0.472
     *   tyre 0x8a5a3a warm mid                         -0.074   S 0.515
     *   tyre 0x4a2a2a warm dark                        -0.092   S 0.511
     *   tyre 0x3a1a1e warm dark                        -0.098   S 0.512
     *
     * The trade is closed in both directions. Chroma is reachable -- the tyres
     * are 0x6d76a8, a near-neutral grey-blue, and warming them takes S from
     * 0.46 to 0.51. But this variant passes on LUMINANCE, every warm tyre is
     * darker than a grey-blue one, and the L it loses is worth more than the S
     * it gains. dS would have to reach 0.30 against a dark road already at
     * S 0.315, which means an object at S 0.615 -- and two of the largest
     * remaining areas are SKIN, which cannot be saturated and stay skin.
     *
     * THE OPEN WHEEL IS THE ONE THING THAT MOVED THAT NUMBER, and it moved it
     * the right way by accident rather than by design: the grey-blue tyre was
     * the largest near-neutral area on the object and most of it is now air.
     * The rebuild is verified against the gate in tools/shoot.js and the
     * before and after are in the report, because this is one of the two
     * variants with no margin to spend.
     *
     * REFUSED. Gate margin +0.195, the widest of the two variants still short.
     */
    const blockCrateLoadGeo = (function () {
      const parts = [];
      const TYRE_BIKE = 0x6d76a8;
      /**
       * ============ THE CRATES, AND WHY A LONE RIDER NEEDS THEM ============
       *
       * A single road cyclist cannot be a fair BLOCK on its own, and that is
       * measured rather than argued. tools/kindread.js reads how much of the
       * lane width a variant covers in each of fourteen bands and runs a
       * nearest-centroid classifier over the result: the two-abreast pair
       * ALREADY landed nearer the DUCK centroid than its own, by -1.5, and one
       * rider is thinner than two. A BLOCK that reads as a DUCK is a player
       * sliding into a wall, and rule 4 makes that a build failure rather than
       * a preference. This file's own header says the same thing in words at
       * the old trike: "one rider is a third of a lane wide and 1.75 tall
       * against a 2.05 jump apex, so it reads as something to hurdle."
       *
       * The answer the pair was giving -- add a second person -- is the one
       * the owner has just refused. So the lane is filled by the object that
       * is actually on the carriageway in TWO of the five reference frames:
       * wooden crates. ttgr-archway-and-crates.png has a pair of them standing
       * in the road with the runner threading between, and
       * ttgr-gift-crate-and-bus.png has one square in a lane. They are also
       * named in this pass's brief as an allowed replacement.
       *
       * WHAT THE STACK IS FOR, in order of importance:
       *   1. It fills bands 0 to 5 at better than 0.8 of the lane, which is
       *      what makes the profile say BLOCK.
       *   2. IT CARRIES THE CAUTION FACE, at 0.72 on its own front plane. The
       *      face is centred on the lane by the pool -- f.position.set(0, y, z)
       *      -- so it can only ever sit on something centred, and on the bare
       *      bicycles that meant a 1.23-wide striped board hanging at hub
       *      height across both wheels. See the note at the face row for what
       *      that was doing.
       *   3. Wood is the one material in the hazard fleet that is not painted
       *      metal, so the stack does not read as more of the same barrier.
       */
      const CRATE = 0xb07434, CRATE_DK = 0x6e4418, CRATE_LT = 0xd89a52;
      (function crates() {
        // Three boxes: a wide low pair and one across the top, offset, so the
        // stack has a stepped outline rather than being one slab with lines
        // drawn on it. Chamfered on every edge -- the owner's "less box like"
        // applies hardest to the thing that IS a box, and the reference's
        // crates are visibly rounded at every corner.
        //
        // THE THIRD CRATE IS BESIDE, NOT ON TOP. It was stacked at x -0.12 and
        // spanned y 0.62 to 1.12 in the middle of the lane, which is exactly
        // where the bicycle is -- the first frame of this build showed crates
        // and a rider's head with no machine between them, and the owner's ask
        // was "the bike needs to be on the road", not "the bike needs to be
        // behind a box". At x -0.62 the stack still owns the low bands and the
        // whole of the lane centre above 0.68 is open for the frame, the
        // saddle, the bars and the rider.
        //
        // THE TWO FRONT CRATES SHARE A z AND A DEPTH, so their front planes are
        // both -0.61 and the caution face lies flush across the pair. They were
        // at -0.30/0.62 and -0.34/0.58, fronts at -0.61 and -0.63, and the
        // deeper one stood 0.02 PROUD of the face and cut it in half: the
        // shipped frame showed the stripes on the middle crate only.
        const boxes = [
          [-0.30, 0.34, -0.30, 0.84, 0.68, 0.62],
          [0.46, 0.31, -0.30, 0.80, 0.62, 0.62],
          [-0.62, 0.90, -0.26, 0.62, 0.44, 0.54],
          // TWO MORE UP THE COLUMN, and this is a fairness repair rather than a
          // composition one. With the stack topping out at 1.12 the variant's
          // profile was 0.72 / 0.71 / 0.72 / 0.57 / 0.48 / 0.41 and then
          // nothing -- mass on the road tapering to air, which is a JUMP's
          // shape. tools/kindread.js moved this variant's misread from "nearer
          // the DUCK centroid" to "nearer the JUMP centroid" and that is not a
          // fix: one is a player sliding into a wall and the other is a player
          // jumping into one. A BLOCK has to carry mass past the 2.05 jump
          // apex, and a loaded stack is how a crate does that.
          [-0.62, 1.36, -0.26, 0.58, 0.44, 0.52],
          [-0.60, 1.80, -0.26, 0.54, 0.42, 0.50],
        ];
        for (const [bx0, by0, bz0, bw, bh, bd] of boxes) {
          parts.push(gl(cbx(bw, bh, bd, bx0, by0, bz0, CRATE, 0.045), GLOSS.matte));
          // The lid rail and the foot rail, proud of the body on all four
          // sides, which is what a crate has instead of a painted edge.
          parts.push(gl(cbx(bw + 0.05, 0.055, bd + 0.05, bx0, by0 + bh / 2 - 0.028, bz0, CRATE_LT, 0.02), GLOSS.matte));
          parts.push(gl(cbx(bw + 0.05, 0.05, bd + 0.05, bx0, by0 - bh / 2 + 0.025, bz0, CRATE_DK, 0.02), GLOSS.trim));
          // THE DIAGONAL BRACE, on the FRONT and the BACK. Rule 1: the crates
          // are passed at 1.70 units and the reference's own brace is the
          // thing that says crate rather than carton. Two of them, mirrored,
          // so the near face and the far face are different objects.
          parts.push(gl(bx(bw * 0.86, 0.055, 0.03, bx0, by0, bz0 - bd / 2 - 0.012, CRATE_DK, 0, 0, 0.62), GLOSS.matte));
          parts.push(gl(bx(bw * 0.86, 0.055, 0.03, bx0, by0, bz0 + bd / 2 + 0.012, CRATE_DK, 0, 0, -0.62), GLOSS.matte));
          // The corner posts, all four, so the flank is framed too.
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              parts.push(gl(cbx(0.06, bh - 0.06, 0.06, bx0 + sx * (bw / 2 - 0.03),
                by0, bz0 + sz * (bd / 2 - 0.03), CRATE_DK, 0.015), GLOSS.trim));
            }
          }
        }
      })();
      /**
       * ============ THE RIDER IS GONE, AND THAT IS THE FINDING =============
       *
       * This slot has now been rebuilt five times and has failed four times on
       * the same mechanism. The history is worth stating once, in full, because
       * the pattern is the finding and not any one of the attempts:
       *
       *   a cargo trike            removed -- "one rider is a third of a lane
       *                            wide and reads as something to hurdle"
       *   two cyclists abreast     read as MOTORCYCLISTS by a blind reader,
       *                            and measured nearer the DUCK centroid than
       *                            its own by -1.5
       *   one cyclist + a board    the board cut the wheels off at hub height;
       *                            the owner: "ours look like it is sitting on
       *                            something"
       *   one cyclist + crates     the crate stood at his feet and the owner
       *                            read it exactly as built: "the cyclist
       *                            appears to be biking on top of the box you
       *                            created. There are also brown boxes next to
       *                            him." A blind reader, with no sight of that
       *                            complaint, independently could not name the
       *                            object at all: "the parts are individually
       *                            legible; the whole is not."
       *
       * ---- WHY IT KEEPS HAPPENING, STATED AS A RULE ------------------------
       *
       * A BLOCK must fill a lane and read as impassable. A bicycle is thin and
       * mostly air -- that is what a bicycle IS, and it is why vBikeWheel was
       * built with the road showing through it. So a bicycle cannot fill a lane
       * on its own, and every version of this object has therefore had a board,
       * a panel or a crate propped next to it to do the filling. THE PROP THEN
       * BECOMES THE THING THAT READS, and the rider becomes something sitting
       * on it. That is not four unlucky compositions; it is one structural
       * fact, and no fifth arrangement of a rider beside an object escapes it.
       *
       * The general form, for the next agent: AN OBJECT THAT CANNOT CARRY ITS
       * KIND ALONE SHOULD NOT BE GIVEN A HELPER. Give the kind to the helper,
       * or give up the slot.
       *
       * ---- SO THE HELPER BECOMES THE HAZARD --------------------------------
       *
       * The crates were already doing all of the work: they own every band the
       * classifier reads, they are what carried the mass past the 2.05 jump
       * apex, and they are the object standing on the carriageway in two of the
       * five reference frames. ttgr-archway-and-crates.png has a pair of them
       * in the road with the runner threading between; ttgr-gift-crate-and-bus
       * .png has one square in a lane.
       *
       * A loaded pallet of delivery crates is a lane-filling road obstacle that
       * is honest about being one -- it is opaque, it is square to the road, it
       * stands ON the road with no plinth under it, and there is no second
       * object beside it for the eye to mistake for the subject. It is also
       * exactly the owner's own vocabulary: "basic brown boxes".
       *
       * The five boxes below are the stack the cyclist used to stand beside,
       * re-laid to fill the lane centre the rider used to occupy rather than to
       * leave a hole for him. Nothing else about them changes.
       */
      (function load() {
        // The lane centre is now the stack's, so the column that used to be
        // pushed out to x -0.62 to clear the bicycle comes back to the middle
        // and the pair at the bottom widens to close the lane at the road.
        const boxes = [
          [-0.40, 0.34, -0.30, 0.90, 0.68, 0.62],
          [0.44, 0.31, -0.30, 0.86, 0.62, 0.62],
          [-0.06, 0.92, -0.26, 0.94, 0.48, 0.56],
          [-0.20, 1.40, -0.26, 0.74, 0.48, 0.54],
          [0.30, 1.38, -0.24, 0.62, 0.44, 0.50],
          [-0.10, 1.84, -0.26, 0.66, 0.44, 0.50],
          [-0.14, 2.26, -0.26, 0.58, 0.42, 0.48],
          // THE TOP CRATE EARNS ITS PLACE ABOVE THE JUMP APEX. A BLOCK has to
          // carry mass past 2.05 or the classifier reads it as something to
          // hurdle -- that is the exact failure the two extra boxes were added
          // for on the old stack. Measured: bands 10-13 read 0.31/0.25/0.11/0
          // with the stack topping out at 2.47, which is a taper into air right
          // where the impassability has to be stated. This one tops out at 2.70
          // against a box ceiling of 2.80.
          // 2.55 AND NOT 2.62, AND THE GUARD IS WHY. At 2.62 with a 0.40 body
          // the crate topped out at 2.82 and its proud lid rail at 2.8195,
          // against a box ceiling of 2.80 -- tools/shoot.js failed the build
          // with "art may not leave its own collision box", which is rule 4
          // working exactly as intended. 2.55 puts the lid rail's top at 2.75
          // with 0.05 of margin, and the band above the jump apex is still
          // carried. Art gives way to the box; it does not negotiate with it.
          [-0.16, 2.55, -0.26, 0.52, 0.40, 0.46],
        ];
        for (const [bx0, by0, bz0, bw, bh, bd] of boxes) {
          parts.push(gl(cbx(bw, bh, bd, bx0, by0, bz0, CRATE, 0.045), GLOSS.matte));
          parts.push(gl(cbx(bw + 0.05, 0.055, bd + 0.05, bx0, by0 + bh / 2 - 0.028, bz0, CRATE_LT, 0.02), GLOSS.matte));
          parts.push(gl(cbx(bw + 0.05, 0.05, bd + 0.05, bx0, by0 - bh / 2 + 0.025, bz0, CRATE_DK, 0.02), GLOSS.trim));
          parts.push(gl(bx(bw * 0.86, 0.055, 0.03, bx0, by0, bz0 - bd / 2 - 0.012, CRATE_DK, 0, 0, 0.62), GLOSS.matte));
          parts.push(gl(bx(bw * 0.86, 0.055, 0.03, bx0, by0, bz0 + bd / 2 + 0.012, CRATE_DK, 0, 0, -0.62), GLOSS.matte));
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              parts.push(gl(cbx(0.06, bh - 0.06, 0.06, bx0 + sx * (bw / 2 - 0.03),
                by0, bz0 + sz * (bd / 2 - 0.03), CRATE_DK, 0.015), GLOSS.trim));
            }
          }
        }
      })();
      return merge(parts);
    })();
    /**
     * Four knees on one pivot, exactly as the trike does it -- rotation.x keeps
     * x offsets, so one mesh can carry both riders. The second rider's pair is
     * set at 3 and 9 o'clock rather than 12 and 6, which puts the two cadences
     * a quarter turn apart: two riders pedalling in lockstep read as one prop
     * mirrored, and the whole point of a pair is that it is two people.
     */
    /**
     * SHOES ON THE PEDALS. A knee with nothing on the end of it is a lobe, and
     * the pale shoe is what turns the orbit into a leg going round -- it is the
     * brightest thing on the lower half of either bike and it moves, which at
     * gameplay framing is worth more than anything static of the same size.
     */

    /**
     * BLOCK v9: A DELIVERY MOPED.
     *
     * A two-wheeler is mostly rider, and the rider is the read -- so this one is
     * built upward: a 1.52-wide insulated food cube behind the seat carrying the
     * mass at 0.86-1.72, a hi-vis back above it, and a helmet at 2.52. The WIDTH
     * comes from the mirrors, which reach 0.67 either side of the lane centre.
     * That is 79% of the lane, and mirrors are the one part of a moped that is
     * genuinely as wide as the vehicle, so nothing is invented for it.
     *
     * It is the one variant allowed to sit under 1.25x on luminance and be
     * carried entirely by saturation, which is exactly the configuration of
     * `tgr-city`'s parked blue car (0.98x luminance, dS +0.38). Saturation
     * e-folds three times faster than value with distance, so if only one
     * variant is allowed to live there it should be the smallest one, and the
     * moped is it.
     */
    /**
     * ============ REBUILT AGAINST THE GAMEPLAY-FRAMING SHEET ============
     *
     * `node tools/framing.js --kind BLOCK`, which renders every variant through
     * the LIVE chase camera at 8 / 12 / 20 / 35 units and counts what its pixels
     * are made of. Before this pass, at 8 units:
     *
     *   v9 moped   66x119 px   body 57.7%  face 12.3  ink 9.7  trim 7.7
     *                          wheel 5.7  plate 2.7  lamp 2.6  skin 1.7
     *
     * Against the five variants the rebuild DID reach:
     *
     *   v5 taxi    92x128 px   trim 34.2  body 32.5  glass 12.8  face 8.8
     *   v7 refuse 103x148 px   body 38.3  trim 32.6  face 13.2  lamp 5.5
     *
     * **The built vehicles carry 30-42% of their pixels in TRIM -- the small
     * structure: skirts, arches, bumpers, creases, brackets. The moped carried
     * 7.7%, and one flat pink cube carried more than half the object.** That is
     * what "a stack of boxes" measures as, and it is the whole finding.
     *
     * The fix is not mass, it is structure, and it is bounded by an unusually
     * tight pair of numbers: this variant clears the luminance GATE by 0.027x
     * and the saturation TARGET by 0.006, the narrowest margins in the fleet.
     * So every bracket here is a DARK OF ITS OWN HUE and never a neutral, and
     * the bright additions (indicators, hi-vis over-trousers, exhaust) are
     * chosen to pay for the dark ones. Measured both ways before and after.
     */
    const blockMopedGeo = (function () {
      const M_DARK = 0x4a1024;      // rack, brackets, guard stays -- dark of pink
      const M_MID = 0x8c2040;       // the deeper pink the box panels are cut in
      const parts = [];

      // ---- THE MACHINE, from the road up ---------------------------------
      // A scooter's lower half is one moulded shell with a step-through floor,
      // and what reads from astern is the pair of runners the rider's feet
      // stand on standing outboard of a dark centre. There was no machine here
      // at all before: the rider's waist sat on air above a single wheel.
      parts.push(
        gl(cbx(0.60, 0.11, 0.94, 0, 0.44, 0.16, PINK, 0.035), GLOSS.paint),
        gl(bx(0.14, 0.07, 0.82, -0.33, 0.42, 0.16, M_DARK), GLOSS.trim),
        gl(bx(0.14, 0.07, 0.82, 0.33, 0.42, 0.16, M_DARK), GLOSS.trim),
        gl(cbx(0.42, 0.32, 0.58, 0, 0.52, 0.00, M_DARK, 0.05), GLOSS.trim),
        gl(cbx(0.48, 0.28, 0.54, 0, 0.66, -0.10, PINK, 0.05), GLOSS.paint),
        gl(cbx(0.78, 0.18, 0.46, 0, 0.80, 0.10, 0x2a0c16, 0.04), GLOSS.trim),
        gl(bx(0.80, 0.05, 0.11, 0, 0.90, -0.11, KIT_B), GLOSS.chrome)
      );
      // The exhaust, on the right where every scooter carries it, and warm pale
      // so the one thing sticking out of the dark side is a bright note rather
      // than a second shadow.
      parts.push(gl(cyl(0.078, 0.066, 0.70, 10, 0.27, 0.31, -0.12, WHEEL_RIM_WARM,
        Math.PI / 2), GLOSS.chrome));
      parts.push(gl(bx(0.10, 0.10, 0.09, 0.27, 0.31, -0.50, M_DARK), GLOSS.trim));

      // BOTH ROAD WHEELS, and both now wear a guard. A moped is 1.9 m long,
      // which is 1.61 here, and the pair sits at -0.36 and +0.78 with the fork
      // raked forward from the bars to meet the front hub -- the one line that
      // makes a two-wheeler read as a two-wheeler from the side.
      vWheel(parts, 0, 0.31, -0.36, 0.31, 0.13, TYRE, WHEEL_RIM, WHEEL_HUB);
      vWheel(parts, 0, 0.29, 0.78, 0.29, 0.12, TYRE, WHEEL_RIM, WHEEL_HUB);
      vGuard(parts, 0, 0.31, -0.36, 0.435, 0.30, PINK, 0.34 * Math.PI, 0.86 * Math.PI, 6);
      vGuard(parts, 0, 0.29, 0.78, 0.405, 0.26, PINK, 0.16 * Math.PI, 0.82 * Math.PI, 6);
      // Guard stays, both sides of both wheels: the strut that carries a mudguard
      // is what stops it reading as a slab floating over a tyre.
      for (const sx of [-1, 1]) {
        parts.push(gl(bx(0.05, 0.40, 0.05, sx * 0.17, 0.44, -0.62, M_DARK, 0.34), GLOSS.trim));
        parts.push(gl(bx(0.05, 0.34, 0.05, sx * 0.15, 0.46, 0.94, M_DARK, -0.30), GLOSS.trim));
      }
      // A reflector on the rear guard, low and central, where the law puts it.
      parts.push(gl(bx(0.16, 0.09, 0.05, 0, 0.60, -0.79, LAMP_RED), GLOSS.chrome));

      /**
       * ---- THE RIDER, AND A BLIND READER CALLED HIM A POLICE OFFICER -----
       *
       * Shown a 1:1 crop of this variant at 8 and 12 units with no idea what
       * the game was, a reader wrote: "I would say a police or official escort
       * motorcyclist, or a delivery rider, on the strength of the top box and
       * panniers." That is the owner's own misreading arrived at independently
       * -- they looked at this game's people and asked for the COPS and the
       * taxi drivers to be improved, and this is the cop.
       *
       * The same reader also said this was "the clearest figure of the four",
       * and gave the reason: "unlike every other figure here, the head is an
       * actual helmet: a rounded shell with a black horizontal visor band
       * across it. That visor is what makes it read as a person on a bike
       * rather than a stack of boxes." One 0.44 x 0.08 box was doing more
       * identification work than everything else on the rider combined, which
       * is the whole thesis of this pass in one sentence.
       *
       * So: the rider is vFigure at tier FACE -- head 21 px at 8 units, eye
       * mark 2.75 -- with a visor over the face and a courier's crossbody
       * strap over the hi-vis. The strap is the cheapest thing on the object
       * that a police officer does not wear and a delivery rider always does,
       * and it is LEMON rather than white for the reason written four hundred
       * lines up: this variant clears its luminance gate by 0.027x and its
       * saturation target by 0.006, the narrowest margins in the fleet, and a
       * pale NEAR-NEUTRAL is what failed the build on the cyclists.
       */
      {
        const RS = 1.16;
        const RH = 1.74 * RS;
        const lean = 0.42;
        const y0 = 0.312;
        const hipY = y0 + 0.505 * RH;
        vFigure(parts, {
          x: 0, y: y0, z: 0.24, h: RS, build: 1.02, tier: 2, fz: 1,
          skin: 0xffc79a, hair: 0x241a14, style: 3,
          top: KIT_B, shoulder: 0x2a0c16, sleeve: 0x2a0c16,
          legCol: 0x2a0c16, hipCol: 0x2a0c16, shoe: 0x141a33,
          lean: lean,
          // Sitting: thighs forward onto the floor pan, shins dropped to the
          // runners. The old rider ended at the saddle and had no legs at all
          // below it, so from astern the machine carried a torso on air.
          leg: [0.72, 0.72], knee: [-0.72, -0.72],
          browTilt: 0.08,
          wrap: function (q, role) { return role === 'foot' ? gl(q, GLOSS.trim) : q; },
        });
        const shY = hipY + RH * 0.085 + Math.cos(lean) * (RH * 0.265) - RH * 0.04;
        const shZ = 0.24 + Math.sin(lean) * (RH * 0.265);
        const hy = shY + RH * 0.045 + RH * 0.028 + (0.262 * RS) / 2;
        // One reflective band across the hi-vis, so the back is two values and
        // not one flat rectangle at the exact height the eye lands.
        parts.push(gl(bx(0.62, 0.07, 0.30, 0, shY - 0.30, shZ, 0x2a0c16), GLOSS.matte));
        // THE COURIER STRAP, corner to corner across the back, with the bag
        // itself low on the hip. Nothing else on this object distinguishes the
        // two services the reader named, and this is four boxes.
        parts.push(gl(bx(0.66, 0.09, 0.28, 0, shY - 0.16, shZ - 0.02, LEMON, 0, 0, 0.62), GLOSS.matte));
        parts.push(gl(cbx(0.34, 0.26, 0.20, 0.26, shY - 0.52, shZ - 0.06, M_MID, 0.04), GLOSS.trim));
        parts.push(gl(bx(0.24, 0.05, 0.06, 0.26, shY - 0.44, shZ - 0.16, LEMON), GLOSS.matte));

        /**
         * ---- THE CUBE, AND WHY THE STRAP WAS NOT ENOUGH -------------------
         *
         * After the strap went on, the same blind reader still landed on the
         * wrong service and said exactly why: "The chevrons and the lamps are
         * what push me toward official escort rather than delivery rider,
         * though a courier with a big top box would honestly look much the
         * same from here; I CANNOT SEE ANY BADGE, LETTERING OR LIVERY TO
         * SETTLE IT."
         *
         * Two things in that sentence. The first is that the chevrons cannot
         * be answered by deleting them: they are the caution face, this
         * variant is carried entirely by saturation, and CLAUDE.md rule 4 says
         * a fairness gate is not tradeable against a cosmetic one. The second
         * is that a top box is genuinely ambiguous -- an escort bike has one
         * too -- so the object has to carry something an escort rider does not
         * have at all.
         *
         * What an escort has is a clean silhouette and matched official kit.
         * What a courier has is CARGO ON THEIR BACK: a square insulated cube
         * rising above the shoulders on webbing straps, which is the one piece
         * of equipment that means this job and no other job anywhere in the
         * world. It is also the right shape for this camera -- the chase view
         * is the rear elevation, and the cube's whole identity (square, taller
         * than the shoulders, strapped rather than bolted) is in that
         * elevation rather than in a badge that would be four pixels wide.
         *
         * COLOUR, AND THE FIRST CHOICE FAILED THE BUILD. Measured before this
         * went on: BLOCK v9 sat at 1.216x luminance -- UNDER the 1.25x gate --
         * and cleared on saturation alone, dS 0.302 against a 0.30 target and
         * a 0.22 gate. The cube therefore could not be a pale neutral, which
         * is what failed the build on the cyclists. It was drafted in 0x2b6bff,
         * a delivery blue at sat 0.83 val 1.00, on the reasoning that a vivid
         * colour cannot cost saturation.
         *
         * It cost all of it. v9 went from a gate margin of +0.373 to -0.108 --
         * a build failure -- with dS collapsing 0.302 to 0.040. THE REASON IS
         * A PROPERTY OF THE INSTRUMENT THAT NOTHING IN THIS FILE STATED:
         * shotMean averages the RGB of every covered pixel FIRST and takes
         * satOf of that one mean colour. So saturation here is the saturation
         * of the object's average colour, not the average of its pixels'
         * saturations, and two vivid parts on opposite sides of the hue wheel
         * measure as grey. Blue at 222 against this bike's pink at 345 is 123
         * degrees apart, and the mean of the two is a neutral.
         *
         * That is not a defect to route around -- it is the correct metric for
         * what the gate is about, since a confetti object really does read as
         * one grey mass once saturation has e-folded down the road. It is a
         * constraint on where a large new part may sit: NEAR ITS OBJECT'S OWN
         * HUE, or the object loses the axis it is carried by.
         *
         * So the cube is 0xff5a2b, hue 14 -- 29 degrees round the wheel from
         * the bike's pink, far enough to read as the rider's own kit rather
         * than matched livery, near enough that the mean stays saturated.
         *
         * Moving the hue was not what recovered the margin, and it is worth
         * saying which lever did, because the obvious one is the weak one.
         * Sliding the cube from hue 14 to hue 4 and then to hue 355 moved the
         * gate margin by 0.005 and 0.032 -- nothing. What moved it was getting
         * the NEAR-NEUTRALS off the new part: a cream reflective bar at sat
         * 0.12 and lemon webbing at sat 0.73 became KIT_B at sat 0.98 (+0.041),
         * the cube grew in WIDTH rather than height so its bright face is a
         * larger share of the object without touching the head (+0.068), and
         * the dark-of-hue trim went from 0x8c2a0c at val 0.55 to 0xd1400f at
         * val 0.82 (+0.050). On a metric that reads the mean colour, area of
         * saturated bright is the whole lever and hue placement is a rounding.
         *
         * Landed, measured the same way, against the same build without it:
         *
         *   gate margin      +0.373  ->  +0.382
         *   target margin    +0.007  ->  +0.013
         *   dS               0.302   ->  0.304
         *
         * Both margins end up wider than they started, which is the only
         * acceptable outcome: rule 4 does not allow an identification win to
         * be bought with a fairness number.
         *
         * Built on all six faces per rule 1, and it is seen on all six: the
         * cube is the widest thing on the rider, so the pass shows its flank
         * at arm's length and the lid reads from the crest of every hill.
         */
        /**
         * SIZED BY THE FIRST DRAFT'S FAILURE, WHICH WAS NOT A COLOUR FAILURE.
         *
         * The cube went on at 0.80 x 0.76 x 0.46 centred 0.06 ABOVE the
         * shoulder line and 0.40 behind it, which is roughly what a real one
         * looks like on a real rider. Shot through framing.js at 8 units it
         * deleted the rider. The cube is nearer the lens than the head by its
         * whole standoff, so from dead astern -- the only view the chase camera
         * has -- it covered the helmet, the visor, the shoulders and the hi-vis
         * band together, and the object went back to being a stack of boxes.
         *
         * That would have traded away the one part this variant is known to be
         * carried by. The reader's words about the previous build: "unlike
         * every other figure here, the head is an actual helmet with a black
         * visor band across it. THAT VISOR is what makes it read as a person on
         * a bike rather than a stack of boxes."
         *
         * So the cube is sized against the HEAD rather than against the rider:
         * its lid finishes at 2.11, which is the underside of the helmet, and
         * everything above that line is left alone. It still rises 0.15 clear
         * of the shoulders, which is what says worn-pack rather than pannier,
         * and it is narrower than the top box it sits above so the two never
         * read as one mass.
         */
        const CUBE = 0xff5a2b;
        const CUBE_D = 0xd1400f;          // the dark of its own hue, never a neutral
        /**
         * AND THE SECOND DRAFT WAS A STACK. Sized to clear the helmet, the
         * cube still filled the whole gap between the top box's lid at 1.665
         * and the underside of the helmet at 2.11 -- the only band of this
         * object the chase camera can see the rider in at all -- and the
         * silhouette came back helmet, box, box: exactly the "stack of blocks"
         * this whole pass exists to stop.
         *
         * The band is 0.45 units tall and nothing can widen it, because the
         * top box is nearer the lens than the rider and owns everything below
         * it. So the cube stops competing for the band and starts DECLARING
         * ITSELF INSIDE IT: it is narrower than the top box by more than half,
         * so the two can never merge into one mass, and its rear face -- the
         * only face this camera gets -- carries two lemon webbing straps and a
         * cream reflective bar. Bright webbing on a soft bag is not something
         * a painted panel does, and at 8 units those three marks are 4 to 6 px
         * each, which tools/people.js's own floor says is drawable.
         */
        const cz = shZ - 0.34;
        const cy = shY - 0.12;
        parts.push(gl(cbx(0.82, 0.54, 0.42, 0, cy, cz, CUBE, 0.05), GLOSS.paint));
        // The lid, proud of the box on every edge, with a webbing grab handle
        // standing off it. A soft-sided bag has a lid that overhangs; a bolted
        // pannier does not, and that difference is the whole read at 12 units.
        parts.push(gl(cbx(0.86, 0.08, 0.46, 0, cy + 0.31, cz, CUBE_D, 0.03), GLOSS.trim));
        parts.push(gl(bx(0.20, 0.045, 0.05, 0, cy + 0.375, cz, 0x2a0c16), GLOSS.matte));
        // Corner seams down all four vertical edges, so the cube is a made
        // object rather than a painted block, from any angle it is passed at.
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            parts.push(gl(bx(0.055, 0.52, 0.055, sx * 0.39, cy, cz + sz * 0.19, CUBE_D), GLOSS.trim));
          }
        }
        // Compression webbing down both faces and a reflective bar across
        // them. Front as well as rear: the cube is seen head-on by oncoming
        // traffic, from the flank on every pass, and from above on a crest,
        // and rule 1 does not have a cheaper side.
        for (const sz of [-1, 1]) {
          for (const sx of [-1, 1]) {
            parts.push(gl(bx(0.085, 0.50, 0.03, sx * 0.21, cy, cz + sz * 0.225, KIT_B), GLOSS.matte));
          }
          parts.push(gl(bx(0.62, 0.06, 0.025, 0, cy - 0.17, cz + sz * 0.232, KIT_B), GLOSS.chrome));
        }
        // WEBBING STRAPS over both shoulders, running from the top of the cube
        // forward and down onto the chest. This is what makes it luggage WORN
        // rather than a second box BOLTED on -- the reader had already read the
        // top box as a top box, so a shape with no visible attachment would
        // simply have become a third one.
        for (const sx of [-1, 1]) {
          parts.push(gl(bx(0.09, 0.40, 0.10, sx * 0.21, cy + 0.22, cz + 0.26, LEMON, 0.46), GLOSS.matte));
          parts.push(gl(bx(0.09, 0.28, 0.10, sx * 0.21, cy - 0.08, cz + 0.42, LEMON, -0.30), GLOSS.matte));
        }
        // The helmet: a full shell over the hair with a DARK VISOR BAND, which
        // is the one feature the blind reader named by itself.
        parts.push(gl(cbx(0.46, 0.40, 0.44, 0, hy + 0.10, shZ, PINK, 0.07), GLOSS.paint));
        parts.push(bx(0.40, 0.10, 0.12, 0, hy + 0.05, shZ - 0.20, 0x141a33));
        parts.push(gl(bx(0.30, 0.06, 0.14, 0, hy + 0.28, shZ - 0.17, M_MID), GLOSS.trim));
        // Arms out to the bars, and hands ON them.
        for (const sx of [-1, 1]) {
          parts.push(bx(0.15, 0.48, 0.15, sx * 0.30, shY - 0.30, shZ + 0.20, 0x2a0c16, 0.55));
          parts.push(bx(0.08, 0.26, 0.08, sx * 0.54, shY - 0.28, shZ + 0.32, 0x2a0c16));
        }
      }
      /**
       * THE MIRRORS, AND THEY WERE READING AS LUGGAGE. A blind reader shown
       * this variant after the rebuild described "square yellow panniers or
       * hard boxes on either side at shoulder height" -- which is exactly what
       * a 0.28 x 0.17 flat slab of hi-vis yellow floating at 1.80 is. It also
       * pushed the whole object toward the wrong service: boxes at shoulder
       * height on a machine that already has a top box is a loaded escort
       * bike, not a courier.
       *
       * A mirror is a SMALL PALE FACE on a THIN STALK with a dark back, and
       * the stalk is most of the read: it is what puts air between the mirror
       * and the rider. Half the area, on an arm, and the pale is kept warm
       * rather than neutral because this variant has the narrowest saturation
       * margin in the fleet.
       */
      for (const sx of [-1, 1]) {
        parts.push(gl(bx(0.05, 0.05, 0.30, sx * 0.50, 1.76, 0.60, 0x2a0c16), GLOSS.trim));
        parts.push(gl(bx(0.055, 0.20, 0.055, sx * 0.60, 1.84, 0.66, 0x2a0c16), GLOSS.trim));
        parts.push(gl(bx(0.15, 0.13, 0.05, sx * 0.60, 1.93, 0.68, 0x2a0c16), GLOSS.trim));
        parts.push(gl(bx(0.12, 0.10, 0.04, sx * 0.60, 1.93, 0.70, KIT_B), GLOSS.chrome));
      }

      // ---- THE FRONT END, which rule 1 owns and which had nothing on it ----
      // A leg shield is what tells a scooter from a motorcycle, and it is the
      // whole of the front elevation on the real thing. Oncoming traffic and
      // the pass both see it; the chase camera never does, and that is not an
      // argument.
      parts.push(
        gl(cbx(0.64, 0.62, 0.15, 0, 0.94, 0.63, PINK, 0.06), GLOSS.paint),
        gl(bx(0.66, 0.06, 0.16, 0, 1.24, 0.63, M_MID), GLOSS.trim),
        gl(cyl(0.115, 0.115, 0.11, 10, 0, 1.14, 0.71, LAMP_COLD, Math.PI / 2), GLOSS.chrome),
        gl(cyl(0.062, 0.062, 0.14, 8, 0, 1.14, 0.715, LAMP_CORE, Math.PI / 2), GLOSS.chrome),
        gl(bx(0.09, 0.10, 0.07, -0.27, 1.16, 0.70, LAMP_AMBER), GLOSS.chrome),
        gl(bx(0.09, 0.10, 0.07, 0.27, 1.16, 0.70, LAMP_AMBER), GLOSS.chrome)
      );
      for (const sx of [-1, 1]) {
        parts.push(bx(0.07, 0.92, 0.09, sx * 0.13, 0.86, 0.66, 0x2a0c16, -0.24));
      }
      parts.push(bx(0.30, 0.09, 0.26, 0, 1.34, 0.60, 0x2a0c16));

      // ---- THE TOP BOX, which was the whole object and is now part of it ---
      // Same footprint to the digit -- it is the mass the silhouette and the
      // contrast audit were both tuned against -- and it is no longer one flat
      // panel. A rack under it, corner posts down its rear edges, a recessed
      // upper panel with a reflective strip, a lid with a real lip and a
      // handle. Everything is outboard of, or above, the caution face's own
      // band at y 0.98-1.22, x +/-0.47: the face is unlit and drawn in front of
      // everything, so a fitting inside its rectangle would simply be deleted.
      parts.push(
        gl(bx(0.66, 0.06, 0.52, 0, 0.95, -0.52, M_DARK), GLOSS.trim),
        gl(bx(0.07, 0.38, 0.10, -0.24, 0.78, -0.52, M_DARK), GLOSS.trim),
        gl(bx(0.07, 0.38, 0.10, 0.24, 0.78, -0.52, M_DARK), GLOSS.trim),
        gl(cbx(1.52 * LANE_FIT, 0.58, 0.62, 0, 1.27, -0.52, PINK, 0.07), GLOSS.paint),
        gl(cbx(1.60 * LANE_FIT, 0.10, 0.66, 0, 1.61, -0.52, KIT_B, 0.03), GLOSS.trim),
        gl(cbx(1.64 * LANE_FIT, 0.045, 0.70, 0, 1.665, -0.52, KIT_B, 0.02), GLOSS.chrome),
        gl(bx(0.86, 0.19, 0.05, 0, 1.435, -0.845, M_MID), GLOSS.paint),
        gl(bx(0.74, 0.055, 0.045, 0, 1.435, -0.852, KIT_B), GLOSS.chrome),
        gl(bx(0.36, 0.05, 0.07, 0, 1.54, -0.855, M_DARK), GLOSS.trim),
        gl(bx(0.94, 0.07, 0.05, 0, 1.005, -0.845, M_DARK), GLOSS.trim)
      );
      for (const sx of [-1, 1]) {
        parts.push(gl(bx(0.075, 0.56, 0.075, sx * 0.505, 1.27, -0.815, PINK), GLOSS.paint));
      }

      // ---- THE TAIL LAMPS, a cluster rather than one disc ------------------
      // The old tail was one 0.13 lamp on the centreline, which is 7 px at 8
      // units and 2 at 20. A cluster spans the tail instead: red in the middle
      // where it always was, amber indicators outboard on short stalks, both
      // bright and both saturated -- which is also how this variant pays for
      // the dark brackets above without losing its two thin margins.
      parts.push(cyl(0.13, 0.13, 0.10, 8, 0, 0.94, -0.88, LAMP_RED, Math.PI / 2));
      parts.push(cyl(0.069, 0.069, 0.13, 8, 0, 0.94, -0.885, LAMP_CORE, Math.PI / 2));
      for (const sx of [-1, 1]) {
        parts.push(gl(bx(0.06, 0.05, 0.15, sx * 0.35, 0.94, -0.79, M_DARK), GLOSS.trim));
        parts.push(gl(cyl(0.082, 0.082, 0.09, 8, sx * 0.35, 0.94, -0.885, LAMP_AMBER,
          Math.PI / 2), GLOSS.chrome));
        parts.push(gl(cyl(0.042, 0.042, 0.12, 8, sx * 0.35, 0.94, -0.89, LAMP_CORE,
          Math.PI / 2), GLOSS.chrome));
      }
      // The number plate, on a bracket rather than stuck to the air, and it is
      // still the lowest bright thing on the vehicle -- the job the reference
      // gives it on every one of its four.
      parts.push(gl(bx(0.40, 0.06, 0.07, 0, 0.80, -0.90, M_DARK), GLOSS.trim));
      parts.push(gl(bx(0.34, 0.14, 0.06, 0, 0.72, -0.92, PLATE), GLOSS.chrome));
      return merge(parts);
    })();

    /**
     * The fleet, and the weights are a statement about what the road IS.
     *
     * Thirteen tickets in sixteen are a vehicle, because the complaint that
     * started this was that the road did not have traffic on it -- and the two
     * hazards that are not vehicles are the two the previous review put double
     * weight on for the same kind of reason, so the marshals keep theirs.
     *
     * Cost of a variant nobody is looking at: one merged geometry, built once
     * and shared by every object in the pool, plus three invisible meshes per
     * pooled hazard -- a matrix update each and no draw call. Only the visible
     * body, its ink shell, its face and its one moving part are ever submitted,
     * so ten skins cost the same per frame as four did.
     *
     * The `face` rows moved with the bodies. Each one now sits on a clean band
     * of its own vehicle and clear of the number plate and the lamps, which
     * share the bumper line: the face plane is unlit and drawn in front of
     * everything, so a chevron overlapping the plate would simply delete it.
     */
    const blockPool = hazardPool(K.BLOCK, 'block', [
      {
        // THE FACE MOVES TO THE TAIL, and its z is inside halfZ rather than
        // 0.011 outside it. Every face row in this pool used to sit at
        // -0.661 against a halfZ of 0.65 -- eleven thousandths of art hanging
        // out of the collision box on ten variants, on the axis the occlusion
        // audit measures from. Nothing was watching. It is now, and the rows
        // below are all inside their own box.
        geo: blockTramGeo, face: [2.16, 0.30, 0.78, -1.945], weight: 1,
        // The pantograph sits well forward of the cab now: on a 3.90 tram the
        // shoe belongs over the trucks, not on the nose. 2.36 rather than 2.38
        // because the sway lifts the whole variant by 0.012 and 2.38 put the
        // shoe on 2.812 against the 2.80 ceiling.
        moving: blockTramPantoGeo, pivot: [0, 2.36, -0.40], anim: 'sway',
      },
      { geo: blockSignGeo, face: [2.06, 1.7, 1.58, -0.541], weight: 1 },
      // THE TRAFFIC LIGHT, where the cargo trike used to be. No moving part
      // and no anim: a signal post standing in a lane is the one hazard in
      // this game that is CORRECTLY dead still, and the idle shudder every
      // stopped vehicle carries would read as an earthquake on a pole.
      //
      // The face is sized to the plinth and not to the lane. Every other row
      // here is 1.98 to 2.16 wide because every other variant is a vehicle
      // filling the carriageway; a lane-wide striped board hanging off a
      // 1.02 base would be a plank floating in mid-air on both sides, which
      // is the defect this pass has now measured twice.
      // y 0.05 AND NOT 0.145, ON THE LOWER TIER'S OWN FRONT PLANE. The lower
      // tier is 0.94 deep, so its front face is z -0.47; at y 0.145 the face
      // was standing on the SECOND tier, which is only 0.72 deep, and hung
      // 0.115 out in front of it. It photographed as a striped mat lying on
      // the road beside the plinth rather than as a marking on it.
      // THE FACE GOES ON THE BARRICADE'S TOP BOARD, which is where a works
      // barrier's marking actually is. The board is 0.46 tall centred at 1.09
      // and 0.10 deep at z -0.40, so its front plane is -0.45 and a 0.40-tall
      // face at y 1.09 sits inside it on every edge. Earlier drafts of this
      // row put the face at y 0.145 and then y 0.05 down on the plinth, where
      // it photographed as a striped mat lying on the road beside the pole.
      { geo: blockLightGeo, face: [2.30, 0.40, 1.09, -0.455], weight: 1 },
      {
        geo: blockCrossGeo, face: [2.10, 0.50, 0.98, -0.641], weight: 2,
        // Inner hand, and high. See blockPaddleGeo: the reach is 1.28 from
        // here, so the +/-0.42 wave sweeps to 1.07 from the lane centre
        // against a box halfX of 1.12, and the roundel tops out at 2.62
        // against a ceiling of 2.80 with the shudder counted.
        moving: blockPaddleGeo, pivot: [0.30, 1.26, 0.34], anim: 'paddle',
      },
      { geo: blockBusGeo, face: [2.16, 0.28, 1.22, -1.941], weight: 2, anim: 'idle' },
      { geo: blockTaxiGeo, face: [2.02, 0.22, 0.98, -1.941], weight: 2, anim: 'idle' },
      { geo: blockVanGeo, face: [2.10, 0.20, 1.06, -1.941], weight: 2 },
      {
        // The chevron board goes ON THE TAILGATE, big, where a real refuse
        // truck carries it -- this is the one vehicle in the set whose real
        // rear marking IS a full-width red-and-white chevron panel, so the
        // kind signal and the vehicle agree instead of arguing.
        geo: blockRefuseGeo, face: [2.16, 0.36, 1.30, -1.921], weight: 1,
        moving: blockRefuseGateGeo, pivot: [0, 1.30, -1.86], anim: 'lift',
      },
      {
        // ---- THE FACE, AND WHAT THE BICYCLES WERE SITTING ON -------------
        //
        // This row was [1.70, 0.20, 0.32, -0.571]: a 1.23-wide, 0.20-tall
        // striped panel at y 0.22 to 0.42, at z -0.571, which is NEARER THE
        // LENS THAN EITHER REAR WHEEL. It spanned 72% of the lane straight
        // across both bicycles at hub height, and its hard bottom edge at
        // 0.22 cut off the bottom two thirds of all four wheels, so the tyres
        // never met the road anywhere the camera could see. That is the
        // owner's "ours look like it is sitting on something", and it was the
        // caution face doing it -- not the wheels, which reach y 0.000
        // exactly (vBikeWheel, centre 0.33, radius 0.33), and not a plinth,
        // because this variant never had one.
        //
        // At 0.40 on the crate stack's own front plane it is a marking on a
        // crate, the wheels are clear from the hub down, and the road under
        // the bicycle is visible for the whole approach.
        // NO MOVING PART AND NO ANIM. The crank went with the rider, and a
        // stack of crates is the one hazard in this game besides the traffic
        // light that is correctly dead still -- the idle shudder every stopped
        // vehicle carries would read as a landslide on a loaded pallet.
        geo: blockCrateLoadGeo, face: [1.90, 0.30, 0.40, -0.632], weight: 2,
      },
      { geo: blockMopedGeo, face: [1.30, 0.24, 1.10, -0.921], weight: 2, anim: 'idle' },
    ]);

    /**
     * ============ CONTACT SHADING UNDER EVERY HAZARD ============
     *
     * Measured off tgr-city.png and tgr-egypt.png, and the measurement is the
     * whole point: their contact shading is not a grey shape painted on the
     * road, it is a MULTIPLY of the surface.
     *
     *   parked car, city    47,48,63  on  83,85,112   0.57 / 0.56 / 0.56
     *   runner, Egypt      186,172,135 on 249,232,180  0.747 / 0.741 / 0.750
     *   tram spill, city    78,83,104 on  91,96,122   0.857 / 0.865 / 0.852
     *
     * The same number on all three channels to within 0.01, every time. So the
     * target is 0.60 directly under the footprint easing to 0.85 at the rim --
     * a hard contact under a car, an ambient-occlusion spill several units out.
     *
     * The runner got a shadow when the first review asked for one. The hazards
     * never did, and they are the objects the game is lost by misjudging.
     *
     * WHY ONE MESH. A flat opaque quad cannot multiply, and a blended material
     * per hazard is a draw call per hazard -- up to thirty of them at mile 20.
     * So every live hazard's quad is written into ONE pooled geometry whose
     * vertices are rewritten in place each frame, exactly as the racing line
     * does: no allocation, no growth with the course, ONE extra draw call for
     * the whole road and two triangles per hazard.
     *
     * COLOUR SPACE, because a multiply is where it bites hardest. The renderer
     * outputs sRGB, so blending happens on sRGB-encoded values in the default
     * framebuffer, and the measurements above are sRGB byte ratios. Authoring
     * the falloff as sRGB bytes and letting three decode and re-encode it puts
     * exactly the measured factor on the destination. Fog stays ON: it mixes
     * the multiplicand toward the near-white haze, so a distant hazard's shadow
     * dissolves at the same rate the hazard does, for free.
     */
    const SHADOW_CORE = 0.60;     // directly under the footprint
    const SHADOW_RIM = 0.85;      // the ambient spill at the edge of the mass
    const shadowTex = (function () {
      const N = 64;
      const cv = canvas(N, N);
      const g = cv.getContext('2d');
      const img = g.createImageData(N, N);
      const d = img.data;
      const c = (N - 1) / 2;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const dx = (x - c) / c, dy = (y - c) / c;
          const r = Math.sqrt(dx * dx + dy * dy);
          // Flat core out to 0.55 of the radius (the footprint), the measured
          // ease to 0.85 by 0.80 (the rim), then out to 1.0 -- which under a
          // multiply is "no change" and is what keeps the quad's own square
          // edge invisible.
          let v;
          if (r <= 0.55) v = SHADOW_CORE;
          else if (r <= 0.80) {
            const t = (r - 0.55) / 0.25;
            v = SHADOW_CORE + (SHADOW_RIM - SHADOW_CORE) * (t * t * (3 - 2 * t));
          } else {
            const t = Math.min(1, (r - 0.80) / 0.20);
            v = SHADOW_RIM + (1 - SHADOW_RIM) * (t * t * (3 - 2 * t));
          }
          const i = (y * N + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255);
          d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    })();

    // Three lanes x the deepest gate cluster the spawn window ever holds, with
    // room to spare. Quads past the live count collapse to a point rather than
    // being removed, so the buffer never resizes.
    const SHADOW_MAX = 72;
    const shadowGeo = (function () {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SHADOW_MAX * 18), 3));
      // WINDING. Seen from +y -- which is the only side anything ever sees a
      // road quad from -- the vertices have to run (x0,z0) (x0,z1) (x1,z1) /
      // (x0,z0) (x1,z1) (x1,z0). The obvious order instead puts the cross
      // product at -y, the quads face DOWN THROUGH THE ROAD, and FrontSide
      // culls every one of them: the mesh reports a live draw range, its
      // vertices are where they should be, and it draws nothing whatever. This
      // file has lost a week to exactly that failure once already -- see the
      // LANE_FIT note at the top -- and it presents identically both times.
      const uv = new Float32Array(SHADOW_MAX * 12);
      for (let i = 0; i < SHADOW_MAX; i++) {
        const u = i * 12;
        uv[u] = 0; uv[u + 1] = 0;
        uv[u + 2] = 0; uv[u + 3] = 1;
        uv[u + 4] = 1; uv[u + 5] = 1;
        uv[u + 6] = 0; uv[u + 7] = 0;
        uv[u + 8] = 1; uv[u + 9] = 1;
        uv[u + 10] = 1; uv[u + 11] = 0;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return g;
    })();
    const shadowMesh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({
      map: shadowTex,
      blending: THREE.MultiplyBlending,
      transparent: true,
      depthWrite: false,
    }));
    // Above the road paint (0.005-0.009) and below the telegraph mats (0.012):
    // the shadow darkens the tarmac and the markings, which is what a shadow
    // does, and never touches the device the lane read depends on.
    shadowMesh.renderOrder = 2;
    shadowMesh.frustumCulled = false;
    shadowMesh.userData.notScenery = true;
    group.add(shadowMesh);

    const SHADOW_Y = 0.0105;
    // Wider than the lane so the rim falls off over tarmac rather than being
    // cut at the seam, and long enough that the near end reads as the object
    // sitting ON the road rather than as a disc in front of it.
    const SHADOW_SPREAD = 0.95;
    /**
     * ===== ONE SHADOW SYSTEM, NOT TWO =====
     *
     * There were two live at once, and their comment blocks contradicted each
     * other outright. Every JUMP and BLOCK carried an alpha-blended
     * S.contactShadow blob parented to its own group -- one draw call each,
     * against 15 to 26 live hazards a frame -- AND had a multiply-blended quad
     * written into this pooled geometry for the same object at the same
     * instant. The blob's header argued that "one quad per hazard is the
     * affordable shape of the same idea"; this one's argued that "a blended
     * material per hazard is a draw call per hazard, so every live hazard's
     * quad is written into ONE pooled geometry". Both were shipping.
     *
     * The pooled quad wins on every axis that was actually measured. It is one
     * draw for the whole road instead of one per hazard; it is a MULTIPLY,
     * which is what the reference frames were measured doing (0.57 / 0.747 /
     * 0.857, the same on all three channels) and which an alpha blob cannot
     * do; and it takes fog for free, so a distant hazard's shadow dissolves at
     * the rate the hazard does. Running both also double-darkened the tarmac
     * under every JUMP and BLOCK in the game, which is not a look either
     * header asked for.
     *
     * So the blob is gone and this keeps the two things the blob was RIGHT
     * about, because deleting a system should not delete what it knew:
     *
     *   THE FOOTPRINT. The blob was cut to the variant's own merged bounding
     *     box in xz -- a tram is long and a kerb is wide -- while this quad was
     *     a fixed LANE-WIDE rectangle off the collision box. Every hazard
     *     therefore cast a lane-width shadow, so a moped and a bus stood on the
     *     same puddle. It now reads the same userData.foot the blob did.
     *   NO SHADOW UNDER A DUCK. A DUCK is a bar hanging at 1.41 on two 0.26
     *     standards; it does not rest on the tarmac, and a full-footprint
     *     shadow for an object that is mostly air covers a telegraph mat to
     *     say something untrue. The blob excluded it and this did not. The
     *     test is the collision box's own yMin rather than a list of kinds
     *     that could drift out of date -- BOX[DUCK].yMin is 1.41 and both
     *     others are 0.00, so the rule selects itself.
     *
     * Measured: -16 draw calls at the peak shot, no triangle change (the quads
     * were already allocated), and the road under a hazard goes from two
     * multiplied darkenings to one.
     */
    function updateShadows() {
      const pos = shadowGeo.attributes.position.array;
      const B = MR.Collision.BOX;
      let n = 0;
      for (const g of activeGates) {
        for (let l = 0; l < 3 && n < SHADOW_MAX; l++) {
          const kind = g.gate.lanes[l];
          if (kind === K.CLEAR || !g.objs[l]) continue;
          const box = B[kind];
          if (!box) continue;
          // Only what actually rests on the road. See the header.
          if (box.yMin > 0) continue;
          // Same span the body is stretched by, so a six-unit train drags its
          // whole length of shadow instead of a disc at the cab.
          const span = (kind === K.BLOCK && g.gate.train) ? 1 + g.gate.train * 0.9 : 1;
          // The variant standing here, not the kind. Written on every claim,
          // so this is never the previous tenant's.
          const act = g.objs[l].userData.active;
          const foot = (act && act.userData.foot) || [LANE * 0.5, -box.halfZ, box.halfZ];
          // Authoring z to gate-space z. The variant group stands halfZ forward
          // of the gate line (the near-face anchor, see hazardPool) and a train
          // scales the body about its own origin, which composes to exactly
          // span * (local z + halfZ). Do not re-derive it anywhere else.
          const fc = (foot[1] + foot[2]) * 0.5, fh = (foot[2] - foot[1]) * 0.56;
          const z0 = g.gate.z + span * (fc - fh + box.halfZ) - SHADOW_SPREAD;
          const z1 = g.gate.z + span * (fc + fh + box.halfZ) + SHADOW_SPREAD;
          const cx = K.LANE_X[l];
          // The variant's own half-width, never a difference of LANE_X.
          const hx = foot[0] * 1.12 + SHADOW_SPREAD;
          const p = n * 18;
          // The quad lies ON the road, so each z-end takes the road's own
          // height there. One value for the whole quad would sink the far end
          // of a train's shadow 16 cm into the tarmac on a 4% grade.
          const sy0 = SHADOW_Y + eAt(z0), sy1 = SHADOW_Y + eAt(z1);
          pos[p] = cx - hx; pos[p + 1] = sy0; pos[p + 2] = z0;
          pos[p + 3] = cx - hx; pos[p + 4] = sy1; pos[p + 5] = z1;
          pos[p + 6] = cx + hx; pos[p + 7] = sy1; pos[p + 8] = z1;
          pos[p + 9] = cx - hx; pos[p + 10] = sy0; pos[p + 11] = z0;
          pos[p + 12] = cx + hx; pos[p + 13] = sy1; pos[p + 14] = z1;
          pos[p + 15] = cx + hx; pos[p + 16] = sy0; pos[p + 17] = z0;
          n++;
        }
      }
      shadowGeo.setDrawRange(0, n * 6);
      shadowGeo.attributes.position.needsUpdate = true;
    }

    /**
     * ============ WHICH SKIN A GATE WEARS ============
     *
     * THE DRAW WAS A BIGGER LEVER THAN THE VARIANT COUNT, AND NOBODY HAD
     * LOOKED AT IT. That is the finding, and it is worth the space.
     *
     * The repetition review measured 64.8% of visible windows carrying a
     * repeated variant and concluded the answer was more variants. It is not
     * the whole answer and it is not the cheap half. Measured over 30 dates
     * and 12,886 hazards on the 64.65-unit window (READ_NEAR to SIGHT_MIN,
     * stepped 5 units), windows containing a repeat:
     *
     *              JUMP 4 / DUCK 3     JUMP 6 / DUCK 5     JUMP 7 / DUCK 6
     *   hash             57.2%               46.9%               43.4%
     *   shuffled bag     38.1%               21.7%               17.5%
     *
     * **A shuffled bag at the OLD variant count beats an independent hash at
     * three more variants than we have.** Two more skins buy 3.5 points; the
     * draw buys 25. Both compose, which is why the four new variants stay.
     *
     * WHY THE HASH LOSES. It is a good hash -- it replaced an arithmetic form
     * that gave the four BLOCK skins 36 / 25 / 11 / 18 -- but a good hash is
     * an INDEPENDENT draw, and independence is the property that produces
     * repeats. With six skins and roughly two JUMPs in a window, an
     * independent draw repeats about one window in six by construction and no
     * amount of avalanche changes it. What the player experiences is not the
     * marginal distribution, it is the run.
     *
     * SO THE DRAW IS A BAG THAT EMPTIES. Every variant is dealt once before
     * any is dealt twice, and the order inside each deal is shuffled. This is
     * the randomiser Tetris settled on for exactly this complaint, and its
     * guarantee is the one that matters here: two hazards of a kind closer
     * together than a full deal CANNOT be the same skin. A window holds about
     * two JUMPs against a deal of six.
     *
     * It stays unpredictable -- a repeat is still possible across a deal
     * boundary, which is why the figure is 21.7% and not zero -- so this is
     * not a cycle the player can learn.
     *
     * IT IS STILL A PROPERTY OF THE COURSE AND NOT OF THE PLAYBACK, which is
     * the one thing the old comment was right to insist on. A bag has state,
     * and state read at spawn time would make the casting depend on the order
     * hazards happened to be claimed -- so the WHOLE COURSE IS CAST ONCE,
     * up front, in gate order, and the claim site reads the answer. Nothing
     * about where the player is, how fast they got there, or whether they
     * restarted can reach it. Two players on the same date see the same skin
     * on the same gate, exactly as before.
     *
     * The weights survive: BLOCK's bag holds two tickets for a bus and one
     * for a tram, so a deal is sixteen cards and not ten, and a variant's
     * share is still the ratio this file states.
     *
     * A TRAIN IS ALWAYS VARIANT 0 and is dealt OUTSIDE the bag. It is the only
     * BLOCK body authored to be stretched along z (see blockTramGeo), and a
     * six-unit cargo trike would be a joke rather than an obstacle. Letting a
     * forced draw consume a card would leave the deal short and rot the
     * guarantee for the hazards after it.
     */
    function castGates(gates, key) {
      const bags = {};
      bags[K.JUMP] = jumpPool.bagOf(); bags[K.DUCK] = duckPool.bagOf();
      bags[K.BLOCK] = blockPool.bagOf();
      const deal = {};
      for (const k of Object.keys(bags)) {
        deal[k] = { left: [], rnd: MR.rng.stream(key || '', 'variants/v1|' + k) };
      }
      function draw(kind) {
        const d = deal[kind];
        if (!d.left.length) {
          d.left = bags[kind].slice();
          // Fisher-Yates on the whole deal. Shuffling the bag rather than
          // picking without replacement keeps a weighted variant's two cards
          // apart as often as chance allows instead of adjacent.
          for (let i = d.left.length - 1; i > 0; i--) {
            const j = d.rnd.int(0, i);
            const t = d.left[i]; d.left[i] = d.left[j]; d.left[j] = t;
          }
        }
        return d.left.pop();
      }
      const cast = [];
      for (let g = 0; g < gates.length; g++) {
        const gate = gates[g];
        const row = [-1, -1, -1];
        for (let l = 0; l < 3; l++) {
          const kind = gate.lanes[l];
          if (kind === K.CLEAR || !bags[kind]) continue;
          row[l] = (kind === K.BLOCK && gate.train) ? 0 : draw(kind);
        }
        cast[g] = row;
      }
      return cast;
    }

    // The day's casting, computed once from the course this world was created
    // with. The claim site reads it by gate index; see the header above for
    // why it may not be computed at spawn time.
    let gateCast = null;

    // ---- scenery --------------------------------------------------------

    const winTex = [windowTexture(0), windowTexture(1)];
    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    const buildingPool = Pool(function () {
      const g = new THREE.Group();
      // Each building owns its textures so `repeat` can hold the window size
      // constant while the box is scaled to any height -- one shared texture
      // would smear a 30-unit tower's windows into stripes. Both styles are
      // cloned per object because the pool has to be able to hand the same
      // slot to a punched-window brick block and to a glass tower on
      // consecutive claims; a 64x64 canvas texture is a rounding error.
      const tex = [winTex[0].clone(), winTex[1].clone()];
      tex[0].needsUpdate = tex[1].needsUpdate = true;
      const mat = S.toon(0xffffff, 2);
      mat.map = tex[0];
      const body = new THREE.Mesh(unitBox, mat);
      const line = new THREE.Mesh(unitBox, S.outlineMaterial(S.INK.scenery));
      line.renderOrder = -1;
      const capMat = S.toon(0xffffff, 2);
      const parapet = S.outlined(unitBox, capMat, S.INK.banner);
      g.add(line, body, parapet);
      g.userData.body = body;
      g.userData.line = line;
      g.userData.tex = tex;
      g.userData.mat = mat;
      g.userData.capMat = capMat;
      g.userData.parapet = parapet;
      return g;
    }, group);

    /**
     * A grove: five trees and undergrowth in one mesh. Single trees at the
     * density the seeded stream can afford left PARKLAND reading as a mown
     * field; a clump costs the same draw and fills the middle distance.
     *
     * The trees in it are the SETTING's trees, so a Roman grove is stone pines
     * and a Valencian one is palms. The undergrowth takes the same palette,
     * which is what stops a palm grove sitting on temperate-green scrub.
     */
    function groveGeo(seed, prof) {
      const parts = [];
      let s = seed;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const greens = prof.colors;
      for (let i = 0; i < 5; i++) {
        const sub = [];
        vTree(sub, prof, 0.75 + r() * 0.6);
        placeAt(parts, sub, -5 + r() * 10, 0, -6 + r() * 12, r() * 6.3);
      }
      for (let i = 0; i < 6; i++) {
        parts.push(cone(0.8 + r() * 0.5, 1.0 + r() * 0.6, 6, -6 + r() * 12, 0.4, -7 + r() * 14,
          greens[Math.floor(r() * greens.length)]));
      }
      return merge(parts);
    }

    // ---- per-setting content pools ---------------------------------------
    /**
     * Trees, groves and street rows, built once per setting the day drew --
     * three or four of them, never twelve. A pool per setting rather than one
     * pool re-tinted, because these are different SHAPES: a palm is not a
     * recoloured conifer and no amount of material work would make it one.
     */
    // The half-width of each setting's tree, so placement can stand it off the
    // corridor by what its own crown needs. See the claim site: a constant
    // minimum distance does not hold once the scale roll is applied.
    //
    // Taken as the larger of the x and z extents because the tree is turned by
    // a random yaw at claim time, so the face it presents to the road is not
    // the one measured here.
    const treeReach = [];
    const treePools = SETS.map(function (st) {
      const parts = [];
      vTree(parts, st.look.tree, 1);
      /**
       * ---- THE UNDERSTOREY, AND THE MEASUREMENT THAT CHOSE IT -----------
       *
       * A blind reader shown a whole gameplay frame, asked only about the
       * people in it, volunteered this: "a group of tall brown vertical slabs
       * I genuinely cannot identify; they might be people in brown, or wooden
       * posts, or market stall frames." docs/roadmap.md entry 23 recorded it
       * and named the cause: tree trunks "standing behind the aid station with
       * their canopies occluded by THE STREET WALL".
       *
       * THAT DIAGNOSIS IS WRONG, and tools/canopy.js is what settles it. It
       * keys each placed tree's trunk and crown to two pure colours, renders
       * the real frame with every other object untouched so the occlusion is
       * the shipped occlusion, and counts. Over 51 tree appearances at eleven
       * skips inside the race: 49 read as trees, 0 as thin, 2 as POSTS --
       * trunk over the floor with zero crown. Then each occluder class was
       * hidden in turn. The class that recovers the crown is not the street
       * wall at 12.20. It is "road tile / hedge": THE GAME'S OWN AVENUE, the
       * four broadleaves baked into every hedge tile at x 7.95, standing in
       * front of everything. The worst tree goes from 55 trunk / 0 crown to
       * 127 / 1700 the moment the avenue is hidden.
       *
       * That changes the fix. The brief's two options were "make the canopy
       * visible" and "do not place trees where the wall eats them", and both
       * were written against the wrong occluder. Neither survives the real
       * one: the avenue is a continuous line 12 units apart down both verges,
       * so there is no lateral band behind it that is clear -- a tree pushed
       * outboard far enough to miss it is off the side of a portrait frame
       * long before it clears, and one pushed inboard is in the corridor.
       *
       * So the fix is neither. It is that A TRUNK SEEN WITHOUT ITS CROWN
       * SHOULD NOT BE A BARE POLE. Real dense planting has an understorey, and
       * the pixels that survive through a gap in the avenue are the ones
       * nearest the ground. Putting a shrub mass at the foot of every scatter
       * tree means the thing that shows through that gap is FOLIAGE -- which
       * is identifiable, and true -- instead of a brown slab. It fixes the
       * class rather than the two instances: any occluder, any distance, any
       * leg, including the ones no skip in the sweep happened to land on.
       *
       * It costs no draw call: this is merged into the tree's own geometry and
       * claimed with it. It costs triangles, which the budget has. And the
       * corridor standoff below is computed from the merged vertices, so the
       * skirt is inside the reach it measures automatically and cannot push
       * anything over the carriageway.
       */
      {
        const uc = canopy(st.look.tree.colors);
        const ub = function (i) { return uc[Math.min(i, uc.length - 1)]; };
        // Seven lobes on a ring plus one over the stem, radii and heights
        // stepped so the mass has a top rather than being a flat disc, and
        // sized off the trunk rather than off the crown -- an understorey that
        // reaches as far as the crown is a bush with a tree in it.
        const RING = [
          [0.00, 0.00, 0.62, 0.50, 0],
          [0.86, 0.30, 0.44, 0.32, 1],
          [-0.62, 0.74, 0.40, 0.26, 2],
          [-0.80, -0.46, 0.46, 0.30, 1],
          [0.36, -0.82, 0.42, 0.24, 2],
          [0.58, 0.72, 0.34, 0.44, 0],
          [-0.30, -0.90, 0.32, 0.20, 2],
          [0.94, -0.40, 0.30, 0.22, 1],
        ];
        for (const s of RING) {
          parts.push(sph(s[2] * (st.look.tree.h || 1), 6,
            s[0] * (st.look.tree.h || 1), s[3] * (st.look.tree.h || 1),
            s[1] * (st.look.tree.h || 1), ub(s[4])));
        }
      }
      const geo = merge(parts);
      // THE CIRCUMSCRIBED RADIUS, NOT THE BOX HALF-EXTENT.
      //
      // This used to be max(|x|, |z|) off the bounding box, which is the right
      // number for an axis-aligned tree and the wrong one for this tree,
      // because the claim site turns it through a random yaw. A crown lobe
      // offset in BOTH x and z swings out to hypot(x, z) at some angle, and
      // the box half-extent never sees that: measured on the live page at
      // skip 140, a PARKLAND tree at scale 1.24 stood off by the formula and
      // still put its crown at x 3.61 against a CORRIDOR_HALF of 3.75.
      //
      // That is the same breach the standoff was written to fix, surviving in
      // the fix, and it is the reason to prefer a rotation-INVARIANT measure:
      // the largest distance any vertex sits from the stem is true at every
      // yaw the claim site can roll, so there is no angle left to be unlucky
      // at. It costs one pass over the geometry, once per setting, at build.
      const tp = geo.attributes.position;
      let reach = 0;
      for (let i = 0; i < tp.count; i++) {
        reach = Math.max(reach, Math.hypot(tp.getX(i), tp.getZ(i)));
      }
      treeReach.push(reach);
      return Pool(function () {
        const o = S.outlined(geo, mats.leaf, S.INK.prop);
        // Stamped so tools/canopy.js can find the shaded mesh of every placed
        // tree without guessing at a material or a name -- the same contract
        // userData.people gives the crowd pools. It answers one question that
        // no tree instrument could: how much of THIS tree's crown survives the
        // street wall, the barrier and the top of the viewport.
        o.userData.treeAudit = o.userData.fill;
        return o;
      }, group);
    });
    const grovePools = SETS.map(function (st) {
      return [5, 29, 97].map(function (seed) {
        const geo = groveGeo(seed, st.look.tree);
        return Pool(function () { return S.outlined(geo, mats.leaf, S.INK.prop); }, group);
      });
    });

    /**
     * ================= KERBSIDE FURNITURE: CRATES AND PLANTERS ============
     *
     * The owner, item 6 of the Gold Run notes, verbatim: *"Test out adding
     * basic brown boxes or flower beds on the edge. These are more realistic
     * obstacles."*
     *
     * ---- DECOR, NOT HAZARDS, AND THE REASON IS THE CORRIDOR ---------------
     *
     * The brief asked for an honest decision on that, so here it is with the
     * number attached. The owner called them "obstacles", and a crate standing
     * in a running lane IS what two of the five reference frames show. But
     * anything inside CORRIDOR_HALF is bound by MR.Collision.BOX and by the
     * contrast gates, and this game has just spent an entire pass learning what
     * happens when a crate is put in a lane next to something: the owner read
     * the result as *"the cyclist appears to be biking on top of the box you
     * created."*
     *
     * So the split is deliberate and it is by POSITION rather than by object:
     *
     *   IN A LANE   the crate load is a hazard and carries the whole kind on
     *               its own -- see blockCrateLoadGeo, which is what the failed
     *               cyclist slot became. It is bound by the box and the gates.
     *   ON THE VERGE  these. They are scenery, they stand outside
     *               CORRIDOR_HALF, and the player can never touch them.
     *
     * That is the same object doing both jobs, which is the point: a road has
     * crates on its edge and crates in its way, and they are the same crates.
     *
     * ---- THE STAND-OFF, AND THE PRECEDENT IT OBEYS -----------------------
     *
     * Both of these are turned through a random yaw at claim time, so the
     * reach used to stand them off the corridor is the CIRCUMSCRIBED RADIUS --
     * the largest distance any vertex sits from the origin -- and not
     * max(|x|, |z|) off the bounding box. That distinction is not theoretical:
     * it is written up at treeReach, where the box half-extent let a PARKLAND
     * crown swing out to x 3.61 against a CORRIDOR_HALF of 3.75 at some yaws
     * while measuring as compliant at others. A rotation-invariant measure is
     * true at every angle the claim site can roll, so there is no angle left to
     * be unlucky at.
     *
     * They stand as close in as that rule allows, because the reference puts
     * them hard against the kerb -- ttgr-archway-and-crates.png has a crate
     * with its edge on the kerb line, and ttgr-lightpole-in-lane.png runs
     * planters in a row down both verges. The band is the one the lamp
     * standard already calls "roadside furniture in the same band as the kerb
     * and the aid tables": outside CORRIDOR_HALF (3.75), inboard of POLE_X
     * (5.40), which puts them just beyond the kerb at 3.92.
     */
    // Seeded reach, computed once per pooled geometry at build. Same one pass
    // over the merged vertices the trees take.
    function circumRadius(geo) {
      const p = geo.attributes.position;
      let r = 0;
      for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
      return r;
    }

    /**
     * A STACK OF WOODEN CRATES ON THE VERGE.
     *
     * reference/ttgr-archway-and-crates.png, read off the frame rather than
     * remembered: a chunky brown box, visibly ROUNDED at every corner, with a
     * lighter rim along the top edge, a darker rail at the foot, and a single
     * diagonal plank scribed across the face. Not a cube with a texture on it.
     *
     * RULE 1, AND IT IS NOT A FORMALITY HERE. The player passes these at the
     * kerb, 3.9 units to the side of a camera 4.35 back, and the camera banks
     * through every lane change -- so the flank and the BACK of a kerbside
     * crate are in frame constantly and at close range. The diagonal brace is
     * therefore on all four faces, the rims run right round, and the corner
     * posts are on all four corners. There is no face left off because a chase
     * camera "starts" behind: it goes everywhere.
     */
    function crateStackGeo(seed) {
      let s = seed;
      const r = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const CRATE = 0xb07434, CRATE_DK = 0x6e4418, CRATE_LT = 0xd89a52;
      const parts = [];
      // One to three boxes, stacked and jittered so a row of these down a verge
      // is not the same silhouette repeated. The stack stays under 1.6 tall:
      // these are beside the road, and anything taller starts competing with
      // the hazards for the eye at the distance the lane is chosen.
      const n = 1 + Math.floor(r() * 2.99);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const w = 0.86 - i * 0.13 + r() * 0.20;
        const d = 0.78 - i * 0.10 + r() * 0.18;
        const h = 0.52 - i * 0.06 + r() * 0.12;
        // Each box in the stack is offset and turned a little, which is what a
        // real stack looks like and what stops three boxes reading as one prism.
        const ox = (r() - 0.5) * 0.16, oz = (r() - 0.5) * 0.16;
        const yaw = (r() - 0.5) * 0.5;
        const sub = [];
        sub.push(gl(cbx(w, h, d, 0, 0, 0, CRATE, 0.05), GLOSS.matte));
        // Lid rim and foot rail, proud on all four sides -- what a crate has
        // instead of a painted edge.
        sub.push(gl(cbx(w + 0.055, 0.06, d + 0.055, 0, h / 2 - 0.03, 0, CRATE_LT, 0.02), GLOSS.matte));
        sub.push(gl(cbx(w + 0.055, 0.055, d + 0.055, 0, -h / 2 + 0.028, 0, CRATE_DK, 0.02), GLOSS.trim));
        // The scribed diagonal, on the two long faces AND the two ends.
        sub.push(gl(bx(w * 0.84, 0.06, 0.032, 0, 0, -d / 2 - 0.014, CRATE_DK, 0, 0, 0.6), GLOSS.matte));
        sub.push(gl(bx(w * 0.84, 0.06, 0.032, 0, 0, d / 2 + 0.014, CRATE_DK, 0, 0, -0.6), GLOSS.matte));
        sub.push(gl(bx(0.032, 0.06, d * 0.84, -w / 2 - 0.014, 0, 0, CRATE_DK, 0.6, 0, 0), GLOSS.matte));
        sub.push(gl(bx(0.032, 0.06, d * 0.84, w / 2 + 0.014, 0, 0, CRATE_DK, -0.6, 0, 0), GLOSS.matte));
        // Corner posts, all four.
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            sub.push(gl(cbx(0.065, h - 0.07, 0.065, sx * (w / 2 - 0.032), 0,
              sz * (d / 2 - 0.032), CRATE_DK, 0.015), GLOSS.trim));
          }
        }
        placeAt(parts, sub, ox, y + h / 2, oz, yaw);
        y += h;
      }
      return merge(parts);
    }

    /**
     * A KERBSIDE PLANTER.
     *
     * reference/ttgr-lightpole-in-lane.png runs these down both verges between
     * the cypresses: a terracotta pot, WIDER AT THE TOP than at the foot, with
     * a pronounced lipped rim, and planting standing out of it.
     *
     * ROUND, AND THAT IS THE OWNER'S STANDING INSTRUCTION. *"Make it less box
     * like. That goes for everything. Round animations with extensive
     * detail."* A planter is a body of revolution and there is no excuse for
     * it to be a tapered box: 14 radial segments, a separate rim ring standing
     * proud of the wall, a recessed soil disc so the pot reads as OPEN rather
     * than as a solid lump, and the planting massed as overlapping blobs rather
     * than one cone.
     *
     * BUILT ON ALL SIDES BY CONSTRUCTION. A revolved solid has no back, in the
     * sense that matters: every radial segment is the same as every other, so
     * there is no angle this reads worse from. The soil and the planting are
     * inside the rim from every direction.
     */
    function planterGeo(seed, prof) {
      let s = seed;
      const r = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const TERRA = 0xb5623a, TERRA_DK = 0x8a4526, TERRA_LT = 0xd08055, SOIL = 0x4a3524;
      const parts = [];
      const h = 0.62 + r() * 0.22;
      const rTop = 0.40 + r() * 0.10;
      const rBot = rTop * 0.70;          // the taper the reference actually has
      // The wall, as three stacked frusta rather than one, so the profile can
      // curve very slightly outward instead of being a straight cone.
      parts.push(gl(cyl(rBot + (rTop - rBot) * 0.42, rBot, h * 0.42, 14, 0, h * 0.21, 0, TERRA), GLOSS.matte));
      parts.push(gl(cyl(rBot + (rTop - rBot) * 0.78, rBot + (rTop - rBot) * 0.42, h * 0.36, 14, 0, h * 0.60, 0, TERRA), GLOSS.matte));
      parts.push(gl(cyl(rTop, rBot + (rTop - rBot) * 0.78, h * 0.22, 14, 0, h * 0.89, 0, TERRA), GLOSS.matte));
      // THE RIM, which is the feature that makes it a planter and not a bucket.
      parts.push(gl(cyl(rTop + 0.045, rTop + 0.045, 0.085, 14, 0, h - 0.03, 0, TERRA_LT), GLOSS.trim));
      // A foot ring, so it stands ON the verge rather than being sunk into it.
      parts.push(gl(cyl(rBot + 0.03, rBot + 0.035, 0.05, 14, 0, 0.025, 0, TERRA_DK), GLOSS.trim));
      // The soil, RECESSED below the rim. Without this the pot is a solid
      // tapered lump and the rim has nothing to be the rim of.
      parts.push(gl(cyl(rTop - 0.02, rTop - 0.02, 0.05, 14, 0, h - 0.10, 0, SOIL), GLOSS.matte));
      // The planting. Overlapping low-poly blobs in the SETTING's own foliage
      // colours, so a Valencian planter carries palm greens and a Roman one
      // carries stone-pine greens -- the same rule the groves follow.
      const greens = (prof && prof.colors) || [0x5f9e3a, 0x86c24e];
      const lobes = 4 + Math.floor(r() * 3);
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * Math.PI * 2 + r() * 0.6;
        const rr = (0.16 + r() * 0.13);
        parts.push(sph(rr, 6, Math.cos(a) * rTop * 0.46, h + 0.02 + r() * 0.16,
          Math.sin(a) * rTop * 0.46, greens[Math.floor(r() * greens.length) % greens.length]));
      }
      return merge(parts);
    }

    // Three seeded variants of each, per setting for the planters (the planting
    // takes the setting's foliage) and setting-independent for the crates (a
    // wooden crate is a wooden crate in every city). Pools, not per-object
    // meshes: draw calls are the binding constraint and a pooled prop costs one.
    const crateReach = [], planterReach = [];
    const cratePools = [7, 41, 113].map(function (seed) {
      const geo = crateStackGeo(seed);
      crateReach.push(circumRadius(geo));
      return Pool(function () { return S.outlined(geo, mats.prop, S.INK.prop); }, group);
    });
    const planterPools = SETS.map(function (st, si) {
      planterReach[si] = 0;
      return [3, 61, 131].map(function (seed) {
        const geo = planterGeo(seed, st.look.tree);
        planterReach[si] = Math.max(planterReach[si], circumRadius(geo));
        return Pool(function () { return S.outlined(geo, mats.prop, S.INK.prop); }, group);
      });
    });

    /**
     * THE STREET WALL. Three row variants per setting, laid on a grid down
     * both shoulders wherever the biome says there is a street.
     *
     * This is the single highest-value thing in the whole feature and it is
     * also the cheapest: one merged draw call per row, ten rows live at the
     * spawn window's full depth, and it is in frame permanently instead of
     * once a minute like a landmark. Amsterdam's stepped gables and Bo-Kaap's
     * flat saturated blocks do more to name a city from a still than any tower
     * does, because they are what the road actually runs between.
     *
     * The front face lands at 12.2 -- just behind the eight units of pavement
     * the tile carries -- so a row crowds the frame edge the way the reference
     * games' foreground props do, without ever coming near the corridor.
     */
    const STREET_LEN = 30;
    const streetPools = SETS.map(function (st) {
      const t = st.look.terrace;
      return [11, 47, 83].map(function (seed) {
        const parts = [];
        vTerrace(parts, Object.assign({ bays: Math.max(3, Math.round(STREET_LEN / t.bay)) }, t), seed);
        const geo = merge(parts);
        return Pool(function () { return S.outlined(geo, mats.prop, S.INK.scenery); }, group);
      });
    });

    /**
     * ================== A KNOT OF SPECTATORS ==================
     *
     * Nine people, merged into ONE DRAW. That is the whole reason this object
     * is shaped the way it is and it is not negotiable: the crowd is the
     * largest population of anything in the game, draw calls peak at 266
     * against about 400, and a per-person submission would be catastrophic.
     * Everything below costs triangles, of which there are 296,000 spare.
     *
     * ---- WHAT THE MEASUREMENT SAID TO BUILD, AND WHAT NOT TO --------------
     *
     * tools/people.js, through the live chase camera: a spectator's head in
     * one of these knots is 1.5 px across at the median and 10.1 px at the
     * absolute best, and the WHOLE POPULATION draws 91 head pixels a frame
     * shared between forty visible heads -- 2.3 pixels per face. A 0.055-unit
     * eye projects to 0.4 px at the median head. There is no face here. Not a
     * simplified one, not a hinted one: the mark would land inside a single
     * pixel and be averaged into its neighbour.
     *
     * So this figure is tier READ. Every triangle goes into the two things
     * that DO survive to 90 units:
     *
     *   THE SILHOUETTE, which now separates. Head, neck, shoulders, chest,
     *     hips, two thighs, two shins, two feet, two arms -- through vFigure,
     *     the same builder the marshals use, at a lower tier. The old figure
     *     was five boxes with the legs as one slab and no hips at all, and a
     *     body with no waist is a bottle at every distance.
     *   THE MOTION, which is what tells a crowd from a hedge. Five behaviours
     *     now, not one: arms up, waving, clapping, jumping, and braced on the
     *     barrier leaning at the road. See WAVE_BODY.
     *
     * ---- THE TIMING IS OFFSET PER PERSON, TWICE --------------------------
     *
     * Phase is rolled over a FULL cycle rather than stepped by 1.31 per index,
     * and the shader takes a rate jitter off the same number, so no two people
     * in a knot share a clock. A phase-only stagger at one frequency
     * re-converges: the crowd drifts into unison and back out forever, which
     * is exactly the mechanical look the owner asked to be rid of.
     *
     * ---- AND THE LATERAL REACH WENT DOWN -------------------------------
     *
     * The knots were moved out 0.35 once already because a swept arm reached
     * x 3.70 against a CORRIDOR_HALF of 3.75. vFigure hangs its arms from a
     * 0.40 shoulder, so a hand sits at 0.165 from the centre line where the
     * old splayed arms sat at 0.30, and raised arms go straight up. Nothing
     * here reaches further than what it replaces.
     */
    function crowdGeo(seed) {
      const parts = [];
      const shirts = [0xff4d5e, 0x37d6ff, 0xffe45e, 0x59d47a, 0xff9ad5, 0xfff2e0, 0xffb020, 0x9a7bff];
      const trousers = [0x2b2f52, 0x3a4472, 0x4a3a52, 0x2f3a38, 0x5a4a3a, 0x37405e];
      const signs = [0xffe45e, 0xfffdf5, 0x37d6ff, 0xff9ad5];
      let s = seed * 9301 + 49297;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 9; i++) {
        vSpectator(parts, {
          x: -1.5 + (i % 3) * 1.15 + r() * 0.35,
          z: -2.6 + Math.floor(i / 3) * 2.4 + r() * 0.9,
          r: r, shirts: shirts, trousers: trousers, signs: signs,
          lo: 0.86, hi: 0.30, placard: 0.55,
        });
      }
      return merge(parts);
    }
    const crowdGeos = [crowdGeo(3), crowdGeo(17), crowdGeo(41), crowdGeo(88)];
    const crowdPool = crowdGeos.map((geo) => Pool(function () {
      const o = S.outlined(geo, mats.crowd, S.INK.prop);
      o.userData.people = 'crowd';
      return o;
    }, group));

    /**
     * PAVEMENT LIFE -- the city carrying on beside the closed road.
     *
     * The player asked for people walking across the street, and they now get
     * that on the road itself, as a fixed-lane BLOCK (see blockCrossGeo). These
     * are the other half: purely decorative figures, and the distinction
     * between the two has to be UNMISTAKABLE, because the whole skill of this
     * game is parsing what is on the tarmac. Two rules make it so, and both are
     * structural rather than careful:
     *
     *   DISTANCE. They are clamped outside WALK_IN, which is four units beyond
     *     the crowd barrier and roughly three times the half-width of the play
     *     corridor. Nothing here can drift toward the road however long it is
     *     on screen; the clamp is applied to the drifted position, not to the
     *     spawn.
     *   COLOUR. No pink, no amber, no cyan. Every hazard in this game is one of
     *     those three, and a figure in hazard colours beyond the kerb would
     *     teach the player to discount the hue -- which is the read the record
     *     depends on. These wear greens, blues, creams and browns.
     *
     * A previous pass put rival runners on the tarmac and they had to be
     * removed for the same reason (see the note where they used to be). The
     * lesson stuck: anything on the road is lethal, anything beyond the kerb is
     * not, and there is no middle ground.
     */
    const WALK_IN = K.TRACK_HALF_WIDTH + 4.2;
    /**
     * ---- TIER BODY, AND THE MEASUREMENT THAT PUT THEM THERE --------------
     *
     * tools/people.js through the live chase camera: a walker's head is 6.8 px
     * across at the very best and 1.5 to 4.3 at the median, with a 1.25 px eye
     * mark on the best one. That is the definition of marginal -- a mark that
     * lands across one pixel boundary -- so they get the whole articulated
     * figure and NO facial marks: neck, shoulders, upper arm, forearm, hand,
     * hips, thigh, shin, foot, hair and ears, and nothing inside the face.
     *
     * This is the population where the tier actually bites. They are the
     * closest civilians in the game -- the blind reader picked them out
     * correctly as "ordinary passers-by or commuters, not race staff" -- and
     * they are still too far for an eye.
     */
    function walkersGeo(seed) {
      const parts = [];
      // Deliberately no hazard hues -- see above. AND IT WAS NOT TRUE.
      //
      // The rule three paragraphs up says "no pink, no amber, no cyan", and
      // then the last coat in this list was 0x4fb0c8, which is hue 197 at
      // saturation 0.76 -- the DUCK cyan, three degrees off, on 12% of a
      // figure's surface area. tools/motion.js failed on it the first run it
      // did with an area weight, on a pool that has been drifting laterally
      // beside the road since it was written. A rule stated in a comment and
      // contradicted eight lines later is worth less than no rule, because it
      // stops anyone looking.
      //
      // 0x3fa88f is hue 166 -- a sea green, 28 degrees clear of the cyan and
      // still a coat colour a person would wear.
      const coats = [0x3f6fbf, 0x2f9f72, 0xf6f2e0, 0x7a5a9a, 0x8a5a3c, 0x3fa88f];
      const legwear = [0x2b2f52, 0x3a3444, 0x4a4a5a, 0x5a4a3a, 0x33405e];
      let s = seed * 9301 + 49297;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const pick = (a) => a[Math.floor(r() * a.length)];
      const n = 3 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const x = -1.1 + r() * 2.2;
        const z = -1.8 + i * 1.5 + r() * 0.7;
        const S = 0.90 + r() * 0.26;
        const coat = pick(coats);
        // Mid-stride: one leg forward, one back, with the OPPOSITE arm
        // forward, which is what a walking human does and what a figure with
        // both arms hanging does not. A figure with its feet together reads as
        // standing however much the group is moving, and "standing beside the
        // road" is what the crowd knots already say.
        const step = 0.24 + r() * 0.16;
        const flip = r() < 0.5 ? 1 : -1;
        vFigure(parts, {
          x: x, y: 0, z: z, h: S, build: 0.90 + r() * 0.26, tier: 1, fz: -1,
          skin: pick(FIG.skin), hair: pick(FIG.hair), style: Math.floor(r() * 6),
          top: coat, legCol: pick(legwear), shoe: 0x241f2c,
          leg: [step * flip, -step * flip], knee: [0.16, 0.16],
          arm: [-step * 1.5 * flip, step * 1.5 * flip],
          fore: [0.30, 0.30],
          lean: 0.05,
        });
        // A bag, a dog or nothing: three silhouettes rather than one repeated.
        // The tans came down in SATURATION rather than being moved in hue,
        // because tan IS hue 35-40 and there is nowhere else for it to go. The
        // colour contract is luminance OR saturation (see the CONTRAST note in
        // tools/shoot.js), so a desaturated cream is not the amber a JUMP kerb
        // wears however close the hue sits. 0xe0c69a measured S 0.53 at hue 38
        // and carried 6.6% of a walker's area, which is over the panel
        // threshold in tools/motion.js; these are S 0.33 and S 0.22, under the
        // floor entirely.
        if (i % 3 === 1) {
          parts.push(bx(0.26, 0.30, 0.20, x + 0.38, 0.76 * S, z + 0.20, 0xf6f2e0));
        } else if (i % 3 === 2) {
          // The dog got legs. It was a body, a head and ONE 0.09 post, which
          // at four pixels is a lump on a lead -- and it is the only animal in
          // the game, so it is the only thing that can read as one.
          const dx = x + 0.62, dz = z + 0.10;
          parts.push(bx(0.22, 0.24, 0.56, dx, 0.30, dz, 0xd6c8ae));
          parts.push(bx(0.20, 0.22, 0.22, dx, 0.46, dz - 0.20, 0xd6c8ae));
          parts.push(bx(0.09, 0.11, 0.09, dx, 0.55, dz - 0.26, 0xbdb098));
          for (const lx of [-1, 1]) {
            parts.push(bx(0.075, 0.20, 0.08, dx + lx * 0.07, 0.10, dz - 0.18, 0xbdb098));
            parts.push(bx(0.075, 0.20, 0.08, dx + lx * 0.07, 0.10, dz + 0.20, 0xbdb098));
          }
          parts.push(bx(0.07, 0.16, 0.07, dx, 0.48, dz + 0.30, 0xbdb098, -0.5));
        }
      }
      return merge(parts);
    }
    const walkersGeos = [walkersGeo(11), walkersGeo(23), walkersGeo(59)];
    const walkersPool = walkersGeos.map((geo) => Pool(function () {
      const o = S.outlined(geo, mats.prop, S.INK.prop);
      o.userData.people = 'walkers';
      return o;
    }, group));

    // Rival runners used to live here, on the shoulder, drifting forward and
    // yielding as the player came past. They are gone, and not only because the
    // playtester called them unnecessary.
    //
    // This game's entire skill is parsing objects on the play surface: three
    // lanes, one contact, no second chance. Putting non-interactive human
    // figures on that surface teaches exactly the wrong reflex -- that some of
    // the traffic on the road can be ignored -- and the frames prove the cost:
    // a yielding rival at the closest approach filled a third of the frame
    // beside the runner at the moment the next gate had to be read. The record
    // ghost is the only figure allowed on the road, because it is the only one
    // that means something.
    //
    // The geometry is not kept. A future pass that wants a field of runners
    // wants them OFF the course -- a start-line pack behind the barriers -- and
    // that is a single merged static knot in the shape of crowdGeo below, not a
    // pool of individually animated movers. See git history for the old code.
    //
    // Removing them also freed the shoulder, which is what the oversized
    // landmarks further down now stand on.

    // ---- aid -------------------------------------------------------------
    /**
     * Water and fruit: the only things on the road that are good to hit.
     *
     * Everything about them is built to be the OPPOSITE of a hazard, because
     * the player loses the race by misreading road objects and aid is supposed
     * to be the merciful option:
     *
     *   HAZARD                          AID
     *   fills its lane                  small, a fifth of a lane wide
     *   sits on the road, or overhead   hovers at hip height, between the two
     *   saturated amber/cyan/pink       white and mint, the "go" family
     *   hard-edged icon mat, 14 units   a soft pale pool of light, 1 unit
     *   dead still                      turning
     *
     * The turn is doing more work than it looks like. Nothing else in this
     * world rotates -- hazards, props and scenery are all rigidly static -- so
     * a slowly spinning object is unambiguous at any distance, and it is the
     * genre's universal "pick me up" besides.
     *
     * Collection is lane-match only, with no vertical test and no action (see
     * player.js), so nothing here is allowed to imply otherwise: the item never
     * rises above 1.2, never spans the lane, and the pool of light beneath it
     * says that being in the lane is the whole requirement.
     */
    const AID_Y = 0.95;   // hip height: not the ground (jump), not overhead (duck)
    const AID_POP_TIME = 0.42;
    // Released much sooner than BEHIND, because an uncollected bottle sitting
    // in the next lane back is only clutter -- and the pop needs the slot.
    const AID_BEHIND = 14;
    const aidItems = course.aid || [];

    /**
     * The pool of light under an item, as GEOMETRY rather than as a soft
     * transparent sprite. A glow sprite is the obvious way to draw this and it
     * is the wrong one here: large transparent surfaces are the single most
     * expensive thing this renderer does. Two flat opaque discs of a pale mint
     * cost nothing and read the same at the distance that matters.
     *
     * Both discs are rotationally symmetric on purpose -- the whole item is one
     * mesh and one draw, so the spin below turns the pickup while leaving the
     * pool looking planted on the road.
     */
    function aidPool(r) {
      return [
        cyl(r, r, 0.04, 14, 0, 0.03, 0, 0x86eec0),
        cyl(r * 0.58, r * 0.58, 0.04, 14, 0, 0.06, 0, 0xf0fff8),
      ];
    }

    /**
     * A BOTTLE, and it has to actually look like one. Aid arrives alone now --
     * one item per point, roughly fourteen in a whole marathon -- so each one
     * gets the frame to itself for a second and has to say what it is on its
     * own. The old chunky box did not: it read as "small pale cube", which is
     * a shape this game otherwise only uses for things you must not touch.
     *
     * The identity is entirely in the SILHOUETTE, because at the 20-40 units
     * where the lane is chosen the whole item is about twenty pixels across and
     * nothing else survives. So: a wide base, a shoulder that steps in, a
     * distinctly narrow neck, and a cap wider than the neck in a contrasting
     * mint. Four steps is what turns a rectangle into a bottle; three is a
     * bottle with the cap missing.
     *
     * Still square in section rather than turned, and that is not laziness: a
     * body of revolution is its own axis of rotation, so the spin -- the one
     * signal in this world that says "pickup, not obstacle" -- would be
     * invisible on it. A 0.34 x 0.26 section swings visibly.
     */
    const waterGeo = merge(aidPool(0.54).concat([
      bx(0.34, 0.42, 0.26, 0, 0.85, 0, 0xf6fffb),   // body, 0.64 -> 1.06
      bx(0.36, 0.14, 0.28, 0, 0.82, 0, 0x2fd39a),   // label band
      bx(0.24, 0.12, 0.19, 0, 1.12, 0, 0xf6fffb),   // shoulder
      bx(0.14, 0.10, 0.12, 0, 1.23, 0, 0xf6fffb),   // neck
      bx(0.20, 0.13, 0.17, 0, 1.345, 0, 0x2fd39a),  // cap, proud of the neck
    ]));

    /**
     * A BANANA, and the curve is the whole identity -- a yellow box is a
     * yellow box. It is built as a real circular arc: five short segments laid
     * on a radius 0.42 circle over +/-1.0 radians, each turned to the tangent
     * at its own station, fat in the middle and tapering to the ends the way
     * the fruit does. Five is the fewest that reads as a curve rather than as a
     * chevron at the distance this is seen from.
     *
     * The crescent lies in the vertical plane, which is the only orientation
     * that survives this camera: the eye sits at y ~2.7 and the item at ~1.0
     * some 30 units out, so the view is within a few degrees of level and a
     * crescent laid flat would read as a bar. It does go edge-on twice per
     * turn; the asymmetric ends are what carry it through those frames, which
     * is also why there is a dark blossom tip at one end and a stem at the
     * other rather than the old matching pair.
     *
     * Fruit is the rare one and worth more than twice a bottle, so it is bigger
     * and sits in a wider pool. Lemon yellow rather than the JUMP amber, and on
     * a mint pool it never joins that family.
     */
    const bananaGeo = (function () {
      const parts = aidPool(0.70);
      const R = 0.42, SPAN = 1.0, N = 5;
      // Centre of curvature above, so the arc hangs as a smile with the tips
      // lifted. The lowest point sits just under AID_Y.
      const yc = AID_Y - 0.10 + R;
      const pt = (a) => [R * Math.sin(a), yc - R * Math.cos(a)];
      for (let i = 0; i < N; i++) {
        const a = -SPAN + (i + 0.5) * (2 * SPAN / N);
        const p = pt(a);
        // Taper: 0.21 through the belly down to 0.155 at the ends.
        const th = 0.21 - 0.055 * Math.abs(a) / SPAN;
        // Segment length overshoots the arc step so the joints never gap, and
        // the section is turned 45 degrees about its own long axis. That is a
        // LIGHTING decision as much as a shape one: an upright box shows the
        // camera one flat vertical face, which lands in the toon ramp's dark
        // band and turned a lemon banana olive. Cornered, the two facets it
        // shows both carry normal.y = 0.7, take most of the sky hemisphere, and
        // the fruit comes back to yellow -- and a ridged section is what a
        // banana has anyway.
        parts.push(bx(0.20, th, th * 0.92, p[0], p[1], 0, 0xffe45e, Math.PI / 4, 0, a));
        // The crease along the outer edge, in a paler yellow, sitting on the
        // corner the turned section presents. At 30 units, where the whole
        // fruit is eight pixels, this pale line is the part that still reads.
        const d = th * 0.66;
        parts.push(bx(0.20, 0.075, 0.075,
          p[0] - Math.sin(a) * d, p[1] + Math.cos(a) * d, 0,
          0xfff2a8, Math.PI / 4, 0, a));
      }
      // The ends are deliberately NOT a matching pair: a dark blossom tip at
      // one end and a green stem with a stub at the other. The asymmetry is
      // what still says "banana" in the two frames per turn where the crescent
      // is edge-on to the camera and its curve has nothing to show.
      const tip = pt(SPAN), stem = pt(-SPAN);
      parts.push(bx(0.13, 0.12, 0.12, tip[0], tip[1], 0, 0x4a3418, Math.PI / 4, 0, SPAN));
      parts.push(bx(0.11, 0.13, 0.13, stem[0], stem[1] + 0.01, 0, 0x8fbf3f, Math.PI / 4, 0, -SPAN));
      parts.push(bx(0.09, 0.10, 0.09, stem[0] - 0.055, stem[1] + 0.09, 0, 0x6b4f1f));
      return merge(parts);
    })();

    // Aid stands IN the corridor on purpose -- it is collected by lane -- so it
    // is exempt from the crossing audit the same way a hazard is. See
    // api.crossings().
    // aidAudit names the KIND on every pooled item, so a tool can pull the
    // bottle and the fruit out of the live scene and photograph either one at
    // a chosen distance without a claim site happening to put it there. The
    // same contract userData.people gives the crowd and userData.treeAudit
    // gives the trees.
    const waterPool = Pool(function () {
      const o = S.outlined(waterGeo, mats.propLit, S.INK.prop);
      o.userData.notScenery = true;
      o.userData.aidAudit = 'bottle';
      return o;
    }, group);
    const bananaPool = Pool(function () {
      const o = S.outlined(bananaGeo, mats.propLit, S.INK.prop);
      o.userData.notScenery = true;
      o.userData.aidAudit = 'banana';
      return o;
    }, group);

    /**
     * The water table itself: trestle, cloth, cups, volunteers, and a sign.
     *
     * This is what says the floating bottle is aid and not another thing to
     * dodge -- one station per water point, on the shoulder outside
     * CORRIDOR_HALF, on whichever side the served lane is nearest, and built
     * with the road toward local -x so one geometry serves both sides under a
     * half-turn.
     *
     * Subway-Surfers chunky: few, large, saturated shapes. The volunteer
     * holding a cup out over the kerb is the whole story of the prop in one
     * silhouette.
     */
    const aidTableGeo = (function () {
      const parts = [];
      const CLOTH = 0x2fd39a, LINEN = 0xf6fffb;
      parts.push(bx(1.20, 0.16, 5.4, 0, 0.94, 0, LINEN));       // table top
      parts.push(bx(1.24, 0.50, 5.46, 0, 0.62, 0, CLOTH));      // skirt
      parts.push(bx(1.28, 0.12, 5.5, 0, 0.86, 0, LINEN));       // trim
      for (const z of [-2.4, 0, 2.4]) {
        parts.push(bx(0.14, 0.86, 0.14, -0.42, 0.43, z, 0x2b2f52));
        parts.push(bx(0.14, 0.86, 0.14, 0.42, 0.43, z, 0x2b2f52));
      }
      // Cups, in two rows down the table. Small, but a dozen white dots on a
      // mint cloth is the read even once the cups themselves are one pixel.
      for (let i = 0; i < 14; i++) {
        parts.push(cyl(0.10, 0.08, 0.20, 6, -0.26 + (i % 2) * 0.5, 1.12,
          -2.4 + Math.floor(i / 2) * 0.72, 0xfffdf5));
      }
      // Crates of stock under and behind the table.
      parts.push(bx(0.9, 0.7, 1.1, 0.9, 0.35, -1.6, 0x1f9f78));
      parts.push(bx(0.9, 0.7, 1.1, 0.9, 0.35, 1.9, 0x1f9f78));
      parts.push(bx(0.94, 0.14, 1.14, 0.9, 0.76, 1.9, 0x86eec0));
      // Two volunteers on the road side, the near one reaching out with a cup.
      const vol = [
        { z: -1.5, skin: 0xffc79a, reach: 1 },
        { z: 1.7, skin: 0xb87a4e, reach: 0 },
      ];
      for (const v of vol) {
        parts.push(bx(0.34, 0.66, 0.26, -0.85, 0.33, v.z, 0x2b2f52));
        parts.push(bx(0.52, 0.66, 0.34, -0.85, 0.99, v.z, CLOTH));
        parts.push(bx(0.30, 0.30, 0.28, -0.85, 1.47, v.z, v.skin));
        parts.push(bx(0.34, 0.12, 0.32, -0.85, 1.64, v.z, 0xfffdf5));
        if (v.reach) {
          parts.push(bx(0.60, 0.14, 0.14, -1.25, 1.22, v.z, v.skin, 0, 0, 0.25));
          parts.push(cyl(0.11, 0.09, 0.22, 6, -1.58, 1.34, v.z, 0xfffdf5));
        } else {
          parts.push(bx(0.14, 0.50, 0.14, -1.10, 1.10, v.z, v.skin));
        }
      }
      // The sign: a post on the road side of the table carrying a board that
      // faces back down the course. It is the only part of the prop the player
      // sees before they are level with it, so it carries the whole distance
      // read -- see aidSignTex.
      parts.push(bx(0.20, 3.4, 0.20, -1.0, 1.7, -2.9, 0x1f7f62));
      parts.push(bx(0.20, 3.4, 0.20, -1.0, 1.7, 2.9, 0x1f7f62));
      parts.push(bx(0.24, 0.24, 6.2, -1.0, 3.5, 0, 0x1f7f62));
      // A pennant above the sign: movement-free, but tall and mint, and the
      // first thing over the crowd line.
      parts.push(bx(0.14, 1.6, 0.14, -1.0, 4.4, -2.9, 0x1f7f62));
      parts.push(bx(0.10, 0.7, 1.3, -1.0, 4.9, -2.2, 0x86eec0));
      return merge(parts);
    })();

    // One texture and one material for every table -- only the mesh is per
    // instance. A word beats any icon at 90 units, and no hazard in this game
    // carries text, so the sign is unambiguous before the cups resolve at all.
    const aidSignTex = labelTexture('WATER', '#0f5c46', '#eafff8', 512, 128);
    const aidSignMat = new THREE.MeshBasicMaterial({ map: aidSignTex });
    const aidSignGeo = new THREE.PlaneGeometry(4.6, 1.15);

    const aidTablePool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(aidTableGeo, mats.prop, S.INK.prop));
      const sign = new THREE.Mesh(aidSignGeo, aidSignMat);
      // Hung under the rail and turned back down the course, canted toward the
      // road so it is square-on to a runner still 60 units away.
      sign.position.set(-1.06, 2.80, -3.06);
      sign.rotation.y = Math.PI + 0.45;
      g.add(sign);
      return g;
    }, group);

    // ---- biome set pieces -------------------------------------------------

    // The suspension tower that used to live here is now MARKS.tower, built
    // per setting from mkSuspension: the same shape in a different palette is
    // London's, New York's and Tokyo's span, and building one copy eagerly for
    // a day that draws none of them was pure waste.

    /**
     * Abutment: caps the end of the deck so the water does not just stop.
     *
     * The coping used to be one 48-wide slab at y = 0.1, which put a 0.45-high
     * step across all three lanes for ten units of road at each end of the
     * bridge. Nothing in collision.js knows it is there, so the player runs
     * through it -- and it is a lane-wide horizontal mass at hazard height,
     * which is the silhouette of a BLOCK. It is now two pieces on the
     * shoulders, clear of the corridor, and the carriageway runs unbroken
     * between them exactly as a real bridge joint does.
     */
    const ABUT_COPE = (48 / 2) - (CORRIDOR_HALF + 2.6);
    const abutGeo = merge([
      bx(46, 4.0, 9, 0, -2.0, 0, 0x6f7aa8),
      bx(ABUT_COPE, 0.7, 10, -(CORRIDOR_HALF + 2.6 + ABUT_COPE / 2), 0.1, 0, 0x8e99c6),
      bx(ABUT_COPE, 0.7, 10, (CORRIDOR_HALF + 2.6 + ABUT_COPE / 2), 0.1, 0, 0x8e99c6),
      bx(3.0, 2.6, 9.4, -13, 1.2, 0, 0x8e99c6),
      bx(3.0, 2.6, 9.4, 13, 1.2, 0, 0x8e99c6),
    ]);
    const abutPool = Pool(function () {
      return S.outlined(abutGeo, mats.prop, S.INK.scenery);
    }, group);

    /**
     * The river itself, on the left bank of the RIVERSIDE leg. It starts just
     * beyond the pooled shoulders (which reach TRACK_HALF_WIDTH + 30, so a
     * little under |x| = 34) and so the two never fight over the same ground.
     */
    const riverGeo = merge([
      part(new THREE.PlaneGeometry(94, 58), 0x2f8fc4, -60, -0.12, 0, -Math.PI / 2),
      bx(2.4, 0.34, 58, -12.6, -0.12, 0, 0xe6d9a8),
      bx(1.4, 0.5, 12, -16.5, 0.10, -14, 0x8a5a3c),
      bx(7.5, 0.5, 1.6, -20, 0.10, -19.5, 0x8a5a3c),
      bx(0.24, 1.1, 0.24, -23.5, 0.4, -19.5, 0x8a5a3c),
      bx(2.2, 0.8, 5.4, -21, 0.14, 6, 0xfff2e0),
      bx(0.32, 3.4, 0.32, -21, 1.9, 6, 0xfff2e0),
      bx(2.0, 2.4, 0.12, -20.0, 2.4, 6, 0xff4d5e),
      bx(2.2, 0.8, 5.4, -31, 0.14, 24, 0xffe45e),
      bx(0.32, 3.0, 0.32, -31, 1.7, 24, 0xfff2e0),
      bx(1.8, 2.0, 0.12, -30.1, 2.1, 24, 0x37d6ff),
    ]);
    const riverPool = Pool(function () {
      return S.outlined(riverGeo, mats.prop, S.INK.prop);
    }, group);

    /**
     * Overpass: THE WALL runs under a string of these, so the light drops.
     *
     * THE SOFFIT IS THE WHOLE SPECIFICATION. This deck spanned the road with
     * its fascia bars at y = 8.0 and its underside at 8.05, both below
     * OVERHEAD_Y -- and it had done since it was added, with the corridor
     * comment at the top of this file citing "the WALL overpass has spanned the
     * road at 8.0" as though that were a fact about the design rather than a
     * defect. It is a defect. A structure hanging over the carriageway inside
     * the height the collision model reasons about is geometry the game does
     * not know is there: the player passes through it, and it is drawn in front
     * of whatever is behind it.
     *
     * DECK_Y is the underside, and everything else is measured off it, so the
     * clearance cannot be lost again by editing one number in the middle. The
     * piers grow to meet the deck rather than the deck dropping to meet them.
     */
    const OVERPASS_SOFFIT = OVERHEAD_Y + 0.20;    // 9.20
    const overpassGeo = (function () {
      const soffit = OVERPASS_SOFFIT;
      const deckH = 1.9;
      const pierTop = soffit + deckH * 0.6;
      return merge([
        bx(3.4, pierTop, 5.0, -10.5, pierTop / 2, 0, 0x6f6580),
        bx(3.4, pierTop, 5.0, 10.5, pierTop / 2, 0, 0x6f6580),
        // Fascia first: it is the lowest thing over the road and therefore the
        // number the audit checks, so it sits exactly on the soffit line.
        bx(26, 0.5, 0.4, 0, soffit + 0.25, -3.0, 0x2b2f52),
        bx(26, 0.5, 0.4, 0, soffit + 0.25, 3.0, 0x2b2f52),
        bx(26, deckH, 6.0, 0, soffit + deckH / 2, 0, 0x8b7f9c),
        bx(27, 0.7, 6.4, 0, soffit + deckH + 0.25, 0, 0x5a4f66),
        bx(27, 1.0, 0.35, 0, soffit + deckH + 1.05, -3.2, 0xffb020),
        bx(27, 1.0, 0.35, 0, soffit + deckH + 1.05, 3.2, 0xffb020),
      ]);
    })();
    const overpassPool = Pool(function () {
      return S.outlined(overpassGeo, mats.prop, S.INK.scenery);
    }, group);

    /**
     * A FOOTBRIDGE, and it settles two things at once.
     *
     * It is the heaviest thing in the overhead layer -- the tile wires give
     * rhythm, this gives a single large mass sweeping top-to-bottom past the
     * lens, which is where the parallax actually comes from. And it is the one
     * place pedestrians can cross the road without being on it: the figures on
     * the deck are walking over the runner's head at 9.5 units, which is the
     * literal answer to "people walking across the street" with no ambiguity
     * about what is on the tarmac whatsoever.
     *
     * The clearance is the design. The soffit sits at 9.05 -- above OVERHEAD_Y,
     * a full six units above the chase camera and three above the top of the
     * highest jump -- and the stair towers stand at 8.35, more than twice
     * CORRIDOR_HALF. A gate is read at 40-90 units, at or below the camera
     * axis; this can crop the top of the frame and can never be in front of one.
     */
    const footbridgeGeo = (function () {
      const parts = [];
      const STEEL = 0x5f6a9c, DECK = 0xc9cee8, RAIL = 0xf2f4ff, TRIM = 0x37d6ff;
      const TX = K.TRACK_HALF_WIDTH + 4.6;
      const W = TX * 2 + 3.2;
      parts.push(bx(W, 0.40, 3.0, 0, 9.25, 0, DECK));
      parts.push(bx(W + 0.4, 0.26, 0.34, 0, 9.20, -1.62, STEEL));
      parts.push(bx(W + 0.4, 0.26, 0.34, 0, 9.20, 1.62, STEEL));
      // Parapets. Solid at the bottom so the walkers have legs to stand behind,
      // open above so they are not sealed into a tube.
      for (const sz of [-1, 1]) {
        parts.push(bx(W, 0.70, 0.20, 0, 9.85, sz * 1.55, TRIM));
        parts.push(bx(W, 0.16, 0.30, 0, 10.72, sz * 1.55, RAIL));
        for (let i = 0; i < 13; i++) {
          parts.push(bx(0.13, 1.10, 0.13, -W / 2 + 0.6 + i * ((W - 1.2) / 12), 10.20, sz * 1.55, RAIL));
        }
      }
      // Stair towers, with a flight of steps facing away from the road.
      for (const sx of [-1, 1]) {
        parts.push(bx(2.9, 9.4, 3.4, sx * TX, 4.70, 0, STEEL));
        parts.push(bx(3.3, 0.5, 3.8, sx * TX, 9.65, 0, TRIM));
        parts.push(bx(3.5, 0.8, 4.0, sx * TX, 0.40, 0, 0x2b2f52));
        for (let i = 0; i < 9; i++) {
          parts.push(bx(2.5, 0.24, 0.72, sx * (TX + 1.9), 0.9 + i * 0.95, -1.5 + i * 0.34, DECK));
        }
        parts.push(bx(0.7, 3.0, 0.7, sx * (TX + 3.2), 5.6, 1.4, STEEL));
      }
      // The people, which are the whole reason this is here rather than a plain
      // gantry. Static: at 9.5 units up and passed in half a second, a walk
      // cycle would cost a draw call each and never be seen.
      const coats = [0x3f6fbf, 0x2f9f72, 0xf6f2e0, 0x7a5a9a, 0x4fb0c8];
      const skins = [0xffc79a, 0xe0a173, 0xb87a4e];
      let s = 4111;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 6; i++) {
        const px = -W / 2 + 2.2 + i * ((W - 4.4) / 5) + r() * 0.6;
        const pz = -0.5 + r() * 1.0;
        const h = 1.0 + r() * 0.2;
        const coat = coats[Math.floor(r() * coats.length)];
        parts.push(bx(0.18, 0.60 * h, 0.20, px - 0.11, 9.75 + 0.30 * h, pz + 0.14, 0x2b2f52, -0.28));
        parts.push(bx(0.18, 0.60 * h, 0.20, px + 0.11, 9.75 + 0.30 * h, pz - 0.14, 0x2b2f52, 0.28));
        parts.push(bx(0.48, 0.62 * h, 0.34, px, 9.75 + 0.92 * h, pz, coat));
        parts.push(bx(0.30, 0.30, 0.28, px, 9.75 + 1.38 * h, pz, skins[Math.floor(r() * skins.length)]));
        parts.push(bx(0.32, 0.11, 0.30, px, 9.75 + 1.53 * h, pz, 0x3a2b46));
      }
      return merge(parts);
    })();
    const footbridgePool = Pool(function () {
      return S.outlined(footbridgeGeo, mats.prop, S.INK.scenery);
    }, group);

    /**
     * ============ GRANDSTAND: FINAL MILE, BOTH SHOULDERS, EVERY TILE ========
     *
     * Stepped seating packed with spectators. Built on +x and rotated a
     * half-turn for the other side rather than mirrored with a negative scale,
     * which would invert its normals.
     *
     * SEAT PITCH IS THE WHOLE ARGUMENT, and it was set four times too loose.
     * Eleven spectators over a 24-unit tile is a pitch of 2.15 units against a
     * body 0.40 wide -- five body widths of empty bench between neighbours.
     * That is not a stand at a marathon finish, it is a stand at a reserve-team
     * fixture, and it is visible in a still: on the nearest tile the front row
     * reads as separated blocks with the deck showing through between them.
     *
     * The pitch that closes it is a projection, not a taste. The stand lies
     * almost along the view, so a figure's projected width and the projected
     * gap between figures shrink at different rates -- the width is dominated
     * by the 0.40 face turned toward the camera, the gap by the pitch seen at
     * the grazing angle atan(5.85 / d):
     *
     *   d = 15   angle 21.3 deg   figure 0.475 wide   pitch x 0.364
     *   d = 24         13.7             0.455                0.237
     *   d = 60          5.6             0.421                0.097
     *
     * So a row closes when pitch x sin(angle) < figure width, which at the
     * nearest tile the player ever sees needs pitch < 1.30 and at 24 units
     * needs 1.92. Past 40 units every pitch under 2.15 is already overlapping.
     * 0.97 -- twenty-four to a tile -- closes the front row at the closest
     * approach with a body-width to spare and overlaps everywhere behind it,
     * which is what a full stand does.
     *
     * THE RANK AT THE RAIL is the FINAL MILE roadside crowd, put where it can
     * be seen. Commit 5336124 correctly found that the nine-figure crowd knots
     * from the roadside lottery stand at x 5.65 to 9.05 and the grandstands
     * that run this entire leg occupy 5.40 outward -- so every knot in the last
     * mile was inside a grandstand and 10,080 triangles of spectators had never
     * been visible. Deleting them was right. Leaving the last mile with no
     * standing crowd at all was not: there is no ground-level slot left on this
     * leg -- the barrier is at 4.60, the seating starts at 5.40 and the street
     * wall is at 12.2 -- so the crowd belongs on the strip between the barrier
     * and the first bench, which is exactly where a real finish straight puts
     * it. Seventeen standing figures a tile, on their feet, with arms up and
     * placards: the knot's people, in the only place they read.
     *
     * FAIRNESS. Local x runs outward from an object standing at
     * TRACK_HALF_WIDTH + 1.3 = 5.05. The rail rank sits at local 0.14 +/- 0.10,
     * so the nearest triangle in the whole object is an arm at 4.76 -- outside
     * the barrier's road face at 4.65, and a full unit outside CORRIDOR_HALF.
     * The wave shader can sway a body 0.085 x amplitude x excitement, at most
     * 0.13 on an arm, which still leaves it outside the barrier and 0.9 clear
     * of the corridor at the peak of an ovation.
     * Raised arms go straight up rather than leaning out, so they cannot reach
     * past the torso; the placards are centred on the body for the same reason.
     * Nothing here reaches over the carriageway at any height.
     */
    const standGeo = (function () {
      const parts = [];
      const shirts = [0xff4d5e, 0x37d6ff, 0xffe45e, 0x59d47a, 0xff9ad5, 0xffb020,
                      0xfff2e0, 0x9a7bff];
      const skins = [0xffc79a, 0xe0a173, 0xb87a4e, 0x8a5a3c];
      const signs = [0xffe45e, 0xfffdf5, 0x37d6ff, 0xff9ad5, 0xff4d5e];
      const r = lcg(7717);

      // ---- the rank at the rail ------------------------------------------
      // THE RANK AT THE RAIL is vSpectator now -- the same builder the roadside
      // knots and the finish arena use, so a person leaning on the barrier in
      // the last mile is the same animal as one at mile two. Tier READ: this
      // population's head measures 1.0 px at the median and 2.2 at the best
      // through the live chase camera, so it is all silhouette and motion.
      //
      // Raised arms go STRAIGHT UP and placards are centred on the body, which
      // is the fairness constraint this object is built against: local x runs
      // outward from 5.05 and the rank sits at 0.14, so the nearest triangle is
      // an arm at 4.76 against a barrier face at 4.65 and a CORRIDOR_HALF of
      // 3.75. vFigure hangs its arms from a 0.52 shoulder rather than splaying
      // them at 0.28, so the reach came DOWN.
      const trousers = [0x2b2f52, 0x3a4472, 0x4a3a52, 0x2f3a38, 0x5a4a3a, 0x37405e];
      const RAIL_N = 17;
      for (let i = 0; i < RAIL_N; i++) {
        const z = -TILE / 2 + 0.9 + i * ((TILE - 1.8) / (RAIL_N - 1)) + (r() - 0.5) * 0.5;
        vSpectator(parts, {
          x: 0.14 + (r() - 0.5) * 0.20, z: z,
          r: r, shirts: shirts, trousers: trousers, signs: signs,
          lo: 0.82, hi: 0.26, amp: 1.15, placard: 0.45,
          // Phase off the SEAT rather than off a counter, so neighbours are a
          // beat apart down the row instead of pumping as one object.
          phase: z * 0.53 + r() * 2.4,
        });
      }

      // ---- the seating ----------------------------------------------------
      const SEAT_N = 20;
      for (let row = 0; row < 5; row++) {
        const y = row * 0.74;
        const x = 0.9 + row * 1.10;
        parts.push(bx(1.10, 0.74, TILE, x, y + 0.37, 0, row % 2 ? 0x8e99c6 : 0x6f7aa8));
        for (let i = 0; i < SEAT_N; i++) {
          const z = -TILE / 2 + 0.85 + i * ((TILE - 1.7) / (SEAT_N - 1)) + (r() - 0.5) * 0.44;
          // Phase off the seat, not off a counter: neighbours in a row are a
          // beat apart and the rows are offset from each other, which is what
          // keeps a stand from pumping like one object.
          const ph = z * 0.42 + row * 1.7 + r() * 1.4;
          const shirt = shirts[Math.floor(r() * shirts.length)];
          const skin = skins[Math.floor(r() * skins.length)];
          // The back row is on its feet, and one in six of the rest with it.
          // A row of seated heads is a straight line, and a straight line of
          // heads is the thing that makes a stand read as upholstery. What
          // breaks it is people STANDING among the seated -- an irregular top
          // edge that survives to any distance the row itself does, because it
          // is a change in the silhouette rather than in its detail.
          const up = (i % 5) === 3;
          const lift = up ? 0.52 : 0;
          if (up) parts.push(wv(bx(0.30, 0.52, 0.24, x - 0.1, y + 0.98, z, 0x2b2f52), ph, 0.5));
          parts.push(wv(bx(0.40, 0.48, 0.28, x - 0.1, y + 0.98 + lift, z, shirt), ph));
          parts.push(wv(bx(0.22, 0.22, 0.20, x - 0.1, y + 1.33 + lift, z, skin), ph));
          // One in four with both arms over their head. At the nearest tile an
          // arm is 3.3px wide and 15px tall, at 60 units 1.3 x 6 -- and even
          // where it stops resolving as an arm it is still a lighter fringe
          // above the row, which is the part that was doing the work.
          if ((i % 5) === 1) {
            parts.push(wv(bx(0.11, 0.46, 0.11, x - 0.1, y + 1.62 + lift, z - 0.16, skin), ph, 1.6));
            parts.push(wv(bx(0.11, 0.46, 0.11, x - 0.1, y + 1.62 + lift, z + 0.16, skin), ph, 1.6));
          }
        }
      }
      for (const z of [-TILE / 2 + 1, TILE / 2 - 1]) {
        parts.push(bx(0.28, 7.2, 0.28, 0.2, 3.6, z, 0x2b2f52));
        parts.push(bx(0.14, 1.7, 2.3, 0.2, 6.4, z, z < 0 ? 0xff3b6b : 0x37d6ff));
      }
      return merge(parts);
    })();

    /**
     * ============ THE FAR STANDS ARE PEOPLE AT EVERY DISTANCE ============
     *
     * There used to be a second geometry here that redrew a stand beyond 130
     * units as five extruded BANDS in the mean of the six shirt tints -- 228
     * triangles against 1,428, eight thousand saved across twenty stands. It
     * was built to fit a 75,000-triangle ceiling that was measured under
     * SwiftShader and was never real. The working ceiling is 500,000 and the
     * heaviest frame in the game is 170k, so the saving bought nothing that
     * was needed and the band is gone.
     *
     * Its stated justification was also wrong, and the number is worth keeping
     * because the same mistake is easy to make again. "Past about a hundred
     * units a spectator is under a pixel wide" -- projected through the real
     * camera at the fov this leg actually runs (70.3, not the base 58), a
     * spectator's 0.40-unit torso is:
     *
     *     d = 24   10.1 px      d = 110   2.2 px
     *     d = 40    6.1 px      d = 130   1.9 px
     *     d = 60    4.0 px      d = 210   1.2 px
     *
     * -- 1.9 px at the swap distance, not "under a pixel", and still over a
     * pixel at the spawn edge. It is the same class of error as the 110px
     * runner this file's older comments assume: a size asserted rather than
     * projected.
     *
     * What IS true, and is the reason the swap was hard to see: the stand runs
     * nearly parallel to the view, so the 2.15-unit SEAT PITCH foreshortens far
     * faster than the body does -- 9.0 px at 24 units, 1.5 px at 60, 0.33 px at
     * 130. Along the row the crowd merges into a bar long before the individual
     * does. That is an argument for a band somewhere past 200 units, not at
     * 130, and past 200 the stands are behind three closer stands anyway: the
     * grandstands are a continuous wall down both shoulders, so beyond about
     * the fourth one only the strip either side of the vanishing point is ever
     * visible at all. There is nothing left there worth a second geometry.
     */
    const standPool = Pool(function () {
      const o = S.outlined(standGeo, mats.crowd, S.INK.scenery);
      o.userData.people = 'grandstand';
      return o;
    }, group);

    /**
     * ================== THE FINISH STAND ==================
     *
     * The chute's own grandstand, and the difference between it and the one
     * above is DEPTH, not headcount.
     *
     * The stands that run the last mile put their nearest spectator 5.4 units
     * off the centre line and five rows deep -- a low band at the edge of the
     * frame that the eye reads as texture. A finish straight does not look
     * like that. What makes one is people PRESSED AGAINST THE BARRIER, close
     * enough that individual bodies are a hand's width of screen and their
     * movement is legible: the front two rows are standing, leaning over the
     * rail, and they are the only crowd in this game that the player ever sees
     * as people rather than as a mass.
     *
     * So the weight goes to the front. Sixteen standing figures in two rows at
     * x = 0.6 and 1.5 take a third of the triangles; the six seated rows behind
     * them take the rest, every row of them drawn as people. The rear
     * wall and roof line are what let the street wall be switched off in the
     * chute (see the street pass) -- this becomes the thing the road runs
     * between, which is what a finish arena actually is.
     *
     * FAIRNESS: local x runs from 0 outward and the object stands at
     * TRACK_HALF_WIDTH + 0.55 = 4.30, so the nearest triangle is at 4.10
     * against a CORRIDOR_HALF of 3.75 and a barrier line of 4.60. The crowd is
     * BEHIND the barrier, which is both correct and the reason it can never be
     * confused with anything on the road. Nothing reaches over the corridor at
     * any height.
     */
    const FSTAND_X = K.TRACK_HALF_WIDTH + 0.55;
    function finishStandParts(seed) {
      const parts = [];
      const shirts = [0xff4d5e, 0x37d6ff, 0xffe45e, 0x59d47a, 0xff9ad5, 0xffb020,
                      0xfff2e0, 0x9a7bff];
      const skins = [0xffc79a, 0xe0a173, 0xb87a4e, 0x8a5a3c];
      const flags = [0xffe45e, 0xfffdf5, 0x37d6ff, 0xff9ad5, 0xff4d5e];
      const ftrousers = [0x2b2f52, 0x3a4472, 0x4a3a52, 0x2f3a38, 0x5a4a3a, 0x37405e];
      const r = lcg(seed);

      // ---- the front rail: the reason this object exists -----------------
      // There was a banded twin of this object for stands beyond 118 units,
      // and a chute is 150 units long, so it swapped in for the far end of the
      // finish arena. It is gone with the grandstand's -- same false ceiling,
      // same measurement error, and this one had less excuse: the finish stand
      // is the object the player is closest to in the whole game.
      {
        for (let row = 0; row < 2; row++) {
          const rx = 0.62 + row * 0.90;
          const n = 8;
          for (let i = 0; i < n; i++) {
            const z = -TILE / 2 + 1.4 + i * ((TILE - 2.8) / (n - 1)) + (r() - 0.5) * 0.7;
            // THE ONLY CROWD IN THIS GAME MEASURED AT A REAL FACE SIZE, and
            // it is still not one. tools/people.js puts the widest head in
            // these two rows at 21.4 px with a 3.92 px eye mark -- which
            // clears the threshold -- but the MEDIAN head in the population is
            // 1.9 px, and 878 head pixels a frame are shared between 183
            // visible heads. Four and a half pixels a face. The two front rows
            // could carry eyes; the other three hundred and fifty figures they
            // are merged into could not, and they are one geometry and one
            // draw. Tier READ, and the front row gets its legibility from
            // being the only rank that BRACES on the rail while everything
            // behind it jumps.
            const braced = (i + row) % 3 === 0;
            vSpectator(parts, {
              x: rx, z: z, r: r, shirts: shirts, trousers: ftrousers, signs: flags,
              lo: 0.90, hi: 0.22, amp: 1.2, placard: 0.5,
              act: braced ? 4 : undefined,
              phase: z * 0.55 + row * 2.3 + r() * 2.0,
            });
          }
        }
      }

      // ---- stepped seating behind ---------------------------------------
      for (let row = 0; row < 6; row++) {
        const y = 0.55 + row * 0.80;
        const x = 2.65 + row * 1.05;
        parts.push(bx(1.05, 0.80, TILE, x, y - 0.40, 0, row % 2 ? 0x8e99c6 : 0x6f7aa8));
        // The back three rows used to be drawn as a band on the grounds that
        // they sit behind the front rows anyway. They do not: the rows step up
        // 0.80 each and the eye is at 2.4, so from row 3 up every seat is above
        // the head of the one in front and every one of them is on screen.
        for (let i = 0; i < 9; i++) {
          const z = -TILE / 2 + 1.4 + i * 2.6 + (r() - 0.5) * 0.6;
          const ph = z * 0.44 + row * 1.6 + r() * 1.6;
          parts.push(wv(bx(0.44, 0.52, 0.30, x - 0.08, y + 0.62, z,
            shirts[Math.floor(r() * shirts.length)]), ph));
          parts.push(wv(bx(0.24, 0.24, 0.22, x - 0.08, y + 1.00, z,
            skins[Math.floor(r() * skins.length)]), ph));
        }
      }

      // ---- the back of the arena ----------------------------------------
      // This is what replaces the street wall in the chute: a solid rear
      // elevation at 9.3 with a roof fascia and pennant masts on top of it, so
      // the horizon behind the crowd is the stadium rather than a hole.
      // Held to 7.9, and lighter than the first pass. At 9.6 in a near-black
      // navy it stopped being the back of a stand and became a warehouse: two
      // slabs running the length of the frame, eating the sky the gold light
      // of this leg is carried in. It only has to reach above the top row of
      // seats, which is at 6.9.
      parts.push(bx(0.5, 7.9, TILE, 9.20, 3.95, 0, 0x565c92));
      parts.push(bx(1.6, 0.75, TILE, 8.60, 8.28, 0, 0x2b2f52));
      parts.push(bx(1.5, 0.30, TILE, 8.65, 8.80, 0, 0xff3b6b));
      for (const z of [-TILE / 2 + 3, 0, TILE / 2 - 3]) {
        parts.push(bx(0.20, 3.0, 0.20, 8.65, 10.4, z, 0x2b2f52));
        parts.push(wv(bx(0.12, 1.4, 1.8, 8.65, 11.4, z,
          flags[Math.floor(r() * flags.length)]), z * 0.7, 0.9));
      }
      return parts;
    }
    const finishStandGeo = merge(finishStandParts(4211));
    const finishStandPool = Pool(function () {
      const o = S.outlined(finishStandGeo, mats.crowd, S.INK.scenery);
      o.userData.people = 'finishstand';
      return o;
    }, group);

    /**
     * ================== THE CHUTE ==================
     *
     * One object per road tile across the last CHUTE units, carrying the three
     * things that say "this is no longer the race, this is the finish":
     *
     *   BUNTING   a sagging pennant line across the road. It is the only thing
     *             in the ending that passes CLOSE to the lens, so it sweeps
     *             top-to-bottom every 24 units and does more for the sense of
     *             closing speed than anything on the ground can. Its lowest
     *             point is 9.72, against an OVERHEAD_Y of 9.0 -- the rule the
     *             mile gantries obey, checked by api.crossings() rather than
     *             promised here.
     *
     *             THIS IS NOW THE ONLY BUNTING IN THE GAME. It used to run on
     *             every city and every park tile, fifteen pennants a span and
     *             two spans every 24 units for the whole race, and it was worth
     *             nothing there because it never stopped. The first pennants a
     *             player sees in a whole marathon are the ones over the chute,
     *             which is the only place the object ever meant anything.
     *   CARPET    the finish chute laid over the tarmac. Every road race in the
     *             world does this and it is instantly legible as an ending.
     *             It sits at y = 0.016, under Y_FLOOR, so it is road paint as
     *             far as the corridor audit is concerned -- and it is held to
     *             the last CHUTE units, which course.js keeps clear of gates by
     *             FINISH_GRACE = 190 with 40 units to spare. Nothing ever
     *             stands on it, so it cannot change the tarmac a hazard is read
     *             against. It is a DARK violet, deliberately: hazards are pink,
     *             amber and cyan, and darkening the surface can only ever
     *             increase their contrast, never reduce it.
     *   THE STRIP the pace lights, and the only part of the ending that says a
     *             number. Two scrolling dashed lines along the kerb, running
     *             at the speed of the thing being chased -- gold for the
     *             record, green for a rung still in reach, and cool and slow
     *             for a run that has settled. It is the athletics Wavelight,
     *             which is exactly the right borrow: it is what a stadium puts
     *             beside a runner in the last lap of a record attempt.
     */
    const carpetTex = (function () {
      // Near-black indigo, and the value is the point. The FINAL MILE road is
      // a light violet, so the carpet has to be a long way DOWN in value to
      // register at all -- a first pass at 0x2c2352 was invisible against it
      // in every frame. Down is also the only safe direction: darkening the
      // surface can only widen a hazard's luminance ratio against it, never
      // close it, which is the one thing the contrast gate cares about.
      const c = canvas(64, 128);
      const g = c.getContext('2d');
      g.fillStyle = '#2b2258'; g.fillRect(0, 0, 64, 128);
      // Chevrons pointing at the tape. v runs along the road, so these are the
      // only thing in the chute that has a DIRECTION, and at speed they are
      // what the eye follows to the line.
      g.strokeStyle = 'rgba(255,255,255,0.34)';
      g.lineWidth = 5;
      for (let i = 0; i < 4; i++) {
        const y = i * 32 + 6;
        g.beginPath(); g.moveTo(2, y + 13); g.lineTo(32, y); g.lineTo(62, y + 13); g.stroke();
      }
      // Kept narrow so the pace lights, which run just inboard of it, have
      // dark carpet to sit on rather than a white band to disappear into.
      g.fillStyle = 'rgba(255,255,255,0.70)';
      g.fillRect(0, 0, 3, 128); g.fillRect(61, 0, 3, 128);
      return texture(c, true);
    })();
    const stripTex = (function () {
      const c = canvas(8, 64);
      const g = c.getContext('2d');
      g.fillStyle = '#000000'; g.fillRect(0, 0, 8, 64);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 8, 26);
      return texture(c, true);
    })();
    // One material, one map, one offset: every strip in the chute shares them,
    // so the whole run of lights moves as a single travelling front and the
    // per-frame cost is one number.
    const stripMat = new THREE.MeshBasicMaterial({ map: stripTex, color: 0xffe45e });
    const carpetMat = new THREE.MeshBasicMaterial({ map: carpetTex });
    const chuteGeo = (function () {
      const parts = [];
      const BUNT = [0xff4d5e, 0xffe45e, 0x37d6ff, 0x59d47a, 0xff9ad5, 0xfff2e0];
      // Same reach as the mile gantry's legs: the bunting is strung from the
      // same line of posts the rest of the overhead layer hangs off.
      const span = K.TRACK_HALF_WIDTH + 1.2;
      // A catenary in five chords. Ends at 11.35, centre at 10.45.
      const SAG = 0.90, TOP = 11.35, N = 5;
      const at = (i) => {
        const u = (i / N) * 2 - 1;
        return [u * span, TOP - SAG * (1 - u * u)];
      };
      // ONE span per tile, not two. The road tile already carries a bunting
      // line of its own on every city leg, and a second one at half a tile's
      // spacing turned the top of a portrait frame into confetti before the
      // confetti. One line every 24 units, with pennants big enough to read as
      // pennants, says "finish" where two lines of small ones said "noise".
      const sz = 0;
      for (let i = 0; i < N; i++) {
        const a = at(i), b = at(i + 1);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        parts.push(bx(Math.hypot(dx, dy) + 0.06, 0.09, 0.09,
          (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, sz, 0x2b2f52, 0, 0, Math.atan2(dy, dx)));
      }
      // THE PENNANTS FLY AND THE LINE THEY HANG FROM DOES NOT. The catenary
      // chords above take no wave at all, so the string stays a string and only
      // the cloth on it moves -- which is the whole reason the wave is a
      // per-part attribute rather than a per-object one.
      //
      // Phase runs along the span, so the flutter travels the line from one
      // side to the other instead of every pennant snapping together. It is the
      // same travelling-front idea the wind uses across the world, at the scale
      // of a single object.
      for (let i = 0; i <= 9; i++) {
        const u = i / 9 * 2 - 1;
        const y = TOP - SAG * (1 - u * u);
        parts.push(wv(bx(0.62, 0.80, 0.05, u * span, y - 0.46, sz, BUNT[i % BUNT.length]),
          u * 2.6, 1));
      }
      return merge(parts);
    })();
    const chutePool = Pool(function () {
      const g = new THREE.Group();
      // mats.cloth, not mats.prop: the pennants carry an amplitude and the
      // posts and chords carry zero, so one material moves exactly the cloth.
      // No extra draw -- it is the same merged geometry under a different ramp.
      g.add(S.outlined(chuteGeo, mats.cloth, S.INK.banner));

      const carpet = new THREE.Mesh(
        new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, TILE), carpetMat);
      carpet.rotation.x = -Math.PI / 2;
      carpet.position.y = 0.016;
      carpet.renderOrder = 1;      // under the racing line (3) and the mats (5)
      g.add(carpet);

      // OFF THE TARMAC ALTOGETHER, on the pavement between the kerb (3.92) and
      // the barrier (4.60). A first pass ran them inside the carriageway at
      // 3.15 and it was wrong twice over: they landed on top of the road's own
      // yellow edge line and were indistinguishable from it, and course.js has
      // just filled this stretch with the hardest gates in the race, so a
      // bright moving line at the edge of the play surface is competing with
      // the one read the whole game is decided by. Out here it is trackside
      // lighting -- which is what a Wavelight is -- and it cannot be mistaken
      // for anything painted on the road.
      for (const sx of [-1, 1]) {
        const st = new THREE.Mesh(new THREE.PlaneGeometry(0.34, TILE), stripMat);
        st.rotation.x = -Math.PI / 2;
        st.position.set(sx * 4.28, 0.012, 0);
        st.renderOrder = 2;
        g.add(st);
      }
      return g;
    }, group);
    // TAGGED sRGB, and it is not optional here. texture() leaves colorSpace
    // unset, which makes three treat the canvas bytes as LINEAR and then encode
    // them on output -- everything comes back roughly a stop and a half lighter
    // than it was authored. That is harmless for the near-white mottles this
    // file's other canvases carry, and it cost an hour here: the carpet was
    // authored at #1a1338 and arrived on screen at about #5b4f82, a mid
    // lavender indistinguishable from the road it was supposed to sit on.
    // The whole point of the carpet is its VALUE, so it is decoded properly.
    carpetTex.colorSpace = THREE.SRGBColorSpace;
    stripTex.colorSpace = THREE.SRGBColorSpace;
    carpetTex.repeat.set(1, TILE / 8);
    // Two units per dash, and TILE/2 is a whole number of them, so the lights
    // run continuously from tile to tile instead of restarting at every seam.
    stripTex.repeat.set(1, TILE / 2);

    /**
     * ================== THE TAPE ==================
     *
     * The single object this whole task is about. Four boxes, two of which
     * move, and it is worth more than everything else in the ending put
     * together, because it is the only thing on the course that BREAKS.
     *
     * Built as two halves hinged on their own posts rather than as one ribbon
     * that vanishes. When the runner arrives, each half swings back and
     * outward about its post and sags: the tape ends up trailing along the
     * barrier line, which is what a broken tape does and what a photograph of
     * a marathon finish always shows. Nothing is deleted and nothing fades --
     * this renderer has no transparency to spare, and a thing that swings is
     * more legible than a thing that disappears anyway.
     *
     * IT IS EXEMPT FROM THE CORRIDOR AUDIT, and this is the only new exemption
     * in the ending. The tape crosses the carriageway at chest height, which is
     * squarely inside the band a BLOCK occupies, so api.crossings() would call
     * it a low crossing -- correctly, by the letter of the rule.
     *
     * The reason it is safe is structural rather than careful: the tape stands
     * at z = TOTAL_UNITS, the last coordinate the course has. Occlusion means
     * being BETWEEN THE LENS AND A GATE, and there is no gate beyond the finish
     * line -- there cannot be, because the race ends there. The screen half of
     * the audit already reaches that conclusion on its own (it skips any
     * scenery that is not strictly in front of a gate); only the blanket height
     * rule needs the exemption, and it needs it for exactly one object whose
     * whole purpose is to be at chest height across the road.
     */
    const TAPE_X = K.TRACK_HALF_WIDTH + 0.30;   // 4.05: outside 3.75, inside the barrier
    const TAPE_Y = 1.34;
    const tape = (function () {
      const g = new THREE.Group();
      g.userData.notScenery = true;
      g.userData.auditName = 'finish tape';

      // BRIGHT, and bright is not decoration. The posts began as the same
      // 0x2b2f52 navy the rest of the roadside furniture wears, standing on a
      // near-black carpet: at forty units they were not there at all, and the
      // player's first sight of the tape was the frame in which it broke.
      const postParts = [];
      for (const sx of [1, -1]) {
        postParts.push(bx(0.44, 0.14, 0.44, sx * TAPE_X, 0.07, 0, 0x1b1633));
        // Banded like a course marker, so it reads as a post rather than as a
        // stick, and separates from both the carpet and the barrier behind it.
        for (let i = 0; i < 4; i++) {
          postParts.push(bx(0.18, (TAPE_Y + 0.34) / 4, 0.18, sx * TAPE_X,
            (TAPE_Y + 0.34) * (i + 0.5) / 4, 0, i % 2 ? 0xfffdf5 : 0xff3b6b));
        }
      }
      // THE LIFTED RAMP, not the scenery one, and for exactly the reason
      // hazards use it (see mats.propLit). The tape is a vertical surface
      // turned square at the lens and therefore square AWAY from the key
      // light, so on the scenery floor of 0.31 it is lit almost entirely by
      // the blue bounce: authored at 0xfffdf5, it rendered as a dark maroon
      // bar on a dark carpet and was invisible in every frame taken of it.
      // This is the same class of object as a hazard -- a thing the player has
      // to read head-on, at speed, in the last second of the race.
      g.add(S.outlined(merge(postParts), mats.propLit, S.INK.banner));

      /**
       * A half, built running from its own post toward the centre line, so the
       * group's origin IS the hinge and the swing is one rotation.
       *
       * 0.44 tall rather than 0.22. A real breast tape is a banner, not a
       * ribbon, and the screen maths says the same thing: at the distance the
       * tape is first read -- forty units, three quarters of the clear run-in
       * course.js leaves -- 0.22 units is under two pixels of a portrait frame
       * and half of that is eaten by the haze. Doubling it is the difference
       * between a thing you see coming and a thing that is suddenly gone.
       */
      function halfGeo() {
        return merge([
          bx(TAPE_X, 0.44, 0.035, -TAPE_X / 2, 0, 0, 0xfffdf5),
          bx(TAPE_X, 0.13, 0.045, -TAPE_X / 2, 0.155, 0, 0xff3b6b),
          bx(TAPE_X, 0.13, 0.045, -TAPE_X / 2, -0.155, 0, 0xffe45e),
        ]);
      }
      const halves = [];
      for (const sx of [1, -1]) {
        const h = new THREE.Group();
        const m = S.outlined(halfGeo(), mats.propLit, S.INK.banner);
        if (sx < 0) m.rotation.y = Math.PI;
        h.add(m);
        h.position.set(sx * TAPE_X, TAPE_Y, 0);
        g.add(h);
        halves.push(h);
      }
      g.position.z = FINISH_Z;
      g.visible = false;
      group.add(g);

      return {
        group: g,
        halves,
        reset() {
          for (const h of halves) { h.rotation.set(0, 0, 0); h.position.y = TAPE_Y; }
          g.visible = false;
        },
        /** @param b seconds since the break, or -1 while it is still up. */
        update(z, b) {
          g.visible = z > FINISH_Z - 300;
          if (!g.visible) return;
          if (b < 0) {
            for (const h of halves) { h.rotation.set(0, 0, 0); h.position.y = TAPE_Y; }
            return;
          }
          // 1.8 seconds, not 1.1. The break is the single most important beat
          // in the ending and it is over before the camera has finished
          // arriving: at 1.1s, sampling the real game 400ms apart caught the
          // tape intact in one frame and flat against the barrier in the next,
          // with nothing in between. The ease is still cubic out, so the SNAP
          // is at the front where the eye is and the long tail is the trailing
          // ribbon settling.
          const t = Math.min(1, b / 1.8);
          const e = 1 - Math.pow(1 - t, 3);
          for (let i = 0; i < 2; i++) {
            const s = i === 0 ? 1 : -1;
            halves[i].rotation.y = s * 1.85 * e;
            halves[i].rotation.z = -s * 0.55 * e;
            // Whip up on the break, then hang.
            halves[i].position.y = TAPE_Y + Math.sin(Math.min(1, b / 0.6) * Math.PI) * 0.55
              - 0.55 * e;
          }
        },
      };
    })();

    /**
     * ================== WHAT IS BEHIND THE TAPE ==================
     *
     * The road did not stop at the finish and that was quietly the worst thing
     * about the ending. Standing on the line, the frame showed the tape a third
     * of the way up and then two hundred more units of identical carriageway
     * running away into the same bright haze it had been running into for four
     * minutes. The arch read as one more gantry with a sign on it, because
     * nothing behind it said the road was over.
     *
     * So the road is given an end: a sponsor wall and a media tribune straight
     * across it, 46 units past the line, with wings angled in to make a funnel
     * rather than a cul-de-sac. It is tall enough (11.4) to cover the horizon
     * from every part of the finish camera move, which is the point -- the
     * vanishing point goes away, and with it the sense that there is more race.
     *
     * It stands BEYOND the last coordinate of the course, so like the tape it
     * is exempt from the corridor height rule and for the same structural
     * reason: nothing the player can hit exists past z = TOTAL_UNITS, so this
     * cannot be between the lens and anything. It is not exempt from being
     * looked at, and it is only ever on screen for the last three seconds.
     */
    // Two geometries, two materials, and the split is the same one the tape
    // makes: everything here faces the lens square-on, so the STRUCTURE takes
    // the lifted hazard ramp (mats.propLit) or the whole wall goes to mud,
    // while the PEOPLE take the crowd ramp so they keep waving. Two draws for
    // the object rather than one, which at one object is not a trade worth
    // thinking about.
    const backdropParts = [];
    const backdropCrowd = [];
    (function () {
      const parts = backdropParts;
      const shirts = [0xff4d5e, 0x37d6ff, 0xffe45e, 0x59d47a, 0xff9ad5, 0xffb020];
      const r = lcg(6161);
      // The wall itself, in sponsor-board panels so it is not one slab.
      // BRIGHT panels, not navy. A dark wall closing the road reads as the
      // road having been blocked off; a bright one reads as the place you were
      // running to. It is also the last large surface the light of this leg
      // (gold, by the FINAL MILE palette pull) has to land on.
      const PANEL = [0xff3b6b, 0xffe45e, 0xfffdf5, 0x37d6ff];
      for (let i = -5; i <= 5; i++) {
        parts.push(bx(3.5, 4.6, 0.5, i * 3.6, 2.3, 0, PANEL[(i + 5) % PANEL.length]));
        parts.push(bx(3.3, 0.8, 0.6, i * 3.6, 0.6, -0.06, 0x1b1633));
        parts.push(bx(3.3, 0.5, 0.6, i * 3.6, 4.1, -0.06, 0x1b1633));
      }
      parts.push(bx(40, 0.7, 1.1, 0, 4.95, 0, 0x1b1633));
      // A tribune on top of it: the photographers' gantry, packed.
      for (let row = 0; row < 3; row++) {
        const y = 5.3 + row * 0.85;
        parts.push(bx(40, 0.85, 1.5, 0, y, row * 1.2, 0x565c92));
        for (let i = -8; i <= 8; i++) {
          const ph = i * 0.9 + row * 1.7;
          backdropCrowd.push(wv(bx(0.46, 0.56, 0.32, i * 2.3 + (r() - 0.5), y + 0.70,
            row * 1.2 - 0.4, shirts[Math.floor(r() * shirts.length)]), ph));
          backdropCrowd.push(wv(bx(0.26, 0.26, 0.24, i * 2.3, y + 1.10,
            row * 1.2 - 0.4, 0xffc79a), ph));
        }
      }
      parts.push(bx(41, 0.8, 2.4, 0, 8.35, 1.2, 0x2b2f52));
      parts.push(bx(41, 0.35, 2.2, 0, 8.95, 1.2, 0xff3b6b));
      for (let i = -6; i <= 6; i++) {
        parts.push(bx(0.18, 2.2, 0.18, i * 3.2, 10.2, 1.2, 0x2b2f52));
        backdropCrowd.push(wv(bx(0.10, 1.3, 1.6, i * 3.2, 11.4, 1.2,
          shirts[Math.floor(r() * shirts.length)]), i * 1.3, 0.9));
      }
      // Wings, angled in. Without them the wall is a garage door; with them the
      // chute funnels and the eye is carried to the tape rather than stopped
      // dead behind it.
      for (const sx of [-1, 1]) {
        parts.push(bx(26, 5.2, 0.6, sx * 26, 2.6, -12, 0x3a3f6e, 0, sx * 0.55, 0));
        parts.push(bx(26, 0.8, 0.8, sx * 26, 5.5, -12, 0x2b2f52, 0, sx * 0.55, 0));
      }
    })();
    const backdrop = (function () {
      const g = new THREE.Group();
      g.add(S.outlined(merge(backdropParts), mats.propLit, S.INK.scenery));
      g.add(S.outlined(merge(backdropCrowd), mats.crowd, S.INK.scenery));
      g.position.z = FINISH_Z + 46;
      g.userData.notScenery = true;
      g.userData.auditName = 'finish backdrop';
      g.visible = false;
      group.add(g);
      return g;
    })();

    /**
     * ================== CONFETTI ==================
     *
     * One InstancedMesh, 300 quads, one draw call and 600 triangles -- the
     * cheapest thing in the ending and the one that does the most work, because
     * it is the only element that occupies the MIDDLE of the frame. Everything
     * else the finish has (arch, stands, bunting, tape) is at the edges or
     * above; a celebration the camera has to look away from the runner to see
     * is not a celebration.
     *
     * It is also where the verdict is spent hardest. The burst is sized and
     * coloured from finale: a record fires the whole magazine in gold and white
     * from four cannons, a run that came apart gets a third of it in cooler
     * house colours. The difference is meant to be obvious at a glance and
     * without reading a number, which is the entire brief.
     *
     * Exempt from the corridor audit for the same structural reason as the
     * tape: it does not exist until the runner is ON the finish line, and there
     * is no gate beyond the finish line.
     */
    const CONFETTI_N = 300;
    const confetti = (function () {
      const geo = new THREE.PlaneGeometry(0.26, 0.15);
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
      const mesh = new THREE.InstancedMesh(geo, mat, CONFETTI_N);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.userData.notScenery = true;
      mesh.userData.auditName = 'confetti';
      mesh.renderOrder = 7;
      const col = new THREE.InstancedBufferAttribute(new Float32Array(CONFETTI_N * 3), 3);
      mesh.instanceColor = col;
      group.add(mesh);

      const px = new Float32Array(CONFETTI_N), py = new Float32Array(CONFETTI_N),
            pz = new Float32Array(CONFETTI_N);
      const vx = new Float32Array(CONFETTI_N), vy = new Float32Array(CONFETTI_N),
            vz = new Float32Array(CONFETTI_N);
      const sp = new Float32Array(CONFETTI_N);   // spin phase
      const life = new Float32Array(CONFETTI_N);
      let live = 0;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e3 = new THREE.Euler();
      const one = new THREE.Vector3(1, 1, 1);
      const p3 = new THREE.Vector3();
      const GOLD = [0xffe45e, 0xfff2c0, 0xffb020, 0xfffdf5, 0xff9ad5];
      const HOUSE = [0x37d6ff, 0xff4d5e, 0xffe45e, 0xfffdf5, 0x59d47a];

      return {
        mesh,
        reset() { live = 0; mesh.visible = false; mesh.count = 0; },
        /**
         * @param gold 0..1 -- how much of a record this was.
         * @param scale 0..1 -- how much of the magazine to fire.
         */
        fire(gold, scale) {
          const n = Math.round(CONFETTI_N * (0.34 + 0.66 * scale));
          const pal = gold > 0.5 ? GOLD : HOUSE;
          const r = lcg(9001 + Math.round(gold * 97));
          for (let i = 0; i < n; i++) {
            // Two sources, and both are needed. The cannons at the posts throw
            // ACROSS the frame, which is the part that reads as an event; the
            // overhead rain fills the air the camera pulls back through.
            const cannon = i % 3 !== 0;
            if (cannon) {
              const s = (i % 2) ? 1 : -1;
              px[i] = s * TAPE_X; py[i] = 1.5 + r() * 0.4; pz[i] = FINISH_Z + (r() - 0.5) * 2;
              vx[i] = -s * (5.5 + r() * 5.0);
              vy[i] = 7.0 + r() * 5.5;
              vz[i] = (r() - 0.5) * 6.0 - 2.0;
            } else {
              px[i] = (r() - 0.5) * 13; py[i] = 11 + r() * 5; pz[i] = FINISH_Z + (r() - 0.5) * 26;
              vx[i] = (r() - 0.5) * 2.2; vy[i] = -0.4 - r() * 1.2; vz[i] = (r() - 0.5) * 2.4;
            }
            sp[i] = r() * 6.28;
            life[i] = 0;
            _cA.set(pal[Math.floor(r() * pal.length)]);
            col.setXYZ(i, _cA.r, _cA.g, _cA.b);
          }
          col.needsUpdate = true;
          live = n;
          mesh.count = n;
          mesh.visible = true;
        },
        update(dt, camZ) {
          if (!live) return;
          let any = 0;
          for (let i = 0; i < live; i++) {
            life[i] += dt;
            // Gravity, air drag, and a lateral flutter that is what makes a
            // rectangle of card read as paper rather than as gravel.
            vy[i] -= 11.0 * dt;
            const drag = Math.pow(0.28, dt);
            vx[i] *= drag; vz[i] *= drag;
            vy[i] = Math.max(vy[i], -3.4);
            px[i] += (vx[i] + Math.sin(life[i] * 5.4 + sp[i]) * 1.5) * dt;
            py[i] += vy[i] * dt;
            pz[i] += vz[i] * dt;
            if (py[i] < 0.03) { py[i] = 0.03; vy[i] = 0; vx[i] = 0; vz[i] = 0; }
            // Anything the camera has left behind is recycled to the bottom of
            // the buffer rather than drawn: after the pull-back the far half of
            // a 300-piece burst is off the back of the lens.
            const gone = pz[i] < camZ - 6 || life[i] > 14;
            if (!gone) any++;
            e3.set(life[i] * 3.1 + sp[i], life[i] * 4.7 + sp[i] * 1.7, sp[i]);
            q.setFromEuler(e3);
            p3.set(px[i], gone ? -50 : py[i], pz[i]);
            m4.compose(p3, q, one);
            mesh.setMatrixAt(i, m4);
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (!any) { live = 0; mesh.visible = false; }
        },
      };
    })();

    // ---- landmarks --------------------------------------------------------
    /**
     * The oversized set dressing: things too big to fit in frame.
     *
     * This is the layer the reference frames have and this game did not.
     * Subway Surfers runs a giant sushi chef and a stacked burger straight
     * through the frame edge; Sonic gives you the loop and the Golden Gate to
     * aim at. What they buy is not detail, it is SPEED -- a 30-unit object
     * sweeping past the edge of the lens is the only thing in a runner that
     * conveys how fast the ground is moving, because the road itself is a
     * repeating texture and the horizon does not move at all.
     *
     * Everything here is built to one convention so a single geometry can serve
     * both sides of the road: local -x is the road, and a landmark on the far
     * side is the same mesh turned a half-turn. They stand at LANDMARK_IN or
     * beyond -- outside the corridor, outside the crowd line, outside the
     * grandstands -- and where one reaches back over the road it does so above
     * OVERHEAD_Y. Nothing here may ever be between the camera and the next gate.
     *
     * One draw each: they are merged, and scenery ink is off, so a 4,000
     * triangle clock tower costs exactly what a tree does.
     */

    /**
     * Railway viaduct, CITY START. The road runs through the arch, so it is a
     * landmark you aim at for twenty seconds and then pass under -- the single
     * most effective shape in the reference set. The arch springs at 9.5 and
     * the deck sits at 13, which is well above the overpass clearance the
     * camera has never reached.
     */
    const viaductGeo = (function () {
      const parts = [];
      const BRICK = 0xb4705a, BRICK2 = 0x8f5546, CAP = 0xd9a48a;
      for (const sx of [-1, 1]) {
        parts.push(bx(5.0, 13.0, 8.4, sx * 13.5, 6.5, 0, BRICK));
        parts.push(bx(5.6, 0.8, 9.0, sx * 13.5, 12.2, 0, BRICK2));
        parts.push(bx(5.0, 11.0, 8.4, sx * 24.0, 5.5, 0, BRICK2));
      }
      // Segmental arch over the road, in stone-sized voussoirs.
      const N = 7;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI, a1 = ((i + 1) / N) * Math.PI;
        const x0 = -11.5 * Math.cos(a0), y0 = 10.0 + 3.0 * Math.sin(a0);
        const x1 = -11.5 * Math.cos(a1), y1 = 10.0 + 3.0 * Math.sin(a1);
        parts.push(bx(Math.hypot(x1 - x0, y1 - y0) + 0.35, 1.1, 8.6,
          (x0 + x1) / 2, (y0 + y1) / 2, 0, i % 2 ? BRICK : CAP,
          0, 0, Math.atan2(y1 - y0, x1 - x0)));
      }
      parts.push(bx(62, 2.2, 8.6, 0, 14.1, 0, BRICK2));
      parts.push(bx(63, 0.9, 9.4, 0, 15.5, 0, CAP));
      for (const sz of [-1, 1]) {
        parts.push(bx(63, 1.1, 0.6, 0, 16.4, sz * 4.4, CAP));
      }
      // A train standing on it, because a bridge with nothing on it is a wall.
      const cars = [0x37d6ff, 0xf0f4ff, 0x37d6ff];
      for (let i = 0; i < 3; i++) {
        const x = -11 + i * 11;
        parts.push(bx(10.2, 2.8, 3.2, x, 18.3, 0, cars[i]));
        parts.push(bx(10.4, 0.9, 3.3, x, 19.1, 0, 0x1b3350));
        parts.push(bx(9.4, 0.4, 3.0, x, 19.9, 0, 0xd8dcf0));
      }
      return merge(parts);
    })();

    /**
     * Clock tower, CITY START and FINAL MILE. A race is a clock, so the city's
     * clock is the landmark that means something here rather than merely being
     * tall. It stands close enough to be cropped by the top and the side of the
     * frame at the same time, which is the reference framing exactly.
     */
    const clockGeo = (function () {
      const parts = [];
      const STONE = 0xe3d3b6, STONE2 = 0xc3ae8e;
      parts.push(bx(7.4, 1.2, 7.4, 0, 0.6, 0, STONE2));
      parts.push(bx(6.4, 21, 6.4, 0, 11.0, 0, STONE));
      // Window slots, on the two faces that can be seen from the road.
      for (let i = 0; i < 4; i++) {
        const y = 4.5 + i * 4.2;
        parts.push(bx(0.3, 2.6, 1.5, -3.25, y, 0, 0x4a4664));
        parts.push(bx(1.5, 2.6, 0.3, 0, y, -3.25, 0x4a4664));
      }
      parts.push(bx(7.2, 1.0, 7.2, 0, 22.0, 0, STONE2));
      parts.push(bx(5.8, 4.8, 5.8, 0, 24.8, 0, STONE));
      for (const f of [[-3.0, 0, 0.34, 3.3], [0, -3.0, 3.3, 0.34]]) {
        parts.push(bx(f[2], 3.3, f[3], f[0], 24.8, f[1], 0xfffdf5));
      }
      parts.push(bx(0.30, 1.4, 0.16, -3.2, 25.4, 0, 0x2b2f52));
      parts.push(bx(0.16, 0.30, 1.1, -3.2, 24.8, 0.4, 0x2b2f52));
      parts.push(bx(0.16, 1.4, 0.30, 0, 25.4, -3.2, 0x2b2f52));
      parts.push(bx(1.1, 0.30, 0.16, 0.4, 24.8, -3.2, 0x2b2f52));
      parts.push(bx(6.6, 0.8, 6.6, 0, 27.4, 0, STONE2));
      parts.push(cone(4.6, 6.4, 4, 0, 31.0, 0, 0x2f9f8a));
      parts.push(bx(0.30, 2.4, 0.30, 0, 35.2, 0, 0xffe45e));
      return merge(parts);
    })();

    /**
     * Quayside crane, RIVERSIDE. Built with the jib toward local +x so it
     * reaches out over the water, away from the road.
     *
     * THE CONTAINERS USED TO STAND IN THE PLAY CORRIDOR, and nothing caught it
     * for as long as they did because of WHICH DAY the harness photographs.
     *
     * This crane is a CHICAGO / RIVERSIDE mark, and tools/shoot.js runs LOW and
     * HIDES against the DEFAULT DATE only -- one course out of 365. On that day
     * Chicago falls late in the race and owns no RIVERSIDE leg, so the crane is
     * never claimed and never audited. Pointed at a day where it is:
     *
     *   node tools/shoot.js --q "bot=1&nocount=1&date=2026-09-06&skip=46"
     *
     *   ! LOW   set piece / crane crosses the corridor at y=0
     *   ! HIDES set piece / crane projects onto the JUMP in lane 0, 37.9u ahead
     *
     * WHAT WAS ACTUALLY OUT THERE, measured off the live scene rather than read
     * off this source. The mesh stands at |x| = 13 with local +x toward the
     * water, so local -x points AT THE ROAD, and the container run was authored
     * 6.4 units long in x centred at local -8:
     *
     *   local x -11.2 .. -4.8   ->   world x 1.80 .. 8.20
     *
     * CORRIDOR_HALF is 3.75. Two of the three containers therefore stood on the
     * outer lane, from road level to y = 5.5 -- taller than the 2.8 a BLOCK
     * occupies -- and hid a JUMP 38 units out. A quayside crane at |x| 13 had
     * put a solid object in the lanes.
     *
     * The paint made it worse rather than better: 0x37d6ff is h 192.3 deg, which
     * is 1.7 deg off the 194 this game contracts as DUCK cyan. A cyan slab
     * standing in a lane is not merely occlusion, it is the colour contract
     * being spent on something that is not a gate.
     *
     * THE FIX IS THE STACK'S AXIS, not its existence. Containers on a quay run
     * ALONG the quay, so they are turned to lie 6.4 deep in z and 2.7 wide in x
     * and moved onto the landward apron behind the crane's inboard leg. Inner
     * faces now land at world x 6.05 and 7.05 against a corridor of 3.75 --
     * 2.3 units of margin -- and the lowest thing this mesh still puts over the
     * corridor is the counterweight at y = 21.0, which is the counterjib doing
     * its job twelve units above OVERHEAD_Y.
     */
    const craneGeo = (function () {
      const parts = [];
      const RUST = 0xe8543f, DARK = 0x2b2f52;
      for (const sz of [-1, 1]) {
        parts.push(bx(9.6, 1.0, 1.4, 0, 0.5, sz * 3.2, DARK));
        parts.push(bx(1.0, 18, 1.0, -3.4, 9.0, sz * 3.2, RUST, 0, 0, 0.13));
        parts.push(bx(1.0, 18, 1.0, 3.4, 9.0, sz * 3.2, RUST, 0, 0, -0.13));
        parts.push(bx(9.0, 0.7, 0.7, 0, 10.0, sz * 3.2, RUST));
      }
      parts.push(bx(7.4, 3.8, 7.4, 0, 19.8, 0, RUST));
      parts.push(bx(7.8, 0.8, 7.8, 0, 22.0, 0, DARK));
      parts.push(bx(2.2, 2.2, 2.4, -3.2, 18.4, 0, 0xf0f4ff));
      parts.push(bx(24, 1.2, 1.8, 12.5, 23.4, 0, RUST, 0, 0, -0.09));
      parts.push(bx(9.0, 1.0, 1.6, -7.0, 22.6, 0, RUST));
      parts.push(bx(3.4, 2.4, 3.4, -10.5, 22.2, 0, DARK));
      parts.push(bx(0.22, 9.0, 0.22, 18.0, 17.6, 0, DARK));
      parts.push(bx(1.6, 1.2, 1.6, 18.0, 12.6, 0, 0xffe45e));
      // Containers on the quay, which is what makes it a quay. Long axis along
      // z, stacked two-and-one on the landward apron; see the note above for
      // the corridor measurement that set these x values.
      // 0x2f6ad8 is h 219 deg -- the blue a container is actually painted,
      // and 25 degrees clear of the DUCK cyan the old 0x37d6ff sat on top of.
      const box = [0x2f6ad8, 0xff9ad5, 0x59d47a];
      const CONT = [[-5.6, 1.35, -8.0], [-4.6, 1.35, -1.0], [-5.6, 4.15, -8.2]];
      for (let i = 0; i < 3; i++) {
        parts.push(bx(2.7, 2.7, 6.4, CONT[i][0], CONT[i][1], CONT[i][2], box[i]));
      }
      return merge(parts);
    })();

    /**
     * A ship. On the river in RIVERSIDE, and out on the open water under THE
     * BRIDGE, where it is the only thing that gives the drop below the deck a
     * scale. Waterline is local y = 0, so the caller sets the height from
     * whatever the water is doing at that z.
     */
    // One hull length every 10.6 seconds. Derived, and argued, at the sail
    // loop in api.update -- the short version is that the time-compressed
    // figure is 35.7 units/s and that reads as a speedboat.
    const SHIP_SPEED = 3.2;

    const shipGeo = (function () {
      const parts = [];
      const HULL = 0x1f3f6e, TOP = 0xd8552f, WHITE = 0xf0f4ff;
      parts.push(bx(9.0, 3.6, 34, 0, -1.0, 0, HULL));
      parts.push(bx(9.3, 0.6, 34, 0, 1.0, 0, TOP));
      // Bow, faked with two canted plates rather than a taper.
      parts.push(bx(6.0, 3.6, 6.0, 0, -1.0, 18.0, HULL, 0, 0.5));
      parts.push(bx(6.0, 3.6, 6.0, 0, -1.0, 18.0, HULL, 0, -0.5));
      parts.push(bx(7.6, 4.4, 7.0, 0, 3.4, -12.0, WHITE));
      parts.push(bx(7.8, 1.0, 7.2, 0, 4.6, -12.0, 0x2b3350));
      parts.push(bx(6.6, 0.6, 6.2, 0, 5.9, -12.0, TOP));
      parts.push(cyl(1.5, 1.7, 3.6, 8, 0, 7.6, -14.0, TOP));
      parts.push(cyl(1.6, 1.6, 0.8, 8, 0, 8.6, -14.0, 0x2b2f52));
      parts.push(bx(0.30, 7.0, 0.30, 0, 9.4, -8.0, WHITE));
      // THE CONTAINERS USED TO BE THE HAZARD PALETTE, LITERALLY.
      //
      // The old stack was [0x37d6ff, 0xff4d5e, 0x59d47a, 0xffe45e, 0x9a7bff]:
      // 0x37d6ff is the DUCK cyan to the digit, 0xffe45e is the JUMP amber to
      // the digit, and 0xff4d5e sits 8 degrees off the BLOCK pink. Three of
      // five boxes wore the three colours the whole game is read by, on the
      // largest object on the leg.
      //
      // It survived because the ship was MOORED, and a static thing 24 to 40
      // units off the centre line never draws the eye. Now that it is under
      // way it does, which is exactly when a hazard hue on a non-hazard costs
      // something -- and tools/motion.js failed on it the first time it ran.
      // The colour contract is what tools/shoot.js fails builds over; it is
      // worth nothing if the moving objects opt out of it.
      //
      // Replaced with a real container stack, every hue at least 18 degrees
      // clear of the nearest hazard family: oxide, forest, deep navy, slate
      // (below the saturation floor anyway) and plum. Nothing is lost -- a
      // container yard is rust and dark blue, not neon.
      const box = [0x8c4a33, 0x3f8452, 0x2f5aa8, 0x6a7080, 0x6a4a7a, 0x2b6f6a];
      for (let i = 0; i < 12; i++) {
        parts.push(bx(7.4, 2.5, 5.4, 0, 2.55 + Math.floor(i / 4) * 2.6,
          -2 + (i % 4) * 6.0, box[i % box.length]));
      }
      return merge(parts);
    })();

    /**
     * A single enormous tree, PARKLAND. The groves fill the middle distance;
     * this is the one that fills the frame. Its canopy reaches back toward the
     * road (local -x) and is cropped by the top of the lens as you pass it, but
     * it stops short of the corridor by a wide margin.
     */
    const oakGeo = (function () {
      const parts = [];
      const BARK = 0x7a5236, BARK2 = 0x6a452c;
      parts.push(cyl(2.2, 3.6, 1.6, 8, 0, 0.6, 0, BARK2));
      parts.push(cyl(1.1, 2.1, 11.0, 8, 0, 6.0, 0, BARK));
      parts.push(bx(0.9, 6.0, 0.9, -2.6, 11.0, 0, BARK, 0, 0, 0.7));
      parts.push(bx(0.8, 5.0, 0.8, 2.4, 11.6, 1.0, BARK, 0, 0, -0.6));
      // THE SAME TWO FAULTS SECTION 6 MEASURED ON `vTree`, in the biggest tree
      // in the game. The palette was a true green at R = 0.30-0.42 of G against
      // the reference's 0.75-0.78, and it was handed out by BLOB INDEX -- so the
      // lightest of the four landed on the blob at y 12.8, the second lowest in
      // the canopy, and the crown blob at 16.8 got the third. Value ran at
      // random against height, which is the exact defect on the pooled trees.
      //
      // Now it is a chartreuse ladder assigned by the blob's own height:
      // shadedL 76.9 / 89.8 / 102.5 / 132.0, darkest under the canopy and
      // lightest on top of it. Zero triangles.
      const green = canopy([0x5c8028, 0x6e9430, 0x7fa838, 0xa4d848]);
      // The inner reach is the number that matters. The furthest any blob gets
      // toward the road is centre minus radius = -10.4, and an oak is never
      // placed nearer than 15, so the canopy stops at world x = 4.6 -- outside
      // CORRIDOR_HALF with room to spare, and at that extremity it is 14 units
      // up regardless.
      const blobs = [
        [-6.0, 14.0, 0.5, 4.4], [-3.0, 15.6, -2.0, 5.2], [0.5, 16.8, 1.2, 5.6],
        [4.2, 15.2, -1.4, 4.8], [6.6, 12.8, 1.8, 4.0], [-1.0, 12.6, 3.6, 4.2],
        [1.6, 13.0, -4.2, 4.4],
      ];
      const yLo = Math.min.apply(null, blobs.map((b) => b[1]));
      const yHi = Math.max.apply(null, blobs.map((b) => b[1]));
      for (const b of blobs) {
        const t = (b[1] - yLo) / (yHi - yLo);
        parts.push(sph(b[3], 7, b[0], b[1], b[2],
          green[Math.min(green.length - 1, Math.floor((1 - t) * green.length))]));
      }
      return merge(parts);
    })();

    /**
     * A boating lake, PARKLAND. The player asked for water and RIVERSIDE was
     * the only leg that had any. Opaque, deliberately: a transparent 26x30
     * sheet is the most expensive surface this renderer could be asked to draw
     * and it would buy nothing a flat toy-blue does not already say.
     */
    const pondGeo = (function () {
      const parts = [];
      parts.push(bx(26, 0.30, 30, 0, -0.17, 0, 0x37a8d8));
      // A stone rim, so the water does not simply stop against the grass.
      for (const sz of [-1, 1]) {
        parts.push(bx(27.6, 0.34, 0.9, 0, 0.02, sz * 15.2, 0xcfc6ae));
        parts.push(bx(0.9, 0.34, 30.8, sz * 13.2, 0.02, 0, 0xcfc6ae));
      }
      // Reeds, a jetty, a rowing boat and two ducks: the props are what make a
      // blue rectangle read as a lake.
      let s = 991;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 14; i++) {
        const a = r() * 6.3, rad = 11.5 + r() * 2.4;
        parts.push(cone(0.55 + r() * 0.4, 1.5 + r() * 1.2, 5,
          // Reeds, half chartreuse and half olive. The green half was the
          // hedge's old 0x2f9f52 emerald -- the last true green in the
          // vegetation after the hedge took the ladder, and standing in the
          // one place a PARKLAND landmark puts foliage next to water.
          Math.cos(a) * rad, 0.6, Math.sin(a) * rad, r() > 0.5 ? 0x7fa838 : 0x8f9a3e));
      }
      parts.push(bx(2.0, 0.26, 7.0, -11.5, 0.35, 4.0, 0x8a5a3c));
      parts.push(bx(0.22, 0.8, 0.22, -10.7, 0.7, 7.0, 0x8a5a3c));
      parts.push(bx(0.22, 0.8, 0.22, -12.3, 0.7, 7.0, 0x8a5a3c));
      parts.push(bx(1.5, 0.5, 4.2, -6.0, 0.15, -2.0, 0xfff2e0, 0, 0.25));
      parts.push(bx(1.2, 0.2, 3.4, -6.0, 0.38, -2.0, 0xff4d5e, 0, 0.25));
      for (const d of [[3.0, 6.0], [4.4, 7.2]]) {
        parts.push(bx(0.5, 0.34, 0.8, d[0], 0.12, d[1], 0xfffdf5));
        parts.push(bx(0.3, 0.4, 0.3, d[0], 0.34, d[1] + 0.4, 0xfffdf5));
        parts.push(bx(0.2, 0.16, 0.3, d[0], 0.34, d[1] + 0.65, 0xffb020));
      }
      return merge(parts);
    })();

    /**
     * Roadside hoarding, THE WALL and CITY START. Sixteen units of billboard on
     * two legs, canted toward the road by the caller. It is the cheapest way to
     * get one enormous saturated shape into the frame edge, and on THE WALL --
     * a leg with no crowd and no colour -- it is the only bright thing there is.
     */
    const hoardingGeo = (function () {
      const parts = [];
      for (const sz of [-1, 1]) {
        parts.push(bx(1.0, 9.0, 1.0, 0.2, 4.5, sz * 5.0, 0x2b2f52));
        parts.push(bx(0.6, 0.6, 9.0, 0.2, 7.5, 0, 0x2b2f52));
      }
      parts.push(bx(0.7, 7.2, 16.4, -0.5, 11.6, 0, 0xf6f2e8));
      parts.push(bx(0.9, 0.6, 17.0, -0.5, 15.4, 0, 0x2b2f52));
      parts.push(bx(0.9, 0.6, 17.0, -0.5, 7.9, 0, 0x2b2f52));
      // Poster, in flat blocks: a disc, a bar and a wedge read as graphic
      // design at any distance and never as an object standing in the road.
      parts.push(cyl(2.8, 2.8, 0.24, 14, -0.95, 12.6, -4.2, 0xff3b6b, 0, 0, Math.PI / 2));
      parts.push(bx(0.24, 1.5, 9.6, -0.95, 9.6, 2.2, 0x2b2f52));
      parts.push(bx(0.24, 1.0, 6.4, -0.95, 11.4, 3.4, 0xffb020));
      parts.push(bx(0.24, 4.4, 4.4, -0.95, 13.6, 3.6, 0x37d6ff, Math.PI / 4));
      // Floodlights on the top rail.
      for (const z of [-5.5, 0, 5.5]) {
        parts.push(bx(0.7, 0.5, 1.4, -1.1, 16.0, z, 0xffe45e));
      }
      return merge(parts);
    })();

    /**
     * Big screen on a truss, FINAL MILE. The last mile of a real marathon is
     * lined with them, and it gives the closing leg a vertical landmark to run
     * at that the grandstands -- which are long and low -- cannot provide.
     */
    const jumboGeo = (function () {
      const parts = [];
      const DARK = 0x1b1633;
      for (const sz of [-1, 1]) {
        parts.push(bx(1.2, 13.0, 1.2, 0.6, 6.5, sz * 5.0, DARK));
        parts.push(bx(1.6, 1.0, 1.6, 0.6, 0.5, sz * 5.0, 0x2b2f52));
      }
      for (let i = 0; i < 3; i++) {
        parts.push(bx(0.5, 0.5, 10.6, 0.6, 3.0 + i * 3.6, 0, 0x2b2f52, 0.36));
      }
      parts.push(bx(1.4, 7.6, 13.4, 0, 15.4, 0, 0x2b2f52));
      parts.push(bx(0.5, 6.6, 12.4, -0.8, 15.4, 0, 0x0d1030));
      // What is on the screen: the race, in blocks. Bright, because a dark
      // rectangle at this size just reads as a hole in the sky.
      parts.push(bx(0.24, 3.4, 12.0, -1.08, 16.6, 0, 0x37d6ff));
      parts.push(bx(0.24, 2.2, 5.4, -1.10, 14.2, -3.0, 0xff4d5e));
      parts.push(bx(0.24, 1.0, 5.0, -1.10, 13.0, 3.0, 0xffe45e));
      parts.push(bx(0.24, 1.6, 1.6, -1.10, 16.9, -4.2, 0xfffdf5));
      // Speaker stacks and a pair of flags, so the truss has a base and a top.
      for (const sz of [-1, 1]) {
        parts.push(bx(2.2, 2.6, 2.2, 0.6, 11.0, sz * 7.2, DARK));
        parts.push(bx(0.24, 3.2, 0.24, 0.6, 20.8, sz * 5.0, 0x2b2f52));
        parts.push(bx(0.12, 1.3, 2.0, 0.6, 21.6, sz * 5.0 + (sz > 0 ? 1.0 : -1.0),
          sz > 0 ? 0xff3b6b : 0x37d6ff));
      }
      return merge(parts);
    })();

    const landmarkPools = {
      viaduct: Pool(function () { return S.outlined(viaductGeo, mats.prop, S.INK.scenery); }, group),
      clock: Pool(function () { return S.outlined(clockGeo, mats.prop, S.INK.scenery); }, group),
      crane: Pool(function () { return S.outlined(craneGeo, mats.prop, S.INK.scenery); }, group),
      ship: Pool(function () { return S.outlined(shipGeo, mats.prop, S.INK.scenery); }, group),
      oak: Pool(function () { return S.outlined(oakGeo, mats.prop, S.INK.scenery); }, group),
      pond: Pool(function () { return S.outlined(pondGeo, mats.prop, S.INK.scenery); }, group),
      hoarding: Pool(function () { return S.outlined(hoardingGeo, mats.prop, S.INK.scenery); }, group),
      jumbo: Pool(function () { return S.outlined(jumboGeo, mats.prop, S.INK.scenery); }, group),
    };

    // ---- mile banners ---------------------------------------------------
    // A banner is a gantry, not a floating card: legs, a truss, a lit header
    // and a stripe painted across the road so the moment of passing it is
    // marked on the ground as well as overhead.
    // A gantry straddles the road, so its legs are pinned a fixed step outside
    // the kerb rather than to a literal. Narrow the track and the banner comes
    // in with it, instead of being left standing out among the spectators.
    const GANTRY = K.TRACK_HALF_WIDTH + 1.2;
    /**
     * THE TRUSS SITS ABOVE THE CORRIDOR, and it did not used to.
     *
     * Every mile gantry crossed the carriageway with its lower chord at y=3.50
     * and its sign panel at 3.73-5.83. MR.Collision.BOX puts a BLOCK at 0-2.80
     * and the jump apex at 2.05, so the sign was hanging in and just over the
     * band the player reads hazards in -- at ?skip=190 the MILE 21 panel passes
     * straight through the runner's head, and any gate behind it is being read
     * through a lit yellow board. Scenery in front of a hazard costs a streak
     * for something outside the player's control, which in this game is the
     * record.
     *
     * So the whole truss lifts by TRUSS_LIFT, putting its lowest member 0.35
     * above OVERHEAD_Y. The legs grow to carry it; nothing else changes shape,
     * and the painted stripe on the road stays exactly where it was, because
     * that is the part that marks the moment of passing.
     *
     * It also reads better. A sign gantry at 9.5-11.8 is the same object every
     * motorway has and it sweeps top-to-bottom past the lens rather than across
     * the middle of the frame.
     *
     * ============ AND THEN IT STILL COULD NOT BE READ ============
     *
     *   "Review the mile markers. Still tough to read at the top. You should
     *    be able to clearly see that."
     *
     * Three separate defects, all of them measured on the rendered frame at
     * 420x860 rather than argued about (the R3 brief carries the harness):
     *
     * 1. THE GANTRY WAS DRAWING ITS OWN LATTICE ACROSS ITS OWN SIGN. Nine
     *    X-braces, 0.16 x 2.4 x 0.16, sat at z = 0 rotated about z -- and the
     *    sign panel was a plane at z = 0 as well. The near half of every brace
     *    was therefore IN FRONT of the text, in the same plane, z-fighting with
     *    it. Zoom into the crop in the R3 report and the zigzag is legible
     *    across MILE 19 while the numeral is not. The braces existed to make
     *    the truss look like a truss; they made the sign look like a fence.
     *    They are gone, and a header beam above the panel does that job now.
     *
     * 2. NOTHING WAS BEHIND THE PANEL BUT MORE STRUCTURE. Rays from the real
     *    camera to a 13 x 5 grid on the sign face, at the distance the sign is
     *    first read: 57% to 100% blocked, right across the race, mostly by the
     *    WALL birdcage and the tile catenary. That half is fixed at the top of
     *    this file -- the road tile no longer spans the road at all -- and the
     *    banner is now the tallest thing for a hundred units in either
     *    direction.
     *
     * 3. THE NUMERAL WAS FOUR TO EIGHT PIXELS TALL. The plate was 9.3 wide by
     *    2.1 high carrying "MILE 24" as one centred line at 0.60 em, so the cap
     *    height was 0.90 world units on a plate with 9.3 units of width and
     *    almost nothing in it. The plate grows to 2.9 and the label is re-set
     *    the way a real marathon mile marker is set: the word small and out of
     *    the way, the NUMBER as large as the plate will carry. Cap height goes
     *    0.90 -> 1.74 world units, 1.93x, for no extra triangles and no extra
     *    draw call.
     *
     * The panel also comes forward to PANEL_Z, clear of every member of the
     * frame, so no future brace can ever be coplanar with it again.
     */
    const BANNER_CHORD = OVERHEAD_Y + 0.35;      // lowest member over the road
    const TRUSS_LIFT = BANNER_CHORD - 3.50;      // 3.50 was the old chord bottom
    const PANEL_H = 2.9;                         // was 2.1
    const PANEL_Y = 5.20 + TRUSS_LIFT;           // centre; bottom 9.60, top 12.50
    const PANEL_Z = -0.62;                       // in front of every member
    const bannerFrameGeo = (function () {
      const parts = [];
      const legTop = 6.85 + TRUSS_LIFT + 0.40;
      for (const sx of [-1, 1]) {
        parts.push(bx(0.42, legTop, 0.42, sx * GANTRY, legTop / 2, 0, 0x2b2f52));
        parts.push(bx(0.90, 0.30, 0.90, sx * GANTRY, 0.15, 0, 0x1b1633));
        parts.push(bx(0.30, 0.30, 1.8, sx * GANTRY, 6.20 + TRUSS_LIFT, 0, 0x2b2f52, 0, 0, 0));
      }
      // Header above the plate and a rail under it. The truss reads as a truss
      // from its top chord and its depth, not from bracing laid over the sign.
      parts.push(bx(GANTRY * 2 + 0.4, 0.44, 0.44, 0, 6.85 + TRUSS_LIFT, 0, 0x2b2f52));
      parts.push(bx(GANTRY * 2 + 0.4, 0.26, 0.26, 0, 6.30 + TRUSS_LIFT, 0, 0x3a4570));
      parts.push(bx(GANTRY * 2 + 0.4, 0.30, 0.30, 0, 3.65 + TRUSS_LIFT, 0, 0x2b2f52));
      parts.push(part(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, 0.7), 0xfffdf5, 0, 0.011, 0, -Math.PI / 2));
      return merge(parts);
    })();

    const bannerPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(bannerFrameGeo, mats.prop, S.INK.banner));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(GANTRY * 2 - 0.6, PANEL_H), mat);
      panel.position.set(0, PANEL_Y, PANEL_Z); panel.rotation.y = Math.PI;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(GANTRY * 2 - 0.6, PANEL_H), mat);
      back.position.set(0, PANEL_Y, 0.30);
      g.add(back);
      g.userData.panel = panel;
      g.userData.back = back;
      g.userData.mat = mat;
      return g;
    }, group);

    // Start and finish get a heavier arch with a checker band.
    const checkTex = checkerTexture();
    const ARCH = K.TRACK_HALF_WIDTH + 3.0;   // heavier gantry, set further back
    // Same lift, same reason, and the same amount of it: the start and finish
    // arches crossed the road at 5.95-9.35 with the sign panel at 6.25-8.65.
    // START stands 30 units into the race with gates behind it.
    const ARCH_LIFT = BANNER_CHORD - 5.95;
    // ARCH_HEAD: the top chord used to sit at 8.7 + L, which put its underside
    // at 11.45 through a sign panel running 9.65 to 12.05 -- the same defect
    // the mile gantry's X-braces had, on the one sign in the game that says
    // FINISH. It lifts to clear the panel outright, the panel comes forward of
    // the chords, and the checker band drops below the plate instead of being
    // hidden behind it. See the mile banner's note above for the measurement.
    const ARCH_HEAD = 9.35;
    const archGeo = (function () {
      const L = ARCH_LIFT;
      const legTop = ARCH_HEAD + L + 0.70;
      return merge([
        bx(1.5, legTop, 1.5, -ARCH, legTop / 2, 0, 0xff3b6b),
        bx(1.5, legTop, 1.5, ARCH, legTop / 2, 0, 0xff3b6b),
        bx(2.3, 0.6, 2.3, -ARCH, 0.3, 0, 0x1b1633),
        bx(2.3, 0.6, 2.3, ARCH, 0.3, 0, 0x1b1633),
        bx(ARCH * 2 + 2.4, 1.3, 1.6, 0, ARCH_HEAD + L, 0, 0xff3b6b),
        bx(ARCH * 2 + 2.4, 0.5, 1.2, 0, 6.2 + L, 0, 0xd42a55),
        // The finials came down from 4.2 to 2.8 to pay for the lift. A finish
        // arch reaching 17 units would have been half again the height of
        // anything else on the course and would have cropped out of a portrait
        // frame at the distance it is first read.
        bx(0.9, 2.8, 0.9, -(ARCH - 1.2), 10.9 + L - 0.7, 0, 0x2b2f52),
        bx(0.9, 2.8, 0.9, ARCH - 1.2, 10.9 + L - 0.7, 0, 0x2b2f52),
        bx(2.6, 1.5, 0.12, -(ARCH - 2.4), 12.4 + L - 1.0, 0, 0xffe45e),
        bx(2.6, 1.5, 0.12, ARCH - 2.4, 12.4 + L - 1.0, 0, 0xffe45e),
      ]);
    })();
    const archPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(archGeo, mats.prop, S.INK.banner));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(ARCH * 2 + 0.6, 2.4), mat);
      // z = -0.90 clears the 1.6-deep top chord and the 1.2-deep lower one, so
      // the plate is unambiguously in front of the whole frame.
      panel.position.set(0, 7.45 + ARCH_LIFT, -0.90); panel.rotation.y = Math.PI;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(ARCH * 2 + 0.6, 2.4), mat);
      back.position.set(0, 7.45 + ARCH_LIFT, 0.90);
      g.add(back);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(ARCH * 2 + 0.6, 0.50), new THREE.MeshBasicMaterial({ map: checkTex }));
      // BELOW the plate now, not behind it. At 0.1 in front of the chord it was
      // 0.8 behind the sign panel and more than half of it was simply never
      // drawn. Its lower edge lands at 9.13 against an OVERHEAD_Y of 9.0, which
      // is the clearance the audit exists to keep honest.
      band.position.set(0, 9.38, -0.95); band.rotation.y = Math.PI;
      g.add(band);
      // Checker laid across the road: the line you actually cross.
      const line = new THREE.Mesh(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, 1.2),
        new THREE.MeshBasicMaterial({ map: checkTex }));
      line.rotation.x = -Math.PI / 2;
      line.position.y = 0.013;
      line.renderOrder = 4;
      g.add(line);
      g.userData.panel = panel;
      g.userData.mat = mat;
      return g;
    }, group);

    // ---------------------------------------------------------------------
    // Layout is drawn once from the seeded stream so it is identical for every
    // player, then indexed by z for windowed spawning.
    //
    // Every entry now records WHICH SETTING it belongs to. Inside a 190-unit
    // fade band that choice is dithered (settingIndexAt), so the two cities
    // interleave along the road instead of changing on a line -- the old
    // street thins out as the new one thickens. Content cannot be lerped the
    // way a colour can; dithering the placement is the closest thing to a
    // cross-fade that geometry has.
    const scenery = [];
    {
      let z = -60;
      while (z < K.TOTAL_UNITS + 120) {
        const look = lookAtZ(Math.max(0, z)).look;
        const w = PROP_KINDS.map((k) => look.mix[k] || 0);
        const total = w.reduce((a, b) => a + b, 0);
        let side = rnd.chance(0.5) ? -1 : 1;
        let kind = total > 0 ? rnd.weighted(PROP_KINDS, w) : null;
        // Anything with foundations goes on the dry side of a river leg.
        if (look.bank === side && kind !== 'crowd') side = -side;
        // A zero-weighted kind must never slip through the fallback branch of
        // weighted(); a building standing in the middle of the river is the
        // kind of thing nobody notices until a screenshot.
        if (kind && !look.mix[kind]) kind = null;
        // THE LAST MILE'S CROWD IS THE GRANDSTAND'S, and the lottery's knots
        // are buried in it. A knot stands at TRACK_HALF_WIDTH + 1.9 to + 5.3,
        // i.e. x = 5.65 to 9.05; the stands that run this whole leg occupy
        // 5.40 outward. Every one of those nine-figure knots -- 1,680
        // triangles each, and FINAL MILE draws them at the highest weight in
        // the race -- is inside a grandstand where the player cannot see it.
        // Measured at mile 25: 10,080 triangles of crowd nobody has ever seen.
        //
        // Inside the chute nothing roadside spawns at all, for the same reason
        // taken further: the finish stand is deeper still.
        //
        // THIS IS A VISIBILITY RULE, NOT A SAVING, and the distinction matters
        // because the two were originally made at the same time and only one
        // of them was right. The people are not gone -- see the rank at the
        // rail in standGeo, which puts seventeen standing figures a tile on the
        // strip between the barrier and the first bench. That is the only slot
        // left on this leg (barrier 4.60, seating from 5.40, street wall 12.2)
        // and it is where a real finish straight puts its crowd anyway.
        //
        // The rng stream is untouched -- the draw is still made and thrown
        // away -- so every other prop in the race lands exactly where it did.
        if (kind === 'crowd' && z > BI[BI.length - 1].from) kind = null;
        if (z > FINISH_Z - CHUTE) kind = null;
        const set = settingIndexAt(Math.max(0, z), rnd.next());
        if (kind) {
          scenery.push({
            z, side, kind, set,
            x: side * rnd.range(7.5, 26),
            a: rnd.next(), b: rnd.next(), c: rnd.next(),
          });
        }
        z += rnd.range(3.4, 9.5);
      }
      scenery.sort((p, q) => p.z - q.z);
    }

    // How much clear road a mile marker is owed in front of and behind it.
    // Declared here rather than beside nudgeOver() below because the structure
    // loops read it and `const` does not hoist -- see the note on the function
    // for what the two numbers are and what they were measured against.
    const MILE_SIGHT_BEFORE = 95;
    const MILE_SIGHT_AFTER = 26;

    // Set pieces: deterministic, biome-specific, and placed by hand rather
    // than rolled, because a bridge tower in the wrong place is not a bridge.
    const structures = [];
    // Far enough out that the player runs through it rather than starting
    // underneath it, which is where the camera would never see it at all.
    structures.push({ z: 30, kind: 'arch', label: 'START', sub: course.key, bg: '#1b1633', fg: '#ffe45e' });
    structures.push({ z: DECK_FROM - 5, kind: 'abut' });
    structures.push({ z: DECK_TO + 5, kind: 'abut' });

    /**
     * Place one landmark. `x` is the distance out from the centre line and is
     * always positive; `side` decides which shoulder it stands on and turns the
     * mesh a half-turn so its road-facing side (local -x, by convention above)
     * still faces the road. Nothing may be placed inside LANDMARK_IN.
     */
    // Where a landmark stands, the street opens up for it. See the street-wall
    // pass below: rows are laid AFTER the landmarks and skipped inside these
    // spans, so a Colosseum at x = 21 is not buried behind a terrace at 15.
    const markBlocks = [];
    function landmark(z, kind, side, x, y, rz, set) {
      if (Math.abs(x) < 34) markBlocks.push({ z, side });
      structures.push({
        z, kind, side, set: set || 0,
        x: side * Math.max(x, LANDMARK_IN),
        y: y || 0,
        ry: side < 0 ? Math.PI : 0,
        rz: (rz || 0) * side,
      });
    }
    // Spanning pieces are symmetric and sit on the centre line.
    function landmarkOver(z, kind, set) {
      // A spanning piece has piers on BOTH shoulders, so it clears both.
      markBlocks.push({ z, side: 0 });
      structures.push({ z, kind, set: set || 0, side: 1, x: 0, y: 0, ry: 0, rz: 0 });
    }

    /**
     * THE BRIDGE is the same structural beat in every city and a different
     * object in each: Tower Bridge in London, the Harbour Bridge's arch in
     * Sydney, a bascule in Chicago, a white harp in Valencia, a stone span in
     * Rome. This is the crossing of the two axes in one line of code -- the
     * biome decides that there IS a bridge here and where its deck runs, the
     * setting decides what it looks like.
     */
    for (let z = BRIDGE.from + 140; z < BRIDGE.to - 120; z += 235) {
      const si = setIndexAt(z);
      landmarkOver(z, SETS[si].look.bridge || 'tower', si);
    }

    for (const b of BI) {
      if (b.name === 'RIVERSIDE') {
        for (let z = b.from; z < b.to; z += 58) structures.push({ z, kind: 'river', side: -1, set: 0 });
      }
      if (b.name === 'THE WALL') {
        // nudgeOver, and it was missing here. These are the only opaque decks
        // in the game and nothing kept them off the mile gantries -- the loop
        // simply stepped 168 units and landed where it landed.
        for (let z = b.from + 90; z < b.to - 40; z += 168) {
          structures.push({ z: nudgeOver(z), kind: 'overpass', set: 0 });
        }
        // One placed by hand: you go under it and the mile 20 gantry is
        // waiting on the far side. Mile 20 is where a marathon breaks people,
        // and the course should stage it rather than merely label it.
        //
        // It stood 34 units before the gantry, which staged nothing: the deck
        // covered the sign for the whole approach and then the sign was 34
        // units away, i.e. already overhead. At MILE_SIGHT_BEFORE the deck is
        // passed with 3.6 seconds of open road and the marker standing in it,
        // which is the beat the comment above always described.
        structures.push({ z: 20 * K.UNITS_PER_MILE - MILE_SIGHT_BEFORE, kind: 'overpass', set: 0 });
      }
      if (b.name === 'FINAL MILE') {
        for (let z = b.from; z < K.TOTAL_UNITS + 30; z += TILE) {
          // Inside the chute the ordinary stand is replaced rather than
          // supplemented: two grandstands a metre apart would be a wall of
          // triangles the player never sees the back of. See finishStandParts.
          const k = z > FINISH_Z - CHUTE ? 'fstand' : 'stand';
          structures.push({ z, kind: k, side: -1, set: 0 });
          structures.push({ z, kind: k, side: 1, set: 0 });
        }
        // The chute's overhead layer and its carpet, one per road tile.
        for (let z = FINISH_Z - CHUTE; z < K.TOTAL_UNITS + TILE; z += TILE) {
          structures.push({ z, kind: 'chute', side: 1, set: 0 });
        }
      }
    }

    // Under the bridge the water is WATER_DROP below the road, so the ships sit
    // there rather than at zero -- and being able to see how far down that is,
    // on an object of known size, is the whole reason they are out there. They
    // are also the only objects on this leg: with the shoulders gone the deck
    // is a ribbon over an empty plane, and a ribbon over nothing has no speed.
    //
    // AND THEY ARE UNDER WAY. This leg had exactly one object class in it and
    // that class was moored, which is why the comment above had to argue that
    // a ribbon over nothing has no speed -- it was true, and the fix for it
    // was sitting right there. Ships are the only traffic in this game with
    // nowhere it could go wrong: they are 24 to 40 units off the centre line
    // on the far side of a parapet, over water the player cannot reach, in
    // hull blue and container colours that are not the three hazard hues.
    //
    // Heading follows SIDE, which is what a waterway does: landmark() turns a
    // piece on the -x side through pi, so those ships already point downstream
    // and the +x ones upstream. That is a navigation rule for free, and it is
    // why the two columns pass each other rather than drifting in convoy.
    for (let z = DECK_FROM + 60; z < DECK_TO - 40; z += 155) {
      const sd = (Math.round(z / 155) % 2) ? 1 : -1;
      landmark(z, 'ship', sd, 24 + (Math.round(z / 155) % 3) * 8, -0.34 - WATER_DROP, 0,
        setIndexAt(z));
    }

    // ---- landmarks --------------------------------------------------------
    /**
     * Landmarks, planned rather than typed out.
     *
     * The old version was a hand-written list of thirty calls, which was fine
     * when the course was one place. It cannot survive twelve settings times
     * six biomes, so the placement is now a walk: for each biome, for each
     * setting that overlaps it, take that setting's list for that beat and lay
     * it down the overlap. A setting with nothing to say about a beat falls
     * back to the generic set this file has always had, which is exactly what
     * "fall back gracefully rather than inventing something generic and wrong"
     * has to mean in code.
     *
     * Spacing is 145 units -- about five seconds at race pace, and far enough
     * apart that at most two are in the 210-unit spawn window at once. They are
     * the most expensive thing in the frame in fill terms and a skyline of them
     * would read as clutter rather than as landmarks.
     */
    const DEFAULT_MARKS = {
      'CITY START': [{ k: 'clock', x: 14.5 }, { k: 'hoarding', x: 13.0, rz: -0.13 }, { k: 'viaduct', over: 1 }],
      'RIVERSIDE': [{ k: 'crane', x: 13.0 }, { k: 'ship', x: 34.0, y: -0.12 }, { k: 'oak', x: 15.0 }],
      'PARKLAND': [{ k: 'oak', x: 15.0 }, { k: 'pond', x: 27.0 }],
      'THE WALL': [{ k: 'hoarding', x: 12.6, rz: -0.16 }],
      'FINAL MILE': [{ k: 'jumbo', x: 13.5 }, { k: 'clock', x: 15.5 }],
    };
    const MARK_SPACING = 145;
    // Spans already carrying a continuous structure over the road -- Chicago's
    // L -- take no footbridges: two things straddling the road at once read as
    // one confused mass, which is the same rule the old hand-placed list was
    // obeying by eye.
    const noBridgeSpans = [];

    /**
     * KEEP THE MILE MARKER'S SIGHTLINE CLEAR. This is the placement half of the
     * legibility fix and it is asymmetric, because occlusion is.
     *
     * The old rule was |z - mile| >= 32, symmetric, and it was reasoning about
     * the wrong thing: it kept two structures from reading as one confused
     * mass, which is a composition problem. The problem that made MILE 20
     * unreadable is a SIGHTLINE problem. A spanning piece anywhere between the
     * camera and a sign hides it, and the camera is always on the low-z side,
     * so a footbridge 60 units BEFORE a marker sits in front of it for the
     * entire approach while one 60 units after it is simply not in the way.
     *
     * Measured, on the shipped build: the overpass hand-placed 34 units before
     * the mile 20 gantry blocked 52 to 64 of 65 rays to the sign face at every
     * distance the sign could be read at, and the footbridge at 5250 blocked 26
     * of 65 to MILE 22. Both passed the old 32-unit test.
     *
     *   BEFORE   95 units, which at race pace is 3.6 seconds of clear approach
     *            after the piece has been passed -- long enough to read a sign
     *            and see it coming, and it is the number the mile 20 staging
     *            wanted all along ("you go under it and the gantry is waiting
     *            on the far side").
     *   AFTER    26 units, enough that the two do not read as one mass. A piece
     *            beyond the sign is never between the lens and it.
     */
    function nudgeOver(z) {
      const m = Math.round(z / K.UNITS_PER_MILE) * K.UNITS_PER_MILE;
      const d = z - m;
      if (d >= MILE_SIGHT_AFTER || d <= -MILE_SIGHT_BEFORE) return z;
      // Push to whichever side of the marker it is already nearer, so a piece
      // laid on a spacing keeps as close to its intended z as the rule allows.
      return d > (MILE_SIGHT_AFTER - MILE_SIGHT_BEFORE) / 2
        ? m + MILE_SIGHT_AFTER
        : m - MILE_SIGHT_BEFORE;
    }

    for (const b of BI) {
      // The bridge deck's landmark IS the bridge, placed above. Nothing else
      // stands out there -- there is nothing for it to stand on.
      if (b.name === 'THE BRIDGE') continue;
      for (let si = 0; si < SETS.length; si++) {
        const from = Math.max(b.from, SETS[si].from);
        const to = Math.min(b.to, SETS[si].to);
        if (to - from < 70) continue;
        const look = SETS[si].look;
        const listed = (look.marks && look.marks[b.name]) || [];
        const list = listed.length ? listed : (DEFAULT_MARKS[b.name] || []);
        const runs = list.filter((e) => e.run);
        const pts = list.filter((e) => !e.run);

        for (const e of runs) {
          let i = 0;
          if (e.over) noBridgeSpans.push([from - 30, to + 30]);
          for (let z = from; z < to; z += e.run, i++) {
            const kind = (e.alt && e.every && (i % e.every) === 0) ? e.alt : e.k;
            const zc = z + e.run / 2;
            if (e.over) landmarkOver(zc, kind, si);
            else landmark(zc, kind, e.side || -1, e.x || LANDMARK_IN, e.y, e.rz, si);
          }
        }
        if (!pts.length) continue;
        let i = 0, side = ((si & 1) ? -1 : 1);
        for (let z = from + 55; z < to - 45; z += MARK_SPACING) {
          const e = pts[i++ % pts.length];
          if (e.over) landmarkOver(nudgeOver(z), e.k, si);
          else {
            const sd = e.side || side;
            landmark(z, e.k, sd, e.x || LANDMARK_IN, e.y, e.rz, si);
            side = -side;
          }
        }
      }
    }

    /**
     * Footbridges: the heaviest thing in the overhead layer, and the one place
     * pedestrians cross the road without being on it.
     *
     * Placed on a spacing now rather than from a hand-written list, because the
     * landmarks they have to miss are no longer at fixed z. Each one is nudged
     * off the mile gantries and dropped entirely where a setting is already
     * running something continuous over the road. None on the bridge deck,
     * which has its own span; none in FINAL MILE, where the grandstands stand
     * where the stair towers would.
     */
    for (let z = 300; z < K.TOTAL_UNITS - 400; z += 330) {
      if (deckLift(z) > 0.05) continue;
      const zz = nudgeOver(z);
      if (noBridgeSpans.some((sp) => zz > sp[0] && zz < sp[1])) continue;
      landmarkOver(zz, 'footbridge', 0);
    }

    // ---- the street wall --------------------------------------------------
    /**
     * Rows on a 30-unit grid down both shoulders, thinned by the biome's own
     * `street` density so PARKLAND stays open and CITY START closes in. The
     * front face lands at 12.2, just behind the pavement the road tile carries.
     *
     * Laid LAST, and that ordering is the whole reason it works. A terrace row
     * occupies x = 12.2 to about 19, which is exactly the band the landmarks
     * stand in -- the first version put the rows down first and every setting's
     * signature silhouette ended up inside a block of flats. The street now
     * opens for a landmark and closes again behind it, which is also what a
     * real city does around its monuments.
     */
    for (const b of BI) {
      const dens = b.look.street || 0;
      if (!dens) continue;
      for (let z = b.from; z < b.to; z += STREET_LEN) {
        for (const side of [-1, 1]) {
          const take = rnd.chance(dens);
          const si = settingIndexAt(z, rnd.next());
          const v = rnd.int(0, 2);
          if (!take) continue;
          if (b.look.bank === side) continue;          // never over the water
          if (deckLift(z) > 0.15) continue;            // nor on the bridge ramp
          const cz = z + STREET_LEN / 2;
          // THE STREET STOPS AT THE CHUTE, and this is where the finish is
          // paid for. A terrace row is 3,270 triangles and there are ten live
          // at mile 25 -- 33k, the single largest line in the frame, and the
          // most expensive frame in the game. Inside the chute every one of
          // them stands BEHIND a finish stand whose rear elevation is 9.6
          // units tall and whose roof line is at 12.2, so what the row buys is
          // a strip of roof visible over the top of a wall. Switching it off
          // pays for the packed barrier crowd twice over and the horizon it
          // used to draw is now drawn by the stand. Measured: -18.6k.
          if (cz > FINISH_Z - CHUTE - 15) continue;
          if (markBlocks.some((m) => (m.side === 0 || m.side === side)
            && Math.abs(m.z - cz) < 30)) continue;
          const depth = SETS[si].look.terrace.depth;
          structures.push({
            z: cz, kind: 'street', set: si, v, side,
            x: side * (12.2 + depth / 2), y: 0,
            ry: side < 0 ? Math.PI : 0, rz: 0,
          });
        }
      }
    }

    /**
     * Water tables, derived from the aid the course generated rather than
     * placed independently -- the props and the pickups have to be telling the
     * same story.
     *
     * That story changed. course.js used to emit a table as a run of three to
     * five consecutive water items in one lane, and this loop grouped the run
     * back up into one table; aid is now ONE item per point, spaced 620 units
     * early to 220 late, about fourteen in a marathon. So a table is no longer
     * a stand serving a stretch of road -- it is a single station beside a
     * single bottle, and it is keyed straight off that bottle. There are eight
     * or nine of them in a whole race, which is about right for a marathon and
     * far enough apart that each one is an event.
     *
     * Fruit gets no prop. Every water point having a stand and every fruit
     * point having nothing is what tells the two apart before either is close
     * enough to identify by shape.
     */
    for (const a of (course.aid || [])) {
      if (a.kind !== 'water') continue;
      // The nearer shoulder to the lane being served. A centre-lane item has
      // no nearer side, so the course's own z picks one -- still identical for
      // every player, which is the only property that matters.
      const lx = K.LANE_X[a.lane];
      const side = lx > 0.05 ? 1 : lx < -0.05 ? -1 : ((Math.round(a.z) & 1) ? 1 : -1);
      structures.push({
        z: a.z, kind: 'aidTable', side,
        x: side * (K.TRACK_HALF_WIDTH + 3.4), y: 0,
        ry: side < 0 ? Math.PI : 0, rz: 0,
      });
    }

    structures.sort((p, q) => p.z - q.z);

    const banners = course.mileMarkers.map((m) => ({ m, tex: null }));

    // ---- windowed spawn bookkeeping -------------------------------------
    const state = {
      roadFrom: 0,
      gateIdx: 0,
      sceneIdx: 0,
      structIdx: 0,
      bannerIdx: 0,
      aidIdx: 0,
      biome: null,
      look: BIOME_LOOK['CITY START'],
    };

    const activeGates = [];   // { gate, objs:[] }
    const activeScene = [];   // { s, obj }
    const activeStruct = [];  // { st, obj }
    const activeBanner = [];  // { b, obj }
    const activeRoad = [];    // { z, obj }
    const activeAid = [];     // { it, obj, pool, pop }

    function hazardObject(kind) {
      if (kind === K.JUMP) return jumpPool.claim();
      if (kind === K.DUCK) return duckPool.claim();
      if (kind === K.BLOCK) return blockPool.claim();
      return null;
    }
    function releaseHazard(kind, obj) {
      if (kind === K.JUMP) jumpPool.release(obj);
      else if (kind === K.DUCK) duckPool.release(obj);
      else if (kind === K.BLOCK) blockPool.release(obj);
    }

    function sceneryPool(s) {
      const si = Math.min(SETS.length - 1, s.set || 0);
      if (s.kind === 'building') return buildingPool;
      if (s.kind === 'tree') return treePools[si];
      if (s.kind === 'grove') {
        const g = grovePools[si];
        return g[Math.floor(s.b * g.length) % g.length];
      }
      if (s.kind === 'crowd') return crowdPool[Math.floor(s.a * crowdPool.length) % crowdPool.length];
      if (s.kind === 'walkers') return walkersPool[Math.floor(s.a * walkersPool.length) % walkersPool.length];
      if (s.kind === 'crates') return cratePools[Math.floor(s.b * cratePools.length) % cratePools.length];
      if (s.kind === 'planters') {
        const pp = planterPools[si];
        return pp[Math.floor(s.b * pp.length) % pp.length];
      }
      return null;
    }

    /**
     * A pool per (setting, landmark). Built on demand and then cached, and
     * warmed at the end of create() for everything the plan actually uses --
     * merging a forty-metre lattice tower in the middle of a race would be a
     * visible hitch, and merging all twelve settings' worth up front would be
     * most of a second of start-up for geometry nine tenths of which never
     * appears.
     */
    const markPools = {};
    function markPool(st) {
      const kind = st.kind;
      const si = Math.min(SETS.length - 1, st.set || 0);
      const build = MARKS[kind];
      // Structural pieces and the generic landmarks are shared across
      // settings: a footbridge is a footbridge in every city.
      if (!build) {
        if (kind === 'abut') return abutPool;
        if (kind === 'river') return riverPool;
        if (kind === 'overpass') return overpassPool;
        if (kind === 'stand') return standPool;
        if (kind === 'fstand') return finishStandPool;
        if (kind === 'chute') return chutePool;
        if (kind === 'footbridge') return footbridgePool;
        if (kind === 'arch') return archPool;
        if (kind === 'aidTable') return aidTablePool;
        if (kind === 'street') return streetPools[si][st.v || 0];
        return landmarkPools[kind] || null;
      }
      const key = si + '/' + kind;
      let pool = markPools[key];
      if (!pool) {
        const geo = build(SETS[si].look);
        pool = Pool(function () { return S.outlined(geo, mats.prop, S.INK.scenery); }, group);
        markPools[key] = pool;
      }
      return pool;
    }
    function structPool(st) { return markPool(st); }

    // routeLane is exposed so it can be asserted against the course rather than
    // taken on trust: the lane it names at every gate must never be a BLOCK.
    const api = { group, sky, mats, course };
    Object.defineProperty(api, 'routeLane', { get: function () { return routeLane; } });

    /**
     * ================== THE PALETTE, AND ITS TWO AXES ==================
     *
     * Called every frame with the runner's progress. Two independent
     * cross-fades run here and they compose rather than compete:
     *
     *   SETTING -- where the race is. Fades over SET_FADE (190 units, ~7s)
     *              at each of the two or three boundaries the day drew.
     *   BIOME   -- what the race is doing. Fades over 0.03 of the distance at
     *              each of the six fixed structural beats.
     *
     * The order matters and it is not arbitrary. The setting blend produces a
     * BASE palette -- what this place looks like. The biome then PULLS that
     * base around (BIOME_MOD): water under a bridge deck, a purple-and-amber
     * sky at mile 20, gold into the tape. Because the pull is applied to the
     * blended base and the two pulls either side of a biome seam are then
     * blended themselves, both fades stay smooth even when a setting boundary
     * and a biome boundary land in the same fifty units -- which they do,
     * roughly one day in five, because nothing coordinates them.
     *
     * Nothing here allocates: every colour is a preallocated scratch.
     */
    api.fogColor = new THREE.Color(BIOME_LOOK['CITY START'].fog);
    const _shoulder = new THREE.Color();
    const _skyTop = new THREE.Color(), _skyBot = new THREE.Color();
    const _edge = new THREE.Color();
    const _base = {
      sky0: new THREE.Color(), sky1: new THREE.Color(), fog: new THREE.Color(),
      ground: new THREE.Color(), road: new THREE.Color(),
      water: new THREE.Color(), edge: new THREE.Color(),
    };
    const _a = new THREE.Color(), _b = new THREE.Color(), _t = new THREE.Color();

    /** Apply one biome's pulls to the blended base, into `out`. */
    function applyMod(out, key, mod) {
      out.copy(_base[key]);
      if (!mod) return out;
      if (key === 'ground' && mod.groundWater) { out.copy(_base.water); }
      const m = mod[key === 'sky0' || key === 'sky1' ? 'sky' : key];
      if (m) out.lerp(_t.set(m[0]), m[1]);
      return out;
    }

    api.applyBiome = function (f) {
      const b = MR.Course.biomeAt(f);
      const idx = MR.Course.BIOMES.indexOf(b);
      const bPrev = idx > 0 ? MR.Course.BIOMES[idx - 1] : b;
      // Cross-fade over the first 0.03 of a biome instead of popping.
      const tb = Math.min(1, (f - b.from) / 0.03);
      const mod = BIOME_MOD[b.name], modPrev = BIOME_MOD[bPrev.name];

      const z = f * K.TOTAL_UNITS;
      if (LEGACY) {
        // No settings on this course: the old per-biome palette, unchanged.
        const look = BIOME_LOOK[b.name] || BIOME_LOOK['CITY START'];
        const prev = BIOME_LOOK[bPrev.name] || look;
        _base.sky0.copy(lerpInto(_skyTop, prev.sky[0], look.sky[0], tb));
        _base.sky1.copy(lerpInto(_skyBot, prev.sky[1], look.sky[1], tb));
        _base.fog.copy(lerpInto(_t, prev.fog, look.fog, tb));
        _base.ground.copy(lerpInto(_t, prev.ground, look.ground, tb));
        _base.road.copy(lerpInto(_t, prev.road, look.road, tb));
        _base.water.set(0x2f8fc4);
        _base.edge.set(0xffffff);
        sky.material.uniforms.top.value.copy(_base.sky0);
        sky.material.uniforms.bottom.value.copy(_base.sky1);
        mats.road.color.copy(_base.road);
        mats.shoulder.color.copy(_base.ground);
        if (mats.ground) mats.ground.color.copy(_base.ground);
        mats.edge.color.set(0xffffff);
        api.fogColor.copy(_base.fog);
        hillsMat.color.copy(mats.shoulder.color).lerp(api.fogColor, 0.45);
        state.biome = b;
        state.look = look;
        return b;
      }

      // ---- 1. the setting blend, which is the base palette ----
      const si = setIndexAt(z);
      const ts = setFadeAt(z);
      const cur = SETS[si].look;
      const pre = SETS[si ? si - 1 : 0].look;
      lerpInto(_base.sky0, pre.sky[0], cur.sky[0], ts);
      lerpInto(_base.sky1, pre.sky[1], cur.sky[1], ts);
      lerpInto(_base.fog, pre.fog, cur.fog, ts);
      lerpInto(_base.ground, pre.ground, cur.ground, ts);
      lerpInto(_base.road, pre.road, cur.road, ts);
      lerpInto(_base.water, pre.water, cur.water, ts);
      lerpInto(_base.edge, pre.edge, cur.edge, ts);

      // ---- 2. the biome pull, itself blended across the biome seam ----
      sky.material.uniforms.top.value.copy(
        applyMod(_a, 'sky0', modPrev).lerp(applyMod(_b, 'sky0', mod), tb));
      sky.material.uniforms.bottom.value.copy(
        applyMod(_a, 'sky1', modPrev).lerp(applyMod(_b, 'sky1', mod), tb));
      api.fogColor.copy(applyMod(_a, 'fog', modPrev).lerp(applyMod(_b, 'fog', mod), tb));
      mats.road.color.copy(applyMod(_a, 'road', modPrev).lerp(applyMod(_b, 'road', mod), tb));
      _shoulder.copy(applyMod(_a, 'ground', modPrev).lerp(applyMod(_b, 'ground', mod), tb));
      mats.shoulder.color.copy(_shoulder);
      if (mats.ground) mats.ground.color.copy(_shoulder);
      // The roadside furniture takes the setting's tint knocked toward the
      // haze, so barriers and parapets belong to the same air as everything
      // standing behind them.
      mats.edge.color.copy(_edge.copy(_base.edge).lerp(api.fogColor, 0.10 + 0.10 * tb));

      state.biome = b;
      state.look = BIOME_LOOK[b.name] || BIOME_LOOK['CITY START'];
      state.setting = SETS[si];
      // Hills take the ground hue knocked back toward the fog, so they read as
      // the same land seen through a great deal of air.
      hillsMat.color.copy(_shoulder).lerp(api.fogColor, 0.45);
      return b;
    };

    /**
     * Advance the spawn window. `z` is the runner's distance along the course
     * in world units; the world itself does not move, the camera does.
     */
    // ---- THE FINALE, AND WHY IT READS THE RACE ---------------------------
    /**
     * One state object, recomputed a few times a second, that every part of
     * the ending hangs off: the crowd's excitement, the colour of the light
     * strip, how much confetti goes up and what colour it is, and how hard the
     * camera opens out.
     *
     * The whole argument for it is this: a finish that plays the same however
     * the run went is a cutscene, and a player learns to stop watching a
     * cutscene by the third time. What this game actually has at mile 25 is a
     * live verdict -- pace.projectClean() says where the run lands if it holds,
     * MR.Tier says which rung of the ladder that is and how far the next one
     * is -- and that verdict is the most interesting thing on the screen. So
     * the road spends it.
     *
     *   record   the record is still on. The crowd goes all the way up, the
     *            strip runs gold, the tape burst is the full one.
     *   chase    the next rung is within reach. THIS is the case the ending
     *            was missing: nine seconds off SUB-2:02 on the last straight
     *            used to look exactly like eleven minutes off it. Now the
     *            crowd lifts, the strip turns and quickens, and the closer the
     *            rung the more of both.
     *   neither  the run came apart. The stands still fill, the tape still
     *            breaks and there is still confetti, because finishing a
     *            marathon is the accomplishment and the game should say so --
     *            but it is a warm ovation, not a stadium coming down.
     *
     * It reads MR.game.pace rather than being pushed the numbers, because
     * main.js calls world.update(z, lane) and nothing else, and adding a
     * parameter would put a render concern into the game loop's signature.
     * Everything here is read-only and every access is guarded: a world built
     * without a game around it (tools/course-test.js does exactly that) simply
     * gets the neutral ending.
     */
    const finale = {
      t: 0,          // 0..1 across APPROACH -- the build
      run: 0,        // 0..1 across the last clear tarmac -- the camera's cue
      hot: 0,        // crowd excitement, smoothed
      gold: 0,       // 0 = warm ovation, 1 = the record went
      chase: 0,      // 0..1 how close the next rung is
      record: false,
      broke: -1,     // performance clock at which the tape went, -1 = intact
      since: 0,      // seconds since the tape went
      done: false,
      next: 0,       // when to re-read the verdict
      proj: 0,
    };
    let lastNow = -1;

    /**
     * WHERE THE CAMERA IS ALLOWED TO START LEAVING THE CHASE, in units before
     * the tape. It has to be far enough back that the whole finish -- an arch
     * 13.5 units wide, a tape 8.1 wide, and both grandstands -- fits a PORTRAIT
     * frame, which needs about fourteen units of pull; and it has to be short
     * enough that it never begins while the player still has a gate to read.
     *
     * So it is derived from the course rather than typed in. course.js has just
     * taken FINISH_GRACE from 190 units to 55 and put the hardest gates of the
     * race in the closing half-mile, and the number below follows that move on
     * its own: it is the real gap between the last gate and the tape, less a
     * ten-unit margin, capped at 46 (about 1.6 seconds, which is as long as a
     * pull-back can run before it stops reading as one move).
     *
     * If the run-in is ever tightened again this shortens itself, and the
     * camera flourish stays behind the last question the course asks.
     */
    const RUNOUT = (function () {
      const gs = course.gates;
      const gap = gs && gs.length ? FINISH_Z - gs[gs.length - 1].z : 190;
      return Math.max(12, Math.min(46, gap - 10));
    })();

    function readVerdict(z) {
      const P = MR.game && MR.game.pace;
      if (!P) return;
      // finishTime once it exists: after the line the verdict is a fact, not a
      // projection, and it must not keep twitching under the celebration.
      const proj = P.finished ? P.finishTime : (P.projectClean ? P.projectClean() : P.projected());
      finale.proj = proj;
      finale.record = proj <= K.RECORD_SECONDS;
      const T = MR.Tier;
      if (T && !finale.record) {
        const up = T.next(proj);
        // 40 seconds is about six clean gates of pace at this end of the
        // race -- the range in which a rung is genuinely still live.
        finale.chase = up ? 1 - Math.min(1, T.gapTo(proj, up) / 40) : 0;
      } else {
        finale.chase = finale.record ? 1 : 0;
      }
    }

    /** Drive the finale from the runner's z. Called once per frame. */
    function updateFinale(z, now, dt) {
      const t = Math.max(0, Math.min(1, (z - (FINISH_Z - APPROACH)) / APPROACH));
      finale.t = t;
      finale.run = Math.max(0, Math.min(1, (z - (FINISH_Z - RUNOUT)) / RUNOUT));
      finale.since = finale.broke < 0 ? 0 : now - finale.broke;
      if (t <= 0) {
        // Outside the ending entirely: the crowd still reacts to the runner
        // going past (that is `near` in the shader), it just is not lit up.
        finale.hot += (0 - finale.hot) * Math.min(1, dt * 2.0);
        finale.gold += (0 - finale.gold) * Math.min(1, dt * 2.0);
        finale.broke = -1;
        finale.done = false;
        crowdU.uHot.value = finale.hot;
        tape.update(z, -1);
        confetti.update(dt, z);
        backdrop.visible = false;
        return;
      }
      // Only ever in the last stretch: it is 40 units wide and would otherwise
      // be a wall sitting on the horizon for the whole race.
      backdrop.visible = z > FINISH_Z - 240;
      if (now >= finale.next) { readVerdict(z); finale.next = now + 0.25; }

      const past = z >= FINISH_Z - 0.25;
      if (past && finale.broke < 0) {
        finale.broke = now;
        // Read the verdict one last time on the line itself, so the burst is
        // sized against the finish that actually happened rather than against
        // a projection taken a quarter of a second earlier.
        readVerdict(z);
        confetti.fire(finale.record ? 1 : finale.chase,
          finale.record ? 1 : 0.32 + 0.50 * finale.chase);
        const A = MR.game && MR.game.audio;
        if (A && A.roar) A.roar(finale.record ? 1 : 0.55 + 0.35 * finale.chase);
      }
      finale.done = past;

      // The build is not linear. t^1.7 keeps the first half of the approach
      // calm so the last three seconds have somewhere to go -- a ramp that
      // starts rising immediately arrives at the tape with nothing left.
      const ramp = Math.pow(t, 1.7);
      // THE FLOOR IS HIGH ON PURPOSE. Most runs are not record runs and most
      // runs are not one rung away either -- a first pass gave the base case
      // 0.34 and the last mile of an ordinary race had a crowd that barely
      // moved, which is the fault this whole feature exists to fix. Finishing
      // is the accomplishment; the verdict is worth a quarter of the noise
      // each way, not all of it.
      const earned = 0.52 + 0.24 * finale.chase + 0.24 * (finale.record ? 1 : 0);
      let target = ramp * earned;
      if (past) {
        // The tape. Everyone gets a roar; the record gets the roof off.
        const since = now - finale.broke;
        target = (finale.record ? 1.0 : 0.72 + 0.2 * finale.chase)
          * (1 - Math.min(0.35, since * 0.045));
      }
      // Rise fast, fall slow: a crowd finds its voice quicker than it loses it.
      const rate = target > finale.hot ? 2.6 : 0.7;
      finale.hot += (target - finale.hot) * Math.min(1, dt * rate);
      const goldTgt = finale.record ? 1 : finale.chase * 0.55;
      finale.gold += (goldTgt - finale.gold) * Math.min(1, dt * 1.5);

      crowdU.uHot.value = finale.hot;

      // ---- the pace lights ----------------------------------------------
      // Gold on a record, green while a rung is still live, and a slow cool
      // white once the run has settled into the band it is going to finish in.
      // The SPEED carries as much of the message as the colour: the lights run
      // away from the runner when there is something left to chase and drift
      // when there is not, so a player nine seconds off a rung is being pulled
      // down the road by something they can see moving.
      _cA.setHex(0xdfe6ff);
      _cB.setHex(finale.record ? 0xffd23a : 0x59d47a);
      stripMat.color.copy(_cA).lerp(_cB, Math.min(1, finale.gold + finale.chase * 0.7));
      const runSpeed = 0.55 + 1.9 * Math.min(1, finale.chase + (finale.record ? 0.5 : 0));
      // Negative v is toward the finish -- the plane's uv runs against +z once
      // it is laid flat, so this is the direction that reads as pulling away.
      stripTex.offset.y = (stripTex.offset.y - dt * runSpeed) % 1;

      tape.update(z, finale.broke < 0 ? -1 : now - finale.broke);
      confetti.update(dt, z);
    }

    // Exposed so the camera and the audio can react to the same verdict the
    // road is reacting to, instead of each computing their own and drifting.
    api.finale = finale;

    api.update = function (z, playerLane) {
      if (playerLane !== undefined && playerLane !== routePlannedLane) {
        routePlannedLane = playerLane;
        // Replan from the next gate the player has not yet resolved, so the
        // line starts where they are rather than where they began.
        let gi = 0;
        while (gi < course.gates.length && course.gates[gi].z < z) gi++;
        const re = racingLine(course.gates, playerLane, gi);
        if (re) routeLane = re;
      }
      const ahead = z + VIEW;
      const back = z - BEHIND;
      const now = performance.now() * 0.001;
      const dt = lastNow < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, now - lastNow));
      lastNow = now;

      // The crowd wave, and the ending it belongs to. Two uniform writes for
      // every spectator in the world -- see vwave().
      crowdU.uT.value = now;
      crowdU.uZ.value = z;
      updateFinale(z, now, dt);

      // Keep the ground under the runner; the sky dome likewise, so the
      // gradient never slides off as the race progresses.
      const lift = deckLift(z);
      ground.position.z = z;
      ground.position.y = -0.34 - WATER_DROP * lift;
      // Displace the ground rows onto the profile. World z of row i is
      // z + GROUND_ROWS[i], and the mesh's own y is the water drop, so the row
      // carries E() alone. Course.elevationPlan() excludes the whole bridge
      // span from hill placement, so on the deck E is zero here and the river
      // stays a flat sheet rather than arching with a road that is not there.
      {
        const gp = groundGeo.attributes.position;
        const arr = gp.array;
        for (let i = 0; i < GROUND_ROWS.length; i++) {
          const y = eAt(z + GROUND_ROWS[i]);
          arr[i * 6 + 1] = y;
          arr[i * 6 + 4] = y;
        }
        gp.needsUpdate = true;
      }
      const eHere = eAt(z);
      sky.position.z = z;
      sky.position.y = eHere;
      hills.position.z = z;
      hills.position.y = eHere;
      // On the bridge there is no land to see, only water to the horizon.
      hills.visible = lift < 0.6;
      ripples.visible = lift > 0.02;
      if (ripples.visible) {
        // Water is level. The bridge is excluded from hill placement, so eAt(z)
        // is zero wherever the ripples are visible; adding it anyway keeps the
        // sheet welded to the ground plane if that exclusion is ever relaxed.
        ripples.position.set(0, ground.position.y + eAt(z) + 0.05, z);
        ripples.material.opacity = 0.9 * lift;
        // THE CURRENT, ACROSS THE ROAD. See rippleTexture() for why the axis
        // changed; this is the rate.
        //
        // The sheet is 900 units across a repeat of 26, so one texture unit is
        // 34.6 world units and the offset rate below is 1.90 units/s of water
        // moving under the deck. That is stated in the units the player can
        // check -- a 34-unit ship is moored out there to compare it against --
        // rather than as an offset constant nobody can size.
        //
        // Four times the old crawl, and the axis is doing more of the work
        // than the number: 0.485 units/s along the direction of travel was
        // 1.9% of the player's own ground speed and could not be seen at any
        // rate short of a rapid. Across the deck it competes with nothing.
        rippleTex.offset.x = (now * RIPPLE_DRIFT) % 1;
        // A second, slower crawl along the road on the far smaller axis, so
        // the sheet is not one rigid pattern sliding sideways. Same trick the
        // two cloud sheets use, and for the same reason.
        rippleTex.offset.y = (now * RIPPLE_DRIFT * 0.21) % 1;
      }

      // road
      while (state.roadFrom * TILE < ahead) {
        const tz = state.roadFrom * TILE;
        const obj = roadPool.claim();
        obj.position.z = tz;
        // THE ROAD STAYS RIGID PER TILE, and that is why hills cost it nothing.
        //
        // The tile's geometry spans local z of -TILE/2 .. +TILE/2, so setting
        // its y to the CHORD's midpoint and its pitch to the chord's angle puts
        // its far end at exactly E(tz + TILE/2) -- which is exactly where the
        // next tile's near end lands. Adjacent tiles therefore meet EXACTLY in
        // y and only the tangent kinks. At the tightest legal curvature that
        // kink is c * TILE = 5.7e-4 * 24 = 0.0137 rad = 0.8 degrees.
        //
        // Everything the tile carries -- both shoulders, the paint, the kerb
        // rail or wall, the verge line -- are its children, so they ride for
        // free. One position, one rotation, one atan, about 1.1 claims a second
        // at race pace.
        const ey0 = eAt(tz - TILE / 2), ey1 = eAt(tz + TILE / 2);
        obj.position.y = (ey0 + ey1) * 0.5;
        obj.rotation.x = -Math.atan2(ey1 - ey0, TILE);
        // One geometry per roadside kind. There used to be a second axis here,
        // the lamp alternating on the parity of the tile index; the verge line
        // is symmetric and staggers within the tile instead.
        const edge = lookAtZ(tz).look.edge;
        for (const k in obj.userData.edges) obj.userData.edges[k].visible = (k === edge);
        // On the deck the shoulders come off and the road becomes a ribbon
        // over water. Tiles are claimed 210 units out, so the swap always
        // happens well beyond anything the player can see change.
        const deck = deckLift(tz + TILE / 2) > 0.55;
        const bank = lookAtZ(tz).look.bank || 0;
        for (let i = 0; i < 2; i++) {
          const sh = obj.userData.shoulders[i];
          const sx = i === 0 ? -1 : 1;
          sh.visible = !deck;
          // Cut the shoulder back to a 9-unit verge where a river runs, so the
          // water starts at x = 13 instead of past the 34-unit shoulder edge.
          const cut = (bank === sx);
          sh.scale.x = cut ? 0.30 : 1;
          sh.position.x = sx * (cut ? 8.9 : K.TRACK_HALF_WIDTH + 15);
        }
        obj.userData.auditName = 'road tile / ' + edge;
        activeRoad.push({ z: tz, obj });
        state.roadFrom++;
      }
      while (activeRoad.length && activeRoad[0].z + TILE < back) {
        roadPool.release(activeRoad.shift().obj);
      }

      // hazards
      while (state.gateIdx < course.gates.length && course.gates[state.gateIdx].z < ahead) {
        // The gate's INDEX, kept, because the casting is by index into the
        // course and not by anything about this moment of play.
        const gi = state.gateIdx;
        const gate = course.gates[state.gateIdx++];
        if (!gateCast) gateCast = castGates(course.gates, course.key);
        const objs = [];
        for (let l = 0; l < 3; l++) {
          const kind = gate.lanes[l];
          if (kind === K.CLEAR) { objs.push(null); continue; }
          const o = hazardObject(kind);
          // Claim site 2: hazards. The hazard's y is the LOCAL road surface --
          // its geometry is authored from y = 0 and collision.js measures every
          // clearance from that same zero, so this lift is purely where it is
          // drawn. It pitches with the road as well, or a 2.8-unit block on a
          // 4% grade would stand with one edge 10 cm off the tarmac.
          o.position.set(K.LANE_X[l], eAt(gate.z), gate.z);
          o.rotation.x = -Math.atan(EL.slope(gate.z));
          // Pick the skin. Pooled, so EVERY variant's visibility is written on
          // every claim -- a hazard inheriting the previous tenant's body is
          // the kind of defect that only shows up in one screenshot in twenty,
          // and on a hazard it costs the record rather than the screenshot.
          const vs = o.userData.variants;
          // Read, not drawn. The bag was dealt for the whole course before the
          // gun; see castGates.
          const vi = gateCast[gi][l];
          for (let k = 0; k < vs.length; k++) vs[k].visible = (k === vi);
          o.userData.active = vs[vi];
          o.userData.body = vs[vi].userData.body;
          let span = 1;
          if (kind === K.BLOCK) {
            // Stretch a train forward along z rather than repeating blocks, so
            // its NEAR face and the telegraph mat stay put on the gate line
            // whatever the span. The offset is halfZ and not the literal 0.65
            // it used to be: that literal was the old BLOCK half-depth, it was
            // never updated when the envelope was renegotiated to 1.95, and it
            // had been quietly anchoring every train 1.30 units too far back.
            span = gate.train ? 1 + gate.train * 0.9 : 1;
            o.userData.body.scale.z = span;
            o.userData.body.position.z = (span - 1) * MR.Collision.BOX[K.BLOCK].halfZ;
          }
          // The contact shadow is not written here any more. It is one pooled
          // quad per live hazard, sized from this same userData.foot and this
          // same span inside updateShadows() -- which reads userData.active,
          // set four lines up. See the header there for why there is now one
          // shadow system rather than two.
          objs.push(o);
        }
        activeGates.push({ gate, objs });
      }
      while (activeGates.length && activeGates[0].gate.z < back) {
        const g = activeGates.shift();
        for (let l = 0; l < 3; l++) if (g.objs[l]) releaseHazard(g.gate.lanes[l], g.objs[l]);
      }

      // roadside props
      while (state.sceneIdx < scenery.length && scenery[state.sceneIdx].z < ahead) {
        const s = scenery[state.sceneIdx++];
        const pool = sceneryPool(s);
        if (!pool) continue;
        const obj = pool.claim();
        if (s.kind === 'building') {
          // The blocks set back behind the street wall. Their tint and their
          // window style are the SETTING's: Chicago's are black glass, Rome's
          // are ochre with punched openings, and that difference is carried by
          // two lines rather than by two pools.
          const tw = SETS[Math.min(SETS.length - 1, s.set || 0)].look.tower;
          const w = 5 + s.a * 10, h = 7 + s.b * 26, d = 5 + s.c * 8;
          obj.userData.body.scale.set(w, h, d);
          obj.userData.line.scale.set(w, h, d);
          const tint = tw.colors[Math.floor(s.a * tw.colors.length) % tw.colors.length];
          obj.userData.mat.color.set(tint);
          obj.userData.capMat.color.set(tint);
          const tex = obj.userData.tex[tw.glass ? 1 : 0];
          obj.userData.mat.map = tex;
          obj.userData.mat.needsUpdate = true;
          // Windows keep a constant world size whatever the box is scaled to.
          tex.repeat.set(Math.max(1, Math.round(w / 4.5)), Math.max(1, Math.round(h / 4.5)));
          obj.userData.parapet.scale.set(w + 0.7, 0.6 + s.c * 0.8, d + 0.7);
          obj.userData.parapet.position.y = h / 2 + 0.3;
          obj.position.set(s.x + s.side * 13, h / 2, s.z);
        } else if (s.kind === 'tree') {
          // The corridor rule, at the one place it was being broken.
          //
          // Trees roll x over [7.5, 26], which clears CORRIDOR_HALF easily on
          // its own -- but the crown is then scaled by up to 1.45, and the
          // scale is applied AFTER the position is chosen. A large roll at the
          // near end of that range reaches back over the carriageway: measured
          // at z 4356, mile 18.3, a crown crossing the corridor at y = 7.74
          // against an OVERHEAD_Y of 9.0. It reproduces on skips 159-166 and
          // the default shot set has never sampled that stretch, so shoot.js
          // has been able to catch this since the corridor rule was written and
          // simply never looked there.
          //
          // Standing it off by its own scaled reach fixes the class rather than
          // the instance: a new tree, a wider crown, or a changed scale range
          // cannot reintroduce it.
          const sc = 0.7 + s.a * 0.75;
          obj.scale.setScalar(sc);
          const si = Math.min(SETS.length - 1, s.set || 0);
          // WIND_REACH is part of the reach, not a decoration on top of it.
          // The standoff above exists because a scaled crown reached back over
          // the carriageway; a crown that also LEANS reaches further still, and
          // at the 1.45 scale cap the sway alone is 0.32 units against the 0.15
          // of slack this line used to carry. Adding it inside the scale keeps
          // the fix at the level of the class, which is what the note above
          // says the standoff is for.
          const minX = CORRIDOR_HALF + (treeReach[si] + WIND_REACH) * sc + 0.15;
          obj.position.set(Math.sign(s.x || 1) * Math.max(Math.abs(s.x), minX), 0, s.z);
          obj.rotation.y = s.b * 6.3;
        } else if (s.kind === 'grove') {
          obj.position.set(s.x + s.side * 10, 0, s.z);
          obj.rotation.y = s.a * 6.3;
        } else if (s.kind === 'crates' || s.kind === 'planters') {
          /**
           * KERBSIDE FURNITURE, AND IT STANDS AS CLOSE IN AS THE RULE ALLOWS.
           *
           * The reference puts these hard against the kerb, so unlike the
           * trees -- which roll x over [7.5, 26] and are only pushed out when
           * that roll lands too close -- these are placed AT the stand-off and
           * then jittered outward. The band is the one the lamp standard names:
           * outside CORRIDOR_HALF (3.75), inboard of POLE_X (5.40), which lands
           * them just beyond the kerb at 3.92 exactly as the frames show.
           *
           * THE REACH IS THE CIRCUMSCRIBED RADIUS, NOT THE BOX HALF-EXTENT,
           * and that is the whole reason this line is not "CORRIDOR_HALF + 0.6".
           * Both of these are turned through a random yaw two lines down. A
           * crate offset in BOTH x and z swings out to hypot(x, z) at some
           * angle, and a bounding-box half-extent never sees it -- which is
           * exactly how a PARKLAND crown got to x 3.61 against a CORRIDOR_HALF
           * of 3.75 while measuring as compliant. See treeReach.
           *
           * 0.12 of slack on top, matching the trees' 0.15, so a crate's ink
           * shell -- which extrudes slightly outside the mesh -- cannot be the
           * thing that crosses the line.
           */
          const si2 = Math.min(SETS.length - 1, s.set || 0);
          const reach = s.kind === 'crates'
            ? crateReach[Math.floor(s.b * crateReach.length) % crateReach.length]
            : planterReach[si2];
          const minX = CORRIDOR_HALF + reach + 0.12;
          obj.position.set(s.side * (minX + s.c * 1.15), 0, s.z);
          obj.rotation.y = s.a * 6.3;
        } else if (s.kind === 'walkers') {
          // Turned to face across the road, which is what makes the lateral
          // drift read as walking rather than as sliding.
          const bxx = s.side * (WALK_IN + s.b * 3.6);
          const dir = s.c > 0.5 ? 1 : -1;
          obj.position.set(bxx, 0, s.z);
          // side * dir is the world direction the clamped drift actually moves
          // them in; facing anywhere else turns a walk into a slide.
          obj.rotation.y = s.side * dir * Math.PI / 2;
          obj.userData.baseX = bxx;
          obj.userData.side = s.side;
          obj.userData.dir = dir;
          obj.userData.phase = s.a * 6.3;
          obj.userData.t0 = now;
        } else {
          // Crowd packs against the barrier line; the far side of a wide road
          // is where a real course puts the overflow.
          //
          // 1.9 became 2.25 TO PAY FOR THE WAVE. The knots stand off by their
          // own inward reach, and that reach was measured on the rest pose --
          // but vwave() displaces a body up to 0.085*exc laterally, which at
          // the exc cap and the amplitudes baked into a knot is 0.30 units
          // inboard. Measured on the live page at skip 140, a knot's swept box
          // reached x 3.70 against a CORRIDOR_HALF of 3.75. Nothing caught it
          // for as long as the wave has existed, because the corridor rule
          // only ever tested things whose bounding box MOVED and a crowd's
          // never does; see the shader-mover note in tools/motion.js.
          obj.position.set(s.side * (K.TRACK_HALF_WIDTH + 2.25 + s.b * 3.4), 0, s.z);
          obj.rotation.y = s.side > 0 ? Math.PI : 0;
          // A pooled knot inherits the last tenant's lift, and the lift is now
          // the shader's. Zero it on claim rather than leaving a knot standing
          // 13cm in the air for the rest of the race.
          obj.position.y = 0;
        }
        // Claim site 3: roadside props. Every branch above has already written
        // its own y (a building's is half its height, a crowd knot's is zero),
        // so the lift is added rather than assigned -- one line for all five
        // kinds instead of five that can drift apart. They do NOT pitch:
        // buildings and trees stand vertical on a hillside, and the kerb and
        // barrier that must follow the road are children of the road tile.
        obj.position.y += eAt(s.z);
        obj.userData.baseY = obj.position.y;
        obj.userData.auditName = 'prop / ' + s.kind;
        activeScene.push({ s, obj, pool });
      }
      while (activeScene.length && activeScene[0].s.z < back) {
        const e = activeScene.shift();
        e.pool.release(e.obj);
      }

      // ---- aid ----------------------------------------------------------
      // Spawned on the same windowed cursor as everything else; the pop is
      // driven from here rather than plumbed in from main.js, because the rule
      // that decides it is one line and duplicating it is cheaper than a new
      // callback the renderer would have to be trusted to fire.
      while (state.aidIdx < aidItems.length && aidItems[state.aidIdx].z < ahead) {
        const it = aidItems[state.aidIdx++];
        const pool = it.kind === 'banana' ? bananaPool : waterPool;
        const obj = pool.claim();
        // Claim site 4: aid. Same rule as a hazard -- resolveAid matches on
        // lane alone, so this is drawing only.
        const aidY = eAt(it.z);
        obj.position.set(K.LANE_X[it.lane], aidY, it.z);
        obj.scale.setScalar(1);
        activeAid.push({ it, obj, pool, pop: -1, y0: aidY });
      }
      for (let i = activeAid.length - 1; i >= 0; i--) {
        const e = activeAid[i];
        if (e.pop < 0) {
          // Lane match only -- exactly what player.js resolves on, so the pop
          // can never disagree with the streak the player was just granted.
          // The 6-unit gate is what stops an item popping long after the fact
          // when a ?skip= jump spawns one that is already behind the runner.
          if (playerLane !== undefined && e.it.lane === playerLane
            && e.it.z <= z && z - e.it.z < 6) {
            e.pop = now;
          } else if (e.it.z < z - AID_BEHIND) {
            e.pool.release(e.obj);
            activeAid.splice(i, 1);
            continue;
          } else {
            // The turn, and it now carries more than it used to: aid arrives
            // alone rather than in runs of five, so a solo item has none of the
            // presence a row had and the spin is most of what distinguishes it
            // from the static world. A little quicker than the old 1.5 for the
            // same reason -- fast enough to be seen turning in the second or so
            // it is on screen, slow enough not to read as a spinning trap.
            // Phase still comes off the item's own z, which keeps two items in
            // sight of each other out of step and costs nothing.
            e.obj.rotation.y = now * 2.0 + e.it.z * 0.9;
          }
        }
        if (e.pop >= 0) {
          const t = (now - e.pop) / AID_POP_TIME;
          if (t >= 1) {
            e.pool.release(e.obj);
            activeAid.splice(i, 1);
            continue;
          }
          // Punch out, then away. Scale and lift only: a fade would need a
          // material per item, and transparent surfaces are the one thing this
          // renderer genuinely cannot spare.
          //
          // It climbs, and climbs fast. Collection happens at the runner's own
          // z with the camera four units behind, so the pop goes off almost at
          // the lens: a burst that swelled in place would sit across the road
          // the player is reading. Lifting it out of the road read in the first
          // tenth is what makes it a flourish instead of a blindfold -- and the
          // swell is kept to 1.35, which is noticed rather than looked at.
          const s = (1 + 0.55 * Math.sin(Math.PI * t)) * (1 - t * t);
          e.obj.scale.setScalar(Math.max(0.001, s));
          e.obj.position.y = e.y0 + 3.4 * Math.sqrt(t);
          e.obj.rotation.y += 0.3;
        }
      }

      // biome set pieces
      while (state.structIdx < structures.length && structures[state.structIdx].z < ahead) {
        const st = structures[state.structIdx++];
        const pool = structPool(st);
        if (!pool) continue;
        const obj = pool.claim();
        // Pooled, so every transform a set piece can carry has to be written
        // on every claim -- a landmark inheriting the previous tenant's cant is
        // the kind of thing that only shows up in one screenshot in twenty.
        obj.position.set(st.x || 0, st.y || 0, st.z);
        obj.rotation.set(0, st.ry || 0, st.rz || 0);
        if (st.kind === 'stand') {
          obj.position.x = st.side * (K.TRACK_HALF_WIDTH + 1.3);
          obj.rotation.y = st.side < 0 ? Math.PI : 0;
        }
        if (st.kind === 'fstand') {
          obj.position.x = st.side * FSTAND_X;
          obj.rotation.y = st.side < 0 ? Math.PI : 0;
        }
        if (st.kind === 'arch' && obj.userData.mat) {
          if (!st.tex) st.tex = labelTexture(st.label, st.bg, st.fg, 768, 128, st.sub);
          obj.userData.mat.map = st.tex;
          obj.userData.mat.needsUpdate = true;
        }
        // Claim site 5: biome set pieces. Written last, after the per-kind
        // overrides above, so none of them can quietly drop it.
        //
        // AND THEY PITCH, which props do not. The reason is the corridor rule:
        // a structure spanning z and placed flat against the road height at its
        // centre loses clearance at its uphill end, and the footbridge's soffit
        // sits at 9.05 against an OVERHEAD_Y of 9.00 -- five centimetres of
        // margin that a 4% grade eats over its own 1.8-unit half-span. Pitching
        // with the local slope holds the clearance to within a millimetre
        // (the residual is curvature * halfspan^2 / 2) and costs a 2.3-degree
        // lean on a lamp standard, which is under anything the eye resolves.
        // Buildings and trees stay plumb because nothing hangs off them.
        obj.position.y += eAt(st.z);
        obj.rotation.x = -Math.atan(EL.slope(st.z));
        // A pooled hull must never inherit the last one's voyage. Cleared here
        // rather than in the sail loop, because that loop only ever sees
        // objects that are already claimed and could not tell a fresh claim
        // from a continuing one.
        if (st.kind === 'ship') obj.userData.sailT0 = undefined;
        obj.userData.auditName = 'set piece / ' + st.kind;
        activeStruct.push({ st, obj, pool });
      }
      while (activeStruct.length && activeStruct[0].st.z < back - 60) {
        const e = activeStruct.shift();
        e.pool.release(e.obj);
      }

      /**
       * ================== SHIPS UNDER WAY ==================
       *
       * The only traffic in this game, and the only place traffic can go: see
       * the refusal recorded on TRAFFIC_REFUSED. They are out over water on
       * the far side of a parapet, which is why this is the one moving class
       * that needs no fairness argument at all -- there is no arrangement of
       * the camera that puts a ship between the lens and a gate.
       *
       * SPEED, and it is the question the brief said to answer with a number.
       *
       * TIME_SCALE runs the race at 30x, so "realistic" has two readings and
       * they disagree by a factor of 25. A container ship does 8 m/s; one
       * world unit is 42195/6292.5 = 6.71 m, so 8 m/s is 1.19 units per RACE
       * second, which the compression turns into 35.7 units per WALL second --
       * faster than the player, crossing the whole 210-unit view in six
       * seconds. That is the arithmetically correct answer and it is the wrong
       * one, because the eye does not judge a vessel's speed against the
       * observer, it judges it in BODY LENGTHS PER SECOND. This hull is 34
       * units long. At 35.7 units/s it covers its own length in under a
       * second, which is a speedboat; a real ship of that length covers its
       * own length in about twenty-five.
       *
       * So the compressed figure is refused and the perceptual one taken:
       * 3.2 units/s is one hull length every 10.6 seconds. It reads as under
       * way rather than moored, it is comfortably slower than the player so
       * every ship is overtaken (which is what you see from a bridge), and the
       * two headings close on each other at 6.4 units/s so a passing pair is
       * legible inside the eleven seconds a ship is on screen.
       *
       * Heading comes off the object's own ry rather than a stored field, so
       * both placement paths get it: the deck loop below DECK_FROM, and the
       * RIVERSIDE entries in the setting table, which go through the landmark
       * plan and never touch that loop.
       *
       * DRIFT IS BOUNDED BY CONSTRUCTION. A ship is claimed 210 units ahead
       * and released 94 behind, so it lives for about 304 units of player
       * travel, i.e. 11.7 s at race pace, i.e. at most 37 units of drift from
       * its anchor. The release test keys off the ANCHOR, so a ship sailing
       * with the player is still 57 units behind the lens when it goes, and
       * one sailing against is 131. Neither can pop on screen.
       */
      for (const e of activeStruct) {
        if (e.st.kind !== 'ship') continue;
        const d = e.obj.userData;
        if (d.sailT0 === undefined) {
          d.sailT0 = now;
          d.sailZ0 = e.obj.position.z;
          // ry is 0 or pi. Bow is at local +z, so pi means sailing toward -z.
          d.sailDir = Math.cos(e.st.ry || 0) >= 0 ? 1 : -1;
        }
        e.obj.position.z = d.sailZ0 + (now - d.sailT0) * SHIP_SPEED * d.sailDir;
        // A long hull rolls slowly and pitches almost not at all. 0.9 degrees
        // at a twelve-second period is under what the eye reads as motion on
        // its own -- it is there so the silhouette against the water is never
        // quite the same twice, which is what stops a moving object still
        // reading as a decal.
        e.obj.rotation.z = Math.sin(now * 0.52 + d.sailZ0 * 0.11) * 0.016;
      }

      // mile banners
      while (state.bannerIdx < banners.length && banners[state.bannerIdx].m.z < ahead) {
        const b = banners[state.bannerIdx++];
        const finish = b.m.finish;
        const wall = b.m.mile === 20;
        if (!b.tex) {
          b.tex = finish
            ? labelTexture('FINISH', '#ff3b6b', '#fffdf5', 768, 128)
            : wall
              ? mileTexture('MILE', '20', '#7a1030', '#ff9ab0', 'THE WALL')
              : mileTexture('MILE', String(b.m.mile), '#1b1633', '#ffe45e');
        }
        const pool = finish ? archPool : bannerPool;
        const obj = pool.claim();
        // Claim site 6: mile banners and the finish arch. The arch is on flat
        // ground by construction -- no hill is placed within EDGE_PAD of the
        // tape -- but it rides the same rule as everything else rather than
        // depending on that.
        obj.position.set(0, eAt(b.m.z), b.m.z);
        obj.rotation.x = -Math.atan(EL.slope(b.m.z));   // see claim site 5
        obj.userData.mat.map = b.tex;
        obj.userData.mat.color.set(0xffffff);
        obj.userData.mat.needsUpdate = true;
        obj.userData.auditName = finish ? 'finish arch' : 'mile banner ' + b.m.mile;
        activeBanner.push({ b, obj, pool });
      }
      while (activeBanner.length && activeBanner[0].b.m.z < back) {
        const e = activeBanner.shift();
        e.pool.release(e.obj);
      }

      // Crowd idle used to live here as a whole-knot bob. It is now per figure
      // and on the GPU -- see vwave() -- so this loop only has the walkers
      // left in it, and nine spectators no longer rise and fall as one object.
      for (const e of activeScene) {
        if (e.s.kind === 'walkers') {
          // Pavement life, and the reason it moves ACROSS rather than along.
          // Lateral motion is far more visible at a glance than forward motion
          // at a speed the runner is already beating, and "people crossing"
          // is what the city is meant to be doing. The clamp is the safety
          // rule made structural: they can never reach the barrier line,
          // whatever the drift does, so a decorative figure can never be
          // mistaken for a hazard in a lane.
          const b = e.obj.userData;
          const d = Math.min(11, (now - b.t0) * 0.85) * b.dir;
          e.obj.position.x = b.side * Math.max(WALK_IN, Math.abs(b.baseX) + d);
          // baseY carries the claim's elevation lift; the bob is on top of it.
          e.obj.position.y = (b.baseY || 0) + Math.abs(Math.sin(now * 3.2 + b.phase)) * 0.075;
        }
      }

      // Hazard variants that move. Only the live ones, only the ones that asked
      // for it, and only ever a rotation on a single child -- a hazard's
      // POSITION is course data and nothing here is allowed to touch it.
      for (const g of activeGates) {
        for (let l = 0; l < 3; l++) {
          const o = g.objs[l];
          if (!o) continue;
          const a = o.userData.active;
          if (!a || !a.userData.anim) continue;
          const ph = g.gate.z * 0.7 + l;
          const kind = a.userData.anim;
          const mv = a.userData.moving;
          if (kind === 'pedal') {
            // A cadence, not a wheel spin: about 1.2 turns a second is what a
            // rider holding up traffic looks like. Slowed from 1.6 now that the
            // knees rise past the box line rather than turning behind it -- at
            // the old rate the pair strobed instead of reading as legs, and a
            // motion you cannot follow is the same as no motion.
            mv.rotation.x = now * 7.6 + ph;
            // 0.008, NOT 0.030. This line moved the WHOLE VARIANT GROUP -- the
            // bicycle, its wheels and its contact shadow -- 0.030 up and down
            // at 2.4 Hz, so for half of every cycle the machine was clear of
            // the road it is standing on. It is the second half of the owner's
            // "ours look like it is sitting on something": the first half was
            // the caution face, measured at that variant's face row, and this
            // is what was left once the face came off the wheels. A crank is
            // not a suspension; what a pedalling rider transmits to a frame is
            // a tremor, and 0.008 is about a third of a pixel at eight units.
            a.position.y = Math.sin(now * 15.2 + ph) * 0.008;
          } else if (kind === 'paddle') {
            // A wave, and a big one. This is the only thing on the road that
            // signals a human intention rather than an obstacle, so it is worth
            // more amplitude than realism would give it.
            mv.rotation.z = Math.sin(now * 3.4 + ph) * 0.42;
            a.position.y = Math.abs(Math.sin(now * 3.0 + ph)) * 0.050;
          } else if (kind === 'sway') {
            // The tram's pantograph, riding a wire that is not drawn. Slow and
            // small on purpose: the head of a pantograph tracks the wire, it
            // does not flap, and a big motion up there would argue with the
            // one thing above the roofline that has to read as rigid.
            mv.rotation.x = Math.sin(now * 0.85 + ph) * 0.045;
            a.position.y = Math.sin(now * 1.1 + ph) * 0.012;
          } else if (kind === 'lift') {
            // The refuse truck's tailgate, working. Slow -- one cycle every
            // five seconds -- because a runner passes this thing in under a
            // second and a fast cycle would only ever be caught mid-blur.
            mv.position.y = a.userData.pivotY + 0.24 + 0.24 * Math.sin(now * 1.25 + ph);
            a.position.y = Math.sin(now * 17 + ph) * 0.012;
          } else {
            // 'idle': a stopped engine shaking its own body, and nothing else.
            // 2.2 Hz at 0.022 is about a third of a pixel at forty units and
            // roughly one at fifteen, which is the range where it should start
            // to be felt rather than seen.
            a.position.y = Math.sin(now * 13.8 + ph) * 0.022;
          }
        }
      }

      updateShadows();
      updateRoute(z, now);

      api.applyBiome(Math.min(1, z / K.TOTAL_UNITS));
    };

    api.reset = function () {
      roadPool.releaseAll(); jumpPool.releaseAll(); duckPool.releaseAll();
      blockPool.releaseAll(); buildingPool.releaseAll();
      aidTablePool.releaseAll(); bannerPool.releaseAll(); archPool.releaseAll();
      abutPool.releaseAll(); riverPool.releaseAll();
      overpassPool.releaseAll(); standPool.releaseAll();
      finishStandPool.releaseAll(); chutePool.releaseAll();
      footbridgePool.releaseAll();
      waterPool.releaseAll(); bananaPool.releaseAll();
      for (const k in landmarkPools) landmarkPools[k].releaseAll();
      for (const k in markPools) markPools[k].releaseAll();
      for (const p of crowdPool) p.releaseAll();
      for (const p of walkersPool) p.releaseAll();
      for (const p of treePools) p.releaseAll();
      for (const g of grovePools) for (const p of g) p.releaseAll();
      for (const p of cratePools) p.releaseAll();
      for (const g of planterPools) for (const p of g) p.releaseAll();
      for (const g of streetPools) for (const p of g) p.releaseAll();
      activeGates.length = 0; activeScene.length = 0; activeStruct.length = 0;
      activeBanner.length = 0; activeRoad.length = 0; activeAid.length = 0;
      state.roadFrom = 0; state.gateIdx = 0; state.sceneIdx = 0;
      state.structIdx = 0; state.bannerIdx = 0; state.aidIdx = 0;
      finale.t = 0; finale.hot = 0; finale.gold = 0; finale.chase = 0;
      finale.record = false; finale.broke = -1; finale.done = false;
      finale.next = 0; finale.proj = 0; finale.run = 0; finale.since = 0;
      crowdU.uHot.value = 0;
      lastNow = -1;
      confetti.reset();
      tape.reset();
    };

    /**
     * Warm every pool the plan will actually ask for. Merging a lattice tower
     * takes a few milliseconds; doing it the first time one comes into view
     * would be a frame drop at the exact moment a new city arrives, which is
     * the worst possible moment for one. Cheap after the first hit -- this is
     * a map lookup per structure.
     */
    for (const st of structures) markPool(st);

    api.stats = function () {
      return {
        gates: activeGates.length,
        scenery: activeScene.length,
        structures: activeStruct.length,
        aid: activeAid.length,
        road: activeRoad.length,
      };
    };

    /**
     * ============ WHAT IS STANDING OVER THE PLAY CORRIDOR ============
     *
     * The corridor rule at the top of this file says no scenery may occupy the
     * play space, and that "anything reaching back over the carriageway does so
     * above OVERHEAD_Y". Both were prose. They were also both false: the WALL
     * overpass carried two fascia bars across the road at y = 8.0 and every
     * mile gantry crossed it at 3.5-6.0, which is the height a BLOCK occupies.
     *
     * A comment cannot catch that. This can. It walks the LIVE scene graph --
     * not a hand-kept list, so geometry added tomorrow is audited the day it is
     * added -- and reports every drawn triangle that passes over the corridor,
     * grouped per mesh, with the lowest point of the over-corridor part.
     *
     * tools/shoot.js turns the result into two failing assertions:
     *   1. nothing crosses the corridor below OVERHEAD_Y;
     *   2. nothing crossing the corridor projects onto a gate behind it.
     * The second is the one that matters. Scenery that hides a hazard costs the
     * player a streak for something they could not see, which in this game is
     * the record; it is a correctness bug and it should fail the build.
     *
     * EXEMPT, via userData.notScenery, and each for a stated reason:
     *   hazards   they ARE the corridor's content, and one gate occluding
     *             another is the game rather than a defect
     *   aid       collected by lane, so it stands in the corridor by design
     *   backdrop  sky dome, ground plane, hills, ripples -- unbounded surfaces
     *             that pass over everything and are behind everything
     *   route     the painted racing line, which is on the road, not over it
     *
     * Road paint, telegraph mats and the finish checker all sit under Y_FLOOR
     * and drop out on height alone.
     *
     * Cost is a full triangle walk of the live graph, so it is a debug hook and
     * nothing calls it per frame.
     */
    const Y_FLOOR = 0.06;      // above this is "over the road", below is paint
    api.OVERHEAD_Y = OVERHEAD_Y;
    /**
     * See WAVE_ENVELOPES above for what this is and why it is keyed per chunk
     * rather than unioned.
     *
     * Exported rather than written into a comment in tools/motion.js, because
     * that is precisely how the number goes stale: that file shipped carrying
     * 0.79 for the crowd vertical, taken from reading WAVE_CHUNK as
     * "0.30*exc + 0.31*|b|" -- but the second coefficient is (0.05 + 0.26*exc),
     * which at the exc cap of 1.55 is 0.453 and not 0.31. The true envelope is
     * 0.918, so the instrument was growing the box by 86% of the volume it was
     * meant to be testing, and it erred in the flattering direction.
     */
    /**
     * The shared animation clock, exposed so an instrument can advance the
     * crowd wave and the wind WITHOUT advancing the game.
     *
     * This is not a convenience. The first attempt to measure whether the wind
     * is perceptible pumped the game's own frame callback and pinned the
     * runner's z, and it reported that 96% of the near band changed -- because
     * pinning the runner does not pin the world, so what it actually measured
     * was parallax with the wind somewhere inside the noise. A tool whose
     * signal is a hundredth of its confound is not an instrument, and this one
     * failed in the flattering direction, which is the direction that gets
     * believed. Writing this value and re-rendering changes exactly the
     * vertices the two wave materials displace and nothing else in the frame,
     * so the difference IS the animation, with no subtraction to get wrong.
     */
    api.waveClock = crowdU.uT;
    api.WAVE_ENVELOPE = WAVE_ENVELOPES;
    api.CORRIDOR_HALF = CORRIDOR_HALF;
    // Exposed so tools/shoot.js can guard this file's copy of the hazard
    // half-width against MR.Collision.BOX. See the note at HAZARD_HALF.
    api.HAZARD_HALF = HAZARD_HALF;
    api.crossings = function (fromZ, toZ) {
      // 0.05 of slack, so a kerb notch whose inner face is authored ON the
      // corridor line (and overhangs it by a hundredth of a unit) is furniture
      // rather than a crossing. Nothing that genuinely spans the road misses
      // the corridor by less than five centimetres.
      const CH = CORRIDOR_HALF - 0.05;
      const z0lim = fromZ === undefined ? -1e9 : fromZ;
      const z1lim = toZ === undefined ? 1e9 : toZ;
      const out = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      group.updateWorldMatrix(true, true);

      function scan(o) {
        if (!o.visible || o.userData.notScenery) return;
        const g = o.geometry;
        if (g && g.attributes && g.attributes.position) {
          const pos = g.attributes.position;
          const idx = g.index;
          const n = idx ? idx.count : pos.count;
          const m = o.matrixWorld;
          let yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity, hits = 0;
          // HILLS SPLIT THIS MEASUREMENT IN TWO, and both halves are needed.
          //
          // The corridor rule -- "anything reaching back over the carriageway
          // does so above OVERHEAD_Y" -- has always meant height above the
          // ROAD, and the road used to be at y = 0 so world y was the same
          // number. It no longer is: a mile gantry standing correctly at 9.0
          // over a crest 6.5 units up is at world y = 15.5, and a road tile
          // itself is 6.5 up when it used to be 0. Testing the corridor rule in
          // world space would therefore report every road tile on every hill as
          // a crossing below OVERHEAD_Y and fail the build for it.
          //
          // So yMin/yMax stay in WORLD space, because tools/shoot.js projects
          // them through the real camera and a projection needs world
          // coordinates; and yMinLocal/yMaxLocal are the same points measured
          // from the road directly under them, which is what the rule is about.
          let yLoMin = Infinity, yLoMax = -Infinity;
          for (let i = 0; i + 2 < n; i += 3) {
            const i0 = idx ? idx.getX(i) : i;
            const i1 = idx ? idx.getX(i + 1) : i + 1;
            const i2 = idx ? idx.getX(i + 2) : i + 2;
            a.fromBufferAttribute(pos, i0).applyMatrix4(m);
            b.fromBufferAttribute(pos, i1).applyMatrix4(m);
            c.fromBufferAttribute(pos, i2).applyMatrix4(m);
            // The triangle counts only if its x span actually reaches into the
            // corridor. A kerb whose inner face sits exactly on CORRIDOR_HALF
            // is roadside furniture, not a crossing, so the test is strict.
            const xlo = Math.min(a.x, b.x, c.x), xhi = Math.max(a.x, b.x, c.x);
            if (xhi <= -CH || xlo >= CH) continue;
            const tz0 = Math.min(a.z, b.z, c.z), tz1 = Math.max(a.z, b.z, c.z);
            if (tz1 < z0lim || tz0 > z1lim) continue;
            // Y_FLOOR IS MEASURED FROM THE ROAD, per vertex. A 24-unit road
            // tile spans 0.96 of elevation on a 4% grade, which is larger than
            // most of the clearances this audit protects, so one value for the
            // triangle is not good enough. Doing it in world space instead
            // would let every piece of road paint on a hill through the floor
            // and into the element box, which turns the screen test below into
            // "the road overlaps everything".
            const la = a.y - eAt(a.z), lb = b.y - eAt(b.z), lc = c.y - eAt(c.z);
            const lHi = Math.max(la, lb, lc);
            if (lHi <= Y_FLOOR) continue;
            const lLo = Math.min(la, lb, lc);
            hits++;
            const ty = Math.min(a.y, b.y, c.y);
            if (ty < yMin) yMin = ty;
            const th = Math.max(a.y, b.y, c.y);
            if (th > yMax) yMax = th;
            if (tz0 < zMin) zMin = tz0;
            if (tz1 > zMax) zMax = tz1;
            if (lLo < yLoMin) yLoMin = lLo;
            if (lHi > yLoMax) yLoMax = lHi;
          }
          if (hits) {
            let name = 'mesh', p = o;
            while (p && p !== group) {
              if (p.userData.auditName) { name = p.userData.auditName; break; }
              p = p.parent;
            }
            out.push({ name, tris: hits, yMin, yMax, z0: zMin, z1: zMax,
                       yMinLocal: yLoMin, yMaxLocal: yLoMax });
          }
        }
        for (let i = 0; i < o.children.length; i++) scan(o.children[i]);
      }
      for (let i = 0; i < group.children.length; i++) scan(group.children[i]);
      return out;
    };

    /**
     * ============ THE HAZARD CONTRAST RULE, MADE MEASURABLE ============
     *
     * Measured off tgr-city.png and tgr-sunset-ramp.png, five objects, own
     * luminance against the tarmac they stand on:
     *
     *   guard rail  186.7 on 73.0  ratio 2.56   S 0.20 vs 0.47
     *   ramp deck   181.6 on 73.0  ratio 2.49   S 0.56 vs 0.47
     *   tram roof   163.5 on 78.0  ratio 2.10   S 0.28 vs 0.22
     *   parked car   76.4 on 78.0  ratio 0.98   S 0.60 vs 0.22
     *   trash can    73.7 on 73.0  ratio 1.01   S 0.25 vs 0.47
     *
     * The last two are the interesting ones. The blue car and the grey bin are
     * the same LUMINANCE as the road to within 2% and are still instantly
     * legible -- the car because its saturation is 2.7x the road's, the bin
     * because its saturation is HALF the road's. Either direction works. What
     * never happens in the reference is an object that matches the road on both
     * axes at once. So the rule is not "value contrast is the whole game":
     *
     *   Every hazard's area-weighted mean must differ from the local road by a
     *   factor of >= 1.6 in luminance, OR by >= 0.30 in saturation.
     *
     * tools/shoot.js applies it and fails the run. It is stated here rather
     * than there because this is the file that owns the numbers on both sides.
     *
     * WEIGHTING, and it is the part that makes the rule mean anything. A hazard
     * is read head on, down the road, so what matters is the area it presents
     * TO THE LENS -- not its total surface area, which would count the top and
     * both flanks of a train equally with the face you actually see. Each
     * triangle is therefore weighted by the area of its projection onto the
     * view plane, and back faces (cross.z >= 0, pointing away from a camera
     * that looks down +z) are dropped. For a convex body that is exactly its
     * silhouette area, which is what survives to sixty units.
     *
     * WHAT IS INCLUDED: the merged body, the one moving part a variant may
     * carry, and the caution-stripe face plane -- which is unlit, textured and
     * a big fraction of the frontal area, so its own canvas is averaged rather
     * than guessed at. The telegraph mat is NOT included: it is painted on the
     * road in front of the hazard, it is the lane cue rather than the object,
     * and letting it into the average would let a bright mat excuse a hazard
     * that has itself gone invisible. That is the exact failure this catches.
     *
     * IT IS MEASURED ON RENDERED PIXELS, not on authored hex. A first pass did
     * the arithmetic on material colour x vertex colour and it was WRONG in the
     * only cases that matter. The road is horizontal and a hazard's read face is
     * vertical, so the toon ramp lands them in different bands: measured off
     * 04-wall, the road comes back at 0.89 of its authored value while a
     * hazard's rear faces come back at about 0.55 (this file already records
     * 0x2b2f52 rendering near 0x111737). Authored arithmetic therefore put the
     * marshal barrier at 1.36x the road -- in the dead zone -- when the shaded
     * object is comfortably DARKER than the road and clears the rule from the
     * other side. The rule is symmetric in luminance for exactly the reason the
     * reference's grey bin is legible, and a model that gets the shading wrong
     * cannot tell which side of the road an object has landed on.
     *
     * So each variant is rendered off screen, alone, with its real materials,
     * the scene's real lights and the real gradient maps, into an alpha-cleared
     * 128px target whose texture is tagged SRGBColorSpace so what comes back is
     * display bytes -- the same quantity the reference frames were measured in.
     * Covered pixels are averaged. That IS the area-weighted mean, done by the
     * rasteriser, with occlusion between the object's own parts handled for
     * free, which no amount of triangle arithmetic gets right.
     *
     * The camera is orthographic, aimed down the game's own sightline: BASE_Y
     * 2.62 falling to LOOK_Y 1.16 over LOOK_AHEAD 8.0 is 10.35 degrees below
     * horizontal. The road is measured through the SAME camera, so the grazing
     * angle the tarmac is always seen at is in the number rather than assumed
     * away. It sits 20 units out, inside the fog's near plane, so haze is not in
     * either measurement -- correctly, since a hazard is committed to well
     * before the fog reaches it.
     */
    function lumOf(rgb) { return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]; }
    function satOf(rgb) {
      const hi = Math.max(rgb[0], rgb[1], rgb[2]), lo = Math.min(rgb[0], rgb[1], rgb[2]);
      return hi <= 0 ? 0 : (hi - lo) / hi;
    }

    const AUDIT_PX = 128;
    const _audit = { rt: null, cam: null, buf: null, lanes: null, holder: null };
    function auditSetup() {
      if (_audit.rt) return;
      _audit.rt = new THREE.WebGLRenderTarget(AUDIT_PX, AUDIT_PX);
      _audit.rt.texture.colorSpace = THREE.SRGBColorSpace;
      _audit.rt.texture.generateMipmaps = false;
      _audit.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 80);
      _audit.buf = new Uint8Array(AUDIT_PX * AUDIT_PX * 4);
      _audit.pitch = Math.atan2(2.62 - 1.16, 8.0);
      _audit.holder = new THREE.Group();
      // One lane's tarmac, exactly as roadGeo builds it -- same five camber
      // strips, same tints, same uv remap onto the carriageway, so the mottle
      // and the gutter grime land where they land on the real road.
      _audit.lanes = [0, 1, 2].map(function (l) {
        const parts = [];
        const sw = LANE / CAMBER_STRIPS;
        for (let s = 0; s < CAMBER_STRIPS; s++) {
          const cx = K.LANE_X[l] - LANE / 2 + sw * (s + 0.5);
          parts.push(laneBand(cx, sw, tintScale(LANE_BAND[l], camber(cx))));
        }
        return new THREE.Mesh(merge(parts), mats.road);
      });
      // THE CARPET IS A ROAD, so it is measured as one.
      //
      // course.js now puts the hardest gates of the whole race in the closing
      // half-mile (FINISH_GRACE is 55 units), which means hazards stand ON the
      // finish carpet. The carpet is a different surface from the tarmac -- far
      // darker, by design -- so measuring hazards only against the tarmac would
      // be measuring them against a road that is not there. It happens to be
      // the safe direction (every hazard in this game is a bright object, and a
      // darker backdrop can only widen the ratio), but "it happens to be safe"
      // is exactly the kind of reasoning this audit exists to replace.
      //
      // One entry per lane, at the same pose and through the same lens, so the
      // gate in tools/shoot.js tests every variant against it without knowing
      // the carpet exists.
      _audit.carpets = [0, 1, 2].map(function (l) {
        const g = new THREE.PlaneGeometry(LANE, 6);
        const uv = g.attributes.uv;
        const full = K.TRACK_HALF_WIDTH * 2;
        for (let i = 0; i < uv.count; i++) {
          const x = K.LANE_X[l] + (uv.getX(i) - 0.5) * LANE;
          uv.setX(i, (x + K.TRACK_HALF_WIDTH) / full);
        }
        g.rotateX(-Math.PI / 2);
        g.translate(K.LANE_X[l], 0, 0);
        return new THREE.Mesh(g, carpetMat);
      });
    }

    /**
     * THE FRAME MUST CONTAIN THE OBJECT, and until this pass it did not.
     *
     * shotMean is an ORTHOGRAPHIC render and its mean is taken over covered
     * pixels only, so the frame's SIZE does not bias the number at all -- what
     * biases it is the frame's EDGE. Anything outside is not measured, and an
     * area mean that silently drops a vehicle's roof or its outer flank is a
     * measurement of the camera.
     *
     * It was already happening before the fleet grew. contrastAudit frames at
     * a fixed halfW of LANE * 0.62 = 1.054, which is 2.108 across, and the
     * refuse truck is 2.14 wide: 0.03 of it, both flanks, has never been in
     * shot. And a 3.90-deep vehicle seen down the game's own sightline stands
     * 0.70 taller on screen than its own height, because an elevated camera
     * reads depth as height -- so the old halfH of h * 0.62 would have started
     * cropping roofs the moment the fleet filled its envelope.
     *
     * This returns the half-extents the object actually needs, in the audit
     * camera's own screen basis. Callers take the MAX of this and whatever they
     * asked for, so every framing that already contained its object is
     * unchanged to the digit and only the ones that were cropping move.
     *
     * The basis: the camera sits at azimuth az, elevation el, looking at the
     * centre. Its right is (cos az, 0, sin az) and its up is
     * (-sin el sin az, cos el, sin el cos az) -- so a point's screen offsets
     * are those two dots, and the eight corners of the box bound them.
     */
    function fitHalf(bb, cx, cy, cz, az, el) {
      const ca = Math.cos(az), sa = Math.sin(az);
      const ce = Math.cos(el), se = Math.sin(el);
      let hw = 0, hh = 0;
      for (const px of [bb.min.x, bb.max.x]) {
        for (const py of [bb.min.y, bb.max.y]) {
          for (const pz of [bb.min.z, bb.max.z]) {
            const dx = px - cx, dy = py - cy, dz = pz - cz;
            hw = Math.max(hw, Math.abs(dx * ca + dz * sa));
            hh = Math.max(hh, Math.abs(-dx * se * sa + dy * ce + dz * se * ca));
          }
        }
      }
      // 4% of headroom, because the ink shell stands slightly outside the
      // geometry it wraps and the merged box does not know about it.
      return [hw * 1.04, hh * 1.04];
    }

    const _clr = new THREE.Color();
    /**
     * Render `obj` alone, down the game's sightline, and average the pixels it
     * covers. Everything in the scene but the lights is hidden for the duration
     * -- a light with `visible` false stops contributing, which would measure
     * the object in the dark.
     */
    function shotMean(renderer, scene, obj, cx, cy, cz, halfW, halfH) {
      auditSetup();
      const saved = [];
      for (const o of scene.children) {
        if (o.isLight) continue;
        saved.push([o, o.visible]);
        o.visible = false;
      }
      _audit.holder.clear();
      _audit.holder.add(obj);
      scene.add(_audit.holder);

      const cam = _audit.cam;
      cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
      cam.updateProjectionMatrix();
      const d = 20;
      // AZIMUTH AND ELEVATION, because CLAUDE.md rule 1 has to be checkable.
      //
      // The default is az 0 / el = _audit.pitch, which is the game's own
      // sightline from directly behind -- so contrastAudit's numbers are
      // exactly what they always were and nothing that reads them moves. What
      // this adds is the ability to ask for any other angle, which is what
      // "every object is modelled on all sides" needs in order to be an
      // assertion rather than an intention. A rear-only object photographs as
      // a fully-built one at az 0 and only at az 0; the flank and the front
      // are where a hollow face shows, and until now nothing in this file
      // could look at them.
      //
      // az 0 is from -z (behind, the chase view); az grows toward +x, so
      // PI/2 is the flank and PI is head-on. el is measured up from the
      // horizontal, which is why the default is +pitch: the eye is above.
      const az = _audit.az || 0;
      const el = _audit.el === undefined ? _audit.pitch : _audit.el;
      const ce = Math.cos(el);
      cam.position.set(
        cx + d * ce * Math.sin(az),
        cy + d * Math.sin(el),
        cz - d * ce * Math.cos(az)
      );
      cam.lookAt(cx, cy, cz);

      const prevRT = renderer.getRenderTarget();
      renderer.getClearColor(_clr);
      const prevA = renderer.getClearAlpha();
      renderer.setRenderTarget(_audit.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(_audit.rt, 0, 0, AUDIT_PX, AUDIT_PX, _audit.buf);
      renderer.setRenderTarget(prevRT);
      renderer.setClearColor(_clr, prevA);

      scene.remove(_audit.holder);
      _audit.holder.clear();
      for (const s of saved) s[0].visible = s[1];

      const b = _audit.buf;
      let r = 0, g = 0, bl = 0, n = 0;
      // Fully covered pixels only. A render target has no MSAA, so an edge
      // pixel is either the object or the clear -- the threshold is belt and
      // braces against a blended alpha, not a silhouette softener.
      for (let i = 0; i < b.length; i += 4) {
        if (b[i + 3] < 200) continue;
        r += b[i]; g += b[i + 1]; bl += b[i + 2]; n++;
      }
      if (!n) return null;
      const rgb = [r / n, g / n, bl / n];
      const out = {
        px: n, rgb: rgb.map((v) => +v.toFixed(1)),
        L: +lumOf(rgb).toFixed(1), S: +satOf(rgb).toFixed(3),
      };
      // A failing assertion that cannot be looked at is an assertion nobody
      // trusts. On request each swatch comes back as a png so the build can
      // drop the exact pixels it measured next to the frame it measured them
      // for. readRenderTargetPixels is bottom-up, hence the flip.
      if (_audit.images) {
        const cv = canvas(AUDIT_PX, AUDIT_PX);
        const cg = cv.getContext('2d');
        const img = cg.createImageData(AUDIT_PX, AUDIT_PX);
        for (let y = 0; y < AUDIT_PX; y++) {
          const src = (AUDIT_PX - 1 - y) * AUDIT_PX * 4;
          img.data.set(b.subarray(src, src + AUDIT_PX * 4), y * AUDIT_PX * 4);
        }
        cg.putImageData(img, 0, 0);
        out.png = cv.toDataURL('image/png');
      }
      return out;
    }

    /**
     * EVERYTHING A VARIANT OCCUPIES, as one box in the variant's own frame.
     *
     * The merged body is not the whole object: every variant also turns a
     * caution face toward the lens, and most carry one moving part on a pivot.
     * Both were outside every extent this file reported -- so `wide` on a
     * fleet sheet was the body's width and not the object's, and the framing
     * that measures contrast was sized from the body alone.
     *
     * It is also what the halfX and halfZ guards are asked against: a variant
     * is inside MR.Collision.BOX only if ALL of it is, and the striped face is
     * the piece most likely to be the widest thing on a hazard.
     */
    /**
     * One variant, assembled exactly as the spawn site assembles it: inked
     * body, the caution face it turns toward the lens, and the one moving part
     * on its pivot. Three places built this by hand and had to agree with each
     * other by inspection; they call this instead.
     *
     * Exposed as api.variantObject because CLAUDE.md rule 1 is checked with an
     * orbit and the sheet this file renders is 128 pixels a tile. That is the
     * right resolution for an AREA MEAN and much too coarse to answer "does
     * this vehicle have a grille", which is the question rule 1 actually asks.
     * A tool can now put the same object in front of any lens it likes.
     */
    function assembleVariant(tint, d) {
      const g = new THREE.Group();
      const body = S.outlined(d.geo, mats.propLit, S.INK.hazard);
      // Same tag the spawn site puts on, for the same reason -- see there.
      body.userData.people = 'hazard';
      g.add(body);
      if (d.face) {
        const f = new THREE.Mesh(hplane(d.face[0], d.face[1]), faceMat[tint]);
        f.position.set(0, d.face[2], d.face[3]);
        f.rotation.y = Math.PI;
        g.add(f);
      }
      if (d.moving) {
        const mv = S.outlined(d.moving, mats.propLit, S.INK.hazard);
        mv.position.set(d.pivot[0] * LANE_FIT, d.pivot[1], d.pivot[2]);
        g.add(mv);
      }
      return g;
    }
    api.variantObject = function (kind, vi) {
      for (const grp of HAZARD_DEFS) {
        if (grp.kind !== kind) continue;
        if (!grp.defs[vi]) return null;
        return assembleVariant(grp.tint, grp.defs[vi]);
      }
      return null;
    };

    function variantBox(d, swept) {
      d.geo.computeBoundingBox();
      const bb = d.geo.boundingBox.clone();
      // The face plane. hplane() puts it through LANE_FIT, so its world
      // half-width is not the number written in the def.
      if (d.face) {
        const fw = d.face[0] * LANE_FIT / 2, fh = d.face[1] / 2;
        bb.expandByPoint(new THREE.Vector3(-fw, d.face[2] - fh, d.face[3]));
        bb.expandByPoint(new THREE.Vector3(fw, d.face[2] + fh, d.face[3]));
      }
      if (d.moving) {
        d.moving.computeBoundingBox();
        const mb = d.moving.boundingBox;
        const px = d.pivot[0] * LANE_FIT, py = d.pivot[1], pz = d.pivot[2];
        // SWEPT, WHEN THE QUESTION IS "DOES IT FIT". A fitting that sits inside
        // the envelope at rest and leaves it the moment the game runs is the
        // defect this project keeps a corrections list for, so the guard asks
        // for the swept reach -- but the SHEET must not, or a variant whose
        // moving part happens to turn through a wide arc prints as a speck
        // beside variants that do not, and the sheet's one job is that every
        // tile is at the same scale.
        //
        // The sweep is per anim and not a ball, because the anims are not
        // balls: 'pedal' turns about x, 'paddle' about z through +/-0.42, and
        // 'sway' about x through +/-0.045. A ball around the paddle's pivot
        // reaches 1.66 units in every direction on a part that never leaves a
        // 0.42 radian fan, which is not conservatism, it is a wrong number.
        const arc = swept ? { pedal: [1, Math.PI], paddle: [3, 0.42], sway: [1, 0.045] }[d.anim] : null;
        const lift = swept && d.anim === 'lift' ? 0.48 : 0;
        for (const qx of [mb.min.x, mb.max.x]) {
          for (const qy of [mb.min.y, mb.max.y]) {
            for (const qz of [mb.min.z, mb.max.z]) {
              const steps = arc ? 16 : 0;
              for (let i = 0; i <= steps; i++) {
                let ax = qx, ay = qy, az2 = qz;
                if (arc) {
                  const t = arc[1] * (-1 + 2 * i / steps);
                  const c = Math.cos(t), s = Math.sin(t);
                  if (arc[0] === 1) { ay = qy * c - qz * s; az2 = qy * s + qz * c; }
                  else { ax = qx * c - qy * s; ay = qx * s + qy * c; }
                }
                bb.expandByPoint(new THREE.Vector3(px + ax, py + ay, pz + az2));
                if (lift) bb.expandByPoint(new THREE.Vector3(px + ax, py + ay + lift, pz + az2));
              }
            }
          }
        }
      }
      // THE Y SHUDDER MOVES THE WHOLE VARIANT, including the eight variants
      // that have no moving part at all -- 'idle' is nothing but this shudder,
      // and it is the only reason a stopped bus reads as a stopped bus. It is
      // charged to the envelope because it is real travel: a fitting authored
      // to land exactly on 2.80 is above 2.80 for half of every cycle.
      const SHUD = { pedal: [-0.030, 0.030], paddle: [0, 0.050], sway: [-0.012, 0.012],
        lift: [-0.012, 0.012], idle: [-0.022, 0.022] }[d.anim];
      if (swept && SHUD) {
        bb.min.y += SHUD[0];
        bb.max.y += SHUD[1];
      }
      return bb;
    }

    /**
     * Every hazard variant's rendered tone, and every lane's road tone under
     * the palette live in this frame. Needs the renderer and the scene, which
     * this file deliberately does not hold: it is a build-time audit, called
     * from tools/shoot.js, and nothing in the game loop may reach for a
     * framebuffer.
     */
    api.contrastAudit = function (renderer, scene, opts) {
      auditSetup();
      _audit.images = !!(opts && opts.images);
      // Always down the game's own sightline, whatever a fleetSheet call left
      // behind. The contrast gate is a statement about the angle the lane is
      // chosen from, and it must not silently become a statement about
      // whatever angle was last photographed.
      _audit.az = 0;
      _audit.el = undefined;
      const NAME = { [K.JUMP]: 'JUMP', [K.DUCK]: 'DUCK', [K.BLOCK]: 'BLOCK' };
      const hazards = [];
      for (const grp of HAZARD_DEFS) {
        grp.defs.forEach(function (d, vi) {
          // The object as it is actually assembled at spawn. The telegraph mat
          // is NOT here -- it is painted on the road in front of the hazard,
          // and letting a bright mat into the average would excuse a hazard
          // that had itself gone invisible.
          const g = assembleVariant(grp.tint, d);
          const bb = variantBox(d);
          const h = bb.max.y;
          // The pose is what it always was -- centred on the object's own
          // half-height, down the game's sightline. What is new is that the
          // frame is never allowed to be smaller than the object: see fitHalf.
          // Every variant that already fitted keeps its old numbers exactly.
          const need = fitHalf(bb, 0, h / 2, 0, 0, _audit.pitch);
          const m = shotMean(renderer, scene, g, 0, h / 2, 0,
            Math.max(LANE * 0.62, need[0]), Math.max(h * 0.62, need[1]));
          hazards.push(Object.assign({
            kind: grp.kind, variant: vi, name: NAME[grp.kind] + ' v' + vi,
          }, m));
        });
      }
      const roads = [0, 1, 2].map(function (l) {
        const m = shotMean(renderer, scene, _audit.lanes[l], K.LANE_X[l], 0.25, 0,
          LANE * 0.44, LANE * 0.44);
        return Object.assign({ lane: l }, m);
      });
      // ...and the finish carpet, which is the surface the last gates of the
      // race actually stand on. See auditSetup().
      for (let l = 0; l < 3; l++) {
        const m = shotMean(renderer, scene, _audit.carpets[l], K.LANE_X[l], 0.02, 0,
          LANE * 0.44, LANE * 0.44);
        roads.push(Object.assign({ lane: 'carpet' + l }, m));
      }
      return { hazards, roads };
    };

    /**
     * THE FLEET AT ONE SCALE -- the sheet `contrastAudit` cannot give you, and
     * the reason a previous pass concluded the fleet had no shape variety at
     * all when what it was looking at was its own camera.
     *
     * `contrastAudit` frames every variant to its OWN height: `halfH` is
     * `h * 0.62` while `halfW` is a FIXED `LANE * 0.62`. That is correct for
     * the thing it measures -- an area mean wants the object filling the target
     * and does not care about aspect -- and it is wrong for anything about
     * SHAPE, in two compounding ways:
     *
     *   Every variant is normalised to exactly 128px tall. A 2.32 taxi and a
     *     2.79 refuse truck come back the same height. Height is the largest
     *     single difference between a taxi, a van and a bus, and this deletes
     *     it.
     *   Every variant is stretched horizontally, by a DIFFERENT factor each --
     *     1.36x for the taxi, 1.64x for the refuse truck -- because halfW is
     *     fixed while halfH is not. So even the surviving proportions are wrong
     *     by a per-variant amount.
     *
     * Width is then near-constant across the fleet for a reason that is not a
     * defect: every BLOCK must fill the lane it blocks, so all ten are ~1.6
     * world wide by contract. Normalise the height too and ten different
     * objects necessarily print as ten identical rectangles. A silhouette sheet
     * built from those swatches shows the camera, not the fleet.
     *
     * reference/our-fleet-silhouettes.png was built exactly that way, and was
     * read as proof that the geometry was flat.
     *
     * This renders every variant of one kind down the same sightline at ONE
     * scale, square (so pixels are undistorted), with ONE ground line -- so
     * relative height, relative width and the shape of the lower edge are all
     * facts about the geometry. It is a build-time audit like its neighbour and
     * is called from tools only.
     */
    api.fleetSheet = function (renderer, scene, kind, opts) {
      auditSetup();
      const prevImages = _audit.images;
      _audit.images = !(opts && opts.images === false);
      // See shotMean: az 0 / el = the game's sightline is the default, so
      // every existing caller is unaffected. Passing an angle is how CLAUDE.md
      // rule 1 gets checked -- a flank or a front that was never built shows
      // here and nowhere else.
      _audit.az = (opts && opts.az) || 0;
      _audit.el = (opts && opts.el !== undefined) ? opts.el : undefined;
      const az = _audit.az;
      const el = _audit.el === undefined ? _audit.pitch : _audit.el;
      const NAME = { [K.JUMP]: 'JUMP', [K.DUCK]: 'DUCK', [K.BLOCK]: 'BLOCK' };

      const picked = [];
      for (const grp of HAZARD_DEFS) {
        if (kind !== undefined && kind !== null && grp.kind !== kind) continue;
        grp.defs.forEach(function (d, vi) { picked.push({ grp, d, vi, bb: variantBox(d) }); });
      }
      // ONE SCALE FOR THE WHOLE SHEET, and that is the entire value of this
      // instrument -- relative height and relative width are only facts about
      // the fleet if every tile is photographed at the same magnification. So
      // the frame is not fitted per variant the way contrastAudit's is; it is
      // grown once until the LARGEST variant fits, and then every tile uses it.
      //
      // Growing it at all is new, and it is the fleet's new depth that forced
      // it: at az PI/2 a 3.90-long vehicle is 3.90 across the frame, and the
      // old fixed 1.58 would have printed the middle 81% of every car in the
      // set and called it a flank. The loop converges because cy is a function
      // of half and the required half is monotone in cy.
      let half = (opts && opts.half) || 1.58;
      let cy = (opts && opts.cy !== undefined) ? opts.cy : half - 0.16;
      for (let pass = 0; pass < 6; pass++) {
        let need = half;
        for (const p of picked) {
          const f = fitHalf(p.bb, 0, cy, 0, az, el);
          need = Math.max(need, f[0], f[1]);
        }
        if (need <= half + 1e-6) break;
        half = need;
        // Put the road a little below centre so the full 0..2.80 band is in
        // frame with the contact line visible on every variant.
        cy = (opts && opts.cy !== undefined) ? opts.cy : half - 0.16;
      }

      const out = [];
      {
        picked.forEach(function (p) {
          const grp = p.grp, d = p.d, vi = p.vi;
          // Assembled exactly as contrastAudit assembles it, so the two sheets
          // describe the same object.
          const g = assembleVariant(grp.tint, d);
          const bb = p.bb;
          const m = shotMean(renderer, scene, g, 0, cy, 0, half, half);
          out.push(Object.assign({
            kind: grp.kind, variant: vi, name: NAME[grp.kind] + ' v' + vi,
            top: +bb.max.y.toFixed(2),
            wide: +(bb.max.x - bb.min.x).toFixed(2),
            // DEPTH, which this sheet has never reported and which is the axis
            // the fleet was rebuilt on. Reported alongside the box it has to
            // fit inside, so a variant that outgrows its envelope is visible
            // in the table and not only in the guard that fails the build.
            deep: +(bb.max.z - bb.min.z).toFixed(2),
            zMin: +bb.min.z.toFixed(2), zMax: +bb.max.z.toFixed(2),
            halfX: +Math.max(-bb.min.x, bb.max.x).toFixed(2),
            half: +half.toFixed(2),
          }, m));
        });
      }
      _audit.images = prevImages;
      _audit.az = 0;
      _audit.el = undefined;
      return out;
    };

    /**
     * WHAT EVERY VARIANT ACTUALLY OCCUPIES, against the box it is allowed.
     *
     * "Art never decides clearance" (CLAUDE.md rule 4) was a sentence and not a
     * test. MR.Collision.BOX had no halfX at all -- world.js was choosing the
     * width of the audited envelope itself, as LANE * 0.5 -- and no assertion
     * anywhere compared a variant's geometry with the box that stands for it.
     * Nothing was watching either axis.
     *
     * So this reports the swept extents of every variant, in the variant's own
     * frame, next to the box; tools/shoot.js turns it into a build failure. It
     * is the same shape of guard as the HAZARD_HALF_Z drift check: the file
     * that owns the numbers reports them, and the file that owns the rule
     * fails the build.
     *
     * THE DIRECTION THAT MATTERS. Art SHORTER than its box is safe -- the
     * occlusion audit then over-counts what a gate hides, which errs toward
     * calling a gate unreadable when it is not. Art LONGER than its box is the
     * defect already in the corrections list: BLANKS under-counts and passes a
     * gate the art really hides. So this reports both directions and shoot.js
     * fails on one of them.
     */
    api.fleetExtents = function () {
      const B = MR.Collision.BOX;
      const NAME = { [K.JUMP]: 'JUMP', [K.DUCK]: 'DUCK', [K.BLOCK]: 'BLOCK' };
      const out = [];
      for (const grp of HAZARD_DEFS) {
        grp.defs.forEach(function (d, vi) {
          const bb = variantBox(d, true);
          const box = B[grp.kind] || {};
          out.push({
            kind: grp.kind, variant: vi, name: NAME[grp.kind] + ' v' + vi,
            halfX: +Math.max(-bb.min.x, bb.max.x).toFixed(3),
            halfZ: +Math.max(-bb.min.z, bb.max.z).toFixed(3),
            yMax: +bb.max.y.toFixed(3), yMin: +bb.min.y.toFixed(3),
            boxHalfX: box.halfX, boxHalfZ: box.halfZ,
            boxYMin: box.yMin, boxYMax: box.yMax,
          });
        });
      }
      return out;
    };

    /**
     * WHICH SKIN EVERY GATE OF A COURSE WILL WEAR, without playing the course.
     *
     * "Enough visual variation that the road does not feel repetitive" is a
     * measurable claim, and it was being answered by eye. The casting is a
     * pure function of the course, so the whole course's skins are knowable up
     * front -- this returns them, and the question "how often does the same
     * variant appear twice inside one visible window" becomes arithmetic
     * rather than a screenshot.
     *
     * It reports what actually SPAWNS, dealt from the weighted bag, so a
     * variant holding two tickets appears at the rate it really appears. That
     * distinction is the point: the fleet's weights are deliberate, and a
     * repetition figure computed from a uniform draw would be describing a
     * different game.
     *
     * THE DEAL IS SEEDED, SO THE KEY IS PART OF THE QUESTION. Pass the course
     * itself, or gates plus the date key. Passing a bare gate array still
     * works and is answered for THIS world's course -- which is what every
     * caller in the tree does -- but planning some other day's course from a
     * bare array cannot be right and now says so rather than quietly casting
     * it with the wrong seed.
     */
    api.variantPlan = function (arg, key) {
      const gates = (arg && arg.gates) || arg;
      const seed = (arg && arg.key) || key || (course && course.key);
      const cast = castGates(gates, seed);
      const out = [];
      for (let g = 0; g < gates.length; g++) {
        const gate = gates[g];
        for (let l = 0; l < 3; l++) {
          const kind = gate.lanes[l];
          if (kind === K.CLEAR || cast[g][l] < 0) continue;
          out.push({ z: gate.z, lane: l, kind: kind, variant: cast[g][l] });
        }
      }
      return out;
    };

    /**
     * WHAT IS ACTUALLY ON THE ROAD RIGHT NOW, by variant.
     *
     * api.variantPlan says what the course WILL wear; this says what the live
     * scene IS wearing, read off the visible child of each claimed hazard
     * rather than off the table that chose it. The two must agree, and until
     * the casting moved to a dealt bag nothing in the tree could ask.
     *
     * That is not a hypothetical gap. The plan and the spawn were separate
     * code paths computing the same hash from the same inputs, and a plan that
     * silently disagreed with the road would have made every repetition figure
     * this project has published a statement about a function nobody rendered.
     */
    api.liveCast = function () {
      const out = [];
      for (const g of activeGates) {
        for (let l = 0; l < 3; l++) {
          const kind = g.gate.lanes[l];
          if (kind === K.CLEAR) continue;
          const o = g.objs && g.objs[l];
          const list = o && o.userData.variants;
          if (!list) continue;
          let vi = -1;
          for (let k = 0; k < list.length; k++) if (list[k].visible) { vi = k; break; }
          out.push({ z: g.gate.z, lane: l, kind: kind, variant: vi });
        }
      }
      return out;
    };

    /**
     * The gates as the occlusion check needs to see them: a world-space box per
     * live hazard, taken from MR.Collision.BOX so the audit is measured against
     * the collision contract rather than against the art.
     */
    api.gateBoxes = function () {
      const B = MR.Collision.BOX;
      const out = [];
      for (const g of activeGates) {
        for (let l = 0; l < 3; l++) {
          const kind = g.gate.lanes[l];
          if (kind === K.CLEAR) continue;
          const box = B[kind];
          if (!box) continue;
          const span = (kind === K.BLOCK && g.gate.train) ? 1 + g.gate.train * 0.9 : 1;
          // Collision.BOX is measured from the LOCAL road surface, and the
          // occlusion check projects these boxes through the real camera -- so
          // they are lifted onto the profile here, exactly as the art is at the
          // claim site. Leaving them at zero would move every hazard the audit
          // is looking for down the frame on a hill and quietly stop it working.
          const ey = eAt(g.gate.z);
          out.push({
            kind, lane: l, z: g.gate.z,
            // halfX comes from the collision box now. It was LANE * 0.5 written
            // here, which meant the ART FILE was choosing the width of the
            // envelope the fairness audit casts against -- see the halfX note
            // in collision.js. The number is the same; who owns it is not.
            x: K.LANE_X[l], halfX: box.halfX,
            yMin: box.yMin + ey, yMax: box.yMax + ey,
            // Nose-anchored: the near face IS the gate line, so the whole box
            // lies forward of it. See collision.js.
            z0: g.gate.z, z1: g.gate.z + 2 * box.halfZ * span,
          });
        }
      }
      return out;
    };

    return api;
  }

  return { create, VIEW, BEHIND, BIOME_LOOK };
})();
