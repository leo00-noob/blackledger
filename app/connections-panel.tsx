"use client"

import * as React from "react"
import {
  AlertTriangle,
  Check,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Wallet,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  PROVIDER_META,
  PROVIDERS,
  type Provider,
} from "@/lib/portfolio-types"
import type { LiveAccount, PortfolioResponse } from "./live-types"

const DOCS: Record<Provider, string> = {
  okx_wallet: "https://web3.okx.com/onchainos/dev-docs/home/api-access-and-usage",
  binance: "https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints",
  bybit: "https://bybit-exchange.github.io/docs/v5/account/wallet-balance",
  bitget: "https://www.bitget.com/api-doc/common/signature",
  upbit: "https://global-docs.upbit.com/reference/auth",
  bithumb: "https://apidocs.bithumb.com/docs/%EC%9D%B8%EC%A6%9D-%ED%86%A0%ED%81%B0-%EC%83%9D%EC%84%B1%ED%95%98%EA%B8%B0",
}

type FormState = {
  apiKey: string
  secretKey: string
  passphrase: string
  walletEntries: string
}

const EMPTY_FORM: FormState = {
  apiKey: "",
  secretKey: "",
  passphrase: "",
  walletEntries: "",
}

const OKX_EVM_CHAIN_IDS = [
  "1",
  "10",
  "56",
  "137",
  "143",
  "196",
  "999",
  "4663",
  "8453",
  "42161",
  "43114",
  "534352",
]

function parseWalletEntries(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":")
      if (separator < 1) throw new Error("각 줄을 chain IDs:address 형식으로 입력해 주세요.")
      const chains = line
        .slice(0, separator)
        .split(",")
        .map((chain) => chain.trim())
        .filter(Boolean)
      const address = line.slice(separator + 1).trim()
      if (!chains.length || !address) throw new Error("체인 ID와 공개 주소를 모두 입력해 주세요.")
      return { chains, address }
    })
}

function addWalletEntry(value: string, chains: string[], address: string) {
  const entries = value.trim() ? parseWalletEntries(value) : []
  const merged = new Map<string, Set<string>>()
  for (const entry of [...entries, { chains, address }]) {
    const current = merged.get(entry.address) ?? new Set<string>()
    entry.chains.forEach((chain) => current.add(chain))
    merged.set(entry.address, current)
  }
  return Array.from(merged, ([entryAddress, entryChains]) =>
    `${Array.from(entryChains).join(",")}:${entryAddress}`,
  ).join("\n")
}

function statusLabel(account?: LiveAccount) {
  if (!account) return "Not connected"
  if (account.status === "error") return "Needs attention"
  return "Connected"
}

function formatSynced(value: string | null) {
  if (!value) return "Never"
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

export function ConnectionsPanel({
  accounts,
  onPortfolio,
  compact = false,
}: {
  accounts: LiveAccount[]
  onPortfolio: (portfolio: PortfolioResponse) => void
  compact?: boolean
}) {
  const [selected, setSelected] = React.useState<Provider | null>(null)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = React.useState<Provider | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const byProvider = React.useMemo(
    () => new Map(accounts.map((account) => [account.provider, account])),
    [accounts],
  )

  function open(provider: Provider) {
    setSelected(provider)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const payload = (await response.json()) as {
      ok?: boolean
      error?: string
      portfolio?: PortfolioResponse
      results?: Array<{ ok: boolean; error?: string }>
    }
    if (!response.ok || !payload.portfolio) {
      throw new Error(payload.error || "연결 요청을 완료하지 못했습니다.")
    }
    onPortfolio(payload.portfolio)
    if (payload.ok === false) {
      throw new Error(
        payload.results?.filter((result) => !result.ok).map((result) => result.error).filter(Boolean).join(" · ") ||
          "일부 계정을 동기화하지 못했습니다.",
      )
    }
  }

  async function connect() {
    if (!selected || busy) return
    setBusy(selected)
    setError(null)
    try {
      const addingWalletChains = selected === "okx_wallet" && byProvider.has("okx_wallet")
      if (addingWalletChains) {
        await request({
          action: "add_wallet_entries",
          provider: selected,
          walletEntries: parseWalletEntries(form.walletEntries),
        })
        setForm(EMPTY_FORM)
        setSelected(null)
        return
      }
      const credentials =
        selected === "okx_wallet"
          ? {
              apiKey: form.apiKey.trim(),
              secretKey: form.secretKey.trim(),
              passphrase: form.passphrase.trim(),
              walletEntries: parseWalletEntries(form.walletEntries),
            }
          : {
              apiKey: form.apiKey.trim(),
              secretKey: form.secretKey.trim(),
              ...(selected === "bitget" ? { passphrase: form.passphrase.trim() } : {}),
            }
      await request({ action: "connect", provider: selected, credentials })
      setForm(EMPTY_FORM)
      setSelected(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "연결에 실패했습니다.")
    } finally {
      setBusy(null)
    }
  }

  async function sync(provider: Provider) {
    if (busy) return
    setBusy(provider)
    setError(null)
    try {
      await request({ action: "sync", provider })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "동기화에 실패했습니다.")
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(provider: Provider) {
    if (busy || !window.confirm(`${PROVIDER_META[provider].name} 연결과 저장된 스냅샷을 삭제할까요?`)) return
    setBusy(provider)
    setError(null)
    try {
      await request({ action: "disconnect", provider })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "연결 해제에 실패했습니다.")
    } finally {
      setBusy(null)
    }
  }

  async function fillOkxEvmAddress() {
    setError(null)
    try {
      const injected = (window as unknown as {
        okxwallet?: {
          request?: (args: { method: string }) => Promise<string[]>
          ethereum?: { request?: (args: { method: string }) => Promise<string[]> }
        }
      }).okxwallet
      if (!injected?.ethereum?.request && !injected?.request) throw new Error("OKX Wallet 브라우저 확장 프로그램을 찾지 못했습니다.")
      const addresses = injected.ethereum?.request
        ? await injected.ethereum.request({ method: "eth_requestAccounts" })
        : await injected.request!({ method: "eth_requestAccounts" })
      const address = addresses?.[0]
      if (!address) throw new Error("공개 주소를 가져오지 못했습니다.")
      setForm((current) => ({
        ...current,
        walletEntries: addWalletEntry(current.walletEntries, OKX_EVM_CHAIN_IDS, address),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "지갑 주소를 가져오지 못했습니다.")
    }
  }

  async function fillOkxSolanaAddress() {
    setError(null)
    try {
      type PublicKeyLike = { toString: () => string }
      const solana = (window as unknown as {
        okxwallet?: {
          solana?: {
            connect?: () => Promise<{ publicKey?: PublicKeyLike | string }>
            request?: (args: { method: string }) => Promise<unknown>
            publicKey?: PublicKeyLike | string
          }
        }
      }).okxwallet?.solana
      if (!solana) throw new Error("OKX Wallet의 Solana 지갑을 찾지 못했습니다.")

      const connected = solana.connect
        ? await solana.connect()
        : await solana.request?.({ method: "connect" })
      const result = connected && typeof connected === "object"
        ? (connected as { publicKey?: PublicKeyLike | string })
        : undefined
      const publicKey = result?.publicKey ?? solana.publicKey
      const address = typeof publicKey === "string" ? publicKey : publicKey?.toString()
      if (!address) throw new Error("Solana 공개 주소를 가져오지 못했습니다.")
      setForm((current) => ({
        ...current,
        walletEntries: addWalletEntry(current.walletEntries, ["501"], address),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Solana 주소를 가져오지 못했습니다.")
    }
  }

  return (
    <div>
      {!compact ? (
        <div className="mb-8 grid border border-neutral-300 md:grid-cols-3">
          <div className="border-b border-neutral-300 p-5 md:border-b-0 md:border-r">
            <ShieldCheck className="mb-5 size-5" />
            <p className="font-semibold">Read-only by design</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">조회 권한만 사용하세요. 거래·출금 권한은 켜지 않습니다.</p>
          </div>
          <div className="border-b border-neutral-300 p-5 md:border-b-0 md:border-r">
            <KeyRound className="mb-5 size-5" />
            <p className="font-semibold">Encrypted at rest</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">키는 서버에서 AES-GCM으로 암호화되며 화면으로 다시 보내지 않습니다.</p>
          </div>
          <div className="p-5">
            <Wallet className="mb-5 size-5" />
            <p className="font-semibold">No seed phrases</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">OKX Wallet은 공개 주소만 조회합니다. 시드 문구·개인키 입력란이 없습니다.</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-5 flex items-start gap-3 border border-black bg-neutral-50 p-4 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="leading-6">{error}</p>
        </div>
      ) : null}

      <div className={`grid border-l border-t border-neutral-300 ${compact ? "lg:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3"}`}>
        {PROVIDERS.map((provider, index) => {
          const meta = PROVIDER_META[provider]
          const account = byProvider.get(provider)
          const loading = busy === provider
          return (
            <div key={provider} className="flex min-h-[190px] flex-col border-b border-r border-neutral-300 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className={`grid size-9 place-items-center text-[10px] font-bold ${account?.status === "connected" ? "bg-black text-white" : "border border-black"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p className="font-semibold">{meta.name}</p>
                    <p className="mt-1 text-xs text-neutral-500">{meta.detail}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${account?.status === "connected" ? "text-black" : "text-neutral-400"}`}>
                  {account?.status === "connected" ? <Check className="size-3" /> : null}
                  {statusLabel(account)}
                </span>
              </div>

              <div className="mt-6 min-h-10 text-xs leading-5 text-neutral-500">
                {account ? (
                  <>
                    <p className="font-medium text-black">{account.publicSummary}</p>
                    <p>Last sync · {formatSynced(account.lastSyncedAt)} KST</p>
                    {provider === "binance" ? (
                      <p className="mt-1 text-black">
                        {account.coverage?.derivatives === true
                          ? "Spot · Funding · Futures synced"
                          : account.coverage?.derivatives === false
                            ? "Spot synced · Futures unavailable"
                            : "Futures sync pending"}
                      </p>
                    ) : null}
                    {account.lastError ? <p className="mt-1 text-black">{account.lastError}</p> : null}
                  </>
                ) : (
                  <p>연결 전에는 샘플 데이터가 유지됩니다.</p>
                )}
              </div>

              <div className="mt-auto flex border-t border-neutral-200 pt-4">
                {account ? (
                  <>
                    <Button variant="ghost" onClick={() => sync(provider)} disabled={Boolean(busy)} className="h-9 rounded-none px-2">
                      {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync
                    </Button>
                    <Button variant="ghost" onClick={() => open(provider)} disabled={Boolean(busy)} className="h-9 rounded-none px-2">
                      {provider === "okx_wallet" ? <Wallet className="size-4" /> : <KeyRound className="size-4" />}
                      {provider === "okx_wallet" ? "Add chains" : "Replace key"}
                    </Button>
                    <Button variant="ghost" onClick={() => disconnect(provider)} disabled={Boolean(busy)} className="ml-auto h-9 rounded-none px-2 text-neutral-500">
                      <Unplug className="size-4" />
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => open(provider)} className="h-9 rounded-none">
                    <Link2 className="size-4" /> Connect
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Dialog open={selected != null} onOpenChange={(openState) => !openState && !busy && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-none border-black p-0 shadow-none sm:max-w-2xl">
          {selected ? (
            <>
              <DialogHeader className="border-b border-neutral-300 p-6 text-left">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Read-only connection</span>
                  <a href={DOCS[selected]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-black">
                    Official docs <ExternalLink className="size-3" />
                  </a>
                </div>
                <DialogTitle className="text-3xl tracking-[-0.045em]">
                  {selected === "okx_wallet" && byProvider.has("okx_wallet")
                    ? "Add OKX Wallet chains"
                    : `Connect ${PROVIDER_META[selected].name}`}
                </DialogTitle>
                <DialogDescription className="max-w-xl pt-2 leading-6">
                  {selected === "okx_wallet" && byProvider.has("okx_wallet")
                    ? "저장된 조회 키는 그대로 두고, 새 공개 주소와 체인만 추가합니다."
                    : "저장 전에 실제 조회 요청으로 키를 검증합니다. 입력값은 성공 후 즉시 비웁니다."}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 p-6">
                {error ? (
                  <div className="flex items-start gap-3 border border-black bg-neutral-50 p-4 text-sm" role="alert">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <p className="leading-6">{error}</p>
                  </div>
                ) : null}

                {selected === "okx_wallet" ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Label htmlFor="wallet-entries">Addresses by chain</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={fillOkxEvmAddress} className="h-8 rounded-none border-neutral-300 text-xs shadow-none">
                          <Wallet className="size-3.5" /> Import EVM + Robinhood
                        </Button>
                        <Button type="button" variant="outline" onClick={fillOkxSolanaAddress} className="h-8 rounded-none border-neutral-300 text-xs shadow-none">
                          <Wallet className="size-3.5" /> Import Solana
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      id="wallet-entries"
                      value={form.walletEntries}
                      onChange={(event) => setForm((current) => ({ ...current, walletEntries: event.target.value }))}
                      placeholder={"1,10,56,137,4663,8453,42161:0x…\n501:Solana address\n0:Bitcoin address"}
                      className="min-h-28 rounded-none border-neutral-300 font-mono text-xs shadow-none focus-visible:border-black focus-visible:ring-0"
                      autoComplete="off"
                    />
                    <p className="text-xs leading-5 text-neutral-500">
                      Robinhood Chain은 4663, Solana는 501입니다. 기존 주소는 유지되고 여기 입력한 체인만 추가됩니다.
                    </p>
                  </div>
                ) : null}

                {selected !== "okx_wallet" || !byProvider.has("okx_wallet") ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="api-key">API Key</Label>
                      <Input id="api-key" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} className="rounded-none border-neutral-300 font-mono shadow-none focus-visible:border-black focus-visible:ring-0" autoComplete="off" spellCheck={false} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="secret-key">Secret Key</Label>
                      <Input id="secret-key" type="password" value={form.secretKey} onChange={(event) => setForm((current) => ({ ...current, secretKey: event.target.value }))} className="rounded-none border-neutral-300 font-mono shadow-none focus-visible:border-black focus-visible:ring-0" autoComplete="new-password" spellCheck={false} />
                    </div>
                    {(selected === "bitget" || selected === "okx_wallet") ? (
                      <div className="space-y-2">
                        <Label htmlFor="passphrase">API Passphrase</Label>
                        <Input id="passphrase" type="password" value={form.passphrase} onChange={(event) => setForm((current) => ({ ...current, passphrase: event.target.value }))} className="rounded-none border-neutral-300 font-mono shadow-none focus-visible:border-black focus-visible:ring-0" autoComplete="new-password" spellCheck={false} />
                      </div>
                    ) : null}
                  </>
                ) : null}

                {(selected === "upbit" || selected === "bithumb") ? (
                  <p className="border-l-2 border-black pl-3 text-xs leading-5 text-neutral-500">
                    국내 거래소는 API 관리 화면의 허용 IP 정책에 따라 서버 호출이 거절될 수 있습니다. 거절되면 표시되는 오류를 그대로 확인해 주세요.
                  </p>
                ) : null}
                {selected === "binance" ? (
                  <p className="border-l-2 border-black pl-3 text-xs leading-5 text-neutral-500">
                    System generated(HMAC) 키에서 Enable Reading만 켜세요. 거래·출금 권한은 끄고, 개인 기기 IP로 제한한 키는 이 호스팅 서버에서 사용할 수 없습니다.
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-neutral-300 p-6">
                <p className="max-w-sm text-xs leading-5 text-neutral-500">
                  {selected === "okx_wallet" && byProvider.has("okx_wallet")
                    ? "공개 주소만 추가되며 개인키나 시드 문구는 요청하지 않습니다."
                    : "출금·주문 권한이 켜진 키는 사용하지 마세요."}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setSelected(null)} disabled={Boolean(busy)} className="rounded-none border-neutral-300 shadow-none">Cancel</Button>
                  <Button onClick={connect} disabled={Boolean(busy)} className="min-w-36 rounded-none">
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    {selected === "okx_wallet" && byProvider.has("okx_wallet") ? "Add & sync" : "Test & connect"}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
