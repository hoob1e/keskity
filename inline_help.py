"""Reviewed glossary entries, scoped to one released untimed problem."""
import re
import unicodedata

MODES = ("definition", "example", "translation")
FOLLOWUP_LIMIT = 360
ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
LANG = re.compile(r"[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8}){0,3}")


def term_key(value):
    """Keep matching equivalent to the browser's visible-text lookup."""
    value = unicodedata.normalize("NFKC", value).lower()
    return " ".join(value.split()).rstrip(".,;:!?").rstrip()


def checked_text(value, label, limit, *, plain=False):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
        raise ValueError(f"{label} needs 1–{limit} characters.")
    if plain:
        if any(unicodedata.category(char) == "Cc" for char in value):
            raise ValueError(f"{label} cannot contain control characters.")
        return " ".join(value.split())
    return value.strip()


def validate_entries(raw, problem_id):
    if not isinstance(raw, list) or not 1 <= len(raw) <= 12:
        raise ValueError(f"{problem_id}: use 1–12 inline help entries, or omit inline_help.")
    entries, ids, forms = [], set(), set()
    for item in raw:
        if not isinstance(item, dict) or set(item) - {"id", "term", "aliases", "credit", "ask_further", *MODES}:
            raise ValueError(f"{problem_id}: invalid inline help entry.")
        entry_id = item.get("id")
        if not isinstance(entry_id, str) or len(entry_id) > 48 or not ID.fullmatch(entry_id) or entry_id in ids:
            raise ValueError(f"{problem_id}: give each inline help entry a distinct lowercase ID.")
        term = checked_text(item.get("term"), "Inline help term", 72, plain=True)
        raw_aliases = item.get("aliases", [])
        if not isinstance(raw_aliases, list) or len(raw_aliases) > 6:
            raise ValueError(f"{problem_id}: use at most six aliases per inline help term.")
        aliases = [checked_text(alias, "Inline help alias", 72, plain=True) for alias in raw_aliases]
        for label in [term, *aliases]:
            key = term_key(label)
            if not key or key in forms:
                raise ValueError(f"{problem_id}: inline help terms and aliases must match distinct text.")
            forms.add(key)
        entry = {"id": entry_id, "term": term, "aliases": aliases}
        modes = {mode for mode in MODES if mode in item}
        if not modes:
            raise ValueError(f"{problem_id}: include a definition, example, or translation.")
        for mode in ("definition", "example"):
            if mode in modes:
                entry[mode] = checked_text(item[mode], f"Inline help {mode}", 1000)
        if "translation" in modes:
            trans = item["translation"]
            if (not isinstance(trans, dict) or set(trans) != {"lang", "text"}
                    or not isinstance(trans["lang"], str) or not LANG.fullmatch(trans["lang"])):
                raise ValueError(f"{problem_id}: a translation needs a language tag and text.")
            entry["translation"] = {"lang": trans["lang"].lower(), "text": checked_text(trans["text"], "Translation", 1000)}
        if "ask_further" in item:
            allowed = item["ask_further"]
            if (not isinstance(allowed, list) or not allowed
                    or any(not isinstance(mode, str) or mode not in modes for mode in allowed)
                    or len(set(allowed)) != len(allowed)):
                raise ValueError(f"{problem_id}: ask_further must list distinct modes provided by this entry.")
            entry["ask_further"] = [mode for mode in MODES if mode in allowed]
        if "credit" in item:
            entry["credit"] = checked_text(item["credit"], "Inline help credit", 160, plain=True)
        ids.add(entry_id)
        entries.append(entry)
    return entries


def index_entries(entries):
    return [{**{k: item[k] for k in ("id", "term", "aliases")},
             "modes": [k for k in MODES if k in item],
             **({"ask_further": item["ask_further"]} if "ask_further" in item else {})} for item in entries]


def find_entry(problem, entry_id, mode):
    if mode not in MODES or not isinstance(entry_id, str):
        raise LookupError("This study help entry is not available for the problem.")
    entry = next((item for item in problem.get("inline_help", ()) if item["id"] == entry_id), None)
    if entry is None or mode not in entry:
        raise LookupError("This study help entry is not available for the problem.")
    return entry


def note_content(entry, mode, language):
    return entry[mode] if mode == "translation" else {"text": entry[mode], "lang": language}


def entry_content(problem, entry_id, mode, language):
    entry = find_entry(problem, entry_id, mode)
    return {**note_content(entry, mode, language), "credit": entry.get("credit")}


def followup_context(problem, language, data):
    if set(data) != {"id", "mode", "question"}:
        raise ValueError("Choose a study note and enter one follow-up question.")
    mode = data["mode"]
    entry = find_entry(problem, data["id"], mode)
    if problem["status"] != "checked" or mode not in entry.get("ask_further", ()):
        raise LookupError("This note does not allow local-model follow-ups.")
    question = data["question"]
    if (not isinstance(question, str) or len(question) > FOLLOWUP_LIMIT or not question.strip()
            or any(unicodedata.category(char) in {"Cc", "Cs"} and char not in "\t\n\r" for char in question)):
        raise ValueError(f"Enter a follow-up of 1–{FOLLOWUP_LIMIT} characters.")
    note = note_content(entry, mode, language)
    return {"term": entry["term"], "mode": mode, "note": note["text"], "language": note["lang"], "question": question.strip()}
