# McpMux Server Registry

Community-maintained registry of [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server definitions for [McpMux](https://mcpmux.com) — the desktop gateway that lets AI clients (Cursor, Claude Desktop, VS Code, Windsurf) share MCP servers through a single endpoint.

Each server is defined as a single JSON file. When merged to `main`, definitions are bundled and published to the McpMux discovery API so every McpMux user can install them in one click.

## Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/<you>/mcp-servers.git
cd mcp-servers && pnpm install

# 2. Create your server definition
cp examples/complete-example.json servers/<your-id>.json

# 3. Validate
pnpm validate servers/<your-id>.json
pnpm check-conflicts

# 4. Submit
git add servers/<your-id>.json
git commit -s -m "Add <your-server-name>"
# Open a Pull Request
```

## Repository Structure

```
mcp-servers/
├── servers/                  # One JSON file per MCP server (the registry)
├── schemas/
│   └── server-definition.schema.json   # JSON Schema 2020-12
├── categories.json           # Predefined category list
├── examples/                 # Starter templates for contributors
│   ├── complete-example.json
│   ├── remote-hosted-example.json
│   ├── read-only-example.json
│   └── sponsored-example.json
├── scripts/
│   ├── validate.js           # AJV validation + conflict detection
│   └── build-bundle.js       # Aggregates servers into bundle.json
├── tests/
│   └── schema-validation.test.js
├── bundle/                   # Generated output (do not edit)
├── CONTRIBUTING.md
├── TRADEMARK-TAKEDOWN.md
└── LICENSE                   # MIT
```

## How It Works

```
contributor submits JSON  ──>  PR validation (CI)  ──>  merge to main
                                                             │
                                                     build-bundle.js
                                                             │
                                              bundle.json uploaded to R2
                                                             │
                                              McpMux apps fetch & display
```

1. You add a JSON file to `servers/`.
2. CI validates it against the schema and checks for ID/alias conflicts.
3. On merge, the bundler aggregates every definition into a single `bundle.json`, enriches it with platform metadata, and uploads it to Cloudflare R2.
4. McpMux desktop app and the discover web UI read from that bundle.

---

## Server Definition Format

### Required Fields

Every definition must include these three fields:

```jsonc
{
  "id": "community.my-server",    // unique, lowercase: {tld}.{publisher}-{name}
  "name": "My Server",            // human-readable display name
  "transport": { ... }            // how to run/connect (see below)
}
```

### Recommended Fields

```jsonc
{
  "$schema": "../schemas/server-definition.schema.json",
  "description": "What the server does in one sentence",
  "alias": "my-srv",             // short CLI alias (lowercase kebab-case)
  "icon": "https://...",         // emoji or image URL
  "schema_version": "2.1",
  "categories": ["developer-tools"],
  "tags": ["keyword1", "keyword2"],
  "auth": { "type": "api_key" },
  "contributor": { "name": "You", "github": "your-username" },
  "links": {
    "repository": "https://github.com/...",
    "homepage": "https://...",
    "documentation": "https://..."
  },
  "platforms": ["all"],          // or ["windows", "macos", "linux"]
  "capabilities": {
    "tools": true,
    "resources": true,
    "prompts": false,
    "read_only_mode": false
  },
  "changelog_url": "https://github.com/.../releases"
}
```

### Optional Fields

| Field | Description |
|-------|-------------|
| `media.screenshots` | Up to 5 screenshot URLs (recommended 1200x800px) |
| `media.demo_video` | Demo video URL (YouTube, Vimeo, etc.) |
| `media.banner` | Banner image for featured display (1200x400px) |

---

## Transport Types

### stdio — Local Command

Runs a process on the user's machine. McpMux communicates over stdin/stdout.

```json
{
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@example/mcp-server"],
    "env": {
      "API_KEY": "${input:API_KEY}"
    },
    "metadata": {
      "inputs": [
        {
          "id": "API_KEY",
          "label": "API Key",
          "type": "password",
          "required": true,
          "secret": true
        }
      ]
    }
  }
}
```

Common commands: `npx`, `uvx`, `docker`, `python`, `node`.

### http — Remote Endpoint

Points to a hosted HTTP(S) server. Supports the Streamable HTTP MCP protocol.

```json
{
  "transport": {
    "type": "http",
    "url": "https://api.example.com/mcp",
    "metadata": {
      "inputs": []
    }
  }
}
```

No local installation required — the server runs in the cloud.

---

## Input Placeholders (`${input:...}`)

Placeholders let you reference user-provided values in `args` and `env` fields. McpMux renders a configuration form based on the `metadata.inputs` array and substitutes values at runtime.

### Syntax

Use `${input:VARIABLE_ID}` anywhere in `env` values or `args`:

```json
"env": {
  "GITHUB_TOKEN": "${input:GITHUB_TOKEN}"
},
"args": ["--db-path", "${input:DB_PATH}"]
```

### Defining Inputs

Each input in `metadata.inputs` describes one field in the setup form:

```json
{
  "id": "GITHUB_TOKEN",
  "label": "GitHub Personal Access Token",
  "description": "Token with repo and read:org scopes",
  "type": "password",
  "required": true,
  "secret": true,
  "placeholder": "ghp_xxxx",
  "obtain": {
    "url": "https://github.com/settings/tokens/new",
    "instructions": "1. Click 'Generate new token'\n2. Select scopes: repo, read:org\n3. Copy the token",
    "button_label": "Create Token"
  }
}
```

| Input Property | Required | Description |
|----------------|----------|-------------|
| `id` | Yes | Uppercase identifier matching pattern `^[A-Z0-9_]+$` |
| `label` | Yes | Human-readable label shown in the UI |
| `type` | No | `text` (default), `password`, `number`, `boolean`, `url` |
| `required` | No | Whether the user must provide a value (default: `false`) |
| `secret` | No | Whether to encrypt the value in storage (default: `false`) |
| `description` | No | Help text shown below the input |
| `placeholder` | No | Greyed-out hint text inside the input |
| `obtain` | No | Link + instructions for how the user can get this value |

### Tips

- Mark API keys and tokens as `"secret": true` — McpMux encrypts them in the OS keychain.
- Always include `obtain` with step-by-step instructions when a value requires sign-up or a dashboard visit.
- Use `"type": "password"` for secrets so the UI masks the value.

---

## Authentication Types

Set the top-level `auth` field to tell users what kind of credential is needed:

| Type | When to use |
|------|------------|
| `none` | Server requires no credentials (e.g., local filesystem, public docs) |
| `api_key` | An API key or token is required |
| `optional_api_key` | Works without auth but has enhanced features with a key |
| `oauth` | Uses OAuth 2.1 flow (McpMux handles the redirect) |
| `basic` | HTTP Basic authentication |

```json
"auth": {
  "type": "api_key",
  "instructions": "Get an API key at https://example.com/api-keys"
}
```

---

## Categories

Every server should include at least one category from `categories.json`:

| ID | Name |
|----|------|
| `developer-tools` | Developer Tools |
| `version-control` | Version Control |
| `cloud` | Cloud Services |
| `productivity` | Productivity |
| `database` | Database |
| `search` | Search & Web |
| `communication` | Communication |
| `file-system` | File System |
| `documentation` | Documentation |
| `ai-ml` | AI & Machine Learning |
| `monitoring` | Monitoring & Observability |
| `security` | Security |

Need a new category? Open an issue.

---

## ID Naming Convention

IDs use the format `{tld}.{publisher}-{name}`:

| Namespace | Who | Example |
|-----------|-----|---------|
| `com.*` | Official publisher or well-known org | `com.github-mcp`, `com.notion-mcp` |
| `community.*` | Community contributors | `community.sqlite`, `community.brave-search` |

Rules:
- Lowercase only, pattern: `^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$`
- The filename must match the ID: `servers/com.github-mcp.json`
- One publisher can have multiple servers (e.g., `com.cloudflare-docs`, `com.cloudflare-bindings`)

---

## Capabilities

Declare what MCP features the server supports:

```json
"capabilities": {
  "tools": true,        // Exposes callable tools
  "resources": true,    // Provides readable resources
  "prompts": false,     // Provides prompt templates
  "read_only_mode": false  // true = no write/destructive actions
}
```

Set `read_only_mode: true` for documentation, search, or analytics servers that never modify data.

---

## Contributing a New Server

### Step-by-Step

1. **Pick a template** from `examples/`:
   - Local CLI tool → `complete-example.json`
   - Cloud/SaaS API → `remote-hosted-example.json`
   - Read-only docs/search → `read-only-example.json`

2. **Create your file** as `servers/{id}.json` using the naming convention above.

3. **Fill in the definition** — at minimum: `id`, `name`, `description`, `transport`, `categories`, and `links.repository`.

4. **Add input metadata** for every value the user needs to provide (API keys, file paths, URLs). Include `obtain` instructions wherever possible.

5. **Validate locally:**
   ```bash
   pnpm validate servers/your-file.json
   pnpm check-conflicts
   pnpm test
   ```

6. **Submit a PR** with DCO sign-off:
   ```bash
   git commit -s -m "Add my-server"
   ```

### PR Checklist

CI will verify:
- Schema compliance (AJV against `server-definition.schema.json`)
- Unique ID and alias (no conflicts with existing servers)
- Valid category references

Maintainers additionally review for:
- Accurate description and metadata
- Working install command / endpoint
- Proper `obtain` instructions for credentials
- No trademark or branding violations

### What NOT to Include

These fields are **platform-managed** and will be stripped from your submission:

- `badges` — computed from publisher verification status
- `stats` — computed metrics (installs, stars)
- `sponsored` — commercial sponsorship (managed by McpMux team)
- `featured` — homepage featured selection
- `publisher.official`, `publisher.verified`, `publisher.domain_verified` — requires verification
- Any field prefixed with `_platform`

### Updating an Existing Server

Edit the existing JSON file in `servers/` and submit a PR. The same validation runs on updates.

---

## Trademark & Branding Policy

- **Names:** You may reference third-party products (e.g., "MCP Server for GitHub"). Use language like "works with", "for", or "connects to".
- **Icons:** Emoji or external URLs only — McpMux does not host icon files. Only reference assets you have the right to use.
- **Official claims:** Do NOT use "official", "certified", or "endorsed" unless you represent the trademark owner and have been verified by McpMux.

See [TRADEMARK-TAKEDOWN.md](TRADEMARK-TAKEDOWN.md) for the full IP policy.

---

## Commands Reference

```bash
pnpm validate servers/foo.json   # Validate specific file(s)
pnpm validate:all                # Validate every server
pnpm check-conflicts             # Check for ID/alias collisions
pnpm test                        # Run full test suite (vitest)
pnpm test:watch                  # Watch mode
pnpm build                       # Generate bundle/bundle.json
```

---

## Full Example: Local stdio Server

```json
{
  "$schema": "../schemas/server-definition.schema.json",
  "id": "community.brave-search",
  "name": "Brave Search",
  "alias": "brave",
  "description": "Search the web using the Brave Search API with privacy-focused results.",
  "icon": "https://avatars.githubusercontent.com/u/12301619?v=4",
  "schema_version": "2.1",
  "categories": ["search"],
  "tags": ["brave", "search", "web-search", "privacy"],

  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@brave/brave-search-mcp-server"],
    "env": {
      "BRAVE_API_KEY": "${input:BRAVE_API_KEY}"
    },
    "metadata": {
      "inputs": [
        {
          "id": "BRAVE_API_KEY",
          "label": "Brave Search API Key",
          "description": "Free tier: 2,000 queries/month.",
          "type": "password",
          "required": true,
          "secret": true,
          "placeholder": "BSAxxxxxxxx",
          "obtain": {
            "url": "https://brave.com/search/api/",
            "instructions": "1. Sign up at brave.com/search/api\n2. Subscribe (free tier available)\n3. Copy your API key",
            "button_label": "Get API Key"
          }
        }
      ]
    }
  },

  "auth": {
    "type": "api_key",
    "instructions": "Get a Brave Search API key at https://brave.com/search/api/"
  },

  "contributor": {
    "name": "Brave",
    "github": "brave",
    "url": "https://brave.com"
  },

  "links": {
    "repository": "https://github.com/brave/brave-search-mcp-server",
    "homepage": "https://brave.com/search/api/",
    "documentation": "https://api.search.brave.com/app/documentation"
  },

  "platforms": ["all"],

  "capabilities": {
    "tools": true,
    "resources": false,
    "prompts": false,
    "read_only_mode": true
  }
}
```

## Full Example: Remote HTTP Server

```json
{
  "$schema": "../schemas/server-definition.schema.json",
  "id": "com.cloudflare-docs",
  "name": "Cloudflare Docs",
  "alias": "cf-docs",
  "description": "Search Cloudflare developer documentation using semantic search.",
  "icon": "https://avatars.githubusercontent.com/u/314135?v=4",
  "schema_version": "2.1",
  "categories": ["documentation", "cloud"],
  "tags": ["cloudflare", "docs", "workers", "pages"],

  "transport": {
    "type": "http",
    "url": "https://docs.mcp.cloudflare.com/mcp",
    "metadata": { "inputs": [] }
  },

  "auth": { "type": "none" },

  "contributor": {
    "name": "Cloudflare",
    "github": "cloudflare",
    "url": "https://developers.cloudflare.com"
  },

  "links": {
    "repository": "https://github.com/cloudflare/mcp-server-cloudflare",
    "homepage": "https://developers.cloudflare.com",
    "documentation": "https://developers.cloudflare.com/agents/model-context-protocol/"
  },

  "platforms": ["all"],

  "capabilities": {
    "tools": true,
    "resources": false,
    "prompts": false,
    "read_only_mode": true
  }
}
```

---

## License

[MIT](LICENSE)

---

## Questions?

- Open an [issue](https://github.com/nicholasgriffintn/mcp-servers/issues) for help or to request a new category.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.
- Browse the [examples/](examples/) directory for starter templates.
