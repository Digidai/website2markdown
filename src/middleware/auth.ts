// 认证相关函数

/** Timing-safe string comparison using HMAC. Does NOT leak length. */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const fixedKey = encoder.encode("timing-safe-compare-key");
  const key = await crypto.subtle.importKey(
    "raw",
    fixedKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig1 = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(a)));
  const sig2 = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(b)));
  let diff = sig1.length ^ sig2.length;
  for (let i = 0; i < sig1.length; i++) diff |= sig1[i] ^ sig2[i];
  return diff === 0;
}

export async function isAuthorizedByToken(
  request: Request,
  expectedToken: string,
  queryToken?: string | null,
): Promise<boolean> {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ") && await timingSafeEqual(auth.slice(7), expectedToken)) {
    return true;
  }
  if (queryToken && await timingSafeEqual(queryToken, expectedToken)) {
    return true;
  }
  return false;
}
