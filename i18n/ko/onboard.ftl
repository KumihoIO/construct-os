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

# ════════════════════════════════════════════════════════════════════
# PHASE 2 — 프로바이더 서브플로우, 하드웨어/프로젝트/터널 상세, 등
# ════════════════════════════════════════════════════════════════════

## ── 2단계: 커스텀 프로바이더 서브플로우 ──────────────────────────

custom-provider-title = 커스텀 프로바이더 설정
custom-provider-subtitle = — OpenAI 호환 API라면 무엇이든
custom-provider-info-1 = OpenAI chat completions 형식을 지원하는 API라면 모두 연결할 수 있습니다.
custom-provider-info-2 = 예: LiteLLM, LocalAI, vLLM, text-generation-webui, LM Studio 등.
custom-provider-confirmed = ✓ 프로바이더: {$provider} | 모델: {$model}

## ── 2단계: 원격 Ollama 서브플로우 ────────────────────────────────

ollama-use-remote = 원격 Ollama 엔드포인트를 사용하시겠습니까? (예: Ollama Cloud)
ollama-remote-url-prompt = 원격 Ollama 엔드포인트 URL
ollama-remote-configured = 원격 엔드포인트 설정됨: {$url}
ollama-normalized-base = 엔드포인트를 베이스 URL로 정규화했습니다 (끝부분의 /api 제거).
ollama-cloud-suffix-hint = 클라우드 전용 모델을 사용하면 모델 ID 뒤에 {$suffix}를 붙이세요.
ollama-remote-key-prompt = 원격 Ollama 엔드포인트 API 키 (없으면 Enter)
ollama-no-key-hint = API 키 미설정. 엔드포인트가 인증을 요구하면 나중에 {$env_var}를 설정하세요.
ollama-using-local = 로컬 Ollama 사용 (http://localhost:11434, API 키 불필요).

## ── 2단계: llama.cpp / SGLang / vLLM / Osaurus 서브플로우 ─────────

llamacpp-url-prompt = llama.cpp 서버 엔드포인트 URL
llamacpp-using = llama.cpp 서버 엔드포인트 사용: {$url}
llamacpp-key-info = llama.cpp 서버를 --api-key로 실행한 경우에만 키가 필요합니다.
llamacpp-key-prompt = llama.cpp 서버 API 키 (없으면 Enter)
local-server-no-key-hint = API 키 미설정. 서버가 인증을 요구할 때만 나중에 {$env_var}를 설정하세요.

sglang-url-prompt = SGLang 서버 엔드포인트 URL
sglang-using = SGLang 서버 엔드포인트 사용: {$url}
sglang-key-info = SGLang 서버가 인증을 요구하는 경우에만 키가 필요합니다.
sglang-key-prompt = SGLang 서버 API 키 (없으면 Enter)

vllm-url-prompt = vLLM 서버 엔드포인트 URL
vllm-using = vLLM 서버 엔드포인트 사용: {$url}
vllm-key-info = vLLM 서버가 인증을 요구하는 경우에만 키가 필요합니다.
vllm-key-prompt = vLLM 서버 API 키 (없으면 Enter)

osaurus-url-prompt = Osaurus 서버 엔드포인트 URL
osaurus-using = Osaurus 서버 엔드포인트 사용: {$url}
osaurus-key-info = Osaurus 서버가 인증을 요구하는 경우에만 키가 필요합니다.
osaurus-key-prompt = Osaurus 서버 API 키 (없으면 Enter)

## ── 2단계: Gemini OAuth + API 키 서브플로우 ──────────────────────

gemini-cli-detected = Gemini CLI 자격증명이 감지되었습니다! API 키를 건너뛸 수 있습니다.
gemini-cli-reuse-info = Construct가 기존 Gemini CLI 인증을 재사용합니다.
gemini-cli-confirm = 기존 Gemini CLI 인증을 사용하시겠습니까?
gemini-cli-using = Gemini CLI OAuth 토큰 사용
gemini-key-url-info = API 키 발급: https://aistudio.google.com/app/apikey
gemini-key-prompt = Gemini API 키를 붙여넣으세요
gemini-env-detected = GEMINI_API_KEY 환경변수가 감지되었습니다!
gemini-cli-fallback-info = 또는 `gemini` CLI를 실행해 인증하면 토큰이 재사용됩니다.
gemini-key-prompt-optional = Gemini API 키를 붙여넣으세요 (없으면 Enter로 건너뛰기)

## ── 2단계: Anthropic OAuth + API 키 서브플로우 ───────────────────

anthropic-oauth-detected = ANTHROPIC_OAUTH_TOKEN 환경변수가 감지되었습니다!
anthropic-key-detected = ANTHROPIC_API_KEY 환경변수가 감지되었습니다!
anthropic-key-url-info = API 키 발급: {$url}
anthropic-setup-token-info = 또는 `claude setup-token`을 실행하면 OAuth setup-token을 받을 수 있습니다.
anthropic-key-prompt = API 키 또는 setup-token을 붙여넣으세요 (없으면 Enter로 건너뛰기)
anthropic-skipped = 건너뜀. 나중에 {$env_oauth} 또는 {$env_key}를 설정하거나 config.toml을 편집하세요.

## ── 2단계: Qwen OAuth 서브플로우 ─────────────────────────────────

qwen-oauth-detected = QWEN_OAUTH_TOKEN 환경변수가 감지되었습니다!
qwen-oauth-creds-info = Qwen Code OAuth 자격증명은 보통 ~/.qwen/oauth_creds.json에 저장됩니다.
qwen-oauth-run-cli = `qwen`을 한 번 실행해 OAuth 로그인을 마치면 캐시된 자격증명이 만들어집니다.
qwen-oauth-token-info = QWEN_OAUTH_TOKEN을 직접 설정해도 됩니다.
qwen-oauth-prompt = Qwen OAuth 토큰을 붙여넣으세요 (없으면 Enter로 캐시된 OAuth 자동 감지)
qwen-oauth-skipped = OAuth 자동 감지를 사용합니다. 필요시 {$env_oauth}와 선택적 {$env_key}를 설정하세요.

## ── 2단계: Bedrock 서브플로우 ────────────────────────────────────

bedrock-info-1 = Bedrock은 단일 API 키가 아니라 AWS 자격증명을 사용합니다.
bedrock-info-2 = {$env_access}와 {$env_secret} 환경변수를 설정하세요.
bedrock-region-info = 선택적으로 리전을 위해 {$env_region}을 설정하세요 (기본: us-east-1).
bedrock-iam-url = IAM 자격증명 관리: {$url}

## ── 2단계: 일반 API 키 서브플로우 ────────────────────────────────

provider-key-url-info = API 키 발급: {$url}
provider-key-config-info = 환경변수나 config 파일을 통해 나중에 설정해도 됩니다.
provider-key-skipped = 건너뜀. 나중에 {$env_var}를 설정하거나 config.toml을 편집하세요.

## ── 2단계: 모델 선택 ──────────────────────────────────────────────

model-needs-key-fallback = 원격 Ollama 라이브 모델 새로고침에는 API 키({$env_var})가 필요합니다. 큐레이션 모델 목록을 사용합니다.
model-cache-found = 캐시된 모델 ({$count}개)을 찾았습니다. {$age} 전에 갱신됨.
model-refresh-prompt = 지금 프로바이더에서 모델을 새로고침하시겠습니까?
model-fetch-prompt = 지금 프로바이더에서 최신 모델을 가져오시겠습니까?
model-fetched-truncated = 모델 {$total}개를 가져왔습니다. 처음 {$shown}개 표시.
model-fetched-all = 라이브 모델 {$count}개를 가져왔습니다.
model-no-models-returned = 프로바이더가 모델을 반환하지 않아 큐레이션 목록을 사용합니다.
model-fetch-failed = 라이브 가져오기 실패 ({$err}). 캐시 또는 큐레이션 목록을 사용합니다.
model-cache-stale = {$age} 전 만료된 캐시를 로드했습니다.
model-no-key-curated = API 키가 감지되지 않아 큐레이션된 모델 목록을 사용합니다.
model-tip-add-key = 팁: API 키를 추가하고 온보딩을 다시 실행하면 라이브 모델을 가져올 수 있습니다.
model-source-prompt = 모델 소스

## ── 5단계: 도구 모드 안내 + Composio 서브플로우 ─────────────────

tool-mode-info-1 = Construct가 외부 앱과 어떻게 연결될지 선택하세요.
tool-mode-info-2 = config.toml에서 언제든 변경할 수 있습니다.
composio-title = Composio 설정
composio-subtitle = — 1000개 이상의 OAuth 통합 (Gmail, Notion, GitHub, Slack 등)
composio-key-url = API 키 발급: https://app.composio.dev/settings
composio-info = Construct는 Composio를 도구로 사용합니다 — 핵심 에이전트는 로컬에 유지됩니다.
composio-key-prompt = Composio API 키 (없으면 Enter)
composio-skipped = 건너뜀 — 나중에 config.toml에서 composio.api_key를 설정하세요
composio-confirmed = Composio: {$value} (1000개 이상의 OAuth 도구 사용 가능)

secrets-info-1 = Construct는 config.toml에 저장된 API 키를 암호화할 수 있습니다.
secrets-info-2 = 로컬 키 파일이 평문 노출과 우발적 유출을 막습니다.
secrets-status-encrypted = 시크릿: {$value} — 로컬 키 파일로 암호화됨
secrets-status-plaintext = 시크릿: {$value} — 평문으로 저장됨 (권장하지 않음)

## ── 6단계: 하드웨어 설정 상세 ────────────────────────────────────

hardware-info-1 = Construct는 물리 하드웨어(LED, 센서, 모터 등)와 통신할 수 있습니다.
hardware-scanning = 연결된 장치 검색 중...
hardware-no-devices = 연결된 장치가 감지되지 않았습니다.
hardware-enable-later = config.toml의 [hardware] 섹션에서 나중에 활성화할 수 있습니다.
hardware-devices-found = {$count}개 장치 발견:

hardware-mode-native = 🚀 네이티브 — 이 Linux 보드의 GPIO 직접 제어 (Raspberry Pi, Orange Pi 등)
hardware-mode-tethered = 🔌 테더드 — USB로 연결된 Arduino/ESP32/Nucleo 제어
hardware-mode-debug-probe = 🔬 디버그 프로브 — SWD/JTAG로 MCU 플래시/읽기 (probe-rs)
hardware-mode-software = ☁️  소프트웨어 전용 — 하드웨어 접근 없음 (기본)

hardware-multiple-serial = 시리얼 장치가 여러 개 발견되었습니다 — 하나를 선택하세요
hardware-serial-port-prompt = 시리얼 포트 경로 (예: /dev/ttyUSB0)
hardware-baud-rate-prompt = 시리얼 baud rate
hardware-baud-default = 115200 (기본, 권장)
hardware-baud-legacy = 9600 (구형 Arduino)
hardware-baud-custom = 직접 입력
hardware-baud-custom-prompt = 커스텀 baud rate
hardware-mcu-prompt = 대상 MCU 칩 (예: STM32F411CEUx, nRF52840_xxAA)
hardware-rag-prompt = 데이터시트 RAG를 활성화할까요? (PDF 회로도를 색인하여 AI가 핀 정보를 조회)
hardware-status-with-rag = 하드웨어: {$mode} | 데이터시트: {$rag}
hardware-status = 하드웨어: {$mode}

## ── 8단계: 프로젝트 컨텍스트 상세 ───────────────────────────────

ctx-info-personalize = 에이전트를 개인화해봅시다. 언제든 나중에 변경할 수 있습니다.
ctx-info-defaults = Enter를 눌러 기본값을 사용할 수 있습니다.

ctx-tz-us-eastern = 미국 동부 (America/New_York)
ctx-tz-us-central = 미국 중부 (America/Chicago)
ctx-tz-us-mountain = 미국 산악 (America/Denver)
ctx-tz-us-pacific = 미국 태평양 (America/Los_Angeles)
ctx-tz-eu-london = 유럽/런던
ctx-tz-eu-berlin = 유럽/베를린
ctx-tz-asia-tokyo = 아시아/도쿄
ctx-tz-utc = UTC
ctx-tz-other = 기타 (직접 입력)

ctx-style-direct = 직접적 — 간결하고 군더더기 없음
ctx-style-friendly = 친근함 — 따뜻하고 대화적
ctx-style-professional = 전문적 — 격식 있고 정확함
ctx-style-expressive = 표현적 — 다채롭고 의견을 가짐
ctx-style-technical = 기술적 — 엔지니어 대 엔지니어, 코드 중심
ctx-style-balanced = 균형 — 중간 톤
ctx-style-custom = 커스텀 — 직접 묘사

## ── 4단계: 터널 설정 상세 ───────────────────────────────────────

tunnel-info-1 = 터널은 게이트웨이를 안전하게 인터넷에 노출시킵니다.
tunnel-info-2 = CLI나 로컬 채널만 사용한다면 건너뛰어도 됩니다.
tunnel-option-skip = 건너뛰기 — 로컬 전용 (기본)
tunnel-option-cloudflare = Cloudflare Tunnel — Zero Trust, 무료 티어
tunnel-option-tailscale = Tailscale — 프라이빗 tailnet 또는 공개 Funnel
tunnel-option-ngrok = ngrok — 즉시 공개 URL 발급
tunnel-option-custom = 커스텀 — 직접 가져오기 (bore, frp, ssh 등)

cloudflare-token-info = Cloudflare Zero Trust 대시보드에서 터널 토큰을 발급받으세요.
cloudflare-token-prompt = Cloudflare 터널 토큰

tailscale-info = Tailscale이 설치되고 인증되어 있어야 합니다 (tailscale up).
tailscale-funnel-prompt = Funnel(공개 인터넷)을 사용할까요? 아니오 = tailnet만 사용

ngrok-token-info = 인증 토큰 발급: https://dashboard.ngrok.com/get-started/your-authtoken
ngrok-token-prompt = ngrok 인증 토큰
ngrok-domain-prompt = 커스텀 도메인 (선택, 없으면 Enter로 건너뛰기)

custom-tunnel-info-1 = 터널을 시작할 명령어를 입력하세요.
custom-tunnel-info-2 = {"{port}"}와 {"{host}"}를 자리표시자로 사용하세요.
custom-tunnel-info-3 = 예: bore local {"{port}"} --to bore.pub
custom-tunnel-cmd-prompt = 시작 명령어

## ── 마무리 "다음 단계" 액션 항목 ────────────────────────────────
# 인증 모델별 세 가지 — 키 없는 로컬 서버, OAuth/디바이스 플로우 프로바이더,
# 환경변수 API 키가 필요한 프로바이더.

next-action-chat = 대화:
next-action-gateway = 게이트웨이:
next-action-status = 상태:
next-action-login = 로그인:
next-action-set-key = API 키 설정:
next-action-or-edit = 또는 편집:

next-cmd-chat-hello = construct agent -m "Hello!"
next-cmd-gateway = construct gateway
next-cmd-status = construct status
next-cmd-login = construct auth login --provider {$provider}
next-cmd-export-key = export {$env_var}="sk-..."
next-cmd-config-toml = ~/.construct/config.toml

## ── 9단계: 내장 워크플로 스캐폴딩 ──────────────────────────────

workflows-available = 내장 워크플로 {$count}개 사용 가능
workflows-destination = 대상 경로: {$path}
workflows-wrote = 새 파일 {$count}개 작성됨
workflows-overwrote = 파일 {$count}개 덮어쓰기됨
workflows-skipped = 기존 파일 {$count}개 건너뜀 (덮어쓰려면 --force 사용)
workflows-summary = 내장 워크플로 {$count}개
