import type { Metadata } from "next";
import ClipClient from "../[id]/ClipClient";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Discover · Kiricast",
  description: "Discover amazing clips on Kiricast.",
};

export default function ClipFeedPage() {
  return <ClipClient />;
}
