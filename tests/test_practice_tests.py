"""Released test packs, sealed answers, and marking on loopback."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest

import demo
from grading import Grader
from hub import Handler, HubHTTP
from packs import adapt, validator
from practice_runs import PracticeRuns
from store import Store

CORE = validator()
RAW = demo.test_fixture(CORE)
ORDER = ["intercept-check", "find-rate", "moving-slope", "compare-lines"]

LINE = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>'


class TestPacks(unittest.TestCase):
    def test_release_order_and_edition_identity(self):
        pack, assets = adapt(CORE, RAW, {})
        self.assertEqual([q["id"] for q in pack["test"]["questions"]], ORDER)
        self.assertEqual(pack["test"]["minutes"], 25)
        self.assertEqual(assets, {})
        authored = json.loads(RAW)
        authored["extensions"]["studyHub"]["test"]["minutes"] = 40
        update, _ = adapt(CORE, json.dumps(authored), {})
        self.assertNotEqual(pack["key"], update["key"])
        self.assertEqual([p["version"] for p in pack["problems"]], [p["version"] for p in update["problems"]])

    def test_reject_malformed_test_editions(self):
        for name in ("not a spec", "unknown", "no rubric", "boolean", "points", "duplicate",
                     "missing", "bad aid", "duplicate aid", "grade floor", "grade range", "grade overlap", "retired"):
            with self.subTest(name=name):
                raw = json.loads(RAW)
                hub = raw["extensions"]["studyHub"]
                test = hub["test"]
                if name == "not a spec":
                    hub["test"] = None
                elif name == "unknown":
                    test["deadline"] = 10
                elif name == "no rubric":
                    raw["problems"][1]["support"]["rubric"] = "  "
                elif name == "boolean":
                    test["minutes"] = True
                elif name == "points":
                    test["questions"][0]["points"] = -1
                elif name == "duplicate":
                    test["questions"][0]["id"] = test["questions"][1]["id"]
                elif name == "missing":
                    test["questions"].pop()
                elif name == "bad aid":
                    test["allowed_aids"] = ["local_model"]
                elif name == "duplicate aid":
                    test["allowed_aids"] = ["hints", "hints"]
                elif name.startswith("grade"):
                    test["grade_scale"] = [{"minimum_points": 0, "label": "Incomplete"}, {"minimum_points": 10, "label": "Pass"}]
                    if name == "grade floor":
                        test["grade_scale"].pop(0)
                    elif name == "grade range":
                        test["grade_scale"][1]["minimum_points"] = 15
                    else:
                        test["grade_scale"][1]["minimum_points"] = 0
                elif name == "retired":
                    raw["problems"][1]["status"] = "retired"
                with self.assertRaises(ValueError):
                    adapt(CORE, json.dumps(raw), {})


class TestAttempts(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.now = 1800000000000
        self.server = HubHTTP(("127.0.0.1", 0), Handler)
        self.server.origin = "http://127.0.0.1:" + str(self.server.server_port)
        self.server.store = Store(self.directory)
        self.server.tests = PracticeRuns(self.server.store, lambda: self.now)
        self.server.core, self.server.demo, self.server.grader = CORE, False, Grader()
        self.run_http(self.server)

    def run_http(self, server):
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        def close():
            server.shutdown()
            thread.join()
            server.server_close()
        self.addCleanup(close)
        thread.start()

    def request(self, route, body=None, expected=200, *, origin=None, image=False):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            conn.request("GET" if body is None else "POST", route, json.dumps(body) if body is not None else None,
                         {} if body is None else {"Content-Type": "application/json", "Origin": origin or self.server.origin})
            response = conn.getresponse()
            raw = response.read()
            self.assertEqual(response.status, expected, raw)
            self.assertEqual(response.getheader("Cache-Control"), "no-store")
            return raw if image else json.loads(raw)
        finally:
            conn.close()

    def import_test(self, *, raw=RAW, assets=None):
        imported = self.request("/api/import", {"packet": raw, "assets": assets or {}})
        self.assertTrue(imported["test"])
        self.assertTrue(imported["added"])
        self.key = imported["key"]
        self.path = "/api/test/" + self.key
        return self.path

    def start(self, **data):
        attempt = self.request(self.path, data)["id"]
        return self.path + "/" + attempt, attempt

    def save(self, run, question, value, revision=None, **kw):
        return self.request(run + "/answer", dict(question=question, value=value, revision=revision), **kw)

    def test_setup_resume_expiry_and_locked_answers(self):
        path = self.import_test()
        self.assertEqual(self.request("/api/home")["packs"], [])
        self.assertEqual(self.request("/api/home")["tests"][0]["key"], self.key)
        test = self.request(path)["test"]
        self.assertEqual((test["minutes"], test["count"], test["points"]), (25, 4, 14))
        self.assertNotIn("questions", test)
        self.request(path, {"aids": ["model"]}, 400)
        self.request(path, {}, 403, origin="http://example.invalid")

        run, aid = self.start()
        started = self.request(run)
        deadline = started["attempt"]["deadline_ms"]
        self.assertEqual(deadline - self.now, 1500000)
        self.assertEqual(self.start(aids=["hints"])[1], aid)
        self.assertEqual(started["attempt"]["aids"], [])
        self.assertEqual([q["id"] for q in started["questions"]], ORDER)
        serialized = json.dumps(started)
        for secret in ("correct_index", "mark", "rubric", "solution", "support_assets", "inline_help"):
            self.assertNotIn('"' + secret + '"', serialized)
        self.assertFalse(started["questions"][2]["visual"]["slider"])

        for old in ("/api/pack/" + self.key, "/api/solver/" + self.key + "/moving-slope"):
            self.request(old, expected=404)
        for action in ("reveal", "attempt"):
            self.request("/api/" + action + "/" + self.key + "/moving-slope", {}, 404)
        self.request(run + "/hint", {"question": "compare-lines", "index": 0}, 400)
        self.request("/api/reveal/" + self.key + "/moving-slope",
                     {"kind": "inline-help", "id": "slope", "mode": "definition"}, 404)
        self.request("/api/ask-further/" + self.key + "/moving-slope",
                     {"id": "slope", "mode": "definition", "question": "Clarify this term?"}, 404)
        self.request(run + "/review?question=compare-lines", expected=409)
        self.request(run + "/self-mark", {"question": "compare-lines", "points": 1}, 409)
        self.request(run + "/model-mark", {"question": "compare-lines"}, 409)
        self.request(run + "/export", {}, 409)

        rev = self.save(run, "find-rate", 0)["revision"]
        self.save(run, "find-rate", 1, expected=409)
        self.assertFalse(self.save(run, "find-rate", None, rev)["answered"])
        self.assertFalse(self.save(run, "compare-lines", "  \n")["answered"])
        self.save(run, "intercept-check", 2, expected=403, origin="http://example.invalid")
        self.now = deadline - 1
        last = self.save(run, "intercept-check", 2)
        self.assertTrue(last["answered"])

        # Reopen the same workspace without a running browser or timer.
        store = Store(self.directory)
        self.server.store = store
        self.server.tests = PracticeRuns(store, lambda: self.now)
        resumed = self.request(run)
        self.assertEqual(resumed["attempt"]["deadline_ms"], deadline)
        self.assertEqual(resumed["questions"][0]["value"], 2)
        self.now = deadline
        self.assertEqual(self.save(run, "intercept-check", 1, last["revision"]), {"status": "submitted"})
        self.assertEqual(self.request(run + "/submit", {"blanks": []}), {"status": "submitted"})
        result = self.request(run)
        self.assertEqual(result["attempt"]["ended_ms"], deadline)
        self.assertEqual(result["attempt"]["reason"], "expired")
        self.assertEqual(result["score"], {"points": 3, "total": 14, "pending": 0, "grade": None,
                                           "percent": 21, "provisional": False})
        self.assertEqual(self.request(run + "/review?question=intercept-check")["value"], 2)
        self.assertNotEqual(self.start()[1], aid)
        self.assertFalse(any(d["count"] for d in self.request("/api/home")["activity"]))

    def test_concurrent_start_only_creates_one_run(self):
        path = self.import_test()
        with ThreadPoolExecutor(max_workers=5) as pool:
            ids = list(pool.map(lambda _: self.request(path, {"aids": []})["id"], range(5)))
        self.assertEqual(len(set(ids)), 1)
        self.assertEqual(len(self.request(path)["attempts"]), 1)

    def test_allowed_aids_and_gated_figures(self):
        authored = json.loads(RAW)
        prompt, support = "assets/prompt.svg", "assets/review.svg"
        authored["problems"][0]["assets"] = [{"path": p, "alt": "Line diagram", "role": role,
                                              "sha256": hashlib.sha256(LINE).hexdigest()}
                                             for p, role in ((prompt, "prompt"), (support, "support"))]
        hints = authored["problems"][0]["support"]["hints"]
        hints.append({"id": "full-answer", "text": "This would reveal the answer.", "reveals_target": True})
        path = self.import_test(raw=json.dumps(authored), assets={p: base64.b64encode(LINE).decode() for p in (prompt, support)})
        run, _ = self.start(aids=["interactive_visuals", "hints"])
        state = self.request(run)
        self.assertEqual(state["attempt"]["aids"], ["hints", "interactive_visuals"])
        question = state["questions"][2]
        self.assertTrue(question["visual"]["slider"])
        self.assertEqual([a["path"] for a in question["assets"]], [prompt])
        self.assertEqual(question["hint_count"], 1)
        self.assertEqual(self.request(run + "/image?path=" + prompt, image=True), LINE)
        self.request(run + "/image?path=" + support, expected=404)
        self.request("/api/image/" + self.key + "?path=" + support, expected=404)
        for _ in range(2):
            data = self.request(run + "/hint", {"question": "moving-slope", "index": 0})
            self.assertIn("substituting", data["text"])
        self.request(run + "/hint", {"question": "moving-slope", "index": 1}, 404)
        self.request(run + "/submit", {"blanks": ORDER})
        self.assertEqual(self.request(run + "/image?path=" + support, image=True), LINE)
        review = self.request(run + "/review?question=moving-slope")
        self.assertEqual([a["path"] for a in review["support_assets"]], [support])
        exported = self.request(run + "/export", {})
        self.assertEqual(exported["questions"][2]["hints_opened"], [0])
        self.assertEqual(exported["attempt"]["aids"], ["hints", "interactive_visuals"])
        self.assertEqual(len(self.request(path)["attempts"]), 1)

    def test_blanks_pending_self_mark_and_optional_scale(self):
        authored = json.loads(RAW)
        authored["extensions"]["studyHub"]["test"]["grade_scale"] = [
            {"minimum_points": 0, "label": "Developing"}, {"minimum_points": 9, "label": "Ready"},
        ]
        self.import_test(raw=json.dumps(authored))
        run, aid = self.start()
        self.save(run, "intercept-check", 2)
        self.save(run, "find-rate", 0)
        self.save(run, "moving-slope", "(0,2) because substituting x=0 removes mx.")
        self.save(run, "compare-lines", "    ")
        self.request(run + "/submit", {"blanks": []}, 409)
        self.assertEqual(self.request(run)["status"], "active")
        self.now += 9000
        self.request(run + "/submit", {"blanks": ["compare-lines"]})
        state = self.request(run)
        self.assertEqual(state["attempt"]["reason"], "submitted")
        self.assertEqual(state["score"], {"total": 14, "points": 5, "pending": 1, "percent": None,
                                          "grade": None, "provisional": False})
        self.assertEqual(state["questions"][2]["mark"], {"method": "pending", "points": None})
        self.assertEqual(state["questions"][3]["mark"], {"method": "unanswered", "points": 0})
        for id_, points in (("find-rate", 1), ("compare-lines", 3), ("moving-slope", 6), ("moving-slope", True)):
            self.request(run + "/self-mark", {"question": id_, "points": points}, 400)
        self.request(run + "/model-mark", {"question": "moving-slope"}, 400)
        score = self.request(run + "/self-mark", {"question": "moving-slope", "points": 4})["score"]
        self.assertEqual((score["points"], score["percent"], score["grade"]), (9, 64, "Ready"))
        exported = self.request(run + "/export", {})
        self.assertEqual(exported["format"], "study-hub-test-attempt")
        self.assertEqual(exported["attempt"]["id"], aid)
        self.assertEqual(exported["questions"][1]["choice_index"], 0)
        self.assertEqual(exported["questions"][1]["answer"], "$-4$")
        self.assertEqual(exported["questions"][2]["mark"], {"method": "self", "points": 4})
        self.assertEqual(exported["questions"][2]["points"], 5)
        self.assertNotIn("rubric", exported["questions"][2])

    def test_model_is_explicit_pending_on_failure_and_replaceable_by_self_mark(self):
        seen = []
        answer = "Equal slopes and distinct intercepts keep the lines parallel."
        responses = [
            {"points": True, "feedback": "Invalid"},
            {"points": 5, "feedback": "Out of range"},
            {"points": None, "feedback": "I cannot judge this."},
            {"points": 4, "feedback": "The answer identifies equal slopes and distinct intercepts."},
        ]
        class Model(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                seen.append((self.path, body))
                returned = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(responses.pop(0))}}]}
                raw = json.dumps(returned).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_args):
                pass

        model = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        self.run_http(model)
        self.import_test()
        run, aid = self.start()
        self.save(run, "compare-lines", answer)
        self.request(run + "/model-mark", {"question": "compare-lines"}, 409)
        self.assertEqual(seen, [])
        self.request(run + "/submit", {"blanks": ORDER[:-1]})
        self.request(run + "/model-mark", {"question": "compare-lines"}, 503)
        self.assertEqual(seen, [])
        self.server.grader = Grader(port=model.server_port)
        for _ in range(2):
            self.request(run + "/model-mark", {"question": "compare-lines"}, 503)
        response = self.request(run + "/model-mark", {"question": "compare-lines"})
        self.assertIn("uncertain", response)
        self.assertEqual(self.request(run)["questions"][-1]["mark"]["points"], None)
        marked = self.request(run + "/model-mark", {"question": "compare-lines"})
        self.assertEqual(marked["score"]["points"], 4)
        self.assertEqual(marked["score"]["percent"], 29)
        self.assertTrue(marked["score"]["provisional"])
        self.assertEqual(marked["questions"][-1]["mark"]["method"], "local-model")
        for route, payload in seen:
            self.assertEqual(route, "/v1/chat/completions")
            self.assertEqual(payload["model"], "study-grader")
            self.assertEqual(payload["response_format"]["json_schema"]["name"], "test_mark")
            context = json.loads(payload["messages"][1]["content"])
            self.assertEqual(set(context), {"answer", "statement", "rubric", "solution", "language", "max_points"})
            self.assertEqual(context["answer"], answer)
            self.assertEqual(context["max_points"], 4)
        self.request(run + "/model-mark", {"question": "compare-lines"}, 400)
        self.request(run + "/self-mark", {"question": "compare-lines", "points": 3})
        score = self.server.tests.save_mark(self.key, aid, "compare-lines", 4, {"model": "late", "feedback": "Stale"})["score"]
        self.assertEqual(score["points"], 3)
        self.assertFalse(score["provisional"])
