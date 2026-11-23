"use strict";

const testRoute = (key, id, number) => "#test/" + key + (id ? "/" + id : "") + (number ? "/" + number : "");
const testApi = (key, id) => "/api/test/" + key + (id ? "/" + id : "");
const testImage = (key, id) => asset => testApi(key, id) + "/image?path=" + encodeURIComponent(asset.path);
const aidNames = {hints: "Hints", interactive_visuals: "Interactive figures"};
const aidSummary = aids => aids.length ? aids.map(a => aidNames[a]).join(", ") : "Off";
const testQuestionTitle = (q, i) => q.title || "Question " + (i + 1);
const testArea = test => test.course && home.packs.some(p => p.course === test.course)
  ? {label: test.course, href: courseRoute(test.course)} : {label: "Study", href: "#study"};
const testDate = ms => new Date(ms).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"});

function testShelf(tests, showCourse = false) {
  if (!tests.length) return null;
  return element("section", {class: "section test-shelf", "aria-labelledby": "test-shelf-title"},
    element("h2", {id: "test-shelf-title"}, "Practice tests"),
    div("test-list", tests.map(test => element("a", {class: "card entry-link ambient-card", href: testRoute(test.key)},
      icon("clock", "icon entry-mark"),
      div("entry-copy", text("strong", test.title), text("span",
        (showCourse && test.course ? test.course + " · " : "") + test.minutes + " min · " + howMany(test.count, "question"),
        "small muted")),
      icon("right", "icon link-arrow")))));
}

function testBack(test, label = "Practice tests", href = testArea(test).href) {
  return element("a", {class: "arrow-link test-back text-action", href}, icon("left"), label);
}

function testSetup({test, overview, attempts}) {
  const running = attempts.find(a => a.ended_ms == null);
  const earlier = attempts.filter(a => a.ended_ms != null);
  const selection = new Set();
  const aidStatus = element("span", {class: "small muted", role: "status"}, "All aids off");
  const status = element("p", {class: "small error", role: "alert"});
  const start = button(["Start test", icon("arrow")], async () => {
    start.disabled = true;
    status.textContent = "";
    try {
      const {id} = await api(testApi(test.key), {aids: [...selection]});
      if (start.isConnected) location.hash = testRoute(test.key, id);
    } catch (err) {
      status.textContent = err.message;
    } finally {
      start.disabled = false;
    }
  }, "button primary test-start");
  const stat = (name, iconName, value) => div("test-fact",
    div("test-mark", icon(iconName)), text("dt", name), text("dd", value));
  const rule = (iconName, name, info) => element("li", {},
    div("test-mark", icon(iconName)), div("test-rule-copy", text("strong", name), text("p", info, "small muted")));
  const aid = (key, label) => {
    const allowed = test.allowed_aids.includes(key) && !running;
    const input = element("input", {type: "checkbox", role: "switch", disabled: allowed ? null : ""});
    input.checked = !!running?.aids.includes(key);
    input.addEventListener("change", () => {
      if (input.checked) selection.add(key);
      else selection.delete(key);
      aidStatus.textContent = selection.size ? howMany(selection.size, "aid on", "aids on") : "All aids off";
    });
    return element("label", {class: "test-aid-row"},
      text("span", label), div("test-switch", input, element("span", {"aria-hidden": "true"})));
  };
  const back = testArea(test);
  main.replaceChildren(div("test-setup",
    testBack(test),
    div("ambient-resume resume-halo", element("header", {class: "study-hero card test-hero"},
      div("study-hero-kicker", codeTag("Practice test"), test.course ? text("span", test.course, "small") : null),
      text("h1", test.title), overview ? text("p", overview, "small") : null)),
    element("dl", {class: "card test-facts"},
      stat("Time limit", "clock", test.minutes + " min"), stat("Questions", "note", String(test.count)),
      stat("Available points", "data", test.points + " pts")),
    running ? div("notice test-resume",
      text("strong", "Test in progress"), text("p", "The countdown is still running. Your saved answers are ready."),
      link("Resume test →", testRoute(test.key, running.id), "button primary")) : null,
    div("test-setup-panels",
      element("section", {class: "card test-rules"}, text("h2", "Before you start"),
        element("ul", {},
          rule("clock", "One countdown", "Time keeps running if you leave or reload."),
          rule("note", "Answers save as you go", "At zero, the test submits the answers you’ve saved."),
          rule("lock", "Mark after submission", "No marking or worked answers during the test."))),
      element("section", {class: "card test-aids"},
        div("card-top", text("h2", "Allowed aids"), pill(running ? "Fixed for this attempt" : "Off by default")),
        text("p", running ? "These choices stay fixed until you finish." : "Choose permitted aids before starting.", "small muted"),
        div("test-aid-list",
          aid("reference", "Definitions, examples, and translations"),
          aid("hints", "Hints"),
          aid("interactive_visuals", "Interactive figures"),
          aid("model", "Local-model help")),
        text("p", "Required figures always appear.", "small muted"))),
    div("test-start-bar", testBack(test, "Back to " + back.label, back.href),
      div("test-start-actions", running ? null : [icon("lock"), aidStatus, start]), status),
    text("p", "This is practice. The rules apply only to aids inside keskity.", "small muted test-boundary"),
    earlier.length ? element("section", {class: "card test-history"},
      text("h2", "Previous attempts"),
      element("ul", {}, earlier.map(a => element("li", {},
        element("a", {class: "test-history-link", href: testRoute(test.key, a.id)},
          text("span", testDate(a.started_ms)), text("small", a.reason === "expired" ? "Time expired" : "Submitted", "muted"),
          icon("right")))))) : null));
}

function testPrompt(task, language, image, i) {
  const hintArea = div("test-hint-row");
  const art = [...figures(task.statement, "", task.assets, image), task.visual ? plot(task.visual) : null].filter(Boolean);
  const heading = element("h1", {id: "test-question-title", tabindex: -1}, testQuestionTitle(task, i));
  const card = element("article", {class: "card task-card test-prompt", lang: language},
    div("test-prompt-meta", text("span", task.topic || "Practice test", "eyebrow"), pill(howMany(task.points, "point"))),
    div("problem-heading", heading),
    div("problem-body" + (art.length ? " with-art" : ""),
      div("problem-prompt", markdown(task.statement, "", task.assets, true, image), hintArea),
      art.length ? div("problem-artwork", art) : null));
  return {heading, card, hintArea};
}

function testClock(totalSeconds) {
  const pad = n => String(n).padStart(2, "0");
  const seconds = totalSeconds % 60, minutes = Math.floor(totalSeconds / 60), hours = Math.floor(minutes / 60);
  return (hours ? hours + ":" + pad(minutes % 60) : pad(minutes)) + ":" + pad(seconds);
}

function activeTest(state, requestedQuestion) {
  const {test, attempt, questions, language} = state;
  const path = testApi(test.key, attempt.id);
  const image = testImage(test.key, attempt.id);
  const requested = Number(requestedQuestion) - 1;
  let index = Number.isInteger(requested) && requested >= 0 && requested < questions.length ? requested :
    Math.max(0, questions.findIndex(q => !q.answered));
  for (const q of questions) q.draft = q.value;
  const dirty = q => q.draft !== q.value;
  const remaining = () => attempt.deadline_ms - clock.server - Math.max(performance.now() - clock.mono, Date.now() - clock.wall);
  const anchor = server => ({server, mono: performance.now(), wall: Date.now()});
  let clock = anchor(state.server_ms);
  let disposed = false, locked = false, finished = false, saving = null, debounce, timeCheck = 0, modal, confirmClock, view;
  const body = div("test-question-body");
  const count = text("span", "", "small muted");
  const mobileAids = text("span", "", "small muted test-mobile-aids");
  mobileAids.textContent = attempt.aids.length ? "Aids: " + aidSummary(attempt.aids) : "Aids off";
  const topAids = $("#test-aids-label");
  topAids.replaceChildren(icon("lock"), mobileAids.textContent);
  topAids.hidden = false;
  const number = text("span", "", "small");
  const left = text("span", "", "small muted");
  const notice = element("p", {class: "notice", role: "status", hidden: ""});
  const alarm = element("span", {class: "sr-only", role: "status"});
  const clockText = text("span", "", "test-clock-digits");
  const clockNode = div("test-clock", icon("clock"), clockText, text("span", "left", "test-clock-unit"));
  clockNode.setAttribute("role", "timer");
  clockNode.setAttribute("aria-label", "Time left");
  const finish = button(["Finish test", icon("arrow")], showFinish, "button primary");
  finish.id = "finish-test";
  finish.setAttribute("aria-haspopup", "dialog");

  const prev = button([icon("left"), "Previous"], () => go(index - 1));
  const next = button(["Next", icon("right")], () => go(index + 1));
  const keys = questions.map((q, i) => {
    const key = button([String(i + 1), icon("check")], () => go(i), "button test-step");
    return key;
  });
  const navigator = element("nav", {class: "card test-navigation", "aria-label": "Test questions"},
    prev, div("test-steps", text("span", "Questions", "small muted"),
      div("test-step-keys", keys), left), next);
  const page = div("test-run",
    div("test-run-meta", number, mobileAids, count), notice, body, navigator, alarm);
  main.dataset.readerView = "test";
  main.replaceChildren(page);
  $("#test-tools").replaceChildren(clockNode, finish);
  $("#test-tools").hidden = false;

  function paint() {
    const filled = questions.filter(q => q.answered).length;
    number.textContent = "Question " + (index + 1) + " of " + questions.length;
    count.textContent = filled + " of " + questions.length + " answered";
    left.textContent = filled === questions.length ? "All answered" : (questions.length - filled) + " unanswered";
    prev.disabled = locked || index === 0;
    next.disabled = locked || index === questions.length - 1;
    keys.forEach((key, i) => {
      const checked = questions[i].answered;
      key.toggleAttribute("data-answered", checked);
      if (i === index) key.setAttribute("aria-current", "step");
      else key.removeAttribute("aria-current");
      const error = !!questions[i].error;
      key.toggleAttribute("data-save-failed", error);
      key.setAttribute("aria-label", "Question " + (i + 1) + (error ? ", save failed" : checked ? ", answered" : ", unanswered"));
      key.disabled = locked;
    });
    if (!view) return;
    const q = questions[index];
    const label = q.error ? "Not saved" : dirty(q) ? "Saving…" : q.revision ? "Saved" : "";
    if (view.badge.textContent !== label) view.badge.textContent = label;
    view.badge.classList.toggle("error", !!q.error);
    view.badge.toggleAttribute("data-saved", label === "Saved");
    view.error.hidden = !q.error;
    if (view.errorText.textContent !== (q.error || "")) view.errorText.textContent = q.error || "";
    view.editor.disabled = locked;
    if (view.clear) view.clear.disabled = locked || q.draft == null;
    view.retry.disabled = locked;
    view.hints.forEach(h => h.disabled = locked);
    view.hintCount.hidden = !q.hints_opened.length;
    view.hintCount.textContent = howMany(q.hints_opened.length, "hint opened", "hints opened");
  }

  function commit(updated) {
    if (locked || remaining() <= 0) return tick();
    const q = questions[index];
    q.draft = updated;
    q.error = null;
    clearTimeout(debounce);
    debounce = setTimeout(flush, q.options ? 0 : Math.min(320, Math.max(0, remaining() - 400)));
    paint();
  }

  function flush() {
    clearTimeout(debounce);
    if (saving) return saving;
    if (locked || finished || remaining() <= 0) return Promise.resolve(false);
    saving = (async () => {
      let q;
      while (!locked && !finished && remaining() > 0 && (q = questions.find(p => dirty(p) && !p.error))) {
        const value = q.draft;
        try {
          const saved = await api(path + "/answer", {question: q.id, value, revision: q.revision}, {keepalive: true});
          if (saved.status === "submitted") {
            openResult();
            return false;
          }
          q.value = value;
          q.answered = saved.answered;
          q.revision = saved.revision;
        } catch (err) {
          q.error = err.message;
        }
        if (!disposed) paint();
      }
      return !questions.some(dirty);
    })().finally(() => { saving = null; });
    return saving;
  }

  function go(to, focus = true) {
    if (disposed || locked || remaining() <= 0 || to < 0 || to >= questions.length) return;
    flush();
    index = to;
    history.replaceState(null, "", testRoute(test.key, attempt.id, index + 1));
    drawQuestion();
    if (focus) {
      window.scrollTo(0, 0);
      view.heading.focus({preventScroll: true});
    }
  }

  function drawQuestion() {
    const q = questions[index];
    const {heading, card, hintArea} = testPrompt(q, language, image, index);
    const hintCount = element("span", {class: "small muted", role: "status"});
    const hints = Array.from({length: q.hint_count}, (_, i) =>
      button([icon("bulb"), q.hint_count === 1 ? "Show hint" : "Hint " + (i + 1)], async e => {
        if (locked) return;
        const trigger = e.currentTarget;
        trigger.setAttribute("aria-busy", "true");
        try {
          const data = await api(path + "/hint", {question: q.id, index: i});
          if (data.status === "submitted") return openResult();
          if (!q.hints_opened.includes(i)) q.hints_opened.push(i);
          if (!disposed && !locked && trigger.isConnected) {
            paint();
            supportDialog("Reviewed hint", [markdown(data.text, "", [], true)]);
          }
        } catch (err) {
          if (!disposed && !locked) toast(err.message);
        } finally {
          trigger.removeAttribute("aria-busy");
        }
      }));
    if (hints.length) hintArea.append(...hints, hintCount);

    let editor, clear;
    if (q.options) {
      const radios = q.options.map((option, i) => {
        const input = element("input", {type: "radio", name: "test-choice", value: i});
        input.checked = q.draft === i;
        input.addEventListener("change", () => { if (input.checked) commit(i); });
        return element("label", {class: "choice"}, input, markdown(option, "", [], true));
      });
      editor = element("fieldset", {class: "test-choice"},
        text("legend", "Choose an answer", "sr-only"), radios);
      clear = button("Clear selection", () => {
        editor.querySelectorAll("input").forEach(r => { r.checked = false; });
        commit(null);
        editor.querySelector("input")?.focus();
      }, "button bare");
    } else {
      editor = element("textarea", {class: "reading-text", maxlength: 12000, rows: 4,
        placeholder: "Write your answer…", "aria-labelledby": "test-answer-label"});
      editor.value = q.draft ?? "";
      editor.addEventListener("input", () => commit(editor.value));
      editor.addEventListener("blur", () => flush());
    }
    const badge = element("span", {class: "test-save-state small", role: "status"});
    const errorText = element("span", {class: "small error", role: "alert"});
    const retry = button("Retry save", () => { q.error = null; paint(); flush(); });
    const error = div("test-save-error", errorText, retry);
    view = {heading, badge, editor, clear, error, errorText, retry, hints, hintCount};
    body.replaceChildren(card, element("section", {class: "card answer-card test-answer", lang: language},
      div("test-answer-head", element("h2", {id: "test-answer-label"}, "Your answer"), badge), editor, clear, error));
    paint();
  }

  async function showFinish() {
    if (locked || modal || finish.hasAttribute("aria-busy")) return;
    finish.setAttribute("aria-busy", "true");
    const saved = await flush();
    finish.removeAttribute("aria-busy");
    if (disposed || locked || modal) return;
    if (!saved) return toast("An answer hasn’t saved. Retry saving before finishing.");
    const blanks = questions.filter(q => !q.answered);
    const blankNumbers = blanks.map(q => questions.indexOf(q) + 1);
    const close = () => modal?.close();
    const keep = button("Keep working", close);
    const error = element("p", {class: "error small", role: "alert"});
    const submit = button("Submit test", async () => {
      if (locked) return;
      keep.disabled = submit.disabled = true;
      error.textContent = "";
      try {
        await api(path + "/submit", {blanks: blanks.map(q => q.id)});
        openResult();
      } catch (err) {
        error.textContent = err.message;
        keep.disabled = submit.disabled = false;
      }
    }, "button primary");
    confirmClock = text("span", clockText.textContent + " left", "test-clock-digits");
    modal = element("dialog", {class: "test-finish-dialog", "aria-labelledby": "test-finish-title"},
      div("dialog-inner",
        div("dialog-head", element("h2", {id: "test-finish-title"}, "Finish this test?"),
          button("×", close, "icon-button")),
        blanks.length ? div("test-blank-warning",
          text("strong", howMany(blanks.length, "unanswered question")),
          text("span", (blanks.length === 1 ? "Question " : "Questions ") + blankNumbers.join(", "), "small")) : null,
        text("p", "We’ll submit the answers you’ve saved. You can’t edit them afterward.", "muted"),
        div("test-confirm-time small muted", icon("clock"), text("span", "The countdown keeps running."), confirmClock),
        error, div("test-finish-actions", keep, submit)));
    modal.querySelector(".icon-button").setAttribute("aria-label", "Close");
    modal.addEventListener("close", e => {
      e.target.remove();
      if (modal !== e.target) return;
      modal = confirmClock = null;
      if (!disposed && !locked) finish.focus({preventScroll: true});
    });
    page.append(modal);
    modal.showModal();
    keep.focus();
  }

  function openResult() {
    if (finished) return;
    finished = locked = true;
    if (disposed || !location.hash.startsWith(testRoute(test.key, attempt.id))) return;
    $("#appearance-dialog[open], #support-dialog[open]")?.close();
    history.replaceState(null, "", testRoute(test.key, attempt.id));
    render({focus: true});
  }

  async function checkExpiry() {
    if (timeCheck || disposed || finished) return;
    timeCheck = 1;
    try {
      const latest = await api(path);
      if (disposed) return;
      if (latest.status === "submitted") return openResult();
      clock = anchor(latest.server_ms);
      locked = false;
      finish.disabled = false;
      notice.hidden = true;
      paint();
    } catch {
      notice.textContent = "Time’s up. Reconnecting to open your result…";
    } finally {
      if (!disposed && !finished) timeCheck = window.setTimeout(() => { timeCheck = 0; }, 1200);
    }
  }

  function tick() {
    if (disposed || finished) return;
    const seconds = Math.max(0, Math.ceil(remaining() / 1000));
    const formatted = testClock(seconds);
    if (clockText.textContent !== formatted) {
      clockText.textContent = formatted;
      if (confirmClock) confirmClock.textContent = formatted + " left";
      if (seconds === 300) alarm.textContent = "Five minutes left.";
      if (seconds === 60) alarm.textContent = "One minute left.";
    }
    clockNode.toggleAttribute("data-urgent", seconds <= 60);
    if (seconds) return;
    if (!locked) {
      locked = true;
      finish.disabled = true;
      modal?.close();
      $("#appearance-dialog[open], #support-dialog[open]")?.close();
      notice.textContent = "Time’s up. Opening your result…";
      notice.hidden = false;
      paint();
    }
    checkExpiry();
  }

  history.replaceState(null, "", testRoute(test.key, attempt.id, index + 1));
  drawQuestion();
  tick();
  const interval = setInterval(tick, 250);
  function departure() { flush(); }
  function visibility() {
    if (document.hidden) departure();
    else tick();
  }
  window.addEventListener("pagehide", departure);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    if (!finished) flush();
    disposed = true;
    $("#appearance-dialog[open]")?.close();
    clearInterval(interval);
    clearTimeout(timeCheck);
    window.removeEventListener("pagehide", departure);
    document.removeEventListener("visibilitychange", visibility);
    modal?.close();
  };
}
