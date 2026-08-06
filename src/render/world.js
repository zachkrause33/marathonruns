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
 *  2. DRAW CALLS, not triangles. SwiftShader at 1100x700 dies on draw count.
 *     Props are therefore merged into single vertex-coloured meshes -- a knot
 *     of eight spectators, a bridge tower with its cables, a whole 24-unit run
 *     of crowd barrier -- so richness costs geometry, which is free, instead
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

  // The widest point of any hazard, measured from its lane centre: the DUCK
  // frame's foot, 0.50 wide at 1.20 out. Anything that has to stand clear of
  // the lanes -- an aid table, a set piece -- starts from here rather than
  // from a literal that goes stale the next time the track is retuned.
  const HAZARD_HALF = 1.20 * LANE_FIT + 0.25;

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
      mix: { building: 1.5, tree: 1.1, grove: 0.3, crowd: 2.3, walkers: 1.1 },
    },
    // `bank` cuts the shoulder back on one side so the water can come right up
    // to the road; at full shoulder width the river sat 35 units out and read
    // as a smear on the horizon.
    'RIVERSIDE': {
      sky: [0x1f6fb8, 0xbdf0ff], ground: 0x57c7a8, road: 0x52677b, fog: 0xbdf0ff,
      edge: 'hedge', bank: -1, street: 0.26,
      mix: { building: 0.35, tree: 2.0, grove: 2.0, crowd: 1.0, walkers: 0.8 },
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
      mix: { building: 0.12, tree: 2.6, grove: 3.6, crowd: 1.1, walkers: 0.9 },
    },
    'THE WALL': {
      sky: [0x8a3a6b, 0xffb27a], ground: 0x8f9a5e, road: 0x795d6a, fog: 0xffb27a,
      edge: 'wall', street: 0.46,
      mix: { building: 1.2, tree: 0.25, crowd: 0.35, walkers: 0.3 },
    },
    'FINAL MILE': {
      sky: [0x24306e, 0xffcf6b], ground: 0x5cb46a, road: 0x656181, fog: 0xffcf6b,
      edge: 'barrier', street: 0.52,
      mix: { building: 0.7, tree: 0.7, crowd: 3.4, walkers: 0.7 },
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
      // 0x8a6a79 is 0xe5b1ca at 0.605 -- same hue, two thirds the value.
      ground: [0x8f9a5e, 0.52], road: [0x8a6a79, 0.42],
    },
    'FINAL MILE': {
      // 0x9c8874 is 0xffe0c0 at 0.61.
      sky: [0x3a2f7e, 0.34], fog: [0xffcf6b, 0.40], road: [0x9c8874, 0.16],
    },
  };

  const PROP_KINDS = ['building', 'tree', 'grove', 'crowd', 'walkers'];

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
        h: [8.5, 11.0], bay: 4.4, depth: 7.0, rows: 4, stoop: 1, chimney: 3,
      },
      tower: { colors: [0x7a8ab0, 0x9aa4c0, 0xc8ccd8], glass: 1, crown: 'flat' },
      tree: { kind: 'round', colors: [0x3e8f4a, 0x4fa85c, 0x5cbf6a], h: 1.15, trunk: 0x9a9a86 },
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
      tree: { kind: 'round', colors: [0x4aa055, 0x58b862, 0x6ccf74], h: 1.2 },
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
      tree: { kind: 'round', colors: [0x3f9a52, 0x4faf5f, 0x62c470], h: 1.0 },
      marks: {
        'CITY START': [{ k: 'willis', x: 20 }, { k: 'lTrack', over: 1, run: 48, alt: 'lTrackTrain', every: 3 }],
        'RIVERSIDE': [{ k: 'lTrack', over: 1, run: 48, alt: 'lTrackTrain', every: 3 }, { k: 'crane', x: 13 }, { k: 'willis', x: 22 }],
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
      tree: { kind: 'round', colors: [0x3f9a52, 0x4faf5f, 0x62c470], h: 1.1 },
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
        h: [9.0, 13.0], bay: 3.8, depth: 6.6, rows: 5, neon: 1,
      },
      tower: { colors: [0xb8bcd0, 0xd0d4e0, 0x8f96b0], glass: 1, crown: 'antenna' },
      tree: { kind: 'columnar', colors: [0x3f9a68, 0x4fb078], h: 1.0 },
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
      tree: { kind: 'palm', colors: [0x3f9a5a, 0x4fb068], h: 1.1 },
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
      tree: { kind: 'pollard', colors: [0x4a9a52, 0x5aae60], h: 1.1, trunk: 0xa8a894 },
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
      tree: { kind: 'palm', colors: [0x4faf62, 0x62c470], h: 1.25 },
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
      tree: { kind: 'round', colors: [0x429a55, 0x52ae62, 0x64c070], h: 1.15 },
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
      tree: { kind: 'umbrella', colors: [0x2f7a44, 0x3a8f50], h: 1.2 },
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
      tree: { kind: 'scrub', colors: [0x6f9a4a, 0x8fae5a, 0x5f8f56], h: 0.9 },
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
      tree: { kind: 'cone', colors: [0x35a855, 0x3fbf63, 0x59d47a], h: 1 },
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

  /** Pale banded ripples, laid over the water plane on the bridge. */
  function rippleTexture() {
    const c = canvas(128, 128);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.30)';
    for (let i = 0; i < 7; i++) {
      const y = 8 + i * 17, w = 24 + ((i * 37) % 60);
      g.fillRect(((i * 53) % 100), y, w, 4);
      g.fillRect(((i * 29) % 90) + 20, y + 7, w * 0.6, 3);
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
  function merge(parts) {
    let n = 0;
    const prepared = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (p.matrix) g.applyMatrix4(p.matrix);
      prepared.push({ g, color: p.color });
      n += g.attributes.position.count;
    }
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
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
      o += count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }

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
  /** Low-poly blob, for canopies and anything that must not read as a box. */
  function sph(r, seg, x, y, z, color) {
    return part(new THREE.SphereGeometry(r, seg || 7, Math.max(3, (seg || 7) - 2)), color, x, y, z);
  }

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
      parts.push({
        geo: p.geo, color: p.color,
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
      const sub = [];
      sub.push(bx(d, h, bw * 0.98, 0, h / 2, 0, col));
      // Ground floor: a stone base course, which is what stops a terrace
      // reading as a row of coloured slabs standing on grass.
      sub.push(bx(d * 1.01, 1.5, bw * 0.99, 0, 0.75, 0, t.trim));
      sub.push(bx(d * 1.02, 0.22, bw, 0, 1.55, 0, t.trim));
      // Windows, proud of the facade so they catch a different band of the
      // toon ramp than the wall does.
      const rows = t.rows || 4;
      for (let r = 0; r < rows; r++) {
        const wy = 2.6 + r * ((h - 3.4) / Math.max(1, rows));
        if (wy > h - 1.0) break;
        for (const sz of [-1, 1]) {
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
      // Door and stoop.
      sub.push(bx(0.24, 1.6, bw * 0.26, fx - 0.10, 0.8, 0, 0x4a3a56));
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
      placeAt(parts, sub, 0, 0, z, lean);
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

  /** A tree, by profile. One function, seven silhouettes. */
  function vTree(parts, o, k) {
    const c = o.colors, s = (o.h || 1) * (k || 1);
    const trunk = o.trunk === undefined ? 0x8a5a3c : o.trunk;
    const kind = o.kind;
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
        parts.push(bx(3.4 * s, 0.14 * s, 0.9 * s,
          tx + Math.cos(a) * 1.5 * s, ty - 0.35 * s, Math.sin(a) * 1.5 * s,
          c[f % c.length], 0, a, -0.30));
      }
      parts.push(sph(0.5 * s, 6, tx, ty, 0, 0x6a4a2c));
    } else if (kind === 'umbrella') {
      // The Roman stone pine: a long bare trunk and a flat wide canopy sitting
      // on top of it like a parasol.
      parts.push(cyl(0.28 * s, 0.5 * s, 6.4 * s, 6, 0, 3.2 * s, 0, trunk));
      parts.push(bx(0.4 * s, 2.4 * s, 0.4 * s, -0.8 * s, 6.4 * s, 0, trunk, 0, 0, 0.5));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 6.283;
        parts.push(sph(1.9 * s, 7, Math.cos(a) * 1.9 * s, 7.4 * s, Math.sin(a) * 1.9 * s,
          c[i % c.length]));
      }
      parts.push(sph(2.3 * s, 7, 0, 8.0 * s, 0, c[0]));
    } else if (kind === 'columnar') {
      parts.push(cyl(0.16 * s, 0.26 * s, 1.2 * s, 6, 0, 0.6 * s, 0, trunk));
      for (let i = 0; i < 4; i++) {
        parts.push(cone((1.05 - i * 0.16) * s, 2.2 * s, 7, 0, (1.9 + i * 1.35) * s, 0, c[i % c.length]));
      }
    } else if (kind === 'scrub') {
      // Fynbos: low, dense, many-crowned and never a single trunk.
      const r = lcg(31);
      for (let i = 0; i < 6; i++) {
        parts.push(sph((0.7 + r() * 0.7) * s, 6, (r() - 0.5) * 4 * s, (0.5 + r() * 0.5) * s,
          (r() - 0.5) * 4 * s, c[i % c.length]));
      }
    } else if (kind === 'pollard') {
      // The Paris plane tree: a pale stubby trunk under a tight clipped ball.
      parts.push(cyl(0.30 * s, 0.42 * s, 3.0 * s, 6, 0, 1.5 * s, 0, trunk));
      for (const a of [-0.6, 0.6]) {
        parts.push(bx(0.24 * s, 1.4 * s, 0.24 * s, 0, 3.4 * s, 0, trunk, 0, 0, a));
      }
      parts.push(sph(2.0 * s, 8, 0, 5.0 * s, 0, c[0]));
      parts.push(sph(1.5 * s, 7, -0.9 * s, 4.3 * s, 0.6 * s, c[1 % c.length]));
      parts.push(sph(1.4 * s, 7, 0.9 * s, 4.4 * s, -0.7 * s, c[c.length - 1]));
    } else if (kind === 'round') {
      parts.push(cyl(0.20 * s, 0.34 * s, 2.6 * s, 6, 0, 1.3 * s, 0, trunk));
      parts.push(sph(2.0 * s, 8, 0, 4.4 * s, 0, c[0]));
      parts.push(sph(1.5 * s, 7, -1.4 * s, 3.7 * s, 0.6 * s, c[1 % c.length]));
      parts.push(sph(1.4 * s, 7, 1.3 * s, 3.9 * s, -0.7 * s, c[2 % c.length]));
      parts.push(sph(1.2 * s, 7, 0.2 * s, 5.7 * s, 0.3 * s, c[(c.length - 1) % c.length]));
    } else {
      parts.push(cyl(0.17 * s, 0.26 * s, 1.3 * s, 6, 0, 0.65 * s, 0, trunk));
      parts.push(cone(1.30 * s, 1.7 * s, 8, 0, 2.0 * s, 0, c[0]));
      parts.push(cone(1.05 * s, 1.5 * s, 8, 0, 2.9 * s, 0, c[1 % c.length]));
      parts.push(cone(0.75 * s, 1.2 * s, 8, 0, 3.7 * s, 0, c[2 % c.length]));
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
     */
    lTrack: function (look, withTrain) {
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
      if (withTrain) {
        const car = [0xc8ccd8, 0x37a8d8];
        for (let i = 0; i < 3; i++) {
          const z = -16 + i * 16;
          parts.push(bx(6.4, 3.0, 14.4, 0, 15.0, z, car[i % 2]));
          parts.push(bx(6.5, 0.9, 14.5, 0, 16.1, z, 0x2b3350));
          parts.push(bx(6.6, 0.4, 14.0, 0, 16.9, z, 0xd8dcf0));
          parts.push(bx(6.0, 0.3, 13.0, 0, 13.5, z, 0x39405a));
        }
      }
      return merge(parts);
    },

    lTrackTrain: function (look) { return MARKS.lTrack(look, true); },

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
      // The next bridge downstream, which is where the arches can be seen.
      const sub = [];
      for (let i = 0; i < 4; i++) {
        const z = -30 + i * 20;
        vArc(sub, { cx: 0, cy: -1.4, cz: z, rx: 8.6, ry: 5.2, n: 8, th: 1.1, d: 7.0, color: S, alt: S2 });
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
  function vtoon(steps) {
    const m = S.toon(0xffffff, steps || 2);
    m.vertexColors = true;
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
      paint: new THREE.MeshBasicMaterial({ vertexColors: true }),
      prop: vtoon(2),
      // The roadside furniture gets its own material so a setting can put a
      // little of its own light on the barriers, hedges and parapets without
      // dragging every tree and spectator with it. It only ever multiplies a
      // baked vertex colour, so the tints in SETTING_LOOK all sit near white:
      // this can knock a value down, never lift one.
      edge: vtoon(2),
      propLit: vtoon(3),
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
    const groundMat = S.toon(P.ground, 2);
    groundMat.map = groundTex;
    mats.shoulder.map = vergeTex;
    mats.road.map = roadTex;
    mats.road.vertexColors = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.34;
    ground.renderOrder = -500;
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
    const SEAM_RAIL = 0x8e8aa8;   // L 140 -- was 0xfff6d8, the bead's colour
    const SEAM_BEAD = 0xfff6d8;   // L 245.7
    const EDGE_LINE = 0xf2f4ff;   // L 244.4, unchanged

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
      const nJ = Math.round(TILE / ROAD_SLAB);
      for (let i = 0; i < nJ; i++) {
        // -TILE/2 + i*ROAD_SLAB, with TILE an exact multiple of ROAD_SLAB, so
        // the run continues into the next tile without doubling or drifting.
        const jz = -TILE / 2 + i * ROAD_SLAB;
        const heavy = (i % 4) === 0;
        parts.push(part(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, heavy ? 0.24 : 0.15),
          heavy ? 0x272636 : 0x313040, 0, 0.004, jz, flat));
        parts.push(part(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, heavy ? 0.11 : 0.08),
          heavy ? 0x7b7a81 : 0x73727b, 0, 0.004, jz + (heavy ? 0.18 : 0.12), flat));
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
          parts.push(part(new THREE.PlaneGeometry(0.11, TILE), 0x77728f, lx + s * 0.12, 0.005, 0, flat));
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

    // ---- the overhead layer -----------------------------------------------
    /**
     * Wires, spans and bunting crossing the road -- baked into the ROAD TILE
     * rather than pooled as objects.
     *
     * This is the other half of Subway Surfers' depth and the layer we had
     * least of. Something crosses that game's frame every second or two, at
     * several depths; we had mile gantries every 240 units and nothing between,
     * which is one crossing every nine seconds. Overhead earns its place
     * because it passes CLOSE TO THE LENS and therefore sweeps top-to-bottom
     * fast -- vertical parallax that no amount of ground detail can imitate,
     * however dense the ground gets.
     *
     * Baking it into the tile is what makes it free. Each tile already draws
     * one merged edge mesh per biome, so a mast, a span wire and fifteen
     * bunting pennants cost triangles instead of draw calls. SPAN_Z puts two
     * crossings in every 24-unit tile -- one every 12 units, or roughly every
     * half second at race pace -- and offsets them from the tile boundary so
     * neighbouring tiles never stack two spans in the same place.
     *
     * NOTHING HERE MAY OBSCURE THE NEXT GATE, and the geometry is what
     * guarantees it rather than care. Everything is at or above OVERHEAD_Y.
     * The chase camera sits near y = 2.7 and a gate is read at 40-90 units,
     * where the road is at or below the camera axis; a member at 9.4 units is
     * 9 degrees ABOVE that axis at 40 units and less further out, so it crops
     * the top of the frame and can never come between the lens and a hazard.
     */
    const SPAN_Z = [-6, 6];

    /**
     * The pennant string. Race bunting is the one piece of overhead dressing
     * that is unambiguously about a marathon rather than about a city, so it
     * runs on every biome that gets a span. The flags face back down the course
     * because that is the only face the runner ever sees.
     */
    const BUNTING = [0xff3b6b, 0xffe45e, 0x37d6ff, 0xfffdf5, 0x59d47a];
    function bunting(parts, halfSpan, y, z, n) {
      for (let k = 0; k < n; k++) {
        const fx = -halfSpan + 0.5 + k * ((halfSpan * 2 - 1.0) / (n - 1));
        parts.push(bx(0.44, 0.48, 0.05, fx, y, z, BUNTING[k % BUNTING.length]));
      }
    }

    /**
     * THE CURVED LAMP ARC -- the top-of-frame device, measured off tgr-city.png.
     *
     * Two posts were fitted through a common horizon there: the far one sits at
     * 1.48x the near one's depth, so the spacing is about 0.48x the near lamp's
     * distance. The near post runs 548 px from head to base against a
     * carriageway 310 px wide at the same depth, i.e. THE HEAD STANDS 1.77 ROAD
     * WIDTHS UP. That is an enormous exaggeration -- no real street lamp is
     * anything like it -- and the exaggeration is exactly the point: it is what
     * fills the top of a PORTRAIT frame instead of hugging the kerb, which is
     * the half of the screen this game had almost nothing in.
     *
     * Our tarmac is 2 * TRACK_HALF_WIDTH = 7.50, so 1.77 * 7.50 = 13.3.
     *
     * THE FAIRNESS GUARANTEE IS GEOMETRIC, not a promise. The post stands at
     * |x| = 5.4, which is outside CORRIDOR_HALF (3.75) and inside LANDMARK_IN
     * (11.75) -- roadside furniture, in the same band as the kerb and the aid
     * tables. The arm is a quarter ellipse from the post top (5.4, 9.6) to the
     * head (1.6, 13.3), i.e. centre (1.6, 9.6) with semi-axes 3.8 and 3.7. The
     * FIRST point of it to reach over the corridor is x = 3.75, and there
     *
     *   cos t = (3.75 - 1.6) / 3.8 = 0.566  ->  y = 9.6 + 3.7 * 0.824 = 12.65
     *
     * so the lowest over-corridor point of the whole lamp is 12.65 against an
     * OVERHEAD_Y of 9.0: 3.65 units of clearance, against the 2.0 the spec asked
     * for. Nothing about the arc can intersect a hazard (top 2.80) or the jump
     * arc, and crossings() re-derives that from the built triangles every time
     * tools/shoot.js runs, so it stays true if these numbers are ever retuned.
     *
     * PERIOD: one lamp per road tile, alternating sides, so an arc crosses the
     * frame every TILE = 24 units and each side carries one every 48. At the
     * race pace this build tops out at (~26 u/s) that is an arc a second, and
     * the reference's ~0.48x-near-distance spacing is in the same family. It
     * errs sparse, which is the right way to err against a device this large.
     *
     * COST: 72 triangles per tile -- post 12, arm 4 x 12, head 12. The spec
     * budgeted 22 by assuming a ribbon arm; boxes are used instead because this
     * file has twice lost days to quads that came out wound the wrong way and
     * drew nothing, and 50 triangles a tile is not worth that risk. At ten live
     * tiles the difference is 500 triangles on a 35k-99k frame.
     */
    const LAMP_POST_X = 5.4;
    const LAMP_POST_Y = 9.6;
    const LAMP_HEAD_X = 1.6;
    const LAMP_HEAD_Y = 13.3;    // 1.77 x the 7.50-unit tarmac
    const LAMP_SEGS = 4;
    function lampArc(parts, sx, z, post, head) {
      parts.push(bx(0.26, LAMP_POST_Y, 0.26, sx * LAMP_POST_X, LAMP_POST_Y / 2, z, post));
      const ax = LAMP_POST_X - LAMP_HEAD_X;      // 3.8
      const ay = LAMP_HEAD_Y - LAMP_POST_Y;      // 3.7
      const at = (i) => {
        const t = (i / LAMP_SEGS) * (Math.PI / 2);
        return [sx * (LAMP_HEAD_X + ax * Math.cos(t)), LAMP_POST_Y + ay * Math.sin(t)];
      };
      for (let i = 0; i < LAMP_SEGS; i++) {
        const a = at(i), b = at(i + 1);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        parts.push(bx(Math.hypot(dx, dy) + 0.14, 0.20, 0.20,
          (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z, post, 0, 0, Math.atan2(dy, dx)));
      }
      // The luminaire hangs off the end of the arm, so its top meets the head
      // height rather than straddling it.
      parts.push(bx(0.92, 0.26, 0.44, sx * LAMP_HEAD_X, LAMP_HEAD_Y - 0.13, z, head));
    }

    // Which roadside kinds carry a lamp, and what colour it is. THE BRIDGE is
    // not here because a post at |x| = 5.4 would stand on open water -- the deck
    // ends at 4.75 -- and it already carries lighting portals every 12 units.
    // THE WALL is not here either: it already has a scaffold birdcage over the
    // carriageway at 9.5-10.2, and a second overhead system above that turns the
    // top of the frame into a thicket, which is the exact failure the bracing
    // was removed for.
    const LAMP_EDGES = {
      barrier: [0x2b2f52, 0xffe45e],
      hedge: [0x3a4560, 0xfff2e0],
    };

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
      // City overhead: tram catenary, plus bunting on the second span.
      //
      // The LONGITUDINAL wires are the part that surprised me. Cross-spans give
      // the strobe, but three wires running the whole length of the tile
      // converge on the vanishing point, and that convergence is what actually
      // reads as depth in the reference frames -- a hard perspective line above
      // the road, which nothing else in this scene provides.
      const MX = K.TRACK_HALF_WIDTH + 2.6;   // mast line, just outside the lamps
      for (const wx of [-LANE, 0, LANE]) {
        parts.push(bx(0.07, 0.07, TILE, wx, 9.30, 0, 0x2b2f52));
      }
      for (let i = 0; i < SPAN_Z.length; i++) {
        const sz = SPAN_Z[i];
        const h = i ? 10.1 : 10.9;
        for (const sx of [-1, 1]) {
          parts.push(bx(0.26, h, 0.26, sx * MX, h / 2, sz, 0x2b2f52));
          parts.push(bx(0.95, 0.16, 0.16, sx * (MX - 0.48), h - 0.55, sz, 0x2b2f52));
        }
        parts.push(bx(MX * 2, 0.11, 0.11, 0, 9.74, sz, 0x2b2f52));
        parts.push(bx(MX * 2, 0.07, 0.07, 0, 10.34, sz, 0x3a4570));
        // Droppers, so the span visibly carries the contact wires rather than
        // three wires and a beam happening to be at the same place.
        for (const wx of [-LANE, 0, LANE]) {
          parts.push(bx(0.06, 0.44, 0.06, wx, 9.52, sz, 0x2b2f52));
        }
        if (i) bunting(parts, MX, 9.44, sz + 0.09, 15);
      }
      return parts;
    }

    /** Park/river edge: a clipped hedge, a gravel path and the odd bench. */
    function hedgeParts() {
      const parts = [];
      for (const sx of [-1, 1]) {
        const x = sx * (K.TRACK_HALF_WIDTH + 1.6);
        pavement(parts, sx, 0xd8c9a0, 0xefe3c2, 0xb0a37e);
        parts.push(bx(1.5, 0.78, TILE, x, 0.28, 0, 0x2f9f52));
        parts.push(bx(1.62, 0.16, TILE, x, 0.68, 0, 0x49c96b));
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
        for (let i = 0; i < 2; i++) {
          const tz = -TILE / 2 + 5 + i * 12 + (sx > 0 ? 3 : 0);
          const k = i ? 1.15 : 0.92;
          const tx = sx * (K.TRACK_HALF_WIDTH + 3.4);
          parts.push(cyl(0.20 * k, 0.32 * k, 1.9 * k, 6, tx, 0.95 * k, tz, 0x8a5a3c));
          parts.push(cone(1.55 * k, 2.1 * k, 8, tx, 2.6 * k, tz, 0x2f9f52));
          parts.push(cone(1.20 * k, 1.7 * k, 8, tx, 3.6 * k, tz, 0x3fbf63));
          parts.push(cone(0.82 * k, 1.4 * k, 8, tx, 4.6 * k, tz, 0x59d47a));
        }
      }
      // Park and riverside overhead: bunting on slim poles and nothing else.
      // These legs are meant to feel open, so they get the crossing rhythm
      // without the ironwork the city carries. The poles stand INSIDE the
      // avenue, at the hedge line rather than beyond it, so a mast never grows
      // out of a tree canopy.
      const MX = K.TRACK_HALF_WIDTH + 0.9;
      for (const sz of SPAN_Z) {
        for (const sx of [-1, 1]) {
          parts.push(cyl(0.12, 0.17, 10.0, 6, sx * MX, 5.0, sz, 0xfff2e0));
          parts.push(bx(0.5, 0.14, 0.14, sx * (MX - 0.24), 9.72, sz, 0xfff2e0));
        }
        parts.push(bx(MX * 2, 0.09, 0.09, 0, 9.76, sz, 0xfff2e0));
        bunting(parts, MX, 9.42, sz + 0.08, 11);
      }
      return parts;
    }

    /**
     * One geometry per (roadside kind, lamp side). The lamp has to be baked into
     * the tile's own merge or it is a draw call per live tile -- about a dozen,
     * on a frame that already runs 150-260 -- and the only thing that differs
     * between the two variants is which side the post stands on, so the pair is
     * built once at start-up and the tile picks one by the parity of its index.
     * Both are held on every pooled tile and one is made visible, exactly as the
     * four kinds already were: a biome change stays a visibility flip.
     */
    const LIT_EDGES = {};
    for (const kind in LAMP_EDGES) {
      const build = kind === 'barrier' ? barrierParts : hedgeParts;
      const col = LAMP_EDGES[kind];
      for (const sx of [-1, 1]) {
        const parts = build();
        lampArc(parts, sx, 0, col[0], col[1]);
        LIT_EDGES[kind + (sx < 0 ? 'L' : 'R')] = merge(parts);
      }
    }
    /** The tile variant a given tile index wears. Alternates every TILE. */
    function edgeVariant(kind, tileIdx) {
      if (!LAMP_EDGES[kind]) return kind;
      return kind + (((tileIdx % 2) + 2) % 2 ? 'R' : 'L');
    }

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
      // THE WALL overhead: the scaffold continues over the road. This leg is
      // the one place a birdcage above the carriageway is not a liberty -- the
      // whole conceit is that the runner is passing through a works site -- and
      // it closes the trench at the top as well as at the sides. The boards are
      // deliberately narrow and staggered: a solid deck would drop the light on
      // a leg that is already the darkest in the race.
      const MX = K.TRACK_HALF_WIDTH + 7.6;
      const TUBE = 0x8f8a9c, TUBE2 = 0x6f6a7c;
      for (const tx of [-2.6, 0, 2.6]) {
        parts.push(bx(0.13, 0.13, TILE, tx, 9.78, 0, TUBE));
      }
      for (let i = 0; i < SPAN_Z.length; i++) {
        const sz = SPAN_Z[i];
        for (const sx of [-1, 1]) {
          parts.push(bx(0.24, 10.4, 0.24, sx * MX, 5.2, sz, TUBE));
        }
        parts.push(bx(MX * 2, 0.16, 0.16, 0, 9.52, sz, TUBE));
        parts.push(bx(MX * 2, 0.13, 0.13, 0, 10.24, sz, TUBE2));
        // No diagonal bracing over the carriageway. It was there and it had to
        // go: from a camera at 2.7 looking down a 6-degree slope, canted tubes
        // at 9.9 cross the horizontal ones at every angle at once and the whole
        // top of the frame turned into a thicket of sticks. The verticals,
        // longitudinals and boards give the same crossing rhythm and stay
        // legible as a structure.
        parts.push(bx(3.4, 0.10, 1.6, i ? -3.2 : 3.2, 10.08, sz, 0xc0a878));
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
        for (let i = 0; i < 2; i++) {
          const z = -TILE / 2 + 6 + i * 12;
          parts.push(bx(0.16, 3.4, 0.16, x, 1.7, z, 0x2b2f52));
          parts.push(bx(0.5, 0.24, 0.5, x, 3.5, z, 0xffe45e));
        }
      }
      // Bridge overhead: lighting portals. The deck is the one leg with no
      // roadside at all, so it was also the leg with no crossing rhythm
      // whatever -- a ribbon over open water, and a ribbon over nothing has no
      // speed. The portals are the only structure a suspension deck can
      // honestly carry, and the two runners above them give the same
      // convergence the city wires do.
      const MX = K.TRACK_HALF_WIDTH + 0.78;
      for (const wx of [-LANE * 1.55, LANE * 1.55]) {
        parts.push(bx(0.07, 0.07, TILE, wx, 9.98, 0, 0x2b2f52));
      }
      for (const sz of SPAN_Z) {
        for (const sx of [-1, 1]) {
          parts.push(bx(0.22, 9.7, 0.22, sx * MX, 4.85, sz, 0x2b2f52));
        }
        parts.push(bx(MX * 2, 0.26, 0.26, 0, 9.62, sz, 0x2b2f52));
        parts.push(bx(MX * 2, 0.13, 0.13, 0, 10.14, sz, 0x3a4570));
        for (const lx of [-LANE, LANE]) {
          parts.push(bx(0.34, 0.30, 0.34, lx, 9.32, sz, 0xffe45e));
        }
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
    routeGeo.setAttribute('position', new THREE.BufferAttribute(routePos, 3));
    routeGeo.setAttribute('uv', new THREE.BufferAttribute(routeUvs, 2));
    const routeMesh = new THREE.Mesh(routeGeo, new THREE.MeshBasicMaterial({
      map: routeTexture(),
      color: 0x5ff0a6,          // the one hue no hazard owns; amber, cyan and
      transparent: true,        // red are all spoken for, and green reads "go"
      // Held under the rings: the paint is the connective tissue, the rings are
      // what the eye is meant to land on. At full strength the line reads as a
      // beam being fired down the road rather than as a marking on it.
      opacity: 0.62,
      depthWrite: false,
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
        // Taper away with distance, so the far end thins into the fog rather
        // than stopping on a cut edge in the middle of the road.
        const w0 = ROUTE_W * (1 - 0.5 * (i / ROUTE_SEGS));
        const w1 = ROUTE_W * (1 - 0.5 * ((i + 1) / ROUTE_SEGS));
        const v0 = z0 * ROUTE_UV, v1 = z1 * ROUTE_UV;
        const p = i * 18, u = i * 12;
        // l0, r1, r0 -- then l0, l1, r1.
        routePos[p] = x0 - w0; routePos[p + 1] = 0.010; routePos[p + 2] = z0;
        routePos[p + 3] = x1 + w1; routePos[p + 4] = 0.010; routePos[p + 5] = z1;
        routePos[p + 6] = x0 + w0; routePos[p + 7] = 0.010; routePos[p + 8] = z0;
        routePos[p + 9] = x0 - w0; routePos[p + 10] = 0.010; routePos[p + 11] = z0;
        routePos[p + 12] = x1 - w1; routePos[p + 13] = 0.010; routePos[p + 14] = z1;
        routePos[p + 15] = x1 + w1; routePos[p + 16] = 0.010; routePos[p + 17] = z1;
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
        const cy = RING_Y + Math.sin(now * 1.9 + n * 1.1) * 0.045;
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

    const stripeTex = {
      jump: stripeTexture('#ffb020', '#2b2f52'),
      duck: stripeTexture('#37d6ff', '#0d2b36'),
      block: stripeTexture('#ff3b6b', '#fff2e0'),
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
     *   COLOUR. Amber JUMP, cyan DUCK, pink BLOCK, always, on the mass that
     *     carries the silhouette. One contact ends the record attempt; the hue
     *     is how the kind is known before the shape resolves.
     *   SILHOUETTE CLASS. Low wide mass with a light cap for JUMP; tall thin
     *     verticals with a bar between them for DUCK; a lane-filling wall for
     *     BLOCK. Checked at 40 units in portrait, which is where the lane
     *     decision is actually made.
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
      // emergent property of an ad-hoc modulo. See variantIndex.
      const bag = [];
      defs.forEach(function (d, i) {
        for (let k = 0; k < (d.weight || 1); k++) bag.push(i);
      });
      return Pool(function () {
        const g = new THREE.Group();
        const variants = [];
        for (const d of defs) {
          const vg = new THREE.Group();
          const body = S.outlined(d.geo, mats.propLit, S.INK.hazard);
          vg.add(body);
          const f = new THREE.Mesh(hplane(d.face[0], d.face[1]), faceMat[tint]);
          f.position.set(0, d.face[2], d.face[3]);
          f.rotation.y = Math.PI;
          vg.add(f);
          // The one moving part a variant is allowed: a single extra mesh on
          // its own pivot. Two would be two more draw calls per live hazard.
          if (d.moving) {
            const mv = S.outlined(d.moving, mats.propLit, S.INK.hazard);
            mv.position.set(d.pivot[0] * LANE_FIT, d.pivot[1], d.pivot[2]);
            vg.add(mv);
            vg.userData.moving = mv;
          }
          vg.userData.body = body;
          vg.userData.anim = d.anim || null;
          vg.visible = false;
          g.add(vg);
          variants.push(vg);
        }
        variants[0].visible = true;
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
    }

    // JUMP v0: a wide amber kerb with a cream cap. The cap is what survives the
    // fog -- a light band on a dark road at 100 units is still a light band.
    // Nothing here rises past 0.80 or reaches past halfZ 0.52.
    const jumpGeo = merge([
      hbx(2.24, 0.66, 1.04, 0, 0.33, 0, 0xffb020),
      hbx(2.34, 0.14, 1.04, 0, 0.73, 0, 0xfff2e0),
      hbx(0.30, 0.80, 1.04, -1.16, 0.40, 0, 0xe07f12),
      hbx(0.30, 0.80, 1.04, 1.16, 0.40, 0, 0xe07f12),
    ]);

    /**
     * JUMP v1: traffic cones on a low plinth.
     *
     * The cones are the identity and the PLINTH is the read. At 40 units the
     * whole hazard is about seventeen pixels tall in portrait, and three cones
     * alone would be three amber slivers with road showing between them -- an
     * object you look at rather than a lane you cannot run down. The plinth
     * carries the lane-filling amber mass and the cream cap band, exactly as
     * the kerb does, and the cones sit on top and do the talking once you are
     * close enough for it to be flavour rather than information.
     */
    const jumpConeGeo = (function () {
      const parts = [
        hbx(2.24, 0.22, 1.02, 0, 0.11, 0, 0xffb020),
        hbx(2.34, 0.10, 1.04, 0, 0.27, 0, 0xfff2e0),
        hbx(0.28, 0.32, 1.02, -1.16, 0.16, 0, 0xe07f12),
        hbx(0.28, 0.32, 1.02, 1.16, 0.16, 0, 0xe07f12),
      ];
      for (let i = 0; i < 3; i++) {
        const cx = (-0.76 + i * 0.76) * LANE_FIT;
        parts.push(bx(0.62, 0.09, 0.62, cx, 0.36, 0, 0x2b2f52));
        parts.push(cone(0.30, 0.48, 8, cx, 0.55, 0, 0xff7a1f));
        parts.push(cyl(0.20, 0.23, 0.11, 8, cx, 0.55, 0, 0xfff2e0));
      }
      return merge(parts);
    })();

    /**
     * JUMP v2: a works trench with a low chevron barrier over it. The dark
     * trench mouth under the board is what makes this one read differently at
     * speed -- a hole rather than a lump -- while the amber frame and the cream
     * cap keep it in the same family.
     */
    const jumpWorksGeo = merge([
      hbx(2.24, 0.16, 1.04, 0, 0.08, 0, 0x2b2f52),
      hbx(2.24, 0.34, 1.04, 0, 0.57, 0, 0xffb020),
      hbx(2.36, 0.14, 1.08, 0, 0.73, 0, 0xfff2e0),
      hbx(0.34, 0.80, 0.34, -1.13, 0.40, -0.34, 0xe07f12),
      hbx(0.34, 0.80, 0.34, 1.13, 0.40, -0.34, 0xe07f12),
      hbx(0.34, 0.80, 0.34, -1.13, 0.40, 0.34, 0xe07f12),
      hbx(0.34, 0.80, 0.34, 1.13, 0.40, 0.34, 0xe07f12),
    ]);

    const jumpPool = hazardPool(K.JUMP, 'jump', [
      { geo: jumpGeo, face: [2.2, 0.62, 0.36, -0.531] },
      { geo: jumpConeGeo, face: [2.2, 0.24, 0.16, -0.521] },
      { geo: jumpWorksGeo, face: [2.2, 0.32, 0.57, -0.531] },
    ]);

    /**
     * DUCK: the bar is only 0.42 tall, which is nothing at distance, so the
     * height comes from tall cyan standards rather than from anything spanning
     * the lane.
     *
     * That distinction is not cosmetic, and it constrains every variant. The
     * chase camera trails 5.1 units and carries 42% of the jump arc, so it
     * sweeps y = 1.76 to 3.14 right through a gate's lane. An earlier version
     * had a header board at 2.44 and the camera flew straight into it -- one
     * frame of full-screen cyan stripes. ABOVE THE BAR, ONLY THIN MEMBERS,
     * and only out at the standards, so the worst a clip can ever be is a
     * sliver of post.
     */
    const duckGeo = merge([
      hbx(2.30, 0.30, 0.60, 0, 1.56, 0, 0x37d6ff),
      hbx(2.36, 0.12, 0.62, 0, 1.77, 0, 0xd8f8ff),
      // The standards keep their own thickness -- only where they stand moves.
      // Scaling a 0.26 post down with the lane would have left the tall cyan
      // verticals, which are the whole distance read on a DUCK, as hairlines.
      bxAt(0.26, 3.30, 0.30, -1.20, 1.65, 0, 0x37d6ff),
      bxAt(0.26, 3.30, 0.30, 1.20, 1.65, 0, 0x37d6ff),
      bxAt(0.30, 0.26, 0.34, -1.20, 2.35, 0, 0x0d2b36),
      bxAt(0.30, 0.26, 0.34, 1.20, 2.35, 0, 0x0d2b36),
      bxAt(0.30, 0.26, 0.34, -1.20, 2.90, 0, 0x0d2b36),
      bxAt(0.30, 0.26, 0.34, 1.20, 2.90, 0, 0x0d2b36),
      bxAt(0.40, 0.22, 0.40, -1.20, 3.41, 0, 0xd8f8ff),
      bxAt(0.40, 0.22, 0.40, 1.20, 3.41, 0, 0xd8f8ff),
      bxAt(0.50, 0.22, 0.50, -1.20, 0.11, 0, 0x2b2f52),
      bxAt(0.50, 0.22, 0.50, 1.20, 0.11, 0, 0x2b2f52),
    ]);

    /**
     * DUCK v1: a scaffold gantry over the road. Round standards on base plates,
     * a hazard-boarded ledger where the bar is, and diagonal braces above --
     * every one of them a 0.22 tube out at the standards, so the rule above
     * holds. It is the same shape as v0 built out of different stock, which is
     * the point: the distance read must not change.
     */
    const duckScaffoldGeo = (function () {
      const parts = [
        hbx(2.30, 0.34, 0.58, 0, 1.58, 0, 0x37d6ff),
        hbx(2.38, 0.12, 0.60, 0, 1.79, 0, 0xd8f8ff),
        hbx(2.24, 0.10, 0.44, 0, 1.44, 0, 0x1f9fd0),
      ];
      for (const sx of [-1, 1]) {
        parts.push(cyl(0.15, 0.15, 3.34, 8, sx * 1.20 * LANE_FIT, 1.67, 0, 0x37d6ff));
        parts.push(cyl(0.19, 0.19, 0.16, 8, sx * 1.20 * LANE_FIT, 2.42, 0, 0x0d2b36));
        parts.push(cyl(0.19, 0.19, 0.16, 8, sx * 1.20 * LANE_FIT, 3.02, 0, 0x0d2b36));
        parts.push(bx(0.56, 0.14, 0.56, sx * 1.20 * LANE_FIT, 0.07, 0, 0x2b2f52));
        parts.push(bx(0.42, 0.20, 0.42, sx * 1.20 * LANE_FIT, 3.38, 0, 0xd8f8ff));
        // Kicker braces. Canted, but the cant is 0.12 and the foot is pulled
        // INSIDE the standard, because the number that matters is how far the
        // widest point reaches from the lane centre: 1.02, which is inside the
        // 1.068 the existing cap already reaches, so a runner jumping in the
        // NEXT lane cannot graze a brace on this one.
        parts.push(bx(0.15, 1.5, 0.15, sx * (1.20 * LANE_FIT - 0.02), 2.70, 0,
          0x1f9fd0, 0, 0, sx * 0.12));
      }
      return merge(parts);
    })();

    /**
     * DUCK v2: a height-restriction sign gantry. The bar becomes a deeper cyan
     * sign board banded top and bottom in cream, and each standard carries a
     * sign roundel. A round mark is the one shape no telegraph mat uses, so it
     * never argues with the rungs painted on the road in front of it.
     */
    const duckSignGeo = (function () {
      const parts = [
        hbx(2.30, 0.42, 0.56, 0, 1.62, 0, 0x37d6ff),
        hbx(2.38, 0.10, 0.58, 0, 1.81, 0, 0xd8f8ff),
        hbx(2.38, 0.08, 0.58, 0, 1.43, 0, 0xd8f8ff),
      ];
      for (const sx of [-1, 1]) {
        const px = sx * 1.20 * LANE_FIT;
        parts.push(bx(0.28, 3.30, 0.28, px, 1.65, 0, 0x37d6ff));
        // The roundel goes on the POST, not on the bar. On the bar it had to
        // sit 0.35 in front of the gate line to clear the board -- past the
        // halfZ the collision box records -- and the striped face covered it
        // regardless. At 0.87 out it is clear of the runner's glove swing
        // (0.543) and nowhere near the lane centre the camera flies down.
        parts.push(cyl(0.20, 0.20, 0.09, 12, px, 2.30, -0.20, 0xfff2e0, Math.PI / 2));
        parts.push(bx(0.36, 0.18, 0.36, px, 2.86, 0, 0x0d2b36));
        parts.push(bx(0.30, 0.44, 0.30, px, 3.14, 0, 0x1f9fd0));
        parts.push(bx(0.40, 0.24, 0.40, px, 3.44, 0, 0xd8f8ff));
        parts.push(bx(0.54, 0.24, 0.54, px, 0.12, 0, 0x2b2f52));
      }
      return merge(parts);
    })();

    const duckPool = hazardPool(K.DUCK, 'duck', [
      { geo: duckGeo, face: [2.26, 0.40, 1.62, -0.302] },
      { geo: duckScaffoldGeo, face: [2.26, 0.36, 1.58, -0.292] },
      { geo: duckSignGeo, face: [2.26, 0.34, 1.62, -0.282] },
    ]);

    // BLOCK v0: a barricaded works truck. Trains scale it along z, so every
    // baked feature is either a horizontal band or sits at the front face,
    // which the scale leaves in place -- and it is the ONLY variant a train is
    // ever allowed to use, for exactly that reason.
    const blockGeo = merge([
      hbx(2.10, 2.30, 1.30, 0, 1.50, 0, 0xff3b6b),
      hbx(2.20, 0.44, 1.30, 0, 0.22, 0, 0x2b2f52),
      hbx(2.24, 0.26, 1.34, 0, 2.24, 0, 0xfff2e0),
      hbx(2.20, 0.20, 1.34, 0, 2.70, 0, 0xd42a55),
      bxAt(0.34, 0.34, 0.34, -0.72, 2.92, 0, 0xffe45e),
      bxAt(0.34, 0.34, 0.34, 0.72, 2.92, 0, 0xffe45e),
    ]);

    /** BLOCK v1: a ROAD CLOSED hoarding on a solid plinth. */
    const blockSignGeo = merge([
      hbx(2.20, 0.52, 1.30, 0, 0.26, 0, 0x2b2f52),
      hbx(2.12, 2.00, 1.06, 0, 1.56, 0, 0xff3b6b),
      hbx(2.26, 0.16, 1.14, 0, 0.72, 0, 0xfff2e0),
      hbx(2.26, 0.16, 1.14, 0, 1.60, 0, 0xfff2e0),
      hbx(2.26, 0.16, 1.14, 0, 2.44, 0, 0xfff2e0),
      hbx(2.28, 0.24, 1.20, 0, 2.68, 0, 0xd42a55),
      bxAt(0.34, 0.34, 0.34, -0.74, 2.92, 0, 0xffe45e),
      bxAt(0.34, 0.34, 0.34, 0.74, 2.92, 0, 0xffe45e),
    ]);

    /**
     * BLOCK v2: A CARGO TRIKE, RIDDEN, IN A LANE. The player asked for cyclists
     * on the road as obstacles, and this is what makes that safe to grant.
     *
     * It is a K.BLOCK and nothing else: the lane it occupies is fixed by the
     * course, so "there is always a way around" is not something this file has
     * to be careful about -- course.js proves by BFS that a lane path exists
     * from gun to tape, validate() re-checks it and tools/course-test.js
     * verifies it across dates. A BLOCK that looks like a cyclist is covered by
     * exactly the same proof as a BLOCK that looks like a barrier. Nothing here
     * may ever change lane over time, because that would break the proof, and
     * the proof is the reason the game is fair.
     *
     * WHY A TRIKE AND NOT A BICYCLE. A road cyclist is 1.75 tall and about a
     * third of a lane wide, and the jump apex is 2.05: a rider on a two-wheeler
     * reads as something you could hurdle, which is the exact complaint state
     * thresholds exist to prevent. A cargo trike fills the lane, carries the
     * pink mass and the cream band the other BLOCKs use, and its tailboard is
     * where the caution-striped face goes -- it rides away from the runner, so
     * the back of the box is the face already turned toward the lens.
     *
     * THE BOX HAS TO STAY LOW, and the first version got this wrong. At 1.68 it
     * was taller than the rider was visible above it, so from directly behind
     * -- which is the ONLY angle this game has -- the whole thing read as a
     * striped barrier on wheels and the cyclist was invisible. The box now tops
     * out at 1.28 and the rider runs 1.28 to 2.42, so a back, a head and a
     * helmet clear it by a wide margin: at a camera height of 2.7 the sightline
     * over the box corner passes 0.3 units above the rider's chest.
     *
     * The two pennant masts do the rest. They take the silhouette to 2.72 --
     * clear of the 2.05 jump apex -- and they fill the upper outer corners of
     * the lane that a lone rider leaves open, so nothing about the shape
     * invites a hurdle. Utility bikes really do carry them, which is the whole
     * reason this reads as a vehicle rather than as a prop.
     */
    const blockTrikeGeo = (function () {
      const parts = [
        // Cargo box: the lane-filling mass, in BLOCK pink with the cream band.
        hbx(2.02, 1.02, 1.20, 0, 0.72, 0.02, 0xff3b6b),
        hbx(2.10, 0.15, 1.24, 0, 1.28, 0.02, 0xfff2e0),
        hbx(2.06, 0.20, 1.26, 0, 0.20, 0.02, 0xd42a55),
        /**
         * THE RIDER, resized and revalued after a full playtest in which the
         * player reported seeing no cyclist at all.
         *
         * Two things were wrong and neither was the pose. First SIZE: the old
         * torso was 0.51 world units wide and the head 0.26, which at the 50
         * units a lane is chosen at is six pixels and three. Nothing legible
         * about a human being survives three pixels. Second and worse, VALUE:
         * the torso was 0xff3b6b -- the cargo box's own colour -- so the one
         * part big enough to see had no edge against the thing it was sitting
         * on, and the figure was a bump on a barrier rather than a person.
         *
         * The rule the rebuild follows is that the background CHANGES up the
         * figure. From the chase camera the torso is seen against the box and
         * the far road, both pale; the head and helmet are seen against sky,
         * paler still. So the body is dark navy -- the darkest thing in the
         * scene, unmissable against either -- with one broad cream hi-vis band
         * where the eye lands, and the helmet stays BLOCK pink so the top of
         * the silhouette still says "impassable" before the shape resolves.
         *
         * Top of the helmet is 2.72, which is the pennant height this variant
         * has always had and still inside the 2.80 the collision box records.
         */
        // The cream starts AT the box line: only 0.17 of dark back shows above
        // the cargo box, so what clears it is a hi-vis torso and a head rather
        // than a dark lump with a head on it. Tested at 45 units against the
        // marshals, whose visible half is exactly this and reads first time.
        hbx(1.14, 0.24, 0.56, 0, 1.42, 0.86, 0x2b2f52),
        hbx(1.22, 0.54, 0.58, 0, 1.81, 0.86, 0xfff2e0),
        hbx(1.10, 0.10, 0.54, 0, 2.13, 0.86, 0x2b2f52),
        hbx(0.60, 0.48, 0.50, 0, 2.44, 0.90, 0xffc79a),
        hbx(0.70, 0.22, 0.60, 0, 2.61, 0.90, 0xff3b6b),
        // Arms down onto the bars, which is what puts a lean in the shape.
        hbx(0.22, 0.62, 0.20, -0.62, 1.56, 1.06, 0x2b2f52, 0.34),
        hbx(0.22, 0.62, 0.20, 0.62, 1.56, 1.06, 0x2b2f52, 0.34),
        hbx(0.98, 0.12, 0.12, 0, 1.28, 1.24, 0x2b2f52),
      ];
      // Wheels. Seen from directly behind they are slabs rather than discs, so
      // they are built as discs on an x axis and read as tyres under the box.
      for (const wx of [-0.86, 0.86]) {
        parts.push(cyl(0.34, 0.34, 0.16, 10, wx * LANE_FIT, 0.34, 0.20, 0x2b2f52, 0, 0, Math.PI / 2));
      }
      parts.push(cyl(0.32, 0.32, 0.12, 10, 0, 0.32, 1.32, 0x2b2f52, 0, 0, Math.PI / 2));
      // Safety pennants, one each side.
      for (const sx of [-1, 1]) {
        parts.push(bxAt(0.11, 1.56, 0.11, sx * 0.92, 1.94, 0.02, 0xfff2e0));
        parts.push(bxAt(0.09, 0.74, 0.58, sx * 0.92, 2.34, 0.32, 0xff3b6b));
      }
      return merge(parts);
    })();
    /**
     * The pedalling half -- now KNEES either side of the rider, not cranks.
     *
     * The cranks were correct and invisible. They sat at z = 0.92, which is
     * further from the lens than the cargo box's far face at 0.62, so the one
     * moving part on the one hazard that was supposed to feel alive was
     * occluded by its own vehicle for the whole approach. Nothing else static
     * on this road moves, so losing that was expensive.
     *
     * Knees orbiting a bottom bracket at (±0.50, 1.30, 0.55) sweep from 0.90 to
     * 1.70 in y. The box tops out at 1.355, so each knee RISES INTO VIEW above
     * it and drops back out of sight, alternately, which is exactly what a
     * rider seen from directly behind looks like and is a far stronger signal
     * than a wheel or a crank at this distance. Cream shoe caps carry it, and
     * they are outboard of the 0.82-wide torso so the rider never hides them.
     */
    const blockTrikeCrankGeo = merge([
      bx(0.30, 0.40, 0.28, -0.50, 0.40, 0, 0x2b2f52),
      bx(0.34, 0.16, 0.32, -0.50, 0.60, 0.04, 0xfff2e0),
      bx(0.30, 0.40, 0.28, 0.50, -0.40, 0, 0x2b2f52),
      bx(0.34, 0.16, 0.32, 0.50, -0.60, 0.04, 0xfff2e0),
    ]);

    /**
     * BLOCK v3: MARSHALS ACROSS THE LANE. The other half of the same request --
     * pedestrians crossing the road -- and the same guarantee: a fixed-lane
     * K.BLOCK, never a mover.
     *
     * The striped face is the board they hold across the lane, which is why
     * this variant can be made of people at all: a person is not a wall, but a
     * person holding a hazard-boarded barrier across a lane is, and it is what
     * a real closed course actually looks like. The stop paddle waves, which is
     * the one animated part it gets.
     */
    const blockCrossGeo = (function () {
      const parts = [];
      // The barrier they are holding. Deliberately BELOW chest height: at 1.55
      // it hid both hi-vis tabards and left two pale heads floating over a
      // board, which is neither a person nor a barrier. At 1.28 the pink
      // torsos read above it and the pair reads as people holding something.
      parts.push(hbx(2.16, 0.56, 0.18, 0, 0.98, -0.54, 0xff3b6b));
      parts.push(hbx(2.24, 0.12, 0.20, 0, 1.30, -0.54, 0xfff2e0));
      parts.push(hbx(2.24, 0.12, 0.20, 0, 0.66, -0.54, 0xfff2e0));
      /**
       * The pair, rebuilt for the same reason the trike's rider was: a player
       * who ran the whole race did not report two marshals they could not make
       * out, they reported seeing nobody.
       *
       * The old torso was 0xff3b6b, the board's own colour, so from behind the
       * two figures had no edge against the thing they were holding and the
       * whole variant collapsed into "striped barrier with lumps". They are now
       * dark navy with a broad cream hi-vis tabard -- the same value ladder the
       * trike's rider uses, and for the same reason: everything they are seen
       * against up there is pale. Caps are BLOCK pink so the top of each
       * silhouette still carries the hazard hue.
       *
       * They are also bigger and further apart: 0.56 world units of shoulder
       * each, set at +/-0.46 so the pair spans the lane and reads as TWO
       * people rather than one mass. Different heights, because two identical
       * figures read as a repeated prop.
       */
      const who = [
        { x: -0.64, skin: 0xffc79a, z: 0.16, h: 0.00 },
        { x: 0.60, skin: 0xb87a4e, z: 0.44, h: -0.09 },
      ];
      for (const p of who) {
        const px = p.x * LANE_FIT;
        const y = p.h;
        // The ladder, bottom to top: dark waist, cream hi-vis, dark collar,
        // skin head, pink cap. Rear faces sit in the toon ramp's dark band --
        // measured, 0x2b2f52 renders near 0x111737 and 0xfff2e0 near 0x848f9d --
        // so alternating dark and light is worth several times what a hue
        // change is up here, and the dark collar is specifically what keeps the
        // head from melting into the tabard at forty units.
        parts.push(bx(0.50, 0.86, 0.34, px, 0.43, p.z, 0x2b2f52));
        parts.push(bx(0.80, 0.32, 0.44, px, 1.34 + y, p.z, 0x2b2f52));
        parts.push(bx(0.86, 0.40, 0.46, px, 1.70 + y, p.z, 0xfff2e0));
        parts.push(bx(0.76, 0.10, 0.42, px, 1.95 + y, p.z, 0x2b2f52));
        parts.push(bx(0.54, 0.48, 0.46, px, 2.24 + y, p.z, p.skin));
        parts.push(bx(0.62, 0.20, 0.52, px, 2.44 + y, p.z, 0xff3b6b));
        // Arms forward onto the barrier, which is what makes them its holders
        // rather than two figures that happen to be standing behind it.
        parts.push(bx(0.19, 0.70, 0.19, px - 0.40, 1.28 + y, p.z - 0.34, 0x2b2f52, 0.62));
        parts.push(bx(0.19, 0.70, 0.19, px + 0.40, 1.28 + y, p.z - 0.34, 0x2b2f52, 0.62));
      }
      return merge(parts);
    })();
    /** The stop paddle, on its own pivot at the marshal's hand. */
    const blockPaddleGeo = merge([
      bx(0.11, 1.44, 0.11, 0, 0.72, 0, 0xfff2e0),
      cyl(0.42, 0.42, 0.10, 12, 0, 1.58, -0.07, 0xff3b6b, Math.PI / 2),
      bx(0.54, 0.15, 0.12, 0, 1.58, -0.14, 0xfff2e0),
    ]);

    // The two INHABITED skins carry double weight. A player who ran the whole
    // race reported never seeing a cyclist or a marshal at all: at even odds
    // they were about a tenth of the gates, and the course has since got harder
    // in a way that spawns fewer BLOCKs still (a full-width gate never carries
    // one). Two thirds living is what makes the road read as a city closed for
    // a race rather than a corridor of street furniture, and it costs nothing
    // -- every variant is built and parented once either way.
    const blockPool = hazardPool(K.BLOCK, 'block', [
      { geo: blockGeo, face: [2.06, 1.9, 1.42, -0.661], weight: 1 },
      { geo: blockSignGeo, face: [2.06, 1.7, 1.58, -0.541], weight: 1 },
      {
        geo: blockTrikeGeo, face: [1.98, 0.86, 0.74, -0.591], weight: 2,
        // Bottom bracket lifted to the box line and pulled forward of its far
        // face, so the knees break the box's top edge instead of pedalling
        // behind it. See blockTrikeCrankGeo.
        moving: blockTrikeCrankGeo, pivot: [0, 1.30, 0.55], anim: 'pedal',
      },
      {
        geo: blockCrossGeo, face: [2.10, 0.50, 0.98, -0.655], weight: 2,
        // Dropped 0.20 so the roundel's top lands exactly on the 2.80 the
        // collision box records for a BLOCK rather than 0.20 over it.
        moving: blockPaddleGeo, pivot: [0.92, 0.80, 0.30], anim: 'paddle',
      },
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
          // Same span the body is stretched by, so a six-unit train drags its
          // whole length of shadow instead of a disc at the cab.
          const span = (kind === K.BLOCK && g.gate.train) ? 1 + g.gate.train * 0.9 : 1;
          const z0 = g.gate.z - box.halfZ - SHADOW_SPREAD;
          const z1 = g.gate.z + box.halfZ * (2 * span - 1) + SHADOW_SPREAD;
          const cx = K.LANE_X[l];
          // LANE_W, never a difference of LANE_X.
          const hx = LANE * 0.5 + SHADOW_SPREAD;
          const p = n * 18;
          pos[p] = cx - hx; pos[p + 1] = SHADOW_Y; pos[p + 2] = z0;
          pos[p + 3] = cx - hx; pos[p + 4] = SHADOW_Y; pos[p + 5] = z1;
          pos[p + 6] = cx + hx; pos[p + 7] = SHADOW_Y; pos[p + 8] = z1;
          pos[p + 9] = cx - hx; pos[p + 10] = SHADOW_Y; pos[p + 11] = z0;
          pos[p + 12] = cx + hx; pos[p + 13] = SHADOW_Y; pos[p + 14] = z1;
          pos[p + 15] = cx + hx; pos[p + 16] = SHADOW_Y; pos[p + 17] = z0;
          n++;
        }
      }
      shadowGeo.setDrawRange(0, n * 6);
      shadowGeo.attributes.position.needsUpdate = true;
    }

    /**
     * Which skin a gate wears. Derived from the gate's own z and lane, so it is
     * a property of the course -- identical for every player on the same day,
     * exactly like the course itself -- and costs no storage.
     *
     * The old form was `(round(z)*7 + lane*3 + round(z/37)) % n`, and it was not
     * a hash: with n = 4 the first term collapses to 3*round(z) mod 4, the last
     * term walks slowly and correlates with the first, and gate z is not
     * uniform mod 4 either -- spacing runs 46 units early and 24 late. Counted
     * over a real course it gave the four BLOCK skins 36 / 25 / 11 / 18, so the
     * rarest was under a third of the commonest and it was the cyclist. This is
     * a proper 32-bit avalanche instead, which puts consecutive gates in
     * unrelated buckets, and it draws from a weighted BAG rather than modulo n
     * so a variant's share is something this file states rather than discovers.
     *
     * A train is always variant 0. It is the only BLOCK body authored to be
     * stretched along z (see blockGeo), and a six-unit cargo trike would be a
     * joke rather than an obstacle.
     */
    function variantIndex(bag, gate, lane) {
      if (gate.train) return 0;
      // Quarter units, so two gates a fraction apart cannot land on the same
      // key, and imul throughout because the products overflow 2^31.
      let h = (Math.round(gate.z * 4) + lane * 0x9e37) | 0;
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
      h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
      h = (h ^ (h >>> 16)) >>> 0;
      return bag[h % bag.length];
    }

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
    const treePools = SETS.map(function (st) {
      const parts = [];
      vTree(parts, st.look.tree, 1);
      const geo = merge(parts);
      return Pool(function () { return S.outlined(geo, mats.prop, S.INK.prop); }, group);
    });
    const grovePools = SETS.map(function (st) {
      return [5, 29, 97].map(function (seed) {
        const geo = groveGeo(seed, st.look.tree);
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
     * A knot of spectators, merged. Individual capsules read as pills and cost
     * a draw each; eight little figures with legs, raised arms and different
     * shirts cost the same one draw and read as a crowd.
     */
    function crowdGeo(seed) {
      const parts = [];
      const shirts = [0xff4d5e, 0x37d6ff, 0xffe45e, 0x59d47a, 0xff9ad5, 0xfff2e0, 0xffb020, 0x9a7bff];
      const skins = [0xffc79a, 0xe0a173, 0xb87a4e, 0x8a5a3c];
      let s = seed * 9301 + 49297;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const signs = [0xffe45e, 0xfffdf5, 0x37d6ff, 0xff9ad5];
      for (let i = 0; i < 9; i++) {
        const x = -1.5 + (i % 3) * 1.15 + r() * 0.35;
        const z = -2.6 + Math.floor(i / 3) * 2.4 + r() * 0.9;
        const h = 1.02 + r() * 0.26;
        const shirt = shirts[Math.floor(r() * shirts.length)];
        const skin = skins[Math.floor(r() * skins.length)];
        parts.push(bx(0.32, 0.60 * h, 0.24, x, 0.30 * h, z, 0x2b2f52));
        parts.push(bx(0.46, 0.62 * h, 0.32, x, 0.92 * h, z, shirt));
        parts.push(bx(0.28, 0.28, 0.26, x, 1.38 * h, z, skin));
        parts.push(bx(0.30, 0.10, 0.28, x, 1.52 * h, z, 0x3a2b46));
        // Arms up, or holding a placard -- a still crowd looks dead, and the
        // placards are what read as "spectators" at the distance the figures
        // themselves have collapsed to two pixels.
        if (i % 3 === 0) {
          parts.push(bx(0.12, 0.56, 0.12, x - 0.30, 1.22 * h, z, skin, 0, 0, 0.32));
          parts.push(bx(0.12, 0.56, 0.12, x + 0.30, 1.22 * h, z, skin, 0, 0, -0.32));
        } else if (i % 4 === 1) {
          parts.push(bx(0.12, 0.70, 0.12, x + 0.26, 1.35 * h, z, skin));
          parts.push(bx(0.10, 0.9, 0.10, x + 0.26, 1.9 * h, z, 0x8a5a3c));
          parts.push(bx(0.86, 0.62, 0.08, x + 0.26, 2.45 * h, z, signs[Math.floor(r() * signs.length)]));
        } else {
          parts.push(bx(0.12, 0.46, 0.12, x - 0.28, 0.92 * h, z, shirt));
          parts.push(bx(0.12, 0.46, 0.12, x + 0.28, 0.92 * h, z, shirt));
        }
      }
      return merge(parts);
    }
    const crowdGeos = [crowdGeo(3), crowdGeo(17), crowdGeo(41), crowdGeo(88)];
    const crowdPool = crowdGeos.map((geo) => Pool(function () {
      return S.outlined(geo, mats.prop, S.INK.prop);
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
    function walkersGeo(seed) {
      const parts = [];
      // Deliberately no hazard hues -- see above.
      const coats = [0x3f6fbf, 0x2f9f72, 0xf6f2e0, 0x7a5a9a, 0x8a5a3c, 0x4fb0c8];
      const skins = [0xffc79a, 0xe0a173, 0xb87a4e, 0x8a5a3c];
      let s = seed * 9301 + 49297;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const n = 3 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const x = -1.1 + r() * 2.2;
        const z = -1.8 + i * 1.5 + r() * 0.7;
        const h = 1.0 + r() * 0.22;
        const coat = coats[Math.floor(r() * coats.length)];
        const skin = skins[Math.floor(r() * skins.length)];
        // Mid-stride: one leg forward, one back. A figure with its feet
        // together reads as standing however much the group is moving, and
        // "standing beside the road" is what the crowd knots already say.
        parts.push(bx(0.17, 0.62 * h, 0.19, x - 0.11, 0.31 * h, z + 0.16, 0x2b2f52, -0.30));
        parts.push(bx(0.17, 0.62 * h, 0.19, x + 0.11, 0.31 * h, z - 0.16, 0x2b2f52, 0.30));
        parts.push(bx(0.48, 0.64 * h, 0.34, x, 0.94 * h, z, coat));
        parts.push(bx(0.30, 0.30, 0.28, x, 1.41 * h, z, skin));
        parts.push(bx(0.32, 0.11, 0.30, x, 1.56 * h, z, 0x3a2b46));
        parts.push(bx(0.12, 0.50, 0.12, x - 0.30, 0.98 * h, z - 0.14, coat, 0.34));
        parts.push(bx(0.12, 0.50, 0.12, x + 0.30, 0.98 * h, z + 0.14, coat, -0.34));
        // A bag, a dog or nothing: three silhouettes rather than one repeated.
        if (i % 3 === 1) {
          parts.push(bx(0.26, 0.30, 0.20, x + 0.38, 0.76 * h, z + 0.20, 0xf6f2e0));
        } else if (i % 3 === 2) {
          parts.push(bx(0.22, 0.24, 0.56, x + 0.62, 0.30, z + 0.10, 0xe0c69a));
          parts.push(bx(0.20, 0.22, 0.22, x + 0.62, 0.46, z - 0.20, 0xe0c69a));
          parts.push(bx(0.09, 0.30, 0.09, x + 0.62, 0.15, z + 0.28, 0xc9a97a));
        }
      }
      return merge(parts);
    }
    const walkersGeos = [walkersGeo(11), walkersGeo(23), walkersGeo(59)];
    const walkersPool = walkersGeos.map((geo) => Pool(function () {
      return S.outlined(geo, mats.prop, S.INK.prop);
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
    const waterPool = Pool(function () {
      const o = S.outlined(waterGeo, mats.propLit, S.INK.prop);
      o.userData.notScenery = true;
      return o;
    }, group);
    const bananaPool = Pool(function () {
      const o = S.outlined(bananaGeo, mats.propLit, S.INK.prop);
      o.userData.notScenery = true;
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
     * Grandstand: stepped seating packed with spectators, for FINAL MILE.
     * Built on +x and rotated a half-turn for the other side rather than
     * mirrored with a negative scale, which would invert its normals.
     */
    const standGeo = (function () {
      const parts = [];
      const shirts = [0xff4d5e, 0x37d6ff, 0xffe45e, 0x59d47a, 0xff9ad5, 0xffb020];
      let s = 7717;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let row = 0; row < 5; row++) {
        const y = row * 0.74;
        const x = 0.9 + row * 1.10;
        parts.push(bx(1.10, 0.74, TILE, x, y + 0.37, 0, row % 2 ? 0x8e99c6 : 0x6f7aa8));
        for (let i = 0; i < 11; i++) {
          const z = -TILE / 2 + 1.2 + i * 2.15 + r() * 0.5;
          parts.push(bx(0.40, 0.48, 0.28, x - 0.1, y + 0.98, z, shirts[Math.floor(r() * shirts.length)]));
          parts.push(bx(0.22, 0.22, 0.20, x - 0.1, y + 1.33, z, 0xffc79a));
        }
      }
      for (const z of [-TILE / 2 + 1, TILE / 2 - 1]) {
        parts.push(bx(0.28, 7.2, 0.28, 0.2, 3.6, z, 0x2b2f52));
        parts.push(bx(0.14, 1.7, 2.3, 0.2, 6.4, z, z < 0 ? 0xff3b6b : 0x37d6ff));
      }
      return merge(parts);
    })();
    const standPool = Pool(function () {
      return S.outlined(standGeo, mats.prop, S.INK.scenery);
    }, group);

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
      // Containers on the quay, which is what makes it a quay.
      const box = [0x37d6ff, 0xff9ad5, 0x59d47a];
      for (let i = 0; i < 3; i++) {
        parts.push(bx(6.4, 2.7, 2.7, -8 + (i % 2) * 3, 1.35 + Math.floor(i / 2) * 2.8,
          -8 - i * 0.6, box[i]));
      }
      return merge(parts);
    })();

    /**
     * A ship. On the river in RIVERSIDE, and out on the open water under THE
     * BRIDGE, where it is the only thing that gives the drop below the deck a
     * scale. Waterline is local y = 0, so the caller sets the height from
     * whatever the water is doing at that z.
     */
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
      const box = [0x37d6ff, 0xff4d5e, 0x59d47a, 0xffe45e, 0x9a7bff];
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
      const green = [0x2f9f52, 0x35a855, 0x3fbf63, 0x59d47a];
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
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        parts.push(sph(b[3], 7, b[0], b[1], b[2], green[i % green.length]));
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
          Math.cos(a) * rad, 0.6, Math.sin(a) * rad, r() > 0.5 ? 0x2f9f52 : 0x8f9a3e));
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
     * motorway has, it now belongs to the same overhead layer as the catenary
     * and the footbridges instead of floating in its own band, and it sweeps
     * top-to-bottom past the lens rather than across the middle of the frame.
     */
    const BANNER_CHORD = OVERHEAD_Y + 0.35;      // lowest member over the road
    const TRUSS_LIFT = BANNER_CHORD - 3.50;      // 3.50 was the old chord bottom
    const bannerFrameGeo = (function () {
      const parts = [];
      const legTop = 5.95 + TRUSS_LIFT + 0.25;
      for (const sx of [-1, 1]) {
        parts.push(bx(0.42, legTop, 0.42, sx * GANTRY, legTop / 2, 0, 0x2b2f52));
        parts.push(bx(0.90, 0.30, 0.90, sx * GANTRY, 0.15, 0, 0x1b1633));
        parts.push(bx(0.30, 0.30, 1.8, sx * GANTRY, 5.4 + TRUSS_LIFT, 0, 0x2b2f52, 0, 0, 0));
      }
      parts.push(bx(GANTRY * 2 + 0.4, 0.40, 0.40, 0, 5.95 + TRUSS_LIFT, 0, 0x2b2f52));
      parts.push(bx(GANTRY * 2 + 0.4, 0.30, 0.30, 0, 3.65 + TRUSS_LIFT, 0, 0x2b2f52));
      for (let i = -4; i <= 4; i++) {
        parts.push(bx(0.16, 2.4, 0.16, i * (GANTRY - 0.6) / 4, 4.8 + TRUSS_LIFT, 0, 0x3a4570, 0, 0, i % 2 ? 0.45 : -0.45));
      }
      parts.push(part(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, 0.7), 0xfffdf5, 0, 0.011, 0, -Math.PI / 2));
      return merge(parts);
    })();

    const bannerPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(bannerFrameGeo, mats.prop, S.INK.banner));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(GANTRY * 2 - 0.6, 2.1), mat);
      panel.position.y = 4.78 + TRUSS_LIFT; panel.rotation.y = Math.PI;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(GANTRY * 2 - 0.6, 2.1), mat);
      back.position.y = 4.78 + TRUSS_LIFT;
      g.add(back);
      g.userData.panel = panel;
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
    const archGeo = (function () {
      const L = ARCH_LIFT;
      const legTop = 8.7 + L + 0.65;
      return merge([
        bx(1.5, legTop, 1.5, -ARCH, legTop / 2, 0, 0xff3b6b),
        bx(1.5, legTop, 1.5, ARCH, legTop / 2, 0, 0xff3b6b),
        bx(2.3, 0.6, 2.3, -ARCH, 0.3, 0, 0x1b1633),
        bx(2.3, 0.6, 2.3, ARCH, 0.3, 0, 0x1b1633),
        bx(ARCH * 2 + 2.4, 1.3, 1.6, 0, 8.7 + L, 0, 0xff3b6b),
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
      panel.position.y = 7.45 + ARCH_LIFT; panel.rotation.y = Math.PI;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(ARCH * 2 + 0.6, 2.4), mat);
      back.position.y = 7.45 + ARCH_LIFT;
      g.add(back);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(ARCH * 2 + 0.6, 0.55), new THREE.MeshBasicMaterial({ map: checkTex }));
      // Nudged clear of the chord it hangs under so its own lower edge stays
      // above OVERHEAD_Y too -- a 0.55 band centred on the chord would dip
      // 0.02 under it, which is exactly the sort of thing the audit exists for.
      band.position.set(0, 6.28 + ARCH_LIFT, 0.1); band.rotation.y = Math.PI;
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
        for (let z = b.from + 90; z < b.to - 40; z += 168) structures.push({ z, kind: 'overpass', set: 0 });
        // One placed by hand: you go under it and the mile 20 gantry is
        // waiting on the far side. Mile 20 is where a marathon breaks people,
        // and the course should stage it rather than merely label it.
        structures.push({ z: 20 * K.UNITS_PER_MILE - 34, kind: 'overpass', set: 0 });
      }
      if (b.name === 'FINAL MILE') {
        for (let z = b.from; z < K.TOTAL_UNITS + 30; z += TILE) {
          structures.push({ z, kind: 'stand', side: -1, set: 0 });
          structures.push({ z, kind: 'stand', side: 1, set: 0 });
        }
      }
    }

    // Under the bridge the water is WATER_DROP below the road, so the ships sit
    // there rather than at zero -- and being able to see how far down that is,
    // on an object of known size, is the whole reason they are out there. They
    // are also the only objects on this leg: with the shoulders gone the deck
    // is a ribbon over an empty plane, and a ribbon over nothing has no speed.
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

    /** Keep a spanning piece clear of the mile gantries, which are every 240. */
    function nudgeOver(z) {
      const m = Math.round(z / K.UNITS_PER_MILE) * K.UNITS_PER_MILE;
      return Math.abs(z - m) < 32 ? m + (z < m ? -32 : 32) : z;
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

      // Keep the ground under the runner; the sky dome likewise, so the
      // gradient never slides off as the race progresses.
      const lift = deckLift(z);
      ground.position.z = z;
      ground.position.y = -0.34 - WATER_DROP * lift;
      sky.position.z = z;
      hills.position.z = z;
      // On the bridge there is no land to see, only water to the horizon.
      hills.visible = lift < 0.6;
      ripples.visible = lift > 0.02;
      if (ripples.visible) {
        ripples.position.set(0, ground.position.y + 0.05, z);
        ripples.material.opacity = 0.9 * lift;
        // A slow crawl is all a flat plane needs to stop reading as lino.
        rippleTex.offset.y = (now * 0.014) % 1;
      }

      // road
      while (state.roadFrom * TILE < ahead) {
        const tz = state.roadFrom * TILE;
        const obj = roadPool.claim();
        obj.position.z = tz;
        // The lamp alternates on the parity of the tile index, not on the tile's
        // z, so the pattern is a property of the course and identical for every
        // player on the same day -- like everything else the course decides.
        const edge = edgeVariant(lookAtZ(tz).look.edge, state.roadFrom);
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
        const gate = course.gates[state.gateIdx++];
        const objs = [];
        for (let l = 0; l < 3; l++) {
          const kind = gate.lanes[l];
          if (kind === K.CLEAR) { objs.push(null); continue; }
          const o = hazardObject(kind);
          o.position.set(K.LANE_X[l], 0, gate.z);
          // Pick the skin. Pooled, so EVERY variant's visibility is written on
          // every claim -- a hazard inheriting the previous tenant's body is
          // the kind of defect that only shows up in one screenshot in twenty,
          // and on a hazard it costs the record rather than the screenshot.
          const vs = o.userData.variants;
          const vi = variantIndex(o.userData.bag, gate, l);
          for (let k = 0; k < vs.length; k++) vs[k].visible = (k === vi);
          o.userData.active = vs[vi];
          o.userData.body = vs[vi].userData.body;
          if (kind === K.BLOCK) {
            // Stretch a train backwards along z rather than repeating blocks;
            // the front face and the telegraph stay put on the gate line.
            const span = gate.train ? 1 + gate.train * 0.9 : 1;
            o.userData.body.scale.z = span;
            o.userData.body.position.z = (span - 1) * 0.65;
          }
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
          obj.scale.setScalar(0.7 + s.a * 0.75);
          obj.position.set(s.x, 0, s.z);
          obj.rotation.y = s.b * 6.3;
        } else if (s.kind === 'grove') {
          obj.position.set(s.x + s.side * 10, 0, s.z);
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
          obj.position.set(s.side * (K.TRACK_HALF_WIDTH + 1.9 + s.b * 3.4), 0, s.z);
          obj.rotation.y = s.side > 0 ? Math.PI : 0;
          obj.userData.bounce = s.c;
        }
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
        obj.position.set(K.LANE_X[it.lane], 0, it.z);
        obj.scale.setScalar(1);
        activeAid.push({ it, obj, pool, pop: -1 });
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
          e.obj.position.y = 3.4 * Math.sqrt(t);
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
        if (st.kind === 'arch' && obj.userData.mat) {
          if (!st.tex) st.tex = labelTexture(st.label, st.bg, st.fg, 768, 128, st.sub);
          obj.userData.mat.map = st.tex;
          obj.userData.mat.needsUpdate = true;
        }
        obj.userData.auditName = 'set piece / ' + st.kind;
        activeStruct.push({ st, obj, pool });
      }
      while (activeStruct.length && activeStruct[0].st.z < back - 60) {
        const e = activeStruct.shift();
        e.pool.release(e.obj);
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
              ? labelTexture('MILE 20', '#7a1030', '#ff9ab0', 768, 128, 'THE WALL')
              : labelTexture(`MILE ${b.m.mile}`, '#1b1633', '#ffe45e', 768, 128);
        }
        const pool = finish ? archPool : bannerPool;
        const obj = pool.claim();
        obj.position.set(0, 0, b.m.z);
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

      // Crowd idle: a cheap bob keeps the roadside alive without animation data.
      for (const e of activeScene) {
        if (e.s.kind === 'crowd') {
          e.obj.position.y = Math.abs(Math.sin(now * 4 + e.obj.userData.bounce * 6.3)) * 0.13;
        } else if (e.s.kind === 'walkers') {
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
          e.obj.position.y = Math.abs(Math.sin(now * 3.2 + b.phase)) * 0.075;
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
          if (a.userData.anim === 'pedal') {
            // A cadence, not a wheel spin: about 1.2 turns a second is what a
            // rider holding up traffic looks like. Slowed from 1.6 now that the
            // knees rise past the box line rather than turning behind it -- at
            // the old rate the pair strobed instead of reading as legs, and a
            // motion you cannot follow is the same as no motion.
            a.userData.moving.rotation.x = now * 7.6 + ph;
            a.position.y = Math.sin(now * 15.2 + ph) * 0.030;
          } else {
            // A wave, and a big one. This is the only thing on the road that
            // signals a human intention rather than an obstacle, so it is worth
            // more amplitude than realism would give it.
            a.userData.moving.rotation.z = Math.sin(now * 3.4 + ph) * 0.42;
            a.position.y = Math.abs(Math.sin(now * 3.0 + ph)) * 0.050;
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
      footbridgePool.releaseAll();
      waterPool.releaseAll(); bananaPool.releaseAll();
      for (const k in landmarkPools) landmarkPools[k].releaseAll();
      for (const k in markPools) markPools[k].releaseAll();
      for (const p of crowdPool) p.releaseAll();
      for (const p of walkersPool) p.releaseAll();
      for (const p of treePools) p.releaseAll();
      for (const g of grovePools) for (const p of g) p.releaseAll();
      for (const g of streetPools) for (const p of g) p.releaseAll();
      activeGates.length = 0; activeScene.length = 0; activeStruct.length = 0;
      activeBanner.length = 0; activeRoad.length = 0; activeAid.length = 0;
      state.roadFrom = 0; state.gateIdx = 0; state.sceneIdx = 0;
      state.structIdx = 0; state.bannerIdx = 0; state.aidIdx = 0;
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
    api.CORRIDOR_HALF = CORRIDOR_HALF;
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
            const ty = Math.min(a.y, b.y, c.y);
            if (Math.max(a.y, b.y, c.y) <= Y_FLOOR) continue;
            const tz0 = Math.min(a.z, b.z, c.z), tz1 = Math.max(a.z, b.z, c.z);
            if (tz1 < z0lim || tz0 > z1lim) continue;
            hits++;
            if (ty < yMin) yMin = ty;
            const th = Math.max(a.y, b.y, c.y);
            if (th > yMax) yMax = th;
            if (tz0 < zMin) zMin = tz0;
            if (tz1 > zMax) zMax = tz1;
          }
          if (hits) {
            let name = 'mesh', p = o;
            while (p && p !== group) {
              if (p.userData.auditName) { name = p.userData.auditName; break; }
              p = p.parent;
            }
            out.push({ name, tris: hits, yMin, yMax, z0: zMin, z1: zMax });
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
      cam.position.set(cx, cy + d * Math.sin(_audit.pitch), cz - d * Math.cos(_audit.pitch));
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
     * Every hazard variant's rendered tone, and every lane's road tone under
     * the palette live in this frame. Needs the renderer and the scene, which
     * this file deliberately does not hold: it is a build-time audit, called
     * from tools/shoot.js, and nothing in the game loop may reach for a
     * framebuffer.
     */
    api.contrastAudit = function (renderer, scene, opts) {
      auditSetup();
      _audit.images = !!(opts && opts.images);
      const NAME = { [K.JUMP]: 'JUMP', [K.DUCK]: 'DUCK', [K.BLOCK]: 'BLOCK' };
      const hazards = [];
      for (const grp of HAZARD_DEFS) {
        grp.defs.forEach(function (d, vi) {
          // The object as it is actually assembled at spawn: inked body, the
          // caution face it turns toward the lens, and the one moving part.
          // The telegraph mat is NOT here -- it is painted on the road in
          // front of the hazard, and letting a bright mat into the average
          // would excuse a hazard that had itself gone invisible.
          const g = new THREE.Group();
          g.add(S.outlined(d.geo, mats.propLit, S.INK.hazard));
          const f = new THREE.Mesh(hplane(d.face[0], d.face[1]), faceMat[grp.tint]);
          f.position.set(0, d.face[2], d.face[3]);
          f.rotation.y = Math.PI;
          g.add(f);
          if (d.moving) {
            const mv = S.outlined(d.moving, mats.propLit, S.INK.hazard);
            mv.position.set(d.pivot[0] * LANE_FIT, d.pivot[1], d.pivot[2]);
            g.add(mv);
          }
          d.geo.computeBoundingBox();
          const bb = d.geo.boundingBox;
          const h = Math.max(bb.max.y, d.face[2] + d.face[1] / 2);
          const m = shotMean(renderer, scene, g, 0, h / 2, 0, LANE * 0.62, h * 0.62);
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
      return { hazards, roads };
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
          out.push({
            kind, lane: l, z: g.gate.z,
            x: K.LANE_X[l], halfX: LANE * 0.5,
            yMin: box.yMin, yMax: box.yMax,
            z0: g.gate.z - box.halfZ, z1: g.gate.z + box.halfZ * (2 * span - 1),
          });
        }
      }
      return out;
    };

    return api;
  }

  return { create, VIEW, BEHIND, BIOME_LOOK };
})();
