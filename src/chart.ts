// Small live charts drawn on canvas: population over time and one sparkline per gene.
import {COLORS, FONTS} from './brand';
import type {Sample, Sim} from './sim';

/** Sizes the canvas backing store to its CSS box and returns a context scaled to CSS pixels. */
export const fit = (canvas: HTMLCanvasElement) => {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {ctx, w, h};
};

const span = (sim: Sim) => Math.max(4000, sim.t);

const marks = (ctx: CanvasRenderingContext2D, sim: Sim, x: (t: number) => number, y0: number, y1: number, labels: boolean) => {
  for (const m of sim.marks) {
    const color = m.kind === 'jaws' ? COLORS.orangeBright : COLORS.text;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x(m.t), y0);
    ctx.lineTo(x(m.t), y1);
    ctx.stroke();
    ctx.setLineDash([]);
    if (labels) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.font = `700 10px ${FONTS.mono}`;
      ctx.textAlign = x(m.t) > 60 ? 'right' : 'left';
      ctx.fillText(m.kind === 'jaws' ? 'JAWS' : 'METEOR', x(m.t) + (x(m.t) > 60 ? -4 : 4), y0 + 10);
    }
    ctx.globalAlpha = 1;
  }
};

const line = (ctx: CanvasRenderingContext2D, hist: Sample[], key: keyof Sample, x: (t: number) => number, y: (v: number) => number, color: string, width: number) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  hist.forEach((s, i) => (i ? ctx.lineTo(x(s.t), y(s[key])) : ctx.moveTo(x(s.t), y(s[key]))));
  ctx.stroke();
  const last = hist[hist.length - 1];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x(last.t), y(last[key]), width + 1, 0, Math.PI * 2);
  ctx.fill();
};

export const drawPopulation = (canvas: HTMLCanvasElement, sim: Sim) => {
  const {ctx, w, h} = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  const hist = sim.history;
  const padL = 34;
  const padR = 10;
  const top = 8;
  const bottom = h - 18;
  const T = span(sim);
  const x = (t: number) => padL + (t / T) * (w - padL - padR);
  let max = 50;
  for (const s of hist) max = Math.max(max, s.n);
  max = Math.ceil(max / 50) * 50;
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  ctx.font = `400 10px ${FONTS.mono}`;
  ctx.fillStyle = COLORS.textFaint;
  ctx.strokeStyle = 'rgba(143,179,194,0.14)';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (const v of [0, max / 2, max]) {
    ctx.beginPath();
    ctx.moveTo(padL, y(v));
    ctx.lineTo(w - padR, y(v));
    ctx.stroke();
    ctx.fillText(String(Math.round(v)), padL - 6, y(v) + 3);
  }
  ctx.textAlign = 'left';
  ctx.fillText('GEN 0', padL, h - 4);
  ctx.textAlign = 'right';
  ctx.fillText(`GEN ${Math.round(hist[hist.length - 1].gen)}`, w - padR, h - 4);
  marks(ctx, sim, x, top, bottom, true);
  line(ctx, hist, 'hunters', x, y, COLORS.orangeBright, 1.5);
  line(ctx, hist, 'n', x, y, COLORS.tealBright, 2);
};

export const GENE_ROWS: {key: keyof Sample; label: string; color: string; digits: number}[] = [
  {key: 'size', label: 'SIZE', color: COLORS.tealBright, digits: 2},
  {key: 'speed', label: 'SPEED', color: COLORS.tealBright, digits: 2},
  {key: 'sight', label: 'SIGHT', color: COLORS.tealBright, digits: 0},
  {key: 'diet', label: 'DIET', color: COLORS.orangeBright, digits: 2},
  {key: 'crest', label: 'CREST', color: COLORS.gold, digits: 2},
  {key: 'taste', label: 'TASTE', color: COLORS.gold, digits: 2},
];

/** Six rows: label, sparkline on its own scale (from the lowest to the highest value so far), current average. */
export const drawGenes = (canvas: HTMLCanvasElement, sim: Sim) => {
  const {ctx, w, h} = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  const hist = sim.history;
  const rowH = h / GENE_ROWS.length;
  const padL = 58;
  const padR = 54;
  const T = span(sim);
  const x = (t: number) => padL + (t / T) * (w - padL - padR);
  GENE_ROWS.forEach((row, i) => {
    const y0 = i * rowH + 6;
    const y1 = (i + 1) * rowH - 6;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of hist) {
      lo = Math.min(lo, s[row.key]);
      hi = Math.max(hi, s[row.key]);
    }
    if (hi - lo < 1e-6) hi = lo + 1;
    const y = (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
    if (i) {
      ctx.strokeStyle = 'rgba(143,179,194,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, i * rowH);
      ctx.lineTo(w, i * rowH);
      ctx.stroke();
    }
    marks(ctx, sim, x, y0 - 4, y1 + 4, false);
    line(ctx, hist, row.key, x, y, row.color, 1.6);
    const first = hist[0][row.key];
    const now = hist[hist.length - 1][row.key];
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 11px ${FONTS.mono}`;
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(row.label, 0, (y0 + y1) / 2);
    ctx.textAlign = 'right';
    ctx.font = `700 13px ${FONTS.mono}`;
    ctx.fillStyle = row.color;
    ctx.fillText(now.toFixed(row.digits), w, (y0 + y1) / 2 - 6);
    ctx.font = `400 10px ${FONTS.mono}`;
    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText(`from ${first.toFixed(row.digits)}`, w, (y0 + y1) / 2 + 8);
    ctx.textBaseline = 'alphabetic';
  });
};
