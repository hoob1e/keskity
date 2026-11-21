#!/usr/bin/env python3
"""Study Hub: local dashboard, released pack import, and private practice history."""
import argparse
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import signal
import sys
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, unquote, urlsplit

import demo
from grading import GradeError, Grader
from packs import KEY, adapt, asset_path, line, public_pack, upload_from_path, validator
from store import Store, encode

ROOT = Path(__file__).resolve().parent
MODULES = ROOT / "node_modules"
STATIC = {
    "/": (ROOT / "web/index.html", "text/html; charset=utf-8"),
    "/app.js": (ROOT / "web/app.js", "text/javascript; charset=utf-8"),
    "/theme.css": (ROOT / "web/theme.css", "text/css; charset=utf-8"),
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
    task = next((t for t in pack["problems"] if t["id"] == pid), None)
    if task is None:
        raise LookupError("Problem not found in this edition.")
    return pack, task


class Handler(BaseHTTPRequestHandler):
    server_version = "StudyHub"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(50)

    def log_message(self, *_args):
        pass  # Do not log URLs, answer bodies, or pack metadata.

    def send(self, payload, mime="application/json; charset=utf-8", status=200, image=False):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", IMAGE_CSP if image else APP_CSP)
        self.end_headers()
        self.wfile.write(payload)

    def respond(self, value, status=200):
        self.send(encode(value).encode("utf-8"), status=status)

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
            raise PermissionError("Use the printed 127.0.0.1 address.")
        url = urlsplit(self.path)
        if url.scheme or url.netloc or not url.path.startswith("/"):
            raise LookupError("Page not found.")
        parts = [unquote(p, errors="strict") for p in url.path.strip("/").split("/")]
        if len(parts) > 6 or any("/" in p or "\x00" in p for p in parts):
            raise LookupError("Page not found.")
        db = self.server.store
        if method == "GET":
            if url.path in STATIC:
                path, mime = STATIC[url.path]
                return self.send(path.read_bytes(), mime=mime)
            if parts[:2] == ["lib", "fonts"] and len(parts) == 3 and re.fullmatch(r"KaTeX_[\w-]+\.(?:woff2?|ttf)", parts[2]):
                font = MODULES / "katex/dist/fonts" / parts[2]
                if font.is_file():
                    return self.send(font.read_bytes(), mime="font/" + font.suffix[1:])
            if parts == ["api", "home"]:
                return self.respond({**db.dashboard(), "grader": self.server.grader.port is not None, "demo": self.server.demo})
            if len(parts) == 3 and parts[:2] == ["api", "pack"] and KEY.fullmatch(parts[2]):
                pack = public_pack(db.pack(parts[2]))
                return self.respond(pack)
            if len(parts) == 4 and parts[:2] == ["api", "history"]:
                get_task(db, parts[2], parts[3])
                return self.respond(db.history(parts[2], parts[3]))
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
            return self.respond({"key": pack["key"], "title": pack["title"], "added": db.install(pack, assets)})
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
            if data.get("id") is None:
                raise ValueError("Submit an answer before requesting feedback.")
            a = db.attempt(uuid_text(data["id"]))
            pack, p = get_task(db, a["pack_key"], a["problem_id"])
            if a["feedback"] is not None:
                return self.respond(a)
            if p["status"] != "checked" or p["choice"] or p["visual"] or any(x["role"] == "prompt" for x in p["assets"]):
                raise ValueError("Local checking is limited to written, text-only practice with a reviewed key.")
            feedback = self.server.grader.complete(p, a["answer"], pack["language"])
            return self.respond(db.save_feedback(a["id"], feedback))
        if len(parts) == 4 and parts[1] in {"attempt", "reveal"}:
            key, pid = parts[2:]
            _, task = get_task(db, key, pid)
            if parts[1] == "reveal":
                kind = data.get("kind")
                if kind == "hint":
                    n = data.get("index")
                    if type(n) is not int or not 0 <= n < len(task["hints"]):
                        raise ValueError("Hint not found.")
                    h = task["hints"][n]
                    if h["reveals_target"] and not data.get("allow_reveal"):
                        return self.respond({"confirm": True})
                    db.reveal(key, pid, "solution" if h["reveals_target"] else "hint")
                    return self.respond({"text": h["text"]})
                if kind == "solution":
                    db.reveal(key, pid, "solution")
                    return self.respond({"solution": task["solution"], "rubric": task["rubric"],
                                         "assets": [a for a in task["assets"] if a["role"] == "support"]})
                raise ValueError("Unsupported reveal.")
            reported = data.get("help", "unknown")
            if reported not in ("unknown", "no-help", "hint", "solution"):
                raise ValueError("Unsupported help status.")
            fb = None
            i = None
            if task["choice"]:
                i = data.get("choice")
                options = task["choice"]["options"]
                if type(i) is not int or not 0 <= i < len(options):
                    raise ValueError("Choose an answer.")
                text = options[i]
                right = i == task["choice"]["correct_index"]
                fb = {"method": "answer-key", "verdict": "correct" if right else "incorrect",
                      "feedback": "That matches the checked key." if right else "That choice does not match the checked key.",
                      "next_step": "" if right else "Try again or open the reviewed solution when ready."}
            else:
                text = line(data.get("answer"), "Answer", 12000)
            return self.respond(db.save_attempt(key, task, text, i, reported, fb), status=201)
        raise LookupError("Page not found.")

    def dispatch(self, method):
        try:
            self.route(method)
        except PermissionError as exc:
            self.respond({"error": str(exc)}, 403)
        except LookupError as exc:
            self.respond({"error": str(exc)}, 404)
        except GradeError as exc:
            self.respond({"error": str(exc)}, 503)
        except (ValueError, UnicodeError, RecursionError) as exc:
            self.respond({"error": str(exc)[:700]}, 400)
        except (ConnectionError, TimeoutError):
            return
        except Exception as exc:
            print(f"Study Hub internal error: {type(exc).__name__}", file=sys.stderr)
            self.respond({"error": "The app could not finish this action. Check the terminal."}, 500)

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
        pack, assets = adapt(core, demo.fixture(core), {})
        db.install(pack, assets)
        db.save_exam(None, "Functions practice", "DEMO", (date.today() + timedelta(days=6)).isoformat())
    with HubHTTP(("127.0.0.1", args.port), Handler) as server:
        server.origin = f"http://127.0.0.1:{server.server_port}"
        server.store, server.core, server.demo = db, core, args.demo
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
    sub.add_parser("check", help="check pack compatibility without saving").add_argument("pack", type=Path)
    sub.add_parser("import", help="import a selected published pack").add_argument("pack", type=Path)
    args = parser.parse_args()
    if args.command == "serve":
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
