//! Native read-only UI adapters. Secrets never cross the webview boundary.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{process::Command, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraQuery {
    connection_id: String,
    project_key: String,
    site_url: String,
    email: String,
    board_id: Option<u64>,
    backlog_only: bool,
    cursor: Option<String>,
    approved: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraCredential {
    #[serde(alias = "baseUrl")]
    site_url: String,
    email: String,
    api_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    key: String,
    title: String,
    body: String,
    status: String,
    status_category: String,
    external_ref: String,
    url: String,
    backlog: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraPage {
    items: Vec<JiraIssue>,
    next_cursor: Option<String>,
}

fn jira_origin(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Jira 사이트 URL이 올바르지 않습니다.")?;
    let host = url.host_str().unwrap_or_default();
    let tenant = host.strip_suffix(".atlassian.net").unwrap_or_default();
    if url.scheme() != "https"
        || tenant.is_empty()
        || tenant.contains('.')
        || !tenant
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || value
            .split("://")
            .nth(1)
            .and_then(|rest| rest.split('/').next())
            .is_some_and(|authority| authority.contains(':'))
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Jira Cloud 사이트 주소(https://회사.atlassian.net)만 지원합니다.".into());
    }
    Ok(url)
}

fn validate_query(query: &JiraQuery) -> Result<(), String> {
    if !query.approved {
        return Err("Jira 조회에 Keychain 및 사이트 접근 허용이 필요합니다.".into());
    }
    super::keychain_identifiers("com.queuest.jira", &query.connection_id)?;
    jira_origin(&query.site_url)?;
    let key = &query.project_key;
    if key.is_empty()
        || key.len() > 128
        || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        || query.board_id == Some(0)
        || (query.backlog_only && query.board_id.is_none())
        || query
            .cursor
            .as_ref()
            .is_some_and(|c| c.is_empty() || c.len() > 8192 || c.chars().any(char::is_control))
    {
        return Err("Jira 프로젝트 키, 보드 ID 또는 페이지 정보가 올바르지 않습니다.".into());
    }
    Ok(())
}

fn read_jira_credential(connection_id: &str) -> Result<JiraCredential, String> {
    #[cfg(target_os = "macos")]
    {
        let (service, account) = super::keychain_identifiers("com.queuest.jira", connection_id)?;
        let output = Command::new("/usr/bin/security")
            .args([
                "find-generic-password",
                "-s",
                &service,
                "-a",
                &account,
                "-w",
            ])
            .output()
            .map_err(|_| "Jira 인증 정보를 읽지 못했습니다.")?;
        if !output.status.success() {
            return Err("플러그인 설정에서 Jira API token을 저장하세요.".into());
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|_| "Jira 인증 정보를 다시 저장하세요.".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = connection_id;
        Err("Jira 인증은 macOS Keychain에서만 지원합니다.".into())
    }
}

fn description_text(value: &Value, depth: usize) -> String {
    if depth > 64 {
        return String::new();
    }
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    let mut text = value
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if let Some(children) = value.get("content").and_then(Value::as_array) {
        for child in children {
            text.push_str(&description_text(child, depth + 1));
        }
    }
    if matches!(
        value.get("type").and_then(Value::as_str),
        Some("paragraph" | "heading" | "hardBreak" | "listItem")
    ) {
        text.push('\n');
    }
    text
}

fn map_page(body: Value, origin: &reqwest::Url, backlog: bool) -> Result<JiraPage, String> {
    let invalid = || "Jira 이슈 응답을 해석하지 못했습니다.".to_string();
    let issues = body
        .get("issues")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    let mut items = Vec::new();
    for issue in issues {
        let key = issue
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        if key.is_empty()
            || !key
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err(invalid());
        }
        let fields = &issue["fields"];
        let category = fields["status"]["statusCategory"]["key"]
            .as_str()
            .ok_or_else(invalid)?;
        if !matches!(category, "new" | "indeterminate" | "done") {
            return Err(invalid());
        }
        items.push(JiraIssue {
            key: key.into(),
            title: fields["summary"].as_str().ok_or_else(invalid)?.into(),
            body: description_text(&fields["description"], 0).trim().into(),
            status: fields["status"]["name"].as_str().unwrap_or(category).into(),
            status_category: category.into(),
            external_ref: format!("jira:{}/{key}", origin.host_str().unwrap_or_default()),
            url: origin
                .join(&format!("browse/{key}"))
                .map_err(|_| invalid())?
                .into(),
            backlog,
        });
    }
    let next_cursor = match body.get("nextPageToken") {
        None | Some(Value::Null) => None,
        Some(Value::String(token))
            if !token.is_empty() && token.len() <= 8192 && !token.chars().any(char::is_control) =>
        {
            Some(token.clone())
        }
        _ => return Err(invalid()),
    };
    if body.get("isLast").and_then(Value::as_bool) == Some(false) && next_cursor.is_none() {
        return Err(invalid());
    }
    Ok(JiraPage { items, next_cursor })
}

#[tauri::command]
pub async fn jira_issue_list(query: JiraQuery) -> Result<JiraPage, String> {
    // Validate approval before spawning Keychain access or making a request.
    validate_query(&query)?;
    let connection_id = query.connection_id.clone();
    let credential =
        tauri::async_runtime::spawn_blocking(move || read_jira_credential(&connection_id))
            .await
            .map_err(|_| "Jira 인증 정보 읽기가 중단되었습니다.")??;
    let origin = jira_origin(&credential.site_url)?;
    if origin != jira_origin(&query.site_url)? || credential.email.trim() != query.email.trim() {
        return Err(
            "연결 설정과 저장된 인증 정보가 다릅니다. Jira API token을 다시 저장하세요.".into(),
        );
    }
    if credential.email.trim().is_empty() || credential.api_token.trim().is_empty() {
        return Err("Jira 인증 정보를 다시 저장하세요.".into());
    }
    let client = jira_client()?;
    let jql = format!("project = \"{}\" ORDER BY updated DESC", query.project_key);
    let request = if query.backlog_only {
        let board_id = query.board_id.ok_or("백로그 보드 ID가 필요합니다.")?;
        let url = origin
            .join(&format!("rest/software/1.0/board/{board_id}/backlog"))
            .map_err(|_| "Jira 보드 주소가 올바르지 않습니다.")?;
        let mut request = client.get(url).query(&[
            ("jql", jql.as_str()),
            ("maxResults", "100"),
            ("fields", "summary,description,status"),
        ]);
        if let Some(cursor) = &query.cursor {
            request = request.query(&[("nextPageToken", cursor)]);
        }
        request
    } else {
        let mut payload =
            json!({"jql": jql, "maxResults": 100, "fields": ["summary", "description", "status"]});
        if let Some(cursor) = &query.cursor {
            payload["nextPageToken"] = json!(cursor);
        }
        client
            .post(
                origin
                    .join("rest/api/3/search/jql")
                    .map_err(|_| "Jira 주소가 올바르지 않습니다.")?,
            )
            .json(&payload)
    };
    let body = request_json(request, &credential).await?;
    let mut page = map_page(body, &origin, query.backlog_only)?;
    // With a configured board, project-wide imports also preserve backlog acceptance.
    if !query.backlog_only && !page.items.is_empty() {
        if let Some(board_id) = query.board_id {
            let keys = page
                .items
                .iter()
                .map(|item| format!("\"{}\"", item.key))
                .collect::<Vec<_>>()
                .join(",");
            let backlog_jql = format!("project = \"{}\" AND key IN ({keys})", query.project_key);
            let url = origin
                .join(&format!("rest/software/1.0/board/{board_id}/backlog"))
                .map_err(|_| "Jira 보드 주소가 올바르지 않습니다.")?;
            let mut cursor: Option<String> = None;
            let mut cursors = std::collections::HashSet::new();
            let mut backlog_keys = std::collections::HashSet::new();
            loop {
                let mut request = client.get(url.clone()).query(&[
                    ("jql", backlog_jql.as_str()),
                    ("maxResults", "100"),
                    ("fields", "summary,status"),
                ]);
                if let Some(token) = &cursor {
                    request = request.query(&[("nextPageToken", token)]);
                }
                let backlog = map_page(request_json(request, &credential).await?, &origin, true)?;
                backlog_keys.extend(backlog.items.into_iter().map(|item| item.key));
                match backlog.next_cursor {
                    None => break,
                    Some(token) if cursors.len() < 100 && cursors.insert(token.clone()) => {
                        cursor = Some(token)
                    }
                    _ => {
                        return Err(
                            "Jira 백로그 페이지를 확인하지 못했습니다. 다시 조회하세요.".into()
                        )
                    }
                }
            }
            for item in &mut page.items {
                item.backlog = backlog_keys.contains(&item.key);
            }
        }
    }
    Ok(page)
}

fn jira_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Jira 연결을 준비하지 못했습니다.".into())
}

async fn request_json(
    request: reqwest::RequestBuilder,
    credential: &JiraCredential,
) -> Result<Value, String> {
    let mut response = request
        .basic_auth(&credential.email, Some(&credential.api_token))
        .header("Accept", "application/json")
        .header("User-Agent", "Queuest Desktop/0.1.0")
        .send()
        .await
        .map_err(|_| "Jira 연결에 실패했습니다. 네트워크를 확인하세요.")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Jira 인증 또는 프로젝트·보드 조회 권한을 확인하세요.",
            404 => "Jira 프로젝트 또는 보드를 찾지 못했습니다.",
            429 => "Jira 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
            _ => "Jira 조회에 실패했습니다. 연결 설정을 확인하세요.",
        }
        .into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Jira 응답을 읽지 못했습니다.")?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("Jira 응답이 너무 큽니다.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Jira 응답 형식이 올바르지 않습니다.".into())
}

#[tauri::command]
pub async fn github_review_list() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = Command::new("gh")
            .args([
                "search",
                "prs",
                "--review-requested=@me",
                "--state=open",
                "--limit=100",
                "--sort=updated",
                "--order=desc",
                "--json",
                "number,title,url,repository,author,updatedAt,isDraft",
            ])
            .output()
            .map_err(|_| "gh를 실행하지 못했습니다. 설치 및 인증 상태를 확인하세요.")?;
        if !output.status.success() {
            return Err(
                "PR 조회에 실패했습니다. gh auth login 및 저장소 접근 권한을 확인하세요.".into(),
            );
        }
        serde_json::from_slice(&output.stdout).map_err(|_| "PR 응답을 해석하지 못했습니다.".into())
    })
    .await
    .map_err(|_| "PR 조회가 중단되었습니다.")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_jira_origin_to_cloud_without_redirect_targets() {
        assert!(jira_origin("https://team.atlassian.net/").is_ok());
        for url in [
            "http://team.atlassian.net",
            "https://team.atlassian.net.evil.com",
            "https://a.b.atlassian.net",
            "https://user@team.atlassian.net",
            "https://team.atlassian.net/path",
            "https://team.atlassian.net:443/",
            "https://team.atlassian.net?x=1",
        ] {
            assert!(jira_origin(url).is_err(), "{url}");
        }
    }

    #[test]
    fn approval_and_query_validation_precede_access() {
        let mut query = JiraQuery {
            connection_id: "work".into(),
            project_key: "Q".into(),
            site_url: "https://team.atlassian.net".into(),
            email: "me@example.com".into(),
            board_id: None,
            backlog_only: false,
            cursor: None,
            approved: false,
        };
        assert!(validate_query(&query).unwrap_err().contains("허용"));
        query.approved = true;
        assert!(validate_query(&query).is_ok());
        query.project_key = "Q OR project = OTHER".into();
        assert!(validate_query(&query).is_err());
    }

    #[test]
    fn preserves_backlog_identity_description_and_pagination() {
        let body = json!({"issues": [{"key": "Q-1", "fields": {"summary": "Test", "description": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Do it"}]}]}, "status": {"name": "Backlog", "statusCategory": {"key": "new"}}}}], "nextPageToken": "next", "isLast": false});
        let page = map_page(
            body,
            &jira_origin("https://team.atlassian.net").unwrap(),
            true,
        )
        .unwrap();
        assert_eq!(page.items[0].external_ref, "jira:team.atlassian.net/Q-1");
        assert_eq!(page.items[0].body, "Do it");
        assert!(page.items[0].backlog);
        assert_eq!(page.next_cursor.as_deref(), Some("next"));
        assert!(map_page(
            json!({"issues": [], "isLast": false}),
            &jira_origin("https://team.atlassian.net").unwrap(),
            false
        )
        .is_err());
    }

    #[test]
    fn native_transport_sanitizes_errors_and_does_not_follow_redirects() {
        use std::io::{Read, Write};
        for status in ["401 Unauthorized", "302 Found"] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let handle = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0; 8192];
                let size = socket.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
                assert!(request.contains("authorization: basic "));
                let body = "secret-test-token remote-provider-error";
                write!(socket, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nLocation: http://127.0.0.1:1/must-not-follow\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let credential = JiraCredential {
                site_url: "https://team.atlassian.net".into(),
                email: "me@example.com".into(),
                api_token: "secret-test-token".into(),
            };
            let error = tauri::async_runtime::block_on(request_json(
                jira_client().unwrap().get(format!("http://{address}")),
                &credential,
            ))
            .unwrap_err();
            assert!(!error.contains("secret-test-token"));
            assert!(!error.contains("remote-provider-error"));
            assert!(
                !error.contains("네트워크"),
                "redirects must remain an HTTP error"
            );
            handle.join().unwrap();
        }
    }
}
