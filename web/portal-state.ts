/**
 * Session state machine of the developer portal.
 *
 *   checking ──meLoaded──▶ signedIn ──signedOut / sessionExpired──▶ signedOut
 *      │  └──meUnauthorized──▶ signedOut
 *      └──meFailed──▶ unavailable ──retry──▶ checking
 *
 * While signed in, usage and keys load on their own: each is loading, ready,
 * or failed, so a failed request is never shown as real data such as "0 / 0".
 * Plain TypeScript (no DOM) so the Worker tests can import it.
 */

export interface Session { email: string; tier: string; account_id?: string }
export interface Usage { tier: string; quota: number; used: number; remaining: number }
export interface ApiKey { id: string; name: string | null; prefix: string; created_at: string; active: boolean }
export type Banner = { status: "success" | "danger"; text: string } | null;

export type Loadable<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "failed" };

export type PortalState =
  | { phase: "checking" }
  | { phase: "unavailable" }
  | { phase: "signedOut"; banner: Banner }
  | { phase: "signedIn"; session: Session; usage: Loadable<Usage>; keys: Loadable<ApiKey[]> };

export type PortalEvent =
  | { type: "meLoaded"; session: Session }
  | { type: "meUnauthorized" }
  | { type: "meFailed" }
  | { type: "retry" }
  | { type: "usageLoading" }
  | { type: "usageLoaded"; usage: Usage }
  | { type: "usageFailed" }
  | { type: "keysLoading" }
  | { type: "keysLoaded"; keys: ApiKey[] }
  | { type: "keysFailed" }
  /** Any request answered 401 while signed in. */
  | { type: "sessionExpired" }
  | { type: "signedOut" };

export const SIGN_IN_ERRORS: Record<string, string> = {
  invalid_token: "This sign-in link is invalid.",
  link_expired: "This sign-in link has expired. Please request a new one.",
  link_already_used: "This sign-in link has already been used.",
  service_unavailable: "Sign-in service is temporarily unavailable.",
  internal_error: "Something went wrong. Please try again.",
};

export const SESSION_EXPIRED_TEXT = "Your session has expired. Sign in again to continue.";

/** First state: without a session cookie /api/me can only answer 401, so the sign-in form shows at once. */
export function initialPortalState(hasSession: boolean, error?: string): PortalState {
  if (hasSession) return { phase: "checking" };
  return { phase: "signedOut", banner: error ? { status: "danger", text: SIGN_IN_ERRORS[error] || "Sign-in failed." } : null };
}

export function portalReducer(state: PortalState, event: PortalEvent): PortalState {
  switch (state.phase) {
    case "checking":
      if (event.type === "meLoaded") return { phase: "signedIn", session: event.session, usage: { status: "loading" }, keys: { status: "loading" } };
      if (event.type === "meUnauthorized") return { phase: "signedOut", banner: null };
      if (event.type === "meFailed") return { phase: "unavailable" };
      return state;
    case "unavailable":
      return event.type === "retry" ? { phase: "checking" } : state;
    case "signedOut":
      return state;
    case "signedIn":
      switch (event.type) {
        case "usageLoading":
          return { ...state, usage: { status: "loading" } };
        case "usageLoaded":
          return { ...state, usage: { status: "ready", value: event.usage } };
        case "usageFailed":
          return { ...state, usage: { status: "failed" } };
        case "keysLoading":
          // Keep showing the current list while it refreshes.
          return state.keys.status === "ready" ? state : { ...state, keys: { status: "loading" } };
        case "keysLoaded":
          return { ...state, keys: { status: "ready", value: event.keys } };
        case "keysFailed":
          return state.keys.status === "ready" ? state : { ...state, keys: { status: "failed" } };
        case "sessionExpired":
          return { phase: "signedOut", banner: { status: "danger", text: SESSION_EXPIRED_TEXT } };
        case "signedOut":
          return { phase: "signedOut", banner: null };
        default:
          return state;
      }
  }
}
