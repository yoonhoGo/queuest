use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub(super) struct DirectoryDialogState(AtomicBool);

struct DialogGuard<'a>(&'a AtomicBool);

impl Drop for DialogGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl DirectoryDialogState {
    pub(super) fn is_open(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    fn begin_dialog(&self) -> Result<DialogGuard<'_>, String> {
        self.0
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "이미 폴더 선택 창이 열려 있습니다.".to_string())?;
        Ok(DialogGuard(&self.0))
    }
}

#[tauri::command]
pub(super) async fn choose_project_directory(
    window: WebviewWindow,
    state: State<'_, DirectoryDialogState>,
    title: String,
) -> Result<Option<String>, String> {
    let _guard = state.begin_dialog()?;
    let parent = window.clone();
    let selection = tauri::async_runtime::spawn_blocking(move || {
        parent
            .dialog()
            .file()
            .set_parent(&parent)
            .set_title(title)
            .blocking_pick_folder()
    })
    .await;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    selection
        .map_err(|_| "폴더 선택 창이 중단되었습니다.".to_string())?
        .map(|path| {
            path.into_path()
                .map_err(|error| error.to_string())?
                .into_os_string()
                .into_string()
                .map_err(|_| "선택한 경로를 문자열로 읽을 수 없습니다.".to_string())
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::DirectoryDialogState;

    #[test]
    fn dialog_guard_prevents_overlap_and_resets_after_close() {
        let state = DirectoryDialogState::default();
        assert!(!state.is_open());
        let guard = state.begin_dialog().unwrap();
        assert!(state.is_open());
        assert!(state.begin_dialog().is_err());
        drop(guard);
        assert!(!state.is_open());
        assert!(state.begin_dialog().is_ok());
    }
}
