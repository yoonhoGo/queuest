import { PixelIcon } from "./PixelIcon";
import { Button, IconButton } from "./ui";

interface AppHeaderProps {
  readonly todoCount: number;
  readonly pinned: boolean;
  readonly pinPending: boolean;
  readonly onTogglePinned: () => void;
  readonly onOpenProject: () => void;
  readonly projectLabel?: string;
  readonly countLabel?: string;
  readonly onOpenSettings?: () => void;
  readonly onOpenAppSettings?: () => void;
}

export function AppHeader({
  todoCount, pinned, pinPending, onTogglePinned, onOpenProject,
  projectLabel = "원정", countLabel = "완료하지 않은 인박스 할 일 수", onOpenSettings, onOpenAppSettings,
}: AppHeaderProps) {
  const draggable = !pinned && !pinPending;
  return (
    <header className="topbar" data-tauri-drag-region={draggable}>
      <div className="brand-lockup" data-tauri-drag-region={draggable}>
        <span className="brand-mark" data-tauri-drag-region={draggable}>
          <PixelIcon name="star" />
          <span className="brand-flag" aria-hidden="true"><PixelIcon name="flag" /></span>
        </span>
        <div className="brand-copy" data-tauri-drag-region={draggable}>
          <h1 data-tauri-drag-region={draggable}>Queuest</h1>
          <p data-tauri-drag-region={draggable}>작은 퀘스트로 채우는 하루</p>
        </div>
      </div>
      <div className="topbar-actions">
        <span className="active-counter" title={countLabel} aria-label={`${countLabel}: ${todoCount}`}>
          <PixelIcon name="bell" />
          {todoCount > 0 && <span>{todoCount}</span>}
        </span>
        <IconButton className={`pin-button ${pinned ? "active" : ""}`}
          label={pinned ? "팝오버 고정 해제" : "팝오버 고정"} aria-pressed={pinned}
          disabled={pinPending}
          title={pinned ? "고정 해제: 드래그 이동 허용, 다른 앱을 클릭하면 숨기기" : "드래그 이동을 잠그고 항상 위에 표시"}
          onClick={onTogglePinned}><PixelIcon name="pin" /></IconButton>
        {onOpenAppSettings && <IconButton className="theme-button" label="앱 설정" title="앱 설정" onClick={onOpenAppSettings}><PixelIcon name="settings" /></IconButton>}
        <Button variant="secondary" size="small" className="topbar-project-button" onClick={onOpenProject}>{projectLabel}</Button>
        {onOpenSettings && <IconButton label="원정 설정" onClick={onOpenSettings}><PixelIcon name="settings" /></IconButton>}
      </div>
    </header>
  );
}
