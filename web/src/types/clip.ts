/** Timing line from transcript JSON */
export type TimingLine = {
  speaker?: string;
  start?: number;
  end?: number;
  text?: string;
  type?: string;
};

/** Agent info embedded in timing data */
export type AgentInfo = {
  id: string;
  name: string;
  image_key?: string;
  dominant_color?: string;
};

/** Client-side clip shape (superset of all API response variants) */
export type ClipPayload = {
  id: string;
  title: string | null;
  durationSec: number | null;
  playbackUrl: string | null;
  timingUrl?: string | null;
  videoUrl?: string | null;
  /** 배경 이미지 URL */
  backgroundImageUrl?: string | null;
  likeCount?: number | null;
  liked?: boolean;
  ownerId?: string;
  publishedAt?: string;
  viewCount?: number;
  agent1Id?: string;
  agent2Id?: string;
  /** 시리즈 연속 클립 */
  seriesId?: string | null;
  seriesTitle?: string;
  episodeNumber?: number | null;
  arcPhase?: string | null;
  /** 시리즈 소유자 ID (삭제 권한 판단용) */
  seriesOwnerId?: string;
  /** 시리즈 내 이전/다음 에피소드 clip ID */
  prevEpisodeClipId?: string;
  nextEpisodeClipId?: string;
  /** 콘텐츠 언어 */
  language?: string;
};
