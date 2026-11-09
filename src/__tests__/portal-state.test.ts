import { describe, expect, it } from "vitest";
import {
  initialPortalState,
  portalReducer,
  SESSION_EXPIRED_TEXT,
  type PortalEvent,
  type PortalState,
} from "../../web/portal-state";

const run = (events: PortalEvent[], from: PortalState) => events.reduce(portalReducer, from);
const session = { email: "a@example.com", tier: "free" };
const key = { id: "k1", name: "prod", prefix: "abcd1234", created_at: "2026-11-09T00:00:00Z", active: true };

describe("portal session state machine", () => {
  it("starts on the sign-in form without a session cookie, with the sign-in link error", () => {
    expect(initialPortalState(false, "link_expired")).toEqual({
      phase: "signedOut",
      banner: { status: "danger", text: "This sign-in link has expired. Please request a new one." },
    });
    expect(initialPortalState(false)).toEqual({ phase: "signedOut", banner: null });
    // A stale cookie must not swallow the link error: it comes back when /api/me says 401.
    const checking = initialPortalState(true, "link_expired");
    expect(checking.phase).toBe("checking");
    const expired = { status: "danger", text: "This sign-in link has expired. Please request a new one." };
    expect(portalReducer(checking, { type: "meUnauthorized" })).toEqual({ phase: "signedOut", banner: expired });
    // It also survives an outage and a retry before the 401.
    expect(run([{ type: "meFailed" }, { type: "retry" }, { type: "meUnauthorized" }], checking)).toEqual({
      phase: "signedOut",
      banner: expired,
    });
  });

  it("treats only a 401 as signed out; an outage offers a retry instead of the sign-in form", () => {
    expect(run([{ type: "meUnauthorized" }], { phase: "checking", banner: null })).toEqual({ phase: "signedOut", banner: null });
    const down = run([{ type: "meFailed" }], { phase: "checking", banner: null });
    expect(down).toEqual({ phase: "unavailable", banner: null });
    expect(run([{ type: "retry" }], down)).toEqual({ phase: "checking", banner: null });
  });

  it("shows a failed usage or keys request as failed, never as empty data", () => {
    const state = run([{ type: "meLoaded", session }, { type: "usageFailed" }, { type: "keysFailed" }], { phase: "checking", banner: null });
    expect(state).toEqual({ phase: "signedIn", session, usage: { status: "failed" }, keys: { status: "failed" } });
    expect(run([{ type: "usageLoading" }], state)).toMatchObject({ usage: { status: "loading" } });
  });

  it("keeps the current key list while a refresh is loading or fails", () => {
    const ready = run([{ type: "meLoaded", session }, { type: "keysLoaded", keys: [key] }], { phase: "checking", banner: null });
    expect(run([{ type: "keysLoading" }], ready)).toBe(ready);
    expect(run([{ type: "keysFailed" }], ready)).toBe(ready);
    expect(run([{ type: "keysLoaded", keys: [] }], ready)).toMatchObject({ keys: { status: "ready", value: [] } });
  });

  it("returns to the sign-in form with a notice when the session expires, and quietly on sign-out", () => {
    const signedIn = run([{ type: "meLoaded", session }], { phase: "checking", banner: null });
    expect(run([{ type: "sessionExpired" }], signedIn)).toEqual({
      phase: "signedOut",
      banner: { status: "danger", text: SESSION_EXPIRED_TEXT },
    });
    expect(run([{ type: "signedOut" }], signedIn)).toEqual({ phase: "signedOut", banner: null });
    // Late responses from the old session do not sign anyone back in.
    const out = run([{ type: "signedOut" }], signedIn);
    expect(run([{ type: "meLoaded", session }, { type: "keysLoaded", keys: [key] }], out)).toBe(out);
  });
});
