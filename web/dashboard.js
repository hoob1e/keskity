"use strict";

const dashboardDay = {weekday: "long", month: "long", day: "numeric"};

function summaryCard(home, showLink = true) {
  const totals = [
    [home.packs.length, "Study packs"],
    [home.packs.reduce((n, p) => n + p.attempted, 0), "Problems attempted"],
    [home.packs.reduce((n, p) => n + p.submissions, 0), "Answers saved"],
  ];
  return element("section", {class: "card dashboard-summary"},
    div("card-top", text("h2", "Study summary"), text("span", "All time", "small muted")),
    element("dl", {class: "summary-counts"}, totals.map(([n, label]) => div("summary-count",
      text("dt", label), text("dd", String(n))))),
    showLink ? link([text("span", "Open Data"), icon("arrow", "icon link-arrow")], "#data", "text-action arrow-link") : null);
}

function shiftDay(day, delta) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function activityCard(events) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const before = (new Date(events[0].day + "T00:00:00Z").getUTCDay() + 6) % 7;
  const dates = [...Array(before).fill(null), ...events];
  const groups = Array.from({length: Math.ceil(dates.length / 7)}, (_, i) => dates.slice(i * 7, (i + 1) * 7));
  const table = element("table", {class: "heat-calendar"},
    element("caption", {class: "sr-only"}, "Answer submissions by day, last 35 days"),
    element("thead", {}, element("tr", {},
      element("th", {scope: "col"}, text("span", "Week of", "sr-only")),
      days.map(d => element("th", {scope: "col"}, text("span", d, "sr-only"),
        element("span", {"aria-hidden": "true"}, d[0]))))),
    element("tbody", {}, groups.map((group, i) => element("tr", {},
      element("th", {scope: "row"}, dateLabel(shiftDay(events[0].day, 7 * i - before))),
      days.map((_, j) => {
        const entry = group[j];
        if (!entry) return element("td");
        const label = dateLabel(entry.day, dashboardDay) + ": " + howMany(entry.count, "submission");
        return element("td", {}, text("span", label, "sr-only"), element("span", {
          class: "heat l" + Math.min(4, entry.count), title: label, "aria-hidden": "true",
        }));
      })))));
  return element("section", {class: "card dashboard-activity"},
    div("card-top", text("h2", "Activity"), text("span", "Last 35 days", "small muted")),
    table,
    div("activity-legend", text("span", "Answer submissions", "small muted"),
      element("span", {class: "legend-scale", "aria-hidden": "true"}, "Less",
        [0, 1, 2, 3, 4].map(n => element("span", {class: "heat l" + n})), "More")));
}

function examRow(exam, home, edit) {
  const date = new Date(exam.day + "T12:00:00");
  const linked = home.packs.some(p => p.course === exam.course);
  const day = dateLabel(exam.day, {...dashboardDay, year: "numeric"});
  const calendar = element("time", {class: "exam-date", datetime: exam.day, title: day, "aria-label": day},
    text("span", dateLabel(exam.day, {month: "short"})),
    text("strong", String(date.getDate()).padStart(2, "0")));
  const editButton = iconButton("edit", "Edit " + exam.title, () => edit(exam), "icon-button exam-edit");
  editButton.dataset.editExam = exam.id;
  return element("li", {class: "exam-entry"}, calendar,
    div("exam-copy", text("p", exam.course, "exam-course"),
      element("h3", {}, linked ? link(exam.title, courseRoute(exam.course), "text-action") : exam.title)),
    editButton);
}
function examPanel(home, edit) {
  const upcoming = home.exams.filter(e => e.day >= home.today);
  const past = home.exams.filter(e => e.day < home.today).reverse();
  const list = exams => element("ul", {class: "exam-list"}, exams.map(exam => examRow(exam, home, edit)));
  const add = button([icon("plus"), text("span", "Add exam")], () => edit(), "button add-exam");
  add.id = "add-exam";
  return element("section", {class: "card dashboard-exams"},
    div("card-top", text("h2", "Upcoming exams"), div("panel-mark", icon("calendar"))),
    upcoming.length ? list(upcoming.slice(0, 3)) : div("exams-empty", text("p", "No upcoming exams logged.", "muted")),
    upcoming.length > 3 ? element("details", {class: "exam-more"}, element("summary", {}, "More exams"), list(upcoming.slice(3))) : null,
    div("exam-actions", add),
    past.length ? element("details", {class: "exam-more"}, element("summary", {}, "Past exams"), list(past)) : null);
}

function resumePanel(home, openings) {
  const recent = openings[0];
  const pack = recent?.pack || home.packs[0];
  if (!pack) return element("section", {class: "card resume-panel resume-empty"},
    text("p", "STUDY", "eyebrow"), text("h2", "Open your first set", "feature-title"),
    text("p", "Import a published problem set to start practicing.", "muted"),
    !home.demo ? button([icon("import"), "Import pack"], () => $("#open-import").click(), "button primary") : null);
  const index = recent?.visit.index;
  const sub = Number.isInteger(index) && index >= 0 && index < pack.items
    ? "Problem " + (index + 1) + " of " + pack.items : howMany(pack.items, "problem");
  return div("resume-halo ambient-resume", element("section", {class: "card resume-panel resume-card"},
    text("p", recent ? "RESUME LATEST SET" : "LATEST STUDY PACK", "eyebrow"),
    text("p", pack.course || "Independent study", "resume-course"),
    text("h2", pack.title, "feature-title"),
    div("resume-actions", link([text("span", recent ? "Resume set" : "Open pack"), icon("arrow", "icon link-arrow")],
      routeFor(pack.key, recent?.visit.pid), "button resume-link"), text("span", sub, "small"))));
}
function recentPanel(home, openings) {
  const entries = openings.length ? openings.slice(0, 3) : home.packs.slice(0, 3).map(pack => ({pack}));
  if (!entries.length) return null;
  return element("section", {class: "dashboard-recent"},
    div("card-top", text("h2", openings.length ? "Recently opened" : "Study packs"),
      link([text("span", "Open Study"), icon("arrow", "icon link-arrow")], "#study", "text-action arrow-link")),
    div("recent-grid", entries.map(({pack, visit}) => element("a", {class: "card entry-link", href: routeFor(pack.key, visit?.pid)},
      icon("book", "icon entry-mark"),
      div("entry-copy", text("span", pack.course || "Independent study", "entry-kicker"), text("strong", pack.title)),
      icon("right", "icon link-arrow")))));
}

function dashboardPage(home, editExam) {
  const openings = openedPacks(home);
  const tips = studyTipCard();
  main.replaceChildren(
    div("dashboard-heading", text("h1", "Dashboard"),
      element("time", {datetime: home.today}, icon("calendar"), dateLabel(home.today, dashboardDay))),
    div("dashboard-grid",
      div("dashboard-lead", resumePanel(home, openings), tips.node),
      examPanel(home, editExam),
      summaryCard(home),
      activityCard(home.activity)),
  );
  const recent = recentPanel(home, openings);
  if (recent) main.append(recent);
  return tips.dispose;
}
