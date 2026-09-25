declare module "openclaw/plugin-sdk/plugin-entry" {
  export function definePluginEntry(entry: {
    id: string;
    name: string;
    description?: string;
    register: (api: {
      registerWebSearchProvider: (provider: unknown) => void;
    }) => void;
  }): unknown;
}

declare module "openclaw/plugin-sdk/lazy-runtime" {
  export function createLazyRuntimeModule<T>(
    loader: () => Promise<T>,
  ): () => Promise<T>;
}

declare module "openclaw/plugin-sdk/provider-web-search-contract" {
  export type WebSearchProviderPlugin = {
    id: string;
    label: string;
    hint: string;
    onboardingScopes?: readonly "text-inference"[];
    credentialLabel?: string;
    envVars: string[];
    placeholder: string;
    signupUrl: string;
    docsUrl?: string;
    autoDetectOrder?: number;
    credentialPath: string;
    createTool: (ctx: {
      config?: Record<string, unknown>;
      searchConfig?: Record<string, unknown>;
    }) => {
      description: string;
      parameters: Record<string, unknown>;
      execute: (
        args: Record<string, unknown>,
        context?: { signal?: AbortSignal },
      ) => Promise<Record<string, unknown>>;
    } | null;
    [key: string]: unknown;
  };

  export function createWebSearchProviderContractFields(options: {
    credentialPath: string;
    searchCredential:
      | { type: "scoped"; scopeId: string }
      | { type: "top-level" }
      | { type: "none" };
    configuredCredential?: { pluginId: string; field?: string };
    selectionPluginId?: string;
    inactiveSecretPaths?: string[];
  }): Record<string, unknown>;
}

declare module "openclaw/plugin-sdk/provider-web-search" {
  export const DEFAULT_SEARCH_COUNT: number;
  export function buildSearchCacheKey(parts: unknown[]): string;
  export function mergeScopedSearchConfig(
    searchConfig: Record<string, unknown> | undefined,
    scopeId: string,
    pluginConfig: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined;
  export function parseIsoDateRange(params: Record<string, unknown>):
    | { dateAfter?: string; dateBefore?: string }
    | { error: string; message: string; docs: string };
  export function readCachedSearchPayload(
    cacheKey: string,
    ttlMs: number,
  ): Record<string, unknown> | undefined;
  export function readConfiguredSecretString(
    value: unknown,
    path: string,
  ): string | undefined;
  export function readPositiveIntegerParam(
    params: Record<string, unknown>,
    key: string,
    options?: { max?: number; message?: string },
  ): number | undefined;
  export function readProviderEnvValue(names: string[]): string | undefined;
  export function readStringArrayParam(
    params: Record<string, unknown>,
    key: string,
  ): string[] | undefined;
  export function readStringParam(
    params: Record<string, unknown>,
    key: string,
    options: { required: true },
  ): string;
  export function readStringParam(
    params: Record<string, unknown>,
    key: string,
    options?: { required?: boolean },
  ): string | undefined;
  export function resolveProviderWebSearchPluginConfig(
    config: Record<string, unknown> | undefined,
    pluginId: string,
  ): Record<string, unknown> | undefined;
  export function resolveSearchCacheTtlMs(
    searchConfig?: Record<string, unknown>,
  ): number;
  export function resolveSearchTimeoutSeconds(
    searchConfig?: Record<string, unknown>,
  ): number;
  export function resolveSiteName(url: string): string;
  export function withTrustedWebSearchEndpoint<T>(
    params: {
      url: string;
      timeoutSeconds: number;
      signal?: AbortSignal;
      init: RequestInit;
    },
    run: (response: Response) => Promise<T>,
  ): Promise<T>;
  export function wrapWebContent(content: string, source?: string): string;
  export function writeCachedSearchPayload(
    cacheKey: string,
    payload: Record<string, unknown>,
    ttlMs: number,
  ): void;
}

declare module "openclaw/plugin-sdk/provider-http" {
  export class ProviderHttpError extends Error {
    constructor(
      message: string,
      options?: { status?: number; cause?: unknown },
    );
    status?: number;
  }
  export function readResponseTextLimited(
    response: Response,
    maxBytes: number,
  ): Promise<string>;
}

declare module "openclaw/plugin-sdk/number-runtime" {
  export function parseStrictPositiveInteger(
    value: unknown,
  ): number | undefined;
}

declare module "openclaw/plugin-sdk/response-limit-runtime" {
  export function readResponseWithLimit(
    response: Response,
    maxBytes: number,
    options?: { onOverflow?: (info: { maxBytes: number }) => Error },
  ): Promise<Uint8Array>;
}

declare module "openclaw/plugin-sdk/string-coerce-runtime" {
  export function normalizeOptionalLowercaseString(
    value: string | undefined | null,
  ): string | undefined;
  export function normalizeOptionalString(
    value: string | undefined | null,
  ): string | undefined;
}
