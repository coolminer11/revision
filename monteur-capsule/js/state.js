// state.js — project model, program (output timeline) builder, time mapping, themes, stats, persistence.
// Owned by the integrator. Other modules import from here; do not change the shapes documented in CONTRACT.md.

export const STORE_KEY = "monteur-capsule-v2";

/* ------------------------------------------------------------------ */
/* Style (visual settings shared by the whole video)                   */
/* ------------------------------------------------------------------ */
export const DEFAULT_STYLE = {
  // layout
  camSide: "right",          // "right" | "left"
  camShape: "3:4",           // "3:4" | "1:1" | "9:16" | "16:9" | "circle"
  camWidth: 22,              // % of frame width
  camAlign: "center",        // "top" | "center" | "bottom"
  margin: 2.2,               // % of width
  gap: 1.6,                  // % of width
  duoLayout: "stack",        // two people: "stack" (2 cams stacked beside slide) | "side" (2 cams side by side, no slide)
  // camera look
  camBright: 100, camContrast: 100, camSat: 100,
  camFilter: "none",         // "none" | "warm" | "cold" | "bw" | "cinema" | "vivid" | "fade"
  camEnter: "slide",         // camera entrance animation: "none" | "slide" | "pop" | "bounce" | "fade"
  camEnterDur: 0.6,
  // background
  bgType: "gradient",        // "solid" | "gradient" | "image" | "animated"
  bg1: "#0f1b2d", bg2: "#1f3b57", bgAngle: 135,
  bgBlur: 12, bgDim: 35,
  bgAnim: "gradient",        // when bgType==="animated": "gradient" | "particles" | "grid" | "waves" | "bokeh"
  bgAnimSpeed: 1,
  // frames
  accent: "#4fd1c5", radius: 18, camBorder: 3, slideBorder: 0, shadow: 40,
  camGlow: false,
  // slide transitions (default; a marker can override with marker.trans)
  trans: "fade",             // "cut"|"fade"|"slide"|"zoom"|"curtain"|"blur"|"wipe"|"cube"|"glitch"|"flash"
  transDur: 0.45,
  // banner (member name)
  bannerOn: true, bannerPos: "cam", bannerDur: 6, bannerBg: "#4fd1c5", bannerFg: "#06221f",
  // header + logo
  headerText: "", headerColor: "#e8ecf4", logoPos: "tr", logoSize: 9,
  // extras
  progressOn: true, slideNumOn: false,
  font: "system",            // "system" | "rounded" | "serif" | "mono" | "condensed"
  // export
  res: "1080", fps: "30", masterVolume: 100, monitor: true, fadeInOut: true,
};

export const FONTS = {
  system: "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif",
  rounded: "'Nunito','Varela Round','Arial Rounded MT Bold',system-ui,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  mono: "'JetBrains Mono',Consolas,'Courier New',monospace",
  condensed: "'Roboto Condensed','Arial Narrow','Helvetica Neue',sans-serif",
};

export const THEMES = {
  "Studio sombre": {},
  "Corporate bleu": { bgType: "gradient", bg1: "#0b1f3a", bg2: "#123d6b", bgAngle: 160, accent: "#5aa9ff", bannerBg: "#5aa9ff", bannerFg: "#04162b", headerColor: "#eaf2ff", radius: 10, shadow: 30, camFilter: "none", trans: "wipe" },
  "Néon": { bgType: "animated", bgAnim: "grid", bg1: "#0a0614", bg2: "#2a0a4a", accent: "#ff3cac", bannerBg: "#ff3cac", bannerFg: "#16001a", headerColor: "#ffe6fb", camGlow: true, camBorder: 4, radius: 22, trans: "glitch", camFilter: "vivid" },
  "Minimal blanc": { bgType: "solid", bg1: "#f4f5f7", bg2: "#ffffff", accent: "#111827", bannerBg: "#111827", bannerFg: "#ffffff", headerColor: "#111827", shadow: 18, camBorder: 0, radius: 14, trans: "fade" },
  "Bordeaux": { bgType: "gradient", bg1: "#2a0b12", bg2: "#5b1424", bgAngle: 120, accent: "#f2c14e", bannerBg: "#f2c14e", bannerFg: "#2a0b12", headerColor: "#fff3d6", trans: "curtain", camFilter: "warm" },
  "Turquoise": { bgType: "animated", bgAnim: "waves", bg1: "#062a30", bg2: "#0e4a52", accent: "#4fd1c5", bannerBg: "#4fd1c5", bannerFg: "#06221f", trans: "slide" },
  "Coucher de soleil": { bgType: "animated", bgAnim: "gradient", bg1: "#2b1055", bg2: "#d4573b", bgAngle: 170, accent: "#ffb86b", bannerBg: "#ffb86b", bannerFg: "#2b1055", headerColor: "#fff1e0", trans: "zoom", camFilter: "warm" },
  "Cinéma": { bgType: "solid", bg1: "#050505", accent: "#e5c07b", bannerBg: "#111111", bannerFg: "#e5c07b", headerColor: "#e5e5e5", camFilter: "cinema", radius: 4, camBorder: 1, trans: "blur", shadow: 60 },
};

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */
let _id = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${(_id++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function newProject() {
  return {
    app: "monteur-capsule", version: 2,
    style: { ...DEFAULT_STYLE },
    clips: {},            // id -> Clip
    parts: [],            // ordered Part list
    slideVideos: [],      // {id, slide, clipId, volume, fit, loop}
    music: { clipId: null, volume: 0.35, duck: 0.3, fadeIn: 2, fadeOut: 3, loop: true },
    intro: { on: false, template: "reveal", title: "", subtitle: "", names: "", dur: 5 },
    outro: { on: false, template: "reveal", title: "Merci !", subtitle: "", names: "", dur: 5 },
    memberCards: { on: true, template: "reveal", dur: 2.2 },
    target: 720,          // seconds; 0 = no target
    extractLimit: 30,     // seconds; 0 = no limit
    thumbnail: { outT: 0, title: "", sub: "", style: "bold" },
    customThemes: {},     // name -> partial style
  };
}

export function newTalkPart(clipId, clip) {
  return {
    id: uid("part"), type: "talk", clipId,
    in: 0, out: clip && clip.duration ? clip.duration : null,
    speed: 1, volume: 1,
    member: { name: "", sub: "", color: null },
    cam: { zoom: 1, x: 0, y: 0, mirror: false },
    camB: null,           // {clipId, offset, zoom, x, y, mirror, volume}
    layout: null,         // null = normal (slide + cam; duo when camB is set), "cam" = camera only for the whole part
    cuts: [],             // [{a,b}] source seconds removed from the output
    speedSections: [],    // [{a,b,speed}] override part.speed inside [a,b]
    markers: [],          // [{t, target, mode?, trans?}]  target: slide index | "CAM" | "SLIDE"
    startSlide: 0,
    overlays: [],         // Overlay list (times in this part's source seconds)
    voice: { clear: true, denoise: 0.4 },
  };
}
export function newExtractPart(clipId, clip) {
  return {
    id: uid("part"), type: "extract", clipId,
    in: 0, out: clip && clip.duration ? clip.duration : null,
    speed: 1, volume: 1,
    label: "Extrait", sub: "",
    display: "full",      // "full" | "frame"
    voice: { clear: true, denoise: 0.4 },
  };
}
export function newCardPart() { return { id: uid("part"), type: "card", title: "Titre", sub: "", dur: 2.5 }; }

export function newOverlay(type, t) {
  const base = { id: uid("ov"), type, t: Math.max(0, t || 0), dur: 4 };
  if (type === "text") return { ...base, text: "Ton texte", x: 0.5, y: 0.18, size: 64, color: "#ffffff", bg: "#000000", bgOn: false, anim: "up", align: "center", weight: 800 };
  if (type === "number") return { ...base, value: 35, from: 0, decimals: 0, prefix: "", suffix: "", label: "employés", x: 0.5, y: 0.5, size: 150, color: "#ffffff", countDur: 1.6, dur: 4.5 };
  if (type === "zoom") return { ...base, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, inDur: 0.7, outDur: 0.7, dur: 4 };
  if (type === "broll") return { ...base, clipId: null, area: "full", kenBurns: true, volume: 0, dur: 5 };
  return base;
}

/* ------------------------------------------------------------------ */
/* Shared runtime store + event bus                                    */
/* ------------------------------------------------------------------ */
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));

export const store = {
  project: newProject(),
  slides: [],          // ImageBitmap | canvas, index = slide number - 1
  slideTitles: [],     // string per slide (best effort from PDF text)
  slideThumbs: [],     // dataURL per slide
  bgImage: null,       // ImageBitmap (not persisted)
  logoImage: null,     // ImageBitmap (not persisted)
  selectedPartId: null,
  selectedOverlayId: null,
  view: "program",     // "program" | "source"
  exporting: false,
  _program: null,
};

/** Clip shape: {id, name, fileName, kind:"video"|"image"|"audio", duration, width, height, linked:boolean} */
export function clipById(id) { return id ? store.project.clips[id] || null : null; }
export function partById(id) { return store.project.parts.find(p => p.id === id) || null; }
export const style = () => store.project.style;

/* ------------------------------------------------------------------ */
/* Program builder                                                     */
/* ------------------------------------------------------------------ */
const EPS = 1e-4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function partRange(part) {
  const c = clipById(part.clipId);
  const D = c && c.duration ? c.duration : (part.out || 0);
  const a = clamp(part.in || 0, 0, D || 1e9);
  let b = part.out == null ? D : clamp(part.out, a, D || 1e9);
  if (!(b > a)) b = a;
  return [a, b];
}

function subtractCuts(a, b, cuts) {
  let ranges = [[a, b]];
  for (const c of (cuts || []).slice().sort((x, y) => x.a - y.a)) {
    const ca = Math.min(c.a, c.b), cb = Math.max(c.a, c.b);
    const next = [];
    for (const [ra, rb] of ranges) {
      if (cb <= ra || ca >= rb) { next.push([ra, rb]); continue; }
      if (ca > ra) next.push([ra, ca]);
      if (cb < rb) next.push([cb, rb]);
    }
    ranges = next;
  }
  return ranges.filter(([x, y]) => y - x > 0.02);
}

function splitBySpeed(ranges, sections, baseSpeed) {
  const out = [];
  const secs = (sections || []).map(s => ({ a: Math.min(s.a, s.b), b: Math.max(s.a, s.b), speed: clamp(+s.speed || 1, 0.25, 4) })).sort((x, y) => x.a - y.a);
  for (const [ra, rb] of ranges) {
    const pts = new Set([ra, rb]);
    for (const s of secs) { if (s.a > ra && s.a < rb) pts.add(s.a); if (s.b > ra && s.b < rb) pts.add(s.b); }
    const sorted = [...pts].sort((x, y) => x - y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1], mid = (a + b) / 2;
      const s = secs.find(s => mid >= s.a && mid < s.b);
      out.push({ a, b, speed: s ? s.speed : baseSpeed });
    }
  }
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.b - r.a) < EPS && last.speed === r.speed) last.b = r.b; else merged.push({ ...r });
  }
  return merged;
}

/**
 * Span: {i, partId|null, type:"intro"|"outro"|"card"|"talk"|"extract", auto:boolean,
 *        outStart, outEnd, srcStart, srcEnd, speed, clipId|null, title?, sub?, memberIndex, firstOfPart?}
 * For intro/outro/card: srcStart=0, srcEnd=dur, speed=1, clipId=null (src time = local time).
 * firstOfPart: true on the first talk/extract span of a part (camera entrance + banner timing).
 */
export function buildProgram(project = store.project) {
  const spans = [];
  let t = 0, memberIndex = -1;
  const push = s => { s.i = spans.length; s.outStart = t; t += (s.srcEnd - s.srcStart) / s.speed; s.outEnd = t; spans.push(s); };
  if (project.intro.on) push({ type: "intro", partId: null, auto: true, srcStart: 0, srcEnd: Math.max(1, +project.intro.dur || 5), speed: 1, clipId: null, memberIndex: -1 });
  let lastMember = null;
  for (const part of project.parts) {
    if (part.type === "talk") {
      const name = ((part.member && part.member.name) || "").trim();
      if (name && name !== lastMember) memberIndex++;
      else if (memberIndex < 0) memberIndex = 0;
      if (project.memberCards.on && name && name !== lastMember) {
        push({ type: "card", partId: part.id, auto: true, title: name, sub: part.member.sub || "", srcStart: 0, srcEnd: Math.max(0.8, +project.memberCards.dur || 2), speed: 1, clipId: null, memberIndex });
      }
      if (name) lastMember = name;
      const [a, b] = partRange(part);
      const ranges = splitBySpeed(subtractCuts(a, b, part.cuts), part.speedSections, clamp(+part.speed || 1, 0.25, 4));
      ranges.forEach((r, k) => push({ type: "talk", partId: part.id, auto: false, srcStart: r.a, srcEnd: r.b, speed: r.speed, clipId: part.clipId, memberIndex: Math.max(0, memberIndex), firstOfPart: k === 0 }));
    } else if (part.type === "extract") {
      const [a, b] = partRange(part);
      if (b - a > 0.02) push({ type: "extract", partId: part.id, auto: false, srcStart: a, srcEnd: b, speed: clamp(+part.speed || 1, 0.25, 4), clipId: part.clipId, memberIndex: Math.max(0, memberIndex), firstOfPart: true });
    } else if (part.type === "card") {
      push({ type: "card", partId: part.id, auto: false, title: part.title, sub: part.sub, srcStart: 0, srcEnd: Math.max(0.5, +part.dur || 2), speed: 1, clipId: null, memberIndex, firstOfPart: true });
    }
  }
  if (project.outro.on) push({ type: "outro", partId: null, auto: true, srcStart: 0, srcEnd: Math.max(1, +project.outro.dur || 5), speed: 1, clipId: null, memberIndex: -1 });
  const prog = { spans, duration: t };
  store._program = prog;
  return prog;
}
export const program = () => store._program || buildProgram();

/** Output time -> {span, srcT, local}. local = output seconds since span start. null if the program is empty. */
export function locate(prog, outT) {
  const spans = prog.spans;
  if (!spans.length) return null;
  outT = clamp(outT, 0, prog.duration);
  let lo = 0, hi = spans.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (spans[mid].outStart <= outT + EPS) lo = mid; else hi = mid - 1; }
  const span = spans[lo];
  const local = clamp(outT - span.outStart, 0, span.outEnd - span.outStart);
  return { span, local, srcT: span.srcStart + local * span.speed };
}

/** Source time inside a part -> output time (null if that moment is cut out). */
export function srcToOut(prog, partId, srcT) {
  for (const s of prog.spans) {
    if (s.partId !== partId || (s.type !== "talk" && s.type !== "extract")) continue;
    if (srcT >= s.srcStart - EPS && srcT <= s.srcEnd + EPS) return s.outStart + (clamp(srcT, s.srcStart, s.srcEnd) - s.srcStart) / s.speed;
  }
  return null;
}
/** First output time of a part (its auto card if any, else its first span). */
export function partOutStart(prog, partId) {
  const s = prog.spans.find(s => s.partId === partId);
  return s ? s.outStart : 0;
}
/** Output duration of the talk/extract spans of a part. */
export function partOutDuration(prog, partId) {
  return prog.spans.filter(s => s.partId === partId && (s.type === "talk" || s.type === "extract")).reduce((a, s) => a + (s.outEnd - s.outStart), 0);
}

/* ------------------------------------------------------------------ */
/* Slide state inside a talk part                                      */
/* ------------------------------------------------------------------ */
export const kindOf = m => m.target === "CAM" ? "cam" : m.target === "SLIDE" ? "slide" : m.mode === "slide" ? "slide" : "pip";
export function sortMarkers(part) { part.markers.sort((a, b) => a.t - b.t); }

/** Slide index (number) shown at or before srcT, ignoring CAM/SLIDE string targets. */
export function lastSlideBefore(part, srcT) {
  let idx = part.startSlide | 0;
  for (const m of part.markers) { if (m.t <= srcT) { if (typeof m.target === "number") idx = m.target; } else break; }
  return idx;
}
/**
 * {target, prev, kind, prevKind, since, trans, slide, prevSlide, changeT}
 *  - kind/prevKind: "pip" | "cam" | "slide". The renderer draws the "duo" layout when part.camB is set and kind==="pip".
 *  - since: source seconds since the last change (huge if none)
 *  - trans: transition for the last change (marker.trans || style.trans)
 *  - slide/prevSlide: numeric slide indexes to draw now / before the change
 */
export function slideStateAt(part, srcT) {
  const forcedCam = part.layout === "cam";
  let target = part.startSlide | 0, prev = target, kind = forcedCam ? "cam" : "pip", prevKind = kind, at = -1e9, trans = style().trans;
  let slide = target, prevSlide = target;
  for (const m of part.markers) {
    if (m.t <= srcT) {
      prev = target; prevKind = kind; prevSlide = slide;
      target = m.target; kind = forcedCam ? "cam" : kindOf(m); at = m.t;
      if (typeof target === "number") slide = target;
      trans = m.trans || style().trans;
    } else break;
  }
  return { target, prev, kind, prevKind, since: srcT - at, trans, slide, prevSlide, changeT: at > -1e8 ? at : null };
}

/** Overlays active at srcT: [{ov, local (source s since ov.t), p (0..1 of its duration)}] in list order. */
export function activeOverlays(part, srcT) {
  if (!part || !part.overlays) return [];
  const out = [];
  for (const ov of part.overlays) {
    if (srcT >= ov.t && srcT < ov.t + ov.dur) out.push({ ov, local: srcT - ov.t, p: (srcT - ov.t) / ov.dur });
  }
  return out;
}

/**
 * Secondary videos that must play at a moment, besides the span's main clip.
 * Returns [{key, clipId, role:"camB"|"broll"|"slideVideo", time, rate, volume, loop}]
 *  - the media layer keeps one <video> per (clipId, role); time = desired currentTime; rate = desired playbackRate.
 */
export function auxVideosAt(span, srcT) {
  const out = [];
  if (!span || span.type !== "talk") return out;
  const part = partById(span.partId); if (!part) return out;
  if (part.camB && part.camB.clipId) {
    const c = clipById(part.camB.clipId);
    const t = srcT + (+part.camB.offset || 0);
    if (c && t >= 0 && (!c.duration || t <= c.duration)) out.push({ key: `camB:${part.id}`, clipId: part.camB.clipId, role: "camB", time: t, rate: span.speed, volume: part.camB.volume ?? 1, loop: false });
  }
  for (const { ov, local } of activeOverlays(part, srcT)) {
    if (ov.type === "broll" && ov.clipId) {
      const c = clipById(ov.clipId);
      if (c && c.kind === "video") out.push({ key: `broll:${ov.id}`, clipId: ov.clipId, role: "broll", time: c.duration ? (local / span.speed) % c.duration : local / span.speed, rate: 1, volume: +ov.volume || 0, loop: true });
    }
  }
  const st = slideStateAt(part, srcT);
  if (st.kind !== "cam") {
    const sv = store.project.slideVideos.find(v => v.slide === st.slide && v.clipId);
    if (sv) {
      const c = clipById(sv.clipId);
      let appear = null;
      for (const m of part.markers) { if (m.t > srcT) break; if (typeof m.target === "number") appear = m.target === st.slide ? (appear != null && lastSlideBefore(part, m.t - 1e-3) === st.slide ? appear : m.t) : null; }
      if (appear == null) appear = partRange(part)[0];
      let tt = Math.max(0, (srcT - appear) / span.speed);
      if (c && c.duration) tt = sv.loop ? tt % c.duration : Math.min(tt, Math.max(0, c.duration - 0.05));
      out.push({ key: `slideVideo:${sv.id}`, clipId: sv.clipId, role: "slideVideo", time: tt, rate: 1, volume: sv.volume ?? 0, loop: !!sv.loop });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Stats + chapters                                                    */
/* ------------------------------------------------------------------ */
export function stats(prog = program(), project = store.project) {
  const members = new Map();
  let extracts = 0, talk = 0;
  for (const s of prog.spans) {
    const d = s.outEnd - s.outStart;
    if (s.type === "extract") extracts += d;
    if (s.type === "talk") {
      talk += d;
      const p = partById(s.partId);
      const name = (p && p.member.name.trim()) || "Sans nom";
      const m = members.get(name) || { name, talk: 0, color: p && p.member.color };
      m.talk += d; members.set(name, m);
    }
  }
  const total = prog.duration;
  return {
    total, talk, extracts,
    perMember: [...members.values()],
    target: project.target || 0,
    overTarget: project.target ? total - project.target : 0,
    extractLimit: project.extractLimit || 0,
    overExtract: project.extractLimit ? extracts - project.extractLimit : 0,
  };
}

/**
 * YouTube chapters: [{t, title}] in output seconds; first forced to 0:00; chapters < minGap s apart are dropped.
 * Sources: intro, member/manual cards (or member names when cards are off), extracts, and slide changes whose
 * slide has a title (store.slideTitles, from the PDF text).
 */
export function chapters(prog = program(), project = store.project, slideTitles = store.slideTitles, minGap = 10) {
  const list = [];
  const add = (t, title) => { title = (title || "").trim(); if (title) list.push({ t, title }); };
  for (const s of prog.spans) {
    if (s.type === "intro") add(s.outStart, project.intro.title || "Introduction");
    else if (s.type === "outro") add(s.outStart, project.outro.title || "Conclusion");
    else if (s.type === "card") add(s.outStart, s.title);
    else if (s.type === "extract") { const p = partById(s.partId); add(s.outStart, p ? `${p.label}${p.sub ? " — " + p.sub : ""}` : "Extrait"); }
    else if (s.type === "talk") {
      const part = partById(s.partId);
      if (s.firstOfPart && !project.memberCards.on && part && part.member.name) add(s.outStart, part.member.name);
      if (part) for (const m of part.markers) {
        if (typeof m.target !== "number" || m.t < s.srcStart || m.t >= s.srcEnd) continue;
        const title = slideTitles[m.target];
        if (title) add(s.outStart + (m.t - s.srcStart) / s.speed, title);
      }
    }
  }
  list.sort((a, b) => a.t - b.t);
  const out = [];
  for (const c of list) { if (!out.length || c.t - out[out.length - 1].t >= minGap) out.push(c); }
  if (out.length) out[0] = { ...out[0], t: 0 };
  return out;
}
export const fmtTime = (t, tenths = false) => {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = tenths ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
export const chaptersText = list => list.map(c => `${fmtTime(c.t)} ${c.title}`).join("\n");

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */
function sanitize(p) {
  const base = newProject();
  const out = { ...base, ...p, style: { ...DEFAULT_STYLE, ...(p.style || {}) } };
  for (const k of ["music", "intro", "outro", "memberCards", "thumbnail"]) out[k] = { ...base[k], ...(p[k] || {}) };
  out.clips = p.clips && typeof p.clips === "object" ? p.clips : {};
  for (const c of Object.values(out.clips)) c.linked = false;     // media must be re-imported after a reload
  out.parts = (Array.isArray(p.parts) ? p.parts : []).filter(x => x && x.id && x.type).map(part => {
    if (part.type === "talk") {
      const d = newTalkPart(part.clipId, null);
      const q = { ...d, ...part, member: { ...d.member, ...(part.member || {}) }, cam: { ...d.cam, ...(part.cam || {}) }, voice: { ...d.voice, ...(part.voice || {}) } };
      q.markers = (q.markers || []).map(m => ({ ...m, t: +m.t })).filter(m => isFinite(m.t) && (typeof m.target === "number" || m.target === "CAM" || m.target === "SLIDE")).sort((a, b) => a.t - b.t);
      q.cuts = (q.cuts || []).filter(c => isFinite(c.a) && isFinite(c.b));
      q.speedSections = (q.speedSections || []).filter(c => isFinite(c.a) && isFinite(c.b));
      q.overlays = (q.overlays || []).filter(o => o && o.id && ["text", "number", "zoom", "broll"].includes(o.type) && isFinite(+o.t)).map(o => {
        const d = newOverlay(o.type, +o.t);
        const r = { ...d, ...o, id: o.id, t: +o.t, dur: isFinite(+o.dur) && +o.dur > 0 ? +o.dur : d.dur };
        if (o.type === "zoom") r.rect = { ...d.rect, ...(o.rect || {}) };
        return r;
      });
      return q;
    }
    if (part.type === "extract") { const d = newExtractPart(part.clipId, null); return { ...d, ...part, voice: { ...d.voice, ...(part.voice || {}) } }; }
    return { ...newCardPart(), ...part };
  });
  out.slideVideos = Array.isArray(p.slideVideos) ? p.slideVideos : [];
  out.customThemes = p.customThemes || {};
  return out;
}
export function saveNow() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store.project)); } catch (e) { /* quota or private mode */ }
}
let _saveT = 0;
export function saveSoon() { clearTimeout(_saveT); _saveT = setTimeout(saveNow, 400); }
export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { store.project = sanitize(JSON.parse(raw)); store.selectedPartId = store.project.parts[0] ? store.project.parts[0].id : null; buildProgram(); return true; }
  } catch (e) { }
  buildProgram();
  return false;
}
export function exportJSON() { return JSON.stringify(store.project, null, 2); }
export function importJSON(text) {
  const d = JSON.parse(text);
  if (d.app !== "monteur-capsule") throw new Error("ce n'est pas un projet du monteur");
  if (d.version !== 2) throw new Error("projet d'une ancienne version : refais les changements dans cette version");
  checkpoint();
  store.project = sanitize(d);
  store.selectedPartId = store.project.parts[0] ? store.project.parts[0].id : null;
  changed("project"); emit("style", null);
}

/** Call after any project mutation. kind: "project" (structure/timing) | "style" | "media" | "select". */
export function changed(kind = "project") {
  if (kind === "project" || kind === "media") buildProgram();
  saveSoon();
  emit(kind, null);
  emit("any", kind);
}

/* ------------------------------------------------------------------ */
/* Undo (snapshot based, project only). Call checkpoint() BEFORE a mutation. */
/* ------------------------------------------------------------------ */
const undoStack = [], redoStack = [];
export function checkpoint() {
  const snap = JSON.stringify(store.project);
  if (undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap); if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}
function restore(snap) {
  // media is not part of undo: keep every clip currently known (and its linked state), even if the snapshot predates it
  const current = store.project.clips;
  store.project = JSON.parse(snap);
  for (const [id, c] of Object.entries(current)) {
    if (!store.project.clips[id]) store.project.clips[id] = c;
    else store.project.clips[id].linked = !!c.linked;
  }
  if (!partById(store.selectedPartId)) store.selectedPartId = store.project.parts[0] ? store.project.parts[0].id : null;
  changed("project"); emit("style", null);
}
export function undo() { if (!undoStack.length) return false; redoStack.push(JSON.stringify(store.project)); restore(undoStack.pop()); return true; }
export function redo() { if (!redoStack.length) return false; undoStack.push(JSON.stringify(store.project)); restore(redoStack.pop()); return true; }
export const canUndo = () => undoStack.length > 0;
