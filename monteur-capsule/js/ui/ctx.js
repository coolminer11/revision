// ctx.js — shared UI context: engine handle, which part/time the tools act on, seeking helpers.
import { store, partById, program, srcToOut, changed } from "../state.js";
import { toast } from "./widgets.js";

export const app = {
  engine: null,
  focusPartId: null,     // talk part shown in "Changements de diapo" / "Éléments à l'écran"
  pendingCut: null,      // {partId, a}
  pendingSpeed: null,    // {partId, a}
  refreshAll: () => { },
};

let fiCache = null;   // valid only inside one UI-loop tick (event handlers always get fresh info)
export function beginFrame() { fiCache = null; app._inFrame = true; }
export function endFrame() { app._inFrame = false; fiCache = null; }
export function frameInfo() {
  if (app._inFrame && fiCache) return fiCache;
  let fi; try { fi = (app.engine && app.engine.currentFrameInfo()) || {}; } catch (e) { fi = {}; }
  if (app._inFrame) fiCache = fi;
  return fi;
}
export const isSource = () => !!app.engine && app.engine.view === "source";

/** Part under the playhead (any type) — program view: span's part; source view: the selected part. */
export function partUnderPlayhead() {
  if (isSource()) return partById(store.selectedPartId);
  const fi = frameInfo();
  if (fi.part) return fi.part;
  return fi.span && fi.span.partId ? partById(fi.span.partId) : null;
}

/** Source time of `part` at the playhead, or null when the playhead is elsewhere. */
export function srcTimeIn(part) {
  if (!part) return null;
  const fi = frameInfo();
  if (isSource()) return part.id === store.selectedPartId ? (fi.srcT ?? app.engine.time) : null;
  const span = fi.span;
  if (span && span.partId === part.id && (span.type === "talk" || span.type === "extract")) return fi.srcT;
  return null;
}

/** Talk part the keyboard / "+ élément" tools act on, with its current source time. Toasts when there is none. */
export function targetTalk(quiet = false) {
  const fi = frameInfo();
  if (isSource()) {
    const part = partById(store.selectedPartId);
    if (part && part.type === "talk") return { part, srcT: fi.srcT ?? app.engine.time };
    if (!quiet) toast("Cette vue clip n'est pas une partie « présentation ».");
    return null;
  }
  const span = fi.span;
  if (span && span.type === "talk") {
    const part = fi.part || partById(span.partId);
    if (part) return { part, srcT: fi.srcT };
  }
  if (!quiet) toast(store.project.parts.length ? "Place la tête de lecture sur une partie où quelqu'un présente." : "Ajoute d'abord une vidéo comme « Partie ».");
  return null;
}

/** Seek so that `part` shows source time t (stays in source view if it is open on that part). */
export function seekSrc(part, t) {
  if (!app.engine || !part) return;
  if (isSource() && store.selectedPartId === part.id) { app.engine.seek(t); return true; }
  if (isSource()) setView("program");
  const out = srcToOut(program(), part.id, t);
  if (out == null) { toast("Ce moment est coupé du montage (ouvre la vue clip pour le voir)."); return false; }
  app.engine.seek(out); return true;
}

export function setView(view, partId = store.selectedPartId) {
  if (!app.engine) return;
  if (view === "source") {
    const p = partById(partId);
    if (!p || (p.type !== "talk" && p.type !== "extract")) { toast("Choisis une partie avec une vidéo pour la vue clip."); return; }
    store.selectedPartId = p.id;
  }
  const cur = frameInfo();
  try { app.engine.setView(view, partId); } catch (e) { console.warn(e); toast("Impossible d'ouvrir cette vue pour l'instant."); return; }
  store.view = view;
  // keep the same moment when switching
  try {
    if (view === "source" && cur.span && cur.span.partId === partId && cur.srcT != null) app.engine.seek(cur.srcT);
    else if (view === "program" && cur.srcT != null && partById(partId)) {
      const out = srcToOut(program(), partId, cur.srcT); if (out != null) app.engine.seek(out);
    }
  } catch (e) { }
  changed("select");
}

export function selectPart(id, { seek = true } = {}) {
  store.selectedPartId = id;
  const p = partById(id);
  if (store.selectedOverlayId && !(p && p.overlays && p.overlays.some(o => o.id === store.selectedOverlayId))) store.selectedOverlayId = null;
  if (app.engine && seek && p) {
    if (isSource()) { if (p.type === "card") setView("program"); else { app.engine.setView("source", id); } }
    if (!isSource()) {
      const prog = program();
      const s = prog.spans.find(s => s.partId === id && !s.auto) || prog.spans.find(s => s.partId === id);
      if (s) app.engine.seek(s.outStart + 0.001);
    }
  }
  changed("select");
}

export const editingLocked = () => store.exporting;
