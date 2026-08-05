/**
 * HUD: the race readout, plus the start/finish panels.
 *
 * DOM rather than canvas, because tabular-figure text at small sizes is
 * sharper through the browser's own rasteriser than anything drawn into a
 * WebGL texture, and it stays sharp on every DPR without extra work.
 *
 * The numbers update every frame but are written only when their rendered
 * string actually changes -- a race clock re-flowing 60 times a second is
 * both a layout cost and a readability problem.
 */
MR.HUD = (function () {
  const K = MR.K;
  const Pace = MR.Pace;

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function create(root, opts) {
    opts = opts || {};
    root.innerHTML = `
      <div id="top">
        <div id="clockBox">
          <div class="lab">RACE TIME</div>
          <div class="val num" id="clock">0:00</div>
        </div>
        <div id="deltaBox">
          <div class="lab">VS ${K.RECORD_LABEL}</div>
          <div class="val num" id="delta">+0:00.0</div>
        </div>
      </div>

      <div id="pace">
        <div class="lab">CURRENT PACE</div>
        <div><span class="val num" id="paceVal">5:30</span><span class="unit">/MI</span></div>
        <div class="sub num" id="paceSub">TARGET 4:33/MI</div>
      </div>

      <div id="dist">
        <div class="lab">DISTANCE</div>
        <div><span class="val num" id="distVal">0.00</span><span class="unit">MI</span></div>
        <div class="sub num" id="proj">PROJ --:--</div>
      </div>

      <div id="streak">
        <div class="val num" id="streakVal">0</div>
        <div class="lab">CLEAN</div>
      </div>

      <div id="rail">
        <div id="railBg"></div>
        <div id="railFill"></div>
        <div id="railGhost"></div>
      </div>

      <div id="toast"><div class="big num" id="toastBig"></div><div class="small num" id="toastSmall"></div></div>
      <div id="perf" class="num"></div>

      <div class="panel" id="startPanel">
        <div class="date" id="startDate"></div>
        <h1>DAILY MARATHON</h1>
        <div class="blurb">
          One course. Same for everyone, everywhere, today.
          26.2 miles at ${Pace.pace(K.START_PACE)}/mi &mdash; and the only thing
          that makes you faster is an unbroken clean line.
          <br><br>
          The record is <b>${K.RECORD_LABEL}</b>. It needs ${Pace.pace(K.RECORD_PACE)}/mi.
        </div>
        <div class="keys">
          <kbd>&larr;</kbd> <kbd>&rarr;</kbd> lanes &nbsp;&middot;&nbsp;
          <kbd>&uarr;</kbd> jump &nbsp;&middot;&nbsp; <kbd>&darr;</kbd> duck
          <br>or swipe
        </div>
        <button class="cta" id="startBtn">TOE THE LINE</button>
      </div>

      <div class="panel hidden" id="endPanel">
        <div class="date" id="endDate"></div>
        <h1 id="endTime">—</h1>
        <div id="verdict"></div>
        <div id="resultStats"></div>
        <button class="cta" id="againBtn">RUN IT AGAIN</button>
      </div>

      <div id="count" class="hidden"><span id="countVal"></span></div>
    `;

    const q = (id) => root.querySelector('#' + id);
    const n = {
      clock: q('clock'), delta: q('delta'), deltaBox: q('deltaBox'),
      paceVal: q('paceVal'), paceSub: q('paceSub'),
      distVal: q('distVal'), proj: q('proj'),
      streak: q('streak'), streakVal: q('streakVal'),
      railFill: q('railFill'), railGhost: q('railGhost'), rail: q('rail'),
      toast: q('toast'), toastBig: q('toastBig'), toastSmall: q('toastSmall'),
      startPanel: q('startPanel'), startBtn: q('startBtn'), startDate: q('startDate'),
      endPanel: q('endPanel'), endTime: q('endTime'), endDate: q('endDate'),
      verdict: q('verdict'), stats: q('resultStats'), againBtn: q('againBtn'),
      count: q('count'), countVal: q('countVal'),
      perf: q('perf'),
    };

    // Mile ticks on the rail; every 5th is major, plus the finish.
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

    const api = { nodes: n };

    api.setDate = function (key) {
      n.startDate.textContent = key + ' · GLOBAL COURSE';
      n.endDate.textContent = key + ' · GLOBAL COURSE';
    };

    api.update = function (p, extra) {
      set(n.clock, 'clock', Pace.clock(p.raceTime));

      const d = p.deltaVsRecord();
      set(n.delta, 'delta', Pace.delta(d));
      const ahead = d < 0;
      if (cache.aheadState !== ahead) {
        cache.aheadState = ahead;
        n.delta.className = 'val num ' + (ahead ? 'ahead' : 'behind');
      }

      set(n.paceVal, 'pace', Pace.pace(p.pace));
      set(n.paceSub, 'paceSub', 'TARGET ' + Pace.pace(p.targetPace()) + '/MI');
      set(n.distVal, 'dist', p.miles.toFixed(2));
      set(n.proj, 'proj', 'PROJ ' + Pace.clock(p.projected()));
      set(n.streakVal, 'streak', String(p.streak));

      const f = p.miles / K.MARATHON_MILES;
      n.railFill.style.width = (f * 100) + '%';
      n.railGhost.style.left = ((p.ghostMiles() / K.MARATHON_MILES) * 100) + '%';

      if (extra && extra.fps !== undefined) {
        set(n.perf, 'perf', extra.fps.toFixed(0) + ' FPS · ' + (extra.draws || 0) + ' DRAWS');
      }
    };

    api.flashBroken = function () {
      n.streak.classList.add('broken');
      setTimeout(() => n.streak.classList.remove('broken'), 420);
    };

    let toastTimer = null;
    api.toast = function (big, small, ms) {
      n.toastBig.textContent = big;
      n.toastSmall.textContent = small || '';
      n.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => n.toast.classList.remove('show'), ms || 1400);
    };

    api.showStart = function (show) { n.startPanel.classList.toggle('hidden', !show); };

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
        ['BEST PACE', Pace.pace(p.pace) + '/mi'],
        ['LONGEST CLEAN', String(p.bestStreak) + ' gates'],
        ['MISTAKES', String(p.hits)],
        ['RECORD', K.RECORD_LABEL],
      ];
      n.stats.innerHTML = rows
        .map(([k, v]) => `<div class="k">${k}</div><div class="v num">${v}</div>`)
        .join('');
      n.endPanel.classList.remove('hidden');
    };

    api.hideEnd = function () { n.endPanel.classList.add('hidden'); };

    api.onStart = function (fn) { n.startBtn.addEventListener('click', fn); };
    api.onAgain = function (fn) { n.againBtn.addEventListener('click', fn); };
    api.showPerf = function (on) { n.perf.classList.toggle('on', on); };

    return api;
  }

  return { create };
})();
