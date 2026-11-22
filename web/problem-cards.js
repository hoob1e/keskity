"use strict";

function problemTitle(task) {
  if (task.title) return task.title;
  const title = task.id.replaceAll("-", " ");
  return title[0].toUpperCase() + title.slice(1);
}

const problemOrder = new Intl.Collator(undefined, {numeric: true, sensitivity: "base"});
const studyLayoutKey = "study-hub-problem-layout";
const studyFilters = new Map();

function problemEntries(packs) {
  return packs.flatMap(pack => pack.problems.map((task, index) => ({
    pack, task, index,
    title: problemTitle(task),
  })));
}

function problemGroups(entries, group) {
  const result = new Map();
  for (const entry of entries) {
    const {pack, task} = entry;
    // Unresolved investigations have their own section, never mixed into checked practice.
    const topic = group === "topic" ? task.topic : null;
    const label = task.status === "experimental" ? "Investigations" :
      group === "none" ? "All checked problems" : topic || pack.title;
    const key = task.status === "experimental" ? "investigations" :
      group === "none" ? "all" : topic ? "topic:" + topic.toLowerCase() : "pack:" + pack.key;
    if (!result.has(key)) result.set(key, {key, label, entries: []});
    result.get(key).entries.push(entry);
  }
  return Array.from(result.values());
}

function studyProgress(entries) {
  const checked = entries.filter(({task}) => task.status === "checked");
  return {attempted: checked.filter(({task}) => task.attempts > 0).length, total: checked.length};
}

function cardPreview(pack, task) {
  const art = div("problem-art");
  art.setAttribute("aria-hidden", "true");
  const preview = task.preview;
  if (preview?.path) {
    art.classList.add("has-image");
    art.append(element("img", {src: imageRoute(pack.key, preview), alt: "", loading: "lazy", decoding: "async"}));
  } else if (preview?.line) {
    const {slope, intercept} = preview.line;
    const svg = svgNode("svg", {viewBox: "0 0 240 64", preserveAspectRatio: "xMidYMid slice"});
    svg.append(svgNode("path", {class: "mini-axis", d: "M120 0V64 M0 32H240"}),
      svgNode("path", {class: "mini-line", d: "M0 " + (32 - 5*(intercept-4*slope)) + " L240 " + (32 - 5*(intercept+4*slope))}));
    art.append(svg);
  } else {
    art.append(icon(task.choice ? "checklist" : "note"));
  }
  return art;
}

function problemCard({pack, task, index, title}, last, showPack) {
  const checked = task.status === "checked";
  const isLast = last?.key === pack.key && last.pid === task.id;
  const href = routeFor(pack.key, task.id);
  const formattedIndex = String(index + 1).padStart(2, "0");
  const displayStatus = checked
    ? (task.attempts ? "Attempted" : "Not attempted")
    : (task.attempts ? howMany(task.attempts, "response") + " saved" : "Open investigation");
  const preview = div("problem-preview", cardPreview(pack, task), isLast ? text("span", "Last opened", "problem-last") : null);

  return element("li", {class: "problem-list-item"},
    element("a", {class: "card problem-card ambient-card", href, "data-problem-id": task.id,
      "data-attempted": checked && task.attempts > 0 ? "" : null},
    preview,
    div("problem-card-body",
      div("problem-card-meta", text("span", "Problem " + formattedIndex, "small muted"),
        icon("open", "icon link-arrow")),
      text("h4", title),
      showPack ? text("p", pack.title, "problem-pack small muted") : null,
      div("problem-card-progress", text("span", displayStatus, "small"),
        checked ? element("progress", {class: "study-meter", max: 1, value: task.attempts ? 1 : 0,
          "aria-label": title + ": " + displayStatus}) : null))));
}

function controlsSelect(label, id, choices, current) {
  const node = element("select", {id}, choices.map(([value, name]) => element("option", {value}, name)));
  node.value = current;
  return [element("label", {class: "problem-control", for: id}, text("span", label, "small muted"), node), node];
}

function problemCatalogue(entries, locationKey, home) {
  const layouts = [["topic", "Topic"], ["pack", "Study pack"], ["none", "None"]];
  const sorts = [["original", "Pack order"], ["title", "Title A–Z"], ["recent", "Recent attempts"]];
  const filters = [["all", "All statuses"], ["not-tried", "Not attempted"], ["tried", "Attempted"], ["investigations", "Investigations"]];
  let prior = {};
  try { prior = JSON.parse(readPreference(studyLayoutKey)) || {}; } catch {}
  const selected = (list, value) => list.some(([key]) => key === value) ? value : list[0][0];
  const [groupField, group] = controlsSelect("Group by", "problem-group", layouts, selected(layouts, prior.group));
  const [sortField, order] = controlsSelect("Sort by", "problem-order", sorts, selected(sorts, prior.order));
  const [filterField, filter] = controlsSelect("Filter", "problem-filter", filters,
    selected(filters, studyFilters.get(locationKey)));
  const count = element("p", {class: "small muted", role: "status"});
  const results = div("problem-results");
  const last = openedPacks(home)[0]?.visit;
  const showPack = new Set(entries.map(({pack}) => pack.key)).size > 1;

  function paint() {
    const visible = entries.filter(({task}) => {
      if (filter.value === "all") return true;
      if (filter.value === "investigations") return task.status === "experimental";
      return task.status === "checked" && (filter.value === "tried" ? task.attempts > 0 : !task.attempts);
    });
    if (order.value === "title") visible.sort((a, b) => problemOrder.compare(a.title, b.title));
    if (order.value === "recent") visible.sort((a, b) => (b.task.latest || "").localeCompare(a.task.latest || ""));
    count.textContent = visible.length === entries.length ? howMany(entries.length, "problem") :
      visible.length + " of " + entries.length + " problems";
    if (!visible.length) {
      const reset = button("Clear filter", () => {
        filter.value = "all";
        update();
        filter.focus();
      });
      results.replaceChildren(div("empty", "No problems match this filter.", reset));
      return;
    }
    const totals = new Map(problemGroups(entries, group.value).map(g => [g.key, studyProgress(g.entries)]));
    results.replaceChildren(...problemGroups(visible, group.value).map(({key, label, entries: batch}) => {
      const {attempted, total} = totals.get(key);
      return element("section", {class: "problem-group-block"},
        div("problem-group-head", text("h3", label), total ? progressLine(attempted, total) : text("span", howMany(batch.length, "investigation"), "small muted")),
        element("ul", {class: "problem-cards"}, batch.map(entry => problemCard(entry, last, showPack))));
    }));
  }
  function update() {
    writePreference(studyLayoutKey, JSON.stringify({group: group.value, order: order.value}));
    if (filter.value === "all") studyFilters.delete(locationKey);
    else studyFilters.set(locationKey, filter.value);
    paint();
  }
  for (const control of [group, order, filter]) control.addEventListener("change", update);
  paint();
  return element("section", {class: "problem-catalogue"},
    div("catalogue-head",
      div("catalogue-title", element("h2", {id: "study-problems", tabindex: "-1", class: "feature-title"}, "Problems"), count),
      div("problem-controls", groupField, sortField, filterField)),
    results);
}
