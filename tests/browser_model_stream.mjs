import assert from 'node:assert/strict';

export async function exerciseModelStream({key, call, evaluate, until, waitFor, click, escape, size, setTheme, image}) {
  const path = '/api/explain-selection/' + key + '/moving-slope';
  const popup = '.study-help-popover:popover-open';
  const preview = popup + ' .model-text-preview:not([hidden])';
  const result = popup + ' .study-followup-reply .md';
  const submit = popup + ' .study-local-form button[type="submit"]';
  const q = 'What does “fixed” mean here?';
  const first = '“Fixed” means the value stays in the same place';
  const second = ' or remains unchanged as something else varies.';
  await size(1440,960);
  await setTheme('white');
  await evaluate(`{
    window.location.hash = ${JSON.stringify('#pack/' + key + '/moving-slope')};
    window.scrollTo(0,0);
  }`);
  await until(() => evaluate('document.querySelector("#problem-title")?.textContent === "Change the slope"'));
  // Deliver individual frames on demand so loading/partial/final states are testable on any machine.
  await evaluate(`{
    const realFetch = window.fetch;
    const configured = home.explain_selection;
    home.explain_selection = true;
    window.localModelFixture = {
      requests: [], aborts: 0, fades: 0,
      restore() { window.fetch = realFetch; home.explain_selection = configured; },
    };
    document.addEventListener("transitionrun", e => {
      if (e.propertyName === "opacity" && e.target.matches(".model-text-fragment")) localModelFixture.fades++;
    });
    window.fetch = (path, options) => {
      if (path !== ${JSON.stringify(path)}) return realFetch(path, options);
      const control = window.localModelFixture;
      const request = new Request(path, options);
      control.requests.push({accept: request.headers.get("Accept"), mode: request.mode, referrerPolicy: request.referrerPolicy});
      if (options.headers.Accept === "application/json") {
        return new Promise(resolve => { control.completeJSON = result => resolve(Response.json(result)); });
      }
      const body = new ReadableStream({
        start(stream) {
          const encoder = new TextEncoder();
          control.send = (frame, splitUTF8 = false) => {
            const bytes = encoder.encode(JSON.stringify(frame) + "\\n");
            if (splitUTF8) {
              const split = bytes.findIndex(n => n >= 0xc0) + 1;
              stream.enqueue(bytes.slice(0, split));
              stream.enqueue(bytes.slice(split));
            } else stream.enqueue(bytes);
          };
          control.end = () => stream.close();
          options.signal.addEventListener("abort", () => {
            control.aborts++;
            stream.error(new DOMException("Aborted", "AbortError"));
          }, {once: true});
        },
      });
      return Promise.resolve(new Response(body, {headers: {"Content-Type": "application/x-ndjson"}}));
    };
  }`);
  const select = async (needle = 'stays fixed') => {
    await evaluate(`{
      const node = document.querySelector(".problem-prompt strong").firstChild;
      const word = ${JSON.stringify(needle)};
      const start = node.data.indexOf(word);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + word.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }`);
    await click(popup+' [data-study-tab="explain"]');
    await click(popup+' [aria-controls="study-inline-explain-local"]');
    await evaluate('document.querySelector("#study-inline-explain-question").value = '+JSON.stringify(q));
    await click(submit);
  };
  const send = (frame, split = false) => evaluate(`localModelFixture.send(${JSON.stringify(frame)}, ${split})`);
  const selectedTabs = () => evaluate('document.querySelector(".study-menu-tabs").getBoundingClientRect().top');
  const seenText = () => evaluate('document.querySelector('+JSON.stringify(preview)+')?.textContent');

  try {
    await select();
    assert.match(await evaluate('document.querySelector(".study-reply-status").textContent'), /Generating locally/);
    assert.equal(await evaluate('!!document.querySelector('+JSON.stringify(preview)+')'), false);
    assert.deepEqual(await evaluate('localModelFixture.requests[0]'),
      {accept: 'application/x-ndjson', mode: 'same-origin', referrerPolicy: 'same-origin'});
    const tabsTop = await selectedTabs();
    await image('stream-waiting-light');
    await send({field: 'reply', text: first}, true);
    await waitFor(preview);
    assert.equal(await seenText(), first);
    assert(await evaluate('document.querySelector(".model-text-preview").getAttribute("aria-hidden") === "true"'));
    await until(() => evaluate('localModelFixture.fades > 0'), 'Arriving text did not fade in');
    assert.equal(await selectedTabs(), tabsTop);
    await image('stream-arriving-light');
    await send({field: 'reply', text: second});
    await until(async () => (await seenText()) === first + second);
    assert.equal(await selectedTabs(), tabsTop);
    await evaluate(`{
      localModelFixture.send({result: {reply: ${JSON.stringify(first + second)}, lang: "en"}});
      localModelFixture.end();
    }`);
    await waitFor(result);
    assert.equal(await evaluate('document.querySelector(".study-followup-reply .md").innerText'), first + second);
    assert.equal(await evaluate('!!document.querySelector('+JSON.stringify(preview)+')'), false);
    await image('stream-complete-light');

    await escape();
    await setTheme('dark');
    await size(390,820,true);
    await evaluate('window.scrollTo(0,0)');
    await select('fixed');
    await send({field: 'reply', text: first});
    await waitFor(preview);
    await image('stream-arriving-mobile-dark');
    await send({field: 'reply', text: '<b>not markup</b>'});
    await until(async () => (await seenText())?.includes('<b>not markup</b>'));
    assert(await evaluate('!document.querySelector(".model-text-preview b")'));
    await evaluate('localModelFixture.end()');
    await waitFor(popup+' .study-reply-status.error');
    assert(await evaluate('!document.querySelector(".study-followup-reply").checkVisibility()'));
    assert.equal(await evaluate('document.querySelector(".study-local-form textarea").value'), q);

    await click(submit);
    await send({field: 'reply', text: 'Text from an earlier selection'});
    await waitFor(preview);
    await escape();
    await until(() => evaluate('localModelFixture.aborts === 1'));
    assert.equal(await evaluate('!!document.querySelector(".study-help-popover:popover-open")'), false);
    assert.equal(await evaluate('!!document.querySelector(".model-text-fragment")'), false);

    await call('Emulation.setEmulatedMedia', {features: [{name:'prefers-reduced-motion', value:'reduce'}]});
    await select('point');
    assert.deepEqual(await evaluate('localModelFixture.requests.at(-1)'),
      {accept: 'application/json', mode: 'same-origin', referrerPolicy: 'same-origin'});
    await evaluate(`localModelFixture.completeJSON({reply: ${JSON.stringify(first + second)}, lang: "en"})`);
    await waitFor(result);
    assert.equal(await evaluate('!!document.querySelector(".model-text-fragment")'), false);
    assert.equal(await evaluate('document.querySelector(".study-followup-reply").getAnimations({subtree:true}).length'), 0);
    await escape();
  } finally {
    await evaluate('localModelFixture.restore()');
    await call('Emulation.setEmulatedMedia', {features: []});
    await size(1440,960);
    await setTheme('white');
  }
}
