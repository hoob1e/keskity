"use strict";

const studySelectionLimit = 420;

function studyPassage(node, field, label, key, language) {
  node.dataset.studyPassage = field;
  node.dataset.studyLabel = label;
  if (key) node.dataset.studyPack = key;
  if (language) node.lang = language;
  return node;
}

function readStudyRange(range) {
  const contents = range.cloneContents();
  // KaTeX renders two copies for sighted and assistive reading. Send a full formula once.
  contents.querySelectorAll(".katex").forEach(math => {
    const source = math.querySelector("annotation")?.textContent;
    if (source) math.replaceWith(document.createTextNode(source));
  });
  contents.querySelectorAll(".katex-mathml, .sr-only").forEach(node => node.remove());
  contents.querySelectorAll("br,p,li,h1,h2,h3,h4,td,th,pre,blockquote").forEach(node => node.after(" "));
  return contents.textContent.replace(/\s+/gu, " ").trim();
}

function studyPassageText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  return readStudyRange(range);
}

function findStudySelection(root) {
  const selection = document.getSelection();
  if (selection?.rangeCount !== 1 || selection.isCollapsed ||
      !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const range = selection.getRangeAt(0);
  const target = edge => (edge.nodeType === Node.ELEMENT_NODE ? edge : edge.parentElement)?.closest("[data-study-passage]");
  const start = target(range.startContainer), end = target(range.endContainer);
  if (!start || !end) return null;
  const value = readStudyRange(range);
  return value ? {range: range.cloneRange(), value, source: start === end ? start : null} : null;
}

function sameStudyRange(a, b) {
  return a && b && a.startContainer === b.startContainer && a.endContainer === b.endContainer &&
    a.startOffset === b.startOffset && a.endOffset === b.endOffset;
}

function placeStudyHelp(popover, passage, range, preferred, editing) {
  const viewport = window.visualViewport;
  const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
  const left = x + 10, right = x + (viewport?.width ?? document.documentElement.clientWidth) - 10;
  const top = Math.max(y, $(".top").getBoundingClientRect().bottom) + 6;
  const bottom = y + (viewport?.height ?? document.documentElement.clientHeight) - 8;
  if (right <= left || bottom - top < 60) return null;
  const rects = [...range.getClientRects()].filter(r =>
    r.width && r.height && r.bottom > top && r.top < bottom && r.right > left && r.left < right);
  const gap = 7;
  popover.style.maxInlineSize = (right - left) + "px";
  const barHeight = popover.querySelector(".study-menu-tabs").offsetHeight;
  popover.style.setProperty("--study-bar-height", barHeight + "px");
  const first = rects[0], last = rects.at(-1);
  const space = {above: first ? first.top - top - gap : 0, below: last ? bottom - last.bottom - gap : 0};
  const room = Math.max(space.above, space.below);
  if (editing && room < barHeight + 88) {
    // A touch keyboard may leave too little room next to the original selection.
    popover.style.left = left + "px";
    popover.style.top = top + "px";
    popover.style.setProperty("--study-room", (bottom - top) + "px");
    popover.removeAttribute("data-above");
    popover.setAttribute("data-unpinned", "");
    return preferred || "below";
  }
  if (!first || room < barHeight + 6) return null;
  const side = preferred && space[preferred] >= barHeight + 40 ? preferred :
    (space.below >= 200 || space.below >= space.above ? "below" : "above");
  const anchor = side === "above" ? first : last;
  const point = Math.min(right, Math.max(left, (anchor.left + anchor.right) / 2));
  const width = popover.offsetWidth;
  const column = passage?.getBoundingClientRect();
  const colLeft = Math.max(left, column?.left ?? left), colRight = Math.min(right, column?.right ?? right);
  const fits = colRight - colLeft >= width;
  const low = fits ? colLeft : left, high = fits ? colRight - width : right - width;
  const position = Math.min(high, Math.max(low, point - 58));
  popover.style.left = position + "px";
  popover.style.top = (side === "below" ? last.bottom + gap : first.top - gap) + "px";
  popover.style.setProperty("--study-pin", Math.min(width - 14, Math.max(14, point - position)) + "px");
  popover.style.setProperty("--study-room", space[side] + "px");
  popover.toggleAttribute("data-above", side === "above");
  popover.removeAttribute("data-unpinned");
  return side;
}

function studySelectionPopover(root, on, fallback, menu) {
  const popover = element("div", {class: "study-help-popover", popover: "auto", role: "dialog",
    "aria-label": "Study help", "data-reader-view": "study-help"});
  const supported = typeof popover.showPopover === "function";
  let selection, dismissed, engaged = false, side, pointer, pointerSelection = false, frame = 0;
  const visible = () => supported && popover.matches(":popover-open");
  function close(restore = false) {
    if (visible()) popover.hidePopover();
    if (restore) fallback()?.focus({preventScroll: true});
  }
  function highlight(range) {
    if (!window.Highlight || !CSS.highlights) return;
    if (range) CSS.highlights.set("reviewed-study-term", new Highlight(range));
    else CSS.highlights.delete("reviewed-study-term");
  }
  function place() {
    const focus = document.activeElement;
    const editing = engaged && popover.contains(focus) && focus.matches("textarea:not([readonly])");
    side = placeStudyHelp(popover, selection.source, selection.range, side, editing);
    if (!side) close(popover.contains(focus));
  }
  function update() {
    frame = 0;
    if (pointer != null || $("dialog[open]") || !root.isConnected) return;
    if (visible() && engaged) {
      place();
      return;
    }
    const next = findStudySelection(root);
    if (!next) {
      close();
      dismissed = null;
      return;
    }
    if (sameStudyRange(next.range, dismissed)) return;
    if (!visible() || !sameStudyRange(selection?.range, next.range)) {
      selection = next;
      const initiallyHidden = !visible();
      if (initiallyHidden) {
        side = null;
        popover.toggleAttribute("data-pointer-open", pointerSelection);
      }
      cancelStudyReplies(popover);
      popover.replaceChildren(menu(next, () => {
        engaged = true;
        highlight(selection.range);
      }));
      if (initiallyHidden) popover.showPopover();
    }
    place();
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  if (supported) {
    root.querySelectorAll("[data-study-passage]").forEach(node => node.classList.add("study-help-target"));
    on(popover, "beforetoggle", e => {
      if (e.newState !== "closed") return;
      dismissed = selection?.range;
      selection = side = null;
      engaged = false;
      highlight(null);
      cancelStudyReplies(popover);
      popover.replaceChildren();
    });
    on(document, "keydown", e => {
      pointerSelection = false;
      if (e.key !== "Escape" || !visible() || $("dialog[open]")) return;
      e.preventDefault();
      close(popover.contains(document.activeElement));
    }, {capture: true});
    on(popover, "mousedown", e => {
      if (e.button === 0 && e.target.closest(".study-menu-tab")) e.preventDefault();
    });
    on(root, "pointerdown", e => {
      if (e.button !== 0 || !e.target.closest("[data-study-passage]")) return;
      dismissed = null;
      pointerSelection = true;
      pointer = e.pointerId;
    });
    on(window, "blur", () => { pointer = null; });
    for (const event of ["pointerup", "pointercancel"]) on(window, event, e => {
      if (pointer === e.pointerId) {
        pointer = null;
        schedule();
      }
    }, {capture: true});
    on(document, "selectionchange", schedule);
    on(document, "scroll", e => { if (!popover.contains(e.target)) schedule(); }, {passive: true, capture: true});
    on(window, "resize", schedule);
    on(window.visualViewport, "resize", schedule);
    on(window.visualViewport, "scroll", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    return {node: popover, visible, close, dispose: () => {
      close();
      observer.disconnect();
      cancelAnimationFrame(frame);
    }};
  }
  return {node: null, visible, close, dispose: () => {}};
}
