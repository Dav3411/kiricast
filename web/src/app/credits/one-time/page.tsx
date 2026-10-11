"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabaseClient";

function OneTimeCreditsPageContent() {
  const t = useTranslations("onetimeCredits");
  const tc = useTranslations("common");
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const success = searchParams.get("success") === "1";

  useEffect(() => {
    let mounted = true;
    async function loadToken() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setToken(data.session?.access_token ?? "");
    }
    loadToken();
    const { data: sub } = supabase.auth.onAuthStateChange((_e: string, session: { access_token?: string } | null) => {
      setToken(session?.access_token ?? "");
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleCheckout() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/credits/checkout-onetime", {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      const text = await res.text();
      let payload: { url?: string; error?: string } = {};
      if (text) {
        try {
          payload = JSON.parse(text) as { url?: string; error?: string };
        } catch {
          setError(t("invalidResponse"));
          return;
        }
      }
      if (!res.ok || !payload.url) {
        throw new Error(payload.error || t("paymentFailed"));
      }
      const url = payload.url.trim();
      const isAbsolute = url.startsWith("http://") || url.startsWith("https://");
      window.location.href = isAbsolute ? url : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("paymentFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto text-zinc-100 relative" style={{ background: "#0a0a0b" }}>
      <div className="max-w-3xl mx-auto px-6 py-12 relative z-10">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mb-6 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg backdrop-blur-xl bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 text-sm transition-all"
        >
          {tc("back")}
        </button>

        <div className="rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 p-7">
          <h1 className="text-2xl font-semibold text-gray-100">{t("pageTitle")}</h1>
          {success ? (
            <p className="mt-3 text-sm text-emerald-300">{t("paymentSuccess")}</p>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">
              {t("description")}
            </p>
          )}

          <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-900/20 p-5">
            <div className="text-sm text-emerald-300">{t("packLabel")}</div>
            <div className="mt-1 text-3xl font-black text-zinc-100">{t("creditsAmount")}</div>
            <div className="mt-1 text-zinc-300">{t("price")}</div>
          </div>

          <button
            type="button"
            className="mt-6 w-full rounded-xl backdrop-blur-xl px-4 py-3 font-semibold shadow-lg shadow-emerald-400/25 hover:brightness-110 transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
            onClick={handleCheckout}
            disabled={submitting || !token}
          >
            {submitting ? t("redirecting") : t("payWithPaypal")}
          </button>

          {!token ? (
            <p className="mt-3 text-sm text-amber-400">{t("loginRequired")}</p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default function OneTimeCreditsPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-zinc-500" style={{ background: "#0a0a0b" }}>{tc("loading")}</div>}>
      <OneTimeCreditsPageContent />
    </Suspense>
  );
}
