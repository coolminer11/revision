// transport.js — play/pause, ±5 s, frame step, rate, time readout, program/clip view toggle, big "next slide" button.
import { store, fmtTime, partById } from "../state.js";
import { app, isSource, setView, frameInfo } from "./ctx.js";
import { keyNext, keyMode } from "./markers.js";
import { partLabel } from "./sequence.js";
import { $, toast } from "./widgets.js";

export function togglePlay() {
  const E = app.engine; if (!E || store.exporting) return;
  if (!store.project.parts.length && !store.project.intro.on && !store.project.outro.on) return toast("Ajoute d'abord une vidéo (Médias → + Partie).");
  try { E.toggle(); } catch (e) { console.warn(e); }
}

export function initTransport() {
  const E = () => app.engine;
  $("#btnPlay").onclick = togglePlay;
  $("#btnBack").onclick = () => E().nudge(-5);
  $("#btnFwd").onclick = () => E().nudge(5);
  $("#btnPrevF").onclick = () => { E().pause(); E().nudge(-1 / 30); };
  $("#btnNextF").onclick = () => { E().pause(); E().nudge(1 / 30); };
  $("#rate").onchange = e => { try { E().setRate(+e.target.value); } catch (_) { } e.target.blur(); };
  $("#btnMark").onclick = () => keyNext(1);
  $("#btnCam").onclick = () => keyMode("CAM");
  $("#btnSolo").onclick = () => keyMode("SLIDE");
  $("#viewProg").onclick = () => { if (isSource()) setView("program"); };
  $("#viewSrc").onclick = () => {
    if (isSource()) return;
    const fi = frameInfo();
    const id = fi.span && fi.span.partId && (fi.span.type === "talk" || fi.span.type === "extract") ? fi.span.partId : store.selectedPartId;
    setView("source", id);
  };
}

let lastTxt = "", lastPlaying = null, lastView = "";
export function updateTransport() {
  const E = app.engine; if (!E) return;
  let t = 0, d = 0, playing = false;
  try { t = E.time || 0; d = E.duration || 0; playing = !!E.playing; } catch (_) { }
  const txt = `${fmtTime(t, true)} / ${fmtTime(d, true)}`;
  if (txt !== lastTxt) { $("#timeLbl").textContent = txt; lastTxt = txt; }
  if (playing !== lastPlaying) {
    lastPlaying = playing;
    const b = $("#btnPlay"); b.innerHTML = playing ? `<span class="ic">❚❚</span>` : `<span class="ic">▶</span>`;
    b.title = playing ? "Pause (Espace)" : "Lecture (Espace)"; b.setAttribute("aria-label", b.title);
    b.classList.toggle("playing", playing);
  }
  const src = isSource();
  const vkey = src + "|" + store.selectedPartId;
  if (vkey !== lastView) {
    lastView = vkey;
    $("#viewProg").classList.toggle("on", !src); $("#viewSrc").classList.toggle("on", src);
    const p = partById(store.selectedPartId);
    $("#srcBadge").classList.toggle("show", src);
    $("#srcBadge").textContent = src && p ? `Vue clip · ${partLabel(p, store.project.parts.indexOf(p))} — vidéo brute, sans coupes` : "";
  }
  const empty = !store.project.parts.length && !store.project.intro.on && !store.project.outro.on;
  $("#emptyMsg").classList.toggle("show", empty);
}
