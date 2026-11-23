import assert from 'node:assert/strict';

export async function exerciseLocalExplanations({key, origin, call, evaluate, until, waitFor, click, pointerClick,
  escape, size, setTheme, image, grader, requestDetails}) {
  const popup = '.study-help-popover:popover-open';
  const dialog = '.study-help-dialog[open]';
  const toolCalls = action => requestDetails.filter(r => /\/api\/(explain|define|translate)-selection\//.test(r.url)
    && (!action || r.url.startsWith(origin + '/api/' + action + '-selection/')));
  const writes = () => requestDetails.filter(r => r.method === 'POST').length;
  const openTab = (surface, tab) => click(surface + ' [data-study-tab="' + tab + '"]');
  const section = (surface, tab, name) => click(surface + ' [aria-controls="' + (surface === popup ? 'study-inline' : 'study-picker')
    + '-' + tab + '-' + name + '"]');
  const pane = (surface, tab) => surface + ' [data-study-pane="' + tab + '"]';
  const shut = async () => {
    await escape();
    await until(() => evaluate('!document.querySelector(".study-help-popover:popover-open, .study-help-dialog[open]")'));
  };
  const select = async (selector, phrase) => evaluate(`{
    const root = document.querySelector(${JSON.stringify(selector)});
    const needle = ${JSON.stringify(phrase)};
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node, offset;
    while ((node = it.nextNode())) {
      offset = node.textContent.indexOf(needle);
      if (offset !== -1) break;
    }
    if (!node) throw new Error("Missing selection text: " + needle);
    const range = document.createRange();
    range.setStart(node,offset);
    range.setEnd(node,offset + needle.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }`);
  const reply = async (surface, tab, lang = 'en') => {
    const result = pane(surface, tab) + ' .study-followup-reply:not([hidden])';
    await waitFor(result + ' .md');
    const state = await evaluate(`{
      const result = document.querySelector(${JSON.stringify(result)});
      const reply = result.querySelector(".md");
      ({label: result.querySelector(".pill").textContent, lang: reply.lang, text: reply.innerText.trim()});
    }`);
    assert.equal(state.label, 'Unreviewed');
    assert.equal(state.lang, lang);
    assert(state.text.length > 0);
    return state.text;
  };
  const prompt = surface => evaluate('document.querySelector('+JSON.stringify(surface+' .study-prompt-preview')+').textContent');
  const readPrompt = async surface => JSON.parse((await prompt(surface)).split('\n\n').at(-1));

  await size(1440,960);
  await evaluate('location.hash = "#course/DEMO"');
  await waitFor('.study-overview');
  await evaluate('window.scrollTo(0,0)');
  const startWrites = writes();
  const startCalls = toolCalls().length;
  await select('.study-description', 'equations');
  await waitFor(popup + ' .study-menu-tabs');
  assert.equal(await evaluate('document.querySelector(".study-help-popover").innerText'), 'Explain\nDefinition\nTranslation');
  // A second pointer press can reverse the same transition without waiting for it to finish.
  assert(await evaluate(`(() => {
    const tab = document.querySelector(".study-menu-tab");
    const body = document.getElementById(tab.getAttribute("aria-controls"));
    const press = () => tab.dispatchEvent(new MouseEvent("click", {detail:1, bubbles:true}));
    press();
    const expand = body.getAnimations().find(a => a.transitionProperty === "grid-template-rows");
    if (!expand) return false;
    expand.pause();
    expand.currentTime = 65;
    const height = body.offsetHeight;
    press();
    return height > 0 && body.inert && tab.getAttribute("aria-expanded") === "false"
      && Math.abs(body.offsetHeight - height) <= 1;
  })()`));
  await openTab(popup,'definition');
  await openTab(popup,'translation');
  await openTab(popup,'explain');
  await section(popup,'explain','copy');
  assert.equal(writes(), startWrites);
  assert.deepEqual(await readPrompt(popup), {language:'en', selection:'equations'});
  assert(await evaluate('!document.querySelector(".study-context-option input").checked'));
  await click(popup+' .study-context-option input');
  const context = await evaluate('document.querySelector(".study-description").textContent');
  assert.deepEqual(await readPrompt(popup), {language:'en', selection:'equations', context});
  await click(popup+' .study-context-option input');
  const expectedClipboard = await prompt(popup);
  await call('Browser.grantPermissions',{origin, permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await evaluate('document.querySelector(".study-prompt-copy button").scrollIntoView({block:"nearest", container:"nearest"})');
  await pointerClick(popup+' .study-prompt-copy button');
  await until(() => evaluate('document.querySelector(".study-copy-status").textContent === "Prompt copied."'));
  assert.equal(await evaluate('navigator.clipboard.readText()'), expectedClipboard);
  assert.equal(writes(), startWrites);
  await image('compact-copy-light');
  // On insecure origins or when the clipboard is blocked, the prompt is still selectable.
  await evaluate('navigator.clipboard.writeText = () => Promise.reject(new DOMException("Clipboard denied","NotAllowedError"))');
  await pointerClick(popup+' .study-prompt-copy button');
  await until(() => evaluate('document.querySelector(".study-copy-status").textContent.includes("manually")'));
  assert.equal(await evaluate('getSelection().toString()'), expectedClipboard);
  await evaluate('delete navigator.clipboard.writeText');
  assert.equal(writes(), startWrites);

  await section(popup,'explain','local');
  if (grader) {
    const form = pane(popup,'explain') + ' form';
    await waitFor(form);
    assert.equal(await evaluate('document.querySelector("#study-inline-explain-question").value'), '');
    await image('compact-local-explain-light');
    await evaluate('window.selectionLayer = document.querySelector(".study-help-popover:popover-open")');
    await click(form+' button[type="submit"]');
    await reply(popup,'explain');
    assert(await evaluate('window.selectionLayer === document.querySelector(".study-help-popover:popover-open")'));
    assert.equal(toolCalls().length, startCalls + 1);
    assert.deepEqual(JSON.parse(toolCalls('explain').at(-1).postData), {field:'overview', text:'equations', question:''});
    assert(await evaluate('location.hash === "#course/DEMO"'));

    await openTab(popup,'definition');
    const noLookup = await evaluate(`{
      const row = document.querySelector(".study-menu-later");
      row.textContent.includes("Check online") && !row.querySelector("a, button");
    }`);
    assert(noLookup);
    await section(popup,'definition','local');
    assert.equal(toolCalls().length, startCalls + 1);
    await click(pane(popup,'definition')+' form button');
    await reply(popup,'definition');
    assert.equal(toolCalls().length, startCalls + 2);
    assert.deepEqual(JSON.parse(toolCalls('define').at(-1).postData), {field:'overview', text:'equations'});
    await openTab(popup,'explain');
    await waitFor(pane(popup,'explain')+' .study-followup-reply:not([hidden])');
    assert.equal(toolCalls().length, startCalls + 2);
  } else {
    assert.match(await evaluate('document.querySelector("#study-inline-explain-local").innerText'), /needs the local model/);
    assert.equal(await evaluate('!!document.querySelector("#study-inline-explain-local form")'), false);
    assert.equal(toolCalls().length, startCalls);
    await image('compact-model-off-light');
  }
  await shut();

  const task = key + '/moving-slope';
  await evaluate('location.hash = '+JSON.stringify('#pack/'+task));
  await waitFor('#problem-title');
  await setTheme('dark');
  await evaluate(`{
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".problem-prompt .md p"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }`);
  await openTab(popup,'explain');
  await section(popup,'explain','copy');
  assert.equal(await evaluate('!!document.querySelector(".study-context-option")'),false);
  assert.deepEqual(await readPrompt(popup), {language:'en',selection:'Start with y=mx+2. Move the slope slider. What point stays fixed, and why?'});
  await shut();

  await evaluate('window.scrollTo(0,0)');
  await select('.problem-prompt .md p', 'slope');
  const beforeTranslate = writes();
  await openTab(popup,'translation');
  await section(popup,'translation','local');
  assert.equal(writes(), beforeTranslate);
  if (grader) {
    const selector = pane(popup,'translation')+' select';
    await evaluate(`{
      const menu = document.querySelector(${JSON.stringify(selector)});
      menu.value = "sv";
      menu.dispatchEvent(new Event("change"));
    }`);
    assert.equal(writes(), beforeTranslate);
    await section(popup,'translation','provided');
    await waitFor(popup + ' .study-help-note .reading-text[lang="fi"]');
    await click(pane(popup,'translation')+' form button');
    const result = await reply(popup,'translation','sv');
    assert.notEqual(result.toLowerCase(),'slope');
    assert.match(await evaluate('document.querySelector(".study-help-note .reading-text[lang=fi]").innerText'), /Kulmakerroin/);
    assert.deepEqual(JSON.parse(toolCalls('translate').at(-1).postData), {field:'prompt', text:'slope', target:'sv'});
    assert.equal(toolCalls('translate').at(-1).url, origin+'/api/translate-selection/'+task);
    await image('compact-translation-dark');
  } else {
    assert.equal(await evaluate('!!document.querySelector(".study-menu-body form")'), false);
  }
  await shut();
  await select('.problem-prompt strong', 'stays fixed');
  await openTab(popup,'explain');
  await section(popup,'explain','local');
  if (grader) {
    const target = origin+'/api/explain-selection/'+task;
    const form = pane(popup,'explain')+' form';
    const question = 'What does “fixed” mean in this phrase?';
    await evaluate('document.querySelector("#study-inline-explain-question").value = '+JSON.stringify(question));
    await call('Network.setBlockedURLs',{urls:['https://*',target]});
    await click(form+' button');
    await waitFor(form+' .study-reply-status.error');
    await call('Network.setBlockedURLs',{urls:['https://*']});
    const before = toolCalls('explain').length;
    await evaluate(`{
      const form = document.querySelector(${JSON.stringify(form)});
      form.requestSubmit();
      form.requestSubmit();
    }`);
    await reply(popup,'explain');
    assert.equal(toolCalls('explain').length, before + 1);
    assert.equal(toolCalls('explain').at(-1).url, target);
    assert.deepEqual(JSON.parse(toolCalls('explain').at(-1).postData), {field:'prompt', text:'stays fixed', question});
    await image('compact-explanation-dark');
    await openTab(popup,'translation');
    await section(popup,'translation','local');
    assert.equal(await evaluate('document.querySelector(".study-menu-body select").value'), 'sv');
  }
  await shut();

  // The passage-picker uses the same affordances on narrow screens.
  await size(390,840,true);
  await evaluate('window.scrollTo(0,0)');
  await click('.problem-support .study-help-control');
  await waitFor(dialog+' #study-explain-passage');
  await evaluate(`{
    const choice = document.querySelector("#study-explain-passage");
    choice.selectedIndex = [...choice.options].findIndex(item => item.textContent === "Question");
    choice.dispatchEvent(new Event("change"));
    const field = document.querySelector("#study-explain-text");
    field.focus();
    const start = field.value.indexOf("stays fixed");
    field.setSelectionRange(start, start + "stays fixed".length);
  }`);
  const beforePicker = toolCalls().length;
  await click('.study-explain-picker .primary');
  await openTab(dialog,'explain');
  await section(dialog,'explain','copy');
  assert.deepEqual(await readPrompt(dialog), {language:'en',selection:'stays fixed'});
  assert.equal(toolCalls().length, beforePicker);
  assert(await evaluate('document.querySelector(".study-help-dialog").scrollWidth <= document.querySelector(".study-help-dialog").clientWidth'));
  await shut();

  await size(320,620,true);
  await evaluate('window.scrollTo(0,0)');
  await select('.problem-prompt strong', 'point');
  await openTab(popup,'explain');
  await section(popup,'explain','copy');
  assert(await evaluate(`(() => {
    const host = document.querySelector(".study-help-popover:popover-open");
    const tabs = host.querySelector(".study-menu-tabs");
    const body = host.querySelector(".study-menu-body");
    const box = host.getBoundingClientRect();
    const y = tabs.getBoundingClientRect().top;
    const pageY = scrollY;
    body.scrollTop = body.scrollHeight;
    const copy = body.querySelector(".study-prompt-copy button").getBoundingClientRect();
    return box.top >= document.querySelector(".top").getBoundingClientRect().bottom
      && box.right <= innerWidth && box.bottom <= innerHeight
      && body.scrollTop > 0 && host.scrollTop === 0 && y === tabs.getBoundingClientRect().top
      && copy.bottom <= box.bottom && pageY === scrollY;
  })()`), 'Only the body should scroll and the anchored menu should stay inside the viewport');
  assert.equal(toolCalls().length, beforePicker);
  await image('compact-scroll-mobile-dark');
  await shut();
  await size(1440,960);
  await setTheme('white');
}
