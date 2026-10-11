"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { trackEvent } from "@/lib/analytics";
import { features } from "@/lib/featuresClient";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading } = useAuth();
  const t = useTranslations("login");
  const tc = useTranslations("common");

  const initialMode = searchParams?.get("mode") === "signup" ? "signup" : "login";
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [nickname, setNickname] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [policyModal, setPolicyModal] = useState<"terms" | "privacy" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [signupStep, setSignupStep] = useState<"form" | "verify">("form");
  const [pendingSignupEmail, setPendingSignupEmail] = useState("");
  const [pendingSignupNickname, setPendingSignupNickname] = useState("");
  const [verifyCode, setVerifyCode] = useState("");

  useEffect(() => {
    void trackEvent("page_view", { page: "login", mode });
    // keep in sync when query param changes mode
  }, [mode]);

  useEffect(() => {
    if (!loading && session) {
      const next = searchParams?.get("next") ?? "";
      const adminErr = searchParams?.get("admin_error");
      if (adminErr) router.replace(`/?admin_error=${adminErr}`);
      else if (next) router.replace(next);
      else router.replace("/");
    }
  }, [loading, session, router, searchParams]);

  useEffect(() => {
    if (searchParams?.get("mode") === "signup") {
      setMode("signup");
    } else if (searchParams?.get("mode") === "login") {
      setMode("login");
    }
  }, [searchParams]);

  // signup 페이지를 나갈 때 입력 내용 초기화
  useEffect(() => {
    if (mode === "login") {
      setEmail("");
      setPassword("");
      setPasswordConfirm("");
      setNickname("");
      setAgreedToTerms(false);
      setError(null);
      setSignupStep("form");
      setPendingSignupEmail("");
      setPendingSignupNickname("");
      setVerifyCode("");
    }
  }, [mode]);

  useEffect(() => {
    if (!features.referrals) return;
    const ref = searchParams?.get("ref") ?? "";
    if (ref && isUuid(ref) && typeof window !== "undefined") {
      try {
        window.localStorage.setItem("kiricast_referrer", ref);
      } catch {
        // ignore
      }
    }
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (err) throw err;
        void trackEvent("sign_in");
        router.replace("/");
      } else {
        if (password !== passwordConfirm) {
          setError(t("passwordMismatch"));
          setBusy(false);
          return;
        }
        if (password.length < 6) {
          setError(t("passwordTooShort"));
          setBusy(false);
          return;
        }
        const trimmedNick = nickname.trim();
        if (trimmedNick.length < 1 || trimmedNick.length > 32) {
          setError(t("nicknameInvalid"));
          setBusy(false);
          return;
        }
        const res = await fetch(`${window.location.origin}/api/auth/send-signup-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), nickname: trimmedNick }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to send code");
        setPendingSignupEmail(email.trim());
        setPendingSignupNickname(trimmedNick);
        setSignupStep("verify");
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message === "Token has expired or is invalid" ? t("codeExpired") : message);
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = verifyCode.trim().replace(/\s/g, "");
    if (code.length !== 6) {
      setError(t("enterVerifyCode"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${window.location.origin}/api/auth/confirm-signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: pendingSignupEmail,
          code,
          password,
          nickname: pendingSignupNickname,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create account");
      void trackEvent("sign_up");
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: pendingSignupEmail,
        password,
      });
      if (signInErr) throw signInErr;
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (token) {
          const profileRes = await fetch(`${window.location.origin}/api/profile`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ nickname: pendingSignupNickname }),
          });
          if (!profileRes.ok) {
            const body = (await profileRes.json()) as { error?: string };
            throw new Error(body.error ?? "Failed to save nickname");
          }
        }
      } catch (profileErr) {
        setError(profileErr instanceof Error ? profileErr.message : "Failed to save nickname");
        setBusy(false);
        return;
      }
      router.replace("/");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function onResendCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${window.location.origin}/api/auth/send-signup-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingSignupEmail, nickname: pendingSignupNickname }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to resend code");
      setVerifyCode("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to resend code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen text-zinc-100 flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="rounded-3xl p-8 backdrop-blur-xl bg-white/5 border border-white/10 shadow-2xl shadow-black/30">
        <div className="text-center flex flex-col items-center">
          <Logo width={160} height={34} textOnly />
          {signupStep === "verify" ? (
            <div className="text-sm text-zinc-400 mt-2">{t("verifyEmail")}</div>
          ) : null}
        </div>

        {mode === "signup" && signupStep === "verify" ? (
          <form className="mt-6 space-y-3" onSubmit={onVerifyCode}>
            <p className="text-sm text-zinc-300">
              {t("verifyEmailSent")} <strong className="text-zinc-100">{pendingSignupEmail}</strong>. {t("verifyEmailInstructions")}
            </p>
            <div>
              <label className="block text-sm text-zinc-400">{t("verificationCode")}</label>
              <input
                className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-400/50 text-center text-lg tracking-[0.4em] font-mono"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                required
              />
            </div>
            {error ? (
              <div className="text-sm text-red-400 border border-red-500/30 bg-red-900/20 rounded-lg p-3">
                {error}
              </div>
            ) : null}
            <button
              disabled={busy || verifyCode.trim().replace(/\s/g, "").length < 6}
              className="w-full rounded-3xl px-10 py-5 text-xl font-semibold shadow-lg shadow-emerald-400/25 disabled:opacity-50 cursor-pointer"
              style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
              type="submit"
            >
              {busy ? t("verifying") : t("verifyAndCreate")}
            </button>
            <p className="text-sm text-zinc-400 text-center">
              {t("didntGetCode")}{" "}
              <button
                type="button"
                className="underline hover:text-zinc-200 disabled:opacity-50"
                onClick={() => void onResendCode()}
                disabled={busy}
              >
                {t("resendCode")}
              </button>
            </p>
          </form>
        ) : (
        <form ref={formRef} className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-sm text-zinc-400">{t("email")}</label>
            <input
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-400/50"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400">{t("password")}</label>
            <input
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-400/50"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 6 : undefined}
            />
          </div>

          {mode === "signup" ? (
            <>
              <div>
                <label className="block text-sm text-zinc-400">{t("confirmPassword")}</label>
                <input
                  className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-400/50"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  placeholder={t("reenterPassword")}
                />
              </div>
              <p className="text-sm text-zinc-400">
                {t("agreeTermsPrefix")}{" "}
                <button type="button" onClick={() => setPolicyModal("terms")} className="text-emerald-400 hover:underline">
                  {tc("termsOfService")}
                </button>
                {" "}{t("and")}{" "}
                <button type="button" onClick={() => setPolicyModal("privacy")} className="text-emerald-400 hover:underline">
                  {tc("privacyPolicy")}
                </button>
                .
              </p>
              {policyModal ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-transparent" onClick={() => setPolicyModal(null)}>
                  <div
                    className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden border border-white/20 bg-zinc-900 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex shrink-0 items-center justify-end px-2 py-1 bg-zinc-900">
                      <button
                        type="button"
                        onClick={() => setPolicyModal(null)}
                        className="text-zinc-400 hover:text-zinc-100 p-2 rounded"
                        aria-label="Close"
                      >
                        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden bg-zinc-900">
                      <iframe
                        src={policyModal === "terms" ? "/terms/embed" : "/privacy/embed"}
                        title={policyModal === "terms" ? tc("termsOfService") : tc("privacyPolicy")}
                        className="w-full h-full min-h-[60vh] border-0 block"
                      />
                    </div>
                  </div>
                </div>
              ) : null}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-1 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30"
                />
                <span className="text-sm text-zinc-300">
                  {t("agreeTermsCheckbox")}
                </span>
              </label>
              <div>
                <label className="block text-sm text-zinc-400">{t("nickname")}</label>
                <input
                  className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-400/50"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  type="text"
                  autoComplete="username"
                  placeholder={t("nicknameChars")}
                  minLength={1}
                  maxLength={32}
                  required
                />
              </div>
            </>
          ) : null}

          {error ? (
            <div className="text-sm text-red-400 border border-red-500/30 bg-red-900/20 rounded-lg p-3">
              {error}
            </div>
          ) : null}

          <div className="pt-2" />
          <button
            disabled={
              busy ||
              (mode === "signup" && (!agreedToTerms || password !== passwordConfirm || password.length < 6))
            }
            className="w-full rounded-3xl px-10 py-5 text-xl font-semibold shadow-lg shadow-emerald-400/25 disabled:opacity-50 cursor-pointer"
            style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
            type="submit"
          >
            {busy ? t("working") : mode === "login" ? tc("signIn") : t("sendVerificationCode")}
          </button>

          {mode === "login" ? (
            <p className="text-sm text-zinc-400 text-center">
              {t("newToKiricast")}{" "}
              <Link
                href="/login?mode=signup"
                className="underline cursor-pointer text-emerald-400 hover:text-emerald-300"
              >
                {t("createAccount")}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-zinc-400 text-center">
              {t("alreadyHaveAccount")}{" "}
              <Link
                href="/login?mode=login"
                className="underline cursor-pointer text-emerald-400 hover:text-emerald-300"
              >
                {tc("signIn")}
              </Link>
            </p>
          )}
        </form>
        )}

        {mode === "signup" && signupStep === "verify" ? (
          <div className="mt-4 text-xs text-zinc-500">
            <button
              type="button"
              className="underline hover:text-zinc-300"
              onClick={() => {
                setSignupStep("form");
                setVerifyCode("");
                setError(null);
              }}
            >
              {t("useDifferentEmail")}
            </button>
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-zinc-500 bg-zinc-950">{tc("loading")}</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
