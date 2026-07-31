// Difficulty sweep.
//
// Plays the full 26.2 miles at several skill levels against the same course and
// reports where each lands relative to the world record. The point is that the
// record must be reachable only by a near-perfect race: if every tier clusters
// within a minute of each other, the record is a coin flip rather than a test of
// skill, which is exactly what this caught the first time it ran.
//
// `errorRate` is a committed mistake — the bot ignores that obstacle entirely —
// so it maps onto hits instead of being a harmless one-frame hesitation.
import { chromium } from 'playwright';
import { serve, launch, threeDirFromArgv } from './serve.mjs';
const { url, close } = await serve({ root:'/home/user/marathonruns', threeDir: threeDirFromArgv() });
const b = await launch(chromium);
const page = await b.newPage({ viewport:{width:430,height:860} });
page.on('pageerror', e=>console.log('PAGEERROR', e.message));
page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('favicon')) console.log('CONSOLE', m.text()); });
await page.clock.install({ time: new Date(Date.UTC(2026,0,15,12,0,0)) });
await page.addInitScript(()=>localStorage.setItem('mr_tut_v1','1'));
await page.goto(url+'/index.html?debug', { waitUntil:'load' });
await page.waitForFunction(()=>!!window.MR);

const results = await page.evaluate(() => {
  const d=window.MR, S=d.S, T=d.T, LX=d.LANE_X;
  d.detach(); d.reseed();
  document.querySelectorAll('.overlay').forEach(o=>o.classList.add('hidden'));
  const DT=1/60;
  const step=()=>d.frame(DT, false);
  const act=a=>{ if(d.input.queue.length<3) d.input.queue.push(a); };

  // does lane L collide with anything in the window [s0,s1]?
  const laneBlocked=(L,s0,s1)=>{
    for(const o of d.COURSE){
      if(o.s < s0-12) continue;
      if(o.s > s1) break;
      if(o.mode==='pickup'||o.mode==='decor') continue;
      if(o.type===T.CYCLIST){ if(o.lane===L) return o; continue; }
      if(Math.abs(LX[L]-o.x) < o.w*0.5+0.9) return o;
    }
    return null;
  };
  const pickupInLane=(L,s0,s1)=>{
    for(const o of d.COURSE){
      if(o.s < s0) continue;
      if(o.s > s1) break;
      if(o.mode!=='pickup'||o.done) continue;
      if(Math.abs(LX[L]-o.x) < 1.2) return o;
    }
    return null;
  };

  // errorRate: probability of fumbling a given decision, to model skill levels
  const run=(errorRate, grabPickups, seed)=>{
    // The obvious LCG (rnd*1103515245 + 12345) & 0x7fffffff silently breaks in
    // JS: once rnd is large the product passes 2^53, the double loses integer
    // precision and the sequence collapses. It never returned a value under
    // 0.04, so every skill tier played identically to `perfect` and the sweep
    // reported a tier separation that did not exist. mulberry32 stays inside
    // 32-bit ops via Math.imul and does not have that failure mode.
    let rnd=(seed||12345)>>>0;
    const rand=()=>{
      rnd=(rnd+0x6D2B79F5)|0;
      let t=Math.imul(rnd^rnd>>>15, 1|rnd);
      t=t+Math.imul(t^t>>>7, 61|t)^t;
      return ((t^t>>>14)>>>0)/4294967296;
    };
    d.startRun();
    let real=0, guard=0, pickTaken=0, pickSeen=0, comboSum=0, samples=0;
    const ignored=new Set(), judged=new Set();
    const shouldIgnore=o=>{
      if(!judged.has(o)){ judged.add(o); if(rand()<errorRate) ignored.add(o); }
      return ignored.has(o);
    };
    const paceAt=[];
    let nextMile=1;
    while(S.phase==='running' && guard++<200000){
      const v=d.worldSpeed();
      const react=v*0.55;          // plan roughly half a second out
      const s0=S.s, s1=S.s+react;

      // 1) overhead scaffold: duck, timed late enough to still be low on contact
      let over=null;
      for(const o of d.COURSE){
        if(o.s<s0) continue; if(o.s>s0+v*0.34) break;
        if(o.mode==='over'&&!o.done){ over=o; break; }
      }
      if(over && !shouldIgnore(over) && !d.isLow() && !d.isAirborne()){
        act('down');
      } else {
        let threat=laneBlocked(S.lane,s0,s1);
        if(threat && shouldIgnore(threat)) threat=null;
        if(threat){
          {
            // Consider every lane, not just the neighbours, and step toward the
            // best one. A car spans two lanes, so from the far side the only
            // escape is two lanes across; a bot that only looked at S.lane±1
            // scored that -100, gave up, and ate the car. That made cars 15 of
            // its 16 stumbles and understated what the course actually allows.
            let bestL=-1,bestScore=-1e9;
            for(let L=0;L<3;L++){
              if(L===S.lane) continue;
              const blk=laneBlocked(L,s0,s1+40);
              let sc = blk? -100 : 0;
              sc -= Math.abs(L-S.lane);                  // prefer the nearer out
              if(!blk && pickupInLane(L,s0,s1+40)) sc+=5;
              // crossing a middle lane is only viable if the middle is clear too
              if(Math.abs(L-S.lane)===2 && laneBlocked(1,s0,s1+40)) sc-=100;
              if(sc>bestScore){bestScore=sc;bestL=L;}
            }
            if(bestScore>-50 && bestL>=0 && S.laneT>=1){
              act(bestL>S.lane?'right':'left');
            } else if(threat.jump && !d.isAirborne() && (threat.s-S.s)<v*0.30){
              act('up');
            }
          }
        } else if(grabPickups && S.laneT>=1){
          // no threat: drift onto a pickup line if it stays safe
          for(const L of [S.lane,S.lane-1,S.lane+1]){
            if(L<0||L>2||L===S.lane) continue;
            if(pickupInLane(L,s0,s1+30) && !laneBlocked(L,s0,s1+50)){
              act(L>S.lane?'right':'left'); break;
            }
          }
        }
      }
      step(); real+=DT;
      comboSum+=S.combo; samples++;
      if(S.mile>=nextMile){ paceAt.push(+S.pace.toFixed(2)); nextMile++; }
    }
    for(const o of d.COURSE){ if(o.mode==='pickup'){ pickSeen++; if(o.done) pickTaken++; } }
    // static audit of the generated course for unwinnable positions
    let impossible=0;
    for(const o of d.COURSE){
      if(o.mode==='pickup'||o.mode==='decor') continue;
      if(o.mode==='over'||o.jump) continue;          // duck or jump clears it
      let free=0;
      for(let L=0;L<3;L++){
        const blk=laneBlocked(L,o.s-2,o.s+2);
        if(!blk) free++;
      }
      if(free===0) impossible++;
    }
    const total=S.clock+S.penalty;
    return {
      clock:total, clockFmt:document.getElementById('rTime').textContent,
      realSec:+real.toFixed(1),
      avgPace:+(total/60/26.2).toFixed(3),
      hits:S.hits, gapToWR:+(total-d.WR_SECONDS).toFixed(1),
      beatWR: total<d.WR_SECONDS,
      pickupRate:+(pickTaken/pickSeen).toFixed(2),
      avgCombo:+(comboSum/samples).toFixed(1),
      paceByMile:paceAt, impossible,
    };
  };

  return {
    WR: d.WR_SECONDS, WRpace:+d.WR_PACE.toFixed(3),
    band:{base:d.PACE_BASE, floor:d.PACE_FLOOR, cap:d.PACE_CAP, comboFull:d.COMBO_FULL},
    obstacles: d.COURSE.filter(o=>o.mode!=='pickup'&&o.mode!=='decor').length,
    pickups: d.COURSE.filter(o=>o.mode==='pickup').length,
    perfect: run(0.00, true, 111),
    strong:  run(0.04, true, 222),
    decent:  run(0.12, true, 333),
    sloppy:  run(0.28, false, 444),
    passive: run(1.00, false, 555),
  };
});
console.log(JSON.stringify(results,null,1));
await b.close(); close();
