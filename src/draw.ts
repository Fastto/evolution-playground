// Drawing the world on a canvas: the same creatures as in the video.
// Genes on the body: size - bigger circles, speed - longer tail, sight - bigger eyes, diet - a redder head,
// then jaws past 0.5, crest (males only) - a glowing golden fan. Body colour - the mother's family.
import {COLORS} from './brand';
import {Corpse, Creature, H, HIST, JAWS, Sim, W} from './sim';

export type Cam = {cx: number; cy: number; zoom: number};
type Pt = [number, number];
type Circle = [number, number, number];
const BORN = 50; // steps a newborn takes to grow to full size
const OUTLINE = '#06121B';

// A hundred families - a hundred hues, avoiding red/orange/gold (those belong to jaws and crests)
const LINE_COLORS = new Map<number, string>();
export const lineColor = (line: number) => {
  let c = LINE_COLORS.get(line);
  if (!c) {
    const hue = 75 + ((line * 137.508) % 265);
    const light = 52 + ((line * 7) % 3) * 6;
    c = `hsl(${hue.toFixed(1)}, 50%, ${light}%)`;
    LINE_COLORS.set(line, c);
  }
  return c;
};

const PARSED = new Map<string, number[]>();
const parse = (c: string): number[] => {
  const hit = PARSED.get(c);
  if (hit) return hit;
  let v: number[];
  if (c.startsWith('#')) v = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  else if (c.startsWith('hsl')) {
    const [h, s, l] = c.match(/[\d.]+/g)!.map(Number);
    const S = s / 100;
    const L = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = S * Math.min(L, 1 - L);
    const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    v = [f(0) * 255, f(8) * 255, f(4) * 255];
  } else v = c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  PARSED.set(c, v);
  return v;
};
const MIXED = new Map<string, string>();
const mix = (a: string, b: string, k: number) => {
  const key = `${a}|${b}|${k}`;
  let c = MIXED.get(key);
  if (!c) {
    const pa = parse(a);
    const pb = parse(b);
    const m = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * k);
    c = `rgb(${m(0)},${m(1)},${m(2)})`;
    MIXED.set(key, c);
  }
  return c;
};

/** Segment radii from the genes (world units). */
export const radiiOf = (g: number[]) => {
  const R = 5.6 * g[0] + 1.4;
  const tail = Math.max(1, Math.min(6, Math.round((g[1] - 1.5) * 1.35)));
  const r = [R, R * 1.08, R * 0.92];
  for (let k = 1; k <= tail; k++) r.push(R * 0.82 * Math.pow(0.8, k));
  return r;
};

const smooth = (pts: Circle[]) => {
  const out: Circle[] = [];
  for (let s = 0; s < pts.length; s++) {
    out.push(pts[s]);
    if (s < pts.length - 1) out.push([(pts[s][0] + pts[s + 1][0]) / 2, (pts[s][1] + pts[s + 1][1]) / 2, (pts[s][2] + pts[s + 1][2]) / 2]);
  }
  return out;
};

/** Spine: the head between the last two steps (f = 0..1), the body trailing back along the path it swam. */
const bodyOf = (c: Creature, f: number, radii: number[], k: number): {pts: Circle[]; dir: Pt} => {
  const N = HIST + 1;
  const at = (s: number): Pt => {
    const i = (c.pi - s + N * 2) % N;
    return [c.px[i], c.py[i]];
  };
  let [hx, hy] = at(0);
  const trail: Pt[] = [];
  if (c.pn > 1) {
    const [ax, ay] = at(1);
    if (Math.hypot(hx - ax, hy - ay) < 40) {
      hx = ax + (hx - ax) * f;
      hy = ay + (hy - ay) * f;
    }
    trail.push([hx, hy]);
    for (let s = 1; s < c.pn; s++) {
      const q = at(s);
      const last = trail[trail.length - 1];
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 40) break;
      trail.push(q);
    }
  } else trail.push([hx, hy]);
  let dx = Math.cos(c.head);
  let dy = Math.sin(c.head);
  if (trail.length > 2) {
    const q = trail[Math.min(3, trail.length - 1)];
    const L = Math.hypot(hx - q[0], hy - q[1]);
    if (L > 0.5) {
      dx = (hx - q[0]) / L;
      dy = (hy - q[1]) / L;
    }
  }
  const gaps: number[] = [];
  for (let s = 1; s < radii.length; s++) gaps.push(0.55 * (radii[s - 1] + radii[s]) * k);
  const pts: Circle[] = [[hx, hy, radii[0] * k]];
  let seg = 1;
  let need = gaps[0];
  let px = hx;
  let py = hy;
  for (let s = 1; s < trail.length && seg < radii.length; s++) {
    const [qx, qy] = trail[s];
    let d = Math.hypot(qx - px, qy - py);
    while (d >= need && seg < radii.length) {
      const u = need / d;
      px += (qx - px) * u;
      py += (qy - py) * u;
      pts.push([px, py, radii[seg] * k]);
      seg++;
      need = gaps[seg - 1] ?? 0;
      d = Math.hypot(qx - px, qy - py);
    }
    need -= d;
    px = qx;
    py = qy;
  }
  // not enough history yet (a newborn): extend straight back
  while (seg < radii.length) {
    const [lx, ly] = pts[pts.length - 1];
    pts.push([lx - dx * gaps[seg - 1], ly - dy * gaps[seg - 1], radii[seg] * k]);
    seg++;
  }
  return {pts: smooth(pts), dir: [dx, dy]};
};

/** A pose without a path (bodies, portraits): along `angle`, with a slight wave. */
export const posedBody = (g: number[], x: number, y: number, angle: number, scale: number, tt: number, phase: number) => {
  const radii = radiiOf(g).map((r) => r * scale);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const pts: Circle[] = [[x, y, radii[0]]];
  let along = 0;
  for (let i = 1; i < radii.length; i++) {
    along += 0.55 * (radii[i - 1] + radii[i]) * (1 + 0.06 * Math.sin(tt * 5 + phase - i * 0.9));
    const side = Math.sin(tt * 4 + phase - i * 0.8) * along * 0.1;
    pts.push([x - dx * along - dy * side, y - dy * along + dx * side, radii[i]]);
  }
  return {pts: smooth(pts), dir: [dx, dy] as Pt};
};

const ring = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
};

type Look = {fill: string; outline: string; outlineW: number; eyes: boolean; blink?: number; shine?: string; eyeScale?: number};

/** Body as a chain of circles in two passes: outline colour first, then the fill - only the outer contour stays. */
const drawBody = (ctx: CanvasRenderingContext2D, body: Circle[], dir: Pt, look: Look) => {
  ctx.fillStyle = look.outline;
  ctx.beginPath();
  for (const [x, y, r] of body) ring(ctx, x, y, r + look.outlineW);
  ctx.fill();
  ctx.fillStyle = look.fill;
  ctx.beginPath();
  for (const [x, y, r] of body) ring(ctx, x, y, r);
  ctx.fill();
  const [hx, hy, hr] = body[0];
  if (look.shine) {
    ctx.fillStyle = look.shine;
    ctx.beginPath();
    ring(ctx, hx - hr * 0.3, hy - hr * 0.35, hr * 0.32);
    ctx.fill();
  }
  if (!look.eyes || hr < 5) return;
  const [dx, dy] = dir;
  const er = hr * 0.34 * (look.eyeScale ?? 1);
  const open = 1 - (look.blink ?? 0);
  for (const s of [-1, 1]) {
    const ex = hx + dx * hr * 0.35 - dy * s * hr * 0.42;
    const ey = hy + dy * hr * 0.35 + dx * s * hr * 0.42;
    ctx.fillStyle = '#F6FAFA';
    ctx.beginPath();
    ctx.ellipse(ex, ey, er, er * Math.max(0.08, open), Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.fill();
    if (open > 0.3) {
      ctx.fillStyle = '#0B1620';
      ctx.beginPath();
      ring(ctx, ex + dx * er * 0.35, ey + dy * er * 0.35, er * 0.55);
      ctx.fill();
    }
  }
};

const blinkAt = (t: number, phase: number) => {
  const p = (t * 0.27 + phase) % 1;
  return p < 0.04 ? Math.sin((p / 0.04) * Math.PI) : 0;
};

/** Crest: a golden fan of spikes from the neck backwards; length and count grow with the gene. */
const drawCrest = (ctx: CanvasRenderingContext2D, pts: Circle[], dir: Pt, crest: number, glow: number, phase: number, tt: number) => {
  if (crest < 0.04) return;
  const [nx0, ny0, r0] = pts[Math.min(2, pts.length - 1)];
  const back = Math.atan2(-dir[1], -dir[0]);
  const spikes = 3 + Math.round(Math.min(crest, 2.5) * 3);
  const len = r0 * (1.2 + crest * 2.6);
  const spread = 0.42 + Math.min(crest, 2) * 0.22;
  const a0 = ctx.globalAlpha;
  const gr = len * 1.25;
  const cx = nx0 + Math.cos(back) * len * 0.45;
  const cy = ny0 + Math.sin(back) * len * 0.45;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
  g.addColorStop(0, `rgba(255,210,122,${Math.min(0.55, (0.12 + crest * 0.22) * glow)})`);
  g.addColorStop(1, 'rgba(255,210,122,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, gr, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = a0 * Math.min(1, 0.55 + crest * 0.5);
  ctx.fillStyle = COLORS.gold;
  const sway = Math.sin(tt * 3.1 + phase) * 0.08;
  const w = r0 * 0.38;
  ctx.beginPath();
  for (let s = 0; s < spikes; s++) {
    const u = spikes === 1 ? 0 : s / (spikes - 1) - 0.5;
    const a = back + u * 2 * spread + sway;
    const l = len * (1 - Math.abs(u) * 0.55);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    ctx.moveTo(nx0 - uy * w, ny0 + ux * w);
    ctx.lineTo(nx0 + ux * l, ny0 + uy * l);
    ctx.lineTo(nx0 + uy * w, ny0 - ux * w);
    ctx.closePath();
    ctx.moveTo(nx0 + ux * l + w * 0.55, ny0 + uy * l);
    ctx.arc(nx0 + ux * l, ny0 + uy * l, w * 0.55, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalAlpha = a0;
};

/** Jaws: two orange mandibles in front of the head. */
const drawJaws = (ctx: CanvasRenderingContext2D, head: Circle, dir: Pt, open: number) => {
  const [hx, hy, r] = head;
  const [dx, dy] = dir;
  const nx = -dy;
  const ny = dx;
  ctx.fillStyle = COLORS.orangeBright;
  for (const s of [-1, 1]) {
    const bx = hx + dx * r * 0.7 + nx * s * r * 0.55;
    const by = hy + dy * r * 0.7 + ny * s * r * 0.55;
    const tipX = bx + dx * r - nx * s * r * (0.25 - open * 0.35);
    const tipY = by + dy * r - ny * s * r * (0.25 - open * 0.35);
    ctx.beginPath();
    ctx.moveTo(bx - nx * s * r * 0.22, by - ny * s * r * 0.22);
    ctx.quadraticCurveTo(bx + dx * r * 0.9 + nx * s * r * 0.35, by + dy * r * 0.9 + ny * s * r * 0.35, tipX, tipY);
    ctx.lineTo(bx + nx * s * r * 0.25, by + ny * s * r * 0.25);
    ctx.closePath();
    ctx.fill();
  }
};

const dress = (ctx: CanvasRenderingContext2D, b: {pts: Circle[]; dir: Pt}, g: number[], sex: number, color: string, tt: number, phase: number, alpha: number, outlineW: number) => {
  const diet = g[3];
  ctx.globalAlpha = alpha;
  if (sex === 1) drawCrest(ctx, b.pts, b.dir, g[4], 1, phase * 6.28, tt);
  const fill = diet > JAWS ? mix(color, COLORS.orange, 0.82) : color;
  drawBody(ctx, b.pts, b.dir, {fill, outline: OUTLINE, outlineW, eyes: true, eyeScale: 0.85 + (g[2] - 80) / 90, blink: blinkAt(tt, phase), shine: 'rgba(255,255,255,0.18)'});
  // a head that eats meat turns red before it grows jaws
  if (diet > 0.12 && diet <= JAWS) {
    const [hx, hy, hr] = b.pts[0];
    ctx.fillStyle = COLORS.orange;
    ctx.globalAlpha = alpha * Math.min(0.55, (diet - 0.12) * 1.3);
    ctx.beginPath();
    ctx.arc(hx + b.dir[0] * hr * 0.55, hy + b.dir[1] * hr * 0.55, hr * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  if (diet > JAWS) drawJaws(ctx, b.pts[0], b.dir, 0.5 + 0.5 * Math.sin(tt * 9 + phase * 6));
};

const drawOne = (ctx: CanvasRenderingContext2D, c: Creature, t: number, f: number, k: number, selected: boolean) => {
  const age = t - c.birth;
  const grow = c.mom >= 0 && age < BORN ? 0.4 + 0.6 * Math.max(0, age / BORN) : 1;
  const b = bodyOf(c, f, radiiOf(c.g), k * grow);
  const tt = t / 30;
  const phase = (c.uid * 0.618) % 1;
  dress(ctx, b, c.g, c.sex, lineColor(c.line), tt, phase, 1, 0.9);
  if (grow < 1 && age >= 0) {
    // a newborn: a ring flashes around it
    const u = age / BORN;
    const [hx, hy, hr] = b.pts[0];
    ctx.globalAlpha = (1 - u) * 0.9;
    ctx.strokeStyle = COLORS.tealBright;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(hx, hy, hr * (1.5 + u * 4), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (selected) {
    const [hx, hy, hr] = b.pts[2] ?? b.pts[0];
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(hx, hy, hr * 3.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

const drawCorpse = (ctx: CanvasRenderingContext2D, b: Corpse, kB: number) => {
  // The body stays where the creature died: its family colour, dimmed, no eyes, a red outline; it shrinks as it is eaten.
  const left = Math.max(0, Math.min(1, b.meat / b.full));
  const a = Math.min(1, b.age / 8) * (b.age > 440 ? Math.max(0, (500 - b.age) / 60) : 1);
  if (a <= 0.01) return;
  const angle = (b.uid * 2.399) % (Math.PI * 2);
  const body = posedBody(b.g, b.x, b.y, angle, 0.7 * kB * (0.55 + 0.45 * Math.sqrt(left)), 0, b.uid * 0.7);
  const base = lineColor(b.line);
  const fill = mix(mix(b.g[3] > JAWS ? mix(base, COLORS.orange, 0.82) : base, '#14232C', 0.35), '#000000', 0.5);
  ctx.globalAlpha = a * 0.92;
  drawBody(ctx, body.pts, body.dir, {fill, outline: COLORS.orangeBright, outlineW: 1.3, eyes: false});
  ctx.globalAlpha = 1;
};

/** Dust in the sky after a meteor: darkening 0..1. */
const dustAt = (dt: number) => (dt < 0 ? 0 : dt < 30 ? (dt / 30) * 0.55 : 0.55 * Math.max(0, 1 - (dt - 30) / 700));

/**
 * The whole world through a camera. `vw` x `vh` is the canvas size in CSS pixels, `f` is how far we are
 * between the previous step and the current one (0..1) so that movement stays smooth at 1x.
 */
export const drawWorld = (ctx: CanvasRenderingContext2D, sim: Sim, cam: Cam, vw: number, vh: number, f: number, selected: Creature | null) => {
  const z = (vw / W) * cam.zoom;
  const t = sim.t - 1 + f;
  ctx.save();
  ctx.fillStyle = COLORS.bgDeep;
  ctx.fillRect(0, 0, vw, vh);
  ctx.translate(vw / 2 - cam.cx * z, vh / 2 - cam.cy * z);
  ctx.scale(z, z);
  const g = ctx.createRadialGradient(W / 2, H * 0.42, 50, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, COLORS.bg);
  g.addColorStop(1, COLORS.bgDeep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,190,210,0.07)';
  for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);

  const met = sim.meteor;
  const mdt = met ? t - met.t : -1e9;
  if (met && mdt >= 0 && mdt < 1500) {
    // the scorched circle, slowly cooling
    ctx.fillStyle = `rgba(110,42,23,${0.6 * (1 - mdt / 1500)})`;
    ctx.beginPath();
    ctx.arc(met.x, met.y, met.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // bodies are drawn larger on wide views (looks only; the model is unchanged), true size up close
  const k = Math.max(1, Math.min(1.7, 1.7 - 0.35 * (cam.zoom - 1)));
  for (const b of sim.corpses) drawCorpse(ctx, b, k);

  ctx.fillStyle = 'rgba(63,212,230,0.18)';
  ctx.beginPath();
  sim.eachPlant((x, y) => ring(ctx, x, y, 4.5));
  ctx.fill();
  ctx.fillStyle = COLORS.tealBright;
  ctx.beginPath();
  sim.eachPlant((x, y) => ring(ctx, x, y, 2.1));
  ctx.fill();

  // females first, then males, so that crests are not covered by neighbours
  for (const c of sim.cs) if (c.sex === 0) drawOne(ctx, c, t, f, k, c === selected);
  for (const c of sim.cs) if (c.sex === 1) drawOne(ctx, c, t, f, k, c === selected);

  for (const kill of sim.kills) {
    const u = (t - kill.t) / 45;
    if (u < 0 || u > 1) continue;
    ctx.strokeStyle = COLORS.orangeBright;
    ctx.globalAlpha = (1 - u) * 0.9;
    ctx.lineWidth = 2 * (1 - u) + 0.5;
    ctx.beginPath();
    ctx.arc(kill.x, kill.y, 6 + u * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (met) {
    if (mdt > -50 && mdt < 0) {
      // the streak in the sky: it comes in from the upper left
      const u = (mdt + 50) / 50;
      const hx = met.x - (1 - u) * 1170;
      const hy = met.y - (1 - u) * 750;
      const lg = ctx.createLinearGradient(hx - 330, hy - 215, hx, hy);
      lg.addColorStop(0, 'rgba(255,210,122,0)');
      lg.addColorStop(1, 'rgba(255,240,220,0.95)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx - 330, hy - 215);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = '#FFF4E0';
      ctx.beginPath();
      ctx.arc(hx, hy, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    if (mdt >= 0 && mdt < 40) {
      const u = mdt / 40;
      ctx.strokeStyle = `rgba(255,240,220,${1 - u})`;
      ctx.lineWidth = 25 * (1 - u) + 3;
      ctx.beginPath();
      ctx.arc(met.x, met.y, met.r * Math.sqrt(u), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (met) {
    const dim = dustAt(mdt);
    if (dim > 0) {
      ctx.fillStyle = `rgba(0,10,18,${dim})`;
      ctx.fillRect(0, 0, vw, vh);
    }
    if (mdt >= 0 && mdt < 25) {
      ctx.fillStyle = `rgba(255,246,230,${Math.pow(1 - mdt / 25, 2)})`;
      ctx.fillRect(0, 0, vw, vh);
    }
  }
};

/** A portrait for the inspector card: the creature posed, facing right. */
export const drawPortrait = (ctx: CanvasRenderingContext2D, c: Creature, w: number, h: number, tt: number) => {
  ctx.clearRect(0, 0, w, h);
  const radii = radiiOf(c.g);
  let len = radii[0];
  for (let i = 1; i < radii.length; i++) len += 0.55 * (radii[i - 1] + radii[i]);
  len += radii[radii.length - 1];
  const crest = c.sex === 1 ? radii[2] * (1.2 + c.g[4] * 2.6) : 0;
  const scale = Math.min((w * 0.8) / len, (h * 0.42) / Math.max(radii[1], crest * 0.75));
  const b = posedBody(c.g, w / 2 + (len * scale) / 2 - radii[0] * scale, h / 2, 0, scale, tt, c.uid);
  dress(ctx, b, c.g, c.sex, lineColor(c.line), tt, (c.uid * 0.618) % 1, c.dead ? 0.45 : 1, Math.max(1, scale * 0.9));
  ctx.globalAlpha = 1;
};

export const clampCam = (c: Cam): Cam => {
  const hw = W / 2 / c.zoom;
  const hh = H / 2 / c.zoom;
  return {zoom: c.zoom, cx: Math.max(hw, Math.min(W - hw, c.cx)), cy: Math.max(hh, Math.min(H - hh, c.cy))};
};
