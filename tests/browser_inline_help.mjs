import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

export async function exerciseInlineHelp({root, origin, call, evaluate, until, waitFor, click, pointerClick, mouse,
  escape, size, setTheme, image, grader, requestDetails}) {
  const packet = execFileSync('python3', ['-B','-c','import demo,packs;print(demo.help_fixture(packs.validator()))'],
    {cwd:root,encoding:'utf8'});
  const pack = await evaluate('api("/api/import",{packet:'+JSON.stringify(packet)+',assets:{}})');
  assert(pack.added);
  const task = pack.key + '/moving-slope';
  const apiState = async () => (await fetch(origin+'/api/solver/'+task)).json();
  const popup = '.study-help-popover:popover-open';
  const dialog = '.study-help-dialog[open]';
  const definition = ' [data-study-tab="definition"]';
  const translation = ' [data-study-tab="translation"]';
  const provided = tab => ' [data-study-pane="' + tab + '"] .study-menu-section:first-child > button';
  const note = ' .study-help-note';
  const ask = ' .study-help-ask';
  const inner = ' .study-followup';
  const media = reduce => call('Emulation.setEmulatedMedia', {features: reduce ? [{name:'prefers-reduced-motion', value:'reduce'}] : []});
  const closed = () => until(() => evaluate('!document.querySelector(' + JSON.stringify(popup+', '+dialog) + ')'));
  const openDefinition = async (action = click) => {
    await action(popup+definition);
    await action(popup+provided('definition'));
    await waitFor(popup+note+' .katex');
  };
  const setSize = async (w,h) => {
    await size(w,h,w<500);
    await evaluate('window.scrollTo(0,0)');
  };
  const press = async (key, code, windowsVirtualKeyCode) => {
    const event = {key,code,windowsVirtualKeyCode};
    await call('Input.dispatchKeyEvent',{type:'keyDown',...event, ...(key === 'Enter' ? {text:'\r'} : {})});
    await call('Input.dispatchKeyEvent',{type:'keyUp',...event});
  };
  const selectPrompt = async (word, withMouse = false) => {
    const coords = await evaluate(`{
      const prompt = document.querySelector(".problem-prompt .md");
      const needle = ${JSON.stringify(word)};
      const it = document.createTreeWalker(prompt, NodeFilter.SHOW_TEXT);
      let node;
      do { node = it.nextNode(); } while (node && !node.data.includes(needle));
      if (!node) throw new Error("Missing prompt text " + needle);
      const start = node.data.indexOf(needle);
      const range = document.createRange();
      range.setStart(node,start);
      range.setEnd(node,start+needle.length);
      const rect = range.getBoundingClientRect();
      if (${!withMouse}) {
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
      window.studySelectionBounds = rect.toJSON();
      [rect.left+rect.width/2, rect.top+rect.height/2]
    }`);
    if (withMouse) {
      await mouse(...coords, 1);
      await mouse(...coords, 2);
      assert.equal(await evaluate('getSelection().toString().trim()'), word);
    }
  };

  await setSize(1440,960);
  await setTheme('white');
  await evaluate('window.location.hash = '+JSON.stringify('#pack/' + task));
  await waitFor('.study-help-control');
  assert.equal((await apiState()).explanation_opened, false);
  assert(await evaluate('document.querySelector(".study-help-status").hidden'));
  await selectPrompt('the', true);
  await waitFor(popup+' .study-menu-tabs');
  assert.equal(await evaluate('document.querySelector(".study-help-popover").innerText'), 'Explain\nDefinition\nTranslation');
  assert.equal((await apiState()).explanation_opened, false);
  await escape();
  await closed();

  await selectPrompt('slope', true);
  await waitFor(popup+' .study-menu-tabs');
  await until(() => evaluate('getComputedStyle(document.querySelector(".study-help-popover")).opacity === "1"'));
  assert(await evaluate(`(() => {
    const box = document.querySelector(".study-help-popover").getBoundingClientRect();
    const selected = window.studySelectionBounds;
    return box.top - selected.bottom >= 6 && box.top - selected.bottom <= 9
      && box.left <= selected.right && box.right >= selected.left;
  })()`));
  assert.equal((await apiState()).explanation_opened, false);
  await image('compact-tabs-light');
  const apiCount = () => requestDetails.filter(r => /\/api\/(reveal|ask-further)\//.test(r.url)).length;
  const beforeNote = apiCount();
  await pointerClick(popup+definition);
  assert.equal(await evaluate('document.activeElement.dataset.studyTab'), 'definition');
  assert.equal(await evaluate('getSelection().toString().trim()'), 'slope');
  assert.equal(await evaluate('CSS.highlights.has("reviewed-study-term")'), true);
  assert.equal(apiCount(), beforeNote);
  assert.equal((await apiState()).explanation_opened, false);
  await pointerClick(popup+provided('definition'));
  await waitFor(popup+note+' .katex');
  assert.match(await evaluate('document.querySelector(".study-help-note").textContent'), /A line’s slope.*From this pack/s);
  assert.equal(await evaluate('!!document.querySelector(".study-help-ask")'), !!grader);
  await image('compact-definition-light');

  if (grader) await checkFollowup();
  await click(popup+note+' .study-note-switch');
  await until(() => evaluate('document.querySelector(".study-help-note .reading-text")?.textContent.startsWith("A ramp")'));
  assert.equal(await evaluate('!!document.querySelector(".study-help-ask")'), false);
  const beforeTranslation = apiCount();
  await click(popup+translation);
  assert.equal(apiCount(), beforeTranslation);
  await click(popup+provided('translation'));
  await waitFor(popup+note+' .reading-text[lang="fi"]');
  assert.match(await evaluate('document.querySelector(".study-help-note .reading-text[lang=fi]").textContent'), /Kulmakerroin/);
  await escape();
  await closed();
  await until(() => evaluate('document.activeElement.matches(".study-help-control")'));
  assert.equal(await evaluate('CSS.highlights.has("reviewed-study-term")'), false);
  assert(await evaluate('!document.querySelector(".study-help-status").hidden'));
  assert.equal(await evaluate('document.querySelector(".hint-status").textContent'), 'Hints opened: 0');
  assert.equal((await apiState()).explanation_opened, true);
  assert.deepEqual((await apiState()).history, []);

  // Keyboard picker, a failed reveal and retry, then back to the same term.
  await press('Enter','Enter',13);
  await waitFor(dialog+' .study-help-terms');
  assert.equal(await evaluate('document.activeElement.id'), 'study-help-title');
  await press('Tab','Tab',9);
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Close study help');
  await press('Tab','Tab',9);
  assert(await evaluate('document.activeElement.matches(".study-help-term")'));
  await call('Network.setBlockedURLs', {urls:['https://*', origin+'/api/reveal/'+task]});
  await press('Enter','Enter',13);
  await waitFor(dialog+' .study-provided-note .error');
  await call('Network.setBlockedURLs', {urls:['https://*']});
  await click(dialog+note+' button');
  await waitFor(dialog+note+' .katex');
  await click(dialog+' .study-help-back');
  assert.match(await evaluate('document.activeElement.textContent'), /Slope/);
  await click(dialog+' li:nth-child(2) button');
  await waitFor(dialog+' .study-help-credit');
  assert.match(await evaluate('document.querySelector(".study-help-note").textContent'), /a handle along a track/);
  assert.equal(await evaluate('!!document.querySelector(".study-note-switch, .study-help-ask")'), false);
  await escape();
  await closed();
  await until(() => evaluate('document.activeElement.matches(".study-help-control")'));

  // Reduced motion also applies when the mouse opens the same accordions.
  await call('Page.reload');
  await waitFor('.study-help-status:not([hidden])');
  await setTheme('dark');
  await media(true);
  await selectPrompt('slope', true);
  await waitFor(popup+' .study-menu-tabs');
  await image('compact-tabs-dark');
  await openDefinition(pointerClick);
  if (grader) await pointerClick(popup+ask);
  assert.equal(await evaluate('document.querySelector(".study-help-popover").getAnimations({subtree:true}).length'), 0);
  await image('compact-definition-dark');
  await pointerClick('.problem-heading h1');
  await closed();
  await media(false);

  for (const width of [320,390,768,1024,1440]) {
    await setSize(width,840);
    await click('.study-help-control');
    await click(dialog+' li:first-child button');
    await waitFor(dialog+' .study-help-credit');
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
    assert(await evaluate('document.querySelector(".study-help-dialog").scrollWidth <= document.querySelector(".study-help-dialog").clientWidth'));
    await escape();
    await closed();
  }
  // Narrow screens retain the selection-anchored layer instead of opening another dialog.
  await setSize(390,660);
  await selectPrompt('slope');
  await openDefinition();
  assert(await evaluate('!document.querySelector(".study-help-dialog[open]")'));
  await image('compact-anchored-mobile-dark');
  await escape();
  await closed();

  await setSize(1440,960);
  await selectPrompt('slope', true);
  await waitFor(popup+' .study-menu-tabs');
  await click('.problem-switcher [aria-label="Next problem"]');
  await until(() => evaluate('document.querySelector("#problem-title")?.textContent === "Compare two lines"'));
  assert.equal(await evaluate('!!document.querySelector(".study-help-control, .study-help-popover:popover-open, .study-help-dialog[open]")'), false);
  await selectPrompt('intercepts', true);
  await click(popup+' [data-study-tab="explain"]');
  await click(popup+' [aria-controls="study-inline-explain-local"]');
  assert.match(await evaluate('document.querySelector("#study-inline-explain-local").textContent'), /pack doesn’t enable/);
  assert.equal(await evaluate('!!document.querySelector("#study-inline-explain-local form")'), false);
  await escape();
  await closed();
  await setTheme('white');
  return pack.key;

  async function checkFollowup() {
    const question = 'What does “when x increases by one unit” mean in this note?';
    const target = origin+'/api/ask-further/'+task;
    const disclosure = popup+' .study-help-note .study-help-disclosure';
    await setSize(1440,1040);
    await waitFor(popup+ask);
    const initial = await evaluate(`(() => {
      const layer = document.querySelector(${JSON.stringify(popup)});
      const pane = document.getElementById(layer.querySelector(".study-help-ask").getAttribute("aria-controls"));
      if (!pane.inert || pane.offsetHeight !== 0) throw new Error("Invalid collapsed state");
      window.currentHelpLayer = layer;
      window.currentHelpNote = layer.querySelector(".study-help-note .md");
      window.followupTransition = 0;
      pane.addEventListener("transitionrun", e => {
        if (e.propertyName === "grid-template-rows") window.followupTransition = e.target.getAnimations()
          .find(a => a.transitionProperty === e.propertyName)?.effect.getTiming().duration ?? 0;
      });
      const {height,top,left} = layer.getBoundingClientRect();
      return {height,top,left};
    })()`);
    const before = apiCount();
    await pointerClick(popup+ask);
    await until(() => evaluate('window.followupTransition === 180'), 'Pointer disclosure did not animate');
    await until(() => evaluate('window.currentHelpLayer.getAnimations({subtree:true}).length === 0'));
    assert.equal(apiCount(), before);
    const after = await evaluate(`{
      const {height,top,left} = window.currentHelpLayer.getBoundingClientRect();
      ({height,top,left});
    }`);
    assert(after.height > initial.height);
    assert.equal(after.top, initial.top);
    assert.equal(after.left, initial.left);
    assert(await evaluate('window.currentHelpLayer === document.querySelector(".study-help-popover:popover-open") && document.querySelector(".study-help-note .md") === window.currentHelpNote'));
    assert.match(await evaluate('document.querySelector(".study-followup p").textContent'), /No transcript is saved/);
    await press('Tab','Tab',9);
    assert(await evaluate('document.activeElement.matches(".study-followup textarea")'));
    await evaluate('document.activeElement.value = '+JSON.stringify(question));
    await image('compact-ask-further-light');

    await call('Network.setBlockedURLs', {urls:['https://*', target]});
    await click(popup+inner+' button[type="submit"]');
    await waitFor(popup+inner+' .study-reply-status.error');
    assert.equal(await evaluate('document.querySelector(".study-followup textarea").value'), question);
    assert(await evaluate('document.querySelector(".study-help-note .md") === window.currentHelpNote'));
    await call('Network.setBlockedURLs', {urls:['https://*']});
    await click(popup+inner+' button[type="submit"]');
    await waitFor(popup+inner+' .study-followup-reply:not([hidden]) .md');
    assert.equal(await evaluate('document.querySelector(".study-followup .pill").textContent'), 'Unreviewed');
    assert.equal(await evaluate('!!document.querySelector(".study-followup .study-reply-status.error")'), false);
    const rendered = await evaluate('document.querySelector(".study-followup-reply .md").innerText.trim()');
    assert(rendered.length >= 8 && rendered.length <= 800, rendered);

    await evaluate('document.querySelector(".study-help-ask").focus()');
    await press('Enter','Enter',13);
    assert(await evaluate('document.querySelector('+JSON.stringify(disclosure)+').inert'));
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(disclosure)+').getAnimations().length'), 0);
    await press('Enter','Enter',13);
    assert.equal(await evaluate('document.querySelector(".study-followup textarea").value'), question);
    await click(popup+note+' .study-note-switch');
    await until(() => evaluate('document.querySelector(".study-help-note .reading-text")?.textContent.startsWith("A ramp")'));
    assert.equal(await evaluate('!!document.querySelector(".study-followup")'), false);
    await click(popup+note+' .study-note-switch');
    await waitFor(popup+ask);
    assert.equal(await evaluate('document.querySelector(".study-followup textarea").value'), '');
    assert(!(JSON.stringify(await apiState()).includes(question)));
    await setSize(1440,960);
  }
}
