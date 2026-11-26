// keyboard.js — shortcuts (ignores only text/number inputs, like v1).
import { store, undo, redo, changed } from "../state.js";
import { app } from "./ctx.js";
import { keyNext, keyMode } from "./markers.js";
import { deleteSelectedOverlay } from "./overlays.js";
import { toast, closeTopModal } from "./widgets.js";
import { togglePlay } from "./transport.js";

export function doUndo() { if (store.exporting) return; if (undo()) toast("↶ Annulé", 1200); else toast("Rien à annuler.", 1400); }
export function doRedo() { if (store.exporting) return; if (redo()) toast("↷ Rétabli", 1200); else toast("Rien à rétablir.", 1400); }

export function initKeyboard() {
  document.addEventListener("keydown", e => {
    const t = e.target, tag = (t.tagName || "").toLowerCase();
    if (e.key === "Escape") {
      if (closeTopModal()) return;
      if (tag === "input" || tag === "textarea") { t.blur(); return; }
      if (store.selectedOverlayId) { store.selectedOverlayId = null; changed("select"); }
      return;
    }
    if (tag === "textarea" || t.isContentEditable || (tag === "input" && /^(text|number|search|email|url|password)$/.test(t.type))) return;
    if (document.querySelector(".modal.show")) return;
    if (store.exporting) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    // Enter keeps its normal meaning on focused controls (buttons, rows, summaries); it is not a shortcut
    if (k === "Enter") return;
    if ((tag === "select" || tag === "input" || tag === "button" || tag === "summary") && (k === " " || k.startsWith("Arrow"))) t.blur();
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); doRedo(); return; }
    if (mod && k.toLowerCase() === "s") { e.preventDefault(); import("./export.js").then(m => m.saveProject()); return; }
    if (mod || e.altKey) return;
    const E = app.engine; if (!E) return;
    switch (k) {
      case " ": e.preventDefault(); togglePlay(); break;
      case "ArrowRight": case "n": case "N": e.preventDefault(); keyNext(1); break;
      case "ArrowLeft": e.preventDefault(); keyNext(-1); break;
      case "c": case "C": keyMode("CAM"); break;
      case "v": case "V": keyMode("SLIDE"); break;
      case "j": case "J": E.nudge(-5); break;
      case "l": case "L": E.nudge(5); break;
      case "k": case "K": E.pause(); break;
      case ",": E.pause(); E.nudge(-1 / 30); break;
      case ".": E.pause(); E.nudge(1 / 30); break;
      case "Home": e.preventDefault(); E.seek(0); break;
      case "End": e.preventDefault(); E.seek(E.duration); break;
      case "Delete": case "Backspace": if (store.selectedOverlayId) { e.preventDefault(); deleteSelectedOverlay(); } break;
      case "?": import("./export.js").then(m => m.showHelp()); break;
    }
  });
  // keep shortcuts working after a click (v1 behaviour)
  document.addEventListener("click", e => { const el = e.target.closest && e.target.closest("button,input[type=checkbox],input[type=range],summary,.seqrow,.ovrow,.thumb"); if (el) setTimeout(() => el.blur(), 0); });
  document.addEventListener("change", e => { if (e.target.matches && e.target.matches("select,input[type=range],input[type=checkbox],input[type=color]")) e.target.blur(); });
}
