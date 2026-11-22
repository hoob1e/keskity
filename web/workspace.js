"use strict";

const recentKey = "study-hub-recent-packs";

function icon(name, cls = "icon") {
  const svg = svgNode("svg", {class: cls, "aria-hidden": "true"});
  svg.append(svgNode("use", {href: "#icon-" + name}));
  return svg;
}

function iconButton(name, label, onClick, cls = "icon-button") {
  const b = button(icon(name), onClick, cls);
  b.setAttribute("aria-label", label);
  b.title = label;
  return b;
}

function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch {} // Keep the current session usable.
}

let recentOpened;
let demoOpened = [];
let newestFirst = readPreference("study-hub-library-sort") === "newest";
let librarySelection = ["", ""];

function visits(isDemo) {
  if (isDemo) return demoOpened;
  if (recentOpened) return recentOpened;
  try {
    const lastOpened = JSON.parse(readPreference("study-hub-last-problem"));
    const saved = JSON.parse(readPreference(recentKey));
    recentOpened = [lastOpened, ...(Array.isArray(saved) ? saved.slice(0, 10) : [])]
      .filter(p => typeof p?.key === "string" && typeof p.pid === "string");
  } catch {
    recentOpened = [];
  }
  return recentOpened;
}

function rememberProblem(isDemo, key, pid, index) {
  const next = [{key, pid, index}, ...visits(isDemo).filter(p => p.key !== key)].slice(0, 10);
  if (isDemo) demoOpened = next;
  else {
    recentOpened = next;
    writePreference(recentKey, JSON.stringify(next));
    writePreference("study-hub-last-problem", JSON.stringify(next[0]));
  }
}

function openedPacks(home) {
  const byKey = new Map(home.packs.map(p => [p.key, p]));
  const seen = new Set();
  return visits(home.demo).flatMap(visit => {
    const pack = byKey.get(visit.key);
    if (!pack || seen.has(pack.key)) return [];
    seen.add(pack.key);
    return [{pack, visit}];
  });
}

function coursesIn(packs) {
  const courses = new Map();
  for (const pack of packs) {
    if (!pack.course) continue;
    if (!courses.has(pack.course)) courses.set(pack.course, []);
    courses.get(pack.course).push(pack);
  }
  return [...courses];
}

function library(home, course, packKey) {
  librarySelection = [course, packKey];
  const host = $("#library-items");
  const sort = $("#library-sort");
  const byName = (a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: "base"});
  const courses = coursesIn(home.packs);
  const independent = home.packs.filter(p => !p.course);
  if (!newestFirst) {
    courses.sort(([a], [b]) => byName(a, b));
    independent.sort((a, b) => byName(a.title, b.title));
  }
  sort.hidden = courses.length < 2 && independent.length < 2;
  sort.setAttribute("aria-pressed", String(newestFirst));

  const list = (heading, entries) => entries.length ? div("library-group",
    text("p", heading, "eyebrow"),
    element("ul", {class: "library-list"}, entries.map(({title, sub, href, active}) =>
      element("li", {}, element("a", {
        class: "workspace-link library-link", href, "aria-current": active ? "location" : null,
      }, text("span", title, "library-name"), text("span", sub, "small muted")))))) : null;
  const courseCount = ([code, packs]) => ({
    title: code, sub: packs.find(p => p.study_title)?.study_title || howMany(packs.length, "pack"), href: courseRoute(code), active: code === course,
  });
  const standalone = pack => ({
    title: pack.study_title || pack.title, sub: howMany(pack.items, "problem"), href: independentRoute(pack.key), active: pack.key === packKey,
  });
  host.replaceChildren();
  for (const group of [list("Courses", courses.map(courseCount)), list("Independent study", independent.map(standalone))]) {
    if (group) host.append(group);
  }
  if (!home.packs.length) host.append(text("p", "No packs yet.", "small muted library-empty"));
}

function toggleLibrarySort(home) {
  newestFirst = !newestFirst;
  writePreference("study-hub-library-sort", newestFirst ? "newest" : "name");
  library(home, ...librarySelection);
}

function paintWorkspace(view, course = "", packKey = "") {
  $("#workspace").dataset.view = view;
  document.documentElement.dataset.view = view;
  $("#problem-focus").hidden = $("#problem-reading").hidden = view !== "problem";
  if (view !== "problem") setProblemFocus(false);
  const active = view === "course" || view === "problem" ? "study" : view;
  document.querySelectorAll(".workspace-nav [data-route]").forEach(a => {
    if (a.dataset.route === active) a.setAttribute("aria-current", active === view ? "page" : "location");
    else a.removeAttribute("aria-current");
  });
  const crumb = $("#breadcrumbs");
  crumb.hidden = view !== "course" && view !== "problem";
  crumb.replaceChildren();
  if (!crumb.hidden) {
    crumb.append(link("Study", "#study"));
    const standalone = !course && home?.packs.find(p => p.key === packKey && !p.course);
    const label = course || standalone?.study_title || standalone?.title;
    if (label) {
      const href = course ? courseRoute(course) : independentRoute(packKey);
      crumb.append(icon("right"), view === "problem" ? link(label, href + "/problems") : text("span", label));
    }
  }
  if (home) library(home, course, packKey);
}

function studyPage(home) {
  const courses = coursesIn(home.packs).sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}));
  const independent = home.packs.filter(p => !p.course);
  const courseList = courses.length ? element("section", {class: "section"},
    text("h2", "Courses"), div("card-grid study-course-list", courses.map(([code, packs]) =>
      element("a", {class: "card entry-link", href: courseRoute(code)}, icon("book", "icon entry-mark"),
        div("entry-copy", text("strong", code), text("span", packs.find(p => p.study_title)?.study_title ||
          howMany(packs.length, "study pack"), "small muted")),
        icon("right", "icon link-arrow"))))) : null;
  const independentList = independent.length ? element("section", {class: "section"},
    text("h2", "Independent study"), div("card-grid study-course-list", independent.map(pack => packCard(pack, independentRoute(pack.key))))) : null;
  main.replaceChildren(text("h1", "Study"));
  if (courseList) main.append(courseList);
  if (independentList) main.append(independentList);
  if (!home.packs.length) main.append(div("empty study-course-list", text("p", "No packs yet."),
    home.demo ? null : button("Import pack", () => $("#open-import").click(), "button primary")));
}

function dataPage(home) {
  const practiced = home.packs.filter(p => p.submissions).sort((a, b) => b.submissions - a.submissions);
  main.replaceChildren(text("h1", "Data"),
    div("data-overview", summaryCard(home, false), activityCard(home.activity)),
    element("section", {class: "section"},
      text("h2", "Submissions by pack"),
      practiced.length ? div("study-course-list data-pack-list", practiced.map(p =>
        element("a", {class: "card entry-link", href: routeFor(p.key)},
          div("entry-copy", text("strong", p.title),
            text("span", howMany(p.attempted, "checked problem attempted", "checked problems attempted"), "small muted")),
          text("span", howMany(p.submissions, "submission"), "small muted"),
          icon("right", "icon link-arrow"))))
        : div("empty study-course-list", "No answers submitted yet.", link("Open Study", "#study", "button"))));
}
