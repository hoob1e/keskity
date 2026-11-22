"""Test the actual importer, API, persistence, and review boundaries with fictional data."""
import base64
from datetime import date, timedelta
import hashlib
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

import demo
from grading import Grader
from hub import HubHTTP, Handler
from packs import adapt, asset_path, public_pack, validator
from store import Store

CORE = validator()
RAW = demo.fixture(CORE)


class PacksTest(unittest.TestCase):
    def test_release_and_solver_projection(self):
        pack, blobs = adapt(CORE, RAW, {})
        view = public_pack(pack)
        self.assertEqual(len(view["problems"]), 3)
        self.assertEqual(blobs, {})
        self.assertNotIn("correct_index", json.dumps(view))
        self.assertNotIn("vanishes", json.dumps(view))
        self.assertEqual(view["problems"][2]["options"][2], "$(0,-2)$")
        self.assertEqual(pack["problems"][1]["digest"], CORE["problem_digest"](json.loads(RAW)["problems"][1]))

    def test_checked_release_is_required(self):
        for how in ("draft", "approval", "widget", "group"):
            with self.subTest(how=how):
                p = json.loads(RAW)
                if how == "draft":
                    p["problems"][1]["status"] = "draft"
                elif how == "approval":
                    p["plan"]["approval"]["status"] = "pending"
                elif how == "widget":
                    p["extensions"]["studyHub"]["items"]["moving-slope"]["visual"]["slider"] = "true"
                else:
                    p["plan"]["participation"] = "group"
                    p["plan"]["approval"]["digest"] = CORE["plan_digest"](p["plan"])
                with self.assertRaises(ValueError):
                    adapt(CORE, json.dumps(p), {})

    def test_local_image_and_checksum(self):
        p = json.loads(RAW)
        img = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>'
        name = "assets/paper-figure.svg"
        p["problems"][1]["assets"] = [{"path":name, "role":"prompt", "alt":"Diagonal line", "sha256":hashlib.sha256(img).hexdigest()}]
        enc = lambda x: base64.b64encode(x).decode("ascii")
        pack, blobs = adapt(CORE, json.dumps(p), {name:enc(img)})
        self.assertEqual(blobs[name], ("image/svg+xml",img))
        self.assertFalse(public_pack(pack)["problems"][1]["can_check"])
        for uploads in ({}, {name:enc(img+b" ")}):
            with self.assertRaises(ValueError):
                adapt(CORE, json.dumps(p), uploads)
        for path in ("assets/../other.svg", "notes/file.svg", "assets//odd.svg"):
            with self.assertRaises(ValueError):
                asset_path(path)

    def test_pack_edition_changes_when_widget_changes(self):
        old, _ = adapt(CORE, RAW, {})
        data = json.loads(RAW)
        data["extensions"]["studyHub"]["items"]["moving-slope"]["visual"]["slope"] = 2
        new, _ = adapt(CORE, json.dumps(data), {})
        self.assertNotEqual(old["key"], new["key"])
        self.assertEqual(old["problems"][0]["digest"], new["problems"][0]["digest"])
        self.assertNotEqual(old["problems"][0]["version"], new["problems"][0]["version"])

    def test_study_metadata_keeps_problem_identity(self):
        raw = json.loads(RAW)
        spec = raw["extensions"]["studyHub"]
        pack, _ = adapt(CORE, RAW, {})
        self.assertEqual(pack["study"]["title"], "Linear functions")
        self.assertEqual(public_pack(pack)["problems"][0]["topic"], "Reading a line")
        del spec["study"]
        spec["items"] = {pid: {k: v for k, v in entry.items() if k in ("visual", "choice")}
                         for pid, entry in spec["items"].items() if set(entry) & {"visual", "choice"}}
        old, _ = adapt(CORE, json.dumps(raw), {})
        self.assertNotIn("study", old)
        self.assertNotEqual(old["key"], pack["key"])
        self.assertEqual([p["version"] for p in old["problems"]], [p["version"] for p in pack["problems"]])

    def test_study_metadata_rejects_unknown_fields_and_invalid_labels(self):
        for field in ({"html": "<b>Test</b>"}, {"title": ""}, {"concepts": {}},
                      {"concepts": ["Slope", "slope"]}, {"overview": "t" * 601}):
            with self.subTest(field=field):
                raw = json.loads(RAW)
                raw["extensions"]["studyHub"]["study"] = field
                with self.assertRaises(ValueError):
                    adapt(CORE, json.dumps(raw), {})


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = HubHTTP(("127.0.0.1",0),Handler)
        self.server.origin = "http://127.0.0.1:" + str(self.server.server_port)
        self.server.store = Store(Path(self.temp.name))
        self.server.core = CORE
        self.server.grader = Grader()
        self.server.demo = False
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval":.01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, data=None, origin=None):
        conn = http.client.HTTPConnection("127.0.0.1",self.server.server_port,timeout=2)
        try:
            conn.request("GET" if data is None else "POST", path,
                         json.dumps(data) if data is not None else None,
                         {} if data is None else {"Content-Type":"application/json", "Origin":origin or self.server.origin})
            response = conn.getresponse()
            return response.status,json.loads(response.read())
        finally:
            conn.close()

    def new_pack(self):
        status, outcome = self.request("/api/import",{"packet":RAW,"assets":{}})
        self.assertEqual(status,200,outcome)
        self.assertTrue(outcome["added"])
        return outcome["key"]

    def test_dashboard_attempt_key_and_export_after_restart(self):
        key = self.new_pack()
        path = "/api/attempt/" + key + "/intercept-check"
        self.assertEqual(self.request(path,{"choice":True})[0],400)
        status, a = self.request(path,{"choice":2,"help":"no-help"})
        self.assertEqual(status,201,a)
        self.assertEqual(a["feedback"]["method"],"answer-key")
        self.assertEqual(a["feedback"]["verdict"],"correct")
        self.assertEqual(a["assistance"],"independent")
        self.server.store = Store(Path(self.temp.name))
        summary = self.request("/api/home")[1]
        self.assertEqual(summary["activity"][-1]["count"],1)
        self.assertEqual(summary["packs"][0]["attempted"],1)
        self.assertEqual(summary["packs"][0]["total"],3)
        self.assertFalse(self.request("/api/import",{"packet":RAW,"assets":{}})[1]["added"])
        self.assertEqual(self.request(path,{"choice":1})[1]["support_used"],["answer-check"])
        out = self.request("/api/export",{"ids":[a["id"]]})[1]
        self.assertEqual(len(out["attempts"]),1)
        self.assertEqual(out["attempts"][0]["problem_version"],a["problem_version"])
        self.assertEqual(out["attempts"][0]["assistance"],"independent")

    def test_help_and_grading_failure_do_not_erase_attempt(self):
        key = self.new_pack()
        task = key + "/compare-lines"
        self.assertEqual(self.request("/api/reveal/"+task, {"kind":"hint","index":0})[0],200)
        status,a = self.request("/api/attempt/"+task,{"answer":"They never intersect."})
        self.assertEqual(status,201,a)
        self.assertEqual(a["assistance"],"hinted")
        self.assertEqual(self.request("/api/feedback",{"id":a["id"]})[0],503)
        history = self.request("/api/history/"+task)[1]
        self.assertEqual(history[0]["answer"],"They never intersect.")
        self.assertIsNone(history[0]["feedback"])
        self.assertEqual(self.request("/api/forget",{"id":a["id"]})[0],200)
        self.assertEqual(self.request("/api/history/"+task)[1],[])

    def test_solver_drafts_are_local_and_separate_from_submissions(self):
        key = self.new_pack()
        task = key + "/compare-lines"
        solve, draft = "/api/solver/" + task, "/api/draft/" + task
        self.assertEqual(self.request(solve)[1], {
            "draft": None, "hint_indexes": [], "earlier_hint": False, "history": [],
        })
        status, saved = self.request(draft, {"answer":"  Parallel lines.\n  ", "help":"hint"})
        self.assertEqual(status, 200)
        self.assertEqual(saved["answer"], "  Parallel lines.\n  ")
        self.assertEqual(self.request(draft, {"answer":"", "help":"no-help"})[0], 400)
        self.assertEqual(self.request(draft, {"answer":"Other origin"}, origin="http://elsewhere.local")[0], 403)

        self.server.store = Store(Path(self.temp.name))
        self.assertEqual(self.request(solve)[1]["draft"], saved)
        self.assertIsNone(self.request("/api/solver/" + key + "/moving-slope")[1]["draft"])
        home = self.request("/api/home")[1]
        self.assertEqual(home["packs"][0]["attempted"], 0)
        self.assertEqual(home["activity"][-1]["count"], 0)
        self.assertEqual(self.request("/api/history/" + task)[1], [])

        _, newer = self.request(draft, {"answer":"A newer draft"})
        self.assertNotEqual(newer["revision"], saved["revision"])
        self.assertEqual(self.request("/api/draft-discard/" + task, {"revision": saved["revision"]})[0], 404)
        status, a = self.request("/api/attempt/" + task, {**saved, "draft_revision":saved["revision"]})
        self.assertEqual(status, 201)
        self.assertEqual(a["assistance"], "hinted")
        self.assertEqual(self.request(solve)[1]["draft"], newer)
        status, _ = self.request("/api/attempt/" + task, {**newer, "draft_revision":newer["revision"]})
        self.assertEqual(status, 201)
        self.assertIsNone(self.request(solve)[1]["draft"])

    def test_choice_draft_does_not_check_and_can_be_discarded(self):
        key = self.new_pack()
        task = key + "/intercept-check"
        self.assertEqual(self.request("/api/draft/" + task, {"choice":True})[0], 400)
        status, draft = self.request("/api/draft/" + task, {"choice":2})
        self.assertEqual(status, 200)
        self.assertEqual(set(draft), {"choice", "help", "revision", "updated_at"})
        self.assertEqual(self.request("/api/draft-discard/" + task, {"revision":draft["revision"]})[0], 200)
        state = self.request("/api/solver/" + task)[1]
        self.assertEqual(state["history"], [])
        self.assertIsNone(state["draft"])

    def test_hint_count_records_distinct_reveals_not_availability(self):
        raw = json.loads(RAW)
        hints = raw["problems"][1]["support"]["hints"]
        hints.append({"id":"next-step","text":"Compare the equations.", "reveals_target":True})
        status, item = self.request("/api/import", {"packet":json.dumps(raw), "assets":{}})
        self.assertEqual(status, 200)
        task = item["key"] + "/compare-lines"
        url = "/api/solver/" + task
        reveal = "/api/reveal/" + task
        self.assertEqual(self.request(url)[1]["hint_indexes"], [])
        self.assertEqual(self.request(reveal, {"kind":"hint","index":1})[1], {"confirm":True})
        self.assertEqual(self.request(url)[1]["hint_indexes"], [])
        for _ in range(2):
            self.assertEqual(self.request(reveal, {"kind":"hint","index":0})[0], 200)
        self.assertEqual(self.request(url)[1]["hint_indexes"], [0])
        self.assertEqual(self.request(reveal, {"kind":"hint","index":1,"allow_reveal":True})[0], 200)
        self.assertEqual(self.request(url)[1]["hint_indexes"], [0, 1])
        self.assertEqual(self.request("/api/attempt/" + task, {"answer":"Their slopes match."})[1]["assistance"],
                         "worked-explanation")

    def test_study_index_keeps_attempts_and_support_separate(self):
        key = self.new_pack()
        path = "/api/attempt/" + key + "/intercept-check"
        status, submission = self.request(path, {"choice":2})
        self.assertEqual(status, 201)
        self.request(path, {"choice":2})

        legacy = json.loads(RAW)
        legacy.pop("course")
        legacy.pop("extensions")
        status, independent = self.request("/api/import", {"packet":json.dumps(legacy),"assets":{}})
        self.assertEqual(status, 200)
        independent_route = "/api/study/independent/"
        self.assertEqual(self.request(independent_route + key)[0], 404)
        self.assertEqual(self.request("/api/study/course?code=UNKNOWN")[0], 404)
        code, packs = self.request("/api/study/course?code=DEMO")
        self.assertEqual(code, 200)
        self.assertEqual([p["key"] for p in packs], [key])
        items = {p["id"]:p for p in packs[0]["problems"]}
        self.assertEqual(items["intercept-check"]["attempts"], 2)
        self.assertGreaterEqual(items["intercept-check"]["latest"], submission["submitted_at"])
        self.assertTrue(items["intercept-check"]["choice"])
        self.assertEqual(items["moving-slope"]["preview"], {"line": {"slope":1,"intercept":2}})
        sensitive = {"answer", "statement", "solution", "rubric", "correct_index", "options", "hint_count"}
        for item in items.values():
            self.assertTrue(sensitive.isdisjoint(item))
        code, [standalone] = self.request(independent_route + independent["key"])
        self.assertEqual(code, 200)
        self.assertEqual(standalone["study"], {})
        self.assertTrue(all(p["attempts"] == 0 and p["latest"] is None for p in standalone["problems"]))

    def test_exam_card_edit_and_origin(self):
        day = (date.today()+timedelta(days=3)).isoformat()
        item = {"title":"Imaginary exam","course":"demo","day":day}
        self.assertEqual(self.request("/api/exam",item,origin="http://different.local")[0],403)
        status, ex = self.request("/api/exam",item)
        self.assertEqual(status,200,ex)
        self.assertEqual(self.request("/api/exam",{**item,"id":ex["id"],"title":"Revised date card"})[0],200)
        self.assertEqual(self.request("/api/home")[1]["exams"][0]["title"],"Revised date card")
        self.assertEqual(self.request("/api/home")[1]["exams"][0]["course"],"DEMO")
        self.assertEqual(self.request("/api/exam-remove",ex)[0],200)
        self.assertEqual(self.request("/api/home")[1]["exams"],[])


if __name__ == "__main__":
    unittest.main()
