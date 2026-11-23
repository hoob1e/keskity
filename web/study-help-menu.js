"use strict";

function studyDisclosure(id, content, cls = "") {
  const pane = element("div", {id, class: ("study-help-disclosure " + cls).trim(), inert: ""},
    div("study-help-disclosure-clip", content));
  return {
    pane,
    show(open, motion) {
      pane.toggleAttribute("data-animate", motion);
      pane.inert = !open;
      pane.toggleAttribute("data-open", open);
    },
  };
}

function studyAccordion(prefix, rows, {first, multiple = false} = {}) {
  const group = div("study-menu-accordion");
  const items = new Map();
  for (const row of rows) {
    const id = prefix + "-" + row.key;
    if (row.later) {
      group.append(div("study-menu-section",
        div("study-menu-row study-menu-later", text("span", row.label), pill("Later"))));
      continue;
    }
    const pane = studyDisclosure(id, div("study-menu-section-inner", row.content));
    const toggle = button([row.label, icon("chevron-down")], e => {
      const open = pane.pane.inert;
      const motion = e.detail > 0;
      if (open && !multiple) {
        for (const item of items.values()) if (item !== setOpen) item(false, motion);
      }
      setOpen(open, motion);
    }, "study-menu-row");
    function setOpen(open, motion = false) {
      toggle.setAttribute("aria-expanded", String(open));
      pane.show(open, motion);
      if (open) row.onOpen?.();
    }
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", id);
    group.append(div("study-menu-section", toggle, pane.pane));
    items.set(row.key, setOpen);
  }
  items.get(first)?.(true);
  return group;
}

function studyHelpMenu({prefix, makePane, isOpen, onInteract, initial}) {
  const bar = element("div", {class: "study-menu-tabs", role: "group", "aria-label": "Study help options"});
  const scroller = div("study-menu-body");
  const body = studyDisclosure(prefix + "-body", scroller, "study-menu-reveal");
  body.pane.setAttribute("role", "region");
  const root = div("study-inline-menu", bar, body.pane);
  const tabs = new Map(), pages = new Map();
  let active;
  for (const [mode, label] of Object.entries({explain: "Explain", definition: "Definition", translation: "Translation"})) {
    const tab = button(label, e => {
      onInteract?.();
      // Pointer activation preserves the selection, then focuses the tab for keyboard continuation.
      tab.focus({preventScroll: true});
      show(mode, e.detail > 0);
    }, "study-menu-tab");
    tab.id = prefix + "-tab-" + mode;
    tab.dataset.studyTab = mode;
    tab.setAttribute("aria-expanded", "false");
    tab.setAttribute("aria-controls", body.pane.id);
    tabs.set(mode, tab);
    bar.append(tab);
  }
  function show(mode, motion = false) {
    if (active === mode) {
      active = null;
      tabs.get(mode).setAttribute("aria-expanded", "false");
      body.show(false, motion);
      return;
    }
    const switching = !!active;
    active = mode;
    if (!pages.has(mode)) {
      const current = () => isOpen() && root.isConnected;
      const page = makePane(mode, prefix + "-" + mode, current);
      page.node.dataset.studyPane = mode;
      pages.set(mode, page);
      scroller.append(page.node);
    }
    for (const [key, page] of pages) page.node.hidden = key !== mode;
    scroller.scrollTop = 0;
    body.pane.setAttribute("aria-labelledby", tabs.get(mode).id);
    for (const [key, tab] of tabs) tab.setAttribute("aria-expanded", String(key === mode));
    body.pane.toggleAttribute("data-switch", switching && motion);
    body.show(true, motion);
  }
  return {node: root, start: () => { if (initial) show(initial); }};
}
