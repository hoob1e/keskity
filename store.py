"""Local, single-learner activity. No writes to the imported packet or vault."""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import uuid

SCHEMA = """
CREATE TABLE IF NOT EXISTS packs(
  key TEXT PRIMARY KEY, payload TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets(
  pack_key TEXT REFERENCES packs(key), path TEXT, mime TEXT NOT NULL, body BLOB NOT NULL,
  PRIMARY KEY(pack_key, path)
);
CREATE TABLE IF NOT EXISTS exams(
  id TEXT PRIMARY KEY, course TEXT NOT NULL, title TEXT NOT NULL, day TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exposures(
  pack_key TEXT REFERENCES packs(key), problem_id TEXT, kind TEXT,
  PRIMARY KEY(pack_key, problem_id, kind)
);
CREATE TABLE IF NOT EXISTS drafts(
  pack_key TEXT NOT NULL REFERENCES packs(key), problem_id TEXT NOT NULL,
  revision TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(pack_key, problem_id)
);
CREATE TABLE IF NOT EXISTS hint_opens(
  pack_key TEXT NOT NULL REFERENCES packs(key), problem_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  PRIMARY KEY(pack_key, problem_id, ordinal)
);
CREATE TABLE IF NOT EXISTS attempts(
  id TEXT PRIMARY KEY, pack_key TEXT NOT NULL REFERENCES packs(key), problem_id TEXT NOT NULL,
  problem_version TEXT NOT NULL, problem_digest TEXT NOT NULL,
  submitted_at TEXT NOT NULL, day TEXT NOT NULL, answer TEXT NOT NULL, choice_index INTEGER,
  assistance TEXT NOT NULL, support_used TEXT NOT NULL, feedback TEXT,
  retry_of TEXT REFERENCES attempts(id)
);
CREATE INDEX IF NOT EXISTS attempt_task ON attempts(pack_key, problem_id, submitted_at);
CREATE INDEX IF NOT EXISTS attempt_day ON attempts(day);
"""


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def attempt_row(row):
    out = dict(row)
    out["support_used"] = json.loads(out["support_used"])
    out["feedback"] = json.loads(out["feedback"]) if out["feedback"] else None
    return out


class Store:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "study.db"
        data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(SCHEMA)
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=4)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def install(self, pack, assets):
        with self.connect() as db:
            row = db.execute("INSERT OR IGNORE INTO packs VALUES(?,?,?)", (pack["key"], encode(pack), stamp()))
            if row.rowcount:
                db.executemany("INSERT INTO assets VALUES(?,?,?,?)",
                               [(pack["key"], path, mime, blob) for path, (mime, blob) in assets.items()])
            return bool(row.rowcount)

    def pack(self, key):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM packs WHERE key=?", (key,)).fetchone()
        if row is None:
            raise LookupError("This pack isn’t in the library.")
        return json.loads(row[0])

    def asset(self, key, path):
        with self.connect() as db:
            row = db.execute("SELECT mime, body FROM assets WHERE pack_key=? AND path=?", (key, path)).fetchone()
        if row is None:
            raise LookupError("Image not in this pack.")
        return row

    def save_exam(self, exam_id, title, course, day):
        with self.connect() as db:
            if exam_id is None:
                exam_id = str(uuid.uuid4())
                db.execute("INSERT INTO exams VALUES(?,?,?,?)", (exam_id, course, title, day))
            elif not db.execute("UPDATE exams SET title=?, course=?, day=? WHERE id=?", (title, course, day, exam_id)).rowcount:
                raise LookupError("Exam not found.")
        return exam_id

    def remove_exam(self, exam_id):
        with self.connect() as db:
            db.execute("DELETE FROM exams WHERE id=?", (exam_id,))

    def study(self, *, course=None, key=None):
        """Return a compact problem index without prompts, worked support, or answers."""
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM packs WHERE key=?" if key else
                              "SELECT payload FROM packs ORDER BY imported_at DESC", (key,) if key else ())
            output = []
            for row in rows:
                pack = json.loads(row["payload"])
                if (key and pack["course"]) or (not key and pack["course"] != course):
                    continue
                attempts = {r["problem_id"]: (r["n"], r["latest"]) for r in db.execute(
                    "SELECT problem_id, COUNT(*) n, MAX(submitted_at) latest "
                    "FROM attempts WHERE pack_key=? GROUP BY problem_id", (pack["key"],))}
                problems = []
                for p in pack["problems"]:
                    count, latest = attempts.get(p["id"], (0, None))
                    preview = next(({"path": a["path"]} for a in p["assets"]
                                    if a["role"] == "prompt" and not a["path"].lower().endswith(".gif")), None)
                    if preview is None and p["visual"]:
                        preview = {"line": {k: p["visual"][k] for k in ("slope", "intercept")}}
                    problems.append({
                        **{k: p[k] for k in ("id", "status", "title", "topic") if k in p},
                        "attempts": count, "latest": latest, "preview": preview,
                        "choice": p["choice"] is not None,
                    })
                output.append({
                    **{k: pack[k] for k in ("key", "title", "scope")},
                    "study": pack.get("study", {}),
                    "problems": problems,
                })
        if not output:
            raise LookupError("No study packs found for this area.")
        return output

    def dashboard(self):
        today = date.today()
        first = today - timedelta(days=34)
        with self.connect() as db:
            exams = [dict(r) for r in db.execute("SELECT * FROM exams ORDER BY day,title")]
            packs = []
            by_pack = {}
            for row in db.execute("SELECT pack_key, problem_id, COUNT(*) AS submissions FROM attempts GROUP BY pack_key,problem_id"):
                by_pack.setdefault(row["pack_key"], {})[row["problem_id"]] = row["submissions"]
            for row in db.execute("SELECT * FROM packs ORDER BY imported_at DESC"):
                p = json.loads(row["payload"])
                counts = by_pack.get(p["key"], {})
                checked = [a["id"] for a in p["problems"] if a["status"] == "checked"]
                all_ids = [a["id"] for a in p["problems"]]
                packs.append({
                    **{k:p[k] for k in ("key","id","title","course","scope")},
                    "total": len(checked), "items": len(all_ids), "attempted": sum(pid in counts for pid in checked),
                    "attempted_ids": [pid for pid in all_ids if pid in counts],
                    "submissions": sum(counts.values()), "imported_at": row["imported_at"],
                    "study_title": p.get("study", {}).get("title"),
                    "resume_id": next((pid for pid in all_ids if pid not in counts), all_ids[0]),
                })
            chart = {row["day"]: row["n"] for row in db.execute(
                "SELECT day,COUNT(*) AS n FROM attempts WHERE day BETWEEN ? AND ? GROUP BY day",
                (first.isoformat(), today.isoformat()))}
        return {"today": today.isoformat(), "exams": exams, "packs": packs,
                "activity": [{"day": (first+timedelta(days=i)).isoformat(), "count": chart.get((first+timedelta(days=i)).isoformat(), 0)}
                             for i in range(35)]}

    def reveal(self, key, pid, kind, *, hint_index=None):
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO exposures VALUES(?,?,?)", (key, pid, kind))
            if hint_index is not None:
                db.execute("INSERT OR IGNORE INTO hint_opens VALUES(?,?,?)", (key, pid, hint_index))

    def solver_state(self, key, pid):
        with self.connect() as db:
            draft = db.execute("SELECT revision,body FROM drafts WHERE pack_key=? AND problem_id=?", (key, pid)).fetchone()
            hints = [row[0] for row in db.execute(
                "SELECT ordinal FROM hint_opens WHERE pack_key=? AND problem_id=? ORDER BY ordinal", (key, pid))]
            earlier_hint = db.execute(
                "SELECT 1 FROM exposures WHERE pack_key=? AND problem_id=? AND kind='hint'", (key, pid)).fetchone()
            history = db.execute("SELECT * FROM attempts WHERE pack_key=? AND problem_id=? "
                                 "ORDER BY submitted_at DESC LIMIT 25", (key, pid)).fetchall()
        return {"draft": {**json.loads(draft["body"]), "revision": draft["revision"]} if draft else None,
                "hint_indexes": hints, "earlier_hint": bool(earlier_hint) and not hints,
                "history": [attempt_row(row) for row in history]}

    def save_draft(self, key, pid, body):
        revision = str(uuid.uuid4())
        body = {**body, "updated_at": stamp()}
        with self.connect() as db:
            db.execute("INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(pack_key, problem_id) "
                       "DO UPDATE SET revision=excluded.revision, body=excluded.body",
                       (key, pid, revision, encode(body)))
        return {**body, "revision": revision}

    def discard_draft(self, key, pid, revision):
        with self.connect() as db:
            row = db.execute("DELETE FROM drafts WHERE pack_key=? AND problem_id=? AND revision=?", (key, pid, revision))
            if not row.rowcount:
                raise LookupError("The saved draft changed. Reopen the problem to get the latest copy.")

    def history(self, key, pid):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM attempts WHERE pack_key=? AND problem_id=? ORDER BY submitted_at DESC LIMIT 25",
                              (key, pid)).fetchall()
        return [attempt_row(r) for r in rows]

    def attempt(self, aid):
        with self.connect() as db:
            row = db.execute("SELECT * FROM attempts WHERE id=?", (aid,)).fetchone()
        if row is None:
            raise LookupError("Attempt not found.")
        return attempt_row(row)

    def save_attempt(self, key, problem, answer, choice_index, reported, feedback, draft_revision=None):
        pid = problem["id"]
        aid = str(uuid.uuid4())
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            used = {r["kind"] for r in db.execute("SELECT kind FROM exposures WHERE pack_key=? AND problem_id=?", (key, pid))}
            prev = db.execute("SELECT id, feedback FROM attempts WHERE pack_key=? AND problem_id=? ORDER BY submitted_at DESC LIMIT 1",
                              (key, pid)).fetchone()
            if prev and (prev["feedback"] or db.execute(
                "SELECT 1 FROM attempts WHERE pack_key=? AND problem_id=? AND feedback IS NOT NULL LIMIT 1", (key, pid)).fetchone()):
                used.add("answer-check")
            if reported == "hint":
                used.add("hint")
            if reported == "solution":
                used.add("solution")
            if "solution" in used:
                assistance = "worked-explanation"
            elif "hint" in used:
                assistance = "hinted"
            elif used:
                assistance = "prompted"
            else:
                assistance = "independent" if reported == "no-help" else "unknown"
            db.execute("INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (aid, key, pid, problem["version"], problem["digest"], stamp(),
                        date.today().isoformat(), answer, choice_index, assistance,
                        encode(sorted(used)), encode(feedback) if feedback else None, prev["id"] if prev else None))
            if draft_revision:
                db.execute("DELETE FROM drafts WHERE pack_key=? AND problem_id=? AND revision=?", (key, pid, draft_revision))
        return self.attempt(aid)

    def save_feedback(self, aid, feedback):
        with self.connect() as db:
            db.execute("UPDATE attempts SET feedback=? WHERE id=? AND feedback IS NULL", (encode(feedback), aid))
        return self.attempt(aid)

    def forget_attempt(self, aid):
        with self.connect() as db:
            row = db.execute("SELECT pack_key, problem_id, feedback FROM attempts WHERE id=?", (aid,)).fetchone()
            if row and row["feedback"]:
                db.execute("INSERT OR IGNORE INTO exposures VALUES(?,?,?)",
                           (row["pack_key"], row["problem_id"], "answer-check"))
            db.execute("UPDATE attempts SET retry_of=NULL WHERE retry_of=?", (aid,))
            db.execute("DELETE FROM attempts WHERE id=?", (aid,))

    def selected_export(self, ids, demo):
        attempts = []
        for aid in dict.fromkeys(ids):
            a = self.attempt(aid)
            p = self.pack(a["pack_key"])
            task = next(t for t in p["problems"] if t["id"] == a["problem_id"])
            attempts.append({
                **a, "pack_id": p["id"], "pack_title": p["title"], "course": p["course"],
                "statement": task["statement"], "source_ids": task["source_ids"],
                "evidence_kind": "submitted response", "help_provenance": "in-app reveals and learner report",
            })
        return {"format": "study-hub-attempts-v1", "exported_at": stamp(), "demo": demo,
                "note": "Use only as selected practice evidence. Local feedback is provisional, not a grade or a mastery judgment.",
                "attempts": attempts}
