"""Test the actual importer, API, persistence, and review boundaries with fictional data."""
import base64
from datetime import date, timedelta
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock

import demo
from grading import Grader
from hub import HubHTTP, Handler
from packs import adapt, asset_path, public_pack, upload_from_path, validator
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

    def test_published_skill_packet_imports_with_declared_assets(self):
        raw = json.loads(demo.help_fixture(CORE))
        figure = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 10 L10 0"/></svg>'
        name = "assets/figures/line.svg"
        raw["problems"][0]["assets"] = [{"path": name, "role": "prompt", "alt": "Rising line",
                                         "sha256": hashlib.sha256(figure).hexdigest()}]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            work, published = root / "work", root / "published"
            (work / name).parent.mkdir(parents=True)
            (work / name).write_bytes(figure)
            files = CORE["export_packet"](raw, work, published)
            self.assertIn("Problems.md", files)
            self.assertIn(name, files)
            pack, assets = adapt(CORE, *upload_from_path(published))
            store = Store(root / "local")
            self.assertTrue(store.install(pack, assets))
            self.assertFalse(store.install(pack, assets))
            key, item = pack["key"], pack["problems"][0]
            self.assertEqual(tuple(store.asset(key, name)), ("image/svg+xml", figure))
            self.assertEqual(store.history(key, item["id"]), [])
            self.assertTrue(item["explain_selection"])
            self.assertIn("slope", [entry["id"] for entry in item["inline_help"]])
            self.assertNotIn("vanishes", (published / "Problems.md").read_text())

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

    def test_reviewed_study_help_uses_a_versioned_index_without_bodies(self):
        raw = json.loads(demo.help_fixture(CORE))
        pack, _ = adapt(CORE, json.dumps(raw), {})
        task = pack["problems"][0]
        self.assertIn("line’s slope", task["inline_help"][0]["definition"])
        exposed = public_pack(pack)
        self.assertEqual(exposed["problems"][0]["inline_help"][0], {
            "id": "slope", "term": "Slope", "aliases": ["gradient"],
            "modes": ["definition", "example", "translation"], "ask_further": ["definition"],
        })
        self.assertNotIn("ask_further", exposed["problems"][0]["inline_help"][1])
        self.assertNotIn("Kulmakerroin", json.dumps(exposed))
        self.assertNotIn("A ramp", json.dumps(exposed))
        self.assertNotIn("inline_help", exposed["problems"][1])
        raw["extensions"]["studyHub"]["items"]["moving-slope"]["inline_help"][0]["definition"] += " Review annotation."
        revised, _ = adapt(CORE, json.dumps(raw), {})
        self.assertNotEqual(revised["key"], pack["key"])
        self.assertNotEqual(revised["problems"][0]["version"], task["version"])
        self.assertEqual(revised["problems"][0]["digest"], task["digest"])
        self.assertEqual(revised["problems"][1]["version"], pack["problems"][1]["version"])

    def test_study_help_requires_distinct_reviewed_entries_not_test_aids(self):
        raw = demo.help_fixture(CORE)
        examples = (
            [],
            {"term": "Slope", "definition": "Wrong shape"},
            [{"id": "named-term", "term": "A term"}],
            [{"id": "Unable to use", "term": "A term", "definition": "A note"}],
            [{"id": "angle", "term": "Angle", "aliases": ["Ａｎｇｌｅ."], "definition": "A note"}],
            [{"id": "angle", "term": "Angle", "definition": "   "}],
            [{"id": "angle", "term": "Angle", "definition": "y" * 1001}],
            [{"id": "angle", "term": "Angle", "generated": "No", "definition": "A note"}],
            [{"id": "angle", "term": "Angle", "translation": {"lang": "Finnish language", "text": "Kulma"}}],
        )
        for value in examples:
            with self.subTest(value=str(value)[:60]):
                packet = json.loads(raw)
                packet["extensions"]["studyHub"]["items"]["moving-slope"]["inline_help"] = value
                with self.assertRaisesRegex(ValueError, "(?i)inline help|translation"):
                    adapt(CORE, json.dumps(packet), {})
        packet = json.loads(demo.test_fixture(CORE))
        packet["extensions"]["studyHub"]["items"]["moving-slope"]["inline_help"] = (
            json.loads(raw)["extensions"]["studyHub"]["items"]["moving-slope"]["inline_help"])
        with self.assertRaisesRegex(ValueError, "checked untimed"):
            adapt(CORE, json.dumps(packet), {})

    def test_selection_explanations_are_per_problem_and_versioned(self):
        raw = json.loads(demo.help_fixture(CORE))
        original, _ = adapt(CORE, json.dumps(raw), {})
        self.assertTrue(public_pack(original)["problems"][0]["explain_selection"])
        options = raw["extensions"]["studyHub"]["items"]["moving-slope"]
        for value in (0, 1, None, "yes", [], {}):
            options["explain_selection"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "true or false"):
                adapt(CORE, json.dumps(raw), {})
        options["explain_selection"] = False
        disabled, _ = adapt(CORE, json.dumps(raw), {})
        self.assertNotIn("explain_selection", public_pack(disabled)["problems"][0])
        self.assertNotEqual(original["problems"][0]["version"], disabled["problems"][0]["version"])
        del options["explain_selection"]
        old, _ = adapt(CORE, json.dumps(raw), {})
        self.assertEqual(old["key"], disabled["key"])
        self.assertEqual(original["problems"][1]["version"], old["problems"][1]["version"])
        timed = json.loads(demo.test_fixture(CORE))
        timed["extensions"]["studyHub"]["items"]["moving-slope"]["explain_selection"] = True
        with self.assertRaisesRegex(ValueError, "checked untimed"):
            adapt(CORE, json.dumps(timed), {})

    def test_followup_permissions_must_name_authored_modes(self):
        demo_packet = demo.help_fixture(CORE)
        for bad in (True, [], "definition", ["example", "example"], ["chat"], [None], [["definition"]]):
            with self.subTest(ask_further=bad):
                raw = json.loads(demo_packet)
                raw["extensions"]["studyHub"]["items"]["moving-slope"]["inline_help"][0]["ask_further"] = bad
                with self.assertRaisesRegex(ValueError, "ask_further"):
                    adapt(CORE, json.dumps(raw), {})
        raw = json.loads(demo_packet)
        entry = raw["extensions"]["studyHub"]["items"]["moving-slope"]["inline_help"][0]
        del entry["translation"]
        entry["ask_further"] = ["translation"]
        with self.assertRaisesRegex(ValueError, "ask_further"):
            adapt(CORE, json.dumps(raw), {})
        original, _ = adapt(CORE, demo_packet, {})
        entry.pop("ask_further")
        reviewed_only, _ = adapt(CORE, json.dumps(raw), {})
        self.assertNotIn("ask_further", public_pack(reviewed_only)["problems"][0]["inline_help"][0])
        self.assertNotEqual(original["problems"][0]["version"], reviewed_only["problems"][0]["version"])

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
            "draft": None, "hint_indexes": [], "earlier_hint": False, "explanation_opened": False, "history": [],
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

    def test_study_help_reveal_is_local_scoped_and_not_retroactive(self):
        old = self.new_pack()
        status, item = self.request("/api/import", {"packet": demo.help_fixture(CORE), "assets": {}})
        self.assertEqual(status, 200, item)
        key = item["key"]
        pid = key + "/moving-slope"
        path, solve = "/api/reveal/" + pid, "/api/solver/" + pid
        definition = {"kind": "inline-help", "id": "slope", "mode": "definition"}
        self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request(path, definition, origin="http://elsewhere.local")[0], 403)
        self.assertEqual(self.request(path, {**definition, "id": ["slope"]})[0], 404)
        self.assertEqual(self.request(path, {**definition, "id": "slider", "mode": "example"})[0], 404)
        self.assertEqual(self.request("/api/reveal/" + old + "/moving-slope", definition)[0], 404)
        self.assertEqual(self.request("/api/reveal/" + key + "/compare-lines", definition)[0], 404)
        self.assertEqual(self.request("/api/home")[1]["packs"][0]["submissions"], 0)
        self.assertFalse(self.request(solve)[1]["explanation_opened"])
        answer = {"answer": "The value at x=0 is unchanged.", "help": "no-help"}
        _, original = self.request("/api/attempt/" + pid, answer)
        self.assertEqual(original["assistance"], "independent")
        status, note = self.request(path, definition)
        self.assertEqual(status, 200, note)
        self.assertEqual(set(note), {"text", "lang", "credit"})
        self.assertEqual(note["lang"], "en")
        self.assertIn("changes", note["text"])
        status, note = self.request(path, {**definition, "mode": "translation"})
        self.assertEqual(status, 200, note)
        self.assertEqual(note["lang"], "fi")
        self.assertIn("Kulmakerroin", note["text"])

        self.server.store = Store(Path(self.temp.name))
        current = self.request(solve)[1]
        self.assertTrue(current["explanation_opened"])
        self.assertEqual(current["hint_indexes"], [])
        self.assertEqual(len(current["history"]), 1)
        self.assertEqual(current["history"][0]["support_used"], [])
        self.assertFalse(self.request("/api/solver/" + key + "/compare-lines")[1]["explanation_opened"])
        self.assertFalse(self.request("/api/solver/" + old + "/moving-slope")[1]["explanation_opened"])
        with self.server.store.connect() as db:
            rows = db.execute("SELECT pack_key, problem_id, kind FROM exposures").fetchall()
            self.assertEqual([tuple(row) for row in rows], [(key, "moving-slope", "explanation")])
        _, after = self.request("/api/attempt/" + pid, answer)
        self.assertEqual(after["assistance"], "prompted")
        self.assertEqual(after["support_used"], ["explanation"])
        export = self.request("/api/export", {"ids": [after["id"]]})[1]["attempts"]
        self.assertEqual([a["id"] for a in export], [after["id"]])
        self.assertEqual(export[0]["support_used"], ["explanation"])
        self.assertNotIn("inline_help", export[0])
        self.request(path, {"kind": "hint", "index": 0})
        _, hinted = self.request("/api/attempt/" + pid, answer)
        self.assertEqual(hinted["assistance"], "hinted")
        self.assertEqual(hinted["support_used"], ["explanation", "hint"])

    def test_explanation_tool_only_sends_authorized_selection_and_no_records(self):
        pack, figures = adapt(CORE, demo.help_fixture(CORE), {})
        timed, _ = adapt(CORE, demo.test_fixture(CORE), {})
        self.server.store.install(pack, figures)
        self.server.store.install(timed, {})
        key = pack["key"]
        base = "/api/explain-selection/" + key
        task_path = key + "/moving-slope"
        problem = {"field": "prompt", "text": "stays fixed, and why"}
        overview = {"field": "overview", "text": "equations"}
        self.assertFalse(self.request("/api/home")[1]["explain_selection"])
        self.assertEqual(self.request(base, overview)[0], 503)
        self.assertFalse(self.request("/api/solver/" + task_path)[1]["explanation_opened"])

        grader = Mock(spec=Grader)
        grader.port = 8766
        grader.request.return_value = {"reply": "An equation expresses a relation."}
        self.server.grader = grader
        self.assertTrue(self.request("/api/home")[1]["explain_selection"])
        self.assertEqual(self.request(base)[0], 404)
        self.assertEqual(self.request(base, overview, origin="http://elsewhere.local")[0], 403)
        test_route = "/api/explain-selection/" + timed["key"]
        self.assertEqual(self.request(test_route, overview)[0], 404)
        self.assertEqual(self.request(test_route + "/moving-slope", problem)[0], 404)
        self.assertEqual(self.request(base + "/compare-lines", {"field": "prompt", "text": "intercepts"})[0], 403)
        self.assertEqual(self.request(base + "/moving-slope", {**problem, "text": "The point stays fixed and the product vanishes"})[0], 400)
        self.assertEqual(self.request(base, {**overview, "field": "prompt"})[0], 400)
        self.assertEqual(self.request(base, {**overview, "context": "Not from the pack"})[0], 400)
        for bad in ("", " " * 421, False, None, "equations\x00"):
            self.assertEqual(self.request(base, {**overview, "text": bad})[0], 400)
        address = self.server.server_address
        try:
            self.server.server_address = ("192.0.2.14", self.server.server_port)
            self.assertFalse(self.request("/api/home")[1]["explain_selection"])
            self.assertEqual(self.request(base, overview)[0], 403)
        finally:
            self.server.server_address = address
        grader.request.assert_not_called()

        status, result = self.request(base, overview)
        self.assertEqual((status, result), (200, {"reply": "An equation expresses a relation.", "lang": "en"}))
        subject, schema, guide, name = grader.request.call_args.args
        self.assertEqual(subject, {"selection": "equations", "language": "en", "context": pack["study"]["overview"]})
        self.assertEqual(schema["required"], ["reply"])
        self.assertEqual(name, "explain_selection")
        self.assertIn("disambiguate", guide)
        with self.server.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM exposures").fetchone()[0], 0)
        self.request("/api/draft/" + task_path, {"answer": "This learner draft is private."})
        self.request("/api/attempt/" + task_path, {"answer": "Earlier submitted answer.", "help": "no-help"})
        path = base + "/moving-slope"
        grader.request.return_value = {"reply": None}
        self.assertEqual(self.request(path, problem), (200, {"reply": None, "lang": "en"}))
        self.assertFalse(self.request("/api/solver/" + task_path)[1]["explanation_opened"])
        grader.request.return_value = {"reply": 123}
        self.assertEqual(self.request(path, problem)[0], 503)
        grader.request.return_value = {"reply": "It does not move."}
        self.assertEqual(self.request(path, problem), (200, {"reply": "It does not move.", "lang": "en"}))
        subject, _, guide, _ = grader.request.call_args.args
        self.assertEqual(subject, {"selection": problem["text"], "language": "en"})
        self.assertIn("Do not compute", guide)
        state = self.request("/api/solver/" + task_path)[1]
        self.assertTrue(state["explanation_opened"])
        self.assertEqual(state["hint_indexes"], [])
        self.assertEqual(state["history"][0]["support_used"], [])
        self.assertNotIn("It does not move.", json.dumps(state))
        self.assertEqual(self.request("/api/attempt/" + task_path, {"answer": "Later answer."})[1]["support_used"], ["explanation"])

    def test_compact_selection_actions_are_bounded_private_and_opt_in(self):
        pack, figures = adapt(CORE, demo.help_fixture(CORE), {})
        timed, _ = adapt(CORE, demo.test_fixture(CORE), {})
        self.server.store.install(pack, figures)
        self.server.store.install(timed, {})
        self.assertEqual(self.request("/api/home")[1]["study_languages"], {})
        key = pack["key"]
        task = key + "/moving-slope"
        state = lambda: self.request("/api/solver/" + task)[1]
        self.request("/api/draft/" + task, {"answer": "Private draft marker"})
        self.request("/api/attempt/" + task, {"answer": "Earlier independent attempt"})
        grader = Mock(spec=Grader)
        grader.port = 8766
        self.server.grader = grader
        self.assertEqual(self.request("/api/home")[1]["study_languages"]["sv"], "Swedish")

        problem = {"field": "prompt", "text": "stays fixed"}
        overview = {"field": "overview", "text": "equations"}
        actions = [
            ("explain-selection", {"question": "  What does this wording mean?\n"}),
            ("define-selection", {}),
            ("translate-selection", {"target": "sv"}),
        ]
        for action, options in actions:
            with self.subTest(action=action):
                base = "/api/" + action + "/"
                path = base + task
                self.assertEqual(self.request(path)[0], 404)
                self.assertEqual(self.request(path, {**problem, **options}, origin="https://outside.invalid")[0], 403)
                self.assertEqual(self.request(base + timed["key"], {**overview, **options})[0], 404)
                self.assertEqual(self.request(base + timed["key"] + "/moving-slope", {**problem, **options})[0], 404)
                self.assertEqual(self.request(base + key + "/compare-lines",
                                              {"field": "prompt", "text": "intercepts", **options})[0], 403)
                for private_field in ("answer", "context", "key", "attempt"):
                    self.assertEqual(self.request(path, {**problem, **options, private_field: "Extra"})[0], 400)
                self.assertEqual(self.request(path, {**problem, "text": "Private draft marker", **options})[0], 400)
                address = self.server.server_address
                try:
                    self.server.server_address = ("192.0.2.14", self.server.server_port)
                    self.assertEqual(self.request("/api/home")[1]["study_languages"], {})
                    self.assertEqual(self.request(path, {**problem, **options})[0], 403)
                finally:
                    self.server.server_address = address
        explain = "/api/explain-selection/" + task
        define = "/api/define-selection/" + task
        translate = "/api/translate-selection/" + task
        for bad in (None, True, ["what"], "x" * 361, "how\x00"):
            self.assertEqual(self.request(explain, {**problem, "question": bad})[0], 400)
        for bad in (None, True, {"lang": "sv"}, "sv-SE", "XX", "https://example.invalid"):
            self.assertEqual(self.request(translate, {**problem, "target": bad})[0], 400)
        self.assertEqual(self.request(define, {**problem, "question": "Not a definition option"})[0], 400)
        grader.request.assert_not_called()
        self.assertFalse(state()["explanation_opened"])

        grader.request.return_value = {"reply": None}
        self.assertEqual(self.request(explain, {**problem, "question": "   "}), (200, {"reply": None, "lang": "en"}))
        self.assertEqual(grader.request.call_args.args[0], {"selection": "stays fixed", "language": "en"})
        self.assertEqual(self.request(explain, {**problem, **actions[0][1]})[0], 200)
        subject, _, guide, name = grader.request.call_args.args
        self.assertEqual(subject, {"selection": "stays fixed", "language": "en", "question": "What does this wording mean?"})
        self.assertEqual(name, "explain_selection")
        self.assertIn("focus the explanation", guide)
        self.assertEqual(self.request(translate, {**problem, "target": "sv"}), (200, {"reply": None, "lang": "sv"}))
        self.assertFalse(state()["explanation_opened"])

        grader.request.return_value = {"reply": "   A relation between quantities.   "}
        self.assertEqual(self.request("/api/define-selection/" + key, overview),
                         (200, {"reply": "A relation between quantities.", "lang": "en"}))
        subject, schema, guide, name = grader.request.call_args.args
        self.assertEqual(subject, {"selection": "equations", "language": "en", "context": pack["study"]["overview"]})
        self.assertEqual(schema["required"], ["reply"])
        self.assertEqual(name, "define_selection")
        self.assertIn("Define", guide)
        self.assertFalse(state()["explanation_opened"])

        for bad in ("", 123, "x" * 801, "text\x00more", "\ud800"):
            grader.request.return_value = {"reply": bad}
            self.assertEqual(self.request(translate, {**problem, "target": "sv"})[0], 503)
        self.assertFalse(state()["explanation_opened"])
        grader.request.return_value = {"reply": "  förblir oförändrad  "}
        self.assertEqual(self.request(translate, {**problem, "target": "sv"}),
                         (200, {"reply": "förblir oförändrad", "lang": "sv"}))
        subject, _, guide, name = grader.request.call_args.args
        self.assertEqual(subject, {"selection": "stays fixed", "language": "en", "target_language": "Swedish"})
        self.assertEqual(name, "translate_selection")
        self.assertIn("only the selection into Swedish", guide)
        self.assertTrue(state()["explanation_opened"])
        self.assertEqual(state()["history"][0]["support_used"], [])
        self.assertNotIn("förblir", json.dumps(state(), ensure_ascii=False))
        self.assertNotIn("wording", json.dumps(state()))
        self.assertEqual(self.request("/api/attempt/" + task, {"answer": "Attempt after translation"})[1]["support_used"],
                         ["explanation"])
        with self.server.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM exposures").fetchone()[0], 1)

    def test_ask_further_is_explicit_local_and_scoped_to_one_note(self):
        model_calls = []
        responses = [
            (200, {"reply": None}),
            (200, {"reply": 123}),
            (200, {"reply": " "}),
            (200, {"reply": "x" * 801}),
            (200, {"reply": "Unexpected field", "another": True}),
            (503, {}),
            (200, {"reply": "  A steeper line changes height faster.  "}),
        ]

        class Model(BaseHTTPRequestHandler):
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                model_calls.append((self.path, request))
                status, next_reply = responses.pop(0)
                raw = json.dumps({"choices": [{"message": {"content": json.dumps(next_reply)}}]}).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_args):
                pass

        model = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        thread = threading.Thread(target=model.serve_forever, kwargs={"poll_interval":.01}, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(model.server_close)
        self.addCleanup(model.shutdown)

        _, item = self.request("/api/import", {"packet": demo.help_fixture(CORE), "assets": {}})
        key = item["key"]
        task = key + "/moving-slope"
        path, solve = "/api/ask-further/" + task, "/api/solver/" + task
        data = {"id": "slope", "mode": "definition", "question": "  How should I read the word changes here?  "}
        self.assertFalse(self.request("/api/home")[1]["followup"])
        self.assertEqual(self.request(path, data)[0], 503)
        self.assertFalse(self.request(solve)[1]["explanation_opened"])
        self.server.grader = Grader(port=model.server_port)
        self.assertTrue(self.request("/api/home")[1]["followup"])

        self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request(path, data, origin="http://elsewhere.local")[0], 403)
        self.assertEqual(self.request(path, {**data, "mode": "example"})[0], 404)
        self.assertEqual(self.request(path, {**data, "id": "slider"})[0], 404)
        self.assertEqual(self.request("/api/ask-further/"+key+"/compare-lines", data)[0], 404)
        for bad in (None, True, "   ", "x" * 361, "\x00pick"):
            self.assertEqual(self.request(path, {**data, "question": bad})[0], 400)
        self.assertEqual(self.request(path, {**data, "note": "Not the authored note"})[0], 400)
        address = self.server.server_address
        try:
            # Use the real LAN guard without opening a LAN listener for the test.
            self.server.server_address = ("192.0.2.14", self.server.server_port)
            self.assertFalse(self.request("/api/home")[1]["followup"])
            self.assertEqual(self.request(path, data)[0], 403)
        finally:
            self.server.server_address = address
        self.assertEqual(model_calls, [])

        self.request("/api/draft/" + task, {"answer": "Draft marker that must not be sent."})
        _, prior = self.request("/api/attempt/" + task, {"answer": "Prior answer marker.", "help": "no-help"})
        self.assertEqual(prior["assistance"], "independent")
        self.assertEqual(self.request(path, data), (200, {"reply": None}))
        for _ in range(5):
            self.assertEqual(self.request(path, data)[0], 503)
        self.assertFalse(self.request(solve)[1]["explanation_opened"])
        slot = self.server.grader.slot
        with slot:
            self.assertEqual(self.request(path, data)[0], 503)
        self.assertEqual(len(model_calls), 6)

        self.assertEqual(self.request(path, data), (200, {"reply": "A steeper line changes height faster."}))
        for route, request in model_calls:
            self.assertEqual(route, "/v1/chat/completions")
            self.assertEqual(request["response_format"]["json_schema"]["name"], "study_followup")
            self.assertEqual(json.loads(request["messages"][1]["content"]), {
                "term": "Slope", "language": "en", "mode": "definition",
                "question": data["question"].strip(),
                "note": "A line’s slope tells you how much $y$ changes when $x$ increases by one unit.",
            })
        saved = self.request(solve)[1]
        self.assertTrue(saved["explanation_opened"])
        self.assertIn("Draft marker", saved["draft"]["answer"])
        self.assertEqual(saved["history"], [prior])
        _, after = self.request("/api/attempt/" + task, {"answer": "A later answer.", "help": "no-help"})
        self.assertEqual(after["support_used"], ["explanation"])
        self.assertEqual(after["assistance"], "prompted")
        export = self.request("/api/export", {"ids": [after["id"]]})[1]
        for record in (saved, export):
            self.assertNotIn("changes here", json.dumps(record))
            self.assertNotIn("changes height", json.dumps(record))

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
