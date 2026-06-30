import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverPlugins, getPluginManifest } from "../../src/runtime/plugin-toolkit";

// Mock the skill-loader module
vi.mock("../../src/runtime/skill-loader", () => ({
  getSkillDirectory: vi.fn(),
}));

// Mock node:fs promises
const mockReaddir = vi.fn();
const mockReadFile = vi.fn();
vi.mock("node:fs", () => ({
  promises: {
    readdir: (...args: unknown[]) => mockReaddir(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

describe("discoverPlugins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty map when getSkillDirectory returns null", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue(null as unknown as string);

    const result = await discoverPlugins();
    expect(result.size).toBe(0);
  });

  it("returns empty map when directory does not exist", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/nonexistent");
    mockReaddir.mockRejectedValue(new Error("ENOENT"));

    const result = await discoverPlugins();
    expect(result.size).toBe(0);
  });

  it("returns empty map when directory is empty", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/skills");
    mockReaddir.mockResolvedValue([]);

    const result = await discoverPlugins();
    expect(result.size).toBe(0);
  });

  it("skips non-directory entries", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/skills");
    mockReaddir.mockResolvedValue([
      { name: "file.txt", isDirectory: () => false },
    ]);

    const result = await discoverPlugins();
    expect(result.size).toBe(0);
  });

  it("discovers a valid plugin from directory", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/skills");
    mockReaddir.mockResolvedValue([
      { name: "my-plugin", isDirectory: () => true },
    ]);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ name: "my-plugin", version: "1.0.0", description: "A test plugin" })
    );

    const result = await discoverPlugins();
    expect(result.size).toBe(1);
    expect(result.get("my-plugin")).toBeDefined();
    expect(result.get("my-plugin")!.version).toBe("1.0.0");
  });

  it("skips directories without plugin.json", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/skills");
    mockReaddir.mockResolvedValue([
      { name: "no-manifest", isDirectory: () => true },
    ]);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const result = await discoverPlugins();
    expect(result.size).toBe(0);
  });

  it("skips plugin.json with invalid JSON", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/skills");
    mockReaddir.mockResolvedValue([
      { name: "bad-json", isDirectory: () => true },
    ]);
    mockReadFile.mockResolvedValue("not valid json");

    const result = await discoverPlugins();
    expect(result.size).toBe(0);
  });

  it("skips plugin.json missing name or version", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/skills");
    mockReaddir.mockResolvedValue([
      { name: "no-name", isDirectory: () => true },
    ]);
    mockReadFile.mockResolvedValue(JSON.stringify({ description: "no name field" }));

    const result = await discoverPlugins();
    expect(result.size).toBe(0);
  });

  it("discovers multiple plugins", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/skills");
    mockReaddir.mockResolvedValue([
      { name: "plugin-a", isDirectory: () => true },
      { name: "plugin-b", isDirectory: () => true },
      { name: "not-a-dir.txt", isDirectory: () => false },
    ]);
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ name: "plugin-a", version: "1.0.0", description: "A" }))
      .mockResolvedValueOnce(JSON.stringify({ name: "plugin-b", version: "2.0.0", description: "B" }));

    const result = await discoverPlugins();
    expect(result.size).toBe(2);
    expect(result.has("plugin-a")).toBe(true);
    expect(result.has("plugin-b")).toBe(true);
  });

  it("includes optional fields in manifest", async () => {
    const { getSkillDirectory } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillDirectory).mockReturnValue("/skills");
    mockReaddir.mockResolvedValue([
      { name: "full-plugin", isDirectory: () => true },
    ]);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        name: "full-plugin",
        version: "1.0.0",
        description: "Full",
        author: "Test Author",
        skills: ["skill-a"],
        tools: ["tool-b"],
        hooks: { onLoad: "init.sh" },
        dependencies: ["other-plugin"],
        metadata: { category: "test" },
      })
    );

    const result = await discoverPlugins();
    const manifest = result.get("full-plugin")!;
    expect(manifest.author).toBe("Test Author");
    expect(manifest.skills).toEqual(["skill-a"]);
    expect(manifest.tools).toEqual(["tool-b"]);
    expect(manifest.hooks?.onLoad).toBe("init.sh");
    expect(manifest.dependencies).toEqual(["other-plugin"]);
    expect(manifest.metadata).toEqual({ category: "test" });
  });
});

describe("getPluginManifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed manifest for valid plugin.json", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ name: "test-plugin", version: "1.0.0", description: "Test" })
    );

    const result = await getPluginManifest("/skills/test-plugin");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test-plugin");
    expect(result!.version).toBe("1.0.0");
  });

  it("returns null when plugin.json does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const result = await getPluginManifest("/skills/nonexistent");
    expect(result).toBeNull();
  });

  it("returns null when plugin.json contains invalid JSON", async () => {
    mockReadFile.mockResolvedValue("{broken json");

    const result = await getPluginManifest("/skills/bad-plugin");
    expect(result).toBeNull();
  });

  it("reads from the correct path", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ name: "path-test", version: "1.0.0", description: "Path" })
    );

    await getPluginManifest("/custom/dir/my-plugin");
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining("plugin.json"),
      "utf-8"
    );
  });
});
