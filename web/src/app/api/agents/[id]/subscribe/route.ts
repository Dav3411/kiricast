import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

async function getAgentSubscriberCount(agentId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("agents")
    .select("subscriber_count")
    .eq("id", agentId)
    .maybeSingle();
  return data?.subscriber_count != null ? Number(data.subscriber_count) : 0;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const { error: authError, userId } = await requireUserId(req);
  if (authError || !userId) {
    return NextResponse.json({ error: authError ?? "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const agentId = params?.id?.trim() ?? "";
  if (!agentId) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  // Verify agent exists and is public (or owned by user)
  const { data: agent, error: agentErr } = await supabaseAdmin
    .from("agents")
    .select("id, is_public, user_id")
    .eq("id", agentId)
    .maybeSingle();

  if (agentErr || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (agent.is_public === false && agent.user_id !== userId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  await supabaseAdmin
    .from("agent_subscriptions")
    .upsert({ agent_id: agentId, user_id: userId }, { onConflict: "agent_id,user_id" });

  const subscriberCount = await getAgentSubscriberCount(agentId);
  return NextResponse.json({ subscribed: true, subscriberCount });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const { error: authError, userId } = await requireUserId(req);
  if (authError || !userId) {
    return NextResponse.json({ error: authError ?? "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const agentId = params?.id?.trim() ?? "";
  if (!agentId) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  await supabaseAdmin
    .from("agent_subscriptions")
    .delete()
    .eq("agent_id", agentId)
    .eq("user_id", userId);

  const subscriberCount = await getAgentSubscriberCount(agentId);
  return NextResponse.json({ subscribed: false, subscriberCount });
}
