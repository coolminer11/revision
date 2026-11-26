// timeline.js — timeline canvas.
//  Program view: the whole sequence in output time (parts as blocks, slide-change ticks, overlay bars, playhead).
//  Source view:  the selected part's clip in source time (in/out handles, cuts hatched + draggable edges,
//                speed sections, draggable markers, overlay bars that move / resize).
import { store, partById, clipById, program, locate, srcToOut, partRange, sortMarkers, kindOf, fmtTime, checkpoint, changed } from "../state.js";
import { app, isSource, frameInfo, setView } from "./ctx.js";
import { partColor, partLabel } from "./sequence.js";
import { OV_META, selectOverlay } from "./overlays.js";
import { clamp } from "./widgets.js";

const H = 122, PAD = 10, LANES = 3;
const Y = { rulerB: 16, blockT: 22, blockB: 64, lane0: 70, laneH: 14 };
let cv, ctx, W = 600, hits = [], drag = null, hatch = null, hover = null;
let zoom = 1, scroll = 0;          // source view horizontal zoom (1 = fit) and scroll (seconds)

const fontUI = (w, s) => `${w} ${s}px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;
function rr(c, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function hexA(hex, a) { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || ""); if (!m) return `rgba(120,140,170,${a})`; return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`; }
function getHatch() {
  if (hatch) return hatch;
  const c = document.createElement("canvas"); c.width = c.height = 8; const x = c.getContext("2d");
  x.fillStyle = "rgba(245,101,101,.20)"; x.fillRect(0, 0, 8, 8);
  x.strokeStyle = "rgba(245,101,101,.85)"; x.lineWidth = 1.6; x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
  hatch = ctx.createPattern(c, "repeat"); return hatch;
}
function niceStep(pps) { for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200]) if (s * pps >= 64) return s; return 1800; }

/* ---------------- domain helpers ---------------- */
function domain() {
  if (isSource()) {
    const part = partById(store.selectedPartId); const c = part && clipById(part.clipId);
    const D = (c && c.duration) || (part ? partRange(part)[1] : 0) || 1;
    const vis = D / zoom; scroll = clamp(scroll, 0, Math.max(0, D - vis));
    return { t0: scroll, t1: scroll + vis, D, part };
  }
  const D = program().duration || 0;
  return { t0: 0, t1: D || 1, D };
}
let dom = { t0: 0, t1: 1, D: 1 };
const tx = t => PAD + (t - dom.t0) / (dom.t1 - dom.t0) * (W - 2 * PAD);
const xt = x => dom.t0 + (x - PAD) / (W - 2 * PAD) * (dom.t1 - dom.t0);

/** Output time of a source time inside a part, snapping cut-out moments to the next kept moment. */
function outOf(prog, part, t) {
  const o = srcToOut(prog, part.id, t); if (o != null) return o;
  const spans = prog.spans.filter(s => s.partId === part.id && s.type === "talk");
  for (const s of spans) if (s.srcStart >= t) return s.outStart;
  const l = spans[spans.length - 1]; return l ? l.outEnd : null;
}
/** Source time in `part` at output time outT (null if outT is not inside that part). */
function srcAtOut(prog, part, outT) {
  const loc = locate(prog, outT); if (!loc || loc.span.partId !== part.id || loc.span.type !== "talk") return null;
  return loc.srcT;
}

/* ---------------- drawing ---------------- */
let dirty = true, lastSig = "";
export function markTimelineDirty() { dirty = true; }
export function drawTimeline() {
  if (!cv) return;
  const dpr0 = window.devicePixelRatio || 1;
  let t = 0; try { t = app.engine ? app.engine.time : 0; } catch (_) { }
  const sig = [Math.round(t * 1000), isSource(), store.selectedPartId, store.selectedOverlayId, cv.clientWidth, dpr0, zoom.toFixed(3), scroll.toFixed(3), store.project.style.accent, JSON.stringify(app.pendingCut), JSON.stringify(app.pendingSpeed)].join("|");
  if (!dirty && sig === lastSig) return;
  dirty = false; lastSig = sig;
  const dpr = dpr0; W = cv.clientWidth || 600;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  hits = [];
  dom = domain();
  const accent = store.project.style.accent || "#4fd1c5";
  const viewLbl = document.getElementById("tlMode"); if (viewLbl) viewLbl.textContent = isSource() ? "Vue clip" : "Vue programme";
  if (isSource()) drawSource(accent); else drawProgram(accent);
}

function drawRuler(D) {
  const pps = (W - 2 * PAD) / (dom.t1 - dom.t0), step = niceStep(pps);
  ctx.fillStyle = "#6f7d97"; ctx.font = fontUI(500, 10); ctx.textBaseline = "alphabetic";
  const start = Math.ceil(dom.t0 / step) * step;
  for (let t = start; t <= Math.min(dom.t1, D) + 1e-6; t += step) {
    const x = tx(t); ctx.fillRect(Math.round(x), 11, 1, 5);
    if (x < W - 28) ctx.fillText(fmtTime(t), x + 3, 11);
    for (let k = 1; k < 4; k++) { const xx = tx(t + step * k / 4); if (xx < W - PAD && t + step * k / 4 <= D) ctx.fillRect(Math.round(xx), 14, 1, 2); }
  }
}
function drawEmpty(msg) {
  ctx.fillStyle = "#7d8aa5"; ctx.font = fontUI(500, 13); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(msg, W / 2, H / 2); ctx.textAlign = "left";
}
function drawPlayhead(t) {
  const x = tx(t); if (x < PAD - 2 || x > W - PAD + 2) return;
  ctx.fillStyle = "#fff"; ctx.fillRect(Math.round(x) - 1, 4, 2, H - 6);
  ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill();
}
function markerGlyph(x, accent, m, active) {
  const k = kindOf(m);
  const col = k === "cam" ? "#f6ad55" : k === "slide" ? "#b794f4" : accent;
  ctx.fillStyle = col; ctx.globalAlpha = active ? 1 : 0.95;
  ctx.fillRect(Math.round(x) - 1, Y.blockT - 4, 2, Y.blockB - Y.blockT + 6);
  rr(ctx, x - 9, Y.blockT - 12, 18, 13, 4); ctx.fill();
  ctx.fillStyle = "#0b1020"; ctx.font = fontUI(800, 9); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(m.target === "CAM" ? "C" : m.target === "SLIDE" ? "V" : (m.mode === "slide" ? "▣" : "") + (m.target + 1), x, Y.blockT - 5.5);
  ctx.textAlign = "left"; ctx.globalAlpha = 1;
  if (active) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; rr(ctx, x - 9, Y.blockT - 12, 18, 13, 4); ctx.stroke(); }
}
function laneOf(bars, x0, x1) {
  for (let l = 0; l < LANES; l++) { if (!bars[l].some(([a, b]) => x0 < b + 2 && x1 > a - 2)) { bars[l].push([x0, x1]); return l; } }
  bars[LANES - 1].push([x0, x1]); return LANES - 1;
}
function drawOvBar(ov, x0, x1, lane, selected) {
  const m = OV_META[ov.type] || { color: "#999", icon: "?" };
  const y = Y.lane0 + lane * (Y.laneH + 2), w = Math.max(6, x1 - x0);
  ctx.fillStyle = hexA(m.color, selected ? 0.95 : 0.55); rr(ctx, x0, y, w, Y.laneH, 4); ctx.fill();
  if (selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; rr(ctx, x0, y, w, Y.laneH, 4); ctx.stroke(); }
  if (w > 18) {
    ctx.save(); rr(ctx, x0, y, w, Y.laneH, 4); ctx.clip();
    ctx.fillStyle = "#0b1020"; ctx.font = fontUI(700, 10); ctx.textBaseline = "middle";
    const label = ov.type === "text" ? ov.text : ov.type === "number" ? `${ov.prefix || ""}${ov.value}${ov.suffix || ""}` : ov.type === "zoom" ? "Zoom" : (clipById(ov.clipId)?.name || "B-roll");
    ctx.fillText(`${m.icon} ${String(label).replace(/\s+/g, " ")}`, x0 + 5, y + Y.laneH / 2 + 0.5);
    ctx.restore();
  }
  return { y0: y, y1: y + Y.laneH };
}

function drawProgram(accent) {
  const prog = program();
  if (!prog.spans.length) { drawEmpty("La séquence apparaîtra ici : ajoute une vidéo comme « Partie »."); return; }
  drawRuler(prog.duration);
  const parts = store.project.parts;
  // blocks (spans of the same part are drawn joined, with a thin seam where a cut / speed change happens)
  const first = new Set();
  const sp = prog.spans;
  const selRange = [Infinity, -Infinity];
  sp.forEach((s, k) => {
    const x0 = tx(s.outStart), x1 = tx(s.outEnd);
    const part = s.partId ? partById(s.partId) : null;
    const same = (o) => o && o.partId && o.partId === s.partId && !o.auto && !s.auto;
    const joinL = same(sp[k - 1]), joinR = same(sp[k + 1]);
    let col = "#4a5268", label = "";
    if (s.type === "intro") { col = "#566079"; label = "Intro"; }
    else if (s.type === "outro") { col = "#566079"; label = "Outro"; }
    else if (s.type === "card") { col = s.auto ? "#6c55c9" : "#8b6cf0"; label = s.title || "Carte"; }
    else if (part) { col = partColor(part, prog); label = partLabel(part, parts.indexOf(part)); }
    if (part && part.id === store.selectedPartId && !s.auto) { selRange[0] = Math.min(selRange[0], x0); selRange[1] = Math.max(selRange[1], x1); }
    const gx0 = x0 + (joinL ? 0 : 0.5), gx1 = x1 - (joinR ? 0 : 1.5), w = Math.max(1, gx1 - gx0);
    const grad = ctx.createLinearGradient(0, Y.blockT, 0, Y.blockB);
    grad.addColorStop(0, hexA(col, s.type === "talk" ? 0.62 : 0.75)); grad.addColorStop(1, hexA(col, s.type === "talk" ? 0.38 : 0.5));
    ctx.fillStyle = grad;
    ctx.save(); ctx.beginPath(); ctx.rect(gx0, Y.blockT - 1, w, Y.blockB - Y.blockT + 2); ctx.clip();
    rr(ctx, joinL ? gx0 - 8 : gx0, Y.blockT, w + (joinL ? 8 : 0) + (joinR ? 8 : 0), Y.blockB - Y.blockT, 6); ctx.fill(); ctx.restore();
    if (joinL) { ctx.fillStyle = "rgba(10,14,22,.75)"; ctx.fillRect(Math.round(x0) - 0.5, Y.blockT + 4, 1, Y.blockB - Y.blockT - 8); }
    if (s.speed !== 1 && s.type !== "card" && w > 26) { ctx.fillStyle = "rgba(246,224,94,.95)"; ctx.font = fontUI(800, 9); ctx.textBaseline = "alphabetic"; ctx.fillText(`${String(s.speed).replace(".", ",")}×`, gx1 - 22, Y.blockB - 5); }
    const key = (s.partId || s.type) + (s.auto ? "a" : "");
    if (!first.has(key)) {
      first.add(key);
      let end = k; while (same(sp[end + 1])) end++;
      const fullW = tx(sp[end].outEnd) - x0;
      if (fullW > 24) {
        ctx.save(); ctx.beginPath(); ctx.rect(x0, Y.blockT, fullW - 2, Y.blockB - Y.blockT); ctx.clip();
        ctx.fillStyle = "#f2f5fb"; ctx.font = fontUI(700, 11.5); ctx.textBaseline = "alphabetic";
        ctx.fillText(label, x0 + 7, Y.blockB - 23);
        ctx.fillStyle = "rgba(242,245,251,.68)"; ctx.font = fontUI(500, 10);
        const pd = s.partId && (s.type === "talk" || s.type === "extract") ? sp.filter(o => o.partId === s.partId && o.type === s.type).reduce((a, o) => a + o.outEnd - o.outStart, 0) : s.outEnd - s.outStart;
        ctx.fillText(({ talk: "Présentation", extract: "Extrait", card: s.auto ? "Carte membre" : "Carte", intro: "Animation", outro: "Animation" }[s.type]) + " · " + fmtTime(pd), x0 + 7, Y.blockB - 10);
        ctx.restore();
      }
    }
    hits.push({ x0, x1, y0: Y.blockT, y1: Y.blockB, kind: "block", span: s });
  });
  if (selRange[1] > selRange[0]) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; rr(ctx, selRange[0] + 1, Y.blockT + 1, selRange[1] - selRange[0] - 2.5, Y.blockB - Y.blockT - 2, 6); ctx.stroke(); }
  // overlays + markers of talk parts
  const bars = [[], [], []];
  const selOv = store.selectedOverlayId;
  for (const part of parts) {
    if (part.type !== "talk") continue;
    for (const ov of part.overlays) {
      const o0 = outOf(prog, part, ov.t), o1 = outOf(prog, part, ov.t + ov.dur); if (o0 == null) continue;
      const x0 = tx(o0), x1 = Math.max(x0 + 6, tx(o1 ?? o0));
      const lane = laneOf(bars, x0, x1);
      const { y0, y1 } = drawOvBar(ov, x0, x1, lane, ov.id === selOv);
      hits.push({ x0, x1, y0, y1, kind: "ovProg", part, ov, cursor: "grab" });
    }
  }
  const fi = frameInfo();
  for (const part of parts) {
    if (part.type !== "talk") continue;
    for (const m of part.markers) {
      const o = srcToOut(prog, part.id, m.t); if (o == null) continue;
      const x = tx(o);
      markerGlyph(x, accent, m, drag && drag.m === m);
      hits.push({ x0: x - 9, x1: x + 9, y0: Y.blockT - 13, y1: Y.blockB, kind: "markerProg", part, m, cursor: "ew-resize" });
    }
  }
  drawPlayhead(fi.outT ?? (app.engine ? app.engine.time : 0));
}

function drawSource(accent) {
  const part = dom.part; if (!part) { drawEmpty("Choisis une partie avec une vidéo."); return; }
  const D = dom.D;
  drawRuler(D);
  const [a, b] = partRange(part);
  const col = partColor(part);
  const top = Y.blockT, bot = Y.blockB;
  // clip base
  ctx.fillStyle = "#222b3f"; rr(ctx, tx(0), top, tx(D) - tx(0), bot - top, 6); ctx.fill();
  const g = ctx.createLinearGradient(0, top, 0, bot); g.addColorStop(0, hexA(col, 0.6)); g.addColorStop(1, hexA(col, 0.35));
  ctx.fillStyle = g; ctx.fillRect(tx(a), top, tx(b) - tx(a), bot - top);
  // speed sections
  if (part.type === "talk") for (const s of part.speedSections) {
    const x0 = tx(Math.min(s.a, s.b)), x1 = tx(Math.max(s.a, s.b));
    ctx.fillStyle = "rgba(246,224,94,.22)"; ctx.fillRect(x0, top, x1 - x0, bot - top);
    ctx.fillStyle = "rgba(246,224,94,.95)"; ctx.fillRect(x0, top, 1.5, bot - top); ctx.fillRect(x1 - 1.5, top, 1.5, bot - top);
    ctx.font = fontUI(800, 11); ctx.textBaseline = "alphabetic"; if (x1 - x0 > 30) ctx.fillText(`⏩ ${String(s.speed).replace(".", ",")}×`, x0 + 5, top + 14);
    hits.push({ x0: x0 - 4, x1: x0 + 4, y0: top, y1: bot, kind: "spEdge", part, s, edge: "a", cursor: "ew-resize" });
    hits.push({ x0: x1 - 4, x1: x1 + 4, y0: top, y1: bot, kind: "spEdge", part, s, edge: "b", cursor: "ew-resize" });
  }
  // outside in/out
  ctx.fillStyle = "rgba(6,9,16,.62)";
  ctx.fillRect(tx(0), top, tx(a) - tx(0), bot - top); ctx.fillRect(tx(b), top, tx(D) - tx(b), bot - top);
  // cuts
  if (part.type === "talk") for (const c of part.cuts) {
    const x0 = tx(Math.min(c.a, c.b)), x1 = tx(Math.max(c.a, c.b));
    ctx.fillStyle = getHatch(); ctx.fillRect(x0, top, x1 - x0, bot - top);
    ctx.fillStyle = "#f56565"; ctx.fillRect(x0 - 1, top - 2, 2.5, bot - top + 4); ctx.fillRect(x1 - 1.5, top - 2, 2.5, bot - top + 4);
    if (x1 - x0 > 22) { ctx.font = fontUI(800, 11); ctx.fillStyle = "#fff"; ctx.textBaseline = "alphabetic"; ctx.fillText("✂", (x0 + x1) / 2 - 5, bot - 6); }
    hits.push({ x0, x1, y0: top, y1: bot, kind: "cut", part, c, cursor: "pointer" });
    hits.push({ x0: x0 - 5, x1: x0 + 5, y0: top - 2, y1: bot + 2, kind: "cutEdge", part, c, edge: "a", cursor: "ew-resize" });
    hits.push({ x0: x1 - 5, x1: x1 + 5, y0: top - 2, y1: bot + 2, kind: "cutEdge", part, c, edge: "b", cursor: "ew-resize" });
  }
  // pending cut / speed start
  for (const p of [app.pendingCut, app.pendingSpeed]) {
    if (!p || p.partId !== part.id) continue;
    const x = tx(p.a); ctx.strokeStyle = p === app.pendingCut ? "#f56565" : "#f6e05e"; ctx.setLineDash([4, 3]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, top - 3); ctx.lineTo(x, bot + 3); ctx.stroke(); ctx.setLineDash([]);
  }
  // in / out handles
  for (const [t, edge] of [[a, "in"], [b, "out"]]) {
    const x = tx(t);
    ctx.fillStyle = "#e8ecf4"; rr(ctx, edge === "in" ? x - 1 : x - 7, top - 1, 8, bot - top + 2, 3); ctx.fill();
    ctx.fillStyle = "#0b1020"; ctx.fillRect(edge === "in" ? x + 2 : x - 4, top + 14, 2, bot - top - 28);
    hits.push({ x0: x - 8, x1: x + 8, y0: top - 2, y1: bot + 2, kind: edge, part, cursor: "ew-resize" });
  }
  // label
  ctx.save(); ctx.fillStyle = "rgba(242,245,251,.9)"; ctx.font = fontUI(700, 11); ctx.textBaseline = "alphabetic";
  const c = clipById(part.clipId); ctx.fillText(`${partLabel(part, store.project.parts.indexOf(part))} · clip brut ${c ? "(" + c.name + ")" : ""}`, Math.max(tx(a), PAD) + 12, bot - 8); ctx.restore();
  if (part.type === "talk") {
    const bars = [[], [], []];
    for (const ov of part.overlays) {
      const x0 = tx(ov.t), x1 = tx(ov.t + ov.dur);
      const lane = laneOf(bars, x0, x1);
      const { y0, y1 } = drawOvBar(ov, x0, x1, lane, ov.id === store.selectedOverlayId);
      hits.push({ x0, x1, y0, y1, kind: "ov", part, ov, mode: "move", cursor: "grab" });
      hits.push({ x0: x0 - 3, x1: x0 + 4, y0, y1, kind: "ov", part, ov, mode: "l", cursor: "ew-resize" });
      hits.push({ x0: x1 - 4, x1: x1 + 3, y0, y1, kind: "ov", part, ov, mode: "r", cursor: "ew-resize" });
    }
    for (const m of part.markers) {
      const x = tx(m.t); if (x < PAD - 9 || x > W - PAD + 9) continue;
      markerGlyph(x, accent, m, drag && drag.m === m);
      hits.push({ x0: x - 9, x1: x + 9, y0: Y.blockT - 13, y1: Y.blockB - 18, kind: "marker", part, m, cursor: "ew-resize" });
    }
  }
  if (zoom > 1.01) { // scroll indicator
    const fx0 = dom.t0 / D, fx1 = dom.t1 / D;
    ctx.fillStyle = "rgba(255,255,255,.12)"; rr(ctx, PAD, H - 4, W - 2 * PAD, 3, 1.5); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.5)"; rr(ctx, PAD + fx0 * (W - 2 * PAD), H - 4, (fx1 - fx0) * (W - 2 * PAD), 3, 1.5); ctx.fill();
  }
  drawPlayhead(app.engine ? app.engine.time : 0);
}

/* ---------------- interaction ---------------- */
function hitAt(x, y) { for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h; } return null; }
const r2 = t => Math.round(t * 100) / 100;

function seekX(x) {
  if (!app.engine) return;
  const t = clamp(xt(x), 0, dom.D);
  app.engine.seek(t);
}

export function initTimeline(canvas) {
  cv = canvas; ctx = cv.getContext("2d");
  cv.addEventListener("pointerdown", e => {
    if (store.exporting || !app.engine) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = hitAt(x, y);
    drag = { hit, x0: x, moved: false, m: hit && hit.m };
    if (hit && hit.kind === "ov") drag.grab = xt(x) - hit.ov.t, drag.orig = { t: hit.ov.t, dur: hit.ov.dur };
    if (hit && hit.kind === "ovProg") { const s = srcAtOut(program(), hit.part, xt(x)); drag.grab = s != null ? s - hit.ov.t : 0; }
    if (!hit || hit.kind === "block" || hit.kind === "cut") seekX(x);
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!drag) { const hh = hitAt(x, y); cv.style.cursor = hh && hh.cursor ? hh.cursor : "pointer"; hover = hh; return; }
    if (!drag.moved && Math.abs(x - drag.x0) < 3) return;
    const hit = drag.hit;
    const editable = hit && !["block", "cut"].includes(hit.kind);
    if (!editable) { seekX(x); drag.moved = true; return; }
    if (!drag.moved) { checkpoint(); drag.moved = true; }
    const t = clamp(xt(x), 0, dom.D);
    const prog = program();
    switch (hit.kind) {
      case "markerProg": { const s = srcAtOut(prog, hit.part, t); if (s != null) { hit.m.t = r2(s); app.engine.seek(t); } break; }
      case "marker": hit.m.t = r2(t); app.engine.seek(t); break;
      case "ovProg": { const s = srcAtOut(prog, hit.part, t); if (s != null) hit.ov.t = r2(Math.max(0, s - drag.grab)); break; }
      case "ov": {
        const ov = hit.ov, o = drag.orig;
        if (hit.mode === "move") ov.t = r2(Math.max(0, t - drag.grab));
        else if (hit.mode === "l") { const end = o.t + o.dur; ov.t = r2(clamp(t, 0, end - 0.3)); ov.dur = r2(end - ov.t); }
        else ov.dur = r2(Math.max(0.3, t - o.t));
        break;
      }
      case "cutEdge": hit.c[hit.edge] = r2(t); app.engine.seek(t); break;
      case "spEdge": hit.s[hit.edge] = r2(t); app.engine.seek(t); break;
      case "in": { const [, b] = partRange(hit.part); hit.part.in = r2(clamp(t, 0, b - 0.1)); app.engine.seek(hit.part.in); break; }
      case "out": { const [a] = partRange(hit.part); hit.part.out = r2(Math.max(a + 0.1, t)); app.engine.seek(hit.part.out); break; }
    }
    dirty = true;
    try { app.engine.renderNow(); } catch (_) { }
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null; dirty = true;
    const hit = d.hit;
    if (d.moved && hit && !["block", "cut"].includes(hit.kind)) {
      if (hit.part && hit.part.markers) sortMarkers(hit.part);
      if (hit.kind === "cutEdge") { const c = hit.c; if (c.a > c.b) [c.a, c.b] = [c.b, c.a]; if (c.b - c.a < 0.05) hit.part.cuts = hit.part.cuts.filter(x => x !== c); }
      if (hit.kind === "spEdge") { const s = hit.s; if (s.a > s.b) [s.a, s.b] = [s.b, s.a]; if (s.b - s.a < 0.05) hit.part.speedSections = hit.part.speedSections.filter(x => x !== s); }
      changed("project");
      return;
    }
    if (d.moved) return;
    // plain click
    if (!hit) return;
    if (hit.kind === "block") {
      const id = hit.span.partId;
      if (id && id !== store.selectedPartId) { store.selectedPartId = id; if (store.selectedOverlayId && !(partById(id)?.overlays || []).some(o => o.id === store.selectedOverlayId)) store.selectedOverlayId = null; changed("select"); }
    } else if (hit.kind === "ov" || hit.kind === "ovProg") selectOverlay(hit.part, hit.ov, { seek: false });
    else if (hit.kind === "marker") app.engine.seek(hit.m.t);
    else if (hit.kind === "markerProg") { const o = srcToOut(program(), hit.part.id, hit.m.t); if (o != null) app.engine.seek(o); }
    else if (hit.kind === "in" || hit.kind === "out") app.engine.seek(hit.kind === "in" ? partRange(hit.part)[0] : partRange(hit.part)[1]);
    else if (hit.kind === "cutEdge" || hit.kind === "spEdge") app.engine.seek(hit.c ? hit.c[hit.edge] : hit.s[hit.edge]);
  };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("dblclick", e => {
    // double-click a part block in program view → open its clip view
    const r = cv.getBoundingClientRect(); const hh = hitAt(e.clientX - r.left, e.clientY - r.top);
    if (hh && hh.kind === "block" && hh.span.partId && (hh.span.type === "talk" || hh.span.type === "extract")) setView("source", hh.span.partId);
  });
  cv.addEventListener("wheel", e => {
    if (!isSource()) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      const t = xt(x); const nz = clamp(zoom * (e.deltaY < 0 ? 1.25 : 0.8), 1, 64);
      dirty = true; zoom = nz; const vis = dom.D / zoom; scroll = t - (x - PAD) / (W - 2 * PAD) * vis;
    } else { e.preventDefault(); dirty = true; scroll += e.deltaX / (W - 2 * PAD) * (dom.t1 - dom.t0); }
  }, { passive: false });
}
export function setZoom(z) { zoom = clamp(z, 1, 64); dirty = true; }
export function getZoom() { return zoom; }
/** Keep the playhead visible when zoomed in the source view. */
export function followPlayhead() {
  if (!isSource() || zoom <= 1.01 || !app.engine || drag) return;
  const t = app.engine.time, vis = dom.t1 - dom.t0;
  if (t < dom.t0 || t > dom.t1) scroll = t - vis * 0.1;
}
