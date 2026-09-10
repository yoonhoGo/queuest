const names = { tasks: '할 일', project: '프로젝트', character: '캐릭터', plugins: '플러그인' };
const initial = [
  { id: 1, title: '로그인 화면 완성하기', tag: 'Queuest', xp: 30, done: false },
  { id: 2, title: '포트폴리오 정리', tag: '개인', xp: 30, done: false },
  { id: 3, title: '프로젝트 아이디어 메모', tag: '기획', xp: 10, done: false },
  { id: 4, title: '산책 20분', tag: '건강', xp: 10, done: true },
  { id: 5, title: '책 10쪽 읽기', tag: '자기계발', xp: 10, done: true },
];
let tasks = structuredClone(initial);
let mode = 'overview';
let views = ['tasks', 'project', 'character'];
let projectDone = new Set();
const connections = new Set();
const pinned = new Set();
const host = document.querySelector('#windows');
let noticeTimer;
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const completed = () => tasks.filter((task) => task.done).length;
const experience = () => 700 + tasks.filter((task) => task.done).reduce((sum, task) => sum + task.xp, 0) + projectDone.size * 30;
function meter(value, max, label, mint = false) {
  return `<div class="meter ${mint ? 'mint-meter' : ''}"><progress value="${value}" max="${max}" aria-label="${label}"></progress></div>`;
}
function taskRow(task, scope, index) {
  const id = `${scope}-${index}-${task.id}`;
  return `<div class="task ${task.done ? 'done' : ''}"><input id="${id}" type="checkbox" data-scope="${scope}" data-task="${task.id}" ${task.done ? 'checked' : ''}><label class="task-title" for="${id}">${escape(task.title)}</label>${task.tag ? `<span class="tag">${escape(task.tag)}</span>` : ''}<span class="xp">+${task.xp} XP</span></div>`;
}
function tasksView(index) {
  return `<div class="view-heading">${icon('clipboard')}<div><h2>오늘의 퀘스트</h2><p>한 걸음씩, 오늘도 레벨 업!</p></div></div>
  <div class="progress-row">${meter(completed(), tasks.length, '오늘의 퀘스트 완료율')}<b>${completed()} / ${tasks.length} 완료</b></div>
  <form class="add-form" data-add="${index}"><label class="sr-only" for="add-${index}">새 퀘스트</label><input id="add-${index}" name="title" placeholder="새 퀘스트 추가" maxlength="120" required autocomplete="off"><button aria-label="퀘스트 추가">+</button></form>
  <div class="task-list">${tasks.map((task) => taskRow(task, 'task', index)).join('')}</div><button class="primary" data-focus="${index}">+ 퀘스트 만들기</button>`;
}
const projectTasks = [
  { id: 11, title: '프로젝트 보드 다듬기', tag: 'UI/UX', xp: 30 },
  { id: 12, title: '퀘스트 필터 추가', tag: '기능', xp: 30 },
  { id: 13, title: '키보드 단축키', tag: '편의성', xp: 30 },
];
function projectView(index) {
  const row = (task) => taskRow({ ...task, done: projectDone.has(task.id) }, 'project', index);
  return `<p class="breadcrumb">프로젝트 / Queuest</p><div class="view-heading">${icon('flag')}<div><h2>Queuest 만들기</h2><p>작지만 특별한, 나만의 퀘스트 앱</p></div></div>
  <section class="stage"><div class="stage-top"><div class="stage-number">STAGE<strong>02</strong></div><div><h3>핵심 기능 구현</h3><p>더 나은 하루를 위한 핵심을 완성해요.</p></div></div><div class="progress-row">${meter(3 + projectDone.size, 6, '프로젝트 진행률', true)}<b>${Math.round((3 + projectDone.size) / 6 * 100)}%</b></div></section>
  <details class="status-section doing" open><summary>진행 중 · ${projectDone.has(11) ? 0 : 1}</summary>${projectDone.has(11) ? '' : row(projectTasks[0])}</details>
  <details class="status-section" open><summary>할 일 · ${projectTasks.slice(1).filter((task) => !projectDone.has(task.id)).length}</summary>${projectTasks.slice(1).filter((task) => !projectDone.has(task.id)).map(row).join('')}</details>
  <details class="status-section done"><summary>완료 · ${3 + projectDone.size}</summary><p class="preview-note" style="padding:12px;margin:0">프로젝트 생성 · 화면 구성 · 디자인 시안</p>${projectTasks.filter((task) => projectDone.has(task.id)).map(row).join('')}</details>
  <p class="preview-note">체크박스로 퀘스트를 완료해 보세요.</p>`;
}
function characterView() {
  const xp = experience();
  return `<div class="view-heading">${icon('star')}<div><h2>나의 캐릭터</h2><p>오늘도 멋진 하루를 만들어가는 중!</p></div></div>
  <div class="character-layout"><img class="portrait" src="assets/adventurer.webp" alt="민트색 망토를 입고 금빛 지팡이를 든 픽셀 모험가" width="384" height="384" fetchpriority="high"><div class="character-info"><h3>예림</h3><span class="level">Lv. ${12 + Math.floor(xp / 1000)}</span><p>꾸준한 모험가</p>${meter(xp % 1000, 1000, '다음 레벨까지의 경험치')}<span class="xp-total">${xp % 1000} / 1,000 XP</span></div></div>
  <div class="stats"><div class="stat">${icon('clipboard')}<div><p>완료한 퀘스트</p><b>${46 + completed() + projectDone.size}</b></div></div><div class="stat">${icon('flag')}<div><p>완료한 스테이지</p><b>${7 + (projectDone.size === 3 ? 1 : 0)}</b></div></div></div>
  <section class="skills"><h3>스킬</h3><div class="skill-grid">${[['book', '집중', '더 깊이 생각해요'], ['sprout', '꾸준함', '매일 조금씩'], ['bolt', '실행력', '생각을 행동으로']].map(([symbol, title, copy]) => `<div class="skill">${icon(symbol)}<b>${title}</b><p>${copy}</p></div>`).join('')}</div></section><p class="character-note">작은 완료가 모여, 나를 성장시켜요.</p>`;
}
function pluginsView() {
  return `<div class="view-heading">${icon('bolt')}<div><h2>플러그인</h2><p>모험에 필요한 도구를 모아 보세요.</p></div></div>${['GitHub', 'Calendar', 'Jira'].map((name) => `<div class="plugin"><div><h3>${name}</h3><small>${connections.has(name) ? '미리보기에서 연결됨' : '연결되지 않음'}</small></div><button data-connect="${name}" aria-pressed="${connections.has(name)}">${connections.has(name) ? '연결 해제' : '연결 체험'}</button></div>`).join('')}<p class="preview-note">연결 상태만 체험할 수 있어요. 실제 계정에는 연결되지 않습니다.</p>`;
}
function windowMarkup(view, index) {
  const body = view === 'tasks' ? tasksView(index) : view === 'project' ? projectView(index) : view === 'character' ? characterView() : pluginsView();
  return `<article class="window-group"><p class="window-label">0${index + 1} / ${names[view]}</p><div class="window"><header class="titlebar">${icon('star')}<span>Queuest</span><button class="pin" data-pin="${index}" aria-label="창 고정" aria-pressed="${pinned.has(index)}" title="미리보기 창 고정">${icon('pin')}</button></header><nav class="tabs" aria-label="${index + 1}번 창 메뉴">${Object.entries(names).map(([key, name]) => `<button data-view="${key}" data-window="${index}" aria-pressed="${view === key}">${name}</button>`).join('')}</nav><div class="window-body">${body}</div></div></article>`;
}
function render() {
  const activeId = document.activeElement?.id;
  const scrollPositions = [...host.querySelectorAll('.window-body')].map((body) => body.scrollTop);
  host.className = `windows ${mode === 'single' ? 'single' : ''}`;
  host.innerHTML = views.slice(0, mode === 'single' ? 1 : 3).map(windowMarkup).join('');
  host.querySelectorAll('.window-body').forEach((body, index) => { body.scrollTop = scrollPositions[index] ?? 0; });
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
}
function notify(message) {
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 2600);
}
host.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const input = event.target;
  const id = Number(input.dataset.task);
  if (input.dataset.scope === 'task') {
    tasks = tasks.map((task) => task.id === id ? { ...task, done: input.checked } : task);
  } else if (input.dataset.scope === 'project') {
    if (input.checked) projectDone.add(id); else projectDone.delete(id);
  } else return;
  notify(input.checked ? '퀘스트 완료! 경험치를 얻었어요.' : '퀘스트를 다시 열었어요.');
  render();
});
host.addEventListener('submit', (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  event.preventDefault();
  const title = String(new FormData(event.target).get('title') ?? '').trim();
  if (!title) return;
  const index = event.target.dataset.add;
  tasks.push({ id: Date.now(), title, tag: '개인', xp: 10, done: false });
  render();
  document.querySelector(`#add-${index}`)?.focus();
  notify('새 퀘스트가 추가됐어요.');
});
host.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) {
    const index = Number(button.dataset.window);
    views[index] = button.dataset.view;
    render();
    host.querySelector(`[data-window="${index}"][data-view="${views[index]}"]`)?.focus();
    host.querySelectorAll('.window-body')[index].scrollTop = 0;
  } else if (button.dataset.focus) {
    document.querySelector(`#add-${button.dataset.focus}`)?.focus();
  } else if (button.dataset.pin !== undefined) {
    const index = Number(button.dataset.pin);
    if (pinned.has(index)) pinned.delete(index); else pinned.add(index);
    button.setAttribute('aria-pressed', String(pinned.has(index)));
    notify(pinned.has(index) ? '창 고정 켜짐 · 미리보기' : '창 고정 꺼짐 · 미리보기');
  } else if (button.dataset.connect) {
    const name = button.dataset.connect;
    if (connections.has(name)) connections.delete(name); else connections.add(name);
    render();
    host.querySelector(`[data-connect="${name}"]`)?.focus();
    notify(`${name} 연결 상태를 변경했어요. (미리보기)`);
  }
});
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  views = ['tasks', 'project', 'character'];
  document.querySelectorAll('[data-mode]').forEach((control) => control.setAttribute('aria-pressed', String(control.dataset.mode === mode)));
  render();
}));
document.querySelector('#reset').addEventListener('click', () => {
  tasks = structuredClone(initial); projectDone = new Set(); connections.clear(); pinned.clear(); render(); notify('처음 모습으로 돌아왔어요.');
});
render();
