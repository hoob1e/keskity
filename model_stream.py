"""Read llama.cpp SSE and expose only the prose in a flat structured reply."""
import json
import re
from time import monotonic
import unicodedata


REPLY_LIMIT = 800
COMMENT_LIMIT = 1000
PROSE_LIMITS = {"reply": REPLY_LIMIT, "feedback": COMMENT_LIMIT, "next_step": COMMENT_LIMIT}
INVALID_REPLY = "The local model did not return a usable reply."
TRUNCATED_REPLY = "The local model did not finish its reply. Try again."
MAX_CONTENT = 16 * 1024
MAX_EVENTS_BYTES = 512 * 1024

# Match the complete characters/escapes available so far, not the closing quote.
STRING_PREFIX = re.compile(r'"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*')
DECODER = json.JSONDecoder()


def valid_prose(value, limit):
    return (isinstance(value, str) and bool(value.strip()) and len(value) <= limit
            and all(unicodedata.category(c) not in {"Cc", "Cs"} or c in "\t\n\r" for c in value))


def unique_fields(pairs):
    result = dict(pairs)
    if len(pairs) != len(result):
        raise ValueError(INVALID_REPLY)
    return result


def text_prefixes(raw, allowed):
    """Read top-level string prefixes only. Partial objects are never results."""
    raw = raw.lstrip()
    if not raw.startswith("{"):
        return
    index, seen = 1, set()
    while index < len(raw):
        index += len(raw[index:]) - len(raw[index:].lstrip())
        if raw[index:index + 1] != '"':
            return
        try:
            key, end = DECODER.raw_decode(raw, index)
        except ValueError:
            return  # Key not complete yet.
        if key not in allowed or key in seen:
            return
        seen.add(key)
        tail = raw[end:].lstrip()
        if not tail.startswith(":"):
            return
        index = len(raw) - len(tail[1:].lstrip())
        if raw[index:index + 1] == '"':
            end = STRING_PREFIX.match(raw, index).end()
            closed = raw[end:end + 1] == '"'
            if key in PROSE_LIMITS:
                value = json.loads(raw[index:end] + '"')
                if not closed and value and "\ud800" <= value[-1] <= "\udbff":
                    value = value[:-1]  # A low surrogate may arrive in the next delta.
                if valid_prose(value, PROSE_LIMITS[key]):
                    yield key, value.lstrip()
            if not closed:
                return
            index = end + 1
        else:
            try:
                value, index = DECODER.raw_decode(raw, index)
            except ValueError:
                return
            if value is not None and type(value) is not int:
                return
        tail = raw[index:].lstrip()
        if not tail.startswith(","):
            return
        index = len(raw) - len(tail) + 1


def sse_data(response, deadline):
    buffer = b""
    lines = []
    total = 0
    while data := response.read1(8192):
        total += len(data)
        if total > MAX_EVENTS_BYTES:
            raise ValueError(INVALID_REPLY)
        if monotonic() >= deadline:
            raise TimeoutError
        *complete, buffer = (buffer + data).split(b"\n")
        for line in complete:
            line = line.removesuffix(b"\r")
            if not line:
                if lines:
                    yield b"\n".join(lines)
                    lines.clear()
            elif line == b"data" or line.startswith(b"data:"):
                lines.append(line[5:].removeprefix(b" "))


def streamed_content(response, allowed, on_text, deadline):
    raw, finish = "", None
    displayed = {}
    for event in sse_data(response, deadline):
        if event == b"[DONE]":
            if finish != "stop":
                raise ValueError(TRUNCATED_REPLY)
            return raw
        payload = json.loads(event)
        choices = payload["choices"]
        if choices == []:  # Optional usage metadata.
            continue
        if not isinstance(choices, list) or len(choices) != 1 or finish is not None:
            raise ValueError(INVALID_REPLY)
        item = choices[0]
        if not isinstance(item, dict) or item.get("index", 0) != 0:
            raise ValueError(INVALID_REPLY)
        finish = item.get("finish_reason")
        if finish == "length":
            raise ValueError(TRUNCATED_REPLY)
        if finish not in (None, "stop"):
            raise ValueError(INVALID_REPLY)
        delta = item["delta"]
        if not isinstance(delta, dict):
            raise ValueError(INVALID_REPLY)
        piece = delta.get("content")
        if piece is None or piece == "":
            continue
        if not isinstance(piece, str):
            raise ValueError(INVALID_REPLY)
        raw += piece
        if len(raw) > MAX_CONTENT:
            raise ValueError(INVALID_REPLY)
        # Never forward model reasoning, raw JSON, or verdict/points fields.
        for key, value in text_prefixes(raw, allowed):
            previous = displayed.get(key, "")
            if len(value) > len(previous) and value.startswith(previous):
                on_text(key, value[len(previous):])
                displayed[key] = value
    raise ValueError(TRUNCATED_REPLY)
