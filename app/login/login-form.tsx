"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

export function LoginForm() {
  const router = useRouter()
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error || "로그인에 실패했습니다.")
      router.replace("/")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-neutral-100">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl"
      >
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Black Ledger</p>
          <h1 className="mt-2 text-xl font-semibold">대시보드 잠금 해제</h1>
        </div>
        <label className="block space-y-2 text-sm">
          <span className="text-neutral-400">비밀번호</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-base outline-none focus:border-neutral-400"
          />
        </label>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button
          type="submit"
          disabled={pending || !password}
          className="w-full rounded-lg bg-neutral-100 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {pending ? "확인 중…" : "들어가기"}
        </button>
      </form>
    </main>
  )
}
