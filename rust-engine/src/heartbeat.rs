//! Optional progress notices on stderr let the process driving the engine distinguish a slow command from a silent
//! process. The caller still applies finite operation deadlines; a heartbeat does not authorize indefinite work.
//!
//! A beat says whether a command is running, which, for how long, and a progress count that the work advances as it
//! goes (each revision read, rebuilt or validated). A beat that keeps coming while the count stands still means the
//! process lives but its work does not move. Beats are off unless LIFE_SIM_HEARTBEAT_MS names an interval, so a caller
//! that does not read them never sees one; they go to stderr, never into the response stream.

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const HEARTBEAT_SCHEMA: &str = "life-sim-rust-heartbeat/v1";
pub const HEARTBEAT_ENV: &str = "LIFE_SIM_HEARTBEAT_MS";
const MIN_INTERVAL_MS: u64 = 50;

static PROGRESS: AtomicU64 = AtomicU64::new(0);
static BUSY: Mutex<Option<Busy>> = Mutex::new(None);
static INTERVAL_MS: AtomicU64 = AtomicU64::new(0);

struct Busy {
    operation: String,
    request_id: Option<String>,
    started: Instant,
}

/// Advances the progress count; cheap enough for every revision a loop handles.
pub fn tick() {
    PROGRESS.fetch_add(1, Ordering::Relaxed);
}

pub fn progress() -> u64 {
    PROGRESS.load(Ordering::Relaxed)
}

/// Marks the start of a piece of work the beats should name.
pub fn begin(operation: &str, request_id: Option<&str>) {
    if let Ok(mut busy) = BUSY.lock() {
        *busy = Some(Busy {
            operation: operation.to_owned(),
            request_id: request_id.map(str::to_owned),
            started: Instant::now(),
        });
    }
}

/// Names startup work only when it is not already part of a command. The caller ends it only when this returns true.
pub fn begin_if_idle(operation: &str) -> bool {
    if let Ok(mut busy) = BUSY.lock() {
        if busy.is_none() {
            *busy = Some(Busy {
                operation: operation.to_owned(),
                request_id: None,
                started: Instant::now(),
            });
            return true;
        }
    }
    false
}

pub fn end() {
    if let Ok(mut busy) = BUSY.lock() {
        *busy = None;
    }
}

/// The interval the beats were started with, if they were.
pub fn interval_ms() -> Option<u64> {
    match INTERVAL_MS.load(Ordering::Relaxed) {
        0 => None,
        value => Some(value),
    }
}

/// Starts the beats when the environment asks for them. Returns the interval, if any.
pub fn start_from_environment() -> Option<u64> {
    let interval = std::env::var(HEARTBEAT_ENV)
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()?
        .max(MIN_INTERVAL_MS);
    INTERVAL_MS.store(interval, Ordering::Relaxed);
    std::thread::Builder::new()
        .name("heartbeat".to_owned())
        .spawn(move || {
            let mut sequence = 0u64;
            loop {
                std::thread::sleep(Duration::from_millis(interval));
                sequence += 1;
                let line = beat(sequence);
                let mut stderr = std::io::stderr().lock();
                if writeln!(stderr, "{line}").is_err() {
                    return;
                }
            }
        })
        .ok()?;
    Some(interval)
}

fn beat(sequence: u64) -> String {
    let busy = BUSY.lock().ok().and_then(|busy| {
        busy.as_ref().map(|busy| {
            (
                busy.operation.clone(),
                busy.request_id.clone(),
                u64::try_from(busy.started.elapsed().as_millis()).unwrap_or(u64::MAX),
            )
        })
    });
    render(
        sequence,
        progress(),
        busy.as_ref().map(|(operation, request_id, elapsed)| {
            (operation.as_str(), request_id.as_deref(), *elapsed)
        }),
    )
}

fn render(sequence: u64, progress: u64, busy: Option<(&str, Option<&str>, u64)>) -> String {
    serde_json::json!({
        "schema": HEARTBEAT_SCHEMA,
        "sequence": sequence,
        "progress": progress,
        "busy": busy.map(|(operation, request_id, elapsed_ms)| serde_json::json!({
            "operation": operation,
            "request_id": request_id,
            "elapsed_ms": elapsed_ms,
        })),
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_beat_names_the_running_work_and_its_progress() {
        let line: serde_json::Value =
            serde_json::from_str(&render(3, 17, Some(("get_model", Some("request-1"), 250))))
                .unwrap();
        assert_eq!(line["schema"], HEARTBEAT_SCHEMA);
        assert_eq!(line["sequence"], 3);
        assert_eq!(line["progress"], 17);
        assert_eq!(line["busy"]["operation"], "get_model");
        assert_eq!(line["busy"]["request_id"], "request-1");
        assert_eq!(line["busy"]["elapsed_ms"], 250);
        let idle: serde_json::Value = serde_json::from_str(&render(4, 17, None)).unwrap();
        assert!(idle["busy"].is_null());
        let before = progress();
        tick();
        assert!(progress() > before);
        // A beat is one line, so it never splits a response's or another beat's line.
        assert!(!beat(5).contains('\n'));
    }
}
