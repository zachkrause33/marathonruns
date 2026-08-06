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
MR.HUD = (function () {
  const K = MR.K;
  const Pace = MR.Pace;

  // Where record pace sits inside the 5:30 -> 4:20 range the streak unlocks.
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

      <div class="panel" id="startPanel"><div class="panelInner">
        <div class="date" id="startDate"></div>
        <h1>DAILY MARATHON</h1>
        <div class="blurb">
          One course. Same for everyone, everywhere, today.
          26.2 miles, about four minutes.
        </div>

        <div class="rule">HOW YOU GET FASTER</div>
        <div class="mech">
          <div class="mechPace"><b>${Pace.pace(K.START_PACE)}</b><span>&rarr;</span><b>${Pace.pace(K.FLOOR_PACE)}</b><i>/MI</i></div>
          <div class="gauge" id="startGauge">
            <div class="gaugeFill" style="width:100%"></div>
            <div class="gaugeRec"></div>
          </div>
          <div class="gaugeLeg">the mark is record pace, ${Pace.pace(K.RECORD_PACE)}/mi</div>
          <p>Clear a gate cleanly and you speed up. Every clean gate in a row buys
             more. Touch one and you lose three quarters of the streak, and the
             pace bleeds back down.</p>
        </div>

        <div class="rule">THE RECORD</div>
        <div class="mech">
          <p><b>${K.RECORD_LABEL}</b> needs ${Pace.pace(K.RECORD_PACE)}/mi. You start slower than
             that and reel it in, so the ghost leads for the first few miles by
             design. <b>PROJECTED FINISH</b> is the number that tells you whether
             the record is still on.</p>
        </div>

        <div class="keys">
          <kbd>&larr;</kbd> <kbd>&rarr;</kbd> lanes &nbsp;&middot;&nbsp;
          <kbd>&uarr;</kbd> jump &nbsp;&middot;&nbsp; <kbd>&darr;</kbd> duck
          &nbsp;&middot;&nbsp; or swipe
        </div>
        <button class="cta" id="startBtn">TOE THE LINE</button>
      </div></div>

      <div class="panel hidden" id="endPanel"><div class="panelInner">
        <div class="date" id="endDate"></div>
        <div class="finLab">FINAL TIME</div>
        <h1 id="endTime">&mdash;</h1>
        <div id="verdict"></div>
        <div id="endCols">
          <div id="resultStats"></div>
          <div id="splitTable"></div>
        </div>
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
      endPanel: q('endPanel'), endTime: q('endTime'), endDate: q('endDate'),
      verdict: q('verdict'), stats: q('resultStats'), splitTable: q('splitTable'),
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

    const api = { nodes: n };

    api.setDate = function (key) {
      n.startDate.textContent = key + ' · GLOBAL COURSE';
      n.endDate.textContent = key + ' · GLOBAL COURSE';
    };

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
      set(n.margin, 'margin',
        Pace.clock(Math.abs(margin)) + (margin >= 0 ? ' UNDER ' : ' OVER ') + K.RECORD_LABEL);

      // Pace required over the road that is left. This is the race-desk number
      // and it is also the exact test for a dead record: FLOOR_PACE is the
      // fastest the streak can ever make you, so once the requirement drops
      // below it no run of clean gates can get the record back.
      const remain = K.MARATHON_MILES - p.miles;
      const need = remain > 0.01 ? (K.RECORD_SECONDS - p.raceTime) / remain : NaN;
      const gone = remain > 0.01 && !(need >= K.FLOOR_PACE);

      // Share of the 5:30 -> 4:20 range the streak has already bought. While a
      // lot of it is still unspent the projection is falling under the player
      // every second, so it is an estimate and is labelled as one.
      const unlocked = (K.START_PACE - p.targetPace()) / (K.START_PACE - K.FLOOR_PACE);
      // The long "still buying speed" hold existed because the frozen-pace
      // projection was useless until the streak had spent most of its range.
      // projectClean() is within ~30s of the truth by the first mile, so the
      // verdict can harden almost immediately; all that is held back is the
      // opening stretch where too few gates have been seen to measure the
      // gate rate the projection depends on.
      const settled = p.miles > 0.6;
      const bleeding = p.targetPace() - p.pace > 1.5; // streak was cut, pace sliding back

      let state, chip;
      if (gone) {
        state = 'off'; chip = 'RECORD GONE';
      } else if (!settled) {
        state = 'est';
        chip = bleeding ? 'BLEEDING SPEED ▲' : 'ESTIMATING';
      } else if (margin > 0) {
        state = 'on';  chip = 'RECORD ON';
      } else {
        state = 'off'; chip = 'OFF RECORD';
      }
      set(n.status, 'chip', chip);
      cls(n.status, 'chipCls', 'chip ' + state);
      cls(n.projCell, 'projCls', state);

      // ---- the engine: streak -> speed unlocked -> pace ------------------
      set(n.streakVal, 'streak', String(p.streak));
      n.gaugeFill.style.width =
        (clamp01((K.START_PACE - p.pace) / (K.START_PACE - K.FLOOR_PACE)) * 100) + '%';
      set(n.paceVal, 'pace', Pace.pace(p.pace));
      cls(n.paceVal, 'paceCls', 'val num' + (p.pace <= K.RECORD_PACE ? ' ahead' : ''));
      set(n.needVal, 'need', 'NEED ' + Pace.pace(need) + '/MI');
      cls(n.needVal, 'needCls', 'sub num' + (gone ? ' behind' : ''));

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
      syncPanels();
    };

    api.countdown = function (text) {
      n.count.classList.toggle('hidden', text === null);
      if (text !== null) n.countVal.textContent = text;
    };

    api.showEnd = function (p) {
      const beat = p.finishTime < K.RECORD_SECONDS;
      n.endTime.textContent = Pace.clock(p.finishTime);
      n.verdict.textContent = beat
        ? `RECORD BEATEN BY ${Pace.clock(K.RECORD_SECONDS - p.finishTime)}`
        : `SHORT BY ${Pace.clock(p.finishTime - K.RECORD_SECONDS)}`;
      n.verdict.className = beat ? 'beat' : 'miss';

      const rows = [
        ['AVG PACE', Pace.pace(p.finishTime / K.MARATHON_MILES) + '/mi'],
        // p.pace at the line is the pace held into the finish, not the best of
        // the race -- a run that broke late finishes slower than it ever ran.
        ['FINAL PACE', Pace.pace(p.pace) + '/mi'],
        ['LONGEST CLEAN', String(p.bestStreak) + ' gates'],
        ['CONTACTS', String(p.hits)],
        ['TIME LOST', '+' + Pace.clock(p.hits * K.HIT_TIME_PENALTY)],
        ['RECORD', K.RECORD_LABEL],
      ];
      n.stats.innerHTML = rows
        .map(([k, v]) => `<div class="k">${k}</div><div class="v num">${v}</div>`)
        .join('');

      // Five-mile splits plus the line: the shape of the race in six rows,
      // which is the one thing the finish screen can show that the live
      // readout never could.
      let table = '<div class="k">MI</div><div class="k">TIME</div><div class="k">VS REC</div>';
      const marks = p.splits.filter((s) => s.mile % 5 === 0);
      for (const s of marks) {
        const d = s.time - s.mile * K.RECORD_PACE;
        table += `<div class="v num">${s.mile}</div>`
              + `<div class="v num">${Pace.clock(s.time)}</div>`
              + `<div class="v num ${d < 0 ? 'ahead' : 'behind'}">${Pace.delta(d)}</div>`;
      }
      const fd = p.finishTime - K.RECORD_SECONDS;
      table += '<div class="sep"></div>';
      table += `<div class="v num fin">${K.MARATHON_LABEL}</div>`
            + `<div class="v num fin">${Pace.clock(p.finishTime)}</div>`
            + `<div class="v num fin ${fd < 0 ? 'ahead' : 'behind'}">${Pace.delta(fd)}</div>`;
      n.splitTable.innerHTML = table;

      n.endPanel.classList.remove('hidden');
      syncPanels();
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
