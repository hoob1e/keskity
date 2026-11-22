"use strict";

const STUDY_TIPS = [
  ["Try before opening a hint", "Write down a first step. If you get stuck, look for one hint, then try again."],
  ["Explain your next step", "Write why the step follows, not just what you calculated."],
  ["Revisit a problem later", "Close the solution and see which steps you can reconstruct from memory."],
];

function studyTipCard() {
  const controller = new AbortController();
  const {signal} = controller;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const hoverable = matchMedia("(hover: hover) and (pointer: fine)");
  const pauseKey = "study-hub-tips-paused";
  const dwell = 14000;
  const curve = "cubic-bezier(0.74, 0.02, 0.38, 1)";
  let current = 0, paused = readPreference(pauseKey) === "true", hovered = false, visible = false;
  let timer, animations = [];
  const count = text("span", "", "tip-count");
  const spoken = element("span", {class: "sr-only", role: "status"});
  const copies = STUDY_TIPS.map(([title, copy], i) => element("div", {
    class: "tip-copy", "aria-hidden": String(i !== 0), "data-current": i === 0 ? "" : null,
  }, text("h3", title), text("p", copy, "small muted")));
  const previous = iconButton("left", "Previous study tip", () => move(-1));
  const next = iconButton("right", "Next study tip", () => move(1));
  const toggle = iconButton("pause", "Pause study tips", () => {
    paused = !paused;
    writePreference(pauseKey, String(paused));
    updateControls();
    schedule();
  });
  const art = svgNode("svg", {class: "tip-art", viewBox: "0 0 156 40", "aria-hidden": "true"});
  art.append(
    svgNode("path", {class: "tip-art-base", d: "M1 20h154"}),
    svgNode("path", {d: "M1 19c13-15 26-15 39 0s26 15 39 0 26-15 39 0 26 15 37 1"}),
    svgNode("path", {class: "tip-art-second", d: "M1 26c13 7 26-1 39-13s27-2 39 10 25 11 39-4 27-6 37 4"}),
  );
  const node = element("section", {class: "card tip-card", "aria-labelledby": "study-tip-heading"},
    div("tip-head",
      div("tip-label", div("tip-mark", icon("bulb")), element("h2", {id: "study-tip-heading"}, "Study tip")),
      div("tip-actions", count, previous, toggle, next)),
    div("tip-body", div("tip-copy-stack", copies), art),
    spoken);

  function updateControls() {
    count.textContent = (current + 1) + " / " + copies.length;
    toggle.hidden = reduceMotion.matches;
    const label = paused ? "Play study tips" : "Pause study tips";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.replaceChildren(icon(paused ? "play" : "pause"));
  }
  function clearMotion() {
    animations.forEach(animation => animation.cancel());
    animations = [];
    copies.forEach(copy => delete copy.dataset.exiting);
  }
  function move(offset, auto = false) {
    clearMotion();
    const old = copies[current];
    delete old.dataset.current;
    old.setAttribute("aria-hidden", "true");
    current = (current + offset + copies.length) % copies.length;
    const shown = copies[current];
    shown.dataset.current = "";
    shown.setAttribute("aria-hidden", "false");
    if (auto && !reduceMotion.matches && typeof shown.animate === "function") {
      old.dataset.exiting = "";
      animations = [
        old.animate([
          {opacity: 1, transform: "translateY(0)"},
          {opacity: 0, transform: "translateY(-5px)", offset: .56},
          {opacity: 0, transform: "translateY(-5px)"},
        ], {duration: 600, easing: curve}),
        shown.animate([
          {opacity: 0, transform: "translateY(5px)"},
          {opacity: 0, transform: "translateY(5px)", offset: .43},
          {opacity: 1, transform: "translateY(0)"},
        ], {duration: 600, easing: curve}),
      ];
      animations[0].onfinish = () => { delete old.dataset.exiting; };
    }
    if (!auto) spoken.textContent = "Tip " + (current + 1) + " of " + copies.length + ": " + STUDY_TIPS[current].join(". ");
    updateControls();
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (signal.aborted || !visible || paused || hovered || document.hidden || reduceMotion.matches
      || node.contains(document.activeElement)) return;
    timer = setTimeout(() => move(1, true), dwell);
  }
  node.addEventListener("pointerenter", e => {
    if (hoverable.matches && e.pointerType === "mouse") { hovered = true; schedule(); }
  }, {signal});
  node.addEventListener("pointerleave", () => { hovered = false; schedule(); }, {signal});
  node.addEventListener("focusin", schedule, {signal});
  node.addEventListener("focusout", () => queueMicrotask(() => { if (!signal.aborted) schedule(); }), {signal});
  document.addEventListener("visibilitychange", schedule, {signal});
  reduceMotion.addEventListener("change", () => { clearMotion(); updateControls(); schedule(); }, {signal});

  const observer = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting && e.intersectionRatio >= .5;
    schedule();
  }, {threshold: [.5]});
  observer.observe(node);
  updateControls();
  return {node, dispose() {
    observer.disconnect();
    controller.abort();
    clearTimeout(timer);
    clearMotion();
  }};
}
