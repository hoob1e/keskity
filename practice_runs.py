"""Deadline-bound practice test attempts. All writes stay in the local database."""
import json
import time
import uuid

from practice_specs import can_model_mark, test_summary, validate_aids
from store import encode

SCHEMA = """
CREATE TABLE IF NOT EXISTS test_attempts(
    id TEXT PRIMARY KEY, pack_key TEXT NOT NULL REFERENCES packs(key),
    started_ms INTEGER NOT NULL, deadline_ms INTEGER NOT NULL, aids TEXT NOT NULL,
    ended_ms INTEGER, reason TEXT CHECK(reason IN ('submitted','expired'))
);
CREATE INDEX IF NOT EXISTS test_attempts_by_pack ON test_attempts(pack_key, started_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS active_test_by_pack ON test_attempts(pack_key) WHERE ended_ms IS NULL;
CREATE TABLE IF NOT EXISTS test_answers(
    attempt_id TEXT NOT NULL REFERENCES test_attempts(id), question TEXT NOT NULL,
    value TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(attempt_id, question)
);
CREATE TABLE IF NOT EXISTS test_marks(
    attempt_id TEXT NOT NULL REFERENCES test_attempts(id), question TEXT NOT NULL,
    points INTEGER NOT NULL, method TEXT NOT NULL CHECK(method IN ('self','local-model')),
    feedback TEXT, model TEXT, PRIMARY KEY(attempt_id, question)
);
CREATE TABLE IF NOT EXISTS test_hint_opens(
    attempt_id TEXT NOT NULL REFERENCES test_attempts(id), question TEXT NOT NULL, ordinal INTEGER NOT NULL,
    PRIMARY KEY(attempt_id, question, ordinal)
);
"""
SUBMITTED = {"status": "submitted"}


class TestConflict(ValueError):
    pass


def now_ms():
    return time.time_ns() // 1_000_000


def attempt_view(row):
    return {**{k: row[k] for k in ("id", "started_ms", "deadline_ms", "ended_ms", "reason")},
            "aids": json.loads(row["aids"])}


def test_questions(pack):
    by_id = {p["id"]: p for p in pack["problems"]}
    return [{**by_id[q["id"]], "points": q["points"]} for q in pack["test"]["questions"]]


def safe_hints(question):
    return [h["text"] for h in question["hints"] if not h["reveals_target"]]


def answered(value):
    return bool(value.strip()) if isinstance(value, str) else value is not None


def prompt(question, aids=()):
    p = question
    return {
        "id": p["id"], "points": p["points"], "title": p.get("title"), "topic": p.get("topic"),
        "statement": p["statement"], "assets": [a for a in p["assets"] if a["role"] == "prompt"],
        "visual": {**p["visual"], "slider": p["visual"]["slider"] and "interactive_visuals" in aids} if p["visual"] else None,
        "options": p["choice"]["options"] if p["choice"] else None,
    }


def mark_for(question, value, stored):
    if not answered(value):
        return {"method": "unanswered", "points": 0}
    if question["choice"]:
        return {"method": "answer-key", "points": question["points"] if value == question["choice"]["correct_index"] else 0}
    return stored or {"method": "pending", "points": None}


def score_for(pack, rows):
    marks = [row["mark"] for row in rows]
    earned = sum(m["points"] or 0 for m in marks)
    total = sum(q["points"] for q in rows)
    pending = sum(m["points"] is None for m in marks)
    grade = next((r["label"] for r in pack["test"].get("grade_scale", []) if earned >= r["minimum_points"]), None)
    return {
        "points": earned, "total": total, "pending": pending, "grade": None if pending else grade,
        "percent": None if pending else (200 * earned + total) // (2 * total),
        "provisional": any(m["method"] == "local-model" for m in marks),
    }


class PracticeRuns:
    def __init__(self, store, clock=now_ms):
        self.store, self.clock = store, clock
        with self.store.connect() as db:
            db.executescript(SCHEMA)

    def pack(self, key):
        pack = self.store.pack(key)
        if "test" not in pack:
            raise LookupError("This edition is not a practice test.")
        return pack

    @staticmethod
    def expire(db, key, now):
        # The deadline is authoritative even if no browser or server was open at zero.
        db.execute("UPDATE test_attempts SET ended_ms=deadline_ms, reason='expired' "
                   "WHERE pack_key=? AND ended_ms IS NULL AND deadline_ms<=?", (key, now))

    def open(self, db, key, attempt_id):
        # Sample the clock under the write lock so saves and submission have one order.
        db.execute("BEGIN IMMEDIATE")
        now = self.clock()
        self.expire(db, key, now)
        row = db.execute("SELECT * FROM test_attempts WHERE pack_key=? AND id=?", (key, attempt_id)).fetchone()
        if row is None:
            raise LookupError("Practice test attempt not found in this edition.")
        return row, now

    def setup(self, key):
        pack = self.pack(key)
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.expire(db, key, self.clock())
            rows = db.execute("SELECT * FROM test_attempts WHERE pack_key=? "
                              "ORDER BY ended_ms IS NULL DESC, started_ms DESC, rowid DESC LIMIT 25", (key,)).fetchall()
        return {"test": test_summary(pack), "overview": pack.get("study", {}).get("overview"),
                "attempts": [attempt_view(r) for r in rows]}

    def start(self, key, selection):
        pack = self.pack(key)
        aids = validate_aids(selection, pack["test"]["allowed_aids"])
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            now = self.clock()
            self.expire(db, key, now)
            current = db.execute("SELECT id FROM test_attempts WHERE pack_key=? AND ended_ms IS NULL", (key,)).fetchone()
            if current:
                return {"id": current["id"]}
            attempt_id = str(uuid.uuid4())
            db.execute("INSERT INTO test_attempts(id,pack_key,started_ms,deadline_ms,aids) VALUES(?,?,?,?,?)",
                       (attempt_id, key, now, now + 60000 * pack["test"]["minutes"], encode(aids)))
        return {"id": attempt_id}

    @staticmethod
    def inputs(db, attempt_id):
        return {r["question"]: (json.loads(r["value"]), r["revision"]) for r in db.execute(
            "SELECT question,value,revision FROM test_answers WHERE attempt_id=?", (attempt_id,))}

    @staticmethod
    def marks(db, attempt_id):
        return {r["question"]: {k: r[k] for k in ("points", "method", "feedback", "model") if r[k] is not None}
                for r in db.execute("SELECT * FROM test_marks WHERE attempt_id=?", (attempt_id,))}

    @staticmethod
    def hints(db, attempt_id):
        found = {}
        for row in db.execute("SELECT question,ordinal FROM test_hint_opens WHERE attempt_id=? ORDER BY ordinal", (attempt_id,)):
            found.setdefault(row["question"], []).append(row["ordinal"])
        return found

    def result(self, db, pack, attempt_id):
        inputs, marks, hints = self.inputs(db, attempt_id), self.marks(db, attempt_id), self.hints(db, attempt_id)
        return [{
            **{k: p.get(k) for k in ("id", "title", "points")},
            "answered": answered(inputs.get(p["id"], (None,))[0]),
            "mark": mark_for(p, inputs.get(p["id"], (None,))[0], marks.get(p["id"])),
            "hint_count": len(hints.get(p["id"], [])),
        } for p in test_questions(pack)]

    def state(self, key, attempt_id):
        pack = self.pack(key)
        with self.store.connect() as db:
            row, now = self.open(db, key, attempt_id)
            attempt = attempt_view(row)
            if row["ended_ms"] is not None:
                rows = self.result(db, pack, attempt_id)
                return {**SUBMITTED, "test": test_summary(pack), "attempt": attempt, "questions": rows,
                        "score": score_for(pack, rows)}
            inputs, hints = self.inputs(db, attempt_id), self.hints(db, attempt_id)
            tasks = []
            for p in test_questions(pack):
                value, rev = inputs.get(p["id"], (None, None))
                tasks.append({**prompt(p, attempt["aids"]), "value": value, "revision": rev, "answered": answered(value),
                              "hint_count": len(safe_hints(p)) if "hints" in attempt["aids"] else 0,
                              "hints_opened": hints.get(p["id"], [])})
            return {"status": "active", "test": test_summary(pack), "attempt": attempt,
                    "questions": tasks, "server_ms": now, "language": pack["language"]}

    @staticmethod
    def question(pack, pid):
        for p in test_questions(pack):
            if p["id"] == pid:
                return p
        raise LookupError("Question not found in this practice test.")

    def save(self, key, attempt_id, pid, value, revision):
        pack = self.pack(key)
        task = self.question(pack, pid)
        if task["choice"]:
            if value is not None and (type(value) is not int or not 0 <= value < len(task["choice"]["options"])):
                raise ValueError("Choose a listed answer or clear your choice.")
        elif not isinstance(value, str) or len(value) > 12000:
            raise ValueError("Use at most 12,000 characters for a written answer.")
        with self.store.connect() as db:
            row, _ = self.open(db, key, attempt_id)
            if row["ended_ms"] is not None:
                return SUBMITTED
            existing = db.execute("SELECT revision FROM test_answers WHERE attempt_id=? AND question=?",
                                  (attempt_id, pid)).fetchone()
            if revision != (existing["revision"] if existing else None):
                raise TestConflict("This answer changed in another tab. Reopen the test for the saved copy.")
            rev = str(uuid.uuid4())
            db.execute("INSERT INTO test_answers VALUES(?,?,?,?) ON CONFLICT(attempt_id, question) "
                       "DO UPDATE SET value=excluded.value, revision=excluded.revision", (attempt_id, pid, encode(value), rev))
        return {"status": "active", "revision": rev, "answered": answered(value)}

    def submit(self, key, attempt_id, confirmed_blanks):
        pack = self.pack(key)
        with self.store.connect() as db:
            row, now = self.open(db, key, attempt_id)
            if row["ended_ms"] is None:
                answers = self.inputs(db, attempt_id)
                blanks = [q["id"] for q in pack["test"]["questions"] if not answered(answers.get(q["id"], (None,))[0])]
                if confirmed_blanks != blanks:
                    raise TestConflict("Saved answers changed. Reopen the test and check the blank questions before submitting.")
                db.execute("UPDATE test_attempts SET ended_ms=?, reason='submitted' WHERE id=?",
                           (max(now, row["started_ms"]), attempt_id))
        return SUBMITTED

    def hint(self, key, attempt_id, pid, index):
        pack = self.pack(key)
        q = self.question(pack, pid)
        with self.store.connect() as db:
            row, _ = self.open(db, key, attempt_id)
            if row["ended_ms"] is not None:
                return SUBMITTED
            if "hints" not in json.loads(row["aids"]):
                raise ValueError("Hints are off for this attempt.")
            hints = safe_hints(q)
            if type(index) is not int or not 0 <= index < len(hints):
                raise LookupError("Hint not found.")
            db.execute("INSERT OR IGNORE INTO test_hint_opens VALUES(?,?,?)", (attempt_id, pid, index))
        return {"status": "active", "text": hints[index]}

    @staticmethod
    def require_submitted(row):
        if row["ended_ms"] is None:
            raise TestConflict("Submit the test before reviewing or marking answers.")

    def review(self, key, attempt_id, pid):
        pack = self.pack(key)
        q = self.question(pack, pid)
        with self.store.connect() as db:
            row, _ = self.open(db, key, attempt_id)
            self.require_submitted(row)
            value = self.inputs(db, attempt_id).get(pid, (None,))[0]
            mark = mark_for(q, value, self.marks(db, attempt_id).get(pid))
        return {
            **prompt(q), "language": pack["language"], "value": value, "mark": mark,
            "correct_index": q["choice"]["correct_index"] if q["choice"] else None,
            "solution": q["solution"], "rubric": q["rubric"],
            "support_assets": [a for a in q["assets"] if a["role"] == "support"],
            "can_self_mark": not q["choice"] and answered(value),
            "can_model_mark": mark["method"] == "pending" and can_model_mark(q),
        }

    @staticmethod
    def markable_answer(db, attempt_id, task):
        answer = db.execute("SELECT value FROM test_answers WHERE attempt_id=? AND question=?",
                            (attempt_id, task["id"])).fetchone()
        value = json.loads(answer["value"]) if answer else None
        if task["choice"] or not answered(value):
            raise ValueError("Only answered written questions can be marked with a rubric.")
        return value

    def model_input(self, key, attempt_id, pid):
        pack = self.pack(key)
        q = self.question(pack, pid)
        with self.store.connect() as db:
            row, _ = self.open(db, key, attempt_id)
            self.require_submitted(row)
            value = self.markable_answer(db, attempt_id, q)
            marked = db.execute("SELECT 1 FROM test_marks WHERE attempt_id=? AND question=?", (attempt_id, pid)).fetchone()
            if marked or not can_model_mark(q):
                raise ValueError("Local marking is limited to pending, text-only answers with a reviewed rubric.")
        return q, value, pack["language"]

    def save_mark(self, key, attempt_id, pid, points, model_result=None):
        pack = self.pack(key)
        q = self.question(pack, pid)
        if type(points) is not int or not 0 <= points <= q["points"]:
            raise ValueError(f"Enter whole points from 0 to {q['points']}.")
        with self.store.connect() as db:
            row, _ = self.open(db, key, attempt_id)
            self.require_submitted(row)
            self.markable_answer(db, attempt_id, q)
            # A slow model response must not overwrite a concurrent self-mark.
            if model_result is not None:
                db.execute("INSERT OR IGNORE INTO test_marks VALUES(?,?,?,?,?,?)",
                           (attempt_id, pid, points, "local-model", model_result["feedback"], model_result["model"]))
            else:
                db.execute("INSERT INTO test_marks VALUES(?,?,?,'self',NULL,NULL) "
                           "ON CONFLICT(attempt_id, question) DO UPDATE SET points=excluded.points, "
                           "method='self', feedback=NULL, model=NULL", (attempt_id, pid, points))
            rows = self.result(db, pack, attempt_id)
            return {"score": score_for(pack, rows), "questions": rows}

    def image(self, key, attempt_id, path):
        pack = self.pack(key)
        with self.store.connect() as db:
            row, _ = self.open(db, key, attempt_id)
            permitted = any(a["path"] == path and (a["role"] == "prompt" or row["ended_ms"] is not None)
                            for q in pack["problems"] for a in q["assets"])
        if not permitted:
            raise LookupError("This figure is not available for the attempt.")
        return self.store.asset(key, path, practice_test=True)

    def export(self, key, attempt_id, demo=False):
        pack = self.pack(key)
        with self.store.connect() as db:
            row, _ = self.open(db, key, attempt_id)
            self.require_submitted(row)
            records, hints = self.inputs(db, attempt_id), self.hints(db, attempt_id)
            questions = self.result(db, pack, attempt_id)
        rows = []
        for entry, task in zip(questions, test_questions(pack)):
            pid = task["id"]
            value = records.get(pid, (None,))[0]
            chosen = task["choice"] and value is not None
            rows.append({**entry, "version": task["version"], "digest": task["digest"],
                         "answer": task["choice"]["options"][value] if chosen else value,
                         "choice_index": value if task["choice"] else None, "hints_opened": hints.get(pid, [])})
        return {
            "format": "study-hub-test-attempt", "version": 1, "demo": demo,
            "test": {**test_summary(pack), "id": pack["id"]},
            "attempt": attempt_view(row), "score": score_for(pack, questions),
            "questions": rows,
        }
