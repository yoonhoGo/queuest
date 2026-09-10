import { useState } from "react";
import type { FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Workspace } from "@queuest/domain";
import type { NewProjectInput } from "../data/project";
import { DirectoryField } from "./DirectoryField";

interface ProjectCreateFormProps {
  workspace: Workspace;
  initialTaskTitle?: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: NewProjectInput) => Promise<boolean>;
}

function repositoryName(value: string): string {
  return value.trim().replace(/\/+$/, "").split(/[/:]/).at(-1)?.replace(/\.git$/, "") ?? "";
}

export function ProjectCreateForm({ workspace, initialTaskTitle, submitting, onCancel, onSubmit }: ProjectCreateFormProps) {
  const [name, setName] = useState("");
  const [firstTaskTitle, setFirstTaskTitle] = useState(initialTaskTitle ?? "");
  const [repoPath, setRepoPath] = useState("");
  const [skills, setSkills] = useState("");
  const [source, setSource] = useState<"folder" | "clone">("folder");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [directoryName, setDirectoryName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const busy = submitting || cloning || choosing;

  function selectFolder(path: string) {
    setRepoPath(path);
    if (!name.trim()) setName(path.split(/[\\/]/).filter(Boolean).at(-1) ?? "");
  }

  function updateRepository(value: string) {
    const previous = repositoryName(repositoryUrl);
    const suggested = repositoryName(value);
    setRepositoryUrl(value);
    if (!directoryName.trim() || directoryName === previous) setDirectoryName(suggested);
    if (!name.trim() || name === previous) setName(suggested);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setValidationError("프로젝트 이름을 입력하세요.");
      return;
    }
    setValidationError(null);
    let path = repoPath.trim();
    try {
      if (source === "clone") {
        if (!repositoryUrl.trim() || !parentPath.trim() || !directoryName.trim()) {
          setValidationError("저장소 주소, 저장 위치, 새 폴더 이름을 모두 지정하세요.");
          return;
        }
        setCloning(true);
        path = await invoke<string>("clone_project_repository", {
          repositoryUrl: repositoryUrl.trim(), parentPath: parentPath.trim(), directoryName: directoryName.trim(),
        });
        setRepoPath(path);
        setSource("folder");
      }
      await onSubmit({
        name: name.trim(),
        firstTaskTitle: firstTaskTitle.trim() || undefined,
        repoPath: path || undefined,
        skills: [...new Set(skills.split(",").map((skill) => skill.trim()).filter(Boolean))],
      });
    } catch (reason: unknown) {
      setValidationError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "프로젝트를 불러오지 못했습니다.");
    } finally {
      setCloning(false);
    }
  }

  return (
    <form className="project-create-form" onSubmit={handleSubmit} aria-busy={busy}>
      <div className="section-heading">
        <div><p className="eyebrow">NEW EXPEDITION</p><h2>새 프로젝트 만들기</h2></div>
        <span className="section-note">{workspace.name}</span>
      </div>
      <fieldset className="project-source" disabled={busy}>
        <legend>프로젝트 가져오기</legend>
        <label><input type="radio" name="project-source" checked={source === "folder"} onChange={() => { setSource("folder"); setValidationError(null); }} />기존 폴더</label>
        <label><input type="radio" name="project-source" checked={source === "clone"} onChange={() => { setSource("clone"); setValidationError(null); }} />Git clone</label>
      </fieldset>
      {source === "folder" ? (
        <DirectoryField label="작업 폴더 (선택)" value={repoPath} disabled={busy} onChange={selectFolder} onBusyChange={setChoosing} />
      ) : (
        <>
          <label htmlFor="clone-url">Git 저장소 주소</label>
          <input id="clone-url" value={repositoryUrl} disabled={busy} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="https://github.com/owner/repo.git" onChange={(event) => updateRepository(event.target.value)} />
          <DirectoryField label="Clone 저장 위치" value={parentPath} disabled={busy} onChange={setParentPath} onBusyChange={setChoosing} />
          <label htmlFor="clone-directory">새 폴더 이름</label>
          <input id="clone-directory" value={directoryName} disabled={busy} placeholder="repo" onChange={(event) => setDirectoryName(event.target.value)} />
          <p className="field-hint clone-destination">{parentPath && directoryName ? `${parentPath.replace(/\/$/, "")}/${directoryName}` : "선택한 위치 아래에 새 폴더를 만듭니다."}</p>
        </>
      )}
      <label htmlFor="project-name">프로젝트 이름</label>
      <input id="project-name" value={name} disabled={busy} placeholder="예: Queuest" onChange={(event) => setName(event.target.value)} />
      <label htmlFor="first-task-title">첫 퀘스트 <span>(선택)</span></label>
      <input id="first-task-title" value={firstTaskTitle} disabled={busy} placeholder="첫 번째 할 일" onChange={(event) => setFirstTaskTitle(event.target.value)} />
      <label htmlFor="new-project-skills">프로젝트 스킬 <span>(선택)</span></label>
      <input id="new-project-skills" value={skills} disabled={busy} placeholder="typescript, tauri, rust" onChange={(event) => setSkills(event.target.value)} />
      {cloning && <p className="field-hint" role="status">저장소를 clone하고 있습니다. 완료되면 프로젝트를 엽니다.</p>}
      {validationError && <p className="validation-note" role="alert">{validationError}</p>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={busy}>
          {cloning ? "Clone 중…" : submitting ? "저장 중…" : source === "clone" ? "Clone 후 프로젝트 열기" : "프로젝트 만들기"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>취소</button>
      </div>
    </form>
  );
}
