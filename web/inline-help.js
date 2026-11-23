"use strict";

const studyTermKey = value => value.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ").replace(/[.,;:!?]+$/u, "").trimEnd();

function providedStudyNote({entry, modes, prefix, reveal, ask, label, isOpen}) {
  const note = div("study-help-note");
  const notice = element("p", {role: "status", class: "small muted sr-only"});
  const node = div("study-provided-note", note, notice);
  let started = false, version = 0;

  async function show(mode, trigger) {
    const request = ++version;
    cancelStudyReplies(note);
    let focused = trigger && document.activeElement === trigger;
    notice.classList.remove("sr-only", "error");
    notice.textContent = "Opening pack note…";
    try {
      const data = await reveal(entry, mode);
      if (request !== version || !isOpen()) return;
      focused = focused && document.activeElement === trigger;
      const body = markdown(data.text, "", [], true);
      body.lang = data.lang;
      body.dir = "auto";
      const credit = text("p", "From this pack" + (mode === "translation" ? " · " + label(data.lang) : "") +
        (data.credit ? " · " + data.credit : ""), "study-help-credit small muted");
      const other = modes.find(key => key !== mode);
      const switchMode = other ? button(other === "example" ? "Example" : "Definition",
        e => show(other, e.currentTarget), "button bare study-note-switch") : null;
      const followup = ask && entry.ask_further?.includes(mode) ?
        studyFollowup(prefix + "-question", data.lang, (question, options) => ask(entry, mode, question, options), isOpen) : null;
      const buttons = switchMode || followup ? div("study-note-actions", switchMode, followup?.toggle) : null;
      const foot = div("study-note-foot", mode === "translation" ? null : credit, buttons);
      note.replaceChildren(
        ...(mode === "translation" ? [credit] : []), body,
        ...(buttons || mode !== "translation" ? [foot] : []), ...(followup ? [followup.pane] : []),
      );
      if (focused) (switchMode || followup?.toggle || note.closest(".study-menu-section")?.firstElementChild)
        ?.focus({preventScroll: true});
      notice.classList.add("sr-only");
      notice.textContent = "Pack note ready.";
    } catch (err) {
      if (request !== version || !isOpen()) return;
      notice.classList.add("error");
      notice.textContent = err.message;
      if (!note.childElementCount) {
        const retry = button("Try again", () => show(mode, retry));
        note.append(retry);
      }
    }
  }
  return {node, open: () => {
    if (!started) {
      started = true;
      show(modes[0]);
    }
  }};
}

function studyHelp(root, {pack, task, opened = false, restore} = {}) {
  const entries = task?.inline_help || [];
  const allowed = !task || task.explain_selection === true;
  const terms = new Map(entries.flatMap(entry => [entry.term, ...entry.aliases].map(term => [studyTermKey(term), entry])));
  const life = new AbortController();
  const on = (target, event, listener, options = {}) =>
    target?.addEventListener(event, listener, {...options, signal: life.signal});
  const status = task ? div("row study-help-status", icon("book"), text("span", "Study help opened", "small")) : null;
  if (status) status.hidden = !opened;
  const control = button([icon("book"), "Study help"], () => browse(), "button study-help-control");
  control.setAttribute("aria-haspopup", "dialog");
  const fallback = () => control.isConnected ? control : restore;
  const title = element("h2", {id: "study-help-title", tabindex: -1}, "Study help");
  const close = iconButton("close", "Close study help", () => dialog.close());
  const body = div("study-help-browser");
  const dialog = element("dialog", {class: "study-help-dialog", "aria-labelledby": title.id, "data-reader-view": "study-help"},
    div("dialog-inner", div("dialog-head", title, close), body));

  const floating = studySelectionPopover(root, on, fallback, (selection, activate) =>
    menu(selection, "study-inline", () => floating.visible(), activate).node);

  function showedHelp() {
    if (status && !life.signal.aborted) status.hidden = false;
  }
  function noteRequest(entry, mode) {
    return api("/api/reveal/" + pack.key + "/" + encodeURIComponent(task.id), {kind: "inline-help", id: entry.id, mode})
      .then(data => { showedHelp(); return data; });
  }
  function followupRequest(entry, mode, question, options) {
    return requestLocalModel("/api/ask-further/" + pack.key + "/" + encodeURIComponent(task.id),
      {id: entry.id, mode, question}, options);
  }

  function menu(selection, prefix, open, onInteract, initial, knownEntry) {
    const entry = knownEntry || terms.get(studyTermKey(selection.value));
    const issue = !allowed ? "This pack doesn’t enable help for new selections in this problem." :
      knownEntry ? "Select text in the problem or choose a passage to use this option." : studyPassageIssue(selection);
    const modelIssue = issue || (!home.explain_selection ? "Local help needs the local model on this computer." : null);
    const language = selection.source?.lang || pack?.language || "en";
    const langLabel = code => {
      try { return new Intl.DisplayNames(["en"], {type: "language"}).of(code); }
      catch { return code; }
    };
    const request = async (action, extra, options) => {
      const key = pack?.key || selection.source.dataset.studyPack;
      const path = key + (task ? "/" + encodeURIComponent(task.id) : "");
      const data = await requestLocalModel("/api/" + action + "/" + path,
        {field: selection.source.dataset.studyPassage, text: selection.value, ...extra}, options);
      if (data.reply != null) showedHelp();
      return data;
    };
    const problemNote = (modes, id, current) => providedStudyNote({
      entry, modes, prefix: id, isOpen: current, label: langLabel, reveal: noteRequest,
      ask: home.followup ? followupRequest : null,
    });
    const message = value => text("p", value, "small muted study-menu-message");
    return studyHelpMenu({prefix, isOpen: () => !life.signal.aborted && open(), onInteract, initial,
      makePane(mode, id, isOpen) {
        if (mode === "explain") {
          // Context is optional and limited to the published overview containing the selection.
          const source = !issue && !task ? studyPassageText(selection.source) : "";
          const context = source !== selection.value && [...source].length <= 600 ? source : "";
          return {node: studyAccordion(id, [
            {key: "local", label: "Explain locally", content: modelIssue ? message(modelIssue) :
              localExplanationForm(id + "-question", request, isOpen, language)},
            {key: "copy", label: "Copy explanation prompt", content: issue ? message(issue) :
              studyPromptCopy(selection.value, language, context, isOpen)},
          ])};
        }
        if (mode === "definition") {
          const modes = entry?.modes.filter(mode => mode !== "translation") || [];
          const provided = modes.length ? problemNote(modes, id + "-provided", isOpen) : null;
          return {node: studyAccordion(id, [
            {key: "provided", label: modes.length === 1 && modes[0] === "example" ? "Provided example" : "Provided definition",
              content: provided?.node || message("No definition from this pack for the selection."), onOpen: provided?.open},
            {key: "online", label: "Check online", later: true},
            {key: "local", label: "Generate definition locally", content: modelIssue ? message(modelIssue) :
              localDefinitionForm(request, isOpen, language)},
          ], {first: knownEntry && provided ? "provided" : null, multiple: true})};
        }
        const provided = entry?.modes.includes("translation") ? problemNote(["translation"], id + "-provided", isOpen) : null;
        return {node: studyAccordion(id, [
          {key: "provided", label: "Provided translation", content: provided?.node || message("No translation from this pack for the selection."),
            onOpen: provided?.open},
          {key: "local", label: "Translate locally", content: modelIssue ? message(modelIssue) :
            localTranslationForm(id + "-target", language, request, isOpen)},
        ], {first: knownEntry && provided ? "provided" : null, multiple: true})};
      },
    });
  }

  function openDialog(nodes) {
    cancelStudyReplies(body);
    body.replaceChildren(...nodes);
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    title.focus({preventScroll: true});
  }
  function browse(focusEntry) {
    floating.close();
    const rows = entries.map(entry => element("li", {}, button([text("strong", entry.term), icon("right")],
      () => choose({value: entry.term}, entry), "study-help-term")));
    const picker = allowed ? browseStudyPassages(root, selection => choose(selection)) : null;
    openDialog([
      rows.length ? text("p", "Reviewed terms for this question.", "small muted") : null,
      rows.length ? element("ul", {class: "study-help-terms"}, rows) : null,
      picker ? element("section", {class: "study-help-passage-section"},
        rows.length ? text("h3", "Select a passage") : null, picker) : null,
    ].filter(Boolean));
    if (focusEntry) body.querySelectorAll(".study-help-term")[entries.indexOf(focusEntry)]?.focus({preventScroll: true});
  }
  function choose(selection, entry) {
    const initial = entry ? (entry.modes.some(mode => mode !== "translation") ? "definition" : "translation") : null;
    const view = menu(selection, "study-picker", () => dialog.open, null, initial, entry);
    openDialog([button([icon("left"), "Study help options"], () => browse(entry), "button bare study-help-back"), view.node]);
    view.start();
  }

  on(dialog, "close", () => {
    if (dialog.open) return;
    cancelStudyReplies(body);
    body.replaceChildren();
    if (fallback()?.isConnected) fallback().focus({preventScroll: true});
  });
  return {control: entries.length || allowed ? control : null, status: entries.length || allowed ? status : null,
    layers: [dialog, floating.node].filter(Boolean), dispose: () => {
      floating.dispose();
      cancelStudyReplies(body);
      life.abort();
      if (dialog.open) dialog.close();
    }};
}
