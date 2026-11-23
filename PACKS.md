# Author a pack for keskity

Start with the installed **problem-sets** skill: agree the scope and help policy, generate prompts and separate solutions or rubrics, check the substance, and publish a v1 packet. The app runs the same release validator. It does not turn a draft or an unresolved investigation into checked practice.

## First pack: author, check, import

In a separate Pi chat, give the skill the course, topic, and relevant source pages or notes. For example:

> /skill:problem-sets Plan an individual, untimed keskity pilot on [topic] for [course code] using [sources]. Start with 3–5 problems and wait for my approval before writing them. Keep reviewed solutions or rubrics separate from the prompts. Export a released v1 packet to a new folder I approve, then run the keskity import check. Keep learner records out of the pack.

Use the actual course code to group the pack under a course. Omit `course` for independent study. Plain text and math are enough for a first pack; [display metadata](#optional-study-metadata-and-interactive-fields) and [reviewed vocabulary help](#reviewed-inline-study-help) are optional. If you want to try local written feedback, include at least one checked written problem that doesn’t depend on a figure.

The skill’s standard `export` command produces the importable `set.json` and copies declared images. From the keskity checkout, verify the exported folder:

```sh
python3 -B hub.py check /path/to/published
```

Run keskity without `--demo`, then choose **Import → Choose folder** and select that export. Use **Choose set.json only** if it has no images. Open the imported pack in **Study**. The app copies the practice material and leaves the original folder untouched.

The import check verifies compatibility, not whether a problem is correct or well designed. Keep the substantive review in the authoring workflow. To review your work later, export only the attempts you select in keskity; don’t share the live database.

## Import format

- Use the folder directly containing `set.json` and any `assets/`. Images must be declared with the correct hash and prompt/support role. PNG, JPEG, WebP, GIF, and static SVG are supported; arbitrary HTML, executable widgets, remote images, and non-image documents are not.
- Markdown and KaTeX are rendered locally. Use ordinary Markdown images linking to a declared asset and `$...$` / `$$...$$` for math. External links are displayed as text. Native Obsidian embeds and Canvas files do not become interactive in this viewer.
- Put the standard solution, rubric, and hints in the problem's `support` object. Keep the key out of the prompt, visual caption, and filenames. The UI separates views, but the original pack still contains answers: it is not a secure exam format.

## Optional Study metadata and interactive fields

Add this object under the packet's existing `extensions.studyHub`. Keys under `items` must be existing problem IDs. Both `study` and `items` are optional. The app renders this data without executing it.

```json
{
  "version": 1,
  "study": {
    "title": "Linear functions",
    "overview": "Connect the numbers in a line’s equation to its graph.",
    "uses": "Compare costs with a fixed starting fee and a price per kilometre.",
    "concepts": ["Slope", "Intercept"],
    "fact": "On a speed–time graph, a horizontal line above zero represents steady motion."
  },
  "items": {
    "moving-slope": {
      "title": "Change the slope",
      "topic": "Reading a line",
      "visual": {
        "kind": "line",
        "caption": "Vary the slope and compare where the line meets each axis.",
        "slope": 1,
        "intercept": 2,
        "slider": true
      }
    },
    "intercept-check": {
      "choice": {
        "options": ["$(-2,0)$", "$(0,3)$", "$(0,-2)$"],
        "correct_index": 2
      }
    }
  }
}
```

- Use `study` for plain text that describes the course or, without a course code, the independent pack. Each field is optional. When several packs share a course code, Study uses the latest available title, overview, use, and fact; it combines their scope and concepts.
- Problem titles and topics are optional plain text. Leave out solution cues. Without these fields, the app uses the problem ID for the title and the pack for the group.
- A `line` is \(y=mx+b\). `slope` is −3 to 3 and `intercept` is −4 to 4. The slider varies only the slope.
- A `choice` uses two to six distinct options and a **zero-based** index. The author must check the key against the existing reviewed solution. Use it for checked practice, not for an open investigation.
- Review these fields with the actual problem before publishing; core packet validation does not check graph meaning, answer leakage, or choice correctness. Render the visual at reading size and check that the claim, labels, and view match the problem. Changing interactive fields or help permissions changes the viewer’s problem version. Changing only the overview or display labels creates a separate pack edition but leaves problem versions unchanged.

## Reviewed inline study help

For a checked, untimed problem, add an optional `inline_help` array under that problem’s `extensions.studyHub.items` entry. Adding it opts that question in. Here is an entry for a question that allows vocabulary help:

```json
{
  "id": "slope",
  "term": "Slope",
  "aliases": ["gradient"],
  "definition": "A line’s slope tells you how much $y$ changes when $x$ increases by one unit.",
  "example": "A ramp that rises 3 metres over a horizontal distance of 6 metres has a slope of $1/2$.",
  "translation": {"lang": "fi", "text": "**Kulmakerroin**."}
}
```

- Use 1–12 entries per problem. Give each entry a distinct lowercase ID and a display term, with up to six optional aliases. Matching uses the complete selected term or alias, ignoring case, extra spaces, and trailing sentence punctuation. Include common inflections as aliases when needed.
- Provide at least one of `definition`, `example`, or `translation` (each body: up to 1,000 characters of Markdown and math, without images). A translation needs a language tag, such as `fi`, and its text. An optional plain-text `credit` identifies the source or locator.
- Check each entry against the problem’s approved help policy. Keep the target inference, worked answer, and solution cues out of the term, aliases, and support text. Omit the array if the question does not allow vocabulary help. The app rejects inline help in timed test editions.
- The app shows term labels in the **Study help** list and sends a note body only when opened. It records an explanation exposure, not the selected text or a lookup log. A changed note creates a new pack edition and problem version; it does not change previous attempts.

### Optional local follow-ups

To let learners ask the local model to clarify a reviewed note, add `"ask_further": ["definition"]` to its `inline_help` entry. This enables **Ask further** only while reading the provided definition for that entry. List only existing modes from `definition`, `example`, and `translation`; omit the field to keep the note reviewed-only.

Opt in only where rephrasing the note won’t give away the exercise’s target reasoning. The model receives just that note’s text, term, mode, language, and the learner’s typed question (up to 360 characters). It does not get the exercise or its key. Generated replies are **Unreviewed**, not additions to the released pack. Changing this permission creates a new edition and problem version.

### Local explanations for selections

To allow local explanations, definitions, and translations of a checked, untimed problem’s visible reading text, add `"explain_selection": true` under its `extensions.studyHub.items` entry, alongside fields such as `title` and `inline_help`. You don’t need an authored entry for each term. Leave it off if explaining, defining, or translating the wording could give away the target reasoning. Older editions don’t inherit the permission. This opt-in is independent of note-specific `ask_further`.

The same opt-in enables **Copy explanation prompt** for the selected problem text. It doesn’t permit online lookup. Local model actions receive the selection and language, plus the learner’s optional question for an explanation or target language for translation. They don’t receive the surrounding problem, answer key, or drafts. The model is instructed not to solve the problem. Use reviewed-only help where that boundary matters. Timed test editions can’t enable this option.

Course and independent-study overview text supports local selection help without a permission flag. The app can use a short surrounding passage to clarify the selection. A copied prompt includes that surrounding passage only when the learner chooses it.

## Timed practice test editions

Add a `test` object alongside `study` and `items` in `extensions.studyHub` (version 1). The edition then appears under **Practice tests**, not in the untimed solver. This example assumes the two question IDs are the only active problems in the pack.

```json
{
  "minutes": 25,
  "questions": [
    {"id": "intercept-check", "points": 3},
    {"id": "moving-slope", "points": 5}
  ],
  "allowed_aids": ["hints"],
  "grade_scale": [
    {"minimum_points": 0, "label": "Not yet"},
    {"minimum_points": 6, "label": "Pass"}
  ]
}
```

- Use 1–240 whole minutes and 1–40 questions. List every active checked problem exactly once, in test order, with 1–100 whole points per question. Exclude retired problems and keep investigations in a separate pack.
- A choice gets all its points or none from the reviewed key. For a written question, put a point-by-point marking rubric in `support.rubric`; check that the criteria add to the question’s point value. A worked solution is optional if the rubric stands on its own. When the model cannot mark a response, the learner can use this rubric.
- Omit `allowed_aids` for a test with no optional aids. Supported IDs are `hints` (excluding any hint marked `reveals_target`) and `interactive_visuals` (the slope slider). Learners opt in before starting. Prompt figures and static graphs always appear. Check that every question is answerable without the optional aids, and keep worked solutions and answer cues out of prompt images and captions.
- Omit `grade_scale` to report points and a percentage only. To give a course grade, provide up to 20 distinct whole-point thresholds from zero up to the total, with a short label for each. Include zero. The highest threshold met supplies the label once marking is complete.
- Changes to time, order, points, or pack content create a new edition. Attempts stay with the original edition. This is practice, not browser lockdown or a secure exam format.

Use the same [publish and import check](#first-pack-author-check-import) for a timed edition.
