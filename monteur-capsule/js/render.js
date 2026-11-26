// render.js — all canvas drawing for the Monteur de capsule (pure drawing, no playback control).
// Everything is designed at 1920×1080 and scaled with W. Never throws on missing / unready media.

import { store, FONTS, DEFAULT_STYLE, slideStateAt, activeOverlays, partById, clipById, program } from "./state.js";

/* ------------------------------------------------------------------ */
/* Public catalogs                                                     */
/* ------------------------------------------------------------------ */
export const TRANSITIONS = [
  { id: "cut", label: "Coupe franche" },
  { id: "fade", label: "Fondu" },
  { id: "slide", label: "Glissement" },
  { id: "zoom", label: "Zoom" },
  { id: "curtain", label: "Rideau" },
  { id: "blur", label: "Flou" },
  { id: "wipe", label: "Balayage" },
  { id: "cube", label: "Cube 3D" },
  { id: "glitch", label: "Glitch" },
  { id: "flash", label: "Flash" },
];
export const CAM_FILTERS = [
  { id: "none", label: "Aucun" },
  { id: "warm", label: "Chaud" },
  { id: "cold", label: "Froid" },
  { id: "bw", label: "Noir et blanc" },
  { id: "cinema", label: "Cinéma" },
  { id: "vivid", label: "Éclatant" },
  { id: "fade", label: "Délavé" },
];
export const CAM_ENTERS = [
  { id: "none", label: "Aucune" },
  { id: "slide", label: "Glissement" },
  { id: "pop", label: "Pop" },
  { id: "bounce", label: "Rebond" },
  { id: "fade", label: "Fondu" },
];
export const BG_ANIMS = [
  { id: "gradient", label: "Dégradé mouvant" },
  { id: "particles", label: "Particules" },
  { id: "grid", label: "Grille néon" },
  { id: "waves", label: "Vagues" },
  { id: "bokeh", label: "Bokeh" },
];
export const CARD_TEMPLATES = [
  { id: "reveal", label: "Révélation" },
  { id: "split", label: "Partagé" },
  { id: "minimal", label: "Minimal" },
  { id: "bold", label: "Audacieux" },
];

/* ------------------------------------------------------------------ */
/* Math / easing / color                                               */
/* ------------------------------------------------------------------ */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const eIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const eOut = t => 1 - Math.pow(1 - t, 3);
const eOutQ = t => 1 - Math.pow(1 - t, 5);
const eBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const eBounce = t => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
const TAU = Math.PI * 2;

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { s = String(s || ""); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const _rgbCache = new Map();
function rgb(hex) {
  let v = _rgbCache.get(hex);
  if (v) return v;
  let h = String(hex || "#000").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map(x => x + x).join("");
  const n = parseInt(h.slice(0, 6), 16);
  v = isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
  if (_rgbCache.size > 200) _rgbCache.clear();
  _rgbCache.set(hex, v);
  return v;
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
function mixHex(a, b, t) { const A = rgb(a), B = rgb(b); return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`; }
function lum(hex) { const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
const onColor = hex => (lum(hex) > 0.42 ? "#0b1220" : "#ffffff");

/* ------------------------------------------------------------------ */
/* Canvas helpers                                                      */
/* ------------------------------------------------------------------ */
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function resetCtx(c) {
  c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
  if ("filter" in c) c.filter = "none";
  c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
  c.imageSmoothingEnabled = true; try { c.imageSmoothingQuality = "high"; } catch (e) { }
  c.textBaseline = "alphabetic"; c.textAlign = "left";
  if ("letterSpacing" in c) c.letterSpacing = "0px";
}
const HAS_FILTER = (() => { try { const x = document.createElement("canvas").getContext("2d"); return "filter" in x; } catch (e) { return false; } })();
const HAS_LS = (() => { try { const x = document.createElement("canvas").getContext("2d"); return "letterSpacing" in x; } catch (e) { return false; } })();
function setLS(c, px) { if (HAS_LS) c.letterSpacing = `${px.toFixed(2)}px`; }

function newCanvas(w, h) {
  if (typeof document !== "undefined") { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; return cv; }
  return new OffscreenCanvas(w, h);
}
// Pool of reusable offscreen canvases (never shrink -> no per-frame allocations).
const OFF = [];
function off(i, w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  let o = OFF[i];
  if (!o) { const cv = newCanvas(w, h); o = OFF[i] = { cv, x: cv.getContext("2d") }; }
  if (o.cv.width < w || o.cv.height < h) { o.cv.width = Math.max(o.cv.width, w); o.cv.height = Math.max(o.cv.height, h); o.x = o.cv.getContext("2d"); }
  const x = o.x;
  x.setTransform(1, 0, 0, 1, 0, 0); resetCtx(x);
  x.clearRect(0, 0, w, h);
  o.w = w; o.h = h;
  return o;
}

function srcDims(s) {
  if (!s) return null;
  try {
    if (typeof HTMLVideoElement !== "undefined" && s instanceof HTMLVideoElement) {
      return s.readyState >= 2 && s.videoWidth > 0 ? [s.videoWidth, s.videoHeight] : null;
    }
    if (typeof HTMLImageElement !== "undefined" && s instanceof HTMLImageElement) return s.complete && s.naturalWidth ? [s.naturalWidth, s.naturalHeight] : null;
    const w = s.width, h = s.height;
    return w > 0 && h > 0 ? [w, h] : null;
  } catch (e) { return null; }
}
function safeVideo(f, clipId, role) { if (!clipId || !f.getVideo) return null; try { return f.getVideo(clipId, role) || null; } catch (e) { return null; } }
function safeImage(f, clipId) { if (!clipId || !f.getImage) return null; try { return f.getImage(clipId) || null; } catch (e) { return null; } }

// Draw src covering box b with crop zoom/offset (camera math from v1).
function drawCover(c, src, d, b, zoom = 1, ox = 0, oy = 0, mirror = false) {
  const [sw, sh] = d;
  const ta = b.w / b.h, va = sw / sh;
  let cw = va > ta ? sh * ta : sw, ch = va > ta ? sh : sw / ta;
  const z = Math.max(1, +zoom || 1);
  cw /= z; ch /= z;
  const sx = clamp((sw - cw) / 2 * (1 + clamp(+ox || 0, -1, 1)), 0, sw - cw);
  const sy = clamp((sh - ch) / 2 * (1 + clamp(+oy || 0, -1, 1)), 0, sh - ch);
  if (mirror) { c.save(); c.translate(b.x * 2 + b.w, 0); c.scale(-1, 1); c.drawImage(src, sx, sy, cw, ch, b.x, b.y, b.w, b.h); c.restore(); }
  else c.drawImage(src, sx, sy, cw, ch, b.x, b.y, b.w, b.h);
}
function containRect(d, b) {
  const s = Math.min(b.w / d[0], b.h / d[1]), w = d[0] * s, h = d[1] * s;
  return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
}
const lerpBox = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });

function fontOf(S) { return FONTS[S.font] || FONTS.system; }

// Shadow helpers (frames)
function shadowOn(c, S, u, k = 1) {
  if (S.shadow > 0 && k > 0.01) {
    c.shadowColor = `rgba(0,0,0,${(Math.min(0.75, S.shadow / 100 + 0.15) * k).toFixed(3)})`;
    c.shadowBlur = S.shadow * u; c.shadowOffsetY = S.shadow * 0.28 * u; c.shadowOffsetX = 0;
  }
}
function shadowOff(c) { c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0; c.shadowOffsetX = 0; }

// Cached 9-slice shadow sprites: native shadows on rounded paths are very slow on software canvases.
const _shadowCache = new Map();
function shadowSprite(r, blur, color) {
  r = r > 24 ? Math.round(r / 4) * 4 : Math.round(r);
  blur = Math.round(blur);
  const key = `${r}|${blur}|${color}`;
  let s = _shadowCache.get(key);
  if (s) return s;
  const pad = Math.ceil(blur * 1.25 + 2), core = 2 * r + 10, size = core + 2 * pad;
  const cv = newCanvas(size, size), x = cv.getContext("2d");
  x.shadowColor = color; x.shadowBlur = blur; x.shadowOffsetX = 10000;
  rr(x, pad - 10000, pad, core, core, r); x.fillStyle = "#000"; x.fill();
  s = { cv, pad, r, size, k: pad + r + 2 };
  if (_shadowCache.size > 48) _shadowCache.delete(_shadowCache.keys().next().value);
  _shadowCache.set(key, s);
  return s;
}
// Draw a soft drop shadow under the rounded rect (x,y,w,h,r).
function dropShadow(c, x, y, w, h, r, blur, offY, color) {
  if (blur < 0.5 || w < 2 || h < 2) return;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const s = shadowSprite(r, blur, color);
  const k = s.k, S = s.size, p = s.pad;
  y += offY;
  const X0 = x - p, Y0 = y - p, X1 = x + w + p, Y1 = y + h + p;
  if (X1 - X0 < 2 * k || Y1 - Y0 < 2 * k) { // too small for 9-slice: native
    c.save(); c.shadowColor = color; c.shadowBlur = blur; c.shadowOffsetX = 10000; rr(c, x - 10000, y, w, h, r); c.fillStyle = "#000"; c.fill(); c.restore(); return;
  }
  const mw = X1 - X0 - 2 * k, mh = Y1 - Y0 - 2 * k, sm = S - 2 * k;
  c.drawImage(s.cv, 0, 0, k, k, X0, Y0, k, k);
  c.drawImage(s.cv, k, 0, sm, k, X0 + k, Y0, mw, k);
  c.drawImage(s.cv, S - k, 0, k, k, X1 - k, Y0, k, k);
  c.drawImage(s.cv, 0, k, k, sm, X0, Y0 + k, k, mh);
  c.drawImage(s.cv, S - k, k, k, sm, X1 - k, Y0 + k, k, mh);
  c.drawImage(s.cv, 0, S - k, k, k, X0, Y1 - k, k, k);
  c.drawImage(s.cv, k, S - k, sm, k, X0 + k, Y1 - k, mw, k);
  c.drawImage(s.cv, S - k, S - k, k, k, X1 - k, Y1 - k, k, k);
  // the center is hidden under an opaque frame; only needed when fading
  if (c.globalAlpha < 0.999) c.drawImage(s.cv, k, k, sm, sm, X0 + k, Y0 + k, mw, mh);
}
function frameShadow(c, S, u, b, r, k = 1) {
  if (!(S.shadow > 0) || k <= 0.01) return;
  const a = Math.min(0.75, S.shadow / 100 + 0.15);
  const ga = c.globalAlpha; c.globalAlpha = ga * k;
  dropShadow(c, b.x, b.y, b.w, b.h, r, S.shadow * u, S.shadow * 0.28 * u, `rgba(0,0,0,${a.toFixed(3)})`);
  c.globalAlpha = ga;
}

// Pre-scaled slide cache (high-quality downscale once, then 1:1 blits).
const _slideCache = [];
function scaledSlide(img, w, h) {
  w = Math.round(w); h = Math.round(h);
  if (w < 2 || h < 2) return null;
  for (let i = 0; i < _slideCache.length; i++) { const e = _slideCache[i]; if (e.img === img && e.w === w && e.h === h) { if (i) { _slideCache.splice(i, 1); _slideCache.unshift(e); } return e.cv; } }
  const cv = newCanvas(w, h), x = cv.getContext("2d");
  x.imageSmoothingEnabled = true; try { x.imageSmoothingQuality = "high"; } catch (e) { }
  x.drawImage(img, 0, 0, w, h);
  _slideCache.unshift({ img, w, h, cv });
  if (_slideCache.length > 8) _slideCache.pop();
  return cv;
}

// Fitted / wrapped title cache
const _fitCache = new Map();
function wrapText(c, text, maxW) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (cur && c.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t;
    }
    out.push(cur);
  }
  return out;
}
function fitText(c, text, fontFn, maxW, maxLines, size0, minSize, ls = 0) {
  const key = `${text}|${fontFn(100)}|${Math.round(maxW)}|${maxLines}|${Math.round(size0)}|${ls}`;
  let r = _fitCache.get(key);
  if (r) return r;
  let size = size0, lines;
  for (let k = 0; k < 40; k++) {
    c.font = fontFn(size); setLS(c, ls * size);
    lines = wrapText(c, text, maxW);
    const okW = lines.every(l => c.measureText(l).width <= maxW);
    if ((lines.length <= maxLines && okW) || size <= minSize) break;
    size = Math.max(minSize, size * 0.93);
  }
  // balance multi-line titles: narrow the box while the line count stays the same
  if (lines.length > 1) {
    const n = lines.length;
    let w = maxW;
    for (let k = 0; k < 14; k++) {
      const w2 = w * 0.95, l2 = wrapText(c, text, w2);
      if (l2.length !== n) break;
      w = w2; lines = l2;
    }
  }
  setLS(c, 0);
  r = { size, lines };
  if (_fitCache.size > 120) _fitCache.clear();
  _fitCache.set(key, r);
  return r;
}

/* ------------------------------------------------------------------ */
/* Style access                                                        */
/* ------------------------------------------------------------------ */
function styleOf(f) { const s = (f && (f.style || (f.project && f.project.style))) || (store.project && store.project.style) || {}; return Object.assign({}, DEFAULT_STYLE, s); }
function slideAspect(slides) {
  const d = srcDims(slides && slides[0]);
  return d ? d[0] / d[1] : 16 / 9;
}
const CAM_ASPECT = { "3:4": 3 / 4, "1:1": 1, "9:16": 9 / 16, "16:9": 16 / 9, circle: 1 };

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */
function fitBox(W, H, aspect, m) { let w = W - 2 * m, h = w / aspect; if (h > H - 2 * m) { h = H - 2 * m; w = h * aspect; } return { x: (W - w) / 2, y: (H - h) / 2, w, h }; }

function computeLayout(W, H, part, kind, S, slides) {
  const u = W / 100, m = S.margin * u, g = S.gap * u;
  const headerH = S.headerText ? H * 0.075 : 0;
  const top = m + headerH, availH = H - top - m;
  const sa = slideAspect(slides);
  const bigSlide = fitBox(W, H - headerH, sa, Math.max(m, W * 0.02)); bigSlide.y += headerH;
  const duoOn = !!(part && part.camB);
  const duo = duoOn ? (S.duoLayout === "side" ? "side" : "stack") : null;
  const base = { bigSlide, headerH, m, duo };
  if (kind === "cam") return { ...base, slide: null, cam: { x: 0, y: 0, w: W, h: H }, camB: null };
  if (kind === "slide") return { ...base, slide: { ...bigSlide }, cam: null, camB: null };
  if (duo === "side") {
    const cw = (W - 2 * m - g) / 2, ch = availH;
    return { ...base, slide: null, cam: { x: m, y: top, w: cw, h: ch }, camB: { x: m + cw + g, y: top, w: cw, h: ch } };
  }
  const ca = CAM_ASPECT[S.camShape] || 0.75;
  let cw = S.camWidth * u, ch = cw / ca;
  const maxCh = duo === "stack" ? (availH - g) / 2 : availH;
  if (ch > maxCh) { ch = maxCh; cw = ch * ca; }
  let sw = W - 2 * m - g - cw, sh = sw / sa;
  if (sh > availH) { sh = availH; sw = sh * sa; }
  const groupW = sw + g + cw, gx = (W - groupW) / 2;
  const sy = top + (availH - sh) / 2;
  let sx, cx;
  if (S.camSide === "left") { cx = gx; sx = gx + cw + g; } else { sx = gx; cx = gx + sw + g; }
  const colH = duo === "stack" ? ch * 2 + g : ch;
  let cy = S.camAlign === "top" ? sy : S.camAlign === "bottom" ? sy + sh - colH : sy + (sh - colH) / 2;
  cy = clamp(cy, top, H - m - colH);
  const cam = { x: cx, y: cy, w: cw, h: ch };
  const camB = duo === "stack" ? { x: cx, y: cy + ch + g, w: cw, h: ch } : null;
  return { ...base, slide: { x: sx, y: sy, w: sw, h: sh }, cam, camB };
}

/** Public: boxes for a part in a given kind ("pip" | "slide" | "cam"). Uses store.project.style and store.slides. */
export function layoutBoxes(W, H, part, kind = "pip") {
  const S = Object.assign({}, DEFAULT_STYLE, (store.project && store.project.style) || {});
  return computeLayout(W, H, part, kind || "pip", S, store.slides);
}

/* ------------------------------------------------------------------ */
/* Backgrounds                                                         */
/* ------------------------------------------------------------------ */
const _bgCache = []; // small LRU: preview, export and thumbnail sizes alternate
const _imgIds = new WeakMap(); let _imgN = 0;
const imgId = im => { if (!im) return 0; let v = _imgIds.get(im); if (!v) { v = ++_imgN; _imgIds.set(im, v); } return v; };

function linGrad(c, W, H, angleDeg, c1, c2) {
  const a = (angleDeg - 90) * Math.PI / 180, r = Math.hypot(W, H) / 2, cx = W / 2, cy = H / 2;
  const g = c.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  return g;
}
function staticBg(W, H, S, img) {
  const type = S.bgType === "image" && img ? "image" : S.bgType === "solid" ? "solid" : "gradient";
  const key = `${W}x${H}|${type}|${S.bg1}|${S.bg2}|${S.bgAngle}|${S.bgBlur}|${S.bgDim}|${imgId(type === "image" ? img : null)}`;
  for (let i = 0; i < _bgCache.length; i++) if (_bgCache[i].key === key) { const e = _bgCache[i]; if (i) { _bgCache.splice(i, 1); _bgCache.unshift(e); } return e.cv; }
  const cv = _bgCache.length >= 3 ? _bgCache.pop().cv : newCanvas(W, H);
  cv.width = W; cv.height = H;
  const x = cv.getContext("2d"); resetCtx(x);
  if (type === "image") {
    const d = srcDims(img);
    x.fillStyle = S.bg1; x.fillRect(0, 0, W, H);
    if (d) {
      const s = Math.max(W / d[0], H / d[1]), w = d[0] * s, h = d[1] * s;
      const blur = (S.bgBlur || 0) * W / 1920, pad = blur * 2;
      if (blur > 0 && HAS_FILTER) x.filter = `blur(${blur}px)`;
      x.drawImage(img, (W - w) / 2 - pad, (H - h) / 2 - pad, w + 2 * pad, h + 2 * pad);
      x.filter = "none";
    }
    if (S.bgDim > 0) { x.fillStyle = `rgba(0,0,0,${S.bgDim / 100})`; x.fillRect(0, 0, W, H); }
  } else if (type === "solid") { x.fillStyle = S.bg1; x.fillRect(0, 0, W, H); }
  else {
    x.fillStyle = linGrad(x, W, H, S.bgAngle, S.bg1, S.bg2); x.fillRect(0, 0, W, H);
    // subtle radial light for depth
    const rg = x.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.3, H * 0.2, W * 0.8);
    rg.addColorStop(0, "rgba(255,255,255,0.06)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
  }
  _bgCache.unshift({ key, cv });
  return cv;
}

// Seeded fields (normalized, size independent)
const FIELD = (() => {
  const r = mulberry32(1234), N = 72;
  const p = []; for (let i = 0; i < N; i++) p.push({ x: r(), y: r(), vx: (r() - 0.5) * 0.012, vy: 0.006 + r() * 0.014, s: 0.6 + r() * 1.6, ph: r() * TAU, tw: 0.5 + r() * 1.5, acc: r() < 0.35 });
  const b = []; const r2 = mulberry32(99); for (let i = 0; i < 22; i++) b.push({ x: r2(), y: r2(), rad: 0.025 + r2() * 0.075, sp: 0.4 + r2(), ph: r2() * TAU, a: 0.1 + r2() * 0.22, col: i % 3 });
  return { p, b, sx: new Float32Array(N), sy: new Float32Array(N) };
})();
const _sprites = new Map();
function softSprite(color) {
  let s = _sprites.get(color);
  if (s) return s;
  const cv = newCanvas(256, 256), x = cv.getContext("2d");
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  const [r, gg, b] = rgb(color);
  g.addColorStop(0, `rgba(${r},${gg},${b},1)`); g.addColorStop(0.55, `rgba(${r},${gg},${b},0.75)`);
  g.addColorStop(0.8, `rgba(${r},${gg},${b},0.25)`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  if (_sprites.size > 24) _sprites.clear();
  _sprites.set(color, cv);
  return cv;
}
function lighten(hex, t) { const [r, g, b] = rgb(hex); const f = v => Math.round(lerp(v, 255, t)).toString(16).padStart(2, "0"); return `#${f(r)}${f(g)}${f(b)}`; }

const _gridCache = { key: "", cv: null };
function gridBase(W, H, S, A) {
  const key = `${W}x${H}|${S.bg1}|${S.bg2}|${S.bgAngle}|${A}`;
  if (_gridCache.key === key) return _gridCache.cv;
  const cv = _gridCache.cv || newCanvas(W, H); cv.width = W; cv.height = H;
  const c = cv.getContext("2d"), u = W / 1920, hz = H * 0.56, vx = W / 2;
  c.fillStyle = linGrad(c, W, H, S.bgAngle, S.bg1, S.bg2); c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(vx, hz, 0, vx, hz, W * 0.45);
  glow.addColorStop(0, rgba(A, 0.45)); glow.addColorStop(0.4, rgba(A, 0.12)); glow.addColorStop(1, rgba(A, 0));
  c.fillStyle = glow; c.fillRect(0, 0, W, H);
  const fl = c.createLinearGradient(0, hz, 0, H);
  fl.addColorStop(0, rgba(S.bg1, 0.2)); fl.addColorStop(1, rgba(S.bg1, 0.85));
  c.fillStyle = fl; c.fillRect(0, hz, W, H - hz);
  c.save(); c.beginPath(); c.rect(0, hz, W, H - hz); c.clip();
  for (let pass = 0; pass < 2; pass++) {
    c.beginPath();
    for (let i = -14; i <= 14; i++) { c.moveTo(vx + i * W * 0.012, hz); c.lineTo(vx + i * W * 0.14, H); }
    c.strokeStyle = rgba(A, pass ? 0.75 : 0.16); c.lineWidth = (pass ? 1.6 : 7) * u; c.stroke();
  }
  const fade = c.createLinearGradient(0, hz, 0, hz + (H - hz) * 0.35);
  fade.addColorStop(0, rgba(S.bg2, 0.9)); fade.addColorStop(1, rgba(S.bg2, 0));
  c.fillStyle = fade; c.fillRect(0, hz, W, (H - hz) * 0.35);
  c.restore();
  _gridCache.key = key; _gridCache.cv = cv;
  return cv;
}
function drawBackground(c0, R) {
  const { S, f } = R;
  if (S.bgType !== "animated") { c0.drawImage(staticBg(R.W, R.H, S, f.bgImage), 0, 0, R.W, R.H); return; }
  const t = (f.wall || 0) * (+S.bgAnimSpeed || 1), A = R.accent;
  const anim = BG_ANIMS.some(b => b.id === S.bgAnim) ? S.bgAnim : "gradient";
  // soft layers are rendered at low resolution then upscaled once (cheap, invisible on blurry content)
  const q = anim === "gradient" || anim === "bokeh" ? 1 / 3 : 1;
  let c = c0, W = R.W, H = R.H, o = null;
  if (q < 1) { o = off(6, R.W * q, R.H * q); c = o.x; W = o.w; H = o.h; }
  const u = W / 1920;
  drawAnimBg(c, W, H, u, S, A, t, anim, q < 1);
  if (o) { c0.save(); c0.imageSmoothingEnabled = true; try { c0.imageSmoothingQuality = "low"; } catch (e) { } c0.drawImage(o.cv, 0, 0, o.w, o.h, 0, 0, R.W, R.H); c0.restore(); }
}
function drawAnimBg(c, W, H, u, S, A, t, anim, lowres) {
  if (anim === "gradient") {
    c.fillStyle = linGrad(c, W, H, S.bgAngle + 25 * Math.sin(t * 0.09), S.bg1, S.bg2); c.fillRect(0, 0, W, H);
    const blobs = [[A, 0.26, 0.3, 0.33, 0.11, 0.07], [S.bg2, 0.55, 0.72, 0.62, 0.08, 0.13], [lighten(S.bg1, 0.25), 0.35, 0.5, 0.8, 0.06, 0.1]];
    for (let i = 0; i < blobs.length; i++) {
      const [col, a, bx, by, fx, fy] = blobs[i];
      const x = W * (bx + 0.22 * Math.sin(t * fx * 3 + i * 2)), y = H * (by + 0.25 * Math.cos(t * fy * 3 + i));
      const rad = W * (0.42 + 0.06 * Math.sin(t * 0.2 + i));
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    return;
  }
  if (lowres) { c.fillStyle = linGrad(c, W, H, S.bgAngle, S.bg1, S.bg2); c.fillRect(0, 0, W, H); }
  else c.drawImage(staticBg(W, H, { ...S, bgType: "gradient" }, null), 0, 0, W, H);
  if (anim === "particles") {
    const P = FIELD.p, N = P.length, sx = FIELD.sx, sy = FIELD.sy;
    for (let i = 0; i < N; i++) {
      const p = P[i];
      let x = (p.x + p.vx * t + 0.015 * Math.sin(t * 0.4 + p.ph)) % 1; if (x < 0) x += 1;
      let y = (p.y - p.vy * t) % 1; if (y < 0) y += 1;
      sx[i] = x * W; sy[i] = y * H;
    }
    c.lineWidth = 1.2 * u;
    const d1 = 120 * u, d2 = 200 * u;
    for (let pass = 0; pass < 2; pass++) {
      c.beginPath();
      const lo = pass ? d1 : 0, hi = pass ? d2 : d1;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const dx = sx[i] - sx[j], dy = sy[i] - sy[j]; const d = dx * dx + dy * dy;
        if (d < hi * hi && d >= lo * lo) { c.moveTo(sx[i], sy[i]); c.lineTo(sx[j], sy[j]); }
      }
      c.strokeStyle = rgba(A, pass ? 0.07 : 0.18); c.stroke();
    }
    for (let i = 0; i < N; i++) {
      const p = P[i], tw = 0.55 + 0.45 * Math.sin(t * p.tw + p.ph);
      c.fillStyle = p.acc ? rgba(A, 0.85 * tw) : `rgba(255,255,255,${(0.6 * tw).toFixed(3)})`;
      c.beginPath(); c.arc(sx[i], sy[i], p.s * 2.2 * u, 0, TAU); c.fill();
    }
    return;
  }
  if (anim === "grid") {
    const hz = H * 0.56;
    c.drawImage(gridBase(W, H, S, A), 0, 0, W, H);
    // stars
    const P = FIELD.p;
    for (let i = 0; i < P.length; i += 2) { const p = P[i]; const sz = 2 * u * p.s; c.fillStyle = `rgba(255,255,255,${(0.2 + 0.4 * Math.sin(t * p.tw + p.ph) ** 2).toFixed(3)})`; c.fillRect(p.x * W, p.y * hz * 0.9, sz, sz); }
    // moving horizontal lines (axis aligned -> fillRect, very cheap)
    const n = 14, ph = (t * 0.35) % 1;
    for (let k = 0; k < n; k++) {
      const z = (k + ph) / n, y = hz + (H - hz) * Math.pow(z, 2.6), a = c01(z * 1.8);
      c.fillStyle = rgba(A, 0.12 * a); c.fillRect(0, y - 3.5 * u, W, 7 * u);
      c.fillStyle = rgba(A, 0.75 * a); c.fillRect(0, y - 0.8 * u, W, 1.6 * u);
    }
    c.fillStyle = rgba(A, 0.9); c.fillRect(0, hz - 1 * u, W, 2 * u);
    return;
  }
  if (anim === "waves") {
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const base = H * (0.58 + i * 0.1), amp = (38 - i * 5) * u, wl = W * (0.9 - i * 0.12), sp = 0.35 + i * 0.12;
      c.beginPath(); c.moveTo(0, H);
      const step = W / 48;
      for (let x = 0; x <= W + step; x += step) {
        const y = base + Math.sin(x / wl * TAU + t * sp + i * 1.7) * amp + Math.sin(x / (wl * 0.53) * TAU - t * sp * 0.7 + i) * amp * 0.35;
        c.lineTo(x, y);
      }
      c.lineTo(W, H); c.closePath();
      c.fillStyle = rgba(i % 2 ? A : lighten(S.bg2, 0.15), 0.1 + i * 0.045); c.fill();
    }
    return;
  }
  if (anim === "bokeh") {
    const cols = [A, lighten(S.bg2, 0.35), "#ffffff"];
    c.save(); c.globalCompositeOperation = "screen";
    for (const b of FIELD.b) {
      const spr = softSprite(cols[b.col]);
      let y = (b.y - t * 0.006 * b.sp) % 1.2; if (y < -0.2) y += 1.4;
      const x = W * (b.x + 0.04 * Math.sin(t * 0.12 * b.sp + b.ph)), yy = H * (y + 0.03 * Math.cos(t * 0.1 * b.sp + b.ph));
      const rad = W * b.rad * (1 + 0.08 * Math.sin(t * 0.3 + b.ph));
      c.globalAlpha = b.a * (0.75 + 0.25 * Math.sin(t * 0.5 * b.sp + b.ph));
      c.drawImage(spr, x - rad, yy - rad, rad * 2, rad * 2);
    }
    c.restore();
    return;
  }
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */
// Camera looks are built from composite operations (no ctx.filter: it is very slow on software canvases).
// Each preset = multipliers on brightness / contrast / saturation + tint layers.
const LOOKS = {
  none: { b: 1, c: 1, s: 1 },
  warm: { b: 1, c: 1, s: 1, tints: [["soft-light", "rgba(255,140,50,0.38)"], ["source-over", "rgba(255,170,90,0.06)"]] },
  cold: { b: 1, c: 1, s: 1, tints: [["soft-light", "rgba(60,140,255,0.40)"], ["source-over", "rgba(120,180,255,0.06)"]] },
  bw: { b: 1.0, c: 1.12, s: 0 },
  cinema: { b: 0.96, c: 1, s: 1, tints: [["soft-light", "rgba(0,128,140,0.42)"], ["source-over", "rgba(255,150,70,0.06)"]], vignette: 0.5 },
  vivid: { b: 1.02, c: 1.06, s: 1.45 },
  fade: { b: 1.04, c: 0.84, s: 0.78, tints: [["lighten", "rgb(40,38,52)"]] },
};
const _vig = [];
function vignetteSprite(a, w, h) {
  w = Math.round(w); h = Math.round(h);
  for (const e of _vig) if (e.a === a && e.w === w && e.h === h) return e.cv;
  const cv = newCanvas(w, h), x = cv.getContext("2d");
  const rad = Math.hypot(w, h) / 2;
  const g = x.createRadialGradient(w / 2, h / 2, rad * 0.4, w / 2, h / 2, rad);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${a})`);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  _vig.unshift({ a, w, h, cv }); if (_vig.length > 3) _vig.pop();
  return cv;
}
function drawCamLook(c, S, video, d, b, cfg) {
  const L = LOOKS[S.camFilter] || LOOKS.none;
  const br = (S.camBright / 100) * L.b, ct = (S.camContrast / 100) * L.c, sa = (S.camSat / 100) * L.s;
  const z = cfg && cfg.zoom, ox = cfg && cfg.x, oy = cfg && cfg.y, mir = !!(cfg && cfg.mirror);
  drawCover(c, video, d, b, z, ox, oy, mir);
  const ga = c.globalAlpha;
  const self = (op, a) => { c.globalCompositeOperation = op; c.globalAlpha = ga * a; drawCover(c, video, d, b, z, ox, oy, mir); };
  const fill = (op, col, a = 1) => { c.globalCompositeOperation = op; c.globalAlpha = ga * a; c.fillStyle = col; c.fillRect(b.x, b.y, b.w, b.h); };
  // order matters: self-draw steps (colored) first, then fills, desaturation last
  if (sa > 1.005) self("soft-light", c01((sa - 1) * 1.3));
  else if (ct > 1.005) self("overlay", c01((ct - 1) * 2.2));
  if (br > 1.005) self("lighter", c01(br - 1));
  if (ct < 0.995) fill("source-over", "rgb(128,128,128)", c01(1 - ct));
  if (br < 0.995) fill("source-over", "#000", c01(1 - br));
  if (sa < 0.995) fill("saturation", "#808080", c01(1 - sa));
  if (L.tints) for (const [op, col] of L.tints) fill(op, col);
  c.globalCompositeOperation = "source-over"; c.globalAlpha = ga;
  if (L.vignette) c.drawImage(vignetteSprite(L.vignette, b.w, b.h), b.x, b.y);
}
function placeholder(c, b, label, u, dark = true) {
  const g = c.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  g.addColorStop(0, dark ? "#1b2333" : "#eef1f6"); g.addColorStop(1, dark ? "#111827" : "#dfe4ec");
  c.fillStyle = g; c.fillRect(b.x, b.y, b.w, b.h);
  const s = Math.max(10 * u, Math.min(b.w, b.h) * 0.09);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  c.strokeStyle = dark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.45)"; c.lineWidth = Math.max(1.5, s * 0.09);
  if (label === "Caméra") { rr(c, cx - s * 1.1, cy - s * 1.25, s * 1.6, s * 1.1, s * 0.2); c.stroke(); c.beginPath(); c.moveTo(cx + s * 0.5, cy - s * 0.95); c.lineTo(cx + s * 1.1, cy - s * 1.25); c.lineTo(cx + s * 1.1, cy - s * 0.15); c.lineTo(cx + s * 0.5, cy - s * 0.45); c.stroke(); }
  else { rr(c, cx - s * 1.1, cy - s * 1.3, s * 2.2, s * 1.3, s * 0.15); c.stroke(); c.beginPath(); c.moveTo(cx - s * 0.6, cy - s * 0.8); c.lineTo(cx + s * 0.4, cy - s * 0.8); c.moveTo(cx - s * 0.6, cy - s * 0.5); c.lineTo(cx + s * 0.1, cy - s * 0.5); c.stroke(); }
  c.fillStyle = dark ? "#94a3b8" : "#475569"; c.font = `600 ${s * 0.62}px ${FONTS.system}`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(label, cx, cy + s * 0.55); c.textAlign = "left"; c.textBaseline = "alphabetic";
}
function applyTf(c, b, tf) {
  if (!tf) return;
  if (tf.dx || tf.dy) c.translate(tf.dx || 0, tf.dy || 0);
  if (tf.s != null && tf.s !== 1) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; c.translate(cx, cy); c.scale(tf.s, tf.s); c.translate(-cx, -cy); }
}

function drawCamEl(c, R, el, video, cfg) {
  const { S, u } = R, b = el.box, r = el.r, full = el.full || 0, frameK = 1 - full;
  if (el.alpha <= 0.002 || b.w < 1 || b.h < 1) return;
  c.save();
  c.globalAlpha *= el.alpha;
  applyTf(c, b, el.tf);
  if (frameK > 0.01) {
    frameShadow(c, S, u, b, r, frameK);
    if (S.camGlow) { const ga = c.globalAlpha; c.globalAlpha = ga * frameK; c.globalCompositeOperation = "lighter"; dropShadow(c, b.x, b.y, b.w, b.h, r, 54 * u, 0, rgba(R.accent, 1)); c.globalCompositeOperation = "source-over"; c.globalAlpha = ga; }
    rr(c, b.x, b.y, b.w, b.h, r); c.fillStyle = "#000"; c.fill();
  }
  c.save();
  rr(c, b.x, b.y, b.w, b.h, r); c.clip();
  const d = srcDims(video);
  if (d) {
    drawCamLook(c, S, video, d, b, cfg);
  } else placeholder(c, b, "Caméra", u);
  if (full > 0.01 && S.camFilter === "cinema") {
    const bh = b.h * 0.12 * full; c.fillStyle = "#000"; c.fillRect(b.x, b.y, b.w, bh); c.fillRect(b.x, b.y + b.h - bh, b.w, bh);
  }
  c.restore();
  if (S.camBorder > 0 && frameK > 0.01) {
    c.globalAlpha *= frameK; c.lineWidth = S.camBorder * u; c.strokeStyle = R.accent;
    const i = S.camBorder * u / 2; rr(c, b.x + i, b.y + i, b.w - 2 * i, b.h - 2 * i, Math.max(0, r - i)); c.stroke();
  }
  c.restore();
}

function camEnterTf(R, b, p, side) {
  const t = c01(p), type = R.S.camEnter;
  if (type === "none" || t >= 1) return { alpha: 1, tf: null };
  if (type === "slide") {
    const dist = side === "left" ? -(b.x + b.w + 40 * R.u) : (R.W - b.x + 40 * R.u);
    return { alpha: c01(t * 2.5), tf: { dx: dist * (1 - eOutQ(t)), s: 1 } };
  }
  if (type === "pop") return { alpha: c01(t * 4), tf: { s: 0.4 + 0.6 * eBack(t) } };
  if (type === "bounce") return { alpha: c01(t * 6), tf: { dy: -(b.y + b.h + 60 * R.u) * (1 - eBounce(t)), s: 1 } };
  if (type === "fade") return { alpha: eOut(t), tf: { s: 0.94 + 0.06 * eOut(t) } };
  return { alpha: 1, tf: null };
}

/* ------------------------------------------------------------------ */
/* Slides                                                              */
/* ------------------------------------------------------------------ */
function slideVideoFor(R, idx) {
  const list = (R.f.project && R.f.project.slideVideos) || [];
  for (const sv of list) if (sv.slide === idx && sv.clipId) return sv;
  return null;
}
// Paint slide idx inside box b on context x (caller clips). Applies the zoom view if any.
function paintSlide(x, R, b, idx, view = R.view) {
  const img = R.f.slides ? R.f.slides[idx] : null;
  const d = srcDims(img);
  x.save();
  x.fillStyle = "#ffffff"; x.fillRect(b.x, b.y, b.w, b.h);
  if (d && view) {
    // crisp zoom: draw straight from the source bitmap with a source rect (no big transformed draw)
    const cr = containRect(d, b), s = view.s;
    const Dx = b.x + (cr.x - b.x - view.vx) * s, Dy = b.y + (cr.y - b.y - view.vy) * s, Dw = cr.w * s, Dh = cr.h * s;
    const ix0 = Math.max(Dx, b.x), iy0 = Math.max(Dy, b.y), ix1 = Math.min(Dx + Dw, b.x + b.w), iy1 = Math.min(Dy + Dh, b.y + b.h);
    try { x.imageSmoothingQuality = "medium"; } catch (e) { }
    if (ix1 > ix0 && iy1 > iy0) x.drawImage(img, (ix0 - Dx) / Dw * d[0], (iy0 - Dy) / Dh * d[1], (ix1 - ix0) / Dw * d[0], (iy1 - iy0) / Dh * d[1], ix0, iy0, ix1 - ix0, iy1 - iy0);
  }
  if (view) { x.translate(b.x, b.y); x.scale(view.s, view.s); x.translate(-view.vx, -view.vy); x.translate(-b.x, -b.y); }
  if (d && !view) {
    const cr = containRect(d, b);
    const cv = R.slideStatic ? scaledSlide(img, cr.w, cr.h) : null;
    if (cv) x.drawImage(cv, Math.round(cr.x), Math.round(cr.y));
    else x.drawImage(img, cr.x, cr.y, cr.w, cr.h);
  }
  else if (!d) placeholder(x, b, idx != null && (R.f.slides || []).length ? `Diapo ${idx + 1}` : "Diapo", R.u, false);
  const sv = slideVideoFor(R, idx);
  if (sv) {
    const v = safeVideo(R.f, sv.clipId, "slideVideo"), vd = srcDims(v);
    if (vd) {
      if (sv.fit === "cover") drawCover(x, v, vd, b);
      else { const cr = containRect(vd, b); x.fillStyle = "#000"; x.fillRect(cr.x, cr.y, cr.w, cr.h); x.drawImage(v, cr.x, cr.y, cr.w, cr.h); }
    }
  }
  x.restore();
}

// Slide element: frame + content (with slide-to-slide transition if active)
function drawSlideEl(c, R, el) {
  const { S, u } = R, b = el.box, r = el.r;
  if (el.alpha <= 0.002 || b.w < 1 || b.h < 1) return;
  c.save();
  c.globalAlpha *= el.alpha;
  applyTf(c, b, el.tf);
  frameShadow(c, S, u, b, r);
  c.save(); rr(c, b.x, b.y, b.w, b.h, r); c.clip();
  if (el.trans) drawSlideTransition(c, R, b, el.trans); else paintSlide(c, R, b, R.st.slide);
  c.restore();
  if (S.slideBorder > 0) { c.lineWidth = S.slideBorder * u; c.strokeStyle = R.accent; const i = S.slideBorder * u / 2; rr(c, b.x + i, b.y + i, b.w - 2 * i, b.h - 2 * i, Math.max(0, r - i)); c.stroke(); }
  c.restore();
}

function drawSlideTransition(c, R, b, T) {
  const { a, b: nb, k, type, dir } = T, u = R.u;
  const e = eIO(k);
  switch (type) {
    case "fade": paintSlide(c, R, b, a); c.globalAlpha *= e; paintSlide(c, R, b, nb); break;
    case "slide": {
      c.save(); c.translate(-dir * b.w * e, 0); paintSlide(c, R, b, a); c.restore();
      c.save(); c.translate(dir * b.w * (1 - e), 0); paintSlide(c, R, b, nb);
      // soft leading-edge shadow
      const ex = dir > 0 ? b.x : b.x + b.w, g = c.createLinearGradient(ex, 0, ex - dir * 40 * u, 0);
      g.addColorStop(0, `rgba(0,0,0,${0.25 * (1 - e)})`); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(Math.min(ex, ex - dir * 40 * u), b.y, 40 * u, b.h);
      c.restore(); break;
    }
    case "zoom": {
      const ga = c.globalAlpha, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      c.save(); c.translate(cx, cy); c.scale(1 + 0.18 * e, 1 + 0.18 * e); c.translate(-cx, -cy); paintSlide(c, R, b, a); c.restore();
      c.save(); c.globalAlpha = ga * eOut(c01(k * 1.25)); const s = 0.86 + 0.14 * eOutQ(k); c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy); paintSlide(c, R, b, nb); c.restore();
      break;
    }
    case "curtain": {
      paintSlide(c, R, b, nb);
      const half = b.w / 2, off = half * e;
      c.save(); c.translate(-off, 0); c.beginPath(); c.rect(b.x, b.y, half, b.h); c.clip(); paintSlide(c, R, b, a); c.restore();
      c.save(); c.translate(off, 0); c.beginPath(); c.rect(b.x + half, b.y, half, b.h); c.clip(); paintSlide(c, R, b, a); c.restore();
      if (e > 0 && e < 1) {
        const sw = 46 * u, al = 0.35 * (1 - e);
        let g = c.createLinearGradient(b.x + half - off, 0, b.x + half - off + sw, 0); g.addColorStop(0, `rgba(0,0,0,${al})`); g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g; c.fillRect(b.x + half - off, b.y, sw, b.h);
        g = c.createLinearGradient(b.x + half + off, 0, b.x + half + off - sw, 0); g.addColorStop(0, `rgba(0,0,0,${al})`); g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g; c.fillRect(b.x + half + off - sw, b.y, sw, b.h);
      }
      break;
    }
    case "blur": {
      const amt = Math.sin(Math.PI * k) * 26 * u;
      if (!HAS_FILTER) { paintSlide(c, R, b, a); c.globalAlpha *= e; paintSlide(c, R, b, nb); break; }
      const ga = c.globalAlpha;
      // crossfade around the midpoint
      paintSlide(c, R, b, a);
      c.globalAlpha = ga * c01((k - 0.3) / 0.4); paintSlide(c, R, b, nb);
      c.globalAlpha = ga;
      // blurred low-res layer on top (cheap)
      const q = 0.25, lw = b.w * q, lh = b.h * q;
      const o1 = off(3, lw, lh), o2 = off(4, lw, lh);
      const lb = { x: 0, y: 0, w: lw, h: lh };
      paintSlide(o1.x, R, lb, a, R.view ? { s: R.view.s, vx: R.view.vx * q, vy: R.view.vy * q } : null);
      o1.x.globalAlpha = c01((k - 0.3) / 0.4); paintSlide(o1.x, R, lb, nb, R.view ? { s: R.view.s, vx: R.view.vx * q, vy: R.view.vy * q } : null);
      o2.x.filter = `blur(${Math.max(0.5, amt * q)}px)`; o2.x.drawImage(o1.cv, 0, 0, o1.w, o1.h, 0, 0, lw, lh); o2.x.filter = "none";
      c.globalAlpha = ga * c01(amt / (7 * u));
      c.drawImage(o2.cv, 0, 0, o2.w, o2.h, b.x, b.y, b.w, b.h);
      c.globalAlpha = ga;
      break;
    }
    case "wipe": {
      paintSlide(c, R, b, a);
      const slant = b.h * 0.45, front = lerp(-slant, b.w + slant, e);
      c.save();
      c.beginPath(); c.moveTo(b.x - 2, b.y); c.lineTo(b.x + front + slant / 2, b.y); c.lineTo(b.x + front - slant / 2, b.y + b.h); c.lineTo(b.x - 2, b.y + b.h); c.closePath(); c.clip();
      paintSlide(c, R, b, nb); c.restore();
      if (k > 0 && k < 1) {
        c.save(); c.beginPath(); c.moveTo(b.x + front + slant / 2, b.y); c.lineTo(b.x + front - slant / 2, b.y + b.h);
        c.strokeStyle = rgba(R.accent, 0.35); c.lineWidth = 22 * u; c.stroke();
        c.strokeStyle = R.accent; c.lineWidth = 7 * u; c.stroke(); c.restore();
      }
      break;
    }
    case "cube": drawCube(c, R, b, a, nb, k, dir); break;
    case "glitch": drawGlitch(c, R, b, a, nb, k); break;
    case "flash": {
      paintSlide(c, R, b, k < 0.5 ? a : nb);
      const fl = 1 - Math.abs(k - 0.5) * 2, ga = c.globalAlpha;
      c.globalAlpha = ga * Math.pow(c01(fl), 1.6) * 0.92; c.fillStyle = R.accent; c.fillRect(b.x, b.y, b.w, b.h);
      c.globalAlpha = ga * Math.pow(c01(fl), 5) * 0.75; c.fillStyle = "#fff"; c.fillRect(b.x, b.y, b.w, b.h);
      c.globalAlpha = ga; break;
    }
    default: paintSlide(c, R, b, nb);
  }
}

function drawCube(c, R, b, ia, ib, k, dir) {
  const e = eIO(k), th = e * Math.PI / 2, ang = dir * th;
  const oA = off(0, b.w, b.h), oB = off(1, b.w, b.h);
  const lb = { x: 0, y: 0, w: b.w, h: b.h };
  paintSlide(oA.x, R, lb, ia); paintSlide(oB.x, R, lb, ib);
  c.fillStyle = "#0b0f17"; c.fillRect(b.x, b.y, b.w, b.h);
  const s = b.w / 2, D = b.w * 2.2, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const zf = 1 - 0.14 * Math.sin(Math.PI * e);
  const cosA = Math.cos(ang), sinA = Math.sin(ang), N = 40;
  const proj = (x, z) => { const xr = x * cosA + z * sinA, zr = -x * sinA + z * cosA; const k2 = D / (D + s + zr); return [cx + xr * k2 * zf, k2 * zf]; };
  const face = (o, pt, shade) => {
    let px = proj(...pt(0));
    const first = px; let last = px, drawn = false;
    for (let i = 1; i <= N; i++) {
      const pp = proj(...pt(i / N));
      const x0 = px[0], x1 = pp[0];
      if (x1 - x0 > 0.01) {
        const h = b.h * (px[1] + pp[1]) / 2;
        c.drawImage(o.cv, (i - 1) / N * b.w, 0, b.w / N, b.h, x0, cy - h / 2, x1 - x0 + 0.75, h);
        drawn = true;
      }
      px = pp; last = pp;
    }
    if (drawn && shade > 0.01 && last[0] > first[0]) {
      const h0 = b.h * first[1], h1 = b.h * last[1];
      c.beginPath(); c.moveTo(first[0], cy - h0 / 2); c.lineTo(last[0], cy - h1 / 2); c.lineTo(last[0], cy + h1 / 2); c.lineTo(first[0], cy + h0 / 2); c.closePath();
      c.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`; c.fill();
    }
  };
  // old front face: x = (2t-1)s, z = -s
  face(oA, t => [(2 * t - 1) * s, -s], 0.4 * Math.sin(th));
  // new face: dir=1 -> right face x=s, z from -s..s ; dir=-1 -> left face x=-s with texture reversed
  if (dir > 0) face(oB, t => [s, (2 * t - 1) * s], 0.4 * Math.cos(th));
  else face(oB, t => [-s, (1 - 2 * t) * s], 0.4 * Math.cos(th));
}

function drawGlitch(c, R, b, ia, ib, k) {
  const seed = Math.floor(k * 14), rnd = mulberry32(seed * 7919 + 13);
  const idx = k > 0.55 ? ib : (rnd() < 0.3 ? ib : ia);
  const w = b.w, h = b.h, u = R.u, lb = { x: 0, y: 0, w, h };
  const oS = off(0, w, h), oR = off(1, w, h), oC = off(2, w, h);
  paintSlide(oS.x, R, lb, idx);
  // red copy
  oR.x.drawImage(oS.cv, 0, 0, w, h, 0, 0, w, h); oR.x.globalCompositeOperation = "multiply"; oR.x.fillStyle = "#ff0000"; oR.x.fillRect(0, 0, w, h); oR.x.globalCompositeOperation = "source-over";
  // cyan copy
  oC.x.drawImage(oS.cv, 0, 0, w, h, 0, 0, w, h); oC.x.globalCompositeOperation = "multiply"; oC.x.fillStyle = "#00ffff"; oC.x.fillRect(0, 0, w, h); oC.x.globalCompositeOperation = "source-over";
  const amp = Math.sin(Math.PI * k) * 26 * u;
  const dx = amp * (0.6 + rnd() * 0.8);
  // compose RGB split into oS
  oS.x.fillStyle = "#000"; oS.x.fillRect(0, 0, w, h);
  oS.x.globalCompositeOperation = "lighter";
  oS.x.drawImage(oR.cv, 0, 0, w, h, -dx, 0, w, h);
  oS.x.drawImage(oC.cv, 0, 0, w, h, dx, 0, w, h);
  oS.x.globalCompositeOperation = "source-over";
  c.drawImage(oS.cv, 0, 0, w, h, b.x, b.y, w, h);
  // displaced slices
  const n = 6 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const sy = rnd() * h, sh = (4 + rnd() * 50) * u, off2 = (rnd() - 0.5) * amp * 5;
    c.drawImage(oS.cv, 0, sy, w, Math.min(sh, h - sy), b.x + off2, b.y + sy, w, Math.min(sh, h - sy));
  }
  // scanline tint
  c.fillStyle = rgba(R.accent, 0.12 * Math.sin(Math.PI * k)); c.fillRect(b.x, b.y + rnd() * h, w, 3 * u);
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */
function frNum(v, d) {
  d = clamp(d | 0, 0, 6);
  const neg = v < 0; const s = Math.abs(v).toFixed(d);
  let [i, fr] = s.split(".");
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (neg ? "−" : "") + i + (fr ? "," + fr : "");
}

function drawTextOv(c, R, ov, t, T) {
  const { W, H } = R, u = H / 1080, F = fontOf(R.S);
  const size = Math.max(6, (+ov.size || 64) * u), weight = ov.weight || 800;
  const text = String(ov.text == null ? "" : ov.text);
  if (!text.trim()) return;
  const pi = c01(t / 0.55), po = c01((t - (T - 0.4)) / 0.4);
  let alpha = 1, dx = 0, dy = 0, sc = 1, chars = Infinity;
  const anim = ov.anim || "up";
  if (anim === "fade") alpha = eOut(pi);
  else if (anim === "up") { alpha = eOut(c01(pi * 1.3)); dy = (1 - eOutQ(pi)) * size * 0.7; }
  else if (anim === "pop") { alpha = c01(pi * 3); sc = 0.55 + 0.45 * eBack(pi); }
  else if (anim === "slide") { alpha = eOut(c01(pi * 1.5)); dx = -(1 - eOutQ(pi)) * W * 0.18; }
  else if (anim === "type") { const total = text.length; chars = Math.floor(total * c01(t / Math.max(0.35, total * 0.04))); }
  if (po > 0) { const e = eIO(po); alpha *= 1 - e; dy -= e * size * 0.3; }
  if (alpha <= 0.002) return;
  c.save();
  c.globalAlpha *= alpha;
  c.font = `${weight} ${size}px ${F}`;
  const lines = text.split("\n");
  const lh = size * 1.18;
  let maxW = 0; for (const l of lines) maxW = Math.max(maxW, c.measureText(l).width);
  const align = ov.align === "left" || ov.align === "right" ? ov.align : "center";
  const x = (+ov.x || 0) * W + dx, y = (+ov.y || 0) * H + dy;
  const totalH = lh * lines.length;
  const top = y - totalH / 2;
  const left = align === "left" ? x : align === "right" ? x - maxW : x - maxW / 2;
  if (sc !== 1) { c.translate(left + maxW / 2, y); c.scale(sc, sc); c.translate(-(left + maxW / 2), -y); }
  if (ov.bgOn) {
    const pad = size * 0.38, py = size * 0.24;
    c.shadowColor = "rgba(0,0,0,0.3)"; c.shadowBlur = 24 * u; c.shadowOffsetY = 6 * u;
    rr(c, left - pad, top - py, maxW + pad * 2, totalH + py * 2, size * 0.32); c.fillStyle = ov.bg || "#000"; c.fill();
    shadowOff(c);
  } else { c.shadowColor = "rgba(0,0,0,0.5)"; c.shadowBlur = 18 * u; c.shadowOffsetY = 3 * u; }
  c.fillStyle = ov.color || "#fff"; c.textBaseline = "middle"; c.textAlign = align;
  let shown = 0;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (chars !== Infinity) { const rem = chars - shown; shown += l.length; if (rem <= 0) break; if (rem < l.length) l = l.slice(0, rem); }
    c.fillText(l, x, top + lh * (i + 0.5) + size * 0.04);
    if (chars !== Infinity && shown >= chars && chars < text.length && Math.floor(t * 2.5) % 2 === 0) {
      const lw = c.measureText(l).width, cxp = align === "left" ? x + lw : align === "right" ? x : x + lw / 2;
      c.fillRect(cxp + size * 0.06, top + lh * i + lh * 0.18, size * 0.07, lh * 0.64);
    }
  }
  c.restore();
}

function drawNumberOv(c, R, ov, t, T) {
  const { W, H } = R, u = H / 1080, F = fontOf(R.S);
  const size = Math.max(8, (+ov.size || 150) * u);
  const cd = Math.max(0.05, +ov.countDur || 1.6);
  const from = +ov.from || 0, to = +ov.value || 0;
  const v = lerp(from, to, eOut(c01((t - 0.15) / cd)));
  const pi = c01(t / 0.6), po = c01((t - (T - 0.4)) / 0.4);
  let alpha = c01(pi * 3) * (1 - eIO(po)), sc = 0.6 + 0.4 * eBack(pi);
  if (alpha <= 0.002) return;
  const txt = `${ov.prefix || ""}${frNum(v, ov.decimals)}${ov.suffix || ""}`;
  const finalTxt = `${ov.prefix || ""}${frNum(to, ov.decimals)}${ov.suffix || ""}`;
  const x = (+ov.x || 0) * W, y = (+ov.y || 0) * H - po * 20 * u;
  c.save();
  c.globalAlpha *= alpha;
  c.translate(x, y); c.scale(sc, sc); c.translate(-x, -y);
  c.font = `900 ${size}px ${F}`; c.textAlign = "center"; c.textBaseline = "alphabetic";
  const fw = c.measureText(finalTxt).width;
  c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 30 * u; c.shadowOffsetY = 8 * u;
  c.fillStyle = ov.color || "#fff";
  const base = y + size * 0.35;
  c.fillText(txt, x, base);
  shadowOff(c);
  // accent underline
  const lw = fw * 0.42 * eOutQ(c01((t - 0.35) / 0.7)), lh = Math.max(3, size * 0.055);
  if (lw > 1) { rr(c, x - lw / 2, base + size * 0.12, lw, lh, lh / 2); c.fillStyle = R.accent; c.fill(); }
  if (ov.label) {
    const ls = size * 0.3, la = c01((t - 0.45) / 0.5);
    c.globalAlpha *= eOut(la);
    c.font = `600 ${ls}px ${F}`; c.fillStyle = ov.color || "#fff";
    c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = 16 * u; c.shadowOffsetY = 3 * u;
    c.fillText(String(ov.label), x, base + size * 0.17 + lh + ls * 1.05 + (1 - eOut(la)) * 12 * u);
  }
  c.restore();
}

function zoomView(R, b) {
  // Returns {s, vx, vy} in box-local px or null. Uses the last active zoom overlay.
  let z = null;
  for (const a of R.ovs) if (a.ov.type === "zoom" && a.ov.rect) z = a;
  if (!z) return null;
  const sp = R.speed, t = z.local / sp, T = z.ov.dur / sp;
  const inD = Math.max(0.05, +z.ov.inDur || 0.7), outD = Math.max(0.05, +z.ov.outDur || 0.7);
  const p = eIO(c01(t / inD)) * (1 - eIO(c01((t - (T - outD)) / outD)));
  if (p <= 0.0005) return null;
  const rc = z.ov.rect, bw = b.w, bh = b.h, ba = bw / bh;
  let rw = clamp(+rc.w || 0.5, 0.02, 1) * bw, rh = clamp(+rc.h || 0.5, 0.02, 1) * bh;
  if (rw / rh > ba) rh = rw / ba; else rw = rh * ba;
  if (rw > bw) { rw = bw; rh = bw / ba; } if (rh > bh) { rh = bh; rw = bh * ba; }
  const rcx = ((+rc.x || 0) + (+rc.w || 0) / 2) * bw, rcy = ((+rc.y || 0) + (+rc.h || 0) / 2) * bh;
  const sA = bw / rw;
  const s = Math.exp(Math.log(sA) * p);
  const wgt = sA > 1.0001 ? (s - 1) / (sA - 1) : p;
  const vw = bw / s, vh = bh / s;
  const cx = lerp(bw / 2, rcx, wgt), cy = lerp(bh / 2, rcy, wgt);
  return { s, vx: clamp(cx - vw / 2, 0, bw - vw), vy: clamp(cy - vh / 2, 0, bh - vh) };
}

function drawBroll(c, R, ov, t, T) {
  const { W, H, u } = R;
  const a = eOut(c01(t / 0.35)) * eOut(c01((T - t) / 0.35));
  if (a <= 0.002) return;
  const useSlide = ov.area === "slide" && R.slideBox;
  const b = useSlide ? R.slideBox : { x: 0, y: 0, w: W, h: H };
  const r = useSlide ? R.S.radius * u : 0;
  const clip = clipById(ov.clipId);
  let src = null;
  if (clip && clip.kind === "image") src = safeImage(R.f, ov.clipId);
  else if (ov.clipId) src = safeVideo(R.f, ov.clipId, "broll") || safeImage(R.f, ov.clipId);
  const d = srcDims(src);
  c.save();
  c.globalAlpha *= a;
  if (useSlide) { frameShadow(c, R.S, u, b, r); rr(c, b.x, b.y, b.w, b.h, r); c.fillStyle = "#000"; c.fill(); }
  rr(c, b.x, b.y, b.w, b.h, r); c.clip();
  if (d) {
    const isImg = !(typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement);
    let s = 1 + 0.03 * (1 - eOut(c01(t / 0.6))), dx = 0, dy = 0;
    if (isImg && ov.kenBurns !== false) {
      const p = c01(t / Math.max(0.5, T)), h = hashStr(ov.id);
      s = (1 + 0.12 * p) * s; dx = ((h & 1) ? 1 : -1) * 0.035 * b.w * (p - 0.5); dy = ((h & 2) ? 1 : -1) * 0.025 * b.h * (p - 0.5);
    }
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    c.translate(cx + dx, cy + dy); c.scale(s, s); c.translate(-cx, -cy);
    drawCover(c, src, d, b);
  } else { c.fillStyle = "#111827"; c.fillRect(b.x, b.y, b.w, b.h); placeholder(c, b, "B-roll", u); }
  c.restore();
}

/* ------------------------------------------------------------------ */
/* Chrome: header, logo, slide number, banner, progress                */
/* ------------------------------------------------------------------ */
function drawHeader(c, R, L, alpha) {
  const { S, W, H, u, f } = R;
  if (S.headerText && alpha > 0.01) {
    c.save(); c.globalAlpha *= alpha;
    c.fillStyle = S.headerColor; c.font = `700 ${34 * u}px ${fontOf(S)}`; c.textBaseline = "middle";
    const logoLeft = S.logoPos === "tl" && f.logoImage;
    const hx = logoLeft ? L.m + S.logoSize * W / 100 + 24 * u : L.m;
    const hy = L.m + L.headerH / 2 - 6 * u;
    c.fillText(S.headerText, hx, hy);
    rr(c, hx, hy + 26 * u, 70 * u, 5 * u, 2.5 * u); c.fillStyle = R.accent; c.fill();
    c.restore();
  }
  const lg = f.logoImage, d = srcDims(lg);
  if (d) {
    const lw = S.logoSize * W / 100, lh = lw * d[1] / d[0], pad = Math.max(L.m, 24 * u) * 0.8;
    const pos = S.logoPos || "tr";
    const lx = pos.includes("l") ? pad : W - pad - lw, ly = pos.includes("t") ? pad : H - pad - lh - (S.progressOn ? 8 * u : 0);
    c.drawImage(lg, lx, ly, lw, lh);
  }
}
function drawSlideNum(c, R, b, alpha) {
  const { S, u, f } = R;
  const n = (f.slides || []).length;
  if (!S.slideNumOn || !n || !b || alpha < 0.01) return;
  c.save(); c.globalAlpha *= alpha;
  c.font = `700 ${22 * u}px ${fontOf(S)}`;
  const txt = `${(R.st.slide | 0) + 1} / ${n}`, w = c.measureText(txt).width + 26 * u, h = 34 * u;
  const x = b.x + b.w - w - 14 * u, y = b.y + b.h - h - 14 * u;
  rr(c, x, y, w, h, h / 2); c.fillStyle = "rgba(10,14,22,0.66)"; c.fill();
  c.fillStyle = "#fff"; c.textBaseline = "middle"; c.textAlign = "center"; c.fillText(txt, x + w / 2, y + h / 2 + u);
  c.restore();
}
function drawBanner(c, R, name, sub, t, camBox, color, inside = false) {
  const { S, W, H, u } = R;
  if (!S.bannerOn || !(name || sub)) return;
  const dur = +S.bannerDur || 0;
  if (t < 0 || (dur > 0 && t > dur + 0.6)) return;
  const pIn = c01(t / 0.7), pOut = dur > 0 ? c01((t - dur) / 0.6) : 0;
  const F = fontOf(S), fs1 = 40 * u, fs2 = 24 * u, padX = 26 * u, padY = 16 * u, bar = 6 * u;
  c.save();
  c.font = `800 ${fs1}px ${F}`; const w1 = name ? c.measureText(name).width : 0;
  c.font = `500 ${fs2}px ${F}`; const w2 = sub ? c.measureText(sub).width : 0;
  const bw = Math.max(w1, w2) + padX * 2 + bar + 14 * u, bh = (name ? fs1 * 1.18 : 0) + (sub ? fs2 * 1.4 : 0) + padY * 2;
  let x, y;
  const pos = S.bannerPos;
  if (pos === "cam" && camBox) {
    x = camBox.x + (camBox.w - bw) / 2; y = camBox.y + camBox.h + 18 * u;
    if (inside || y + bh > H - 14 * u) y = camBox.y + camBox.h - bh - 18 * u;
    x = clamp(x, 14 * u, W - bw - 14 * u);
  } else if (pos === "br") { x = W - bw - 60 * u; y = H - bh - 64 * u; }
  else { x = 60 * u; y = H - bh - 64 * u; }
  const bg = color || S.bannerBg, fg = color ? onColor(color) : S.bannerFg;
  const reveal = eOutQ(pIn), out = eIO(pOut);
  c.globalAlpha *= 1 - out;
  c.translate(0, out * 14 * u);
  // reveal from left (clip), then text slides in
  c.save();
  c.beginPath(); c.rect(x - 60 * u, y - 60 * u, (bw + 60 * u) * reveal + 60 * u, bh + 120 * u); c.clip();
  c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 30 * u; c.shadowOffsetY = 10 * u;
  rr(c, x, y, bw, bh, 14 * u); c.fillStyle = bg; c.fill(); shadowOff(c);
  rr(c, x + padX - 4 * u, y + padY, bar, bh - padY * 2, bar / 2); c.fillStyle = rgba(fg === "#ffffff" ? "#ffffff" : fg, 0.9); c.fill();
  const tIn = eOutQ(c01((t - 0.18) / 0.6));
  c.globalAlpha *= tIn;
  const tx = x + padX + bar + 10 * u + (1 - tIn) * -18 * u;
  let ty = y + padY; c.textBaseline = "top"; c.fillStyle = fg;
  if (name) { c.font = `800 ${fs1}px ${F}`; c.fillText(name, tx, ty + fs1 * 0.04); ty += fs1 * 1.18; }
  if (sub) { c.font = `500 ${fs2}px ${F}`; c.globalAlpha *= 0.82; c.fillText(sub, tx, ty + fs2 * 0.2); }
  c.restore();
  c.restore();
}
function drawProgress(c, R) {
  const { S, W, H, u, f } = R;
  if (!S.progressOn || !(f.duration > 0)) return;
  const p = c01((f.outT || 0) / f.duration), h = 6 * u;
  c.save();
  c.fillStyle = "rgba(255,255,255,0.14)"; c.fillRect(0, H - h, W, h);
  c.fillStyle = R.accent; c.fillRect(0, H - h, W * p, h);
  c.fillStyle = "rgba(255,255,255,0.5)"; c.fillRect(Math.max(0, W * p - 3 * u), H - h, 3 * u, h);
  c.restore();
}

/* ------------------------------------------------------------------ */
/* Talk                                                                */
/* ------------------------------------------------------------------ */
function sceneEls(R, kind) {
  const L = computeLayout(R.W, R.H, R.part, kind, R.S, R.f.slides);
  const rad = R.S.radius * R.u, circle = R.S.camShape === "circle" && L.duo !== "side";
  const camR = bx => kind === "cam" ? 0 : circle ? Math.min(bx.w, bx.h) / 2 : rad;
  const els = { L };
  if (L.slide) els.slide = { box: L.slide, r: rad, full: 0, alpha: 1, tf: null };
  if (L.cam) els.cam = { box: L.cam, r: camR(L.cam), full: kind === "cam" ? 1 : 0, alpha: 1, tf: null };
  if (L.camB) els.camB = { box: L.camB, r: camR(L.camB), full: 0, alpha: 1, tf: null };
  return els;
}
function prevSpanType(span) {
  try { const p = store._program || program(); const s = p.spans[(span.i | 0) - 1]; return s ? s.type : null; } catch (e) { return null; }
}

function drawTalk(c, R) {
  const { f, S, span, part } = R;
  const st = R.st = slideStateAt(part, f.srcT);
  R.ovs = activeOverlays(part, f.srcT);
  drawBackground(c, R);
  const speed = R.speed;
  const transDur = Math.max(0.05, +S.transDur || 0.45);
  const changing = st.changeT != null && st.trans !== "cut";
  const kindChange = changing && st.prevKind !== st.kind && st.since < transDur;
  const cur = sceneEls(R, st.kind);
  let els;
  if (kindChange) {
    const prev = sceneEls(R, st.prevKind), e = eIO(c01(st.since / transDur));
    els = { L: cur.L };
    for (const key of ["slide", "cam", "camB"]) {
      const A = prev[key], B = cur[key];
      if (A && B) els[key] = { box: lerpBox(A.box, B.box, e), r: lerp(A.r, B.r, e), full: lerp(A.full, B.full, e), alpha: 1, tf: null };
      else if (A) els[key] = { ...A, alpha: 1 - e, tf: { s: 1 - 0.05 * e } };
      else if (B) els[key] = { ...B, alpha: e, tf: { s: 0.95 + 0.05 * e }, entering: true };
    }
  } else els = cur;
  R.L = cur.L;
  R.slideBox = cur.L.slide;
  R.slideStatic = !kindChange;
  // camera entrance: part start, or coming back to pip from slide-only
  if (st.kind === "pip" && S.camEnter !== "none") {
    const ed = Math.max(0.05, +S.camEnterDur || 0.6);
    let tE = null;
    if (span.firstOfPart && f.local < ed + 0.2 && (st.changeT == null || st.since * 1 > (f.srcT - span.srcStart) - 1e-6)) tE = f.local;
    if (st.changeT != null && st.prevKind === "slide" && st.since / speed < ed + 0.2) tE = st.since / speed;
    if (tE != null) {
      for (const [key, delay] of [["cam", 0], ["camB", 0.12]]) {
        const el = els[key]; if (!el) continue;
        const en = camEnterTf(R, el.box, (tE - delay) / ed, S.camSide);
        els[key] = { ...el, alpha: en.alpha, tf: en.tf };
      }
    }
  }
  // slide fade-up when the part starts after a non-talk span
  if (span.firstOfPart && f.local < 0.6 && els.slide && !kindChange) {
    const pt = prevSpanType(span);
    if (pt && pt !== "talk") { const p = c01(f.local / 0.55); els.slide = { ...els.slide, alpha: eOut(p), tf: { dy: (1 - eOutQ(p)) * 26 * R.u, s: 0.985 + 0.015 * eOut(p) } }; }
  }
  // slide-to-slide transition
  if (els.slide) {
    R.view = zoomView(R, els.slide.box);
    if (changing && !kindChange && st.prevKind === st.kind && st.slide !== st.prevSlide) {
      const dur = st.trans === "glitch" ? 0.25 * speed : transDur;
      if (st.since < dur) els.slide = { ...els.slide, trans: { a: st.prevSlide, b: st.slide, k: c01(st.since / dur), type: st.trans, dir: st.slide > st.prevSlide ? 1 : -1 } };
    }
    drawSlideEl(c, R, els.slide);
  }
  const camCfg = part.cam || {}, bCfg = part.camB || {};
  if (els.camB) drawCamEl(c, R, els.camB, safeVideo(f, part.camB && part.camB.clipId, "camB"), bCfg);
  if (els.cam) drawCamEl(c, R, els.cam, safeVideo(f, span.clipId, "main"), camCfg);
  // overlays in list order
  for (const a of R.ovs) {
    const ov = a.ov, t = a.local / speed, T = (+ov.dur || 0) / speed;
    try {
      if (ov.type === "text") drawTextOv(c, R, ov, t, T);
      else if (ov.type === "number") drawNumberOv(c, R, ov, t, T);
      else if (ov.type === "broll") drawBroll(c, R, ov, t, T);
    } catch (e) { warnOnce("overlay", e); }
  }
  const camness = els.cam ? (els.cam.full || 0) * (els.cam.alpha == null ? 1 : els.cam.alpha) : 0;
  const chromeA = 1 - camness;
  drawHeader(c, R, cur.L, chromeA);
  drawSlideNum(c, R, els.slide ? els.slide.box : null, chromeA * (els.slide ? els.slide.alpha : 0));
  if (span.firstOfPart && part.member) {
    const camBox = st.kind === "pip" && cur.L.cam && !kindChange ? cur.L.cam : null;
    drawBanner(c, R, (part.member.name || "").trim(), (part.member.sub || "").trim(), f.local, camBox, part.member.color || null, !!cur.L.duo);
  }
  drawProgress(c, R);
}

/* ------------------------------------------------------------------ */
/* Extract                                                             */
/* ------------------------------------------------------------------ */
function drawExtract(c, R) {
  const { f, S, W, H, u, span, part } = R;
  const v = safeVideo(f, span.clipId, "main"), d = srcDims(v);
  const t = f.local || 0;
  if (part.display === "frame") {
    drawBackground(c, R);
    const asp = d ? d[0] / d[1] : 16 / 9;
    const box = fitBox(W, H * 0.92, asp, Math.min(W, H) * 0.1); box.y -= H * 0.01;
    const p = c01(t / 0.55);
    const s = span.firstOfPart ? 0.94 + 0.06 * eOutQ(p) : 1, a = span.firstOfPart ? eOut(p) : 1;
    const r = S.radius * u;
    c.save(); c.globalAlpha *= a;
    applyTf(c, box, { s });
    frameShadow(c, S, u, box, r); rr(c, box.x, box.y, box.w, box.h, r); c.fillStyle = "#000"; c.fill();
    c.save(); rr(c, box.x, box.y, box.w, box.h, r); c.clip();
    if (d) drawCover(c, v, d, box); else placeholder(c, box, "Extrait", u);
    c.restore();
    if (S.camBorder > 0) { c.lineWidth = S.camBorder * u; c.strokeStyle = R.accent; rr(c, box.x, box.y, box.w, box.h, r); c.stroke(); }
    c.restore();
  } else {
    c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
    if (d) {
      const va = d[0] / d[1], fa = W / H;
      if (Math.abs(va - fa) / fa > 0.04) {
        // blurred cover copy (cheap: tiny canvas upscaled) + contained clip
        const o = off(5, 64, 36);
        drawCover(o.x, v, d, { x: 0, y: 0, w: 64, h: 36 });
        o.x.fillStyle = "rgba(0,0,0,0.4)"; o.x.fillRect(0, 0, 64, 36);
        c.save(); c.imageSmoothingEnabled = true; try { c.imageSmoothingQuality = "low"; } catch (e) { }
        const cr = containRect(d, { x: 0, y: 0, w: W, h: H });
        // only the visible bands (left/right or top/bottom) of the blurred copy
        const bx = -W * 0.05, by = -H * 0.05, bw = W * 1.1, bh = H * 1.1, sxk = 64 / bw, syk = 36 / bh;
        const band = (x0, y0, x1, y1) => { if (x1 - x0 < 1 || y1 - y0 < 1) return; c.drawImage(o.cv, (x0 - bx) * sxk, (y0 - by) * syk, (x1 - x0) * sxk, (y1 - y0) * syk, x0, y0, x1 - x0, y1 - y0); };
        if (cr.x > 1) { band(0, 0, cr.x + 2, H); band(cr.x + cr.w - 2, 0, W, H); } else { band(0, 0, W, cr.y + 2); band(0, cr.y + cr.h - 2, W, H); }
        try { c.imageSmoothingQuality = "high"; } catch (e) { }
        c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 50 * u;
        c.fillStyle = "#000"; c.fillRect(cr.x, cr.y, cr.w, cr.h); shadowOff(c);
        c.drawImage(v, cr.x, cr.y, cr.w, cr.h);
        c.restore();
      } else drawCover(c, v, d, { x: 0, y: 0, w: W, h: H });
    } else placeholder(c, { x: 0, y: 0, w: W, h: H }, "Extrait", u);
  }
  // EXTRAIT tag
  {
    const a = eOut(c01(t / 0.5));
    c.save(); c.globalAlpha *= a;
    c.font = `800 ${22 * u}px ${fontOf(S)}`; setLS(c, 3 * u);
    const tw = c.measureText("EXTRAIT").width, h = 40 * u, w = tw + 30 * u + 18 * u;
    const x = 48 * u, y = 44 * u;
    c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 16 * u; c.shadowOffsetY = 4 * u;
    rr(c, x, y, w, h, h / 2); c.fillStyle = R.accent; c.fill(); shadowOff(c);
    const fg = onColor(R.accent);
    c.fillStyle = fg; c.beginPath(); c.arc(x + 20 * u, y + h / 2, 5 * u, 0, TAU);
    c.globalAlpha *= 0.55 + 0.45 * Math.abs(Math.sin((f.wall || 0) * 2.4)); c.fill(); c.globalAlpha = a;
    c.textBaseline = "middle"; c.fillText("EXTRAIT", x + 34 * u, y + h / 2 + u);
    setLS(c, 0); c.restore();
  }
  // lower third
  const label = (part.label || "").trim(), sub = (part.sub || "").trim();
  if (span.firstOfPart && (label || sub) && t < 4.9) {
    const pIn = c01((t - 0.35) / 0.65), pOut = c01((t - 4.3) / 0.55);
    if (pIn > 0) {
      const F = fontOf(S), fs1 = 44 * u, fs2 = 26 * u;
      c.save();
      c.font = `800 ${fs1}px ${F}`; const w1 = c.measureText(label).width;
      c.font = `500 ${fs2}px ${F}`; const w2 = c.measureText(sub).width;
      const pad = 26 * u, bw = Math.max(w1, w2) + pad * 2, bh = (label ? fs1 * 1.2 : 0) + (sub ? fs2 * 1.45 : 0) + pad * 1.2;
      const x = 64 * u, y = H - bh - 80 * u;
      const e = eOutQ(pIn), o = eIO(pOut);
      c.globalAlpha *= 1 - o;
      // accent bar grows, then panel reveals
      const barH = bh * e;
      rr(c, x, y + bh - barH, 8 * u, barH, 4 * u); c.fillStyle = R.accent; c.fill();
      const pw = bw * eOutQ(c01((t - 0.5) / 0.6));
      if (pw > 1) {
        c.save(); c.beginPath(); c.rect(x + 14 * u, y - 20 * u, pw, bh + 40 * u); c.clip();
        c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 26 * u; c.shadowOffsetY = 8 * u;
        rr(c, x + 14 * u, y, bw, bh, 12 * u); c.fillStyle = "rgba(10,14,22,0.82)"; c.fill(); shadowOff(c);
        c.textBaseline = "top"; let ty = y + pad * 0.6;
        const tx = x + 14 * u + pad - (1 - eOutQ(c01((t - 0.65) / 0.5))) * 20 * u;
        if (label) { c.font = `800 ${fs1}px ${F}`; c.fillStyle = "#fff"; c.fillText(label, tx, ty); ty += fs1 * 1.2; }
        if (sub) { c.font = `500 ${fs2}px ${F}`; c.fillStyle = "rgba(255,255,255,0.78)"; c.fillText(sub, tx, ty + fs2 * 0.15); }
        c.restore();
      }
      c.restore();
    }
  }
  drawProgress(c, R);
}

/* ------------------------------------------------------------------ */
/* Title scenes: cards, intro, outro                                   */
/* ------------------------------------------------------------------ */
const SHAPES = (() => { const r = mulberry32(4242), out = []; for (let i = 0; i < 12; i++) out.push({ x: r(), y: r(), s: 0.02 + r() * 0.05, type: i % 4, rot: r() * TAU, vr: (r() - 0.5) * 0.5, ph: r() * TAU, a: 0.1 + r() * 0.14, acc: r() < 0.6 }); return out; })();

function drawShapes(c, R, t, ink, accent, alpha) {
  const { W, H, u } = R;
  for (let i = 0; i < SHAPES.length; i++) {
    const sh = SHAPES[i];
    const p = c01((t - 0.1 - i * 0.05) / 0.7); if (p <= 0) continue;
    const sc = eBack(p), sz = sh.s * W * sc;
    const x = W * sh.x + Math.sin(t * 0.4 + sh.ph) * 18 * u, y = H * sh.y + Math.cos(t * 0.33 + sh.ph) * 14 * u;
    // keep the middle readable
    if (Math.abs(sh.x - 0.5) < 0.33 && Math.abs(sh.y - 0.5) < 0.3) continue;
    c.save(); c.translate(x, y); c.rotate(sh.rot + t * sh.vr);
    c.globalAlpha *= sh.a * c01(p * 2) * alpha;
    const col = sh.acc ? accent : ink;
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = Math.max(2, sz * 0.12);
    if (sh.type === 0) { c.beginPath(); c.arc(0, 0, sz / 2, 0, TAU); c.stroke(); }
    else if (sh.type === 1) { rr(c, -sz / 2, -sz / 2, sz, sz, sz * 0.22); c.stroke(); }
    else if (sh.type === 2) { c.beginPath(); c.arc(0, 0, sz * 0.18, 0, TAU); c.fill(); }
    else { const k = sz * 0.4, w = sz * 0.12; c.fillRect(-k, -w / 2, k * 2, w); c.fillRect(-w / 2, -k, w, k * 2); }
    c.restore();
  }
}

function drawWords(c, lines, size, x, yCenter, align, lh, t, delay, stagger, color, mask, slideX = 0) {
  const totalH = lh * lines.length;
  let i = 0;
  const space = c.measureText(" ").width;
  c.fillStyle = color; c.textBaseline = "alphabetic"; c.textAlign = "left";
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li], lw = c.measureText(line).width;
    const base = yCenter - totalH / 2 + lh * li + lh * 0.5 + size * 0.36;
    let cx = align === "center" ? x - lw / 2 : align === "right" ? x - lw : x;
    if (mask) { c.save(); c.beginPath(); c.rect(cx - size, base - size * 1.05, lw + size * 2, size * 1.38); c.clip(); }
    for (const w of line.split(" ")) {
      if (!w) { cx += space; continue; }
      const ww = c.measureText(w).width;
      const p = c01((t - delay - i * stagger) / 0.65), e = eOutQ(p);
      if (p > 0) {
        const ga = c.globalAlpha;
        if (!mask) c.globalAlpha = ga * c01(p * 1.8);
        c.fillText(w, cx + (1 - e) * slideX, base + (mask ? (1 - e) * size * 1.15 : (1 - e) * size * 0.5));
        c.globalAlpha = ga;
      }
      cx += ww + space; i++;
    }
    if (mask) c.restore();
  }
  return i;
}

function drawChips(c, R, names, x, y, align, maxW, t, delay, ink, accent, style) {
  if (!names.length) return;
  const u = R.u, F = fontOf(R.S), fs = 28 * u, h = 56 * u, padX = 24 * u, gap = 14 * u;
  c.font = `600 ${fs}px ${F}`;
  const widths = names.map(n => c.measureText(n).width + padX * 2);
  const rows = []; let row = [], rw = 0;
  widths.forEach((w, i) => { if (row.length && rw + gap + w > maxW) { rows.push({ row, rw }); row = []; rw = 0; } rw += (row.length ? gap : 0) + w; row.push(i); });
  if (row.length) rows.push({ row, rw });
  let k = 0;
  rows.forEach((r, ri) => {
    let cx = align === "center" ? x - r.rw / 2 : x;
    const cy = y + ri * (h + gap);
    for (const i of r.row) {
      const w = widths[i], p = c01((t - delay - k * 0.08) / 0.5);
      if (p > 0) {
        const s = 0.6 + 0.4 * eBack(p);
        c.save(); c.globalAlpha *= c01(p * 2.5);
        c.translate(cx + w / 2, cy + h / 2); c.scale(s, s); c.translate(-(cx + w / 2), -(cy + h / 2));
        rr(c, cx, cy, w, h, h / 2);
        if (style === "solid") { c.fillStyle = rgba(ink, 0.14); c.fill(); }
        else { c.fillStyle = rgba(ink, 0.07); c.fill(); c.lineWidth = 2 * u; c.strokeStyle = rgba(accent, 0.85); c.stroke(); }
        c.fillStyle = ink; c.textBaseline = "middle"; c.textAlign = "center"; c.fillText(names[i], cx + w / 2, cy + h / 2 + u);
        c.restore();
      }
      cx += w + gap; k++;
    }
  });
}

function drawLogoAt(c, R, cx, cy, maxH, alpha, align = "center") {
  const lg = R.f.logoImage, d = srcDims(lg);
  if (!d || alpha <= 0.01) return false;
  let h = maxH, w = h * d[0] / d[1];
  if (w > maxH * 3.2) { w = maxH * 3.2; h = w * d[1] / d[0]; }
  c.save(); c.globalAlpha *= alpha;
  c.drawImage(lg, align === "center" ? cx - w / 2 : cx, cy - h / 2, w, h);
  c.restore();
  return true;
}

function drawTitleScene(c, R, o) {
  const { W, H, u, S } = R;
  const t = o.t, T = Math.max(0.5, o.T), F = fontOf(S);
  const accent = o.accent, ink = S.headerColor || "#ffffff", onA = onColor(accent);
  const outD = o.rich ? 0.7 : 0.45;
  const pOut = c01((t - (T - outD)) / outD), outE = eIO(pOut);
  const title = (o.title || "").trim(), sub = (o.sub || "").trim(), names = o.names || [];
  const tpl = CARD_TEMPLATES.some(x => x.id === o.tpl) ? o.tpl : "reveal";
  c.save();
  if (o.rich && tpl !== "bold") drawShapes(c, R, t, ink, accent, 1 - outE);
  c.globalAlpha *= 1 - outE;
  if (pOut > 0) { c.translate(W / 2, H / 2); c.scale(1 + 0.03 * outE, 1 + 0.03 * outE); c.translate(-W / 2, -H / 2); }
  const titleFont = w => s => `${w} ${s}px ${F}`;

  if (tpl === "reveal") {
    // accent panel sweeping across
    const a = eIO(c01(t / 0.55)), b = eIO(c01((t - 0.2) / 0.55));
    if (b < 1) { c.fillStyle = accent; c.fillRect(W * b, 0, W * (a - b), H); }
    const logoY = H * 0.2;
    const hasLogo = o.rich && drawLogoAt(c, R, W / 2, logoY, 100 * u, eOut(c01((t - 0.35) / 0.6)));
    const ft = fitText(c, title || " ", titleFont(800), W * 0.8, 2, (o.rich ? 120 : 110) * u, 48 * u);
    c.font = titleFont(800)(ft.size);
    const lh = ft.size * 1.12, cy = H * (names.length ? 0.42 : 0.46) + (hasLogo ? 20 * u : 0);
    drawWords(c, ft.lines, ft.size, W / 2, cy, "center", lh, t, 0.35, 0.07, ink, true);
    const ly = cy + lh * ft.lines.length / 2 + 34 * u;
    const lw = 180 * u * eOutQ(c01((t - 0.6) / 0.6));
    if (lw > 1) { rr(c, W / 2 - lw / 2, ly, lw, 7 * u, 3.5 * u); c.fillStyle = accent; c.fill(); }
    let ny = ly + 50 * u;
    if (sub) {
      const p = c01((t - 0.75) / 0.6), fs = 42 * u;
      c.save(); c.globalAlpha *= eOut(p); c.font = `500 ${fs}px ${F}`; c.fillStyle = rgba(ink, 0.82); c.textAlign = "center"; c.textBaseline = "top";
      c.fillText(sub, W / 2, ly + 32 * u + (1 - eOutQ(p)) * 18 * u); c.restore();
      ny += fs * 1.3;
    }
    drawChips(c, R, names, W / 2, ny + 20 * u, "center", W * 0.8, t, 1.0, ink, accent);
  } else if (tpl === "split") {
    const p = eOutQ(c01(t / 0.75)), pw = W * 0.38, sk = W * 0.07;
    const offX = -(1 - p) * (pw + sk + 40 * u);
    c.save(); c.translate(offX, 0);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(pw + sk, 0); c.lineTo(pw - sk * 0.3, H); c.lineTo(0, H); c.closePath(); c.fillStyle = accent; c.fill();
    const p2 = eOutQ(c01((t - 0.12) / 0.75));
    c.globalAlpha *= 0.22; c.beginPath(); c.moveTo(pw + sk + 14 * u, 0); c.lineTo(pw + sk + 40 * u * p2, 0); c.lineTo(pw - sk * 0.3 + 40 * u * p2, H); c.lineTo(pw - sk * 0.3 + 14 * u, H); c.closePath(); c.fillStyle = accent; c.fill();
    c.globalAlpha /= 0.22;
    // panel content
    const pcx = pw * 0.45, pcy = H / 2;
    const pin = c01((t - 0.35) / 0.6);
    if (o.index != null) {
      c.save(); c.globalAlpha *= eOut(pin); c.font = `900 ${300 * u}px ${F}`; c.fillStyle = rgba(onA, 0.92); c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(String(o.index + 1).padStart(2, "0"), pcx, pcy + (1 - eOutQ(pin)) * 40 * u + 10 * u); c.restore();
    } else if (!(o.rich && drawLogoAt(c, R, pcx, pcy, 140 * u, eOut(pin)))) {
      c.save(); c.translate(pcx, pcy); c.rotate(t * 0.4); c.strokeStyle = rgba(onA, 0.85); c.lineWidth = 10 * u;
      const rr1 = 110 * u * eBack(pin); c.beginPath(); c.arc(0, 0, Math.max(0, rr1), -Math.PI * 0.2, Math.PI * 1.3); c.stroke();
      c.lineWidth = 5 * u; c.beginPath(); c.arc(0, 0, Math.max(0, rr1 * 0.62), Math.PI * 0.6, Math.PI * 2.1); c.stroke(); c.restore();
    }
    c.restore();
    const tx = W * 0.47, maxW = W * 0.47;
    const ft = fitText(c, title || " ", titleFont(800), maxW, 3, 104 * u, 44 * u);
    c.font = titleFont(800)(ft.size);
    const lh = ft.size * 1.1, cy = H * (names.length ? 0.42 : 0.47);
    const tl = 120 * u * eOutQ(c01((t - 0.3) / 0.5));
    const topY = cy - lh * ft.lines.length / 2 - 34 * u;
    if (tl > 1) { rr(c, tx, topY, tl, 7 * u, 3.5 * u); c.fillStyle = accent; c.fill(); }
    drawWords(c, ft.lines, ft.size, tx, cy, "left", lh, t, 0.4, 0.07, ink, false, 70 * u);
    let ny = cy + lh * ft.lines.length / 2 + 24 * u;
    if (sub) {
      const p3 = c01((t - 0.7) / 0.6), fs = 38 * u;
      c.save(); c.globalAlpha *= eOut(p3); c.font = `500 ${fs}px ${F}`; c.fillStyle = rgba(ink, 0.8); c.textBaseline = "top";
      c.fillText(sub, tx + (1 - eOutQ(p3)) * 40 * u, ny); c.restore();
      ny += fs * 1.5;
    }
    drawChips(c, R, names, tx, ny + 16 * u, "left", W * 0.42, t, 0.95, ink, accent);
  } else if (tpl === "minimal") {
    const p = c01((t - 0.1) / 1.1), e = eOutQ(p);
    const ls = lerp(0.32, 0.02, e);
    const ft = fitText(c, title || " ", titleFont(300), W * 0.72, 2, 96 * u, 40 * u, 0.02);
    c.font = titleFont(300)(ft.size); setLS(c, ls * ft.size);
    const lh = ft.size * 1.2, cy = H * (names.length ? 0.43 : 0.47);
    c.save(); c.globalAlpha *= eOut(c01(p * 1.4)); c.fillStyle = ink; c.textAlign = "center"; c.textBaseline = "middle";
    let maxLW = 0;
    ft.lines.forEach((l, i) => { const ww = c.measureText(l).width; maxLW = Math.max(maxLW, ww); c.fillText(l, W / 2 + (HAS_LS ? ls * ft.size / 2 : 0), cy - lh * (ft.lines.length - 1) / 2 + lh * i); });
    c.restore(); setLS(c, 0);
    // side lines
    const ll = 150 * u * eOutQ(c01((t - 0.45) / 0.8)), gapL = 46 * u;
    if (ll > 1 && ft.lines.length === 1) {
      c.fillStyle = rgba(ink, 0.45);
      c.fillRect(W / 2 - maxLW / 2 - gapL - ll, cy - u, ll, 2 * u);
      c.fillRect(W / 2 + maxLW / 2 + gapL, cy - u, ll, 2 * u);
    }
    // accent dot
    const dp = eBack(c01((t - 0.3) / 0.5));
    if (dp > 0) { c.fillStyle = accent; c.beginPath(); c.arc(W / 2, cy - lh * ft.lines.length / 2 - 34 * u, Math.max(0, 7 * u * dp), 0, TAU); c.fill(); }
    let ny = cy + lh * ft.lines.length / 2 + 30 * u;
    if (sub) {
      const p3 = c01((t - 0.6) / 0.7), fs = 26 * u;
      c.save(); c.globalAlpha *= eOut(p3) * 0.75; c.font = `600 ${fs}px ${F}`; setLS(c, fs * lerp(0.5, 0.28, eOutQ(p3))); c.fillStyle = ink; c.textAlign = "center"; c.textBaseline = "top";
      c.fillText(sub.toUpperCase(), W / 2 + (HAS_LS ? fs * 0.14 : 0), ny); setLS(c, 0); c.restore();
      ny += fs * 2;
    }
    if (o.rich) drawLogoAt(c, R, W / 2, H * 0.17, 80 * u, eOut(c01((t - 0.5) / 0.8)));
    drawChips(c, R, names, W / 2, ny + 16 * u, "center", W * 0.75, t, 0.9, ink, accent);
  } else { // bold
    const p = c01(t / 0.65), e = eIO(p), maxR = Math.hypot(W, H) / 2 * 1.04;
    // outer ring
    const rp = c01((t - 0.05) / 0.9);
    if (rp < 1) { c.save(); c.globalAlpha *= (1 - rp) * 0.6; c.strokeStyle = accent; c.lineWidth = 14 * u; c.beginPath(); c.arc(W / 2, H / 2, maxR * eOutQ(rp) * 1.1, 0, TAU); c.stroke(); c.restore(); }
    c.save();
    c.beginPath(); c.arc(W / 2, H / 2, Math.max(0, maxR * e), 0, TAU); c.fillStyle = accent; c.fill(); c.clip();
    // moving diagonal stripes
    c.globalAlpha *= 0.07; c.strokeStyle = onA; c.lineWidth = 46 * u;
    const off3 = (t * 50 * u) % (140 * u);
    c.beginPath(); for (let x = -H - 140 * u + off3; x < W + H; x += 140 * u) { c.moveTo(x, H); c.lineTo(x + H * 0.6, 0); } c.stroke();
    c.restore();
    if (o.rich) drawShapes(c, R, t, onA, onA, 1 - outE);
    const hasLogo = o.rich && drawLogoAt(c, R, W / 2, H * 0.18, 96 * u, eOut(c01((t - 0.5) / 0.6)));
    const ft = fitText(c, (title || " ").toUpperCase(), titleFont(900), W * 0.84, 2, 150 * u, 54 * u);
    c.font = titleFont(900)(ft.size);
    const lh = ft.size * 1.02, cy = H * (names.length ? 0.42 : 0.47) + (hasLogo ? 16 * u : 0);
    const tp = c01((t - 0.35) / 0.6), s = 0.7 + 0.3 * eBack(tp);
    c.save(); c.globalAlpha *= c01(tp * 3);
    c.translate(W / 2, cy); c.scale(s, s); c.translate(-W / 2, -cy);
    c.fillStyle = onA; c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = "rgba(0,0,0,0.18)"; c.shadowOffsetY = 8 * u; c.shadowBlur = 0;
    ft.lines.forEach((l, i) => c.fillText(l, W / 2, cy - lh * (ft.lines.length - 1) / 2 + lh * i));
    c.restore();
    let ny = cy + lh * ft.lines.length / 2 + 30 * u;
    if (sub) {
      const p3 = c01((t - 0.7) / 0.5), fs = 40 * u;
      c.save(); c.globalAlpha *= eOut(p3) * 0.88; c.font = `600 ${fs}px ${F}`; c.fillStyle = onA; c.textAlign = "center"; c.textBaseline = "top";
      c.fillText(sub, W / 2, ny + (1 - eOutQ(p3)) * 16 * u); c.restore();
      ny += fs * 1.5;
    }
    drawChips(c, R, names, W / 2, ny + 14 * u, "center", W * 0.8, t, 0.95, onA, onA, "solid");
  }
  c.restore();
}

function parseNames(s) { return String(s || "").split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 12); }

function drawCardSpan(c, R) {
  const { f, span } = R;
  drawBackground(c, R);
  const auto = !!span.auto;
  const part = span.partId ? partById(span.partId) : null;
  const accent = (auto && part && part.member && part.member.color) || R.S.accent;
  const tpl = auto ? ((f.project && f.project.memberCards && f.project.memberCards.template) || "reveal") : "reveal";
  drawTitleScene(c, R, { tpl, title: span.title || "", sub: span.sub || "", t: f.local || 0, T: (span.srcEnd - span.srcStart) || 2, accent, index: auto ? Math.max(0, span.memberIndex | 0) : null, rich: false });
  drawProgress(c, R);
}
function drawIntroOutro(c, R) {
  const { f, span, W, H } = R;
  const isIntro = span.type === "intro";
  const d = (f.project && (isIntro ? f.project.intro : f.project.outro)) || {};
  drawBackground(c, R);
  const T = (span.srcEnd - span.srcStart) || 5, t = f.local || 0;
  drawTitleScene(c, R, { tpl: d.template || "reveal", title: d.title || (isIntro ? "" : "Merci !"), sub: d.subtitle || "", names: parseNames(d.names), t, T, accent: R.S.accent, index: null, rich: true });
  if (!isIntro) { const a = eIO(c01((t - (T - 0.8)) / 0.8)); if (a > 0) { c.fillStyle = `rgba(0,0,0,${a})`; c.fillRect(0, 0, W, H); } }
}

/* ------------------------------------------------------------------ */
/* Frame                                                               */
/* ------------------------------------------------------------------ */
const _warned = new Set();
function warnOnce(k, e) { if (_warned.has(k)) return; _warned.add(k); try { console.warn("[render]", k, e); } catch (x) { } }

function drawEmpty(c, R) {
  const { W, H, u, S } = R;
  drawBackground(c, R);
  const F = fontOf(S), ink = S.headerColor || "#fff";
  const t = R.f.wall || 0;
  c.save();
  const cy = H / 2 - 30 * u, pulse = 1 + 0.04 * Math.sin(t * 2);
  c.translate(W / 2, cy - 70 * u); c.scale(pulse, pulse);
  c.beginPath(); c.arc(0, 0, 54 * u, 0, TAU); c.fillStyle = rgba(R.accent, 0.18); c.fill();
  c.beginPath(); c.moveTo(-14 * u, -22 * u); c.lineTo(24 * u, 0); c.lineTo(-14 * u, 22 * u); c.closePath(); c.fillStyle = R.accent; c.fill();
  c.restore();
  c.fillStyle = ink; c.textAlign = "center"; c.textBaseline = "middle";
  c.font = `800 ${56 * u}px ${F}`; c.fillText("Ta capsule apparaîtra ici", W / 2, cy + 40 * u);
  c.font = `500 ${30 * u}px ${F}`; c.fillStyle = rgba(ink, 0.7);
  c.fillText("Importe une vidéo et ta présentation dans « Médias » pour commencer", W / 2, cy + 100 * u);
  c.textAlign = "left";
}

export function renderFrame(ctx, W, H, f) {
  const c = ctx;
  f = f || {};
  c.save();
  resetCtx(c);
  const S = styleOf(f);
  const R = { c, f, S, W, H, u: W / 1920, span: f.span || null, part: null, accent: S.accent, speed: 1, view: null, ovs: [], st: null, L: null, slideBox: null };
  try {
    const span = R.span;
    if (!span) drawEmpty(c, R);
    else {
      R.speed = +span.speed || 1;
      if (span.type === "talk" || span.type === "extract") {
        const part = partById(span.partId);
        if (!part) drawEmpty(c, R);
        else {
          R.part = part;
          if (part.member && part.member.color) R.accent = part.member.color;
          if (span.type === "talk") drawTalk(c, R); else drawExtract(c, R);
        }
      } else if (span.type === "card") drawCardSpan(c, R);
      else if (span.type === "intro" || span.type === "outro") drawIntroOutro(c, R);
      else drawEmpty(c, R);
    }
  } catch (e) {
    warnOnce("frame", e);
  }
  // global fade (export only)
  if (f.exporting && S.fadeInOut && f.duration > 0) {
    const t = f.outT || 0;
    const a = Math.max(0, 1 - t / 0.6, 1 - (f.duration - t) / 0.8);
    if (a > 0) { resetCtx(c); c.fillStyle = `rgba(0,0,0,${c01(a).toFixed(3)})`; c.fillRect(0, 0, W, H); }
  }
  c.restore();
}

/* ------------------------------------------------------------------ */
/* YouTube thumbnail                                                   */
/* ------------------------------------------------------------------ */
export function renderThumbnail(ctx, W, H, f, opts) {
  const c = ctx;
  opts = opts || {};
  renderFrame(c, W, H, { ...f, exporting: false });
  c.save(); resetCtx(c);
  try {
    const S = styleOf(f), u = W / 1280, F = fontOf(S);
    const title = String(opts.title || "").trim(), sub = String(opts.sub || "").trim();
    const textRight = S.camSide === "left";
    // darken + vignette, stronger on the text side
    const g = c.createLinearGradient(textRight ? W : 0, 0, textRight ? 0 : W, 0);
    g.addColorStop(0, "rgba(0,0,0,0.72)"); g.addColorStop(0.55, "rgba(0,0,0,0.35)"); g.addColorStop(1, "rgba(0,0,0,0.05)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const vg = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
    c.fillStyle = vg; c.fillRect(0, 0, W, H);
    if (!title && !sub) { c.restore(); return; }
    const accent = S.accent;
    const maxW = W * 0.62, x0 = textRight ? W - 56 * u : 56 * u, align = textRight ? "right" : "left";
    if (opts.style === "clean") {
      const ft = fitText(c, title || " ", s => `800 ${s}px ${F}`, W * 0.8, 2, 84 * u, 36 * u);
      const lh = ft.size * 1.12, padX = 40 * u, padY = 28 * u, subFs = 32 * u;
      c.font = `800 ${ft.size}px ${F}`;
      let tw = 0; for (const l of ft.lines) tw = Math.max(tw, c.measureText(l).width);
      c.font = `600 ${subFs}px ${F}`; const sw = sub ? c.measureText(sub).width : 0;
      const barW = Math.min(W - 40 * u, Math.max(tw, sw) + padX * 2 + 12 * u);
      const barH = lh * ft.lines.length + padY * 2 + (sub ? subFs * 1.55 : 0);
      const by = H - barH - 56 * u, bx = textRight ? W - barW : 0;
      // accent darkened just enough for white text
      const bar = lum(accent) > 0.3 ? mixHex(accent, "#000000", Math.min(0.55, (lum(accent) - 0.18) * 1.4)) : accent;
      c.shadowColor = "rgba(0,0,0,0.45)"; c.shadowBlur = 34 * u; c.shadowOffsetY = 10 * u;
      if (textRight) rr(c, bx, by, barW + 40 * u, barH, 18 * u); else rr(c, bx - 40 * u, by, barW + 40 * u, barH, 18 * u);
      c.fillStyle = bar; c.fill(); shadowOff(c);
      c.fillStyle = accent; c.fillRect(textRight ? W - 10 * u : 0, by, 10 * u, barH);
      const tx = bx + padX + (textRight ? -12 * u : 12 * u);
      c.font = `800 ${ft.size}px ${F}`; c.fillStyle = "#ffffff"; c.textBaseline = "alphabetic"; c.textAlign = "left";
      ft.lines.forEach((l, i) => c.fillText(l, tx, by + padY + lh * i + ft.size * 0.88));
      if (sub) { c.font = `600 ${subFs}px ${F}`; c.globalAlpha = 0.88; c.fillText(sub, tx, by + padY + lh * ft.lines.length + subFs * 1.1); c.globalAlpha = 1; }
    } else {
      const ft = fitText(c, (title || " ").toUpperCase(), s => `900 ${s}px ${F}`, maxW, 3, 118 * u, 44 * u);
      const lh = ft.size * 1.0, subFs = 38 * u;
      const blockH = lh * ft.lines.length + (sub ? subFs * 2.2 : 0);
      let y = (H - blockH) / 2 + ft.size * 0.82;
      c.font = `900 ${ft.size}px ${F}`; c.textAlign = align; c.lineJoin = "round"; c.miterLimit = 2;
      const yellow = "#FFD60A";
      ft.lines.forEach((l, i) => {
        c.save(); c.translate(x0, y); c.rotate(-0.025);
        c.lineWidth = ft.size * 0.16; c.strokeStyle = "rgba(8,10,16,0.95)"; c.strokeText(l, 0, 0);
        c.shadowColor = "rgba(0,0,0,0.5)"; c.shadowBlur = 20 * u; c.shadowOffsetY = 6 * u;
        c.fillStyle = i === ft.lines.length - 1 && ft.lines.length > 1 ? yellow : (ft.lines.length === 1 ? yellow : "#ffffff");
        c.fillText(l, 0, 0); c.restore();
        y += lh;
      });
      if (sub) {
        c.font = `800 ${subFs}px ${F}`;
        const sw = c.measureText(sub).width, ph = subFs * 1.5, pw = sw + 40 * u;
        const sx = textRight ? x0 - pw : x0, sy = y - ft.size * 0.82 + subFs * 0.5;
        c.save(); c.translate(sx + pw / 2, sy + ph / 2); c.rotate(-0.025); c.translate(-(sx + pw / 2), -(sy + ph / 2));
        c.shadowColor = "rgba(0,0,0,0.45)"; c.shadowBlur = 18 * u; c.shadowOffsetY = 6 * u;
        rr(c, sx, sy, pw, ph, 10 * u); c.fillStyle = accent; c.fill(); shadowOff(c);
        c.fillStyle = onColor(accent); c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(sub, sx + 20 * u, sy + ph / 2 + u);
        c.restore();
      }
    }
  } catch (e) { warnOnce("thumb", e); }
  c.restore();
}
