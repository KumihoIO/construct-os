# macOS 업데이트·제거 가이드

macOS(OS X)에서 Construct를 업데이트하거나 제거하는 정식 절차입니다.

마지막 검증: **2026년 2월 22일**.

## 1) 현재 설치 방식 확인

```bash
which construct
construct --version
```

자주 보이는 위치:

- Homebrew: `/opt/homebrew/bin/construct` (Apple Silicon) 또는 `/usr/local/bin/construct` (Intel)
- Cargo/부트스트랩/수동: `~/.cargo/bin/construct`

둘 다 있다면 셸 `PATH` 순서에 따라 어느 쪽이 실행될지 결정됩니다.

## 2) macOS에서 업데이트

### A) Homebrew 설치

```bash
brew update
brew upgrade construct
construct --version
```

### B) 클론 + 부트스트랩 설치

로컬 체크아웃에서:

```bash
git pull --ff-only
./install.sh --prefer-prebuilt
construct --version
```

소스에서만 다시 빌드하고 싶다면:

```bash
git pull --ff-only
cargo install --path . --force --locked
construct --version
```

### C) 수동 사전 빌드 바이너리 설치

평소 받던 다운로드/설치 흐름을 최신 릴리스 자산으로 다시 돌린 뒤 확인하세요.

```bash
construct --version
```

## 3) macOS에서 제거

### A) 먼저 백그라운드 서비스 정지·제거

바이너리를 지운 뒤에도 데몬이 계속 살아 있는 상황을 막기 위해 먼저 처리합니다.

```bash
construct service stop || true
construct service uninstall || true
```

`service uninstall`이 정리하는 서비스 아티팩트:

- `~/Library/LaunchAgents/com.construct.daemon.plist`

### B) 설치 방식별 바이너리 제거

Homebrew:

```bash
brew uninstall construct
```

Cargo/부트스트랩/수동 (`~/.cargo/bin/construct`):

```bash
cargo uninstall construct || true
rm -f ~/.cargo/bin/construct
```

### C) 선택: 로컬 런타임 데이터 제거

설정·인증 프로필·로그·워크스페이스 상태까지 전부 깨끗이 지우고 싶을 때만 실행하세요.

```bash
rm -rf ~/.construct
```

## 4) 제거 완료 확인

```bash
command -v construct || echo "construct binary not found"
pgrep -fl construct || echo "No running construct process"
```

`pgrep`에 여전히 잡히는 프로세스가 있으면 수동으로 정리하고 다시 확인하세요.

```bash
pkill -f construct
```

## 관련 문서

- [한 번에 부트스트랩](one-click-bootstrap.md)
- [명령어 참조](../reference/cli/commands-reference.md) *(영문)*
- [트러블슈팅](../ops/troubleshooting.md) *(영문)*
