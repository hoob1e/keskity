# Author a pack for keskity

Start with the installed **problem-sets** skill: agree the scope and help policy, generate prompts and separate solutions or rubrics, check the substance, and publish a v1 packet. The app runs the same release validator. It does not turn a draft or an unresolved investigation into checked practice.

## Imports

- Use the folder directly containing `set.json` and any `assets/`. Images must be declared with the correct hash and prompt/support role. PNG, JPEG, WebP, GIF, and static SVG are supported; arbitrary HTML, executable widgets, remote images, and non-image documents are not.
- Markdown and KaTeX are rendered locally. Use ordinary Markdown images linking to a declared asset and `$...$` / `$$...$$` for math. External links are displayed as text. Native Obsidian embeds and Canvas files do not become interactive in this viewer.
- Put the standard solution, rubric, and hints in the problem's `support` object. Keep the key out of the prompt, visual caption, and filenames. The UI separates views, but the original pack still contains answers: it is not a secure exam format.

## Optional interactive fields

Add this object under the packet's existing `extensions.studyHub`. Keys under `items` must be existing problem IDs. Omit an option you don't need. These are instructions to the viewer, not code it executes.

```json
{
  "version": 1,
  "items": {
    "moving-slope": {
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

- A `line` is \(y=mx+b\). `slope` is −3 to 3 and `intercept` is −4 to 4. The slider varies only the slope. The user picks the colors in the app.
- A `choice` uses two to six distinct options and a **zero-based** index. The author must check the key against the existing reviewed solution. Use it for checked practice, not for an open investigation.
- Review these fields with the actual problem before publishing; core packet validation does not check graph meaning, answer leakage, or choice correctness. Render the visual at reading size and check that the claim, labels, and view match the problem. Changing an interactive field changes the viewer's problem version.

Run `python3 -B hub.py check /path/to/published` before pointing the learner to it. Give Pi the selected attempt export for the return leg, not the live database.
