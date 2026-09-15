import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { isValidSession, SESSION_COOKIE } from "@/lib/server/auth"

import { Dashboard } from "./dashboard"

export const dynamic = "force-dynamic"

export default async function Home() {
  const store = await cookies()
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) redirect("/login")
  return <Dashboard />
}
