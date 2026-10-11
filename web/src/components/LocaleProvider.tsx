"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from "@/i18n/config";

export type LanguageSettings = {
  uiLanguage: Locale;
  creationLanguage: Locale;
  contentLanguages: Locale[];
};

type LocaleContextValue = LanguageSettings & {
  /** Update all language settings at once. Persists to DB (if logged in) + cookie. */
  updateLanguageSettings: (settings: Partial<LanguageSettings>) => Promise<void>;
  /** Shortcut: change only the UI language (triggers page reload). */
  setLocale: (locale: Locale) => Promise<void>;
  loaded: boolean;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

function getInitialLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  // 1. 쿠키에 저장된 값 우선
  const cookie = document.cookie
    .split("; ")
    .find((c) => c.startsWith("locale="));
  const val = cookie?.split("=")[1];
  if (val && SUPPORTED_LOCALES.includes(val as Locale)) return val as Locale;
  // 2. 브라우저 언어 자동 감지
  if (typeof navigator !== "undefined" && navigator.language) {
    const browserLang = navigator.language.split("-")[0] as Locale;
    if (SUPPORTED_LOCALES.includes(browserLang)) return browserLang;
  }
  return DEFAULT_LOCALE;
}

function setCookie(locale: string) {
  document.cookie = `locale=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth();
  const token = session?.access_token ?? "";

  const [settings, setSettings] = useState<LanguageSettings>(() => {
    const initial = getInitialLocale();
    return {
      uiLanguage: initial,
      creationLanguage: initial,
      contentLanguages: [initial],
    };
  });
  const [loaded, setLoaded] = useState(false);

  // Load settings from server when logged in
  useEffect(() => {
    if (!user || !token) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const ui = SUPPORTED_LOCALES.includes(data.uiLanguage) ? data.uiLanguage : settings.uiLanguage;
        const creation = SUPPORTED_LOCALES.includes(data.creationLanguage) ? data.creationLanguage : ui;
        const content: Locale[] = Array.isArray(data.contentLanguages)
          ? data.contentLanguages.filter((l: string) => SUPPORTED_LOCALES.includes(l as Locale))
          : [creation];
        // Ensure creation language is always in content languages
        if (!content.includes(creation)) content.unshift(creation);

        setSettings({ uiLanguage: ui, creationLanguage: creation, contentLanguages: content });
        setCookie(ui);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, token]);

  const updateLanguageSettings = useCallback(
    async (partial: Partial<LanguageSettings>) => {
      const next = { ...settings, ...partial };
      // Enforce: creation language always in content languages
      if (!next.contentLanguages.includes(next.creationLanguage)) {
        next.contentLanguages = [next.creationLanguage, ...next.contentLanguages];
      }
      setSettings(next);
      setCookie(next.uiLanguage);

      if (token) {
        try {
          await fetch("/api/profile", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              uiLanguage: next.uiLanguage,
              creationLanguage: next.creationLanguage,
              contentLanguages: next.contentLanguages,
            }),
          });
        } catch {
          // ignore
        }
      }

      // If UI language changed, reload to apply new translations
      if (partial.uiLanguage && partial.uiLanguage !== settings.uiLanguage) {
        window.location.reload();
      }
    },
    [settings, token],
  );

  const setLocale = useCallback(
    async (locale: Locale) => {
      await updateLanguageSettings({ uiLanguage: locale });
    },
    [updateLanguageSettings],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ ...settings, updateLanguageSettings, setLocale, loaded }),
    [settings, updateLanguageSettings, setLocale, loaded],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocaleSettings() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocaleSettings must be used within LocaleProvider");
  return ctx;
}
