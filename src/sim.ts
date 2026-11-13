// The model from the ArtiFish video "I Simulated Evolution", ported from the original Python/numpy
// prototype to plain TypeScript. No dependencies and no DOM: this file runs in the browser and in Node.
//
// World: a 1600x900 arena where plant crumbs appear at random. Every creature carries six genes:
//   size  - body size (mass = size^2): a bigger energy store, but more expensive to keep alive
//   speed - cost of moving ~ mass * speed^3 (drag): twice as fast burns eight times the energy
//   sight - how far it sees food, mates and threats; eyes cost energy too
//   diet  - 0 = plants, 1 = meat. Plants give (1 - diet), meat gives sqrt(diet).
//           Only diet > 0.5 ("jaws") can attack the living, and only prey that is not bigger.
//   crest - shown by males only: costs energy, slows him down, and makes him easier for a hunter to spot
//   taste - used by females only: how much a male's crest matters when she chooses
// Both sexes carry all six genes. `line` is the mother's family (the body colour): it passes only from
// mother to child and never mutates.

export const W = 1600;
export const H = 900;
export const JAWS = 0.5;
export const HIST = 40; // steps of position history kept per creature (the drawn tail follows it)
export const GENES = ['size', 'speed', 'sight', 'diet', 'crest', 'taste'] as const;
export const LO = [0.4, 0.3, 20, 0, 0, 0];
export const HI = [3, 6, 300, 1, 5, 8];
export const MUT = [0.05, 0.12, 5, 0.035, 0.07, 0.14];
const CELL = 50; // plant grid cell

/** Every number the model uses. Defaults are the values of the run shown in the video. */
export type Params = {
  startPop: number; // founders (applies on reset)
  plantRate: number; // new plants per step (Poisson mean)
  plantCap: number; // no new plants while this many are uneaten
  plantEnergy: number;
  mutation: number; // multiplier on the per-gene mutation sizes in MUT
  base: number; // resting cost * mass
  move: number; // * mass * speed^3
  see: number; // * sight
  crestCost: number; // * crest (males only)
  crestVis: number; // a hunter sees a male (1 + crestVis * crest) times farther and prefers him as a target
  crestDrag: number; // a crest slows him down: speed / (1 + crestDrag * crest)
  ready: number; // energy a female needs to breed (* sqrt(mass))
  maleReady: number;
  child: number; // what a child costs the mother (* sqrt(mass))
  maleChild: number; // what it costs the father
  maleCool: number; // steps a male waits between matings
  store: number; // energy cap (* mass)
  meat: number; // meat in a body (* mass)
  corpseLife: number;
  maturity: number;
  life: number; // lifespan in steps (each creature gets 80-120 % of it)
  chooseNoise: number; // noise in a female's choice
  lunge: number; // a hunter's sprint multiplier when close to prey
  lungeRange: number;
};

export const DEFAULTS: Params = {
  startPop: 100,
  plantRate: 1.6,
  plantCap: 900,
  plantEnergy: 40,
  mutation: 1,
  base: 0.03,
  move: 0.006,
  see: 0.0006,
  crestCost: 0.02,
  crestVis: 3,
  crestDrag: 0.15,
  ready: 90,
  maleReady: 60,
  child: 50,
  maleChild: 12,
  maleCool: 40,
  store: 160,
  meat: 150,
  corpseLife: 500,
  maturity: 70,
  life: 800,
  chooseNoise: 0.06,
  lunge: 1.6,
  lungeRange: 70,
};

/** The three moments of the video's run. */
export const VIDEO_EVENTS = {jaws: 14000, meteor: 44000, meteorAt: [1050, 400] as [number, number], meteorR: 600, dust: 1500, dustFood: 0.9 / 1.6};

export type Creature = {
  uid: number;
  x: number;
  y: number;
  head: number;
  g: number[]; // size, speed, sight, diet, crest, taste
  energy: number;
  age: number;
  line: number;
  gen: number;
  sex: number; // 0 female, 1 male
  cool: number;
  mom: number;
  dad: number;
  birth: number; // step of birth
  mode: number; // 0 wandering, 1 fleeing, 2 food, 3 mate
  kids: number;
  dead: number; // 0 alive, 1 starved, 2 eaten, 3 old age, 4 meteor
  diedAt: number;
  px: Float32Array; // ring buffer of past positions
  py: Float32Array;
  pi: number; // index of the newest entry
  pn: number; // entries filled
};

export type Corpse = {x: number; y: number; meat: number; full: number; age: number; uid: number; line: number; g: number[]; diedAt: number};
export type Kill = {t: number; x: number; y: number};
export type Meteor = {t: number; x: number; y: number; r: number};
export type Sample = {t: number; n: number; hunters: number; gen: number; lines: number; size: number; speed: number; sight: number; diet: number; crest: number; taste: number};

/** Deterministic generator (mulberry32), same as the channel's other simulations. */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// sqrt is exactly rounded everywhere, so results do not depend on the engine's Math.hypot
const dist = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const plantEff = (diet: number) => (1 - diet) * (diet > JAWS ? 0.25 : 1); // jaws grind plants badly

export class Sim {
  p: Params;
  seed: number;
  t = 0;
  cs: Creature[] = [];
  corpses: Corpse[] = [];
  kills: Kill[] = []; // recent attacks (for drawing)
  meteor: Meteor | null = null; // the last (or incoming) meteor
  jaws = false; // can diet > 0.5 attack the living?
  dustUntil = -1; // less food until this step (after a meteor)
  ev = {births: 0, starved: 0, eaten: 0, old: 0, meteor: 0};
  history: Sample[] = [];
  sampleEvery = 100;
  marks: {t: number; kind: 'jaws' | 'meteor'}[] = [];
  extinctAt: number | null = null;
  plantCount = 0;
  private cells: number[][]; // plant grid: flat [x, y, x, y, ...] per cell
  private gw = Math.ceil(W / CELL);
  private gh = Math.ceil(H / CELL);
  private nextUid = 0;
  private r: () => number;
  private spare: number | null = null;

  constructor(seed: number, params: Params) {
    this.seed = seed;
    this.p = params;
    this.r = rng(seed);
    this.cells = Array.from({length: this.gw * this.gh}, () => []);
    const n0 = Math.max(2, Math.round(params.startPop));
    for (let i = 0; i < n0; i++) {
      const x = this.uni(50, W - 50);
      const y = this.uni(50, H - 50);
      const g = [
        this.norm(1.0, 0.05),
        this.norm(2.0, 0.1),
        this.norm(80, 5),
        clamp(this.norm(0.05, 0.02), 0, 1),
        Math.max(0, this.norm(0.1, 0.05)),
        Math.max(0, this.norm(0.3, 0.2)),
      ];
      const c = this.make(x, y, this.uni(0, Math.PI * 2), g, 80, i, 0, i % 2, -1, -1);
      c.age = Math.floor(this.r() * 300);
      c.birth = -c.age;
      this.cs.push(c);
    }
    for (let i = 0; i < 400; i++) this.addPlant(this.uni(0, W), this.uni(0, H));
    this.sample();
  }

  // ---------- random ----------
  private uni(a: number, b: number) {
    return a + (b - a) * this.r();
  }
  private norm(mu: number, sd: number) {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mu + sd * s;
    }
    let u = 0;
    while (u < 1e-12) u = this.r();
    const v = this.r();
    const m = Math.sqrt(-2 * Math.log(u));
    this.spare = m * Math.sin(2 * Math.PI * v);
    return mu + sd * m * Math.cos(2 * Math.PI * v);
  }
  private poisson(lambda: number) {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0;
    let q = 1;
    do {
      k++;
      q *= this.r();
    } while (q > L);
    return k - 1;
  }

  private make(x: number, y: number, head: number, g: number[], energy: number, line: number, gen: number, sex: number, mom: number, dad: number): Creature {
    const c: Creature = {uid: this.nextUid++, x, y, head, g, energy, age: 0, line, gen, sex, cool: 0, mom, dad, birth: this.t, mode: 0, kids: 0, dead: 0, diedAt: -1, px: new Float32Array(HIST + 1), py: new Float32Array(HIST + 1), pi: 0, pn: 1};
    c.px[0] = x;
    c.py[0] = y;
    return c;
  }

  // ---------- plants ----------
  private cellOf(x: number, y: number) {
    const cx = clamp(Math.floor(x / CELL), 0, this.gw - 1);
    const cy = clamp(Math.floor(y / CELL), 0, this.gh - 1);
    return cy * this.gw + cx;
  }
  private addPlant(x: number, y: number) {
    this.cells[this.cellOf(x, y)].push(x, y);
    this.plantCount++;
  }
  /** Calls f(x, y) for every plant. */
  eachPlant(f: (x: number, y: number) => void) {
    for (const cell of this.cells) for (let i = 0; i < cell.length; i += 2) f(cell[i], cell[i + 1]);
  }
  private nearestPlant(x: number, y: number, radius: number): [number, number, number] | null {
    const x0 = clamp(Math.floor((x - radius) / CELL), 0, this.gw - 1);
    const x1 = clamp(Math.floor((x + radius) / CELL), 0, this.gw - 1);
    const y0 = clamp(Math.floor((y - radius) / CELL), 0, this.gh - 1);
    const y1 = clamp(Math.floor((y + radius) / CELL), 0, this.gh - 1);
    let best = radius * radius;
    let bx = 0;
    let by = 0;
    let hit = false;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.gw + cx];
        for (let i = 0; i < cell.length; i += 2) {
          const dx = cell[i] - x;
          const dy = cell[i + 1] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            bx = cell[i];
            by = cell[i + 1];
            hit = true;
          }
        }
      }
    return hit ? [bx, by, Math.sqrt(best)] : null;
  }
  /** Removes every plant within reach and returns how many were eaten. */
  private eatPlants(x: number, y: number, reach: number) {
    const x0 = clamp(Math.floor((x - reach) / CELL), 0, this.gw - 1);
    const x1 = clamp(Math.floor((x + reach) / CELL), 0, this.gw - 1);
    const y0 = clamp(Math.floor((y - reach) / CELL), 0, this.gh - 1);
    const y1 = clamp(Math.floor((y + reach) / CELL), 0, this.gh - 1);
    const r2 = reach * reach;
    let eaten = 0;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.gw + cx];
        for (let i = cell.length - 2; i >= 0; i -= 2) {
          const dx = cell[i] - x;
          const dy = cell[i + 1] - y;
          if (dx * dx + dy * dy < r2) {
            cell.splice(i, 2);
            eaten++;
          }
        }
      }
    this.plantCount -= eaten;
    return eaten;
  }
  private spawnPlants() {
    const rate = this.p.plantRate * (this.t < this.dustUntil ? VIDEO_EVENTS.dustFood : 1);
    const k = this.poisson(rate);
    if (k && this.plantCount < this.p.plantCap) for (let i = 0; i < k; i++) this.addPlant(this.uni(0, W), this.uni(0, H));
  }

  // ---------- world events ----------
  setJaws(on: boolean) {
    if (on === this.jaws) return;
    this.jaws = on;
    if (on) this.marks.push({t: this.t, kind: 'jaws'});
  }
  /** Announces a meteor: it lands `delay` steps from now (the streak in the sky needs a moment). */
  callMeteor(x: number, y: number, r = VIDEO_EVENTS.meteorR, delay = 50) {
    this.meteor = {t: this.t + delay, x, y, r};
  }
  private impact(m: Meteor) {
    const r2 = m.r * m.r;
    const keep: Creature[] = [];
    for (const c of this.cs) {
      const dx = c.x - m.x;
      const dy = c.y - m.y;
      if (dx * dx + dy * dy > r2) keep.push(c);
      else {
        c.dead = 4;
        c.diedAt = this.t;
        this.ev.meteor++;
      }
    }
    this.cs = keep;
    for (const cell of this.cells)
      for (let i = cell.length - 2; i >= 0; i -= 2) {
        const dx = cell[i] - m.x;
        const dy = cell[i + 1] - m.y;
        if (dx * dx + dy * dy <= r2) {
          cell.splice(i, 2);
          this.plantCount--;
        }
      }
    this.dustUntil = this.t + VIDEO_EVENTS.dust;
    this.marks.push({t: this.t, kind: 'meteor'});
  }

  // ---------- one step ----------
  step() {
    const p = this.p;
    if (this.meteor && this.meteor.t === this.t) this.impact(this.meteor);
    this.spawnPlants();
    const cs = this.cs;
    const n = cs.length;
    if (n === 0) {
      if (this.extinctAt === null) this.extinctAt = this.t;
      this.t++;
      return;
    }
    const m = new Float64Array(n);
    const show = new Float64Array(n); // visible crest
    const fReady: number[] = [];
    const mReady: number[] = [];
    const hungry = new Uint8Array(n);
    const tx = new Float64Array(n);
    const ty = new Float64Array(n);
    const mode = new Uint8Array(n);
    const best = new Float64Array(n);
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    const preyOf = new Int32Array(n).fill(-1);
    const choice = new Int32Array(n).fill(-1);
    const hunters: number[] = [];
    const prey: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      m[i] = c.g[0] * c.g[0];
      show[i] = c.sex === 1 ? c.g[4] : 0;
      const mature = c.age > p.maturity;
      const sq = Math.sqrt(m[i]);
      if (c.sex === 0 && mature && c.energy > p.ready * sq) fReady.push(i);
      else if (c.sex === 1 && mature && c.energy > p.maleReady * sq && c.cool <= 0) mReady.push(i);
      else hungry[i] = 1;
      tx[i] = c.x;
      ty[i] = c.y;
      if (c.g[3] > JAWS) hunters.push(i);
      else prey.push(i);
    }

    // threats: run from the nearest hunter you can see (it must have jaws and be at least your size)
    if (this.jaws && hunters.length)
      for (const i of prey) {
        const c = cs[i];
        let bd = c.g[2];
        let bj = -1;
        for (const j of hunters) {
          const h = cs[j];
          if (h.g[0] < c.g[0]) continue;
          const d = dist(c.x - h.x, c.y - h.y);
          if (d < bd) {
            bd = d;
            bj = j;
          }
        }
        if (bj >= 0) {
          tx[i] = c.x + (c.x - cs[bj].x);
          ty[i] = c.y + (c.y - cs[bj].y);
          mode[i] = 1;
        }
      }

    // food: the best of the nearest plant, a body, or living prey
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      const diet = c.g[3];
      const sight = c.g[2];
      const eff = p.plantEnergy * plantEff(diet);
      if (eff > 0) {
        const np = this.nearestPlant(c.x, c.y, sight);
        if (np) {
          const s = eff / (np[2] + 20);
          if (s > best[i]) {
            best[i] = s;
            fx[i] = np[0];
            fy[i] = np[1];
          }
        }
      }
      if (diet > 0.15) {
        const sd = Math.sqrt(diet);
        for (const k of this.corpses) {
          const d = dist(c.x - k.x, c.y - k.y);
          if (d < sight) {
            const s = (sd * k.meat) / (d + 20);
            if (s > best[i]) {
              best[i] = s;
              fx[i] = k.x;
              fy[i] = k.y;
            }
          }
        }
      }
    }
    if (this.jaws)
      for (const i of hunters) {
        const c = cs[i];
        const sd = Math.sqrt(c.g[3]);
        const speed = c.g[1];
        let bs = 0;
        let bj = -1;
        for (const j of prey) {
          const q = cs[j];
          if (c.g[0] < q.g[0]) continue;
          const d = dist(c.x - q.x, c.y - q.y);
          const vis = 1 + p.crestVis * show[j];
          if (d >= c.g[2] * vis) continue;
          const val = sd * (p.meat * m[j] + 0.5 * Math.max(q.energy, 0));
          const vmax = q.g[1] / (1 + p.crestDrag * show[j]);
          const catchP = clamp((speed - vmax) / speed + 0.35, 0.05, 1);
          const s = (val * catchP * vis) / (d + 20); // a bright crest draws the eye
          if (s > bs) {
            bs = s;
            bj = j;
          }
        }
        if (bj >= 0 && bs > best[i]) {
          best[i] = bs;
          fx[i] = cs[bj].x;
          fy[i] = cs[bj].y;
          preyOf[i] = bj;
        }
      }
    for (let i = 0; i < n; i++)
      if (mode[i] === 0 && best[i] > 0 && hungry[i]) {
        tx[i] = fx[i];
        ty[i] = fy[i];
        mode[i] = 2;
      }

    // mates: a female picks the ready male she can see whose crest she likes best;
    // a male heads for the nearest ready female
    if (fReady.length && mReady.length) {
      for (const i of fReady) {
        if (mode[i] !== 0) continue;
        const c = cs[i];
        let bs = -Infinity;
        let bj = -1;
        for (const j of mReady) {
          const q = cs[j];
          if (dist(c.x - q.x, c.y - q.y) >= c.g[2]) continue;
          const s = c.g[5] * show[j] + this.norm(0, p.chooseNoise);
          if (s > bs) {
            bs = s;
            bj = j;
          }
        }
        if (bj >= 0) {
          choice[i] = bj;
          tx[i] = cs[bj].x;
          ty[i] = cs[bj].y;
          mode[i] = 3;
        }
      }
      for (const i of mReady) {
        if (mode[i] !== 0) continue;
        const c = cs[i];
        let bd = c.g[2];
        let bj = -1;
        for (const j of fReady) {
          const d = dist(c.x - cs[j].x, c.y - cs[j].y);
          if (d < bd) {
            bd = d;
            bj = j;
          }
        }
        if (bj >= 0) {
          tx[i] = cs[bj].x;
          ty[i] = cs[bj].y;
          mode[i] = 3;
        }
      }
    }
    for (let i = 0; i < n; i++)
      if (mode[i] === 0 && best[i] > 0) {
        tx[i] = fx[i];
        ty[i] = fy[i];
        mode[i] = 2;
      }

    // movement (targets and distances above all use the positions from before this move)
    const lungeD = new Float64Array(n);
    for (let i = 0; i < n; i++) if (mode[i] === 2 && preyOf[i] >= 0) lungeD[i] = dist(cs[preyOf[i]].x - cs[i].x, cs[preyOf[i]].y - cs[i].y);
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      const wander = mode[i] === 0;
      if (wander) c.head += this.norm(0, 0.25);
      else {
        const want = Math.atan2(ty[i] - c.y, tx[i] - c.x);
        const dh = Math.atan2(Math.sin(want - c.head), Math.cos(want - c.head));
        c.head += clamp(dh, -0.5, 0.5);
      }
      let v = (c.g[1] * (wander ? 0.6 : 1)) / (1 + p.crestDrag * show[i]);
      if (mode[i] === 2 && preyOf[i] >= 0 && lungeD[i] < p.lungeRange) v *= p.lunge; // the sprint is paid for by the same v^3
      let x = c.x + Math.cos(c.head) * v;
      let y = c.y + Math.sin(c.head) * v;
      if (x < 5 || x > W - 5) c.head = Math.PI - c.head;
      if (y < 5 || y > H - 5) c.head = -c.head;
      x = clamp(x, 5, W - 5);
      y = clamp(y, 5, H - 5);
      nx[i] = x;
      ny[i] = y;
      c.energy -= p.base * m[i] + p.move * m[i] * v * v * v + p.see * c.g[2] + p.crestCost * show[i];
      c.age++;
      c.cool--;
      c.mode = mode[i];
    }
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      c.x = nx[i];
      c.y = ny[i];
      c.pi = (c.pi + 1) % (HIST + 1);
      c.px[c.pi] = c.x;
      c.py[c.pi] = c.y;
      if (c.pn <= HIST) c.pn++;
    }

    // eating
    const alive = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      const reach = 6 + 8 * c.g[0];
      const k = this.eatPlants(c.x, c.y, reach);
      if (k) c.energy += k * p.plantEnergy * plantEff(c.g[3]);
      if (c.g[3] > 0.15 && this.corpses.length) {
        const sd = Math.sqrt(c.g[3]);
        for (const b of this.corpses) {
          if (b.meat <= 0 || dist(c.x - b.x, c.y - b.y) >= reach) continue;
          const bite = Math.min(b.meat, 15);
          b.meat -= bite;
          c.energy += bite * sd;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const j = preyOf[i];
      if (j < 0 || mode[i] !== 2 || !alive[i] || !alive[j]) continue;
      const c = cs[i];
      const q = cs[j];
      if (dist(c.x - q.x, c.y - q.y) < 6 + 8 * c.g[0] + 4) {
        alive[j] = 0;
        q.dead = 2;
        q.diedAt = this.t;
        c.energy += Math.sqrt(c.g[3]) * (p.meat * m[j] + 0.5 * Math.max(q.energy, 0));
        this.ev.eaten++;
        this.kills.push({t: this.t, x: q.x, y: q.y});
      }
    }
    for (let i = 0; i < n; i++) cs[i].energy = Math.min(cs[i].energy, p.store * m[i]);

    // children: each gene from one parent or the other, plus a small copying mistake
    const babies: Creature[] = [];
    for (let i = 0; i < n; i++) {
      const j = choice[i];
      if (j < 0 || !alive[i] || !alive[j]) continue;
      const mom = cs[i];
      const dad = cs[j];
      if (dad.cool > 0) continue;
      if (dist(mom.x - dad.x, mom.y - dad.y) > 6 + 8 * mom.g[0] + 6 + 8 * dad.g[0]) continue;
      const ci = p.child * Math.sqrt(m[i]);
      const cj = p.maleChild * Math.sqrt(m[j]);
      if (mom.energy < ci + 5 || dad.energy < cj + 5) continue;
      mom.energy -= ci;
      dad.energy -= cj;
      dad.cool = p.maleCool;
      const g: number[] = [];
      for (let k = 0; k < 6; k++) g.push(clamp((this.r() < 0.5 ? mom.g[k] : dad.g[k]) + this.norm(0, MUT[k] * p.mutation), LO[k], HI[k]));
      const bx = clamp(mom.x + this.norm(0, 6), 5, W - 5);
      const by = clamp(mom.y + this.norm(0, 6), 5, H - 5);
      const baby = this.make(bx, by, this.uni(0, Math.PI * 2), g, ci + cj, mom.line, Math.max(mom.gen, dad.gen) + 1, this.r() < 0.5 ? 0 : 1, mom.uid, dad.uid);
      baby.birth = this.t + 1;
      babies.push(baby);
      mom.kids++;
      dad.kids++;
      this.ev.births++;
    }

    // death: out of energy or old. The body stays where it fell.
    const next: Creature[] = [];
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      if (!alive[i]) continue;
      const starved = c.energy <= 0;
      const old = c.age > p.life * (0.8 + (0.4 * ((c.uid * 2654435761) % 1000)) / 1000);
      if (starved || old) {
        c.dead = starved ? 1 : 3;
        c.diedAt = this.t;
        if (starved) this.ev.starved++;
        else this.ev.old++;
        const full = p.meat * m[i];
        this.corpses.push({x: c.x, y: c.y, meat: full, full, age: 0, uid: c.uid, line: c.line, g: c.g, diedAt: this.t});
      } else next.push(c);
    }
    let w = 0;
    for (const b of this.corpses) {
      b.age++;
      if (b.age < p.corpseLife && b.meat > 0.5) this.corpses[w++] = b;
    }
    this.corpses.length = w;
    for (const b of babies) next.push(b);
    this.cs = next;
    while (this.kills.length && this.kills[0].t < this.t - 60) this.kills.shift();
    this.t++;
    if (this.cs.length === 0 && this.extinctAt === null) this.extinctAt = this.t;
    if (this.t % this.sampleEvery === 0) this.sample();
  }

  // ---------- statistics ----------
  stats(): Sample {
    const cs = this.cs;
    const n = cs.length;
    const s: Sample = {t: this.t, n, hunters: 0, gen: 0, lines: 0, size: 0, speed: 0, sight: 0, diet: 0, crest: 0, taste: 0};
    if (!n) return s;
    const lines = new Set<number>();
    let males = 0;
    let females = 0;
    for (const c of cs) {
      s.gen += c.gen;
      s.size += c.g[0];
      s.speed += c.g[1];
      s.sight += c.g[2];
      s.diet += c.g[3];
      if (c.sex === 1) {
        s.crest += c.g[4];
        males++;
      } else {
        s.taste += c.g[5];
        females++;
      }
      if (c.g[3] > JAWS) s.hunters++;
      lines.add(c.line);
    }
    s.gen /= n;
    s.size /= n;
    s.speed /= n;
    s.sight /= n;
    s.diet /= n;
    s.crest = males ? s.crest / males : 0; // crest: males only (only they show it)
    s.taste = females ? s.taste / females : 0; // taste: females only (only they use it)
    s.lines = lines.size;
    return s;
  }
  private sample() {
    this.history.push(this.stats());
    if (this.history.length > 1500) {
      // keep the chart light on very long runs: halve the resolution
      this.history = this.history.filter((_, i) => i % 2 === 0);
      this.sampleEvery *= 2;
    }
  }
  /** Living members per mother's family, sorted by family number. */
  families(): [number, number][] {
    const m = new Map<number, number>();
    for (const c of this.cs) m.set(c.line, (m.get(c.line) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }
  /** A short fingerprint of the whole state: equal seeds and settings must give equal fingerprints. */
  fingerprint() {
    let h = 2166136261;
    const mixIn = (v: number) => {
      h ^= Math.round(v * 1000) | 0;
      h = Math.imul(h, 16777619);
    };
    mixIn(this.t);
    for (const c of this.cs) {
      mixIn(c.uid);
      mixIn(c.x);
      mixIn(c.y);
      mixIn(c.energy);
      for (const g of c.g) mixIn(g);
    }
    mixIn(this.plantCount);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
