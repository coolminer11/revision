// main.js — boot + wiring: engine, panels, timeline, keyboard, render loop for the UI.
import { Engine } from "./engine.js";
import { store, on, loadSaved, partById, STORE_KEY, canUndo } from "./state.js";
import { app, frameInfo, isSource, beginFrame, endFrame } from "./ui/ctx.js";
import { $, toast } from "./ui/widgets.js";
import { createBinPanel, doImport, doSlides } from "./ui/bin.js";
import { createSequencePanel } from "./ui/sequence.js";
import { createInspectorPanel } from "./ui/inspector.js";
import { createMarkersPanel, renderThumbs, highlightMarkers } from "./ui/markers.js";
import { createOverlaysPanel, initPreviewEditing, updateGuides, selectedOverlay } from "./ui/overlays.js";
import { createStylePanel } from "./ui/style.js";
import { createMusicPanel, createTimePanel, createChaptersPanel, createThumbPanel, updateTimePill } from "./ui/extras.js";
import { createExportPanel, saveProject, openProject, showHelp, updateRelink } from "./ui/export.js";
import { initTimeline, drawTimeline, followPlayhead, markTimelineDirty } from "./ui/timeline.js";
import { initKeyboard, doUndo, doRedo } from "./ui/keyboard.js";
import { initTransport, updateTransport } from "./ui/transport.js";

loadSaved();

let engine = null;
try { engine = new Engine($("#preview")); }
catch (e) { console.error(e); toast("Le moteur vidéo n'a pas pu démarrer : " + (e.message || e), 8000, "warn"); }
app.engine = engine;

/* ---------------- panels ---------------- */
const body = id => $(`#${id} .pbody`);
const isOpen = id => $(`#${id}`).open;
const panels = {
  media: createBinPanel(body("p-media")),
  seq: createSequencePanel(body("p-seq")),
  insp: createInspectorPanel(body("p-insp")),
  markers: createMarkersPanel(body("p-markers")),
  overlays: createOverlaysPanel(body("p-overlays")),
  style: createStylePanel(body("p-style")),
  music: createMusicPanel(body("p-music")),
  time: createTimePanel(body("p-time")),
  chapters: createChaptersPanel(body("p-chapters")),
  thumb: createThumbPanel(body("p-thumb"), () => isOpen("p-thumb")),
  export: createExportPanel(body("p-export")),
};
let lastThumbsKey = "";
function refreshAll() {
  // the clip view needs a talk/extract part: fall back to the program view if it disappeared (undo, delete…)
  if (isSource()) { const p = partById(store.selectedPartId); if (!p || p.type === "card") { try { engine.setView("program"); store.view = "program"; } catch (_) { } } }
  computeFocus();
  for (const [k, p] of Object.entries(panels)) { try { p.refresh(); } catch (e) { console.error("panel " + k, e); } }
  const tk = store.slideThumbs.length + "|" + store.slideThumbs[0]?.slice(-24) + "|" + store.project.slideVideos.map(v => v.slide + (v.clipId || "")).join(",");
  if (tk !== lastThumbsKey) { lastThumbsKey = tk; renderThumbs(); }
  updateBadges(); updateRelink(); updateTimePill();
  $("#btnUndo").disabled = !canUndo() || store.exporting;
  document.body.classList.toggle("is-exporting", !!store.exporting);
  try { if (engine && !engine.playing) engine.renderNow(); } catch (_) { }
}
app.refreshAll = refreshAll;

/** Which talk part the marker/overlay panels show: under the playhead (program) or selected (source / fallback). */
function computeFocus() {
  let id = null;
  if (isSource()) id = store.selectedPartId;
  else {
    const fi = frameInfo();
    if (fi.span && fi.span.type === "talk") id = fi.span.partId;
    else {
      const sel = partById(store.selectedPartId);
      if (sel && sel.type === "talk") id = sel.id;
    }
  }
  const p = partById(id);
  app.focusPartId = p && p.type === "talk" ? p.id : null;
}

function updateBadges() {
  const set = (id, txt) => { const b = $(`#${id} .count`); if (b && b.textContent !== txt) b.textContent = txt; };
  set("p-media", Object.keys(store.project.clips).length ? String(Object.keys(store.project.clips).length) : "");
  set("p-seq", store.project.parts.length ? String(store.project.parts.length) : "");
  const fp = partById(app.focusPartId);
  set("p-markers", fp ? String(fp.markers.length) : "");
  set("p-overlays", fp && fp.overlays.length ? String(fp.overlays.length) : "");
  const p = partById(store.selectedPartId);
  set("p-insp", p ? (p.type === "talk" ? (p.member.name || "Présentation") : p.type === "extract" ? "Extrait" : "Carte") : "");
}

on("any", () => { markTimelineDirty(); refreshAll(); });
on("view", () => { markTimelineDirty(); refreshAll(); });
on("mediaWarning", d => { const m = d && (d.message || d); if (m) toast(String(m), 7000, "warn"); });
on("exportstate", () => { markTimelineDirty(); refreshAll(); });
// the thumbnail preview is generated on demand: also when its panel is opened
$("#p-thumb").addEventListener("toggle", () => { if ($("#p-thumb").open && panels.thumb.kick) panels.thumb.kick(); });

/* ---------------- header ---------------- */
$("#btnSave").onclick = saveProject;
$("#btnOpen").onclick = openProject;
$("#btnHelp").onclick = showHelp;
$("#btnUndo").onclick = doUndo;
$("#btnRedo").onclick = doRedo;

/* ---------------- global drop (anywhere on the page) ---------------- */
let dragDepth = 0;
window.addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; document.body.classList.add("dropping"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dropping"); });
window.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
window.addEventListener("drop", e => {
  dragDepth = 0; document.body.classList.remove("dropping");
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  // images only + no video → probably slides if the deck is empty and names look like slides
  const allImgs = files.every(f => f.type.startsWith("image/"));
  if (allImgs && files.length > 1 && /diapo|slide/i.test(files[0].name)) doSlides(files); else doImport(files);
});
window.addEventListener("beforeunload", e => { if (store.exporting) { e.preventDefault(); e.returnValue = ""; } });

/* ---------------- init ---------------- */
initTimeline($("#timeline"));
initPreviewEditing();
initKeyboard();
initTransport();
$("#tlZoomHint").title = "Vue clip : molette pour zoomer";
refreshAll();

/* UI loop: transport readout, timeline, current marker highlight, guides, focus part changes */
let lastFocus = null;
function loop() {
  beginFrame();
  try {
    updateTransport();
    computeFocus();
    if (app.focusPartId !== lastFocus) { lastFocus = app.focusPartId; panels.markers.refresh(); panels.overlays.refresh(); updateBadges(); }
    followPlayhead();
    drawTimeline();
    highlightMarkers();
    updateGuides();
  } catch (e) { console.error(e); }
  endFrame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

try { if (!localStorage.getItem(STORE_KEY + "-seen")) { showHelp(); localStorage.setItem(STORE_KEY + "-seen", "1"); } } catch (e) { }

// small debugging hook (handy in the console and for tests)
window.__monteur = { store, app, refreshAll, selectedOverlay };
