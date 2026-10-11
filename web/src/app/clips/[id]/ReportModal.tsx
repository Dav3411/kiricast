"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const REPORT_REASONS = [
  { value: "defamation", labelKey: "reportDefamation" },
  { value: "copyright", labelKey: "reportCopyright" },
  { value: "privacy", labelKey: "reportPrivacy" },
  { value: "inappropriate", labelKey: "reportInappropriate" },
  { value: "other", labelKey: "reportOther" },
] as const;

type ReportModalProps = {
  clipId: string;
  onClose: () => void;
};

export function ReportModal({ clipId, onClose }: ReportModalProps) {
  const t = useTranslations("clipViewer");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/clips/${encodeURIComponent(clipId)}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setDone(true);
    } catch {
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-2xl border border-white/15 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="text-center py-4">
            <div className="text-2xl mb-2">&#x2705;</div>
            <div className="text-sm text-zinc-200 font-medium">{t("reportSuccess")}</div>
            <div className="text-xs text-zinc-400 mt-1">{t("reportSuccessDesc")}</div>
            <button
              type="button"
              className="mt-4 w-full rounded-xl bg-white/10 py-2 text-sm text-zinc-200 hover:bg-white/20 transition"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="text-sm font-semibold text-zinc-100 mb-3">{t("reportTitle")}</div>
            <div className="flex flex-col gap-1.5">
              {REPORT_REASONS.map(({ value, labelKey }) => (
                <button
                  key={value}
                  type="button"
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition ${
                    reason === value
                      ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-200"
                      : "bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10"
                  }`}
                  onClick={() => setReason(value)}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-zinc-400 hover:bg-white/5 transition"
                onClick={onClose}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-red-500/80 py-2 text-sm text-white hover:bg-red-500 transition disabled:opacity-50"
                disabled={!reason || submitting}
                onClick={() => void handleSubmit()}
              >
                {submitting ? "Submitting\u2026" : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
