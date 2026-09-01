/**
 * HUD: the race readout, the mile splits, the progress rail, and the
 * start/finish panels.
 *
 * DOM rather than canvas, because tabular-figure text at small sizes is
 * sharper through the browser's own rasteriser than anything drawn into a
 * WebGL texture, and it stays sharp on every DPR without extra work.
 *
 * The numbers update every frame but are written only when their rendered
 * string actually changes -- a race clock re-flowing 60 times a second is
 * both a layout cost and a readability problem.
 *
 * ---- why the readout is arranged the way it is ----
 *
 * deltaVsRecord() is the honest split, and it is also the most misleading
 * thing on the screen if it is given the headline. The player starts at
 * 5:30/mi and only the clean streak buys the speed back, so a flawless run is
 * two and a half minutes down on the ghost for the first third of the race
 * while actually heading for 1:58:16. Shown big and red at the top, that told
 * every good player they were failing. So the split is not the headline:
 *
 *   - the headline is the PROJECTED FINISH measured against 1:59:30, which is
 *     the number that answers "is the record still alive";
 *   - the split moves down to the progress rail and sits with the ghost marker
 *     it describes, so "the ghost is 1:52 up the road" reads as geography
 *     rather than as a grade -- it is a position, not a verdict;
 *   - the streak gets the weight it earns. It sits directly above the pace it
 *     causes with the speed gauge between them, so the panel reads top to
 *     bottom as the mechanic: clean gates -> speed unlocked -> pace.
 *
 * The projection has a trap of its own: it assumes the current pace holds to
 * the line, and on a clean run the current pace is still falling, so early on
 * it reads far worse than the run deserves (2:24:12 at the first mile). It is
 * therefore not presented as a verdict until the streak has spent most of the
 * speed it can buy. Until then the chip says so in as many words, and the
 * estimate is shown in neutral ink rather than in red.
 */
/**
 * THE RESULT LADDER.
 *
 * A run used to have two possible endings: it beat 1:59:30, or it read
 * "SHORT BY 11:58". The record survives exactly one mistake in 189 obstacles,
 * so the second ending is what essentially every session got -- a pure
 * negative, with no information in it about whether this run was better than
 * the last one, and nothing to aim at next time except the thing that had
 * just been proved out of reach.
 *
 * The ladder converts the same arithmetic into a graded result with a next
 * rung. It changes no balance whatsoever -- nothing here is a difficulty
 * knob, it is a way of reading the finish time the model already produces.
 *
 * The rungs are DERIVED, not typed. They hang off RECORD_SECONDS: the first
 * is the next whole minute above the record, and the gaps double from there,
 * because the spread of finish times widens as the mistakes multiply. The
 * labels are formatted from the same numbers that gate the comparison, so a
 * band can never be named one thing and tested as another.
 *
 * That derivation has already earned itself. These rungs were fitted against
 * a single-exponential pace ramp, in which one mistake finished 1:58:49, two
 * 1:59:40, five 2:02:17 and ten 2:05:22. The ramp was then rebuilt with two
 * time constants and the floor moved 4:20 -> 4:14, and the ladder needed no
 * edit at all: measured on the model as it stands (tools/simulate.js, aid
 * taken), a one- and two-mistake run are RECORD, three is SUB-2:00 at
 * 1:59:46, five is SUB-2:02 at 2:00:55, ten is SUB-2:06 at 2:03:32, and
 * without aid the same counts read RECORD / SUB-2:02 / SUB-2:02 / SUB-2:06 /
 * FINISHED. Roughly "one more mistake per rung" either way, which is the
 * resolution a player can act on.
 */
MR.Tier = (function () {
  const K = MR.K;

  const BASE = Math.ceil(K.RECORD_SECONDS / 60) * 60;   // next whole minute up
  const STEP = 120;                                     // then 2 min, then 4

  /** 7320 -> "2:02". Rounds through whole minutes so 7170 cannot read "1:60". */
  function mark(sec) {
    if (!isFinite(sec)) return '';
    const m = Math.round(sec / 60);
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  }

  // The ladder had no bottom. It ran RECORD / 2:00 / 2:02 / 2:06 / FINISHED,
  // and FINISHED was everything above 2:06 -- unbounded. A 16-contact run
  // measured 2:10:58 and read "FINISHED · 4:52 OFF SUB-2:06", which is nearly
  // five minutes from the lowest rung: not a next step, just the old SHORT BY
  // wearing a new hat.
  //
  // The rungs below cover where real runs actually land, measured against the
  // shipped model: 0.90 accuracy finishes 2:09:59, 0.75 2:22:11, 0.50 2:25:33,
  // and a run that clears nothing at all 2:29:09. So the ladder now reaches to
  // 2:24 in six-minute steps, and FINISHED means what it says rather than
  // standing in for a fifth of the range.
  //
  // Still derived from RECORD_SECONDS rather than typed, which is what let the
  // top of this ladder survive a pace-curve rebuild without an edit.
  const LADDER = [
    { max: K.RECORD_SECONDS, name: 'RECORD', label: K.RECORD_LABEL },
    { max: BASE },                  // 2:00
    { max: BASE + STEP },           // 2:02
    { max: BASE + STEP * 3 },       // 2:06
    { max: BASE + STEP * 6 },       // 2:12
    { max: BASE + STEP * 9 },       // 2:18
    { max: BASE + STEP * 12 },      // 2:24
    { max: Infinity, name: 'FINISHED', label: '' },
  ];
  LADDER.forEach(function (t, i) {
    t.i = i;
    if (!t.name) { t.label = mark(t.max); t.name = 'SUB-' + t.label; }
  });

  /** The band a finish time lands in. Never null. */
  function of(sec) {
    for (const t of LADDER) if (sec <= t.max) return t;
    return LADDER[LADDER.length - 1];
  }

  /** The rung above that band -- the thing to chase -- or null at the top. */
  function next(sec) {
    const i = of(sec).i;
    return i > 0 ? LADDER[i - 1] : null;
  }

  /** Seconds still to find to reach `rung`. */
  function gapTo(sec, rung) {
    return rung && isFinite(rung.max) ? Math.max(0, sec - rung.max) : 0;
  }

  return { LADDER, of, next, gapTo, mark };
})();

MR.HUD = (function () {
  const K = MR.K;
  const Pace = MR.Pace;
  const Tier = MR.Tier;
  const Store = MR.Store;

  // Where record pace sits inside the START_PACE -> FLOOR_PACE range the
  // streak unlocks. Derived, so a retune of either end moves the tick: the
  // floor has already moved once, 4:20 -> 4:14.
  // Everything that draws the speed gauge shares this so the tick, the fill
  // and the copy can never drift apart.
  const REC_MARK = (K.START_PACE - K.RECORD_PACE) / (K.START_PACE - K.FLOOR_PACE);

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function create(root, opts) {
    opts = opts || {};
    root.innerHTML = `
      <!--
        THE MIDDLE OF THE FRAME BELONGS TO THE ROAD.
        
        That rule is stated at the top of the stylesheet and the layout broke
        it. Measured at 390x844: three plates in the top third, 25.2% of the
        screen covered, and the race-clock plate spanning x68-322 of 390 -- 
        dead centre, which is exactly where the mile gantries stand. Playtest
        frames show MILE 5 hidden behind the streak panel and MILE 26 cut in
        half by the projection. The one piece of scenery that tells you how far
        you have run was being covered by a panel telling you how far you have
        run.

        So the top bar is gone as a centred object. Everything the player needs
        while running is on the LEFT EDGE and along the BOTTOM, and the centre
        and right of the frame are given back to the road.

        What was cut, and why each is safe:
          RACE TIME   demoted to the rail strip. On a four-minute compressed
                      race the elapsed clock is flavour; the projection is the
                      number decisions are made against.
          DISTANCE    removed entirely. The rail already draws position against
                      26.2 with mile ticks, and the mile gantries in the world
                      are the same fact -- made legible for the first time by
                      deleting the panel that was covering them.
      -->
      <div id="leftCol">
        <div id="projCell">
          <div class="cap"><span class="lab"><span class="wideOnly">PROJECTED</span><span class="narrowOnly">PROJ</span> FINISH</span><span class="chip" id="status">BUYING SPEED</span></div>
          <div class="val num" id="projVal">--:--</div>
          <div class="sub num" id="margin">VS ${K.RECORD_LABEL}</div>
        </div>

        <!--
          THE STREAK IS FUEL, NOT A SCORE.

          It used to lead with CLEAN GATES over a large integer, and every
          review of this game independently said the same thing about it: a big
          number with a label like that is a SCOREBOARD, and people read
          scoreboards with the loss-aversion circuit -- "points I could lose".
          The variable is not a score. It is a tank: it fills while you run
          clean, it drains most of the way on contact, water and bananas refill
          it, and the pace you get is read straight off how full it is. The
          shipped aid toast already says FUEL out loud while crediting a
          counter called CLEAN GATES -- three names for one thing.

          So the gauge leads and the integer stops being the headline. Same
          variable, same maths, nothing balanced changed; what changes is
          whether a player reads it as something to protect or something to
          spend and rebuild. It also costs one large number less on a screen
          the owner asked to declutter.
        -->
        <!--
          THE SECOND PASS: THE PLATE IS THE GAUGE AND ONE NUMBER.

          It carried four rows under the tank -- PACE, a required-pace line and
          a clean count -- and three of them were the same statement written
          three ways. Measured across a full clean run at one-second
          resolution (bot=1, 390x844):

            NEED   moves 4:32 -> 4:27 and back to 4:29 over the first 200
                   seconds. Five seconds of travel across four fifths of a
                   race: a constant with a decimal point. Then, as the
                   remaining distance goes to zero, it divides by it: the last
                   thing the readout says on a RECORD run is NEED 24:44/MI.
                   The line that is supposed to price the record prints
                   nonsense at the moment the record is won.

            Its one live question -- "am I fast enough?" -- is already answered
            twice beside it, at the same instant. The gauge fill passes the
            white record tick between race-second 90 and 95; NEED minus PACE
            crosses zero between race-second 90 and 95. Same event. And PACE
            itself turns green on the same crossing (the 'ahead' class). Three
            encodings of one bit.

            n CLEAN is the number the gauge is drawn from -- fill is a linear
                   map of the pace the streak buys -- so it restates the tank
                   directly. The stylesheet had already dimmed it to 0.62 on
                   phones, which is what a readout does just before it admits
                   the row is furniture.

            Once the record is gone the same slot became PB n CLEAN · n TO GO,
            or LONGEST CLEAN · n, which measured FROZEN for the last 45
            seconds of a 265-second run (stuck at 24 from race-second 215 to
            the tape) while the rail and the projection both retargeted live.

          PACE stays, and this is the argument for keeping it rather than for
          cutting it: it is the only number in the game that answers to every
          frame of play, it is the one thing that gives the white tick on the
          tank a name, and it is stated in the same units as the wager. The
          gauge shows how full; PACE says how fast. Nothing else does.
        -->
        <div id="engine">
          <div class="lab" id="engLab">ENERGY</div>
          <!--
            THE GAUGE CARRIES THE POOL UNDER EFFORT, AND NOTHING ELSE MOVES.

            The owner's constraint was explicit: no new plate. So the tank the
            player already reads becomes the tank the player already reads --
            same box, same label, same white record tick -- and what fills it
            becomes the pool rather than the pace.

            That leaves the pace needing somewhere to be, because the record
            tick is meaningless without it: the tick's whole job is to be the
            line the pace crosses. So the pace becomes a HAIRLINE that slides
            along the same bar. Pace and record are still read against each
            other exactly as they were -- the hairline reaches the tick at the
            same instant the fill used to -- and the fill is freed to be the
            one thing the player now has to decide about.

            Three readings, one bar, and no two of them are the same encoding:
            the FILL is how much you have, the HAIRLINE is how fast you are, the
            TICK is how fast the record needs. At EFFORT = 0 the hairline is
            hidden and the fill goes back to being the pace, which is the
            shipped plate to the pixel.
          -->
          <div class="gauge tank" id="paceGauge">
            <div class="gaugeFill" id="gaugeFill"></div>
            <div class="gaugePace" id="gaugePace"></div>
            <div class="gaugeRec"></div>
          </div>
          <div class="lab" id="paceLab">PACE</div>
          <div><span class="val num" id="paceVal">5:30</span><span class="unit">/MI</span></div>
          <div id="why">EACH CLEAN GATE BUYS SPEED</div>
        </div>

        <!--
          AID ONLY. The mile split card used to live here too, and every one
          of its four facts was already on the screen it was drawn over:

            MILE 11    the mile gantry in the world says so, and R3 is about
                       making that sign legible rather than duplicating it.
            4:41/MI    a SECOND pace, in the same units, sixty pixels under a
                       PACE plate reading 4:25/MI. Two different min/mi
                       numbers stacked, neither labelled to tell them apart.
            51:45      the cumulative clock, which the rail prints live.
            +1:36.8    the ghost delta, which the rail prints live -- and
                       printed here in PINK on a run whose projection two
                       plates above read RECORD ON in green. That is the exact
                       contradiction the rail's tone rule and the finish
                       card's split column were both rebuilt to remove; this
                       was the last place in the game it survived.

          It was up for two seconds every mile: 26 cards, ~52s of a ~250s run,
          21% of the race spent covering the left edge with four numbers that
          were already elsewhere. Aid is not a duplicate -- nothing else says
          a bottle refilled the tank -- so the card stays for that alone.
        -->
        <div id="toast">
          <div class="lab" id="toastLab">FUEL</div>
          <div class="big num" id="toastBig"></div>
        </div>
      </div>

      <div id="railWrap">
        <div id="gapLine">
          <span class="num" id="clock">0:00</span>
          <span class="lab" id="gapLabel">RECORD GHOST</span>
          <span class="num" id="gapVal">+0:00.0</span>
          <span id="gapTrend">GAINING</span>
          <span class="num" id="distVal">0.00</span><span class="unit" id="distUnit">MI</span>
        </div>
        <div id="rail">
          <div id="railBg"></div>
          <div id="railFill"></div>
          <div id="railGap"></div>
          <div id="railGhost"></div>
        </div>
        <!--
          THE AXIS LABEL BECOMES THE ROUTE.

          This row used to read 0 / 13.1 / 26.2. The stylesheet's own argument
          for dropping it on short frames is the argument for replacing it
          here: it is the least live thing on the plate, the halfway point it
          marked is already drawn on the bar, and the live distance is printed
          as #distVal in the line directly above it. Three numbers restating
          the geometry of the bar they sit under.

          What goes in its place is the same axis labelled with the three or
          four places the run actually passes through. Same row, same height,
          same element count -- and it is the only statement in the running
          game of WHERE YOU ARE. Without it the finish card's "clean through
          Boston" line names a city the player was never told they were in.

          It is geography and nothing else. No outcome is printed here: the
          per-chapter verdict cannot honestly be computed until the tape (see
          chapterCost), and a name with a number beside it that only measures
          the course is what the mile toast was.
        -->
        <div id="railRoute"></div>
      </div>

      <div id="perf" class="num"></div>

      <!--
        THE START PANEL.

        It used to carry 109 words in five stacked blocks: 28 to 33 seconds of
        reading before a stranger could press the button, with the explanatory
        sections alone taking 51-56% of the panel's height. A stranger who
        clicks into a free browser game gives a start screen three to eight
        seconds.

        Worse, it spent all of that explaining a pace economy in vocabulary the
        reader did not have yet -- "gate", "the streak", "the ghost" and
        "PROJECTED FINISH" were each used before, or entirely without, being
        defined -- while never once saying what kind of game this is. The word
        "lanes" appeared exactly once, at character 565 of 622, inside the key
        legend. You could read the whole panel and not learn you were about to
        dodge things in three lanes.

        So: genre first, then the wager, then the one rule you cannot infer.
        Everything cut from here is either shown live by the HUD within fifteen
        seconds (the pace gauge, the record margin, the projection) or is not
        needed before the first obstacle.
      -->
      <div class="panel" id="startPanel" role="dialog" aria-modal="true"
           aria-labelledby="startTitle"><div class="panelInner">
        <div class="date" id="startDate"></div>
        <h1 id="startTitle">MARATHON MILES</h1>
        <div class="route" id="startRoute"></div>
        <!--
          MILES SPEAKS, once a day (docs/miles.md). One terse line in the
          masthead voice, chosen by the day's city -- the tater-tot lesson
          from the owner's references: a single spoken line to the camera
          builds more character than any mesh. Attributed, because the name
          is new and the line is how the player learns whose name it is.
        -->
        <div id="milesLine"></div>

        <div class="blurb">
          Three lanes. Jump or slide past everything in the way.
          <b>26.2 miles.</b>
        </div>

        <!--
          THREE LINES CAME OUT OF THIS PANEL AND NONE OF THEM WERE WRONG.
          The owner cut the duration, the pace rule and the mistake count:
          "about four minutes", "5:30 up to 4:14 a mile, touch one and most of
          it is gone", "survives one mistake in 185".

          Every one was true and every one was answering a question nobody had
          asked yet. A player who has not run this cannot use a pace range, has
          no idea whether 185 gates is a lot, and does not need the length of a
          thing they are about to be shown. The panel now states the wager and
          the controls and stops -- the mechanic teaches itself on the road,
          where the fuel gauge and the pace readout are already saying it live.

          The target keeps its number because that IS the wager. What it loses
          is the gloss under it.

          The label names the wager in full -- the owner: the target "needs to
          mention you are trying to break the marathon record". Same single
          line, same figure; only the word TARGET grew into the claim it was
          abbreviating.
        -->
        <div class="target">
          <span class="targetLab">BREAK THE MARATHON WORLD RECORD</span>
          <b class="num">${K.RECORD_LABEL}</b>
        </div>

        <!--
          WHAT THE GAME REMEMBERS.

          Empty on a first visit, and it stays out of the way when it is: a
          stranger gets exactly the panel they got before. From the second run
          onward it is the reason to have come back, so it sits directly under
          the wager it is a record of.
        -->
        <div id="startMemory"></div>

        <!--
          THE DAY IS WON, AND THE PANEL SAYS SO INSTEAD OF OFFERING A START.

          The owner: "You can play the game as many times as you want until
          you break the record. After that you wait until the next day."
          Retries stay unlimited on every other day; on a day the record fell
          this box replaces the button, and it carries the four facts that
          state of affairs consists of: the record is broken, the time that
          broke it, that today is over, and when the next road opens. The
          city and the streak are already on the panel above it.
        -->
        <div id="lockedBox" class="hidden">
          <div class="lockChip">RECORD BROKEN</div>
          <div class="lockTime num" id="lockTime"></div>
          <div class="lockSub">MILES IS DONE FOR TODAY</div>
          <div class="lockNext num" id="lockNext"></div>
        </div>

        <div class="keys" id="startKeys"></div>
        <button class="cta" id="startBtn" type="button">TOE THE LINE</button>
        <!--
          The door to the run history. A text row rather than a second CTA --
          it must not compete with TOE THE LINE -- and it renders only once
          there is a history to show, the same empty-state rule the memory
          plates follow.
        -->
        <button id="histBtn" type="button" class="hidden">PAST DAYS</button>
        <!--
          The door OUT to the explainer, which lives on the site rather than in
          the game. Absolute rather than rooted, because this same file is
          opened from file:// by every tool in tools/ and is published as a
          standalone artifact -- a /how-to-play/ link is a dead link in both,
          and a dead link on the start panel is worse than no link.
          target=_blank so a player who taps it mid-session does not lose the
          page they were about to run.
        -->
        <a id="howBtn" class="textBtn"
           href="https://marathon-miles.com/how-to-play/"
           target="_blank" rel="noopener">HOW TO PLAY</a>
      </div></div>

      <!--
        THE HISTORY TAB. The owner: "Maybe a tab that shows all the cities
        you've completed and where you broke the record."

        One row per finished date, newest first: when, where, the day's best
        time, and a WR mark where 1:59:30 fell. WR is typeset, not iconed,
        because the embedded face is subset to the characters this HUD prints
        and a star would arrive in the system font. Reached only from the
        start panel, and it goes back there, so it can never strand a race.
      -->
      <div class="panel hidden" id="histPanel" role="dialog" aria-modal="true"
           aria-labelledby="histTitle"><div class="panelInner">
        <div class="date">RUN HISTORY</div>
        <h1 id="histTitle">PAST DAYS</h1>
        <div id="histSum"></div>

        <!--
          EVERY CITY IN THE POOL, AND WHERE THE RECORD HAS FALLEN.

          The owner paused the map: "lets put a pause on the map. for now, its
          a list of all available cities and then shows where you have
          completed the record."

          It is a COMPANION to the list below, not a replacement, because the
          two answer different questions. PAST DAYS is chronological -- what
          did I do lately -- and it can only ever show the days that happened.
          This is the SET: the whole pool at once, so the cities you have not
          reached are on the screen as well as the ones you have, which is the
          only way a checklist can be a thing to finish.

          Three states, and they are three because two would collapse the
          question: a city where 1:59:30 fell, a city raced without it, and a
          city not yet drawn. The third is the one a chronological log cannot
          express at all.

          DERIVED FROM course.js's SETTINGS, never a copy of it. The owner has
          said more cities and landmarks are coming, so the count is
          SETTINGS.length and the rows are the table's own order; adding a
          thirteenth city updates this panel by existing.
        -->
        <div class="rule" id="cityRule"></div>
        <div id="cityGrid"></div>

        <div id="histList"></div>
        <button class="cta" id="histBack" type="button">BACK TO THE LINE</button>
      </div></div>

      <!--
        THE FINISH CARD.

        It was a spreadsheet on a dimmed screenshot: two grids of 12.5px/700
        text, keys and values at identical size and weight separated only by
        opacity, on two baseline rhythms three pixels out of phase, under a
        date line typeset larger and louder than the label of the headline
        number. Nothing about it belonged to the same product as the HUD.

        So it is rebuilt in the HUD's own language -- plates, left-aligned
        columns, a 9px/800/0.16em label over a large tabular value -- and it
        carries the things the old card could not:

          - a GRADE, not a verdict. See MR.Tier.
          - the longest clean streak as a co-headline. It is monotone, so a
            contact can never take it away; it has 189 points of resolution
            against the record's one bit; and it stays winnable for the whole
            race long after the record has died.
          - the TRUE cost of contact, measured against a flawless run of this
            exact course rather than 1.5s per hit.
          - what the player's best today was, and whether this beat it.
          - tomorrow.

        WHAT THE SECOND PASS TOOK OFF IT, AND WHY.

        The card answers five questions, in this order: what did I run, was
        that good, why was it not better, what did I do well, what now. Two
        blocks answered none of them.

        THE FIVE-ROW SUMMARY. Four of its five rows were arithmetic on
        numbers already printed on the same card:
          AVG PACE      FINAL TIME / 26.2.
          FINAL PACE    the last row of the split table beside it (4:17 and
                        4:17 clean; 5:05 and 5:06 on a 22-contact run).
          CLEAN GATES   OF 205 GATES minus 22 CONTACTS COST, both printed.
          CONTACTS      the cost plate's own label says "22 CONTACTS COST".
        The fifth, AID TAKEN, is the only fact on the card that is nowhere
        else, so it survives as a note rather than as a table row.

        THE SIX-ROW SPLIT TABLE. Measured over four different days' courses
        at four skill levels:
          - on a CLEAN run it prints 4:57 4:30 4:26 4:23 4:16 4:17, and those
            six numbers are the same to within two seconds on every one of
            the four days. It is not showing this run; it is showing the
            pace model's ramp, which is a constant.
          - on a run that went wrong -- the card most players see -- the
            whole spread across its six blocks is 14 to 23 seconds, while
            the contacts cost 462 to 1064. Five-mile blocks average eight
            miles of clean running over four contacts, so the one thing the
            table could usefully locate is exactly what it averages away.
        Constant on a good run, noise on a bad one. The shape of the race is
        left to the one line that names an actual moment in it: the turn.

        The best-today line no longer says FIRST RUN TODAY. That is the same
        empty state the start panel's memory plates already refuse to draw:
        nothing to remember, so nothing rendered.

        And the rung line no longer repeats the headline. On a record run the
        card read RECORD, then RECORD BEATEN BY 1:37, over -1:37 VS 1:59:30
        -- one number three times in ninety pixels. There is no rung above
        RECORD, so there is nothing for that slot to say; the green chip
        says it.
      -->
      <div class="panel hidden" id="endPanel"><div class="panelInner">
        <div class="endDate" id="endDate"></div>

        <!--
          THE THIRD PASS TOOK THREE MORE ROWS, on the owner's word: "X contacts
          cost, aid taken, longest clean" are out. The LONGEST CLEAN
          co-headline, the contacts-cost plate and its counterfactual line, and
          the AID TAKEN note all go; the finish time, the grade, the badges,
          the best-today comparison, the turn line, the biome-leg chapter line
          and TOMORROW stay. The card is one headline again.
        -->
        <div id="endHead">
          <div class="endCell">
            <div class="lab">FINAL TIME</div>
            <h1 class="endBig num" id="endTime">&mdash;</h1>
            <div class="endSub num" id="endVs"></div>
          </div>
        </div>

        <div id="tierRow">
          <span id="verdict"></span>
          <div id="milesEnd"></div>
          <span id="tierNext" class="num"></span>
        </div>

        <div id="endBadges"></div>
        <div id="endMem" class="num"></div>

        <div id="endTurn"></div>

        <!--
          THE SHARE CARD.

          The owner: "Share artifact is important. work on that and add that",
          and "no leaderboard is needed. individual game. share card is more
          important". Those two sentences are one decision: the comparison
          between players happens OUTSIDE the game, in a message thread, and
          what the game owes it is a result that survives being pasted.

          WHY A RESULT IS WORTH SHARING AT ALL, which is the load-bearing fact
          and not a marketing line: the day's course is byte-identical for
          everyone. rng.dateKey is pure UTC year/month/day and pickSettings
          deals the city from a bag keyed on the UTC epoch-day, so two people
          on opposite sides of the world race the same road on the same date.
          A time with no shared course behind it is a number about a stranger.

          SIX BLOCKS, ONE PER BIOME LEG -- the same cut the chapter verdict
          above already uses, so this is a byproduct of machinery that was
          here rather than new bookkeeping. Green: the leg was run clean.
          Yellow: a contact, and the pool paid for it. Red: a contact nothing
          paid for. That describes THE RUN and not the road, which is what
          keeps it spoiler-free -- nothing here leaks where a hazard stood,
          which lane cleared it, or what the layout was. A reader who has not
          run yet learns only how their friend's day went.

          The blocks on the card are DIVS, not glyphs, and the emoji live only
          in the copied text. The embedded typeface is subset to the characters
          this HUD prints (see tools/mkfont.py) and has no block glyphs at all,
          so a rendered square would arrive in whatever the system font felt
          like -- three different sizes on three different phones, inside the
          one element whose whole job is to look like a row.
        -->
        <div id="shareBox">
          <div class="lab">TODAY'S RESULT</div>
          <div id="shareLegs" aria-hidden="true"></div>
          <div id="shareLine" class="num"></div>
          <button id="shareBtn" type="button">COPY RESULT</button>
          <div id="shareNote" role="status"></div>
          <!--
            THE LAST RESORT, AND THE REASON IT EXISTS: the button must never
            fail silently. If the share sheet is absent, the async clipboard is
            blocked by permissions policy and execCommand is gone, there is
            still one thing that always works -- showing the player the text
            with it already selected. It is hidden until that happens.
          -->
          <textarea id="shareText" readonly aria-label="Your result, to copy"></textarea>
        </div>

        <!--
          THE RETURN HOOK, next to the button it is competing with.

          This was the faintest line on the card, below every stat, which is
          an odd place for the only element on the screen whose job is to
          bring someone back tomorrow. It is now a plate directly above RUN IT
          AGAIN, at the weight of the grade chip, so the two read as a pair of
          offers: run it again now, or come back for a different road.
        -->
        <div id="tomorrow" class="empty">
          <div class="lab">TOMORROW</div>
          <div class="tomRoute" id="tomorrowRoute"></div>
        </div>
        <button class="cta" id="againBtn">RUN IT AGAIN</button>
        <!--
          The owner: "past days needs to be on the score page as well." The
          finish is where a player has just produced a row for that log, so it
          is the moment the log is most worth reading. Same panel, same button
          class as the start panel's door -- and it hides on the same rule,
          because a history of one run is not a history.
        -->
        <button id="endHistBtn" type="button" class="hidden">PAST DAYS</button>
      </div></div>

      <!--
        THE PAUSE BUTTON, AND WHY IT IS IN THE TOP RIGHT.

        Three constraints and only one corner satisfies all three.

        THE MIDDLE OF THE FRAME BELONGS TO THE ROAD, which is the rule this
        whole readout was rebuilt around, so it is an edge or it is nothing.

        IT MUST NOT SIT WHERE A SWIPE LANDS. The four game verbs are swipes
        anywhere on the canvas, and the one input a player must never lose is
        the lane change that avoids a hazard. A pause under the thumb is a
        pause pressed by a mis-started swipe -- and an accidental pause during
        a record attempt is a worse outcome than an awkward deliberate one. So
        the awkwardness is the feature: this is the one control in the game
        that should cost a second hand, because it is the only one that is
        never used in a hurry.

        AND NOTHING NEW AT THE BOTTOM. tools/footroom.js asserts the runner's
        shoe clears the top of #railWrap across 96 combinations of viewport,
        pace and state, and that gate is currently held by a plate that had to
        give up a whole row to pass it. A 46px control anywhere along the
        bottom edge would be measured against the same figure. The top right is
        the one region of this HUD that is measured by nothing, because it is
        the slot the retired #dist plate used to occupy -- which is also why
        the offsets below are #dist's own, at every breakpoint.
      -->
      <button id="pauseBtn" type="button" aria-label="Pause the race">
        <span class="pauseGlyph"></span>
      </button>

      <div class="panel hidden" id="pausePanel" role="dialog" aria-modal="true"
           aria-labelledby="pauseTitle"><div class="panelInner">
        <div class="date">RACE STOPPED</div>
        <h1 id="pauseTitle">PAUSED</h1>
        <!--
          The panel is opaque, and that is the anti-cheat rather than the
          styling. See the .panel override in style.css.
        -->
        <div class="blurb">
          The clock, the road and the ghost are stopped together.
          <b>Resuming counts 3 &middot; 2 &middot; 1</b> before any of them move.
        </div>
        <div id="pauseStat"></div>
        <button class="cta" id="resumeBtn" type="button">RESUME</button>
        <button class="cta alt" id="restartBtn" type="button">RESTART THIS RUN</button>
      </div></div>

      <div id="count" class="hidden"><span id="countVal"></span></div>
    `;

    const q = (id) => root.querySelector('#' + id);
    const n = {
      clock: q('clock'),
      projCell: q('projCell'), projVal: q('projVal'), margin: q('margin'), status: q('status'),
      engine: q('engine'), why: q('why'), engLab: q('engLab'),
      gaugeFill: q('gaugeFill'), gaugePace: q('gaugePace'),
      paceGauge: q('paceGauge'), paceVal: q('paceVal'),
      distVal: q('distVal'),
      railWrap: q('railWrap'),
      rail: q('rail'), railFill: q('railFill'), railGap: q('railGap'), railGhost: q('railGhost'),
      railRoute: q('railRoute'),
      gapVal: q('gapVal'), gapTrend: q('gapTrend'), gapLabel: q('gapLabel'),
      toast: q('toast'), toastLab: q('toastLab'), toastBig: q('toastBig'),
      startPanel: q('startPanel'), startBtn: q('startBtn'), startDate: q('startDate'),
      startRoute: q('startRoute'), startKeys: q('startKeys'),
      startMemory: q('startMemory'),
      lockedBox: q('lockedBox'), lockTime: q('lockTime'), lockNext: q('lockNext'),
      histBtn: q('histBtn'), histPanel: q('histPanel'),
      endHistBtn: q('endHistBtn'),
      histSum: q('histSum'), histList: q('histList'), histBack: q('histBack'),
      endPanel: q('endPanel'), endTime: q('endTime'), endDate: q('endDate'),
      endVs: q('endVs'),
      verdict: q('verdict'), tierNext: q('tierNext'),
      milesLine: q('milesLine'), milesEnd: q('milesEnd'),
      endBadges: q('endBadges'), endMem: q('endMem'),
      endTurn: q('endTurn'), tomorrow: q('tomorrow'), tomorrowRoute: q('tomorrowRoute'),
      shareBox: q('shareBox'), shareLegs: q('shareLegs'), shareLine: q('shareLine'),
      shareBtn: q('shareBtn'), shareNote: q('shareNote'), shareText: q('shareText'),
      cityRule: q('cityRule'), cityGrid: q('cityGrid'),
      againBtn: q('againBtn'),
      count: q('count'), countVal: q('countVal'),
      pauseBtn: q('pauseBtn'), pausePanel: q('pausePanel'),
      pauseStat: q('pauseStat'), resumeBtn: q('resumeBtn'), restartBtn: q('restartBtn'),
      perf: q('perf'),
    };

    // The --bugH machinery that used to live here is gone with the top bar it
    // measured. It existed because the side columns hung below a centred plate
    // whose height four breakpoints each guessed at, and the narrow one guessed
    // 2px short. With the readout moved to the left edge there is no plate
    // above anything, so there is nothing to measure and nothing to clip.

    // Record pace is a fixed point in the unlockable range, so both gauges get
    // their tick from the same number rather than a hand-placed percentage.
    root.querySelectorAll('.gaugeRec').forEach((t) => { t.style.left = (REC_MARK * 100) + '%'; });

    // Mile ticks on the rail; every 5th is major. The half-marathon lands at
    // 13.109 mi, which is within a pixel of the midpoint at any rail width.
    for (let m = 1; m <= 26; m++) {
      const t = el('div', 'railTick' + (m % 5 === 0 ? ' major' : ''));
      t.style.left = ((m / K.MARATHON_MILES) * 100) + '%';
      n.rail.appendChild(t);
    }

    const cache = {};
    function set(node, key, text) {
      if (cache[key] === text) return;
      cache[key] = text;
      node.textContent = text;
    }
    function cls(node, key, name) {
      if (cache[key] === name) return;
      cache[key] = name;
      node.className = name;
    }

    // The live readout is hidden behind either panel. It used to show through
    // the overlay, which made the finish screen read as a rendering fault.
    function syncPanels() {
      const open = !n.startPanel.classList.contains('hidden')
                || !n.endPanel.classList.contains('hidden')
                || !n.histPanel.classList.contains('hidden')
                || !n.pausePanel.classList.contains('hidden');
      root.classList.toggle('panelOpen', open);
    }

    let hintUntil = 0;     // while set, the why-line shows the streak-cut message
    let dateKey = '';
    let course = null;
    let chapterCost = null; // per-city counterfactual, computed once at the tape
    let hitZ = null;       // z of every gate this run made contact with
    let guardZ = null;     // ...and of every contact the guard pool paid for
    let shareStr = '';     // the copyable result, built once at the tape

    // Latched, and deliberately so. `recordPossible()` is a bound, not a
    // guess, but at the exact boundary it can flicker: a player holding
    // FLOOR_PACE keeps the required pace constant, so the comparison sits on a
    // knife edge for several seconds. A verdict that un-says itself is worse
    // than either answer, and the record genuinely does not come back.
    let recordGone = false;
    // The debounced RECORD ON / OFF RECORD verdict. See update().
    let chipOn = null, chipAt = 0;
    const CHIP_DEAD = 6;    // projected seconds either side of the record
    const CHIP_HOLD = 900;  // ms a verdict must stand before it may flip back

    const api = { nodes: n };

    /** Clear everything that belongs to one run. Called before each start. */
    api.reset = function () {
      recordGone = false;
      chipOn = null;
      chipAt = 0;
      cache.chip = cache.chipCls = cache.projCls = undefined;
    };

    api.setDate = function (key) {
      dateKey = key;
      n.startDate.textContent = key + ' · GLOBAL COURSE';
      n.endDate.textContent = key + ' · GLOBAL COURSE';
    };

    // ---- memory ---------------------------------------------------------

    /** 2026-08-05 -> "AUG 5". Relative where relative is clearer. */
    function dayName(key, today) {
      const d = Store ? Store.dayDiff(key, today) : NaN;
      if (d === 1) return 'YESTERDAY';
      const t = Store ? Store.parseKey(key) : NaN;
      if (isNaN(t)) return key;
      const dt = new Date(t);
      const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      return M[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
    }

    function plate(lab, val, sub) {
      return '<div class="mplate"><div class="lab">' + lab + '</div>'
           + '<div class="mv num">' + val + '</div>'
           + '<div class="ms">' + (sub || '&nbsp;') + '</div></div>';
    }

    /**
     * Put the save on the start panel.
     *
     * Three plates at most, and each one only when it has something true to
     * say. A first-ever visit renders nothing at all -- the panel a stranger
     * meets is unchanged, and the memory arrives as a reward for having come
     * back rather than as an empty frame promising one.
     */
    api.setMemory = function (sum) {
      if (!n.startMemory) return;
      if (!sum) { n.startMemory.innerHTML = ''; return; }

      let html = '';
      if (sum.today) {
        html += plate("TODAY'S BEST", Pace.clock(sum.today.time),
          Tier.of(sum.today.time).name + ' · ' + sum.today.streak + ' CLEAN');
      }
      // The record streak -- consecutive days on which 1:59:30 fell. The win
      // condition's own streak, so it outranks the played-days one, and it is
      // held back until 2: a streak of one is just yesterday wearing a label.
      if ((sum.recordStreak | 0) >= 2) {
        html += plate('RECORD STREAK', String(sum.recordStreak),
          sum.recordStreakCounted
            ? 'RECORDS IN A ROW'
            : 'BREAK TODAY FOR ' + (sum.recordStreak + 1));
      }
      if (sum.dayStreak > 0) {
        html += plate('DAY STREAK', String(sum.dayStreak),
          sum.dayStreakCounted
            ? (sum.dayStreak === 1 ? 'DAY' : 'DAYS') + ' IN A ROW'
            : 'RUN TODAY FOR ' + (sum.dayStreak + 1));
      }
      if (sum.last) {
        html += plate('LAST RUN', Pace.clock(sum.last.time),
          dayName(sum.last.date, sum.dateKey) + ' · ' + Tier.of(sum.last.time).name);
      }
      if (!html && sum.best) {
        html += plate('ALL-TIME BEST', Pace.clock(sum.best.time),
          Tier.of(sum.best.time).name + ' · ' + sum.best.streak + ' CLEAN');
      }
      n.startMemory.innerHTML = html;
      if (api.markScroll) requestAnimationFrame(api.markScroll);
    };

    // ---- the run history ------------------------------------------------

    /** 2026-08-05 -> "AUG 5", with the year only when it is not this one. */
    function histDay(key, today) {
      const t = Store ? Store.parseKey(key) : NaN;
      if (isNaN(t)) return key;
      const dt = new Date(t);
      const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const s = M[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
      const ty = Store ? Store.parseKey(today) : NaN;
      return (!isNaN(ty) && new Date(ty).getUTCFullYear() !== dt.getUTCFullYear())
        ? s + ' ' + dt.getUTCFullYear() : s;
    }

    /**
     * Fill the history tab, and show its door only when there is something
     * behind it -- the same empty-state rule the memory plates follow, so a
     * first-ever visit still gets exactly the panel a stranger has always got.
     */
    /**
     * THE WHOLE POOL, WITH THE RECORD CITIES MARKED.
     *
     * Read off MR.Course.SETTINGS rather than a list typed here, so a city
     * added to that table appears in this panel the same day, in the table's
     * own order, and the count moves with it. Nothing below knows or cares
     * that there are currently twelve.
     *
     * A history row's city is matched by NAME, because that is what main.js
     * writes into the save (course.settings[0].name) and it is the only field
     * of the two lists that is guaranteed to be there -- an old row predating
     * a tag rename still matches on the word the player saw. A row whose city
     * is not in the pool at all is simply not represented here; it keeps its
     * place in PAST DAYS below, which is the log and is meant to hold
     * everything that happened.
     */
    function drawCities(sum) {
      const pool = (MR.Course && MR.Course.SETTINGS) ? MR.Course.SETTINGS : [];
      if (!pool.length) { n.cityRule.textContent = ''; n.cityGrid.innerHTML = ''; return; }
      const seen = (sum && sum.cities) || {};
      let done = 0;
      const html = pool.map(function (s) {
        const c = seen[s.name];
        const state = (c && c.rec) ? 'rec' : c ? 'ran' : 'new';
        if (state === 'rec') done++;
        // A mark as well as a colour and an opacity: the three states have to
        // be told apart by someone who cannot see the difference between the
        // green and the cream, and by anyone reading this on a phone in the
        // sun. Typeset, not iconed, for the reason the WR mark below is -- the
        // embedded face is subset to what this HUD prints and a symbol would
        // arrive in the system font.
        const mark = state === 'rec' ? 'WR' : state === 'ran' ? 'RAN' : '&mdash;';
        return '<span class="ccity ' + state + '">'
          + '<span class="cname">' + s.name + '</span>'
          + '<span class="cmark">' + mark + '</span></span>';
      }).join('');
      n.cityRule.textContent = 'RECORD CITIES · ' + done + ' OF ' + pool.length;
      n.cityGrid.innerHTML = html;
    }

    api.setHistory = function (sum) {
      const rows = sum && sum.history ? sum.history : [];
      n.histBtn.classList.toggle('hidden', !rows.length);
      n.endHistBtn.classList.toggle('hidden', !rows.length);
      if (!rows.length) {
        n.histSum.innerHTML = '';
        n.histList.innerHTML = '';
        n.cityRule.textContent = '';
        n.cityGrid.innerHTML = '';
        return;
      }
      drawCities(sum);

      let wr = 0;
      for (const e of rows) if (e.rec) wr++;
      let html = '';
      if ((sum.recordStreak | 0) >= 2) {
        html += plate('RECORD STREAK', String(sum.recordStreak),
          sum.recordStreakCounted ? 'RECORDS IN A ROW'
                                  : 'BREAK TODAY FOR ' + (sum.recordStreak + 1));
      }
      html += plate('DAYS FINISHED', String(rows.length), 'ONE CITY EACH');
      html += plate('RECORDS BROKEN', String(wr), wr ? 'MARKED WR BELOW' : 'NONE YET');
      n.histSum.innerHTML = html;

      n.histList.innerHTML = rows.map(function (e) {
        return '<div class="hrow' + (e.rec ? ' rec' : '') + '">'
          + '<span class="hdate">' + histDay(e.date, sum.dateKey) + '</span>'
          + '<span class="hcity">' + (e.city || '&mdash;') + '</span>'
          + '<span class="hwr">' + (e.rec ? 'WR' : '') + '</span>'
          + '<span class="htime num">' + Pace.clock(e.time) + '</span>'
          + '</div>';
      }).join('');
    };

    // WHICH PANEL OPENED THE LOG, because BACK has to go back. The history is
    // now reachable from two places and the return path is not the same one:
    // sending a player who opened it from the finish card back to the START
    // panel would silently discard the result they were just looking at.
    let histFrom = null;
    const openHist = function (from) {
      histFrom = from;
      from.classList.add('hidden');
      n.histPanel.classList.remove('hidden');
      syncPanels();
      requestAnimationFrame(markScroll);
    };
    // ---- MILES'S LINES (docs/miles.md) ----------------------------------
    // One a day before the gun, one at the tape. City lines are authored per
    // SETTINGS tag rather than derived from the hints, because a voice is
    // written and a hint is a contract with the renderer -- different jobs.
    // Register: terse, no exclamation marks, a professional talking to
    // himself. The result line at the tape is picked by what the run WAS:
    // the record, a near miss inside fifteen seconds (his watch-check beat,
    // in words), or a day the road won.
    const MILES_CITY = {
      BOSTON: 'RIGHT ON HEREFORD. LEFT ON BOYLSTON.',
      LONDON: 'OVER THE THAMES. HOLD THE LINE.',
      BERLIN: 'FLAT AND FAST. NO EXCUSES.',
      CHICAGO: 'UNDER THE L. KEEP IT CLEAN.',
      NEWYORK: 'THE VERRAZZANO FIRST. THEN WE TALK.',
      TOKYO: 'THE MOAT, THEN THE NEON. FAST ROAD.',
      SYDNEY: 'THE HARBOUR WIND IS REAL.',
      PARIS: 'COBBLES LIE. STAY WIDE.',
      VALENCIA: 'WHITE STONE. QUICK GROUND.',
      AMSTERDAM: 'CANALS ON BOTH SIDES. PICK A LANE.',
      ROME: 'OLD ROADS KNOW EVERYTHING.',
      CAPETOWN: 'THE MOUNTAIN WATCHES. RUN.',
    };
    api.milesSpeaks = function (tag) {
      const line = MILES_CITY[tag];
      n.milesLine.innerHTML = line
        ? '&ldquo;' + line + '&rdquo;<span class="who">&mdash; MILES</span>' : '';
      n.milesLine.classList.toggle('hidden', !line);
    };
    api.milesFinish = function (finishTime) {
      const over = finishTime - K.RECORD_SECONDS;
      const line = over <= 0 ? 'THAT&rsquo;S THE ONE.'
        : over <= 15 ? (over <= 1.5 ? 'ONE SECOND. TOMORROW.'
          : Math.ceil(over) + ' SECONDS. TOMORROW.')
        : 'THE ROAD WON TODAY.';
      n.milesEnd.innerHTML = '&ldquo;' + line + '&rdquo;<span class="who">&mdash; MILES</span>';
    };

    n.histBtn.addEventListener('click', function () { openHist(n.startPanel); });
    n.endHistBtn.addEventListener('click', function () { openHist(n.endPanel); });
    n.histBack.addEventListener('click', function () {
      n.histPanel.classList.add('hidden');
      (histFrom || n.startPanel).classList.remove('hidden');
      syncPanels();
      requestAnimationFrame(markScroll);
    });

    // ---- the daily lockout ----------------------------------------------

    /**
     * Put the start panel into (or out of) its day-is-won state.
     *
     * The panel keeps its masthead, city, wager and memory; what changes is
     * the offer: TOE THE LINE and the key legend step out, the RECORD BROKEN
     * box steps in, and the finish card's RUN IT AGAIN relabels to say the
     * road is closed. main.js owns WHETHER today is locked (it holds the save
     * and the nosave flag); this only draws it.
     *
     * The countdown to the next course is re-derived on a slow tick rather
     * than counted down, so a laptop waking from sleep shows the truth. When
     * it reaches zero the page cannot roll the course without a reload --
     * the seed is read at boot -- so the line says exactly that.
     */
    let lockTimer = null;
    api.setLocked = function (info) {
      n.startPanel.classList.toggle('locked', !!info);
      n.lockedBox.classList.toggle('hidden', !info);
      n.againBtn.textContent = info ? 'DONE FOR TODAY' : 'RUN IT AGAIN';
      if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
      if (!info) return;
      n.lockTime.textContent = Pace.clock(info.time);
      const tick = function () {
        const t0 = Store ? Store.parseKey(info.dateKey) : NaN;
        const left = isNaN(t0) ? NaN : (t0 + 86400000) - Date.now();
        let s = '';
        if (isFinite(left)) {
          if (left <= 0) s = 'A NEW ROAD IS READY · RELOAD';
          else {
            const mins = Math.ceil(left / 60000);
            const h = Math.floor(mins / 60), m = mins - h * 60;
            s = 'NEXT COURSE IN ' + (h > 0 ? h + 'H ' : '') + m + 'M';
          }
        }
        n.lockNext.textContent = s;
      };
      tick();
      lockTimer = setInterval(tick, 30000);
      if (api.markScroll) requestAnimationFrame(api.markScroll);
    };

    // cleanFinish() -- the flawless-run counterfactual that priced the
    // contacts-cost plate -- went with that plate: the owner removed the row,
    // and this was its only reader. chapterCosts() below never used it; its
    // baseline is its own run(-1), differenced against itself.

    /**
     * WHICH LEG THE RUN WAS LOST IN.
     *
     * It was "which CITY", cut at the day's setting boundaries -- and the
     * one-city-a-day decision (docs/one-city-a-day.md, roadmap 73) removed
     * those boundaries: a course is one city end to end, so a per-city
     * counterfactual has exactly one row and answers nothing. The cut moves
     * to the BIOME LEGS, which are the six chapters every day's race still
     * has (CITY START through FINAL MILE), and everything below -- the
     * counterfactual, the floor, the majority rule -- is cut-agnostic and
     * carries over unchanged. The history that justified the counterfactual
     * itself is kept as written, city names and all; the measurements were
     * real and the reasoning is about CUTS, not about what they are named.
     *
     * The roadmap asked for "a segment clock" per city. Measured over 60
     * dates, that is a number about the COURSE and not about the player: a
     * chapter runs 34.3 to 126.9 real seconds (mean 69.4), and the spread is
     * set almost entirely by where course.js jittered the boundaries. Two
     * other candidates were measured and rejected for the same reason:
     *
     *   THE GHOST DELTA PER CHAPTER is the pace ramp with a city name on it.
     *   On a FLAWLESS run over ten dates the first chapter reads +97s to
     *   +134s and the last -51s to -158s -- every time, on every date, on a
     *   run heading for the record. That is exactly what condemned the
     *   six-row split table, and it would have printed a large positive
     *   number in the one place a player looks for a verdict.
     *
     *   ELAPSED-MINUS-FLAWLESS per chapter cancels the ramp exactly (a clean
     *   run measures 0.000s in every chapter over 40 dates) and still charges
     *   the wrong city, because a broken streak is paid off for the rest of
     *   the race: five contacts in Berlin billed Boston 2:45 and Chicago 0:57
     *   for a stretch the player ran clean. On 2026-08-12 it named Sydney as
     *   the worst chapter of a run whose every contact was in Tokyo.
     *
     * What is left is the counterfactual, which is also the language the cost
     * plate above already speaks ("CLEAN, YOU FINISH 1:58:04 ON THIS
     * COURSE"): re-run this exact race with one city's contacts erased and
     * ask what it would have finished in. A city the player ran clean scores
     * exactly zero by construction, so it cannot be blamed for a neighbour.
     *
     * ONE LINE, NOT A TABLE, and that is measured too. Over 60 bursty runs
     * per row:
     *
     *     3 contacts   top city holds 87% of the cost, 60/60 majority
     *     8 contacts   63%, 47/60
     *    20 contacts   51%, 27/60
     *
     * So on the runs a player is reading the card for, one chapter IS the
     * story and the other rows are zeros; on a wreck the breakdown flattens
     * into similar numbers -- the split table's second failure, noise -- and
     * the counterfactuals stop summing to the plate's own total (55s adrift
     * at 20 contacts, against 1.2s at three). A table would print its worst
     * self on the runs it reads worst. A single line simply does not appear
     * unless one chapter genuinely carried the run, which is the same rule
     * the memory plates, the best-today line and the aid note already follow.
     */
    /**
     * Which biome leg a gate z falls in.
     *
     * A gate's leg is decided by the gate's own z, not by where the runner
     * happened to be on the frame that resolved it. Frame-rate independent,
     * and it is the same test world.js uses to decide which leg to build.
     *
     * Shared by the chapter counterfactual below and the share card's six
     * blocks, so the two can never disagree about which leg a contact was in
     * -- a card saying the run was clean through THE WALL over a row of blocks
     * with THE WALL in red would be the game contradicting itself in ninety
     * pixels.
     */
    function legCut() {
      const legs = course && course.biomes;
      if (!legs || !legs.length) return null;
      const cut = legs.map(function (b) { return b.from * K.TOTAL_UNITS; });
      return {
        legs: legs,
        of: function (z) {
          let i = 0;
          for (let k = 0; k < cut.length; k++) if (z >= cut[k]) i = k;
          return i;
        },
      };
    }

    function chapterCosts() {
      if (chapterCost !== null) return chapterCost;
      chapterCost = [];
      // The biome legs are course.js's BIOMES: six of them, every day, by
      // design -- so unlike the settings cut this one never degenerates.
      const cutter = legCut();
      const legs = cutter && cutter.legs;
      if (!legs || legs.length < 2 || !hitZ || !hitZ.size
          || !course.gates || !course.gates.length) return chapterCost;
      const legOf = cutter.of;

      // The hill is not modelled here because pace.js integrates the grade
      // term to zero over the race: it measures 0.01s on a flawless finish
      // (established when the retired cleanFinish() counterfactual was built,
      // and unchanged by its retirement). Both sides of every
      // subtraction below use the identical model anyway, so anything it did
      // contribute would cancel.
      const run = function (skip) {
        const p = Pace.create();
        let gi = 0, guard = 0;
        while (!p.finished && guard++ < 40000) {
          p.update(1 / 60);
          while (gi < course.gates.length && p.units >= course.gates[gi].z) {
            const g = course.gates[gi];
            gi++;
            if (hitZ.has(g.z) && legOf(g.z) !== skip) p.onHit();
            else p.onClean();
          }
        }
        return p.finished ? p.finishTime : 0;
      };

      // Differenced against the RECONSTRUCTION, never against the real finish
      // time. The reconstruction cannot reproduce a live run to the
      // millisecond -- it replays gate outcomes, not the player's exact frame
      // timings -- and any drift it does have is common to both terms and
      // cancels here. Differencing against p.finishTime would put that drift
      // into the answer.
      const base = run(-1);
      if (!base) { chapterCost = []; return chapterCost; }
      for (let i = 0; i < legs.length; i++) {
        chapterCost.push({ name: legs[i].name, cost: Math.max(0, base - run(i)) });
      }
      return chapterCost;
    }

    /** The leg that carried the run, or nothing when no single leg did. */
    function decisiveChapter(actualFinish) {
      const rows = chapterCosts();
      if (!rows.length) return null;
      let total = 0, top = rows[0];
      for (const r of rows) { total += r.cost; if (r.cost > top.cost) top = r; }
      // A majority, and worth naming. Ten seconds is roughly a quarter of what
      // a single contact costs, so the floor only suppresses trivia; the
      // majority test is what keeps the line off a run that fell apart
      // everywhere, where naming one leg would be a lie about the other five.
      // Six rows instead of three or four makes the majority STRICTER, not
      // looser, so the line prints less often rather than more -- the safe
      // direction for a verdict.
      if (total <= 0 || top.cost < 10 || top.cost / total <= 0.5) return null;
      // Reported against the run's OWN finish time, so the two numbers on the
      // card are commensurable even where the reconstruction drifted.
      return { name: top.name, would: actualFinish - top.cost };
    }

    // ---- the share card --------------------------------------------------

    // 0 the leg was run clean, 1 a contact the pool paid for, 2 a contact
    // nothing paid for. Ordered so the worse outcome always wins the leg: a
    // leg with one guard and one real hit is red, because the run lost time
    // there and that is what the row is reporting.
    const LEG_CLEAN = 0, LEG_GUARD = 1, LEG_HIT = 2;

    // Written as escapes rather than as the characters themselves so the build
    // pipeline, the linters and every editor this file passes through cannot
    // silently mangle them: U+1F7E9 green square, U+1F7E8 yellow, U+1F7E5 red,
    // U+1F3C6 trophy.
    const BLOCK = ['\uD83D\uDFE9', '\uD83D\uDFE8', '\uD83D\uDFE5'];
    const TROPHY = '\uD83C\uDFC6';

    /**
     * One mark per biome leg, worst outcome wins.
     *
     * This is a BYPRODUCT and not new bookkeeping: main.js already recorded
     * the z of every contact for the chapter counterfactual, and the only
     * thing added for this card was recording the guarded ones too -- the
     * counterfactual could not use them (a guard costs no time, so erasing one
     * measures zero) and the card is the first thing that ever needed them.
     *
     * A leg with no gates in it reads clean, which is correct: nothing was hit
     * there. Every leg of every real course carries gates, so this is a
     * statement about the degenerate case rather than about any shipped day.
     */
    function legMarks() {
      const cutter = legCut();
      if (!cutter) return [];
      const marks = cutter.legs.map(function () { return LEG_CLEAN; });
      if (guardZ) {
        for (const z of guardZ) {
          const i = cutter.of(z);
          if (marks[i] < LEG_GUARD) marks[i] = LEG_GUARD;
        }
      }
      if (hitZ) {
        for (const z of hitZ) marks[cutter.of(z)] = LEG_HIT;
      }
      return marks;
    }

    /**
     * The result as text, and the whole design is in what it does NOT carry.
     *
     * Four lines, and the fourth only when it has something true to say:
     *
     *   MARATHON MILES · CAPE TOWN
     *   SUB-2:02 · 2:01:47 (+2:17)
     *   [six blocks]
     *   Day streak: 6
     *
     * NO URL. The game has no domain yet and a share string that invents one
     * is a broken link travelling under the game's name; the line goes in the
     * day the owner has somewhere to point it, and not before.
     *
     * NO SPOILERS, which is a constraint on every field and not a note on one.
     * The city is the day's public name -- it is on the start panel before a
     * stroke is played, and every player on the date gets the same one -- and
     * the blocks describe the RUN. Nothing here names a gate, a lane, a mile,
     * an obstacle or a count of them.
     *
     * A RECORD READS AS A RECORD. The trophy and a negative delta, in the same
     * line, so it cannot be mistaken for a good-but-not-record run at a
     * glance. The grade word does the rest: RECORD is the only rung whose name
     * is not a time.
     *
     * The day streak is held back until 2 for the reason the memory plate
     * holds it back: a streak of one is just today wearing a label -- and on
     * a shared result it would be a boast about having turned up once.
     */
    function buildShare(p, rec, marks) {
      const t = p.finishTime;
      const set = course && course.settings;
      const city = set && set.length ? set[0].name : '';
      const vs = t - K.RECORD_SECONDS;
      const isRec = t <= K.RECORD_SECONDS;

      const out = [];
      out.push('MARATHON MILES' + (city ? ' · ' + city : ''));
      out.push((isRec ? TROPHY + ' ' : '') + Tier.of(t).name
        + ' · ' + Pace.clock(t)
        + ' (' + (vs <= 0 ? '-' : '+') + Pace.clock(Math.abs(vs)) + ')');
      if (marks.length) out.push(marks.map(function (m) { return BLOCK[m]; }).join(''));
      const streak = rec && rec.dayStreak ? rec.dayStreak | 0 : 0;
      if (streak >= 2) out.push('Day streak: ' + streak);
      return out.join('\n');
    }

    /**
     * Say what happened, every time, and never nothing.
     *
     * A copy button that reports nothing is worse than no button: the player
     * cannot tell a working copy from a blocked one without leaving the game
     * to go and paste somewhere. `hold` keeps the last-resort message up --
     * that one is an instruction, not a receipt, and it has to survive until
     * the player has acted on it.
     */
    let noteTimer = null;
    function shareNote(text, hold) {
      n.shareNote.textContent = text;
      clearTimeout(noteTimer);
      if (text && !hold) {
        noteTimer = setTimeout(function () { n.shareNote.textContent = ''; }, 2600);
      }
    }

    /**
     * The four ways a browser will let a page hand text to a person, in the
     * order they are worth trying.
     *
     * 1. THE NATIVE SHARE SHEET, on touch devices only. navigator.share exists
     *    on desktop Chrome and Edge too, where it opens a Windows share dialog
     *    most people have never used and cannot cancel back out of gracefully;
     *    on a phone it is the whole point, because it reaches the messaging
     *    app the result is going to anyway. So the test is the same one the
     *    key legend uses -- pointer: coarse -- rather than a width, which is
     *    not an input type.
     * 2. THE ASYNC CLIPBOARD, called from inside the click. That is a real
     *    user gesture, which is what keeps it from prompting for permission,
     *    and it is why none of this is done anywhere but the handler.
     * 3. execCommand('copy') off an off-screen textarea, for old webviews that
     *    have no navigator.clipboard at all. Deprecated, still the only thing
     *    that works there.
     * 4. SHOW THE PLAYER THE TEXT, selected, and say so. Nothing can take this
     *    one away.
     */
    function shareLast(text) {
      let ok = false;
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        // Fixed and inside the viewport rather than parked at -1000px: iOS
        // scrolls to a selection, and a selection off the top of the document
        // takes the finish card with it.
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;'
          + 'padding:0;border:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        if (ta.setSelectionRange) ta.setSelectionRange(0, text.length);
        ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { ok = false; }
      if (ok) { shareNote('COPIED'); return; }
      n.shareText.value = text;
      n.shareBox.classList.add('revealed');
      try { n.shareText.focus(); n.shareText.select(); } catch (e) { /* still visible */ }
      shareNote('SELECT AND COPY', true);
      if (api.markScroll) requestAnimationFrame(api.markScroll);
    }

    function shareCopy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { shareNote('COPIED'); },
          function () { shareLast(text); }
        );
        return;
      }
      shareLast(text);
    }

    n.shareBtn.addEventListener('click', function () {
      const text = shareStr;
      if (!text) return;
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (coarse && navigator.share) {
        let p = null;
        try { p = navigator.share({ text: text }); } catch (e) { p = null; }
        if (p && p.then) {
          p.then(function () { shareNote('SHARED'); }, function (e) {
            // A cancelled share sheet is the player changing their mind, not a
            // failure, and must not be answered with a fallback they did not
            // ask for. Anything else means the sheet could not open at all.
            if (e && e.name === 'AbortError') shareNote('');
            else shareCopy(text);
          });
          return;
        }
      }
      shareCopy(text);
    });

    // Exposed so tools/sharecard.js reads the string the button copies rather
    // than rebuilding it -- an instrument that recomputes its subject is
    // measuring itself. See correction 28 in docs/roadmap.md.
    api.shareString = function () { return shareStr; };

    /**
     * Draw the day's route along the rail.
     *
     * THE TWO AXES ARE THE SAME AXIS, and that is not a coincidence to be
     * checked at runtime. The rail is drawn at `miles / MARATHON_MILES`;
     * course.js hands settings over as fractions of race distance, which
     * world.js reads as `from * TOTAL_UNITS`; and TOTAL_UNITS is defined as
     * MARATHON_MILES * UNITS_PER_MILE. So a setting's `from` is already this
     * bar's own coordinate and needs no conversion. If either definition ever
     * moves, the boundary marks and the world's cross-fade move together,
     * because both read the same field.
     *
     * A boundary gets a mark ON the bar as well as a name UNDER it: the name
     * alone cannot say where a city started, and where a city started is the
     * whole reason the ghost gap drawn on the same bar becomes a statement
     * about a place rather than about a distance.
     */
    function drawRoute(set) {
      for (const old of n.rail.querySelectorAll('.railCut')) old.remove();
      n.railRoute.innerHTML = '';
      if (!set || !set.length) return;

      // ONE city a day means this loop draws no cuts (it starts at 1) and the
      // row below is a single label owning the whole bar. Both are left as
      // loops on purpose: the seam machinery stays dormant, not deleted, and
      // an old multi-stop course still draws its boundaries correctly.
      for (let i = 1; i < set.length; i++) {
        const cut = el('div', 'railCut');
        cut.style.left = (set[i].from * 100) + '%';
        n.rail.appendChild(cut);
      }
      // Each name is boxed to its OWN share of the bar and clipped there. A
      // four-city day can give a segment as little as 15% of the road (the
      // generator's floor is 60% of an even share), which is ~51px at 390
      // wide -- narrower than the word AMSTERDAM. Clipping keeps a long name
      // inside its own city rather than letting it push the next one along
      // the axis, which would put every label in the wrong place. A solo
      // label -- the shipped case -- is centred under the bar instead of
      // hugging the start line (.rcity.solo).
      for (const s of set) {
        const span = el('span', 'rcity' + (set.length === 1 ? ' solo' : ''), s.name);
        span.style.left = (s.from * 100) + '%';
        span.style.width = ((s.to - s.from) * 100) + '%';
        n.railRoute.appendChild(span);
      }
      cache.here = undefined;
      fitRoute();
    }

    /**
     * Shrink the route until the longest name fits its own city.
     *
     * MEASURED, not guessed at, and the guess was wrong: 9px looked safe
     * against a third of the bar and is not. At 360x780 on 2026-08-13 the
     * generator gives AMSTERDAM 52px of a four-city bar and the label clipped
     * to AMSTERD -- which does not read as a truncation, it reads as the game
     * having failed to draw a word.
     *
     * The whole row steps down together. One name at a smaller size than its
     * neighbours reads as a defect even when it is deliberate, and the row's
     * height is pinned in the stylesheet, so nothing below it moves whatever
     * this lands on -- which is what keeps footroom.js out of it.
     */
    function fitRoute() {
      const spans = n.railRoute.children;
      if (!spans.length) return;
      const over = function () {
        for (const s of spans) if (s.scrollWidth > s.clientWidth + 1) return true;
        return false;
      };
      n.railRoute.style.fontSize = '';
      // Four steps from the stylesheet's own size, which reaches 6px from 9
      // and 7px from 10. Below that the row would be unreadable and the
      // ellipsis backstop in the stylesheet is the better failure.
      const base = parseFloat(getComputedStyle(n.railRoute).fontSize) || 9;
      for (let i = 1; i <= 4 && over(); i++) {
        n.railRoute.style.fontSize = Math.max(6, base - i * 0.75) + 'px';
      }
    }

    /**
     * Name today's road, and price the wager.
     *
     * ONE CITY since the one-city-a-day decision (roadmap 73), so this is a
     * HEADLINE rather than a route string: the day's identity in a word --
     * "ROME" -- the way a single puzzle has a single name, styled up to
     * headline weight in the stylesheet (.panel .route). The map/join is kept
     * because it is exactly one name now and still prints an old multi-stop
     * course honestly if one ever reaches it.
     *
     * The city is the only thing on this panel that is visibly different
     * tomorrow. A different gate layout is invisible before you press start; a
     * different city is not, which makes this the one line that earns
     * a daily habit rather than describing one.
     *
     * The gate count is read off the real course rather than typed in, because
     * the claim is a measurement -- the record survives exactly one mistake,
     * and that was established by simulating this pace model against real
     * generated courses.
     */
    api.setCourse = function (c) {
      if (!c) return;
      course = c;
      chapterCost = null;
      const set = course.settings;
      n.startRoute.textContent = set && set.length
        ? set.map(function (x) { return x.name; }).join(' → ')
        : '';
      drawRoute(set);
      api.milesSpeaks(set && set.length ? set[0].tag : null);
      // The route and the gate count arrive after the panel is first laid out
      // and both add height, so the overflow test has to run again here or it
      // measures a panel shorter than the one on screen.
      if (api.markScroll) requestAnimationFrame(api.markScroll);
    };

    /**
     * Show the right instruction to the right device.
     *
     * The legend used to lead with four arrow-key chips and end with the word
     * "swipe", on every device -- and at 360px and below it wrapped so that
     * "swipe", the only instruction that applied to the phone in the reader's
     * hand, was orphaned alone on the second line. Width was being used as a
     * proxy for input type, and it is not one: a 1024px tablet got pure
     * keyboard instructions and a narrow desktop window got told to swipe.
     */
    function inputHint() {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (coarse) {
        return 'Swipe <b>left</b> / <b>right</b> to change lane, ' +
               '<b>up</b> to jump, <b>down</b> to slide';
      }
      return '<kbd>&larr;</kbd><kbd>&rarr;</kbd> lanes &nbsp;·&nbsp; ' +
             '<kbd>&uarr;</kbd> jump &nbsp;·&nbsp; <kbd>&darr;</kbd> slide' +
             '<span class="orSwipe"> &nbsp;·&nbsp; or swipe</span>';
    }
    n.startKeys.innerHTML = inputHint();

    /**
     * Flag a panel that overflows, so the fade at its bottom edge only appears
     * when there is genuinely something below the fold.
     *
     * On a 320x460 viewport the CTA sat 175px past the bottom with no
     * scrollbar, no reserved gutter and nothing on screen to suggest a swipe
     * would help. Scrolling worked -- it was measured -- but on a full-screen
     * game overlay "no button" reads as "broken", and a recovery nobody knows
     * about is not a recovery.
     */
    function markScroll() {
      for (const el of [n.startPanel, n.endPanel, n.histPanel]) {
        if (!el) continue;
        el.classList.toggle('canScroll', el.scrollHeight - el.clientHeight > 4);
      }
    }
    api.markScroll = markScroll;
    window.addEventListener('resize', markScroll);
    // The route is fitted to a width, so it has to be refitted when the width
    // changes -- a phone turned on its side is the common case, and the row it
    // lands in is the one the runner stands on.
    window.addEventListener('resize', fitRoute);
    for (const el of [n.startPanel, n.endPanel, n.histPanel]) {
      el.addEventListener('scroll', function () {
        el.classList.toggle('canScroll',
          el.scrollHeight - el.clientHeight - el.scrollTop > 4);
      }, { passive: true });
    }
    if (window.matchMedia) {
      const mq = window.matchMedia('(pointer: coarse)');
      const onMq = function () { n.startKeys.innerHTML = inputHint(); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }

    api.update = function (p, extra) {
      set(n.clock, 'clock', Pace.clock(p.raceTime));
      set(n.distVal, 'dist', p.miles.toFixed(2));

      // ---- the headline: is the record still alive ----------------------
      // projectClean() rolls the real streak/easing model forward assuming the
      // line holds from here, rather than freezing the current pace. The
      // frozen-pace version read 2:24:12 at the gun on a run heading for
      // 1:58:14; this reads 1:57:48 there and is exact from about mile 3.
      const proj = p.projectClean();
      const margin = K.RECORD_SECONDS - proj;         // positive = under the record
      set(n.projVal, 'proj', Pace.clock(proj));

      // Pace required over the road that is left. This is the race-desk number
      // and it is also the exact test for a dead record: FLOOR_PACE is the
      // fastest the streak can ever make you, so once the requirement drops
      // below it no run of clean gates can get the record back.
      const remain = K.MARATHON_MILES - p.miles;
      const need = remain > 0.01 ? (K.RECORD_SECONDS - p.raceTime) / remain : NaN;
      if (!recordGone && remain > 0.01 && !(need >= K.FLOOR_PACE)) recordGone = true;
      const gone = recordGone;

      // The projection is an estimate until enough of the race has gone past
      // to measure the gate rate it depends on. `unlocked` -- the share of the
      // START_PACE -> FLOOR_PACE range the streak had already bought -- used
      // to gate this and was computed here for a test that no longer reads it;
      // it has been removed rather than left as a dead line that looks load
      // bearing. projectClean() is within ~30s of the truth by the first mile,
      // so the verdict can harden almost immediately.
      const settled = p.miles > 0.6;
      const bleeding = p.targetPace() - p.pace > 1.5; // streak was cut, pace sliding back

      let state, chip, sub;
      if (gone) {
        // THE RECORD IS DEAD; THE RACE IS NOT.
        //
        // Measured on the model as it stands, a 90%-accuracy run loses the
        // record at wall-second 96 of 267 and a 95% run at second 126 of 254
        // -- so between half and two thirds of a typical session used to have
        // no goal in it at all. Worse, the readout kept demanding a required
        // pace the engine physically cannot produce, in red, for the rest of
        // the race: the pace floor is 4:14 and the ask ran below 4:00. The
        // screen was requesting something impossible and grading the player
        // against it for two and a half minutes.
        //
        // So the headline retargets. The projection is unchanged -- it is
        // still "where you finish if you hold a clean line from here" -- but
        // it is now measured against the rung of the ladder the run is
        // actually on, and the sub-line names the next rung up. Both move
        // live, so clearing gates still changes the number the player is
        // looking at, which is the whole job of a race readout.
        const rung = Tier.of(proj);
        const up = Tier.next(proj);
        state = 'tier';
        if (isFinite(rung.max)) {
          // A rung is being held. Name it, and price the next one up.
          chip = rung.name;
          sub = up
            ? Pace.clock(Tier.gapTo(proj, up)) + ' OFF ' + up.name
            : 'ON FOR ' + rung.name;
        } else {
          // The bottom of the ladder, where the rung is called FINISHED --
          // which is the right word on the finish card and the wrong one at
          // mile 20, where a chip reading FINISHED next to a header reading
          // PROJ FINISH says the race is already over. With no rung held
          // there is nothing to report, so the chip names the one being
          // chased instead, marked as a target rather than a standing.
          chip = up ? '▲ ' + up.name : rung.name;
          sub = up ? Pace.clock(Tier.gapTo(proj, up)) + ' TO GO' : '';
        }
      } else if (!settled) {
        state = 'est';
        chip = bleeding ? 'BLEEDING SPEED ▲' : 'ESTIMATING';
      } else {
        // DEBOUNCED, because the underlying comparison is a coin landing on
        // its edge. Around mile 2 of a clean run projectClean() crosses 7170
        // by single seconds, and the chip flickered between RECORD ON and OFF
        // RECORD several times in a couple of seconds -- which reads as a
        // broken readout, and destroys the authority of the one number on
        // screen that is supposed to be the verdict. A verdict has to stand
        // for a moment to be a verdict: it flips only once the projection is
        // CHIP_DEAD seconds clear on the other side, and never twice inside
        // CHIP_HOLD milliseconds.
        const now = performance.now();
        const want = margin > 0;
        if (chipOn === null) { chipOn = want; chipAt = now; }
        else if (want !== chipOn
                 && (want ? margin > CHIP_DEAD : margin < -CHIP_DEAD)
                 && now - chipAt > CHIP_HOLD) {
          chipOn = want; chipAt = now;
        }
        state = chipOn ? 'on' : 'off';
        chip = chipOn ? 'RECORD ON' : 'OFF RECORD';
      }
      if (sub === undefined) {
        sub = Pace.clock(Math.abs(margin))
            + (margin >= 0 ? ' UNDER ' : ' OVER ') + K.RECORD_LABEL;
      }
      set(n.margin, 'margin', sub);
      set(n.status, 'chip', chip);
      cls(n.status, 'chipCls', 'chip ' + state);
      cls(n.projCell, 'projCls', state);

      // ---- the engine: the tank, and the speed it bought ------------------
      // Two marks, one variable. The fill is a linear map of the pace the
      // streak has unlocked; the number names it in the units of the wager;
      // and both cross the white record tick at the same instant, which is why
      // the required-pace line and the clean count that used to sit under here
      // were removed rather than reworded. See the plate's comment above.
      // The pace fill, which is what the bar has always drawn. Under EFFORT it
      // is drawn against the SURGE floor rather than K.FLOOR_PACE, because the
      // range the gauge maps has to be the range the player can actually reach
      // -- a bar that pinned at 100% while a surge was still buying speed would
      // stop moving at exactly the moment the player spent something for it.
      // The fastest pace anything can reach. It was FLOOR_SURGE under EFFORT,
      // because an elected surge ran toward a second floor; with one speed
      // system there is one floor, and a lift moves the TARGET toward it
      // rather than moving the floor itself.
      const lo = K.FLOOR_PACE;
      const pace01 = clamp01((K.START_PACE - p.pace) / (K.START_PACE - lo));
      if (MR.Pace.EFFORT > 0) {
        // The fill is the POOL, counted. Fractional while a surge burns, which
        // is the whole difference between the two spends: a guard takes one
        // segment in a single step and reads as a notch going out, a surge
        // slides continuously down through the divisions.
        // ---- THE GAUGE IS ENERGY NOW, NOT THE GUARD POOL ------------------
        //
        // It used to count segments, which meant it only mattered to a player
        // who was about to crash -- and a player who never crashes had no
        // reason to look at it at all. Energy drains from the gun whether you
        // crash or not and sets your top speed below the knee, so this is now
        // the one number on screen that is always about to cost you something.
        //
        // Below the knee it turns, because a bar that only gets shorter does
        // not say WHEN the slowing starts, and the whole mechanic is that
        // there is a line you must stay above.
        const energy01 = clamp01(p.energy);
        n.gaugeFill.style.width = (energy01 * 100) + '%';
        n.gaugePace.style.left = (pace01 * 100) + '%';
        // ---- AND THE LAST 385 YARDS SAY SO --------------------------
        // The kick is the fastest ground in the game and it is over in about
        // a minute; without a word on screen it reads as the pace gauge
        // glitching. The label is the cheapest place to say it -- the plate,
        // the box and the bar all stay exactly where they were, so nothing
        // moves under the player at the one moment they are threading
        // obstacles at full speed.
        set(n.engLab, 'engLab', p.kicking ? 'KICK' : 'ENERGY');
        cls(n.gaugeFill, 'fillCls', 'gaugeFill'
          + (p.kicking ? ' kick'
             : p.energy < MR.Pace.EFFORT_CFG.ENERGY_KNEE ? ' dry' : ''));
        // The gauge is the POOL, counted, and it now has one spend: guard.
        // The 'surging' class it used to carry while a segment burned has no
        // state left to represent.
        cls(n.paceGauge, 'gaugeCls', 'gauge tank pool');
        cls(n.engine, 'engCls', '');
      } else {
        n.gaugeFill.style.width = (pace01 * 100) + '%';
      }
      set(n.paceVal, 'pace', Pace.pace(p.pace));
      cls(n.paceVal, 'paceCls', 'val num' + (p.pace <= K.RECORD_PACE ? ' ahead' : ''));

      // Nothing else on screen says why the pace moves, so the line stays up
      // until the player has plainly felt it, and comes back on every break.
      const hint = performance.now() < hintUntil ? 'cut'
        : (p.streak < 12 && p.miles < 2.5) ? 'teach' : 'off';
      if (cache.hint !== hint) {
        cache.hint = hint;
        n.why.textContent = hint === 'cut'
          ? 'STREAK CUT · +' + K.HIT_TIME_PENALTY + 'S · SPEED BLEEDING'
          : 'EACH CLEAN GATE BUYS SPEED';
        n.why.className = hint === 'off' ? 'off' : hint;
      }

      // ---- the rail: you, the ghost, and the road between you ------------
      const you = clamp01(p.miles / K.MARATHON_MILES) * 100;
      const gh = clamp01(p.ghostMiles() / K.MARATHON_MILES) * 100;
      n.railFill.style.width = you + '%';
      n.railGhost.style.left = gh + '%';
      n.railGap.style.left = Math.min(you, gh) + '%';
      n.railGap.style.width = Math.abs(you - gh) + '%';

      // THE GHOST GAP IS A POSITION, NOT A GRADE -- INCLUDING ITS COLOUR.
      //
      // The wording was fixed first: this used to read GAINING / LOSING off
      // `p.pace < RECORD_PACE`, which is accurate and was still wrong. The
      // race is DESIGNED to start at 5:30 and reel the ghost in, so a flawless
      // run trails for the whole first half and the tag read LOSING for about
      // three quarters of it, while the projection at the top of the same
      // screen read RECORD ON.
      //
      // Fixing only the words was half a fix, because the COLOUR was still
      // keyed off `d < 0` -- the sign of the positional gap. So on a clean run
      // the top bug read RECORD ON / 1:24 UNDER 1:59:30 in green while the
      // rail 700px below read +1:27.1 in red: one state, two opposite
      // emotional readings, and at eight seconds in a player winning by 1:48
      // was already being told in red that they were losing. That contradiction
      // is why the start panel had grown a sentence explaining that the ghost
      // leads "by design" -- copy papering over a HUD defect.
      //
      // The grade belongs to the projection, which integrates the whole
      // remaining race and computes it correctly. So the tone comes from the
      // projection's own state, and red appears here only when the top bug is
      // also red. Being physically in front of the ghost is the one thing this
      // line can claim on its own, and it earns green for it.
      const d = p.deltaVsRecord();
      const ahead = d < 0;

      // THE RAIL IS A MAP. IT DOES NOT CARRY A SECOND VERDICT.
      //
      // Once the record died this band used to retarget too: CHASING /
      // SUB-2:06 / 4:30.0 TO FIND. The plate at the top of the same frame was
      // simultaneously reading SUB-2:12 / 2:50 OFF SUB-2:06 -- the same rung,
      // the same question, and two different answers 700px apart, because the
      // plate integrates the rest of the race with projectClean() and the rail
      // froze the current pace with projected(). Measured on one frame at 20.1
      // miles: 2:50 against 4:30.0, a disagreement of 1:40 about how far the
      // player is from the thing the screen is telling them to chase.
      //
      // Unifying the two projections would have printed the identical string
      // twice, which is the definition of the crowding this pass is for. So the
      // chase is stated once, in the plate that owns verdicts, and the rail
      // goes back to being the one thing it draws: you, the ghost, and the road
      // between you. That is geography, and it stays true after the record has
      // gone -- which is exactly why its tone is already neutral there: `tone`
      // can only be red when the projection itself is red, and on a dead run
      // the projection has retargeted onto the ladder and is not.
      // Which segment of the day's road the runner is in. Written only on the
      // crossing -- with one city a day that is exactly once, at the gun,
      // against ~14,000 frames; kept because it costs nothing and an old
      // multi-stop course still highlights correctly.
      // NOT named `set`: that is the cached text writer this function has been
      // calling since its first line, and shadowing it here throws on the
      // temporal dead zone for the whole race while still building clean.
      const cities = course && course.settings;
      if (cities && cities.length) {
        let hi = 0;
        const f = p.miles / K.MARATHON_MILES;
        for (let i = cities.length - 1; i >= 0; i--) if (f >= cities[i].from) { hi = i; break; }
        if (cache.here !== hi) {
          cache.here = hi;
          const spans = n.railRoute.children;
          // `solo` is layout, not state -- it must survive this rewrite, or
          // the one-city label snaps off-centre the moment the race starts.
          const solo = spans.length === 1 ? ' solo' : '';
          for (let i = 0; i < spans.length; i++) {
            spans[i].className = 'rcity' + solo + (i === hi ? ' here' : i < hi ? ' past' : '');
          }
        }
      }

      const tone = ahead ? 'ahead' : state === 'off' ? 'behind' : 'level';
      set(n.gapLabel, 'gapLab', 'RECORD GHOST');
      set(n.gapVal, 'gap', Pace.delta(d));
      cls(n.gapVal, 'gapCls', 'num ' + tone);
      cls(n.railGap, 'railGapCls', tone);
      set(n.gapTrend, 'trend', Math.abs(d) < 1 ? 'LEVEL' : ahead ? 'BEHIND YOU' : 'UP THE ROAD');
      cls(n.gapTrend, 'trendCls', tone);

      if (extra && extra.fps !== undefined) {
        set(n.perf, 'perf', extra.fps.toFixed(0) + ' FPS · ' + (extra.draws || 0) + ' DRAWS');
      }
    };

    api.flashBroken = function () {
      n.engine.classList.add('broken');
      setTimeout(() => n.engine.classList.remove('broken'), 520);
      hintUntil = performance.now() + 2200;
    };

    /**
     * A contact a segment paid for.
     *
     * DELIBERATELY NOT flashBroken. The plate going red is the game saying the
     * streak is gone and the seconds are on the clock, and neither is true
     * here -- a guard is the one contact in this game that costs no time at
     * all. It flashes the plate in the engine's own colour instead, which reads
     * as the tank doing its job rather than as damage, and it does not arm the
     * STREAK CUT hint, because nothing was cut.
     */
    api.flashGuard = function () {
      n.engine.classList.add('guarded');
      setTimeout(() => n.engine.classList.remove('guarded'), 460);
    };

    // ---- the aid card ----------------------------------------------------
    let toastTimer = null;

    /**
     * Aid taken. The only thing this card still says, and the only thing it
     * ever said that was not already on screen: nothing else in the game
     * reports that a banana put fuel back in the tank. The gauge jumps, but a
     * jump with no cause named is indistinguishable from a lucky gate.
     *
     * A bottle still gets no card at all -- five cards in a row through a
     * water table would be noise.
     *
     * The `/MI` unit that used to sit in this row is gone with the splits, and
     * that fixes a live defect on the way out: `toastAid` never hid it, so
     * every aid card in the shipped game read "+3 STREAK /MI".
     */
    api.toastAid = function (lab, sub) {
      n.toastLab.textContent = lab;
      n.toastBig.textContent = sub;
      n.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { n.toast.classList.remove('show'); }, 1200);
    };

    /**
     * The mile split card, retired. See the markup comment on #toast for the
     * four facts it carried and where each one already was.
     *
     * Kept as a no-op rather than deleted, because main.js calls it once per
     * mile and that file belongs to another agent. The call site
     * (main.js, the split handler) can go with it.
     */
    api.toast = function () {};

    api.showStart = function (show) {
      n.startPanel.classList.toggle('hidden', !show);
      if (show) requestAnimationFrame(markScroll);
      syncPanels();
    };

    /**
     * The pause panel, on exactly the machinery the other two panels use.
     *
     * `syncPanels` is the whole point of routing it here rather than inventing
     * a second overlay: the live readout steps out of the way behind ANY panel
     * (see #ui.panelOpen in the stylesheet), and a pause screen that left the
     * projection, the fuel gauge and the rail showing through would read as the
     * rendering fault the panelOpen rule was written to fix.
     *
     * @param p  the pace model, or null. The two figures printed are the ones
     *           the readout underneath has just been told to hide, so the panel
     *           is not a place where the player loses sight of their race.
     */
    api.showPause = function (show, p) {
      if (show && p) {
        n.pauseStat.innerHTML =
          plate('ELAPSED', Pace.clock(p.raceTime), 'RACE CLOCK STOPPED')
          + plate('DISTANCE', p.miles.toFixed(2), 'OF ' + K.MARATHON_MILES.toFixed(2) + ' MI')
          + plate('CLEAN', String(p.streak), 'GATES IN A ROW');
      }
      n.pausePanel.classList.toggle('hidden', !show);
      if (show) requestAnimationFrame(markScroll);
      syncPanels();
    };

    /**
     * The button itself, which exists only while there is a race to stop. It is
     * driven by main.js off the state machine rather than by this file off the
     * panel, because the two are not the same interval: the button is gone for
     * the whole of the resume countdown, when no panel is open and the game is
     * not yet running.
     */
    api.showPauseBtn = function (on) {
      root.classList.toggle('canPause', !!on);
    };

    api.countdown = function (text) {
      n.count.classList.toggle('hidden', text === null);
      // The count is a full-frame element and the pause panel is a full-frame
      // element, and a resume runs both at once: the digit landed across the
      // DISTANCE plate. So the panel empties while the count is up -- the fill
      // stays, which is the half of it that is load-bearing, and the copy and
      // the buttons step out of the way exactly as the live readout does behind
      // any panel. It also removes the two buttons from under a player's thumb
      // during the three seconds when pressing either of them would do nothing.
      root.classList.toggle('counting', text !== null);
      if (text !== null) n.countVal.textContent = text;
    };

    /**
     * The one line of narrative the card is allowed.
     *
     * A record-beating run used to be graded pink for three of its six splits,
     * because the ghost comparison is structurally negative early: the player
     * starts at 5:30 by design and reels the ghost in. The comparison was not
     * wrong, it was being asked the wrong question at the wrong mile. So the
     * split column stops carrying it (see below) and the turn is NAMED
     * instead, once, in the tense a race report would use.
     *
     * A run that never took the lead gets its fastest mile rather than a
     * silence -- still a fact, still the player's own, and still the thing
     * they did best.
     */
    function turnLine(p) {
      const sp = p.splits;
      if (!sp.length) return '';
      if (p.finishTime < K.RECORD_SECONDS) {
        let m = 1;
        for (let i = sp.length - 1; i >= 0; i--) {
          if (sp[i].time - sp[i].mile * K.RECORD_PACE >= 0) { m = sp[i].mile + 1; break; }
        }
        return m > 1 ? 'YOU TOOK THE LEAD AT MILE ' + m
                     : 'AHEAD OF THE GHOST FROM THE GUN';
      }
      let best = null, prev = 0;
      for (const s of sp) {
        const mt = s.time - prev; prev = s.time;
        if (!best || mt < best.mt) best = { mile: s.mile, mt: mt };
      }
      return best ? 'FASTEST MILE · MILE ' + best.mile + ' IN ' + Pace.pace(best.mt) + '/MI' : '';
    }

    /** Tomorrow's road. Free: the date seed already decides it. */
    function tomorrowLine() {
      try {
        const k = Store && dateKey ? Store.shift(dateKey, 1) : null;
        const s = k && MR.Course.pickSettings ? MR.Course.pickSettings(k) : null;
        if (s && s.length) {
          return s.map(function (x) { return x.name; }).join(' → ');
        }
      } catch (e) { /* a teaser is never worth an exception */ }
      return '';
    }

    /**
     * @param p    the finished pace state
     * @param rec  what MR.Store made of it (see Store.record), or nothing
     * @param hits z of every gate the run made contact with, in any order.
     *             Optional: without it the chapter line simply does not print,
     *             which is the same thing that happens on a flawless run.
     */
    api.showEnd = function (p, rec, hits, guards) {
      rec = rec || {};
      hitZ = hits && hits.length ? new Set(hits) : null;
      guardZ = guards && guards.length ? guards.slice() : null;
      chapterCost = null;
      const t = p.finishTime;
      const rung = Tier.of(t);
      const up = Tier.next(t);

      // ---- headline: the time ---------------------------------------------
      // One number. The LONGEST CLEAN co-headline that stood beside it was
      // removed on the owner's word, with the contacts-cost plate and the aid
      // note ("the following ... can be removed: X contacts cost, aid taken,
      // longest clean").
      n.endTime.textContent = Pace.clock(t);
      const vs = t - K.RECORD_SECONDS;
      n.endVs.textContent = (vs <= 0 ? '-' : '+') + Pace.clock(Math.abs(vs))
                          + ' VS ' + K.RECORD_LABEL;
      cls(n.endVs, 'endVsCls', 'endSub num' + (vs <= 0 ? ' ahead' : ''));

      // ---- the grade -----------------------------------------------------
      n.verdict.textContent = rung.name;
      n.verdict.className = 'tier t' + rung.i;
      api.milesFinish(p.finishTime);
      // Nothing above RECORD, so nothing to chase and nothing to print. This
      // slot used to say RECORD BEATEN BY 1:37 directly beneath an endVs
      // reading -1:37 VS 1:59:30, beside a chip reading RECORD: the same
      // number three times inside ninety pixels.
      n.tierNext.textContent = up
        ? Pace.clock(Tier.gapTo(t, up)) + ' OFF ' + up.name
        : '';

      // ---- what the save made of it --------------------------------------
      const badges = [];
      if (rec.allTimeBest && !rec.firstEver) badges.push('ALL-TIME BEST');
      else if (rec.beatToday && !rec.firstToday) badges.push('BEST TODAY');
      if (rec.allTimeStreak && !rec.firstEver) badges.push('LONGEST CLEAN EVER');
      else if (rec.beatTodayStreak && !rec.firstToday) badges.push('LONGEST CLEAN TODAY');
      if (rec.dayStreak > 1) badges.push(rec.dayStreak + ' DAY STREAK');
      n.endBadges.innerHTML = badges
        .map(function (b) { return '<span class="ebadge">' + b + '</span>'; }).join('');

      const was = rec.prevToday;
      n.endMem.textContent = was
        ? (t < was.time
            ? 'BEAT YOUR BEST TODAY BY ' + Pace.clock(was.time - t)
            : 'YOUR BEST TODAY ' + Pace.clock(was.time)
              + ' · THIS RUN +' + Pace.clock(t - was.time))
        // No previous run today means there is no comparison to draw, and
        // "FIRST RUN TODAY" is that absence typed out. The start panel's
        // memory plates already refuse to render their own empty state; this
        // is the same rule on the other side of the run.
        : '';

      // ---- the two notes ---------------------------------------------------
      // The turn names one actual moment in the race, which is the job the
      // six-block split table could not do. The contacts-cost plate and the
      // AID TAKEN note that used to sit between here and the badges were
      // removed on the owner's word.
      const notes = [];
      const turn = turnLine(p);
      if (turn) notes.push(turn);
      // Where the run went. See chapterCosts(): this is the only per-chapter
      // number in the game that moves with how the player ran rather than
      // with what the date drew, and it prints only when one biome leg really
      // did carry the run ("CLEAN THROUGH THE WALL").
      const where = p.hits ? decisiveChapter(t) : null;
      if (where) notes.push('CLEAN THROUGH ' + where.name + ' · ' + Pace.clock(where.would));
      n.endTurn.innerHTML = notes
        .map(function (x) { return '<div>' + x + '</div>'; }).join('');
      // ---- the share card --------------------------------------------------
      // Built once, here, off the same finished run everything above was read
      // from -- so the string the button copies is the card the player is
      // looking at, and cannot drift from it by being rebuilt later against a
      // reset() that has already emptied the contact lists.
      const marks = legMarks();
      shareStr = buildShare(p, rec, marks);
      const CLS = ['clean', 'guard', 'hit'];
      n.shareLegs.innerHTML = marks.map(function (m, i) {
        // The leg's name is the accessible label and nothing more: it is not
        // drawn, because six names would be a table and the row is deliberately
        // a shape you can take in at once.
        const nm = (course && course.biomes && course.biomes[i]) ? course.biomes[i].name : '';
        return '<span class="sblock ' + CLS[m] + '" title="' + nm + '"></span>';
      }).join('');
      // THE ROW NEEDS A KEY AND NOTHING ELSE.
      //
      // The first draft printed the first two lines of the share string here,
      // so the player could see what they were about to copy -- and those two
      // lines are the city, the grade and the finish time, all three of which
      // are already on this card in larger type. That is the duplication this
      // card has been cut twice to remove, so it went.
      //
      // What is genuinely new is the row itself, and six coloured squares with
      // no key are a cipher. One line, fixed, naming the three states.
      n.shareLine.textContent = marks.length
        ? 'ONE BLOCK PER LEG · GREEN CLEAN · YELLOW GUARDED · RED HIT' : '';
      n.shareBox.classList.remove('revealed');
      n.shareText.value = '';
      shareNote('');

      const tom = tomorrowLine();
      n.tomorrowRoute.textContent = tom;
      n.tomorrow.classList.toggle('empty', !tom);

      n.endPanel.classList.remove('hidden');
      syncPanels();
      requestAnimationFrame(markScroll);
    };

    /**
     * The celebration: the live readout's top-left column steps out of the
     * frame while the camera is round the front of the runner. See the
     * .celebrating rule in style.css for what stays and why.
     */
    api.celebrate = function (on) {
      root.classList.toggle('celebrating', !!on);
    };

    api.hideEnd = function () {
      n.endPanel.classList.add('hidden');
      syncPanels();
    };

    api.onStart = function (fn) { n.startBtn.addEventListener('click', fn); };
    api.onAgain = function (fn) { n.againBtn.addEventListener('click', fn); };
    api.onPause = function (fn) { n.pauseBtn.addEventListener('click', fn); };
    api.onResume = function (fn) { n.resumeBtn.addEventListener('click', fn); };
    api.onRestart = function (fn) { n.restartBtn.addEventListener('click', fn); };
    api.showPerf = function (on) { n.perf.classList.toggle('on', on); };

    /**
     * HOW MANY PIXELS AT THE BOTTOM OF THE FRAME THIS READOUT HAS TAKEN.
     *
     * From the top edge of #railWrap to the bottom of the viewport, so it
     * includes the plate, its border, and the standoff and safe-area inset
     * underneath it. It is a MEASUREMENT AND NOT A POLICY: this file does not
     * know or care what the number is for, and there is no threshold in it.
     *
     * It exists because the camera needs it. camera.js frames the runner so
     * his feet sit at a fixed FRACTION of frame height, and this plate claims
     * a fixed number of PIXELS -- so whether the two collide is decided by a
     * quantity neither file could see on its own, and the camera had been
     * guessing at it from the aspect ratio. See THE READOUT'S OWN CLAIM in
     * camera.js for what is done with it, and tools/footroom.js for the
     * assertion that says whether it worked.
     *
     * `visibility: hidden` is what takes this plate away behind a panel, not
     * `display: none`, so the box is still laid out and this still answers
     * while the start card is up. null is returned only if the element is
     * genuinely unlaid-out -- in which case the camera keeps what it had,
     * because a zero here would read as "the readout claims nothing" and
     * quietly hand back the whole fix.
     */
    api.bottomClaim = function () {
      const r = n.railWrap.getBoundingClientRect();
      if (!(r.height > 0)) return null;
      const claim = window.innerHeight - r.top;
      return claim > 0 ? claim : null;
    };

    syncPanels();
    return api;
  }

  return { create };
})();
