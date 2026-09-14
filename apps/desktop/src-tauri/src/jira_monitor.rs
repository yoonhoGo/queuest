//! Native timer: continues while the menu-bar webview is hidden.
use super::{jira_issue_list, validate_query, JiraIssue, JiraQuery};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

const INTERVAL: Duration = Duration::from_secs(5 * 60);
const MAX_PAGES: usize = 100;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    id: u64,
    title: String,
    detail: String,
    url: String,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorView {
    notices: Vec<Notice>,
    errors: BTreeMap<String, String>,
    last_checked: Option<u64>,
    connection_count: usize,
}

#[derive(Default)]
struct Inner {
    queries: Vec<JiraQuery>,
    generation: u64,
    snapshots: BTreeMap<String, BTreeMap<String, String>>,
    view: MonitorView,
    next_id: u64,
}

#[derive(Default)]
pub struct JiraMonitor {
    inner: Mutex<Inner>,
    wake: tokio::sync::Notify,
}

#[tauri::command]
pub fn jira_monitor_configure(
    queries: Vec<JiraQuery>,
    state: tauri::State<'_, JiraMonitor>,
) -> Result<(), String> {
    for query in &queries {
        validate_query(query)?;
        if query.cursor.is_some() || query.backlog_only || query.board_id.is_some() {
            return Err("백그라운드 조회 설정이 올바르지 않습니다.".into());
        }
    }
    let mut inner = state.inner.lock().map_err(|_| "Jira 모니터 잠금 오류")?;
    if inner.queries == queries {
        return Ok(());
    }
    let unchanged: HashSet<_> = queries
        .iter()
        .filter(|q| inner.queries.contains(q))
        .map(|q| q.connection_id.clone())
        .collect();
    inner.snapshots.retain(|id, _| unchanged.contains(id));
    inner.view.errors.clear();
    inner.view.connection_count = queries.len();
    inner.queries = queries;
    inner.generation += 1;
    drop(inner);
    state.wake.notify_one();
    Ok(())
}

#[tauri::command]
pub fn jira_monitor_status(state: tauri::State<'_, JiraMonitor>) -> Result<MonitorView, String> {
    Ok(state
        .inner
        .lock()
        .map_err(|_| "Jira 모니터 잠금 오류")?
        .view
        .clone())
}

#[tauri::command]
pub fn jira_monitor_clear(state: tauri::State<'_, JiraMonitor>) -> Result<(), String> {
    state
        .inner
        .lock()
        .map_err(|_| "Jira 모니터 잠금 오류")?
        .view
        .notices
        .clear();
    Ok(())
}

async fn fetch_all(query: JiraQuery) -> Result<Vec<JiraIssue>, String> {
    fetch_all_with(query, jira_issue_list).await
}

async fn fetch_all_with<F, Fut>(
    mut query: JiraQuery,
    mut fetch: F,
) -> Result<Vec<JiraIssue>, String>
where
    F: FnMut(JiraQuery) -> Fut,
    Fut: std::future::Future<Output = Result<super::JiraPage, String>>,
{
    let mut items = BTreeMap::new();
    let mut cursors = HashSet::new();
    for _ in 0..MAX_PAGES {
        let page = fetch(query.clone()).await?;
        for item in page.items {
            items.insert(item.external_ref.clone(), item);
        }
        match page.next_cursor {
            None => return Ok(items.into_values().collect()),
            Some(cursor) if cursors.insert(cursor.clone()) => query.cursor = Some(cursor),
            _ => return Err("Jira 페이지가 반복되어 조회를 중단했습니다.".into()),
        }
    }
    Err("Jira 조회 페이지 한도를 초과했습니다.".into())
}

fn changes(
    previous: Option<&BTreeMap<String, String>>,
    items: &[JiraIssue],
) -> Vec<(String, String, String)> {
    let Some(previous) = previous else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let detail = match previous.get(&item.external_ref) {
                None => format!("새 티켓 · {}", item.status),
                Some(status) if status != &item.status => format!("{} → {}", status, item.status),
                _ => return None,
            };
            Some((
                format!("{} · {}", item.key, item.title),
                detail,
                item.url.clone(),
            ))
        })
        .collect()
}

pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let state = app.state::<JiraMonitor>();
            let (queries, generation) = {
                let inner = state.inner.lock().expect("Jira monitor lock");
                (inner.queries.clone(), inner.generation)
            };
            for query in queries {
                let id = query.connection_id.clone();
                let result = fetch_all(query).await;
                let mut inner = state.inner.lock().expect("Jira monitor lock");
                // A removed/edited connection cannot publish an in-flight response.
                if inner.generation != generation {
                    break;
                }
                match result {
                    Ok(items) => {
                        let updates = changes(inner.snapshots.get(&id), &items);
                        inner.snapshots.insert(
                            id.clone(),
                            items
                                .iter()
                                .map(|i| (i.external_ref.clone(), i.status.clone()))
                                .collect(),
                        );
                        inner.view.errors.remove(&id);
                        inner.view.last_checked = Some(
                            SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs(),
                        );
                        for (title, detail, url) in &updates {
                            inner.next_id += 1;
                            let notice = Notice {
                                id: inner.next_id,
                                title: title.clone(),
                                detail: detail.clone(),
                                url: url.clone(),
                            };
                            inner.view.notices.insert(0, notice);
                        }
                        inner.view.notices.truncate(50);
                        if !updates.is_empty() {
                            let body = if updates.len() == 1 {
                                format!("{}\n{}", updates[0].0, updates[0].1)
                            } else {
                                format!("{}개 티켓이 추가되거나 상태가 변경되었습니다. 앱에서 Jira 알림을 확인하세요.", updates.len())
                            };
                            if app
                                .notification()
                                .builder()
                                .title("Queuest · Jira 업데이트")
                                .body(body)
                                .show()
                                .is_err()
                            {
                                inner.view.errors.insert(id.clone(), "시스템 알림을 표시하지 못했습니다. 앱의 Jira 알림을 확인하세요.".into());
                            }
                        }
                    }
                    Err(error) => {
                        inner.view.errors.insert(id, error);
                    }
                }
                let _ = app.emit("jira-monitor-updated", inner.view.clone());
            }
            tokio::select! {
                _ = tokio::time::sleep(INTERVAL) => {},
                _ = state.wake.notified() => {},
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn issue(key: &str, status: &str) -> JiraIssue {
        JiraIssue {
            key: key.into(),
            title: "티켓".into(),
            body: String::new(),
            status: status.into(),
            status_category: "new".into(),
            external_ref: key.into(),
            url: format!("https://team.atlassian.net/browse/{key}"),
            backlog: false,
        }
    }
    #[test]
    fn baseline_is_silent_and_only_new_or_changed_tickets_notify() {
        let items = vec![issue("Q-1", "진행 중"), issue("Q-2", "대기")];
        assert!(changes(None, &items).is_empty());
        let previous = BTreeMap::from([("Q-1".into(), "대기".into())]);
        let updates = changes(Some(&previous), &items);
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0].1, "대기 → 진행 중");
        assert!(updates[1].1.contains("새 티켓"));
        let current = items
            .iter()
            .map(|i| (i.external_ref.clone(), i.status.clone()))
            .collect();
        assert!(changes(Some(&current), &items).is_empty());
        assert!(changes(Some(&current), &[]).is_empty());
    }
    fn query() -> JiraQuery {
        JiraQuery {
            connection_id: "work".into(),
            project_key: "Q".into(),
            site_url: "https://team.atlassian.net".into(),
            email: "me@example.com".into(),
            board_id: None,
            backlog_only: false,
            cursor: None,
            approved: true,
        }
    }

    #[tokio::test]
    async fn reads_every_page_and_deduplicates_identity() {
        let mut calls = 0;
        let items = fetch_all_with(query(), |query| {
            calls += 1;
            let (items, next_cursor) = if query.cursor.is_none() {
                (vec![issue("Q-1", "대기")], Some("next".into()))
            } else {
                assert_eq!(query.cursor.as_deref(), Some("next"));
                (vec![issue("Q-1", "진행 중"), issue("Q-2", "대기")], None)
            };
            std::future::ready(Ok(super::super::JiraPage { items, next_cursor }))
        })
        .await
        .unwrap();
        assert_eq!(calls, 2);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].status, "진행 중");
    }

    #[tokio::test]
    async fn failed_or_repeated_pages_never_return_a_partial_snapshot() {
        let failure = fetch_all_with(query(), |query| {
            std::future::ready(if query.cursor.is_none() {
                Ok(super::super::JiraPage {
                    items: vec![issue("Q-1", "대기")],
                    next_cursor: Some("next".into()),
                })
            } else {
                Err("조회 실패".into())
            })
        })
        .await;
        assert!(failure.is_err());
        let repeated = fetch_all_with(query(), |_| {
            std::future::ready(Ok(super::super::JiraPage {
                items: Vec::new(),
                next_cursor: Some("same".into()),
            }))
        })
        .await;
        assert!(repeated.err().unwrap().contains("반복"));
    }
}
