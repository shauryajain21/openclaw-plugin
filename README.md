# openclaw-linkup-plugin

Native OpenClaw `web_search` provider plugin for [Linkup](https://www.linkup.so).

This is an installable TypeScript ESM OpenClaw plugin (not a ClawHub skill). It
registers Linkup through `api.registerWebSearchProvider(...)`, matching the
bundled Exa / Perplexity provider architecture.

## Install

From npm (after publish):

```bash
openclaw plugins install openclaw-linkup-plugin
```

From a local checkout / packed tarball:

```bash
npm pack
openclaw plugins install npm-pack:./openclaw-linkup-plugin-1.0.0.tgz --force
```

Or point OpenClaw at this package path:

```json5
{
  plugins: {
    load: { paths: ["/absolute/path/to/openclaw-plugin"] },
    entries: {
      linkup: { enabled: true }
    }
  }
}
```

## Configure

Set a Linkup API key via env or plugin config, then select Linkup as the web
search provider:

```json5
{
  plugins: {
    entries: {
      linkup: {
        config: {
          webSearch: {
            apiKey: "…", // or set LINKUP_API_KEY
            baseUrl: "https://api.linkup.so" // optional
          }
        }
      }
    }
  },
  tools: {
    web: {
      search: {
        provider: "linkup"
      }
    }
  }
}
```

Never commit API keys. Prefer `LINKUP_API_KEY` in the Gateway environment for
local/dev setups.

## Tool behavior

`web_search` with provider `linkup` calls:

`POST https://api.linkup.so/v1/search`

Defaults:

- `depth`: `standard` (`flash` | `fast` | `standard` | `deep`)
- `outputType`: `searchResults` (`searchResults` | `sourcedAnswer`)

Result mapping:

- Linkup `{ name, url, content }` → OpenClaw/Exa-like `{ title, url, description }`
- `sourcedAnswer` returns wrapped `content` plus `citations` (source URLs), similar to Perplexity’s answer path

Optional tool params: `count`, `depth`, `output_type`, `include_domains`,
`exclude_domains`, `date_after`, `date_before`.

## Develop

```bash
npm install
npm test
npm run build
```

`package.json` `openclaw.extensions` points at the built entry `./dist/index.js`.

## Package identity

| Field | Value |
| --- | --- |
| npm name | `openclaw-linkup-plugin` |
| plugin id | `linkup` |
| category | `web` |
| repository | `https://github.com/shauryajain21/openclaw-plugin.git` |
