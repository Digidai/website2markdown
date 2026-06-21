import type { AuthContext, Env, PolicyDecision, Tier } from "../types";
import { TIER_QUOTAS } from "../types";
import { CORS_HEADERS } from "../config";
import { timingSafeEqual } from "./auth";
import { resolveAuth } from "./auth-d1";
import { buildPolicy, checkPolicy } from "./tier-gate";

export interface ApiAccessContext {
  auth: AuthContext;
  policy: PolicyDecision;
  legacyToken: boolean;
}

interface ApiAccessParams {
  forceBrowser?: boolean;
  noCache?: boolean;
  engine?: string;
}

function legacyAuthContext(): AuthContext {
  const tier: Tier = "pro";
  return {
    tier,
    accountId: null,
    keyId: null,
    quotaLimit: TIER_QUOTAS[tier],
    quotaUsed: 0,
  };
}

async function isLegacyAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.API_TOKEN) return false;
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") && await timingSafeEqual(auth.slice(7), env.API_TOKEN);
}

function unauthorized(message: string = "Valid Bearer token required"): Response {
  return Response.json(
    { error: "Unauthorized", message },
    { status: 401, headers: CORS_HEADERS },
  );
}

function serviceMisconfigured(): Response {
  return Response.json(
    { error: "Service misconfigured", message: "API_TOKEN not set and no valid D1 API key was provided." },
    { status: 503, headers: CORS_HEADERS },
  );
}

export async function authorizeApiAccess(
  request: Request,
  env: Env,
  route: string,
  params: ApiAccessParams = {},
): Promise<ApiAccessContext | Response> {
  if (env.AUTH_DB) {
    const auth = await resolveAuth(request, env);
    if (auth.tier !== "anonymous") {
      const policy = buildPolicy(auth, route);
      const policyError = checkPolicy(policy, params);
      if (policyError) return unauthorized(policyError);
      if (policy.quotaRemaining <= 0) {
        return Response.json(
          {
            error: "Quota Exceeded",
            message: `Monthly quota of ${auth.quotaLimit} credits exhausted. Upgrade your plan at /portal/.`,
          },
          { status: 429, headers: CORS_HEADERS },
        );
      }
      return { auth, policy, legacyToken: false };
    }
  }

  if (await isLegacyAuthorized(request, env)) {
    const auth = legacyAuthContext();
    return { auth, policy: buildPolicy(auth, route), legacyToken: true };
  }

  if (env.AUTH_DB || env.API_TOKEN) {
    return unauthorized();
  }
  return serviceMisconfigured();
}

export function sessionProfileScopeForAuth(auth?: AuthContext | null): string | undefined {
  if (!auth || auth.tier === "anonymous") return undefined;
  if (auth.accountId) return `account:${auth.accountId}`;
  if (auth.keyId) return `key:${auth.keyId}`;
  return undefined;
}
