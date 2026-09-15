import { buildPortfolio } from "@/lib/server/portfolio";
import { ensureDatabase } from "@/db";
import { getApiUser, unauthorized } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getApiUser(request);
  if (!user) return unauthorized();
  await ensureDatabase();

  try {
    const portfolio = await buildPortfolio(user.id);
    return Response.json(portfolio, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "포트폴리오를 불러오지 못했습니다.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

