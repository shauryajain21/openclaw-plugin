// Linkup plugin entrypoint registers its OpenClaw integration.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createLinkupWebSearchProvider } from "./src/linkup-web-search-provider.js";

export default definePluginEntry({
  id: "linkup",
  name: "Linkup Plugin",
  description: "Linkup web search plugin for OpenClaw",
  register(api) {
    api.registerWebSearchProvider(createLinkupWebSearchProvider());
  },
});
