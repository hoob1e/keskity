"""Fictional UI fixture; never an actual exam or a learner record."""
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
