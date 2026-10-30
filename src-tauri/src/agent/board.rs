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
";

/// Board columns in display order. Blocked is a flag on a task, never a column.
pub const STATUSES: [&str; 4] = ["backlog", "in_progress", "review", "done"];

const SYSTEM_ACTOR: &str = "system";

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
    /// Task body for `add`, report for `move`, reason for `block`.
    #[serde(default)]
    pub text: String,
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

/// The caller's board: its own when it is a chief, otherwise the one board it works on.
fn board_of(app: &AppCtx, caller: &str) -> Result<Option<(String, Role)>, String> {
    let conn = app.db().conn.lock().unwrap();
    let owns = conn
        .query_row("SELECT 1 FROM board_tasks WHERE chief_id=?1 LIMIT 1", [caller], |_| Ok(()))
        .optional()
        .map_err(|e| e.to_string())?;
    if owns.is_some() {
        return Ok(Some((caller.to_owned(), Role::Chief)));
    }
    let mut query = conn
        .prepare("SELECT DISTINCT chief_id FROM board_tasks WHERE worker_id=?1")
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
    Ok(json!({"chiefId":chief,"board":chief_name,"role":if role == Role::Chief {"chief"} else {"worker"},"columns":columns}))
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
            "SELECT CASE WHEN chief_id=?1 THEN 'chief' ELSE 'worker' END FROM board_tasks \
             WHERE chief_id=?1 OR (worker_id=?1 AND chief_id!=?2) LIMIT 1",
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

fn add(app: &AppCtx, chief: &str, req: &Request) -> Result<Value, String> {
    let title = req.title.as_deref().map(str::trim).unwrap_or("");
    if title.is_empty() || title.chars().count() > 200 {
        return Err("Give the task a title of 1 to 200 characters".into());
    }
    let status = parse_status(req.status.as_deref().unwrap_or("backlog"))?;
    let worker = req.worker.as_deref().map(|w| worker_for(app, chief, w)).transpose()?.flatten();
    let label = req.label.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let link = req.link.as_deref().map(str::trim).filter(|s| !s.is_empty());
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
        let event = insert_event(&tx, &id, &Event { actor: chief, action: "add", from: None, to: Some(status), text: title })?;
        tx.commit().map_err(|e| e.to_string())?;
        event
    };
    let task = app.db().conn.lock().unwrap()
        .query_row(&format!("SELECT {TASK_COLUMNS} FROM board_tasks WHERE id=?1"), [&id], read_task)
        .map_err(|e| e.to_string())?;
    let message = match (&task.worker_id, status) {
        (Some(worker), "in_progress") => Some(send(app, event, &task, chief, worker, &brief(app, &task))),
        _ => None,
    };
    changed(app, &task);
    Ok(json!({"task":task,"message":message}))
}

fn assign(app: &AppCtx, chief: &str, mut task: Task, reference: &str) -> Result<Value, String> {
    let worker = worker_for(app, chief, reference)?;
    let text = worker.as_deref().unwrap_or("none");
    let event = apply(app, &task.id, &Event { actor: chief, action: "assign", from: None, to: None, text }, |conn| {
        conn.execute("UPDATE board_tasks SET worker_id=?2,updated_at=?3 WHERE id=?1", params![task.id, worker, now_ms()])
            .map(|_| ())
            .map_err(|e| e.to_string())
    })?;
    let previous = std::mem::replace(&mut task.worker_id, worker.clone());
    if previous == worker {
        changed(app, &task);
        return Ok(json!({"task":task,"message":null,"released":null}));
    }
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
    let message = match role {
        Role::Worker => {
            let name = session(app, caller).map(|s| s.name).unwrap_or_default();
            let mut notice = format!("[Board] {} \"{}\" moved {from} → {status} by {name}.", task.reference, task.title);
            if !text.trim().is_empty() {
                notice.push_str(&format!("\n\n{}", text.trim()));
            }
            Some(send(app, event, &task, caller, &task.chief_id.clone(), &notice))
        }
        Role::Chief => task.worker_id.clone().map(|worker| {
            let notice = if status == "in_progress" && from != "in_progress" {
                brief(app, &task)
            } else {
                let mut notice = format!("[Board] The chief moved {} \"{}\" {from} → {status}.", task.reference, task.title);
                if !text.trim().is_empty() {
                    notice.push_str(&format!("\n\n{}", text.trim()));
                }
                notice
            };
            send(app, event, &task, caller, &worker, &notice)
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
    let target = match role {
        Role::Worker => Some(task.chief_id.clone()),
        Role::Chief => task.worker_id.clone(),
    };
    let message = target.map(|target| {
        let notice = match reason {
            Some(reason) => format!("[Board] {} \"{}\" is blocked.\n\n{reason}", task.reference, task.title),
            None => format!("[Board] {} \"{}\" is no longer blocked.", task.reference, task.title),
        };
        send(app, event, &task, caller, &target, &notice)
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
            _ => add(app, &req.session_id, req),
        };
    }
    let (chief, role) = board.ok_or("This session has no board yet; create one with vboard add")?;
    if req.action == "list" {
        return list(app, &chief, role);
    }
    let task = get_task(app, &chief, parse_ref(req.task.as_deref().ok_or("Missing task reference")?)?)?;
    if role == Role::Worker && task.worker_id.as_deref() != Some(req.session_id.as_str()) {
        return Err(format!("{} is not assigned to this session", task.reference));
    }
    match (req.action.as_str(), role) {
        ("show", _) => show(app, &task),
        ("assign", Role::Chief) => assign(app, &chief, task, req.worker.as_deref().ok_or("Missing worker session")?),
        ("move", _) => move_task(app, &req.session_id, role, task, req.status.as_deref().ok_or("Missing status")?, &req.text),
        ("block", _) => set_blocked(app, &req.session_id, role, task, Some(&req.text)),
        ("unblock", _) => set_blocked(app, &req.session_id, role, task, None),
        ("assign", Role::Worker) => Err("Only the chief can assign tasks".into()),
        _ => Err("Unknown board action".into()),
    }
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

The first vboard add from a session makes it the chief of its board. A worker can list its board and
show, move or block only its own tasks. Text given with -m, or piped on stdin with -m -, is delivered to the other
side: a worker's move or block reaches the chief, a chief's move reaches the worker. Moving a task into
in_progress sends its worker the task brief. Moving a task clears its blocked flag.";

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
        "show" | "block" | "unblock" => 1,
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
        _ => {}
    }
    if action == "add" && req.status.is_some() {
        parse_status(req.status.as_deref().unwrap())?;
    }
    if action == "move" {
        parse_status(req.status.as_deref().unwrap())?;
    }
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
    fn a_turn_with_a_board_update_is_not_blocked() {
        let app = fixture();
        add_task(&app, "Rendimiento", |r| { r.worker = Some(PLAN.into()); r.status = Some("in_progress".into()); });
        let brief = tells(&app, PLAN)[0].0.clone();
        action(&app, &on(PLAN, "move", "T1", |r| { r.status = Some("in_progress".into()); r.text = "Progress".into(); })).unwrap();
        watchdog(&app, PLAN, &brief, false);
        assert!(get_task(&app, CHIEF, 1).unwrap().blocked_reason.is_none());
        cleanup(app);
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
