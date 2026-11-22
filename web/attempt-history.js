"use strict";

function showFeedback(fb) {
  const verdict = {correct:"Matches",partial:"Partly supported",incorrect:"Does not match",uncertain:"Uncertain"}[fb.verdict];
  const label = fb.method === "answer-key" ? "Checked answer key" : "Local AI feedback · provisional";
  return div("feedback " + fb.verdict, text("p", label, "eyebrow"),
    text("strong", verdict), text("p", fb.feedback),
    fb.next_step && text("p", fb.next_step, "small"));
}
const assistanceNames = {independent:"No help reported",hinted:"Hint used","worked-explanation":"Solution seen",prompted:"Prior feedback","unknown":"Help not recorded"};

function attemptViews(pack, task, initial) {
  let attempts = initial, busy = false;
  const selected = new Set();
  const host = element("section", {class:"card history"});
  const live = div("live-feedback");
  live.setAttribute("aria-live","polite");
  const refetch = async () => {
    attempts = await api("/api/history/" + pack.key + "/" + encodeURIComponent(task.id));
    paint();
  };
  async function feedback(a) {
    if (busy) return;
    busy = true;
    live.replaceChildren(text("p","Checking your answer against the reviewed key…","muted"));
    paint();
    try {
      const graded = await api("/api/feedback", {id: a.id});
      live.replaceChildren(showFeedback(graded.feedback));
      await refetch();
    } catch (err) {
      live.replaceChildren(text("p", err.message, "error"));
    } finally { busy = false; paint(); }
  }
  async function exportSelected() {
    try {
      const data = await api("/api/export", {ids: [...selected]});
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:"application/json"}));
      const a = element("a", {href:url, download:"study-hub-attempts.json"});
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Exported selected attempts for Pi");
    } catch (err) { toast(err.message); }
  }
  function paint() {
    const exportBtn = button("Export selected for Pi", exportSelected);
    exportBtn.disabled = !selected.size;
    const check = a => {
      const el = element("input", {type:"checkbox","aria-label":"Select this attempt for export"});
      el.checked = selected.has(a.id);
      el.addEventListener("change", () => {
        if (el.checked) selected.add(a.id); else selected.delete(a.id);
        exportBtn.disabled = !selected.size;
      });
      return el;
    };
    const details = attempts.map(a => {
      const label = new Date(a.submitted_at).toLocaleString(undefined, {dateStyle:"medium",timeStyle:"short"});
      const grade = a.feedback ? showFeedback(a.feedback) : null;
      const doCheck = home.grader && task.can_check && !a.feedback
        ? button("Check locally", () => feedback(a)) : null;
      if (doCheck) doCheck.disabled = busy;
      return element("article", {class:"attempt"},
        div("card-top", element("label",{class:"row"},check(a),text("span",label)), pill(assistanceNames[a.assistance])),
        element("details", {}, element("summary", {}, "View saved answer"), text("pre", a.answer, "reading-text"), grade),
        div("row", doCheck, button("Forget attempt", async () => {
          if (!window.confirm("Remove this answer and its feedback from your local history?")) return;
          try {
            await api("/api/forget", {id:a.id});
            selected.delete(a.id);
            live.replaceChildren();
            await updateHome();
            await refetch();
          } catch (err) { toast(err.message); }
        }, "button bare danger")));
    });
    host.replaceChildren(sectionHead("Attempt history", attempts.length ? "Latest " + howMany(attempts.length, "saved attempt") : "Your submitted answers will appear here.",
      attempts.length ? exportBtn : null), ...details);
  }
  paint();
  return {
    host, live,
    saved: async (a, autoCheck) => {
      attempts = [a, ...attempts.filter(prev => prev.id !== a.id)].slice(0,25);
      live.replaceChildren(a.feedback ? showFeedback(a.feedback) : text("p","Answer saved.","muted"));
      paint();
      await updateHome();
      if (autoCheck && !a.feedback) await feedback(a);
    },
  };
}
