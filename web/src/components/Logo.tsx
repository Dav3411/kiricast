"use client";

import { Poppins } from "next/font/google";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

function LogoIcon({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      style={{ display: "block" }}
    >
      <defs>
        <mask id="logo-green-mask">
          <rect width="200" height="200" fill="white" />
          <circle cx="125" cy="73" r="52" fill="black" />
        </mask>
      </defs>
      <circle cx="125" cy="73" r="44" fill="#8b5cf6" />
      <circle cx="100" cy="102" r="62" fill="#34d399" mask="url(#logo-green-mask)" />
    </svg>
  );
}

export function Logo({
  width = 140,
  height = 30,
  textOnly = false,
}: {
  width?: number;
  height?: number;
  textOnly?: boolean;
}) {
  const baseSize = Math.min(width, height);
  const iconSize = baseSize * 0.7;
  const fontSize = baseSize * 0.8;

  return (
    <span className="inline-flex items-center gap-1.5" style={{ height }}>
      {!textOnly && (
        <LogoIcon size={iconSize} />
      )}
      <span
        className="font-medium tracking-tight"
        suppressHydrationWarning
        style={{
          fontSize,
          fontFamily: poppins.style.fontFamily,
          backgroundImage: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        KIRICAST
      </span>
    </span>
  );
}
