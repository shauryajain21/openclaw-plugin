import { afterEach, describe, expect, it, vi } from "vitest";
import { createLinkupWebSearchProvider } from "./linkup-web-search-provider.js";
import { executeLinkupWebSearchProviderTool } from "./linkup-web-search-provider.runtime.js";

type JsonRecord = Record<string, unknown>;

function requireLinkupTool(webSearch: JsonRecord, searchConfig: JsonRecord = {}) {
  const tool = createLinkupWebSearchProvider().createTool({
    config: { plugins: { entries: { linkup: { config: { webSearch } } } } },
    searchConfig,
  });
  if (!tool) {
    throw new Error("Expected Linkup tool definition");
  }
  return tool;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("linkup web search provider metadata", () => {
  it("exposes Linkup provider metadata and selection wiring", () => {
    const provider = createLinkupWebSearchProvider();
    expect(provider.id).toBe("linkup");
    expect(provider.envVars).toEqual(["LINKUP_API_KEY"]);
    expect(provider.credentialPath).toBe("plugins.entries.linkup.config.webSearch.apiKey");
    expect(typeof provider.createTool).toBe("function");
    expect(typeof provider.applySelectionConfig).toBe("function");
  });

  it("declares depth and output_type tool parameters", () => {
    const tool = requireLinkupTool({ apiKey: "test-key" });
    const parameters = tool.parameters as {
      properties?: {
        depth?: { enum?: string[] };
        output_type?: { enum?: string[] };
        count?: { maximum?: number };
      };
    };
    expect(parameters.properties?.depth?.enum).toEqual(["flash", "fast", "standard", "deep"]);
    expect(parameters.properties?.output_type?.enum).toEqual([
      "searchResults",
      "sourcedAnswer",
    ]);
    expect(parameters.properties?.count?.maximum).toBe(100);
  });
});

describe("linkup web search provider runtime", () => {
  it("returns a missing-key payload without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeLinkupWebSearchProviderTool(
      { config: {}, searchConfig: {} },
      { query: "OpenClaw plugins" },
    );

    expect(result).toMatchObject({
      error: "missing_linkup_api_key",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Linkup searchResults into Exa-like title/url/description results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              type: "text",
              name: "Linkup Docs",
              url: "https://docs.linkup.so/search",
              content: "Agentic web search API",
            },
            {
              type: "image",
              name: "Ignored image",
              url: "https://cdn.example/image.png",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeLinkupWebSearchProviderTool(
      {
        config: {
          plugins: {
            entries: {
              linkup: { config: { webSearch: { apiKey: "linkup-test-key" } } },
            },
          },
        },
      },
      { query: "linkup search api", count: 5 },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.linkup.so/v1/search");
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer linkup-test-key",
      }),
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      q: "linkup search api",
      depth: "standard",
      outputType: "searchResults",
      maxResults: 5,
    });

    expect(result).toMatchObject({
      provider: "linkup",
      query: "linkup search api",
      count: 1,
      outputType: "searchResults",
    });
    const rows = result.results as Array<{ title: string; url: string; description: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe("https://docs.linkup.so/search");
    expect(rows[0]?.title).toContain("Linkup Docs");
    expect(rows[0]?.description).toContain("Agentic web search API");
  });

  it("supports sourcedAnswer responses with citations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: "Linkup is a web search API for AI agents.",
          sources: [
            {
              name: "Linkup",
              url: "https://www.linkup.so",
              snippet: "Web search for AI",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeLinkupWebSearchProviderTool(
      {
        searchConfig: {
          linkup: { apiKey: "linkup-answer-key" },
        },
      },
      {
        query: "What is Linkup?",
        output_type: "sourcedAnswer",
        depth: "fast",
      },
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      q: "What is Linkup?",
      depth: "fast",
      outputType: "sourcedAnswer",
    });
    expect(result).toMatchObject({
      provider: "linkup",
      outputType: "sourcedAnswer",
      citations: ["https://www.linkup.so"],
    });
    expect(String(result.content)).toContain("Linkup is a web search API for AI agents.");
  });

  it("rejects invalid depth before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeLinkupWebSearchProviderTool(
      { searchConfig: { linkup: { apiKey: "k" } } },
      { query: "x", depth: "ultra" },
    );

    expect(result).toMatchObject({ error: "invalid_depth" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("appends /v1/search to a custom baseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await executeLinkupWebSearchProviderTool(
      {
        searchConfig: {
          linkup: {
            apiKey: "k",
            baseUrl: "https://proxy.example/linkup",
          },
        },
      },
      { query: "base url" },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://proxy.example/linkup/v1/search");
  });
});
