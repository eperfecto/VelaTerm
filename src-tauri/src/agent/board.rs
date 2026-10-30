//! Task board owned by a chief session: tasks assigned to worker sessions move between fixed statuses,
//! and every move or blocker is reported to the other side through the ordinary session ledger.

use std::io::{IsTerminal, Read};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::host::AppCtx;

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS board_tasks (
 id TEXT PRIMARY KEY, chief_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 number INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
 label TEXT, link TEXT, status TEXT NOT NULL, blocked_reason TEXT,
 worker_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
 position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(chief_id, number)
);
CREATE INDEX IF NOT EXISTS board_tasks_worker ON board_tasks(worker_id);
CREATE TABLE IF NOT EXISTS board_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id TEXT NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, from_status TEXT, to_status TEXT,
 text TEXT NOT NULL DEFAULT '', message_id TEXT, target_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS board_events_task ON board_events(task_id);
CREATE INDEX IF NOT EXISTS board_events_message ON board_events(message_id);
CREATE TABLE IF NOT EXISTS boards (
 chief_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS board_workers (
 chief_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 worker_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 labels TEXT NOT NULL DEFAULT '[]', instructions TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
 PRIMARY KEY(chief_id, worker_id)
);
";

/// Board columns in display order. Blocked is a flag on a task, never a column.
pub const STATUSES: [&str; 4] = ["backlog", "in_progress", "review", "done"];

const SYSTEM_ACTOR: &str = "system";
/// Actor recorded for changes made from the board view. No session has this id, so the CLI cannot claim it.
const USER_ACTOR: &str = "user";

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub session_id: String,
    pub action: String,
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub link: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub worker: Option<String>,
    /// Comma-separated labels a worker takes, for `profile`; an empty string clears them.
    #[serde(default)]
    pub labels: Option<String>,
    /// Task body for `add`, report for `move`, reason for `block`, worker instructions for `profile`.
    #[serde(default)]
    pub text: String,
    /// `profile` only: no instructions were given, so the current ones are kept instead of cleared.
    #[serde(default)]
    pub keep_instructions: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub chief_id: String,
    pub number: i64,
    #[serde(rename = "ref")]
    pub reference: String,
    pub title: String,
    pub body: String,
    pub label: Option<String>,
    pub link: Option<String>,
    pub status: String,
    pub blocked_reason: Option<String>,
    pub worker_id: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role {
    Chief,
    Worker,
    /// The human acting from the board view: chief permissions, reachable only from dispatch.
    User,
}

/// The board-view request: a CLI request without a session, since the user acts on a named board.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserRequest {
    pub action: String,
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub link: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub worker: Option<String>,
    #[serde(default)]
    pub labels: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
}

fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64
}

use super::tell::{resolve as resolve_session, session};

fn parse_status(value: &str) -> Result<&'static str, String> {
    let normalized = value.trim().to_lowercase().replace('-', "_");
    STATUSES
        .iter()
        .find(|s| **s == normalized)
        .copied()
        .ok_or_else(|| format!("Unknown status {value:?}; use one of: {}", STATUSES.join(", ")))
}

fn parse_ref(value: &str) -> Result<i64, String> {
    let digits = value.trim().trim_start_matches(['T', 't']);
    digits.parse::<i64>().ok().filter(|n| *n > 0).ok_or_else(|| format!("Invalid task reference {value:?}; use T3 or 3"))
}

/// The caller's board: its own when it is a registered board or owns tasks, otherwise the one board it works on.
fn board_of(app: &AppCtx, caller: &str) -> Result<Option<(String, Role)>, String> {
    let conn = app.db().conn.lock().unwrap();
    let owns = conn
        .query_row(
            "SELECT 1 FROM boards WHERE chief_id=?1 UNION ALL SELECT 1 FROM board_tasks WHERE chief_id=?1 LIMIT 1",
            [caller],
            |_| Ok(()),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if owns.is_some() {
        return Ok(Some((caller.to_owned(), Role::Chief)));
    }
    let mut query = conn
        .prepare("SELECT DISTINCT chief_id FROM board_tasks WHERE worker_id=?1 AND status!='done'")
        .map_err(|e| e.to_string())?;
    let chiefs = query
        .query_map([caller], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    match chiefs.as_slice() {
        [] => Ok(None),
        [chief] => Ok(Some((chief.clone(), Role::Worker))),
        _ => Err("This session works on several boards; ask its chief to reassign the tasks".into()),
    }
}

fn read_task(r: &rusqlite::Row) -> rusqlite::Result<Task> {
    let number: i64 = r.get(2)?;
    Ok(Task {
        id: r.get(0)?,
        chief_id: r.get(1)?,
        number,
        reference: format!("T{number}"),
        title: r.get(3)?,
        body: r.get(4)?,
        label: r.get(5)?,
        link: r.get(6)?,
        status: r.get(7)?,
        blocked_reason: r.get(8)?,
        worker_id: r.get(9)?,
        position: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

const TASK_COLUMNS: &str =
    "id,chief_id,number,title,body,label,link,status,blocked_reason,worker_id,position,created_at,updated_at";

fn get_task(app: &AppCtx, chief: &str, number: i64) -> Result<Task, String> {
    app.db()
        .conn
        .lock()
        .unwrap()
        .query_row(
            &format!("SELECT {TASK_COLUMNS} FROM board_tasks WHERE chief_id=?1 AND number=?2"),
            params![chief, number],
            read_task,
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Task T{number} not found on this board"))
}

fn tasks(app: &AppCtx, chief: &str) -> Result<Vec<Task>, String> {
    let conn = app.db().conn.lock().unwrap();
    let mut query = conn
        .prepare(&format!(
            "SELECT {TASK_COLUMNS} FROM board_tasks WHERE chief_id=?1 ORDER BY CASE status \
             WHEN 'backlog' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'review' THEN 2 ELSE 3 END, position, number"
        ))
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([chief], read_task)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn next_position(conn: &rusqlite::Connection, chief: &str, status: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(position),-1)+1 FROM board_tasks WHERE chief_id=?1 AND status=?2",
        params![chief, status],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

struct Event<'a> {
    actor: &'a str,
    action: &'a str,
    from: Option<&'a str>,
    to: Option<&'a str>,
    text: &'a str,
}

fn insert_event(conn: &rusqlite::Connection, task_id: &str, event: &Event) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO board_events(task_id,actor_id,action,from_status,to_status,text,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![task_id, event.actor, event.action, event.from, event.to, event.text, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

/// Apply a task change and its event in one transaction. The watchdog reads events to decide whether a
/// worker updated its task, so a change must never exist without its event.
fn apply(
    app: &AppCtx,
    task_id: &str,
    event: &Event,
    change: impl FnOnce(&rusqlite::Connection) -> Result<(), String>,
) -> Result<i64, String> {
    let mut conn = app.db().conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    change(&tx)?;
    let id = insert_event(&tx, task_id, event)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

/// Deliver a board message and link it to the event that produced it, so a worker's later silence
/// can be told apart from a turn that never received board work.
fn send(app: &AppCtx, event_id: i64, task: &Task, sender: &str, target: &str, text: &str) -> Value {
    let name = session(app, sender).map(|s| s.name).unwrap_or_else(|_| "VelaTerm".into());
    let origin = json!({"sessionId":sender,"name":name,"agent":"terminal","role":"board",
        "chiefId":task.chief_id,"task":task.reference});
    match super::tell::notify(app, sender, target, origin, text) {
        Ok(result) => {
            let linked = app.db().conn.lock().unwrap().execute(
                "UPDATE board_events SET message_id=?2,target_id=?3 WHERE id=?1",
                params![event_id, result["messageId"].as_str(), target],
            );
            // Without the link the watchdog cannot follow this message; make that visible.
            if let Err(error) = linked {
                crate::diagnostics::record("WARN", "board_link", json!({"eventId":event_id,"error":error.to_string()}));
            }
            result
        }
        Err(error) => json!({"targetSessionId":target,"delivery":{"error":error}}),
    }
}

fn brief(app: &AppCtx, task: &Task) -> String {
    let board = session(app, &task.chief_id).map(|s| s.name).unwrap_or_default();
    let mut text = format!("[Board] You are the worker for {} on board \"{board}\".\nTitle: {}", task.reference, task.title);
    if let Some(label) = &task.label {
        text.push_str(&format!("\nLabel: {label}"));
    }
    if let Some(link) = &task.link {
        text.push_str(&format!("\nLink: {link}"));
    }
    if !task.body.trim().is_empty() {
        text.push_str(&format!("\n\n{}", task.body.trim()));
    }
    let profile = task.worker_id.as_deref().and_then(|worker| profile_of(app, &task.chief_id, worker).ok().flatten());
    if let Some(profile) = profile.filter(|p| !p.instructions.trim().is_empty()) {
        text.push_str(&format!("\n\nYour instructions on this board:\n{}", profile.instructions.trim()));
    }
    text.push_str(&format!(
        "\n\nWhen you finish or need a decision, update the board and report to the chief in one step:\n  \
         vboard move {r} review -m \"what you did and how you verified it\"\n  \
         vboard block {r} -m \"what is blocking you\"",
        r = task.reference
    ));
    text
}

fn changed(app: &AppCtx, task: &Task) {
    app.emit("board://changed", json!({"chiefId":task.chief_id,"taskId":task.id}));
}

/// The session a change is delivered from. The user has no session, so its changes reach workers
/// from the chief, exactly as a chief change would.
fn speaker<'a>(role: Role, caller: &'a str, chief: &'a str) -> &'a str {
    if role == Role::User { chief } else { caller }
}

/// Keep the chief informed of what the user changed on its board. Sent before any worker message, so
/// the event stays linked to the worker message the watchdog follows.
fn tell_chief(app: &AppCtx, role: Role, event: i64, task: &Task, text: String) {
    if role == Role::User {
        send(app, event, task, &task.chief_id, &task.chief_id, &text);
    }
}

fn task_json(app: &AppCtx, task: &Task, states: &[super::status_watch::StatusRow]) -> Value {
    let mut value = serde_json::to_value(task).unwrap();
    if let Some(worker) = &task.worker_id {
        value["workerName"] = json!(session(app, worker).ok().map(|s| s.name));
        value["workerState"] = json!(states.iter().find(|s| &s.session_id == worker).map(|s| s.state));
    }
    value
}

fn list(app: &AppCtx, chief: &str, role: Role) -> Result<Value, String> {
    let (_, states) = super::status_watch::snapshot();
    let all = tasks(app, chief)?;
    let columns: Vec<Value> = STATUSES
        .iter()
        .map(|status| {
            json!({"status":status,"tasks":all.iter().filter(|t| t.status == *status)
                .map(|t| task_json(app, t, &states)).collect::<Vec<_>>()})
        })
        .collect();
    let chief_name = session(app, chief).map(|s| s.name).ok();
    let workers = workers(app, chief)?;
    Ok(json!({"chiefId":chief,"board":chief_name,"role":if role == Role::Worker {"worker"} else {"chief"},
        "columns":columns,"workers":workers}))
}

fn show(app: &AppCtx, task: &Task) -> Result<Value, String> {
    let (_, states) = super::status_watch::snapshot();
    let conn = app.db().conn.lock().unwrap();
    let mut query = conn
        .prepare("SELECT actor_id,action,from_status,to_status,text,message_id,target_id,created_at FROM board_events WHERE task_id=?1 ORDER BY id DESC LIMIT 50")
        .map_err(|e| e.to_string())?;
    let events = query
        .query_map([&task.id], |r| {
            Ok(json!({"actorId":r.get::<_,String>(0)?,"action":r.get::<_,String>(1)?,
                "from":r.get::<_,Option<String>>(2)?,"to":r.get::<_,Option<String>>(3)?,"text":r.get::<_,String>(4)?,
                "messageId":r.get::<_,Option<String>>(5)?,"targetId":r.get::<_,Option<String>>(6)?,"at":r.get::<_,i64>(7)?}))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(query);
    drop(conn);
    Ok(json!({"task":task_json(app, task, &states),"events":events}))
}

fn worker_for(app: &AppCtx, chief: &str, reference: &str) -> Result<Option<String>, String> {
    if reference.trim().eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    let id = resolve_session(app, reference)?;
    if id == chief {
        return Err("The chief cannot be a worker on its own board".into());
    }
    session(app, &id)?;
    // A session resolves to exactly one board; a second one would make its commands ambiguous.
    let conflict: Option<String> = app
        .db()
        .conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT 'chief' FROM boards WHERE chief_id=?1 \
             UNION ALL SELECT CASE WHEN chief_id=?1 THEN 'chief' ELSE 'worker' END FROM board_tasks \
             WHERE chief_id=?1 OR (worker_id=?1 AND chief_id!=?2 AND status!='done') LIMIT 1",
            params![id, chief],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match conflict.as_deref() {
        Some("chief") => Err("That session is the chief of its own board and cannot also be a worker".into()),
        Some(_) => Err("That session already works on another board".into()),
        None => Ok(Some(id)),
    }
}

/// A worker's profile on one board: the labels it takes (none means any) and instructions for its briefs.
#[derive(Default)]
struct Profile {
    labels: Vec<String>,
    instructions: String,
}

fn read_labels(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

/// Trimmed, uppercased and deduplicated labels from a comma-separated list; empty entries are dropped.
fn normalize_labels(raw: &str) -> Vec<String> {
    let mut labels: Vec<String> = Vec::new();
    for label in raw.split(',').map(|l| l.trim().to_uppercase()).filter(|l| !l.is_empty()) {
        if !labels.contains(&label) {
            labels.push(label);
        }
    }
    labels
}

fn profile_of(app: &AppCtx, chief: &str, worker: &str) -> Result<Option<Profile>, String> {
    app.db()
        .conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT labels,instructions FROM board_workers WHERE chief_id=?1 AND worker_id=?2",
            params![chief, worker],
            |r| Ok(Profile { labels: read_labels(&r.get::<_, String>(0)?), instructions: r.get(1)? }),
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn worker_json(worker: &str, name: &str, profile: &Profile) -> Value {
    json!({"workerId":worker,"name":name,"labels":profile.labels,"instructions":profile.instructions})
}

/// Every worker profile on the board, by worker name, so the board view can show and edit them.
fn workers(app: &AppCtx, chief: &str) -> Result<Vec<Value>, String> {
    let conn = app.db().conn.lock().unwrap();
    let mut query = conn
        .prepare(
            "SELECT w.worker_id,s.name,w.labels,w.instructions FROM board_workers w JOIN sessions s ON s.id=w.worker_id \
             WHERE w.chief_id=?1 AND s.archived_at IS NULL ORDER BY s.name, w.worker_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([chief], |r| {
            let profile = Profile { labels: read_labels(&r.get::<_, String>(2)?), instructions: r.get(3)? };
            Ok(worker_json(&r.get::<_, String>(0)?, &r.get::<_, String>(1)?, &profile))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Refuse a labeled task for a worker whose profile on this board only takes other labels.
fn check_labels(app: &AppCtx, chief: &str, worker: &str, reference: &str, label: &str) -> Result<(), String> {
    let labels = profile_of(app, chief, worker)?.map(|p| p.labels).unwrap_or_default();
    let wanted = label.trim().to_uppercase();
    if labels.is_empty() || labels.contains(&wanted) {
        return Ok(());
    }
    let name = session(app, worker).map(|s| s.name).unwrap_or_default();
    Err(format!("{reference} is labeled {label} but {name} only takes {}", labels.join(", ")))
}

/// Create or update a worker's profile. Absent labels or instructions keep the current ones; an empty
/// value clears them. Not a task change, so no event is recorded.
fn profile(app: &AppCtx, chief: &str, req: &Request) -> Result<Value, String> {
    let worker = worker_for(app, chief, req.worker.as_deref().ok_or("Missing worker session")?)?
        .ok_or("Choose a worker session for the profile")?;
    let mut profile = profile_of(app, chief, &worker)?.unwrap_or_default();
    if let Some(labels) = &req.labels {
        profile.labels = normalize_labels(labels);
    }
    if !req.keep_instructions {
        profile.instructions = req.text.trim().to_owned();
    }
    let labels = serde_json::to_string(&profile.labels).map_err(|e| e.to_string())?;
    app.db()
        .conn
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO board_workers(chief_id,worker_id,labels,instructions,updated_at) VALUES (?1,?2,?3,?4,?5) \
             ON CONFLICT(chief_id,worker_id) DO UPDATE SET labels=excluded.labels,instructions=excluded.instructions,\
             updated_at=excluded.updated_at",
            params![chief, worker, labels, profile.instructions, now_ms()],
        )
        .map_err(|e| e.to_string())?;
    app.emit("board://changed", json!({"chiefId":chief,"taskId":null}));
    let name = session(app, &worker).map(|s| s.name).unwrap_or_default();
    Ok(json!({"worker":worker_json(&worker, &name, &profile)}))
}

fn add(app: &AppCtx, chief: &str, actor: &str, role: Role, req: &Request) -> Result<Value, String> {
    let title = req.title.as_deref().map(str::trim).unwrap_or("");
    if title.is_empty() || title.chars().count() > 200 {
        return Err("Give the task a title of 1 to 200 characters".into());
    }
    let status = parse_status(req.status.as_deref().unwrap_or("backlog"))?;
    let worker = req.worker.as_deref().map(|w| worker_for(app, chief, w)).transpose()?.flatten();
    let label = req.label.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let link = req.link.as_deref().map(str::trim).filter(|s| !s.is_empty());
    // The board view opens links with one click, so only web links are stored.
    if link.is_some_and(|l| !(l.starts_with("https://") || l.starts_with("http://"))) {
        return Err("A task link must start with http:// or https://".into());
    }
    if let (Some(worker), Some(label)) = (&worker, label) {
        // The board lock is held, so the next number is the one this task receives.
        let number: i64 = app
            .db()
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT COALESCE(MAX(number),0)+1 FROM board_tasks WHERE chief_id=?1", [chief], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        check_labels(app, chief, worker, &format!("T{number}"), label)?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let event = {
        let mut conn = app.db().conn.lock().unwrap();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let number: i64 = tx
            .query_row("SELECT COALESCE(MAX(number),0)+1 FROM board_tasks WHERE chief_id=?1", [chief], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let position = next_position(&tx, chief, status)?;
        let at = now_ms();
        tx.execute(
            "INSERT INTO board_tasks(id,chief_id,number,title,body,label,link,status,worker_id,position,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            params![id, chief, number, title, req.text.trim(), label, link, status, worker, position, at],
        )
        .map_err(|e| e.to_string())?;
        let event = insert_event(&tx, &id, &Event { actor, action: "add", from: None, to: Some(status), text: title })?;
        tx.commit().map_err(|e| e.to_string())?;
        event
    };
    let task = app.db().conn.lock().unwrap()
        .query_row(&format!("SELECT {TASK_COLUMNS} FROM board_tasks WHERE id=?1"), [&id], read_task)
        .map_err(|e| e.to_string())?;
    tell_chief(app, role, event, &task, format!("[Board] The user added {} \"{}\".", task.reference, task.title));
    let message = match (&task.worker_id, status) {
        (Some(worker), "in_progress") => Some(send(app, event, &task, chief, worker, &brief(app, &task))),
        _ => None,
    };
    changed(app, &task);
    Ok(json!({"task":task,"message":message}))
}

fn assign(app: &AppCtx, chief: &str, actor: &str, role: Role, mut task: Task, reference: &str) -> Result<Value, String> {
    let worker = worker_for(app, chief, reference)?;
    if let (Some(worker), Some(label)) = (&worker, task.label.as_deref()) {
        check_labels(app, chief, worker, &task.reference, label)?;
    }
    let text = worker.as_deref().unwrap_or("none");
    let event = apply(app, &task.id, &Event { actor, action: "assign", from: None, to: None, text }, |conn| {
        conn.execute("UPDATE board_tasks SET worker_id=?2,updated_at=?3 WHERE id=?1", params![task.id, worker, now_ms()])
            .map(|_| ())
            .map_err(|e| e.to_string())
    })?;
    let previous = std::mem::replace(&mut task.worker_id, worker.clone());
    if previous == worker {
        changed(app, &task);
        return Ok(json!({"task":task,"message":null,"released":null}));
    }
    let notice = match &worker {
        Some(worker) => {
            let name = session(app, worker).map(|s| s.name).unwrap_or_default();
            format!("[Board] The user assigned {} \"{}\" to {name}.", task.reference, task.title)
        }
        None => format!("[Board] The user unassigned {} \"{}\".", task.reference, task.title),
    };
    tell_chief(app, role, event, &task, notice);
    // The outgoing worker stops here; otherwise it keeps working and its next update is refused.
    let released = previous.map(|previous| {
        let notice = format!("[Board] {} \"{}\" is no longer assigned to you. Stop working on it.", task.reference, task.title);
        send(app, event, &task, chief, &previous, &notice)
    });
    // Sent last, so the event links to the brief that the watchdog follows.
    let message = match &worker {
        Some(worker) if task.status == "in_progress" => Some(send(app, event, &task, chief, worker, &brief(app, &task))),
        _ => None,
    };
    changed(app, &task);
    Ok(json!({"task":task,"message":message,"released":released}))
}

fn move_task(app: &AppCtx, caller: &str, role: Role, mut task: Task, status: &str, text: &str) -> Result<Value, String> {
    let status = parse_status(status)?;
    let from = task.status.clone();
    // Done tasks release their worker to other boards, so reopening one needs a worker that is still free.
    if from == "done" && status != "done" {
        if let Some(worker) = &task.worker_id {
            let busy = app
                .db()
                .conn
                .lock()
                .unwrap()
                .query_row(
                    "SELECT 1 FROM board_tasks WHERE worker_id=?1 AND chief_id!=?2 AND status!='done' LIMIT 1",
                    params![worker, task.chief_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if busy.is_some() {
                return Err(format!("{}'s worker now works on another board; assign another worker first", task.reference));
            }
        }
    }
    let mut position = task.position;
    let event = apply(app, &task.id, &Event { actor: caller, action: "move", from: Some(from.as_str()), to: Some(status), text }, |conn| {
        if from != status {
            position = next_position(conn, &task.chief_id, status)?;
        }
        conn.execute(
            "UPDATE board_tasks SET status=?2,blocked_reason=NULL,position=?3,updated_at=?4 WHERE id=?1",
            params![task.id, status, position, now_ms()],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    })?;
    task.position = position;
    task.status = status.to_owned();
    task.blocked_reason = None;
    let mut notice = format!("[Board] The user moved {} \"{}\" {from} → {status}.", task.reference, task.title);
    if !text.trim().is_empty() {
        notice.push_str(&format!("\n\n{}", text.trim()));
    }
    tell_chief(app, role, event, &task, notice);
    let message = match role {
        Role::Worker => {
            let name = session(app, caller).map(|s| s.name).unwrap_or_default();
            let mut notice = format!("[Board] {} \"{}\" moved {from} → {status} by {name}.", task.reference, task.title);
            if !text.trim().is_empty() {
                notice.push_str(&format!("\n\n{}", text.trim()));
            }
            Some(send(app, event, &task, caller, &task.chief_id.clone(), &notice))
        }
        Role::Chief | Role::User => task.worker_id.clone().map(|worker| {
            let notice = if status == "in_progress" && from != "in_progress" {
                brief(app, &task)
            } else {
                let mut notice = format!("[Board] The chief moved {} \"{}\" {from} → {status}.", task.reference, task.title);
                if !text.trim().is_empty() {
                    notice.push_str(&format!("\n\n{}", text.trim()));
                }
                notice
            };
            send(app, event, &task, speaker(role, caller, &task.chief_id), &worker, &notice)
        }),
    };
    changed(app, &task);
    Ok(json!({"task":task,"message":message}))
}

fn set_blocked(app: &AppCtx, caller: &str, role: Role, mut task: Task, reason: Option<&str>) -> Result<Value, String> {
    if reason.is_some_and(|r| r.trim().is_empty()) {
        return Err("Explain what is blocking the task".into());
    }
    let reason = reason.map(str::trim);
    let action = if reason.is_some() { "block" } else { "unblock" };
    let event = apply(app, &task.id, &Event { actor: caller, action, from: None, to: None, text: reason.unwrap_or("") }, |conn| {
        conn.execute("UPDATE board_tasks SET blocked_reason=?2,updated_at=?3 WHERE id=?1", params![task.id, reason, now_ms()])
            .map(|_| ())
            .map_err(|e| e.to_string())
    })?;
    task.blocked_reason = reason.map(str::to_owned);
    tell_chief(app, role, event, &task, match reason {
        Some(reason) => format!("[Board] The user blocked {} \"{}\".\n\n{reason}", task.reference, task.title),
        None => format!("[Board] The user unblocked {} \"{}\".", task.reference, task.title),
    });
    let target = match role {
        Role::Worker => Some(task.chief_id.clone()),
        Role::Chief | Role::User => task.worker_id.clone(),
    };
    let message = target.map(|target| {
        let notice = match reason {
            Some(reason) => format!("[Board] {} \"{}\" is blocked.\n\n{reason}", task.reference, task.title),
            None => format!("[Board] {} \"{}\" is no longer blocked.", task.reference, task.title),
        };
        send(app, event, &task, speaker(role, caller, &task.chief_id), &target, &notice)
    });
    changed(app, &task);
    Ok(json!({"task":task,"message":message}))
}

pub fn action(app: &AppCtx, req: &Request) -> Result<Value, String> {
    let _guard = lock().lock().unwrap();
    session(app, &req.session_id)?;
    let board = board_of(app, &req.session_id)?;
    if req.action == "add" {
        return match board {
            Some((_, Role::Worker)) => Err("Only the chief can add tasks to this board".into()),
            _ => add(app, &req.session_id, &req.session_id, Role::Chief, req),
        };
    }
    let (chief, role) = board.ok_or("This session has no board yet; create one with vboard add")?;
    perform(app, &chief, &req.session_id, role, req)
}

/// Run a non-add action on a board. `caller` is the actor recorded in events: a session id, or the
/// user's literal actor for Role::User.
fn perform(app: &AppCtx, chief: &str, caller: &str, role: Role, req: &Request) -> Result<Value, String> {
    if req.action == "list" {
        return list(app, chief, role);
    }
    if req.action == "profile" {
        return match role {
            Role::Worker => Err("Only the chief can edit worker profiles".into()),
            Role::Chief | Role::User => profile(app, chief, req),
        };
    }
    let task = get_task(app, chief, parse_ref(req.task.as_deref().ok_or("Missing task reference")?)?)?;
    if role == Role::Worker && task.worker_id.as_deref() != Some(caller) {
        return Err(format!("{} is not assigned to this session", task.reference));
    }
    match (req.action.as_str(), role) {
        ("show", _) => show(app, &task),
        ("assign", Role::Worker) => Err("Only the chief can assign tasks".into()),
        ("assign", _) => assign(app, chief, caller, role, task, req.worker.as_deref().ok_or("Missing worker session")?),
        ("move", _) => {
            let status = parse_status(req.status.as_deref().ok_or("Missing status")?)?;
            // The chief closes work and lifts blockers; a move would clear the blocked flag.
            if role == Role::Worker && status == "done" {
                return Err("Only the chief can move a task to done; move it to review instead".into());
            }
            if role == Role::Worker && task.blocked_reason.is_some() {
                return Err(format!("{} is blocked; only the chief can unblock it", task.reference));
            }
            move_task(app, caller, role, task, status, &req.text)
        }
        ("block", _) => set_blocked(app, caller, role, task, Some(&req.text)),
        ("unblock", Role::Worker) => Err("Only the chief can unblock tasks".into()),
        ("unblock", _) => set_blocked(app, caller, role, task, None),
        _ => Err("Unknown board action".into()),
    }
}

/// A session that is a board: registered, or owning tasks. Anything else is refused by the view's commands.
fn require_board(app: &AppCtx, chief: &str) -> Result<(), String> {
    session(app, chief)?;
    match board_of(app, chief)? {
        Some((_, Role::Chief)) => Ok(()),
        _ => Err("That session is not a board".into()),
    }
}

/// Flag a native chat agent session as a board, so it is a chief before its first task. Idempotent.
pub fn register(app: &AppCtx, chief: &str) -> Result<Value, String> {
    let _guard = lock().lock().unwrap();
    let target = session(app, chief)?;
    if target.engine != "chat" || !super::plan_execute::supported(target.kind) {
        return Err("A board must be a native chat agent session".into());
    }
    if let Some((_, Role::Worker)) = board_of(app, chief)? {
        return Err("That session already works on another board and cannot also be a chief".into());
    }
    app.db()
        .conn
        .lock()
        .unwrap()
        .execute("INSERT OR IGNORE INTO boards(chief_id,created_at) VALUES (?1,?2)", params![chief, now_ms()])
        .map_err(|e| e.to_string())?;
    app.emit("board://changed", json!({"chiefId":chief,"taskId":null}));
    Ok(json!({"chiefId":chief}))
}

/// Every live board: registered sessions and sessions that own tasks.
pub fn ids(app: &AppCtx) -> Result<Vec<String>, String> {
    let conn = app.db().conn.lock().unwrap();
    let mut query = conn
        .prepare(
            "SELECT b.chief_id FROM (SELECT chief_id FROM boards UNION SELECT chief_id FROM board_tasks) b \
             JOIN sessions s ON s.id=b.chief_id WHERE s.archived_at IS NULL ORDER BY b.chief_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// The board as its chief sees it, for the board view.
pub fn board_list(app: &AppCtx, chief: &str) -> Result<Value, String> {
    let _guard = lock().lock().unwrap();
    require_board(app, chief)?;
    list(app, chief, Role::Chief)
}

/// Act on a board as the user, from the board view. Only dispatch reaches this; the CLI route always
/// derives its role from the calling session.
pub fn user_action(app: &AppCtx, chief: &str, request: UserRequest) -> Result<Value, String> {
    let _guard = lock().lock().unwrap();
    require_board(app, chief)?;
    let keep_instructions = request.text.is_none();
    let req = Request {
        session_id: chief.to_owned(),
        action: request.action,
        task: request.task,
        title: request.title,
        label: request.label,
        link: request.link,
        status: request.status,
        worker: request.worker,
        labels: request.labels,
        text: request.text.unwrap_or_default(),
        keep_instructions,
    };
    if req.action == "add" {
        return add(app, chief, USER_ACTOR, Role::User, &req);
    }
    perform(app, chief, USER_ACTOR, Role::User, &req)
}

/// Observe turn boundaries. A worker whose turn was started by a board message and ended without any
/// board update leaves its task blocked, and the chief hears about it; silence is never progress.
pub fn observe(app: &AppCtx, id: &str, event: &Value) {
    let kind = event["type"].as_str().unwrap_or("");
    if !matches!(kind, "turnCompleted" | "turnInterrupted" | "exited") || event["released"] == true {
        return;
    }
    let app = app.clone();
    let id = id.to_owned();
    let interrupted = kind != "turnCompleted";
    // The engine emits from its own threads; the database is only read off that path.
    std::thread::spawn(move || {
        let _guard = lock().lock().unwrap();
        let watched = app
            .db()
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT 1 FROM board_tasks WHERE worker_id=?1 AND status='in_progress' AND blocked_reason IS NULL LIMIT 1",
                [&id],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some();
        if !watched {
            return;
        }
        if app.chat().turn_in_progress(&id) && !interrupted {
            return;
        }
        let snapshot = app.chat().snapshot_window(&id, Some(&Default::default()));
        // Another message is already waiting; the worker gets a new turn before anything is decided.
        if !interrupted && !snapshot.queue.is_empty() {
            return;
        }
        let last = snapshot.rows.iter().rev().find_map(|row| match row {
            super::chat::engine::ChatRow::User { text, .. } => Some(text.clone()),
            _ => None,
        });
        if let Some(text) = last {
            watchdog(&app, &id, &text, interrupted);
        }
    });
}

/// Block the task whose board message started the worker's last turn, unless the worker updated it since.
fn watchdog(app: &AppCtx, worker: &str, last_message: &str, interrupted: bool) {
    let Some(message_id) = last_message.strip_prefix("[VelaTerm message ").and_then(|s| s.split_once(']')).map(|(id, _)| id) else {
        return;
    };
    let found: Option<(String, i64)> = app
        .db()
        .conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT e.task_id,e.id FROM board_events e JOIN board_tasks t ON t.id=e.task_id \
             WHERE e.message_id=?1 AND e.target_id=?2 AND t.worker_id=?2 AND t.status='in_progress' AND t.blocked_reason IS NULL",
            params![message_id, worker],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    let Some((task_id, event_id)) = found else {
        return;
    };
    let updated = app
        .db()
        .conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT 1 FROM board_events WHERE task_id=?1 AND actor_id=?2 AND id>?3 LIMIT 1",
            params![task_id, worker, event_id],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if updated {
        return;
    }
    let reason = if interrupted {
        "The worker stopped before updating the board. Inspect its conversation before resuming."
    } else {
        "The worker's turn ended without a board update. Inspect its conversation before resuming."
    };
    let Ok(mut task) = app.db().conn.lock().unwrap().query_row(
        &format!("SELECT {TASK_COLUMNS} FROM board_tasks WHERE id=?1"),
        [&task_id],
        read_task,
    ) else {
        return;
    };
    let blocked = Event { actor: SYSTEM_ACTOR, action: "block", from: None, to: None, text: reason };
    let Ok(event) = apply(app, &task.id, &blocked, |conn| {
        conn.execute("UPDATE board_tasks SET blocked_reason=?2,updated_at=?3 WHERE id=?1", params![task.id, reason, now_ms()])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }) else {
        return;
    };
    task.blocked_reason = Some(reason.into());
    crate::diagnostics::record("WARN", "board_handoff", json!({"taskId":task.id,"sessionId":worker,"status":"blocked"}));
    let notice = format!(
        "[Board] {} \"{}\" is blocked: {reason}\nWorker session: {worker}\nUse vboard show {} before resuming.",
        task.reference, task.title, task.reference
    );
    send(app, event, &task, worker, &task.chief_id.clone(), &notice);
    changed(app, &task);
}

pub fn handle(app: AppCtx, mut request: crate::diagnostics::HttpRequest, token: String) {
    let started = Instant::now();
    let request_id = request.id().to_owned();
    let authorized = request
        .headers()
        .iter()
        .any(|h| h.field.equiv("Authorization") && h.value.as_str() == format!("Bearer {token}"));
    let mut body = String::new();
    let result = if !authorized {
        Err((401, "Authentication required".to_owned()))
    } else if request.method() != &tiny_http::Method::Post {
        Err((405, "Use POST".to_owned()))
    } else if request.as_reader().take(131073).read_to_string(&mut body).is_err() || body.len() > 131072 {
        Err((413, "Request too large".to_owned()))
    } else {
        serde_json::from_str::<Request>(&body)
            .map_err(|e| e.to_string())
            .and_then(|req| action(&app, &req))
            .map_err(|e| (400, e))
    };
    let (status, value) = match result {
        Ok(result) => (200, json!({"result":result})),
        Err((code, error)) => (code, json!({"error":error})),
    };
    let _ = request.respond(
        tiny_http::Response::from_string(value.to_string())
            .with_status_code(status)
            .with_header(tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap()),
    );
    crate::diagnostics::record(
        if status == 200 { "INFO" } else { "WARN" },
        "board",
        json!({"requestId":request_id,"statusCode":status,"durationMs":started.elapsed().as_millis() as u64}),
    );
}

pub const USAGE: &str = "vboard list
vboard show T3
vboard add \"title\" [--label FE] [--link URL] [--status backlog|in_progress|review|done] [--worker SESSION] [-m body]
vboard assign T3 SESSION|none
vboard move T3 backlog|in_progress|review|done [-m report]
vboard block T3 -m reason
vboard unblock T3
vboard profile SESSION [--labels BE,BFF] [-m instructions]

The first vboard add from a session makes it the chief of its board. A worker can list its board and
show, move or block only its own tasks; only the chief moves a task to done or unblocks it, and a worker
cannot move a blocked task. Text given with -m, or piped on stdin with -m -, is delivered to the other
side: a worker's move or block reaches the chief, a chief's move reaches the worker. Moving a task into
in_progress sends its worker the task brief. Moving a task clears its blocked flag.

Only the chief edits a worker's profile on its board: the labels it takes and instructions appended to
every brief it receives. A labeled task cannot be assigned to a worker whose labels do not include it; a
worker without labels takes any task. Omitted --labels or -m keep the current value; an empty one clears it.";

pub fn parse_args(args: &[String]) -> Result<Option<Request>, String> {
    let Some(action) = args.first() else { return Ok(None) };
    if matches!(action.as_str(), "--help" | "-h" | "help") {
        return Ok(None);
    }
    let mut req = Request { action: action.clone(), ..Default::default() };
    let mut positional = Vec::new();
    let mut text = None;
    let mut i = 1;
    while i < args.len() {
        let flag = args[i].as_str();
        if flag == "--" {
            // Everything after `--` is positional, so a title may itself start with a dash.
            positional.extend(args[i + 1..].iter().cloned());
            break;
        }
        let target = match flag {
            "-m" | "--message" => &mut text,
            "--label" => &mut req.label,
            "--link" => &mut req.link,
            "--status" => &mut req.status,
            "--worker" => &mut req.worker,
            "--labels" => &mut req.labels,
            _ if flag.starts_with("--") => return Err(format!("Unknown option {flag}")),
            _ => {
                positional.push(args[i].clone());
                i += 1;
                continue;
            }
        };
        *target = Some(args.get(i + 1).ok_or_else(|| format!("Missing value for {flag}"))?.clone());
        i += 2;
    }
    let expected = match action.as_str() {
        "list" => 0,
        "show" | "block" | "unblock" | "profile" => 1,
        "add" => 1,
        "assign" | "move" => 2,
        _ => return Err(format!("Unknown action {action:?}")),
    };
    if positional.len() != expected {
        return Err(format!("Wrong number of arguments for {action}; see vboard --help"));
    }
    match action.as_str() {
        "add" => req.title = Some(positional[0].clone()),
        "assign" => {
            req.task = Some(positional[0].clone());
            req.worker = Some(positional[1].clone());
        }
        "move" => {
            req.task = Some(positional[0].clone());
            req.status = Some(positional[1].clone());
        }
        "show" | "block" | "unblock" => req.task = Some(positional[0].clone()),
        "profile" => req.worker = Some(positional[0].clone()),
        _ => {}
    }
    if action == "add" && req.status.is_some() {
        parse_status(req.status.as_deref().unwrap())?;
    }
    if action == "move" {
        parse_status(req.status.as_deref().unwrap())?;
    }
    req.keep_instructions = action == "profile" && text.is_none();
    req.text = text.unwrap_or_default();
    Ok(Some(req))
}

pub fn run_cli(args: &[String]) -> ! {
    let result = (|| -> Result<Option<Value>, String> {
        let Some(mut req) = parse_args(&args[args.len().min(2)..])? else {
            return Ok(None);
        };
        req.session_id = std::env::var("VLX_SESSION_ID").map_err(|_| "Run inside a VelaTerm session")?;
        // Text is optional for most actions, so stdin is read only when asked for: an agent shell can
        // leave stdin as an open pipe that never closes.
        if req.text == "-" {
            if std::io::stdin().is_terminal() {
                return Err("-m - reads the text from stdin; pipe it in".into());
            }
            req.text.clear();
            std::io::stdin().take(65537).read_to_string(&mut req.text).map_err(|_| "Cannot read message text")?;
        }
        if req.text.len() > 65536 {
            return Err("Keep message text under 65536 bytes".into());
        }
        if req.action == "block" && req.text.trim().is_empty() {
            return Err("Explain what is blocking the task with -m, or pipe it with -m -".into());
        }
        super::tell::post_local("board", &serde_json::to_value(req).unwrap()).map(Some)
    })();
    match result {
        Ok(Some(value)) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap());
            std::process::exit(0)
        }
        Ok(None) => {
            println!("{USAGE}");
            std::process::exit(0)
        }
        Err(error) => {
            eprintln!("vboard: {error}");
            std::process::exit(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::session_query::tests::{cleanup, fixture, EXEC, PLAN};

    const CHIEF: &str = "owner";

    fn req(session: &str, action: &str) -> Request {
        Request { session_id: session.into(), action: action.into(), ..Default::default() }
    }

    fn add_task(app: &AppCtx, title: &str, extra: impl FnOnce(&mut Request)) -> Value {
        let mut r = req(CHIEF, "add");
        r.title = Some(title.into());
        extra(&mut r);
        action(app, &r).unwrap()
    }

    fn on(session: &str, act: &str, task: &str, f: impl FnOnce(&mut Request)) -> Request {
        let mut r = req(session, act);
        r.task = Some(task.into());
        f(&mut r);
        r
    }

    fn tells(app: &AppCtx, target: &str) -> Vec<(String, Value)> {
        let conn = app.db().conn.lock().unwrap();
        let mut q = conn.prepare("SELECT wire,origin FROM session_tells WHERE target_id=?1 ORDER BY rowid").unwrap();
        let rows = q
            .query_map([target], |r| Ok((r.get::<_, String>(0)?, serde_json::from_str::<Value>(&r.get::<_, String>(1)?).unwrap())))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        rows
    }

    #[test]
    fn first_add_creates_the_board_and_numbers_tasks_per_chief() {
        let app = fixture();
        assert!(action(&app, &req(CHIEF, "list")).unwrap_err().contains("no board"));
        let one = add_task(&app, "Trazabilidad de bins", |r| { r.label = Some("FE".into()); r.text = "Details".into(); });
        let two = add_task(&app, "Rendimiento", |_| {});
        assert_eq!(one["task"]["ref"], "T1");
        assert_eq!(one["task"]["status"], "backlog");
        assert_eq!(one["task"]["label"], "FE");
        assert_eq!(one["task"]["body"], "Details");
        let mut local = req(CHIEF, "add");
        local.title = Some("Local link".into());
        local.link = Some("file:///etc/passwd".into());
        assert!(action(&app, &local).unwrap_err().contains("http:// or https://"));
        assert_eq!(two["task"]["ref"], "T2");
        assert_eq!(two["task"]["position"], 1);
        let other = { let mut r = req("legacy", "add"); r.title = Some("Other board".into()); action(&app, &r).unwrap() };
        assert_eq!(other["task"]["ref"], "T1");
        let board = action(&app, &req(CHIEF, "list")).unwrap();
        assert_eq!(board["role"], "chief");
        assert_eq!(board["columns"][0]["status"], "backlog");
        assert_eq!(board["columns"][0]["tasks"].as_array().unwrap().len(), 2);
        let mut empty = req(CHIEF, "add");
        empty.title = Some("  ".into());
        assert!(action(&app, &empty).is_err());
        cleanup(app);
    }

    #[test]
    fn starting_a_task_sends_the_brief_and_worker_moves_report_to_the_chief() {
        let app = fixture();
        add_task(&app, "Rendimiento", |r| { r.label = Some("BE".into()); r.link = Some("https://app.clickup.com/t/1".into()); });
        action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(PLAN.into()))).unwrap();
        assert!(tells(&app, PLAN).is_empty(), "assigning a backlog task must not dispatch it");
        let started = action(&app, &on(CHIEF, "move", "T1", |r| r.status = Some("in-progress".into()))).unwrap();
        assert_eq!(started["task"]["status"], "in_progress");
        assert_eq!(started["message"]["delivery"], "retained");
        let brief = &tells(&app, PLAN)[0];
        assert!(brief.0.contains("You are the worker for T1"));
        assert!(brief.0.contains("Link: https://app.clickup.com/t/1"));
        assert_eq!(brief.1["role"], "board");
        assert_eq!(brief.1["task"], "T1");

        let worker = action(&app, &req(PLAN, "list")).unwrap();
        assert_eq!(worker["role"], "worker");
        assert_eq!(worker["chiefId"], CHIEF);
        let moved = action(&app, &on(PLAN, "move", "T1", |r| { r.status = Some("review".into()); r.text = "Done, tests pass".into(); })).unwrap();
        assert_eq!(moved["task"]["status"], "review");
        let report = &tells(&app, CHIEF)[0].0;
        assert!(report.contains("T1 \"Rendimiento\" moved in_progress → review"));
        assert!(report.ends_with("Done, tests pass"));

        let events = action(&app, &on(PLAN, "show", "T1", |_| {})).unwrap()["events"].clone();
        assert_eq!(events[0]["action"], "move");
        assert_eq!(events[0]["actorId"], PLAN);
        assert_eq!(events.as_array().unwrap().len(), 4);
        cleanup(app);
    }

    #[test]
    fn workers_only_touch_their_own_tasks_and_cannot_manage_the_board() {
        let app = fixture();
        add_task(&app, "Mine", |r| r.worker = Some(PLAN.into()));
        add_task(&app, "Theirs", |r| r.worker = Some(EXEC.into()));
        assert!(action(&app, &on(PLAN, "move", "T2", |r| r.status = Some("done".into()))).unwrap_err().contains("not assigned"));
        assert!(action(&app, &on(PLAN, "assign", "T1", |r| r.worker = Some(EXEC.into()))).unwrap_err().contains("Only the chief"));
        let mut add = req(PLAN, "add");
        add.title = Some("Sneaky".into());
        assert!(action(&app, &add).unwrap_err().contains("Only the chief"));
        assert!(action(&app, &on("caller", "show", "T1", |_| {})).unwrap_err().contains("no board"));
        assert!(action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(CHIEF.into()))).unwrap_err().contains("chief cannot"));
        assert!(action(&app, &on(CHIEF, "move", "T1", |r| r.status = Some("blocked".into()))).unwrap_err().contains("Unknown status"));
        assert!(action(&app, &on(CHIEF, "show", "T9", |_| {})).unwrap_err().contains("not found"));
        cleanup(app);
    }

    #[test]
    fn a_session_works_on_one_board_and_reassignment_releases_the_previous_worker() {
        let app = fixture();
        let mut own = req("legacy", "add");
        own.title = Some("Legacy board".into());
        own.worker = Some(EXEC.into());
        action(&app, &own).unwrap();
        add_task(&app, "Rendimiento", |r| { r.worker = Some(PLAN.into()); r.status = Some("in_progress".into()); });
        assert!(action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some("legacy".into()))).unwrap_err().contains("chief of its own board"));
        assert!(action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(EXEC.into()))).unwrap_err().contains("another board"));
        let mut extra = req(CHIEF, "add");
        extra.title = Some("Extra".into());
        extra.worker = Some(EXEC.into());
        assert!(action(&app, &extra).unwrap_err().contains("another board"));

        action(&app, &on("legacy", "assign", "T1", |r| r.worker = Some("none".into()))).unwrap();
        let reassigned = action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(EXEC.into()))).unwrap();
        assert_eq!(reassigned["task"]["workerId"], EXEC);
        assert!(tells(&app, PLAN).last().unwrap().0.contains("no longer assigned to you"));
        assert!(tells(&app, EXEC).last().unwrap().0.contains("You are the worker for T1"));
        assert!(action(&app, &on(PLAN, "move", "T1", |r| r.status = Some("review".into()))).unwrap_err().contains("no board"));
        let same = action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(EXEC.into()))).unwrap();
        assert!(same["message"].is_null() && same["released"].is_null());
        cleanup(app);
    }

    #[test]
    fn blocking_is_a_flag_that_notifies_the_other_side_and_a_move_clears_it() {
        let app = fixture();
        add_task(&app, "Histograma", |r| { r.worker = Some(PLAN.into()); r.status = Some("in_progress".into()); });
        assert_eq!(tells(&app, PLAN).len(), 1, "adding a started task with a worker sends the brief");
        assert!(action(&app, &on(PLAN, "block", "T1", |r| r.text = " ".into())).is_err());
        let blocked = action(&app, &on(PLAN, "block", "T1", |r| r.text = "Need the API contract".into())).unwrap();
        assert_eq!(blocked["task"]["status"], "in_progress");
        assert_eq!(blocked["task"]["blockedReason"], "Need the API contract");
        assert!(tells(&app, CHIEF)[0].0.contains("is blocked.\n\nNeed the API contract"));
        let unblocked = action(&app, &on(CHIEF, "unblock", "T1", |_| {})).unwrap();
        assert!(unblocked["task"]["blockedReason"].is_null());
        assert!(tells(&app, PLAN)[1].0.contains("no longer blocked"));
        action(&app, &on(PLAN, "block", "T1", |r| r.text = "Again".into())).unwrap();
        let moved = action(&app, &on(CHIEF, "move", "T1", |r| r.status = Some("review".into()))).unwrap();
        assert!(moved["task"]["blockedReason"].is_null());
        assert!(tells(&app, PLAN)[2].0.contains("The chief moved T1"));
        cleanup(app);
    }

    #[test]
    fn a_silent_turn_after_a_board_message_blocks_the_task_once() {
        let app = fixture();
        add_task(&app, "Cosecheros", |r| { r.worker = Some(PLAN.into()); r.status = Some("in_progress".into()); });
        let brief = tells(&app, PLAN)[0].0.clone();
        watchdog(&app, PLAN, "an ordinary message", false);
        assert!(get_task(&app, CHIEF, 1).unwrap().blocked_reason.is_none());
        watchdog(&app, PLAN, &brief, false);
        let task = get_task(&app, CHIEF, 1).unwrap();
        assert!(task.blocked_reason.unwrap().contains("without a board update"));
        let notices = tells(&app, CHIEF);
        assert_eq!(notices.len(), 1);
        assert!(notices[0].0.contains("T1 \"Cosecheros\" is blocked"));
        watchdog(&app, PLAN, &brief, false);
        assert_eq!(tells(&app, CHIEF).len(), 1, "an already blocked task is not reported again");
        cleanup(app);
    }

    #[test]
    fn only_the_chief_finishes_and_unblocks_tasks() {
        let app = fixture();
        add_task(&app, "Rendimiento", |r| { r.worker = Some(PLAN.into()); r.status = Some("in_progress".into()); });
        assert!(action(&app, &on(PLAN, "move", "T1", |r| r.status = Some("done".into()))).unwrap_err().contains("Only the chief can move a task to done"));
        action(&app, &on(PLAN, "block", "T1", |r| r.text = "Need input".into())).unwrap();
        assert!(action(&app, &on(PLAN, "unblock", "T1", |_| {})).unwrap_err().contains("Only the chief can unblock"));
        assert!(action(&app, &on(PLAN, "move", "T1", |r| r.status = Some("review".into()))).unwrap_err().contains("only the chief can unblock"));
        let task = get_task(&app, CHIEF, 1).unwrap();
        assert_eq!((task.status.as_str(), task.blocked_reason.as_deref()), ("in_progress", Some("Need input")));
        action(&app, &on(CHIEF, "unblock", "T1", |_| {})).unwrap();
        action(&app, &on(PLAN, "move", "T1", |r| r.status = Some("review".into()))).unwrap();
        let done = action(&app, &on(CHIEF, "move", "T1", |r| r.status = Some("done".into()))).unwrap();
        assert_eq!(done["task"]["status"], "done");
        cleanup(app);
    }

    #[test]
    fn done_tasks_release_their_worker_to_another_board() {
        let app = fixture();
        let mut other = req("legacy", "add");
        other.title = Some("Legacy task".into());
        other.worker = Some(EXEC.into());
        other.status = Some("in_progress".into());
        action(&app, &other).unwrap();
        add_task(&app, "Rendimiento", |_| {});
        assert!(action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(EXEC.into()))).unwrap_err().contains("another board"));

        action(&app, &on("legacy", "move", "T1", |r| r.status = Some("done".into()))).unwrap();
        action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(EXEC.into()))).unwrap();
        assert_eq!(action(&app, &req(EXEC, "list")).unwrap()["chiefId"], CHIEF);
        let reopened = action(&app, &on("legacy", "move", "T1", |r| r.status = Some("review".into())));
        assert!(reopened.unwrap_err().contains("assign another worker first"));
        assert_eq!(get_task(&app, "legacy", 1).unwrap().status, "done");
        action(&app, &on("legacy", "assign", "T1", |r| r.worker = Some("none".into()))).unwrap();
        action(&app, &on("legacy", "move", "T1", |r| r.status = Some("review".into()))).unwrap();
        cleanup(app);
    }

    #[test]
    fn a_turn_with_a_board_update_is_not_blocked() {
        let app = fixture();
        add_task(&app, "Rendimiento", |r| { r.worker = Some(PLAN.into()); r.status = Some("in_progress".into()); });
        let brief = tells(&app, PLAN)[0].0.clone();
        action(&app, &on(PLAN, "move", "T1", |r| { r.status = Some("in_progress".into()); r.text = "Progress".into(); })).unwrap();
        watchdog(&app, PLAN, &brief, false);
        assert!(get_task(&app, CHIEF, 1).unwrap().blocked_reason.is_none());
        cleanup(app);
    }

    fn set_engine(app: &AppCtx, id: &str, engine: &str) {
        app.db().conn.lock().unwrap().execute("UPDATE sessions SET engine=?2 WHERE id=?1", params![id, engine]).unwrap();
    }

    /// Register `legacy` (a claude session) as a board, then return it to a non-chat engine so board
    /// messages to it are retained instead of starting a real chat.
    fn register_legacy(app: &AppCtx) {
        set_engine(app, "legacy", "chat");
        register(app, "legacy").unwrap();
        set_engine(app, "legacy", "tui");
    }

    fn user(app: &AppCtx, chief: &str, act: &str, task: Option<&str>, f: impl FnOnce(&mut UserRequest)) -> Result<Value, String> {
        let mut r = UserRequest { action: act.into(), task: task.map(str::to_owned), ..Default::default() };
        f(&mut r);
        user_action(app, chief, r)
    }

    #[test]
    fn registering_a_board_is_idempotent_and_limited_to_chat_agents_without_another_board() {
        let app = fixture();
        assert!(register(&app, "legacy").unwrap_err().contains("native chat agent"), "a tui session is not a board");
        set_engine(&app, "owner", "chat");
        assert!(register(&app, "owner").unwrap_err().contains("native chat agent"), "a terminal kind is not supported");
        assert!(register(&app, "archived-child").unwrap_err().contains("missing or archived"));
        set_engine(&app, "legacy", "chat");
        assert_eq!(register(&app, "legacy").unwrap()["chiefId"], "legacy");
        assert_eq!(register(&app, "legacy").unwrap()["chiefId"], "legacy");
        let rows: i64 = app.db().conn.lock().unwrap().query_row("SELECT COUNT(*) FROM boards", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
        add_task(&app, "Rendimiento", |r| r.worker = Some(PLAN.into()));
        set_engine(&app, PLAN, "chat");
        assert!(register(&app, PLAN).unwrap_err().contains("another board"));
        cleanup(app);
    }

    #[test]
    fn board_ids_lists_registered_and_task_boards_but_not_archived_ones() {
        let app = fixture();
        assert!(ids(&app).unwrap().is_empty());
        register_legacy(&app);
        add_task(&app, "Rendimiento", |_| {});
        assert_eq!(ids(&app).unwrap(), vec!["legacy".to_owned(), CHIEF.to_owned()]);
        app.db().conn.lock().unwrap().execute("UPDATE sessions SET archived_at=1 WHERE id='legacy'", []).unwrap();
        assert_eq!(ids(&app).unwrap(), vec![CHIEF.to_owned()]);
        cleanup(app);
    }

    #[test]
    fn an_empty_registered_board_lists_as_its_chief() {
        let app = fixture();
        assert!(board_list(&app, "legacy").unwrap_err().contains("not a board"));
        register_legacy(&app);
        let board = board_list(&app, "legacy").unwrap();
        assert_eq!(board["chiefId"], "legacy");
        assert_eq!(board["role"], "chief");
        let columns = board["columns"].as_array().unwrap();
        assert_eq!(columns.iter().map(|c| c["status"].as_str().unwrap()).collect::<Vec<_>>(), STATUSES.to_vec());
        assert!(columns.iter().all(|c| c["tasks"].as_array().unwrap().is_empty()));
        cleanup(app);
    }

    #[test]
    fn a_registered_board_session_is_a_chief_for_cli_actions_and_never_a_worker() {
        let app = fixture();
        register_legacy(&app);
        assert_eq!(action(&app, &req("legacy", "list")).unwrap()["role"], "chief");
        let mut first = req("legacy", "add");
        first.title = Some("Primera".into());
        assert_eq!(action(&app, &first).unwrap()["task"]["ref"], "T1");
        assert!(action(&app, &on("legacy", "move", "T1", |r| r.status = Some("done".into()))).is_ok());
        let mut other = req(CHIEF, "add");
        other.title = Some("Rendimiento".into());
        other.worker = Some("legacy".into());
        assert!(action(&app, &other).unwrap_err().contains("chief of its own board"));
        cleanup(app);
    }

    #[test]
    fn user_actions_act_as_chief_record_the_user_and_keep_the_chief_informed() {
        let app = fixture();
        assert!(user(&app, CHIEF, "add", None, |r| r.title = Some("Early".into())).unwrap_err().contains("not a board"));
        add_task(&app, "Base", |_| {});
        let added = user(&app, CHIEF, "add", None, |r| { r.title = Some("Rendimiento".into()); r.label = Some("BE".into()); }).unwrap();
        assert_eq!(added["task"]["ref"], "T2");
        assert!(tells(&app, CHIEF).last().unwrap().0.ends_with("[Board] The user added T2 \"Rendimiento\"."));

        user(&app, CHIEF, "assign", Some("T2"), |r| r.worker = Some(PLAN.into())).unwrap();
        assert!(tells(&app, CHIEF).last().unwrap().0.contains("[Board] The user assigned T2 \"Rendimiento\" to Planning session."));
        assert!(tells(&app, PLAN).is_empty(), "assigning a backlog task must not dispatch it");

        let started = user(&app, CHIEF, "move", Some("T2"), |r| r.status = Some("in_progress".into())).unwrap();
        assert_eq!(started["task"]["status"], "in_progress");
        let brief = tells(&app, PLAN);
        assert_eq!(brief.len(), 1);
        assert!(brief[0].0.contains("You are the worker for T2"));
        assert!(tells(&app, CHIEF).last().unwrap().0.contains("[Board] The user moved T2 \"Rendimiento\" backlog → in_progress."));
        let events = action(&app, &on(CHIEF, "show", "T2", |_| {})).unwrap()["events"].clone();
        assert_eq!(events[0]["actorId"], USER_ACTOR);
        assert_eq!(events[0]["targetId"], PLAN, "the event stays linked to the worker brief the watchdog follows");

        action(&app, &on(PLAN, "block", "T2", |r| r.text = "Need input".into())).unwrap();
        user(&app, CHIEF, "unblock", Some("T2"), |_| {}).unwrap();
        assert!(tells(&app, PLAN).last().unwrap().0.contains("no longer blocked"));
        assert!(tells(&app, CHIEF).last().unwrap().0.contains("[Board] The user unblocked T2 \"Rendimiento\"."));
        user(&app, CHIEF, "block", Some("T2"), |r| r.text = Some("Waiting on design".into())).unwrap();
        assert!(tells(&app, CHIEF).last().unwrap().0.contains("[Board] The user blocked T2 \"Rendimiento\".\n\nWaiting on design"));
        let done = user(&app, CHIEF, "move", Some("T2"), |r| r.status = Some("done".into())).unwrap();
        assert_eq!(done["task"]["status"], "done");
        assert!(tells(&app, PLAN).last().unwrap().0.contains("The chief moved T2"));

        assert_eq!(user(&app, CHIEF, "list", None, |_| {}).unwrap()["role"], "chief");
        let events = action(&app, &on(CHIEF, "show", "T2", |_| {})).unwrap()["events"].clone();
        let actors = events.as_array().unwrap().iter().filter(|e| e["actorId"] == USER_ACTOR).count();
        assert_eq!(actors, 6, "add, assign, move, unblock, block and move are recorded as the user");
        assert!(action(&app, &req(USER_ACTOR, "list")).unwrap_err().contains("missing or archived"), "the CLI cannot act as the user");
        cleanup(app);
    }

    fn profile_req(session: &str, worker: &str, f: impl FnOnce(&mut Request)) -> Request {
        let mut r = req(session, "profile");
        r.worker = Some(worker.into());
        f(&mut r);
        r
    }

    #[test]
    fn profiles_normalize_labels_and_keep_or_clear_omitted_and_empty_fields() {
        let app = fixture();
        add_task(&app, "Base", |_| {});
        let set = action(&app, &profile_req(CHIEF, PLAN, |r| { r.labels = Some(" be, bff,,BE ".into()); r.text = " Use pnpm ".into(); })).unwrap();
        assert_eq!(set["worker"], json!({"workerId":PLAN,"name":"Planning session","labels":["BE","BFF"],"instructions":"Use pnpm"}));
        let kept = action(&app, &profile_req(CHIEF, PLAN, |r| r.keep_instructions = true)).unwrap();
        assert_eq!((kept["worker"]["labels"].clone(), kept["worker"]["instructions"].clone()), (json!(["BE","BFF"]), json!("Use pnpm")));
        let relabeled = action(&app, &profile_req(CHIEF, PLAN, |r| { r.labels = Some("fe".into()); r.keep_instructions = true; })).unwrap();
        assert_eq!((relabeled["worker"]["labels"].clone(), relabeled["worker"]["instructions"].clone()), (json!(["FE"]), json!("Use pnpm")));
        let cleared = action(&app, &profile_req(CHIEF, PLAN, |r| r.labels = Some(String::new()))).unwrap();
        assert_eq!((cleared["worker"]["labels"].clone(), cleared["worker"]["instructions"].clone()), (json!([]), json!("")));
        let rows: i64 = app.db().conn.lock().unwrap().query_row("SELECT COUNT(*) FROM board_workers", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1, "a profile is upserted, never duplicated");
        let events: i64 = app.db().conn.lock().unwrap().query_row("SELECT COUNT(*) FROM board_events", [], |r| r.get(0)).unwrap();
        assert_eq!(events, 1, "a profile is not a task change, so only the add is recorded");
        assert!(action(&app, &profile_req(CHIEF, CHIEF, |_| {})).unwrap_err().contains("chief cannot"));
        assert!(action(&app, &profile_req(CHIEF, "none", |_| {})).is_err());
        cleanup(app);
    }

    #[test]
    fn workers_cannot_edit_worker_profiles() {
        let app = fixture();
        add_task(&app, "Mine", |r| r.worker = Some(PLAN.into()));
        let refused = action(&app, &profile_req(PLAN, PLAN, |r| r.labels = Some("BE".into())));
        assert_eq!(refused.unwrap_err(), "Only the chief can edit worker profiles");
        assert!(profile_of(&app, CHIEF, PLAN).unwrap().is_none());
        cleanup(app);
    }

    #[test]
    fn labeled_tasks_only_go_to_workers_whose_profile_takes_the_label() {
        let app = fixture();
        add_task(&app, "Pantalla", |r| r.label = Some("FE".into()));
        add_task(&app, "API", |r| r.label = Some("be".into()));
        add_task(&app, "Docs", |_| {});
        action(&app, &profile_req(CHIEF, PLAN, |r| r.labels = Some("BE, bff".into()))).unwrap();
        let refused = action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(PLAN.into())));
        assert_eq!(refused.unwrap_err(), "T1 is labeled FE but Planning session only takes BE, BFF");
        assert!(get_task(&app, CHIEF, 1).unwrap().worker_id.is_none());
        assert_eq!(action(&app, &on(CHIEF, "assign", "T2", |r| r.worker = Some(PLAN.into()))).unwrap()["task"]["workerId"], PLAN, "labels match case-insensitively");
        assert_eq!(action(&app, &on(CHIEF, "assign", "T3", |r| r.worker = Some(PLAN.into()))).unwrap()["task"]["workerId"], PLAN, "an unlabeled task fits any worker");
        action(&app, &on(CHIEF, "assign", "T2", |r| r.worker = Some("none".into()))).unwrap();

        let mut extra = req(CHIEF, "add");
        extra.title = Some("Botón".into());
        extra.label = Some("FE".into());
        extra.worker = Some(PLAN.into());
        assert_eq!(action(&app, &extra).unwrap_err(), "T4 is labeled FE but Planning session only takes BE, BFF");
        extra.label = Some("BFF".into());
        assert_eq!(action(&app, &extra).unwrap()["task"]["ref"], "T4");

        assert_eq!(action(&app, &on(CHIEF, "assign", "T1", |r| r.worker = Some(EXEC.into()))).unwrap()["task"]["workerId"], EXEC, "no profile takes any task");
        action(&app, &profile_req(CHIEF, EXEC, |r| r.labels = Some(" , ".into()))).unwrap();
        let mut any = req(CHIEF, "add");
        any.title = Some("Estilos".into());
        any.label = Some("FE".into());
        any.worker = Some(EXEC.into());
        assert!(action(&app, &any).is_ok(), "a profile without labels takes any task");
        cleanup(app);
    }

    #[test]
    fn worker_instructions_are_appended_to_its_briefs() {
        let app = fixture();
        add_task(&app, "Base", |_| {});
        action(&app, &profile_req(CHIEF, PLAN, |r| r.text = "Run cargo test before review".into())).unwrap();
        add_task(&app, "Rendimiento", |r| { r.worker = Some(PLAN.into()); r.status = Some("in_progress".into()); r.text = "Details".into(); });
        let brief = tells(&app, PLAN)[0].0.clone();
        assert!(brief.contains("Details\n\nYour instructions on this board:\nRun cargo test before review\n\nWhen you finish"));
        add_task(&app, "Sin perfil", |r| { r.worker = Some(EXEC.into()); r.status = Some("in_progress".into()); });
        assert!(!tells(&app, EXEC)[0].0.contains("Your instructions on this board"));
        cleanup(app);
    }

    #[test]
    fn board_lists_include_worker_profiles_by_name() {
        let app = fixture();
        add_task(&app, "Base", |_| {});
        assert_eq!(board_list(&app, CHIEF).unwrap()["workers"], json!([]));
        action(&app, &profile_req(CHIEF, PLAN, |r| { r.labels = Some("BE".into()); r.text = "Backend only".into(); })).unwrap();
        action(&app, &profile_req(CHIEF, EXEC, |_| {})).unwrap();
        let workers = board_list(&app, CHIEF).unwrap()["workers"].clone();
        assert_eq!(workers, json!([
            {"workerId":EXEC,"name":"Execute","labels":[],"instructions":""},
            {"workerId":PLAN,"name":"Planning session","labels":["BE"],"instructions":"Backend only"}
        ]));
        assert_eq!(action(&app, &req(CHIEF, "list")).unwrap()["workers"], workers);
        cleanup(app);
    }

    #[test]
    fn the_user_edits_worker_profiles_from_the_board_view() {
        let app = fixture();
        register_legacy(&app);
        let request: UserRequest = serde_json::from_value(json!({"action":"profile","worker":PLAN,"labels":"fe, qa","text":"Hi"})).unwrap();
        let set = user_action(&app, "legacy", request).unwrap();
        assert_eq!(set["worker"]["labels"], json!(["FE","QA"]));
        assert_eq!(set["worker"]["instructions"], "Hi");
        let kept = user(&app, "legacy", "profile", None, |r| r.worker = Some(PLAN.into())).unwrap();
        assert_eq!((kept["worker"]["labels"].clone(), kept["worker"]["instructions"].clone()), (json!(["FE","QA"]), json!("Hi")));
        let cleared = user(&app, "legacy", "profile", None, |r| { r.worker = Some(PLAN.into()); r.text = Some(String::new()); }).unwrap();
        assert_eq!(cleared["worker"]["instructions"], "");
        assert!(user(&app, "legacy", "profile", None, |_| {}).unwrap_err().contains("Missing worker"));
        cleanup(app);
    }

    #[test]
    fn cli_profile_arguments_map_to_a_profile_request() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let set = parse_args(&args(&["profile", "worker one", "--labels", "BE,BFF", "-m", "Rules"])).unwrap().unwrap();
        assert_eq!((set.worker.as_deref(), set.labels.as_deref(), set.text.as_str(), set.keep_instructions), (Some("worker one"), Some("BE,BFF"), "Rules", false));
        let keep = parse_args(&args(&["profile", "worker one"])).unwrap().unwrap();
        assert_eq!((keep.labels.as_deref(), keep.keep_instructions), (None, true));
        let clear = parse_args(&args(&["profile", "worker one", "--labels", "", "-m", ""])).unwrap().unwrap();
        assert_eq!((clear.labels.as_deref(), clear.text.as_str(), clear.keep_instructions), (Some(""), "", false));
        assert!(parse_args(&args(&["profile"])).is_err());
        assert!(parse_args(&args(&["profile", "a", "b"])).is_err());
    }

    #[test]
    fn cli_arguments_map_to_board_requests() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(parse_args(&[]).unwrap().is_none());
        assert!(parse_args(&args(&["--help"])).unwrap().is_none());
        let add = parse_args(&args(&["add", "Title here", "--label", "FE", "-m", "Body"])).unwrap().unwrap();
        assert_eq!((add.title.as_deref(), add.label.as_deref(), add.text.as_str()), (Some("Title here"), Some("FE"), "Body"));
        let mv = parse_args(&args(&["move", "T3", "review", "-m", "Report"])).unwrap().unwrap();
        assert_eq!((mv.task.as_deref(), mv.status.as_deref(), mv.text.as_str()), (Some("T3"), Some("review"), "Report"));
        let assign = parse_args(&args(&["assign", "3", "worker one"])).unwrap().unwrap();
        assert_eq!(assign.worker.as_deref(), Some("worker one"));
        assert!(parse_args(&args(&["move", "T3", "blocked"])).is_err());
        assert!(parse_args(&args(&["move", "T3"])).is_err());
        assert!(parse_args(&args(&["show", "T3", "--bogus", "x"])).is_err());
        assert!(parse_args(&args(&["frobnicate"])).is_err());
        assert_eq!(parse_args(&args(&["add", "-5% latency"])).unwrap().unwrap().title.as_deref(), Some("-5% latency"));
        assert_eq!(parse_args(&args(&["add", "--", "--flag-like"])).unwrap().unwrap().title.as_deref(), Some("--flag-like"));
        assert_eq!(parse_ref("t12").unwrap(), 12);
        assert!(parse_ref("T0").is_err());
    }
}
