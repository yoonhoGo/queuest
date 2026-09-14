mod project_clone;
mod project_directory;
use project_clone::clone_project_repository;
use project_directory::{choose_project_directory, DirectoryDialogState};

use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

mod integrations;

use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use tauri::PhysicalPosition;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WebviewWindow, WindowEvent,
};

#[derive(Default)]
struct AgentState {
    active_child: Mutex<Option<Arc<Mutex<Child>>>>,
}

mod window_state;
use window_state::{get_window_pinned, set_window_pinned, WindowState};

#[derive(Debug, Serialize)]
struct AgentRunResult {
    summary: String,
    raw_output: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct GithubIssue {
    number: u64,
    title: String,
    body: Option<String>,
    state: String,
    url: String,
}

#[derive(Debug, Serialize)]
struct RepoPathInfo {
    path: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
}

#[derive(Debug, Serialize)]
struct ToolInfo {
    id: String,
    installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    authenticated: Option<bool>,
}

#[derive(Debug, Serialize)]
struct ToolDiscovery {
    claude: ToolInfo,
    gh: ToolInfo,
    jj: ToolInfo,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct InstalledApp {
    name: String,
    path: String,
}

#[derive(Debug, Serialize)]
struct ToolInventory {
    tools: ToolDiscovery,
    apps: Vec<InstalledApp>,
}

// Keep a pathological /Applications from flooding the webview.
const MAX_INSTALLED_APPS: usize = 500;

const KEYCHAIN_NAMESPACE: &str = "com.yoonhogo.queuest.credentials";

#[cfg(target_os = "macos")]
mod popover;

#[cfg(target_os = "macos")]
fn position_main_window(window: &WebviewWindow, _rect: tauri::Rect) -> Result<(), String> {
    popover::position(window)
}

#[cfg(not(target_os = "macos"))]
fn position_main_window(window: &WebviewWindow, rect: tauri::Rect) -> Result<(), String> {
    let scale = window.scale_factor().unwrap_or(1.0);
    let origin = rect.position.to_physical::<f64>(scale);
    let icon_size = rect.size.to_physical::<f64>(scale);
    let anchor = PhysicalPosition::new(
        origin.x + icon_size.width / 2.0,
        origin.y + icon_size.height,
    );
    let monitor = window.monitor_from_point(anchor.x, origin.y).ok().flatten();
    let scale = monitor
        .as_ref()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(scale);
    let width = (420.0 * scale).round();
    let (work_area_left, work_area_right) = if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let left = f64::from(area.position.x);
        let available_height =
            f64::from(area.position.y) + f64::from(area.size.height) - anchor.y - 6.0 * scale;
        // Short displays still keep navigation visible; the content scrolls inside.
        let height = (640.0 * scale).min(available_height).max(320.0 * scale);
        let _ = window.set_size(tauri::PhysicalSize::new(
            width as u32,
            height.round() as u32,
        ));
        (left, left + f64::from(area.size.width))
    } else {
        (0.0, width)
    };
    let position = popover_position(anchor, width, work_area_left, work_area_right, scale);
    window
        .set_position(position)
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn popover_position(
    anchor: PhysicalPosition<f64>,
    width: f64,
    left: f64,
    right: f64,
    scale: f64,
) -> PhysicalPosition<i32> {
    let max_x = (right - width).max(left);
    PhysicalPosition::new(
        (anchor.x - width / 2.0).clamp(left, max_x).round() as i32,
        (anchor.y + 6.0 * scale).round() as i32,
    )
}

#[cfg(all(test, not(target_os = "macos")))]
mod popover_tests {
    use super::*;

    #[test]
    fn centers_below_icon_with_retina_gap() {
        assert_eq!(
            popover_position(PhysicalPosition::new(1400.0, 48.0), 840.0, 0.0, 2880.0, 2.0),
            PhysicalPosition::new(980, 60)
        );
    }

    #[test]
    fn clamps_at_both_edges_and_supports_negative_monitor_coordinates() {
        assert_eq!(
            popover_position(PhysicalPosition::new(30.0, 24.0), 420.0, 0.0, 1440.0, 1.0).x,
            0
        );
        assert_eq!(
            popover_position(PhysicalPosition::new(1430.0, 24.0), 420.0, 0.0, 1440.0, 1.0).x,
            1020
        );
        assert_eq!(
            popover_position(PhysicalPosition::new(-20.0, 24.0), 420.0, -1440.0, 0.0, 1.0).x,
            -420
        );
    }
}

fn toggle_main_window(app: &tauri::AppHandle, anchor: Option<tauri::Rect>) {
    if let Some(window) = app.get_webview_window("main") {
        if cfg!(debug_assertions) {
            let anchor = anchor.or_else(|| {
                app.tray_by_id("queuest")
                    .and_then(|tray| tray.rect().ok().flatten())
            });
            if let Some(anchor) = anchor {
                if let Err(error) = position_main_window(&window, anchor) {
                    eprintln!("Queuest 개발 창 위치 설정 실패: {error}");
                }
            }
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }

        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
        } else if app.state::<WindowState>().is_pinned().unwrap_or(false) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            let anchor = anchor.or_else(|| {
                app.tray_by_id("queuest")
                    .and_then(|tray| tray.rect().ok().flatten())
            });
            if let Some(anchor) = anchor {
                if let Err(error) = position_main_window(&window, anchor) {
                    eprintln!("Queuest 팝오버 위치 설정 실패: {error}");
                    return;
                }
            } else {
                eprintln!("Queuest 메뉴바 아이콘 위치를 읽지 못했습니다.");
                return;
            }
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn should_hide_on_focus_loss(pinned: bool, directory_dialog_open: bool, debug_build: bool) -> bool {
    !debug_build && !pinned && !directory_dialog_open
}

#[cfg(test)]
mod window_visibility_tests {
    use super::should_hide_on_focus_loss;

    #[test]
    fn development_windows_stay_open_when_focus_moves() {
        assert!(!should_hide_on_focus_loss(false, false, true));
    }

    #[test]
    fn release_popovers_only_hide_when_unpinned_and_idle() {
        assert!(should_hide_on_focus_loss(false, false, false));
        assert!(!should_hide_on_focus_loss(true, false, false));
        assert!(!should_hide_on_focus_loss(false, true, false));
    }
}

#[tauri::command]
fn validate_repo_path(repo_path: String) -> Result<RepoPathInfo, String> {
    let path = repo_path.trim();
    if path.is_empty() {
        return Err("프로젝트 작업 경로를 입력하세요.".to_string());
    }

    let candidate = Path::new(path);
    if !candidate.exists() {
        return Err("입력한 작업 경로가 존재하지 않습니다.".to_string());
    }

    if !candidate.is_dir() {
        return Err("프로젝트 작업 경로는 폴더여야 합니다.".to_string());
    }

    Ok(RepoPathInfo {
        path: path.to_string(),
        is_directory: true,
    })
}

fn keychain_identifiers(plugin_id: &str, connection_id: &str) -> Result<(String, String), String> {
    let plugin_id = plugin_id.trim();
    let connection_id = connection_id.trim();
    if plugin_id.is_empty() || connection_id.is_empty() {
        return Err("플러그인 ID와 연결 ID를 입력하세요.".to_string());
    }

    if !plugin_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
        || !connection_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
    {
        return Err("플러그인 ID와 연결 ID에 허용되지 않는 문자가 있습니다.".to_string());
    }

    let service = format!("{KEYCHAIN_NAMESPACE}.plugin.{plugin_id}");
    let account = format!("{KEYCHAIN_NAMESPACE}.plugin.{plugin_id}.{connection_id}");
    Ok((service, account))
}

#[cfg(target_os = "macos")]
fn set_keychain_credential(
    plugin_id: &str,
    connection_id: &str,
    value: &str,
) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("credential 값을 입력하세요.".to_string());
    }
    let (service, account) = keychain_identifiers(plugin_id, connection_id)?;
    let output = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-a",
            account.as_str(),
            "-s",
            service.as_str(),
            "-w",
            value,
            "-U",
        ])
        .output()
        .map_err(|_| "macOS Keychain을 실행하지 못했습니다.".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("macOS Keychain에 credential을 저장하지 못했습니다.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn delete_keychain_credential(plugin_id: &str, connection_id: &str) -> Result<(), String> {
    let (service, account) = keychain_identifiers(plugin_id, connection_id)?;
    let output = Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-a",
            account.as_str(),
            "-s",
            service.as_str(),
        ])
        .output()
        .map_err(|_| "macOS Keychain을 실행하지 못했습니다.".to_string())?;
    if output.status.success() {
        return Ok(());
    }

    let detail = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    if detail.contains("could not be found") || detail.contains("item not found") {
        Ok(())
    } else {
        Err("macOS Keychain에서 credential을 삭제하지 못했습니다.".to_string())
    }
}

#[tauri::command]
async fn plugin_credential_set(
    plugin_id: String,
    connection_id: String,
    value: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            set_keychain_credential(&plugin_id, &connection_id, &value)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (plugin_id, connection_id, value);
            Err("연결 credential 저장은 macOS Keychain에서만 지원합니다.".to_string())
        }
    })
    .await
    .map_err(|_| "credential 저장 작업이 중단되었습니다.".to_string())?
}

#[tauri::command]
async fn plugin_credential_delete(plugin_id: String, connection_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            delete_keychain_credential(&plugin_id, &connection_id)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (plugin_id, connection_id);
            Err("연결 credential 삭제는 macOS Keychain에서만 지원합니다.".to_string())
        }
    })
    .await
    .map_err(|_| "credential 삭제 작업이 중단되었습니다.".to_string())?
}

fn discover_tool(id: &str, check_authentication: bool) -> ToolInfo {
    let path = Command::new("which")
        .arg(id)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (!path.is_empty()).then_some(path)
        });
    let authenticated = if check_authentication && path.is_some() {
        Some(
            Command::new(id)
                .args(["auth", "status"])
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false),
        )
    } else {
        None
    };

    ToolInfo {
        id: id.to_string(),
        installed: path.is_some(),
        path,
        authenticated,
    }
}

fn discover_all_tools() -> ToolDiscovery {
    ToolDiscovery {
        claude: discover_tool("claude", false),
        gh: discover_tool("gh", true),
        jj: discover_tool("jj", false),
    }
}

/// Keeps only `*.app` bundles, strips the extension for the display name,
/// sorts case-insensitively by name (then path), dedupes and caps the list.
fn normalize_installed_apps(candidates: impl IntoIterator<Item = PathBuf>) -> Vec<InstalledApp> {
    let mut apps: Vec<InstalledApp> = candidates
        .into_iter()
        .filter(|path| path.extension().is_some_and(|ext| ext == "app"))
        .filter_map(|path| {
            let name = path.file_stem()?.to_str()?.trim().to_string();
            if name.is_empty() || name.starts_with('.') {
                return None;
            }
            Some(InstalledApp {
                name,
                path: path.to_str()?.to_string(),
            })
        })
        .collect();
    apps.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    apps.dedup_by(|a, b| a.path == b.path);
    apps.truncate(MAX_INSTALLED_APPS);
    apps
}

#[cfg(target_os = "macos")]
fn list_installed_apps() -> Vec<InstalledApp> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    // Scan one level per root only; app bundles are directories, never descend into them.
    let candidates = roots
        .into_iter()
        .filter_map(|root| std::fs::read_dir(root).ok())
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir());
    normalize_installed_apps(candidates)
}

#[cfg(not(target_os = "macos"))]
fn list_installed_apps() -> Vec<InstalledApp> {
    Vec::new()
}

// Requested icon edge in points; AppKit picks the nearest larger representation.
const APP_ICON_SIZE: f64 = 64.0;

/// Finder icon for an `.app` bundle as a PNG data URL. `None` when the bundle
/// is missing or AppKit cannot produce a bitmap; the caller falls back to text.
#[cfg(target_os = "macos")]
fn app_icon_data_url(path: &str) -> Option<String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{
        NSDataBase64EncodingOptions, NSDictionary, NSPoint, NSRect, NSSize, NSString,
    };

    let bundle = std::path::Path::new(path);
    if bundle.extension().is_none_or(|ext| ext != "app") || !bundle.is_dir() {
        return None;
    }
    let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(path));
    let mut rect = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(APP_ICON_SIZE, APP_ICON_SIZE),
    );
    // SAFETY: `rect` outlives the call; no context/hints are passed.
    let cg_image = unsafe { image.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg_image);
    // SAFETY: empty, correctly typed property dictionary.
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    let base64 = png.base64EncodedStringWithOptions(NSDataBase64EncodingOptions::empty());
    Some(format!("data:image/png;base64,{base64}"))
}

#[cfg(not(target_os = "macos"))]
fn app_icon_data_url(_path: &str) -> Option<String> {
    None
}

#[cfg(all(test, target_os = "macos"))]
mod app_icon_tests {
    use super::*;

    #[test]
    fn renders_system_app_icon_as_png_data_url() {
        let url = app_icon_data_url("/System/Applications/Calendar.app").expect("icon");
        assert!(url.starts_with("data:image/png;base64,iVBORw0KGgo"));
        assert!(url.len() > 1_000);
    }

    #[test]
    fn falls_back_to_none_for_non_app_paths() {
        assert_eq!(app_icon_data_url("/System/Applications/Nope.app"), None);
        assert_eq!(app_icon_data_url("/etc/hosts"), None);
    }
}

#[tauri::command]
async fn discover_tools() -> Result<ToolDiscovery, String> {
    tauri::async_runtime::spawn_blocking(discover_all_tools)
        .await
        .map_err(|error| format!("도구를 확인하지 못했습니다: {error}"))
}

#[tauri::command]
async fn app_icon(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || app_icon_data_url(&path))
        .await
        .map_err(|error| format!("앱 아이콘을 불러오지 못했습니다: {error}"))
}

#[tauri::command]
async fn discover_inventory() -> Result<ToolInventory, String> {
    tauri::async_runtime::spawn_blocking(|| ToolInventory {
        tools: discover_all_tools(),
        apps: list_installed_apps(),
    })
    .await
    .map_err(|error| format!("도구와 앱 목록을 확인하지 못했습니다: {error}"))
}

#[cfg(test)]
mod installed_app_tests {
    use super::*;

    fn paths(items: &[&str]) -> Vec<PathBuf> {
        items.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn keeps_only_app_bundles_and_strips_extension() {
        let apps = normalize_installed_apps(paths(&[
            "/Applications/Safari.app",
            "/Applications/Utilities",
            "/Applications/.DS_Store",
            "/Applications/notes.txt",
            "/Applications/.Hidden.app",
        ]));
        assert_eq!(
            apps,
            vec![InstalledApp {
                name: "Safari".into(),
                path: "/Applications/Safari.app".into()
            }]
        );
    }

    #[test]
    fn sorts_case_insensitively_and_dedupes_by_path() {
        let apps = normalize_installed_apps(paths(&[
            "/Applications/zoom.us.app",
            "/System/Applications/Calendar.app",
            "/Applications/Xcode.app",
            "/Applications/Xcode.app",
        ]));
        let names: Vec<&str> = apps.iter().map(|app| app.name.as_str()).collect();
        assert_eq!(names, vec!["Calendar", "Xcode", "zoom.us"]);
    }

    #[test]
    fn caps_list_size() {
        let many: Vec<PathBuf> = (0..MAX_INSTALLED_APPS + 50)
            .map(|index| PathBuf::from(format!("/Applications/App{index:04}.app")))
            .collect();
        assert_eq!(normalize_installed_apps(many).len(), MAX_INSTALLED_APPS);
    }
}

fn wait_for_agent(child: Arc<Mutex<Child>>) -> Result<AgentRunResult, String> {
    loop {
        let status = {
            let mut process = child
                .lock()
                .map_err(|_| "AI 프로세스 잠금이 손상되었습니다.".to_string())?;
            process
                .try_wait()
                .map_err(|error| format!("AI 프로세스를 확인하지 못했습니다: {error}"))?
        };

        if let Some(status) = status {
            let (stdout, stderr) = {
                let mut process = child
                    .lock()
                    .map_err(|_| "AI 프로세스 잠금이 손상되었습니다.".to_string())?;
                let mut stdout = String::new();
                let mut stderr = String::new();

                if let Some(mut stream) = process.stdout.take() {
                    stream
                        .read_to_string(&mut stdout)
                        .map_err(|error| format!("AI 표준 출력을 읽지 못했습니다: {error}"))?;
                }
                if let Some(mut stream) = process.stderr.take() {
                    stream
                        .read_to_string(&mut stderr)
                        .map_err(|error| format!("AI 표준 오류를 읽지 못했습니다: {error}"))?;
                }

                (stdout, stderr)
            };

            if !status.success() {
                let detail = if stderr.trim().is_empty() {
                    format!("종료 코드: {}", status)
                } else {
                    stderr.trim().to_string()
                };
                return Err(format!("Claude 실행 실패: {detail}"));
            }

            let summary = if stdout.trim().is_empty() {
                "Claude가 출력 없이 종료되었습니다.".to_string()
            } else {
                stdout.trim().to_string()
            };

            return Ok(AgentRunResult {
                summary,
                raw_output: stdout,
            });
        }

        thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
async fn run_agent(
    state: State<'_, AgentState>,
    repo_path: String,
    prompt: String,
) -> Result<AgentRunResult, String> {
    let active_child = {
        let mut active = state
            .active_child
            .lock()
            .map_err(|_| "AI 실행 잠금이 손상되었습니다.".to_string())?;

        if active.is_some() {
            return Err("이미 실행 중인 AI 작업이 있습니다.".to_string());
        }

        let child = Command::new("claude")
            .arg("-p")
            .arg(prompt)
            .arg("--output-format")
            .arg("json")
            .current_dir(repo_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("claude를 실행하지 못했습니다: {error}"))?;
        let child = Arc::new(Mutex::new(child));
        *active = Some(child.clone());
        child
    };

    let child_for_wait = active_child.clone();
    let result = tauri::async_runtime::spawn_blocking(move || wait_for_agent(child_for_wait))
        .await
        .map_err(|error| format!("AI 실행 스레드가 종료되었습니다: {error}"))?;

    if let Ok(mut active) = state.active_child.lock() {
        if active
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &active_child))
        {
            *active = None;
        }
    }

    result
}

#[tauri::command]
fn cancel_agent(state: State<'_, AgentState>, _task_id: String) -> Result<(), String> {
    let active = state
        .active_child
        .lock()
        .map_err(|_| "AI 실행 잠금이 손상되었습니다.".to_string())?;

    if let Some(child) = active.as_ref() {
        let mut process = child
            .lock()
            .map_err(|_| "AI 프로세스 잠금이 손상되었습니다.".to_string())?;
        process
            .kill()
            .map_err(|error| format!("AI 프로세스를 중단하지 못했습니다: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
fn github_issue_list(repo_path: String) -> Result<Vec<GithubIssue>, String> {
    let output = Command::new("gh")
        .args([
            "issue",
            "list",
            "--state",
            "all",
            "--limit",
            "100",
            "--json",
            "number,title,body,state,url",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|error| format!("gh를 실행하지 못했습니다: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("GitHub Issues 가져오기 실패: {}", output.status)
        } else {
            format!("GitHub Issues 가져오기 실패: {detail}")
        });
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("gh 결과를 해석하지 못했습니다: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentState::default())
        .manage(WindowState::default())
        .manage(DirectoryDialogState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                app.set_dock_visibility(false);
            }

            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                let focus_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        let pinned = app_handle
                            .state::<WindowState>()
                            .is_pinned()
                            .unwrap_or(false);
                        if should_hide_on_focus_loss(
                            pinned,
                            app_handle.state::<DirectoryDialogState>().is_open(),
                            cfg!(debug_assertions),
                        ) {
                            let _ = focus_window.hide();
                        }
                    }
                });
                if !cfg!(debug_assertions) {
                    let _ = window.hide();
                }
            }

            let toggle = MenuItemBuilder::with_id("toggle", "Queuest 열기/닫기").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "종료").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&toggle, &quit]).build()?;

            TrayIconBuilder::with_id("queuest")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .title("Q")
                .tooltip("Queuest")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_main_window(app, None),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        rect,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle(), Some(rect));
                    }
                })
                .build(app)?;

            if cfg!(debug_assertions) {
                toggle_main_window(app.handle(), None);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_agent,
            cancel_agent,
            github_issue_list,
            integrations::github_review_list,
            integrations::jira_issue_list,
            validate_repo_path,
            choose_project_directory,
            clone_project_repository,
            set_window_pinned,
            get_window_pinned,
            discover_tools,
            discover_inventory,
            app_icon,
            plugin_credential_set,
            plugin_credential_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
