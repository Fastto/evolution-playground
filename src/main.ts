import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './style.css';
import {COLORS, VIDEO_TITLE, VIDEO_URL} from './brand';
import {drawGenes, drawPopulation, fit} from './chart';
import {Cam, clampCam, drawPortrait, drawWorld, lineColor} from './draw';
import {Creature, DEFAULTS, H, JAWS, Params, Sim, VIDEO_EVENTS, W} from './sim';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const STEPS_PER_SECOND = 30; // at 1x
const SPEEDS = [1, 4, 16, 64];
const DEFAULT_SEED = 4;

// ---------- settings ----------
type Slider = {key: keyof Params; label: string; note: string; min: number; max: number; step: number; fmt: (v: number) => string};
const SLIDERS: Slider[] = [
  {key: 'startPop', label: 'Starting population', note: 'Founders. Applies on reset.', min: 10, max: 400, step: 10, fmt: (v) => String(v)},
  {key: 'plantRate', label: 'Food', note: 'New plants per step.', min: 0.2, max: 4, step: 0.1, fmt: (v) => v.toFixed(1)},
  {key: 'mutation', label: 'Mutation rate', note: 'Size of the copying mistakes. 0 = perfect copies.', min: 0, max: 5, step: 0.1, fmt: (v) => `×${v.toFixed(1)}`},
  {key: 'life', label: 'Lifespan', note: 'Steps until old age.', min: 200, max: 2000, step: 50, fmt: (v) => String(v)},
  {key: 'move', label: 'Cost of speed', note: 'Energy for moving: mass × speed³ × this.', min: 0.001, max: 0.02, step: 0.001, fmt: (v) => v.toFixed(3)},
  {key: 'chooseNoise', label: 'Randomness in her choice', note: 'Low = females pick by crest almost every time.', min: 0, max: 1, step: 0.02, fmt: (v) => v.toFixed(2)},
  {key: 'crestDrag', label: 'Crest drag', note: 'How much a crest slows a male down.', min: 0, max: 0.6, step: 0.01, fmt: (v) => v.toFixed(2)},
  {key: 'crestVis', label: 'Crest catches the eye', note: 'How much farther hunters see a crested male, and how much they prefer him.', min: 0, max: 8, step: 0.25, fmt: (v) => v.toFixed(2)},
  {key: 'lunge', label: 'Hunter sprint', note: 'Speed boost when a hunter is close to its prey.', min: 1, max: 2.5, step: 0.05, fmt: (v) => `×${v.toFixed(2)}`},
];

const hashOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const parseSeed = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) >>> 0 : hashOf(s.trim() || '0'));

const params: Params = {...DEFAULTS};
let seedText = String(DEFAULT_SEED);
let timeline = true;

// the address keeps the seed and every changed setting, so a world can be shared as a link
const readHash = () => {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.has('seed')) seedText = q.get('seed')!.slice(0, 24);
  if (q.get('timeline') === '0') timeline = false;
  for (const s of SLIDERS) {
    const v = Number(q.get(s.key));
    if (q.has(s.key) && Number.isFinite(v)) params[s.key] = Math.max(s.min, Math.min(s.max, v));
  }
};
const writeHash = () => {
  const q = new URLSearchParams();
  q.set('seed', seedText);
  if (!timeline) q.set('timeline', '0');
  for (const s of SLIDERS) if (params[s.key] !== DEFAULTS[s.key]) q.set(s.key, String(params[s.key]));
  history.replaceState(null, '', `#${q.toString()}`);
};
readHash();

// ---------- state ----------
let sim = new Sim(parseSeed(seedText), params);
let playing = true;
let speed = 1;
let acc = 0;
let cam: Cam = {cx: W / 2, cy: H / 2, zoom: 1};
let selected: Creature | null = null;
let follow = false;
let lastGen = 0;
let frameNo = 0;
let dirty = true; // charts and panels need a redraw

const world = $<HTMLCanvasElement>('world');
const worldBox = $('world-box');
const banner = $('banner');

const restart = () => {
  sim = new Sim(parseSeed(seedText), params);
  acc = 0;
  selected = null;
  follow = false;
  lastGen = 0;
  dirty = true;
  writeHash();
  renderInspector();
};

const tick = () => {
  if (timeline) {
    if (sim.t === VIDEO_EVENTS.jaws) sim.setJaws(true);
    if (sim.t === VIDEO_EVENTS.meteor - 50) sim.callMeteor(VIDEO_EVENTS.meteorAt[0], VIDEO_EVENTS.meteorAt[1]);
  }
  sim.step();
};

// ---------- header ----------
const link = $<HTMLAnchorElement>('video-link');
link.href = VIDEO_URL;
link.textContent = VIDEO_TITLE;

const RULES: [string, string][] = [
  ['Luck votes first', 'Watch the family strip. Most colours vanish in the first generations, before any gene has had time to matter.'],
  ['Win alone, lose together', 'The fast eat first, so speed keeps rising. The same food then feeds fewer creatures: the population falls as speed climbs.'],
  ['Being loved beats being useful', 'A crest only costs. It grows anyway, because females choose by it.'],
  ['Free food finds an eater', 'Nobody added scavengers. Diet drifts up on its own, because a dead body is free meat.'],
  ['More to lose, run faster', 'Once jaws work, the hunted change faster than the hunters.'],
  ['Taste is a trap', 'Crests get males eaten, and taste for crests keeps climbing anyway.'],
  ['Run just to stay in place', 'Prey outgrow the hunters, hunters grow, prey speed up. Nobody ends up any safer.'],
  ["Surviving isn't proof", "One mother's colour ends up covering the world. Try another seed: it is a different mother every time."],
];
$('rules').innerHTML = RULES.map(([a, b]) => `<li><b>${a}.</b> ${b}</li>`).join('');

// ---------- transport ----------
const playBtn = $<HTMLButtonElement>('play');
const ICON_PAUSE = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="1" width="4.500" height="14" rx="1" fill="currentColor"/><rect x="9.500" y="1" width="4.500" height="14" rx="1" fill="currentColor"/></svg>';
const ICON_PLAY = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.500v13a.6.6 0 0 0 .9.500l11-6.500a.6.6 0 0 0 0-1l-11-6.500a.6.6 0 0 0-.9.500z" fill="currentColor"/></svg>';
const renderPlay = () => {
  playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
};
playBtn.onclick = () => {
  playing = !playing;
  renderPlay();
};
renderPlay();

const speedsBox = $('speeds');
const renderSpeeds = () => {
  speedsBox.innerHTML = '';
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${s}x`;
    b.setAttribute('aria-pressed', String(s === speed));
    b.onclick = () => {
      speed = s;
      renderSpeeds();
    };
    speedsBox.append(b);
  }
};
renderSpeeds();

const seedInput = $<HTMLInputElement>('seed');
seedInput.value = seedText;
const applySeed = () => {
  seedText = seedInput.value.trim().slice(0, 24) || String(DEFAULT_SEED);
  seedInput.value = seedText;
  restart();
};
seedInput.onkeydown = (e) => {
  if (e.key === 'Enter') {
    applySeed();
    seedInput.blur();
  }
};
$('reset').onclick = applySeed;
$('random').onclick = () => {
  seedInput.value = String(Math.floor(Math.random() * 1e6));
  applySeed();
};

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    playBtn.click();
  }
});

// ---------- events ----------
const timelineBox = $<HTMLInputElement>('timeline');
timelineBox.checked = timeline;
timelineBox.onchange = () => {
  timeline = timelineBox.checked;
  writeHash();
};
const jawsBtn = $<HTMLButtonElement>('jaws');
const renderJaws = () => {
  jawsBtn.textContent = sim.jaws ? 'Jaws: working' : 'Jaws: off';
  jawsBtn.classList.toggle('on', sim.jaws);
};
jawsBtn.onclick = () => {
  sim.setJaws(!sim.jaws);
  renderJaws();
};
$('meteor').onclick = () => {
  if (sim.meteor && sim.meteor.t > sim.t) return; // one is already on its way
  sim.callMeteor(cam.cx, cam.cy);
};

// ---------- sliders ----------
const slidersBox = $('sliders');
const renderSliders = () => {
  slidersBox.innerHTML = '';
  for (const s of SLIDERS) {
    const label = document.createElement('label');
    label.className = 'slider';
    label.innerHTML = `<span class="name"><span>${s.label}</span><output></output></span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}"><small>${s.note}</small>`;
    const input = label.querySelector('input')!;
    const out = label.querySelector('output')!;
    const show = () => {
      out.textContent = s.fmt(params[s.key]);
      out.classList.toggle('changed', params[s.key] !== DEFAULTS[s.key]);
    };
    input.value = String(params[s.key]);
    show();
    input.oninput = () => {
      params[s.key] = Number(input.value); // the running world reads the same object: it changes at once
      show();
      writeHash();
    };
    slidersBox.append(label);
  }
};
renderSliders();
$('defaults').onclick = () => {
  Object.assign(params, DEFAULTS);
  renderSliders();
  writeHash();
};

// ---------- camera, selection ----------
const setZoom = (zoom: number, ax = cam.cx, ay = cam.cy) => {
  const z = Math.max(1, Math.min(8, zoom));
  // keep the world point (ax, ay) under the same screen point
  const k = cam.zoom / z;
  cam = clampCam({zoom: z, cx: ax + (cam.cx - ax) * k, cy: ay + (cam.cy - ay) * k});
  worldBox.classList.toggle('zoomed', cam.zoom > 1);
};
const toWorld = (e: {clientX: number; clientY: number}): [number, number] => {
  const r = world.getBoundingClientRect();
  const z = (r.width / W) * cam.zoom;
  return [cam.cx + (e.clientX - r.left - r.width / 2) / z, cam.cy + (e.clientY - r.top - r.height / 2) / z];
};
$('zoom-in').onclick = () => setZoom(cam.zoom * 1.6, selected && !selected.dead ? selected.x : cam.cx, selected && !selected.dead ? selected.y : cam.cy);
$('zoom-out').onclick = () => setZoom(cam.zoom / 1.6);
world.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain scrolling moves the page; pinch or Ctrl/Cmd + wheel zooms
    e.preventDefault();
    const [wx, wy] = toWorld(e);
    setZoom(cam.zoom * Math.exp(-e.deltaY * 0.0015), wx, wy);
  },
  {passive: false},
);
let drag: {x: number; y: number; cx: number; cy: number; moved: boolean} | null = null;
world.addEventListener('pointerdown', (e) => {
  drag = {x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy, moved: false};
  if (cam.zoom > 1) world.setPointerCapture(e.pointerId);
});
world.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 6) drag.moved = true;
  if (drag.moved && cam.zoom > 1) {
    const z = (world.getBoundingClientRect().width / W) * cam.zoom;
    cam = clampCam({zoom: cam.zoom, cx: drag.cx - dx / z, cy: drag.cy - dy / z});
    follow = false;
  }
});
world.addEventListener('pointercancel', () => (drag = null));
world.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  if (!d || d.moved) return;
  const [wx, wy] = toWorld(e);
  const z = (world.getBoundingClientRect().width / W) * cam.zoom;
  let best = 26 / z; // a finger-sized target on screen
  let hit: Creature | null = null;
  for (const c of sim.cs) {
    const dist = Math.hypot(c.x - wx, c.y - wy);
    if (dist < best) {
      best = dist;
      hit = c;
    }
  }
  selected = hit;
  follow = !!hit;
  renderInspector();
});
$('unselect').onclick = () => {
  selected = null;
  renderInspector();
};

// ---------- inspector ----------
const inspector = $('inspector-body');
inspector.className = '';
const GENE_VIEW: {label: string; max: number; color: string; digits: number}[] = [
  {label: 'SIZE', max: 2, color: COLORS.tealBright, digits: 2},
  {label: 'SPEED', max: 6, color: COLORS.tealBright, digits: 2},
  {label: 'SIGHT', max: 200, color: COLORS.tealBright, digits: 0},
  {label: 'DIET', max: 1, color: COLORS.orangeBright, digits: 2},
  {label: 'CREST', max: 2.5, color: COLORS.gold, digits: 2},
  {label: 'TASTE', max: 5, color: COLORS.gold, digits: 2},
];
const CAUSES = ['', 'starved', 'eaten', 'died of old age', 'killed by the meteor'];
let portrait: HTMLCanvasElement | null = null;
let statusEl: HTMLElement | null = null;
const statusOf = (c: Creature) => {
  if (c.dead) return `${CAUSES[c.dead]} at step ${c.diedAt.toLocaleString('en-US')}`;
  const doing = ['wandering', 'fleeing', 'after food', 'after a mate'][c.mode];
  return `age ${c.age} · energy ${Math.max(0, Math.round(c.energy))} · ${doing}`;
};
function renderInspector() {
  $('inspector').hidden = !selected;
  if (!selected) {
    portrait = null;
    statusEl = null;
    return;
  }
  const c = selected;
  const kind = c.g[3] > JAWS ? 'hunter' : c.sex ? 'male' : 'female';
  inspector.innerHTML = `<div class="who"><canvas></canvas><div><div class="id">#${c.uid}</div><div class="muted">${c.sex ? 'Male' : 'Female'}${kind === 'hunter' ? ', hunter' : ''} · generation ${c.gen}</div><div class="muted"><span class="sw" style="background:${lineColor(c.line)}"></span>family ${c.line + 1}${c.mom < 0 ? ' · founder' : ''}</div></div></div><div class="muted" id="who-status" style="margin-top:8px"></div><div class="genes-list">${GENE_VIEW.map((g, i) => {
    const off = (i === 4 && c.sex === 0) || (i === 5 && c.sex === 1);
    return `<div class="gene${off ? ' off' : ''}" title="${off ? (i === 4 ? 'Carried, not shown: only males grow a crest' : 'Carried, not used: only females choose') : ''}"><span>${g.label}</span><span class="bar"><i style="width:${Math.min(100, (c.g[i] / g.max) * 100).toFixed(1)}%;background:${g.color}"></i></span><span class="val">${c.g[i].toFixed(g.digits)}</span></div>`;
  }).join('')}</div>`;
  portrait = inspector.querySelector('canvas');
  statusEl = inspector.querySelector('#who-status');
  statusEl!.textContent = statusOf(c);
}

// ---------- panels ----------
const statsBox = $('stats');
const STAT_KEYS = ['GENERATION', 'ALIVE', 'HUNTERS', 'FAMILIES', 'STEP'];
statsBox.innerHTML = STAT_KEYS.map((k) => `<div class="stat"><div class="k">${k}</div><div class="v">0</div></div>`).join('');
const statEls = [...statsBox.querySelectorAll<HTMLElement>('.v')];
const famCanvas = $<HTMLCanvasElement>('families');
const famLabel = $('fam-label');
const popChart = $<HTMLCanvasElement>('chart-pop');
const geneChart = $<HTMLCanvasElement>('chart-genes');

const renderPanels = () => {
  const s = sim.stats();
  if (s.n) lastGen = s.gen;
  const vals = [Math.floor(lastGen), s.n, s.hunters, s.lines, sim.t];
  statEls.forEach((el, i) => (el.textContent = vals[i].toLocaleString('en-US')));
  statEls[2].style.color = s.hunters ? COLORS.orangeBright : '';
  famLabel.textContent = `FAMILIES · ${s.lines}`;
  const {ctx, w, h} = fit(famCanvas);
  ctx.clearRect(0, 0, w, h);
  let x = 0;
  for (const [line, count] of sim.families()) {
    const dx = (count / s.n) * w;
    ctx.fillStyle = lineColor(line);
    ctx.fillRect(x, 0, Math.max(0.5, dx - (s.lines < 60 ? 1 : 0)), h);
    x += dx;
  }
  drawPopulation(popChart, sim);
  drawGenes(geneChart, sim);
  renderJaws();
  if (selected && statusEl) statusEl.textContent = statusOf(selected);
  let msg = '';
  if (sim.extinctAt !== null) msg = `Extinct at generation ${Math.floor(lastGen)}. Reset or try a new seed.`;
  else if (sim.meteor && sim.t >= sim.meteor.t && sim.t < sim.dustUntil) msg = 'Meteor: dust in the sky, less food';
  banner.hidden = !msg;
  banner.textContent = msg;
};

// ---------- main loop ----------
let last = performance.now();
const frame = (now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frameNo++;
  if (playing && sim.extinctAt === null) {
    acc += dt * STEPS_PER_SECOND * speed;
    let k = Math.floor(acc);
    acc -= k;
    const t0 = performance.now();
    while (k-- > 0) {
      tick();
      dirty = true;
      if (sim.extinctAt !== null) break;
      if (performance.now() - t0 > 14) {
        acc = 0; // the device cannot keep up at this speed: run as fast as it can
        break;
      }
    }
  }
  if (selected && !selected.dead && follow && cam.zoom > 1) cam = clampCam({zoom: cam.zoom, cx: cam.cx + (selected.x - cam.cx) * 0.12, cy: cam.cy + (selected.y - cam.cy) * 0.12});
  const {ctx, w, h} = fit(world);
  drawWorld(ctx, sim, cam, w, h, speed === 1 && sim.t > 0 ? Math.min(1, acc) : 1, selected);
  if ((dirty && frameNo % 6 === 0) || frameNo === 1) {
    renderPanels();
    dirty = false;
  }
  if (selected && portrait && frameNo % 2 === 0) {
    const p = fit(portrait);
    drawPortrait(p.ctx, selected, p.w, p.h, now / 1000);
  }
  requestAnimationFrame(frame);
};
writeHash();
requestAnimationFrame(frame);

// For the curious, in the browser console: __playground.sim is the live world,
// __playground.advance(1000) runs a thousand steps at once.
Object.assign(window, {
  __playground: {
    get sim() {
      return sim;
    },
    advance(n: number) {
      for (let i = 0; i < n && sim.extinctAt === null; i++) tick();
      dirty = true;
      return sim.fingerprint();
    },
  },
});
window.addEventListener('resize', () => (dirty = true));
// a pasted link with other settings: load them and start that world
window.addEventListener('hashchange', () => {
  Object.assign(params, DEFAULTS);
  seedText = String(DEFAULT_SEED);
  timeline = true;
  readHash();
  seedInput.value = seedText;
  timelineBox.checked = timeline;
  renderSliders();
  restart();
});
document.fonts.ready.then(() => (dirty = true));
