# Construct 문서 (한국어)

이 페이지는 Construct 문서 시스템의 한국어 진입점입니다.

> Construct의 Rust 코어 런타임은 [ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw)의 포크입니다. 전체 attribution은 루트 [`NOTICE`](../../../NOTICE)와 [`docs/upstream/zeroclaw-attribution.md`](../../upstream/zeroclaw-attribution.md)를 참고하세요.

마지막 업데이트: **April 27, 2026**.

다른 언어: [English](../../README.md) · [Tiếng Việt](../vi/README.md) · [简体中文](../zh-CN/README.md).

> 한국어 번역은 진행 중이며, 본 허브는 영문 원본 문서로 연결되는 색인 역할을 합니다. 번역되지 않은 페이지는 *(영문)* 표시와 함께 영문 문서로 이동합니다.

---

## 대상별 시작점

- **Construct가 처음이라면?** → [one-click-bootstrap.md](../../setup-guides/one-click-bootstrap.md) *(영문)* → [setup-guides/README.md](../../setup-guides/README.md) *(영문)*
- **하드웨어/임베디드?** → [hardware/README.md](../../hardware/README.md) *(영문)*
- **프로덕션 운영?** → [ops/README.md](../../ops/README.md) *(영문)*
- **API/MCP 통합?** → [reference/README.md](../../reference/README.md) *(영문)* + [contributing/README.md](../../contributing/README.md) *(영문)*
- **PR 리뷰/머지?** → [pr-workflow.md](../../contributing/pr-workflow.md) *(영문)* + [reviewer-playbook.md](../../contributing/reviewer-playbook.md) *(영문)*
- **전체 목차** → [SUMMARY.md](SUMMARY.md)

## 작업별 빠른 색인

| 하고 싶은 것… | 이것을 읽으세요 |
|---|---|
| Construct를 빠르게 설치 | [README.md (설치)](../../../README.md#install) *(영문)* |
| 한 번의 명령으로 부트스트랩 | [one-click-bootstrap.md](../../setup-guides/one-click-bootstrap.md) *(영문)* |
| Kumiho 메모리 사이드카 설치 | [kumiho-operator-setup.md](../../setup-guides/kumiho-operator-setup.md) *(영문)* |
| macOS 업데이트/제거 | [macos-update-uninstall.md](../../setup-guides/macos-update-uninstall.md) *(영문)* |
| Windows 설치 | [windows-setup.md](../../setup-guides/windows-setup.md) *(영문)* |
| 작업별 명령어 찾기 | [commands-reference.md](../../reference/cli/commands-reference.md) *(영문)* |
| 구성 키와 기본값 확인 | [config-reference.md](../../reference/api/config-reference.md) *(영문)* |
| 사용자 정의 프로바이더 구성 | [custom-providers.md](../../contributing/custom-providers.md) *(영문)* |
| Z.AI / GLM 프로바이더 구성 | [zai-glm-setup.md](../../setup-guides/zai-glm-setup.md) *(영문)* |
| Kumiho 그래프 네이티브 인지 메모리 통합 | [kumiho-memory-integration.md](../../contributing/kumiho-memory-integration.md) *(영문)* |
| 임베디드 React 대시보드 로컬 실행 | [dashboard-dev.md](../../setup-guides/dashboard-dev.md) *(영문)* |
| 런타임 운영 (2일차 런북) | [operations-runbook.md](../../ops/operations-runbook.md) *(영문)* |
| 설치/런타임/채널 문제 해결 | [troubleshooting.md](../../ops/troubleshooting.md) *(영문)* |
| Matrix 암호화 방 설정 및 진단 | [matrix-e2ee-guide.md](../../security/matrix-e2ee-guide.md) *(영문)* |

## Construct를 Construct답게 만드는 것

- **메모리 네이티브 Rust 에이전트 런타임** — 모든 세션, 계획, 스킬, 신뢰 점수가 Kumiho 그래프에 영속됨
- **단일 바이너리** — 게이트웨이, 데몬, React 대시보드, MCP 사이드카, CLI가 하나의 정적 바이너리로 패키징
- **선언적 오케스트레이션** — Operator가 YAML 워크플로로 다중 에이전트를 구동
- **하드웨어 1급 시민** — STM32, Arduino, ESP32, Pico, Aardvark I²C/SPI를 에이전트 도구 표면으로 노출
- **18개 라우트의 웹 대시보드** — `http://127.0.0.1:42617`에서 Orchestration / Operations / Inspection 탐색
- **Trust 점수 + ClawHub 마켓플레이스** — 에이전트가 실행을 통해 신뢰도를 쌓고 컨텐츠 어드레서블 레지스트리에서 스킬 공유

---

## 설치 및 온보딩

- [setup-guides/README.md](../../setup-guides/README.md) — 설치 가이드 색인 *(영문)*
- [one-click-bootstrap.md](../../setup-guides/one-click-bootstrap.md) — 단일 명령 설치 *(영문)*
- [kumiho-operator-setup.md](../../setup-guides/kumiho-operator-setup.md) — Kumiho 메모리 사이드카 *(영문)*
- [macos-update-uninstall.md](../../setup-guides/macos-update-uninstall.md) — macOS 라이프사이클 *(영문)*
- [windows-setup.md](../../setup-guides/windows-setup.md) — Windows 설치 *(영문)*
- [dashboard-dev.md](../../setup-guides/dashboard-dev.md) — `web/` 대시보드 로컬 실행 *(영문)*
- [browser-setup.md](../../browser-setup.md) — 브라우저 채널 / VNC 모드 *(영문)*

## 일상 운영

- [commands-reference.md](../../reference/cli/commands-reference.md) — CLI 명령어 색인 *(영문)*
- [config-reference.md](../../reference/api/config-reference.md) — 구성 키, 기본값, 보안 기본값 *(영문)*
- [providers-reference.md](../../reference/api/providers-reference.md) — 프로바이더 ID, 별칭, 환경 변수 *(영문)*
- [channels-reference.md](../../reference/api/channels-reference.md) — 채널 능력 및 설정 *(영문)*
- [reference/sop/observability.md](../../reference/sop/observability.md) — SOP 실행 상태 및 메트릭 *(영문)*

## 통합

- [kumiho-memory-integration.md](../../contributing/kumiho-memory-integration.md) — Kumiho 그래프 네이티브 인지 메모리 통합 패턴 *(영문)*
- [custom-providers.md](../../contributing/custom-providers.md) — 사용자 정의 프로바이더 *(영문)*
- [extension-examples.md](../../contributing/extension-examples.md) — 확장 예제 *(영문)*
- [adding-boards-and-tools.md](../../contributing/adding-boards-and-tools.md) — 보드/도구 추가 *(영문)*

## 운영 및 배포

- [ops/README.md](../../ops/README.md) — 운영 색인 *(영문)*
- [ops/operations-runbook.md](../../ops/operations-runbook.md) — 2일차 런북 *(영문)*
- [ops/troubleshooting.md](../../ops/troubleshooting.md) — 장애 시그니처 및 복구 *(영문)*
- [ops/network-deployment.md](../../ops/network-deployment.md) — 라즈베리 파이 / LAN 배포 *(영문)*
- [ops/proxy-agent-playbook.md](../../ops/proxy-agent-playbook.md) — 프록시 모드 *(영문)*
- [ops/resource-limits.md](../../ops/resource-limits.md) — 리소스 컨트롤 *(영문)*

## 보안

- [security/README.md](../../security/README.md) — 보안 색인 *(영문)*
- [security/agnostic-security.md](../../security/agnostic-security.md) — 프로바이더 무관 보안 모델 *(영문)*
- [security/sandboxing.md](../../security/sandboxing.md) — Seatbelt / Landlock / Firejail / Bubblewrap *(영문)*
- [security/audit-logging.md](../../security/audit-logging.md) — Merkle 체인 감사 로그 *(영문)*
- [security/matrix-e2ee-guide.md](../../security/matrix-e2ee-guide.md) — Matrix E2EE *(영문)*

## 하드웨어 및 주변 장치

- [hardware/README.md](../../hardware/README.md) — 하드웨어 색인 *(영문)*
- [hardware/hardware-peripherals-design.md](../../hardware/hardware-peripherals-design.md) — 주변 장치 아키텍처 *(영문)*
- [hardware/nucleo-setup.md](../../hardware/nucleo-setup.md) — STM32 Nucleo *(영문)*
- [hardware/arduino-uno-q-setup.md](../../hardware/arduino-uno-q-setup.md) — Arduino Uno Q *(영문)*
- [hardware/android-setup.md](../../hardware/android-setup.md) — Android / Termux *(영문)*

## 기여

- [../../../CONTRIBUTING.md](../../../CONTRIBUTING.md) — 최상위 기여자 진입 *(영문)*
- [contributing/README.md](../../contributing/README.md) — 기여자 색인 *(영문)*
- [contributing/pr-workflow.md](../../contributing/pr-workflow.md) — PR 거버넌스 및 리뷰 레인 *(영문)*
- [contributing/reviewer-playbook.md](../../contributing/reviewer-playbook.md) — 리뷰어 가이드 *(영문)*
- [contributing/ci-map.md](../../contributing/ci-map.md) — CI 워크플로 맵 *(영문)*
- [contributing/cla.md](../../contributing/cla.md) — Contributor License Agreement *(영문)*

## 아키텍처 및 참조

- [architecture/adr-004-tool-shared-state-ownership.md](../../architecture/adr-004-tool-shared-state-ownership.md) *(영문)*
- [architecture/adr-005-operator-liveness-and-rust-migration.md](../../architecture/adr-005-operator-liveness-and-rust-migration.md) *(영문)*
- [reference/sop/connectivity.md](../../reference/sop/connectivity.md) *(영문)*
- [reference/sop/observability.md](../../reference/sop/observability.md) *(영문)*

## 라이선스 및 상위 출처

- [`../../../NOTICE`](../../../NOTICE) — 루트 NOTICE (Apache 2.0 §4(c) 상위 ZeroClaw attribution 보존)
- [`../../../LICENSE-MIT`](../../../LICENSE-MIT), [`../../../LICENSE-APACHE`](../../../LICENSE-APACHE) — 듀얼 라이선스 텍스트
- [docs/upstream/zeroclaw-attribution.md](../../upstream/zeroclaw-attribution.md) — Construct가 ZeroClaw로부터 상속한 부분과 fork 준수 체크리스트 *(영문)*
- [docs/maintainers/trademark.md](../../maintainers/trademark.md) — Construct 네이밍 규약 및 ZeroClaw 상표 인정 *(영문)*

## 다른 언어

- [English](../../README.md)
- [Tiếng Việt](../vi/README.md)
- [简体中文](../zh-CN/README.md)
