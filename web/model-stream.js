"use strict";

const modelStreamType = "application/x-ndjson";
const modelMotion = matchMedia("(prefers-reduced-motion: no-preference)");

async function requestLocalModel(path, body, {onText, signal} = {}) {
  const streaming = onText && modelMotion.matches && typeof ReadableStream === "function";
  const response = await fetch(path, {
    method: "POST", mode: "same-origin", signal,
    // Gecko sends Origin: null for these POSTs under the page's no-referrer policy.
    referrerPolicy: "same-origin",
    headers: {"Content-Type": "application/json",
      Accept: streaming ? modelStreamType : "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== modelStreamType || !response.body) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The local model request failed.");
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", {fatal: true});
  const interrupted = "The model reply was interrupted. Try again.";
  let buffer = "", size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) throw new Error(interrupted);
      size += value.byteLength;
      if (size > 256 * 1024) throw new Error(interrupted);
      buffer += decoder.decode(value, {stream: true});
      const records = buffer.split("\n");
      buffer = records.pop();
      for (const record of records) {
        if (!record) continue;
        let frame;
        try { frame = JSON.parse(record); }
        catch { throw new Error(interrupted); }
        if (typeof frame?.error === "string") throw new Error(frame.error);
        if (frame?.result && typeof frame.result === "object") return frame.result;
        if (typeof frame?.field !== "string" || typeof frame.text !== "string") throw new Error(interrupted);
        onText?.(frame.field, frame.text);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function modelTextPreview(fields, {reading = false, lang, onReveal} = {}) {
  const node = element("div", {class: "model-text-preview", "aria-hidden": "true", hidden: "", lang: lang || null});
  const paragraphs = new Map(fields.map((key, i) => {
    const line = element("p", {class: [reading && "reading-text", i && "small"].filter(Boolean).join(" "),
      dir: "auto", hidden: ""});
    node.append(line);
    return [key, line];
  }));
  const pending = new Map();
  let timer = 0;
  function paint() {
    timer = 0;
    if (!node.isConnected || !modelMotion.matches) {
      pending.clear();
      return;
    }
    const first = node.hidden;
    for (const [key, chunk] of pending) {
      const line = paragraphs.get(key);
      line.append(text("span", chunk, "model-text-fragment"));
      line.hidden = false;
    }
    pending.clear();
    node.hidden = false;
    if (first) onReveal?.();
  }
  function push(key, chunk) {
    if (!modelMotion.matches || !paragraphs.has(key) || !chunk) return;
    pending.set(key, (pending.get(key) || "") + chunk);
    // Coalesce token bursts; never hold up the final result for animation.
    if (!timer) timer = setTimeout(paint, 40);
  }
  function clear() {
    clearTimeout(timer);
    timer = 0;
    pending.clear();
    node.hidden = true;
    for (const row of paragraphs.values()) {
      row.replaceChildren();
      row.hidden = true;
    }
  }
  return {node, push, clear};
}
