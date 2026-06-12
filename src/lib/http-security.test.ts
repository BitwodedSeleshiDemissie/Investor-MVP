import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  isSameOriginRequest,
  rejectCrossOriginRequest,
} from "./http-security";

describe("admin HTTP security helpers", () => {
  it("allows same-origin requests and requests without an Origin header", () => {
    expect(isSameOriginRequest(new Request("https://investormvp.vercel.app/api/admin/publish-snapshot"))).toBe(true);
    expect(isSameOriginRequest(new Request("https://investormvp.vercel.app/api/admin/publish-snapshot", {
      headers: {
        origin: "https://investormvp.vercel.app",
        host: "investormvp.vercel.app",
      },
    }))).toBe(true);
  });

  it("rejects cross-site admin POST origins", () => {
    const req = new Request("https://investormvp.vercel.app/api/admin/publish-snapshot", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        host: "investormvp.vercel.app",
      },
    });

    const response = rejectCrossOriginRequest(req);
    expect(response?.status).toBe(403);
  });

  it("sanitizes attachment filenames before placing them in response headers", () => {
    const header = attachmentDisposition("audit\"\r\nx-bad: yes.xlsx", "audit.xlsx");

    expect(header).toContain("attachment;");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).not.toContain("x-bad:");
  });
});
