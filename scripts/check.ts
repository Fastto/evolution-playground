// Headless check of the model (Node 23.6+ runs TypeScript directly): `npm run check`
// 1) the same seed gives the same world; 2) a full run with the video's timeline, printed every 2000 steps.
import {DEFAULTS, Sim, VIDEO_EVENTS} from '../src/sim.ts';

const run = (seed: number, steps: number, log = false) => {
  const sim = new Sim(seed, {...DEFAULTS});
  const t0 = Date.now();
  while (sim.t < steps) {
    if (sim.t === VIDEO_EVENTS.jaws) sim.setJaws(true);
    if (sim.t === VIDEO_EVENTS.meteor - 50) sim.callMeteor(...VIDEO_EVENTS.meteorAt);
    sim.step();
    if (log && sim.t % 2000 === 0) {
      const s = sim.stats();
      console.log(
        `t=${s.t} n=${s.n} gen=${s.gen.toFixed(1)} families=${s.lines} hunters=${s.hunters} size=${s.size.toFixed(2)} speed=${s.speed.toFixed(2)} sight=${s.sight.toFixed(0)} diet=${s.diet.toFixed(2)} crest=${s.crest.toFixed(2)} taste=${s.taste.toFixed(2)} eaten=${sim.ev.eaten}`,
      );
    }
    if (sim.extinctAt !== null) {
      if (log) console.log(`extinct at step ${sim.extinctAt}`);
      break;
    }
  }
  return {fp: sim.fingerprint(), ms: Date.now() - t0, sim};
};

const seed = Number(process.argv[2] ?? 4);
const steps = Number(process.argv[3] ?? 50000);
const a = run(seed, 3000);
const b = run(seed, 3000);
const c = run(seed + 1, 3000);
console.log(`same seed, twice: ${a.fp} ${b.fp} -> ${a.fp === b.fp ? 'identical' : 'DIFFERENT'}`);
console.log(`another seed:     ${c.fp} -> ${c.fp !== a.fp ? 'differs, as it should' : 'SAME (bad)'}`);
if (a.fp !== b.fp || c.fp === a.fp) process.exit(1);
const full = run(seed, steps, true);
console.log(`seed ${seed}: ${full.sim.t} steps in ${(full.ms / 1000).toFixed(1)} s (${(full.ms / full.sim.t).toFixed(3)} ms per step)`);
