import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mock child_process ────────────────────────────────────────────────────────
const mockExec = vi.fn();

vi.mock("node:child_process", () => ({
  exec: mockExec,
}));

// ─── Config tests ──────────────────────────────────────────────────────────────

describe("getSandboxConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear sandbox-related env vars
    delete process.env.SANDBOX_ENABLED;
    delete process.env.SANDBOX_MODE;
    delete process.env.SANDBOX_DOCKER_IMAGE;
    delete process.env.SANDBOX_CPUS;
    delete process.env.SANDBOX_MEMORY_MB;
    delete process.env.SANDBOX_TIMEOUT_MS;
    delete process.env.SANDBOX_NETWORK_NONE;
    delete process.env.SANDBOX_ALLOWED_NETWORKS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return defaults when no env vars are set", async () => {
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();

    expect(config.enabled).toBe(false);
    expect(config.mode).toBe("host");
    expect(config.dockerImage).toBe("node:20-alpine");
    expect(config.cpus).toBe(1);
    expect(config.memoryMB).toBe(512);
    expect(config.timeoutMs).toBe(30000);
    expect(config.networkNone).toBe(true);
    expect(config.allowedNetworks).toEqual([]);
  });

  it("should set enabled=true when SANDBOX_ENABLED is 'true'", async () => {
    process.env.SANDBOX_ENABLED = "true";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.enabled).toBe(true);
  });

  it("should set enabled=false when SANDBOX_ENABLED is 'false'", async () => {
    process.env.SANDBOX_ENABLED = "false";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.enabled).toBe(false);
  });

  it("should set mode to 'docker' when SANDBOX_MODE is 'docker'", async () => {
    process.env.SANDBOX_MODE = "docker";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.mode).toBe("docker");
  });

  it("should default mode to 'host' for unknown values", async () => {
    process.env.SANDBOX_MODE = "unknown";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.mode).toBe("host");
  });

  it("should parse custom docker image", async () => {
    process.env.SANDBOX_DOCKER_IMAGE = "my-custom-image:latest";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.dockerImage).toBe("my-custom-image:latest");
  });

  it("should parse numeric env vars", async () => {
    process.env.SANDBOX_CPUS = "4";
    process.env.SANDBOX_MEMORY_MB = "2048";
    process.env.SANDBOX_TIMEOUT_MS = "60000";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.cpus).toBe(4);
    expect(config.memoryMB).toBe(2048);
    expect(config.timeoutMs).toBe(60000);
  });

  it("should set networkNone=false when SANDBOX_NETWORK_NONE is 'false'", async () => {
    process.env.SANDBOX_NETWORK_NONE = "false";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.networkNone).toBe(false);
  });

  it("should set networkNone=true for any value other than 'false'", async () => {
    process.env.SANDBOX_NETWORK_NONE = "true";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.networkNone).toBe(true);
  });

  it("should parse comma-separated allowed networks", async () => {
    process.env.SANDBOX_ALLOWED_NETWORKS = "net1,net2,net3";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.allowedNetworks).toEqual(["net1", "net2", "net3"]);
  });

  it("should filter out empty strings from allowed networks", async () => {
    process.env.SANDBOX_ALLOWED_NETWORKS = "net1,,net2,";
    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();
    expect(config.allowedNetworks).toEqual(["net1", "net2"]);
  });

  it("should override all defaults with env vars", async () => {
    process.env.SANDBOX_ENABLED = "true";
    process.env.SANDBOX_MODE = "docker";
    process.env.SANDBOX_DOCKER_IMAGE = "alpine:3.18";
    process.env.SANDBOX_CPUS = "2";
    process.env.SANDBOX_MEMORY_MB = "1024";
    process.env.SANDBOX_TIMEOUT_MS = "15000";
    process.env.SANDBOX_NETWORK_NONE = "false";
    process.env.SANDBOX_ALLOWED_NETWORKS = "mynet";

    const { getSandboxConfig } = await import("@/runtime/bash-sandbox");
    const config = getSandboxConfig();

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe("docker");
    expect(config.dockerImage).toBe("alpine:3.18");
    expect(config.cpus).toBe(2);
    expect(config.memoryMB).toBe(1024);
    expect(config.timeoutMs).toBe(15000);
    expect(config.networkNone).toBe(false);
    expect(config.allowedNetworks).toEqual(["mynet"]);
  });
});

// ─── isDockerAvailable ─────────────────────────────────────────────────────────
// The result is cached at module level, so we use vi.resetModules() to get
// a fresh module for each test.

describe("isDockerAvailable", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    mockExec.mockReset();
  });

  it("should return true when docker info succeeds", async () => {
    // Mock exec to call the callback with no error (success)
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: "Docker version 20.10", stderr: "" });
    });

    const { isDockerAvailable } = await import("@/runtime/bash-sandbox");
    const result = await isDockerAvailable();
    expect(result).toBe(true);
  });

  it("should return false when docker info fails", async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error("Cannot connect to Docker daemon"));
    });

    const { isDockerAvailable } = await import("@/runtime/bash-sandbox");
    const result = await isDockerAvailable();
    expect(result).toBe(false);
  });

  it("should cache the result on subsequent calls", async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: "ok", stderr: "" });
    });

    const { isDockerAvailable } = await import("@/runtime/bash-sandbox");
    await isDockerAvailable();
    await isDockerAvailable();
    await isDockerAvailable();

    // exec should only have been called once due to caching
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});
