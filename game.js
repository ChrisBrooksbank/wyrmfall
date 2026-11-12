/* WYRMFALL — a neon arcade shooter. No dependencies, no build step. */
(() => {
'use strict';

// ───────────────────────────── Tunables ─────────────────────────────
const CELL = 24, COLS = 30, ROWS = 34, HUD = 52;
const W = COLS * CELL, FH = ROWS * CELL, H = HUD + FH;
const ZONE = 7, ZONE_TOP = ROWS - ZONE;          // rows the player may roam
const BULLET_SPEED = 1500;                        // px/s — one shot on screen at a time
const NOVA_MAX = 28;                              // kills to charge the nova
const EXTRA_LIFE = 12000;
const START_LIVES = 2;                            // spare ships
const TAU = Math.PI * 2;
const FONT = "'Bahnschrift','DIN Alternate','Avenir Next Condensed','Segoe UI',system-ui,sans-serif";

const PALS = [
  { wyrm: '#3dffb4', head: '#fff36b', crys: '#b06bff', accent: '#35d6ff', bg1: '#070418', bg2: '#170b40' },
  { wyrm: '#ff5fa2', head: '#ffd35c', crys: '#35e0ff', accent: '#9dff5c', bg1: '#04101c', bg2: '#06303f' },
  { wyrm: '#ffb13d', head: '#ff4d6d', crys: '#4dffa6', accent: '#ff7bf2', bg1: '#120414', bg2: '#380a30' },
  { wyrm: '#6aa8ff', head: '#ffffff', crys: '#ff8a3d', accent: '#fff36b', bg1: '#030a1a', bg2: '#0c2050' },
  { wyrm: '#d96bff', head: '#6bffea', crys: '#ffe14d', accent: '#ff5f7a', bg1: '#0c0318', bg2: '#2a0b4a' },
];

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = (h, f) => { const [r, g, b] = rgb(h); return `rgb(${r * f | 0},${g * f | 0},${b * f | 0})`; };
const tint = (h, f) => { const [r, g, b] = rgb(h); return `rgb(${r + (255 - r) * f | 0},${g + (255 - g) * f | 0},${b + (255 - b) * f | 0})`; };
const alpha = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };

// ───────────────────────────── Audio (pure synthesis) ─────────────────────────────
const sfx = (() => {
  let ac = null, master = null, noiseBuf = null, muted = false;
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function env(g, t, dur, vol) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(type, f0, f1, dur, vol = 0.2, delay = 0) {
    if (!ac) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, dur, vol);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(f0, f1, dur, vol = 0.3, q = 1, delay = 0) {
    if (!ac) return;
    const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    env(g, t, dur, vol);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.03);
  }
  const arp = (notes, step, type = 'square', vol = 0.13, dur = 0.12) =>
    notes.forEach((n, i) => tone(type, n, n, dur, vol, i * step));
  return {
    init,
    get muted() { return muted; },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; },
    shoot() { tone('square', 1500, 260, 0.085, 0.1); },
    tick() { tone('triangle', 980, 520, 0.04, 0.13); },
    crack() { noise(3200, 900, 0.07, 0.16, 2); tone('triangle', 520, 300, 0.05, 0.08); },
    pop(head) {
      tone('square', head ? 560 : 360, head ? 80 : 110, head ? 0.22 : 0.12, 0.15);
      noise(2000, 300, head ? 0.22 : 0.1, 0.2, 0.9);
    },
    beat(i, danger) { tone('triangle', (i ? 66 : 52) * (1 + danger * 0.6), 38, 0.1, 0.36); },
    bloom(i) { tone('sine', i ? 520 : 415, i ? 500 : 400, 0.16, 0.07); },
    bloomPop() { arp([880, 660, 440], 0.045, 'triangle', 0.14, 0.1); noise(2500, 700, 0.15, 0.15, 1.5); },
    dartAim() { tone('square', 1040, 1040, 0.05, 0.07); },
    dartDash() { tone('sawtooth', 240, 1300, 0.38, 0.13); },
    comet() { tone('sine', 2100, 320, 1.3, 0.09); },
    moth() { tone('sine', [1319, 1568, 1760, 2093, 2349][randi(0, 4)], 2000, 0.09, 0.05); },
    boom() { noise(900, 60, 0.5, 0.5, 0.6); tone('sine', 140, 30, 0.45, 0.4); },
    nova() { noise(400, 5000, 0.5, 0.4, 0.7); tone('sawtooth', 80, 900, 0.5, 0.2); tone('sine', 200, 40, 0.7, 0.4, 0.1); },
    novaReady() { arp([523, 784, 1047], 0.06, 'triangle', 0.12); },
    die() {
      noise(2500, 80, 1.1, 0.55, 0.5); tone('sawtooth', 420, 30, 1.0, 0.25);
      for (let i = 0; i < 6; i++) tone('square', 700 - i * 90, 200 - i * 20, 0.12, 0.1, i * 0.09);
    },
    life() { arp([523, 659, 784, 1047, 1319], 0.07, 'square', 0.14, 0.14); },
    clear() { arp([392, 523, 659, 784, 1047], 0.075, 'triangle', 0.18, 0.2); },
    start() { arp([262, 392, 523, 784], 0.08, 'square', 0.13, 0.16); },
    over() { arp([523, 392, 330, 262, 196], 0.16, 'triangle', 0.2, 0.3); },
  };
})();

// ───────────────────────────── Canvas ─────────────────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let scale = 1;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(window.innerWidth / W, window.innerHeight / H) * 0.985;
  canvas.style.width = W * s + 'px';
  canvas.style.height = H * s + 'px';
  canvas.width = Math.round(W * s * dpr);
  canvas.height = Math.round(H * s * dpr);
  scale = canvas.width / W;
}
window.addEventListener('resize', resize);
resize();

// ───────────────────────────── Sprites (glow baked once, blitted forever) ─────────────────────────────
function bake(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d');
  g.scale(2, 2); g.translate(size / 2, size / 2);
  draw(g);
  c._s = size;
  return c;
}
const blit = (s, x, y, k = 1) => ctx.drawImage(s, x - s._s * k / 2, y - s._s * k / 2, s._s * k, s._s * k);
function poly(g, pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }

function orbSprite(color, r) {
  return bake(52, g => {
    g.shadowColor = color; g.shadowBlur = 13;
    const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, color); gr.addColorStop(1, shade(color, 0.3));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, r - 2.6, 0, TAU); g.stroke();
  });
}
function gemSprite(color, s) {
  return bake(46, g => {
    g.scale(s, s);
    g.shadowColor = color; g.shadowBlur = 11;
    const gr = g.createLinearGradient(-9, -11, 9, 11);
    gr.addColorStop(0, tint(color, 0.55)); gr.addColorStop(0.5, color); gr.addColorStop(1, shade(color, 0.3));
    g.fillStyle = gr; poly(g, [[0, -11], [8, -6], [9, 4], [0, 11], [-9, 4], [-8, -6]]); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,.3)'; poly(g, [[0, -11], [8, -6], [0, -2], [-8, -6]]); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)'; poly(g, [[0, -2], [9, 4], [0, 11]]); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 0.8;
    poly(g, [[0, -11], [8, -6], [9, 4], [0, 11], [-9, 4], [-8, -6]]); g.stroke();
    g.beginPath(); g.moveTo(-8, -6); g.lineTo(0, -2); g.lineTo(8, -6); g.moveTo(0, -2); g.lineTo(0, 11); g.stroke();
  });
}
function shipSprite(color) {
  return bake(56, g => {
    g.shadowColor = color; g.shadowBlur = 14;
    const gr = g.createLinearGradient(0, -14, 0, 11);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, color); gr.addColorStop(1, shade(color, 0.35));
    g.fillStyle = gr;
    poly(g, [[0, -14], [4, -3], [12, 10], [4, 6], [0, 9], [-4, 6], [-12, 10], [-4, -3]]); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 0.9;
    poly(g, [[0, -14], [4, -3], [12, 10], [4, 6], [0, 9], [-4, 6], [-12, 10], [-4, -3]]); g.stroke();
    g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 8;
    g.beginPath(); g.arc(0, 1, 2.6, 0, TAU); g.fill();
  });
}
function bgSprite(p) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, p.bg1); gr.addColorStop(1, p.bg2);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // nebulae
  [[W * 0.2, H * 0.25, 330, p.crys], [W * 0.85, H * 0.5, 380, p.accent], [W * 0.4, H * 0.85, 300, p.wyrm]].forEach(([x, y, r, col]) => {
    gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, alpha(col, 0.16)); gr.addColorStop(1, alpha(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  });
  // lattice
  g.strokeStyle = 'rgba(255,255,255,.028)'; g.lineWidth = 1; g.beginPath();
  for (let x = 0; x <= COLS; x++) { g.moveTo(x * CELL + 0.5, HUD); g.lineTo(x * CELL + 0.5, H); }
  for (let y = 0; y <= ROWS; y++) { g.moveTo(0, HUD + y * CELL + 0.5); g.lineTo(W, HUD + y * CELL + 0.5); }
  g.stroke();
  // home zone
  const zy = HUD + ZONE_TOP * CELL;
  gr = g.createLinearGradient(0, zy, 0, H);
  gr.addColorStop(0, alpha(p.accent, 0.1)); gr.addColorStop(0.25, alpha(p.accent, 0.03)); gr.addColorStop(1, alpha(p.accent, 0.07));
  g.fillStyle = gr; g.fillRect(0, zy, W, H - zy);
  g.fillStyle = alpha(p.accent, 0.35); g.fillRect(0, zy, W, 1);
  // vignette
  gr = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  return c;
}

let S = {};
function buildSprites(p) {
  S = {
    link: orbSprite(p.wyrm, 10), head: orbSprite(p.head, 11.5),
    gem: [null, gemSprite(p.crys, 0.6), gemSprite(p.crys, 0.82), gemSprite(p.crys, 1)],
    vgem: gemSprite('#ff5a3d', 1), ship: shipSprite(p.accent), bg: bgSprite(p),
  };
}

// ───────────────────────────── State ─────────────────────────────
const store = {
  get() { try { return +localStorage.getItem('wyrmfall.hi') || 0; } catch { return 0; } },
  set(v) { try { localStorage.setItem('wyrmfall.hi', String(v)); } catch { /* private mode */ } },
};
const G = {
  mode: 'title', time: 0, score: 0, hi: store.get(), lives: START_LIVES, wave: 1, pal: PALS[0],
  grid: new Uint8Array(COLS * ROWS), vol: new Uint8Array(COLS * ROWS),
  chains: [], foes: [], parts: [], pops: [], rings: [], dets: [], bullet: null,
  p: { x: W / 2, y: FH - 20, alive: true, inv: 0, tilt: 0 },
  combo: 0, comboT: 0, nova: 0, shake: 0, flash: 0, fireCd: 0,
  waveT: 0, deadT: 0, overT: 0, beatT: 0, beatI: 0, nextLife: EXTRA_LIFE, banner: null,
  t: { bloom: 6, dart: 10, comet: 8, moth: 18, solo: 5 },
};
const stars = Array.from({ length: 110 }, () => ({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1), ph: rand(0, TAU) }));
const LP = { x: 0, y: 0 };

const idx = (c, r) => r * COLS + c;
const solid = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && G.grid[idx(c, r)] > 0;
const mult = () => 1 + Math.min(7, G.combo >> 2);
function nearPlayer(c, r) {
  const p = G.p;
  return Math.abs((c + 0.5) * CELL - p.x) < CELL + 10 && Math.abs((r + 0.5) * CELL - p.y) < CELL + 10;
}
function setCrystal(c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS || nearPlayer(c, r)) return false;
  G.grid[idx(c, r)] = 3; G.vol[idx(c, r)] = 0;
  return true;
}
function seedCrystals(target) {
  let n = 0;
  for (let i = 0; i < G.grid.length; i++) if (G.grid[i]) n++;
  for (let tries = 0; n < target && tries < 500; tries++) {
    const c = randi(0, COLS - 1), r = randi(2, ROWS - 3);
    if (!G.grid[idx(c, r)] && setCrystal(c, r)) n++;
  }
}

// ───────────────────────────── Juice ─────────────────────────────
function burst(x, y, color, n, speed = 240) {
  if (G.parts.length > 900) return;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(0.15, 1) * speed, life = rand(0.25, 0.7);
    G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: rand(1.5, 3.6), color, line: Math.random() < 0.4 });
  }
}
const ring = (x, y, max, color, life = 0.35) => G.rings.push({ x, y, max, color, life, t: 0 });
const pop = (x, y, text, color) => G.pops.push({ x, y, text, color, life: 0.9 });

function addScore(base, x, y, color) {
  const pts = base * mult();
  G.score += pts;
  if (base >= 10) pop(x, y, pts, color);
  if (G.score > G.hi) G.hi = G.score;
  if (G.score >= G.nextLife) {
    G.nextLife += EXTRA_LIFE; G.lives++;
    sfx.life(); G.banner = { text: 'EXTRA SHIP', t: 1.6 };
  }
}
function bumpCombo() {
  G.combo++; G.comboT = 1.7;
  if (G.nova < NOVA_MAX && ++G.nova === NOVA_MAX) sfx.novaReady();
}

// ───────────────────────────── The wyrm ─────────────────────────────
function spawnChain(len, col, dx, startRow) {
  const links = [];
  for (let i = 0; i < len; i++) links.push({ c: col, r: startRow - i, pc: col, pr: startRow - i - 1 });
  G.chains.push({ links, dx, vd: 1, t: 0, bottomed: false });
}
function linkPos(ch, l) {
  LP.x = (l.pc + (l.c - l.pc) * ch.t + 0.5) * CELL;
  LP.y = (l.pr + (l.r - l.pr) * ch.t + 0.5) * CELL;
  return LP;
}
function stepChain(ch) {
  const L = ch.links;
  for (let i = L.length - 1; i > 0; i--) { const a = L[i], b = L[i - 1]; a.pc = a.c; a.pr = a.r; a.c = b.c; a.r = b.r; }
  const h = L[0];
  h.pc = h.c; h.pr = h.r;
  if (h.r < 0) { h.r++; return; }                       // still pouring in from above
  const nc = h.c + ch.dx;
  if (nc < 0 || nc >= COLS || solid(nc, h.r)) {
    let nr = h.r + ch.vd;
    if (nr >= ROWS) { ch.vd = -1; nr = h.r - 1; ch.bottomed = true; }
    else if (ch.vd < 0 && nr < ZONE_TOP) { ch.vd = 1; nr = h.r + 1; }
    h.r = nr; ch.dx = -ch.dx;
  } else h.c = nc;
}
function killLink(ch, i, leaveCrystal) {
  const l = ch.links[i], head = i === 0, { x, y } = linkPos(ch, l);
  bumpCombo();
  addScore(head ? 100 : 10, x, y, head ? G.pal.head : G.pal.wyrm);
  burst(x, y, head ? G.pal.head : G.pal.wyrm, head ? 24 : 12);
  if (head) ring(x, y, 46, G.pal.head);
  sfx.pop(head);
  G.shake = Math.max(G.shake, head ? 4 : 2);
  if (leaveCrystal) setCrystal(l.c, l.r);
  const tail = ch.links.slice(i + 1);
  ch.links.length = i;
  if (tail.length) {
    const h = tail[0];
    G.chains.push({ links: tail, dx: (h.c - h.pc) || -ch.dx, vd: ch.vd, t: ch.t, bottomed: ch.bottomed });
  }
}
const pruneChains = () => { G.chains = G.chains.filter(c => c.links.length); };
const linkCount = () => G.chains.reduce((n, c) => n + c.links.length, 0);

function spawnWave() {
  const n = G.wave;
  G.pal = PALS[(n - 1) % PALS.length];
  buildSprites(G.pal);
  seedCrystals(42);
  const total = Math.min(10 + n, 20), k = Math.min(1 + ((n - 1) >> 1), 5);
  let left = total;
  for (let i = 0; i < k; i++) {
    const len = i === k - 1 ? left : Math.max(1, Math.round(total / k));
    left -= len;
    if (len > 0) spawnChain(len, randi(3, COLS - 4), Math.random() < 0.5 ? -1 : 1, -1 - i * 4);
  }
  G.banner = { text: 'WAVE ' + n, t: 1.6 };
}

// ───────────────────────────── Other denizens ─────────────────────────────
function spawnFoe(type) {
  const p = G.p, w = G.wave;
  if (type === 'bloom') {
    G.foes.push({ type, x0: rand(90, W - 90), x: 0, y: -20, vy: 62 + w * 4, ph: rand(0, TAU), r: 12, hp: 1, st: 0 });
  } else if (type === 'dart') {
    const side = Math.random() < 0.5 ? -1 : 1;
    G.foes.push({ type, side, x: side < 0 ? -24 : W + 24, y: p.y, r: 10, hp: 1, aim: 1.15, vx: 0, st: 0 });
  } else if (type === 'comet') {
    G.foes.push({ type, x: rand(40, W - 40), y: -20, vx: (Math.random() < 0.5 ? -1 : 1) * rand(90, 170), vy: 300 + w * 12, r: 10, hp: 2, cell: -1 });
    sfx.comet();
  } else if (type === 'moth') {
    const side = Math.random() < 0.5 ? -1 : 1;
    G.foes.push({ type, x: side < 0 ? -24 : W + 24, y0: rand(3, ZONE_TOP - 6) * CELL, y: 0, vx: -side * (140 + w * 6), r: 12, hp: 1, st: 0 });
  }
}
function killFoe(f, viaBlast) {
  if (f.dead) return;
  f.dead = true;
  bumpCombo();
  const col = { bloom: '#ff8df2', dart: '#ff4d6d', comet: '#ffd35c', moth: '#ffffff', shard: '#ff8df2' }[f.type];
  const base = { bloom: 300, dart: f.aim > 0 ? 500 : 900, comet: 200, moth: 1000, shard: 50 }[f.type];
  addScore(base, f.x, f.y, col);
  burst(f.x, f.y, col, f.type === 'shard' ? 8 : 26, 300);
  ring(f.x, f.y, 54, col);
  G.shake = Math.max(G.shake, 5);
  if (f.type === 'bloom') {
    sfx.bloomPop();
    if (!viaBlast) for (const a of [-0.55, 0, 0.55])
      G.foes.push({ type: 'shard', x: f.x, y: f.y, vx: Math.sin(a) * 250, vy: Math.cos(a) * 250, r: 6, hp: 1, rot: 0 });
  } else sfx.pop(true);
}
function damageFoe(f) {
  if (--f.hp <= 0) killFoe(f, false);
  else { burst(f.x, f.y, '#fff', 8); sfx.crack(); f.vy *= 1.25; }
}
function updateFoes(dt) {
  const p = G.p;
  for (const f of G.foes) {
    if (f.type === 'bloom') {
      f.y += f.vy * dt; f.ph += dt * 2.1;
      f.x = clamp(f.x0 + Math.sin(f.ph) * 74, 14, W - 14);
      if ((f.st -= dt) <= 0) { f.st = 0.26; sfx.bloom((f.i = !f.i)); }
      if (f.y > FH + 30) f.dead = true;
    } else if (f.type === 'shard') {
      f.x += f.vx * dt; f.y += f.vy * dt; f.rot += dt * 9;
      if (f.y > FH + 20 || f.x < -20 || f.x > W + 20) f.dead = true;
    } else if (f.type === 'dart') {
      if (f.aim > 0) {
        f.aim -= dt;
        const tx = f.side < 0 ? 16 : W - 16;
        f.x += (tx - f.x) * Math.min(1, dt * 8);
        f.y = clamp(f.y + (p.y - f.y) * Math.min(1, dt * 4.5), ZONE_TOP * CELL + 12, FH - 12);
        if ((f.st -= dt) <= 0) { f.st = 0.13; sfx.dartAim(); }
        if (f.aim <= 0) { f.vx = -f.side * (640 + G.wave * 22); sfx.dartDash(); }
      } else {
        f.x += f.vx * dt;
        const c = Math.floor(f.x / CELL), r = Math.floor(f.y / CELL);
        if (solid(c, r)) { G.grid[idx(c, r)] = 0; G.vol[idx(c, r)] = 0; burst((c + 0.5) * CELL, (r + 0.5) * CELL, G.pal.crys, 6); }
        if (Math.random() < 0.6) G.parts.push({ x: f.x, y: f.y + rand(-3, 3), vx: -f.vx * 0.1, vy: 0, life: 0.3, max: 0.3, size: 3, color: '#ff4d6d', line: false });
        if (f.x < -40 || f.x > W + 40) f.dead = true;
      }
    } else if (f.type === 'comet') {
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.x < 10) { f.x = 10; f.vx = Math.abs(f.vx); }
      if (f.x > W - 10) { f.x = W - 10; f.vx = -Math.abs(f.vx); }
      const c = Math.floor(f.x / CELL), r = Math.floor(f.y / CELL), id = idx(c, r);
      if (id !== f.cell) { f.cell = id; if (r > 2 && r < ROWS - 1 && !solid(c, r) && Math.random() < 0.38) setCrystal(c, r); }
      G.parts.push({ x: f.x + rand(-4, 4), y: f.y, vx: rand(-20, 20), vy: -60, life: 0.4, max: 0.4, size: rand(2, 4), color: '#ffd35c', line: false });
      if (f.y > FH + 20) f.dead = true;
    } else if (f.type === 'moth') {
      f.x += f.vx * dt; f.y = f.y0 + Math.sin(G.time * 3) * 14;
      const c = Math.floor(f.x / CELL), r = Math.floor(f.y / CELL);
      if (solid(c, r) && !G.vol[idx(c, r)]) { G.vol[idx(c, r)] = 1; G.grid[idx(c, r)] = 3; burst((c + 0.5) * CELL, (r + 0.5) * CELL, '#ff5a3d', 8, 120); }
      if ((f.st -= dt) <= 0) { f.st = 0.11; sfx.moth(); }
      if (f.x < -40 || f.x > W + 40) f.dead = true;
    }
    if (!f.dead && p.alive && p.inv <= 0 && Math.hypot(f.x - p.x, f.y - p.y) < f.r + 8) killPlayer();
  }
  G.foes = G.foes.filter(f => !f.dead);
}
function updateSpawns(dt) {
  const t = G.t, w = G.wave, has = type => G.foes.some(f => f.type === type);
  if ((t.bloom -= dt) <= 0) { t.bloom = rand(7, 12) - Math.min(3, w * 0.3); spawnFoe('bloom'); }
  if (w >= 2 && (t.dart -= dt) <= 0) { t.dart = rand(9, 15) - Math.min(4, w * 0.4); if (!has('dart')) spawnFoe('dart'); }
  if ((t.comet -= dt) <= 0) {
    let zoneCrystals = 0;
    for (let i = idx(0, ZONE_TOP); i < G.grid.length; i++) if (G.grid[i]) zoneCrystals++;
    t.comet = zoneCrystals < 5 ? rand(3, 6) : rand(11, 18);
    if (zoneCrystals < 5 || w >= 2) spawnFoe('comet');
  }
  if (w >= 3 && (t.moth -= dt) <= 0) { t.moth = rand(17, 26); if (!has('moth')) spawnFoe('moth'); }
  if (G.chains.some(c => c.bottomed) && (t.solo -= dt) <= 0) {
    t.solo = Math.max(2.5, 6 - w * 0.3);
    if (linkCount() < 24) {
      const left = Math.random() < 0.5, c = left ? 0 : COLS - 1, dx = left ? 1 : -1;
      G.chains.push({ links: [{ c, r: ZONE_TOP, pc: c - dx, pr: ZONE_TOP }], dx, vd: 1, t: 0, bottomed: true });
    }
  }
}

// ───────────────────────────── Combat ─────────────────────────────
function blast(x, y, rad) {
  for (let found = true; found;) {
    found = false;
    outer: for (const ch of G.chains) for (let i = 0; i < ch.links.length; i++) {
      const q = linkPos(ch, ch.links[i]);
      if (q.y > -CELL && (q.x - x) ** 2 + (q.y - y) ** 2 < rad * rad) { killLink(ch, i, false); found = true; break outer; }
    }
    pruneChains();
  }
  for (const f of G.foes.slice()) if (Math.hypot(f.x - x, f.y - y) < rad + f.r) killFoe(f, true);
}
function detonate(c, r) {
  const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
  G.grid[idx(c, r)] = 0; G.vol[idx(c, r)] = 0;
  addScore(25, x, y, '#ff8a5a');
  burst(x, y, '#ff8a5a', 40, 420); burst(x, y, '#fff', 12, 200);
  ring(x, y, 2.6 * CELL, '#ff8a5a', 0.3);
  G.shake = Math.max(G.shake, 9); G.flash = Math.max(G.flash, 0.12);
  sfx.boom();
  for (let rr = r - 2; rr <= r + 2; rr++) for (let cc = c - 2; cc <= c + 2; cc++) {
    if (!solid(cc, rr) || (cc - c) ** 2 + (rr - r) ** 2 > 6) continue;
    if (G.vol[idx(cc, rr)]) G.dets.push({ c: cc, r: rr, t: 0.09 });
    else { G.grid[idx(cc, rr)] = 0; burst((cc + 0.5) * CELL, (rr + 0.5) * CELL, G.pal.crys, 6); }
  }
  blast(x, y, 2.5 * CELL);
}
function hitTest(x, y) {
  for (const f of G.foes) if (!f.dead && Math.abs(f.x - x) < f.r + 3 && Math.abs(f.y - y) < f.r + 5) { damageFoe(f); return true; }
  for (const ch of G.chains) for (let i = 0; i < ch.links.length; i++) {
    const q = linkPos(ch, ch.links[i]);
    if (Math.abs(q.x - x) < 12 && Math.abs(q.y - y) < 12) { killLink(ch, i, true); pruneChains(); return true; }
  }
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  if (solid(c, r)) {
    const i = idx(c, r), cx = (c + 0.5) * CELL, cy = (r + 0.5) * CELL;
    if (G.vol[i]) detonate(c, r);
    else if (--G.grid[i] === 0) { addScore(1, cx, cy); burst(cx, cy, G.pal.crys, 10); sfx.crack(); }
    else { burst(cx, cy + 8, G.pal.crys, 3, 120); sfx.tick(); }
    return true;
  }
  return false;
}
function fireNova() {
  const p = G.p;
  if (G.mode !== 'play' || !p.alive || G.nova < NOVA_MAX) return;
  G.nova = 0;
  ring(p.x, p.y, 280, '#ffffff', 0.45); ring(p.x, p.y, 230, G.pal.accent, 0.55);
  burst(p.x, p.y, G.pal.accent, 60, 600);
  G.shake = 14; G.flash = 0.35;
  sfx.nova();
  blast(p.x, p.y, 270);
}
function killPlayer() {
  const p = G.p;
  p.alive = false; G.deadT = 1.7; G.bullet = null; G.combo = 0;
  burst(p.x, p.y, G.pal.accent, 70, 520); burst(p.x, p.y, '#fff', 30, 300);
  ring(p.x, p.y, 120, G.pal.accent, 0.6); ring(p.x, p.y, 70, '#fff', 0.4);
  G.shake = 16; G.flash = 0.3;
  sfx.die();
}
function placePlayer() {
  const p = G.p;
  p.x = W / 2; p.y = FH - 20; p.alive = true; p.inv = 2; p.tilt = 0;
  input.target = null;
  const c0 = Math.floor(p.x / CELL), r0 = Math.floor(p.y / CELL);
  for (let r = r0 - 2; r <= r0 + 1; r++) for (let c = c0 - 2; c <= c0 + 2; c++)
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) { G.grid[idx(c, r)] = 0; G.vol[idx(c, r)] = 0; }
}
function respawn() {
  const n = linkCount();
  G.foes = []; G.chains = []; G.dets = [];
  if (n > 0) spawnChain(n, randi(3, COLS - 4), Math.random() < 0.5 ? -1 : 1, -1);
  placePlayer();
}
function startGame() {
  sfx.init(); sfx.start();
  Object.assign(G, {
    mode: 'play', score: 0, lives: START_LIVES, wave: 1, chains: [], foes: [], parts: [], pops: [], rings: [], dets: [],
    bullet: null, combo: 0, comboT: 0, nova: 0, waveT: 0, deadT: 0, nextLife: EXTRA_LIFE,
    t: { bloom: 6, dart: 10, comet: 8, moth: 18, solo: 5 },
  });
  G.grid.fill(0); G.vol.fill(0);
  spawnWave();
  placePlayer();
}
function gameOver() {
  G.mode = 'over'; G.overT = 1.2;
  store.set(G.hi);
  sfx.over();
}
function enterTitle() {
  G.mode = 'title'; G.wave = 1; G.chains = []; G.foes = []; G.bullet = null; G.dets = [];
  G.grid.fill(0); G.vol.fill(0);
  G.pal = PALS[0]; buildSprites(G.pal);
  G.p.x = -999; G.p.y = -999;
  seedCrystals(48);
  spawnChain(14, 6, 1, -1); spawnChain(8, 22, -1, -9);
}

// ───────────────────────────── Input ─────────────────────────────
const input = { keys: new Set(), fire: false, target: null, touches: new Map() };
const MOVE_KEYS = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
function anyKeyStart() {
  if (G.mode === 'title' || (G.mode === 'over' && G.overT <= 0)) { startGame(); return true; }
  return false;
}
function togglePause() {
  if (G.mode === 'play') G.mode = 'pause';
  else if (G.mode === 'pause') G.mode = 'play';
}
window.addEventListener('keydown', e => {
  if (e.code in MOVE_KEYS || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  sfx.init();
  input.keys.add(e.code);
  if (e.code === 'KeyM') sfx.toggleMute();
  else if (e.code === 'KeyF') { const d = document; d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen && d.documentElement.requestFullscreen(); }
  else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  else if (e.code === 'Space' || e.code === 'Enter') { if (anyKeyStart()) input.keys.delete(e.code); }
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyX') fireNova();
});
window.addEventListener('keyup', e => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); input.fire = false; if (G.mode === 'play') G.mode = 'pause'; });

function fieldPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H - HUD, k: W / r.width };
}
const clampTarget = t => { t.x = clamp(t.x, 11, W - 11); t.y = clamp(t.y, ZONE_TOP * CELL + 11, FH - 11); return t; };
window.addEventListener('pointerdown', e => {
  sfx.init();
  if (G.mode === 'pause') { G.mode = 'play'; return; }
  if (anyKeyStart()) return;
  if (e.pointerType === 'touch') {
    input.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (input.touches.size >= 2) fireNova(); else input.fire = true;
  } else if (e.button === 2) fireNova();
  else if (e.button === 0) input.fire = true;
});
window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') {
    const t = input.touches.get(e.pointerId);
    if (!t) return;
    const k = fieldPos(e).k * 1.5;
    if (!input.target) input.target = { x: G.p.x, y: G.p.y };
    input.target.x += (e.clientX - t.x) * k; input.target.y += (e.clientY - t.y) * k;
    clampTarget(input.target);
    t.x = e.clientX; t.y = e.clientY;
  } else input.target = clampTarget(fieldPos(e));
});
const pointerEnd = e => {
  if (e.pointerType === 'touch') { input.touches.delete(e.pointerId); if (!input.touches.size) input.fire = false; }
  else if (e.button === 0) input.fire = false;
};
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);
window.addEventListener('contextmenu', e => e.preventDefault());

// ───────────────────────────── Update ─────────────────────────────
function playerBlocked(x, y) {
  const c0 = Math.floor((x - 8) / CELL), c1 = Math.floor((x + 8) / CELL), r0 = Math.floor((y - 8) / CELL), r1 = Math.floor((y + 8) / CELL);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solid(c, r)) return true;
  return false;
}
function movePlayer(dx, dy) {
  const p = G.p, steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
  const free = playerBlocked(p.x, p.y);            // never trap a ship that is already overlapping
  for (let i = 0; i < steps; i++) {
    const nx = clamp(p.x + dx / steps, 11, W - 11);
    if (free || !playerBlocked(nx, p.y)) p.x = nx;
    const ny = clamp(p.y + dy / steps, ZONE_TOP * CELL + 11, FH - 11);
    if (free || !playerBlocked(p.x, ny)) p.y = ny;
  }
}
function updatePlayer(dt) {
  const p = G.p, k = input.keys;
  let dx = 0, dy = 0;
  for (const code in MOVE_KEYS) if (k.has(code)) { dx += MOVE_KEYS[code][0]; dy += MOVE_KEYS[code][1]; }
  if (dx || dy) {
    input.target = null;
    const n = Math.hypot(dx, dy); dx = dx / n * 440 * dt; dy = dy / n * 440 * dt;
  } else if (input.target) {
    const mx = input.target.x - p.x, my = input.target.y - p.y, d = Math.hypot(mx, my), max = 1700 * dt;
    if (d > max) { dx = mx / d * max; dy = my / d * max; } else { dx = mx; dy = my; }
  }
  const ox = p.x;
  movePlayer(dx, dy);
  p.tilt += (clamp((p.x - ox) / dt / 600, -1, 1) - p.tilt) * Math.min(1, dt * 14);
  p.inv -= dt;
  G.fireCd -= dt;
  if ((input.fire || k.has('Space')) && !G.bullet && G.fireCd <= 0) {
    G.bullet = { x: p.x, y: p.y - 12 }; G.fireCd = 0.05;
    sfx.shoot();
  }
  if (Math.random() < 0.7) G.parts.push({ x: p.x + rand(-2, 2), y: p.y + 10, vx: rand(-15, 15), vy: rand(60, 140), life: 0.25, max: 0.25, size: rand(1.5, 3), color: G.pal.accent, line: false });
}
function updateChains(dt) {
  const cps = Math.min(10 + G.wave * 0.9, 20);
  for (const ch of G.chains) {
    ch.t += cps * (ch.links.length === 1 ? 1.25 : 1) * dt;
    while (ch.t >= 1) { ch.t -= 1; stepChain(ch); }
  }
}
function updateFx(dt) {
  for (const q of G.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 2.2 * dt; q.vy *= 1 - 2.2 * dt; q.life -= dt; }
  G.parts = G.parts.filter(q => q.life > 0);
  for (const q of G.pops) { q.y -= 34 * dt; q.life -= dt; }
  G.pops = G.pops.filter(q => q.life > 0);
  for (const q of G.rings) q.t += dt;
  G.rings = G.rings.filter(q => q.t < q.life);
  G.shake = Math.max(0, G.shake - 40 * dt);
  G.flash = Math.max(0, G.flash - dt);
  if (G.banner && (G.banner.t -= dt) <= 0) G.banner = null;
  for (const s of stars) { s.y += s.z * 14 * dt; if (s.y > H) { s.y = 0; s.x = rand(0, W); } }
}
function update(dt) {
  if (G.mode === 'pause') return;
  G.time += dt;
  updateFx(dt);
  if (G.mode === 'title') { updateChains(dt); return; }
  if (G.mode === 'over') { G.overT -= dt; updateChains(dt); return; }
  const p = G.p;
  if (!p.alive) {                                   // the world holds its breath
    if ((G.deadT -= dt) <= 0) { if (--G.lives < 0) { G.lives = 0; gameOver(); } else respawn(); }
    return;
  }
  if (G.waveT > 0 && (G.waveT -= dt) <= 0) { G.wave++; spawnWave(); }
  if (G.comboT > 0 && (G.comboT -= dt) <= 0) G.combo = 0;

  updatePlayer(dt);
  updateChains(dt);
  updateFoes(dt);
  if (G.chains.length) updateSpawns(dt);

  const b = G.bullet;
  if (b) {
    const ny = b.y - BULLET_SPEED * dt;
    for (let y = b.y; y > ny && G.bullet;) { y = Math.max(ny, y - 8); if (hitTest(b.x, y)) G.bullet = null; }
    if (G.bullet) { b.y = ny; if (ny < -12) G.bullet = null; }
  }
  for (const d of G.dets) if ((d.t -= dt) <= 0 && solid(d.c, d.r)) detonate(d.c, d.r);
  G.dets = G.dets.filter(d => d.t > 0);

  let low = 0;
  for (const ch of G.chains) for (const l of ch.links) {
    const q = linkPos(ch, l);
    if (l.r > low) low = l.r;
    if (p.alive && p.inv <= 0 && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 225) killPlayer();
  }
  if (G.chains.length && (G.beatT -= dt) <= 0) {
    const danger = clamp(low / ROWS, 0, 1);
    G.beatT = Math.max(0.16, 0.44 - G.wave * 0.015) * (1 - 0.45 * danger);
    sfx.beat((G.beatI ^= 1), danger);
  }
  if (p.alive && !G.chains.length && G.waveT <= 0) {
    G.waveT = 1.6; G.score += 100 * G.wave;
    if (G.score > G.hi) G.hi = G.score;
    pop(W / 2, FH / 2 + 40, 'WAVE BONUS ' + 100 * G.wave, '#fff');
    sfx.clear(); G.flash = 0.15;
  }
}

// ───────────────────────────── Render ─────────────────────────────
function txt(s, x, y, size, color, align = 'left', glow = 0, weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.shadowBlur = 0;
}
function drawChain(ch) {
  const L = ch.links, t = G.time;
  ctx.strokeStyle = alpha(G.pal.wyrm, 0.45); ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < L.length; i++) { const q = linkPos(ch, L[i]); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
  ctx.stroke();
  for (let i = L.length - 1; i >= 0; i--) {
    const l = L[i], { x, y } = linkPos(ch, l);
    if (y < -CELL) continue;
    let dx = l.c - l.pc, dy = l.r - l.pr;
    if (!dx && !dy) dy = 1;
    const w = Math.sin(t * 22 + i * 1.3) * 3;
    ctx.strokeStyle = alpha(i ? G.pal.wyrm : G.pal.head, 0.85); ctx.lineWidth = 1.6;
    ctx.beginPath();                                 // fins, perpendicular to travel
    ctx.moveTo(x - dy * 8, y + dx * 8); ctx.lineTo(x - dy * 14 - dx * w, y + dx * 14 - dy * w);
    ctx.moveTo(x + dy * 8, y - dx * 8); ctx.lineTo(x + dy * 14 + dx * w, y - dx * 14 + dy * w);
    ctx.stroke();
    blit(i ? S.link : S.head, x, y, i ? 1 + Math.sin(t * 9 - i * 0.8) * 0.05 : 1);
    if (!i) {
      ctx.fillStyle = '#10061e';
      ctx.beginPath();
      ctx.arc(x + dx * 4 - dy * 4.2, y + dy * 4 + dx * 4.2, 2.6, 0, TAU);
      ctx.arc(x + dx * 4 + dy * 4.2, y + dy * 4 - dx * 4.2, 2.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + dx * 5 - dy * 4.2 - 0.8, y + dy * 5 + dx * 4.2 - 0.8, 1.6, 1.6);
      ctx.fillRect(x + dx * 5 + dy * 4.2 - 0.8, y + dy * 5 - dx * 4.2 - 0.8, 1.6, 1.6);
    }
  }
}
function drawFoe(f) {
  const t = G.time;
  ctx.save(); ctx.translate(f.x, f.y);
  if (f.type === 'bloom') {
    const pu = 1 + Math.sin(t * 6) * 0.1;
    ctx.strokeStyle = 'rgba(255,141,242,.8)'; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = -1.5; i <= 1.5; i++) {
      ctx.moveTo(i * 5, 2);
      ctx.quadraticCurveTo(i * 5 + Math.sin(t * 7 + i) * 5, 10, i * 6 + Math.sin(t * 5 + i * 2) * 4, 18);
    }
    ctx.stroke();
    ctx.shadowColor = '#ff8df2'; ctx.shadowBlur = 16;
    const gr = ctx.createRadialGradient(-3, -6, 1, 0, 0, 14);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, '#ff8df2'); gr.addColorStop(1, '#7a2bd6');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, 2, 12 * pu, 12 / pu, 0, Math.PI, TAU); ctx.closePath(); ctx.fill();
  } else if (f.type === 'shard') {
    ctx.rotate(f.rot); ctx.shadowColor = '#ff8df2'; ctx.shadowBlur = 10; ctx.fillStyle = '#ffd0fa';
    poly(ctx, [[0, -7], [6, 5], [-6, 5]]); ctx.fill();
  } else if (f.type === 'dart') {
    const dir = -f.side, blink = f.aim > 0 && Math.sin(t * 40) > 0;
    ctx.scale(dir, 1);
    ctx.shadowColor = '#ff4d6d'; ctx.shadowBlur = 18;
    ctx.fillStyle = blink ? '#fff' : '#ff4d6d';
    poly(ctx, [[16, 0], [-4, -7], [-12, -10], [-7, 0], [-12, 10], [-4, 7]]); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(4, 0, 2.2, 0, TAU); ctx.fill();
  } else if (f.type === 'comet') {
    ctx.shadowColor = '#ffd35c'; ctx.shadowBlur = 20;
    const gr = ctx.createRadialGradient(0, 0, 1, 0, 0, 10);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, '#ffd35c'); gr.addColorStop(1, '#ff6a2b');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, f.hp > 1 ? 10 : 7.5, 0, TAU); ctx.fill();
  } else if (f.type === 'moth') {
    const col = `hsl(${(t * 220) % 360},100%,72%)`, flap = 0.35 + Math.abs(Math.sin(t * 16)) * 0.65;
    ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.fillStyle = col;
    for (const s of [-1, 1]) { ctx.save(); ctx.scale(s * flap, 1); poly(ctx, [[1, -2], [15, -11], [12, 2], [15, 10], [1, 4]]); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 7, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
function drawField() {
  const t = G.time, p = G.p;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const hp = G.grid[idx(c, r)];
    if (!hp) continue;
    const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
    if (G.vol[idx(c, r)]) blit(S.vgem, x, y, 1 + Math.sin(t * 12 + c) * 0.1);
    else blit(S.gem[hp], x, y);
  }
  for (const f of G.foes) if (f.type === 'dart' && f.aim > 0) {       // telegraph
    ctx.strokeStyle = `rgba(255,77,109,${0.25 + 0.25 * Math.sin(t * 40)})`; ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(0, f.y); ctx.lineTo(W, f.y); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const ch of G.chains) drawChain(ch);
  for (const f of G.foes) drawFoe(f);
  const b = G.bullet;
  if (b) {
    const gr = ctx.createLinearGradient(0, b.y - 4, 0, b.y + 26);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, G.pal.accent); gr.addColorStop(1, alpha(G.pal.accent, 0));
    ctx.fillStyle = gr; ctx.shadowColor = G.pal.accent; ctx.shadowBlur = 12;
    ctx.fillRect(b.x - 1.5, b.y - 4, 3, 30); ctx.shadowBlur = 0;
  }
  if (G.mode !== 'title' && p.alive && (p.inv <= 0 || Math.sin(t * 30) > -0.2)) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.tilt * 0.3); ctx.scale(1 - Math.abs(p.tilt) * 0.18, 1);
    ctx.fillStyle = alpha(G.pal.accent, 0.8);
    poly(ctx, [[-3, 8], [3, 8], [0, 14 + Math.random() * 8]]); ctx.fill();
    blit(S.ship, 0, 0);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const q of G.parts) {
    const a = q.life / q.max;
    ctx.globalAlpha = a;
    if (q.line) {
      ctx.strokeStyle = q.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.04, q.y - q.vy * 0.04); ctx.stroke();
    } else { ctx.fillStyle = q.color; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size); }
  }
  for (const q of G.rings) {
    const k = q.t / q.life, e = 1 - (1 - k) * (1 - k);
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = q.color; ctx.lineWidth = 5 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(q.x, q.y, q.max * e, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  for (const q of G.pops) {
    ctx.globalAlpha = Math.min(1, q.life * 2.5);
    txt(q.text, q.x, q.y, 15, q.color || '#fff', 'center', 8);
  }
  ctx.globalAlpha = 1;
}
function drawHud() {
  const t = G.time, pal = G.pal;
  ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(0, 0, W, HUD);
  txt('SCORE', 16, 18, 11, 'rgba(255,255,255,.55)');
  txt(String(G.score).padStart(6, '0'), 16, 42, 25, '#fff', 'left', 10);
  if (mult() > 1) {
    txt('×' + mult(), 122, 42, 22, pal.head, 'left', 12);
    ctx.fillStyle = alpha(pal.head, 0.8); ctx.fillRect(122, 46, 30 * clamp(G.comboT / 1.7, 0, 1), 2);
  }
  txt('HIGH', W / 2, 18, 11, 'rgba(255,255,255,.55)', 'center');
  txt(String(G.hi).padStart(6, '0'), W / 2, 42, 25, pal.accent, 'center', 10);
  txt('WAVE ' + G.wave, W - 16, 18, 11, 'rgba(255,255,255,.55)', 'right');
  for (let i = 0; i < Math.min(G.lives, 6); i++) blit(S.ship, W - 26 - i * 24, 34, 0.55);
  if (sfx.muted) txt('MUTED', W - 16, HUD + 16, 10, 'rgba(255,255,255,.4)', 'right');
  // nova meter
  const k = G.nova / NOVA_MAX, full = k >= 1;
  ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, HUD - 3, W, 3);
  ctx.fillStyle = full ? (Math.sin(t * 14) > 0 ? '#fff' : pal.accent) : alpha(pal.accent, 0.8);
  ctx.shadowColor = pal.accent; ctx.shadowBlur = full ? 14 : 6;
  ctx.fillRect(0, HUD - 3, W * k, 3); ctx.shadowBlur = 0;
  if (full && G.mode === 'play') txt('NOVA READY — SHIFT / RIGHT-CLICK', W / 2, H - 10, 12, alpha(pal.accent, 0.6 + 0.4 * Math.sin(t * 8)), 'center', 8);
}
function gradTitle(s, y, size) {
  ctx.font = `800 ${size}px ${FONT}`; ctx.textAlign = 'center';
  const gr = ctx.createLinearGradient(0, y - size * 0.8, 0, y + size * 0.1);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, G.pal.head); gr.addColorStop(0.7, G.pal.wyrm); gr.addColorStop(1, G.pal.crys);
  ctx.shadowColor = G.pal.wyrm; ctx.shadowBlur = 40; ctx.fillStyle = gr; ctx.fillText(s, W / 2, y);
  ctx.shadowBlur = 0; ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.strokeText(s, W / 2, y);
}
function drawOverlay() {
  const t = G.time, cx = W / 2, blink = 0.55 + 0.45 * Math.sin(t * 5);
  if (G.mode === 'title') {
    ctx.fillStyle = 'rgba(4,2,16,.5)'; ctx.fillRect(0, HUD, W, FH);
    gradTitle('WYRMFALL', 300 + Math.sin(t * 1.6) * 6, 118);
    txt('BREAK THE WYRM BEFORE IT REACHES YOU', cx, 346, 17, 'rgba(255,255,255,.8)', 'center', 6, 600);
    txt('CLICK OR PRESS SPACE', cx, 452, 26, `rgba(255,255,255,${blink})`, 'center', 14);
    const rows = [['MOVE', 'MOUSE  ·  WASD  ·  ARROWS  ·  DRAG'], ['FIRE', 'CLICK  ·  SPACE  ·  TOUCH'], ['NOVA', 'RIGHT-CLICK  ·  SHIFT  ·  TWO FINGERS'], ['ALSO', 'P PAUSE  ·  M MUTE  ·  F FULLSCREEN']];
    rows.forEach(([a, b], i) => {
      txt(a, cx - 150, 540 + i * 30, 14, G.pal.accent, 'left', 6);
      txt(b, cx - 86, 540 + i * 30, 14, 'rgba(255,255,255,.75)', 'left', 0, 500);
    });
    txt('ORANGE CRYSTALS EXPLODE.  CHAIN KILLS TO MULTIPLY.  KILLS CHARGE THE NOVA.', cx, 700, 12, 'rgba(255,255,255,.5)', 'center', 0, 500);
  } else if (G.mode === 'pause') {
    ctx.fillStyle = 'rgba(4,2,16,.6)'; ctx.fillRect(0, 0, W, H);
    gradTitle('PAUSED', H / 2, 70);
    txt('P  /  ESC  /  CLICK TO RESUME', cx, H / 2 + 50, 16, 'rgba(255,255,255,.75)', 'center');
  } else if (G.mode === 'over') {
    ctx.fillStyle = 'rgba(4,2,16,.6)'; ctx.fillRect(0, HUD, W, FH);
    gradTitle('GAME OVER', 340, 84);
    txt('SCORE  ' + G.score, cx, 410, 28, '#fff', 'center', 10);
    if (G.score && G.score >= G.hi) txt('NEW HIGH SCORE', cx, 452, 20, G.pal.head, 'center', 14);
    txt('WAVE ' + G.wave, cx, 490, 15, 'rgba(255,255,255,.6)', 'center');
    if (G.overT <= 0) txt('CLICK OR PRESS SPACE', cx, 570, 22, `rgba(255,255,255,${blink})`, 'center', 12);
  }
  if (G.banner && G.mode === 'play') {
    const a = clamp(G.banner.t * 2, 0, 1) * clamp((1.6 - G.banner.t) * 6, 0, 1);
    ctx.globalAlpha = a; gradTitle(G.banner.text, HUD + FH * 0.42, 60); ctx.globalAlpha = 1;
  }
}
function render() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.save();
  if (G.shake > 0.2) ctx.translate(rand(-1, 1) * G.shake, rand(-1, 1) * G.shake);
  ctx.drawImage(S.bg, 0, 0);
  for (const s of stars) {
    ctx.globalAlpha = (0.25 + 0.5 * s.z) * (0.6 + 0.4 * Math.sin(G.time * 2 + s.ph));
    ctx.fillStyle = '#fff'; ctx.fillRect(s.x, s.y, s.z * 2, s.z * 2);
  }
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, HUD, W, FH); ctx.clip();
  ctx.translate(0, HUD);
  drawField();
  ctx.restore();
  drawHud();
  drawOverlay();
  ctx.restore();
  if (G.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, G.flash * 1.6)})`; ctx.fillRect(0, 0, W, H); }
}

// ───────────────────────────── Loop ─────────────────────────────
let last = 0;
function frame(ts) {
  const dt = Math.min(0.033, (ts - last) / 1000 || 0);
  last = ts;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
enterTitle();
window.__WYRMFALL__ = { G, update, render, startGame, spawnFoe, fireNova, input };
requestAnimationFrame(frame);
})();
