//! Sidecar installation logic.
//!
//! At compile time we embed:
//! - The two Python launcher scripts (as strings).
//! - The `operator-mcp/` Python package source (via `include_dir!`).
//!
//! At install time we detect Python, create per-sidecar venvs, pip-install
//! `kumiho[mcp]` into the Kumiho venv, extract the embedded operator-mcp
//! source into a temp dir and pip-install it into the Operator venv, and
//! materialize the launchers. No shell scripts involved.

use anyhow::{Context, Result, anyhow};
use include_dir::{Dir, DirEntry, include_dir};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::python::detect_python;
use super::{construct_root, kumiho_launcher_path, operator_launcher_path};

const KUMIHO_LAUNCHER_SRC: &str = include_str!("../../resources/sidecars/run_kumiho_mcp.py");
const OPERATOR_LAUNCHER_SRC: &str = include_str!("../../resources/sidecars/run_operator_mcp.py");

static OPERATOR_MCP_SRC: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/operator-mcp");

/// The PyPI version pin for the Kumiho package. Must match
/// `operator-mcp/requirements.txt`.
const KUMIHO_PIN: &str = "kumiho[mcp]>=0.9.20";

#[derive(Debug, Default, Clone)]
pub struct SidecarInstallOptions {
    pub skip_kumiho: bool,
    pub skip_operator: bool,
    pub dry_run: bool,
    pub python: Option<String>,
}

pub async fn install_sidecars(opts: &SidecarInstallOptions) -> Result<()> {
    let python = detect_python(opts.python.as_deref())?;
    eprintln!("==> construct install --sidecars-only");
    eprintln!("    python: {}", python.display());

    let root = construct_root()?;
    std::fs::create_dir_all(&root).with_context(|| format!("creating {}", root.display()))?;

    if !opts.skip_operator {
        install_operator(&python, opts.dry_run)?;
    } else {
        eprintln!("    [skip] Operator (--skip-operator)");
    }

    if !opts.skip_kumiho {
        install_kumiho(&python, opts.dry_run)?;
    } else {
        eprintln!("    [skip] Kumiho (--skip-kumiho)");
    }

    eprintln!("==> sidecars ready");
    eprintln!("    kumiho   : {}", kumiho_launcher_path()?.display());
    eprintln!("    operator : {}", operator_launcher_path()?.display());
    Ok(())
}

fn install_kumiho(python: &Path, dry_run: bool) -> Result<()> {
    let dir = construct_root()?.join("kumiho");
    let venv = dir.join("venv");
    let launcher = dir.join("run_kumiho_mcp.py");

    eprintln!("==> Installing Kumiho MCP → {}", dir.display());
    if dry_run {
        eprintln!("    + create {}", venv.display());
        eprintln!("    + pip install {KUMIHO_PIN}");
        eprintln!("    + write {}", launcher.display());
        return Ok(());
    }

    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    ensure_venv(python, &venv)?;
    let venv_py = venv_python(&venv)?;

    run(
        &venv_py,
        &["-m", "pip", "install", "--quiet", "--upgrade", "pip"],
    )?;
    run(&venv_py, &["-m", "pip", "install", "--quiet", KUMIHO_PIN])?;
    eprintln!("    [ok] kumiho[mcp] installed");

    write_launcher(&launcher, KUMIHO_LAUNCHER_SRC)?;
    eprintln!("    [ok] launcher: {}", launcher.display());
    Ok(())
}

fn install_operator(python: &Path, dry_run: bool) -> Result<()> {
    let dir = construct_root()?.join("operator_mcp");
    let venv = dir.join("venv");
    let launcher = dir.join("run_operator_mcp.py");

    eprintln!("==> Installing Operator MCP → {}", dir.display());
    if dry_run {
        eprintln!("    + extract embedded operator-mcp source");
        eprintln!("    + create {}", venv.display());
        eprintln!("    + pip install operator-mcp");
        eprintln!("    + write {}", launcher.display());
        return Ok(());
    }

    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;

    let staging = tempfile::tempdir().context("creating operator-mcp staging dir")?;
    extract_operator_source(staging.path())?;
    eprintln!("    [ok] extracted operator-mcp source → staging");

    ensure_venv(python, &venv)?;
    let venv_py = venv_python(&venv)?;

    run(
        &venv_py,
        &["-m", "pip", "install", "--quiet", "--upgrade", "pip"],
    )?;
    let staging_str = staging.path().to_string_lossy().to_string();
    run(&venv_py, &["-m", "pip", "install", "--quiet", &staging_str])?;
    eprintln!("    [ok] operator-mcp installed");

    write_launcher(&launcher, OPERATOR_LAUNCHER_SRC)?;
    eprintln!("    [ok] launcher: {}", launcher.display());
    Ok(())
}

/// Extract the embedded `operator-mcp/` tree into `dest`, skipping the files
/// that pip doesn't need (tests, session-manager, node bits, caches).
fn extract_operator_source(dest: &Path) -> Result<()> {
    walk_dir(&OPERATOR_MCP_SRC, dest)?;
    for required in ["pyproject.toml", "operator_mcp/__init__.py"] {
        if !dest.join(required).exists() {
            return Err(anyhow!(
                "embedded operator-mcp source missing `{required}` after extraction; \
                 check Cargo.toml `include` whitelist"
            ));
        }
    }
    Ok(())
}

fn walk_dir(dir: &Dir<'_>, dest: &Path) -> Result<()> {
    for entry in dir.entries() {
        let rel = entry.path();
        if !is_relevant(rel) {
            continue;
        }
        match entry {
            DirEntry::Dir(sub) => {
                let out = dest.join(rel);
                std::fs::create_dir_all(&out)
                    .with_context(|| format!("creating {}", out.display()))?;
                walk_dir(sub, dest)?;
            }
            DirEntry::File(file) => {
                let out = dest.join(rel);
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent)
                        .with_context(|| format!("creating {}", parent.display()))?;
                }
                std::fs::write(&out, file.contents())
                    .with_context(|| format!("writing {}", out.display()))?;
            }
        }
    }
    Ok(())
}

fn is_relevant(rel: &Path) -> bool {
    let s = rel.to_string_lossy();
    if s.contains("__pycache__")
        || s.contains("/.venv")
        || s.contains("/venv/")
        || s.starts_with("tests/")
        || s.starts_with("session-manager/")
        || s.starts_with("node_modules/")
        || s.ends_with(".pyc")
    {
        return false;
    }
    true
}

fn ensure_venv(python: &Path, venv: &Path) -> Result<()> {
    if venv_python(venv).is_ok() {
        eprintln!("    [skip] venv already exists: {}", venv.display());
        return Ok(());
    }
    let venv_str = venv.to_string_lossy().to_string();
    run(python, &["-m", "venv", &venv_str])?;
    eprintln!("    [ok] venv created: {}", venv.display());
    Ok(())
}

fn venv_python(venv: &Path) -> Result<PathBuf> {
    let candidates = if cfg!(windows) {
        vec![venv.join("Scripts").join("python.exe")]
    } else {
        vec![
            venv.join("bin").join("python3"),
            venv.join("bin").join("python"),
        ]
    };
    for c in candidates {
        if c.exists() {
            return Ok(c);
        }
    }
    Err(anyhow!("venv python not found under {}", venv.display()))
}

fn write_launcher(path: &Path, contents: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(path, contents).with_context(|| format!("writing {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(path)?.permissions();
        perm.set_mode(0o755);
        std::fs::set_permissions(path, perm)
            .with_context(|| format!("chmod +x {}", path.display()))?;
    }
    Ok(())
}

fn run(program: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .status()
        .with_context(|| format!("invoking {} {}", program.display(), args.join(" ")))?;
    if !status.success() {
        return Err(anyhow!(
            "`{} {}` exited with status {}",
            program.display(),
            args.join(" "),
            status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}
