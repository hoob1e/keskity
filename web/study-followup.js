"use strict";

function revealInStudyHelp(node, keepVisible) {
  const surface = node.closest(".study-menu-body, .study-help-dialog");
  if (!surface) return;
  const top = surface.getBoundingClientRect().top + surface.clientTop;
  const bottom = top + surface.clientHeight;
  const target = node.getBoundingClientRect();
  const gap = 10;
  const advance = Math.min(target.bottom - bottom + gap, target.top - top - gap,
    keepVisible.getBoundingClientRect().top - top - gap);
  if (advance > 0) surface.scrollTop += advance;
}

function studyFollowup(id, language, ask, isOpen) {
  const question = element("textarea", {id, name: "question", rows: 2, maxlength: 360,
    required: "", autocomplete: "off", placeholder: "Can you put this more simply?"});
  const form = studyReplyForm({
    controls: [element("label", {for: id, class: "sr-only"}, "Your follow-up"), question],
    action: "Ask local model", note: "Sends this note and your question locally. No transcript is saved.", isOpen, language,
    ask: (fields, options) => ask(fields.get("question").trim(), options),
    empty: "The model couldn’t answer from this note. Try asking about a specific part.",
  });
  const pane = studyDisclosure(id + "-panel", div("study-followup", form));
  const toggle = button(["Ask further", icon("chevron-down")], e => {
    const open = pane.pane.inert;
    pane.show(open, e.detail > 0);
    toggle.setAttribute("aria-expanded", String(open));
  }, "button bare study-help-ask");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", pane.pane.id);
  return {toggle, pane: pane.pane};
}
