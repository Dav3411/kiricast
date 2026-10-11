"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminTabId =
  | "accounts-delete"
  | "accounts-plan"
  | "credits"
  | "metrics"
  | "plan-payments"
  | "content";

const TABS: { id: AdminTabId; label: string; path: string }[] = [
  { id: "accounts-delete", label: "계정 삭제", path: "/accounts?tab=delete" },
  { id: "accounts-plan", label: "플랜 변경", path: "/accounts?tab=plan" },
  { id: "credits", label: "Credits", path: "/credits" },
  { id: "plan-payments", label: "플랜 결제", path: "/plan-payments" },
  { id: "metrics", label: "Metrics", path: "/metrics" },
  { id: "content", label: "클립·시리즈 삭제", path: "/content" },
];

/** 시크릿 베이스 경로(예: /_fic)를 pathname에서 추출. 직접 /admin 접근 시에는 /admin 사용 */
function getAdminBasePath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return pathname || "/admin";
  return "/" + segments.slice(0, -1).join("/");
}

type Props = { current: AdminTabId };

export function AdminNavTabs({ current }: Props) {
  const pathname = usePathname() ?? "";
  const base = getAdminBasePath(pathname);

  return (
    <nav
      className="flex flex-wrap gap-2 mb-6 overflow-visible"
      aria-label="관리자 메뉴"
    >
      {TABS.map((tab) => {
        const isActive = current === tab.id;
        const href = base + tab.path;
        return (
          <Link
            key={tab.id}
            href={href}
            className={
              "shrink-0 min-w-[4.5rem] text-center px-4 py-2.5 rounded-xl text-sm font-medium transition-colors border-2 border-emerald-300/60 " +
              (isActive
                ? "bg-emerald-100 text-emerald-900 border-emerald-400 shadow-sm"
                : "bg-transparent text-zinc-700 hover:bg-emerald-50/80 hover:text-zinc-900 hover:border-emerald-300")
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
