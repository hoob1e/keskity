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
const browser = spawn('chromium', ['--headless','--disable-gpu','--no-first-run','--disable-background-networking',
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
    responses.set(++n,{ok,fail});
    ws.send(JSON.stringify({id:n,method,params}));
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
  await size(1360,980);
  await call('Page.navigate',{url:origin+'/'});
  await waitFor('.empty');
  assert((await evaluate('document.body.innerText')).includes('No upcoming exams logged.'));

  await click('#open-import');
  const dom = await call('DOM.getDocument');
  const selector = await call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#folder'});
  await call('DOM.setFileInputFiles',{files:[fixture],nodeId:selector.nodeId});
  await waitFor('.plot-data');
  assert(await evaluate('!!document.querySelector(".task-card .katex")'));
  const oldPath = await evaluate('document.querySelector(".plot-data").getAttribute("d")');
  await evaluate('let s=document.querySelector("#slope");s.value="-2";s.dispatchEvent(new Event("input"));true');
  assert.notEqual(await evaluate('document.querySelector(".plot-data").getAttribute("d")'),oldPath);
  await image('solver');

  await evaluate('let th=document.querySelector("#theme");th.value="dark";th.dispatchEvent(new Event("change"));true');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".plot-data")).stroke'), 'rgb(178, 209, 189)');
  await image('solver-dark');
  await call('Page.reload');
  await waitFor('.plot-data');
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  await evaluate('let el=document.querySelector("#theme");el.value="paper";el.dispatchEvent(new Event("change"));true');

  await click('[data-pid="compare-lines"]');
  await waitFor('textarea[name="answer"]');
  await until(() => evaluate('document.querySelector(".task-card")?.innerText.includes("never cross")'));
  await evaluate('document.querySelector("textarea").value="Both lines have the same slope, so they are parallel. The first stays four units higher."; document.querySelector("[name=help]").value="no-help";true');
  await click('.answer-card button[type=submit]');
  await waitFor('.attempt');
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

  await click('[data-pid="intercept-check"]');
  await waitFor('.choices');
  await click('.choice:last-child input');
  await click('.answer-card button[type=submit]');
  await waitFor('.live-feedback .feedback.correct');

  await click('.back');
  await waitFor('.hero-grid');
  const add = await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Add exam")).click();true');
  assert(add);
  const today = (await (await fetch(origin+'/api/home')).json()).today;
  await evaluate('let f=document.querySelector("#exam-form").elements;f.title.value="Functions practice";f.course.value="DEMO";f.day.value='+JSON.stringify(today)+';true');
  await click('#exam-form button[type=submit]');
  await waitFor('.exam-card');
  assert.match(await evaluate('document.querySelector(".progress-line").innerText'),/2 \/ 3 attempted/);
  assert.equal(await evaluate('document.querySelectorAll(".heat.l2").length'),1);
  await image('dashboard');
  await click('.exam-card .text-action');
  await until(() => evaluate('document.querySelector("h1")?.textContent === "DEMO"'));
  await size(390,840,true);
  await click('.pack-card .text-action');
  await waitFor('.plot-data');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await image('solver-mobile');
  await click('.back');
  await waitFor('.hero-grid');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await image('dashboard-mobile');
  assert.deepEqual(crashes,[]);
  assert(requests.filter(url => /^https?:/i.test(url)).every(url => url.startsWith(origin+'/')),requests.join('\n'));
  console.log("Browser pass: folder import, math, slider, live/persisted theme, answer submissions, keyed check, selected download, exam hub, heatmap, 390px layout" + (grader ? ", real local grading" : ""));
} finally {
  ws?.close();
  for (const child of [browser,app]) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill();
    await Promise.race([new Promise(resolve => child.once('exit',resolve)),wait(2500)]);
  }
  await rm(t,{recursive:true,force:true});
}
