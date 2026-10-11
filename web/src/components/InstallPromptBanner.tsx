"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { vibrateLight } from "@/lib/haptic";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STORAGE_KEY = "kiricast-pwa-dismissed";
const DISMISS_DAYS = 7;

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (nav.standalone === true) ||
    (document.referrer.includes("android-app://") === true)
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

function wasDismissedRecently(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function InstallPromptBanner() {
  const t = useTranslations("installBanner");
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [iosInstructionsOpen, setIosInstructionsOpen] = useState(false);

  useEffect(() => {
    if (isDesktop() || isStandalone() || wasDismissedRecently()) {
      setVisible(false);
      return;
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // iOS: no beforeinstallprompt; show manual instructions
    if (isIOS()) {
      setVisible(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const dismiss = useCallback(() => {
    vibrateLight();
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {
      /* ignore */
    }
    setVisible(false);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    vibrateLight();
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setVisible(false);
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt]);

  if (!visible) return null;

  const canInstall = !!deferredPrompt && !isIOS();
  const showIosGuide = isIOS();

  return (
    <div
      className="rounded-xl border border-emerald-500/25 bg-emerald-950/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
      role="region"
      aria-label="Add to Home Screen"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="shrink-0 w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center text-lg" aria-hidden>
          📱
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">
            {t("useLikeApp")}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {canInstall
              ? t("addHomeScreenBetter")
              : showIosGuide
                ? t("addHomeScreenSafari")
                : t("installSupportedBrowsers")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canInstall && (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
              color: "#002e1f",
            }}
          >
            {installing ? t("installing") : t("install")}
          </button>
        )}
        {showIosGuide && (
          <button
            type="button"
            onClick={() => {
              vibrateLight();
              setIosInstructionsOpen((v) => !v);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 border border-white/20 text-zinc-200 hover:bg-white/15 transition"
          >
            {t("howToAdd")}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {showIosGuide && iosInstructionsOpen && (
        <div className="w-full mt-2 pt-3 border-t border-white/10 text-left">
          <p className="text-xs text-zinc-400">
            <strong className="text-zinc-300">{t("iosLabel")}</strong> {t("iosInstructions")}
          </p>
        </div>
      )}
    </div>
  );
}
