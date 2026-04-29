@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: Construct Windows Setup Script
:: Simplifies building and installing Construct on Windows.
:: Usage: setup.bat [--prebuilt | --minimal | --standard | --full | --help]
:: ============================================================================

:: Derive version from Cargo.toml (single source of truth) so the banner
:: never drifts from the workspace version we're actually setting up.
:: findstr /b /c:"version = " matches only the [package] version line —
:: cargo-dist-version, rust-version, etc. start with different prefixes.
set "VERSION=unknown"
for /f "tokens=2 delims==" %%v in ('findstr /b /c:"version = " "%~dp0Cargo.toml" 2^>nul') do set "VERSION=%%v"
set "VERSION=%VERSION:"=%"
set "VERSION=%VERSION: =%"
set "RUST_MIN_VERSION=1.87"
set "TARGET=x86_64-pc-windows-msvc"
set "REPO=https://github.com/KumihoIO/construct-os"

:: Colors via ANSI (Windows 10+ Terminal)
set "GREEN=[32m"
set "YELLOW=[33m"
set "RED=[31m"
set "BLUE=[34m"
set "BOLD=[1m"
set "RESET=[0m"

:: Parse arguments
set "MODE=interactive"
if "%~1"=="--help"     goto :show_help
if "%~1"=="-h"         goto :show_help
if "%~1"=="--prebuilt" set "MODE=prebuilt" & goto :start
if "%~1"=="--minimal"  set "MODE=minimal"  & goto :start
if "%~1"=="--standard" set "MODE=standard" & goto :start
if "%~1"=="--full"     set "MODE=full"     & goto :start

:start
echo.
echo %BOLD%%BLUE%=========================================%RESET%
echo %BOLD%%BLUE%  Construct Windows Setup  v%VERSION%%RESET%
echo %BOLD%%BLUE%=========================================%RESET%
echo.

:: ---- Step 1: Check prerequisites ----
echo %BOLD%[1/5] Checking prerequisites...%RESET%

:: Check available RAM (rough estimate via wmic)
for /f "tokens=2 delims==" %%a in ('wmic os get FreePhysicalMemory /value 2^>nul ^| find "="') do (
    set /a "FREE_RAM_MB=%%a / 1024"
)
if defined FREE_RAM_MB (
    if !FREE_RAM_MB! LSS 2048 (
        echo   %YELLOW%WARNING: Only !FREE_RAM_MB! MB free RAM detected. 2048 MB recommended for source builds.%RESET%
        echo   %YELLOW%Consider using --prebuilt instead.%RESET%
    ) else (
        echo   %GREEN%OK%RESET% Free RAM: !FREE_RAM_MB! MB
    )
)

:: Check disk space
for /f "tokens=3" %%a in ('dir /-C "%~dp0" 2^>nul ^| findstr /C:"bytes free"') do (
    set /a "FREE_DISK_GB=%%a / 1073741824"
)

:: Check Rust
where cargo >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   %YELLOW%Rust not found.%RESET%
    goto :install_rust
) else (
    for /f "tokens=2" %%v in ('rustc --version 2^>nul') do set "RUST_VER=%%v"
    echo   %GREEN%OK%RESET% Rust !RUST_VER! found
)

:: Check Node.js (optional)
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   %YELLOW%Node.js not found ^(optional - web dashboard will use stub^).%RESET%
) else (
    for /f "tokens=1" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
    echo   %GREEN%OK%RESET% Node.js !NODE_VER! found
)

:: Check Git
where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   %RED%ERROR: Git is required but not found.%RESET%
    echo   Install Git from https://git-scm.com/download/win
    goto :error_exit
) else (
    echo   %GREEN%OK%RESET% Git found
)

goto :choose_mode

:: ---- Install Rust ----
:install_rust
echo.
echo %BOLD%Installing Rust...%RESET%
echo   Downloading rustup-init.exe...

:: Download rustup-init.exe
curl -sSfL -o "%TEMP%\rustup-init.exe" https://win.rustup.rs
if %ERRORLEVEL% NEQ 0 (
    echo   %RED%ERROR: Failed to download rustup-init.exe%RESET%
    echo   Please install Rust manually from https://rustup.rs
    goto :error_exit
)

:: Run rustup-init with defaults
"%TEMP%\rustup-init.exe" -y --default-toolchain stable --target %TARGET%
if %ERRORLEVEL% NEQ 0 (
    echo   %RED%ERROR: Rust installation failed.%RESET%
    goto :error_exit
)

:: Refresh PATH
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
echo   %GREEN%OK%RESET% Rust installed successfully.
echo   %YELLOW%NOTE: You may need to restart your terminal for PATH changes.%RESET%
goto :choose_mode

:: ---- Choose build mode ----
:choose_mode
echo.

if "%MODE%"=="prebuilt" goto :install_prebuilt
if "%MODE%"=="minimal"  goto :build_minimal
if "%MODE%"=="standard" goto :build_standard
if "%MODE%"=="full"     goto :build_full

:: Interactive mode
echo %BOLD%[2/5] Choose installation method:%RESET%
echo.
echo   1) Prebuilt binary   - Download pre-compiled release (fastest, ~2 min)
echo   2) Minimal build     - Default features only (~15 min)
echo   3) Standard build    - Default + Lark/Feishu + Matrix (~20 min)
echo   4) Full build        - All features including hardware + browser (~30 min)
echo.
set /p "CHOICE=  Select [1-4] (default: 1): "

if "%CHOICE%"=="" set "CHOICE=1"
if "%CHOICE%"=="1" goto :install_prebuilt
if "%CHOICE%"=="2" goto :build_minimal
if "%CHOICE%"=="3" goto :build_standard
if "%CHOICE%"=="4" goto :build_full

echo   %RED%Invalid choice. Please enter 1-4.%RESET%
goto :choose_mode

:: ---- Prebuilt binary ----
:install_prebuilt
echo.
echo %BOLD%[3/5] Downloading prebuilt binary...%RESET%

:: Try to get latest release URL via gh or curl
where gh >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%u in ('gh release view --repo %REPO% --json assets --jq ".assets[] | select(.name | test(\"windows-msvc\")) | .url" 2^>nul') do (
        set "DOWNLOAD_URL=%%u"
    )
)

if not defined DOWNLOAD_URL (
    :: Fallback: construct URL from known release pattern
    set "DOWNLOAD_URL=https://github.com/KumihoIO/construct-os/releases/latest/download/construct-%TARGET%.zip"
)

echo   Downloading from release...
curl -sSfL -o "%TEMP%\construct-windows.zip" "!DOWNLOAD_URL!"
if %ERRORLEVEL% NEQ 0 (
    echo   %YELLOW%Prebuilt binary not available. Falling back to source build ^(standard^).%RESET%
    goto :build_standard
)

:: Extract
echo   Extracting...
mkdir "%USERPROFILE%\.construct\bin" 2>nul
tar -xf "%TEMP%\construct-windows.zip" -C "%USERPROFILE%\.construct\bin"
if %ERRORLEVEL% NEQ 0 (
    powershell -Command "Expand-Archive -Force '%TEMP%\construct-windows.zip' '%USERPROFILE%\.construct\bin'"
)

:: Add to User PATH (idempotent, registry-backed — see :add_to_user_path)
call :add_to_user_path

echo   %GREEN%OK%RESET% Binary installed to %USERPROFILE%\.construct\bin\construct.exe
goto :install_sidecars

:: ---- Minimal build ----
:build_minimal
set "FEATURES="
set "BUILD_DESC=minimal (default features)"
goto :do_build

:: ---- Standard build ----
:build_standard
set "FEATURES=--features channel-matrix,channel-lark"
set "BUILD_DESC=standard (Matrix + Lark/Feishu)"
goto :do_build

:: ---- Full build ----
:build_full
set "FEATURES=--features channel-matrix,channel-lark,browser-native,hardware,rag-pdf,observability-otel"
set "BUILD_DESC=full (all features)"
goto :do_build

:: ---- Build from source ----
:do_build
echo.
echo %BOLD%[3/5] Building Construct (%BUILD_DESC%)...%RESET%
echo   Target: %TARGET%

:: Ensure we're in the repo root (check for Cargo.toml)
if not exist "Cargo.toml" (
    echo   %RED%ERROR: Cargo.toml not found. Run this script from the construct repository root.%RESET%
    echo   Example:
    echo     git clone %REPO%
    echo     cd construct
    echo     setup.bat
    goto :error_exit
)

:: Add target if missing
rustup target add %TARGET% >nul 2>&1

echo   This may take 15-30 minutes on first build...
echo.

cargo build --release --locked %FEATURES% --target %TARGET%
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   %RED%ERROR: Build failed.%RESET%
    echo   Common fixes:
    echo   - Ensure Visual Studio Build Tools are installed ^(C++ workload^)
    echo   - Run: rustup update
    echo   - Check disk space ^(6 GB needed^)
    goto :error_exit
)

echo   %GREEN%OK%RESET% Build succeeded.

:: Copy binary to a convenient location
echo.
echo %BOLD%[4/5] Installing binary...%RESET%
mkdir "%USERPROFILE%\.construct\bin" 2>nul
copy /Y "target\%TARGET%\release\construct.exe" "%USERPROFILE%\.construct\bin\construct.exe" >nul
echo   %GREEN%OK%RESET% Installed to %USERPROFILE%\.construct\bin\construct.exe

:: Add to User PATH (idempotent, registry-backed — see :add_to_user_path)
call :add_to_user_path

goto :install_sidecars

:: ---- Python MCP sidecars (Kumiho + Operator) ----
:: If operator-mcp\ is present and Python is available, auto-install the
:: Kumiho and Operator sidecars under %USERPROFILE%\.construct\. Reached by
:: both prebuilt and source-build paths.
:install_sidecars
if not exist "%~dp0operator-mcp" goto :post_install

where python >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo   %YELLOW%Python not found — skipping MCP sidecar install.%RESET%
    echo   %YELLOW%Install Python 3.11+ and run: scripts\install-sidecars.bat%RESET%
    goto :post_install
)

if exist "%USERPROFILE%\.construct\kumiho\run_kumiho_mcp.py" goto :post_install

echo.
echo %BOLD%[4.5/5] Installing Python MCP sidecars (Kumiho + Operator)...%RESET%
call "%~dp0scripts\install-sidecars.bat"
if !ERRORLEVEL! NEQ 0 (
    echo   %YELLOW%Sidecar install reported errors — see docs\setup-guides\kumiho-operator-setup.md%RESET%
) else (
    echo   %GREEN%OK%RESET% Sidecars installed
)

:: ---- Post install ----
:post_install
echo.
echo %BOLD%[5/5] Verifying installation...%RESET%

:: Step A: prove the binary itself runs (uses absolute path, independent
:: of PATH state).  Failure here is a build/copy bug.
"%USERPROFILE%\.construct\bin\construct.exe" --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   %RED%ERROR:%RESET% Binary not found at %USERPROFILE%\.construct\bin\construct.exe
    goto :error_exit
)
for /f "tokens=*" %%v in ('"%USERPROFILE%\.construct\bin\construct.exe" --version 2^>nul') do (
    echo   %GREEN%OK%RESET% %%v
)

:: Step B: confirm the User PATH registry entry is present (NOT just
:: this session's %PATH% — that's a separate, in-memory copy).  This
:: tests what new terminals will inherit, which is the user's actual
:: question: "will `construct` work after I close and reopen my shell?"
where powershell >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    powershell -NoProfile -Command "$u = [Environment]::GetEnvironmentVariable('Path', 'User'); if (($u -split ';') -contains ($env:USERPROFILE + '\.construct\bin')) { exit 0 } else { exit 1 }" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo   %GREEN%OK%RESET% On User PATH ^(close + reopen your terminal to use 'construct'^)
    ) else (
        echo   %YELLOW%WARNING:%RESET% Not on User PATH yet. Add manually:
        echo     %USERPROFILE%\.construct\bin
    )
)

echo.
echo %BOLD%%GREEN%=========================================%RESET%
echo %BOLD%%GREEN%  Construct setup complete!%RESET%
echo %BOLD%%GREEN%=========================================%RESET%
echo.
echo   Next steps:
echo     1. Restart your terminal (for PATH changes)
echo     2. Run: construct onboard           ^(guided provider + config setup^)
echo     3. Run: construct gateway           ^(starts the web dashboard at http://127.0.0.1:42617^)
echo.
echo   Useful commands:
echo     construct status                    ^(health check^)
echo     construct agent -m "Hello"          ^(one-shot message^)
echo     construct doctor                    ^(diagnose issues^)
echo.
echo   Alternative install via Scoop:
echo     scoop bucket add construct https://github.com/KumihoIO/scoop-construct
echo     scoop install construct
echo.
echo   Documentation: https://www.kumiho.io/docs
echo.
goto :end

:: ---- Help ----
:show_help
echo.
echo Construct Windows Setup Script
echo.
echo Usage: setup.bat [OPTIONS]
echo.
echo Options:
echo   --prebuilt    Download pre-compiled binary (fastest)
echo   --minimal     Build with default features only
echo   --standard    Build with Matrix + Lark/Feishu
echo   --full        Build with all features
echo   --help, -h    Show this help message
echo.
echo Without arguments, runs in interactive mode.
echo.
echo Prerequisites:
echo   - Git (required)
echo   - Rust 1.87+ (auto-installed if missing)
echo   - Visual Studio Build Tools with C++ workload (for source builds)
echo   - Node.js (optional, for web dashboard)
echo.
goto :end

:: ---- Subroutine: idempotent User PATH append ─────────────────────────────
:: Appends %USERPROFILE%\.construct\bin to the **User** PATH (HKCU\Environment\Path)
:: via PowerShell's [Environment]::SetEnvironmentVariable API.
::
:: Why not `setx PATH "%PATH%;..."`?  That's the obvious-looking call but it's
:: broken for our purpose: %PATH% in cmd is the MERGED System+User PATH, so
:: setx ends up writing the merged string into the User scope — which (a)
:: duplicates every System PATH entry into User PATH on the first run, and
:: (b) silently truncates writes longer than 1024 chars (well-documented
:: setx limitation), corrupting whatever was there before.
::
:: PowerShell's [Environment] API touches only the requested scope and has
:: no length cap.  It writes through the same registry path Windows reads
:: when spawning new terminals, so closing + reopening a shell picks up
:: the new entry without a logoff.
::
:: Idempotent: re-running setup.bat does not append duplicates.
:: Also updates the current session's %PATH% so the verification step
:: below can resolve `construct` without the user restarting their shell.
:add_to_user_path
where powershell >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   %YELLOW%WARNING:%RESET% PowerShell not found — cannot update User PATH.
    echo   %YELLOW%Add manually:%RESET% %USERPROFILE%\.construct\bin
    goto :eof
)
set "PATH_RESULT=error"
for /f "delims=" %%r in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=$env:USERPROFILE+'\.construct\bin'; $u=[Environment]::GetEnvironmentVariable('Path','User'); if (($u -split ';') -notcontains $b) { $n = if ([string]::IsNullOrEmpty($u)) { $b } else { $u.TrimEnd(';') + ';' + $b }; [Environment]::SetEnvironmentVariable('Path',$n,'User'); 'added' } else { 'present' }" 2^>nul') do set "PATH_RESULT=%%r"

if "!PATH_RESULT!"=="added" (
    set "PATH=!PATH!;%USERPROFILE%\.construct\bin"
    echo   %GREEN%OK%RESET% Added %USERPROFILE%\.construct\bin to User PATH
) else if "!PATH_RESULT!"=="present" (
    set "PATH=!PATH!;%USERPROFILE%\.construct\bin"
    echo   %GREEN%OK%RESET% %USERPROFILE%\.construct\bin already on User PATH
) else (
    echo   %YELLOW%WARNING:%RESET% Failed to update User PATH automatically.
    echo   %YELLOW%Add manually:%RESET% %USERPROFILE%\.construct\bin
)
goto :eof

:: ---- Error exit ----
:error_exit
echo.
echo %RED%Setup failed. See errors above.%RESET%
echo Need help? Open an issue at %REPO%/issues
echo.
endlocal
exit /b 1

:: ---- Clean exit ----
:end
endlocal
exit /b 0
