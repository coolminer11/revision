// export.js — "Exporter" panel + project save/open + help modal + relink banner.
import { store, exportJSON, importJSON, fmtTime, program, changed } from "../state.js";
import { app } from "./ctx.js";
import { h, $, toast, Panel, bind, row, hint, btn, download, openModal, pickFiles } from "./widgets.js";
import { doImport, clipUses } from "./bin.js";

const S = () => store.project.style;
let last = null;       // {url, name, size, ext, seconds}
let progress = { p: 0, text: "" };

export function createExportPanel(el) {
  const sb = (k, o) => bind(S, k, { kind: "style", ...o });
  return new Panel(el, {
    key: () => String(store.exporting) + (last ? last.url : ""),
    build: root => {
      const locked = store.exporting;
      const box = h("div", { class: locked ? "locked" : "" });
      box.append(row("Qualité", sb("res", { type: "seg", options: [["1080", "1080p"], ["720", "720p"]] })));
      box.append(row("Images / seconde", sb("fps", { type: "seg", options: [["30", "30"], ["60", "60"]] })));
      box.append(row("Volume général", sb("masterVolume", { type: "range", min: 0, max: 250, step: 5, unit: " %", reset: 100 })));
      box.append(row("Entendre pendant l'export", sb("monitor", { type: "check" })));
      box.append(row("Fondu au début et à la fin", sb("fadeInOut", { type: "check" })));
      root.append(box);
      const go = h("button.btn.export" + (locked ? ".cancel" : ""), { type: "button", text: locked ? "⏹ Annuler l'export" : "⬇️ Exporter la vidéo finale", title: locked ? "Arrêter l'export" : "Enregistre la vidéo finale (en temps réel)" });
      go.onclick = () => (store.exporting ? cancel() : startExport());
      root.append(go);
      const pr = h("div.progress", h("div", { id: "expProg", style: { width: (progress.p * 100) + "%" } }));
      root.append(pr, h("div.hint", { id: "expInfo", html: progress.text || `L'export se fait en temps réel : ${fmtTime(program().duration)} de montage ≈ ${fmtTime(program().duration)} d'export. <b>Garde cet onglet ouvert et visible.</b>` }));
      if (last && !locked) root.append(h("div.dlbox", h("a.btn.primary", { href: last.url, download: last.name, text: `⬇️ ${last.name}` }), h("span.hint", { text: `${(last.size / 1048576).toFixed(1)} Mo · ${last.ext.toUpperCase()}${last.ext === "webm" ? " (YouTube l'accepte)" : ""}` })));
      root.append(hint("Format : MP4 si ton navigateur le permet (Chrome/Edge récents), sinon WebM. Rien n'est envoyé sur Internet."));
    },
  });
}

function setProg(p, text) {
  progress = { p, text };
  const bar = $("#expProg"); if (bar) bar.style.width = (p * 100).toFixed(1) + "%";
  const info = $("#expInfo"); if (info) info.innerHTML = text;
}
let starting = false;
async function startExport() {
  if (starting || store.exporting) return;
  const prog = program();
  if (!prog.spans.length) return toast("Ta séquence est vide : ajoute une partie d'abord.");
  const unlinked = Object.values(store.project.clips).filter(c => !c.linked && clipUses(c.id).length);
  if (unlinked.length) {
    toast("Certains fichiers ne sont pas chargés : ré-importe-les dans Médias.", 5000, "warn");
    const names = unlinked.map(c => `• ${c.name} (${[...new Set(clipUses(c.id))].join(", ")})`).join("\n");
    if (!confirm(`Ces fichiers ne sont pas chargés et manqueront dans la vidéo :\n${names}\n\nExporter quand même ?`)) return;
  }
  if (!store.slides.length && store.project.parts.some(p => p.type === "talk" && p.layout !== "cam") && !confirm("Aucune présentation chargée. Exporter quand même ?")) return;
  starting = true;
  document.body.classList.add("is-exporting");
  $("#recBadge").classList.add("show");
  setProg(0, "Préparation…");
  const t0 = performance.now();
  // the engine sets store.exporting; refresh panels once it is on
  setTimeout(() => app.refreshAll(), 50);
  try {
    const res = await app.engine.exportVideo({
      onProgress: ({ p, outT, duration, eta }) => {
        setProg(p || 0, `Export : <b>${Math.round((p || 0) * 100)} %</b> · ${fmtTime(outT || 0)} / ${fmtTime(duration || 0)}${eta != null ? ` · environ ${Math.ceil(eta)} s restantes` : ""}. Garde l'onglet visible.`);
      },
      onStatus: msg => { if (msg) toast(msg, 5000, "warn"); },
    });
    if (res && res.url) {
      const base = (store.project.intro.title || store.project.thumbnail.title || "capsule").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 50) || "capsule";
      last = { url: res.url, name: `${base}_monte.${res.ext || "mp4"}`, size: res.blob ? res.blob.size : 0, ext: res.ext || "mp4", seconds: res.seconds };
      setProg(1, `✔ Terminé en ${Math.round((performance.now() - t0) / 1000)} s.`);
      download(last.url, last.name);
      toast("Vidéo exportée ✔");
    } else setProg(0, "Export annulé.");
  } catch (e) {
    console.error(e);
    setProg(0, "Export interrompu.");
    toast("Export impossible : " + (e.message || e), 7000, "warn");
  } finally {
    starting = false;
    document.body.classList.remove("is-exporting");
    $("#recBadge").classList.remove("show");
    if (store.exporting && !app.engine.exporting) store.exporting = false;
    changed("select");
  }
}
function cancel() { try { app.engine.cancelExport(); } catch (e) { } toast("Export annulé."); }

/* ---------------- project ---------------- */
export function saveProject() {
  const blob = new Blob([exportJSON()], { type: "application/json" });
  const u = URL.createObjectURL(blob);
  const base = (store.project.intro.title || "capsule").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 40) || "capsule";
  download(u, `${base}_projet.json`); setTimeout(() => URL.revokeObjectURL(u), 3000);
  toast("Projet sauvegardé. Les médias ne sont pas inclus : garde tes fichiers.", 4000);
}
export async function openProject() {
  if (store.exporting) return;
  const f = await pickFiles(".json,application/json", false); if (!f.length) return;
  try {
    importJSON(await f[0].text());
    const n = Object.keys(store.project.clips).length;
    toast(n ? `Projet ouvert ✔ Ré-importe tes ${n} fichier(s) pour continuer.` : "Projet ouvert ✔", 5000);
  } catch (e) { toast("Fichier de projet invalide : " + (e.message || e), 5000, "warn"); }
}

/* ---------------- relink banner ---------------- */
export function updateRelink() {
  const el = $("#relink"); if (!el) return;
  const list = Object.values(store.project.clips).filter(c => !c.linked);
  el.classList.toggle("show", list.length > 0);
  if (!list.length) return;
  const names = list.map(c => c.fileName || c.name);
  const key = names.join("|"); if (el.dataset.k === key) return; el.dataset.k = key;
  el.replaceChildren(h("span.ric", { text: "⚠" }), h("div.grow", h("b", { text: "Ré-importe tes fichiers pour continuer" }), h("div.hint", { text: names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "") })),
    btn("Ré-importer…", async () => { const f = await pickFiles("video/*,image/*,audio/*,.mov,.mkv,.m4a,.mp3", true); if (f.length) doImport(f); }, { cls: "sm primary" }));
}

/* ---------------- help ---------------- */
export function showHelp() {
  const body = h("div.help", { html: `
  <ol class="steps">
    <li><b>Médias</b> : ajoute les vidéos (filmées au cell), les photos, la musique et ta présentation <b>en PDF</b> (PowerPoint → Fichier → Exporter → PDF).</li>
    <li><b>Séquence</b> : chaque vidéo devient une <b>Partie</b> (quelqu'un présente) ou un <b>Extrait</b> (entrevue). Glisse pour changer l'ordre.</li>
    <li>Fais jouer et appuie sur <kbd>→</kbd> quand il faut changer de diapo. <kbd>C</kbd> = caméra plein écran, <kbd>V</kbd> = diapo seule.</li>
    <li>Ajoute des <b>éléments à l'écran</b> (texte, chiffre animé, zoom, B-roll) et choisis un <b>style</b>.</li>
    <li>Vérifie le <b>temps</b>, copie les <b>chapitres YouTube</b>, puis <b>Exporter</b>.</li>
  </ol>
  <h3>Raccourcis</h3>
  <div class="keys">
    <div><kbd>Espace</kbd><span>Lecture / pause</span></div>
    <div><kbd>→</kbd> <kbd>N</kbd><span>Diapo suivante ici</span></div>
    <div><kbd>←</kbd><span>Diapo précédente</span></div>
    <div><kbd>C</kbd><span>Caméra plein écran</span></div>
    <div><kbd>V</kbd><span>Diapo seule</span></div>
    <div><kbd>J</kbd> <kbd>L</kbd><span>−5 s / +5 s</span></div>
    <div><kbd>,</kbd> <kbd>.</kbd><span>Image par image</span></div>
    <div><kbd>Ctrl</kbd>+<kbd>Z</kbd><span>Annuler</span></div>
    <div><kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>Z</kbd><span>Rétablir</span></div>
    <div><kbd>Suppr</kbd><span>Supprimer l'élément choisi</span></div>
    <div><kbd>Échap</kbd><span>Désélectionner / fermer</span></div>
  </div>
  <p class="hint">Tout est traité sur ton ordi, rien n'est envoyé sur Internet. Le projet se sauvegarde tout seul dans ce navigateur ; « Sauver » te donne un fichier pour le continuer ailleurs (les vidéos ne sont pas dedans : garde-les).</p>` });
  openModal("Comment ça marche", body, { actions: [{ label: "C'est parti !", primary: true }], wide: true });
}
