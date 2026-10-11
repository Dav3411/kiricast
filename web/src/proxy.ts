import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "";

function getAdminBasePath(): string {
  const raw = (process.env.ADMIN_BASE_PATH ?? "").trim().replace(/\/+$/, "");
  return raw ? (raw.startsWith("/") ? raw : "/" + raw) : "";
}

function getAdminAllowlist(): Set<string> {
  const raw = (process.env.ADMIN_USER_IDS ?? "").trim();
  if (!raw) return new Set();
  // 쉼표·줄바꿈·공백으로 구분, 공백 제거 후 소문자로 통일
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return new Set(ids);
}

const REWRITE_HEADER = "x-internal-admin-rewrite";

/** next 파라미터가 안전한 상대 경로인지 검증. 외부 URL이면 "/" 반환. */
function sanitizeNext(raw: string): string {
  const trimmed = raw.trim();
  // URL 인코딩(%2f 등)을 디코딩한 결과도 검사하여 우회 차단
  let decoded: string;
  try { decoded = decodeURIComponent(trimmed); } catch { return "/"; }
  if (
    decoded.startsWith("/") &&
    !decoded.startsWith("//") &&
    !/^\/\\/.test(decoded)
  ) {
    return trimmed;
  }
  return "/";
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 1) 공개 /admin 경로 폐쇄 — 직접 접근 시 404. (rewrite로 들어온 내부 요청은 통과)
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (request.headers.get(REWRITE_HEADER) === "1") {
      return NextResponse.next();
    }
    return new NextResponse("Not Found", { status: 404 });
  }

  const ADMIN_BASE_PATH = getAdminBasePath();

  // 2) 시크릿 베이스 경로가 없으면 admin 기능 비활성화
  if (!ADMIN_BASE_PATH) {
    return NextResponse.next();
  }
  if (pathname === ADMIN_BASE_PATH) {
    return NextResponse.redirect(new URL(ADMIN_BASE_PATH + "/credits", request.url));
  }
  if (!pathname.startsWith(ADMIN_BASE_PATH + "/")) {
    return NextResponse.next();
  }

  const allowlist = getAdminAllowlist();
  if (allowlist.size === 0) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", sanitizeNext(pathname));
    loginUrl.searchParams.set("admin_error", "no_allowlist");
    return NextResponse.redirect(loginUrl);
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        request.cookies.set({ name, value, ...options });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: Record<string, unknown>) {
        request.cookies.delete(name);
        response.cookies.set({ name, value: "", maxAge: 0, ...options });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", sanitizeNext(pathname));
    return NextResponse.redirect(loginUrl);
  }

  if (!allowlist.has(user.id.toLowerCase())) {
    const homeUrl = new URL("/", request.url);
    homeUrl.searchParams.set("admin_error", "not_allowed");
    return NextResponse.redirect(homeUrl);
  }

  // 3) 시크릿 경로 → 내부 /admin 경로로 리라이트. 헤더로 표시해 재진입 시 404 방지.
  const suffix = pathname.slice(ADMIN_BASE_PATH.length) || "/";
  const url = request.nextUrl.clone();
  url.pathname = `/admin${suffix}`;
  const headers = new Headers(request.headers);
  headers.set(REWRITE_HEADER, "1");
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  // 정적·이미지 제외한 모든 경로에서 proxy 실행. 실제 admin/시크릿 처리는 내부에서 pathname으로만 판단하므로
  // ADMIN_BASE_PATH를 matcher에 넣지 않아도 되고, Git에 경로가 노출되지 않음.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
