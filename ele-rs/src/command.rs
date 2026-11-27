//! Bounded subprocess execution shared by collection and diagnostics.
use std::io::{self, Read};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

pub struct TimedCommandOutput {
    pub status: ExitStatus,
    pub timed_out: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

#[derive(Default)]
struct DrainedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

struct OutputReader {
    completed: Receiver<io::Result<()>>,
    data: Arc<Mutex<DrainedOutput>>,
}

fn drain(mut pipe: impl Read + Send + 'static) -> OutputReader {
    let (sender, completed) = mpsc::channel();
    let data = Arc::new(Mutex::new(DrainedOutput::default()));
    let pending = Arc::clone(&data);
    thread::spawn(move || {
        let result = (|| {
            let mut buffer = [0; 8192];
            loop {
                let count = pipe.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                // Keep draining after the cap so a verbose child cannot block on a full pipe.
                let mut output = pending.lock().expect("output buffer poisoned");
                let keep = count.min(MAX_OUTPUT_BYTES.saturating_sub(output.bytes.len()));
                output.truncated |= keep < count;
                output.bytes.extend_from_slice(&buffer[..keep]);
            }
            Ok(())
        })();
        let _ = sender.send(result);
    });
    OutputReader { completed, data }
}

fn terminate(child: &mut Child) {
    #[cfg(unix)]
    {
        // Each child starts its own group; terminate descendants that inherited its pipes too.
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    if let Some(root) = std::env::var_os("SystemRoot") {
        use std::os::windows::process::CommandExt;
        let _ = Command::new(std::path::PathBuf::from(root).join("System32/taskkill.exe"))
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
    let _ = child.kill();
}

pub fn output_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> io::Result<TimedCommandOutput> {
    if timeout.is_zero() {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "collection deadline exceeded",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let deadline = Instant::now() + timeout;
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = drain(child.stdout.take().expect("piped stdout"));
    let stderr = drain(child.stderr.take().expect("piped stderr"));
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                terminate(&mut child);
                let _ = child.wait();
                return Err(error);
            }
        }
        if Instant::now() >= deadline {
            timed_out = true;
            terminate(&mut child);
            break child.wait()?;
        }
        thread::sleep(Duration::from_millis(10));
    };
    // A killed child still needs a short, bounded drain grace to retain completed NDJSON records.
    let drain_deadline = deadline.max(Instant::now() + Duration::from_millis(100));
    let mut read = |reader: OutputReader| -> io::Result<DrainedOutput> {
        match reader
            .completed
            .recv_timeout(drain_deadline.saturating_duration_since(Instant::now()))
        {
            Ok(result) => result?,
            Err(_) => {
                timed_out = true;
                terminate(&mut child);
            }
        }
        // A descendant can hold a pipe open even after the parent exits. Return
        // bytes already received instead of discarding completed probe records.
        Ok(std::mem::take(
            &mut *reader.data.lock().expect("output buffer poisoned"),
        ))
    };
    let stdout = read(stdout)?;
    let stderr = read(stderr)?;
    Ok(TimedCommandOutput {
        status,
        timed_out,
        stdout: stdout.bytes,
        stderr: stderr.bytes,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn child_worker() {
        match std::env::var("NPCINK_TEST_COMMAND").as_deref() {
            Ok("sleep") => thread::sleep(Duration::from_secs(2)),
            Ok("partial") => {
                std::io::stdout()
                    .write_all(b"{\"completed\":true}\n")
                    .unwrap();
                std::io::stdout().flush().unwrap();
                thread::sleep(Duration::from_secs(2));
            }
            Ok("large") => {
                std::io::stdout()
                    .write_all(&vec![b'x'; 1024 * 1024])
                    .unwrap();
                std::io::stderr()
                    .write_all(&vec![b'y'; 1024 * 1024])
                    .unwrap();
            }
            Ok("huge") => {
                std::io::stdout()
                    .write_all(&vec![b'x'; MAX_OUTPUT_BYTES * 2])
                    .unwrap();
            }
            #[cfg(unix)]
            Ok("descendant") => {
                // The fixture intentionally exits first; the runner must retain output and terminate its orphan.
                std::io::stdout()
                    .write_all(b"{\"completed\":true}\n")
                    .unwrap();
                std::io::stdout().flush().unwrap();
                #[allow(clippy::zombie_processes)]
                let _descendant = worker("sleep").spawn().unwrap();
            }
            _ => {}
        }
    }

    fn worker(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "command::tests::child_worker", "--nocapture"])
            .env("NPCINK_TEST_COMMAND", mode);
        command
    }

    #[test]
    fn terminates_a_hung_command() {
        let start = Instant::now();
        let output = output_with_timeout(&mut worker("sleep"), Duration::from_millis(100)).unwrap();
        assert!(output.timed_out);
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn drains_both_pipes_without_deadlock() {
        let output = output_with_timeout(&mut worker("large"), Duration::from_secs(5)).unwrap();
        assert!(!output.timed_out);
        assert!(output.status.success());
        assert!(output.stdout.len() >= 1024 * 1024);
        assert!(output.stderr.len() >= 1024 * 1024);
    }

    #[test]
    fn caps_output_while_continuing_to_drain() {
        let output = output_with_timeout(&mut worker("huge"), Duration::from_secs(5)).unwrap();
        assert!(!output.timed_out);
        assert!(output.status.success());
        assert_eq!(output.stdout.len(), MAX_OUTPUT_BYTES);
        assert!(output.stdout_truncated);
        assert!(!output.stderr_truncated);
    }

    #[test]
    fn retains_completed_records_when_a_later_probe_hangs() {
        let output =
            output_with_timeout(&mut worker("partial"), Duration::from_millis(150)).unwrap();
        assert!(output.timed_out);
        assert!(String::from_utf8_lossy(&output.stdout).contains("{\"completed\":true}"));
    }

    #[cfg(unix)]
    #[test]
    fn bounds_waiting_for_pipes_inherited_by_descendants() {
        let start = Instant::now();
        let output =
            output_with_timeout(&mut worker("descendant"), Duration::from_millis(200)).unwrap();
        assert!(output.timed_out);
        assert!(start.elapsed() < Duration::from_secs(1));
        assert!(String::from_utf8_lossy(&output.stdout).contains("{\"completed\":true}"));
    }
}
