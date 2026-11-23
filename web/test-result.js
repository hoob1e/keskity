"use strict";

const markingLabels = {
  "answer-key": "Answer key",
  "self": "Self-marked with rubric",
  "local-model": "Local model · provisional",
  "pending": "Pending",
  "unanswered": "Unanswered",
};

function usedTime(attempt) {
  const seconds = Math.floor((attempt.ended_ms - attempt.started_ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? minutes + " min " + (seconds % 60) + " s" : seconds + " s";
}

function testResult(state) {
  const {test, attempt} = state;
  const path = testApi(test.key, attempt.id);
  const image = testImage(test.key, attempt.id);
  const back = testArea(test);
  const page = div("test-result");
  const scoreCard = element("section", {class: "card test-score ambient-card", "aria-label": "Score"});
  const tbody = element("tbody");
  const detailRow = (label, glyph, value) => div("result-detail",
    element("dt", {}, icon(glyph), label), text("dd", value));
  const status = element("span", {class: "small error", role: "alert"});
  let questions = state.questions, drawer, openQuestion, disposed = false;
  let reviewRequest = 0;
  const answeredCount = questions.filter(q => q.answered).length;
  const reviewAll = button(["Review answers", icon("arrow")], () => showReview(0, reviewAll));
  const exportButton = button(["Export this attempt", icon("down")], async () => {
    exportButton.disabled = true;
    status.textContent = "";
    try {
      const data = await api(path + "/export", {});
      if (disposed) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
      const download = element("a", {href: url, download: "study-hub-test-" + attempt.id.slice(0, 8) + ".json"});
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      status.textContent = err.message;
    } finally {
      exportButton.disabled = false;
    }
  });

  function paintResult(score) {
    const settled = score.pending === 0;
    scoreCard.replaceChildren(
      div("card-top", text("span", "Score", "eyebrow"),
        score.provisional ? text("span", "Provisional", "test-provisional") : null),
      div("test-score-value", text("strong", settled ? score.percent + "%" : "Marking pending"),
        text("span", settled ? score.points + " / " + score.total + " points" : score.points + " of " + score.total + " points awarded so far")),
      settled ? element("progress", {class: "study-meter", value: score.points, max: score.total,
        "aria-label": "Score: " + score.points + " out of " + score.total + " points"}) :
        text("p", howMany(score.pending, "answer still needs marking", "answers still need marking") + ".", "small muted"),
      ...(score.grade == null ? [] : [div("test-grade", text("span", "Course grade", "small muted"), text("strong", score.grade))]));
    tbody.replaceChildren(...questions.map((q, i) => {
      const title = testQuestionTitle(q, i);
      const titleButton = button(title, e => showReview(i, e.currentTarget), "result-question-link");
      titleButton.setAttribute("aria-haspopup", "dialog");
      return element("tr", {},
        element("th", {scope: "row"}, text("span", String(i + 1).padStart(2, "0"), "result-question-number small muted"), titleButton),
        text("td", markingLabels[q.mark.method], "result-method" + (q.mark.method === "local-model" ? " is-provisional" : "")),
        element("td", {class: "result-points"}, q.mark.points == null ? "—" : q.mark.points, " / ", q.points));
    }));
  }

  function updateResult(data) {
    questions = data.questions;
    paintResult(data.score);
  }

  function closeReview() {
    reviewRequest += 1;
    drawer?.close();
  }

  async function showReview(i, trigger) {
    if (disposed) return;
    if (!drawer?.open) {
      drawer = element("dialog", {class: "test-review-dialog", "aria-labelledby": "test-review-title"});
      const original = trigger;
      drawer.addEventListener("close", e => {
        e.target.remove();
        if (drawer !== e.target) return;
        reviewRequest += 1;
        drawer = null;
        if (!disposed) (original?.isConnected ? original : tbody.querySelectorAll("button")[openQuestion] || reviewAll)
          .focus({preventScroll: true});
      });
      page.append(drawer);
    }
    openQuestion = i;
    const nextRequest = ++reviewRequest;
    const row = questions[i];
    const title = testQuestionTitle(row, i);
    const close = button("×", closeReview, "icon-button");
    close.setAttribute("aria-label", "Close review");
    const content = div("dialog-inner",
      div("dialog-head", div("test-review-heading", text("p", "Question " + (i + 1) + " of " + questions.length, "small muted"),
        element("h2", {id: "test-review-title"}, title)), close),
      element("p", {role: "status", class: "small muted"}, "Opening answer…"));
    drawer.replaceChildren(content);
    if (!drawer.open) drawer.showModal();
    drawer.scrollTop = 0;
    close.focus({preventScroll: true});
    const current = () => !disposed && nextRequest === reviewRequest && drawer?.open;
    try {
      const review = await api(path + "/review?question=" + encodeURIComponent(row.id));
      if (!current()) return;
      content.lastChild.remove();
      const selected = review.options && review.value != null ? review.options[review.value] : null;
      const yourAnswer = selected ? markdown(selected, "", [], true) :
        row.answered && !review.options ? text("pre", review.value, "test-written reading-text") :
          text("p", "Unanswered", "small muted");
      const promptAssets = [...figures(review.statement, "", review.assets, image), review.visual ? plot(review.visual) : null];
      const support = review.solution + "\n" + review.rubric;
      const reviewSections = element("div", {"data-reader-view": "test", lang: review.language, class: "test-review-sections"},
        element("details", {class: "test-review-prompt"},
          element("summary", {}, "Question and figures"), markdown(review.statement, "", review.assets, true, image),
          div("test-review-art", promptAssets)),
        element("section", {class: "test-review-block"}, text("h3", "Your answer"), yourAnswer),
        review.options ? element("section", {class: "test-review-block"},
          text("h3", "Checked answer"), markdown(review.options[review.correct_index], "", [], true)) : null,
        review.solution ? element("section", {class: "test-review-block"}, text("h3", "Reviewed solution"),
          markdown(review.solution, "", review.support_assets, true, image)) : null,
        review.rubric ? element("section", {class: "test-review-block"}, text("h3", "Marking rubric"),
          markdown(review.rubric, "", review.support_assets, true, image)) : null,
        div("test-review-art", figures(support, "", review.support_assets, image)));
      const source = element("p", {class: "small muted", role: "status"});
      const comment = element("p", {class: "small muted"});
      const message = element("p", {class: "small test-mark-message", role: "status"});
      const paintMark = mark => {
        source.textContent = markingLabels[mark.method] + (mark.points == null ? "" : " · " + mark.points + " / " + row.points + " points");
        comment.textContent = mark.feedback || "";
        comment.hidden = !mark.feedback;
      };
      paintMark(review.mark);
      const controls = div("test-marking-controls", source, comment);
      if (review.can_self_mark) {
        const interim = element("div", {class: "model-mark-preview", "aria-hidden": "true", hidden: ""},
          pill("Local model · provisional"));
        const preview = modelTextPreview(["feedback"], {lang: review.language,
          onReveal: () => { interim.hidden = false; }});
        interim.append(preview.node);
        const input = element("input", {type: "number", inputmode: "numeric", min: 0, max: row.points, step: 1, required: ""});
        if (review.mark.points != null) input.value = review.mark.points;
        const self = element("button", {type: "submit", class: "button primary"}, "Save self-mark");
        const model = home.grader && review.can_model_mark ? button("Mark with local model", modelMark) : null;
        const form = element("form", {class: "test-marking-form"},
          element("label", {class: "test-points-label"}, "Points (0–" + row.points + ")", input), self, model);
        let busy = false;
        const busyWith = working => {
          busy = working;
          self.disabled = input.disabled = working;
          if (model) model.disabled = working;
          form.setAttribute("aria-busy", String(working));
        };
        function done(data) {
          updateResult(data);
          if (current()) {
            const mark = questions[i].mark;
            input.value = mark.points;
            paintMark(mark);
            if (model) model.hidden = true;
            message.textContent = "Mark saved.";
          }
        }
        form.addEventListener("submit", async e => {
          e.preventDefault();
          if (busy) return;
          const points = input.valueAsNumber;
          busyWith(true);
          message.classList.remove("error");
          message.textContent = "Saving mark…";
          try {
            const data = await api(path + "/self-mark", {question: row.id, points});
            if (!disposed) done(data);
          } catch (err) {
            message.classList.add("error");
            message.textContent = err.message;
          } finally {
            busyWith(false);
          }
        });
        async function modelMark() {
          if (busy) return;
          busyWith(true);
          message.classList.remove("error");
          message.textContent = "Marking this answer on your device…";
          try {
            const data = await requestLocalModel(path + "/model-mark", {question: row.id}, {
              onText(key, chunk) { if (current()) preview.push(key, chunk); },
            });
            if (disposed) return;
            if ("uncertain" in data) {
              if (current()) message.textContent = "The model left this pending. " + data.uncertain + " You can use the rubric.";
            } else done(data);
          } catch (err) {
            if (current()) {
              message.classList.add("error");
              message.textContent = err.message;
            }
          } finally {
            preview.clear();
            interim.hidden = true;
            busyWith(false);
          }
        }
        controls.append(form, message, interim);
      }
      const move = (offset, label) => {
        const b = button(label, () => showReview(i + offset));
        b.disabled = !questions[i + offset];
        return b;
      };
      content.append(reviewSections, controls, div("test-review-nav", move(-1, "Previous answer"), move(1, "Next answer")));
    } catch (err) {
      if (current()) content.lastChild.replaceWith(text("p", err.message, "error"));
    }
  }

  reviewAll.setAttribute("aria-haspopup", "dialog");
  main.replaceChildren(page);
  page.append(testBack(test, "Practice tests", testRoute(test.key)),
    div("test-result-head",
      div("", text("h1", "Test result"), text("p", [test.title, test.course].filter(Boolean).join(" · "), "muted")),
      testBack(test, "Back to " + back.label, back.href)),
    div("test-result-summary", scoreCard,
      element("section", {class: "card test-attempt-details"}, text("h2", "Attempt details"),
        element("dl", {},
          detailRow("Answered", "check", answeredCount + " of " + questions.length),
          detailRow("Time used", "clock", usedTime(attempt)),
          detailRow("Study aids", "lock", aidSummary(attempt.aids))),
        attempt.reason === "expired" ? text("p", "Submitted automatically when time ran out.", "small muted") : null)),
    element("section", {class: "card test-breakdown"},
      div("card-top", text("h2", "Question breakdown"), reviewAll),
      element("table", {class: "test-results-table"},
        element("caption", {class: "sr-only"}, "Question breakdown"),
        element("thead", {}, element("tr", {}, ["Question", "Marked by", "Points"].map(label => element("th", {scope: "col"}, label)))),
        tbody)),
    div("test-result-actions", exportButton, status));
  paintResult(state.score);
  return () => {
    disposed = true;
    closeReview();
  };
}
