# Author a pack for keskity

Start with the installed **problem-sets** skill: agree the scope and help policy, generate prompts and separate solutions or rubrics, check the substance, and publish a v1 packet. The app runs the same release validator. It does not turn a draft or an unresolved investigation into checked practice.

## Imports

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
- Review these fields with the actual problem before publishing; core packet validation does not check graph meaning, answer leakage, or choice correctness. Render the visual at reading size and check that the claim, labels, and view match the problem. Changing an interactive field changes the viewer’s problem version. Changing only the overview or display labels creates a separate pack edition but leaves problem versions unchanged.

Run `python3 -B hub.py check /path/to/published` before pointing the learner to it. Give Pi the selected attempt export for the return leg, not the live database.
