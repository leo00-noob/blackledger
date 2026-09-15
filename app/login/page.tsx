import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isValidSession, SESSION_COOKIE } from "@/lib/server/auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const store = await cookies();
  if (await isValidSession(store.get(SESSION_COOKIE)?.value)) redirect("/");
  return <LoginForm />;
}
