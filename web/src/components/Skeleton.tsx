"use client";

export function Skeleton({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded-md bg-zinc-700/50 ${className}`}
      {...props}
    />
  );
}

/** 클립 카드 1개 스켈레톤 (세로 피드용) */
export function ClipCardSkeleton() {
  return (
    <div className="h-full w-full min-h-[70vh] snap-start snap-always flex flex-col bg-zinc-950">
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div className="flex items-center justify-center gap-6">
          <Skeleton className="h-[7.5rem] w-[7.5rem] rounded-3xl md:h-[10.5rem] md:w-[10.5rem]" />
          <Skeleton className="h-[7.5rem] w-[7.5rem] rounded-3xl md:h-[10.5rem] md:w-[10.5rem]" />
        </div>
        <div className="w-full max-w-md space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="h-3 w-full bg-black">
        <Skeleton className="h-full w-1/3 rounded-none" />
      </div>
    </div>
  );
}

/** 피드 로딩: 클립 카드 스켈레톤 3개 */
export function ClipFeedSkeleton() {
  return (
    <>
      <ClipCardSkeleton />
      <ClipCardSkeleton />
      <ClipCardSkeleton />
    </>
  );
}

/** 목록/카드 그리드용 스켈레톤 (아바타 + 텍스트 줄) */
export function ListItemSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
      <div className="flex-1 min-w-0 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" style={{ maxWidth: i === 0 ? "80%" : "60%" }} />
        ))}
      </div>
    </div>
  );
}

/** 에이전트 카드 스켈레톤 (이미지 + 제목) */
export function AgentCardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-zinc-700/50 bg-zinc-900/50 aspect-[9/16] max-h-[320px] flex flex-col">
      <Skeleton className="flex-1 w-full min-h-0" />
      <div className="p-3">
        <Skeleton className="h-4 w-2/3 rounded" />
      </div>
    </div>
  );
}
