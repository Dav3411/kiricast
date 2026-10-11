import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron에서 호출하는 엔드포인트.
 * CRON_SECRET으로 인증 후, WORKER_CRON_URL(외부 워커 서비스)을 호출해 잡 처리 한 사이클을 트리거합니다.
 * 워커·제너레이터는 Vercel에서 실행되지 않으므로 Railway/Render 등에 별도 배포한 뒤
 * 해당 서비스의 "한 번 실행" URL을 WORKER_CRON_URL에 설정하세요.
 *
 * 환경 변수:
 *   CRON_SECRET - Vercel Cron이 Bearer 토큰으로 보냄. 일치해야 200.
 *   WORKER_CRON_URL - 트리거할 URL (예: https://your-worker.railway.app/run)
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerUrl = process.env.WORKER_CRON_URL?.trim();
  if (!workerUrl) {
    return NextResponse.json(
      { ok: false, error: "WORKER_CRON_URL not set" },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(workerUrl, {
      method: "GET",
      headers: { "User-Agent": "Vercel-Cron-Wonka/1.0" },
      signal: AbortSignal.timeout(55_000),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, body: text.slice(0, 500) },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 }
    );
  }
}
