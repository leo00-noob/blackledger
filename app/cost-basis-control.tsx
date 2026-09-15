"use client"

import * as React from "react"
import { Check, LoaderCircle, Pencil, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Provider } from "@/lib/portfolio-types"
import type { PortfolioResponse } from "./live-types"

const SOURCE_LABEL = {
  exchange: "Exchange",
  reconstructed: "History rebuilt",
  manual: "Manual",
  unavailable: "Unavailable",
} as const

export function CostBasisControl({
  provider,
  symbol,
  averageEntryKrw,
  source,
  currency,
  fxKrw,
  onPortfolio,
}: {
  provider: Provider
  symbol: string
  averageEntryKrw: number | null
  source: keyof typeof SOURCE_LABEL
  currency: "KRW" | "USD"
  fxKrw: number
  onPortfolio: (portfolio: PortfolioResponse) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const displayed =
    averageEntryKrw == null
      ? "—"
      : new Intl.NumberFormat(currency === "KRW" ? "ko-KR" : "en-US", {
          style: "currency",
          currency,
          maximumFractionDigits: currency === "KRW" ? 0 : 6,
        }).format(currency === "KRW" ? averageEntryKrw : averageEntryKrw / fxKrw)

  function begin() {
    setValue(
      averageEntryKrw == null
        ? ""
        : String(currency === "KRW" ? averageEntryKrw : averageEntryKrw / fxKrw),
    )
    setError(null)
    setEditing(true)
  }

  async function save() {
    const parsed = Number(value.replaceAll(",", ""))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("0보다 큰 숫자를 입력하세요.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/cost-basis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          symbol,
          averageEntryKrw: currency === "KRW" ? parsed : parsed * fxKrw,
        }),
      })
      const payload = (await response.json()) as { portfolio?: PortfolioResponse; error?: string }
      if (!response.ok || !payload.portfolio) throw new Error(payload.error || "저장하지 못했습니다.")
      onPortfolio(payload.portfolio)
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장하지 못했습니다.")
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="mt-4 border-t border-neutral-300 pt-3" onClick={(event) => event.stopPropagation()}>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-neutral-500">Manual average entry · {currency}</p>
        <div className="flex gap-1">
          <Input value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" autoFocus className="h-8 rounded-none border-neutral-300 text-xs shadow-none focus-visible:border-black focus-visible:ring-0" />
          <Button size="icon-sm" onClick={save} disabled={busy} className="rounded-none">
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          </Button>
          <Button size="icon-sm" variant="outline" onClick={() => setEditing(false)} disabled={busy} className="rounded-none border-neutral-300 shadow-none">
            <X className="size-3.5" />
          </Button>
        </div>
        {error ? <p className="mt-2 text-xs text-black">{error}</p> : null}
      </div>
    )
  }

  return (
    <button type="button" onClick={(event) => { event.stopPropagation(); begin() }} className="mt-4 flex w-full items-end justify-between border-t border-neutral-300 pt-3 text-left hover:text-black">
      <span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.09em] text-neutral-500">Avg. entry · {SOURCE_LABEL[source]}</span>
        <span className="mt-1 block text-xs font-medium tabular-nums">{displayed}</span>
      </span>
      <Pencil className="mb-0.5 size-3 text-neutral-400" />
    </button>
  )
}

