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
          <div class="lab">FUEL</div>
          <div class="gauge tank" id="paceGauge">
            <div class="gaugeFill" id="gaugeFill"></div>
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
        <h1 id="startTitle">DAILY MARATHON</h1>
        <div class="route" id="startRoute"></div>

        <div class="blurb">
          Three lanes. Jump or slide past everything in the way.
          <b>26.2 miles, about four minutes.</b>
        </div>

        <div class="mech" id="startRule">
          <p>Every obstacle you clear in a row buys speed &mdash;
             ${Pace.pace(K.START_PACE)} up to ${Pace.pace(K.FLOOR_PACE)} a mile.
             Touch one and most of it is gone.</p>
        </div>

        <div class="target">
          <span class="targetLab">TARGET</span>
          <b class="num">${K.RECORD_LABEL}</b>
          <span class="targetSub" id="targetSub">&nbsp;</span>
        </div>

        <!--
          WHAT THE GAME REMEMBERS.

          Empty on a first visit, and it stays out of the way when it is: a
          stranger gets exactly the panel they got before. From the second run
          onward it is the reason to have come back, so it sits directly under
          the wager it is a record of.
        -->
        <div id="startMemory"></div>

        <div class="keys" id="startKeys"></div>
        <button class="cta" id="startBtn" type="button">TOE THE LINE</button>
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

        <div id="endHead">
          <div class="endCell">
            <div class="lab">FINAL TIME</div>
            <h1 class="endBig num" id="endTime">&mdash;</h1>
            <div class="endSub num" id="endVs"></div>
          </div>
          <div class="endCell">
            <div class="lab">LONGEST CLEAN</div>
            <div class="endBig num" id="endStreak">0</div>
            <div class="endSub num" id="endStreakSub"></div>
          </div>
        </div>

        <div id="tierRow">
          <span id="verdict"></span>
          <span id="tierNext" class="num"></span>
        </div>

        <div id="endBadges"></div>
        <div id="endMem" class="num"></div>

        <div id="endCost">
          <div class="lab" id="endCostLab">WHAT THE CONTACTS COST</div>
          <div class="endBig num" id="endCostVal">0:00</div>
          <div class="endSub" id="endCostSub"></div>
        </div>

        <div id="endTurn"></div>

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
      engine: q('engine'), why: q('why'),
      gaugeFill: q('gaugeFill'), paceVal: q('paceVal'),
      distVal: q('distVal'),
      rail: q('rail'), railFill: q('railFill'), railGap: q('railGap'), railGhost: q('railGhost'),
      railRoute: q('railRoute'),
      gapVal: q('gapVal'), gapTrend: q('gapTrend'), gapLabel: q('gapLabel'),
      toast: q('toast'), toastLab: q('toastLab'), toastBig: q('toastBig'),
      startPanel: q('startPanel'), startBtn: q('startBtn'), startDate: q('startDate'),
      startRoute: q('startRoute'), startKeys: q('startKeys'), targetSub: q('targetSub'),
      startMemory: q('startMemory'),
      endPanel: q('endPanel'), endTime: q('endTime'), endDate: q('endDate'),
      endVs: q('endVs'), endStreak: q('endStreak'), endStreakSub: q('endStreakSub'),
      verdict: q('verdict'), tierNext: q('tierNext'),
      endBadges: q('endBadges'), endMem: q('endMem'),
      endCost: q('endCost'), endCostLab: q('endCostLab'),
      endCostVal: q('endCostVal'), endCostSub: q('endCostSub'),
      endTurn: q('endTurn'), tomorrow: q('tomorrow'), tomorrowRoute: q('tomorrowRoute'),
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
                || !n.pausePanel.classList.contains('hidden');
      root.classList.toggle('panelOpen', open);
    }

    let hintUntil = 0;     // while set, the why-line shows the streak-cut message
    let dateKey = '';
    let course = null;
    let cleanTime = null;  // this course's flawless finish, computed once
    let chapterCost = null; // per-city counterfactual, computed once at the tape
    let hitZ = null;       // z of every gate this run made contact with

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

    /**
     * The flawless finish for THIS course, simulated once.
     *
     * This is the counterfactual the finish card is missing, and it cannot be
     * approximated: `projectClean()` from a cold start models gates as
     * arriving continuously and lands 50 seconds optimistic, because the real
     * course opens with 150 units of empty runway during which the streak
     * cannot grow. So this rolls the real pace model over the real gate
     * positions -- the same code the race runs -- and takes the finish time.
     *
     * ~14400 steps, measured at 8.7ms, done once and cached. Aid is ignored on
     * purpose: aid tops a streak up to a ceiling a flawless run is already
     * above, so it is worth exactly zero to this hypothetical player.
     */
    function cleanFinish() {
      if (cleanTime !== null) return cleanTime;
      cleanTime = 0;
      if (!course || !course.gates || !course.gates.length) return cleanTime;
      const p = Pace.create();
      let gi = 0, guard = 0;
      while (!p.finished && guard++ < 40000) {
        p.update(1 / 60);
        while (gi < course.gates.length && p.units >= course.gates[gi].z) {
          gi++; p.onClean();
        }
      }
      cleanTime = p.finished ? p.finishTime : 0;
      return cleanTime;
    }

    /**
     * WHICH CITY THE RUN WAS LOST IN.
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
     * So on the runs a player is reading the card for, one city IS the story
     * and the other rows are zeros; on a wreck the breakdown flattens into
     * three similar numbers -- the split table's second failure, noise -- and
     * the counterfactuals stop summing to the plate's own total (55s adrift
     * at 20 contacts, against 1.2s at three). A table would print its worst
     * self on the runs it reads worst. A single line simply does not appear
     * unless one city genuinely carried the run, which is the same rule the
     * memory plates, the best-today line and the aid note already follow.
     */
    function chapterCosts() {
      if (chapterCost !== null) return chapterCost;
      chapterCost = [];
      const set = course && course.settings;
      if (!set || set.length < 2 || !hitZ || !hitZ.size
          || !course.gates || !course.gates.length) return chapterCost;

      // A gate's city is decided by the gate's own z, not by where the runner
      // happened to be on the frame that resolved it. Frame-rate independent,
      // and it is the same test world.js uses to decide which city to build.
      const cut = set.map(function (s) { return s.from * K.TOTAL_UNITS; });
      const cityOf = function (z) {
        let i = 0;
        for (let k = 0; k < cut.length; k++) if (z >= cut[k]) i = k;
        return i;
      };

      // The hill is not modelled here for the same reason cleanFinish() does
      // not model it: pace.js integrates the grade term to zero over the race,
      // and it measures 0.01s on a flawless finish. Both sides of every
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
            if (hitZ.has(g.z) && cityOf(g.z) !== skip) p.onHit();
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
      for (let i = 0; i < set.length; i++) {
        chapterCost.push({ name: set[i].name, cost: Math.max(0, base - run(i)) });
      }
      return chapterCost;
    }

    /** The city that carried the run, or nothing when no single city did. */
    function decisiveChapter(actualFinish) {
      const rows = chapterCosts();
      if (!rows.length) return null;
      let total = 0, top = rows[0];
      for (const r of rows) { total += r.cost; if (r.cost > top.cost) top = r; }
      // A majority, and worth naming. Ten seconds is roughly a quarter of what
      // a single contact costs, so the floor only suppresses trivia; the
      // majority test is what keeps the line off a run that fell apart
      // everywhere, where naming one city would be a lie about the other two.
      if (total <= 0 || top.cost < 10 || top.cost / total <= 0.5) return null;
      // Reported against the run's OWN finish time, so the two numbers on the
      // card are commensurable even where the reconstruction drifted.
      return { name: top.name, would: actualFinish - top.cost };
    }

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
      // the axis, which would put every label in the wrong place.
      for (const s of set) {
        const span = el('span', 'rcity', s.name);
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
     * The route is the only thing on this panel that is visibly different
     * tomorrow. A different gate layout is invisible before you press start; a
     * different set of cities is not, which makes this the one line that earns
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
      cleanTime = null;
      chapterCost = null;
      const set = course.settings;
      n.startRoute.textContent = set && set.length
        ? set.map(function (x) { return x.name; }).join(' → ')
        : '';
      drawRoute(set);
      const g = course.gates ? course.gates.length : 0;
      n.targetSub.textContent = g ? 'survives one mistake in ' + g : '';
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
      for (const el of [n.startPanel, n.endPanel]) {
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
    for (const el of [n.startPanel, n.endPanel]) {
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
      n.gaugeFill.style.width =
        (clamp01((K.START_PACE - p.pace) / (K.START_PACE - K.FLOOR_PACE)) * 100) + '%';
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
      // Which city the runner is in. Written only on the crossing -- there are
      // two or three of them in a race, against ~14,000 frames.
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
          for (let i = 0; i < spans.length; i++) {
            spans[i].className = 'rcity' + (i === hi ? ' here' : i < hi ? ' past' : '');
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
    api.showEnd = function (p, rec, hits) {
      rec = rec || {};
      hitZ = hits && hits.length ? new Set(hits) : null;
      chapterCost = null;
      const t = p.finishTime;
      const rung = Tier.of(t);
      const up = Tier.next(t);

      // ---- headline: the time, and the streak beside it ------------------
      // Two numbers, not one. The finish time is the result; the longest clean
      // line is the SKILL, and unlike the time it cannot be taken away by a
      // single contact in mile 3. It is monotone, it has 189 points of
      // resolution, and it is still worth chasing on a day the record died
      // ninety seconds in -- which is most days.
      n.endTime.textContent = Pace.clock(t);
      const vs = t - K.RECORD_SECONDS;
      n.endVs.textContent = (vs <= 0 ? '-' : '+') + Pace.clock(Math.abs(vs))
                          + ' VS ' + K.RECORD_LABEL;
      cls(n.endVs, 'endVsCls', 'endSub num' + (vs <= 0 ? ' ahead' : ''));

      n.endStreak.textContent = String(p.bestStreak);
      const gates = course && course.gates ? course.gates.length : p.gatesSeen;
      n.endStreakSub.textContent = 'OF ' + gates + ' GATES';

      // ---- the grade -----------------------------------------------------
      n.verdict.textContent = rung.name;
      n.verdict.className = 'tier t' + rung.i;
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

      // ---- the true cost of contact --------------------------------------
      // This row used to print hits * HIT_TIME_PENALTY. On a twelve-contact
      // run that is +0:18 against a real cost of over thirteen minutes -- the
      // stopwatch penalty is a rounding error next to the speed those twelve
      // contacts took away for the rest of the race. The screen understated
      // the player's own causal contribution by a factor of forty-five and
      // left an unexplained twelve-minute hole, which invites exactly one
      // conclusion: "my mistakes cost 18 seconds, the game did the rest."
      //
      // The counterfactual is computable and is now computed. See
      // cleanFinish(): the same pace model, over the same gates, cleared.
      const clean = cleanFinish();
      const lost = clean ? Math.max(0, t - clean) : p.hits * K.HIT_TIME_PENALTY;
      n.endCost.classList.toggle('clean', !p.hits);
      if (!p.hits) {
        n.endCostLab.textContent = 'CLEAN LINE';
        n.endCostVal.textContent = '0:00';
        n.endCostSub.textContent = 'NOTHING LEFT ON THE ROAD';
      } else {
        n.endCostLab.textContent = p.hits + (p.hits === 1 ? ' CONTACT COST' : ' CONTACTS COST');
        n.endCostVal.textContent = Pace.clock(lost);
        n.endCostSub.textContent = clean
          ? 'CLEAN, YOU FINISH ' + Pace.clock(clean) + ' ON THIS COURSE'
          : 'AGAINST A FLAWLESS LINE';
      }

      // ---- the two notes ---------------------------------------------------
      // What is left of the summary and the split table. The turn names one
      // actual moment in the race, which is the job the six-block table could
      // not do; AID TAKEN is the one number from the summary that was not
      // arithmetic on something else already printed here -- and on the runs
      // the mechanic exists for, a broken race, it is very often 0 of 14,
      // which is the only line on the card that tells a player there was help
      // on the road they ran past.
      const notes = [];
      const turn = turnLine(p);
      if (turn) notes.push(turn);
      // Where the run went. See chapterCosts(): this is the only per-city
      // number in the game that moves with how the player ran rather than with
      // which cities the date drew, and it prints only when one city really
      // did carry the run.
      const where = p.hits ? decisiveChapter(t) : null;
      if (where) notes.push('CLEAN THROUGH ' + where.name + ' · ' + Pace.clock(where.would));
      // Not on a flawless line. cleanFinish() spells out why aid is worth
      // exactly zero to a run that never broke -- it tops a streak up to a
      // ceiling that run is already above -- so "AID TAKEN · 0 OF 14" under a
      // 205-of-205 card reports a miss that was not one. It is printed when
      // the player took some, or when there were contacts it could have
      // answered.
      const aidN = course && course.aid ? course.aid.length : 0;
      if (aidN && (p.aid > 0 || p.hits > 0)) {
        notes.push('AID TAKEN · ' + p.aid + ' OF ' + aidN);
      }
      n.endTurn.innerHTML = notes
        .map(function (x) { return '<div>' + x + '</div>'; }).join('');
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

    syncPanels();
    return api;
  }

  return { create };
})();
