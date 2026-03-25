import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

describe("Module import chain", () => {
  it("all handler modules import without error", async () => {
    const modules = await Promise.all([
      import("../handlers/convert"),
      import("../handlers/stream"),
      import("../handlers/health"),
      import("../handlers/batch"),
      import("../handlers/extract"),
      import("../handlers/deepcrawl"),
      import("../handlers/jobs"),
      import("../handlers/og-image"),
      import("../handlers/llms-txt"),
      import("../helpers/format"),
      import("../helpers/response"),
      import("../helpers/crypto"),
      import("../middleware/auth"),
      import("../middleware/rate-limit"),
      import("../runtime-state"),
    ]);
    expect(modules.length).toBe(15);
    modules.forEach((mod) => expect(mod).toBeDefined());
  });

  it("all core modules import without error", async () => {
    const modules = await Promise.all([
      import("../converter"),
      import("../config"),
      import("../security"),
      import("../utils"),
      import("../types"),
      import("../helpers/format"),
      import("../paywall"),
    ]);
    expect(modules.length).toBe(7);
    modules.forEach((mod) => expect(mod).toBeDefined());
  });
});
