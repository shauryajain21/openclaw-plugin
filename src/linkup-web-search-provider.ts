import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
// Linkup provider module implements model/runtime integration.
import type { WebSearchProviderPlugin } from "openclaw/plugin-sdk/provider-web-search-contract";
import { createLinkupWebSearchProviderBase } from "./linkup-web-search-provider.shared.js";

const LINKUP_DEPTHS = ["flash", "fast", "standard", "deep"] as const;
const LINKUP_OUTPUT_TYPES = ["searchResults", "sourcedAnswer"] as const;
const LINKUP_MAX_SEARCH_COUNT = 100;

const loadLinkupWebSearchRuntime = createLazyRuntimeModule(
  () => import("./linkup-web-search-provider.runtime.js"),
);

const LinkupSearchSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query string." },
    count: {
      type: "integer",
      description: "Maximum number of results to return (1-100).",
      minimum: 1,
      maximum: LINKUP_MAX_SEARCH_COUNT,
    },
    depth: {
      type: "string",
      enum: [...LINKUP_DEPTHS],
      description:
        'Linkup search depth: "flash", "fast", "standard", or "deep". Defaults to "standard".',
    },
    output_type: {
      type: "string",
      enum: [...LINKUP_OUTPUT_TYPES],
      description:
        'Linkup output type: "searchResults" (ranked sources) or "sourcedAnswer" (synthesized answer with citations). Defaults to "searchResults".',
    },
    include_domains: {
      type: "array",
      items: { type: "string" },
      description: "Restrict search to these domains (max 100).",
    },
    exclude_domains: {
      type: "array",
      items: { type: "string" },
      description: "Exclude these domains from search results.",
    },
    date_after: {
      type: "string",
      description: "Only results on or after this date (YYYY-MM-DD).",
    },
    date_before: {
      type: "string",
      description: "Only results on or before this date (YYYY-MM-DD).",
    },
  },
  additionalProperties: false,
} satisfies Record<string, unknown>;

export function createLinkupWebSearchProvider(): WebSearchProviderPlugin {
  return {
    ...createLinkupWebSearchProviderBase(),
    createTool: (ctx) => ({
      description:
        "Search the web using Linkup. Returns ranked sources by default, or a sourced natural-language answer with citations.",
      parameters: LinkupSearchSchema,
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        const { executeLinkupWebSearchProviderTool } = await loadLinkupWebSearchRuntime();
        return await executeLinkupWebSearchProviderTool(ctx, args, context?.signal);
      },
    }),
  };
}
