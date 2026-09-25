// Linkup provider module implements model/runtime integration.
import { createWebSearchProviderContractFields } from "openclaw/plugin-sdk/provider-web-search-contract";

const LINKUP_CREDENTIAL_PATH = "plugins.entries.linkup.config.webSearch.apiKey";
const LINKUP_ONBOARDING_SCOPES: Array<"text-inference"> = ["text-inference"];

export function createLinkupWebSearchProviderBase() {
  return {
    id: "linkup",
    label: "Linkup Search",
    hint: "Agentic web search with ranked sources and sourced answers",
    onboardingScopes: [...LINKUP_ONBOARDING_SCOPES],
    credentialLabel: "Linkup API key",
    envVars: ["LINKUP_API_KEY"],
    placeholder: "…",
    signupUrl: "https://app.linkup.so",
    docsUrl: "https://docs.linkup.so/pages/documentation/endpoints/search/overview",
    autoDetectOrder: 68,
    credentialPath: LINKUP_CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: LINKUP_CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "linkup" },
      configuredCredential: { pluginId: "linkup" },
      selectionPluginId: "linkup",
    }),
  };
}
