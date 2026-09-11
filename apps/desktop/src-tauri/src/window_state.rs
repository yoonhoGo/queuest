use std::sync::Mutex;

use tauri::{State, WebviewWindow};

#[derive(Default)]
pub(super) struct WindowState {
    pinned: Mutex<bool>,
}

impl WindowState {
    pub(super) fn is_pinned(&self) -> Result<bool, String> {
        self.pinned
            .lock()
            .map(|value| *value)
            .map_err(|_| "창 고정 상태를 읽지 못했습니다.".to_string())
    }

    fn set_pinned(
        &self,
        pinned: bool,
        apply: impl FnOnce(bool) -> Result<(), String>,
    ) -> Result<bool, String> {
        let mut current = self
            .pinned
            .lock()
            .map_err(|_| "창 고정 상태를 저장하지 못했습니다.".to_string())?;
        apply(pinned)?;
        *current = pinned;
        Ok(pinned)
    }
}

#[tauri::command]
pub(super) fn get_window_pinned(state: State<'_, WindowState>) -> Result<bool, String> {
    state.is_pinned()
}

#[tauri::command]
pub(super) fn set_window_pinned(
    window: WebviewWindow,
    state: State<'_, WindowState>,
    pinned: bool,
) -> Result<bool, String> {
    state.set_pinned(pinned, |value| {
        window
            .set_always_on_top(value)
            .map_err(|error| error.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::WindowState;

    #[test]
    fn pin_and_unpin_apply_the_native_window_level() {
        let state = WindowState::default();
        let mut topmost = false;
        state
            .set_pinned(true, |value| {
                topmost = value;
                Ok(())
            })
            .unwrap();
        assert!(topmost);
        assert!(state.is_pinned().unwrap());

        state
            .set_pinned(false, |value| {
                topmost = value;
                Ok(())
            })
            .unwrap();
        assert!(!topmost);
        assert!(!state.is_pinned().unwrap());
    }

    #[test]
    fn failed_native_change_preserves_the_previous_pin_state() {
        let state = WindowState::default();
        state.set_pinned(true, |_| Ok(())).unwrap();
        let result = state.set_pinned(false, |_| Err("native failure".to_string()));
        assert_eq!(result, Err("native failure".to_string()));
        assert!(state.is_pinned().unwrap());
    }
}
