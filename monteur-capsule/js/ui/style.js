// style.js — "Style": themes (+ custom), layout, camera look, background, frames, transitions, texts.
import { store, DEFAULT_STYLE, THEMES, FONTS, changed } from "../state.js";
import { TRANSITIONS, CAM_FILTERS, CAM_ENTERS, BG_ANIMS } from "../render.js";
import { loadImageAsset } from "../media.js";
import { h, mutate, toast, Panel, bind, row, hint, iconBtn, btn, group, pickFiles, onSync } from "./widgets.js";

const S = () => store.project.style;
// keys a theme never touches (export settings, texts that belong to the project)
const KEEP = ["res", "fps", "masterVolume", "monitor", "fadeInOut", "headerText", "logoPos", "logoSize", "duoLayout"];
const sb = (key, o = {}) => bind(S, key, { kind: "style", ...o });
const rng = (key, min, max, step, unit = "", extra = {}) => sb(key, { type: "range", min, max, step, unit, reset: DEFAULT_STYLE[key], ...extra });

export function applyTheme(theme) {
  mutate(() => {
    const keep = {}; for (const k of KEEP) keep[k] = S()[k];
    store.project.style = { ...DEFAULT_STYLE, ...theme, ...keep };
  }, "style");
}
export function resetStyle() {
  if (!confirm("Remettre tous les réglages visuels par défaut ?")) return;
  applyTheme({});
  toast("Style par défaut rétabli (Ctrl+Z pour annuler).");
}
function themeLooksLike(theme) {
  const s = { ...DEFAULT_STYLE, ...theme };
  return Object.entries(s).every(([k, v]) => KEEP.includes(k) || S()[k] === v);
}
function themeCard(name, theme, custom) {
  const s = { ...DEFAULT_STYLE, ...theme };
  const bg = s.bgType === "solid" ? s.bg1 : `linear-gradient(${s.bgAngle}deg, ${s.bg1}, ${s.bg2})`;
  const card = h("button.theme", { type: "button", title: `Appliquer le thème « ${name} »` },
    h("span.tprev", { style: { background: bg } },
      h("span.tslide"), h("span.tcam", { style: { borderColor: s.accent, borderRadius: Math.min(10, s.radius / 3) + "px" } }),
      h("span.tbar", { style: { background: s.bannerBg } })),
    h("span.tname", { text: name }));
  card.onclick = () => { applyTheme(theme); toast(`Thème « ${name} » appliqué`); };
  if (custom) card.append(h("span.tdel", { title: "Supprimer ce thème", text: "✕", role: "button", "aria-label": `Supprimer le thème ${name}`, onclick: e => { e.stopPropagation(); if (confirm(`Supprimer le thème « ${name} » ?`)) mutate(() => { delete store.project.customThemes[name]; }); } }));
  const sync = () => card.classList.toggle("on", themeLooksLike(theme));
  sync(); onSync(sync);
  return card;
}
function saveTheme() {
  const name = (prompt("Nom de ton thème :", "Mon thème") || "").trim();
  if (!name) return;
  const t = {}; for (const [k, v] of Object.entries(S())) if (!KEEP.includes(k) && DEFAULT_STYLE[k] !== v) t[k] = v;
  mutate(() => { store.project.customThemes[name] = t; });
  toast(`Thème « ${name} » sauvé ✔ (il voyage avec le projet)`);
}

export function createStylePanel(el) {
  return new Panel(el, {
    key: () => Object.keys(store.project.customThemes).join("|") + "|" + S().bgType + "|" + !!store.bgImage + !!store.logoImage,
    build: root => {
      const grid = h("div.themes");
      for (const [n, t] of Object.entries(THEMES)) grid.append(themeCard(n, t, false));
      for (const [n, t] of Object.entries(store.project.customThemes)) grid.append(themeCard(n, t, true));
      root.append(grid, h("div.btnrow", btn("★ Sauver comme thème", saveTheme, { cls: "sm", title: "Garde tes réglages actuels comme thème" }), btn("↺ Par défaut", resetStyle, { cls: "sm ghost", title: "Remettre le style par défaut" })));

      root.append(group("st-layout", "▦ Disposition", b => {
        b.append(row("Caméra", sb("camSide", { type: "seg", options: [["left", "À gauche"], ["right", "À droite"]] })));
        b.append(row("Forme", sb("camShape", { type: "seg", options: [["3:4", "3:4"], ["1:1", "Carré"], ["9:16", "9:16"], ["16:9", "16:9"], ["circle", "Rond"]] })));
        b.append(row("Taille caméra", rng("camWidth", 12, 45, 0.5, " %")));
        b.append(row("Alignement", sb("camAlign", { type: "seg", options: [["top", "Haut"], ["center", "Centre"], ["bottom", "Bas"]] })));
        b.append(row("Marges", rng("margin", 0, 8, 0.25, " %")));
        b.append(row("Espace diapo ↔ cam", rng("gap", 0, 6, 0.25, " %")));
        b.append(row("Deux personnes", sb("duoLayout", { type: "seg", options: [["stack", "Empilées + diapo"], ["side", "Côte à côte"]] })));
      }, { open: true }));

      root.append(group("st-cam", "🎥 Image de la caméra", b => {
        b.append(h("div.chips", CAM_FILTERS.map(f => {
          const c = h("button.chip", { type: "button", text: f.label, title: `Filtre ${f.label}` });
          c.onclick = () => mutate(() => { S().camFilter = f.id; }, "style");
          onSync(() => c.classList.toggle("on", S().camFilter === f.id)); c.classList.toggle("on", S().camFilter === f.id);
          return c;
        })));
        b.append(row("Luminosité", rng("camBright", 60, 160, 1, " %")));
        b.append(row("Contraste", rng("camContrast", 60, 160, 1, " %")));
        b.append(row("Saturation", rng("camSat", 0, 180, 1, " %")));
        b.append(row("Entrée de la cam", sb("camEnter", { type: "select", options: CAM_ENTERS.map(e => [e.id, e.label]) })));
        b.append(row("Durée de l'entrée", rng("camEnterDur", 0.2, 1.5, 0.05, " s")));
      }));

      root.append(group("st-bg", "🌄 Arrière-plan", b => {
        b.append(row("Type", sb("bgType", { type: "seg", options: [["solid", "Uni"], ["gradient", "Dégradé"], ["animated", "Animé"], ["image", "Image"]] })));
        const t = S().bgType;
        b.append(row("Couleurs", sb("bg1", { type: "color", label: "Couleur 1" }), t !== "solid" ? sb("bg2", { type: "color", label: "Couleur 2" }) : null, h("span.grow")));
        if (t === "gradient" || t === "animated") b.append(row("Angle", rng("bgAngle", 0, 360, 1, "°")));
        if (t === "animated") {
          b.append(row("Animation", sb("bgAnim", { type: "select", options: BG_ANIMS.map(a => [a.id, a.label]) })));
          b.append(row("Vitesse", rng("bgAnimSpeed", 0.2, 3, 0.1, "×")));
        }
        if (t === "image") {
          b.append(row("Image", btn(store.bgImage ? "Changer…" : "Choisir…", async () => {
            const f = await pickFiles("image/*", false); if (!f.length) return;
            try { store.bgImage = await loadImageAsset(f[0]); changed("style"); toast("Image de fond ✔ (à re-choisir après un rechargement)"); } catch (e) { toast("Image illisible."); }
          }, { cls: "sm" }), store.bgImage ? h("span.hint", { text: "✔ chargée" }) : h("span.hint", { text: "aucune" })));
          b.append(row("Flou", rng("bgBlur", 0, 40, 1, " px")));
          b.append(row("Assombrir", rng("bgDim", 0, 85, 1, " %")));
        }
      }));

      root.append(group("st-frames", "▢ Cadres", b => {
        b.append(row("Couleur d'accent", sb("accent", { type: "color" }), h("span.grow")));
        b.append(row("Coins arrondis", rng("radius", 0, 60, 1, " px")));
        b.append(row("Bordure caméra", rng("camBorder", 0, 14, 0.5, " px")));
        b.append(row("Bordure diapo", rng("slideBorder", 0, 14, 0.5, " px")));
        b.append(row("Ombre", rng("shadow", 0, 80, 1)));
        b.append(row("Halo lumineux", sb("camGlow", { type: "check", title: "Lueur de la couleur d'accent autour de la caméra" })));
      }));

      root.append(group("st-trans", "✨ Transitions entre diapos", b => {
        b.append(h("div.chips", TRANSITIONS.map(f => {
          const c = h("button.chip", { type: "button", text: f.label, title: `Transition ${f.label}` });
          c.onclick = () => mutate(() => { S().trans = f.id; }, "style");
          const s = () => c.classList.toggle("on", S().trans === f.id); s(); onSync(s);
          return c;
        })));
        b.append(row("Durée", rng("transDur", 0.1, 1.5, 0.05, " s")));
        b.append(hint("Chaque changement de diapo peut avoir sa propre transition (panneau « Changements de diapo »)."));
      }));

      root.append(group("st-text", "🔤 Textes et habillage", b => {
        b.append(row("Police", sb("font", { type: "select", options: [["system", "Moderne"], ["rounded", "Arrondie"], ["serif", "Classique (serif)"], ["mono", "Code (mono)"], ["condensed", "Condensée"]] })));
        b.append(h("div.sub", h("span", { text: "Bandeau du nom" })));
        b.append(row("Afficher", sb("bannerOn", { type: "check" })));
        b.append(row("Position", sb("bannerPos", { type: "seg", options: [["cam", "Sous la cam"], ["bl", "Bas gauche"], ["br", "Bas droite"]] })));
        b.append(row("Durée (0 = toujours)", rng("bannerDur", 0, 30, 1, " s")));
        b.append(row("Fond / texte", sb("bannerBg", { type: "color", label: "Fond du bandeau" }), sb("bannerFg", { type: "color", label: "Texte du bandeau" }), h("span.grow")));
        b.append(hint("Le nom et le sous-titre se règlent dans chaque partie (inspecteur)."));
        b.append(h("div.sub", h("span", { text: "En-tête et logo" })));
        b.append(row("Texte en haut", sb("headerText", { type: "text", placeholder: "ex. Introduction à la gestion" })));
        b.append(row("Couleur du texte", sb("headerColor", { type: "color" }), h("span.grow")));
        b.append(row("Logo", btn(store.logoImage ? "Changer…" : "Choisir…", async () => {
          const f = await pickFiles("image/*", false); if (!f.length) return;
          try { store.logoImage = await loadImageAsset(f[0]); changed("style"); toast("Logo ✔ (à re-choisir après un rechargement)"); } catch (e) { toast("Image illisible."); }
        }, { cls: "sm" }), store.logoImage ? iconBtn("✕", "Retirer le logo", () => { store.logoImage = null; changed("style"); }, "del") : h("span.hint", { text: "aucun" })));
        b.append(row("Position du logo", sb("logoPos", { type: "seg", options: [["tl", "↖"], ["tr", "↗"], ["bl", "↙"], ["br", "↘"]] })));
        b.append(row("Taille du logo", rng("logoSize", 4, 20, 0.5, " %")));
        b.append(h("div.sub", h("span", { text: "Extras" })));
        b.append(row("Barre de progression", sb("progressOn", { type: "check" })));
        b.append(row("Numéro de diapo", sb("slideNumOn", { type: "check" })));
      }));
    },
  });
}
export { FONTS };
