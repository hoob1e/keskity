"use strict";

(() => {
  const root = document.documentElement;
  const key = "study-hub-appearance";
  const themeKey = "study-hub-theme";
  const themes = ["paper", "white", "dark", "ink"];
  const families = {
    interface: "var(--type)",
    sans: "var(--type-default)",
    serif: "var(--display-default)",
    mono: "var(--type-code)",
  };
  const readingDefaults = {font: "interface", family: "", size: 18, leading: "1.6", width: "68"};
  const themeDefaults = {glow: 35, uiFont: "default", uiFamily: "", titleFont: "default", titleFamily: ""};
  const defaults = {...readingDefaults, ...themeDefaults};
  const scales = {leading: ["1.4", "1.6", "1.85"], width: ["50", "68", "86"]};
  const oneOf = (items, value, fallback) => items.includes(value) ? value : fallback;
  const scaled = (value, min, max, fallback) => {
    const number = Number(value);
    return value == null || value === "" || !Number.isFinite(number)
      ? fallback : Math.round(Math.max(min, Math.min(number, max)));
  };

  const fontName = raw => {
    const value = typeof raw === "string" ? raw.trim().slice(0, 70) : "";
    return /^[\p{L}\p{M}\p{N} ._+-]+$/u.test(value) ? value : "";
  };
  const fontChoice = (allowed, value, fallback) =>
    typeof value === "string" && value.startsWith("file:") && localFonts.valid(value.slice(5))
      ? value : oneOf(allowed, value, fallback);

  function normalize(raw) {
    const p = raw ?? {};
    return {
      glow: scaled(p.glow, 0, 100, defaults.glow),
      font: fontChoice([...Object.keys(families), "installed"], p.font, defaults.font),
      family: fontName(p.family),
      uiFont: fontChoice(["default", "system", "serif", "installed"], p.uiFont, defaults.uiFont),
      uiFamily: fontName(p.uiFamily),
      titleFont: fontChoice(["default", "interface", "system", "serif", "installed"], p.titleFont, defaults.titleFont),
      titleFamily: fontName(p.titleFamily),
      size: scaled(p.size, 14, 28, defaults.size),
      leading: oneOf(scales.leading, p.leading, defaults.leading),
      width: oneOf(scales.width, p.width, defaults.width),
    };
  }

  function stack(choice, name, fallback, presets) {
    const font = choice === "installed" ? name : choice.startsWith("file:") ? localFonts.family(choice.slice(5)) : null;
    return font ? '"' + font + '", ' + fallback : presets[choice] || fallback;
  }

  let prefs = {...defaults};
  let theme = oneOf(themes, root.dataset.theme, "paper");
  try {
    theme = oneOf(themes, localStorage.getItem(themeKey), theme);
    prefs = normalize(JSON.parse(localStorage.getItem(key)));
  } catch {}

  function apply() {
    root.dataset.theme = theme;
    root.style.setProperty("--glow-strength", prefs.glow / 100);
    const ui = {"system": "system-ui, sans-serif", "serif": "Georgia, serif"};
    root.style.setProperty("--type", stack(prefs.uiFont, prefs.uiFamily, "var(--type-default)", ui));
    root.style.setProperty("--display", stack(prefs.titleFont, prefs.titleFamily, "var(--display-default)",
      {...ui, interface: "var(--type)"}));
    root.style.setProperty("--reader-font", stack(prefs.font, prefs.family, "var(--type)", families));
    root.style.setProperty("--reader-size", prefs.size / 16 + "rem");
    root.style.setProperty("--reader-leading", prefs.leading);
    root.style.setProperty("--reader-width", prefs.width + "ch");
  }

  function save() {
    try {
      localStorage.setItem(themeKey, theme);
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {} // Settings still apply for this page if storage is disabled.
  }
  apply();

  const dialog = document.querySelector("#appearance-dialog");
  const fields = dialog.querySelector("form").elements;
  let panel = "appearance";
  let opener;
  dialog.addEventListener("close", () => {
    if (opener?.isConnected) opener.focus({preventScroll: true});
    opener = null;
  });
  function updateOutputs() {
    fields.glow.disabled = theme === "ink";
    fields.glow.setAttribute("aria-valuetext", prefs.glow ? prefs.glow + "%" : "Off");
    fields.size.setAttribute("aria-valuetext", prefs.size + " pixels");
    dialog.querySelector("#glow-value").value = prefs.glow + "%";
    dialog.querySelector("#size-value").value = prefs.size + " px";
    fields.family.closest("label").hidden = prefs.font !== "installed";
    fields.uiFamily.closest("label").hidden = prefs.uiFont !== "installed";
    fields.titleFamily.closest("label").hidden = prefs.titleFont !== "installed";
  }
  function sync() {
    fields.theme.value = theme;
    for (const [name, value] of Object.entries(prefs)) {
      const field = fields[name];
      field.value = value;
      if (field.tagName === "SELECT" && field.selectedIndex < 0) field.value = defaults[name];
    }
    updateOutputs();
  }
  function selectPanel(name) {
    panel = name;
    dialog.querySelectorAll("[data-panel]").forEach(b => b.setAttribute("aria-pressed", b.dataset.panel === name));
    dialog.querySelectorAll("[data-settings]").forEach(section => section.hidden = section.dataset.settings !== name);
  }
  dialog.querySelectorAll("[data-panel]").forEach(b => b.addEventListener("click", () => selectPanel(b.dataset.panel)));
  dialog.querySelector("[data-reset-settings]").addEventListener("click", () => {
    prefs = {...prefs, ...(panel === "reading" ? readingDefaults : themeDefaults)};
    apply();
    sync();
    save();
  });
  function edit(e) {
    const {name, value} = e.target;
    if (name === "theme") theme = oneOf(themes, value, theme);
    else if (Object.hasOwn(defaults, name)) prefs = normalize({...prefs, [name]: value});
    else return;
    apply();
    updateOutputs();
    save();
  }
  dialog.addEventListener("input", e => { if (e.target.type === "range") edit(e); });
  dialog.addEventListener("change", edit);

  document.addEventListener("click", e => {
    const trigger = e.target.closest("[data-open-appearance], [data-open-reading]");
    if (!trigger || dialog.open) return;
    opener = trigger;
    const start = trigger.hasAttribute("data-open-reading") ? "reading" : "appearance";
    sync();
    selectPanel(start);
    dialog.showModal();
    (start === "reading" ? fields.font : fields.theme).focus();
  });
  const addFont = dialog.querySelector("#add-font");
  const fontFile = dialog.querySelector("#font-file");
  const fontDetails = dialog.querySelector("#font-files");
  const fontList = dialog.querySelector("#font-list");
  const fontStatus = dialog.querySelector("#font-status");
  const fontRoles = ["uiFont", "titleFont", "font"];
  let fontBusy = false;

  function refreshFonts() {
    const entries = localFonts.entries();
    for (const role of fontRoles) {
      fields[role].querySelector("optgroup")?.remove();
      if (!entries.length) continue;
      const options = document.createElement("optgroup");
      options.label = "My font files";
      for (const [id, label] of entries) options.append(new Option(label, "file:" + id));
      fields[role].append(options);
    }
    fontDetails.hidden = !entries.length;
    fontList.replaceChildren(...entries.map(([id, name]) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = name;
      const remove = document.createElement("button");
      remove.className = "button bare";
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + name);
      remove.addEventListener("click", () => changeFont(async () => {
        await localFonts.remove(id);
        for (const role of fontRoles) if (prefs[role] === "file:" + id) prefs[role] = defaults[role];
        return "Removed " + name + ".";
      }, addFont));
      item.append(label, remove);
      return item;
    }));
  }
  async function changeFont(action, restoreFocus) {
    if (fontBusy) return;
    fontBusy = true;
    addFont.disabled = true;
    fontStatus.classList.remove("error");
    fontStatus.textContent = "Saving font settings…";
    try {
      fontStatus.textContent = await action();
      refreshFonts();
      apply();
      sync();
      save();
    } catch (err) {
      fontStatus.textContent = err?.message || "Font storage is unavailable in this browser.";
      fontStatus.classList.add("error");
    } finally {
      fontBusy = false;
      addFont.disabled = false;
      if (dialog.open) restoreFocus?.focus({preventScroll: true});
    }
  }
  addFont.addEventListener("click", () => fontFile.click());
  fontFile.addEventListener("change", () => {
    const [file] = fontFile.files;
    fontFile.value = "";
    if (file) changeFont(async () => "Added " + await localFonts.add(file) + ". Choose it in a font menu.", addFont);
  });
  sync();
  localFonts.load().then(() => {
    refreshFonts();
    apply();
    sync();
  }).catch(() => {}); // Defaults still work without local font storage.
})();
