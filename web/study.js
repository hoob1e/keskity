"use strict";

const independentRoute = key => "#independent/" + key;

function studyDetail(packs, code, home) {
  const independent = !code;
  const area = independent ? independentRoute(packs[0].key) : courseRoute(code);
  const title = firstStudyNote(packs, "title") || {value: independent ? packs[0].title : code, key: packs[0].key, language: packs[0].language};
  const heading = studyPassage(element("h1", {tabindex: -1}, title.value), "title", "Study title", title.key, title.language);
  const overview = firstStudyNote(packs, "overview");
  const uses = firstStudyNote(packs, "uses");
  const fact = firstStudyNote(packs, "fact");
  const scope = uniqueStudyLabels(packs, pack => pack.scope);
  const concepts = uniqueStudyLabels(packs, pack => pack.study.concepts || []);
  const entries = problemEntries(packs);
  const hero = element("header", {class: "card study-hero"},
    div("study-hero-kicker", code && code !== title.value ? codeTag(code) : null,
      text("span", independent ? "Independent study" : "Course", "small")),
    heading,
    text("p", howMany(packs.length, "study pack") + " · " + howMany(entries.length, "problem"), "small"));

  const jump = element("a", {class: "arrow-link text-action", href: area + "/problems"},
    text("span", "Jump to problems"), icon("down"));
  jump.addEventListener("click", e => {
    if (location.hash !== jump.hash || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    jumpToStudyProblems();
  });

  const actions = div("row study-overview-actions", jump);
  const about = element("section", {class: "card study-overview"},
    div("card-top", text("h2", "Overview"), actions),
    overview ? studyPassage(text("p", overview.value, "study-description"), "overview", "Overview", overview.key, overview.language) : null,
    div("study-overview-columns",
      element("section", {}, text("h3", "Scope"),
        scope.length ? element("ul", {class: "scope-list"}, scope.map(({value, key, language}) =>
          studyPassage(text("li", value), "scope", value, key, language))) :
          text("p", "No scope listed in the imported pack.", "small muted")),
      uses ? element("section", {}, text("h3", "What it’s used for"),
        studyPassage(text("p", uses.value, "small muted"), "uses", "What it’s used for", uses.key, uses.language)) : null),
    concepts.length ? element("section", {class: "study-concepts"},
      text("h3", "Featured concepts"), element("ul", {class: "concept-list"}, concepts.map(({value, key, language}) =>
        studyPassage(text("li", value), "concepts", value, key, language)))) : null);
  const layout = div("study-layout", div("study-intro", hero, about, code ? testShelf(home.tests.filter(t => t.course === code)) : null),
    studySide(packs, entries, code, fact, home), problemCatalogue(entries, area, home));
  const help = studyHelp(layout, {restore: heading});
  if (help.control) actions.prepend(help.control);
  main.replaceChildren(layout, ...help.layers);
  return help.dispose;
}

function jumpToStudyProblems() {
  const title = $("#study-problems");
  title?.focus({preventScroll: true});
  title?.scrollIntoView({block: "start"});
}

function firstStudyNote(packs, key) {
  const pack = packs.find(p => p.study[key]);
  return pack ? {value: pack.study[key], source: pack.title, key: pack.key, language: pack.language} : null;
}

function uniqueStudyLabels(packs, labels) {
  const seen = new Set();
  return packs.flatMap(pack => labels(pack).flatMap(value => {
    const label = value.trim().toLowerCase();
    if (!label || seen.has(label)) return [];
    seen.add(label);
    return [{value, key: pack.key, language: pack.language}];
  }));
}

function studySide(packs, entries, code, fact, home) {
  const exam = code ? home.exams.find(e => e.course === code && e.day >= home.today) : null;
  const row = (label, info) => div("study-detail-row", text("dt", label), element("dd", {}, info));
  const details = element("section", {class: "card study-details"},
    div("study-panel-title", icon(code ? "calendar" : "book"), text("h2", code ? "Course details" : "Study details")),
    element("dl", {}, code ? row("Next exam", exam ? element("time", {datetime: exam.day, title: exam.title},
      dateLabel(exam.day, {month: "short", day: "numeric", year: "numeric"})) : "Not scheduled") : null,
    row("Materials", howMany(packs.length, "study pack"))));

  const {attempted, total} = studyProgress(entries);
  const groups = problemGroups(entries, "topic").flatMap(g => {
    const stats = studyProgress(g.entries);
    if (!stats.total) return [];
    return [{...stats, label: g.label}];
  });
  const bar = (name, info) => element("progress", {class: "study-meter", value: info.attempted, max: info.total,
    "aria-label": name + ": " + info.attempted + " of " + info.total + " checked problems attempted"});
  const byGroup = groups.map(g => div("side-progress-group",
    div("side-progress-row", text("span", g.label), text("span", g.attempted + " / " + g.total)), bar(g.label, g)));
  const extra = groups.length > 4 ? element("details", {class: "side-progress-more"},
    element("summary", {}, "More groups"), byGroup.slice(4)) : null;
  const progress = element("section", {class: "card study-progress"},
    text("h2", "Progress"),
    total ? div("side-progress-total", text("strong", attempted + " / " + total),
      text("span", "checked problems attempted", "small muted")) : text("p", "Investigations only", "small muted"),
    total ? bar("Overall progress", {attempted, total}) : null,
    groups.length > 1 ? div("side-progress-groups", byGroup.slice(0, 4), extra) : null);

  return element("aside", {class: "study-side", "aria-label": "Study details and progress"},
    details, progress, fact ? element("section", {class: "card study-fact"},
      div("study-panel-title", icon("bulb"), text("h2", "From the material")),
      studyPassage(text("p", fact.value), "fact", "From the material", fact.key, fact.language), text("p", fact.source, "small muted")) : null);
}
