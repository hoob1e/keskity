import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const t = await mkdtemp(join(tmpdir(), 'study-hub-browser-'));
const downloads = join(t, 'downloads');
const fixture = join(t, 'published');
const screenshots = process.env.STUDY_HUB_SCREENSHOTS;
const grader = process.env.STUDY_HUB_TEST_GRADER_PORT;
await mkdir(fixture);
await mkdir(downloads);
if (screenshots) await mkdir(screenshots, {recursive:true});
const file = join(fixture, 'set.json');
await writeFile(file, execFileSync('python3', ['-B', '-c', 'import demo,packs;print(demo.fixture(packs.validator()))'], {cwd:root}));
const app = spawn('python3', ['-B','hub.py','--data-dir',join(t,'db'),'serve','--port','0',
  ...(grader ? ['--grader-port', grader] : [])], {cwd:root, stdio:['ignore','pipe','inherit']});
// Headless Chromium has no physical pointer; enable desktop hover media queries.
const browser = spawn('chromium', ['--headless','--disable-gpu','--no-first-run','--disable-background-networking',
  '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2',
  '--remote-debugging-port=0','--user-data-dir='+join(t,'browser'),'about:blank'], {stdio:'ignore'});
let appLog = '', ws;
app.stdout.on('data', chunk => appLog += chunk);
async function until(fn, message) {
  for (let i=0; i<180; i++) {
    const val = await fn();
    if (val) return val;
    await wait(60);
  }
  throw new Error(message || 'Timed out waiting for browser state');
}
try {
  const origin = await until(() => appLog.match(/Study Hub: (http:\/\/127\.0\.0\.1:\d+)/)?.[1], 'App not ready');
  const port = await until(async () => {
    try { return (await readFile(join(t,'browser','DevToolsActivePort'),'utf8')).split('\n')[0]; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  });
  const [tab] = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  let n=0;
  const responses = new Map(), crashes=[], requests=[];
  ws.addEventListener('message', ({data}) => {
    const m=JSON.parse(data);
    if(m.method==='Runtime.exceptionThrown') crashes.push(m.params.exceptionDetails.text);
    if(m.method==='Network.requestWillBeSent') requests.push(m.params.request.url);
    if(!m.id || !responses.has(m.id)) return;
    const {ok,fail}=responses.get(m.id);
    responses.delete(m.id);
    if(m.error) fail(new Error(m.error.message)); else ok(m.result);
  });
  const call = (method,params={}) => new Promise((ok,fail) => {
    const id = ++n;
    const deadline = setTimeout(() => {
      responses.delete(id);
      fail(new Error("Browser command timed out: " + method));
    }, 8000);
    deadline.unref();
    responses.set(id,{
      ok(value) { clearTimeout(deadline); ok(value); },
      fail(error) { clearTimeout(deadline); fail(error); },
    });
    ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = (sel) => until(() => evaluate('!!document.querySelector('+JSON.stringify(sel)+')'), 'Missing '+sel);
  const click = async sel => {
    await waitFor(sel);
    return evaluate('document.querySelector('+JSON.stringify(sel)+').click()');
  };
  async function cardHover(selector) {

    const card = JSON.stringify(selector);
    const query = 'document.querySelector(' + card + ')';
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    await evaluate(query + '.scrollIntoView({block:"center"})');
    const [x,y] = await evaluate(`{ const b = ${query}.getBoundingClientRect(); [b.x + b.width/2,b.y + b.height/2] }`);
    const opacity = () => evaluate('Number(getComputedStyle(' + query + ', "::after").opacity)');
    await until(async () => await opacity() === 0);
    const position = await evaluate(query + '.getBoundingClientRect().toJSON()');
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    const target = Number(await evaluate('getComputedStyle(' + query + ').getPropertyValue("--card-lift")'));
    assert(target > 0 && target < 1);
    await until(async () => Math.abs(await opacity() - target) < .001, selector + ' should lighten on hover');
    assert.deepEqual(await evaluate(query + '.getBoundingClientRect().toJSON()'),position);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
  }
  const size = (width,height,mobile=false) => call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  async function image(name) {
    if (!screenshots) return;
    await evaluate('document.fonts.ready.then(() => true)');
    const {data} = await call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(screenshots,name+'.png'),Buffer.from(data,'base64'));
  }

  await call('Runtime.enable');
  await call('Page.enable');
  await call('Network.enable');
  await call('Network.setBlockedURLs',{urls:['https://*']});
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await size(1440,960);
  await call('Page.navigate',{url:origin+'/'});
  await waitFor('.dashboard-grid');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'white');
  assert((await evaluate('document.body.innerText')).includes('No upcoming exams logged.'));
  assert((await evaluate('document.querySelector(".resume-empty").textContent')).includes('Open your first set'));
  assert.equal(await evaluate('document.querySelector(".workspace-nav [aria-current]").textContent.trim()'), 'Dashboard');
  assert.equal(await evaluate('document.querySelectorAll(".heat-calendar td .heat").length'), 35);
  await click('#open-help');
  assert(await evaluate('document.querySelector("#help-dialog").open'));
  await click('#help-dialog [data-close]');

  await click('.workspace-nav [data-route="study"]');
  await waitFor('.empty.study-course-list');
  assert.equal(await evaluate('document.querySelector("#main h1").textContent'), 'Study');
  await click('.workspace-nav [data-route="data"]');
  await waitFor('.data-overview');
  assert.equal(await evaluate('document.querySelector("#main h1").textContent'), 'Data');
  assert.equal(await evaluate('document.querySelector(".workspace-nav [aria-current]").dataset.route'), 'data');
  await click('.workspace-nav [data-route="dashboard"]');
  await waitFor('.dashboard-grid');

  await click('#open-import');
  const dom = await call('DOM.getDocument');
  const selector = await call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#folder'});
  await call('DOM.setFileInputFiles',{files:[fixture],nodeId:selector.nodeId});
  await waitFor('.plot-data');
  assert(await evaluate('!!document.querySelector(".task-card .katex")'));
  const oldPath = await evaluate('document.querySelector(".plot-data").getAttribute("d")');
  await evaluate('let s=document.querySelector("#slope");s.value="-2";s.dispatchEvent(new Event("input"));true');
  assert.notEqual(await evaluate('document.querySelector(".plot-data").getAttribute("d")'),oldPath);
  assert.equal(await evaluate('document.querySelector("#problem-title").textContent'), 'Change the slope');
  assert.equal(await evaluate('document.querySelector(".problem-switcher button[disabled]").ariaLabel'), 'Previous problem');
  assert(await evaluate(`{
    const prompt = document.querySelector('.problem-prompt').getBoundingClientRect();
    const graph = document.querySelector('.problem-artwork').getBoundingClientRect();
    graph.left > prompt.right;
  }`));
  const focusPosition = await evaluate('document.querySelector("#problem-focus").getBoundingClientRect().right');
  if (screenshots) await until(() => evaluate('document.querySelector("#toast").hidden'));
  await image('solver');
  await click('#problem-focus');
  assert(await evaluate('document.documentElement.hasAttribute("data-problem-focus")'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".problem-toolbar")).display'), 'none');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".history")).display'), 'none');
  assert.equal(await evaluate('document.querySelector("#problem-focus").getBoundingClientRect().right'), focusPosition);
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#problem-focus")).opacity'), '0.25');
  await image('solver-focus');
  const escape = async () => {
    const key = {key:"Escape",code:"Escape",windowsVirtualKeyCode:27};
    await call("Input.dispatchKeyEvent",{type:"keyDown",...key});
    await call("Input.dispatchKeyEvent",{type:"keyUp",...key});
  };
  await escape();
  assert.equal(await evaluate('document.querySelector("#problem-focus").getAttribute("aria-pressed")'), 'false');
  await click('.problem-actions > button');
  assert.equal(await evaluate('document.activeElement.id'), 'answer-heading');
  await evaluate('window.scrollTo(0,0)');

  const editSetting = (selector, value, type='change') => evaluate(
    `{ const field = document.querySelector(${JSON.stringify(selector)});
       field.value = ${JSON.stringify(value)};
       field.dispatchEvent(new Event(${JSON.stringify(type)}, {bubbles:true})); }`);
  const glowOpacity = () => evaluate('getComputedStyle(document.querySelector(".workspace-content.ambient-area"), "::before").opacity');
  await click('[data-open-appearance]');
  assert(await evaluate('document.querySelector("#appearance-dialog").open'));
  await editSetting('#theme','white');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(255, 255, 255)');
  await editSetting('#theme','dark');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".plot-data")).stroke'), 'rgb(203, 184, 245)');
  await editSetting('#ambient-glow','0','input');
  assert.equal(await glowOpacity(),'0');
  assert.equal(await evaluate('document.querySelector("#glow-value").textContent'),'0%');
  await editSetting('#ambient-glow','64','input');
  assert.equal(await glowOpacity(),'0.64');
  await editSetting('#theme','ink');
  assert.equal(await evaluate('document.querySelector("#ambient-glow").disabled'),true);
  assert.equal(await glowOpacity(),'0');
  await editSetting('#theme','dark');
  await click('#appearance-dialog footer .primary');

  const interfaceFont = await evaluate('getComputedStyle(document.querySelector(".brand")).fontFamily');
  await click('[data-open-reading]');
  assert(await evaluate('!document.querySelector("[data-settings=reading]").hidden'));
  await editSetting('#reading-font','serif');
  await editSetting('#reading-size','26','input');
  await editSetting('#reading-leading','1.85');
  await editSetting('#reading-width','50');
  assert.equal(await evaluate('document.documentElement.style.getPropertyValue("--reader-width")'),'50ch');
  assert.match(await evaluate('getComputedStyle(document.querySelector(".task-card .reading-text")).fontFamily'), /Georgia/);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".task-card .reading-text")).fontSize'),'26px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".task-card .reading-text")).lineHeight'),'48.1px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("textarea")).fontSize'),'26px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".brand")).fontFamily'),interfaceFont);
  // The same reader contract applies to an in-test prompt, not ordinary copy.
  const scope = await evaluate(`{
    const fixture = document.createElement('div');
    fixture.innerHTML = '<section data-reader-view="test"><p class="reading-text">Test prompt</p></section><p class="reading-text">Ordinary copy</p>';
    document.body.append(fixture);
    const sizes = Array.from(fixture.querySelectorAll('p'), p => getComputedStyle(p).fontSize);
    fixture.remove();
    sizes;
  }`);
  assert.deepEqual(scope,['26px','16px']);
  await click('#appearance-dialog footer .primary');
  await call('Page.reload');
  await waitFor('.plot-data');
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  assert.equal(await glowOpacity(),'0.64');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".task-card .reading-text")).fontSize'),'26px');
  await image('solver-dark-reading');

  const family = selector => evaluate('getComputedStyle(document.querySelector(' + JSON.stringify(selector) + ')).fontFamily');
  const defaultTitle = await family('#problem-title');
  const readerFont = await family('.reading-text');
  await click('[data-open-appearance]');
  await editSetting('#interface-font','system');
  assert.match(await family('.brand'),/system-ui/);
  assert.notEqual(await family('.brand'),interfaceFont);
  assert.equal(await family('#problem-title'),defaultTitle);
  await editSetting('#title-font','installed');
  await editSetting('#title-family','DejaVu Serif');
  assert.match(await family('#problem-title'),/DejaVu Serif/);
  assert.equal(await family('.reading-text'),readerFont);
  await editSetting('#interface-font','default');
  await editSetting('#title-font','system');
  assert.equal(await family('#problem-title'),'system-ui, sans-serif');
  assert.equal(await family('.brand'),interfaceFont);
  if (screenshots) {
    await evaluate('document.activeElement.blur()');
    await image('typography');
  }

  const font = join(root,'node_modules','katex','dist','fonts','KaTeX_Main-Regular.woff2');
  const fontDOM = await call('DOM.getDocument');
  const {nodeId:fontInput} = await call('DOM.querySelector',{nodeId:fontDOM.root.nodeId,selector:'#font-file'});
  const invalidFont = join(t, 'invalid.woff2');
  await writeFile(invalidFont, 'This text is not a font.');
  await call('DOM.setFileInputFiles',{files:[invalidFont],nodeId:fontInput});
  await until(() => evaluate('document.querySelector("#font-status").textContent.includes("could not be read")'));
  await call('DOM.setFileInputFiles',{files:[font],nodeId:fontInput});
  await until(() => evaluate('document.querySelector("#font-status").textContent.includes("Added KaTeX_Main-Regular.woff2")'));
  const uploaded = await evaluate('document.querySelector("#title-font optgroup option").value');
  await editSetting('#title-font',uploaded);
  const addedTitle = await family('#problem-title');
  assert.match(addedTitle,/Keskity-/);
  assert.notEqual(addedTitle,defaultTitle);
  assert.equal(await family('.reading-text'),readerFont);
  await click('#appearance-dialog footer .primary');
  await call('Page.reload');
  await waitFor('.plot-data');
  await until(async () => (await family('#problem-title')) === addedTitle, 'Uploaded title font did not persist');
  await click('[data-open-appearance]');
  assert.equal(await evaluate('document.querySelector("#title-font").value'),uploaded);
  await click('#font-files summary');
  await click('#font-list button');
  await until(async () => (await family('#problem-title')) === defaultTitle, 'Removing a selected font did not restore its fallback');
  await editSetting('#title-font','system');
  await editSetting('#ambient-glow','47','input');
  await click('[data-reset-settings]');
  assert.equal(await family('#problem-title'),defaultTitle);
  assert.equal(await family('.reading-text'),readerFont);
  assert.equal(await evaluate('document.querySelector("#reading-size").value'),'26');
  assert.equal(await glowOpacity(),'0.35');
  await editSetting('#ambient-glow','64','input');
  await click('#appearance-dialog footer .primary');

  await click('[data-open-appearance]');
  await editSetting('#theme','paper');
  await click('[data-panel=reading]');
  await click('[data-reset-settings]');
  assert.equal(await evaluate('document.querySelector("#reading-size").value'),'18');
  assert.equal(await glowOpacity(),'0.64');
  await click('#appearance-dialog footer .primary');

  assert.equal(await evaluate('document.querySelector(".hint-status").textContent'), 'Hints opened: 0');
  await click('.problem-support button:first-child');
  await until(() => evaluate('document.querySelector("#support-dialog").open'));
  assert.equal(await evaluate('document.querySelector(".hint-status").textContent'), 'Hints opened: 1');
  await click('#support-dialog [data-close]');
  await click('.problem-jump');
  assert(await evaluate('document.querySelector("#problem-picker").open'));
  await click('[data-pid="compare-lines"]');
  await until(() => evaluate('document.querySelector(".task-card")?.innerText.includes("never cross")'));
  const response = "Both lines have the same slope, so they are parallel. The first stays four units higher.";
  await editSetting('textarea[name="answer"]',response,'input');
  await editSetting('[name="help"]','no-help');
  const draftPath = () => evaluate('location.hash.slice(6)');
  await click('.answer-actions button[type="button"]');
  await until(() => evaluate('document.querySelector(".answer-card .status").textContent.startsWith("Draft saved")'));
  const draftHome = (await (await fetch(origin+'/api/home')).json()).packs[0];
  assert.equal(draftHome.submissions,0);
  assert.equal(draftHome.attempted,0);
  await call('Page.reload');
  await until(() => evaluate('document.querySelector("#problem-title")?.textContent === "Compare two lines"'));
  assert.equal(await evaluate('document.querySelector("textarea").value'),response);
  assert.equal(await evaluate('document.querySelector("[name=help]").value'),'no-help');
  if (screenshots) {
    await click('[data-open-appearance]');
    await editSetting('#theme','dark');
    await editSetting('#ambient-glow','35','input');
    await click('#appearance-dialog footer .primary');
    await click('.problem-actions > button');
    await image('solver-answer');
  }
  await click('.answer-card button[type=submit]');
  await waitFor('.attempt');
  assert.equal((await (await fetch(origin+'/api/solver/'+await draftPath())).json()).draft,null);
  if (grader) {
    await waitFor('.live-feedback .feedback');
    assert((await evaluate('document.querySelector(".live-feedback").innerText')).includes('provisional'));
    await image('feedback');
  }
  await click('.attempt input[type=checkbox]');
  await click('.history .section-head button');
  const dump = await until(async () => (await readdir(downloads)).find(n => n.endsWith('.json')), 'Selected export missing');
  const exported = JSON.parse(await readFile(join(downloads,dump),'utf8'));
  assert.equal(exported.attempts.length,1);
  assert.equal(exported.attempts[0].problem_id,'compare-lines');
  assert.equal(exported.attempts[0].assistance,'independent');
  if (grader) assert.equal(exported.attempts[0].feedback.method,'local-model');

  await click('.problem-switcher [aria-label="Next problem"]');
  await waitFor('.choices');
  await click('.choice:last-child input');
  await click('.answer-actions button[type="button"]');
  await until(() => evaluate('document.querySelector(".answer-meta").textContent.includes("Draft saved")'));
  const choicePath = await draftPath();
  assert.equal((await (await fetch(origin+'/api/solver/'+choicePath)).json()).draft.choice,2);
  assert.equal((await (await fetch(origin+'/api/history/'+choicePath)).json()).length,0);
  await click('.answer-card button[type=submit]');
  await waitFor('.live-feedback .feedback.correct');

  await click('.brand');
  await waitFor('.dashboard-grid');
  await click('#add-exam');
  const today = (await (await fetch(origin+'/api/home')).json()).today;
  await evaluate('let f=document.querySelector("#exam-form").elements;f.title.value="Functions practice";f.course.value="DEMO";f.day.value='+JSON.stringify(today)+';true');
  await click('#exam-form button[type=submit]');
  await waitFor('.exam-entry');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".summary-count dd"), el => el.textContent)'), ['1','2','2']);
  assert.equal(await evaluate('document.querySelectorAll(".heat-calendar .heat.l2").length'),1);
  assert(await evaluate('document.querySelector(".resume-card a").getAttribute("href").endsWith("/intercept-check")'));
  assert(await evaluate('document.querySelector(".dashboard-recent").textContent.includes("Recently opened")'));

  await click('.exam-edit');
  assert.equal(await evaluate('document.querySelector("#exam-form").elements.title.value'),'Functions practice');
  await evaluate('document.querySelector("#exam-form").elements.title.value="Linear functions exam"');
  await click('#exam-form button[type=submit]');
  await until(() => evaluate('document.querySelector(".exam-copy h3")?.textContent === "Linear functions exam"'));
  await until(() => evaluate('document.activeElement.classList.contains("exam-edit")'));

  await click('[aria-label="Pause study tips"]');
  await click('[aria-label="Next study tip"]');
  assert.equal(await evaluate('document.querySelector(".tip-count").textContent'),'2 / 3');
  await click('[aria-label="Previous study tip"]');
  assert.equal(await evaluate('document.querySelector(".tip-count").textContent'),'1 / 3');
  await call('Page.reload');
  await waitFor('[aria-label="Play study tips"]');
  assert.match(await evaluate('getComputedStyle(document.querySelector(".resume-link")).transitionProperty'), /transform/);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await until(() => evaluate(`document.querySelector('[aria-label="Play study tips"]')?.hidden`));
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".resume-link")).transitionDuration'),'0s');
  await click('[aria-label="Next study tip"]');
  assert.equal(await evaluate('document.querySelector(".tip-count").textContent'),'2 / 3');
  assert.equal(await evaluate('document.querySelector(".tip-card").getAnimations({subtree:true}).length'),0);
  await call('Emulation.setEmulatedMedia',{features:[]});

  async function setTheme(name) {
    await click('[data-open-appearance]');
    await editSetting('#theme', name);
    await click('#appearance-dialog footer .primary');
  }
  await setTheme('white');
  await click('[data-open-appearance]');
  await editSetting('#ambient-glow','42','input');
  await click('#appearance-dialog footer .primary');
  await evaluate('document.querySelector("#main").focus({preventScroll:true})');
  const fonts = await evaluate(`{
    const family = el => getComputedStyle(el).fontFamily;
    const selectors = ['.rail-caption','.workspace-nav a','.library-group > p','.library-name',
      '.library-link .small','.resume-card .eyebrow','.resume-course','.exam-course',
      '.dashboard-activity h2','.summary-count dt','.brand','#open-import'];
    const body = family(document.body);
    const page = family(document.querySelector('h1'));
    [selectors.every(selector => family(document.querySelector(selector)) === body),
      family(document.querySelector('.resume-card h2')) === page, page !== body];
  }`);
  assert.deepEqual(fonts,[true,true,true]);
  await cardHover('.dashboard-summary');
  await evaluate('window.scrollTo(0,0)');
  await image('dashboard');
  await setTheme('dark');
  await evaluate('document.querySelector("#main").focus({preventScroll:true})');
  await cardHover('.dashboard-summary');
  await evaluate('window.scrollTo(0,0)');
  await image('dashboard-dark');
  await click('.dashboard-summary .arrow-link');
  await waitFor('.data-overview');
  assert.match(await evaluate('document.querySelector(".data-pack-list").textContent'),/Linear functions.*2 submissions/);
  await click('.workspace-nav [data-route="dashboard"]');
  await waitFor('.dashboard-grid');
  await click('.exam-entry .text-action');
  await waitFor('.study-layout');
  assert.equal(await evaluate('document.querySelector("h1")?.textContent'),'Linear functions');
  assert.equal(await evaluate('document.querySelector(".library-link[aria-current] .library-name").textContent'),'DEMO');
  assert.equal(await evaluate('document.querySelector(".workspace-nav [aria-current]").dataset.route'),'study');
  assert.match(await evaluate('document.querySelector(".study-concepts").textContent'), /Slope.*Intercept/);
  assert.match(await evaluate('document.querySelector(".study-description").textContent'), /graphs and equations/);
  assert.match(await evaluate('document.querySelector(".side-progress-total").textContent'), /2 \/ 3/);
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".problem-group-head h3"), el => el.textContent)'), ['Reading a line','Comparing lines']);
  assert(await evaluate('!!document.querySelector(".study-details time")'));
  assert(await evaluate('!!document.querySelector(".mini-line")'));
  assert(await evaluate('document.querySelector(".problem-last").closest("a").dataset.problemId === "intercept-check"'));
  await image('study-dark');

  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await cardHover('.problem-card[data-problem-id="moving-slope"]');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".problem-card"), "::after").transitionDuration'),'0s');
  await call('Emulation.setEmulatedMedia',{features:[]});
  await evaluate('window.scrollTo(0,0)');
  await setTheme('white');
  await until(() => evaluate('!document.querySelector("#appearance-dialog").open'));
  await evaluate('document.querySelector("#main").focus({preventScroll:true}); window.scrollTo(0,0)');
  await image('study-light');
  await click('.study-overview .arrow-link');
  await until(() => evaluate('document.activeElement.id === "study-problems"'));
  assert(await evaluate('location.hash.endsWith("/problems")'));
  await image('study-problems');

  await editSetting('#problem-group','pack');
  assert.equal(await evaluate('document.querySelector(".problem-group-head h3").textContent'),'Linear functions');
  await editSetting('#problem-order','recent');
  await editSetting('#problem-filter','tried');
  const cardIds = () => evaluate('Array.from(document.querySelectorAll(".problem-card"), el => el.dataset.problemId)');
  assert.deepEqual(await cardIds(), ['intercept-check','compare-lines']);
  assert.match(await evaluate('document.querySelector(".problem-group-head .progress-line").innerText'),/2 \/ 3 attempted/);
  await editSetting('#problem-order','title');
  assert.deepEqual(await cardIds(), ['compare-lines','intercept-check']);
  await editSetting('#problem-filter','investigations');
  assert(await evaluate('document.querySelector(".problem-results .empty").textContent.includes("No problems match")'));
  await click('.problem-results .empty button');
  assert.equal((await cardIds()).length,3);
  await call('Page.reload');
  await waitFor('.problem-card');
  assert.deepEqual(await evaluate('["#problem-group","#problem-order"].map(id => document.querySelector(id).value)'),['pack','title']);
  await editSetting('#problem-group','topic');
  await editSetting('#problem-order','original');

  for (const width of [320,390,768,1024,1440]) {
    await size(width,890,width<500);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
    // workspace-content clips its decorative glow; verify it doesn't hide overflowing controls.
    assert(await evaluate('document.querySelector(".problem-controls").scrollWidth <= document.querySelector(".problem-controls").clientWidth'));
  }
  await size(390,840,true);
  await evaluate('window.scrollTo(0,0)');
  await image('study-mobile');
  await click('.problem-card[data-problem-id="moving-slope"]');
  await waitFor('.plot-data');
  assert.equal(await evaluate('document.querySelector(".hint-status").textContent'),'Hints opened: 1');
  assert(await evaluate(`{
    const prompt = document.querySelector('.problem-prompt').getBoundingClientRect();
    const graph = document.querySelector('.problem-artwork').getBoundingClientRect();
    graph.top >= prompt.bottom;
  }`));
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await image('solver-mobile');
  await size(320,720,true);
  await click('[data-open-reading]');
  const scrolls = await evaluate(`(() => {
    const d = document.querySelector('#appearance-dialog');
    return d.scrollWidth > d.clientWidth || document.documentElement.scrollWidth > innerWidth;
  })()`);
  assert.equal(scrolls,false);
  await escape();
  await until(() => evaluate('!document.querySelector("#appearance-dialog").open'));
  await until(() => evaluate('document.activeElement.hasAttribute("data-open-reading")'), "Reading trigger did not regain focus");
  for (const width of [768,1024,1440]) {
    await size(width,900);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  }
  await size(390,840,true);
  await click('.brand');
  await waitFor('.dashboard-grid');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await setTheme('white');
  await evaluate('document.querySelector("#main").focus({preventScroll:true})');
  await image('dashboard-mobile');
  for (const width of [320,768,1024,1440]) {
    await size(width,900,width===320);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
    assert(await evaluate('document.querySelector(".top-actions").getBoundingClientRect().right <= innerWidth'));
  }
  const independentFixture = JSON.parse(await readFile(file,'utf8'));
  delete independentFixture.course;
  delete independentFixture.extensions;
  independentFixture.id = 'graph-reading-demo';
  independentFixture.title = 'Reading graphs independently';
  const independent = await evaluate(`fetch('/api/import',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({packet:${JSON.stringify(JSON.stringify(independentFixture))},assets:{}})
  }).then(response => response.json())`);
  assert.equal(independent.added,true);
  await click('.workspace-nav [data-route="study"]');
  await waitFor('.pack-card');
  await click('.pack-card .text-action');
  await waitFor('.study-layout');
  assert.equal(await evaluate('document.querySelector("#main h1").textContent'),'Reading graphs independently');
  assert.equal(await evaluate('document.querySelector(".study-details time")'),null);
  assert.match(await evaluate('document.querySelector(".study-overview").textContent'), /Slope and intercept/);
  assert.equal(await evaluate('document.querySelector(".study-concepts")'),null);
  assert.equal(await evaluate('document.querySelector(".problem-card h4").textContent'),'Moving slope');
  await click('.workspace-nav [data-route="dashboard"]');
  await waitFor('.dashboard-grid');
  await click('[aria-label="Play study tips"]');
  await evaluate('document.querySelector("#main").focus({preventScroll:true}); window.scrollTo(0,0);');
  // Let the real intersection observer and the 14-second timer run.
  // Fast-forwarding a background headless tab can skip the first visibility callback.
  await wait(14500);
  await until(() => evaluate('document.querySelector(".tip-count").textContent === "2 / 3"'), 'Study tip did not auto-rotate');
  assert.deepEqual(crashes,[]);
  assert(requests.filter(url => /^https?:/i.test(url)).every(url => url.startsWith(origin+'/')),requests.join('\n'));
  console.log("Browser pass: dashboard, card hover and typography, Study overviews and problem controls, responsive solver, focus, hints, drafts, local fonts, tips, import, reading settings, answer checks and export" + (grader ? ", real local grading" : ""));
} finally {
  ws?.close();
  for (const child of [browser,app]) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill();
    await Promise.race([new Promise(resolve => child.once('exit',resolve)),wait(2500)]);
  }
  await rm(t,{recursive:true,force:true});
}
