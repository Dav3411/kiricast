import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAgentByIdOrLegacy } from "@/lib/agentsDb";
import { buildSignedMediaUrl } from "@/lib/serverUtils";

export const runtime = "nodejs";

/**
 * GET /api/agents/[id]/avatar
 * 유저 생성 에이전트 이미지: image_key로 서명 URL을 만들어 302 리다이렉트.
 * id는 UUID 또는 legacy_preset_id.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const params = await context.params;
  const id = (params?.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  const { data, error } = await getAgentByIdOrLegacy(
    supabaseAdmin,
    id,
    "id, image_key"
  );

  if (error || !data?.image_key) {
    return NextResponse.json({ error: "Agent or image not found" }, { status: 404 });
  }

  const objectPath = String(data.image_key).replace(/^\//, "");
  const url = buildSignedMediaUrl(objectPath);
  if (!url) {
    return NextResponse.json(
      { error: "Media signing not configured" },
      { status: 503 }
    );
  }

  return NextResponse.redirect(url, 302);
}
