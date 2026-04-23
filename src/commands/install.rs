//! `construct install` — unified post-build install flow.
//!
//! First slice: the `--sidecars-only` path is the only implementation. It
//! materializes the embedded `install-sidecars.{sh,bat}` scripts into a
//! temporary directory and runs them. This gives users a cross-platform
//! `construct install --sidecars-only` entry point without having to know
//! whether their checkout has the scripts or not (e.g. a `cargo install
//! kumihoio-construct`-only user has no `scripts/` directory available).
//!
//! The full install flow (prerequisite checks, build, onboard, dashboard
//! launch) will migrate from `install.sh` / `setup.bat` into this module over
//! time. Today those scripts remain canonical for a full install.

use anyhow::{Context, Result, anyhow};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The POSIX sidecar installer, embedded at compile time.
const SIDECARS_SH: &str = include_str!("../../scripts/install-sidecars.sh");

/// The Windows sidecar installer, embedded at compile time.
const SIDECARS_BAT: &str = include_str!("../../scripts/install-sidecars.bat");

/// Options for `construct install`.
#[derive(Debug, Default, Clone)]
pub struct InstallOptions {
    /// Install only the Python MCP sidecars (Kumiho + Operator).
    pub sidecars_only: bool,
    /// Skip installing the Kumiho sidecar.
    pub skip_kumiho: bool,
    /// Skip installing the Operator sidecar.
    pub skip_operator: bool,
    /// Print what would be done without executing.
    pub dry_run: bool,
    /// Optional explicit Python interpreter (passed to the sidecar script).
    pub python: Option<String>,
}

/// Run the install command with the given options.
pub async fn run(opts: InstallOptions) -> Result<()> {
    if !opts.sidecars_only {
        return Err(anyhow!(
            "Full install is not yet implemented as a Rust subcommand.\n\
             Use one of:\n  \
               construct install --sidecars-only    # install Kumiho + Operator Python MCP sidecars\n  \
               ./install.sh                         # full POSIX install (source build + sidecars + onboard)\n  \
               setup.bat                            # full Windows install"
        ));
    }
    run_sidecars(&opts).await
}

/// Install the Kumiho + Operator Python MCP sidecars by materializing and
/// invoking the bundled script for the current platform.
async fn run_sidecars(opts: &InstallOptions) -> Result<()> {
    let tmp = tempdir_for_scripts()?;
    let (script_path, mut cmd) = if cfg!(windows) {
        let path = tmp.join("install-sidecars.bat");
        write_atomic(&path, SIDECARS_BAT)?;
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&path);
        (path, c)
    } else {
        let path = tmp.join("install-sidecars.sh");
        write_atomic(&path, SIDECARS_SH)?;
        make_executable(&path)?;
        let mut c = Command::new("bash");
        c.arg(&path);
        (path, c)
    };

    if opts.skip_kumiho {
        cmd.arg("--skip-kumiho");
    }
    if opts.skip_operator {
        cmd.arg("--skip-operator");
    }
    if opts.dry_run && !cfg!(windows) {
        // .bat does not yet implement --dry-run; leave off on Windows.
        cmd.arg("--dry-run");
    }
    if let Some(py) = &opts.python {
        cmd.arg("--python").arg(py);
    }

    eprintln!("==> construct install --sidecars-only");
    eprintln!("    script: {}", script_path.display());

    let status = cmd
        .status()
        .with_context(|| format!("failed to invoke {}", script_path.display()))?;

    if !status.success() {
        let code = status.code().unwrap_or(-1);
        return Err(anyhow!(
            "sidecar installer exited with status {code}. \
             See ~/.construct/logs/ and docs/setup-guides/kumiho-operator-setup.md for troubleshooting."
        ));
    }

    Ok(())
}

/// Create a fresh temp directory under the system temp root.
fn tempdir_for_scripts() -> Result<PathBuf> {
    let base = std::env::temp_dir().join(format!("construct-install-{}", std::process::id()));
    std::fs::create_dir_all(&base)
        .with_context(|| format!("creating temp dir {}", base.display()))?;
    Ok(base)
}

/// Write file contents atomically (best-effort; just write-through on Windows).
fn write_atomic(path: &Path, contents: &str) -> Result<()> {
    let mut f =
        std::fs::File::create(path).with_context(|| format!("creating {}", path.display()))?;
    f.write_all(contents.as_bytes())
        .with_context(|| format!("writing {}", path.display()))?;
    f.flush().ok();
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perm = std::fs::metadata(path)?.permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(path, perm).with_context(|| format!("chmod +x {}", path.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<()> {
    Ok(())
}
