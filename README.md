# Kiricast — AI 음성 드라마 서비스

캐릭터와 이야기 아이디어를 바탕으로 시리즈를 설계하고, 대본·음성·다음 에피소드를 이어서 만드는 웹 서비스입니다. 한 편의 생성 결과만 다루는 대신, 시리즈 문서와 캐릭터 상태를 다음 생성 과정에 전달하는 구조를 담고 있습니다.

- 개발 기간: **6개월**
- 기술: Next.js 16 · React 19 · TypeScript · Python/FastAPI · Supabase · Cloudflare R2 · FFmpeg
- 상태: **2026-03-06 소스의 독립 보관 스냅샷**. 현재 운영 버전이나 완전한 배포 템플릿이 아닙니다.
- 이 저장소는 비공개 정리본입니다. 원본 Git 이력, 실제 환경변수, 사용자 데이터, 생성 미디어는 포함하지 않습니다.

## 서비스 흐름

1. 캐릭터를 선택하거나 생성하고 이야기 아이디어를 입력합니다.
2. 시리즈 문서와 아크 문서를 생성·수정한 뒤 잠급니다.
3. 시나리오와 대본을 생성하고 캐릭터별 음성 및 효과음을 합성합니다.
4. 에피소드 요약·롤링 요약·핵심 기억·캐릭터 상태를 갱신합니다.
5. 다음 화의 방향을 선택해 연재를 이어 갑니다.

클립 재생·자막, 캐릭터 구독, 좋아요, 크레딧과 결제 연결 코드도 포함돼 있습니다. 이러한 주변 기능은 별도 외부 서비스 설정과 데이터베이스 준비가 필요합니다.

## 구조

```text
사용자 → Next.js 페이지 / API → Supabase Auth·DB
                   │                │ 작업 큐
                   │                ▼
                   └────────── Node.js worker
                                    │
                                    ▼
                              FastAPI Generator
                                    │
                 Anthropic / OpenAI / ElevenLabs / FFmpeg
                                    │
                              MP3 · 자막 · 영상
                                    │
                              R2 → 클립 재생
```

### 연재 맥락 관리

`podcast_maker.py`는 시리즈·아크 문서, 최근 에피소드 맥락, 500자 이내 롤링 요약, 핵심 기억을 조합합니다. `core_memory`에는 주요 사건·공개된 비밀·관계·미해결 실마리·복선을 유지하는 코드가 있습니다. 캐릭터 상태 변화량을 제한하는 코드와 에피소드 유형 선택 로직도 포함돼 있습니다.

이 구조는 연재 중 설정과 감정 변화의 일관성을 다루기 위한 구현입니다. **장기 연재 품질이나 50화 일관성을 실측해 입증한 결과는 이 저장소에 포함하지 않습니다.**

### 비동기 생성

`web/scripts/worker.mjs`가 생성 작업을 가져와 Generator를 호출하고, 결과를 R2에 저장한 뒤 작업 상태와 클립 정보를 갱신합니다. 일반 생성 작업과 대본 생성 작업의 처리 경로, 오래된 처리 작업의 재큐잉, 실패 시 크레딧 반환 연결이 있습니다. 이 스냅샷의 동시 실행 안전성·실서비스 부하 성능은 별도 검증 대상입니다.

### 음성 제작

대사·내레이션·효과음을 처리하고 FFmpeg로 오디오를 합성합니다. `TTS_PROVIDER`로 ElevenLabs 또는 OpenAI 경로를 선택할 수 있습니다. 음성 ID는 각 계정에서 사용할 수 있는 값을 지정해야 합니다. 이미지 생성 경로에는 OpenAI 및 Gemini 연결 코드가 있습니다.

## 소스 안내

| 경로 | 내용 |
|---|---|
| `web/src/app/series/`, `web/src/app/api/series/` | 시리즈 생성·편집·잠금·다음 화 흐름 |
| `web/src/app/clips/` | 클립 피드·재생·자막 |
| `web/scripts/worker.mjs` | 작업 큐와 Generator·R2 연결 |
| `local_server.py` | 생성 작업용 FastAPI API |
| `podcast_maker.py` | 문서·시나리오·대본·메모리·음성 생성 |
| `web/sql/` | 당시 관리되던 증분 SQL 자료 |
| `agents.json` | 예제 캐릭터 설정 |
| `web/.env.example` | 자격증명을 포함하지 않는 설정 예시 |

## 실행 준비와 재현 한계

**빈 데이터베이스에서 전체 서비스를 바로 시작할 수 있는 상태는 아닙니다.** 당시 소스에 `agents`, `clips`, `jobs`, `credit_wallets`, `credit_ledger` 등의 기본 생성문과 일부 RPC 정의가 모두 보관되어 있지 않습니다. `web/sql/*.sql`은 완전한 초기 스키마나 실행 순서가 보장된 마이그레이션 묶음이 아닙니다. 기존 인스턴스와 분리된 개발용 DB에 기본 스키마·RPC·RLS를 복원하고 의존 순서를 검토한 뒤 사용해야 합니다. 이 정리 작업에서는 데이터베이스를 추측해 생성하거나 운영 DB에 SQL을 실행하지 않았습니다.

준비물:

- Node.js 20.9 이상과 npm, Python 3.12 권장
- FFmpeg/ffprobe 실행 파일
- 개발용 Supabase 프로젝트 및 복원한 스키마
- R2 버킷과 서버 전용 자격증명
- 사용할 생성 서비스의 API 키
- 영상 자막·로고를 출력한다면 적법하게 취득한 Noto Sans KR와 Poppins 폰트

기존 폰트 바이너리는 스냅샷에 라이선스 파일이 동봉되지 않아 제외했습니다. 직접 확인한 라이선스와 함께 `fonts/`에 설치하거나 `podcast_maker.py`가 탐색하는 시스템 폰트 위치에 설치하세요. 폰트가 없으면 대체 글꼴이 사용되며 출력이 달라질 수 있습니다. 웹의 `next/font/google`은 빌드할 때 Google Fonts 접근이 필요합니다.

### 1. 환경 설정

```powershell
Copy-Item web/.env.example web/.env.local
```

빈 키를 개발용 값으로 채우세요. Next.js·worker·Generator 모두 `web/.env.local`을 읽는 구조입니다. `NEXT_PUBLIC_*`에는 서버 전용 비밀키를 넣지 마세요. `SUPABASE_SECRET_KEY`, AI API 키, R2 비밀키는 서버 전용입니다.

### 2. 프런트엔드

```powershell
cd web
npm ci
npm run dev
```

프런트엔드 주소는 `http://localhost:3000`입니다. DB가 준비되지 않으면 인증·조회·생성 기능은 동작하지 않습니다.

### 3. Generator — 저장소 루트의 별도 터미널

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn local_server:app --host 127.0.0.1 --port 8787
```

macOS/Linux에서는 `python3`와 `.venv/bin/python`을 사용합니다. Generator는 인증이 완비된 공개 API 서버로 검증하지 않았으므로 로컬 주소 또는 접근이 통제된 내부 네트워크에서 사용하세요.

### 4. Worker — 스키마와 저장소 준비 후 별도 터미널

```powershell
cd web
npm run worker:run
```

예시 설정은 `JOB_SOURCE=development`, 폴링 모드입니다. 운영 DB·버킷 자격증명을 복사하지 말고 분리된 개발 자원을 사용하세요. 생성 버튼이나 worker 실행은 실제 API 호출과 DB·스토리지 쓰기를 일으킬 수 있습니다.

## 외부 서비스와 비용

OpenAI·Anthropic·ElevenLabs·Gemini 생성 요청, R2 저장·전송, 선택적 Cloudflare Stream·Supabase·Resend 사용에는 서비스별 요금과 제한이 적용됩니다. 가격과 모델 이용 가능 여부는 각 공급자에서 확인해야 합니다. 결제 경로는 PayPal sandbox 설정부터 준비하며, 이 정리본으로 실제 결제를 검증하지 않았습니다. 약관·개인정보 페이지와 요금 문구는 당시 구현 자료이므로 실제 서비스 정책으로 그대로 사용하지 마세요.

## 검증 범위

정리 과정의 정적 검증과 빌드 결과는 `VALIDATION.md`에 기록합니다. API 키 없는 타입·문법 검증과 실제 음성 생성·결제·배포 성공은 구분합니다. 성능 수치, 유료 사용자 수, 개인별 기여율은 소스로 확정할 수 없어 기재하지 않았습니다.

재배포 전에는 기존 권한 검사를 검토해야 합니다. 예를 들어 `web/src/app/api/series/[id]/lock/route.ts`는 로그인 여부를 검사하지만 시리즈 소유자와 요청자를 비교하지 않는 상태로 보관되어 있습니다. 이 스냅샷을 인터넷에 그대로 배포하지 마세요.

## 권리와 배포

별도 오픈소스 라이선스를 임의로 부여하지 않았습니다. 의존 패키지는 각각의 라이선스를 따릅니다. 로고·캐릭터 설정·정책 문구 및 향후 추가할 음성·이미지·폰트의 이용·재배포 권한은 별도로 확인해야 합니다.
