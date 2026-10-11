"use client";

import { useId } from "react";

export function LogoKiricast({ width = 180, height = 40 }: { width?: number; height?: number }) {
  const id = useId();
  const mintId = `${id}-kc-mint`;
  const mintFadeId = `${id}-kc-mintFade`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 260 48"
      fill="none"
      width={width}
      height={height}
    >
      <defs>
        <linearGradient id={mintId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A4F4CF" />
          <stop offset="100%" stopColor="#7CEDA3" />
        </linearGradient>
        <linearGradient id={mintFadeId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A4F4CF" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#7CEDA3" stopOpacity={0.25} />
        </linearGradient>
      </defs>

      {/* Left signal source */}
      <circle cx="10" cy="24" r="3" fill={`url(#${mintId})`} />
      {/* Left arcs (radiating right) */}
      <path d="M16 16a10.5 10.5 0 0 1 0 16" stroke={`url(#${mintId})`} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M21 10a17 17 0 0 1 0 28" stroke={`url(#${mintId})`} strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M26 4a24 24 0 0 1 0 40" stroke={`url(#${mintFadeId})`} strokeWidth="2.5" strokeLinecap="round" fill="none" />

      {/* Right signal source */}
      <circle cx="46" cy="24" r="3" fill={`url(#${mintId})`} />
      {/* Right arcs (radiating left, mirrored) */}
      <path d="M40 16a10.5 10.5 0 0 0 0 16" stroke={`url(#${mintId})`} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M35 10a17 17 0 0 0 0 28" stroke={`url(#${mintId})`} strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M30 4a24 24 0 0 0 0 40" stroke={`url(#${mintFadeId})`} strokeWidth="2.5" strokeLinecap="round" fill="none" />

      {/* KIRICAST text */}
      <text
        x="58"
        y="35"
        fontFamily="var(--font-space-grotesk), 'Space Grotesk', sans-serif"
        fontSize="34"
        fontWeight="500"
        letterSpacing="0.5"
        fill={`url(#${mintId})`}
      >
        KIRICAST
      </text>
    </svg>
  );
}
