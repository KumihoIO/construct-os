# Construct onboard 마법사 — 한국어 번역.
#
# 키 이름은 i18n/en/onboard.ftl 영문 원본과 동일합니다. {$name} 자리표시자도
# 그대로 두세요. 영문에 키가 추가되면 이 파일에도 추가해야 합니다 — 누락 키는
# 자동으로 영문으로 폴백되어 사용자에게 영어 문장이 섞여 보일 수 있습니다.
#
# 톤 가이드:
# - 본문은 -ㅂ니다체로, 안내문은 짧고 직접적으로.
# - "Construct"는 영문 그대로 (제품명).
# - "에이전트", "워크스페이스", "프로바이더" 같은 용어는 한국어 IT 업계
#   표기를 따름. 외래어가 더 자연스러우면 그대로 사용.
# - 명령어/경로/URL/ENV 변수명은 절대 번역하지 마세요.

## ── 배너 / 환영 메시지 ──────────────────────────────────────────

welcome-title = Construct에 오신 것을 환영합니다.
welcome-subtitle = 이 마법사가 60초 안에 에이전트 설정을 끝냅니다.

## ── 언어 선택 (Step 0) ─────────────────────────────────────────

step-language-prompt = Select your language / 언어를 선택하세요
step-language-saved = 언어를 {$lang}(으)로 설정했습니다.

## ── 단계 헤더 ───────────────────────────────────────────────────

step-header = {$total}단계 중 {$num}단계: {$title}

step-1-title = 워크스페이스 설정
step-2-title = AI 프로바이더 및 API 키
step-3-title = 채널 (Construct와의 대화 통로)
step-4-title = 터널 (외부 노출)
step-5-title = 도구 모드 및 보안
step-6-title = 하드웨어 (물리 세계 연결)
step-7-title = 메모리 구성
step-8-title = 프로젝트 컨텍스트 (에이전트 개인화)
step-9-title = 워크스페이스 파일

## ── 1단계: 워크스페이스 ────────────────────────────────────────

workspace-default-location = 기본 위치: {$path}
workspace-use-default = 기본 워크스페이스 위치를 사용할까요?
workspace-enter-path = 워크스페이스 경로를 입력하세요
workspace-confirmed = ✓ 워크스페이스: {$path}

## ── 2단계: 프로바이더 ──────────────────────────────────────────

provider-select-tier = 프로바이더 카테고리를 선택하세요
provider-tier-recommended = 추천 (Anthropic, OpenAI, Google) — 일반 사용에 가장 안정적
provider-tier-fast = 빠른 / 저비용 (Groq, Cerebras, OpenRouter) — 응답 속도와 비용 우선
provider-tier-gateway = 게이트웨이 / 멀티 프로바이더 (OpenRouter, LiteLLM) — 한 키로 여러 모델
provider-tier-specialized = 전문 (Cohere, Mistral, Together) — 특정 영역 강점
provider-tier-local = 로컬 (Ollama, llama.cpp, LM Studio, vLLM, SGLang) — 인터넷 없이 자체 호스팅
provider-tier-custom = 커스텀 (OpenAI 호환 엔드포인트) — 직접 운영하는 API

provider-select = AI 프로바이더를 선택하세요
provider-api-key-prompt = API 키를 붙여넣으세요 (없으면 Enter로 건너뛰기)
provider-api-base-prompt = API 엔드포인트 URL (예: http://localhost:1234 — Construct가 LLM 요청을 보낼 주소)
provider-api-key-optional = API 키 (필요 없으면 Enter)
provider-model-name = 모델 이름 (예: llama3, gpt-4o, mistral)
provider-select-model = 기본 모델을 선택하세요
provider-enter-custom-model = 커스텀 모델 ID를 입력하세요

## ── 3단계: 채널 ─────────────────────────────────────────────────

channels-prompt = 연결할 채널을 선택하세요 (완료하려면 Done)

## ── 4단계: 터널 ─────────────────────────────────────────────────

tunnel-select = 터널 프로바이더를 선택하세요

## ── 5단계: 도구 모드 및 시크릿 ─────────────────────────────────

tool-mode-select = 도구 모드를 선택하세요
secrets-encrypt = 암호화된 시크릿 저장소를 사용할까요? (API 키를 평문 대신 암호화해 저장)

## ── 6단계: 하드웨어 ────────────────────────────────────────────

hardware-prompt = Construct가 어떻게 물리 세계와 상호작용할까요? (시리얼 장치, 없음 등)

## ── 7단계: 메모리 ──────────────────────────────────────────────

memory-select = 메모리 백엔드를 선택하세요
memory-kumiho-api-url = Kumiho API URL (기본값을 그대로 두면 api.kumiho.cloud)
memory-kumiho-token = Kumiho 서비스 토큰 (KUMIHO_SERVICE_TOKEN — 대시보드 → Service Tokens에서 발급)
memory-auto-save = 대화를 메모리에 자동 저장할까요?

dreamstate-prompt = 야간 DreamState 메모리 통합을 설정할까요? (권장 — 매일 밤 자동으로 메모리를 정리·연결합니다)
dreamstate-time-prompt = DreamState를 몇 시에 실행할까요?
dreamstate-cron-created = ✓ DreamState 크론 작업 등록 완료 (스케줄: {$time}, 다음 실행: {$next})
dreamstate-cron-failed = DreamState 크론 작업 등록에 실패했습니다: {$err}

## ── 8단계: 프로젝트 컨텍스트 ───────────────────────────────────

ctx-your-name = 사용자 이름
ctx-timezone = 타임존
ctx-timezone-enter = 타임존을 입력하세요 (예: Asia/Seoul)
ctx-agent-name = 에이전트 이름
ctx-comm-style = 커뮤니케이션 스타일
ctx-comm-style-custom = 커스텀 커뮤니케이션 스타일

## ── 기존 설정 처리 ────────────────────────────────────────────

existing-config-found = {$path}에 기존 설정이 있습니다. 진행 모드를 선택하세요
existing-config-detected-force = ! {$path}에 기존 설정이 감지되었습니다. --force 플래그로 강제 진행합니다.
existing-config-overwrite-prompt = {$path}에 기존 설정이 있습니다. 다시 온보딩하면 config.toml을 덮어씁니다. 계속할까요?

setup-mode-full = 전체 온보딩 (config.toml 덮어쓰기)
setup-mode-update-provider = AI 프로바이더 / 모델 / API 키만 업데이트
setup-mode-cancel = 취소

## ── --reinit 플로우 ────────────────────────────────────────────

reinit-banner = ⚠️  Construct 설정을 초기화합니다...
reinit-current-dir = 현재 설정 디렉토리: {$path}
reinit-backup-target = 기존 설정을 다음 위치에 백업합니다: {$path}
reinit-confirm = 계속할까요? [y/N]
reinit-aborted = 중단되었습니다.
reinit-backup-ok = 백업이 정상적으로 생성되었습니다.
reinit-fresh-start = 새 설정으로 초기화를 시작합니다...

## ── 마무리 "다음 단계" 블록 ────────────────────────────────────

next-steps-header = 다음 단계:
next-step-chat = 에이전트와 대화 시작:
next-step-chat-cmd = construct agent
next-step-gateway = 게이트웨이 실행 (채널, 대시보드):
next-step-gateway-cmd = construct gateway start
next-step-status = 상태 확인:
next-step-status-cmd = construct status
next-step-pairing-enabled = 페어링이 활성화되었습니다. 게이트웨이가 시작되면 일회성 페어링 코드가 표시됩니다.
next-step-dashboard = 대시보드: http://127.0.0.1:{$port}

## ── 에러 / 기타 ────────────────────────────────────────────────

err-no-command = 명령어가 입력되지 않았습니다.
err-try-onboard = 워크스페이스를 초기화하려면 `construct onboard`를 실행하세요.
