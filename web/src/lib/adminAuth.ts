/**
 * 관리자 API 접근 제어
 * - ADMIN_CREDITS_SECRET: 크레딧 관리 API용 시크릿 (필수)
 * - ADMIN_USER_IDS: 허용 유저 UUID 목록 (쉼표 구분). 비어 있으면 로그인만 검사.
 */

import { getUserIdFromToken } from "@/lib/authServer";

function getAdminSecret(req: Request): string {
  return req.headers.get("x-admin-secret") ?? "";
}

function getAdminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  if (!raw.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * 크레딧 관리 API: 시크릿 + 로그인 + (선택) 허용 목록 통과 시 true
 */
export async function requireCreditsAdmin(req: Request): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string }
> {
  const secret = process.env.ADMIN_CREDITS_SECRET;
  if (!secret || getAdminSecret(req) !== secret) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const { error: authErr, userId } = await getUserIdFromToken(token);
  if (authErr || !userId) {
    return { ok: false, status: 401, error: "Sign in required" };
  }

  const allowlist = getAdminAllowlist();
  if (allowlist.size === 0) {
    return { ok: false, status: 403, error: "ADMIN_USER_IDS not configured" };
  }
  if (!allowlist.has(userId.toLowerCase())) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, userId };
}
