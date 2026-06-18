import { describe, it, expect, vi } from "vitest";
import { StorePreferenceTool } from "../../src/modules/agent/tools/memory/store-preference.tool";
import { RecallPreferencesTool } from "../../src/modules/agent/tools/memory/recall-preferences.tool";

describe("Memory Tools", () => {
  const mockQdrantService = {
    upsert: vi.fn(),
    search: vi.fn(),
  };

  const mockEmbeddingsService = {
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };

  const storeTool = new StorePreferenceTool(
    mockQdrantService as any,
    mockEmbeddingsService as any,
  );

  const recallTool = new RecallPreferencesTool(
    mockQdrantService as any,
    mockEmbeddingsService as any,
  );

  it("should successfully store traveller preferences", async () => {
    mockQdrantService.upsert.mockResolvedValue(undefined);

    const result = await storeTool.execute({
      userId: "user-123",
      preference: "prefer 4-star hotels",
    });

    expect(result.success).toBe(true);
    expect(result.id).toContain("user-123");
    expect(mockQdrantService.upsert).toHaveBeenCalled();
  });

  it("should successfully recall stored traveller preferences", async () => {
    mockQdrantService.search.mockResolvedValue([
      {
        id: "p1",
        score: 0.95,
        payload: { userId: "user-123", preference: "prefer 4-star hotels" },
      },
      {
        id: "p2",
        score: 0.9,
        payload: { userId: "other-user", preference: "hates hostels" },
      },
    ]);

    const result = await recallTool.execute({
      userId: "user-123",
      query: "hotels",
      limit: 5,
    });

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0]).toBe("prefer 4-star hotels");
  });
});
