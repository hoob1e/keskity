import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {readdir, readFile} from 'node:fs/promises';

export async function exercisePracticeTests({root, directory, downloads, origin, call, evaluate, until, waitFor, click,
  editSetting, setTheme, escape, size, image, grader}) {
  const fixture = execFileSync('python3', ['-B','-c','import demo,packs;print(demo.test_fixture(packs.validator()))'],
    {cwd:root,encoding:'utf8'});
  // Exercise the same import projection as the file picker.
  const imported = await evaluate('api("/api/import",{packet:'+JSON.stringify(fixture)+',assets:{}})');
  assert.equal(imported.test, true);
  const setup = '#test/' + imported.key;
  const runURL = () => evaluate('location.hash.split("/").slice(0,3).join("/")');
  const saved = () => waitFor('.test-save-state[data-saved]');
  const heading = selector => evaluate('document.querySelector(".test-question-body h1")?.textContent === ' + JSON.stringify(selector));
  const starts = async () => {
    await click('.test-start');
    await waitFor('.test-navigation');
    return runURL();
  };
  const go = async (n, title) => {
    await click('.test-step-keys button:nth-child('+n+')');
    await until(() => heading(title));
  };
  const state = async hash => (await fetch(origin+'/api/'+hash.slice(1))).json();
  const capture = async name => { await evaluate('window.scrollTo(0,0)'); await image(name); };
  const closeReview = async () => {
    await click('.test-review-dialog [aria-label="Close review"]');
    await until(() => evaluate('!document.querySelector("dialog.test-review-dialog")'));
  };
  const review = async (n, title) => {
    await click('.test-results-table tr:nth-child('+n+') .result-question-link');
    await waitFor('.test-marking-controls');
    assert.equal(await evaluate('document.querySelector("#test-review-title").textContent'),title);
  };
  const selfMark = async points => {
    await editSetting('.test-points-label input', points, 'input');
    await click('.test-marking-form button[type=submit]');
    await until(() => evaluate('document.querySelector(".test-mark-message")?.textContent === "Mark saved."'));
  };
  const shiftDeadline = (run, delay) => {
    const id = run.split('/')[2];
    execFileSync('python3',['-B','-c',[
      'import sqlite3,sys,time',
      'deadline=time.time_ns()//1000000+int(sys.argv[3])',
      'with sqlite3.connect(sys.argv[1]) as db:',
      '    row=db.execute("UPDATE test_attempts SET started_ms=?, deadline_ms=? WHERE id=? AND ended_ms IS NULL", (deadline-25*60000, deadline, sys.argv[2]))',
      '    assert row.rowcount==1',
    ].join('\n'),join(directory,'db','study.db'),id,String(delay)]);
  };
  await size(1440,960);
  await setTheme('white');
  await click('.workspace-nav [data-route="study"]');
  await waitFor('.test-shelf');
  assert.equal(await evaluate('document.querySelector(".test-shelf a").hash'),setup);
  await click('.study-course-list a[href="#course/DEMO"]');
  await waitFor('.study-intro .test-shelf');
  await click('.test-shelf a');
  await waitFor('.test-setup');
  assert.equal(await evaluate('document.querySelectorAll(".test-aid-row input:checked").length'),0);
  assert.equal(await evaluate('document.querySelectorAll(".test-aid-row input:not(:disabled)").length'),2);
  assert.equal((await state(setup)).attempts.length,0);
  await capture('test-setup-light');

  const light = await starts();
  assert.equal(await evaluate('document.querySelector("#main").dataset.readerView'),'test');
  assert.equal(await evaluate('document.querySelector(".workspace-rail").checkVisibility()'),false);
  assert.equal(await evaluate('document.querySelector(".test-run-meta").textContent.includes("Question 1 of 4")'),true);
  assert.equal(await evaluate(`(async () => {
    const p = document.querySelector(".test-prompt .reading-text");
    const range = document.createRange();
    range.selectNodeContents(p);
    getSelection().addRange(range);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const offered = !!document.querySelector(".study-help-control, .study-help-popover, .study-help-dialog");
    getSelection().removeAllRanges();
    return offered;
  })()`),false);
  const deadline = (await state(light)).attempt.deadline_ms;
  await click('.test-choice label:nth-of-type(3) input');
  await saved();
  assert.equal(await evaluate('document.querySelector(".test-step-keys [aria-current]").getAttribute("aria-label")'),'Question 1, answered');

  await go(2,'Read the rate of change');
  await click('.test-choice label:first-of-type input');
  await saved();
  assert.equal((await state(light)).questions[1].value,0);
  await click('.test-answer > button');
  await saved();
  assert.equal((await state(light)).questions[1].value,null);

  await go(3,'A family of lines');
  assert.equal(await evaluate('!!document.querySelector(".plot-data") && !document.querySelector("#slope")'),true);
  assert.equal(await evaluate('!document.querySelector(".test-hint-row button")'),true);
  const fonts = () => evaluate(`[".test-clock", ".test-prompt .reading-text", ".test-prompt .katex .mathnormal", "#finish-test"]
    .map((s, i) => getComputedStyle(document.querySelector(s))[i === 2 ? "fontFamily" : "fontSize"])`);
  const before = await fonts();
  await click('[data-open-reading]');
  assert.equal(await evaluate('document.querySelector(".settings-sections").hidden'),true);
  assert.equal(await evaluate('document.querySelector("#model-settings").hidden'),true);
  await editSetting('#reading-size','23','input');
  const adjusted = await fonts();
  assert.notEqual(adjusted[1],before[1]);
  assert.deepEqual([adjusted[0],adjusted[2],adjusted[3]],[before[0],before[2],before[3]]);
  await editSetting('#reading-size', String(parseInt(before[1],10)), 'input');
  await escape();
  await until(() => evaluate('!document.querySelector("#appearance-dialog").open'));
  await until(() => evaluate('document.activeElement.id === "problem-reading"'));
  const familyAnswer = 'Yes, at (0, 2). At x = 0, mx is zero for every slope m, so the equation gives y = 2.';
  await editSetting('.test-answer textarea', familyAnswer, 'input');
  await saved();
  await evaluate('document.querySelector("#main").focus({preventScroll:true})');
  await capture('test-running-light');
  for (const width of [320,390,768,1024,1440]) {
    await size(width,width<500?840:960,width<500);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
    assert(await evaluate('document.querySelector("#finish-test").getBoundingClientRect().right <= innerWidth'));
    if (width === 390) {
      assert(await evaluate('document.querySelector(".problem-artwork").getBoundingClientRect().top >= document.querySelector(".problem-prompt").getBoundingClientRect().bottom'));
      await capture('test-mobile');
    }
  }

  await call('Page.reload');
  await until(() => heading('A family of lines'));
  assert.equal(await evaluate('document.querySelector(".test-answer textarea").value'),familyAnswer);
  assert.equal((await state(light)).attempt.deadline_ms,deadline);
  const comparison = 'Both slopes are 2. The intercepts differ by 4, so the lines are parallel and always separated.';
  await go(4,'Compare two lines');
  await editSetting('.test-answer textarea', comparison, 'input');
  await click('#finish-test'); // Finish flushes a response even before the autosave delay.
  await waitFor('.test-finish-dialog[open]');
  assert.match(await evaluate('document.querySelector(".test-blank-warning").textContent'),/1 unanswered question.*Question 2/);
  await capture('test-finish-light');
  await click('.test-finish-actions button:first-child');
  await until(() => evaluate('!document.querySelector(".test-finish-dialog")'));
  assert.equal(await evaluate('document.activeElement.id'),'finish-test');
  await click('#finish-test');
  await click('.test-finish-actions .primary');
  await waitFor('.test-result');
  const submitted = await state(light);
  assert.equal(submitted.attempt.reason,'submitted');
  assert.deepEqual(submitted.questions.map(q => q.mark.method),['answer-key','unanswered','pending','pending']);
  assert.equal(submitted.score.percent,null);
  assert.equal(await evaluate('document.querySelector("#open-import").hidden && document.querySelector("#test-tools").hidden'),true);
  assert.match(await evaluate('document.querySelector(".test-score").textContent'),/Marking pending/);

  await review(3,'A family of lines');
  assert.equal(await evaluate('document.querySelector(".test-written").textContent'),familyAnswer);
  assert.equal(await evaluate('!!document.querySelector(".test-review-dialog .plot-svg")'),true);
  assert.match(await evaluate('document.querySelector(".test-review-dialog").textContent'),/Marking rubric/);
  assert.equal(await evaluate('!![...document.querySelectorAll(".test-marking-form .button")].find(b => b.textContent === "Mark with local model")'),false);
  await selfMark(5);
  await closeReview();
  await review(4,'Compare two lines');
  if (grader) {
    await click('.test-marking-form button[type=button]');
    await until(() => evaluate('document.querySelector(".test-provisional")?.textContent === "Provisional"'), 'Local model did not return a provisional test mark');
    assert.equal((await state(light)).questions[3].mark.method,'local-model');
    assert.equal((await state(light)).score.pending,0);
    await closeReview();
    await capture('test-provisional-light');
    await review(4,'Compare two lines');
  } else {
    assert.equal(await evaluate('document.querySelectorAll(".test-marking-form .button").length'),1);
  }
  await selfMark(4);
  await closeReview();
  assert.equal(await evaluate('document.querySelector(".test-score-value strong").textContent'),'86%');
  assert.equal(await evaluate('!!document.querySelector(".test-grade") || document.querySelector(".test-score").textContent.includes("null")'),false);
  await capture('test-result-light');
  await click('.test-result-actions .button');
  const file = await until(async () => (await readdir(downloads)).find(n => n.startsWith('study-hub-test-') && n.endsWith('.json')));
  const exported = JSON.parse(await readFile(join(downloads,file),'utf8'));
  assert.equal(exported.attempt.id,light.split('/')[2]);
  assert.equal(exported.questions[3].answer,comparison);
  assert.deepEqual(exported.questions.map(q => q.mark.method),['answer-key','unanswered','self','self']);

  await setTheme('dark');
  await waitFor('.test-result');
  await capture('test-result-dark');
  await click('.test-result > .test-back');
  await waitFor('.test-setup');
  assert.equal(await evaluate('document.querySelector(".test-history-link").hash'),light);
  await capture('test-setup-dark');
  await click('.test-aid-row:nth-child(2) input');
  await click('.test-aid-row:nth-child(3) input');
  const dark = await starts();
  await go(3,'A family of lines');
  assert.equal(await evaluate('!!document.querySelector("#slope")'),true);
  await click('.test-hint-row button');
  await waitFor('#support-dialog[open]');
  await click('#support-dialog [data-close]');
  assert.match(await evaluate('document.querySelector(".test-hint-row span[role=status]").textContent'),/1 hint opened/);
  await editSetting('.test-answer textarea','The point is (0, 2).','input');
  await saved();
  await capture('test-running-dark');

  shiftDeadline(dark, 4500);
  await call('Page.reload');
  await until(() => heading('A family of lines'));
  assert.equal(await evaluate('document.querySelector(".test-answer textarea").value'),'The point is (0, 2).');
  await click('#finish-test');
  await waitFor('.test-finish-dialog[open]');
  await capture('test-finish-dark');
  await until(() => evaluate('document.querySelector(".test-attempt-details")?.textContent.includes("Submitted automatically")'));
  const expired = await state(dark);
  assert.equal(expired.attempt.reason,'expired');
  assert.equal(expired.attempt.ended_ms,expired.attempt.deadline_ms);
  assert.equal(expired.questions[2].hint_count,1);
  assert.equal(await evaluate('!!document.querySelector(".test-finish-dialog[open]")'),false);
  assert.equal(await evaluate('!!document.querySelector(".test-answer textarea")'),false);
  assert.match(await evaluate('document.querySelector(".test-score").textContent'),/Marking pending/);

  await click('.test-result > .test-back');
  await waitFor('.test-start');
  const closed = await starts();
  await click('.test-choice label:nth-of-type(3) input');
  await saved();
  await click('.brand');
  await waitFor('.dashboard-grid');
  shiftDeadline(closed, -250);
  await evaluate('location.hash = ' + JSON.stringify(setup));
  await waitFor('.test-setup');
  assert.equal(await evaluate('!!document.querySelector(".test-resume")'), false);
  const closedLink = 'Array.from(document.querySelectorAll(".test-history-link")).find(a => a.hash === ' + JSON.stringify(closed) + ')';
  assert.equal(await evaluate(closedLink + '?.querySelector("small").textContent'),'Time expired');
  assert.equal((await state(closed)).score.points,3);
  await setTheme('white');
}
