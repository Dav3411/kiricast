# Kiricast 개발 가이드

[README로 돌아가기](../README.md)

## 저장소 범위

2026-03-06 소스를 독립 저장소로 정리한 개발 자료입니다. 현재 운영 버전이나 완전한 배포 템플릿은 아닙니다. 원본 Git 이력, 실제 환경 변수, 사용자 데이터와 생성 미디어는 포함하지 않습니다.

웹, Worker, Generator는 각각 실행하는 프로세스입니다. 웹 화면만 실행해도 전체 생성 기능이 준비되는 것은 아닙니다. 인증·DB·작업 큐·미디어 저장소와 사용할 외부 API를 함께 설정해야 합니다.

## 데이터베이스 준비

`web/sql/`은 당시 관리되던 증분 SQL 자료입니다. 빈 DB에서 실행할 수 있는 완전한 초기 스키마나 실행 순서가 보장된 마이그레이션 묶음이 아닙니다.

- `agents`, `clips`, `jobs`, `credit_wallets`, `credit_ledger` 등의 기본 생성문이 모두 보관되어 있지 않습니다.
- 소스가 참조하는 일부 RPC 정의도 누락되어 있습니다.
- 기본 스키마, RPC, RLS를 복원하고 증분 SQL의 의존 순서를 검토해야 합니다.
- 운영 인스턴스와 분리된 개발용 Supabase 프로젝트에서 준비하세요. SQL 파일을 이름순으로 일괄 실행하는 방식은 권장하지 않습니다.

이 저장소 정리 과정에서는 스키마를 추측해 생성하거나 운영 DB에 SQL을 실행하지 않았습니다. DB가 준비되지 않은 상태에서는 회원가입·조회·생성 흐름을 사용할 수 없습니다.

### 외부 배포 전 확인

기존 권한 검사를 보완해야 합니다. [`web/src/app/api/series/[id]/lock/route.ts`](../web/src/app/api/series/%5Bid%5D/lock/route.ts)는 로그인 여부를 검사하지만, 시리즈 소유자와 요청자를 비교하지 않습니다. 이 제한이 남아 있는 상태로 인터넷에 배포하지 마세요.

Generator 역시 인증이 완비된 공개 API 서버로 검증되지 않았습니다. README의 명령은 `127.0.0.1`에 바인딩합니다. 로컬 주소 또는 접근이 통제된 내부 네트워크에서 사용하세요.

## 환경 변수

[`web/.env.example`](../web/.env.example)을 `web/.env.local`로 복사한 뒤 개발용 값을 입력합니다. Next.js, Worker, Generator가 모두 이 파일을 읽습니다. Generator는 파일이 있으면 일부 기존 환경 변수도 파일 값으로 덮어씁니다.

| 용도 | 주요 변수 |
| --- | --- |
| Supabase 클라이언트 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Supabase 서버 | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY` |
| 웹·Generator 주소 | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `GENERATOR_BASE_URL` |
| 이야기·이미지 생성 | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `IMAGE_PROVIDER`, `GEMINI_API_KEY` |
| 음성 합성 | `TTS_PROVIDER`, `ELEVENLABS_API_KEY`, 음성 ID 관련 변수 |
| 미디어 저장 | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Worker | `JOB_SOURCE`, `WORKER_POLLING_MODE`, `WORKER_HTTP_PORT` |
| FFmpeg 경로 | `FFMPEG_BIN` |

- `NEXT_PUBLIC_*`는 클라이언트에 노출될 수 있습니다. Supabase 서버 키, AI API 키, R2 비밀키를 넣지 마세요.
- 예시 설정의 `JOB_SOURCE=development`, 폴링 모드를 개발 환경에 맞게 유지하세요.
- `TTS_PROVIDER`는 ElevenLabs 또는 OpenAI 경로를 선택합니다. ElevenLabs 음성 ID는 본인 계정에서 사용할 수 있는 값으로 지정하세요.
- 이메일, Stream, 결제, 관리자 기능의 설정은 필요한 기능을 사용할 때 별도로 준비합니다. 비워 둔 연동 항목은 해당 기능을 사용할 수 없다는 뜻입니다.
- 운영 DB와 버킷 자격증명을 복사하지 말고 분리된 개발 자원을 사용하세요.

## Windows PowerShell

저장소 루트에서 환경 파일을 준비합니다.

```powershell
Copy-Item web/.env.example web/.env.local
```

환경 변수와 DB를 준비한 뒤 웹을 실행합니다.

```powershell
Set-Location web
npm ci
npm run dev
```

저장소 루트의 별도 터미널에서 Generator를 실행합니다. 아래 명령은 Python 3.12와 Windows Python Launcher가 설치된 환경을 기준으로 합니다.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn local_server:app --host 127.0.0.1 --port 8787
```

DB와 R2가 준비되면 저장소 루트의 또 다른 터미널에서 Worker를 실행합니다.

```powershell
Set-Location web
npm run worker:run
```

Python 의존성 설치와 Generator의 실제 실행은 기존 검증 기록에 포함되지 않습니다. 현재 환경에서 설치 결과와 API 공급자의 SDK 호환성을 확인해야 합니다.

## FFmpeg와 폰트

`ffmpeg`와 `ffprobe`를 PATH에서 찾을 수 있게 설치하거나 두 실행 파일이 있는 디렉터리를 `FFMPEG_BIN`으로 지정합니다.

영상 자막·로고 출력에는 Noto Sans KR와 Poppins를 사용합니다. 기존 폰트 바이너리는 동봉된 라이선스 파일이 없어 이 저장소에서 제외했습니다. 사용할 폰트를 해당 라이선스와 함께 `fonts/` 또는 `podcast_maker.py`가 탐색하는 시스템 폰트 위치에 설치하세요. 폰트가 없으면 대체 글꼴을 사용하며 출력이 달라질 수 있습니다.

웹의 `next/font/google`은 빌드 시 Google Fonts에 접근합니다. 네트워크가 제한된 환경에서는 빌드 결과가 달라질 수 있습니다.

## 생성 엔진 구현 범위

- 시나리오 단계는 롤링 요약을 우선 사용하며, 없을 때 최근 3개 에피소드 요약으로 대체합니다.
- 500자 제한은 롤링 요약에 적용됩니다. 대본 생성 단계는 전달받은 에피소드 요약들을 사용하므로 전체 생성 입력이 항상 500자로 제한되는 구조는 아닙니다.
- FSM은 시나리오가 제안한 상태 변화량을 적용합니다. 변화량은 ±1, 상태 값은 1~5로 제한합니다.
- `validate_scenario` 함수는 존재하지만 `generate_and_validate_scenario`의 실행 경로에서 호출되지 않습니다. 현재 경로는 생성 후 코드 기반 제약을 적용하며, 별도 LLM의 평가·재생성 루프가 활성화된 구조는 아닙니다.
- 장기 연재 일관성, 입력 토큰 감소율, 생성 품질의 정량 측정 결과는 포함하지 않습니다.

## 외부 서비스와 비용

생성 버튼이나 Worker 실행은 실제 API 호출과 DB·스토리지 쓰기를 일으킬 수 있습니다. OpenAI, Anthropic, ElevenLabs, Gemini, R2 및 선택적 Supabase, Cloudflare Stream, Resend에는 공급자별 요금과 제한이 적용됩니다. 모델·음성 가용성과 요금은 각 공급자에서 확인하세요.

결제 연동은 PayPal sandbox부터 준비합니다. 이 저장소 정리 과정에서는 실제 결제를 검증하지 않았습니다. 약관·개인정보 페이지와 요금 문구는 당시 구현 자료이므로 운영 정책으로 그대로 사용하지 마세요.

## 검증

2026-10-11에 수행한 타입·문법 검사 및 웹 빌드 결과는 [VALIDATION.md](../VALIDATION.md)에 있습니다. 해당 기록은 외부 API를 호출하거나 운영 DB를 사용하지 않은 결과입니다.

다음 항목은 별도로 확인해야 합니다.

- Python 의존성 설치와 Generator 실행
- 전체 DB 초기화, RLS·RPC 및 권한 검사
- 회원가입·결제·생성·재생의 전체 실행 흐름
- 다중 Worker 동시성, 재시도 중복과 크레딧 정합성
- 외부 모델·음성 가용성 및 장기 연재 품질
- 배포, 부하, 지연시간과 비용

## 라이선스와 미디어

이 저장소에는 별도 오픈소스 라이선스를 부여하지 않았습니다. 의존 패키지는 각각의 라이선스를 따릅니다. 로고, 캐릭터 설정, 정책 문구 및 별도로 추가하는 음성·이미지·폰트의 이용·재배포 권한도 확인해야 합니다.
