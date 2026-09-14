use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

const SETTINGS_FILE_NAME: &str = "settings.json";

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default = "default_true")]
    pub launch_at_login: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            auto_update: true,
            launch_at_login: true,
        }
    }
}

/// Keep the CLI and the Tauri webview on the same small, non-secret config file.
/// Credentials never belong here; plugin credentials use the Keychain boundary.
pub fn settings_path() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("QUEUEST_CONFIG_DIR") {
        return Ok(PathBuf::from(path).join(SETTINGS_FILE_NAME));
    }

    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "사용자 설정 디렉터리를 찾지 못했습니다.".to_string())?;

    #[cfg(target_os = "macos")]
    let directory = home
        .join("Library")
        .join("Application Support")
        .join("Queuest");

    #[cfg(target_os = "windows")]
    let directory = env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData").join("Roaming"))
        .join("Queuest");

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let directory = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"))
        .join("queuest");

    Ok(directory.join(SETTINGS_FILE_NAME))
}

pub fn load_from(path: &Path) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("설정 파일을 읽지 못했습니다: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("설정 파일을 해석하지 못했습니다: {error}"))
}

pub fn save_to(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "설정 파일의 상위 디렉터리를 찾지 못했습니다.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("설정 디렉터리를 만들지 못했습니다: {error}"))?;
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("설정을 직렬화하지 못했습니다: {error}"))?;
    fs::write(path, format!("{contents}\n"))
        .map_err(|error| format!("설정을 저장하지 못했습니다: {error}"))
}

pub fn load() -> Result<AppSettings, String> {
    let path = settings_path()?;
    load_from(&path)
}

pub fn save(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    save_to(&path, settings)
}

#[tauri::command]
pub fn get_app_settings() -> Result<AppSettings, String> {
    load()
}

#[tauri::command]
pub fn save_app_settings(settings: AppSettings) -> Result<AppSettings, String> {
    save(&settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::{load_from, save_to, AppSettings};
    use std::path::PathBuf;

    #[test]
    fn missing_settings_use_enabled_defaults() {
        let settings = load_from(&PathBuf::from("/tmp/queuest-settings-does-not-exist.json"))
            .expect("default settings");
        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn settings_round_trip_as_camel_case_json() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("settings.json");
        let expected = AppSettings {
            auto_update: false,
            launch_at_login: true,
        };

        save_to(&path, &expected).expect("save settings");
        assert_eq!(load_from(&path).expect("load settings"), expected);
        assert!(std::fs::read_to_string(path)
            .expect("read settings")
            .contains("autoUpdate"));
    }
}
