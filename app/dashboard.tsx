"use client"

import * as React from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
} from "lucide-react"
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
} from "recharts"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ConnectionsPanel } from "./connections-panel"
import { CostBasisControl } from "./cost-basis-control"
import type { LiveHolding, PortfolioResponse } from "./live-types"

type Currency = "KRW" | "USD"
type Range = "1D" | "7D" | "1M" | "3M" | "1Y" | "ALL"
type View = "Overview" | "Assets" | "Positions" | "Accounts" | "History" | "Settings"
type SortKey =
  | "name"
  | "totalValue"
  | "spotValue"
  | "futuresExposure"
  | "currentPrice"
  | "unrealizedPnl"
  | "change24"

type Holding = {
  venue: string
  account: string
  amount: string
  value: number
  exposure: string
  provider?: LiveHolding["provider"]
  averageEntry?: number | null
  price?: number
  unrealizedPnl?: number
  costBasisSource?: LiveHolding["costBasisSource"]
}

type Asset = {
  symbol: string
  name: string
  totalValue: number
  spotValue: number
  futuresExposure: number
  averageEntry: number
  currentPrice: number
  unrealizedPnl: number
  change24: number
  venues: string[]
  holdings: Holding[]
}

type WidgetId =
  | "netWorth"
  | "performance"
  | "exposure"
  | "allocation"
  | "positions"
  | "accounts"
  | "activity"
  | "pnl"

const FX_RATE = 1_382

const ASSETS: Asset[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    totalValue: 28_480_000,
    spotValue: 22_000_000,
    futuresExposure: 6_480_000,
    averageEntry: 98_420_000,
    currentPrice: 104_860_000,
    unrealizedPnl: 1_824_000,
    change24: 2.41,
    venues: ["Binance", "Upbit", "OKX Wallet"],
    holdings: [
      { venue: "Binance", account: "Spot", amount: "0.1194 BTC", value: 12_520_000, exposure: "Long" },
      { venue: "Binance", account: "USDⓈ-M", amount: "+0.0618 BTC", value: 6_480_000, exposure: "2× Long" },
      { venue: "Upbit", account: "Spot", amount: "0.0641 BTC", value: 6_720_000, exposure: "Long" },
      { venue: "OKX Wallet", account: "Bitcoin", amount: "0.0262 BTC", value: 2_760_000, exposure: "Long" },
    ],
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    totalValue: 17_960_000,
    spotValue: 15_200_000,
    futuresExposure: 2_760_000,
    averageEntry: 3_190_000,
    currentPrice: 3_346_000,
    unrealizedPnl: 918_000,
    change24: 1.86,
    venues: ["Binance", "Bybit", "OKX Wallet"],
    holdings: [
      { venue: "Binance", account: "Spot", amount: "2.214 ETH", value: 7_406_000, exposure: "Long" },
      { venue: "Bybit", account: "USDT Perpetual", amount: "+0.825 ETH", value: 2_760_000, exposure: "3× Long" },
      { venue: "OKX Wallet", account: "Ethereum", amount: "2.329 ETH", value: 7_794_000, exposure: "Long" },
    ],
  },
  {
    symbol: "USDT",
    name: "Tether",
    totalValue: 12_550_000,
    spotValue: 12_550_000,
    futuresExposure: 0,
    averageEntry: 1_377,
    currentPrice: 1_382,
    unrealizedPnl: 46_000,
    change24: 0.06,
    venues: ["Binance", "Bybit", "Bitget", "OKX Wallet"],
    holdings: [
      { venue: "Binance", account: "Funding", amount: "4,108 USDT", value: 5_678_000, exposure: "Cash" },
      { venue: "Bybit", account: "Unified", amount: "2,174 USDT", value: 3_004_000, exposure: "Collateral" },
      { venue: "Bitget", account: "Futures", amount: "1,590 USDT", value: 2_197_000, exposure: "Collateral" },
      { venue: "OKX Wallet", account: "Arbitrum", amount: "1,209 USDT", value: 1_671_000, exposure: "Cash" },
    ],
  },
  {
    symbol: "ZEC",
    name: "Zcash",
    totalValue: 7_820_000,
    spotValue: 1_200_000,
    futuresExposure: 6_620_000,
    averageEntry: 1_076_800,
    currentPrice: 1_119_400,
    unrealizedPnl: 552_000,
    change24: 5.72,
    venues: ["Binance", "Bithumb"],
    holdings: [
      { venue: "Binance", account: "USDⓈ-M", amount: "+5.91 ZEC", value: 6_620_000, exposure: "3× Long" },
      { venue: "Bithumb", account: "Spot", amount: "1.07 ZEC", value: 1_200_000, exposure: "Long" },
    ],
  },
  {
    symbol: "HYPE",
    name: "Hyperliquid",
    totalValue: 5_640_000,
    spotValue: 5_640_000,
    futuresExposure: 0,
    averageEntry: 38_220,
    currentPrice: 41_360,
    unrealizedPnl: 428_000,
    change24: 3.18,
    venues: ["OKX Wallet", "Bybit"],
    holdings: [
      { venue: "OKX Wallet", account: "Arbitrum", amount: "91.3 HYPE", value: 3_776_000, exposure: "Long" },
      { venue: "Bybit", account: "Spot", amount: "45.1 HYPE", value: 1_864_000, exposure: "Long" },
    ],
  },
  {
    symbol: "SOL",
    name: "Solana",
    totalValue: 4_700_000,
    spotValue: 4_700_000,
    futuresExposure: 0,
    averageEntry: 198_400,
    currentPrice: 207_900,
    unrealizedPnl: 214_000,
    change24: -1.14,
    venues: ["Upbit", "OKX Wallet"],
    holdings: [
      { venue: "Upbit", account: "Spot", amount: "14.7 SOL", value: 3_056_000, exposure: "Long" },
      { venue: "OKX Wallet", account: "Solana", amount: "7.91 SOL", value: 1_644_000, exposure: "Long" },
    ],
  },
  {
    symbol: "TRUMP",
    name: "Official Trump",
    totalValue: 3_180_000,
    spotValue: 1_260_000,
    futuresExposure: 1_920_000,
    averageEntry: 3_568,
    currentPrice: 3_734,
    unrealizedPnl: 136_000,
    change24: -3.42,
    venues: ["Binance", "Bitget"],
    holdings: [
      { venue: "Binance", account: "USDⓈ-M", amount: "+514 TRUMP", value: 1_920_000, exposure: "3× Long" },
      { venue: "Bitget", account: "Spot", amount: "337 TRUMP", value: 1_260_000, exposure: "Long" },
    ],
  },
  {
    symbol: "AKE",
    name: "Akedo",
    totalValue: 1_920_000,
    spotValue: 1_920_000,
    futuresExposure: -1_870_000,
    averageEntry: 14.01,
    currentPrice: 14.08,
    unrealizedPnl: 25_000,
    change24: -0.61,
    venues: ["Bitget", "OKX Wallet"],
    holdings: [
      { venue: "OKX Wallet", account: "Ethereum", amount: "136,364 AKE", value: 1_920_000, exposure: "Long" },
      { venue: "Bitget", account: "USDT Perpetual", amount: "−132,813 AKE", value: -1_870_000, exposure: "1× Short hedge" },
    ],
  },
  {
    symbol: "FAMI",
    name: "Fami",
    totalValue: 4_830,
    spotValue: 4_830,
    futuresExposure: 0,
    averageEntry: 0.034,
    currentPrice: 0.029,
    unrealizedPnl: -830,
    change24: -14.4,
    venues: ["OKX Wallet"],
    holdings: [
      { venue: "OKX Wallet", account: "BNB Chain", amount: "166,552 FAMI", value: 4_830, exposure: "Dust" },
    ],
  },
]

const TOTAL_ASSETS = ASSETS.reduce((sum, asset) => sum + asset.totalValue, 0)

const PERFORMANCE: Record<Range, number[]> = {
  "1D": [-1.12, -0.82, -0.94, -0.31, -0.48, 0.08, 0.41, 0.24, 0.91, 1.18, 1.43, 1.82],
  "7D": [-4.2, -3.6, -2.9, -3.3, -1.8, -0.7, 0.4, 1.6, 1.1, 3.2, 4.8, 6.34],
  "1M": [2.2, 3.4, 1.8, 0.6, -1.5, -3.1, -4.2, -3.7, -4.9, -3.3, -2.8, -2.14],
  "3M": [-8.4, -6.1, -9.8, -5.4, -1.1, 3.7, 1.4, 5.8, 9.2, 7.4, 12.1, 16.8],
  "1Y": [-12.4, -6.2, 4.1, -3.8, 8.2, 14.7, 11.6, 18.9, 24.1, 19.4, 27.2, 31.8],
  ALL: [-18.1, -4.8, 8.4, 1.2, 19.7, 14.6, 28.3, 34.8, 22.1, 39.2, 29.5, 46.4],
}

const RANGE_DAYS: Record<Range, number> = { "1D": 1, "7D": 7, "1M": 30, "3M": 90, "1Y": 365, ALL: 720 }

const PERIOD_STATS = [
  { label: "24H", value: 1.82 },
  { label: "7D", value: 6.34 },
  { label: "30D", value: -2.14 },
  { label: "ALL", value: 46.4 },
]

const POSITIONS = [
  { symbol: "BTCUSDT", side: "LONG", leverage: "2×", venue: "Binance", size: 6_480_000, entry: 101_240_000, mark: 104_860_000, pnl: 224_000, liq: 61_440_000, margin: "Cross" },
  { symbol: "ETHUSDT", side: "LONG", leverage: "3×", venue: "Bybit", size: 2_760_000, entry: 3_188_000, mark: 3_346_000, pnl: 130_000, liq: 2_178_000, margin: "Isolated" },
  { symbol: "ZECUSDT", side: "LONG", leverage: "3×", venue: "Binance", size: 6_620_000, entry: 1_076_800, mark: 1_119_400, pnl: 252_000, liq: 724_000, margin: "Isolated" },
  { symbol: "AKEUSDT", side: "SHORT", leverage: "1×", venue: "Bitget", size: 1_870_000, entry: 14.01, mark: 14.08, pnl: -9_000, liq: 27.84, margin: "Isolated" },
]

const ACTIVITY = [
  { time: "Today · 21:18", type: "Transfer", asset: "USDT", detail: "Bybit → Binance", amount: "+1,200 USDT", value: 1_658_400 },
  { time: "Today · 19:42", type: "Realized P&L", asset: "ZEC", detail: "Binance · 30% close", amount: "+0.82 ZEC", value: 286_000 },
  { time: "Today · 18:05", type: "Buy", asset: "SOL", detail: "Upbit · KRW", amount: "+4.70 SOL", value: 977_000 },
  { time: "Yesterday · 23:14", type: "Deposit", asset: "KRW", detail: "Bithumb", amount: "+₩1,000,000", value: 1_000_000 },
  { time: "Yesterday · 17:32", type: "Funding", asset: "AKE", detail: "Bitget · Short", amount: "+18.42 USDT", value: 25_456 },
]

const VENUE_ALLOCATION = [
  { label: "Binance", value: 29_420_000, shade: "#090909" },
  { label: "OKX Wallet", value: 18_210_000, shade: "#383838" },
  { label: "Bybit", value: 13_810_000, shade: "#686868" },
  { label: "Upbit", value: 10_110_000, shade: "#989898" },
  { label: "Bitget", value: 6_430_000, shade: "#bebebe" },
  { label: "Bithumb", value: 4_294_830, shade: "#dedede" },
]

const WIDGET_LABELS: Record<WidgetId, { title: string; description: string }> = {
  netWorth: { title: "Net worth", description: "Total assets and period returns" },
  performance: { title: "Performance", description: "Net-worth history chart" },
  exposure: { title: "Asset exposure", description: "Consolidated spot and futures table" },
  allocation: { title: "Allocation", description: "Venue and account composition" },
  positions: { title: "Open positions", description: "Leverage, liquidation and unrealized P&L" },
  accounts: { title: "Connected accounts", description: "Sync health across wallets and exchanges" },
  activity: { title: "Recent activity", description: "Transfers, trades and funding" },
  pnl: { title: "P&L detail", description: "Realized and unrealized performance" },
}

const DEFAULT_WIDGET_ORDER: WidgetId[] = [
  "netWorth",
  "performance",
  "exposure",
  "allocation",
  "positions",
  "accounts",
  "activity",
  "pnl",
]

const DEFAULT_VISIBLE_WIDGETS: WidgetId[] = ["netWorth", "performance", "exposure", "allocation", "positions"]

function formatMoney(value: number, currency: Currency, compact = false) {
  const converted = currency === "KRW" ? value : value / FX_RATE
  return new Intl.NumberFormat(currency === "KRW" ? "ko-KR" : "en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: currency === "KRW" ? 0 : compact ? 1 : 2,
  }).format(converted)
}

function formatSignedMoney(value: number, currency: Currency) {
  const sign = value >= 0 ? "+" : "−"
  return `${sign}${formatMoney(Math.abs(value), currency)}`
}

function buildChartData(range: Range, totalAssets = TOTAL_ASSETS) {
  const percentages = PERFORMANCE[range]
  const baseTime = Date.UTC(2026, 8, 2, 12, 0, 0)
  const totalSpan = RANGE_DAYS[range] * 24 * 60 * 60 * 1000
  return percentages.map((percentage, index) => {
    const timestamp = baseTime - totalSpan + (totalSpan * index) / (percentages.length - 1)
    const previousPercentage = index === 0 ? percentage : percentages[index - 1]
    const value = totalAssets / (1 + percentages[percentages.length - 1] / 100) * (1 + percentage / 100)
    const previousValue = totalAssets / (1 + percentages[percentages.length - 1] / 100) * (1 + previousPercentage / 100)
    return {
      date: new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        ...(range === "1D" ? { hour: "2-digit" as const, minute: "2-digit" as const } : {}),
      }).format(new Date(timestamp)),
      value,
      change: value - previousValue,
    }
  })
}

function DirectionMark({ value, compact = false }: { value: number; compact?: boolean }) {
  const positive = value >= 0
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${positive ? "font-semibold text-black" : "font-medium text-neutral-500"}`}>
      {positive ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" />}
      {compact ? Math.abs(value).toFixed(1) : Math.abs(value).toFixed(2)}%
    </span>
  )
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: Array<{ payload: { value: number; change: number } }>
  label?: string
  currency: Currency
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="border border-black bg-white px-4 py-3 text-sm shadow-none">
      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-neutral-500">{label}</p>
      <p className="font-semibold tabular-nums">{formatMoney(point.value, currency)}</p>
      <p className={`mt-1 text-xs tabular-nums ${point.change >= 0 ? "text-black" : "text-neutral-500"}`}>
        {formatSignedMoney(point.change, currency)}
      </p>
    </div>
  )
}

function SectionHeading({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">{eyebrow}</p>
        <h2 className="text-2xl font-semibold tracking-[-0.035em] text-black md:text-3xl">{title}</h2>
      </div>
      {note ? <p className="max-w-md text-sm leading-6 text-neutral-500">{note}</p> : null}
    </div>
  )
}

function WidgetShell({
  id,
  editMode,
  index,
  total,
  children,
  onHide,
  onMove,
  onDragStart,
  onDrop,
}: {
  id: WidgetId
  editMode: boolean
  index: number
  total: number
  children: React.ReactNode
  onHide: (id: WidgetId) => void
  onMove: (id: WidgetId, direction: -1 | 1) => void
  onDragStart: (id: WidgetId) => void
  onDrop: (id: WidgetId) => void
}) {
  return (
    <section
      draggable={editMode}
      onDragStart={() => onDragStart(id)}
      onDragOver={(event) => editMode && event.preventDefault()}
      onDrop={() => onDrop(id)}
      className={`group relative border-t border-neutral-300 py-9 md:py-12 ${editMode ? "cursor-move bg-[linear-gradient(90deg,rgba(0,0,0,.025)_1px,transparent_1px)] bg-[length:12px_12px]" : ""}`}
    >
      {editMode ? (
        <div className="absolute right-0 top-3 z-10 flex items-center border border-neutral-300 bg-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="flex h-8 items-center border-r border-neutral-300 px-2 text-xs uppercase tracking-[0.12em] text-neutral-500">
            <GripVertical className="mr-1 size-3.5" /> Drag
          </span>
          <button
            type="button"
            onClick={() => onMove(id, -1)}
            disabled={index === 0}
            className="grid size-8 place-items-center border-r border-neutral-300 transition-colors hover:bg-black hover:text-white disabled:opacity-25"
            aria-label={`Move ${WIDGET_LABELS[id].title} up`}
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(id, 1)}
            disabled={index === total - 1}
            className="grid size-8 place-items-center border-r border-neutral-300 transition-colors hover:bg-black hover:text-white disabled:opacity-25"
            aria-label={`Move ${WIDGET_LABELS[id].title} down`}
          >
            <ArrowDown className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onHide(id)}
            className="grid size-8 place-items-center transition-colors hover:bg-black hover:text-white"
            aria-label={`Hide ${WIDGET_LABELS[id].title}`}
          >
            <EyeOff className="size-3.5" />
          </button>
        </div>
      ) : null}
      {children}
    </section>
  )
}

function SortButton({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  direction: "asc" | "desc"
  onSort: (key: SortKey) => void
  align?: "left" | "right"
}) {
  const active = activeKey === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500 hover:text-black ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      {label}
      <span aria-hidden="true" className={active ? "text-black" : "text-neutral-300"}>
        {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  )
}

function formatAssetAmount(value: number, symbol: string) {
  const absolute = Math.abs(value)
  const maximumFractionDigits = absolute >= 1000 ? 2 : absolute >= 1 ? 6 : 8
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value)} ${symbol}`
}

function kstTime(value: string | null | undefined) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

function liveChartData(portfolio: PortfolioResponse, range: Range) {
  const days = RANGE_DAYS[range]
  const cutoff = Date.now() - days * 86_400_000
  const source = portfolio.history.filter(
    (point) => range === "ALL" || new Date(point.at).getTime() >= cutoff,
  )
  const points = source.length ? source : portfolio.history.slice(-1)
  const normalized = points.map((point, index) => ({
    date: new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      ...(range === "1D" ? { hour: "2-digit" as const, minute: "2-digit" as const } : {}),
    }).format(new Date(point.at)),
    value: point.valueKrw,
    change:
      index === 0
        ? 0
        : point.valueKrw - points[index - 1].valueKrw - point.externalFlowKrw,
  }))
  if (normalized.length === 1) {
    return [
      { ...normalized[0], date: "Baseline" },
      normalized[0],
    ]
  }
  return normalized
}

export function Dashboard() {
  const [currency, setCurrency] = React.useState<Currency>("KRW")
  const [range, setRange] = React.useState<Range>("1M")
  const [activeView, setActiveView] = React.useState<View>("Overview")
  const [search, setSearch] = React.useState("")
  const [minValue, setMinValue] = React.useState(0)
  const [hideDust, setHideDust] = React.useState(true)
  const [sortKey, setSortKey] = React.useState<SortKey>("totalValue")
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc")
  const [expandedAsset, setExpandedAsset] = React.useState<string | null>("AKE")
  const [editMode, setEditMode] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [widgetOrder, setWidgetOrder] = React.useState<WidgetId[]>(DEFAULT_WIDGET_ORDER)
  const [visibleWidgets, setVisibleWidgets] = React.useState<WidgetId[]>(DEFAULT_VISIBLE_WIDGETS)
  const [draggedWidget, setDraggedWidget] = React.useState<WidgetId | null>(null)
  const [lastSync, setLastSync] = React.useState("21:42")
  const [refreshing, setRefreshing] = React.useState(false)
  const [layoutLoaded, setLayoutLoaded] = React.useState(false)
  const [portfolio, setPortfolio] = React.useState<PortfolioResponse | null>(null)
  const [portfolioError, setPortfolioError] = React.useState<string | null>(null)
  const binanceCoverageSyncAttempted = React.useRef(false)

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("black-ledger-layout")
        if (saved) {
          const parsed = JSON.parse(saved) as { order?: WidgetId[]; visible?: WidgetId[] }
          if (parsed.order?.length) setWidgetOrder(parsed.order)
          if (parsed.visible?.length) setVisibleWidgets(parsed.visible)
        }
      } catch {
        // A damaged local preference should never block the dashboard.
      } finally {
        setLayoutLoaded(true)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  React.useEffect(() => {
    if (!layoutLoaded) return
    window.localStorage.setItem(
      "black-ledger-layout",
      JSON.stringify({ order: widgetOrder, visible: visibleWidgets })
    )
  }, [layoutLoaded, widgetOrder, visibleWidgets])

  const loadPortfolio = React.useCallback(async () => {
    try {
      const response = await fetch("/api/portfolio", { cache: "no-store" })
      if (response.status === 401) {
        window.location.href = "/login"
        return
      }
      const payload = (await response.json()) as PortfolioResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error || "Live portfolio unavailable")
      setPortfolio(payload)
      setPortfolioError(null)
      if (payload.asOf) setLastSync(kstTime(payload.asOf))
    } catch (error) {
      setPortfolioError(error instanceof Error ? error.message : "Live portfolio unavailable")
    }
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void loadPortfolio(), 0)
    return () => window.clearTimeout(timer)
  }, [loadPortfolio])

  React.useEffect(() => {
    if (!portfolio || binanceCoverageSyncAttempted.current) return
    const binance = portfolio.accounts.find((account) => account.provider === "binance")
    if (!binance || binance.coverage?.derivatives === true) return

    binanceCoverageSyncAttempted.current = true
    void (async () => {
      try {
        setRefreshing(true)
        const response = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", provider: "binance" }),
        })
        const payload = (await response.json()) as {
          ok?: boolean
          portfolio?: PortfolioResponse
          error?: string
          results?: Array<{ ok: boolean; error?: string }>
        }
        if (!response.ok || !payload.portfolio) {
          throw new Error(payload.error || "Binance 선물을 동기화하지 못했습니다.")
        }
        setPortfolio(payload.portfolio)
        if (payload.portfolio.asOf) setLastSync(kstTime(payload.portfolio.asOf))
        if (payload.ok === false) {
          throw new Error(
            payload.results?.find((result) => !result.ok)?.error ||
              "Binance 선물을 동기화하지 못했습니다.",
          )
        }
        setPortfolioError(null)
      } catch (error) {
        setPortfolioError(
          error instanceof Error ? error.message : "Binance 선물을 동기화하지 못했습니다.",
        )
      } finally {
        setRefreshing(false)
      }
    })()
  }, [portfolio])

  const liveMode = portfolio?.mode === "live"
  const displayAssets = React.useMemo<Asset[]>(() => {
    if (!liveMode || !portfolio) return ASSETS
    return portfolio.assets.map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      totalValue: asset.totalValueKrw,
      spotValue: asset.spotValueKrw,
      futuresExposure: asset.futuresExposureKrw,
      averageEntry: 0,
      currentPrice: asset.currentPriceKrw,
      unrealizedPnl: asset.unrealizedPnlKrw,
      change24: asset.change24Pct,
      venues: asset.venues,
      holdings: asset.holdings.map((holding) => ({
        venue: holding.venue,
        account: holding.account,
        amount: formatAssetAmount(holding.amount, holding.symbol),
        value: holding.valueKrw,
        exposure: holding.exposure,
        provider: holding.provider,
        averageEntry: holding.averageEntryKrw,
        price: holding.priceKrw,
        unrealizedPnl: holding.unrealizedPnlKrw,
        costBasisSource: holding.costBasisSource,
      })),
    }))
  }, [liveMode, portfolio])
  const totalAssets = liveMode && portfolio ? portfolio.totalNetWorthKrw : TOTAL_ASSETS
  const chartData = React.useMemo(
    () =>
      liveMode && portfolio?.history.length
        ? liveChartData(portfolio, range)
        : buildChartData(range, totalAssets),
    [liveMode, portfolio, range, totalAssets],
  )

  const displayPositions = React.useMemo(() => {
    if (!liveMode || !portfolio) return POSITIONS
    return portfolio.positions.map((position) => ({
      symbol: position.symbol,
      side: position.side,
      leverage: `${position.leverage || 1}×`,
      venue: position.venue,
      size: position.sizeKrw,
      entry: position.entryKrw,
      mark: position.markKrw,
      pnl: position.unrealizedPnlKrw,
      liq: position.liquidationKrw,
      margin: position.marginMode,
    }))
  }, [liveMode, portfolio])

  const venueAllocation = React.useMemo(() => {
    if (!liveMode || !portfolio) return VENUE_ALLOCATION
    const shades = ["#090909", "#383838", "#686868", "#989898", "#bebebe", "#dedede"]
    return portfolio.allocation
      .filter((item) => item.valueKrw !== 0)
      .map((item, index) => ({ label: item.label, value: item.valueKrw, shade: shades[index % shades.length] }))
  }, [liveMode, portfolio])

  const periodStats = React.useMemo(() => {
    if (!liveMode || !portfolio) return PERIOD_STATS
    return [
      { label: "24H", value: portfolio.returns.day },
      { label: "7D", value: portfolio.returns.week },
      { label: "30D", value: portfolio.returns.month },
      { label: "ALL", value: portfolio.returns.all },
    ]
  }, [liveMode, portfolio])

  const todayChange = React.useMemo(() => {
    if (!liveMode || !portfolio || portfolio.history.length < 2) return { amount: 0, percent: 0 }
    const last = portfolio.history.at(-1)!
    const previous = portfolio.history.at(-2)!
    const amount = last.valueKrw - previous.valueKrw - last.externalFlowKrw
    return { amount, percent: previous.valueKrw ? (amount / previous.valueKrw) * 100 : 0 }
  }, [liveMode, portfolio])

  const filteredAssets = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return displayAssets.filter((asset) => {
      const matchesSearch = !query || asset.symbol.toLowerCase().includes(query) || asset.name.toLowerCase().includes(query)
      const matchesMinimum = asset.totalValue >= minValue
      const matchesDust = !hideDust || asset.totalValue >= 10_000
      return matchesSearch && matchesMinimum && matchesDust
    }).sort((a, b) => {
      const left = sortKey === "name" ? a.name : a[sortKey]
      const right = sortKey === "name" ? b.name : b[sortKey]
      if (typeof left === "string" && typeof right === "string") {
        return sortDirection === "asc" ? left.localeCompare(right) : right.localeCompare(left)
      }
      return sortDirection === "asc" ? Number(left) - Number(right) : Number(right) - Number(left)
    })
  }, [displayAssets, hideDust, minValue, search, sortDirection, sortKey])

  const visibleOrder = widgetOrder.filter((id) => visibleWidgets.includes(id))
  const hiddenWidgets = widgetOrder.filter((id) => !visibleWidgets.includes(id))

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDirection(key === "name" ? "asc" : "desc")
    }
  }

  function hideWidget(id: WidgetId) {
    setVisibleWidgets((current) => current.filter((widget) => widget !== id))
  }

  function showWidget(id: WidgetId) {
    setVisibleWidgets((current) => (current.includes(id) ? current : [...current, id]))
    setAddOpen(false)
  }

  function moveWidget(id: WidgetId, direction: -1 | 1) {
    setWidgetOrder((current) => {
      const visible = current.filter((widget) => visibleWidgets.includes(widget))
      const from = visible.indexOf(id)
      const to = from + direction
      if (from < 0 || to < 0 || to >= visible.length) return current
      const target = visible[to]
      const next = [...current]
      const fromIndex = next.indexOf(id)
      const toIndex = next.indexOf(target)
      next[fromIndex] = target
      next[toIndex] = id
      return next
    })
  }

  function dropWidget(target: WidgetId) {
    if (!draggedWidget || draggedWidget === target) return
    setWidgetOrder((current) => {
      const next = current.filter((id) => id !== draggedWidget)
      const targetIndex = next.indexOf(target)
      next.splice(targetIndex, 0, draggedWidget)
      return next
    })
    setDraggedWidget(null)
  }

  async function refreshData() {
    if (refreshing) return
    setRefreshing(true)
    try {
      if (portfolio?.accounts.length) {
        const response = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync" }),
        })
        const payload = (await response.json()) as {
          ok?: boolean
          portfolio?: PortfolioResponse
          error?: string
          results?: Array<{ ok: boolean; error?: string }>
        }
        if (!response.ok || !payload.portfolio) throw new Error(payload.error || "동기화하지 못했습니다.")
        setPortfolio(payload.portfolio)
        if (payload.portfolio.asOf) setLastSync(kstTime(payload.portfolio.asOf))
        if (payload.ok === false) {
          throw new Error(
            payload.results?.filter((result) => !result.ok).map((result) => result.error).filter(Boolean).join(" · ") ||
              "일부 계정을 동기화하지 못했습니다.",
          )
        }
        setPortfolioError(null)
      } else {
        await loadPortfolio()
      }
    } catch (error) {
      setPortfolioError(error instanceof Error ? error.message : "동기화하지 못했습니다.")
    } finally {
      setRefreshing(false)
    }
  }

  function renderAssetTable(standalone = false) {
    return (
      <div>
        {standalone ? <SectionHeading eyebrow="Consolidated" title="All assets" note="Every wallet and exchange, normalized into one view." /> : null}
        <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search asset"
              aria-label="Search assets"
              className="h-10 rounded-none border-neutral-300 pl-10 shadow-none focus-visible:border-black focus-visible:ring-0"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(minValue)} onValueChange={(value) => setMinValue(Number(value))}>
              <SelectTrigger className="h-10 rounded-none border-neutral-300 shadow-none focus:ring-0" aria-label="Minimum asset value">
                <SlidersHorizontal className="size-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none border-neutral-300 shadow-none">
                <SelectItem className="rounded-none" value="0">No minimum</SelectItem>
                <SelectItem className="rounded-none" value="1000000">₩1M minimum</SelectItem>
                <SelectItem className="rounded-none" value="5000000">₩5M minimum</SelectItem>
                <SelectItem className="rounded-none" value="10000000">₩10M minimum</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex h-10 cursor-pointer items-center gap-2 border border-neutral-300 px-3 text-sm">
              <Checkbox
                checked={hideDust}
                onCheckedChange={(checked) => setHideDust(Boolean(checked))}
                className="rounded-none border-neutral-400 shadow-none"
              />
              Hide dust
            </label>
            <span className="text-xs tabular-nums text-neutral-500">{filteredAssets.length} assets</span>
          </div>
        </div>

        <div className="border-y border-neutral-300">
          <Table className="min-w-[1180px]">
            <TableHeader>
              <TableRow className="border-neutral-300 hover:bg-transparent">
                <TableHead className="h-12 pl-0">
                  <SortButton label="Asset" sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </TableHead>
                <TableHead className="h-12 text-right">
                  <SortButton label="Value" sortKey="totalValue" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                </TableHead>
                <TableHead className="h-12 text-right">Weight</TableHead>
                <TableHead className="h-12 text-right">
                  <SortButton label="Spot" sortKey="spotValue" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                </TableHead>
                <TableHead className="h-12 text-right">
                  <SortButton label="Futures net" sortKey="futuresExposure" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                </TableHead>
                <TableHead className="h-12 text-right">
                  <SortButton label="Price" sortKey="currentPrice" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                </TableHead>
                <TableHead className="h-12 text-right">
                  <SortButton label="Unrealized" sortKey="unrealizedPnl" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                </TableHead>
                <TableHead className="h-12 text-right">
                  <SortButton label="24H" sortKey="change24" activeKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                </TableHead>
                <TableHead className="h-12 pr-0 text-right">Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssets.map((asset) => {
                const expanded = expandedAsset === asset.symbol
                return (
                  <React.Fragment key={asset.symbol}>
                    <TableRow
                      className="cursor-pointer border-neutral-200 hover:bg-neutral-100/70"
                      onClick={() => setExpandedAsset(expanded ? null : asset.symbol)}
                      aria-expanded={expanded}
                    >
                      <TableCell className="h-[70px] pl-0">
                        <div className="flex items-center gap-3">
                          <span className="grid size-8 place-items-center bg-black text-[10px] font-bold tracking-[-0.04em] text-white">{asset.symbol.slice(0, 3)}</span>
                          <span>
                            <span className="block font-semibold tracking-tight text-black">{asset.symbol}</span>
                            <span className="block text-xs text-neutral-500">{asset.name}</span>
                          </span>
                          {expanded ? <ChevronDown className="ml-1 size-3.5 text-neutral-400" /> : <ChevronRight className="ml-1 size-3.5 text-neutral-400" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatMoney(asset.totalValue, currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{totalAssets ? ((asset.totalValue / totalAssets) * 100).toFixed(1) : "0.0"}%</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(asset.spotValue, currency, true)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${asset.futuresExposure < 0 ? "text-neutral-500" : "text-black"}`}>{formatSignedMoney(asset.futuresExposure, currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(asset.currentPrice, currency)}</TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${asset.unrealizedPnl >= 0 ? "text-black" : "text-neutral-500"}`}>{formatSignedMoney(asset.unrealizedPnl, currency)}</TableCell>
                      <TableCell className="text-right"><DirectionMark value={asset.change24} /></TableCell>
                      <TableCell className="max-w-[190px] pr-0 text-right text-xs text-neutral-500">
                        <span className="block truncate">{asset.venues.join(" · ")}</span>
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow className="border-neutral-300 bg-neutral-50 hover:bg-neutral-50">
                        <TableCell colSpan={9} className="px-0 py-0">
                          <div className="grid gap-px bg-neutral-200 md:grid-cols-2 xl:grid-cols-4">
                            {asset.holdings.map((holding, holdingIndex) => (
                              <div key={`${asset.symbol}-${holding.venue}-${holding.account}-${holdingIndex}`} className="bg-neutral-50 px-5 py-5">
                                <div className="mb-4 flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-black">{holding.venue}</p>
                                    <p className="mt-1 text-xs text-neutral-500">{holding.account}</p>
                                  </div>
                                  <span className="border border-neutral-300 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-600">{holding.exposure}</span>
                                </div>
                                <p className="font-medium tabular-nums">{holding.amount}</p>
                                <p className={`mt-1 text-xs tabular-nums ${holding.value >= 0 ? "text-neutral-500" : "text-neutral-400"}`}>{formatSignedMoney(holding.value, currency)}</p>
                                {holding.price != null ? (
                                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-neutral-200 pt-3 text-xs">
                                    <div>
                                      <p className="text-[10px] uppercase tracking-[0.08em] text-neutral-400">Venue price</p>
                                      <p className="mt-1 tabular-nums">{formatMoney(holding.price, currency)}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-[10px] uppercase tracking-[0.08em] text-neutral-400">Unrealized</p>
                                      <p className="mt-1 tabular-nums">{formatSignedMoney(holding.unrealizedPnl ?? 0, currency)}</p>
                                    </div>
                                  </div>
                                ) : null}
                                {holding.provider && holding.costBasisSource ? (
                                  <CostBasisControl
                                    provider={holding.provider}
                                    symbol={asset.symbol}
                                    averageEntryKrw={holding.averageEntry ?? null}
                                    source={holding.costBasisSource}
                                    currency={currency}
                                    fxKrw={portfolio?.fxKrw ?? FX_RATE}
                                    onPortfolio={setPortfolio}
                                  />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  function renderPositions(standalone = false) {
    return (
      <div>
        {standalone ? <SectionHeading eyebrow="Derivatives" title="Open positions" note="Directional exposure and liquidation distance across exchanges." /> : null}
        <div className="border-y border-neutral-300">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="border-neutral-300 hover:bg-transparent">
                {['Contract', 'Side', 'Venue', 'Size', 'Entry', 'Mark', 'Unrealized', 'Liquidation', 'Margin'].map((heading, index) => (
                  <TableHead key={heading} className={`h-12 text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500 ${index === 0 ? "pl-0" : "text-right"} ${index === 8 ? "pr-0" : ""}`}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayPositions.map((position) => (
                <TableRow key={position.symbol} className="border-neutral-200 hover:bg-neutral-100/70">
                  <TableCell className="h-16 pl-0 font-semibold">{position.symbol}</TableCell>
                  <TableCell className="text-right"><span className={`inline-flex border px-2 py-1 text-[10px] font-bold tracking-[0.08em] ${position.side === "LONG" ? "border-black bg-black text-white" : "border-neutral-400 text-neutral-600"}`}>{position.leverage} {position.side}</span></TableCell>
                  <TableCell className="text-right text-neutral-600">{position.venue}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(position.size, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-neutral-600">{formatMoney(position.entry, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(position.mark, currency)}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${position.pnl >= 0 ? "text-black" : "text-neutral-500"}`}>{formatSignedMoney(position.pnl, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-neutral-500">{formatMoney(position.liq, currency)}</TableCell>
                  <TableCell className="pr-0 text-right text-neutral-500">{position.margin}</TableCell>
                </TableRow>
              ))}
              {!displayPositions.length ? (
                <TableRow className="border-neutral-200 hover:bg-transparent">
                  <TableCell colSpan={9} className="h-28 text-center text-sm text-neutral-500">Open futures positions will appear here after sync.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  function renderAccounts(standalone = false) {
    const liveAccounts = portfolio?.accounts ?? []
    if (standalone) {
      return (
        <div>
          <SectionHeading eyebrow="Connections" title="Accounts" note="실제 잔고를 읽기 위한 조회 전용 연결입니다. 키는 저장 전에 검증됩니다." />
          <ConnectionsPanel
            accounts={liveAccounts}
            onPortfolio={(next) => {
              setPortfolio(next)
              setPortfolioError(null)
              if (next.asOf) setLastSync(kstTime(next.asOf))
            }}
          />
        </div>
      )
    }
    return (
      <div>
        <div className="border-t border-neutral-300">
          {liveAccounts.map((account, index) => (
            <div key={account.name} className="grid gap-4 border-b border-neutral-300 py-5 md:grid-cols-[1.1fr_1.7fr_1fr_auto] md:items-center">
              <div className="flex items-center gap-3">
                <span className="grid size-8 place-items-center border border-black text-[10px] font-bold">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <p className="font-semibold">{account.name}</p>
                  <p className="text-xs text-neutral-500">{account.type} · {account.publicSummary}</p>
                </div>
              </div>
              <p className="text-sm text-neutral-500">{account.detail}</p>
              <p className="font-medium tabular-nums md:text-right">{formatMoney(account.valueKrw, currency)}</p>
              <span className="inline-flex items-center gap-2 text-xs text-neutral-500 md:justify-end">
                <span className={`size-1.5 ${account.status === "connected" ? "bg-black" : "border border-black"}`} /> Synced {kstTime(account.lastSyncedAt)}
              </span>
            </div>
          ))}
          {!liveAccounts.length ? (
            <div className="flex flex-col justify-between gap-5 border-b border-neutral-300 py-8 sm:flex-row sm:items-center">
              <div>
                <p className="font-semibold">No live accounts yet</p>
                <p className="mt-2 text-sm text-neutral-500">Connect the first read-only account when you are ready.</p>
              </div>
              <Button onClick={() => setActiveView("Accounts")} className="rounded-none"><Plus className="size-4" /> Connect account</Button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  function renderActivity(standalone = false) {
    return (
      <div>
        {standalone ? <SectionHeading eyebrow="Ledger" title="History" note="Deposits and internal transfers are separated from investment returns." /> : null}
        <div className="border-t border-neutral-300">
          {(liveMode ? [] : ACTIVITY).map((item) => (
            <div key={`${item.time}-${item.asset}`} className="grid gap-3 border-b border-neutral-300 py-5 sm:grid-cols-[1.2fr_.8fr_1.6fr_1fr] sm:items-center">
              <p className="text-sm text-neutral-500">{item.time}</p>
              <p className="text-xs font-semibold uppercase tracking-[0.09em]">{item.type}</p>
              <div>
                <p className="font-semibold">{item.asset}</p>
                <p className="text-xs text-neutral-500">{item.detail}</p>
              </div>
              <div className="sm:text-right">
                <p className="font-medium tabular-nums">{item.amount}</p>
                <p className="text-xs tabular-nums text-neutral-500">{formatMoney(item.value, currency)}</p>
              </div>
            </div>
          ))}
          {liveMode ? (
            <div className="border-b border-neutral-300 py-10 text-center">
              <p className="font-semibold">Current balances are live</p>
              <p className="mt-2 text-sm text-neutral-500">Trade and transfer backfill will appear here after the first account history import.</p>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  function renderWidget(id: WidgetId) {
    switch (id) {
      case "netWorth":
        return (
          <div className="grid gap-10 xl:grid-cols-[1.5fr_1fr] xl:items-end">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Total net worth</p>
                <span className={`border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${liveMode ? "border-black bg-black text-white" : "border-neutral-300 text-neutral-500"}`}>
                  {liveMode ? "Live portfolio" : "Demo portfolio"}
                </span>
              </div>
              <p className="max-w-full overflow-hidden text-[clamp(3.2rem,7vw,7.3rem)] font-semibold leading-[0.92] tracking-[-0.075em] tabular-nums text-black">
                {formatMoney(totalAssets, currency)}
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="text-lg font-semibold tabular-nums">{formatSignedMoney(liveMode ? todayChange.amount : 1_468_240, currency)}</span>
                <DirectionMark value={liveMode ? todayChange.percent : 1.82} />
                <span className="text-sm text-neutral-500">{liveMode && portfolio && portfolio.history.length < 2 ? "baseline" : "today · flows excluded"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 border-l border-t border-neutral-300 sm:grid-cols-4 xl:grid-cols-2">
              {periodStats.map((stat) => (
                <div key={stat.label} className="border-b border-r border-neutral-300 px-4 py-5">
                  <p className="mb-3 text-xs font-semibold tracking-[0.12em] text-neutral-500">{stat.label}</p>
                  {stat.value == null ? <span className="text-xs font-medium text-neutral-400">Baseline</span> : <DirectionMark value={stat.value} />}
                </div>
              ))}
            </div>
          </div>
        )
      case "performance":
        return (
          <div>
            <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Performance</p>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-3xl font-semibold tracking-[-0.04em]">Net-worth history</h2>
                  {liveMode && portfolio?.history.length && portfolio.history.length < 2 ? (
                    <span className="text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">Building baseline</span>
                  ) : (
                    <DirectionMark value={liveMode ? (portfolio?.returns.all ?? 0) : PERFORMANCE[range][PERFORMANCE[range].length - 1]} />
                  )}
                </div>
              </div>
              <div className="flex border border-neutral-300" aria-label="Chart range">
                {(Object.keys(PERFORMANCE) as Range[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setRange(item)}
                    className={`h-9 min-w-11 border-r border-neutral-300 px-3 text-xs font-semibold last:border-r-0 ${range === item ? "bg-black text-white" : "bg-white text-neutral-500 hover:text-black"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative h-[270px] w-full md:h-[350px]">
              <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-dashed border-neutral-200" />
              <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-dashed border-neutral-200" />
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 14, right: 4, bottom: 0, left: 4 }}>
                  <XAxis dataKey="date" hide />
                  <RechartsTooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: "#a3a3a3", strokeDasharray: "3 3" }} />
                  <Line type="monotone" dataKey="value" stroke="#050505" strokeWidth={2.4} dot={false} activeDot={{ r: 4, fill: "#050505", stroke: "#ffffff", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex justify-between text-xs tabular-nums text-neutral-400">
              <span>{chartData[0].date}</span>
              <span>{chartData[chartData.length - 1].date}</span>
            </div>
          </div>
        )
      case "exposure":
        return (
          <div>
            <SectionHeading eyebrow="Consolidated" title="Asset exposure" note="Spot and derivatives are netted by asset. Select a row for account-level detail." />
            {renderAssetTable()}
          </div>
        )
      case "allocation":
        return (
          <div>
            <SectionHeading eyebrow="Distribution" title="Allocation" note="Where capital sits, and how much remains directional." />
            <div className="grid gap-12 xl:grid-cols-[1.35fr_1fr]">
              <div>
                <div className="mb-6 flex h-7 w-full overflow-hidden border border-black" aria-label="Venue allocation">
                  {venueAllocation.map((venue) => (
                    <span key={venue.label} style={{ width: `${totalAssets ? (venue.value / totalAssets) * 100 : 0}%`, backgroundColor: venue.shade }} title={`${venue.label} ${formatMoney(venue.value, currency)}`} />
                  ))}
                </div>
                <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                  {venueAllocation.map((venue) => (
                    <div key={venue.label} className="flex items-center justify-between border-b border-neutral-200 pb-3">
                      <span className="flex items-center gap-2 text-sm"><span className="size-2.5" style={{ backgroundColor: venue.shade }} />{venue.label}</span>
                      <span className="text-sm font-medium tabular-nums">{totalAssets ? ((venue.value / totalAssets) * 100).toFixed(1) : "0.0"}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 border-l border-t border-neutral-300">
                {[
                  { label: "Spot", value: liveMode && portfolio ? portfolio.composition.spotKrw : 55_300_000 },
                  { label: "Derivatives", value: liveMode && portfolio ? portfolio.composition.derivativeEquityKrw : 14_400_000 },
                  { label: "Stable", value: liveMode && portfolio ? portfolio.composition.stableKrw : 12_550_000 },
                ].map((item, index) => (
                  <div key={item.label} className="border-b border-r border-neutral-300 px-4 py-5">
                    <p className="mb-5 text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">{item.label}</p>
                    <p className="text-xl font-semibold tabular-nums">{totalAssets ? ((item.value / totalAssets) * 100).toFixed(1) : "0.0"}%</p>
                    <div className="mt-4 h-1 bg-neutral-200"><div className="h-full bg-black" style={{ width: `${Math.min(100, totalAssets ? (item.value / totalAssets) * 100 * 2.2 : 0)}%`, opacity: 1 - index * 0.25 }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      case "positions":
        return (
          <div>
            <SectionHeading eyebrow="Derivatives" title="Open positions" note="Short hedges are shown in outline; directional longs are filled." />
            {renderPositions()}
          </div>
        )
      case "accounts":
        return (
          <div>
            <SectionHeading eyebrow="Connections" title="Connected accounts" note="One wallet and five exchange accounts, all in read-only mode." />
            {renderAccounts()}
          </div>
        )
      case "activity":
        return (
          <div>
            <SectionHeading eyebrow="Ledger" title="Recent activity" note="Internal transfers do not count as portfolio returns." />
            {renderActivity()}
          </div>
        )
      case "pnl":
        return (
          <div>
            <SectionHeading eyebrow="Attribution" title="P&L detail" note="Realized results remain separate from open-position movement." />
            <div className="grid border-l border-t border-neutral-300 sm:grid-cols-3">
              {[
                { label: "Realized · 30D", value: liveMode ? null : 2_184_000, detail: liveMode ? "Awaiting ledger backfill" : "42 closed trades" },
                { label: "Unrealized", value: liveMode ? displayAssets.reduce((sum, asset) => sum + asset.unrealizedPnl, 0) : 4_142_170, detail: `${displayAssets.filter((asset) => asset.unrealizedPnl !== 0).length} active assets` },
                { label: "Funding · 30D", value: liveMode ? null : 184_600, detail: liveMode ? "Awaiting funding history" : "Net received" },
              ].map((item) => (
                <div key={item.label} className="border-b border-r border-neutral-300 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500">{item.label}</p>
                  <p className="mt-8 text-2xl font-semibold tabular-nums">{item.value == null ? "—" : formatSignedMoney(item.value, currency)}</p>
                  <p className="mt-2 text-xs text-neutral-500">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )
    }
  }

  function renderStandaloneView() {
    if (activeView === "Assets") return renderAssetTable(true)
    if (activeView === "Positions") return renderPositions(true)
    if (activeView === "Accounts") return renderAccounts(true)
    if (activeView === "History") return renderActivity(true)
    if (activeView === "Settings") {
      return (
        <div>
          <SectionHeading eyebrow="Preferences" title="Settings" note="레이아웃은 이 기기에, 연결 키는 서버 암호화 저장소에 보관됩니다." />
          <div className="grid gap-px border border-neutral-300 bg-neutral-300 md:grid-cols-2">
            <div className="bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Base currency</p>
              <div className="mt-6 flex border border-neutral-300">
                {(["KRW", "USD"] as Currency[]).map((item) => (
                  <button key={item} onClick={() => setCurrency(item)} className={`h-10 flex-1 text-sm font-semibold ${currency === item ? "bg-black text-white" : "bg-white"}`}>{item}</button>
                ))}
              </div>
            </div>
            <div className="bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Layout</p>
              <p className="mt-3 text-sm leading-6 text-neutral-500">Reorder, hide, and restore dashboard sections directly from Overview.</p>
              <Button onClick={() => { setActiveView("Overview"); setEditMode(true) }} className="mt-6 rounded-none">Edit overview</Button>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  const navItems: View[] = ["Overview", "Assets", "Positions", "Accounts", "History", "Settings"]

  return (
    <SidebarProvider style={{ "--sidebar-width": "13rem" } as React.CSSProperties}>
      <Sidebar collapsible="offcanvas" className="border-neutral-300 bg-white">
        <SidebarHeader className="border-b border-neutral-300 p-0">
          <button type="button" onClick={() => setActiveView("Overview")} className="flex h-[88px] items-center gap-3 px-6 text-left">
            <span className="grid size-8 place-items-center bg-black text-xs font-bold tracking-[-0.08em] text-white">BL</span>
            <span>
              <span className="block text-sm font-semibold tracking-[-0.02em]">Black Ledger</span>
              <span className="mt-0.5 block text-[10px] uppercase tracking-[0.14em] text-neutral-500">Private portfolio</span>
            </span>
          </button>
        </SidebarHeader>
        <SidebarContent className="pt-6">
          <SidebarGroup className="p-3">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {navItems.map((item, index) => (
                  <SidebarMenuItem key={item}>
                    <SidebarMenuButton
                      isActive={activeView === item}
                      onClick={() => setActiveView(item)}
                      className="h-10 rounded-none px-3 data-[active=true]:bg-black data-[active=true]:text-white"
                    >
                      <span className={`w-5 text-[10px] tabular-nums ${activeView === item ? "text-neutral-300" : "text-neutral-400"}`}>{String(index + 1).padStart(2, "0")}</span>
                      <span>{item}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-neutral-300 p-5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500">{portfolio?.accounts.length ?? 0}/6 connected</span>
            <span className="inline-flex items-center gap-2 font-medium"><span className={`size-1.5 ${portfolio?.accounts.some((account) => account.status === "error") ? "border border-black" : "bg-black"}`} /> {portfolio?.accounts.some((account) => account.status === "error") ? "Check sync" : liveMode ? "Live" : "Ready"}</span>
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-neutral-400">Read only · AES-GCM encrypted</p>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-white">
        <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-neutral-300 bg-white/95 px-4 backdrop-blur md:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="rounded-none md:hidden" />
            <p className="text-sm font-semibold">{activeView}</p>
            <span className="hidden text-xs text-neutral-400 sm:inline">/</span>
            <span className="hidden text-xs uppercase tracking-[0.1em] text-neutral-500 sm:inline">{liveMode ? "Live data" : "Sample data"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs tabular-nums text-neutral-500 lg:inline">Synced {lastSync} KST</span>
            <Button variant="ghost" size="icon-sm" onClick={refreshData} className="rounded-none" aria-label="Refresh data">
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <div className="flex h-9 border border-neutral-300">
              {(["KRW", "USD"] as Currency[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCurrency(item)}
                  className={`min-w-12 px-2 text-xs font-semibold ${currency === item ? "bg-black text-white" : "bg-white text-neutral-500 hover:text-black"}`}
                >
                  {item}
                </button>
              ))}
            </div>
            {activeView === "Overview" ? (
              <Button
                variant={editMode ? "default" : "outline"}
                onClick={() => setEditMode((current) => !current)}
                className="h-9 rounded-none border-neutral-300 px-3 shadow-none"
              >
                {editMode ? <Check className="size-4" /> : <LayoutGrid className="size-4" />}
                <span className="hidden sm:inline">{editMode ? "Done" : "Edit layout"}</span>
              </Button>
            ) : null}
          </div>
        </header>

        <div className="w-full px-4 pb-16 md:px-8 lg:px-10">
          {portfolioError ? (
            <div className="mt-4 flex items-center justify-between gap-4 border border-black bg-neutral-50 px-4 py-3 text-sm">
              <span>Live sync notice · {portfolioError}</span>
              <button type="button" onClick={() => void loadPortfolio()} className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] underline underline-offset-4">Retry</button>
            </div>
          ) : null}
          {liveMode && portfolio?.warnings.length ? (
            <div className="mt-4 flex items-start gap-3 border border-black bg-neutral-50 px-4 py-3 text-sm" role="status">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">일부 계정이 합산되지 않았습니다.</p>
                <ul className="mt-1 space-y-1 text-xs leading-5 text-neutral-600">
                  {portfolio.warnings.slice(0, 4).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {activeView === "Overview" ? (
            <>
              {editMode ? (
                <div className="flex flex-col justify-between gap-3 border-b border-neutral-300 py-4 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3 text-sm">
                    <GripVertical className="size-4" />
                    <span className="font-medium">Layout editing</span>
                    <span className="text-neutral-500">Drag sections or use arrow controls.</span>
                  </div>
                  <Dialog open={addOpen} onOpenChange={setAddOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="h-9 rounded-none border-black shadow-none"><Plus className="size-4" /> Add widget</Button>
                    </DialogTrigger>
                    <DialogContent className="rounded-none border-black p-0 shadow-none sm:max-w-xl">
                      <DialogHeader className="border-b border-neutral-300 p-6">
                        <DialogTitle className="text-2xl tracking-[-0.04em]">Add widget</DialogTitle>
                        <DialogDescription>Restore a hidden section to your Overview.</DialogDescription>
                      </DialogHeader>
                      <div className="divide-y divide-neutral-300">
                        {hiddenWidgets.length ? hiddenWidgets.map((id) => (
                          <button key={id} type="button" onClick={() => showWidget(id)} className="flex w-full items-center justify-between gap-5 px-6 py-5 text-left transition-colors hover:bg-neutral-100">
                            <span>
                              <span className="block font-semibold">{WIDGET_LABELS[id].title}</span>
                              <span className="mt-1 block text-sm text-neutral-500">{WIDGET_LABELS[id].description}</span>
                            </span>
                            <Plus className="size-4 shrink-0" />
                          </button>
                        )) : <p className="p-6 text-sm text-neutral-500">Every widget is already visible.</p>}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              ) : null}

              {visibleOrder.length ? visibleOrder.map((id, index) => (
                <WidgetShell
                  key={id}
                  id={id}
                  editMode={editMode}
                  index={index}
                  total={visibleOrder.length}
                  onHide={hideWidget}
                  onMove={moveWidget}
                  onDragStart={setDraggedWidget}
                  onDrop={dropWidget}
                >
                  {renderWidget(id)}
                </WidgetShell>
              )) : (
                <div className="grid min-h-[65vh] place-items-center border-b border-neutral-300 text-center">
                  <div>
                    <Settings2 className="mx-auto mb-5 size-8" />
                    <h2 className="text-2xl font-semibold tracking-tight">Overview is empty</h2>
                    <p className="mt-2 text-sm text-neutral-500">Enter layout editing and add the sections you need.</p>
                    <Button onClick={() => setEditMode(true)} className="mt-6 rounded-none"><Plus className="size-4" /> Add widget</Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <section className="py-10 md:py-14">{renderStandaloneView()}</section>
          )}
        </div>

        <footer className="mt-auto flex flex-col justify-between gap-3 border-t border-neutral-300 px-4 py-5 text-xs text-neutral-500 sm:flex-row md:px-8 lg:px-10">
          <span>Black Ledger · Private portfolio</span>
          <span className="inline-flex items-center gap-2"><ArrowLeftRight className="size-3.5" /> KRW/USDT reference {(portfolio?.fxKrw ?? FX_RATE).toLocaleString("ko-KR")}</span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
