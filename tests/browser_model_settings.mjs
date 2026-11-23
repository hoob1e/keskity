import assert from 'node:assert/strict';

export async function exerciseModelSettings({origin, call, evaluate, until, click, escape, size, setTheme, image, grader, requestDetails}) {
  const dialog = '#appearance-dialog';
  const tab = dialog+' [data-panel=model]';
  const state = '#model-settings .model-state';
  const check = '#model-settings [data-check-model]';
  const setup = '#model-settings details';
  const route = origin+'/api/model-status';
  const checks = () => requestDetails.filter(r => r.url === route).length;
  const waitForState = want => until(() => evaluate(`document.querySelector(${JSON.stringify(state)}).dataset.state === ${JSON.stringify(want)}`),
    'Expected model status '+want);
  const show = async () => {
    await click('[data-open-appearance]');
    await click(tab);
  };

  assert.equal(checks(),0);
  await size(1440,960);
  await setTheme('white');
  await click('[data-open-appearance]');
  assert.equal(checks(),0);
  assert(await evaluate('document.activeElement.id === "theme"'));
  await evaluate('document.querySelector('+JSON.stringify(tab)+').focus()');
  const enter = {key:'Enter',code:'Enter',windowsVirtualKeyCode:13};
  await call('Input.dispatchKeyEvent', {type:'keyDown',text:'\r',...enter});
  await call('Input.dispatchKeyEvent', {type:'keyUp',...enter});
  const actual = grader ? 'ready' : 'off';
  await waitForState(actual);
  assert.equal(checks(),1);
  assert(await evaluate('!document.querySelector("#model-settings").hidden && document.querySelector("[data-reset-settings]").hidden'));
  assert.equal(await evaluate('document.activeElement.dataset.panel'), 'model');
  assert.equal(await evaluate('document.querySelector(".model-connection code").textContent'), grader ? '127.0.0.1:'+grader : '');
  await image('model-status-'+actual+'-light');
  await click(check);
  await waitForState(actual);
  assert.equal(checks(),2);
  await escape();
  await until(() => evaluate('document.activeElement.hasAttribute("data-open-appearance")'));

  await setTheme('dark');
  // Slow and unavailable states are deterministic without restarting the real grader.
  await evaluate(`{
    const fetchOriginal = window.fetch;
    window.healthFixture = {next:"starting", aborts:0, restore: () => { window.fetch = fetchOriginal; }};
    window.fetch = (path, options) => {
      if (path !== "/api/model-status") return fetchOriginal(path, options);
      const fixture = window.healthFixture;
      if (fixture.next === "hold") {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            fixture.aborts++;
            reject(new DOMException("Aborted","AbortError"));
          }, {once:true});
        });
      }
      if (fixture.next === "network-error") return Promise.reject(new Error("Lost connection"));
      return Promise.resolve(Response.json({state:fixture.next, port:9876}));
    };
  }`);
  try {
    await size(390,840,true);
    await show();
    await waitForState('starting');
    assert.equal(await evaluate('document.querySelector(".model-state").textContent'),'Starting');
    await image('model-status-starting-dark');
    await evaluate('healthFixture.next = "unavailable"');
    await click(check);
    await waitForState('unavailable');
    await click(setup+' summary');
    assert.match(await evaluate('document.querySelector("[data-grader-command]").textContent'), /STUDY_HUB_GRADER_PORT=9876 sh start-grader.sh/);
    assert(await evaluate('document.querySelector("[data-grader-enable]").hidden'));
    for (const width of [390,320,768]) {
      await size(width,840,width<500);
      assert(await evaluate(`{
        const node = document.querySelector("#appearance-dialog");
        const bounds = node.getBoundingClientRect();
        bounds.left >= 0 && bounds.right <= innerWidth && node.scrollWidth <= node.clientWidth;
      }`));
      if (width === 390) await image('model-status-unavailable-mobile-dark');
    }
    await evaluate('healthFixture.next = "hold"');
    await click(check);
    await waitForState('checking');
    assert(await evaluate('document.querySelector("[data-check-model]").getAttribute("aria-disabled") === "true"'));
    await click(dialog+' [data-panel=reading]');
    await until(() => evaluate('healthFixture.aborts === 1'));
    assert(await evaluate('document.querySelector("#model-settings").hidden && !document.querySelector("[data-reset-settings]").hidden'));
    await evaluate('healthFixture.next = "network-error"');
    await click(tab);
    await until(() => evaluate('document.querySelector(".model-status-note").textContent.includes("couldn’t check")'));
    assert(await evaluate('document.querySelector(".model-setup").hidden'));
  } finally {
    await escape();
    await evaluate('healthFixture.restore()');
    await size(1440,960);
    await setTheme('white');
  }
  assert.equal(checks(),2);
}
