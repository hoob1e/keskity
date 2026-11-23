"""Import rules and public metadata for released practice tests."""
AIDS = ("hints", "interactive_visuals")


def test_config(raw, problems):
    if (not isinstance(raw, dict) or set(raw) - {"minutes", "questions", "allowed_aids", "grade_scale"}
            or type(raw.get("minutes")) is not int or not 1 <= raw["minutes"] <= 240):
        raise ValueError("A practice test needs a time limit of 1–240 whole minutes.")
    questions = raw.get("questions")
    if not isinstance(questions, list) or not 1 <= len(questions) <= 40:
        raise ValueError("A practice test needs 1–40 ordered questions.")
    checked = {p["id"]: p for p in problems if p["status"] == "checked"}
    if len(checked) != len(problems) or len(questions) != len(checked):
        raise ValueError("A test must list every active problem, and every one must be checked practice.")

    ordered, seen = [], set()
    for row in questions:
        if (not isinstance(row, dict) or set(row) != {"id", "points"} or not isinstance(row["id"], str)
                or row["id"] not in checked or row["id"] in seen
                or type(row["points"]) is not int or not 1 <= row["points"] <= 100):
            raise ValueError("List each checked problem ID once, with 1–100 whole points.")
        problem = checked[row["id"]]
        if not problem["choice"] and not problem["rubric"].strip():
            raise ValueError(f"{row['id']}: a written test question requires a reviewed point rubric.")
        seen.add(row["id"])
        ordered.append({"id": row["id"], "points": row["points"]})
    allowed = validate_aids(raw.get("allowed_aids", []), AIDS)
    total = sum(q["points"] for q in ordered)
    result = {"minutes": raw["minutes"], "questions": ordered, "allowed_aids": allowed}
    if "grade_scale" in raw:
        result["grade_scale"] = grade_scale(raw["grade_scale"], total)
    return result


def validate_aids(value, allowed):
    if (not isinstance(value, list) or any(not isinstance(a, str) or a not in allowed for a in value)
            or len(value) != len(set(value))):
        raise ValueError("Choose only distinct aids allowed by this test.")
    return [a for a in AIDS if a in value]


def grade_scale(value, total):
    if not isinstance(value, list) or not 1 <= len(value) <= 20:
        raise ValueError("A grade scale needs 1–20 point thresholds, including zero.")
    seen, scale = set(), []
    for row in value:
        if (not isinstance(row, dict) or set(row) != {"minimum_points", "label"}
                or type(row["minimum_points"]) is not int or not 0 <= row["minimum_points"] <= total
                or row["minimum_points"] in seen or not isinstance(row["label"], str)
                or not 1 <= len(row["label"].strip()) <= 30):
            raise ValueError("Use distinct whole-point grade thresholds and short labels.")
        seen.add(row["minimum_points"])
        scale.append({"minimum_points": row["minimum_points"], "label": " ".join(row["label"].split())})
    if 0 not in seen:
        raise ValueError("Include a grade threshold for zero points.")
    return sorted(scale, key=lambda row: row["minimum_points"], reverse=True)


def test_summary(pack):
    test = pack["test"]
    return {
        **{k: pack[k] for k in ("key", "title", "course")},
        "minutes": test["minutes"],
        "count": len(test["questions"]),
        "points": sum(q["points"] for q in test["questions"]),
        "allowed_aids": test["allowed_aids"],
    }


def can_model_mark(problem):
    return not (problem["choice"] or problem["visual"] or any(a["role"] == "prompt" for a in problem["assets"]))
