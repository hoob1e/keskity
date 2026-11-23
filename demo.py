"""Fictional UI fixtures; never an actual exam or a learner record."""
import json


def fixture(core):
    pack = core["new_packet"]("lines-demo", "Linear functions", "exam-prep")
    pack["course"] = "DEMO"
    plan = pack["plan"]
    plan.update({
        "goal": "Exercise the viewer with fictional math prompts.",
        "scope": ["Slope and intercept", "Interpreting a line"],
        "context": {"prerequisites": "Read x and y on a graph.", "challenge": "Explain a relationship.", "source_coverage": "Invented demo."},
        "probe": {"method": "reasoning-sample", "evidence": "Synthetic interface fixture.", "limitations": "No learner observed."},
        "help": {"protected_reasoning": ["Distinguish slope and intercept."], "allowed_support": ["An optional authored hint"],
                 "reveal_policy": "Try an answer before looking at the solution. Open hints only when you want a nudge.",
                 "independence_conditions": "No hint or solution used.", "checkpoints": "Compare after submitting."},
        "steering": {"mode": "focused", "policy": "One problem at a time."},
        "support_contract": "Include a short worked key.",
        "recording_policy": "Demo is isolated and discarded on exit.",
    })
    plan["approval"] = {"status": "approved", "basis": "Synthetic software fixture only, not recorded consent.",
                        "digest": core["plan_digest"](plan)}
    def task(pid, statement, solution, hint, check):
        return {
            "id": pid, "kind": "practice", "status": "checked", "statement": statement,
            "origin": {"mode": "create", "rationale": "Fictional interface fixture.", "changes": "None."},
            "design": {"intent": "Interpret a line.", "foothold": "Use the displayed equation.", "reasoning": "Connect a parameter to the graph.", "evidence": "A short explanation."},
            "source_ids": [], "depends_on": [], "assets": [],
            "support": {"hints": [{"id":"first-step","text":hint,"reveals_target": False}], "solution":solution, "rubric":"","tutor_notes":""},
            "review": {"criteria": dict.fromkeys(core["CRITERIA"], True), "checks":[
                {"method":"derivation","result":"pass","scope":"Synthetic algebra","evidence":check,"source_ids":[]}], "issues":[]},
        }
    pack["problems"] = [
        task("moving-slope", "Start with $y=mx+2$. Move the slope slider. **What point stays fixed, and why?**",
             "The point $(0,2)$ stays fixed. At $x=0$ the product $mx$ vanishes for every slope.",
             "Try substituting $x=0$ into the equation.", "Substitution gives y=2 independently of m."),
        task("compare-lines", "The lines $y=2x+1$ and $y=2x-3$ have different intercepts. Explain why they never cross.",
             "Both have slope $2$, so they are parallel. The first is always $4$ units higher: $(2x+1)-(2x-3)=4$.",
             "Subtract their $y$-values at an arbitrary $x$.", "Subtract to obtain a constant nonzero vertical separation of 4."),
        task("intercept-check", "Which point is the **vertical intercept** of $y=3x-2$?",
             "The vertical intercept is $(0,-2)$, found by setting $x=0$.",
             "What is the $x$-coordinate of every point on the vertical axis?", "Substituting x=0 yields y=-2."),
    ]
    pack["extensions"] = {"studyHub": {
        "version": 1,
        "study": {
            "title": "Linear functions",
            "overview": "Read graphs and equations as two ways of describing the same relationship. Change a line’s slope, find its intercept, and compare two lines.",
            "uses": "A linear model can separate a fixed cost from a rate, like a delivery fee plus a price per kilometre.",
            "concepts": ["Slope", "Intercept", "Rate of change"],
            "fact": "On a speed–time graph, a horizontal line above zero represents steady motion.",
        },
        "items": {
            "moving-slope": {"title": "Change the slope", "topic": "Reading a line",
                             "visual": {"kind": "line", "caption": "Vary the slope and compare where the line meets each axis.",
                                        "slope": 1, "intercept": 2, "slider": True}},
            "compare-lines": {"title": "Compare two lines", "topic": "Comparing lines"},
            "intercept-check": {"title": "Find the intercept", "topic": "Reading a line",
                                "choice": {"options": ["$(-2,0)$", "$(0,3)$", "$(0,-2)$"], "correct_index": 2}},
        },
    }}
    return json.dumps(pack, ensure_ascii=False)


def help_fixture(core):
    """Fictional vocabulary notes that leave the invariant-point reasoning open."""
    pack = json.loads(fixture(core))
    plan = pack["plan"]
    plan["help"]["allowed_support"] += ["Reviewed vocabulary notes from the pack", "Local vocabulary and wording help"]
    plan["help"]["reveal_policy"] = (
        "Use study help for wording, not for solving the problem. Try an answer before consulting the solution."
    )
    plan["help"]["independence_conditions"] = "No in-app study help, hint, solution, or outside help used."
    plan["approval"]["digest"] = core["plan_digest"](plan)
    item = pack["extensions"]["studyHub"]["items"]["moving-slope"]
    item["explain_selection"] = True
    item["inline_help"] = [
        {
            "id": "slope", "term": "Slope", "aliases": ["gradient"],
            "definition": "A line’s slope tells you how much $y$ changes when $x$ increases by one unit.",
            "ask_further": ["definition"],
            "example": "A ramp rises $3$ metres over a horizontal distance of $6$ metres. Its slope is $3/6$, or $1/2$.",
            "translation": {"lang": "fi", "text": "**Kulmakerroin**. Se kertoo, kuinka paljon $y$ muuttuu, kun $x$ kasvaa yhdellä."},
        },
        {
            "id": "slider", "term": "Slider",
            "definition": "A control that lets you choose a value by moving a handle along a track.",
        },
    ]
    return json.dumps(pack, ensure_ascii=False)


def test_fixture(core):
    pack = json.loads(fixture(core))
    pack.update(id="lines-test-demo", title="Lines & relationships")
    spec = pack["extensions"]["studyHub"]
    spec["study"] = {
        "overview": "A timed check on intercepts, slope, and what equations tell you about a graph.",
    }
    moving, compare, intercept = pack["problems"]
    moving["statement"] = (
        "The graph shows one member of the family $y=mx+2$. "
        "Does **every** line in this family pass through the same point? "
        "Give its coordinates and use the equation to explain why."
    )
    moving["support"]["rubric"] = (
        "- **2 points** for identifying $(0,2)$.\n"
        "- **3 points** for showing that at $x=0$, the term $mx$ is zero for any $m$, so $y=2$."
    )
    spec["items"]["moving-slope"]["title"] = "A family of lines"
    spec["items"]["moving-slope"]["visual"]["caption"] = "One line from the family."
    compare["support"]["rubric"] = (
        "- **2 points** for identifying the equal slopes or cancelling the $2x$ terms.\n"
        "- **2 points** for explaining why the distinct intercepts or nonzero constant separation rule out an intersection."
    )
    slope = {
        **compare,
        "id": "find-rate",
        "statement": "A line has equation $y=-4x+5$. By how much does $y$ change when $x$ increases by one?",
        "support": {"hints": [], "solution": "It decreases by $4$: the coefficient of $x$ is $-4$.",
                    "rubric": "", "tutor_notes": ""},
        "review": {**compare["review"], "checks": [{"method": "derivation", "result": "pass",
                   "scope": "Synthetic algebra", "evidence": "Subtract y(x) from y(x+1) to obtain -4.", "source_ids": []}]},
    }
    pack["problems"].append(slope)
    spec["items"]["find-rate"] = {"title": "Read the rate of change", "topic": "Slope",
                                 "choice": {"options": ["$-4$", "$4$", "$5$"], "correct_index": 0}}
    spec["test"] = {
        "minutes": 25,
        "questions": [{"id": task["id"], "points": points}
                      for task, points in ((intercept, 3), (slope, 2), (moving, 5), (compare, 4))],
        "allowed_aids": ["hints", "interactive_visuals"],
    }
    return json.dumps(pack, ensure_ascii=False)
