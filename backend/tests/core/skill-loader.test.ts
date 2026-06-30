import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";

// ─── Mock helpers ────────────────────────────────────────────────────────────

class DirentMock {
  name: string;
  private _isDir: boolean;
  constructor(name: string, isDir: boolean) {
    this.name = name;
    this._isDir = isDir;
  }
  isDirectory() { return this._isDir; }
  isFile() { return !this._isDir; }
  isSymbolicLink() { return false; }
  isBlockDevice() { return false; }
  isCharacterDevice() { return false; }
  isFIFO() { return false; }
  isSocket() { return false; }
}

// We need to mock `node:fs` which exports both `existsSync` and `promises`.
// The source does: import { existsSync, promises as fs } from "node:fs";
const mockExistsSync = vi.fn(() => false);
const mockReaddir = vi.fn(async () => []);
const mockReadFile = vi.fn(async () => "");
const mockAccess = vi.fn(async () => {});

vi.mock("node:fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  promises: {
    readdir: (...args: any[]) => mockReaddir(...args),
    readFile: (...args: any[]) => mockReadFile(...args),
    access: (...args: any[]) => mockAccess(...args),
  },
  // Also export default for any other usage
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
    promises: {
      readdir: (...args: any[]) => mockReaddir(...args),
      readFile: (...args: any[]) => mockReadFile(...args),
      access: (...args: any[]) => mockAccess(...args),
    },
  },
}));

import {
  parseFrontmatter,
  SkillLoader,
  formatSkillPrompt,
  invalidateSkillCache,
  getSkillDirectory,
  FRONTMATTER_RE,
} from "@/runtime/skill-loader";
import type { Skill } from "@/runtime/skill-loader";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSkillCache();
});

// ─── parseFrontmatter ────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("returns null when name is missing", () => {
    const text = "description: A test skill\n";
    expect(parseFrontmatter(text)).toBeNull();
  });

  it("returns null when description is missing", () => {
    const text = "name: my-skill\n";
    expect(parseFrontmatter(text)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseFrontmatter("")).toBeNull();
  });

  it("returns null when both name and description are missing", () => {
    const text = "license: MIT\n";
    expect(parseFrontmatter(text)).toBeNull();
  });

  it("parses valid frontmatter with name and description", () => {
    const text = "name: test-skill\ndescription: A test skill\n";
    const result = parseFrontmatter(text);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test-skill");
    expect(result!.description).toBe("A test skill");
  });

  it("strips surrounding double quotes from values", () => {
    const text = 'name: "quoted-skill"\ndescription: "A quoted description"\n';
    const result = parseFrontmatter(text)!;
    expect(result.name).toBe("quoted-skill");
    expect(result.description).toBe("A quoted description");
  });

  it("strips surrounding single quotes from values", () => {
    const text = "name: 'single-quoted'\ndescription: 'Single quoted desc'\n";
    const result = parseFrontmatter(text)!;
    expect(result.name).toBe("single-quoted");
    expect(result.description).toBe("Single quoted desc");
  });

  it("parses inline YAML list for allowed-tools", () => {
    const text = "name: tool-skill\ndescription: test\nallowed-tools: [bash, read_file]\n";
    const result = parseFrontmatter(text)!;
    expect(result["allowed-tools"]).toEqual(["bash", "read_file"]);
  });

  it("parses multi-line YAML list for allowed-tools", () => {
    const text = "name: tool-skill\ndescription: test\nallowed-tools:\n  - bash\n  - read_file\n";
    const result = parseFrontmatter(text)!;
    expect(result["allowed-tools"]).toEqual(["bash", "read_file"]);
  });

  it("parses inline YAML list for requires", () => {
    const text = "name: dep-skill\ndescription: test\nrequires: [skill-a, skill-b]\n";
    const result = parseFrontmatter(text)!;
    expect(result["requires"]).toEqual(["skill-a", "skill-b"]);
  });

  it("parses multi-line YAML list for requires", () => {
    const text = "name: dep-skill\ndescription: test\nrequires:\n  - skill-a\n  - skill-b\n";
    const result = parseFrontmatter(text)!;
    expect(result["requires"]).toEqual(["skill-a", "skill-b"]);
  });

  it("parses empty inline list as empty array", () => {
    const text = "name: empty-list\ndescription: test\nallowed-tools: []\n";
    const result = parseFrontmatter(text)!;
    expect(result["allowed-tools"]).toEqual([]);
  });

  it("parses license field", () => {
    const text = "name: licensed\ndescription: test\nlicense: MIT\n";
    const result = parseFrontmatter(text)!;
    expect(result.license).toBe("MIT");
  });

  it("parses metadata block with indented keys", () => {
    const text = "name: meta-skill\ndescription: test\nmetadata:\n  version: 1.0\n  author: test\n";
    const result = parseFrontmatter(text)!;
    expect(result.metadata).toEqual({ version: "1.0", author: "test" });
  });

  it("parses inline list inside metadata block", () => {
    const text = "name: meta-skill\ndescription: test\nmetadata:\n  roles: [frontend, backend]\n";
    const result = parseFrontmatter(text)!;
    expect(result.metadata).toEqual({ roles: ["frontend", "backend"] });
  });

  it("parses empty inline list inside metadata block", () => {
    const text = "name: meta-skill\ndescription: test\nmetadata:\n  roles: []\n";
    const result = parseFrontmatter(text)!;
    expect(result.metadata).toEqual({ roles: [] });
  });

  it("ignores comment lines (starting with #)", () => {
    const text = "# This is a comment\nname: comment-skill\ndescription: test\n";
    const result = parseFrontmatter(text)!;
    expect(result.name).toBe("comment-skill");
  });

  it("ignores blank lines", () => {
    const text = "\nname: blank-skill\n\ndescription: test\n\n";
    const result = parseFrontmatter(text)!;
    expect(result.name).toBe("blank-skill");
    expect(result.description).toBe("test");
  });

  it("parses auto-load as string value", () => {
    const text = "name: auto-skill\ndescription: test\nauto-load: true\n";
    const result = parseFrontmatter(text)!;
    expect(result["auto-load"]).toBe("true");
  });

  it("handles allowed-tools with non-list single value", () => {
    const text = "name: single-tool\ndescription: test\nallowed-tools: bash\n";
    const result = parseFrontmatter(text)!;
    expect(result["allowed-tools"]).toEqual(["bash"]);
  });
});

// ─── FRONTMATTER_RE regex ────────────────────────────────────────────────────

describe("FRONTMATTER_RE", () => {
  it("matches valid frontmatter block", () => {
    const text = "---\nname: test\ndescription: test\n---\nBody content here";
    const match = text.match(FRONTMATTER_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("name: test");
    expect(match![2]).toBe("Body content here");
  });

  it("does not match text without delimiters", () => {
    const text = "name: test\ndescription: test\nBody content";
    expect(text.match(FRONTMATTER_RE)).toBeNull();
  });

  it("captures empty body after closing delimiter", () => {
    const text = "---\nname: test\ndescription: test\n---\n";
    const match = text.match(FRONTMATTER_RE);
    expect(match).not.toBeNull();
    expect(match![2].trim()).toBe("");
  });
});

// ─── SkillLoader ─────────────────────────────────────────────────────────────

describe("SkillLoader", () => {
  it("discovers no skills when directory does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    const loader = new SkillLoader("/nonexistent/path");
    await loader.discoverSkills();
    const skills = await loader.listSkills();
    expect(skills).toEqual([]);
  });

  it("discovers skills from SKILL.md files", async () => {
    const skillContent = "---\nname: my-skill\ndescription: A test skill\n---\nSkill body content";

    mockAccess.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);

    mockReaddir.mockImplementation(async (dir: any) => {
      const d = String(dir);
      if (d === "/skills") {
        return [new DirentMock("my-skill", true) as any];
      }
      if (d === path.join("/skills", "my-skill")) {
        return [new DirentMock("SKILL.md", false) as any];
      }
      return [];
    });

    mockReadFile.mockResolvedValue(skillContent);

    const loader = new SkillLoader("/skills");
    await loader.discoverSkills();
    const skills = await loader.listSkills();
    expect(skills).toContain("my-skill");
  });

  it("getSkill returns null for unknown skill", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    const loader = new SkillLoader("/nonexistent");
    await loader.discoverSkills();
    const skill = await loader.getSkill("nonexistent");
    expect(skill).toBeNull();
  });

  it("getSkill returns skill after discovery", async () => {
    const skillContent = "---\nname: found-skill\ndescription: Found\n---\nBody";

    mockAccess.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockImplementation(async (dir: any) => {
      const d = String(dir);
      if (d === "/skills") {
        return [new DirentMock("found-skill", true) as any];
      }
      if (d.endsWith("found-skill")) {
        return [new DirentMock("SKILL.md", false) as any];
      }
      return [];
    });
    mockReadFile.mockResolvedValue(skillContent);

    const loader = new SkillLoader("/skills");
    await loader.discoverSkills();
    const skill = await loader.getSkill("found-skill");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("found-skill");
    expect(skill!.description).toBe("Found");
  });

  it("listAutoLoadSkills returns only auto-load skills", async () => {
    const autoContent = "---\nname: auto-skill\ndescription: auto\nauto-load: true\n---\nBody";
    const manualContent = "---\nname: manual-skill\ndescription: manual\n---\nBody";

    mockAccess.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockImplementation(async (dir: any) => {
      const d = String(dir);
      if (d === "/skills") {
        return [
          new DirentMock("auto-skill", true) as any,
          new DirentMock("manual-skill", true) as any,
        ];
      }
      if (d.endsWith("auto-skill")) {
        return [new DirentMock("SKILL.md", false) as any];
      }
      if (d.endsWith("manual-skill")) {
        return [new DirentMock("SKILL.md", false) as any];
      }
      return [];
    });
    mockReadFile.mockImplementation(async (file: any) => {
      if (String(file).includes("auto-skill")) return autoContent;
      return manualContent;
    });

    const loader = new SkillLoader("/skills");
    await loader.discoverSkills();
    const autoSkills = await loader.listAutoLoadSkills();
    expect(autoSkills.length).toBe(1);
    expect(autoSkills[0].name).toBe("auto-skill");
  });

  it("discovers skills only once (caches loaded state)", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    const loader = new SkillLoader("/nonexistent");
    await loader.discoverSkills();
    await loader.discoverSkills(); // second call should be no-op
    expect(mockAccess).toHaveBeenCalledTimes(1);
  });

  it("skips SKILL.md files with invalid frontmatter", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockImplementation(async (dir: any) => {
      const d = String(dir);
      if (d === "/skills") {
        return [new DirentMock("bad-skill", true) as any];
      }
      if (d.endsWith("bad-skill")) {
        return [new DirentMock("SKILL.md", false) as any];
      }
      return [];
    });
    // No frontmatter delimiters → FRONTMATTER_RE won't match
    mockReadFile.mockResolvedValue("Just plain text, no frontmatter");

    const loader = new SkillLoader("/skills");
    await loader.discoverSkills();
    const skills = await loader.listSkills();
    expect(skills).toEqual([]);
  });
});

// ─── topoSort (via listAutoLoadSkills) ───────────────────────────────────────

describe("topoSort (skill dependencies)", () => {
  it("returns skills in dependency order", async () => {
    const contentA = "---\nname: skill-a\ndescription: A\nauto-load: true\n---\nBody";
    const contentB = "---\nname: skill-b\ndescription: B\nauto-load: true\nrequires: [skill-a]\n---\nBody";

    mockAccess.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockImplementation(async (dir: any) => {
      const d = String(dir);
      if (d === "/skills") {
        return [
          new DirentMock("skill-a", true) as any,
          new DirentMock("skill-b", true) as any,
        ];
      }
      if (d.endsWith("skill-a")) {
        return [new DirentMock("SKILL.md", false) as any];
      }
      if (d.endsWith("skill-b")) {
        return [new DirentMock("SKILL.md", false) as any];
      }
      return [];
    });
    mockReadFile.mockImplementation(async (file: any) => {
      if (String(file).includes("skill-a")) return contentA;
      return contentB;
    });

    const loader = new SkillLoader("/skills");
    await loader.discoverSkills();
    const autoSkills = await loader.listAutoLoadSkills();
    const names = autoSkills.map(s => s.name);
    // skill-a should come before skill-b because skill-b depends on skill-a
    expect(names.indexOf("skill-a")).toBeLessThan(names.indexOf("skill-b"));
  });
});

// ─── invalidateSkillCache ────────────────────────────────────────────────────

describe("invalidateSkillCache", () => {
  it("resets cached loader (no throw)", () => {
    expect(() => invalidateSkillCache()).not.toThrow();
  });

  it("calling invalidateSkillCache multiple times is safe", () => {
    expect(() => {
      invalidateSkillCache();
      invalidateSkillCache();
    }).not.toThrow();
  });
});

// ─── getSkillDirectory ───────────────────────────────────────────────────────

describe("getSkillDirectory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns AGENT_SKILLS_DIR when set and directory exists", () => {
    process.env.AGENT_SKILLS_DIR = "/custom/skills";
    mockExistsSync.mockImplementation((p: any) => String(p) === path.resolve("/custom/skills"));
    const result = getSkillDirectory();
    expect(result).toBe(path.resolve("/custom/skills"));
  });

  it("falls back to cwd/skills when env not set and it exists", () => {
    delete process.env.AGENT_SKILLS_DIR;
    mockExistsSync.mockImplementation((p: any) => {
      const s = String(p);
      return s === path.resolve(process.cwd(), "skills");
    });
    const result = getSkillDirectory();
    expect(result).toBe(path.resolve(process.cwd(), "skills"));
  });

  it("falls back to first candidate when no directory exists", () => {
    delete process.env.AGENT_SKILLS_DIR;
    mockExistsSync.mockReturnValue(false);
    const result = getSkillDirectory();
    // First candidate when no env is cwd/skills
    expect(result).toBe(path.resolve(process.cwd(), "skills"));
  });
});

// ─── formatSkillPrompt ───────────────────────────────────────────────────────

describe("formatSkillPrompt", () => {
  it("includes skill name in header", () => {
    const skill: Skill = {
      name: "test-skill",
      description: "A test",
      content: "Body",
      skillPath: "/skills/test-skill/SKILL.md",
      skillDir: "/skills/test-skill",
    };
    const result = formatSkillPrompt(skill);
    expect(result).toContain("# Skill: test-skill");
  });

  it("includes skill directory info", () => {
    const skill: Skill = {
      name: "dir-skill",
      description: "test",
      content: "Body",
      skillPath: "/skills/dir-skill/SKILL.md",
      skillDir: "/skills/dir-skill",
    };
    const result = formatSkillPrompt(skill);
    expect(result).toContain("/skills/dir-skill");
  });

  it("includes description and content", () => {
    const skill: Skill = {
      name: "full-skill",
      description: "Full description here",
      content: "Full body content here",
      skillPath: "/skills/full-skill/SKILL.md",
      skillDir: "/skills/full-skill",
    };
    const result = formatSkillPrompt(skill);
    expect(result).toContain("Full description here");
    expect(result).toContain("Full body content here");
  });
});
