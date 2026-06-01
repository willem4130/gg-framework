export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function parseToolArguments(argsJson: string): Record<string, unknown> {
  if (!argsJson) return {};
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    const unwrapped = typeof parsed === "string" ? (JSON.parse(parsed) as unknown) : parsed;
    return isJsonObject(unwrapped) ? unwrapped : {};
  } catch {
    return {};
  }
}
