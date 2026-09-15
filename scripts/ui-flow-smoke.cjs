/* Browser fixture only: never opens the user's SQLite database or provider accounts.
 * Run against `npm run dev`, with Playwright available on NODE_PATH.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const output = process.env.UI_SMOKE_OUTPUT || '/tmp/queuest-ui-flow';
const url = process.env.UI_SMOKE_URL || 'http://127.0.0.1:1420';
const fixture = `
const workspace = {id:'w1',name:'내 작업 공간'};
const project = {id:'p1',workspaceId:'w1',name:'베타 출시',skills:['개발']};
const milestones = [{id:'m1',projectId:'p1',name:'기본 흐름 만들기',order:1},{id:'m2',projectId:'p1',name:'첫 사용자 경험',order:2}];
const quest = {goal:'첫 사용자가 퀘스트를 완료한다',reason:'작은 화면에서도 길을 잃지 않게',nextAction:'첫 화면의 안내 문구 확인',role:'main',cadence:'once',challenge:'normal',tracked:false,successCriteria:'작은 화면의 한글 확인\\n결과물 확인',scheduledAt:'',links:[{kind:'pr',url:'https://github.com/example/review/pull/128'}]};
const seed = {
 todos:[{id:'i1',title:'개인 메모 정리',completed:false,createdAt:'2026-09-15T01:00:00Z'}],
 tasks:[{id:'t1',milestoneId:'m1',title:'첫 퀘스트 완료 흐름 다듬기',body:'사용자 여정을 확인하고 결과를 검토합니다.',status:'review',assignee:'human',skills:['개발'],blocked:false,quest:{...quest,tracked:true}},
 {id:'t2',milestoneId:'m1',title:'빈 화면 안내 문구 작성',body:'',status:'doing',assignee:'human',skills:[],blocked:false,quest:{...quest}},
 {id:'t3',milestoneId:'m1',title:'온보딩 체크리스트 정리',body:'제안을 먼저 확인하세요.',status:'todo',assignee:'human',skills:[],blocked:false,quest:{...quest,acceptance:'pending'}},
 {id:'t4',milestoneId:'m2',title:'첫 사용자 테스트',body:'',status:'todo',assignee:'human',skills:[],blocked:false,quest:{...quest}}]
};
const state = JSON.parse(sessionStorage.getItem('ui-fixture') || 'null') || seed;
const persist=()=>sessionStorage.setItem('ui-fixture',JSON.stringify(state));
const clone=value=>structuredClone(value);
const graph=()=>({workspace,project,milestones,tasks:state.tasks});
const repository = {
 listInboxTodos:async()=>clone(state.todos),
 saveInboxTodo:async(todo)=>{const i=state.todos.findIndex(t=>t.id===todo.id); if(i<0)state.todos.push(clone(todo));else state.todos[i]=clone(todo);persist();},
 deleteInboxTodo:async(id)=>{state.todos=state.todos.filter(t=>t.id!==id);persist();},
 listProjectTodos:async()=>clone(state.tasks.map(task=>({task,workspace,project,milestone:milestones.find(m=>m.id===task.milestoneId)}))),
 listProjectGraphs:async()=>clone([graph()]),listWorkspaces:async()=>clone([workspace]),
 saveTask:async(task)=>{if(window.failNextSave){window.failNextSave=false;throw new Error('fixture save failed');} state.tasks=state.tasks.map(t=>t.id===task.id?clone(task):t);persist();},
 listPluginConnections:async()=>[],getCharacter:async()=>({name:'탐험가',job:'developer',spriteId:'developer'}),
 listTaskComments:async()=>[],getLoadout:async()=>undefined,
};
export async function getRepository(){return repository;}
`;

(async () => {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.UI_SMOKE_BROWSER || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 420, height: 640 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/data/repository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
      if (cmd === 'get_app_settings') return { autoUpdate: false, launchAtLogin: false };
      if (cmd === 'save_app_settings') return args.settings;
      if (cmd === 'get_window_pinned') return false;
      if (cmd === 'set_window_pinned') return args.pinned;
      if (cmd === 'discover_tools') return Object.fromEntries(['claude', 'gh', 'jj'].map(id => [id, { id, installed: false, authenticated: false }]));
      if (cmd === 'discover_inventory') return { apps: [], tools: Object.fromEntries(['claude', 'gh', 'jj'].map(id => [id, { id, installed: false, authenticated: false }])) };
      if (cmd.startsWith('plugin:opener')) { window.lastSource = args; return; }
      if (cmd.startsWith('plugin:autostart')) return false;
      if (cmd.startsWith('plugin:event')) return 1;
      throw new Error('Unexpected fixture invoke: ' + cmd);
    }, transformCallback: () => 1 };
  });
  try {
    await page.goto(url);
    await page.getByRole('button', { name: '검토 열기', exact: true }).waitFor();
    const openReview = () => page.getByRole('button', { name: '검토 열기', exact: true }).click();
    await openReview();
    const dialog = page.getByRole('dialog');
    const finish = dialog.getByRole('button', { name: '완료 확인', exact: true });
    assert(await finish.isDisabled(), 'completion must require explicit human review');
    await dialog.getByLabel('작업 결과와 완료 조건을 직접 확인했습니다.').check();
    assert(await finish.isDisabled(), 'all criteria must be checked');
    await dialog.getByLabel('작은 화면의 한글 확인', { exact: true }).check();
    await dialog.getByLabel('결과물 확인', { exact: true }).check();
    assert(await finish.isEnabled());
    await page.evaluate(() => { window.failNextSave = true; });
    await finish.click();
    await dialog.getByRole('alert').waitFor();
    assert(await dialog.isVisible(), 'failed save must retain review');
    await page.screenshot({ path: output + '/review-420.png' });
    await finish.click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('group', { name: '퀘스트 상태 필터' }).getByRole('button', { name: '완료', exact: true }).click();
    await page.locator('.quest-queue-row').filter({ hasText: '첫 퀘스트 완료 흐름 다듬기' }).waitFor();
    await page.reload();
    await page.getByRole('group', { name: '퀘스트 상태 필터' }).getByRole('button', { name: '완료', exact: true }).click();
    await page.locator('.quest-queue-row').filter({ hasText: '첫 퀘스트 완료 흐름 다듬기' }).waitFor();
    await page.getByRole('button', { name: '미수락', exact: true }).click();
    await page.locator('.quest-queue-row').filter({ hasText: '온보딩' }).click();
    assert.equal(await dialog.getByRole('button', { name: '완료 확인', exact: true }).count(), 0);
    await dialog.getByRole('button', { name: '퀘스트 수락', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.quest-queue-row').count(), 0);
    await page.getByRole('button', { name: '진행할 일', exact: true }).click();
    await page.locator('.quest-queue-row').filter({ hasText: '첫 사용자 테스트' }).click();
    assert(await dialog.getByRole('button', { name: '퀘스트 시작', exact: true }).isDisabled(), 'locked stage cannot start from the global queue');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('.quest-queue-row').filter({ hasText: '온보딩' }).click();
    await dialog.getByRole('button', { name: '내용 편집' }).click();
    await dialog.getByLabel('퀘스트 제목', { exact: true }).fill('온보딩 안내 수정');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('.quest-queue-row').filter({ hasText: '온보딩 안내 수정' }).click();
    await dialog.getByRole('button', { name: '퀘스트 시작', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByLabel('새 퀘스트 제목').fill('새 개인 퀘스트');
    await page.getByRole('button', { name: '추가', exact: true }).click();
    await page.locator('.quest-queue-row').filter({ hasText: '새 개인 퀘스트' }).click();
    await dialog.getByRole('button', { name: '퀘스트 삭제' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '되돌리기', exact: true }).click();
    await page.locator('.quest-queue-row').filter({ hasText: '새 개인 퀘스트' }).waitFor();
    for (const width of [375, 420, 768, 1280]) {
      await page.setViewportSize({ width, height: width < 760 ? 640 : 900 });
      await page.screenshot({ path: output + '/home-' + width + '.png' });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflow at ' + width);
      assert(await page.locator('.main-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'content overflow at ' + width);
      await page.getByRole('navigation').getByRole('button', { name: '원정', exact: true }).click();
      await page.getByRole('button', { name: /베타 출시/ }).click();
      await page.screenshot({ path: output + '/expedition-' + width + '.png' });
      assert(await page.locator('.main-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'expedition overflow at ' + width);
      await page.getByRole('navigation').getByRole('button', { name: '퀘스트', exact: true }).click();
      await page.getByRole('heading', { name: '지금의 퀘스트' }).waitFor();
    }
    await page.setViewportSize({ width: 420, height: 640 });
    for (const theme of ['레트로', '별빛 모험', '기본']) {
      await page.getByRole('button', { name: '앱 설정', exact: true }).click();
      await page.getByRole('button', { name: '테마와 앱 동작' }).click();
      await dialog.getByRole('button', { name: new RegExp('^' + theme) }).click();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.activeElement.textContent), '테마와 앱 동작');
      await page.getByRole('navigation').getByRole('button', { name: '퀘스트', exact: true }).click();
      await page.screenshot({ path: output + '/theme-' + theme + '.png' });
      assert(await page.locator('.main-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'theme overflow ' + theme);
    }
    await page.locator('.quest-queue-row').first().click();
    await page.keyboard.press('Tab');
    assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'focus stays in modal');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('navigation').getByRole('button', { name: '캐릭터', exact: true }).click();
    await page.getByText('완료한 퀘스트', { exact: true }).waitFor();
    assert.equal(await page.locator('.character-completion-stat').count(), 2);
    assert.equal(await page.locator('.character-completion-stat').first().locator('strong').textContent(), '1');
    await page.screenshot({ path: output + '/character-420.png' });
    assert.equal(errors.length, 0, errors.join('\n'));
    if (process.env.UI_SMOKE_REFERENCE) {
      const reference = await browser.newPage({ viewport: { width: 420, height: 640 } });
      await reference.goto(pathToFileURL(process.env.UI_SMOKE_REFERENCE).href);
      await reference.screenshot({ path: output + '/reference-420.png' });
      await reference.close();
    }
    console.log('PASS: review gate, failure/retry, persisted fixture reload, acceptance, edit/start, stage lock, capture/delete/undo, 4 sizes, 3 themes, character stats, focus/Escape.');
    console.log('Screenshots: ' + output);
  } catch (error) {
    await page.screenshot({ path: output + '/failure.png' });
    console.error(await page.locator('body').ariaSnapshot());
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
