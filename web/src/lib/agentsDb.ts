/**
 * agents.id는 UUID 전용.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(id: string): boolean {
  return typeof id === "string" && UUID_REGEX.test(id.trim());
}

/**
 * id(UUID)로 에이전트 단일 행 반환.
 */
export async function getAgentByIdOrLegacy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  id: string,
  selectColumns: string,
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  const trimmed = id.trim();
  if (!trimmed) return { data: null, error: null };

  const result = await supabase
    .from("agents")
    .select(selectColumns)
    .eq("id", trimmed)
    .maybeSingle();

  return {
    data: result.data as Record<string, unknown> | null,
    error: result.error,
  };
}
