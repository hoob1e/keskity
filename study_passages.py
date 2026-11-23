"""Allow model tools to read only the selected part of a released passage."""
import html
import re
import unicodedata

SELECTION_LIMIT = 420


def flat(value):
    return " ".join(unicodedata.normalize("NFKC", html.unescape(value)).casefold().split())


def reading_key(value):
    # Displayed Markdown/KaTeX can omit delimiters or insert spaces.
    # Word and number order still has to match the authored text.
    return "".join(c for c in flat(value) if c.isalnum())


def overview_text(pack, field):
    study = pack.get("study", {})
    if field == "title":
        return (study.get("title") or (pack["course"] or pack["title"]),)
    if field == "scope":
        return tuple(pack["scope"])
    if field == "concepts":
        return tuple(study.get("concepts", ()))
    if field in ("overview", "uses", "fact") and study.get(field):
        return (study[field],)
    return ()


def problem_text(problem, field):
    if field in ("prompt", "option"):
        if field == "prompt":
            passages = (problem["statement"],)
        else:
            passages = problem["choice"]["options"] if problem["choice"] else ()
        # Use link labels, not destinations, when matching visible Markdown.
        return tuple(re.sub(r"!?\[([^\]\n]*)\]\([^\n)]*\)", r"\1", value) for value in passages)
    if field == "title":
        return (problem.get("title") or problem["id"].replace("-", " "),)
    if field == "topic":
        return (problem["topic"],) if problem.get("topic") else ()
    if field == "figure":
        return tuple(a["alt"] for a in problem["assets"] if a["role"] == "prompt") + (
            (problem["visual"]["caption"],) if problem["visual"] else ())
    return ()


def selection_context(pack, problem, data):
    if problem is not None and (problem["status"] != "checked" or problem.get("explain_selection") is not True):
        raise PermissionError("This problem’s pack does not allow help for new selections.")
    if set(data) != {"text", "field"} or not isinstance(data["field"], str):
        raise ValueError("Select text from a study passage.")
    raw = data["text"]
    if (not isinstance(raw, str) or not raw.strip() or len(raw) > SELECTION_LIMIT
            or any(unicodedata.category(c) in {"Cc", "Cs"} and c not in "\t\n\r" for c in raw)):
        raise ValueError(f"Select 1–{SELECTION_LIMIT} characters from a study passage.")
    selected = " ".join(raw.split())
    field = data["field"]
    sources = overview_text(pack, field) if problem is None else problem_text(problem, field)
    visible = flat(selected)
    key = reading_key(selected)
    # The loose match accounts for Markdown delimiters. Plain text and symbol-only selections stay literal.
    markdown_field = problem is not None and field in ("prompt", "option")
    source = next((item for item in sources
                   if visible in flat(item) or (markdown_field and key and key in reading_key(item))), None)
    if source is None:
        raise ValueError("Select one passage from the released material.")
    subject = {"selection": selected, "language": pack["language"]}
    if problem is None and len(source) <= 600 and visible != flat(source):
        subject["context"] = source
    return subject
