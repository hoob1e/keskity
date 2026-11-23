# Local model in keskity

The Python backend shares one loopback [`llama.cpp` client](local_model.py) for generation and grading. Each action provides its own instructions and data. The app enforces permissions and checks the structured result. The model doesn’t choose which app actions to run and has no shell, web, or vault tools.

## Connection status

**Settings → Local model** makes one read-only request to keskity when opened or refreshed. The app can then call [llama.cpp’s `GET /health`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#get-health-returns-health-check-result) on its configured loopback port. It sends no study text and doesn’t run inference or claim an inference slot.

**Off** means the app wasn’t started with a grader, or is running as a LAN demo. Those states make no health request. **Starting** means llama.cpp reports that it is loading the model. **Ready** means its health check passed, not that an inference slot is free. **Unavailable** means the grader couldn’t be reached or didn’t return a supported health response. There’s no polling, process control, or model configuration in the panel. During an active timed test, Settings still offers only reading controls.

## Explain selection

Selecting text opens **Explain · Definition · Translation** without a model call. Switching tabs or opening a local section doesn’t call the model either. Pack notes are separate: opening a **Provided** section retrieves the reviewed text from local storage.

[`study_passages.py`](study_passages.py) checks that the selection is at most 420 characters and matches a passage in the released material. [`study_model_tools.py`](study_model_tools.py) validates a short reply or `null` for each action.

| Explicit action | Additional input |
| --- | --- |
| **Explain locally** | An optional question of at most 360 characters. Leaving it blank asks for an explanation of the selection as written. |
| **Generate definition** | None. The model is asked for a short definition, not a worked answer. |
| **Translate** | A target language from the app’s supported list. Only the last target language is remembered, in the browser. |

| Where | When available | What else the model receives |
| --- | --- | --- |
| Course or independent-study overview | Local model configured on the host | Selection, language, and the containing published passage if it adds context (up to 600 characters) |
| Checked untimed problem | Same, plus [author opt-in](PACKS.md#local-explanations-for-selections) | Selection and language. No surrounding problem context, draft, answer, or marking material. |
| Active timed test or LAN demo | Unavailable | Nothing |

Generated content is **Unreviewed**. The model is instructed to clarify or translate without solving; that instruction isn’t a guarantee. Keskity does not save the selection, question, or reply. A returned result for an untimed problem records only the existing `explanation` exposure for that edition. Overviews don’t record help exposure.

**Copy explanation prompt** doesn’t use a model. The preview contains only instructions, language, and the selected material by default. The learner can opt into including the surrounding published overview passage, but not the surrounding problem. Copying puts exactly that preview on the clipboard; the app doesn’t send it anywhere. The prompt doesn’t require a Pi or Codex skill. **Check online** is a placeholder, not a lookup.

## Other model actions

- **Ask further:** [`study_followup.py`](study_followup.py) uses the same short-reply validator to clarify a reviewed note the pack author has enabled. It receives the note, term, mode, language, and typed question. It doesn’t receive the exercise, answer key, learner records, or a transcript. The app doesn’t save the conversation.
- **Feedback and test marking:** [`grading.py`](grading.py) uses different instructions and context. It can receive an eligible submitted answer and reviewed marking material. Choice questions use the key without a model.

## Streaming

The browser requests a newline-delimited JSON stream for animated replies. The backend reads text deltas from the same loopback `llama.cpp` connection and forwards only the designated prose fields. It never forwards raw JSON, reasoning deltas, partial verdicts, or points. The browser treats partial prose as text and replaces it with the validated result at completion. With reduced motion, the browser requests the single JSON result instead.

An interrupted or invalid stream leaves no partial feedback, mark, or help exposure in the database. Validated practice feedback and post-test marks are saved as before; Study help replies aren’t saved. The LAN demo does not offer model actions. No new external connections or context fields are involved.

## How to add an interaction

Treat each action as a small app-specific tool, not a new training run or unrestricted chat.

| Part | Decision to make |
| --- | --- |
| Trigger and permission | Decide where the action appears and which pack rules permit it. Enforce those rules in Python. |
| Context | Send only what the action needs. A graph explanation might need the current equation and a selected point, not a draft or key. |
| Model task and result | Give the model one job. Validate the expected JSON and handle a refusal or unavailable model without blocking study. |
| Effect and evidence | Let app code do calculations or apply explicit learner choices. Keep retention and export separate. |
| Review | Test reviewed examples, requests that should be declined, and the same interaction with the model off. Label generated content. |

For richer explanations, start with explicitly imported, released source excerpts and show their references. Keep Pi and Obsidian as the authoring tools.
