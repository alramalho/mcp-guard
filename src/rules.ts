export function shouldBlock(
  args: Record<string, unknown>,
  patterns: string[]
): { blocked: boolean; pattern?: string } {
  const values = extractStrings(args);
  for (const pattern of patterns) {
    for (const value of values) {
      if (value.toLowerCase().includes(pattern.toLowerCase())) {
        return { blocked: true, pattern };
      }
    }
  }
  return { blocked: false };
}

function extractStrings(obj: unknown): string[] {
  const values: string[] = [];
  function walk(val: unknown): void {
    if (typeof val === "string") {
      values.push(val);
    } else if (Array.isArray(val)) {
      val.forEach(walk);
    } else if (val != null && typeof val === "object") {
      Object.values(val as Record<string, unknown>).forEach(walk);
    }
  }
  walk(obj);
  return values;
}
