#!/usr/bin/env python3
"""Study Hub: local dashboard, released pack import, and private practice history."""
import argparse
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import IPv4Address
import json
import os
from pathlib import Path
import re
import signal
import sys
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, unquote, urlsplit

import demo
from grading import Grader
from inline_help import entry_content, followup_context
from local_model import MODEL_STREAM, ModelError, ModelStreamClosed
from packs import KEY, adapt, asset_path, line, public_pack, upload_from_path, validator
from practice_runs import PracticeRuns, TestConflict
from store import Store, encode
from study_followup import reply_to_note
from study_model_tools import TARGET_LANGUAGES, selection_reply
from study_passages import selection_context

SELECTION_FIELDS = {
    "explain-selection": {"question"},
    "define-selection": set(),
    "translate-selection": {"target"},
}

ROOT = Path(__file__).resolve().parent
MODULES = ROOT / "node_modules"
STATIC = {
    "/": (ROOT / "web/index.html", "text/html; charset=utf-8"),
    "/app.js": (ROOT / "web/app.js", "text/javascript; charset=utf-8"),
    "/model-stream.js": (ROOT / "web/model-stream.js", "text/javascript; charset=utf-8"),
    "/practice-test.js": (ROOT / "web/practice-test.js", "text/javascript; charset=utf-8"),
    "/test-result.js": (ROOT / "web/test-result.js", "text/javascript; charset=utf-8"),
    "/study-followup.js": (ROOT / "web/study-followup.js", "text/javascript; charset=utf-8"),
    "/study-selection.js": (ROOT / "web/study-selection.js", "text/javascript; charset=utf-8"),
    "/study-explain.js": (ROOT / "web/study-explain.js", "text/javascript; charset=utf-8"),
    "/study-help-menu.js": (ROOT / "web/study-help-menu.js", "text/javascript; charset=utf-8"),
    "/inline-help.js": (ROOT / "web/inline-help.js", "text/javascript; charset=utf-8"),
    "/solver.js": (ROOT / "web/solver.js", "text/javascript; charset=utf-8"),
    "/answer-editor.js": (ROOT / "web/answer-editor.js", "text/javascript; charset=utf-8"),
    "/attempt-history.js": (ROOT / "web/attempt-history.js", "text/javascript; charset=utf-8"),
    "/workspace.js": (ROOT / "web/workspace.js", "text/javascript; charset=utf-8"),
    "/study-tips.js": (ROOT / "web/study-tips.js", "text/javascript; charset=utf-8"),
    "/study.js": (ROOT / "web/study.js", "text/javascript; charset=utf-8"),
    "/problem-cards.js": (ROOT / "web/problem-cards.js", "text/javascript; charset=utf-8"),
    "/dashboard.js": (ROOT / "web/dashboard.js", "text/javascript; charset=utf-8"),
    "/theme.css": (ROOT / "web/theme.css", "text/css; charset=utf-8"),
    "/model-stream.css": (ROOT / "web/model-stream.css", "text/css; charset=utf-8"),
    "/practice-test.css": (ROOT / "web/practice-test.css", "text/css; charset=utf-8"),
    "/inline-help.css": (ROOT / "web/inline-help.css", "text/css; charset=utf-8"),
    "/study-help-menu.css": (ROOT / "web/study-help-menu.css", "text/css; charset=utf-8"),
    "/solver.css": (ROOT / "web/solver.css", "text/css; charset=utf-8"),
    "/typography.css": (ROOT / "web/typography.css", "text/css; charset=utf-8"),
    "/study.css": (ROOT / "web/study.css", "text/css; charset=utf-8"),
    "/workspace.css": (ROOT / "web/workspace.css", "text/css; charset=utf-8"),
    "/dashboard.css": (ROOT / "web/dashboard.css", "text/css; charset=utf-8"),
    "/motion.css": (ROOT / "web/motion.css", "text/css; charset=utf-8"),
    "/resume-waves.svg": (ROOT / "web/resume-waves.svg", "image/svg+xml"),
    "/appearance.css": (ROOT / "web/appearance.css", "text/css; charset=utf-8"),
    "/appearance.js": (ROOT / "web/appearance.js", "text/javascript; charset=utf-8"),
    "/local-fonts.js": (ROOT / "web/local-fonts.js", "text/javascript; charset=utf-8"),
    "/lib/markdown-it.js": (MODULES / "markdown-it/dist/markdown-it.min.js", "text/javascript; charset=utf-8"),
    "/lib/katex.js": (MODULES / "katex/dist/katex.min.js", "text/javascript; charset=utf-8"),
    "/lib/katex-auto.js": (MODULES / "katex/dist/contrib/auto-render.min.js", "text/javascript; charset=utf-8"),
    "/lib/katex.css": (MODULES / "katex/dist/katex.min.css", "text/css; charset=utf-8"),
}
APP_CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
           "font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; "
           "form-action 'self'; frame-ancestors 'none'; object-src 'none'")
IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'"
MAX_BODY = 18 * 1024 * 1024
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")


class HubHTTP(ThreadingHTTPServer):
    daemon_threads = True


def uuid_text(value):
    if not isinstance(value, str) or not UUID.fullmatch(value):
        raise ValueError("Invalid record ID.")
    return value


def get_task(store, key, pid):
    if not KEY.fullmatch(key):
        raise LookupError("Invalid pack ID.")
    pack = store.pack(key)
    if "test" in pack:
        raise LookupError("Open this edition under Practice tests.")
    task = next((t for t in pack["problems"] if t["id"] == pid), None)
    if task is None:
        raise LookupError("Problem not found in this edition.")
    return pack, task


def response_input(task, data, *, draft=False):
    reported = data.get("help", "unknown")
    if reported not in ("unknown", "no-help", "hint", "solution"):
        raise ValueError("Unsupported help status.")
    if task["choice"]:
        index = data.get("choice")
        if type(index) is not int or not 0 <= index < len(task["choice"]["options"]):
            raise ValueError("Choose an answer.")
        return {"choice": index, "help": reported}
    answer = data.get("answer")
    clean = line(answer, "Answer", 12000)
    if draft and len(answer) > 12000:
        raise ValueError("A draft can contain at most 12,000 characters.")
    return {"answer": answer if draft else clean, "help": reported}


class Handler(BaseHTTPRequestHandler):
    server_version = "StudyHub"
    sys_version = ""
    model_stream_started = False

    def setup(self):
        super().setup()
        self.connection.settimeout(50)

    def log_message(self, *_args):
        pass  # Do not log URLs, answer bodies, or pack metadata.

    def response_headers(self, mime, status, length=None, image=False):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        if length is None:
            self.send_header("Connection", "close")
            self.close_connection = True
        else:
            self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", IMAGE_CSP if image else APP_CSP)
        self.end_headers()

    def send(self, payload, mime="application/json; charset=utf-8", status=200, image=False):
        self.response_headers(mime, status, len(payload), image)
        self.wfile.write(payload)

    def respond(self, value, status=200):
        self.send(encode(value).encode("utf-8"), status=status)

    @property
    def model_text(self):
        return self.model_delta if self.headers.get("Accept") == MODEL_STREAM else None

    def model_frame(self, value):
        record = (encode(value) + "\n").encode("utf-8")
        try:
            if not self.model_stream_started:
                self.model_stream_started = True
                self.response_headers(MODEL_STREAM + "; charset=utf-8", 200)
            self.wfile.write(record)
        except OSError as exc:
            raise ModelStreamClosed from exc

    def model_delta(self, field, value):
        self.model_frame({"field": field, "text": value})

    def model_response(self, value):
        if self.model_text is not None:
            return self.model_frame({"result": value})
        return self.respond(value)

    def respond_error(self, message, status):
        try:
            if self.model_stream_started:
                self.model_frame({"error": message})
            else:
                self.respond({"error": message}, status)
        except (ConnectionError, TimeoutError, ModelStreamClosed):
            pass

    def body(self):
        if self.headers.get("Origin") != self.server.origin:
            raise PermissionError("Open the app at its printed local address.")
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Expected a JSON request.")
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= MAX_BODY:
            raise ValueError("The request is empty or exceeds the import limit.")
        data = json.loads(self.rfile.read(size).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Expected a JSON object.")
        return data

    def route(self, method):
        if self.headers.get("Host") != self.server.origin.removeprefix("http://"):
            raise PermissionError("Use the address printed by the app.")
        url = urlsplit(self.path)
        if url.scheme or url.netloc or not url.path.startswith("/"):
            raise LookupError("Page not found.")
        parts = [unquote(p, errors="strict") for p in url.path.strip("/").split("/")]
        if len(parts) > 6 or any("/" in p or "\x00" in p for p in parts):
            raise LookupError("Page not found.")
        db = self.server.store
        if len(parts) >= 3 and parts[:2] == ["api", "test"] and KEY.fullmatch(parts[2]):
            return self.test_route(method, parts, url.query)
        if method == "GET":
            if url.path in STATIC:
                path, mime = STATIC[url.path]
                return self.send(path.read_bytes(), mime=mime)
            if parts[:2] == ["lib", "fonts"] and len(parts) == 3 and re.fullmatch(r"KaTeX_[\w-]+\.(?:woff2?|ttf)", parts[2]):
                font = MODULES / "katex/dist/fonts" / parts[2]
                if font.is_file():
                    return self.send(font.read_bytes(), mime="font/" + font.suffix[1:])
            if parts == ["api", "model-status"]:
                if not self.on_loopback():
                    return self.respond({"state": "off", "host_only": True})
                grader = self.server.grader
                status = {"state": grader.readiness()}
                if grader.port is not None:
                    status["port"] = grader.port
                return self.respond(status)
            if parts == ["api", "home"]:
                configured = self.on_loopback() and self.server.grader.port is not None
                return self.respond({**db.dashboard(), "grader": configured, "demo": self.server.demo,
                                     "followup": configured, "explain_selection": configured,
                                     "study_languages": TARGET_LANGUAGES if configured else {}})
            if parts == ["api", "study", "course"]:
                course = parse_qs(url.query, max_num_fields=1).get("code", [""])[0]
                if course:
                    return self.respond(db.study(course=course))
                raise LookupError("Choose a course.")
            if len(parts) == 4 and parts[:3] == ["api", "study", "independent"] and KEY.fullmatch(parts[3]):
                return self.respond(db.study(key=parts[3]))
            if len(parts) == 3 and parts[:2] == ["api", "pack"] and KEY.fullmatch(parts[2]):
                pack = db.pack(parts[2])
                if "test" in pack:
                    raise LookupError("Open this edition under Practice tests.")
                return self.respond(public_pack(pack))
            if len(parts) == 4 and parts[1] in {"history", "solver"} and parts[0] == "api":
                key, pid = parts[2:]
                get_task(db, key, pid)
                return self.respond(db.history(key, pid) if parts[1] == "history" else db.solver_state(key, pid))
            if len(parts) == 3 and parts[:2] == ["api", "image"] and KEY.fullmatch(parts[2]):
                name = asset_path(parse_qs(url.query, max_num_fields=2).get("path", [""])[0])
                mime, blob = db.asset(parts[2], name)
                return self.send(blob, mime=mime, image=True)
            raise LookupError("Page not found.")

        if parts[:1] != ["api"]:
            raise LookupError("Page not found.")
        data = self.body()
        if parts == ["api", "import"]:
            if self.server.demo:
                raise ValueError("Demo mode does not import personal packs. Use the normal app.")
            pack, assets = adapt(self.server.core, data.get("packet"), data.get("assets"))
            return self.respond({"key": pack["key"], "title": pack["title"], "test": "test" in pack,
                                 "added": db.install(pack, assets)})
        if parts == ["api", "exam"]:
            title = line(data.get("title"), "Exam name", 100)
            course = line(data.get("course"), "Course code", 32).upper()
            raw = data.get("day")
            if not isinstance(raw, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
                raise ValueError("Choose an exam date.")
            day = date.fromisoformat(raw)
            eid = data.get("id")
            return self.respond({"id": db.save_exam(uuid_text(eid) if eid is not None else None, title, course, day.isoformat())})
        if parts == ["api", "exam-remove"]:
            db.remove_exam(uuid_text(data.get("id")))
            return self.respond({"ok": True})
        if parts == ["api", "export"]:
            ids = data.get("ids")
            if not isinstance(ids, list) or not 1 <= len(ids) <= 25:
                raise ValueError("Select up to 25 attempts to export.")
            return self.respond(db.selected_export([uuid_text(i) for i in ids], self.server.demo))
        if parts == ["api", "forget"]:
            db.forget_attempt(uuid_text(data.get("id")))
            return self.respond({"ok": True})
        if parts == ["api", "feedback"]:
            self.require_local_model_host()
            if data.get("id") is None:
                raise ValueError("Submit an answer before requesting feedback.")
            a = db.attempt(uuid_text(data["id"]))
            pack, p = get_task(db, a["pack_key"], a["problem_id"])
            if a["feedback"] is not None:
                return self.model_response(a)
            if p["status"] != "checked" or p["choice"] or p["visual"] or any(x["role"] == "prompt" for x in p["assets"]):
                raise ValueError("Local checking is limited to written, text-only practice with a reviewed key.")
            feedback = self.server.grader.complete(p, a["answer"], pack["language"], on_text=self.model_text)
            return self.model_response(db.save_feedback(a["id"], feedback))
        if len(parts) in (3, 4) and parts[1] in SELECTION_FIELDS:
            return self.selection_route(parts[1], parts[2], parts[3] if len(parts) == 4 else None, data)
        if len(parts) == 4 and parts[1] == "ask-further":
            self.require_local_model_host()
            key, pid = parts[2:]
            pack, task = get_task(db, key, pid)
            subject = followup_context(task, pack["language"], data)
            result = reply_to_note(self.server.grader, subject, on_text=self.model_text)
            if result["reply"] is not None:
                db.reveal(key, pid, "explanation")
            return self.model_response(result)
        if len(parts) == 4 and parts[1] in {"attempt", "reveal", "draft", "draft-discard"}:
            key, pid = parts[2:]
            pack, task = get_task(db, key, pid)
            if parts[1] == "draft":
                return self.respond(db.save_draft(key, pid, response_input(task, data, draft=True)))
            if parts[1] == "draft-discard":
                db.discard_draft(key, pid, uuid_text(data.get("revision")))
                return self.respond({"ok": True})
            if parts[1] == "reveal":
                kind = data.get("kind")
                if kind == "inline-help":
                    content = entry_content(task, data.get("id"), data.get("mode"), pack["language"])
                    db.reveal(key, pid, "explanation")
                    return self.respond(content)
                if kind == "hint":
                    n = data.get("index")
                    if type(n) is not int or not 0 <= n < len(task["hints"]):
                        raise ValueError("Hint not found.")
                    h = task["hints"][n]
                    if h["reveals_target"] and not data.get("allow_reveal"):
                        return self.respond({"confirm": True})
                    db.reveal(key, pid, "solution" if h["reveals_target"] else "hint", hint_index=n)
                    return self.respond({"text": h["text"]})
                if kind == "solution":
                    db.reveal(key, pid, "solution")
                    return self.respond({"solution": task["solution"], "rubric": task["rubric"],
                                         "assets": [a for a in task["assets"] if a["role"] == "support"]})
                raise ValueError("Unsupported reveal.")
            answer = response_input(task, data)
            fb = None
            i = answer.get("choice")
            if i is not None:
                text = task["choice"]["options"][i]
                right = i == task["choice"]["correct_index"]
                fb = {"method": "answer-key", "verdict": "correct" if right else "incorrect",
                      "feedback": "That matches the checked key." if right else "That choice does not match the checked key.",
                      "next_step": "" if right else "Try again or open the reviewed solution when ready."}
            else:
                text = answer["answer"]
            revision = data.get("draft_revision")
            return self.respond(db.save_attempt(
                key, task, text, i, answer["help"], fb, uuid_text(revision) if revision is not None else None), status=201)
        raise LookupError("Page not found.")

    def on_loopback(self):
        return IPv4Address(self.server.server_address[0]).is_loopback

    def require_local_model_host(self):
        if not self.on_loopback():
            raise PermissionError("Open keskity on the host computer to use the local model.")

    def selection_route(self, action, key, pid, data):
        self.require_local_model_host()
        db = self.server.store
        if pid is not None:
            pack, task = get_task(db, key, pid)
        else:
            if not KEY.fullmatch(key):
                raise LookupError("Invalid pack ID.")
            pack, task = db.pack(key), None
            if "test" in pack:
                raise LookupError("Study help is not available in practice tests.")
        if data.keys() - {"field", "text"} - SELECTION_FIELDS[action]:
            raise ValueError("Use only the selected passage and this action’s options.")
        subject = selection_context(pack, task, {k: data[k] for k in ("field", "text") if k in data})
        result = selection_reply(self.server.grader, subject, action, data, practice=task is not None,
                                 on_text=self.model_text)
        if task is not None and result["reply"] is not None:
            db.reveal(key, pid, "explanation")
        return self.model_response(result)

    def test_route(self, method, parts, query):
        runs = self.server.tests
        key = parts[2]
        if len(parts) == 3:
            if method == "GET":
                return self.respond(runs.setup(key))
            return self.respond(runs.start(key, self.body().get("aids", [])))
        attempt_id = uuid_text(parts[3])
        action = parts[4] if len(parts) == 5 else ""
        if method == "GET":
            if len(parts) == 4:
                return self.respond(runs.state(key, attempt_id))
            if action == "review":
                pid = parse_qs(query, max_num_fields=1).get("question", [""])[0]
                return self.respond(runs.review(key, attempt_id, pid))
            if action == "image":
                path = asset_path(parse_qs(query, max_num_fields=1).get("path", [""])[0])
                mime, blob = runs.image(key, attempt_id, path)
                return self.send(blob, mime=mime, image=True)
            raise LookupError("Page not found.")
        data = self.body()
        if action == "submit":
            return self.respond(runs.submit(key, attempt_id, data.get("blanks")))
        if action == "export":
            return self.respond(runs.export(key, attempt_id, self.server.demo))
        pid = data.get("question")
        if not isinstance(pid, str):
            raise ValueError("Choose a test question.")
        if action == "answer":
            revision = data.get("revision")
            return self.respond(runs.save(key, attempt_id, pid, data.get("value"),
                                          uuid_text(revision) if revision is not None else None))
        if action == "hint":
            return self.respond(runs.hint(key, attempt_id, pid, data.get("index")))
        if action == "self-mark":
            return self.respond(runs.save_mark(key, attempt_id, pid, data.get("points")))
        if action == "model-mark":
            self.require_local_model_host()
            question, value, language = runs.model_input(key, attempt_id, pid)
            model_result = self.server.grader.mark_test(question, value, language, on_text=self.model_text)
            if model_result["points"] is None:
                return self.model_response({"uncertain": model_result["feedback"]})
            return self.model_response(runs.save_mark(key, attempt_id, pid, model_result["points"], model_result))
        raise LookupError("Page not found.")

    def dispatch(self, method):
        try:
            self.route(method)
        except PermissionError as exc:
            self.respond_error(str(exc), 403)
        except LookupError as exc:
            self.respond_error(str(exc), 404)
        except TestConflict as exc:
            self.respond_error(str(exc), 409)
        except ModelError as exc:
            self.respond_error(str(exc), 503)
        except (ValueError, UnicodeError, RecursionError) as exc:
            self.respond_error(str(exc)[:700], 400)
        except (ConnectionError, TimeoutError, ModelStreamClosed):
            return
        except Exception as exc:
            print(f"Study Hub internal error: {type(exc).__name__}", file=sys.stderr)
            self.respond_error("The app could not finish this action. Check the terminal.", 500)

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")


def serve(args, core, directory):
    missing = [str(p.relative_to(ROOT)) for p, _mime in STATIC.values() if not p.is_file()]
    if missing:
        raise ValueError("Missing app files: " + ", ".join(missing) + ". Run npm ci in the project.")
    db = Store(directory)
    if args.demo:
        pack, assets = adapt(core, demo.help_fixture(core), {})
        db.install(pack, assets)
        pack, assets = adapt(core, demo.test_fixture(core), {})
        db.install(pack, assets)
        db.save_exam(None, "Functions practice", "DEMO", (date.today() + timedelta(days=6)).isoformat())
    host = str(args.lan_ip) if args.lan_ip else "127.0.0.1"
    with HubHTTP((host, args.port), Handler) as server:
        server.origin = f"http://{host}:{server.server_port}"
        server.store, server.core, server.demo = db, core, args.demo
        server.tests = PracticeRuns(db)
        server.grader = Grader(args.grader_port, args.grader_model)
        print(f"Study Hub{' demo (temporary)' if args.demo else ''}: {server.origin}", flush=True)
        print(f"Local feedback: {'127.0.0.1:' + str(args.grader_port) if args.grader_port else 'off'}", flush=True)
        print(f"Private state: {directory}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def port(value):
    result = int(value)
    if not 0 <= result <= 65535:
        raise argparse.ArgumentTypeError("Use a port from 0–65535.")
    return result


def main():
    os.umask(0o077)
    default_data = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "study-hub"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=default_data)
    parser.add_argument("--validator", type=Path, help="Path to your trusted installed problem-set validator.")
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("serve", help="open the local dashboard")
    s.add_argument("--port", type=port, default=8765)
    s.add_argument("--grader-port", type=port, help="opt in to advisory feedback via a running llama-server")
    s.add_argument("--grader-model", default="study-grader")
    s.add_argument("--demo", action="store_true", help="fictional pack and temporary state; does not touch normal data")
    s.add_argument("--lan-ip", type=IPv4Address, help="bind the demo to this PC's LAN IPv4 address")
    sub.add_parser("check", help="check pack compatibility without saving").add_argument("pack", type=Path)
    sub.add_parser("import", help="import a selected published pack").add_argument("pack", type=Path)
    args = parser.parse_args()
    if args.command == "serve":
        if args.lan_ip is not None:
            if not args.demo:
                s.error("--lan-ip requires --demo.")
            if (args.lan_ip.is_unspecified or args.lan_ip.is_multicast
                    or args.lan_ip == IPv4Address("255.255.255.255")):
                s.error("--lan-ip requires a specific unicast IPv4 address on this PC.")

        def finish(_signum, _frame):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, finish)
    try:
        core = validator(args.validator.expanduser()) if args.validator else validator()
        if args.command != "serve":
            pack, assets = adapt(core, *upload_from_path(args.pack))
            if args.command == "import":
                Store(args.data_dir.expanduser()).install(pack, assets)
            print(encode({"valid": True, "id": pack["id"], "key": pack["key"],
                          "items": len(pack["problems"]), "saved": args.command == "import"}))
        elif args.demo:
            with TemporaryDirectory(prefix="study-hub-demo-") as temp:
                serve(args, core, Path(temp))
        else:
            serve(args, core, args.data_dir.expanduser())
    except (ValueError, OSError, KeyError, TypeError, AttributeError, RecursionError) as exc:
        parser.exit(1, f"Study Hub: {exc}\n")


if __name__ == "__main__":
    main()
