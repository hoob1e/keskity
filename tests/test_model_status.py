"""Check only the configured grader's health, without sending model prompts."""
from contextlib import closing
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from socket import AF_INET, SOCK_STREAM, socket
import threading
import unittest

from grading import Grader
from hub import Handler, HubHTTP


class HealthStub(BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.calls.append((self.command, self.path, self.headers.get("Content-Length")))
        status, payload = self.server.reply
        self.send_response(status)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        pass


class ModelStatusTest(unittest.TestCase):
    def serve(self, server):
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        thread.start()
        def cleanup():
            server.shutdown()
            server.server_close()
            thread.join()
        self.addCleanup(cleanup)
        return server

    def setUp(self):
        self.stub = self.serve(ThreadingHTTPServer(("127.0.0.1", 0), HealthStub))
        self.stub.reply = (200, b'{"status":"ok"}')
        self.stub.calls = []
        self.app = self.serve(HubHTTP(("127.0.0.1", 0), Handler))
        self.app.origin = "http://127.0.0.1:" + str(self.app.server_port)
        self.app.grader = Grader(self.stub.server_port)
        # No status calculation should depend on a pack or learner record.
        self.app.store = None

    def read_status(self):
        with closing(http.client.HTTPConnection("127.0.0.1", self.app.server_port, timeout=3)) as conn:
            conn.request("GET", "/api/model-status")
            with conn.getresponse() as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader("Cache-Control"), "no-store")
                return json.load(response)

    def test_reports_health_each_time_without_using_the_model_slot(self):
        self.assertEqual(self.stub.calls, [])
        with self.app.grader.slot:
            for status, response, want in [
                (503, b'{"error":{"code":503,"message":"Loading model","type":"unavailable_error"}}', "starting"),
                (200, b'{"status":"ok"}', "ready"),
                (503, b'{"error":{"message":"unexpected"}}', "unavailable"),
                (200, b'{"status":"ok"}' + b" " * 4096, "unavailable"),
                (200, b'"ok"', "unavailable"),
                (200, b'<html>not grader health</html>', "unavailable"),
                (302, b'{"status":"ok"}', "unavailable"),
            ]:
                with self.subTest(status=status, response=response[:40]):
                    self.stub.reply = status, response
                    self.assertEqual(self.read_status(), {"state": want, "port": self.stub.server_port})
        self.assertEqual(self.stub.calls, [("GET", "/health", None)] * 7)

    def test_off_and_lan_do_not_contact_grader(self):
        bound = self.app.server_address
        try:
            self.app.server_address = ("192.0.2.30", bound[1])
            self.assertEqual(self.read_status(), {"state": "off", "host_only": True})
        finally:
            self.app.server_address = bound
        self.app.grader = Grader()
        self.assertEqual(self.read_status(), {"state": "off"})
        self.assertEqual(self.stub.calls, [])

    def test_refused_connection_is_unavailable(self):
        # Hold the ephemeral port without listening so no unrelated process can bind it.
        with socket(AF_INET, SOCK_STREAM) as reserved:
            reserved.bind(("127.0.0.1", 0))
            port = reserved.getsockname()[1]
            self.app.grader = Grader(port)
            self.assertEqual(self.read_status(), {"state": "unavailable", "port": port})
        self.assertEqual(self.stub.calls, [])
