# Black Ledger

개인용 암호화폐 통합 대시보드. Binance(현물·Funding·USDⓈ-M 선물), Bybit, Bitget, Upbit, Bithumb,
OKX Wallet(멀티체인), Ondo Perps(현물·선물), Entropy(io 선물)를 읽기 전용 API로 모아 원화 기준으로 보여줍니다.

Entropy 연결은 거래에 사용한 EVM 지갑 공개 주소만 필요합니다. Hyperliquid Info API에서 `dex: "io"`의 선물 포지션과 계정 상태를 조회합니다. 표준 계정은 io DEX의 계정 평가액을 합산합니다. 통합 계정과 포트폴리오 마진은 공유 USDC 잔고를 한 번 합산하고 Entropy 포지션의 미실현 손익을 반영합니다. 공유 담보가 다른 Hyperliquid DEX의 거래에도 쓰일 수 있으므로 계정 평가액에는 Hyperliquid 전체 USDC가 포함됩니다.

Ondo Perps 연결은 해당 EVM 지갑으로 발급한 `View` 전용 API Key ID와 API Secret, 지갑 공개 주소를 사용합니다. Ondo의 Spot `total` 잔고(예약 수량 포함)와 Perps 계정 평가액·열린 포지션을 조회합니다. API 키의 계정 주소가 입력 주소와 다르면 연결을 저장하지 않습니다. OAI 등 현물 자산의 `usdValue`가 없을 때는 Ondo 현물 티커를 사용하며, 가격도 없으면 잔고 수량을 남기고 평가액 경고를 표시합니다.

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

`.env.example` 참고. 로컬 실행은 `.env.local`에 같은 값을 넣고 `npm run dev`.

## 왜 Vercel인가

원래 OpenAI Sites(Cloudflare Workers)에 있었는데, Binance 선물 API(`fapi`, `ws-fapi`)와 Bitget이
Cloudflare 대역의 요청을 WAF에서 거절해 선물 잔고·포지션이 비어 있었습니다. 서울 리전의 Vercel
함수에서는 이 차단이 없어 별도 중계 서버 없이 그대로 조회됩니다. 코드에는 그래도 REST → WebSocket API →
지갑 총액 순의 폴백과, 필요 시 쓸 수 있는 `BINANCE_FUTURES_RELAY_URL` 중계 옵션이 남아 있습니다.

## 테스트

Bitget은 `/api/v3/account/assets`로 통합 계정 자산을 조회하고,
`/api/v3/position/current-position`의 USDT·USDC 선물을 읽습니다.
UTA 관리·거래 **읽기 권한**이 필요하며, 쓰기/출금 권한은 필요 없습니다.
공유 담보는 한 번만 합산하고 순자산은 `accountEquity`를 사용합니다.
자산별 평가액 합과 계정 평가액의 차이는 `Unified equity adjustment`로 표시합니다.
Classic 계정임을 명시하는 `25245` 응답에만 기존 v2 현물·USDT 선물 조회로 전환합니다.
포지션 조회 실패 시 동기화를 실패 처리하여 이전 스냅샷을 유지합니다.
Coin-M 선물 및 별도 펀딩 계정은 현재 Bitget 조회 범위에서 제외됩니다.
조사 근거와 배포 확인 절차는 [Bitget UTA 조사 노트](docs/bitget-unified-account.md)를 참고하세요.

```
npm test
```
Bitget 통합/Classic 계정·포지션·오류 처리, Binance 선물 폴백, 서명, 로그인 세션을 네트워크 없이 검증합니다.
