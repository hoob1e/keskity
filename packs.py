"""Adapt a released Life problem packet without changing it."""
import base64
import hashlib
import math
import re
import runpy
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from xml.etree import ElementTree as ET

DEFAULT_VALIDATOR = Path.home() / ".agents/skills/problem-sets/scripts/problem_sets.py"
MAX_PACKET = 2 * 1024 * 1024
MAX_ASSET = 4 * 1024 * 1024
MAX_ASSETS = 10 * 1024 * 1024
KEY = re.compile(r"[0-9a-f]{64}")
ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def validator(path=DEFAULT_VALIDATOR):
    if not path.is_file():
        raise ValueError(f"Problem-set validator not found: {path}")
    return runpy.run_path(str(path))


def asset_path(value):
    if not isinstance(value, str) or not value.startswith("assets/") or len(value) > 240:
        raise ValueError("Use relative paths inside assets/.")
    parts = value.split("/")
    if any(p in {"", ".", ".."} or re.search(r"[\\:\x00-\x1f\x7f]", p) for p in parts):
        raise ValueError("Invalid asset path.")
    return value


def mime_type(path, data):
    ext = PurePosixPath(path).suffix.lower()
    if ext == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if ext in (".jpg", ".jpeg") and data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if ext == ".webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    if ext in (".gif",) and data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if ext == ".svg":
        try:
            xml = data.decode("utf-8")
            if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", xml, re.I):
                raise ValueError("SVG declarations are not supported.")
            root = ET.fromstring(xml)
            if root.tag != "{http://www.w3.org/2000/svg}svg":
                raise ValueError("Not a standalone SVG.")
            for el in root.iter():
                tag = el.tag.rsplit("}", 1)[-1].lower()
                if tag in {"script", "foreignobject", "a", "animate", "animatetransform", "set"}:
                    raise ValueError("Use a static SVG or a PNG.")
                for attr, value in el.attrib.items():
                    attr = attr.rsplit("}", 1)[-1].lower()
                    if attr.startswith("on") or (attr == "href" and not value.startswith("#")):
                        raise ValueError("SVG images must not contain event handlers or external references.")
            return "image/svg+xml"
        except (UnicodeError, ET.ParseError, ValueError) as exc:
            raise ValueError(f"{path}: {exc}") from exc
    raise ValueError(f"{path}: expected a PNG, JPEG, WebP, GIF, or static SVG.")


def line(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValueError(f"{label} must be text of 1–{limit} characters.")
    return value.strip()


def study_text(value, label, limit):
    """Plain display text, not Markdown, a link, or a prompt."""
    value = " ".join(line(value, label, limit).split())
    if re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError(f"{label} cannot contain control characters.")
    return value


def study_metadata(value):
    if not isinstance(value, dict) or set(value) - {"title", "overview", "uses", "concepts", "fact"}:
        raise ValueError("Study metadata can contain title, overview, uses, concepts, and fact.")
    limits = {"title": 100, "overview": 600, "uses": 400, "fact": 240}
    data = {k: study_text(value[k], f"Study {k}", n) for k, n in limits.items() if k in value}
    if "concepts" in value:
        concepts = value["concepts"]
        if not isinstance(concepts, list) or not 1 <= len(concepts) <= 12:
            raise ValueError("Study concepts must contain 1–12 labels.")
        labels = [study_text(v, "Concept label", 60) for v in concepts]
        if len({label.casefold() for label in labels}) != len(labels):
            raise ValueError("Study concepts must use distinct labels.")
        data["concepts"] = labels
    return data


def study_hub_config(packet):
    """Validate viewer options separately from the released problem contract."""
    spec = packet.get("extensions", {}).get("studyHub")
    if spec is None:
        return {}, {}
    if (not isinstance(spec, dict) or set(spec) - {"version", "items", "study"}
            or type(spec.get("version")) is not int or spec["version"] != 1
            or not isinstance(spec.get("items", {}), dict)):
        raise ValueError("Expected extensions.studyHub version 1.")
    study = study_metadata(spec["study"]) if "study" in spec else {}
    result = {}
    problems = {p["id"]: p for p in packet["problems"]}
    for pid, config in spec.get("items", {}).items():
        if pid not in problems or not isinstance(config, dict) or not config or set(config) - {"visual", "choice", "title", "topic"}:
            raise ValueError(f"Invalid Study Hub options for {pid}.")
        out = {k: study_text(config[k], f"Problem {k}", n)
               for k, n in (("title", 100), ("topic", 60)) if k in config}
        if "visual" in config:
            v = config["visual"]
            if not isinstance(v, dict) or set(v) != {"kind", "caption", "slope", "intercept", "slider"} or v["kind"] != "line" or type(v["slider"]) is not bool:
                raise ValueError(f"{pid}: only the line widget is supported.")
            for key, limit in (("slope", 3), ("intercept", 4)):
                n = v[key]
                if type(n) not in (int, float) or not -limit <= n <= limit or not math.isfinite(n):
                    raise ValueError(f"{pid}: {key} must be between {-limit} and {limit}.")
            out["visual"] = {**v, "caption": line(v["caption"], "Caption", 240)}
        if "choice" in config:
            c = config["choice"]
            if not isinstance(c, dict) or set(c) != {"options", "correct_index"} or not isinstance(c["options"], list) or not 2 <= len(c["options"]) <= 6:
                raise ValueError(f"{pid}: multiple choice needs 2–6 options and a key.")
            options = [line(x, "Option", 500) for x in c["options"]]
            i = c["correct_index"]
            if len(set(options)) != len(options) or type(i) is not int or not 0 <= i < len(options) or problems[pid]["status"] not in {"checked", "retired"}:
                raise ValueError(f"{pid}: multiple choice requires distinct options and a checked key.")
            out["choice"] = {"options": options, "correct_index": i}
        result[pid] = out
    return study, result


def adapt(core, raw, uploaded):
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_PACKET:
        raise ValueError("set.json must be UTF-8 and smaller than 2 MiB.")
    if not isinstance(uploaded, dict) or len(uploaded) > 100:
        raise ValueError("Select one pack with at most 100 referenced images.")
    with TemporaryDirectory(prefix="study-hub-pack-") as temp:
        root = Path(temp)
        path = root / "set.json"
        path.write_text(raw, encoding="utf-8")
        packet = core["load_packet"](path)
        if not isinstance(packet, dict) or not isinstance(packet.get("problems"), list) or len(packet["problems"]) > 160:
            raise ValueError("Select one released problem set with at most 160 problems.")

        needed = set()
        for task in packet["problems"]:
            if not isinstance(task, dict) or not isinstance(task.get("assets"), list):
                raise ValueError("Invalid problem asset list.")
            for a in task["assets"]:
                if not isinstance(a, dict):
                    raise ValueError("Invalid asset declaration.")
                needed.add(asset_path(a.get("path")))
        if set(uploaded) != needed:
            missing = sorted(needed - set(uploaded))
            detail = f" Missing: {', '.join(missing[:3])}." if missing else ""
            raise ValueError("Select the published folder with its declared assets." + detail)

        assets = {}
        size = 0
        for name in sorted(needed):
            encoded = uploaded[name]
            if not isinstance(encoded, str) or len(encoded) > (MAX_ASSET + 2) // 3 * 4:
                raise ValueError(f"{name}: image exceeds 4 MiB.")
            binary = base64.b64decode(encoded, validate=True)
            size += len(binary)
            if len(binary) > MAX_ASSET or size > MAX_ASSETS:
                raise ValueError("Images exceed the pack size limit (4 MiB each, 10 MiB total).")
            mime = mime_type(name, binary)
            dest = root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(binary)
            assets[name] = (mime, binary)

        errors = core["validate"](packet, "release", root)
        if errors:
            raise ValueError("Not a released problem set: " + " · ".join(errors[:3]))
        if packet["plan"]["participation"] != "individual":
            raise ValueError("This hub imports individual practice packets, not group evidence.")
        study, items = study_hub_config(packet)

    problems = []
    for task in packet["problems"]:
        if task["status"] not in ("checked", "experimental"):
            continue
        cfg = items.get(task["id"], {})
        widgets = {k: cfg[k] for k in ("visual", "choice") if k in cfg}
        support = task["support"]
        digest = core["problem_digest"](task)
        problems.append({
            **{k: cfg[k] for k in ("title", "topic") if k in cfg},
            "id": task["id"], "digest": digest,
            "version": core["digest"]([digest, widgets]),
            "statement": task["statement"], "status": task["status"],
            "uncertainty": task.get("uncertainty"), "assets": task["assets"],
            "visual": cfg.get("visual"), "choice": cfg.get("choice"),
            "hints": support["hints"], "solution": support["solution"], "rubric": support["rubric"],
            "source_ids": task["source_ids"],
        })
    # Intentionally do not retain incoming attempts, personal probe evidence, resume, or tutor notes.
    pack = {
        "id": packet["id"], "title": packet["title"], "language": packet["language"],
        "course": packet.get("course", "").strip().upper(),
        "scope": packet["plan"]["scope"],
        "reveal_policy": packet["plan"]["help"]["reveal_policy"],
        "problems": problems,
    }
    if study:
        pack["study"] = study
    pack["key"] = core["digest"](pack)
    return pack, assets


def public_pack(pack):
    data = {k: v for k, v in pack.items() if k != "problems"}
    data["problems"] = [{
        **{k: p[k] for k in ("id", "version", "statement", "status", "uncertainty", "visual", "title", "topic") if k in p},
        "assets": [a for a in p["assets"] if a["role"] == "prompt"],
        "options": p["choice"]["options"] if p["choice"] else [],
        "hint_count": len(p["hints"]),
        "has_solution": bool(p["solution"] or p["rubric"] or any(a["role"] == "support" for a in p["assets"])),
        "can_check": p["status"] == "checked" and not p["choice"] and not (p["visual"] or any(a["role"] == "prompt" for a in p["assets"])),
    } for p in pack["problems"]]
    return data


def upload_from_path(path):
    """Explicit CLI import / compatibility check; never scans for packs."""
    path = path.expanduser().resolve()
    if path.is_dir():
        child = path / "set.json"
        if child.is_symlink():
            raise ValueError("Choose the actual published set.json, not a shortcut.")
        path = child
    if path.name != "set.json" or not path.is_file() or path.stat().st_size > MAX_PACKET:
        raise ValueError("Choose one published set.json or its containing folder.")
    import json
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    names = {asset_path(a["path"]) for p in data.get("problems", []) for a in p.get("assets", [])}
    if len(names) > 100:
        raise ValueError("Too many images.")
    uploads, size = {}, 0
    for name in names:
        file = path.parent / name
        if not file.resolve().is_relative_to(path.parent) or not file.is_file() or file.stat().st_size > MAX_ASSET:
            raise ValueError(f"Image missing, too large, or outside the pack: {name}")
        binary = file.read_bytes()
        size += len(binary)
        if size > MAX_ASSETS:
            raise ValueError("Total image size exceeds 10 MiB.")
        uploads[name] = base64.b64encode(binary).decode("ascii")
    return raw, uploads
