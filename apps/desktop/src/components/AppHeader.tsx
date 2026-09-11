import { PixelIcon } from "./PixelIcon";

interface AppHeaderProps {
  readonly todoCount: number;
  readonly pinned: boolean;
  readonly pinPending: boolean;
  readonly onTogglePinned: () => void;
  readonly onOpenProject: () => void;
  readonly projectLabel?: string;
  readonly countLabel?: string;
  readonly onOpenSettings?: () => void;
}

export function AppHeader({
  todoCount, pinned, pinPending, onTogglePinned, onOpenProject,
  projectLabel = "프로젝트", countLabel = "완료하지 않은 인박스 할 일 수", onOpenSettings,
}: AppHeaderProps) {
  const draggable = !pinned && !pinPending;
  return (
    <header className="topbar" data-tauri-drag-region={draggable}>
      <div className="brand-lockup" data-tauri-drag-region={draggable}>
        <span className="brand-mark" data-tauri-drag-region={draggable}><PixelIcon name="star" /></span>
        <h1 data-tauri-drag-region={draggable}>Queuest</h1>
      </div>
      <div className="topbar-actions">
        <span className="active-counter" title={countLabel} aria-label={`${countLabel}: ${todoCount}`}>{todoCount}</span>
        <button className={`icon-button pin-button ${pinned ? "active" : ""}`} type="button"
          aria-label={pinned ? "팝오버 고정 해제" : "팝오버 고정"} aria-pressed={pinned}
          disabled={pinPending}
          title={pinned ? "고정 해제: 드래그 이동 허용, 다른 앱을 클릭하면 숨기기" : "드래그 이동을 잠그고 항상 위에 표시"}
          onClick={onTogglePinned}><PixelIcon name="pin" /></button>
        <button className="topbar-project-button" type="button" onClick={onOpenProject}>{projectLabel}</button>
        {onOpenSettings && <button className="icon-button" type="button" aria-label="프로젝트 설정" onClick={onOpenSettings}><PixelIcon name="settings" /></button>}
      </div>
    </header>
  );
}
