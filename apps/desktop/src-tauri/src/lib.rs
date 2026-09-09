use std::{
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

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

#[derive(Default)]
struct WindowState {
    pinned: Mutex<bool>,
}

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
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
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

#[tauri::command]
fn set_window_pinned(state: State<'_, WindowState>, pinned: bool) -> Result<(), String> {
    let mut current = state
        .pinned
        .lock()
        .map_err(|_| "팝오버 고정 상태를 저장하지 못했습니다.".to_string())?;
    *current = pinned;
    Ok(())
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

#[tauri::command]
async fn discover_tools() -> Result<ToolDiscovery, String> {
    tauri::async_runtime::spawn_blocking(|| ToolDiscovery {
        claude: discover_tool("claude", false),
        gh: discover_tool("gh", true),
        jj: discover_tool("jj", false),
    })
    .await
    .map_err(|error| format!("도구를 확인하지 못했습니다: {error}"))
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
        .plugin(tauri_plugin_opener::init())
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
                            .pinned
                            .lock()
                            .map(|value| *value)
                            .unwrap_or(false);
                        if !pinned {
                            let _ = focus_window.hide();
                        }
                    }
                });
                let _ = window.hide();
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
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        rect,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => toggle_main_window(&tray.app_handle(), Some(rect)),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_agent,
            cancel_agent,
            github_issue_list,
            validate_repo_path,
            set_window_pinned,
            discover_tools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
