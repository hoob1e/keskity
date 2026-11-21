# keskity

A local dashboard for deciding what to study next, opening a released problem set, and keeping a private record of your practice. Pi and Obsidian still handle source notes, planning, generation, and review. The app does not write back to the vault.

## Open the app

On this machine (from the project folder):

```sh
cd ~/Projects/study-hub
python3 -B hub.py serve
```

Open <http://127.0.0.1:8765>. Choose **Import pack** and select the **published** folder that directly contains `set.json` and any `assets/`. A packet without images also opens by itself. Use **Add exam** to enter a name, course code, and date; the code links the card to your imported packs. No exam dates are inferred.

To explore safely with an invented set and a temporary database:

```sh
python3 -B hub.py serve --demo --port 8767
```

Open <http://127.0.0.1:8767>. Try the graph slider, use the theme selector, or submit an answer to the last problem for a deterministic check. Demo records disappear when it stops.

You can also import from the terminal:

```sh
python3 -B hub.py check "/path/to/published"
python3 -B hub.py import "/path/to/published"
```

The first command checks compatibility without saving. Both run the installed `problem-sets` skill's release validator. The app copies the relevant practice content and images, not incoming learner attempts, tutor notes, plan evidence, or resume state. Re-importing an identical edition does not duplicate it. Changed editions stay separate so old attempts are not attributed to a changed task.

## Optional local feedback

Multiple-choice checks use the pack's answer key and do not need a model. Written responses are saved even if the model is off or unreachable. To turn on advisory checking with the installed Qwen3 model, run these in **two terminals** from the project folder:

```sh
# First terminal: model only, using your existing GGUF
sh start-grader.sh

# Second terminal: app, with checking enabled
python3 -B hub.py serve --grader-port 8766
```

If the app is already running on 8765 without the flag, stop it with Ctrl+C and restart it. No answers are sent to a cloud service. When checked, the local model receives only that submission, the problem statement, its language, and its reviewed solution/rubric. It returns a verdict, feedback, and a suggested next step. AI verdicts are **provisional**: the model can miss valid reasoning or disagree on partial credit. Disable **Check locally after saving** on an individual submission if you prefer to compare it yourself. You can request a check later from its history. Text-only checked practice is eligible in v1; the model is not asked to judge graphs or images it cannot see.

Both services listen only on loopback. They are for one learner on their own machine, not for publishing to a network. Stop them with Ctrl+C; there is no background service or model download. To use another existing GGUF, set `STUDY_HUB_MODEL` when launching the grader. Both processes must use the same grader port if you change the default.

## What the dashboard measures

- **Attempted** means you submitted at least one answer to a checked problem in that edition. It doesn't mean correct or mastered.
- The activity graph counts submissions, including retries, over the last 35 local calendar days. Neither exam dates nor browsing count as practice.
- History includes the exact problem version, answer, time, and reported help. Revealing an in-app hint or solution affects later submissions; feedback shown *after* a submission does not retroactively change that attempt.
- Select the entries you want from a problem's history and choose **Export selected for Pi**. Give the downloaded JSON to Pi when you want tutoring or a retry. The course's `Learning Record.md` stays the concise summary; the app does not maintain a second mastery profile.

Answers and feedback live in `~/.local/share/study-hub/study.db` (or under `$XDG_DATA_HOME/study-hub/`). This is a private local database, not encrypted storage. **Forget attempt** removes that entry from app history. Downloads and backups are separate copies. Back up the database with the app stopped. Use another `--data-dir` **before** the command to start a separate workspace.

## Use the existing Pi workflow

```text
Pi plans, authors, and reviews → released set.json + assets/
keskity imports → solves and records → selected attempts JSON
Pi reads only that export when asked
```

Ordinary v1 practice packets work as-is. For interactive visuals or keyed questions, see [the small authoring contract](PACKS.md). Keep existing Markdown exports as the fallback for the upcoming exams.

## Project files and checks

- `hub.py` serves the local UI. `packs.py` adapts reviewed packets. `store.py` keeps application state in SQLite.
- `grading.py` is the optional Qwen bridge; it has no tools or vault access. `web/` renders the interface, themes, and graph widget. Markdown-it and KaTeX are installed in this project, not loaded from a CDN.
- Requires Python 3.11+, the trusted `problem-sets` validator (default `~/.agents/skills/problem-sets/scripts/problem_sets.py`), and the npm dependencies. Run `npm ci --ignore-scripts` after moving/cloning the code; no global Python packages are needed.

```sh
python3 -B -m unittest discover -s tests -v
node tests/smoke_browser.mjs
```

The browser test uses local Chromium and Node 22+ with temporary fictional data. Set `STUDY_HUB_TEST_GRADER_PORT=8766` to include the real model if you have already started it.

**Next useful step:** use one small released pack for a real exam topic. Compare the model's comments with the reviewed key on a few different kinds of answers before relying on it. Add other visual types only where the pilot shows they would help.
