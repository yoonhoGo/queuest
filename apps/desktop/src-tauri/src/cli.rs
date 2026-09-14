use std::{
    env, fs,
    path::Path,
    process::{Command, Stdio},
};

use crate::settings::{load, save};

// Keep the CLI-managed LaunchAgent aligned with the Tauri autostart plugin.
// The plugin uses the product name (`queuest`) as the macOS LaunchAgent name.
const LAUNCH_AGENT_LABEL: &str = "queuest";

pub fn run<I>(mut args: I) -> i32
where
    I: Iterator<Item = String>,
{
    match args.next().as_deref() {
        None | Some("help") | Some("--help") | Some("-h") => {
            print_help();
            0
        }
        Some("version") | Some("--version") | Some("-V") => {
            println!("queuest {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Some("settings") => settings_command(args),
        Some(command) => {
            eprintln!("알 수 없는 명령입니다: {command}");
            eprintln!("queuest help 로 사용법을 확인하세요.");
            2
        }
    }
}

fn print_help() {
    println!(
        "Queuest CLI\n\n사용법:\n  queuest                 메뉴바 앱 실행\n  queuest version         버전 표시\n  queuest settings        현재 설정 표시\n  queuest settings auto-update on|off\n  queuest settings launch-at-login on|off\n"
    );
}

fn settings_command<I>(mut args: I) -> i32
where
    I: Iterator<Item = String>,
{
    let Some(setting) = args.next() else {
        return print_settings();
    };

    if setting == "--json" {
        return print_settings_json();
    }

    let Some(value) = args.next() else {
        eprintln!("설정 값이 필요합니다: {setting} on|off");
        return 2;
    };
    if args.next().is_some() {
        eprintln!("설정 명령에 불필요한 인자가 있습니다.");
        return 2;
    }

    let Some(enabled) = parse_enabled(&value) else {
        eprintln!("설정 값은 on 또는 off여야 합니다.");
        return 2;
    };

    let mut settings = match load() {
        Ok(settings) => settings,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };

    match setting.as_str() {
        "auto-update" | "autoUpdate" => settings.auto_update = enabled,
        "launch-at-login" | "launchAtLogin" => {
            if let Err(error) = configure_cli_launch_agent(enabled) {
                eprintln!("로그인 시 실행 설정을 적용하지 못했습니다: {error}");
                return 1;
            }
            settings.launch_at_login = enabled;
        }
        _ => {
            eprintln!("알 수 없는 설정입니다: {setting}");
            return 2;
        }
    }

    if let Err(error) = save(&settings) {
        eprintln!("{error}");
        return 1;
    }

    println!("{}: {}", setting_label(&setting), on_off(enabled));
    0
}

fn print_settings() -> i32 {
    match load() {
        Ok(settings) => {
            println!("자동 업데이트: {}", on_off(settings.auto_update));
            println!("로그인 시 자동 실행: {}", on_off(settings.launch_at_login));
            0
        }
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn print_settings_json() -> i32 {
    match load().and_then(|settings| {
        serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())
    }) {
        Ok(settings) => {
            println!("{settings}");
            0
        }
        Err(error) => {
            eprintln!("설정을 표시하지 못했습니다: {error}");
            1
        }
    }
}

fn parse_enabled(value: &str) -> Option<bool> {
    match value {
        "on" | "true" | "1" | "yes" => Some(true),
        "off" | "false" | "0" | "no" => Some(false),
        _ => None,
    }
}

fn on_off(value: bool) -> &'static str {
    if value {
        "켜짐"
    } else {
        "꺼짐"
    }
}

fn setting_label(setting: &str) -> &'static str {
    match setting {
        "auto-update" | "autoUpdate" => "자동 업데이트",
        "launch-at-login" | "launchAtLogin" => "로그인 시 자동 실행",
        _ => "설정",
    }
}

#[cfg(target_os = "macos")]
fn configure_cli_launch_agent(enabled: bool) -> Result<(), String> {
    let home = env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "HOME 환경 변수를 찾지 못했습니다.".to_string())?;
    let launch_agents = home.join("Library").join("LaunchAgents");
    let plist_path = launch_agents.join(format!("{LAUNCH_AGENT_LABEL}.plist"));

    if !enabled {
        let domain = launch_domain()?;
        let plist = path_string(&plist_path)?;
        let _ = launchctl(&["bootout", &domain, &plist]);
        if plist_path.exists() {
            fs::remove_file(&plist_path)
                .map_err(|error| format!("로그인 항목을 제거하지 못했습니다: {error}"))?;
        }
        return Ok(());
    }

    let executable =
        env::current_exe().map_err(|error| format!("CLI 실행 경로를 찾지 못했습니다: {error}"))?;
    fs::create_dir_all(&launch_agents)
        .map_err(|error| format!("LaunchAgents 디렉터리를 만들지 못했습니다: {error}"))?;
    let contents = launch_agent_plist(&executable);
    fs::write(&plist_path, contents)
        .map_err(|error| format!("로그인 항목을 저장하지 못했습니다: {error}"))?;

    let plist = path_string(&plist_path)?;
    let domain = launch_domain()?;
    let _ = launchctl(&["bootout", &domain, &plist]);
    launchctl(&["bootstrap", &domain, &plist])
}

#[cfg(not(target_os = "macos"))]
fn configure_cli_launch_agent(enabled: bool) -> Result<(), String> {
    let _ = enabled;
    Err("로그인 시 자동 실행은 macOS CLI 설치에서만 지원합니다.".to_string())
}

#[cfg(target_os = "macos")]
fn launch_agent_plist(executable: &Path) -> String {
    let path = xml_escape(&executable.to_string_lossy());
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key>\n  <string>{LAUNCH_AGENT_LABEL}</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>{path}</string>\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n</dict>\n</plist>\n"
    )
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "macos")]
fn launch_domain() -> Result<String, String> {
    let output = Command::new("id")
        .arg("-u")
        .output()
        .map_err(|error| format!("현재 사용자 ID를 찾지 못했습니다: {error}"))?;
    if !output.status.success() {
        return Err("현재 사용자 ID를 찾지 못했습니다.".to_string());
    }
    let uid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if uid.is_empty() {
        return Err("현재 사용자 ID가 비어 있습니다.".to_string());
    }
    Ok(format!("gui/{uid}"))
}

#[cfg(target_os = "macos")]
fn path_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "LaunchAgent 경로를 해석하지 못했습니다.".to_string())
}

#[cfg(target_os = "macos")]
fn launchctl(args: &[&str]) -> Result<(), String> {
    let output = Command::new("launchctl")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("launchctl을 실행하지 못했습니다: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if detail.is_empty() {
        Err(format!("launchctl 실패: {}", output.status))
    } else {
        Err(format!("launchctl 실패: {detail}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{on_off, parse_enabled};

    #[test]
    fn accepts_cli_boolean_aliases() {
        assert_eq!(parse_enabled("on"), Some(true));
        assert_eq!(parse_enabled("false"), Some(false));
        assert_eq!(parse_enabled("maybe"), None);
    }

    #[test]
    fn renders_korean_setting_state() {
        assert_eq!(on_off(true), "켜짐");
        assert_eq!(on_off(false), "꺼짐");
    }
}
