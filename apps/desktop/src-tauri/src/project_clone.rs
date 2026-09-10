use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

struct CloneDestination(PathBuf);

impl CloneDestination {
    fn parse(parent: &str, directory_name: &str) -> Result<Self, String> {
        if directory_name.trim().is_empty()
            || matches!(directory_name, "." | "..")
            || directory_name.starts_with('-')
            || directory_name
                .chars()
                .any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':'))
        {
            return Err(
                "새 폴더 이름만 입력해 주세요. 경로 구분자는 사용할 수 없습니다.".to_string(),
            );
        }
        let parent = Path::new(parent)
            .canonicalize()
            .map_err(|_| "선택한 저장 위치를 찾을 수 없습니다.".to_string())?;
        if !parent.is_dir() {
            return Err("Clone 저장 위치는 폴더여야 합니다.".to_string());
        }
        Ok(Self(parent.join(directory_name)))
    }
}

struct RepositorySource<'a>(&'a str);

impl<'a> RepositorySource<'a> {
    fn parse(source: &'a str) -> Result<Self, String> {
        let source = source.trim();
        let url_is_valid = tauri::Url::parse(source).is_ok_and(|url| {
            matches!(url.scheme(), "https" | "ssh")
                && url.host_str().is_some()
                && url.password().is_none()
                && !url.path().trim_matches('/').is_empty()
        });
        let scp_is_valid = source.split_once(':').is_some_and(|(host, path)| {
            host.split_once('@').is_some_and(|(user, host)| {
                !user.is_empty()
                    && !host.is_empty()
                    && !user.starts_with('-')
                    && host
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-'))
                    && user
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
            }) && !path.is_empty()
                && !path.starts_with('-')
        });
        if source.chars().any(char::is_control)
            || !(url_is_valid || scp_is_valid || Path::new(source).is_absolute())
        {
            return Err("HTTPS 또는 SSH Git 저장소 주소를 입력해 주세요.".to_string());
        }
        Ok(Self(source))
    }
}

pub(super) fn clone_repository(
    repository_url: &str,
    parent_path: &str,
    directory_name: &str,
) -> Result<String, String> {
    let source = RepositorySource::parse(repository_url)?;
    let destination = CloneDestination::parse(parent_path, directory_name)?;
    let result_path = destination
        .0
        .to_str()
        .ok_or_else(|| "선택한 경로를 문자열로 읽을 수 없습니다.".to_string())?
        .to_owned();
    fs::create_dir(&destination.0).map_err(|error| match error.kind() {
        std::io::ErrorKind::AlreadyExists => {
            "같은 이름의 폴더가 이미 있습니다. 다른 이름을 입력해 주세요.".to_string()
        }
        _ => format!("Clone 폴더를 만들지 못했습니다: {error}"),
    })?;
    let output = Command::new("git")
        .args([
            "-c",
            "protocol.ext.allow=never",
            "-c",
            "http.lowSpeedLimit=1000",
            "-c",
            "http.lowSpeedTime=30",
            "clone",
            "--",
        ])
        .arg(source.0)
        .arg(&destination.0)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env(
            "GIT_SSH_COMMAND",
            "ssh -o BatchMode=yes -o ConnectTimeout=15",
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Git을 실행하지 못했습니다. Git 설치를 확인해 주세요: {error}"))
        .and_then(|child| wait_for_clone(child, Duration::from_secs(600)));
    match output {
        Ok(status) if status.success() => Ok(result_path),
        failed => {
            let _ = fs::remove_dir(&destination.0);
            match failed {
                Err(error) => Err(error),
                Ok(_) => Err("Git clone에 실패했습니다. 저장소 주소와 접근 권한, 네트워크를 확인해 주세요. 비공개 저장소는 Git 인증 또는 SSH 키 설정이 필요합니다.".to_string()),
            }
        }
    }
}

fn wait_for_clone(mut child: Child, timeout: Duration) -> Result<ExitStatus, String> {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if start.elapsed() < timeout => thread::sleep(Duration::from_millis(100)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(error) => format!("Git clone 상태를 확인하지 못했습니다: {error}"),
                    Ok(_) => "Git clone 제한 시간(10분)을 초과했습니다. 네트워크를 확인한 뒤 다른 폴더 이름으로 다시 시도해 주세요.".to_string(),
                });
            }
        }
    }
}

#[tauri::command]
pub(super) async fn clone_project_repository(
    repository_url: String,
    parent_path: String,
    directory_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        clone_repository(&repository_url, &parent_path, &directory_name)
    })
    .await
    .map_err(|_| "Git clone 작업이 중단되었습니다.".to_string())?
}

#[cfg(test)]
mod tests;
