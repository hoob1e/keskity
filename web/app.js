"use strict";
const $ = (sel) => document.querySelector(sel);
const main = $("#main");
let home, renderVersion = 0, examId = null, showingToast;
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
const dayDistance = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
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
function markdown(str, key = "", assets = []) {
  const node = div("md");
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
  $("#grader-status").textContent = home.grader ? "Advisory local feedback enabled" : "Works offline · local feedback off";
}
function toast(message) {
  clearTimeout(showingToast);
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  showingToast = setTimeout(() => node.hidden = true, 4200);
}

const themes = ["paper", "dark", "ink"];
try {
  const chosen = localStorage.getItem("study-hub-theme");
  if (themes.includes(chosen)) document.documentElement.dataset.theme = chosen;
} catch {}
$("#theme").value = document.documentElement.dataset.theme;
$("#theme").addEventListener("change", (e) => {
  document.documentElement.dataset.theme = e.target.value;
  try { localStorage.setItem("study-hub-theme", e.target.value); } catch {}
});
$(".skip").addEventListener("click", e => { e.preventDefault(); main.focus(); });
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
  b.disabled = true;
  try {
    await api("/api/exam", {...data, id: examId});
    $("#exam-dialog").close();
    await updateHome();
    await render();
    toast("Exam saved");
  } catch (err) { $("#exam-status").textContent = err.message; }
  finally { b.disabled = false; }
});
$("#remove-exam").addEventListener("click", async () => {
  if (!window.confirm("Remove this exam date? Your packs and attempts will stay.")) return;
  try {
    await api("/api/exam-remove", {id: examId});
    $("#exam-dialog").close();
    await updateHome();
    await render();
  } catch (err) { $("#exam-status").textContent = err.message; }
});

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
function packCard(pack) {
  const tags = div("card-top", codeTag(pack.course || "Practice"), text("span", howMany(pack.items, "problem"), "small muted"));
  return element("article", {class: "card pack-card"}, tags,
    text("h3", pack.title),
    text("p", pack.scope.join(" · ") || "Individual practice", "muted pack-scope"),
    progressLine(pack.attempted, pack.total),
    div("card-foot",
      text("span", pack.submissions ? howMany(pack.submissions, "submission") : "Not started", "small muted"),
      link(pack.submissions ? "Continue →" : "Open pack →", routeFor(pack.key), "text-action")));
}
function examCard(exam, upcoming) {
  const remaining = dayDistance(exam.day, home.today);
  const matched = home.packs.filter(p => p.course === exam.course).length;
  return element("article", {class: "card exam-card"},
    div("card-top", codeTag(exam.course),
      text("span", upcoming ? (remaining ? howMany(remaining, "day") + " left" : "Today") : "Past", "pill")),
    text("h3", exam.title),
    element("time", {datetime: exam.day, class: "muted"}, dateLabel(exam.day, {weekday: "short", month: "long", day: "numeric", year: "numeric"})),
    div("card-foot",
      matched ? link(howMany(matched, "pack") + " →", courseRoute(exam.course), "text-action")
        : text("span", "No packs for this course yet", "small muted"),
      button("Edit", () => openExam(exam), "button bare")));
}
function activity() {
  const events = home.activity;
  const active = events.filter(d => d.count).length;
  const days = div("heat-grid", events.map(d => {
    const level = d.count >= 4 ? 4 : d.count;
    const label = dateLabel(d.day) + " · " + howMany(d.count, "submission");
    return element("span", {class: "heat l" + level, title: label, role: "listitem", "aria-label": label});
  }));
  days.setAttribute("role", "list");
  days.setAttribute("aria-label", "Daily submission counts for the last 35 days");
  return element("section", {class: "card activity"},
    div("card-top", text("span", "ACTIVITY", "eyebrow"), text("span", "Last 35 days", "small muted")),
    div("activity-summary", text("strong", String(active)), text("span", active === 1 ? "active day" : "active days")),
    days,
    div("heat-labels", text("span", dateLabel(events[0].day)), text("span", "Today")),
    text("p", "Submissions, not scores. Stronger color means more practice that day.", "small muted"));
}
function dashboard() {
  const up = home.exams.filter(e => e.day >= home.today);
  const past = home.exams.filter(e => e.day < home.today);
  const attempted = home.packs.reduce((n, p) => n + p.attempted, 0);
  const submissions = home.packs.reduce((n, p) => n + p.submissions, 0);
  const tiles = div("mini-stats",
    ...[[home.packs.length,"study packs"],[attempted,"problems tried"],[submissions,"answers saved"]].map(([n, label]) =>
      div("mini-stat", text("strong", String(n)), text("span", label))));
  const intro = div("hello",
    text("p", home.demo ? "DEMO WORKSPACE" : "YOUR LOCAL WORKSPACE", "eyebrow"),
    text("h1", "Study dashboard"),
    text("p", home.demo ? "Try a sample pack. Nothing you do here enters your real study history."
      : "Find your next exam, open a pack, and pick up where you left off.", "lede"), tiles);
  const examSection = element("section", {class: "section"}, sectionHead("Upcoming exams", "Dates you’ve added.", button("+ Add exam", () => openExam())),
    up.length ? div("card-grid", up.map(e => examCard(e, true))) : div("empty", "No upcoming exams logged."),
    past.length ? element("details", {class:"past"}, element("summary", {}, howMany(past.length, "past exam")),
      div("card-grid", past.map(e => examCard(e, false)))) : null);
  const packSection = element("section", {class: "section"}, sectionHead("Study packs", "Progress counts checked problems you’ve tried at least once."),
    home.packs.length ? div("card-grid", home.packs.map(packCard)) : div("empty",
      text("p", "No packs yet."),
      button("Import published folder", () => $("#open-import").click(), "button primary")));
  main.replaceChildren(div("hero-grid", intro, activity()), examSection, packSection);
}
function coursePage(code) {
  const packs = home.packs.filter(p => p.course === code);
  const exams = home.exams.filter(e => e.course === code && e.day >= home.today);
  main.replaceChildren(link("← Dashboard","#home","back"),
    text("p", "COURSE PRACTICE", "eyebrow"), text("h1", code),
    text("p", exams.length ? exams.map(e => e.title + " · " + dateLabel(e.day)).join("  /  ") : "No upcoming exam logged.", "lede"),
    element("section", {class:"section"}, sectionHead("Study packs", "Open a pack to continue practicing."),
      packs.length ? div("card-grid", packs.map(packCard)) : div("empty", "No packs for this course yet.")));
}

function svgNode(tag, attrs, value) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (value !== undefined) node.textContent = value;
  return node;
}
function plot(spec) {
  const svg = svgNode("svg", {viewBox:"0 0 480 284", role:"img", class:"plot-svg"});
  const title = svgNode("title", {}, "Graph of a line");
  const graph = svgNode("path", {class:"plot-data"});
  const clip = svgNode("clipPath", {id:"plot-area"});
  clip.append(svgNode("rect", {x:52,y:16,width:400,height:240}));
  graph.setAttribute("clip-path", "url(#plot-area)");
  svg.append(title, clip);
  const X = x => 252 + 50*x, Y = y => 136 - 20*y;
  for (let x = -4; x <= 4; x++) {
    svg.append(svgNode("path", {d:"M"+X(x)+" 16 V256",class: x ? "grid" : "axis"}));
    if (x) svg.append(svgNode("text", {x:X(x),y:278,class:"tick","text-anchor":"middle"}, x));
  }
  for (let y = -6; y <= 6; y++) {
    svg.append(svgNode("path", {d:"M52 "+Y(y)+" H452",class: y ? "grid":"axis"}));
    if (y && y % 2 === 0) svg.append(svgNode("text", {x:42,y:Y(y)+4,class:"tick","text-anchor":"end"}, y));
  }
  svg.append(svgNode("text", {x:464,y:140,class:"tick"}, "x"),
             svgNode("text", {x:261,y:32,class:"tick"}, "y"), graph);
  const out = element("output", {class:"plot-equation", for:spec.slider ? "slope" : null});
  const draw = m => {
    const b = spec.intercept;
    graph.setAttribute("d", "M"+X(-4)+" "+Y(m*-4+b)+" L"+X(4)+" "+Y(m*4+b));
    const equation = "y = " + (m === 0 ? b : m+"x"+(b < 0 ? " − " + Math.abs(b) : b > 0 ? " + "+b : ""));
    title.textContent = "Line " + equation;
    out.value = equation;
  };
  const slider = spec.slider ? element("input", {type:"range",id:"slope",min:-3,max:3,step:"any",value:spec.slope}) : null;
  if (slider) {
    slider.addEventListener("input", () => draw(Number(Number(slider.value).toFixed(2))));
    slider.addEventListener("keydown", e => {
      if (!["ArrowLeft","ArrowDown","ArrowRight","ArrowUp"].includes(e.key)) return;
      e.preventDefault();
      const dx = ["ArrowLeft","ArrowDown"].includes(e.key) ? -.25 : .25;
      slider.value = Math.min(3, Math.max(-3, Number(slider.value) + dx));
      draw(Number(Number(slider.value).toFixed(2)));
    });
  }
  draw(spec.slope);
  return element("figure", {class:"plot"}, div("card-top", text("span", "LINE GRAPH", "eyebrow"), out), svg,
    slider && element("label", {class:"slider"}, "Slope (m)", slider), text("figcaption", spec.caption, "muted"));
}

function supportDialog(title, content) {
  $("#support-title").textContent = title;
  $("#support-body").replaceChildren(...content);
  $("#support-dialog").showModal();
}
function showFeedback(fb) {
  const verdict = {correct:"Matches",partial:"Partly supported",incorrect:"Does not match",uncertain:"Uncertain"}[fb.verdict];
  const label = fb.method === "answer-key" ? "Checked answer key" : "Local AI feedback · provisional";
  return div("feedback " + fb.verdict, text("p", label, "eyebrow"),
    text("strong", verdict), text("p", fb.feedback),
    fb.next_step && text("p", fb.next_step, "small"));
}
const assistanceNames = {independent:"No help reported",hinted:"Hint used","worked-explanation":"Solution seen",prompted:"Prior feedback","unknown":"Help not recorded"};

function attemptViews(pack, task, initial) {
  let attempts = initial, busy = false;
  const selected = new Set();
  const host = element("section", {class:"history"});
  const live = div("live-feedback");
  live.setAttribute("aria-live","polite");
  const refetch = async () => {
    attempts = await api("/api/history/" + pack.key + "/" + task.id);
    paint();
  };
  async function feedback(a) {
    if (busy) return;
    busy = true;
    live.replaceChildren(text("p","Checking your answer against the reviewed key…","muted"));
    paint();
    try {
      const graded = await api("/api/feedback", {id: a.id});
      live.replaceChildren(showFeedback(graded.feedback));
      await refetch();
    } catch (err) {
      live.replaceChildren(text("p", err.message, "error"));
    } finally { busy = false; paint(); }
  }
  async function exportSelected() {
    try {
      const data = await api("/api/export", {ids: [...selected]});
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:"application/json"}));
      const a = element("a", {href:url, download:"study-hub-attempts.json"});
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Exported selected attempts for Pi");
    } catch (err) { toast(err.message); }
  }
  function paint() {
    const exportBtn = button("Export selected for Pi", exportSelected);
    exportBtn.disabled = !selected.size;
    const check = a => {
      const el = element("input", {type:"checkbox","aria-label":"Select this attempt for export"});
      el.checked = selected.has(a.id);
      el.addEventListener("change", () => {
        if (el.checked) selected.add(a.id); else selected.delete(a.id);
        exportBtn.disabled = !selected.size;
      });
      return el;
    };
    const details = attempts.map(a => {
      const label = new Date(a.submitted_at).toLocaleString(undefined, {dateStyle:"medium",timeStyle:"short"});
      const grade = a.feedback ? showFeedback(a.feedback) : null;
      const doCheck = home.grader && task.can_check && !a.feedback
        ? button("Check locally", () => feedback(a)) : null;
      if (doCheck) doCheck.disabled = busy;
      return element("article", {class:"attempt"},
        div("card-top", element("label",{class:"row"},check(a),text("span",label)), pill(assistanceNames[a.assistance])),
        element("details", {}, element("summary", {}, "View saved answer"), text("pre", a.answer), grade),
        div("row", doCheck, button("Forget attempt", async () => {
          if (!window.confirm("Remove this answer and its feedback from your local history?")) return;
          try {
            await api("/api/forget", {id:a.id});
            selected.delete(a.id);
            live.replaceChildren();
            await updateHome();
            paintRailProgress(pack.key);
            await refetch();
          } catch (err) { toast(err.message); }
        }, "button bare danger")));
    });
    host.replaceChildren(sectionHead("Attempt history", attempts.length ? "Latest " + howMany(attempts.length, "saved attempt") : "Your submitted answers will appear here.",
      attempts.length ? exportBtn : null), ...details);
  }
  paint();
  return {
    host, live,
    saved: async (a, autoCheck) => {
      attempts = [a, ...attempts.filter(prev => prev.id !== a.id)].slice(0,25);
      live.replaceChildren(a.feedback ? showFeedback(a.feedback) : text("p","Answer saved.","muted"));
      paint();
      await updateHome();
      paintRailProgress(pack.key);
      if (autoCheck && !a.feedback) await feedback(a);
    },
  };
}
function paintRailProgress(key) {
  const stat = home.packs.find(p => p.key === key);
  if (!stat) return;
  $("#rail-progress")?.replaceChildren(progressLine(stat.attempted,stat.total));
  document.querySelectorAll("[data-pid]").forEach(a => {
    const badge = a.querySelector(".rail-mark");
    if (badge) {
      const done = stat.attempted_ids.includes(a.dataset.pid);
      badge.textContent = done ? "✓" : "○";
      badge.setAttribute("aria-label", done ? "Attempted" : "Not attempted");
    }
  });
}

function solver(pack, pid, history) {
  const idx = pack.problems.findIndex(p => p.id === pid);
  const task = pack.problems[idx];
  const step = pack.problems.length;
  const views = attemptViews(pack, task, history);
  const nav = element("nav", {class:"rail", "aria-label":"Problems"},
    text("h2","Problems"), div("mini-progress", element("div",{id:"rail-progress"})),
    pack.problems.map((p,i) => element("a", {
      href:routeFor(pack.key,p.id), class:"rail-link", "aria-current":p.id===pid ? "step" : null, "data-pid":p.id
    }, text("span", String(i+1).padStart(2,"0")), text("span", p.id.replaceAll("-"," ")), text("span","○","rail-mark"))));

  const statement = element("section",{class:"card task-card",lang:pack.language},
    div("card-top",text("p","PROBLEM " + String(idx+1).padStart(2,"0") + " / " + step,"eyebrow"),
      pill(task.status==="experimental" ? "Investigation · unresolved" : "Checked practice")),
    markdown(task.statement,pack.key,task.assets), figures(task.statement,pack.key,task.assets),
    task.uncertainty ? div("notice", text("strong","What remains open"), text("p",task.uncertainty.what),
      text("p",task.uncertainty.progress), text("p",task.uncertainty.stop_or_resume)) : null,
    task.visual ? plot(task.visual) : null);

  const status = text("p","","status");
  status.setAttribute("role","status");
  const form = element("form",{class:"card answer-card"});
  const select = element("select",{name:"help"},
    ...[["unknown","Not specified"],["no-help","I used no outside help"],["hint","I used an outside hint"],["solution","I consulted a solution"]]
      .map(([value,label]) => element("option",{value},label)));
  let answer;
  if (task.options.length) {
    answer = element("fieldset",{class:"choices"},text("legend","Choose one option"),
      task.options.map((value,i) => element("label",{class:"choice"},
        element("input",{type:"radio",name:"choice",value:i,required:""}),markdown(value,pack.key))));
  } else {
    answer = element("label",{class:"answer-label"},"Your reasoning",element("textarea",{
      name:"answer",rows:5,maxlength:12000,required:"",placeholder:"Write your answer or the reasoning you want to check…" }));
  }
  const auto = element("input",{type:"checkbox",name:"auto-check"});
  auto.defaultChecked = true;
  const supports = div("row");
  for (let i=0;i<task.hint_count;i++) {
    supports.append(button(task.hint_count === 1 ? "Show hint" : "Hint " + (i+1), async () => {
      try {
        const data = await api("/api/reveal/"+pack.key+"/"+pid,{kind:"hint",index:i});
        if (data.confirm) {
          if (!window.confirm("This hint reveals the target reasoning. Open it anyway?")) return;
          const full = await api("/api/reveal/"+pack.key+"/"+pid,{kind:"hint",index:i,allow_reveal:true});
          supportDialog("Hint (reveals reasoning)", [markdown(full.text,pack.key)]);
        } else supportDialog("Reviewed hint",[markdown(data.text,pack.key)]);
      } catch (err) { toast(err.message); }
    }));
  }
  if (task.has_solution) supports.append(button("Reviewed solution",async () => {
    if (!window.confirm("This reveals the reviewed solution or rubric. Open it now?")) return;
    try {
      const data = await api("/api/reveal/"+pack.key+"/"+pid,{kind:"solution"});
      supportDialog("Reviewed solution", [markdown(data.solution || data.rubric,pack.key,data.assets),
        ...(data.solution && data.rubric ? [text("h3","Rubric"),markdown(data.rubric,pack.key,data.assets)] : []),
        ...figures(data.solution + "\n" + data.rubric, pack.key, data.assets)]);
    } catch (err) { toast(err.message); }
  },"button bare"));

  form.append(text("h2","Try it"), answer, element("label",{class:"help-label"},"Outside help",select),
    home.grader && task.can_check ? element("label",{class:"check"},auto,"Check locally after saving") : null,
    div("row",element("button",{class:"button primary",type:"submit"},"Submit answer"),supports),status,views.live);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = e.submitter;
    submit.disabled = true;
    status.classList.remove("error");
    status.textContent = "Saving…";
    const data = new FormData(form);
    const body = {help: data.get("help")};
    if (task.options.length) body.choice = Number(data.get("choice")); else body.answer = data.get("answer");
    try {
      const saved = await api("/api/attempt/"+pack.key+"/"+pid,body);
      status.textContent = "Saved";
      form.reset();
      await views.saved(saved, home.grader && task.can_check && data.has("auto-check"));
    } catch (err) { status.textContent = err.message; status.classList.add("error"); }
    finally { submit.disabled = false; }
  });

  const adjacent = div("adjacent",
    idx > 0 ? link("← Previous",routeFor(pack.key,pack.problems[idx-1].id),"button") : div(""),
    idx+1 < step ? link("Next problem →",routeFor(pack.key,pack.problems[idx+1].id),"button") : link("Dashboard →","#home","button"));
  const help = pack.reveal_policy
    ? element("details",{class:"help-note"},element("summary",{},"Help policy for this pack"),markdown(pack.reveal_policy,pack.key)) : null;
  main.replaceChildren(link("← Dashboard","#home","back"),div("solver-heading",codeTag(pack.course||"Practice"),
    text("h1",pack.title),text("p","Attempted does not mean mastered. Hints and reviewed support are optional.","muted")),
    div("solver-grid",nav,div("solve",statement,help,form,adjacent,views.host)));
  paintRailProgress(pack.key);
}

async function render() {
  const version = ++renderVersion;
  main.setAttribute("aria-busy","true");
  try {
    if (!home) await updateHome();
    const parts = location.hash.slice(1).split("/").map(decodeURIComponent);
    if (parts[0] === "pack" && /^[a-f0-9]{64}$/.test(parts[1] || "")) {
      const key = parts[1];
      let pack = packCache.get(key);
      if (!pack) { pack = await api("/api/pack/"+key); packCache.set(key,pack); }
      const summary = home.packs.find(p => p.key === key);
      const pid = pack.problems.some(p=>p.id===parts[2]) ? parts[2] : summary?.resume_id || pack.problems[0].id;
      const history = await api("/api/history/"+key+"/"+pid);
      if (renderVersion === version) solver(pack,pid,history);
    } else if (parts[0] === "course" && parts[1]) coursePage(parts[1]);
    else dashboard();
  } catch (err) {
    if (renderVersion === version) main.replaceChildren(link("← Dashboard","#home","back"),text("h1","Could not open this view"),text("p",err.message));
  } finally {
    if (renderVersion === version) main.setAttribute("aria-busy","false");
  }
}
window.addEventListener("hashchange", async () => { await render(); main.focus({preventScroll:true}); window.scrollTo(0,0); });
render();
