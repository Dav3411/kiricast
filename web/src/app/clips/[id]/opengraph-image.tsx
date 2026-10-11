import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage({ params }: { params: { id: string } }) {
  const id = params.id ?? "";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 64,
          background:
            "linear-gradient(135deg, rgba(16,185,129,1) 0%, rgba(132,204,22,1) 100%)",
          color: "white",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 900, letterSpacing: -2 }}>Kiricast</div>
        <div style={{ marginTop: 20, fontSize: 34, opacity: 0.95 }}>
          Shareable AI clip
        </div>
        <div style={{ marginTop: 30, fontSize: 22, opacity: 0.85 }}>
          Clip ID: {id}
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

