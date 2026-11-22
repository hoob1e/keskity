"use strict";
const $ = (sel) => document.querySelector(sel);
const main = $("#main");
let home, renderVersion = 0, examId = null, showingToast, disposePage;
const packCache = new Map();
const escAttr = (v) => md.utils.escapeHtml(v);

function element(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null) e.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined) e.append(child);
  }
  return e;
}
const div = (cls, ...nodes) => element("div", {class: cls}, ...nodes);
const text = (tag, str, cls = null) => element(tag, {class: cls}, str);
const button = (label, onClick, cls = "button") => {
  const b = element("button", {class: cls, type: "button"}, label);
  b.addEventListener("click", onClick);
  return b;
};
const link = (label, href, cls = null) => element("a", {href, class: cls}, label);
const codeTag = (label) => text("span", label, "tag");
const pill = (label) => text("span", label, "pill");
const routeFor = (key, pid) => "#pack/" + key + (pid ? "/" + encodeURIComponent(pid) : "");
const courseRoute = (code) => "#course/" + encodeURIComponent(code);
const dateLabel = (day, options = {month: "short", day: "numeric"}) =>
  new Intl.DateTimeFormat(undefined, options).format(new Date(day + "T12:00:00"));
const howMany = (n, one, many = one + "s") => n + " " + (n === 1 ? one : many);

const md = window.markdownit({html: false, linkify: false, maxNesting: 20});
md.renderer.rules.link_open = () => "<span class='quiet-link'>";
md.renderer.rules.link_close = () => "</span>";
const imageRoute = (key, asset) => "/api/image/" + key + "?path=" + encodeURIComponent(asset.path);
md.renderer.rules.image = (tokens, i, _options, ctx) => {
  const t = tokens[i];
  const path = t.attrGet("src");
  let asset;
  try { asset = ctx.assets.get(decodeURIComponent(path)); } catch {}
  return asset ? '<img class="embedded" loading="lazy" src="' + escAttr(imageRoute(ctx.key, asset)) + '" alt="' + escAttr(asset.alt) + '">'
    : escAttr(t.content || "Image not included");
};
// KaTeX auto-render handles dollar delimiters. Preserve the two LaTeX delimiter
// pairs that Markdown would otherwise treat as backslash escapes.
md.inline.ruler.before("escape", "latex-delimiters", (state, silent) => {
  const start = state.pos, pair = state.src.slice(start, start + 2);
  const close = pair === "\\(" ? "\\)" : pair === "\\[" ? "\\]" : null;
  if (!close) return false;
  const end = state.src.indexOf(close, start + 2);
  if (end < 0) return false;
  if (!silent) state.pending += state.src.slice(start, end + 2);
  state.pos = end + 2;
  return true;
});
function markdown(str, key = "", assets = [], reading = false) {
  const node = div(reading ? "md reading-text" : "md");
  node.innerHTML = md.render(str, {key, assets: new Map(assets.map(a => [a.path, a]))});
  window.renderMathInElement(node, {
    delimiters: [
      {left: "$$", right: "$$", display: true}, {left: "\\[", right: "\\]", display: true},
      {left: "\\(", right: "\\)", display: false}, {left: "$", right: "$", display: false},
    ],
    trust: false, throwOnError: false, strict: "ignore", maxExpand: 150, maxSize: 14,
  });
  return node;
}
function figures(str, key, assets) {
  return assets.filter(a => !str.includes(a.path) && !str.includes(encodeURI(a.path))).map(a =>
    element("figure", {class: "embedded-figure"},
      element("img", {src: imageRoute(key, a), alt: a.alt, loading: "lazy"}),
      text("figcaption", a.alt)));
}

async function api(path, body) {
  const opts = body === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
  };
  const result = await fetch(path, opts);
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || "The request failed.");
  return data;
}
async function updateHome() {
  home = await api("/api/home");
  $("#demo-tag").hidden = !home.demo;
  $("#open-import").hidden = home.demo;
  const status = $("#grader-status");
  status.textContent = home.demo ? "Temporary demo" : "Local workspace";
  status.title = home.grader ? "Advisory local feedback enabled" : "Local feedback off";
}
function toast(message) {
  clearTimeout(showingToast);
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  showingToast = setTimeout(() => node.hidden = true, 4200);
}

$(".skip").addEventListener("click", e => { e.preventDefault(); main.focus(); });
$("#open-help").addEventListener("click", () => $("#help-dialog").showModal());
$("#library-sort").addEventListener("click", () => { if (home) toggleLibrarySort(home); });
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
$("#open-import").addEventListener("click", () => {
  $("#import-status").textContent = "";
  $("#import-dialog").showModal();
});
$("#pick-folder").addEventListener("click", () => $("#folder").click());
$("#pick-file").addEventListener("click", () => $("#packet").click());

const MAX_PACKET = 2 * 1024 * 1024;
const MAX_ASSET = 4 * 1024 * 1024;
const importFiles = async (e) => {
  const input = e.target, files = [...input.files];
  input.value = "";
  if (!files.length) return;
  const status = $("#import-status");
  const buttons = [$("#pick-folder"), $("#pick-file")];
  buttons.forEach(b => b.disabled = true);
  status.classList.remove("error");
  status.textContent = "Checking the selected pack…";
  try {
    const selected = files.filter(f => f.name === "set.json" && (f.webkitRelativePath.split("/").length <= 2));
    if (selected.length !== 1) throw new Error("Select the folder that directly contains published set.json, or choose that file.");
    const packet = selected[0];
    if (packet.size > MAX_PACKET) throw new Error("set.json exceeds 2 MiB.");
    const raw = await packet.text();
    const info = JSON.parse(raw);
    if (!Array.isArray(info?.problems) || info.problems.length > 160) throw new Error("Expected one released problem set (maximum 160 problems).");
    const wanted = new Set(info.problems.flatMap(p => (Array.isArray(p?.assets) ? p.assets : []).map(a => a?.path)));
    if (wanted.size > 100) throw new Error("Too many referenced images.");
    const prefix = packet.webkitRelativePath.replace(/set\.json$/, "");
    const assets = Object.create(null);
    let size = 0;
    for (const f of files) {
      if (!f.webkitRelativePath.startsWith(prefix)) continue;
      const path = f.webkitRelativePath.slice(prefix.length);
      if (!wanted.has(path)) continue;
      size += f.size;
      if (f.size > MAX_ASSET || size > 10 * 1024 * 1024) throw new Error("Images exceed 4 MiB each or 10 MiB total.");
      assets[path] = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",", 2)[1]);
        reader.onerror = () => reject(new Error("Could not read " + f.name));
        reader.readAsDataURL(f);
      });
    }
    const item = await api("/api/import", {packet: raw, assets});
    $("#import-dialog").close();
    toast(item.added ? "Imported " + item.title : "Already in your library");
    await updateHome();
    location.hash = routeFor(item.key);
  } catch (err) {
    status.textContent = err.message;
    status.classList.add("error");
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
};
$("#folder").addEventListener("change", importFiles);
$("#packet").addEventListener("change", importFiles);

function openExam(exam = null) {
  examId = exam?.id ?? null;
  $("#exam-heading").textContent = exam ? "Edit exam" : "Add exam";
  const form = $("#exam-form");
  form.reset();
  form.elements.title.value = exam?.title ?? "";
  form.elements.course.value = exam?.course ?? "";
  form.elements.day.value = exam?.day ?? "";
  $("#courses").replaceChildren(...[...new Set(home.packs.map(p => p.course).filter(Boolean))]
    .map(v => element("option", {value: v})));
  $("#exam-status").textContent = "";
  $("#remove-exam").hidden = !exam;
  $("#exam-dialog").showModal();
}
$("#exam-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const b = e.submitter;
  const editing = examId;
  b.disabled = true;
  try {
    await api("/api/exam", {...data, id: examId});
    $("#exam-dialog").close();
    await render();
    focusExamControl(editing);
    toast("Exam saved");
  } catch (err) { $("#exam-status").textContent = err.message; }
  finally { b.disabled = false; }
});
$("#remove-exam").addEventListener("click", async () => {
  if (!window.confirm("Remove this exam date? Your packs and attempts will stay.")) return;
  try {
    await api("/api/exam-remove", {id: examId});
    $("#exam-dialog").close();
    await render();
    focusExamControl();
  } catch (err) { $("#exam-status").textContent = err.message; }
});

function focusExamControl(id) {
  const edit = Array.from(document.querySelectorAll("[data-edit-exam]")).find(b => b.dataset.editExam === id);
  (edit && edit.getClientRects().length ? edit : $("#add-exam"))?.focus({preventScroll: true});
}

function sectionHead(title, sub, action) {
  const left = div("", text("h2", title), text("p", sub, "muted"));
  return div("section-head", left, action);
}
function progressLine(done, n) {
  if (!n) return text("p", "Investigations only · not counted as checked practice", "muted small");
  return div("progress-line",
    element("progress", {value: done, max: n, "aria-label": done + " of " + n + " checked problems attempted"}),
    text("span", done + " / " + n + " attempted", "small"));
}
function packCard(pack, href = routeFor(pack.key)) {
  const tags = div("card-top", codeTag(pack.course || "Practice"), text("span", howMany(pack.items, "problem"), "small muted"));
  return element("article", {class: "card pack-card ambient-card"}, tags,
    text("h3", pack.title),
    text("p", pack.scope.join(" · ") || "Individual practice", "muted pack-scope"),
    progressLine(pack.attempted, pack.total),
    div("card-foot",
      text("span", pack.submissions ? howMany(pack.submissions, "submission") : "Not started", "small muted"),
      link(href === routeFor(pack.key) ? "Open pack →" : "View overview →", href, "text-action")));
}
function svgNode(tag, attrs, value) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (value !== undefined) node.textContent = value;
  return node;
}
async function render({focus = false} = {}) {
  const version = ++renderVersion;
  for (const dialog of document.querySelectorAll("#problem-picker[open], #support-dialog[open]")) dialog.close();
  disposePage?.();
  disposePage = null;
  main.setAttribute("aria-busy","true");
  let openStudyProblems = false;
  try {
    const parts = location.hash.slice(1).split("/").map(decodeURIComponent);
    const isPack = parts[0] === "pack" && /^[a-f0-9]{64}$/.test(parts[1] || "");
    // The workspace views summarize the database, including work just saved on another screen.
    if (!home || !isPack) await updateHome();
    if (renderVersion !== version) return;
    if (isPack) {
      const key = parts[1];
      let pack = packCache.get(key);
      if (!pack) { pack = await api("/api/pack/"+key); packCache.set(key,pack); }
      const summary = home.packs.find(p => p.key === key);
      const pid = pack.problems.some(p=>p.id===parts[2]) ? parts[2] : summary?.resume_id || pack.problems[0].id;
      const state = await api("/api/solver/" + key + "/" + encodeURIComponent(pid));
      if (renderVersion === version) {
        paintWorkspace("problem", pack.course, pack.key);
        solver(pack,pid,state);
      }
    } else {
      delete main.dataset.readerView;
      if ((parts[0] === "course" || parts[0] === "independent") && parts[1]) {
        const course = parts[0] === "course" ? parts[1] : "";
        const key = course ? "" : parts[1];
        const data = await api(course ? "/api/study/course?code=" + encodeURIComponent(course)
          : "/api/study/independent/" + encodeURIComponent(key));
        if (renderVersion !== version) return;
        paintWorkspace("course", course, key);
        studyDetail(data, course, home);
        openStudyProblems = parts[2] === "problems";
      } else if (parts[0] === "study") {
        paintWorkspace("study");
        studyPage(home);
      } else if (parts[0] === "data") {
        paintWorkspace("data");
        dataPage(home);
      } else {
        paintWorkspace("dashboard");
        disposePage = dashboardPage(home, openExam);
      }
    }
  } catch (err) {
    if (renderVersion === version) {
      delete main.dataset.readerView;
      paintWorkspace("error");
      main.replaceChildren(link("← Dashboard","#home","back"),text("h1","Could not open this view"),text("p",err.message));
    }
  } finally {
    if (renderVersion === version) {
      main.setAttribute("aria-busy","false");
      if (openStudyProblems) jumpToStudyProblems();
      else if (focus) {
        window.scrollTo(0,0);
        main.focus({preventScroll:true});
      }
    }
  }
}
initSolverControls();
window.addEventListener("hashchange", () => render({focus: true}));
render();
