# Build 02 · Study overview and problem cards

Screenshots of the running app with sample content:

- [Course overview · White Violet](study-light.jpg)
- [Course overview · Graphite](study-dark.jpg)
- [Problem cards](study-problems.jpg)
- [Course overview · Narrow viewport](study-mobile.jpg)
- [Dashboard · Updated typography](dashboard.jpg)

To try this build, run `python3 -B hub.py serve --demo --port 8767`, open <http://127.0.0.1:8767>, and select **Study → DEMO**. To see progress change, submit an answer in the temporary workspace and return through the course breadcrumb.

## What to review

- **Study:** Scope comes from the released packs. The overview, uses, and featured concepts appear when packs supply them. Packs without a course open from **Independent study**.
- **Problems:** Group by topic or pack, sort by title or recent attempts, or filter by status. The bars count checked problems you’ve attempted, not correctness. Investigations stay separate.
- **Hover:** Cards brighten slightly without moving. On touch screens there’s no sticky hover; reduced motion keeps the color feedback but skips the fade.
- **Type:** The rules below replace the inconsistent font changes from the Dashboard review.

| Role | Typeface and use |
| --- | --- |
| Display | C059, then Georgia or serif, for page titles and featured titles such as Resume and Problems. Regular weight. |
| Interface | Inter, then system sans serif, for body text, section headings, labels, metadata, numbers, and controls. Use size, weight, and spacing for hierarchy. |
| Code | System monospace for literal code only. Use tabular digits in the interface for counts and progress. |
| Reading | **Aa** overrides the font only within marked reading content. KaTeX retains its math fonts. |

Continue to [build 03](../build-03/README.md) for the solver and font controls.
