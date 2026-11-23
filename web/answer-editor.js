"use strict";

function answerEditor(pack, task, savedDraft, supportStatus, onSubmit) {
  const path = pack.key + "/" + encodeURIComponent(task.id);
  let draft = savedDraft;
  let busy = false;
  const hasChoice = task.options.length > 0;
  const status = element("p", {class: "status", role: "status"});
  const draftBadge = text("span", "", "small muted");
  const discard = button("Discard draft", discardDraft, "button bare danger");
  const save = button([icon("note"), "Save draft"], saveDraft);
  const submit = element("button", {class: "button primary", type: "submit"}, "Submit answer");
  const heading = element("h2", {class: "feature-title", id: "answer-heading", tabindex: "-1"}, "Your answer");
  const meta = div("answer-meta", supportStatus, draftBadge, discard);
  const help = element("select", {name: "help"}, [
    ["unknown", "Not specified"], ["no-help", "No outside help"],
    ["hint", "Used an outside hint"], ["solution", "Consulted an outside solution"],
  ].map(([value, label]) => element("option", {value}, label)));
  const auto = element("input", {type: "checkbox", name: "auto-check", checked: ""});
  const answer = hasChoice ? element("fieldset", {class: "choices"},
    text("legend", "Choose one option"),
    task.options.map((value, i) => element("label", {class: "choice"},
      element("input", {type: "radio", name: "choice", value: i, required: ""}),
      studyPassage(markdown(value, pack.key, [], true), "option", "Option " + (i + 1)))))
    : element("textarea", {name: "answer", class: "reading-text", rows: 6, maxlength: 12000,
      required: "", placeholder: "Write your reasoning…", "aria-label": "Your reasoning"});
  const form = element("form", {class: "card answer-card", "aria-labelledby": "answer-heading"},
    div("answer-header", heading, meta), answer,
    div("answer-controls", element("label", {class: "help-label"}, "Outside help", help),
      home.grader && task.can_check ? element("label", {class: "check"}, auto, "Check locally after saving") : null),
    div("answer-actions", save, submit), status);

  function values() {
    const data = new FormData(form);
    const value = hasChoice ? data.get("choice") : data.get("answer");
    return {data, body: hasChoice ? {choice: value === null ? null : Number(value), help: data.get("help")}
      : {answer: value, help: data.get("help")}};
  }
  function matchesSaved(body) {
    const field = hasChoice ? "choice" : "answer";
    return !!draft && body[field] === draft[field] && body.help === draft.help;
  }
  function paint() {
    draftBadge.textContent = draft ? (matchesSaved(values().body) ? "Draft saved" : "Unsaved changes") : "";
    draftBadge.hidden = !draft;
    discard.hidden = !draft;
    const {body} = values();
    save.disabled = busy || matchesSaved(body) || (hasChoice ? body.choice === null : !body.answer.trim());
    submit.disabled = discard.disabled = busy;
  }
  function writeStatus(message, error = false) {
    status.classList.toggle("error", error);
    status.textContent = message;
  }
  function hydrate() {
    if (!draft) return;
    if (hasChoice) form.elements.choice.value = String(draft.choice);
    else answer.value = draft.answer;
    help.value = draft.help;
  }
  async function action(work) {
    if (busy) return;
    busy = true;
    paint();
    try { await work(); }
    catch (err) { writeStatus(err.message, true); }
    finally { busy = false; paint(); }
  }
  function saveDraft() {
    if (!form.reportValidity()) return;
    const {body} = values();
    action(async () => {
      writeStatus("Saving draft…");
      draft = await api("/api/draft/" + path, body);
      writeStatus("Draft saved. It isn’t a submission.");
    });
  }
  function discardDraft() {
    if (!draft || busy || !window.confirm("Discard the saved draft for this problem?")) return;
    action(async () => {
      const clearEditor = matchesSaved(values().body);
      const revision = draft.revision;
      await api("/api/draft-discard/" + path, {revision});
      if (clearEditor && matchesSaved(values().body)) form.reset();
      draft = null;
      if (form.isConnected) heading.focus({preventScroll: true});
      writeStatus("Draft discarded.");
    });
  }
  form.addEventListener("input", () => { writeStatus(""); paint(); });
  form.addEventListener("change", paint);
  form.addEventListener("submit", e => {
    e.preventDefault();
    const {body, data} = values();
    action(async () => {
      writeStatus("Saving answer…");
      const revision = draft?.revision;
      const saved = await api("/api/attempt/" + path, {...body, draft_revision: revision});
      const current = values().body;
      const field = hasChoice ? "choice" : "answer";
      if (current[field] === body[field] && current.help === body.help) form.reset();
      draft = null;
      writeStatus("");
      await onSubmit(saved, data.has("auto-check"));
    });
  });
  hydrate();
  paint();
  return {form, heading, meta};
}
