# 소스 스냅샷 검증 기록

확인일: 2026-10-11. 실제 자격증명이나 운영 DB를 사용하지 않은 검증입니다.

| 확인 | 결과 |
|---|---|
| Python `ast.parse` | `local_server.py`, `podcast_maker.py` 문법 통과. 모듈 실행·API 호출 없음 |
| `npm ci --ignore-scripts --no-audit --no-fund` | 잠금 파일 기준 568개 패키지 설치 성공 |
| `npx tsc --noEmit` | 통과 |
| `node --check scripts/worker.mjs` | 통과 |
| `npm run build` | Next.js webpack 프로덕션 빌드 완료, 정적 생성 단계 73/73 완료 |
| 비밀정보 패턴 확인 | 추출한 소스에서 하드코딩 API 토큰·JWT·private key·credential literal 패턴 발견 없음 |

Google Fonts 다운로드가 포함되는 빌드이며 음성·이미지 생성 API를 호출하지 않았습니다. edge runtime 페이지의 정적 생성 비활성 안내는 빌드 오류가 아닙니다. npm 설치 시 오래된 하위 의존성의 deprecated 경고가 있었고, 보안 취약점 감사 및 의존성 업그레이드는 수행하지 않았습니다.

## 검증하지 않은 범위

- Python 의존성 설치 및 Generator 실제 실행
- 전체 DB 초기화, 증분 SQL 실행, RLS·RPC 동작
- 회원가입·결제·생성·재생의 end-to-end 실행
- 다중 worker 동시성, 재시도 중복, 크레딧 정합성
- 외부 API 모델·음성 가용성, 출력 품질과 장기 연재 일관성
- 실서비스 배포, 부하·지연시간·비용 측정

[개발 가이드](docs/DEVELOPMENT.md)의 스키마 누락과 기존 권한 검사 제한을 먼저 확인해야 합니다. 빌드 성공은 이 범위의 검증을 대신하지 않습니다.
