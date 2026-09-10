import { PixelIcon } from "./PixelIcon";

interface AppHeaderProps {
  readonly todoCount: number;
  readonly pinned: boolean;
  readonly onTogglePinned: () => void;
  readonly onOpenProject: () => void;
  readonly projectLabel?: string;
  readonly countLabel?: string;
  readonly onOpenSettings?: () => void;
}

export function AppHeader({
  todoCount, pinned, onTogglePinned, onOpenProject,
  projectLabel = "프로젝트", countLabel = "완료하지 않은 인박스 할 일 수", onOpenSettings,
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark"><PixelIcon name="star" /></span>
        <h1>Queuest</h1>
      </div>
      <div className="topbar-actions">
        <span className="active-counter" title={countLabel} aria-label={`${countLabel}: ${todoCount}`}>{todoCount}</span>
        <button className={`icon-button pin-button ${pinned ? "active" : ""}`} type="button"
          aria-label={pinned ? "팝오버 고정 해제" : "팝오버 고정"} aria-pressed={pinned}
          title={pinned ? "팝오버 고정 해제" : "포커스를 잃어도 팝오버 유지"}
          onClick={onTogglePinned}><PixelIcon name="pin" /></button>
        <button className="topbar-project-button" type="button" onClick={onOpenProject}>{projectLabel}</button>
        {onOpenSettings && <button className="icon-button" type="button" aria-label="프로젝트 설정" onClick={onOpenSettings}><PixelIcon name="settings" /></button>}
      </div>
    </header>
  );
}
