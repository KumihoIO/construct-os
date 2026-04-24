//! Python interpreter detection for sidecar provisioning.
//!
//! Hard-fails with a download link when no usable Python ≥3.11 is found.
//! Probes candidates with `-c "import sys"` to skip the Windows Store stub
//! which exits 9009 and writes to stderr rather than actually running.

use anyhow::{Result, anyhow};
use std::path::{Path, PathBuf};
use std::process::Command;

const MIN_MAJOR: u32 = 3;
const MIN_MINOR: u32 = 11;

const DOWNLOAD_URL: &str = "https://www.python.org/downloads/";

/// Resolve a usable Python interpreter, honoring `explicit` if provided.
///
/// Returns the absolute path to the interpreter on success.
pub fn detect_python(explicit: Option<&str>) -> Result<PathBuf> {
    if let Some(path) = explicit {
        let candidate = PathBuf::from(path);
        return probe(&candidate).ok_or_else(|| missing_python_error(Some(path)));
    }

    let candidates: &[&str] = if cfg!(windows) {
        &["py", "python3", "python"]
    } else {
        &["python3", "python"]
    };

    for name in candidates {
        if let Some(resolved) = probe(Path::new(name)) {
            return Ok(resolved);
        }
    }

    Err(missing_python_error(None))
}

/// Probe a candidate interpreter. Returns its resolved absolute path if it
/// runs, reports version ≥ MIN_MAJOR.MIN_MINOR, and is not a Store stub.
fn probe(candidate: &Path) -> Option<PathBuf> {
    let output = Command::new(candidate)
        .args([
            "-c",
            "import sys; print(sys.executable); print(sys.version_info[0]); print(sys.version_info[1])",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    let exe = lines.next()?.trim();
    let major: u32 = lines.next()?.trim().parse().ok()?;
    let minor: u32 = lines.next()?.trim().parse().ok()?;

    if exe.is_empty() {
        return None;
    }
    if major < MIN_MAJOR || (major == MIN_MAJOR && minor < MIN_MINOR) {
        return None;
    }

    Some(PathBuf::from(exe))
}

fn missing_python_error(tried: Option<&str>) -> anyhow::Error {
    let prefix = match tried {
        Some(p) => format!("Python interpreter `{p}` is unusable"),
        None => format!("No usable Python ≥{MIN_MAJOR}.{MIN_MINOR} found on PATH"),
    };
    anyhow!(
        "{prefix}.\n\n\
         Construct requires Python {MIN_MAJOR}.{MIN_MINOR}+ to run its MCP sidecars.\n\
         Install it from {DOWNLOAD_URL} and re-run `construct install --sidecars-only`.\n\n\
         On Windows, avoid the Microsoft Store Python stub — install from python.org directly."
    )
}
