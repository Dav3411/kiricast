/** Human-readable relative time string */
export function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min > 1 ? "s" : ""} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? "s" : ""} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day > 1 ? "s" : ""} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month > 1 ? "s" : ""} ago`;
  const year = Math.floor(month / 12);
  return `${year} year${year > 1 ? "s" : ""} ago`;
}

/** Format duration in seconds to display string */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return "--";
  return `${sec}s`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Resolve agent avatar URL */
export function getAgentAvatarUrl(agentId: string): string {
  if (UUID_RE.test(agentId)) {
    return `/api/agents/${encodeURIComponent(agentId)}/avatar`;
  }
  return `/agents/images/${agentId}.png`;
}
