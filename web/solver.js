"use strict";

const focusControl = () => $("#problem-focus");

function setProblemFocus(on) {
  document.documentElement.toggleAttribute("data-problem-focus", on);
  focusControl().setAttribute("aria-pressed", String(on));
  focusControl().title = on ? "Exit focus mode" : "Enter focus mode";
}

function initSolverControls() {
  focusControl().addEventListener("click", () => {
    setProblemFocus(!document.documentElement.hasAttribute("data-problem-focus"));
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || e.defaultPrevented || $("dialog[open]") ||
        !document.documentElement.hasAttribute("data-problem-focus")) return;
    setProblemFocus(false);
    focusControl().focus({preventScroll: true});
  });
}

function problemLocation(pack) {
  const href = pack.course ? courseRoute(pack.course) : independentRoute(pack.key);
  return element("nav", {class: "problem-location", "aria-label": "Problem location"},
    link("Study", "#study", "back"), icon("right"),
    pack.course ? [link(pack.course, href), icon("right")] : null,
    link(pack.title, href + "/problems", "problem-location-title"));
}

function problemNavigation(pack, index) {
  const n = pack.problems.length;
  const arrow = (offset, name, label) => {
    const problem = pack.problems[index + offset];
    return problem
      ? element("a", {class: "icon-button", href: routeFor(pack.key, problem.id), title: label, "aria-label": label}, icon(name))
      : element("button", {class: "icon-button", type: "button", disabled: "", "aria-label": label}, icon(name));
  };
  const picker = $("#problem-picker");
  const jump = button([text("span", (index + 1) + " of " + n), icon("chevron-down")], () => {
    const tried = new Set(home.packs.find(p => p.key === pack.key)?.attempted_ids);
    $("#problem-picker-list").replaceChildren(...pack.problems.map((problem, i) => {
      const current = index === i;
      const item = element("a", {
        href: routeFor(pack.key, problem.id), class: "problem-pick-link",
        "aria-current": current ? "step" : null, "data-pid": problem.id,
      }, text("span", String(i + 1).padStart(2, "0"), "small muted"), text("span", problemTitle(problem)),
      current || tried.has(problem.id) ? text("span", current ? "Open" : "Attempted", "small muted") : null);
      item.addEventListener("click", e => {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) picker.close();
      });
      return element("li", {}, item);
    }));
    jump.focus({preventScroll: true});
    picker.showModal();
    $("#problem-picker-list [aria-current]").focus();
  }, "button problem-jump");
  jump.setAttribute("aria-label", "Choose problem, " + (index + 1) + " of " + n);
  jump.setAttribute("aria-haspopup", "dialog");
  return element("nav", {class: "problem-switcher", "aria-label": "Problems"},
    arrow(-1, "left", "Previous problem"), jump, arrow(1, "right", "Next problem"));
}

function supportDialog(title, content) {
  $("#support-title").textContent = title;
  for (const node of content) if (node.classList.contains("md")) node.classList.add("reading-text");
  $("#support-body").replaceChildren(...content);
  if (!$("#support-dialog").open) $("#support-dialog").showModal();
}

function problemSupport(pack, task, state, isCurrent) {
  const opened = new Set(state.hint_indexes);
  const hintStatus = element("span", {class: "small muted", "aria-live": "polite"});
  const path = pack.key + "/" + encodeURIComponent(task.id);
  let busy = false;
  function paintHints() {
    hintStatus.textContent = state.earlier_hint && !opened.size
      ? "Hint opened earlier" : "Hints opened: " + opened.size;
  }
  async function show(trigger, getContent) {
    if (busy) return;
    busy = true;
    // Preserve focus on the trigger for the dialog's return path.
    trigger.setAttribute("aria-busy", "true");
    try { await getContent(); }
    catch (err) { if (isCurrent()) toast(err.message); }
    finally { busy = false; trigger.removeAttribute("aria-busy"); }
  }
  const hint = i => button([icon("bulb"), task.hint_count === 1 ? "Show hint" : "Hint " + (i + 1)], e => show(e.currentTarget, async () => {
    let data = await api("/api/reveal/" + path, {kind: "hint", index: i});
    if (!isCurrent()) return;
    const revealsReasoning = data.confirm === true;
    if (revealsReasoning) {
      if (!window.confirm("This hint reveals the target reasoning. Open it anyway?")) return;
      data = await api("/api/reveal/" + path, {kind: "hint", index: i, allow_reveal: true});
    }
    if (!isCurrent()) return;
    opened.add(i);
    paintHints();
    supportDialog(revealsReasoning ? "Hint (reveals reasoning)" : "Reviewed hint", [markdown(data.text, pack.key)]);
  }));
  const solution = task.has_solution ? button("Reviewed solution", e => show(e.currentTarget, async () => {
    if (!window.confirm("This reveals the reviewed solution or rubric. Open it now?")) return;
    const data = await api("/api/reveal/" + path, {kind: "solution"});
    if (!isCurrent()) return;
    supportDialog("Reviewed solution", [markdown(data.solution || data.rubric, pack.key, data.assets),
      ...(data.solution && data.rubric ? [text("h3", "Rubric"), markdown(data.rubric, pack.key, data.assets)] : []),
      ...figures(data.solution + "\n" + data.rubric, pack.key, data.assets)]);
  }), "button bare") : null;

  paintHints();
  return {hintStatus: task.hint_count ? div("row hint-status", icon("bulb"), hintStatus) : null,
    buttons: div("row problem-support", Array.from({length: task.hint_count}, (_, i) => hint(i)), solution)};
}

function solver(pack, pid, state) {
  const index = pack.problems.findIndex(p => p.id === pid);
  const task = pack.problems[index];
  const views = attemptViews(pack, task, state.history);
  const page = div("problem-page");
  const aides = problemSupport(pack, task, state, () => page.isConnected);
  const editor = answerEditor(pack, task, state.draft, aides.hintStatus, (answer, autoCheck) =>
    views.saved(answer, home.grader && task.can_check && autoCheck));
  editor.form.append(views.live);
  const art = [...figures(task.statement, pack.key, task.assets), task.visual ? plot(task.visual) : null].filter(Boolean);
  const prompt = div("problem-prompt", markdown(task.statement, pack.key, task.assets, true),
    task.uncertainty ? div("notice", text("strong", "What remains open"), text("p", task.uncertainty.what),
      text("p", task.uncertainty.progress), text("p", task.uncertainty.stop_or_resume)) : null);
  const goToAnswer = button(["Go to answer", icon("down")], () => {
    editor.heading.focus({preventScroll: true});
    editor.form.scrollIntoView({block: "start"});
  });
  const statement = element("article", {class: "card task-card", lang: pack.language},
    div("problem-heading",
      text("p", task.topic || pack.course || "Practice", "eyebrow"),
      element("h1", {id: "problem-title"}, problemTitle(task)),
      task.status === "experimental" ? pill("Unresolved investigation") : null),
    div("problem-body" + (art.length ? " with-art" : ""), prompt, art.length ? div("problem-artwork", art) : null),
    div("problem-actions", aides.buttons, goToAnswer));
  const policy = pack.reveal_policy ? element("details", {class: "help-note"},
    element("summary", {}, "Help policy"), markdown(pack.reveal_policy, pack.key, [], true)) : null;
  page.append(div("problem-toolbar", problemLocation(pack), problemNavigation(pack, index)), statement, editor.form);
  if (policy) page.append(policy);
  page.append(views.host);
  main.dataset.readerView = "problem";
  main.replaceChildren(page);
  rememberProblem(home.demo, pack.key, pid, index);
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
    const signed = n => String(n).replace("-", "−");
    const term = m === 1 ? "x" : m === -1 ? "−x" : signed(m) + "x";
    const equation = "y = " + (m === 0 ? signed(b) : term + (b < 0 ? " − " + Math.abs(b) : b > 0 ? " + " + b : ""));
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
