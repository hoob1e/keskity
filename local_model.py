"""One bounded llama.cpp connection path for every optional model feature."""
import http.client
import json
import threading
from time import monotonic

from model_stream import INVALID_REPLY, MAX_CONTENT, TRUNCATED_REPLY, streamed_content, unique_fields

MODEL_STREAM = "application/x-ndjson"


class ModelError(ValueError):
    pass


class ModelStreamClosed(Exception):
    """The browser disconnected while receiving model text."""


class LocalModel:
    def __init__(self, port=None, model="study-grader", timeout=40):
        self.port = port
        self.model = model
        self.timeout = timeout
        self.slot = threading.BoundedSemaphore(1)

    def readiness(self):
        """Ask the configured local server for health, without reserving an inference slot."""
        if self.port is None:
            return "off"
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=1.5)
        try:
            conn.request("GET", "/health")
            with conn.getresponse() as response:
                if response.status not in (200, 503):
                    return "unavailable"
                payload = response.read(4097)
                if len(payload) > 4096:
                    return "unavailable"
                data = json.loads(payload)
                if not isinstance(data, dict):
                    return "unavailable"
                if response.status == 200 and data.get("status") == "ok":
                    return "ready"
                error = data.get("error")
                if response.status == 503 and isinstance(error, dict) and error.get("message") == "Loading model":
                    return "starting"
        except (OSError, http.client.HTTPException, ValueError, RecursionError):
            pass
        finally:
            conn.close()
        return "unavailable"

    def request(self, subject, schema, guide, name, *, on_text=None):
        if self.port is None:
            raise ModelError("The local model is off.")
        source = json.dumps(subject, ensure_ascii=False)
        if len(source) > 7500:
            raise ModelError("This request is too long for the local model.")
        if not self.slot.acquire(blocking=False):
            raise ModelError("The local model is busy. Try again in a moment.")
        deadline = monotonic() + self.timeout
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=self.timeout)
            try:
                request = {
                    "model": self.model, "stream": on_text is not None, "max_tokens": 260, "temperature": 0,
                    "chat_template_kwargs": {"enable_thinking": False},
                    "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
                    "messages": [{"role": "system", "content": guide}, {"role": "user", "content": source}],
                }
                conn.request("POST", "/v1/chat/completions", json.dumps(request).encode("utf-8"), {"Content-Type": "application/json"})
                with conn.getresponse() as response:
                    if response.status != 200:
                        raise ModelError("The local model is not ready. Check llama.cpp and try again.")
                    expected = set(schema["required"])
                    mime = response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
                    if mime == "text/event-stream" and on_text is not None:
                        raw = streamed_content(response, expected, on_text, deadline)
                    else:
                        # A local server may answer with a single JSON object instead.
                        payload = response.read(65537)
                        if len(payload) > 65536:
                            raise ModelError(INVALID_REPLY)
                        item = json.loads(payload)["choices"][0]
                        if not isinstance(item, dict):
                            raise ModelError(INVALID_REPLY)
                        if item.get("finish_reason") == "length":
                            raise ModelError(TRUNCATED_REPLY)
                        raw = item["message"]["content"]
                    result = json.loads(raw, object_pairs_hook=unique_fields) if isinstance(raw, str) and len(raw) <= MAX_CONTENT else None
                    if not isinstance(result, dict) or set(result) != expected:
                        raise ModelError(INVALID_REPLY)
                    return result
            except (OSError, http.client.HTTPException) as exc:
                raise ModelError("The local model is unavailable or timed out. Check that llama.cpp is running.") from exc
            except ModelError:
                raise
            except (TypeError, ValueError, IndexError, KeyError, RecursionError) as exc:
                message = TRUNCATED_REPLY if str(exc) == TRUNCATED_REPLY else INVALID_REPLY
                raise ModelError(message) from exc
            finally:
                conn.close()
        finally:
            self.slot.release()
