# Black Ledger

개인용 암호화폐 통합 대시보드. Binance(현물·Funding·USDⓈ-M 선물), Bybit, Bitget, Upbit, Bithumb,
OKX Wallet(멀티체인)을 읽기 전용 API로 모아 원화 기준으로 보여줍니다.

- Next.js 16 (App Router) · Vercel 서울 리전(icn1)
- DB: Turso(libSQL) — 스키마는 `db/schema.ts`, 테이블은 첫 요청 때 자동 생성(`db/bootstrap.ts`)
- 로그인: `DASHBOARD_PASSWORD` 하나로 잠금 (개인용)

## 환경변수 (Vercel → Settings → Environment Variables)

| 이름 | 설명 |
| --- | --- |
| `TURSO_DATABASE_URL` | Turso DB URL (`libsql://…`). Vercel Storage에서 Turso 연결 시 자동 주입 |
| `TURSO_AUTH_TOKEN` | Turso 토큰 (위와 같이 자동 주입) |
| `CREDENTIAL_ENCRYPTION_KEY` | 거래소 API 키 암호화용 32바이트 base64url. 한 번 정하면 바꾸지 말 것 (바꾸면 저장된 연결이 모두 풀림) |
| `DASHBOARD_PASSWORD` | 대시보드 로그인 비밀번호 |
| `AUTH_ORIGIN` | 선택 사항. 실제 접속 도메인이 Vercel의 자동 제공 도메인과 다를 때 `https://dashboard.example.com`처럼 설정 |

로컬 실행은 `.env.local`에 같은 값을 넣고 `npm run dev`.

## 로그인 보안 및 배포

- 로그인마다 256비트 무작위 토큰을 발급합니다. 브라우저에는 `__Host-bl_session` 쿠키만, Turso에는 토큰의 SHA-256 해시만 저장합니다. 세션은 7일 후 만료되며 로그아웃하면 해당 기기의 DB 레코드를 삭제합니다.
- 같은 IP의 15분 내 로그인 시도는 5회, 전체 로그인 시도는 50회까지 허용합니다. 성공하면 해당 IP와 전체 카운터를 초기화합니다. 제한은 15분 내 자동 해제됩니다. Vercel이 설정한 `x-vercel-forwarded-for`만 IP 식별에 사용하므로 Vercel 외의 프로덕션 호스팅에서는 로그인 요청을 거부합니다.
- 상태 변경 API는 Origin을 `AUTH_ORIGIN`, Vercel 배포 도메인(`VERCEL_URL`), 브랜치 미리보기 도메인(`VERCEL_BRANCH_URL`), 프로덕션 도메인과 비교합니다. 커스텀 도메인이 자동 제공 도메인과 다르면 `AUTH_ORIGIN`을 추가하십시오. Vercel의 자동 시스템 환경변수 노출도 켜져 있어야 합니다. `Host`나 `X-Forwarded-Host`를 허용 목록으로 쓰지 않습니다.
- 새 배포 전에 `drizzle/0001_auth_security.sql`의 세 문장을 Turso에 적용하거나, 앱이 첫 요청에서 수행하는 `db/bootstrap.ts`의 자동 생성 권한을 확인하십시오. 먼저 DB 스키마를 생성한 후 새 버전을 배포하는 편이 안전합니다. DB가 준비되지 않으면 로그인과 인증은 거부됩니다.
- 배포 즉시 기존 `bl_session` 쿠키는 더 이상 인정되지 않아 모든 기기에서 재로그인이 필요합니다. 저장된 거래소 연결은 그대로 유지되므로 `CREDENTIAL_ENCRYPTION_KEY`와 거래소 API 키를 변경하거나 재발급할 필요가 없습니다.
- 롤백할 때는 기존 버전의 결정적 세션이 다시 유효해질 수 있습니다. 먼저 `DASHBOARD_PASSWORD`를 새 값으로 변경하여 이전 토큰을 무효화하거나, 인증 수정 버전으로 재배포하십시오. `CREDENTIAL_ENCRYPTION_KEY`는 변경하지 마십시오. 새 테이블은 기존 데이터와 독립적이므로 롤백 중 삭제할 필요가 없습니다.

## 왜 Vercel인가

원래 OpenAI Sites(Cloudflare Workers)에 있었는데, Binance 선물 API(`fapi`, `ws-fapi`)와 Bitget이
Cloudflare 대역의 요청을 WAF에서 거절해 선물 잔고·포지션이 비어 있었습니다. 서울 리전의 Vercel
함수에서는 이 차단이 없어 별도 중계 서버 없이 그대로 조회됩니다. 코드에는 그래도 REST → WebSocket API →
지갑 총액 순의 폴백과, 필요 시 쓸 수 있는 `BINANCE_FUTURES_RELAY_URL` 중계 옵션이 남아 있습니다.

## 테스트

```
npm test
```
Binance 선물 폴백, 서명, 로그인 세션을 네트워크 없이 검증합니다.
