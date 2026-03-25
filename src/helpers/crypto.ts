// 加密工具函数

export async function sha256Hex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => normalize(item));
    }
    if (input && typeof input === "object") {
      const obj = input as Record<string, unknown>;
      if (seen.has(obj)) {
        throw new Error("Cannot stable-stringify circular structures.");
      }
      seen.add(obj);
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        normalized[key] = normalize(obj[key]);
      }
      return normalized;
    }
    return input;
  };

  return JSON.stringify(normalize(value));
}
