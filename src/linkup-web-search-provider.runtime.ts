// Linkup provider module implements model/runtime integration.
import { parseStrictPositiveInteger } from "openclaw/plugin-sdk/number-runtime";
import { ProviderHttpError, readResponseTextLimited } from "openclaw/plugin-sdk/provider-http";
import {
  buildSearchCacheKey,
  DEFAULT_SEARCH_COUNT,
  mergeScopedSearchConfig,
  parseIsoDateRange,
  readCachedSearchPayload,
  readConfiguredSecretString,
  readPositiveIntegerParam,
  readProviderEnvValue,
  readStringArrayParam,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchCacheTtlMs,
  resolveSearchTimeoutSeconds,
  resolveSiteName,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";
import { readResponseWithLimit } from "openclaw/plugin-sdk/response-limit-runtime";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "openclaw/plugin-sdk/string-coerce-runtime";

const LINKUP_SEARCH_ENDPOINT = "https://api.linkup.so/v1/search";
const LINKUP_DEPTHS = ["flash", "fast", "standard", "deep"] as const;
const LINKUP_OUTPUT_TYPES = ["searchResults", "sourcedAnswer"] as const;
const LINKUP_MAX_SEARCH_COUNT = 100;
const LINKUP_MAX_DOMAIN_FILTERS = 100;
const LINKUP_ERROR_BODY_LIMIT_BYTES = 8 * 1024;
// Cap untrusted Linkup success JSON the same way bundled providers do (16 MiB).
const LINKUP_SEARCH_JSON_MAX_BYTES = 16 * 1024 * 1024;

type LinkupConfig = {
  apiKey?: string;
  baseUrl?: string;
};

type LinkupDepth = (typeof LINKUP_DEPTHS)[number];
type LinkupOutputType = (typeof LINKUP_OUTPUT_TYPES)[number];
type SearchConfigRecord = Record<string, unknown> & {
  linkup?: unknown;
  maxResults?: number;
};

type LinkupResultEntry = {
  type?: unknown;
  name?: unknown;
  url?: unknown;
  content?: unknown;
  snippet?: unknown;
};

type LinkupApiResponse = {
  results?: unknown;
  answer?: unknown;
  sources?: unknown;
};

function resolveLinkupConfig(searchConfig?: SearchConfigRecord): LinkupConfig {
  const linkup = searchConfig?.linkup;
  return linkup && typeof linkup === "object" && !Array.isArray(linkup)
    ? (linkup as LinkupConfig)
    : {};
}

function resolveLinkupApiKey(linkup?: LinkupConfig): string | undefined {
  return (
    readConfiguredSecretString(
      linkup?.apiKey,
      "plugins.entries.linkup.config.webSearch.apiKey",
    ) ?? readProviderEnvValue(["LINKUP_API_KEY"])
  );
}

function invalidBaseUrlPayload(value: string) {
  return {
    error: "invalid_base_url",
    message: `plugins.entries.linkup.config.webSearch.baseUrl must be a valid http(s) URL. Got: ${value}`,
    docs: "https://docs.linkup.so/pages/documentation/endpoints/search/overview",
  };
}

function resolveLinkupSearchEndpoint(
  linkup?: LinkupConfig,
): { endpoint: string } | { error: string; message: string; docs: string } {
  const configured = normalizeOptionalString(linkup?.baseUrl);
  if (!configured) {
    return { endpoint: LINKUP_SEARCH_ENDPOINT };
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(configured) && !/^https?:\/\//i.test(configured)) {
    return invalidBaseUrlPayload(configured);
  }
  const candidate = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return invalidBaseUrlPayload(configured);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return invalidBaseUrlPayload(configured);
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/v1/search") || pathname.endsWith("/search")) {
    parsed.pathname = pathname;
  } else {
    parsed.pathname = `${pathname === "" ? "" : pathname}/v1/search`;
  }
  parsed.hash = "";
  return { endpoint: parsed.toString() };
}

function missingLinkupKeyPayload() {
  return {
    error: "missing_linkup_api_key",
    message:
      "web_search (linkup) needs a Linkup API key. Set LINKUP_API_KEY in the Gateway environment, or configure plugins.entries.linkup.config.webSearch.apiKey.",
    docs: "https://docs.openclaw.ai/tools/web",
  };
}

function resolveLinkupSearchCount(value: unknown, fallback: number): number {
  const parsed = parseStrictPositiveInteger(value);
  if (parsed === undefined) {
    return fallback;
  }
  return Math.min(LINKUP_MAX_SEARCH_COUNT, parsed);
}

function normalizeLinkupDepth(value: string | undefined): LinkupDepth | undefined {
  const trimmed = normalizeOptionalLowercaseString(value);
  if (!trimmed) {
    return undefined;
  }
  return LINKUP_DEPTHS.includes(trimmed as LinkupDepth) ? (trimmed as LinkupDepth) : undefined;
}

function normalizeLinkupOutputType(value: string | undefined): LinkupOutputType | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return LINKUP_OUTPUT_TYPES.includes(trimmed as LinkupOutputType)
    ? (trimmed as LinkupOutputType)
    : undefined;
}

function asResultEntries(value: unknown): LinkupResultEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is LinkupResultEntry =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
  );
}

function normalizeLinkupTextResults(payload: LinkupApiResponse): LinkupResultEntry[] {
  return asResultEntries(payload.results).filter((entry) => {
    const type = normalizeOptionalLowercaseString(
      typeof entry.type === "string" ? entry.type : undefined,
    );
    return type !== "image";
  });
}

function normalizeLinkupSources(payload: LinkupApiResponse): LinkupResultEntry[] {
  return asResultEntries(payload.sources);
}

function resolveLinkupDescription(result: LinkupResultEntry): string {
  return (
    normalizeOptionalString(typeof result.content === "string" ? result.content : undefined) ??
    normalizeOptionalString(typeof result.snippet === "string" ? result.snippet : undefined) ??
    ""
  );
}

function mapLinkupResult(entry: LinkupResultEntry) {
  const title = typeof entry.name === "string" ? entry.name : "";
  const url = typeof entry.url === "string" ? entry.url : "";
  const description = resolveLinkupDescription(entry);
  return {
    title: title ? wrapWebContent(title, "web_search") : "",
    url,
    description: description ? wrapWebContent(description, "web_search") : "",
    siteName: resolveSiteName(url) || undefined,
  };
}

async function readLinkupSearchPayload(response: Response): Promise<LinkupApiResponse> {
  const bytes = await readResponseWithLimit(response, LINKUP_SEARCH_JSON_MAX_BYTES, {
    onOverflow: ({ maxBytes: maxBytesLocal }) =>
      new Error(`Linkup API response exceeds ${maxBytesLocal} bytes`),
  });
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as LinkupApiResponse;
  } catch (cause) {
    throw new Error("Linkup API returned malformed JSON", { cause });
  }
}

async function readLinkupErrorDetail(response: Response): Promise<string> {
  return await readResponseTextLimited(response, LINKUP_ERROR_BODY_LIMIT_BYTES);
}

async function runLinkupSearch(params: {
  apiKey: string;
  endpoint: string;
  query: string;
  count: number;
  depth: LinkupDepth;
  outputType: LinkupOutputType;
  includeDomains?: string[];
  excludeDomains?: string[];
  dateAfter?: string;
  dateBefore?: string;
  timeoutSeconds: number;
  signal?: AbortSignal;
}): Promise<LinkupApiResponse> {
  const body: Record<string, unknown> = {
    q: params.query,
    depth: params.depth,
    outputType: params.outputType,
    maxResults: params.count,
  };
  if (params.includeDomains?.length) {
    body.includeDomains = params.includeDomains;
  }
  if (params.excludeDomains?.length) {
    body.excludeDomains = params.excludeDomains;
  }
  if (params.dateAfter) {
    body.fromDate = params.dateAfter;
  }
  if (params.dateBefore) {
    body.toDate = params.dateBefore;
  }

  return withTrustedWebSearchEndpoint(
    {
      url: params.endpoint,
      timeoutSeconds: params.timeoutSeconds,
      signal: params.signal,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
      },
    },
    async (res) => {
      if (!res.ok) {
        const detail = await readLinkupErrorDetail(res);
        throw new ProviderHttpError(
          `Linkup API error (${res.status}): ${detail || res.statusText}`,
          {
            status: res.status,
          },
        );
      }
      return await readLinkupSearchPayload(res);
    },
  );
}

function buildLinkupCacheKey(params: {
  endpoint: string;
  depth: LinkupDepth;
  outputType: LinkupOutputType;
  query: string;
  count: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  dateAfter?: string;
  dateBefore?: string;
}): string {
  return buildSearchCacheKey([
    "linkup",
    params.endpoint,
    params.depth,
    params.outputType,
    params.query,
    params.count,
    params.includeDomains?.join(",") ?? "",
    params.excludeDomains?.join(",") ?? "",
    params.dateAfter,
    params.dateBefore,
  ]);
}

export async function executeLinkupWebSearchProviderTool(
  ctx: { config?: Record<string, unknown>; searchConfig?: SearchConfigRecord },
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const searchConfig = mergeScopedSearchConfig(
    ctx.searchConfig,
    "linkup",
    resolveProviderWebSearchPluginConfig(ctx.config, "linkup"),
  ) as SearchConfigRecord | undefined;
  const params = args;
  const linkupConfig = resolveLinkupConfig(searchConfig);
  const apiKey = resolveLinkupApiKey(linkupConfig);
  if (!apiKey) {
    return missingLinkupKeyPayload();
  }
  const endpointResult = resolveLinkupSearchEndpoint(linkupConfig);
  if ("error" in endpointResult) {
    return endpointResult;
  }
  const endpoint = endpointResult.endpoint;

  const query = readStringParam(params, "query", { required: true });
  const rawDepth = readStringParam(params, "depth");
  const depth = normalizeLinkupDepth(rawDepth) ?? "standard";
  if (rawDepth && !normalizeLinkupDepth(rawDepth)) {
    return {
      error: "invalid_depth",
      message: 'depth must be one of "flash", "fast", "standard", or "deep".',
      docs: "https://docs.linkup.so/pages/documentation/endpoints/search/overview",
    };
  }

  const rawOutputType = readStringParam(params, "output_type");
  const outputType = normalizeLinkupOutputType(rawOutputType) ?? "searchResults";
  if (rawOutputType && !normalizeLinkupOutputType(rawOutputType)) {
    return {
      error: "invalid_output_type",
      message: 'output_type must be one of "searchResults" or "sourcedAnswer".',
      docs: "https://docs.linkup.so/pages/documentation/endpoints/search/overview",
    };
  }

  const count =
    readPositiveIntegerParam(params, "count", {
      max: LINKUP_MAX_SEARCH_COUNT,
      message: `count must be an integer from 1 to ${LINKUP_MAX_SEARCH_COUNT}.`,
    }) ??
    searchConfig?.maxResults ??
    undefined;

  const includeDomains = readStringArrayParam(params, "include_domains");
  const excludeDomains = readStringArrayParam(params, "exclude_domains");
  if (includeDomains && includeDomains.length > LINKUP_MAX_DOMAIN_FILTERS) {
    return {
      error: "invalid_include_domains",
      message: `include_domains supports a maximum of ${LINKUP_MAX_DOMAIN_FILTERS} domains.`,
      docs: "https://docs.linkup.so/pages/documentation/endpoints/search/overview",
    };
  }
  if (excludeDomains && excludeDomains.length > LINKUP_MAX_DOMAIN_FILTERS) {
    return {
      error: "invalid_exclude_domains",
      message: `exclude_domains supports a maximum of ${LINKUP_MAX_DOMAIN_FILTERS} domains.`,
      docs: "https://docs.linkup.so/pages/documentation/endpoints/search/overview",
    };
  }

  const rawDateAfter = readStringParam(params, "date_after");
  const rawDateBefore = readStringParam(params, "date_before");
  const parsedDateRange = parseIsoDateRange({
    rawDateAfter,
    rawDateBefore,
    invalidDateAfterMessage: "date_after must be YYYY-MM-DD format.",
    invalidDateBeforeMessage: "date_before must be YYYY-MM-DD format.",
    invalidDateRangeMessage: "date_after must be earlier than or equal to date_before.",
  });
  if ("error" in parsedDateRange) {
    return parsedDateRange;
  }
  const { dateAfter, dateBefore } = parsedDateRange;

  const resolvedCount = resolveLinkupSearchCount(count, DEFAULT_SEARCH_COUNT);
  const cacheKey = buildLinkupCacheKey({
    endpoint,
    depth,
    outputType,
    query,
    count: resolvedCount,
    includeDomains,
    excludeDomains,
    dateAfter,
    dateBefore,
  });
  const cacheTtlMs = resolveSearchCacheTtlMs(searchConfig);
  const cached = readCachedSearchPayload(cacheKey, cacheTtlMs);
  if (cached) {
    return cached;
  }

  const start = Date.now();
  const response = await runLinkupSearch({
    apiKey,
    endpoint,
    query,
    count: resolvedCount,
    depth,
    outputType,
    includeDomains,
    excludeDomains,
    dateAfter,
    dateBefore,
    timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
    signal,
  });

  signal?.throwIfAborted();

  if (outputType === "sourcedAnswer") {
    const answer = normalizeOptionalString(
      typeof response.answer === "string" ? response.answer : undefined,
    );
    if (!answer) {
      throw new Error(
        "Linkup sourcedAnswer returned no answer. Retry the query or use output_type=searchResults.",
      );
    }
    const sources = normalizeLinkupSources(response).slice(0, resolvedCount);
    const payload = {
      query,
      provider: "linkup",
      depth,
      outputType,
      tookMs: Date.now() - start,
      externalContent: {
        untrusted: true,
        source: "web_search",
        provider: "linkup",
        wrapped: true,
      },
      content: wrapWebContent(answer, "web_search"),
      citations: sources
        .map((entry) => (typeof entry.url === "string" ? entry.url : ""))
        .filter(Boolean),
      results: sources.map(mapLinkupResult),
    };
    writeCachedSearchPayload(cacheKey, payload, cacheTtlMs);
    return payload;
  }

  const results = normalizeLinkupTextResults(response).slice(0, resolvedCount).map(mapLinkupResult);
  const payload = {
    query,
    provider: "linkup",
    depth,
    outputType,
    count: results.length,
    tookMs: Date.now() - start,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "linkup",
      wrapped: true,
    },
    results,
  };

  writeCachedSearchPayload(cacheKey, payload, cacheTtlMs);
  return payload;
}
