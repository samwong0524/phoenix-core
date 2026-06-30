import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────────
// We must mock the DB layer and auth before importing the module under test.

const mockSelectResult = { from: vi.fn() };
const mockInsertResult = { values: vi.fn() };
const mockUpdateResult = { set: vi.fn() };
const mockDeleteResult = { where: vi.fn() };

const mockDb = {
  select: vi.fn(() => mockSelectResult),
  insert: vi.fn(() => mockInsertResult),
  update: vi.fn(() => mockUpdateResult),
  delete: vi.fn(() => mockDeleteResult),
};

vi.mock("@/db", () => ({
  getDb: () => mockDb,
}));

// Mock schema tables as symbols the query builder can reference
vi.mock("@/db/schema", () => ({
  workspaces: { id: "id" },
  workspaceMembers: {
    id: "id",
    workspaceId: "workspaceId",
    userId: "userId",
    role: "role",
  },
}));

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ op: "eq", val })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
}));

// Mock isAuthEnabled
vi.mock("@/lib/auth", () => ({
  isAuthEnabled: vi.fn(() => true),
}));

// Now import the module under test
import {
  getWorkspaceRole,
  requireWorkspaceRole,
  hasWorkspaceRole,
  addWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  RbacError,
} from "@/lib/rbac";
import { isAuthEnabled } from "@/lib/auth";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function resetDbMocks() {
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
  mockDb.update.mockClear();
  mockDb.delete.mockClear();
  mockSelectResult.from.mockClear();
  mockInsertResult.values.mockClear();
  mockUpdateResult.set.mockClear();
  mockDeleteResult.where.mockClear();
}

/**
 * Build a chainable mock for select().from().where().limit()
 * `rows` is the array returned by .limit(1) or the full select.
 */
function setupSelectChain(rows: unknown[]) {
  const whereResult = { limit: vi.fn().mockResolvedValue(rows) };
  const fromResult = { where: vi.fn().mockReturnValue(whereResult) };
  mockSelectResult.from.mockReturnValue(fromResult);
  // For the "no where" variant (listWorkspaceMembers)
  // from() returns fromResult which also has the rows directly
  return { fromResult, whereResult };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("getWorkspaceRole", () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it("should return the role when membership exists", async () => {
    const { whereResult } = setupSelectChain([{ role: "admin" }]);
    const role = await getWorkspaceRole("user-1", "ws-1");
    expect(role).toBe("admin");
    expect(mockDb.select).toHaveBeenCalled();
    expect(whereResult.limit).toHaveBeenCalledWith(1);
  });

  it("should return null when user is not a member and workspace has other members", async () => {
    // First call: membership lookup → no result
    // Second call: existing members check → has results (workspace is not legacy)
    const membershipChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
    const existingChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: "m1" }]) }) };

    let callCount = 0;
    mockSelectResult.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return membershipChain;
      return existingChain;
    });

    const role = await getWorkspaceRole("user-1", "ws-1");
    expect(role).toBeNull();
  });

  it("should auto-seed legacy workspace and return 'owner'", async () => {
    // Call 1: membership lookup → empty
    // Call 2: existing members check → empty (legacy workspace)
    // Call 3: workspace existence check → exists
    // Then addWorkspaceMember is called (insert)
    const membershipChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
    const existingChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
    const wsChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: "ws-1" }]) }) };

    let callCount = 0;
    mockSelectResult.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return membershipChain;
      if (callCount === 2) return existingChain;
      return wsChain;
    });

    mockInsertResult.values.mockResolvedValue(undefined);

    const role = await getWorkspaceRole("user-1", "ws-1");
    expect(role).toBe("owner");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("should return null when workspace does not exist (legacy path)", async () => {
    const membershipChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
    const existingChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
    const wsChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };

    let callCount = 0;
    mockSelectResult.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return membershipChain;
      if (callCount === 2) return existingChain;
      return wsChain;
    });

    const role = await getWorkspaceRole("user-1", "nonexistent-ws");
    expect(role).toBeNull();
  });
});

describe("requireWorkspaceRole", () => {
  beforeEach(() => {
    resetDbMocks();
    vi.mocked(isAuthEnabled).mockReturnValue(true);
  });

  it("should pass when auth is disabled (DEV_MODE)", async () => {
    vi.mocked(isAuthEnabled).mockReturnValue(false);
    const session = { id: "u1", email: "a@b.com", name: null, role: "viewer" as const };
    await expect(requireWorkspaceRole(session, "ws-1", "owner")).resolves.toBeUndefined();
  });

  it("should pass for global admin regardless of workspace role", async () => {
    const session = { id: "u1", email: "a@b.com", name: null, role: "admin" as const };
    await expect(requireWorkspaceRole(session, "ws-1", "owner")).resolves.toBeUndefined();
  });

  it("should throw RbacError when user is not a member", async () => {
    const membershipChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
    const existingChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: "m1" }]) }) };

    let callCount = 0;
    mockSelectResult.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return membershipChain;
      return existingChain;
    });

    const session = { id: "u1", email: "a@b.com", name: null, role: "member" as const };
    await expect(requireWorkspaceRole(session, "ws-1", "member")).rejects.toThrow(RbacError);
  });

  it("should throw RbacError when role is insufficient", async () => {
    setupSelectChain([{ role: "viewer" }]);
    const session = { id: "u1", email: "a@b.com", name: null, role: "member" as const };
    await expect(requireWorkspaceRole(session, "ws-1", "admin")).rejects.toThrow(RbacError);
  });

  it("should pass when user has sufficient role", async () => {
    setupSelectChain([{ role: "owner" }]);
    const session = { id: "u1", email: "a@b.com", name: null, role: "member" as const };
    await expect(requireWorkspaceRole(session, "ws-1", "member")).resolves.toBeUndefined();
  });

  it("should pass when user role exactly matches minRole", async () => {
    setupSelectChain([{ role: "member" }]);
    const session = { id: "u1", email: "a@b.com", name: null, role: "member" as const };
    await expect(requireWorkspaceRole(session, "ws-1", "member")).resolves.toBeUndefined();
  });
});

describe("hasWorkspaceRole", () => {
  beforeEach(() => {
    resetDbMocks();
    vi.mocked(isAuthEnabled).mockReturnValue(true);
  });

  it("should return true when auth is disabled", async () => {
    vi.mocked(isAuthEnabled).mockReturnValue(false);
    const session = { id: "u1", email: "a@b.com", name: null, role: "viewer" as const };
    const result = await hasWorkspaceRole(session, "ws-1", "owner");
    expect(result).toBe(true);
  });

  it("should return true for global admin", async () => {
    const session = { id: "u1", email: "a@b.com", name: null, role: "admin" as const };
    const result = await hasWorkspaceRole(session, "ws-1", "owner");
    expect(result).toBe(true);
  });

  it("should return false when not a member", async () => {
    const membershipChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
    const existingChain = { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: "m1" }]) }) };
    let callCount = 0;
    mockSelectResult.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return membershipChain;
      return existingChain;
    });

    const session = { id: "u1", email: "a@b.com", name: null, role: "member" as const };
    const result = await hasWorkspaceRole(session, "ws-1", "member");
    expect(result).toBe(false);
  });

  it("should return true when role is sufficient", async () => {
    setupSelectChain([{ role: "admin" }]);
    const session = { id: "u1", email: "a@b.com", name: null, role: "member" as const };
    const result = await hasWorkspaceRole(session, "ws-1", "member");
    expect(result).toBe(true);
  });

  it("should return false when role is insufficient", async () => {
    setupSelectChain([{ role: "viewer" }]);
    const session = { id: "u1", email: "a@b.com", name: null, role: "member" as const };
    const result = await hasWorkspaceRole(session, "ws-1", "member");
    expect(result).toBe(false);
  });
});

describe("addWorkspaceMember", () => {
  beforeEach(() => {
    resetDbMocks();
    mockInsertResult.values.mockResolvedValue(undefined);
  });

  it("should call db.insert with workspaceMembers table", async () => {
    await addWorkspaceMember("ws-1", "user-1", "member");
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockInsertResult.values).toHaveBeenCalledOnce();
  });

  it("should pass the correct workspace and user IDs", async () => {
    await addWorkspaceMember("ws-1", "user-1", "admin");
    const insertArg = mockInsertResult.values.mock.calls[0][0];
    expect(insertArg.workspaceId).toBe("ws-1");
    expect(insertArg.userId).toBe("user-1");
    expect(insertArg.role).toBe("admin");
  });

  it("should default role to 'member'", async () => {
    await addWorkspaceMember("ws-1", "user-1");
    const insertArg = mockInsertResult.values.mock.calls[0][0];
    expect(insertArg.role).toBe("member");
  });

  it("should generate a UUID for the id", async () => {
    await addWorkspaceMember("ws-1", "user-1");
    const insertArg = mockInsertResult.values.mock.calls[0][0];
    expect(insertArg.id).toBeDefined();
    expect(typeof insertArg.id).toBe("string");
  });

  it("should include a createdAt timestamp", async () => {
    await addWorkspaceMember("ws-1", "user-1");
    const insertArg = mockInsertResult.values.mock.calls[0][0];
    expect(insertArg.createdAt).toBeInstanceOf(Date);
  });
});

describe("listWorkspaceMembers", () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it("should call db.select with workspaceMembers table", async () => {
    const members = [{ id: "1", userId: "u1" }, { id: "2", userId: "u2" }];
    const fromResult = { where: vi.fn().mockResolvedValue(members) };
    mockSelectResult.from.mockReturnValue(fromResult);

    const result = await listWorkspaceMembers("ws-1");
    expect(mockDb.select).toHaveBeenCalled();
    expect(result).toEqual(members);
  });
});

describe("removeWorkspaceMember", () => {
  beforeEach(() => {
    resetDbMocks();
    mockDeleteResult.where.mockResolvedValue(undefined);
  });

  it("should call db.delete with workspaceMembers table", async () => {
    await removeWorkspaceMember("ws-1", "user-1");
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDeleteResult.where).toHaveBeenCalledOnce();
  });
});

describe("RbacError", () => {
  it("should have correct status and name", () => {
    const err = new RbacError("Not a member", 403);
    expect(err.status).toBe(403);
    expect(err.message).toBe("Not a member");
    expect(err.name).toBe("RbacError");
    expect(err).toBeInstanceOf(Error);
  });
});
