use std::{
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

#[derive(Default)]
struct AgentState {
    active_child: Mutex<Option<Arc<Mutex<Child>>>>,
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

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let toggle = MenuItemBuilder::with_id("toggle", "Queuest 열기/닫기").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "종료").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&toggle, &quit]).build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => toggle_main_window(&tray.app_handle()),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_agent,
            cancel_agent,
            github_issue_list,
            validate_repo_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
