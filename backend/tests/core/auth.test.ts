import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  isAuthEnabled,
  AuthError,
  createTokenCookie,
  clearTokenCookie,
  getTokenFromRequest,
} from "@/lib/auth";

// ─── Password hashing ────────────────────────────────────────────────────────

describe("hashPassword / verifyPassword", () => {
  it("should hash a password and verify it successfully", async () => {
    const password = "my-secure-password-123";
    const hashed = await hashPassword(password);

    expect(hashed).not.toBe(password);
    expect(hashed.length).toBeGreaterThan(0);

    const isValid = await verifyPassword(password, hashed);
    expect(isValid).toBe(true);
  });

  it("should reject an incorrect password", async () => {
    const hashed = await hashPassword("correct-password");
    const isValid = await verifyPassword("wrong-password", hashed);
    expect(isValid).toBe(false);
  });

  it("should produce different hashes for the same password (salt)", async () => {
    const password = "same-password";
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });

  it("should handle empty password", async () => {
    const hashed = await hashPassword("");
    expect(hashed.length).toBeGreaterThan(0);
    expect(await verifyPassword("", hashed)).toBe(true);
    expect(await verifyPassword("not-empty", hashed)).toBe(false);
  });

  it("should handle very long passwords", async () => {
    const longPassword = "a".repeat(200);
    const hashed = await hashPassword(longPassword);
    expect(await verifyPassword(longPassword, hashed)).toBe(true);
  });
});

// ─── JWT sign / verify ────────────────────────────────────────────────────────

describe("signToken / verifyToken", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-key-for-jwt-signing-32chars!";
  });

  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("should sign and verify a valid token", async () => {
    const payload = { sub: "user-1", email: "user@test.com", role: "member" as const };
    const token = await signToken(payload);

    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");

    const verified = await verifyToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe("user-1");
    expect(verified!.email).toBe("user@test.com");
    expect(verified!.role).toBe("member");
    expect(verified!.iat).toBeDefined();
    expect(verified!.exp).toBeDefined();
  });

  it("should set expiration in the future", async () => {
    const token = await signToken({ sub: "u1", email: "a@b.com", role: "admin" });
    const payload = await verifyToken(token);
    expect(payload!.exp!).toBeGreaterThan(Date.now() / 1000);
  });

  it("should return null for a tampered token", async () => {
    const token = await signToken({ sub: "u1", email: "a@b.com", role: "member" });
    const tampered = token.slice(0, -5) + "XXXXX";
    const result = await verifyToken(tampered);
    expect(result).toBeNull();
  });

  it("should return null for an empty string token", async () => {
    const result = await verifyToken("");
    expect(result).toBeNull();
  });

  it("should return null when AUTH_SECRET is not set", async () => {
    delete process.env.AUTH_SECRET;
    const result = await verifyToken("some-token");
    expect(result).toBeNull();
  });

  it("should throw when signing without AUTH_SECRET", async () => {
    delete process.env.AUTH_SECRET;
    await expect(
      signToken({ sub: "u1", email: "a@b.com", role: "member" })
    ).rejects.toThrow("AUTH_SECRET not set");
  });

  it("should fail verification when secret changes between sign and verify", async () => {
    const token = await signToken({ sub: "u1", email: "a@b.com", role: "member" });
    process.env.AUTH_SECRET = "completely-different-secret";
    const result = await verifyToken(token);
    expect(result).toBeNull();
  });
});

// ─── isAuthEnabled ─────────────────────────────────────────────────────────────

describe("isAuthEnabled", () => {
  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("should return true when AUTH_SECRET is set", () => {
    process.env.AUTH_SECRET = "some-secret";
    expect(isAuthEnabled()).toBe(true);
  });

  it("should return false when AUTH_SECRET is not set", () => {
    delete process.env.AUTH_SECRET;
    expect(isAuthEnabled()).toBe(false);
  });

  it("should return false when AUTH_SECRET is empty string", () => {
    process.env.AUTH_SECRET = "";
    expect(isAuthEnabled()).toBe(false);
  });
});

// ─── AuthError ─────────────────────────────────────────────────────────────────

describe("AuthError", () => {
  it("should have correct status property", () => {
    const err = new AuthError("Unauthorized", 401);
    expect(err.status).toBe(401);
    expect(err.message).toBe("Unauthorized");
    expect(err.name).toBe("AuthError");
  });

  it("should be an instance of Error", () => {
    const err = new AuthError("Forbidden", 403);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthError);
  });

  it("should support different status codes", () => {
    const err401 = new AuthError("Unauthorized", 401);
    const err403 = new AuthError("Forbidden", 403);
    expect(err401.status).toBe(401);
    expect(err403.status).toBe(403);
  });
});

// ─── Cookie helpers ────────────────────────────────────────────────────────────

describe("createTokenCookie", () => {
  it("should include the token in the cookie value", () => {
    const cookie = createTokenCookie("my-jwt-token");
    expect(cookie).toContain("phoenix-token=my-jwt-token");
  });

  it("should set HttpOnly flag", () => {
    const cookie = createTokenCookie("tok");
    expect(cookie).toContain("HttpOnly");
  });

  it("should set SameSite=Lax", () => {
    const cookie = createTokenCookie("tok");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("should set Max-Age to 7 days in seconds", () => {
    const cookie = createTokenCookie("tok");
    const sevenDaysSec = 7 * 24 * 60 * 60;
    expect(cookie).toContain(`Max-Age=${sevenDaysSec}`);
  });

  it("should set Path=/", () => {
    const cookie = createTokenCookie("tok");
    expect(cookie).toContain("Path=/");
  });
});

describe("clearTokenCookie", () => {
  it("should set Max-Age=0 to expire the cookie", () => {
    const cookie = clearTokenCookie();
    expect(cookie).toContain("Max-Age=0");
  });

  it("should clear the phoenix-token cookie", () => {
    const cookie = clearTokenCookie();
    expect(cookie).toContain("phoenix-token=");
  });

  it("should include HttpOnly and SameSite", () => {
    const cookie = clearTokenCookie();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});

// ─── getTokenFromRequest ───────────────────────────────────────────────────────

describe("getTokenFromRequest", () => {
  it("should extract token from cookie header", () => {
    const req = new Request("http://localhost", {
      headers: { cookie: "phoenix-token=abc123" },
    });
    expect(getTokenFromRequest(req)).toBe("abc123");
  });

  it("should extract token among multiple cookies", () => {
    const req = new Request("http://localhost", {
      headers: { cookie: "other=val; phoenix-token=mytoken; another=x" },
    });
    expect(getTokenFromRequest(req)).toBe("mytoken");
  });

  it("should return null when no cookie header is present", () => {
    const req = new Request("http://localhost");
    expect(getTokenFromRequest(req)).toBeNull();
  });

  it("should return null when phoenix-token is not among cookies", () => {
    const req = new Request("http://localhost", {
      headers: { cookie: "other=val; another=x" },
    });
    expect(getTokenFromRequest(req)).toBeNull();
  });

  it("should handle token values containing '=' characters", () => {
    const req = new Request("http://localhost", {
      headers: { cookie: "phoenix-token=abc=def=ghi" },
    });
    expect(getTokenFromRequest(req)).toBe("abc=def=ghi");
  });

  it("should handle cookies with spaces around semicolons", () => {
    const req = new Request("http://localhost", {
      headers: { cookie: "other=val ;  phoenix-token=spaced-token" },
    });
    expect(getTokenFromRequest(req)).toBe("spaced-token");
  });
});
