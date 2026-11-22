# keskity roadmap

Ideas for the next site changes. Nothing here is scheduled yet.

[Build 03](design/build-03/README.md) includes Focus mode and independent interface, title, and reading fonts. Timed practice tests are the next planned build.

## Dashboard direction

- Keep the app name and quick actions such as import, help, and settings in a compact top bar. Use a sidebar for Dashboard, Data, and Study, with a text-only library of courses, books, and independent areas.
- Make **Resume latest set** easy to find. Put material facts or tips and upcoming exams nearby, with study stats and the activity graph below. Leave the lower card area open until there is a clear use for it.
- Start with the data the app already records: packs, problems attempted, and submissions. The sketch’s “hours studied” and “problems completed” are ideas for future metrics, not alternate labels for existing counts.
- The sketch labels describe what belongs where, not final copy. Use icons where the action is clear, give icon-only controls accessible names, and leave purely visual elements unlabeled.

Local references in `~/Pictures/Screenshots/` (direction, not templates):

| Reference | What to take from it |
| --- | --- |
| `layout.png` | The user’s dashboard sketch: a quiet frame around a prominent resume action and a quick view of what’s next. Treat the card sizes and positions as flexible. |
| `data page reference.png` | Group related information into distinct cards. Use small color accents to help identify subjects. |
| `style reference 1.png` | Keep navigation understated and section headings clear so richer content cards can stand out. The dark palette is inspiration, not a change to the default theme. |

## Study tools

- **Inline help from a selection.** Select text on a question or other material to request a definition, example, or translation. On a problem, check its help policy and use the local model to assess whether the requested help would give too much away. The model cannot override explicit restrictions. Prefer an allowed explanation already in the problem set, in full or shortened. If none exists, generate a short response locally or draw on an attributed Wikipedia or Simple English Wikipedia summary. Cache or prepare these in the background or at import so they open quickly. For online lookups, send only public search terms, not private course or learner context.
- **Ask further.** From the same inline panel, ask the local model a brief follow-up or copy a ready-to-paste prompt for Pi Desktop or another tool. Include the selected passage, question, course, set, and problem or section, plus a pointer to the source course file when available. The learner chooses what to share.
- **Concept activity.** Use the local model to scan imported material in the background for topics and concepts. Link those tags to study activity for a **Concepts explored** view. Optionally log which concepts prompted inline help requests as a clue to what felt unclear. A scan alone is not learner activity, and a lookup does not establish a gap.
- **What is this used for?** Add short motivation notes for courses and concepts in the course overview. The local model can draft them. Example: **MAA06 — Derivative:** “In physics, the derivative of position with respect to time gives velocity.”
- **Learner feedback.** Let learners tag problems or material as hard, easy, boring, interesting, or urgent. Use these tags to sort work and help decide what to study next.

## Wilma and exam history

- **Calendar export.** Import a calendar file exported from Wilma to mark exam weeks. Keep manual exam entry available.
- **Upcoming exams screenshot.** Paste a screenshot of Wilma’s upcoming exams, extract the dates and course details, and let the learner review them before adding them to **Upcoming exams**.
- **Previous exams screenshot.** Extract past exam records and any results shown, then confirm them before saving locally. Use them as context for subjects that felt difficult or for suggesting prerequisites to revisit in a later course. An exam result alone does not establish a concept gap.

## Later

- **Interactive visualization toolkit.** Add authoring tools for interactive 3D or more complex visuals when they make a difficult problem easier to reason about. Start from the existing line widget and [pack authoring contract](PACKS.md).

**Next build to review:** timed practice tests from released test packs.
