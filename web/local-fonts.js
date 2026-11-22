"use strict";

const localFonts = (() => {
  const maxBytes = 2 * 1024 * 1024;
  const maxFonts = 8;
  const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  const faces = new Map();
  const format = /\.(woff2?|ttf|otf)$/i;
  const familyOf = id => "Keskity-" + id;
  let opening, ready;

  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("study-hub-fonts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("faces", {keyPath: "id"});
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = ready = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(err => { opening = null; throw err; });
    return opening;
  }

  async function change(action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("faces", "readwrite");
      tx.onabort = () => reject(tx.error || new Error("Could not save the font."));
      tx.oncomplete = () => resolve();
      action(tx.objectStore("faces"));
    });
  }

  async function faceFor(entry) {
    if (!idPattern.test(entry.id) || typeof entry.name !== "string" ||
        !(entry.bytes instanceof ArrayBuffer) || entry.bytes.byteLength > maxBytes) throw new Error("Invalid font file.");
    // Load binary data directly; font files never become a URL or go to the server.
    const face = new FontFace(familyOf(entry.id), entry.bytes);
    await face.load();
    return face;
  }

  function load() {
    if (!ready) ready = database().then(db => new Promise((resolve, reject) => {
      const request = db.transaction("faces", "readonly").objectStore("faces").getAll(null, maxFonts);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })).then(entries => Promise.all(entries.map(async entry => {
      try {
        const face = await faceFor(entry);
        document.fonts.add(face);
        faces.set(entry.id, {face, name: entry.name});
      } catch {} // Ignore unreadable entries; the selected role keeps its fallback.
    }))).catch(err => { ready = null; throw err; });
    return ready;
  }

  async function add(file) {
    if (!format.test(file.name)) throw new Error("Choose a WOFF2, WOFF, TTF, or OTF font.");
    if (!file.size || file.size > maxBytes) throw new Error("Choose a font file no larger than 2 MiB.");
    await load();
    if (faces.size >= maxFonts) throw new Error("Remove a font before adding another.");
    const entry = {id: crypto.randomUUID(), name: file.name.slice(0, 120), bytes: await file.arrayBuffer()};
    let face;
    try { face = await faceFor(entry); }
    catch { throw new Error("This file could not be read as a font."); }
    await change(store => store.add(entry));
    document.fonts.add(face);
    faces.set(entry.id, {face, name: entry.name});
    return entry.name;
  }

  async function remove(id) {
    await change(store => store.delete(id));
    const face = faces.get(id)?.face;
    if (face) document.fonts.delete(face);
    faces.delete(id);
  }

  return {
    load, add, remove,
    valid: id => idPattern.test(id),
    family: id => faces.has(id) ? familyOf(id) : null,
    entries: () => [...faces].map(([id, {name}]) => [id, name]).sort((a, b) => a[1].localeCompare(b[1])),
  };
})();
