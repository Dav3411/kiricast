import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function getAdminSecret(req: Request) {
  return req.headers.get("x-admin-secret") ?? "";
}

function clamp(num: number, min: number, max: number) {
  return Math.min(max, Math.max(min, num));
}

function dayKey(iso: string) {
  // UTC day key
  return new Date(iso).toISOString().slice(0, 10);
}

function safeNumber(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base] ?? 0;
  return (sorted[base] ?? 0) + rest * ((sorted[base + 1] ?? 0) - (sorted[base] ?? 0));
}

function stats(values: number[]) {
  const cleaned = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const count = cleaned.length;
  const avg = count ? cleaned.reduce((a, b) => a + b, 0) / count : 0;
  const p50 = quantile(cleaned, 0.5);
  const p90 = quantile(cleaned, 0.9);
  return {
    count,
    avgSec: Math.round(avg),
    p50Sec: Math.round(p50),
    p90Sec: Math.round(p90),
  };
}

type JobRow = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  payload: unknown;
};

type EventRow = {
  event_name: string;
  created_at: string;
  properties: unknown;
};

type ClipRow = {
  owner_id: string;
  status: string;
  published_at: string | null;
};

type CreditRow = {
  amount: number;
  status: string;
  created_at: string;
};

function inferJobKind(payload: unknown): "agent" | "clip" | "other" {
  if (!payload || typeof payload !== "object") return "other";
  const p = payload as Record<string, unknown>;
  if (p.kind === "agent") return "agent";
  if (typeof p.agent1_id === "string" && typeof p.agent2_id === "string") return "clip";
  return "other";
}

async function fetchPaged<T>(
  makePage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown | null }>,
  maxRows: number
) {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await makePage(from, to);
    if (error) throw error;
    if (Array.isArray(data) && data.length > 0) out.push(...data);
    if (!Array.isArray(data) || data.length < pageSize) break;
  }
  return out;
}

export async function GET(req: Request) {
  const adminSecret = process.env.ADMIN_AGENTS_SECRET;
  if (!adminSecret || getAdminSecret(req) !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? "14");
  const days = clamp(Number.isFinite(daysRaw) ? daysRaw : 14, 1, 30);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const warnings: string[] = [];

  let jobs: JobRow[] = [];
  let events: EventRow[] = [];
  let clips: ClipRow[] = [];
  let creditLedger: CreditRow[] = [];

  try {
    jobs = await fetchPaged<JobRow>(
      async (from, to) => {
        const res = await supabaseAdmin
          .from("jobs")
          .select("id,status,error,created_at,started_at,updated_at,payload")
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .range(from, to);
        return { data: (res.data as JobRow[] | null) ?? null, error: res.error };
      },
      20000
    );
  } catch {
    warnings.push("Failed to load jobs");
  }

  const eventNames = ["share_open", "share_complete", "remix_start", "paywall_shown", "checkout_start"];
  try {
    events = await fetchPaged<EventRow>(
      async (from, to) => {
        const res = await supabaseAdmin
          .from("analytics_events")
          .select("event_name,created_at,properties")
          .gte("created_at", cutoff)
          .in("event_name", eventNames)
          .order("created_at", { ascending: false })
          .range(from, to);
        return { data: (res.data as EventRow[] | null) ?? null, error: res.error };
      },
      20000
    );
  } catch {
    warnings.push("Failed to load analytics_events (table missing?)");
  }

  try {
    clips = await fetchPaged<ClipRow>(
      async (from, to) => {
        const res = await supabaseAdmin
          .from("clips")
          .select("owner_id,status,published_at")
          .gte("published_at", cutoff)
          .order("published_at", { ascending: false })
          .range(from, to);
        return { data: (res.data as ClipRow[] | null) ?? null, error: res.error };
      },
      20000
    );
  } catch {
    warnings.push("Failed to load clips");
  }

  try {
    creditLedger = await fetchPaged<CreditRow>(
      async (from, to) => {
        const res = await supabaseAdmin
          .from("credit_ledger")
          .select("amount,status,created_at")
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .range(from, to);
        return { data: (res.data as CreditRow[] | null) ?? null, error: res.error };
      },
      20000
    );
  } catch {
    warnings.push("Failed to load credit_ledger");
  }

  const kinds: Array<"agent" | "clip"> = ["agent", "clip"];
  const jobTotalsByKind = new Map<"agent" | "clip", { created: number; succeeded: number; failed: number; inProgress: number }>(
    kinds.map((k) => [k, { created: 0, succeeded: 0, failed: 0, inProgress: 0 }])
  );
  const jobErrorsByKind = new Map<"agent" | "clip", Map<string, number>>(
    kinds.map((k) => [k, new Map<string, number>()])
  );
  const queueSecByKind = new Map<"agent" | "clip", number[]>(kinds.map((k) => [k, []]));
  const procSecByKind = new Map<"agent" | "clip", number[]>(kinds.map((k) => [k, []]));
  const totalSecByKind = new Map<"agent" | "clip", number[]>(kinds.map((k) => [k, []]));

  const jobDaily = new Map<
    string,
    {
      agent: { created: number; succeeded: number; failed: number };
      clip: { created: number; succeeded: number; failed: number };
    }
  >();

  for (const job of jobs) {
    const kind = inferJobKind(job.payload);
    if (kind !== "agent" && kind !== "clip") continue;
    const totals = jobTotalsByKind.get(kind)!;
    totals.created += 1;
    if (job.status === "succeeded") totals.succeeded += 1;
    else if (job.status === "failed") totals.failed += 1;
    else if (job.status === "queued" || job.status === "processing") totals.inProgress += 1;

    const dk = dayKey(job.created_at);
    const entry = jobDaily.get(dk) ?? {
      agent: { created: 0, succeeded: 0, failed: 0 },
      clip: { created: 0, succeeded: 0, failed: 0 },
    };
    entry[kind].created += 1;
    if (job.status === "succeeded") entry[kind].succeeded += 1;
    if (job.status === "failed") entry[kind].failed += 1;
    jobDaily.set(dk, entry);

    if (job.status === "failed") {
      const message = (job.error ?? "").trim() || "(no error)";
      const map = jobErrorsByKind.get(kind)!;
      map.set(message, (map.get(message) ?? 0) + 1);
    }

    if (job.started_at) {
      const queue = (new Date(job.started_at).getTime() - new Date(job.created_at).getTime()) / 1000;
      if (Number.isFinite(queue) && queue >= 0) queueSecByKind.get(kind)!.push(queue);
      const total =
        (new Date(job.updated_at).getTime() - new Date(job.created_at).getTime()) / 1000;
      if (Number.isFinite(total) && total >= 0) totalSecByKind.get(kind)!.push(total);
      const proc =
        (new Date(job.updated_at).getTime() - new Date(job.started_at).getTime()) / 1000;
      if (Number.isFinite(proc) && proc >= 0) procSecByKind.get(kind)!.push(proc);
    }
  }

  const creation = {
    agent: (() => {
      const t = jobTotalsByKind.get("agent")!;
      const successPct = t.created ? Math.round((1000 * t.succeeded) / t.created) / 10 : 0;
      return { ...t, successPct };
    })(),
    clip: (() => {
      const t = jobTotalsByKind.get("clip")!;
      const successPct = t.created ? Math.round((1000 * t.succeeded) / t.created) / 10 : 0;
      return { ...t, successPct };
    })(),
    agentTopErrors: Array.from(jobErrorsByKind.get("agent")!.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    clipTopErrors: Array.from(jobErrorsByKind.get("clip")!.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    daily: Array.from(jobDaily.entries())
      .map(([day, v]) => ({
        day,
        agent: {
          ...v.agent,
          successPct: v.agent.created
            ? Math.round((1000 * v.agent.succeeded) / v.agent.created) / 10
            : 0,
        },
        clip: {
          ...v.clip,
          successPct: v.clip.created ? Math.round((1000 * v.clip.succeeded) / v.clip.created) / 10 : 0,
        },
      }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
  };

  const latency = {
    agent: {
      queue: stats(queueSecByKind.get("agent")!),
      proc: stats(procSecByKind.get("agent")!),
      total: stats(totalSecByKind.get("agent")!),
    },
    clip: {
      queue: stats(queueSecByKind.get("clip")!),
      proc: stats(procSecByKind.get("clip")!),
      total: stats(totalSecByKind.get("clip")!),
    },
  };

  const supplyByDay = new Map<string, { clipsPublished: number; creators: Set<string> }>();
  for (const clip of clips) {
    if (!clip.published_at) continue;
    if (clip.status !== "ready") continue;
    const dk = dayKey(clip.published_at);
    const entry = supplyByDay.get(dk) ?? { clipsPublished: 0, creators: new Set<string>() };
    entry.clipsPublished += 1;
    if (clip.owner_id) entry.creators.add(clip.owner_id);
    supplyByDay.set(dk, entry);
  }
  const contentSupplyDaily = Array.from(supplyByDay.entries())
    .map(([day, v]) => ({ day, clipsPublished: v.clipsPublished, creators: v.creators.size }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const shareDaily = new Map<
    string,
    { shareOpen: number; shareComplete: number; remixStart: number; topClipCounts: Map<string, number> }
  >();
  const topClipCounts = new Map<string, number>();
  let paywallShown = 0;
  let checkoutStart = 0;
  for (const ev of events) {
    const dk = dayKey(ev.created_at);
    const entry =
      shareDaily.get(dk) ??
      {
        shareOpen: 0,
        shareComplete: 0,
        remixStart: 0,
        topClipCounts: new Map<string, number>(),
      };
    if (ev.event_name === "share_open") entry.shareOpen += 1;
    if (ev.event_name === "share_complete") {
      entry.shareComplete += 1;
      if (ev.properties && typeof ev.properties === "object") {
        const clipId = String((ev.properties as Record<string, unknown>).clipId ?? "").trim();
        if (clipId) {
          entry.topClipCounts.set(clipId, (entry.topClipCounts.get(clipId) ?? 0) + 1);
          topClipCounts.set(clipId, (topClipCounts.get(clipId) ?? 0) + 1);
        }
      }
    }
    if (ev.event_name === "remix_start") entry.remixStart += 1;
    if (ev.event_name === "paywall_shown") paywallShown += 1;
    if (ev.event_name === "checkout_start") checkoutStart += 1;
    shareDaily.set(dk, entry);
  }

  const shareDailyRows = Array.from(shareDaily.entries())
    .map(([day, v]) => ({
      day,
      shareOpen: v.shareOpen,
      shareComplete: v.shareComplete,
      shareCompletionPct: v.shareOpen ? Math.round((1000 * v.shareComplete) / v.shareOpen) / 10 : 0,
      remixStart: v.remixStart,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const shareTotals = shareDailyRows.reduce(
    (acc, row) => {
      acc.shareOpen += row.shareOpen;
      acc.shareComplete += row.shareComplete;
      acc.remixStart += row.remixStart;
      return acc;
    },
    { shareOpen: 0, shareComplete: 0, remixStart: 0 }
  );

  const topClips = Array.from(topClipCounts.entries())
    .map(([clipId, shareComplete]) => ({ clipId, shareComplete }))
    .sort((a, b) => b.shareComplete - a.shareComplete)
    .slice(0, 10);

  const share = {
    totals: {
      shareOpen: shareTotals.shareOpen,
      shareComplete: shareTotals.shareComplete,
      shareCompletionPct: shareTotals.shareOpen
        ? Math.round((1000 * shareTotals.shareComplete) / shareTotals.shareOpen) / 10
        : 0,
      remixStart: shareTotals.remixStart,
    },
    daily: shareDailyRows,
    topClips,
  };

  const creditsByDay = new Map<
    string,
    { creditsSpent: number; creditsReleased: number; capturedJobs: number; releasedJobs: number }
  >();
  for (const row of creditLedger) {
    const dk = dayKey(row.created_at);
    const entry =
      creditsByDay.get(dk) ??
      { creditsSpent: 0, creditsReleased: 0, capturedJobs: 0, releasedJobs: 0 };
    const amount = safeNumber(row.amount, 0);
    if (row.status === "captured") {
      entry.creditsSpent += amount;
      entry.capturedJobs += 1;
    }
    if (row.status === "released") {
      entry.creditsReleased += amount;
      entry.releasedJobs += 1;
    }
    creditsByDay.set(dk, entry);
  }
  const creditsDaily = Array.from(creditsByDay.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const creditsTotals = creditsDaily.reduce(
    (acc, row) => {
      acc.creditsSpent += row.creditsSpent;
      acc.creditsReleased += row.creditsReleased;
      acc.capturedJobs += row.capturedJobs;
      acc.releasedJobs += row.releasedJobs;
      return acc;
    },
    { creditsSpent: 0, creditsReleased: 0, capturedJobs: 0, releasedJobs: 0 }
  );

  const credits = { totals: creditsTotals, daily: creditsDaily };

  return NextResponse.json({
    ok: true,
    cutoff,
    days,
    creation,
    latency,
    contentSupplyDaily,
    share,
    credits,
    funnel: { paywallShown, checkoutStart },
    rows: {
      jobs: jobs.length,
      events: events.length,
      clips: clips.length,
      creditLedger: creditLedger.length,
    },
    warnings,
  });
}

