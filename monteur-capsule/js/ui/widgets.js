// widgets.js — tiny DOM helpers, bound form controls (with undo checkpoints), panels, toast, modal.
import { store, checkpoint, changed } from "../state.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtNum = (x, d = 2) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("fr-CA", { maximumFractionDigits: d });
export const fmtSec = t => `${(Math.round((+t || 0) * 100) / 100).toFixed(2).replace(".", ",")} s`;

/** h("div.cls#id", {title, onclick, ...}, ...children) */
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs)) { if (attrs != null) kids.unshift(attrs); attrs = {}; }
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || "div");
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) { if (part[0] === ".") el.classList.add(part.slice(1)); else el.id = part.slice(1); }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); }
  return el;
}

/* ---------------- toast ---------------- */
let toastT = 0;
export function toast(msg, ms = 2600, type = "") {
  const el = $("#toast"); if (!el) return;
  el.textContent = msg; el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), ms);
}

/* ---------------- modal ---------------- */
export function openModal(title, body, { actions = [], wide = false, onClose } = {}) {
  const wrap = h("div.modal.show", { role: "dialog", "aria-modal": "true", "aria-label": title });
  const close = () => { wrap.remove(); onClose && onClose(); };
  const card = h("div.mcard" + (wide ? ".wide" : ""),
    h("div.mhead", h("h2", title), h("button.icon", { title: "Fermer (Échap)", "aria-label": "Fermer", onclick: close, text: "✕" })),
    h("div.mbody", body),
    actions.length ? h("div.mfoot", actions.map(a => h("button.btn" + (a.primary ? ".primary" : "") + (a.danger ? ".danger" : ""), { text: a.label, onclick: () => { if (a.onclick && a.onclick() === false) return; close(); } }))) : null);
  wrap.append(card);
  wrap.addEventListener("pointerdown", e => { if (e.target === wrap) close(); });
  wrap._close = close;
  document.body.append(wrap);
  const f = card.querySelector("input,select,textarea,button.primary"); if (f) setTimeout(() => f.focus(), 30);
  return { el: wrap, close };
}
export function closeTopModal() { const ms = $$(".modal.show"); const m = ms[ms.length - 1]; if (!m) return false; if (m._close) m._close(); else m.classList.remove("show"); return true; }

/* ---------------- mutation helpers ---------------- */
/** Run a project mutation with undo: checkpoint() before, changed(kind) after. Returns false while exporting. */
export function mutate(fn, kind = "project") { return mutateP(fn, kind); }
function mutateP(fn, kind) {
  if (store.exporting) { toast("Pas de modification pendant l'export."); return false; }
  checkpoint(); const r = fn(); changed(kind); return r === undefined ? true : r;
}
// continuous controls (sliders, text): one checkpoint per interaction
function commitLive(el, apply, kind) {
  if (kind === "local") { apply(); return; }
  if (store.exporting) return;
  if (!el._cp) { checkpoint(); el._cp = true; }
  apply(); changed(kind);
}
function endLive(el) { el._cp = false; }

/* ---------------- sync collector (panels rebuild only when their structure changes) ---------------- */
let collector = null;
export function collect(fn) { const prev = collector, list = []; collector = list; try { fn(); } finally { collector = prev; } return list; }
export function onSync(fn) { if (collector) collector.push(fn); }

export class Panel {
  constructor(el, { key = () => "", build }) { this.el = el; this.key = key; this.build = build; this._k = null; this.syncers = []; }
  refresh(force = false) {
    if (!this.el) return;
    const k = this.key();
    if (force || k !== this._k || this._proj !== store.project) {
      this._k = k; this._proj = store.project;
      const st = this.el.scrollTop;
      this.el.replaceChildren();
      this.syncers = collect(() => this.build(this.el));
      this.el.scrollTop = st;
    } else for (const s of this.syncers) { try { s(); } catch (e) { console.warn(e); } }
  }
}

/* ---------------- bound controls ----------------
 * bind(getObj, key, opts) -> element. getObj() returns the object holding `key` (re-read on every sync,
 * so the control keeps working after undo replaced the project).
 * opts: {type: range|number|text|textarea|color|check|select|seg, min, max, step, unit, digits, options:[[v,label,title?]],
 *        kind:"project"|"style", toUI, fromUI, after(value), placeholder, label (aria), fmt(v)}
 */
export function bind(getObj, key, o = {}) {
  const kind = o.kind || "project";
  const mutate = (fn, k) => k === "local" ? (fn(), true) : mutateP(fn, k);
  const toUI = o.toUI || (v => v), fromUI = o.fromUI || (v => v);
  const read = () => { const obj = getObj(); return obj ? obj[key] : undefined; };
  const write = v => { const obj = getObj(); if (!obj) return; obj[key] = v; o.after && o.after(v, obj); };
  const t = o.type || "text";
  const aria = o.label || key;

  if (t === "seg") {
    const el = h("div.seg", { role: "radiogroup", "aria-label": aria });
    const btns = o.options.map(([v, lab, tip]) => {
      const b = h("button", { type: "button", text: lab, title: tip || null, role: "radio" });
      b.onclick = () => { if (String(read()) === String(v)) return; mutate(() => write(v), kind); sync(); };
      b._v = v; return b;
    });
    el.append(...btns);
    const sync = () => { const cur = String(toUI(read())); btns.forEach(b => { const on = String(b._v) === cur; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); }); };
    sync(); onSync(sync); return el;
  }
  if (t === "select") {
    const el = h("select", { "aria-label": aria, title: o.title || null });
    const fill = () => {
      const opts = typeof o.options === "function" ? o.options() : o.options;
      el.replaceChildren(...opts.map(([v, lab]) => h("option", { value: String(v), text: lab })));
    };
    fill();
    el.onchange = () => { const raw = el.value; const opt = (typeof o.options === "function" ? o.options() : o.options).find(([v]) => String(v) === raw); mutate(() => write(fromUI(opt ? opt[0] : raw)), kind); el.blur(); };
    const sync = () => { if (typeof o.options === "function") fill(); el.value = String(toUI(read()) ?? ""); };
    sync(); onSync(sync); return el;
  }
  if (t === "check") {
    const inp = h("input", { type: "checkbox", "aria-label": aria });
    const el = h("label.switch", { title: o.title || null }, inp, h("span.slider"));
    inp.onchange = () => { mutate(() => write(fromUI(inp.checked)), kind); };
    const sync = () => { inp.checked = !!toUI(read()); };
    sync(); onSync(sync); return el;
  }
  if (t === "color") {
    const inp = h("input", { type: "color", "aria-label": aria, title: o.title || aria });
    inp.oninput = () => commitLive(inp, () => write(fromUI(inp.value)), kind);
    inp.onchange = () => endLive(inp);
    const sync = () => { if (document.activeElement !== inp) inp.value = toUI(read()) || "#000000"; };
    sync(); onSync(sync); return inp;
  }
  if (t === "range") {
    const inp = h("input", { type: "range", min: o.min ?? 0, max: o.max ?? 100, step: o.step ?? 1, "aria-label": aria });
    const val = h("span.val");
    const show = v => { val.textContent = o.fmt ? o.fmt(v) : `${fmtNum(v, o.digits ?? 2)}${o.unit || ""}`; };
    inp.oninput = () => { const v = parseFloat(inp.value); show(v); commitLive(inp, () => write(fromUI(v)), kind); };
    inp.onchange = () => endLive(inp);
    inp.addEventListener("dblclick", () => { if (o.reset == null) return; mutate(() => write(o.reset), kind); sync(); });
    const sync = () => { const v = toUI(read()); if (document.activeElement !== inp) inp.value = v ?? 0; show(+(v ?? 0)); };
    sync(); onSync(sync);
    if (o.reset != null) inp.title = "Double-clic : valeur par défaut";
    return h("div.rangebox", inp, val);
  }
  if (t === "number") {
    const inp = h("input", { type: "number", min: o.min ?? null, max: o.max ?? null, step: o.step ?? "any", "aria-label": aria, placeholder: o.placeholder || null });
    const apply = () => {
      let v = parseFloat(String(inp.value).replace(",", "."));
      if (!isFinite(v)) { if (o.allowEmpty) v = null; else return; }
      if (v != null) { if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v); }
      commitLive(inp, () => write(fromUI(v)), kind);
    };
    inp.oninput = apply;
    inp.onchange = () => { endLive(inp); sync(true); };
    inp.onblur = () => endLive(inp);
    const sync = force => { if (force || document.activeElement !== inp) { const v = toUI(read()); inp.value = v == null || v === "" ? "" : +(+v).toFixed(o.digits ?? 2); } };
    sync(true); onSync(() => sync()); return inp;
  }
  // text / textarea
  const inp = t === "textarea" ? h("textarea", { rows: o.rows || 2, "aria-label": aria, placeholder: o.placeholder || null }) : h("input", { type: "text", "aria-label": aria, placeholder: o.placeholder || null, maxlength: o.maxlength || null });
  inp.oninput = () => commitLive(inp, () => write(fromUI(inp.value)), kind);
  inp.onchange = () => endLive(inp);
  inp.onblur = () => endLive(inp);
  const sync = () => { if (document.activeElement !== inp) inp.value = toUI(read()) ?? ""; };
  sync(); onSync(sync); return inp;
}

/** A labelled row. */
export function row(label, ...ctl) {
  return h("div.row", label != null ? h("label", { text: label }) : null, ...ctl);
}
export function sub(text, extra) { return h("div.sub", h("span", { text }), extra || null); }
export function hint(html) { return h("div.hint", { html }); }
export function btn(label, onclick, { cls = "", title = null, disabled = false, kbd = null } = {}) {
  const b = h("button.btn" + (cls ? "." + cls.split(" ").join(".") : ""), { type: "button", title, disabled }, label, kbd ? h("kbd", { text: kbd }) : null);
  b.addEventListener("click", e => { onclick(e); });
  return b;
}
export function iconBtn(icon, title, onclick, cls = "") {
  return h("button.icon" + (cls ? "." + cls : ""), { type: "button", title, "aria-label": title, text: icon, onclick: e => { e.stopPropagation(); onclick(e); } });
}
/** Collapsible sub-group inside a panel (keeps its open state across rebuilds). */
const groupOpen = new Map();
export function group(id, title, build, { open = false, badge = "" } = {}) {
  const d = h("details.grp");
  d.open = groupOpen.has(id) ? groupOpen.get(id) : open;
  d.addEventListener("toggle", () => groupOpen.set(id, d.open));
  d.append(h("summary", h("span", { text: title }), badge ? h("span.badge", { text: badge }) : null));
  const body = h("div.grpbody"); d.append(body); build(body);
  return d;
}
/** Swatch chips (accent colors etc.) */
export function swatches(colors, getObj, key, kind = "project", { allowNone = false } = {}) {
  const el = h("div.swatches");
  const mk = c => {
    const b = h("button.sw", { type: "button", title: c || "Couleur automatique", "aria-label": c || "automatique", style: { background: c || "transparent" } });
    if (!c) b.classList.add("none");
    b.onclick = () => mutateP(() => { getObj()[key] = c; }, kind);
    b._c = c; return b;
  };
  const list = (allowNone ? [null] : []).concat(colors).map(mk);
  el.append(...list);
  const sync = () => { const cur = getObj() ? getObj()[key] : null; list.forEach(b => b.classList.toggle("on", (b._c || null) === (cur || null))); };
  sync(); onSync(sync); return el;
}

export function download(url, name) { const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); }
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = h("textarea", { style: { position: "fixed", opacity: 0 } }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (_) { } ta.remove(); return ok;
  }
}
export function pickFiles(accept, multiple = true) {
  return new Promise(res => {
    const inp = h("input", { type: "file", accept, multiple, style: { display: "none" } });
    inp.onchange = () => { res([...inp.files]); inp.remove(); };
    document.body.append(inp); inp.click();
  });
}
