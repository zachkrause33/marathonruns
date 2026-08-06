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

  const LADDER = [
    { max: K.RECORD_SECONDS, name: 'RECORD', label: K.RECORD_LABEL },
    { max: BASE },
    { max: BASE + STEP },
    { max: BASE + STEP * 3 },
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
      <div id="bug">
        <div id="clockCell">
          <div class="lab">RACE TIME</div>
          <div class="val num" id="clock">0:00</div>
        </div>
        <div id="projCell">
          <div class="cap"><span class="lab"><span class="wideOnly">PROJECTED</span><span class="narrowOnly">PROJ</span> FINISH</span><span class="chip" id="status">BUYING SPEED</span></div>
          <div class="val num" id="projVal">--:--</div>
          <div class="sub num" id="margin">VS ${K.RECORD_LABEL}</div>
        </div>
      </div>

      <div id="leftCol">
        <div id="engine">
          <div class="lab">CLEAN GATES</div>
          <div class="val num" id="streakVal">0</div>
          <div class="gauge" id="paceGauge">
            <div class="gaugeFill" id="gaugeFill"></div>
            <div class="gaugeRec"></div>
          </div>
          <div class="lab" id="paceLab">PACE</div>
          <div><span class="val num" id="paceVal">5:30</span><span class="unit">/MI</span></div>
          <div class="sub num" id="needVal">NEED ${Pace.pace(K.RECORD_PACE)}/MI</div>
          <div id="why">EACH CLEAN GATE BUYS SPEED</div>
        </div>

        <div id="toast">
          <div class="lab" id="toastLab">MILE 1</div>
          <div id="toastRow"><span class="big num" id="toastBig">--:--</span><span class="unit">/MI</span></div>
          <div class="small num"><span id="toastCum"></span> <span id="toastDelta"></span></div>
        </div>
      </div>

      <div id="dist">
        <div class="lab">DISTANCE</div>
        <div><span class="val num" id="distVal">0.00</span><span class="unit">MI</span></div>
        <div class="sub num" id="toGo">26.22 MI TO GO</div>
      </div>

      <div id="railWrap">
        <div id="gapLine">
          <span class="lab">RECORD GHOST</span>
          <span class="num" id="gapVal">+0:00.0</span>
          <span id="gapTrend">GAINING</span>
        </div>
        <div id="rail">
          <div id="railBg"></div>
          <div id="railFill"></div>
          <div id="railGap"></div>
          <div id="railGhost"></div>
        </div>
        <div id="railCaps"><span>0</span><span id="railHalf">13.1</span><span>26.2</span></div>
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

        <div id="endCols">
          <div id="resultStats"></div>
          <div id="splitTable"></div>
        </div>

        <div id="endCost">
          <div class="lab" id="endCostLab">WHAT THE CONTACTS COST</div>
          <div class="endBig num" id="endCostVal">0:00</div>
          <div class="endSub" id="endCostSub"></div>
        </div>

        <div id="endTurn"></div>
        <div id="tomorrow"></div>
        <button class="cta" id="againBtn">RUN IT AGAIN</button>
      </div></div>

      <div id="count" class="hidden"><span id="countVal"></span></div>
    `;

    const q = (id) => root.querySelector('#' + id);
    const n = {
      clock: q('clock'),
      projCell: q('projCell'), projVal: q('projVal'), margin: q('margin'), status: q('status'),
      engine: q('engine'), streakVal: q('streakVal'), why: q('why'),
      gaugeFill: q('gaugeFill'), paceVal: q('paceVal'), needVal: q('needVal'),
      distVal: q('distVal'), toGo: q('toGo'),
      rail: q('rail'), railFill: q('railFill'), railGap: q('railGap'), railGhost: q('railGhost'),
      gapVal: q('gapVal'), gapTrend: q('gapTrend'),
      toast: q('toast'), toastLab: q('toastLab'), toastBig: q('toastBig'),
      toastCum: q('toastCum'), toastDelta: q('toastDelta'),
      startPanel: q('startPanel'), startBtn: q('startBtn'), startDate: q('startDate'),
      startRoute: q('startRoute'), startKeys: q('startKeys'), targetSub: q('targetSub'),
      startMemory: q('startMemory'),
      endPanel: q('endPanel'), endTime: q('endTime'), endDate: q('endDate'),
      endVs: q('endVs'), endStreak: q('endStreak'), endStreakSub: q('endStreakSub'),
      verdict: q('verdict'), tierNext: q('tierNext'),
      endBadges: q('endBadges'), endMem: q('endMem'),
      stats: q('resultStats'), splitTable: q('splitTable'),
      endCost: q('endCost'), endCostLab: q('endCostLab'),
      endCostVal: q('endCostVal'), endCostSub: q('endCostSub'),
      endTurn: q('endTurn'), tomorrow: q('tomorrow'),
      againBtn: q('againBtn'),
      count: q('count'), countVal: q('countVal'),
      perf: q('perf'),
    };

    // The side columns hang below the top bug. Their offset used to be four
    // independently hard-coded `top` values, one per breakpoint, each of them a
    // guess at how tall the bug happened to be at that width -- and the narrow
    // one guessed 2px short, so on every phone the bug's plate clipped the
    // corners of both side panels. The overlap widened as the screen narrowed
    // (69px at 420 wide, 99px at 360) because the bug is centred and fixed
    // while the panels are pinned to the edges.
    //
    // Measure it instead. --bugH is the bug's real height, so the columns clear
    // it at any width, at any font size, and after any future edit to the bar.
    const bug = q('bug');
    function measureBug() {
      const h = bug.getBoundingClientRect().height;
      if (h > 0) root.style.setProperty('--bugH', h + 'px');
    }
    measureBug();
    if (window.ResizeObserver) new ResizeObserver(measureBug).observe(bug);
    window.addEventListener('resize', measureBug);

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
                || !n.endPanel.classList.contains('hidden');
      root.classList.toggle('panelOpen', open);
    }

    let lastP = null;      // last state seen, so the split card can read splits
    let hintUntil = 0;     // while set, the why-line shows the streak-cut message
    let mem = null;        // what MR.Store remembers, as of this run's start
    let dateKey = '';
    let course = null;
    let cleanTime = null;  // this course's flawless finish, computed once

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
      cache.need = cache.needCls = undefined;
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
      mem = sum || null;
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
      const set = course.settings;
      n.startRoute.textContent = set && set.length
        ? set.map(function (x) { return x.name; }).join(' → ')
        : '';
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
      lastP = p;

      set(n.clock, 'clock', Pace.clock(p.raceTime));
      set(n.distVal, 'dist', p.miles.toFixed(2));
      set(n.toGo, 'toGo', Math.max(0, K.MARATHON_MILES - p.miles).toFixed(2) + ' MI TO GO');

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
        chip = rung.name;
        sub = up
          ? Pace.clock(Tier.gapTo(proj, up)) + ' OFF ' + up.name
          : 'ON FOR ' + rung.name;
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

      // ---- the engine: streak -> speed unlocked -> pace ------------------
      set(n.streakVal, 'streak', String(p.streak));
      n.gaugeFill.style.width =
        (clamp01((K.START_PACE - p.pace) / (K.START_PACE - K.FLOOR_PACE)) * 100) + '%';
      set(n.paceVal, 'pace', Pace.pace(p.pace));
      cls(n.paceVal, 'paceCls', 'val num' + (p.pace <= K.RECORD_PACE ? ' ahead' : ''));
      // The line under the pace. While the record lives it is the race-desk
      // number: the pace the rest of the course demands. Once the record is
      // gone that number is a lie -- it asks for a pace below the 4:14 floor
      // -- so the plate switches to the one target that is still winnable and
      // still live: the player's own longest clean line. It is monotone, so it
      // can only ever be approached, never lost; it has 189 points of
      // resolution; and it is the exact skill the game is teaching.
      let needText, needCls;
      if (!gone) {
        needText = 'NEED ' + Pace.pace(need) + '/MI';
        needCls = 'sub num';
      } else if (mem && mem.pbStreak > 0) {
        const togo = mem.pbStreak - p.bestStreak;
        needText = togo > 0
          ? 'PB ' + mem.pbStreak + ' CLEAN · ' + togo + ' TO GO'
          : 'CLEAN PB · ' + p.bestStreak;
        needCls = 'sub num' + (togo > 0 ? '' : ' pb');
      } else {
        needText = 'LONGEST CLEAN · ' + p.bestStreak;
        needCls = 'sub num';
      }
      set(n.needVal, 'need', needText);
      cls(n.needVal, 'needCls', needCls);

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

      const d = p.deltaVsRecord();
      const ahead = d < 0;
      set(n.gapVal, 'gap', Pace.delta(d));
      cls(n.gapVal, 'gapCls', 'num ' + (ahead ? 'ahead' : 'behind'));
      cls(n.railGap, 'railGapCls', ahead ? 'ahead' : 'behind');

      // THE GHOST GAP IS A POSITION, NOT A GRADE.
      //
      // This used to read GAINING / LOSING off `p.pace < RECORD_PACE`, which is
      // accurate and was still wrong. The race is DESIGNED to start below
      // record pace and reel it in, so a flawless run is slower than 4:33 for
      // the whole first half and the tag read LOSING for about three quarters
      // of it -- while the projection at the top of the same screen read
      // RECORD ON. Two thirds of the readout told a perfect player they were
      // failing, and the start panel had grown a sentence explaining that the
      // ghost leads "by design", which is the game apologising for its own HUD.
      //
      // The projection already carries the verdict, and carries it correctly,
      // because it integrates the whole remaining race. So this line gives up
      // grading and states where the ghost is instead -- which is the one
      // thing the projection cannot tell you and the thing you actually want
      // when you are looking at the road.
      set(n.gapTrend, 'trend', Math.abs(d) < 1 ? 'LEVEL' : ahead ? 'BEHIND YOU' : 'UP THE ROAD');
      cls(n.gapTrend, 'trendCls', ahead ? 'ahead' : 'behind');

      if (extra && extra.fps !== undefined) {
        set(n.perf, 'perf', extra.fps.toFixed(0) + ' FPS · ' + (extra.draws || 0) + ' DRAWS');
      }
    };

    api.flashBroken = function () {
      n.engine.classList.add('broken');
      setTimeout(() => n.engine.classList.remove('broken'), 520);
      hintUntil = performance.now() + 2200;
    };

    // ---- mile splits ----------------------------------------------------
    // A runner's mile split is the time that mile took, which the caller does
    // not pass; it is one subtraction away in splits[], so the card composes
    // its own line from the state it already sees and falls back to whatever
    // strings it was handed.
    let toastTimer = null;

    /**
     * Aid taken. Deliberately reuses the split card rather than adding a
     * fourth floating element -- the frame is already carrying a race clock, a
     * streak plate and a ghost tag, and the middle stays clear on purpose. A
     * bottle gets no card at all: the streak number jumping is the feedback,
     * and five cards in a row through a water table would be noise.
     */
    api.toastAid = function (lab, sub) {
      n.toastLab.textContent = lab;
      n.toastBig.textContent = sub;
      if (n.toastCum) n.toastCum.textContent = '';
      if (n.toastDelta) { n.toastDelta.textContent = ''; n.toastDelta.className = ''; }
      n.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { n.toast.classList.remove('show'); }, 1200);
    };

    api.toast = function (big, small, ms) {
      const sp = lastP && lastP.splits.length
        ? lastP.splits[lastP.splits.length - 1] : null;
      if (sp) {
        const i = lastP.splits.length;
        const prev = i > 1 ? lastP.splits[i - 2].time : 0;
        const d = sp.time - sp.mile * K.RECORD_PACE;
        n.toastLab.textContent = 'MILE ' + sp.mile;
        n.toastBig.textContent = Pace.pace(sp.time - prev);
        // Only the delta is tinted. The elapsed clock is a plain fact and
        // colouring it too made the whole line read as a warning.
        n.toastCum.textContent = Pace.clock(sp.time);
        n.toastDelta.textContent = Pace.delta(d);
        n.toastDelta.className = d < 0 ? 'ahead' : 'behind';
      } else {
        n.toastLab.textContent = big || '';
        n.toastBig.textContent = '';
        n.toastCum.textContent = small || '';
        n.toastDelta.textContent = '';
      }
      // Without split data there is no mile time to headline, so the card
      // drops that row rather than showing a bare "/MI".
      n.toast.classList.toggle('noBig', !sp);
      n.toast.classList.add('show');
      clearTimeout(toastTimer);
      // Splits arrive every nine or ten real seconds at record pace, so the
      // card can sit long enough to be read without ever stacking up.
      toastTimer = setTimeout(() => n.toast.classList.remove('show'), ms || 2000);
    };

    api.showStart = function (show) {
      n.startPanel.classList.toggle('hidden', !show);
      if (show) requestAnimationFrame(markScroll);
      syncPanels();
    };

    api.countdown = function (text) {
      n.count.classList.toggle('hidden', text === null);
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
          return 'TOMORROW · ' + s.map(function (x) { return x.name; }).join(' → ');
        }
      } catch (e) { /* a teaser is never worth an exception */ }
      return '';
    }

    /**
     * @param p    the finished pace state
     * @param rec  what MR.Store made of it (see Store.record), or nothing
     */
    api.showEnd = function (p, rec) {
      rec = rec || {};
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
      n.tierNext.textContent = up
        ? Pace.clock(Tier.gapTo(t, up)) + ' OFF ' + up.name
        : 'RECORD BEATEN BY ' + Pace.clock(-vs);

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
        : (rec.dateKey ? 'FIRST RUN TODAY' : '');

      // ---- summary -------------------------------------------------------
      // Label and value are no longer the same type at two opacities: the
      // label is the HUD's own 9px/800/0.16em and the value is a large
      // tabular figure, which is the pairing every plate in the live readout
      // already uses. Casing is uppercase throughout, because the HUD says
      // /MI and CLEAN GATES and this card used to say /mi and gates.
      const rows = [
        ['AVG PACE', Pace.pace(t / K.MARATHON_MILES) + '/MI'],
        // p.pace at the line is the pace held into the finish, not the best of
        // the race -- a run that broke late finishes slower than it ever ran.
        ['FINAL PACE', Pace.pace(p.pace) + '/MI'],
        ['CLEAN GATES', String(Math.max(0, p.gatesSeen - p.hits))],
        ['CONTACTS', String(p.hits)],
        ['AID TAKEN', String(p.aid)],
      ];
      // Both grids open with exactly one header row and then run on identical
      // fixed-height rows, which is what puts them back in phase -- they were
      // two grids on two rhythms about three pixels apart, which is close
      // enough to look like a mistake and far enough to be one.
      n.stats.innerHTML = '<div class="k hd">SUMMARY</div><div class="k hd"></div>' + rows
        .map(function (r) {
          return '<div class="k">' + r[0] + '</div><div class="v num">' + r[1] + '</div>';
        }).join('');

      // ---- splits --------------------------------------------------------
      // PER-BLOCK PACE, NOT VS-RECORD.
      //
      // The old third column was the ghost delta, and it graded a WINNING run
      // pink for its first three rows -- the race is built so the player opens
      // at 5:30 and reels the record in, so the delta is positive for the
      // whole first half of even a flawless line. A win that reads as
      // three-fifths failure is a broken scorecard, and no amount of tinting
      // fixes a column that is measuring the wrong thing.
      //
      // Pace over each five-mile block is the same data without the false
      // verdict: it shows the shape of the race climbing from 5:30 toward the
      // floor, and it goes green only where the block was AT or under record
      // pace. Nothing on this card is tinted for failure any more; the tier
      // band carries the result, once.
      let table = '<div class="k hd">MI</div><div class="k hd">TIME</div>'
                + '<div class="k hd">PACE</div>';
      const marks = p.splits.filter(function (s) { return s.mile % 5 === 0; });
      let pm = 0, pt = 0;
      for (const s of marks) {
        const blk = (s.time - pt) / (s.mile - pm);
        table += '<div class="v num">' + s.mile + '</div>'
              + '<div class="v num">' + Pace.clock(s.time) + '</div>'
              + '<div class="v num' + (blk <= K.RECORD_PACE ? ' ahead' : '') + '">'
              + Pace.pace(blk) + '</div>';
        pm = s.mile; pt = s.time;
      }
      const fblk = K.MARATHON_MILES > pm ? (t - pt) / (K.MARATHON_MILES - pm) : NaN;
      table += '<div class="sep"></div>'
            + '<div class="v num fin">' + K.MARATHON_LABEL + '</div>'
            + '<div class="v num fin">' + Pace.clock(t) + '</div>'
            + '<div class="v num fin' + (fblk <= K.RECORD_PACE ? ' ahead' : '') + '">'
            + Pace.pace(fblk) + '</div>';
      n.splitTable.innerHTML = table;

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

      n.endTurn.textContent = turnLine(p);
      n.tomorrow.textContent = tomorrowLine();

      n.endPanel.classList.remove('hidden');
      syncPanels();
      requestAnimationFrame(markScroll);
    };

    api.hideEnd = function () {
      n.endPanel.classList.add('hidden');
      syncPanels();
    };

    api.onStart = function (fn) { n.startBtn.addEventListener('click', fn); };
    api.onAgain = function (fn) { n.againBtn.addEventListener('click', fn); };
    api.showPerf = function (on) { n.perf.classList.toggle('on', on); };

    syncPanels();
    return api;
  }

  return { create };
})();
