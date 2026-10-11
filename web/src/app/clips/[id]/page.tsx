import type { Metadata } from "next";
import ClipClient from "./ClipClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const { data } = await supabaseAdmin
      .from("clips")
      .select("title")
      .eq("id", id)
      .maybeSingle();
    const title = data?.title ?? "Clip";
    return {
      title: `${title} · Kiricast`,
      description: "Listen to a clip on Kiricast.",
      openGraph: {
        title: `${title} · Kiricast`,
        description: "Listen to a clip on Kiricast.",
        type: "website",
      },
    };
  } catch {
    return {
      title: "Clip · Kiricast",
      description: "Listen to a clip on Kiricast.",
    };
  }
}

export default async function ClipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClipClient id={id} />;
}

