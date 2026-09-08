import { useMemo, useState } from "react";
import {
  activeTaskCount,
  advanceTaskStatus,
  calculateExperience,
  calculateLevel,
  calculateMilestoneProgress,
  calculateProjectProgress,
  calculateProjectStatus,
  calculateSkillSummaries,
  canAssignToAi,
  isMilestoneComplete,
  isMilestoneUnlocked,
} from "@queuest/domain";
import type { Task, TaskStatus } from "@queuest/domain";
import {
  DEMO_CHARACTER,
  DEMO_LOADOUT,
  DEMO_MILESTONES,
  DEMO_PROJECT,
  DEMO_TASKS,
  DEMO_WORKSPACE,
} from "./data/demo";
import "./App.css";

const STATUS_COLUMNS: Array<{ status: TaskStatus; label: string; hint: string }> = [
  { status: "todo", label: "대기", hint: "아직 시작하지 않은 퀘스트" },
  { status: "doing", label: "진행 중", hint: "지금 손을 대고 있는 퀘스트" },
  { status: "review", label: "검토 대기", hint: "AI 또는 작업 결과를 확인할 차례" },
  { status: "done", label: "완료", hint: "사람이 완주를 확인한 퀘스트" },
];

const PROJECT_STATUS_LABEL: Record<ReturnType<typeof calculateProjectStatus>, string> = {
  "not-started": "출발 전",
  active: "원정 중",
  complete: "완주",
};

function App() {
  const [tasks, setTasks] = useState<Task[]>(DEMO_TASKS);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState(DEMO_MILESTONES[1].id);

  const selectedMilestone =
    DEMO_MILESTONES.find((milestone) => milestone.id === selectedMilestoneId) ??
    DEMO_MILESTONES[0];
  const projectProgress = calculateProjectProgress(DEMO_MILESTONES, tasks);
  const projectStatus = calculateProjectStatus(DEMO_MILESTONES, tasks);
  const experience = calculateExperience(DEMO_MILESTONES, tasks);
  const level = calculateLevel(experience);
  const skillSummaries = calculateSkillSummaries(
    DEMO_PROJECT,
    DEMO_MILESTONES,
    tasks,
    DEMO_CHARACTER,
  );
  const aiReady = canAssignToAi(DEMO_PROJECT, DEMO_LOADOUT);
  const selectedTasks = useMemo(
    () => tasks.filter((task) => task.milestoneId === selectedMilestone.id),
    [selectedMilestone.id, tasks],
  );
  const activeCount = activeTaskCount(tasks);

  function updateTaskStatus(taskId: string, status: TaskStatus) {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status } : task)),
    );
  }

  function moveTaskForward(task: Task) {
    updateTaskStatus(task.id, advanceTaskStatus(task.status));
  }

  function assignTaskToAi(task: Task) {
    if (!aiReady) {
      return;
    }

    setTasks((current) =>
      current.map((item) =>
        item.id === task.id ? { ...item, assignee: "ai", status: "doing" } : item,
      ),
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            Q
          </div>
          <div>
            <p className="eyebrow">MENU BAR QUEST BOARD</p>
            <h1>Queuest</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="active-counter" title="현재 진행 중인 태스크 수">
            <span aria-hidden="true">◆</span> {activeCount}
          </span>
          <button className="icon-button" type="button" aria-label="설정">
            ⚙
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="workspace-header" aria-labelledby="workspace-title">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h2 id="workspace-title">{DEMO_WORKSPACE.name}</h2>
          </div>
          <span className="workspace-chip">로컬 저장소</span>
        </section>

        <section className="project-banner" aria-labelledby="project-title">
          <div className="project-heading">
            <div className="project-token" aria-hidden="true">
              ✦
            </div>
            <div>
              <p className="eyebrow">EXPEDITION 01</p>
              <h2 id="project-title">{DEMO_PROJECT.name}</h2>
            </div>
          </div>
          <div className="project-stats">
            <span className={`status-pill ${projectStatus}`}>
              {PROJECT_STATUS_LABEL[projectStatus]}
            </span>
            <span className="project-percent">{projectProgress}%</span>
          </div>
          <div className="progress-track" aria-label={`프로젝트 진행률 ${projectProgress}%`}>
            <span style={{ width: `${projectProgress}%` }} />
          </div>
        </section>

        <section className="stage-section" aria-labelledby="stage-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ROUTE MAP</p>
              <h2 id="stage-title">원정 경로</h2>
            </div>
            <span className="section-note">앞 스테이지를 통과하면 다음이 열린다</span>
          </div>

          <div className="stage-map" role="list" aria-label="프로젝트 마일스톤">
            {DEMO_MILESTONES.map((milestone, index) => {
              const unlocked = isMilestoneUnlocked(milestone.id, DEMO_MILESTONES, tasks);
              const complete = isMilestoneComplete(milestone.id, tasks);
              const selected = milestone.id === selectedMilestone.id;

              return (
                <div className="stage-step" key={milestone.id} role="listitem">
                  {index > 0 && <span className="stage-connector" aria-hidden="true" />}
                  <button
                    className={`stage-node ${selected ? "selected" : ""} ${complete ? "complete" : ""}`}
                    type="button"
                    disabled={!unlocked}
                    aria-current={selected ? "step" : undefined}
                    aria-label={`${milestone.name}, ${complete ? "완료" : unlocked ? "열림" : "잠김"}`}
                    onClick={() => setSelectedMilestoneId(milestone.id)}
                  >
                    <span className="stage-number">{complete ? "✓" : index + 1}</span>
                    {!unlocked && <span className="lock-mark" aria-hidden="true">⌑</span>}
                  </button>
                  <span className={`stage-label ${selected ? "selected" : ""}`}>
                    {milestone.name}
                  </span>
                  <span className="stage-progress">
                    {calculateMilestoneProgress(milestone.id, tasks)}%
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="quest-section" aria-labelledby="quest-title">
          <div className="section-heading quest-heading">
            <div>
              <p className="eyebrow">STAGE {selectedMilestone.order}</p>
              <h2 id="quest-title">{selectedMilestone.name}</h2>
            </div>
            <span className="section-note">{selectedTasks.length}개의 퀘스트</span>
          </div>

          <div className="board" aria-label={`${selectedMilestone.name} 상태 보드`}>
            {STATUS_COLUMNS.map((column) => {
              const columnTasks = selectedTasks.filter((task) => task.status === column.status);

              return (
                <section className={`quest-column ${column.status}`} key={column.status}>
                  <header className="column-header">
                    <div>
                      <h3>{column.label}</h3>
                      <p>{column.hint}</p>
                    </div>
                    <span className="column-count">{columnTasks.length}</span>
                  </header>
                  <div className="column-cards">
                    {columnTasks.length === 0 ? (
                      <p className="empty-column">이 칸은 비어 있다</p>
                    ) : (
                      columnTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          aiReady={aiReady}
                          onAdvance={() => moveTaskForward(task)}
                          onAssignAi={() => assignTaskToAi(task)}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        <section className="character-sheet" aria-labelledby="character-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CHARACTER SHEET</p>
              <h2 id="character-title">나의 캐릭터</h2>
            </div>
            <span className="sheet-rule">계산되는 뷰</span>
          </div>

          <div className="character-summary">
            <div className="sprite" aria-label={`${DEMO_CHARACTER.job} 도트 캐릭터`} role="img">
              <span aria-hidden="true">●</span>
              <span aria-hidden="true">╱▌╲</span>
              <span aria-hidden="true">╱ ╲</span>
            </div>
            <div className="character-copy">
              <div className="character-name-row">
                <h3>{DEMO_CHARACTER.name}</h3>
                <span className="job-badge">개발자</span>
              </div>
              <p>Lv. {level} 원정대원</p>
              <div className="xp-row">
                <span>XP {experience}</span>
                <span>다음 레벨까지 {Math.max(0, 100 - (experience % 100))}</span>
              </div>
              <div className="xp-track" aria-label={`경험치 ${experience}`}>
                <span style={{ width: `${Math.min(100, experience % 100 || (experience > 0 ? 100 : 0))}%` }} />
              </div>
            </div>
          </div>

          <div className="sheet-grid">
            <div className="skill-panel">
              <div className="panel-heading">
                <h3>스킬</h3>
                <span>완료 태스크 기준</span>
              </div>
              <div className="skill-list">
                {skillSummaries.map((skill) => (
                  <div className={`skill-row ${skill.emphasized ? "emphasized" : ""}`} key={skill.name}>
                    <div className="skill-label">
                      <span>{skill.name}</span>
                      <strong>{skill.level}</strong>
                    </div>
                    <div className="skill-track" aria-label={`${skill.name} 레벨 ${skill.level}`}>
                      <span style={{ width: `${Math.min(100, skill.level * 20)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="equipment-panel">
              <div className="panel-heading">
                <h3>장비</h3>
                <span>프로젝트 설정</span>
              </div>
              <EquipmentSlot
                label="에이전트"
                value={DEMO_LOADOUT.agentTool ?? "비어 있음"}
                ready={aiReady}
                detail={DEMO_PROJECT.repoPath ? "실행 준비됨" : "repoPath 연결 대기"}
              />
              <EquipmentSlot
                label="소스"
                value={DEMO_LOADOUT.sourceTool ?? "비어 있음"}
                ready={Boolean(DEMO_LOADOUT.sourceTool)}
                detail="가져오기 어댑터"
              />
            </div>
          </div>

          <div className="inventory-line">
            <span className="inventory-label">발견한 도구</span>
            <span className="tool-tag equipped">claude</span>
            <span className="tool-tag equipped">gh</span>
            <span className="tool-tag muted">jj</span>
            <span className="inventory-note">PATH 스캔은 Tauri 셸 연결 후 활성화</span>
          </div>
        </section>

        <p className="prototype-note">
          초기 화면은 데모 데이터로 동작합니다. SQLite 어댑터와 외부 도구 포트는 준비되어 있으며, 다음 단계에서 이 화면의 상태를 로컬 DB에 연결합니다.
        </p>
      </main>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  aiReady: boolean;
  onAdvance: () => void;
  onAssignAi: () => void;
}

function TaskCard({ task, aiReady, onAdvance, onAssignAi }: TaskCardProps) {
  const nextStatus = advanceTaskStatus(task.status);
  const nextLabel = STATUS_COLUMNS.find((column) => column.status === nextStatus)?.label;

  return (
    <article className={`quest-card ${task.status} ${task.blocked ? "blocked" : ""}`}>
      <div className="card-meta">
        <span className="card-status">{STATUS_COLUMNS.find((column) => column.status === task.status)?.label}</span>
        <span className="card-assignee">{task.assignee === "ai" ? "AI" : "나"}</span>
      </div>
      <h4>{task.title}</h4>
      <p>{task.body}</p>
      <div className="card-tags">
        {task.skills.map((skill) => (
          <span key={skill}>#{skill}</span>
        ))}
        {task.assignee === "ai" && <span className="return-badge">AI 귀환</span>}
      </div>
      <div className="card-actions">
        {task.status !== "done" && (
          <button className="advance-button" type="button" onClick={onAdvance}>
            다음: {nextLabel}
          </button>
        )}
        {task.status !== "done" && (
          <button
            className="ai-button"
            type="button"
            disabled={!aiReady || task.assignee === "ai"}
            title={aiReady ? "Claude에게 작업을 맡깁니다" : "프로젝트 repoPath를 먼저 연결하세요"}
            onClick={onAssignAi}
          >
            {task.assignee === "ai" ? "실행 중" : "AI에게 맡기기"}
          </button>
        )}
      </div>
    </article>
  );
}

interface EquipmentSlotProps {
  label: string;
  value: string;
  ready: boolean;
  detail: string;
}

function EquipmentSlot({ label, value, ready, detail }: EquipmentSlotProps) {
  return (
    <div className={`equipment-slot ${ready ? "ready" : "waiting"}`}>
      <div className="equipment-icon" aria-hidden="true">
        {ready ? "✦" : "·"}
      </div>
      <div>
        <span className="equipment-label">{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export default App;
