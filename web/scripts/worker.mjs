import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(webRoot, ".env.local"), override: true });

function getEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

const supabaseUrl = getEnv("SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
const secretKey = getEnv("SUPABASE_SECRET_KEY");
const generatorBaseUrl = process.env.GENERATOR_BASE_URL ?? "http://127.0.0.1:8787";
const jobSource = process.env.JOB_SOURCE || "production";

const r2Endpoint = getEnv("R2_ENDPOINT");
const r2AccessKeyId = getEnv("R2_ACCESS_KEY_ID");
const r2SecretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
const r2Bucket = getEnv("R2_BUCKET");

const supabase = createClient(supabaseUrl, secretKey);
const r2 = new S3Client({
  region: "auto",
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
  },
});

const mediaTokenSecret = process.env.MEDIA_TOKEN_SECRET ?? "";
const mediaBaseUrl = process.env.MEDIA_BASE_URL ?? "";

function base64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signMediaUrl(objectPath, ttlSec = 600) {
  if (!mediaTokenSecret || !mediaBaseUrl || !objectPath) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + ttlSec;
  const payload = `${objectPath}|${expSec}`;
  const sig = base64Url(crypto.createHmac("sha256", mediaTokenSecret).update(payload).digest());
  const base = mediaBaseUrl.endsWith("/") ? mediaBaseUrl.slice(0, -1) : mediaBaseUrl;
  return `${base}/${objectPath}?exp=${expSec}&sig=${sig}`;
}

/**
 * Extract dominant color from an image buffer using the same bucketing
 * algorithm as the client-side useDominantColor hook.
 * Returns raw "r, g, b" string (no saturation boost or lighten).
 */
async function extractDominantColor(imageBuffer) {
  try {
    const { data } = await sharp(imageBuffer)
      .resize(40, 40, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const buckets = {};
    for (let i = 0; i < data.length; i += 12) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r + g + b < 45 || r + g + b > 700) continue;
      const key = `${(r >> 5) << 5},${(g >> 5) << 5},${(b >> 5) << 5}`;
      if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0 };
      buckets[key].r += r;
      buckets[key].g += g;
      buckets[key].b += b;
      buckets[key].count++;
    }

    let best = { r: 60, g: 60, b: 80, count: 0 };
    for (const b of Object.values(buckets)) {
      if (b.count > best.count) best = b;
    }
    if (best.count === 0) return null;

    const rr = Math.round(best.r / best.count);
    const gg = Math.round(best.g / best.count);
    const bb = Math.round(best.b / best.count);
    return `${rr}, ${gg}, ${bb}`;
  } catch {
    return null;
  }
}

const presetAgentsPath = path.join(webRoot, "public", "agents", "agents.json");

/** 프리셋 agents.json + Supabase agents 테이블을 병합하여 에이전트 맵 반환. */
async function loadMergedAgentsMap() {
  const map = {};
  try {
    const raw = await fs.readFile(presetAgentsPath, "utf-8");
    const list = JSON.parse(raw);
    if (Array.isArray(list)) for (const a of list) if (a && a.id) map[a.id] = a;
  } catch (err) {
    console.warn("loadMergedAgentsMap: preset read failed", presetAgentsPath, err?.message || err);
  }
  // Supabase에서 유저 에이전트 직접 조회
  try {
    const { data, error } = await supabase
      .from("agents")
      .select("id, name, concept, personality, speaking_style, elevenlabs_voice_id");
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (row && row.id) {
          map[row.id] = {
            id: row.id,
            name: row.name ?? "",
            concept: row.concept ?? "",
            personality: row.personality ?? "",
            speaking_style: row.speaking_style ?? "",
            elevenlabs_voice_id: row.elevenlabs_voice_id ?? undefined,
          };
        }
      }
    }
  } catch (err) {
    console.warn("loadMergedAgentsMap: Supabase query failed", err?.message || err);
  }
  return map;
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? "")
  );
}

async function ensureAgentsExist(agentIds) {
  const ids = (agentIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean);
  const uuids = ids.filter(looksLikeUuid);
  if (uuids.length === 0) return;

  const { data, error } = await supabase
    .from("agents")
    .select("id")
    .in("id", uuids);
  if (error) {
    throw new Error(error.message || "Failed to load agents for clip generation");
  }

  const found = new Set((data ?? []).map((r) => r.id));
  for (const id of uuids) {
    if (!found.has(id)) {
      throw new Error(`Unknown agent id: ${id}`);
    }
  }
}

function slugifyTitle(title) {
  const base = String(title ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "clip";
}

async function resolveAgents(agentIds) {
  const ids = (agentIds ?? []).filter(Boolean);
  if (ids.length === 0) return [];
  const { data } = await supabase.from("agents").select("id, name").in("id", ids);
  const map = new Map((data ?? []).map((row) => [row.id, row.name]));
  return ids.map((id) => ({ id, name: map.get(id) ?? null }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 재배포/크래시 등으로 오래 동안 processing 상태인 잡을 다시 queued로 되돌림. */
async function requeueStaleProcessingJobs() {
  const minutes = Math.max(1, Number(process.env.WORKER_STALE_PROCESSING_MINUTES ?? "15") || 15);
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const { data: stale } = await supabase
    .from("jobs")
    .select("id")
    .eq("status", "processing")
    .lt("started_at", cutoff);
  if (!stale?.length) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("jobs")
    .update({ status: "queued", progress: 0, started_at: null, requeued_at: now, updated_at: now })
    .in("id", stale.map((r) => r.id));
  if (error) {
    console.warn("requeueStaleProcessingJobs failed:", error.message);
    return;
  }
  console.log(`Requeued ${stale.length} stale processing job(s) (older than ${minutes} min)`);
}

async function claimJob() {
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .eq("source", jobSource)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!job) return null;

  const now = new Date().toISOString();
  const { data: updated } = await supabase
    .from("jobs")
    .update({ status: "processing", progress: 5, started_at: now, updated_at: now })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  return updated ?? null;
}

/** Claim one script generation job (script_generation_jobs table). */
async function claimScriptJob() {
  const { data: job } = await supabase
    .from("script_generation_jobs")
    .select("*")
    .eq("status", "queued")
    .eq("source", jobSource)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!job) return null;
  const now = new Date().toISOString();
  const { data: updated } = await supabase
    .from("script_generation_jobs")
    .update({ status: "processing", progress: 50, started_at: now, updated_at: now })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  return updated ?? null;
}

async function markScriptJobFailed(scriptJobId, message) {
  const now = new Date().toISOString();
  await supabase
    .from("script_generation_jobs")
    .update({ status: "failed", error: message, updated_at: now })
    .eq("id", scriptJobId);
}

async function markJobFailed(jobId, message, creditLedgerId = null, payload = null) {
  const now = new Date().toISOString();
  await supabase
    .from("jobs")
    .update({ status: "failed", error: message, updated_at: now })
    .eq("id", jobId);

  if (creditLedgerId) {
    await supabase.rpc("release_job_credits", { p_ledger_id: creditLedgerId });
  }

  // EP.1 실패 시 시리즈 삭제 (크레딧은 위에서 이미 환불됨)
  const seriesId = payload?.series_id;
  const episodeNumber = payload?.episode_number;
  if (seriesId && episodeNumber === 1) {
    try {
      // 해당 시리즈에 이미 ready 클립이 있으면 삭제 안 함 (안전장치)
      const { count } = await supabase
        .from("clips")
        .select("id", { count: "exact", head: true })
        .eq("series_id", seriesId)
        .eq("status", "ready");
      if ((count ?? 0) === 0) {
        // 관련 잡 삭제
        await supabase.from("jobs").delete().filter("payload->>series_id", "eq", seriesId);
        // 시리즈 삭제
        await supabase.from("clip_series").delete().eq("id", seriesId);
        console.log(`[Worker] EP.1 failed — deleted series ${seriesId}`);
      }
    } catch (e) {
      console.warn(`[Worker] Failed to delete series ${seriesId} after EP.1 failure:`, e?.message ?? e);
    }
  }
}

/** Generator API 오류 시 응답 body/status에서 저장할 메시지 추출 (Supabase job.error용). */
function generatorErrorMessage(res, body, fallback = "Generator failed") {
  const detail = body?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length)
    return detail.map((d) => (typeof d === "object" && d?.msg ? d.msg : String(d))).join("; ") || fallback;
  if (res && !res.ok) return `Generator ${res.status} ${(res.statusText || "").trim()}`.trim() || fallback;
  return fallback;
}

async function processAgentJob(job) {
  const nowIso = () => new Date().toISOString();
  const updateJob = async (fields) => {
    await supabase.from("jobs").update({ ...fields, updated_at: nowIso() }).eq("id", job.id);
  };
  const isAbandoned = async () => {
    const { data } = await supabase
      .from("jobs")
      .select("status, error")
      .eq("id", job.id)
      .maybeSingle();
    return data?.status === "failed" && data?.error === "abandoned";
  };

  const payload = job.payload ?? {};
  const name = String(payload.name ?? "").trim();
  const concept = String(payload.concept ?? "").trim() || null;
  const personality = String(payload.personality ?? "").trim() || null;
  const speakingStyle = String(payload.speaking_style ?? "").trim() || null;
  const appearance = String(payload.appearance ?? "").trim() || null;
  const userIntroLine = String(payload.intro_line ?? "").trim() || null;
  let userVoiceId = String(payload.elevenlabs_voice_id ?? "").trim() || null;
  const language = String(payload.language ?? "").trim() || null;
  if (!name || (!concept && !personality)) {
    throw new Error("Missing agent payload");
  }

  await updateJob({ progress: 8 });
  if (await isAbandoned()) {
    return;
  }

  // generator에 전달할 body 구성
  await updateJob({ progress: 15 });
  const generatorBody = { name };
  if (concept) generatorBody.concept = concept;
  if (personality) generatorBody.personality = personality;
  if (speakingStyle) generatorBody.speaking_style = speakingStyle;
  if (appearance) generatorBody.appearance = appearance;
  if (userIntroLine) generatorBody.intro_line = userIntroLine;
  if (userVoiceId) generatorBody.elevenlabs_voice_id = userVoiceId;
  if (language) generatorBody.language = language;
  // AI Assist로 미리 생성된 spec이 있으면 전달 → generate_agent_spec() 스킵
  const preSpec = payload.pre_spec ?? null;
  if (preSpec && typeof preSpec === "object") {
    generatorBody.pre_spec = preSpec;
    console.log(`[Agent] Passing pre-generated spec (AI Assist) to generator`);
  }
  // 음성 미선택 시: voice_candidates를 generator에 전달 → generator 내부에서 LLM 음성 선택
  const voiceCandidates = payload.voice_candidates ?? null;
  if (!userVoiceId && voiceCandidates && voiceCandidates.length > 0) {
    generatorBody.voice_candidates = voiceCandidates;
    console.log(`[Agent] Passing ${voiceCandidates.length} voice candidates to generator`);
  }
  const alreadyUsedVoiceIds = Array.isArray(payload.already_used_voice_ids) ? payload.already_used_voice_ids : null;
  if (alreadyUsedVoiceIds && alreadyUsedVoiceIds.length > 0) {
    generatorBody.already_used_voice_ids = alreadyUsedVoiceIds;
    console.log(`[Agent] Excluding ${alreadyUsedVoiceIds.length} already-used voice(s) for variety`);
  }
  let res, body;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await fetch(`${generatorBaseUrl}/api/agents/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(generatorBody),
    });

    body = await res.json().catch(() => null);
    if (res.ok && body?.ok && body?.agent) break;

    const errDetail = body?.detail ?? "";
    const isTransient = [503, 429, 502].includes(res.status) || /UNAVAILABLE|high demand|overloaded/i.test(errDetail);
    if (isTransient && attempt < maxAttempts) {
      const waitSec = 2 ** attempt;
      console.warn(`[Agent] Generator ${res.status} (attempt ${attempt}/${maxAttempts}), retrying in ${waitSec}s...`);
      await sleep(waitSec * 1000);
      continue;
    }

    if (!res.ok) console.error("[Agent] Generator error:", res.status, res.statusText, body);
    throw new Error(generatorErrorMessage(res, body, "Generator failed"));
  }

  await updateJob({ progress: 40 });
  if (await isAbandoned()) {
    return;
  }

  await updateJob({ progress: 48 });
  const agent = body.agent ?? {};
  const agentConcept = String(agent.concept ?? "").trim() || concept || null;
  const agentPersonality = String(agent.personality ?? "").trim() || personality || null;
  const agentSpeakingStyle = String(agent.speaking_style ?? "").trim() || speakingStyle || null;
  const agentAppearance = String(agent.appearance ?? "").trim() || appearance || null;
  const rate = String(agent.rate ?? "").trim() || "+0%";
  const pitch = String(agent.pitch ?? "").trim() || "+0Hz";
  const introLine = userIntroLine || String(agent.intro_script ?? "").trim() || null;
  const elevenlabsVoiceId = userVoiceId || String(agent.elevenlabs_voice_id ?? "").trim() || null;

  // Upload avatar image to R2 (base64 from generator)
  let imageKey = null;
  let dominantColor = null;
  const imageB64 = agent.image_b64 ?? null;
  if (imageB64) {
    try {
      const imageBuffer = Buffer.from(imageB64, "base64");
      imageKey = `agents/${job.user_id}/${crypto.randomUUID()}.png`;
      await r2.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: imageKey,
          Body: imageBuffer,
          ContentType: "image/png",
        })
      );
      dominantColor = await extractDominantColor(imageBuffer);
      if (dominantColor) {
        console.log(`[Agent ${name}] Dominant color: ${dominantColor}`);
      }
    } catch {
      imageKey = null;
    }
  }

  // Upload intro.mp3 to R2 (base64 from generator)
  let introMp3Key = null;
  const introMp3B64 = agent.intro_mp3_b64 ?? null;
  if (introMp3B64) {
    try {
      const mp3Buffer = Buffer.from(introMp3B64, "base64");
      console.log(`[Agent ${name}] Decoded intro mp3: ${mp3Buffer.length} bytes`);
      introMp3Key = `agents/${job.user_id}/${crypto.randomUUID()}.mp3`;
      await r2.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: introMp3Key,
          Body: mp3Buffer,
          ContentType: "audio/mpeg",
        })
      );
      console.log(`[Agent ${name}] Intro mp3 uploaded to R2`);
    } catch (err) {
      console.error(`[Agent ${name}] Failed to upload intro mp3:`, err);
      introMp3Key = null;
    }
  }

  await updateJob({ progress: 70 });
  if (await isAbandoned()) {
    return;
  }

  const isPublic = payload.is_public !== false;
  const { data: inserted, error: insertErr } = await supabase
    .from("agents")
    .insert({
      user_id: job.user_id,
      name,
      concept: agentConcept,
      personality: agentPersonality,
      speaking_style: agentSpeakingStyle,
      appearance: agentAppearance,
      rate,
      pitch,
      intro_line: introLine,
      elevenlabs_voice_id: elevenlabsVoiceId,
      image_key: imageKey,
      intro_mp3: introMp3Key,
      is_public: isPublic,
      dominant_color: dominantColor,
      ...(language ? { language } : {}),
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    const message =
      insertErr?.message || insertErr?.details || insertErr?.hint || "Unknown error";
    throw new Error(`Failed to insert agent: ${message}`);
  }

  // 에이전트가 Supabase에 저장되었으므로 local_server.py가 직접 조회 가능
  await updateJob({ progress: 82 });

  await updateJob({ progress: 90 });
  if (await isAbandoned()) {
    return;
  }

  await supabase
    .from("jobs")
    .update({
      status: "succeeded",
      progress: 100,
      result: {
        type: "agent",
        agent_id: inserted.id,
        elevenlabs_voice_id: elevenlabsVoiceId || undefined,
      },
      updated_at: nowIso(),
    })
    .eq("id", job.id);
}

async function processClipJob(job) {
  const nowIso = () => new Date().toISOString();
  const updateJob = async (fields) => {
    await supabase.from("jobs").update({ ...fields, updated_at: nowIso() }).eq("id", job.id);
  };

  await updateJob({ progress: 5 });

  const payload = job.payload ?? {};
  await ensureAgentsExist([payload.agent1_id, payload.agent2_id]);
  await updateJob({ progress: 10 });
  const agentsMap = await loadMergedAgentsMap();
  const agent1 = agentsMap[payload.agent1_id];
  const agent2 = agentsMap[payload.agent2_id];
  const bodyPayload = {
    agent1_id: payload.agent1_id,
    agent2_id: payload.agent2_id,
    title: payload.title,
    setting: payload.setting || "",
    situation: payload.situation || "",
    core_emotion: payload.core_emotion || "",
    relationship_state: payload.relationship_state || "",
    tone: payload.tone || "",
  };
  if (Array.isArray(payload.script) && payload.script.length > 0) {
    bodyPayload.script = payload.script;
  }
  // 시리즈 연속 클립 컨텍스트
  if (payload.series_context) bodyPayload.series_context = payload.series_context;
  if (payload.arc_phase) bodyPayload.arc_phase = payload.arc_phase;
  if (payload.episode_number) bodyPayload.episode_number = payload.episode_number;
  if (payload.total_episodes) bodyPayload.total_episodes = payload.total_episodes;
  if (payload.relationship_context) bodyPayload.relationship_context = payload.relationship_context;
  // 시리즈 파이프라인 (문서/메모리)
  if (payload.series_document) bodyPayload.series_document = payload.series_document;
  if (payload.arc_document) bodyPayload.arc_document = payload.arc_document;
  if (payload.rolling_summary != null) bodyPayload.rolling_summary = payload.rolling_summary;
  if (payload.core_memory) bodyPayload.core_memory = payload.core_memory;
  if (payload.character_fsm) bodyPayload.character_fsm = payload.character_fsm;
  if (payload.episode_type) bodyPayload.episode_type = payload.episode_type;
  if (payload.episode_type_counts) bodyPayload.episode_type_counts = payload.episode_type_counts;
  if (payload.language) bodyPayload.language = payload.language;
  if (agent1 && agent2) {
    bodyPayload.agent1 = agent1;
    bodyPayload.agent2 = agent2;
    console.log("Generating clip:", job.id, "(sending agent1/agent2 in body, script:", bodyPayload.script ? "provided" : "generate", ", map size:", Object.keys(agentsMap).length + ")");
  } else {
    console.warn("Generating clip:", job.id, "- agent1 or agent2 missing in map (agent1_id:", payload.agent1_id, "agent2_id:", payload.agent2_id, "map keys sample:", Object.keys(agentsMap).slice(0, 5).join(", ") + ")");
  }
  await updateJob({ progress: 18 });
  console.log("[Clip] Calling generator:", `${generatorBaseUrl}/api/clips/create`, "| title:", bodyPayload.title, "| setting:", (bodyPayload.setting || "").slice(0, 80), "| agent1:", bodyPayload.agent1_id, "| agent2:", bodyPayload.agent2_id);
  const res = await fetch(`${generatorBaseUrl}/api/clips/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    if (!res.ok) console.error("[Clip] Generator error:", res.status, res.statusText, body);
    throw new Error(generatorErrorMessage(res, body, "Generator failed"));
  }

  await updateJob({ progress: 40 });

  const mp3B64 = body?.clip?.mp3_b64;
  if (!mp3B64) {
    throw new Error("Generator returned no mp3 data");
  }
  const fileBuffer = Buffer.from(mp3B64, "base64");

  const titleFromClip = body?.clip?.title ?? payload.title ?? "clip";
  const baseName = `${slugifyTitle(titleFromClip)}-${job.id}`;
  const r2Key = `clips/${job.user_id}/${baseName}.mp3`;
  await updateJob({ progress: 55 });
  console.log("Uploading audio:", r2Key, `(${fileBuffer.length} bytes)`);
  await r2.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: "audio/mpeg",
    })
  );

  await updateJob({ progress: 70 });

  let timingJsonKey = null;
  let backgroundImageKey = null;
  const transcriptJson = body?.clip?.transcript_json;
  const backgroundImageB64 = body?.clip?.background_image_b64 ?? body?.background_image_b64;

  // Upload transcript JSON and background image in parallel
  const uploadPromises = [];

  if (transcriptJson) {
    uploadPromises.push(
      (async () => {
        try {
          const agents = await resolveAgents([payload.agent1_id, payload.agent2_id]);
          const agentNames = agents.map((agent) => agent.name).filter(Boolean);
          const augmented = Array.isArray(transcriptJson)
            ? { lines: transcriptJson, agent_names: agentNames, agents }
            : { ...transcriptJson, agent_names: agentNames, agents };
          const jsonBuffer = Buffer.from(JSON.stringify(augmented, null, 2));
          timingJsonKey = `clips/${job.user_id}/${baseName}.json`;
          console.log("Uploading timing JSON:", timingJsonKey);
          await r2.send(
            new PutObjectCommand({
              Bucket: r2Bucket,
              Key: timingJsonKey,
              Body: jsonBuffer,
              ContentType: "application/json",
            })
          );
        } catch {
          timingJsonKey = null;
        }
      })()
    );
  }

  if (backgroundImageB64) {
    uploadPromises.push(
      (async () => {
        try {
          const imgBuffer = Buffer.from(backgroundImageB64, "base64");
          backgroundImageKey = `clips/${job.user_id}/${baseName}-bg.png`;
          console.log("Uploading background image:", backgroundImageKey, `(${imgBuffer.length} bytes)`);
          await r2.send(
            new PutObjectCommand({
              Bucket: r2Bucket,
              Key: backgroundImageKey,
              Body: imgBuffer,
              ContentType: "image/png",
            })
          );
        } catch (e) {
          console.error("Failed to upload background image (non-fatal):", e);
          backgroundImageKey = null;
        }
      })()
    );
  }

  if (uploadPromises.length > 0) {
    await updateJob({ progress: 76 });
    await Promise.all(uploadPromises);
  }

  await updateJob({ progress: 85 });

  const now = new Date().toISOString();
  const durationValue = Number(body?.clip?.duration_seconds);
  const durationSec = Number.isFinite(durationValue) ? Math.round(durationValue) : null;

  const clipInsertData = {
    owner_id: job.user_id,
    title: body?.clip?.title ?? null,
    r2_key: r2Key,
    transcript_key: timingJsonKey,
    mime_type: "audio/mpeg",
    duration_sec: durationSec,
    status: "ready",
    view_count: 0,
    published_at: now,
    agent1_id: payload.agent1_id ?? null,
    agent2_id: payload.agent2_id ?? null,
  };
  // 시리즈 연속 클립 컬럼 추가
  if (backgroundImageKey) clipInsertData.background_image_key = backgroundImageKey;
  if (payload.series_id) clipInsertData.series_id = payload.series_id;
  if (payload.episode_number) clipInsertData.episode_number = payload.episode_number;
  if (payload.arc_phase || body?.clip?.arc_phase) clipInsertData.arc_phase = body?.clip?.arc_phase ?? payload.arc_phase;
  // 시나리오/에피소드 타입 저장
  if (body?.clip?.scenario) clipInsertData.scenario = body.clip.scenario;
  if (body?.clip?.episode_type) clipInsertData.episode_type = body.clip.episode_type;
  if (payload.language) clipInsertData.language = payload.language;

  const { data: clip, error: clipErr } = await supabase
    .from("clips")
    .insert(clipInsertData)
    .select("id")
    .single();

  if (clipErr || !clip) {
    const message =
      clipErr?.message || clipErr?.details || clipErr?.hint || "Unknown error";
    console.error("Failed to insert clip:", clipErr);
    throw new Error(`Failed to insert clip: ${message}`);
  }

  // 시리즈 story_context 업데이트 (에피소드 요약 추가)
  if (payload.series_id && body?.clip?.episode_summary) {
    try {
      const { data: series } = await supabase
        .from("clip_series")
        .select("story_context")
        .eq("id", payload.series_id)
        .single();

      if (series) {
        const storyContext = Array.isArray(series.story_context) ? [...series.story_context] : [];
        storyContext.push({
          episode: payload.episode_number,
          title: payload.title ?? "",
          ...body.clip.episode_summary,
        });

        const updateFields = {
          story_context: storyContext,
          updated_at: now,
        };

        // 다음 에피소드 선택지 저장 (새 형식: {forced_next_type, options} / 구 형식: 배열)
        const nextOpts = body?.clip?.next_options;
        if (nextOpts) {
          if (typeof nextOpts === "object" && !Array.isArray(nextOpts)) {
            // 새 형식: {forced_next_type, options}
            updateFields.next_episode_options = nextOpts;
          } else if (Array.isArray(nextOpts) && nextOpts.length > 0) {
            // 레거시 배열 형식
            updateFields.next_episode_options = nextOpts;
          }
        }

        // 3계층 메모리 업데이트 (시리즈 파이프라인)
        const clipData = body.clip;
        if (clipData.rolling_summary != null) updateFields.rolling_summary = clipData.rolling_summary;
        if (clipData.core_memory) updateFields.core_memory = clipData.core_memory;
        if (clipData.character_fsm) updateFields.character_fsm = clipData.character_fsm;
        if (clipData.episode_type_counts) updateFields.episode_type_counts = clipData.episode_type_counts;

        await supabase
          .from("clip_series")
          .update(updateFields)
          .eq("id", payload.series_id);

        console.log(`[Series] Updated story_context for series ${payload.series_id}, episode ${payload.episode_number}`);
        if (updateFields.next_episode_options) {
          const opts = updateFields.next_episode_options;
          const count = Array.isArray(opts) ? opts.length : (opts.options?.length ?? 0);
          console.log(`[Series] Saved ${count} next episode options${opts.forced_next_type ? ` (forced: ${opts.forced_next_type})` : ""}`);
        }
        if (clipData.rolling_summary != null || clipData.core_memory || clipData.character_fsm) {
          console.log(`[Series] Updated 3-layer memory: rolling=${!!clipData.rolling_summary}, core=${!!clipData.core_memory}, fsm=${!!clipData.character_fsm}`);
        }
      }
    } catch (e) {
      console.warn("[Series] Failed to update story_context:", e);
    }
  }

  await updateJob({ progress: 92 });
  if (job.credit_ledger_id) {
    await supabase.rpc("capture_job_credits", { p_ledger_id: job.credit_ledger_id });
  }

  await supabase
    .from("jobs")
    .update({
      status: "succeeded",
      progress: 100,
      clip_id: clip.id,
      result: {
        generator_clip_id: body?.clip?.id ?? null,
        r2_key: r2Key,
        timing_json_key: timingJsonKey,
      },
      updated_at: now,
    })
    .eq("id", job.id);
}

async function processExportShortsJob(job) {
  const nowIso = () => new Date().toISOString();
  const updateJob = async (fields) => {
    await supabase.from("jobs").update({ ...fields, updated_at: nowIso() }).eq("id", job.id);
  };

  const payload = job.payload ?? {};
  const title = String(payload.title ?? "Untitled").trim();
  const r2Key = String(payload.r2_key ?? "");
  const transcriptKey = String(payload.transcript_key ?? "");
  const backgroundImageKey = payload.background_image_key ?? null;
  const noWatermark = !!payload.no_watermark;

  if (!r2Key || !transcriptKey) {
    throw new Error("Missing r2_key or transcript_key in payload");
  }

  await updateJob({ progress: 10 });

  // Signed URLs for MP3, transcript JSON, and background image
  const mp3Url = signMediaUrl(r2Key, 600);
  const jsonUrl = signMediaUrl(transcriptKey, 600);
  const bgImageUrl = backgroundImageKey ? signMediaUrl(backgroundImageKey, 600) : null;
  if (!mp3Url || !jsonUrl) {
    throw new Error("Failed to generate signed URLs");
  }

  await updateJob({ progress: 20 });

  // Fetch transcript JSON → extract speaker IDs + embedded agents
  let speakerIds = [];
  let embeddedAgents = [];
  try {
    const transcriptRes = await fetch(jsonUrl);
    if (transcriptRes.ok) {
      const raw = await transcriptRes.json();
      const lines = Array.isArray(raw) ? raw : (raw?.lines ?? raw?.transcript ?? []);
      if (!Array.isArray(raw) && Array.isArray(raw?.agents)) {
        embeddedAgents = raw.agents;
      }
      const seen = new Set();
      for (const line of lines) {
        const s = line?.speaker;
        if (s && s !== "sfx" && s !== "narration" && !seen.has(s)) {
          seen.add(s);
          speakerIds.push(s);
        }
      }
    }
  } catch {
    // proceed without speakers
  }

  // Resolve agent info (transcript embedded → Supabase → fallback)
  const agents = [];
  const resolvedIds = new Set();

  for (const ea of embeddedAgents) {
    if (ea.id && ea.id !== "sfx" && speakerIds.includes(ea.id)) {
      resolvedIds.add(ea.id);
      agents.push({ id: ea.id, name: ea.name ?? ea.id });
    }
  }

  if (speakerIds.length > 0) {
    const { data: agentRows } = await supabase
      .from("agents")
      .select("id, name, image_key, dominant_color")
      .in("id", speakerIds);

    for (const row of agentRows ?? []) {
      const avatarUrl = row.image_key
        ? signMediaUrl(String(row.image_key).replace(/^\//, ""), 600)
        : undefined;

      if (resolvedIds.has(row.id)) {
        const existing = agents.find((a) => a.id === row.id);
        if (existing) {
          existing.avatar_url = avatarUrl ?? undefined;
          if (row.name) existing.name = row.name;
          if (row.dominant_color) existing.dominant_color = row.dominant_color;
        }
      } else {
        resolvedIds.add(row.id);
        agents.push({
          id: row.id,
          name: row.name ?? row.id,
          avatar_url: avatarUrl ?? undefined,
          dominant_color: row.dominant_color ?? undefined,
        });
      }
    }

    for (const sid of speakerIds) {
      if (!resolvedIds.has(sid)) {
        agents.push({ id: sid, name: sid });
      }
    }
  }

  await updateJob({ progress: 30 });

  // Call generator
  console.log("Export shorts:", job.id, "title:", title, "agents:", agents.length);
  const res = await fetch(`${generatorBaseUrl}/api/clips/export-shorts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mp3_url: mp3Url, json_url: jsonUrl, title, agents, no_watermark: noWatermark, bg_image_url: bgImageUrl }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    console.error("[Export] Generator error:", res.status, res.statusText, errBody);
    throw new Error(generatorErrorMessage(res, errBody, "Generator export failed"));
  }

  await updateJob({ progress: 70 });

  // Upload MP4 to R2
  const mp4Buffer = Buffer.from(await res.arrayBuffer());
  const baseName = `${slugifyTitle(title)}-${job.id}`;
  const mp4R2Key = `exports/${job.user_id}/${baseName}.mp4`;
  console.log("Uploading export MP4:", mp4R2Key, `(${mp4Buffer.length} bytes)`);

  await r2.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: mp4R2Key,
      Body: mp4Buffer,
      ContentType: "video/mp4",
    })
  );

  await updateJob({ progress: 90 });

  // Mark succeeded
  await supabase
    .from("jobs")
    .update({
      status: "succeeded",
      progress: 100,
      result: {
        type: "export_shorts",
        r2_key: mp4R2Key,
      },
      updated_at: nowIso(),
    })
    .eq("id", job.id);
}

async function processScriptJob(scriptJob) {
  const nowIso = () => new Date().toISOString();
  const payload = scriptJob.payload ?? {};
  const body = {
    agent1_id: payload.agent1_id,
    agent2_id: payload.agent2_id,
    title: payload.title ?? "",
    setting: payload.setting ?? "",
    situation: payload.situation ?? "",
    core_emotion: payload.core_emotion ?? "",
    relationship_state: payload.relationship_state ?? "",
    tone: payload.tone ?? "",
  };
  // 시리즈 연속 클립 컨텍스트
  if (payload.series_context) body.series_context = payload.series_context;
  if (payload.arc_phase) body.arc_phase = payload.arc_phase;
  if (payload.episode_number) body.episode_number = payload.episode_number;
  if (payload.total_episodes) body.total_episodes = payload.total_episodes;
  if (payload.relationship_context) body.relationship_context = payload.relationship_context;
  // 시리즈 파이프라인
  if (payload.series_document) body.series_document = payload.series_document;
  if (payload.arc_document) body.arc_document = payload.arc_document;

  const res = await fetch(`${generatorBaseUrl}/api/clips/script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const msg = generatorErrorMessage(res, data, "Script generation failed");
    await markScriptJobFailed(scriptJob.id, msg);
    return;
  }
  await supabase
    .from("script_generation_jobs")
    .update({
      status: "succeeded",
      progress: 100,
      result: data.script ?? null,
      updated_at: nowIso(),
    })
    .eq("id", scriptJob.id);
}

async function processJob(job) {
  const payload = job.payload ?? {};
  if (payload.kind === "agent") {
    await processAgentJob(job);
    return;
  }
  if (payload.kind === "export_shorts") {
    await processExportShortsJob(job);
    return;
  }
  await processClipJob(job);
}

/** Script generation job 최대 maxScriptJobs개 순차 처리. */
async function runScriptCycle(maxScriptJobs) {
  for (let i = 0; i < maxScriptJobs; i++) {
    const scriptJob = await claimScriptJob();
    if (!scriptJob) break;
    try {
      await processScriptJob(scriptJob);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Script job failed";
      await markScriptJobFailed(scriptJob.id, message);
    }
  }
}

/** 한 사이클: 메인 job 1개 + 스크립트 job 여러 개. 메인 잡이 없으면 스크립트만 처리. */
async function runOneFullCycle() {
  const mainJob = await claimJob();
  if (mainJob) {
    try {
      await processJob(mainJob);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Worker failed";
      await markJobFailed(mainJob.id, message, mainJob.credit_ledger_id ?? null, mainJob.payload ?? null);
    }
  }
  await runScriptCycle(scriptJobsPerCycle);
}

/** 한 번에 잡 1개만 처리. HTTP 서버(Cron 트리거)에서 사용. */
export async function runOneCycle() {
  await requeueStaleProcessingJobs();
  const job = await claimJob();
  if (job) {
    try {
      await processJob(job);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Worker failed";
      await markJobFailed(job.id, message, job.credit_ledger_id ?? null, job.payload ?? null);
    }
    return;
  }
  await runScriptCycle(scriptJobsPerCycle);
}

const scriptJobsPerCycle = Math.min(
  20,
  Math.max(1, Number(process.env.WORKER_SCRIPT_JOBS_PER_CYCLE ?? "5") || 1)
);

const staleRequeueIntervalMs = 10 * 60 * 1000; // 10분마다 오래된 processing 재큐

async function run() {
  console.log("Worker started");
  console.log("Generator base URL:", generatorBaseUrl);
  console.log("Job source filter:", jobSource);
  console.log("Per cycle: 1 main job + up to", scriptJobsPerCycle, "script job(s)");
  await requeueStaleProcessingJobs();
  let lastRequeue = Date.now();
  while (true) {
    await runOneFullCycle();
    if (Date.now() - lastRequeue >= staleRequeueIntervalMs) {
      await requeueStaleProcessingJobs();
      lastRequeue = Date.now();
    }
    await sleep(2000);
  }
}

// WORKER_HTTP_PORT 또는 PORT(Railway 등)가 있으면 HTTP 서버만 띄움 (Vercel Cron → GET /run 호출용). 없으면 폴링 루프.
// WORKER_POLLING_MODE=true 이면 PORT가 있어도 폴링 루프를 백그라운드로 함께 실행 (Railway에서 상시 폴링용).
const httpPort = Number(process.env.WORKER_HTTP_PORT || process.env.PORT || "0");
const pollingMode = process.env.WORKER_POLLING_MODE === "true" || process.env.WORKER_POLLING_MODE === "1";

const workerCronSecret = process.env.WORKER_CRON_SECRET ?? process.env.CRON_SECRET ?? "";

function requireRunAuth(req, res) {
  if (!workerCronSecret) return true;
  const auth = req.headers?.authorization;
  if (auth === `Bearer ${workerCronSecret}`) return true;
  res.writeHead(401, { "Content-Type": "text/plain" });
  res.end("Unauthorized");
  return false;
}

if (httpPort > 0) {
  const http = await import("http");
  const server = http.createServer(async (req, res) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url === "/run" || url === "/") {
      if (!requireRunAuth(req, res)) return;
      try {
        await runOneCycle();
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      } catch (e) {
        console.error(e);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(e instanceof Error ? e.message : "error");
      }
    } else if (url === "/health" || url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(httpPort, "0.0.0.0", () => {
    console.log(`Worker HTTP on port ${httpPort} (GET /run = one cycle, GET /health = health check)`);
    if (pollingMode) {
      console.log("WORKER_POLLING_MODE=true: background polling loop started");
      run().catch((e) => {
        console.error("Worker polling loop error:", e);
      });
    }
  });
} else {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
