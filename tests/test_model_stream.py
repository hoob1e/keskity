"""Real HTTP streaming with paced, fictional model output."""
from contextlib import closing
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from queue import Queue
from tempfile import TemporaryDirectory
import threading
import unittest

import demo
from grading import Grader
from hub import Handler, HubHTTP
from local_model import MODEL_STREAM
from model_stream import text_prefixes
from packs import adapt, validator
from practice_runs import PracticeRuns
from store import Store


class ScriptedModel(BaseHTTPRequestHandler):
    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.calls.append(request)
        before, gate, after, finish = self.server.scripts.get(timeout=3)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def event(delta, reason=None):
            data = {"choices": [{"index": 0, "delta": delta, "finish_reason": reason}]}
            self.wfile.write(b"data: " + json.dumps(data).encode() + b"\r\n\r\n")

        event({"role": "assistant", "reasoning_content": "not public"})
        for piece in before:
            event({"content": piece})
        if not gate.wait(3):
            return
        for piece in after:
            event({"content": piece})
        if finish is not None:
            event({}, finish)
            self.wfile.write(b"data: [DONE]\r\n\r\n")

    def log_message(self, *_args):
        pass


class StreamTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.model = ThreadingHTTPServer(("127.0.0.1", 0), ScriptedModel)
        self.model.scripts, self.model.calls = Queue(), []
        self.start_server(self.model)
        self.app = HubHTTP(("127.0.0.1", 0), Handler)
        self.app.origin = "http://127.0.0.1:" + str(self.app.server_port)
        self.app.store = Store(Path(temp.name))
        self.app.tests = PracticeRuns(self.app.store)
        self.app.core, self.app.demo = validator(), False
        self.app.grader = Grader(self.model.server_port)
        self.start_server(self.app)
        packet, assets = adapt(self.app.core, demo.help_fixture(self.app.core), {})
        self.app.store.install(packet, assets)
        self.key = packet["key"]
        self.task = self.key + "/moving-slope"

    def start_server(self, server):
        worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        worker.start()
        def close():
            server.shutdown()
            server.server_close()
            worker.join()
        self.addCleanup(close)

    def request(self, path, body=None, *, stream=False, origin=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.app.server_port, timeout=3)
        with closing(conn):
            headers = {"Accept": MODEL_STREAM} if stream else {}
            if body is not None:
                headers.update({"Origin": origin or self.app.origin, "Content-Type": "application/json"})
            conn.request("GET" if body is None else "POST", path,
                         None if body is None else json.dumps(body), headers)
            response = conn.getresponse()
            self.assertEqual(response.getheader("Cache-Control"), "no-store")
            if response.getheader("Content-Type").startswith(MODEL_STREAM):
                # The response owns its socket when the server sends Connection: close.
                self.addCleanup(response.close)
                return response
            with response:
                return response.status, json.load(response)

    def script(self, before, after=(), *, finish="stop", paused=False):
        gate = threading.Event()
        self.addCleanup(gate.set)
        if not paused:
            gate.set()
        self.model.scripts.put((before, gate, after, finish))
        return gate

    def frames(self, response):
        return [json.loads(line) for line in response]

    def test_prefix_parser_handles_split_escapes_and_allowed_fields(self):
        allowed = {"points", "feedback", "next_step"}
        prefix = r'{"points":4,"feedback":"The \"rate\" is 2 \u20'
        self.assertEqual(list(text_prefixes(prefix, allowed)), [("feedback", 'The "rate" is 2 ')])
        self.assertEqual(list(text_prefixes(prefix + r'ac\n\ud83d', allowed)), [("feedback", 'The "rate" is 2 €\n')])
        complete = prefix + r'ac\n\ud83d\ude00","next_step":"Check'
        self.assertEqual(dict(text_prefixes(complete, allowed)),
                         {"feedback": 'The "rate" is 2 €\n😀', "next_step": "Check"})
        self.assertEqual(list(text_prefixes('{"reply":{"feedback":"Not top-level"}}', {"reply", "feedback"})), [])
        self.assertEqual(list(text_prefixes('{"unknown":"No preview","feedback":"Also no"}', allowed)), [])
        self.assertEqual(list(text_prefixes('{"feedback":"Bounded","feedback":"Duplicate"}', allowed)), [("feedback", "Bounded")])

    def test_help_previews_early_and_does_not_keep_a_partial_reply(self):
        path = "/api/explain-selection/" + self.task
        selection = {"field": "prompt", "text": "stays fixed"}
        payload = {**selection, "question": "What does that phrase mean?"}
        state = lambda: self.request("/api/solver/" + self.task)[1]
        self.request("/api/draft/" + self.task, {"answer": "Private unsent draft"})
        earlier = self.request("/api/attempt/" + self.task, {"answer": "Earlier answer", "help": "no-help"})[1]
        gate = self.script(['{"reply":"It remains'], [' unchanged."}'], paused=True)
        response = self.request(path, payload, stream=True)
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(response.readline()), {"field": "reply", "text": "It remains"})
        self.assertFalse(state()["explanation_opened"])
        gate.set()
        self.assertEqual(self.frames(response), [
            {"field": "reply", "text": " unchanged."},
            {"result": {"reply": "It remains unchanged.", "lang": "en"}},
        ])
        request, = self.model.calls
        self.assertIs(request["stream"], True)
        self.assertEqual(json.loads(request["messages"][1]["content"]),
                         {"selection": "stays fixed", "question": payload["question"], "language": "en"})
        self.assertTrue(state()["explanation_opened"])
        self.assertNotIn("It remains", json.dumps(state()))
        self.assertEqual(self.app.store.attempt(earlier["id"])["support_used"], [])

    def test_bad_refused_and_interrupted_replies_never_create_exposures(self):
        path = "/api/define-selection/" + self.task
        selection = {"field": "prompt", "text": "slope"}
        for name, parts, finish in [
            ("invalid JSON", ['{"reply":"Looks plausible','"'], "stop"),
            ("duplicate field", ['{"reply":"Looks plausible', '","reply":"Another"}'], "stop"),
            ("connection ended", ['{"reply":"Looks plausible"}'], None),
            ("max tokens", ['{"reply":"Looks plausible"}'], "length"),
        ]:
            with self.subTest(name=name):
                self.script(parts, finish=finish)
                frames = self.frames(self.request(path, selection, stream=True))
                self.assertEqual(frames[0], {"field": "reply", "text": "Looks plausible"})
                self.assertEqual(set(frames[-1]), {"error"})
                self.assertNotIn("result", {key for frame in frames for key in frame})
                self.assertFalse(self.request("/api/solver/" + self.task)[1]["explanation_opened"])
        self.script(['{"reply":null}'])
        self.assertEqual(self.frames(self.request(path, selection, stream=True)),
                         [{"result": {"reply": None, "lang": "en"}}])
        self.assertFalse(self.request("/api/solver/" + self.task)[1]["explanation_opened"])

    def test_feedback_previews_text_but_not_verdict_and_saves_only_valid_result(self):
        task = self.key + "/compare-lines"
        attempt = self.request("/api/attempt/" + task, {"answer": "Equal slopes keep the lines parallel."})[1]
        path, body = "/api/feedback", {"id": attempt["id"]}
        self.script(['{"verdict":"bad","feedback":"A comment",', '"next_step":"A step."}'])
        frames = self.frames(self.request(path, body, stream=True))
        self.assertEqual([f["field"] for f in frames[:-1]], ["feedback", "next_step"])
        self.assertIn("error", frames[-1])
        self.assertIsNone(self.app.store.attempt(attempt["id"])["feedback"])

        gate = self.script(['{"verdict":"partial","feedback":"The slopes match.'], ['","next_step":"Check the intercepts."}'], paused=True)
        response = self.request(path, body, stream=True)
        self.assertEqual(json.loads(response.readline()), {"field": "feedback", "text": "The slopes match."})
        self.assertIsNone(self.app.store.attempt(attempt["id"])["feedback"])
        gate.set()
        rest = self.frames(response)
        self.assertEqual(rest[0], {"field": "next_step", "text": "Check the intercepts."})
        self.assertEqual(rest[-1]["result"]["feedback"]["verdict"], "partial")
        self.assertEqual(self.app.store.attempt(attempt["id"])["feedback"]["method"], "local-model")
        self.assertEqual(self.frames(self.request(path, body, stream=True)), [rest[-1]])  # Cached, not generated again.
        self.assertEqual(len(self.model.calls), 2)

    def test_stream_adheres_to_timed_lan_and_pack_permissions(self):
        packet, assets = adapt(self.app.core, demo.test_fixture(self.app.core), {})
        self.app.store.install(packet, assets)
        test_key = packet["key"]
        setup = "/api/test/" + test_key
        run = setup + "/" + self.request(setup, {})[1]["id"]
        question = {"question": "compare-lines"}
        path = run + "/model-mark"
        selection = {"field": "prompt", "text": "intercepts"}
        self.assertEqual(self.request(path, question, stream=True)[0], 409)
        self.assertEqual(self.request("/api/translate-selection/" + test_key + "/compare-lines",
                                      {**selection, "target": "sv"}, stream=True)[0], 404)
        self.assertEqual(self.request("/api/define-selection/" + self.key + "/compare-lines", selection, stream=True)[0], 403)
        for origin in ("null", "https://elsewhere.invalid"):
            self.assertEqual(self.request("/api/explain-selection/" + self.task, selection, stream=True,
                                          origin=origin)[0], 403)
        listener = self.app.server_address
        try:
            self.app.server_address = ("192.0.2.44", listener[1])
            self.assertFalse(self.request("/api/home")[1]["grader"])
            self.assertEqual(self.request(path, question, stream=True)[0], 403)
            self.assertEqual(self.request("/api/feedback", {}, stream=True)[0], 403)
            self.assertEqual(self.request("/api/define-selection/" + self.task, selection, stream=True)[0], 403)
        finally:
            self.app.server_address = listener
        self.assertEqual(self.model.calls, [])

        self.request(run + "/answer", {**question, "value": "They have equal slopes and different intercepts."})
        self.request(run + "/submit", {"blanks": ["intercept-check", "find-rate", "moving-slope"]})
        self.script(['{"points":9,"feedback":"Out of range"}'])
        invalid = self.frames(self.request(path, question, stream=True))
        self.assertEqual(invalid[0]["field"], "feedback")
        self.assertIn("error", invalid[-1])
        self.assertEqual(self.request(run)[1]["questions"][-1]["mark"]["method"], "pending")

        gate = self.script(['{"points":4,"feedback":"Equal slopes'], [' and distinct intercepts."}'], paused=True)
        response = self.request(path, question, stream=True)
        self.assertEqual(json.loads(response.readline()), {"field": "feedback", "text": "Equal slopes"})
        self.assertEqual(self.request(run)[1]["questions"][-1]["mark"]["method"], "pending")
        # The completed model response can't overwrite a self-mark from a different window.
        self.request(run + "/self-mark", {**question, "points": 3})
        gate.set()
        result = self.frames(response)[-1]["result"]
        self.assertEqual(result["questions"][-1]["mark"], {"method": "self", "points": 3})
