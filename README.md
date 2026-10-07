# McpMux Server Registry

Community-maintained registry of [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server definitions for [McpMux](https://mcpmux.com) — the desktop gateway that lets AI clients (Cursor, Claude Desktop, VS Code, Windsurf) share MCP servers through a single endpoint.

Each server is defined as a single JSON file. When merged to `main`, definitions are bundled and published to the McpMux discovery API so every McpMux user can install them in one click.

**[Browse servers on mcpmux.com](https://mcpmux.com)** · **[Download McpMux](https://mcpmux.com/download)** · **[Explore features](https://mcpmux.com/features)** · **[Join our Discord](https://discord.gg/b4RDmwAHAN)**

## Contents

- [Quick Start](#quick-start)
- [Pick a Starting Example](#pick-a-starting-example)
- [Server Definition Format](#server-definition-format)
- [Transport Types](#transport-types)
- [Auth, Inputs & Placeholders — How They Fit Together](#auth-inputs--placeholders--how-they-fit-together)
- [Defining Inputs](#defining-inputs)
- [Examples Cookbook](#examples-cookbook)
- [Common Mistakes](#common-mistakes)
- [ID Naming Convention](#id-naming-convention)
- [Categories](#categories) · [Capabilities](#capabilities)
- [Contributing a New Server](#contributing-a-new-server)
- [Working With an AI Coding Agent](#working-with-an-ai-coding-agent)
- [Commands Reference](#commands-reference)

## Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/<you>/mcp-servers.git
cd mcp-servers && pnpm install        # or: npm ci

# 2. Copy the example closest to your server (see the table below)
cp examples/stdio-api-key.json servers/<your-id>.json

# 3. Edit it, then validate
pnpm validate servers/<your-id>.json
pnpm check-conflicts
pnpm test

# 4. Submit
git add servers/<your-id>.json
git commit -s -m "Add <your-id>"
# Open a Pull Request
```

## Pick a Starting Example

Every file in [`examples/`](examples/) is a copy of a real definition from `servers/` and passes validation (enforced by `pnpm test`). Pick the row that matches **what the server needs from the user**:

| The server needs… | Transport | `auth.type` | Start from |
|---|---|---|---|
| Nothing — it just runs | stdio | `none` | [`stdio-no-auth.json`](examples/stdio-no-auth.json) |
| A folder or file path (not a secret) | stdio | `none` | [`stdio-local-path.json`](examples/stdio-local-path.json) |
| A few settings — a dropdown, a toggle | stdio | `none` | [`stdio-select-toggle.json`](examples/stdio-select-toggle.json) |
| An API key it can't work without | stdio | `api_key` | [`stdio-api-key.json`](examples/stdio-api-key.json) |
| A token, run through Docker | stdio | `api_key` | [`complete-example.json`](examples/complete-example.json) |
| Connection details (host, port, user, password) | stdio | `optional_api_key` | [`stdio-multi-input.json`](examples/stdio-multi-input.json) |
| Nothing — hosted endpoint | http | `none` | [`read-only-example.json`](examples/read-only-example.json) |
| An API key sent as a header | http | `api_key` | [`http-api-key-header.json`](examples/http-api-key-header.json) |
| An optional key (anonymous access works) | http | `optional_api_key` | [`http-optional-api-key.json`](examples/http-optional-api-key.json) |
| A browser sign-in (OAuth) | http | `oauth` | [`remote-hosted-example.json`](examples/remote-hosted-example.json) |

[`examples/README.md`](examples/README.md) explains what each one demonstrates and what to change when you copy it.

## Repository Structure

```
mcp-servers/
├── servers/                  # One JSON file per MCP server (the registry)
├── schemas/
│   └── server-definition.schema.json   # JSON Schema 2020-12 — the contract
├── categories.json           # Allowed category IDs
├── examples/                 # Validated starter templates (see table above)
├── scripts/
│   ├── validate.js           # AJV validation + conflict detection
│   └── build-bundle.js       # Aggregates servers into bundle.json
├── tests/                    # Vitest — schema, examples, placeholders, bundle
├── bundle/                   # Generated output (do not edit)
├── AGENTS.md                 # Instructions for AI coding agents
├── CONTRIBUTING.md
├── TRADEMARK-TAKEDOWN.md
└── LICENSE
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
4. McpMux desktop app and the [discover web UI](https://mcpmux.com) read from that bundle.

> **Want to browse servers without cloning?** Visit [mcpmux.com](https://mcpmux.com) to search, filter, and one-click install servers directly into the McpMux desktop app.

---

## Server Definition Format

### Required Fields

Every definition must include these three fields:

```jsonc
{
  "id": "community.my-server-npx",  // unique, lowercase: {tld}.{publisher}-{name}
  "name": "My Server (npx)",        // human-readable display name
  "transport": { ... }              // how to run/connect (see below)
}
```

### Recommended Fields

```jsonc
{
  "$schema": "../schemas/server-definition.schema.json",
  "description": "What the server does in one sentence",
  "alias": "my-srv",             // short CLI alias (lowercase kebab-case)
  "logo": "https://...",         // HTTP(S) URL to a logo image (emoji not accepted)
  "schema_version": "2.1",
  "categories": ["developer-tools"],
  "tags": ["keyword1", "keyword2"],
  "auth": { "type": "api_key", "instructions": "Where to get a key" },
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
    "args": ["-y", "@brave/brave-search-mcp-server"],
    "env": {
      "BRAVE_API_KEY": "${input:BRAVE_API_KEY}"
    },
    "metadata": {
      "inputs": [
        {
          "id": "BRAVE_API_KEY",
          "label": "Brave Search API Key",
          "type": "text",
          "required": true,
          "secret": true
        }
      ]
    }
  }
}
```

Allowed fields: `type`, `command` (required), `args`, `env`, `cwd`, `metadata`. Common commands: `npx`, `uvx`, `docker`, `python`, `node`. Don't wrap commands in `bash -c` / `sh -c`.

### http — Remote Endpoint

Points to a hosted Streamable HTTP MCP server. No local installation required.

```json
{
  "transport": {
    "type": "http",
    "url": "https://api.githubcopilot.com/mcp/",
    "headers": {
      "Authorization": "Bearer ${input:GITHUB_TOKEN}"
    },
    "metadata": {
      "inputs": [
        {
          "id": "GITHUB_TOKEN",
          "label": "GitHub Personal Access Token",
          "type": "text",
          "required": true,
          "secret": true
        }
      ]
    }
  }
}
```

Allowed fields: `type`, `url` (required), `headers`, `metadata`. A server with no credentials simply omits `headers` and uses `"inputs": []`.

The schema's `oneOf` means you can't mix the two: an `http` transport can't have `command`/`args`/`env`, and a `stdio` transport can't have `url`/`headers`.

---

## Auth, Inputs & Placeholders — How They Fit Together

This is the part people most often get wrong. A definition describes credentials in **three separate places**, and each one does a different job:

| Layer | Field | What it does | What it does **not** do |
|---|---|---|---|
| 1. Label | `auth.type` (+ `auth.instructions`) | Shows a badge ("API Key", "API Key (Optional)", "OAuth") and help text in the McpMux UI | It does **not** add a field to the setup form, and it does **not** send anything to the server |
| 2. Form | `transport.metadata.inputs[]` | Each entry becomes one field in the setup form. `required` blocks saving until it's filled; `secret` stores it in the OS keychain | It does **not** deliver the value by itself |
| 3. Delivery | `${input:ID}` placeholders | Put the user's value where the server reads it: `env`, `args` or `command` for stdio; `url` or `headers` for http | — |

> **`"auth": { "type": "api_key" }` never creates an API key field on its own.**
> If `inputs` is empty, the user is never asked for a key. If the input exists but no placeholder references it, the key is collected and never sent. You need all three layers.

The reverse is also true: **inputs aren't only for credentials.** A folder path, a region, a browser choice or a feature toggle are all inputs on a server whose `auth.type` is `none`. See [`stdio-local-path.json`](examples/stdio-local-path.json) and [`stdio-select-toggle.json`](examples/stdio-select-toggle.json).

### Choosing `auth.type`

Pick it from how the **credential inputs** are set up — the label should describe the form the user will actually see:

| `auth.type` | Use when | The inputs must include |
|---|---|---|
| `none` | The server needs no credential. It can still have non-secret inputs (paths, options, toggles) | No secret inputs |
| `api_key` | The server fails without a credential: a key/token, or a username + password | At least one input with `"secret": true, "required": true`, wired into the transport |
| `optional_api_key` | It works without a key (anonymous, free tier, local instance) and a key unlocks more | The secret input has `"required": false` |
| `oauth` | A **remote `http`** endpoint where McpMux runs the OAuth sign-in in the browser | Usually no inputs at all — McpMux handles the tokens |

### Where input values go

| Transport | You can reference `${input:ID}` in | Notes |
|---|---|---|
| `stdio` | `env`, `args`, `command` | Prefer `env` for secrets: `args` show up in process listings. McpMux also exports every input to the process as an env var named after its `id`. An explicit `env` entry is still clearer, and you need one when the server expects a different variable name |
| `http` | `url`, `headers` | **Nothing else reaches a remote server.** An http input that isn't referenced in `url` or `headers` is thrown away |

### How OAuth works for http servers

- McpMux implements the MCP authorization flow. When an `http` server answers `401`, McpMux discovers its OAuth metadata and opens the browser sign-in. You don't put client IDs, secrets or tokens in the definition.
- With `"auth": { "type": "oauth" }`, McpMux won't auto-connect the server until the user completes sign-in, and the UI shows it as needing OAuth.
- If the definition sends its own `Authorization` header (for example a personal access token), McpMux **skips** OAuth for that server. That's why the registry can have both an OAuth variant ([`remote-hosted-example.json`](examples/remote-hosted-example.json)) and a token variant ([`http-api-key-header.json`](examples/http-api-key-header.json)) of the same kind of service.

---

## Defining Inputs

Each entry in `transport.metadata.inputs` describes one field in the setup form:

```json
{
  "id": "GITHUB_TOKEN",
  "label": "GitHub Personal Access Token",
  "description": "Token with repo and read:org scopes",
  "type": "text",
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
| `id` | Yes | Uppercase identifier matching `^[A-Z0-9_]+$`. This is the `ID` in `${input:ID}` |
| `label` | Yes | Human-readable label shown in the UI |
| `type` | No | One of the input types below (default `text`) |
| `required` | No | The user must fill it in before saving (default `false`) |
| `secret` | No | Store it encrypted in the OS keychain and mask it in the UI (default `false`) |
| `description` | No | Help text shown below the input |
| `placeholder` | No | Greyed-out hint text inside the input |
| `default` | No | Value used when the user provides none (always a string, e.g. `"8443"`, `"true"`) |
| `options` | No | For `select` only: `[{ "value": "...", "label": "...", "description": "..." }]` |
| `obtain` | No | Link + numbered steps telling the user how to get the value |

### Input Types

| `type` | Renders as | Example use |
|--------|------------|-------------|
| `text` | Text field (default) | API keys and tokens (with `"secret": true`), hostnames, project IDs |
| `number` | Number field | Ports, limits |
| `boolean` | Toggle — substituted as `"true"` / `"false"` | Headless mode, "verify SSL" |
| `url` | URL field | Self-hosted instance URL |
| `select` | Dropdown built from `options` | Region, environment, browser |
| `file_path` | File picker | SQLite database, credentials JSON |
| `directory_path` | Folder picker | Workspace or allowed directory |

> There is **no `password` type** — the schema rejects it. For secrets, use `"type": "text"` with `"secret": true`.

### Tips

- Mark every API key, token and password `"secret": true`.
- Include an `obtain` block with numbered steps whenever the value requires a sign-up or dashboard visit. Name the exact scopes or permissions needed.
- Keep inputs `required: false` when the server has a sensible fallback, and say what happens when it's left blank in the `description`.

---

## Examples Cookbook

Short, focused snippets for each pattern. Each links to a complete, validated file.

### 1. No configuration at all — [`stdio-no-auth.json`](examples/stdio-no-auth.json)

```json
"transport": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  "metadata": { "inputs": [] }
},
"auth": { "type": "none" }
```

### 2. A non-secret input passed as an argument — [`stdio-local-path.json`](examples/stdio-local-path.json)

`auth.type` stays `none`: a folder path is configuration, not a credential.

```json
"transport": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "${input:ALLOWED_DIR}"],
  "metadata": {
    "inputs": [
      {
        "id": "ALLOWED_DIR",
        "label": "Allowed Directory",
        "type": "directory_path",
        "required": true,
        "secret": false
      }
    ]
  }
},
"auth": { "type": "none" }
```

### 3. Options: a dropdown and a toggle — [`stdio-select-toggle.json`](examples/stdio-select-toggle.json)

There is no `env` block here. McpMux exports each input as an env var named after its `id`, and Playwright MCP reads `PLAYWRIGHT_MCP_BROWSER` / `PLAYWRIGHT_MCP_HEADLESS`.

```json
"inputs": [
  {
    "id": "PLAYWRIGHT_MCP_BROWSER",
    "label": "Browser",
    "type": "select",
    "required": false,
    "options": [
      { "value": "chrome", "label": "Chrome" },
      { "value": "firefox", "label": "Firefox" },
      { "value": "webkit", "label": "WebKit" },
      { "value": "msedge", "label": "Microsoft Edge" }
    ]
  },
  {
    "id": "PLAYWRIGHT_MCP_HEADLESS",
    "label": "Headless Mode",
    "type": "boolean",
    "required": false
  }
]
```

### 4. Required API key via environment variable — [`stdio-api-key.json`](examples/stdio-api-key.json)

All three layers: the `auth` label, the input, and the `env` placeholder.

```json
"transport": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@brave/brave-search-mcp-server"],
  "env": { "BRAVE_API_KEY": "${input:BRAVE_API_KEY}" },
  "metadata": {
    "inputs": [
      {
        "id": "BRAVE_API_KEY",
        "label": "Brave Search API Key",
        "type": "text",
        "required": true,
        "secret": true,
        "placeholder": "BSAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "obtain": {
          "url": "https://brave.com/search/api/",
          "instructions": "1. Go to brave.com/search/api\n2. Sign up or log in\n3. Subscribe to a plan (free tier available)\n4. Copy your API key from the dashboard",
          "button_label": "Get API Key"
        }
      }
    ]
  }
},
"auth": {
  "type": "api_key",
  "instructions": "Get a Brave Search API key at https://brave.com/search/api/"
}
```

### 5. Docker — [`complete-example.json`](examples/complete-example.json)

Docker doesn't forward the host environment into the container. List each variable with a bare `-e NAME` (no value) in `args`, and set its value in `env`. That keeps the token out of the command line.

```json
"transport": {
  "type": "stdio",
  "command": "docker",
  "args": [
    "run", "-i", "--rm",
    "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
    "-e", "GITHUB_HOST",
    "ghcr.io/github/github-mcp-server"
  ],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "${input:GITHUB_PERSONAL_ACCESS_TOKEN}",
    "GITHUB_HOST": "${input:GITHUB_HOST}"
  }
}
```

`GITHUB_PERSONAL_ACCESS_TOKEN` is `required` + `secret`. `GITHUB_HOST` is an optional, non-secret setting for GitHub Enterprise.

### 6. Connection details with defaults — [`stdio-multi-input.json`](examples/stdio-multi-input.json)

A `uvx` (Python) server that takes host, user, password, port and TLS flags. It uses `number` and `boolean` types with `default` values. The password is optional (some instances have none), so `auth.type` is `optional_api_key`.

```json
"env": {
  "CLICKHOUSE_HOST": "${input:CLICKHOUSE_HOST}",
  "CLICKHOUSE_USER": "${input:CLICKHOUSE_USER}",
  "CLICKHOUSE_PASSWORD": "${input:CLICKHOUSE_PASSWORD}",
  "CLICKHOUSE_PORT": "${input:CLICKHOUSE_PORT}",
  "CLICKHOUSE_SECURE": "${input:CLICKHOUSE_SECURE}"
},
"metadata": {
  "inputs": [
    { "id": "CLICKHOUSE_HOST", "label": "ClickHouse Host", "type": "text", "required": true },
    { "id": "CLICKHOUSE_USER", "label": "ClickHouse User", "type": "text", "required": true },
    { "id": "CLICKHOUSE_PASSWORD", "label": "ClickHouse Password", "type": "text", "required": false, "secret": true },
    { "id": "CLICKHOUSE_PORT", "label": "ClickHouse Port", "type": "number", "default": "8443" },
    { "id": "CLICKHOUSE_SECURE", "label": "Use HTTPS (Secure)", "type": "boolean", "default": "true" }
  ]
}
```

### 7. Hosted endpoint, no auth — [`read-only-example.json`](examples/read-only-example.json)

```json
"transport": {
  "type": "http",
  "url": "https://docs.mcp.cloudflare.com/mcp",
  "metadata": { "inputs": [] }
},
"auth": { "type": "none" },
"capabilities": { "tools": true, "resources": false, "prompts": false, "read_only_mode": true }
```

### 8. Hosted endpoint with an API key header — [`http-api-key-header.json`](examples/http-api-key-header.json)

For `http` servers the key **must** go into `headers` (or the `url`). Use whatever header the upstream documents: `Authorization: Bearer …` is the most common, and some use a custom one such as `"Api-Key": "${input:NEW_RELIC_API_KEY}"`.

```json
"transport": {
  "type": "http",
  "url": "https://api.githubcopilot.com/mcp/",
  "headers": { "Authorization": "Bearer ${input:GITHUB_TOKEN}" },
  "metadata": {
    "inputs": [
      { "id": "GITHUB_TOKEN", "label": "GitHub Personal Access Token", "type": "text", "required": true, "secret": true }
    ]
  }
},
"auth": { "type": "api_key", "instructions": "Create a personal access token with repo and read:org scopes" }
```

### 9. Hosted endpoint with an optional key — [`http-optional-api-key.json`](examples/http-optional-api-key.json)

Same wiring as #8, but the input is `required: false` and `auth.type` is `optional_api_key`. The `description` tells the user what they get by adding a key.

```json
"headers": { "Authorization": "Bearer ${input:HF_TOKEN}" },
"metadata": {
  "inputs": [
    {
      "id": "HF_TOKEN",
      "label": "Hugging Face Token",
      "description": "Optional. Anonymous access works, but a token unlocks higher rate limits and your private resources.",
      "type": "text",
      "required": false,
      "secret": true
    }
  ]
},
"auth": { "type": "optional_api_key" }
```

### 10. Hosted endpoint with OAuth — [`remote-hosted-example.json`](examples/remote-hosted-example.json)

No inputs, no headers. McpMux runs the browser sign-in and stores the tokens.

```json
"transport": {
  "type": "http",
  "url": "https://mcp.atlassian.com/v1/mcp",
  "metadata": { "inputs": [] }
},
"auth": {
  "type": "oauth",
  "instructions": "Authenticates via OAuth 2.1 in your browser."
}
```

---

## Common Mistakes

| ❌ Don't | Why it breaks | ✅ Do |
|---|---|---|
| `"auth": { "type": "api_key" }` with `"inputs": []` | The badge says a key is needed, but the user never gets a field to enter one | Add a `secret` + `required` input and reference it with `${input:ID}` |
| An `http` input that isn't used in `headers` or `url` | The user types their key and McpMux never sends it | `"headers": { "Authorization": "Bearer ${input:API_KEY}" }` (or the header the upstream documents) |
| `"required": true` on a key the server doesn't need | Users who could run it anonymously are blocked from saving | `"required": false` + `"auth": { "type": "optional_api_key" }` |
| `"type": "password"` | Not in the schema — validation fails | `"type": "text", "secret": true` |
| A secret passed in `args` (`--api-key ${input:KEY}`) when the server also reads an env var | Arguments are visible in process listings | Map it through `env` |
| `${input:api_key}` or a placeholder with no matching input | Input IDs are uppercase, and an unmatched placeholder is never filled in | Match `inputs[].id` exactly, e.g. `${input:API_KEY}` |
| `"auth": { "type": "oauth" }` plus client ID / secret inputs for a hosted endpoint | McpMux already runs the OAuth flow for `http` servers | No inputs; let McpMux handle sign-in |
| `-e GITHUB_TOKEN=${input:GITHUB_TOKEN}` in Docker `args` | Puts the secret on the command line | `"-e", "GITHUB_TOKEN"` in `args`, and the value in `env` |

CI enforces the schema, and `pnpm test` checks that every `${input:ID}` has a matching input. Reviewers check the rest.

---

## ID Naming Convention

IDs use the format `{tld}.{publisher}-{name}`, usually followed by the way the server is run:

| Suffix | Meaning | Example |
|--------|---------|---------|
| `-npx` | Node package run with `npx` | `community.brave-search-npx` |
| `-uvx` | Python package run with `uvx` | `com.clickhouse-mcp-uvx` |
| `-docker` | Docker image | `com.github-mcp-docker` |
| `-http` | Hosted endpoint | `com.context7-mcp-http` |

The suffix lets one product ship several variants side by side (`com.context7-mcp-npx`, `com.context7-mcp-docker`, `com.context7-mcp-http`).

| Namespace | Who | Example |
|-----------|-----|---------|
| `com.*`, `io.*`, `ai.*`, … | The publisher's own domain TLD — official publishers or well-known orgs | `com.github-mcp-docker`, `co.huggingface-mcp` |
| `community.*` | Community contributors packaging someone else's server | `community.filesystem`, `community.brave-search-npx` |

Rules:
- Lowercase only, pattern: `^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$`
- The filename must match the ID: `servers/com.github-mcp-docker.json`
- Never change the `id` of a server that's already published. Users' installs are keyed by it.

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
| `design` | Design |

Need a new category? Open an issue.

---

## Capabilities

Declare what MCP features the server supports:

```jsonc
"capabilities": {
  "tools": true,        // Exposes callable tools
  "resources": true,    // Provides readable resources
  "prompts": false,     // Provides prompt templates
  "read_only_mode": false  // true = no write/destructive actions
}
```

Set `read_only_mode: true` only for documentation, search, or analytics servers that never modify data.

---

## Contributing a New Server

### Step-by-Step

1. **Pick a template** from [Pick a Starting Example](#pick-a-starting-example).

2. **Create your file** as `servers/{id}.json` using the [naming convention](#id-naming-convention).

3. **Fill in the definition.** At minimum: `id`, `name`, `description`, `transport`, `categories`, and `links.repository`. Take the package name, env var names, CLI flags and endpoint URL from the upstream server's README, not from memory.

4. **Add an input for every value the user provides** (API keys, paths, URLs), reference each one with `${input:ID}`, and set `auth.type` to match. See [Auth, Inputs & Placeholders](#auth-inputs--placeholders--how-they-fit-together).

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
- Every `${input:ID}` placeholder has a matching input

Maintainers additionally review for:
- Accurate description and metadata
- Working install command / endpoint
- `auth.type` consistent with the inputs and how they're wired
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

Edit the existing JSON file in `servers/` and submit a PR. The same validation runs on updates. Don't rename input IDs casually: users' saved values are keyed by them.

---

## Trademark & Branding Policy

- **Names:** You may reference third-party products (e.g., "MCP Server for GitHub"). Use language like "works with", "for", or "connects to".
- **Logos:** HTTP(S) URLs only — McpMux does not host logo files and emoji are not accepted. Only reference assets you have the right to use.
- **Official claims:** Do NOT use "official", "certified", or "endorsed" unless you represent the trademark owner and have been verified by McpMux.

See [TRADEMARK-TAKEDOWN.md](TRADEMARK-TAKEDOWN.md) for the full IP policy.

---

## Working With an AI Coding Agent

[`AGENTS.md`](AGENTS.md) gives coding agents (Claude Code, Codex, Cursor, Copilot and others) the repo rules, the auth/input model and the validation commands. Point your agent at it and ask for something like *"Add a definition for `<upstream repo URL>`"*. Review the result against the [Common Mistakes](#common-mistakes) table before opening the PR.

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

CI uses npm (`npm ci`, then `npm run validate`, `npm run check-conflicts`, `npm test`). Both package managers work locally.

---

## McpMux Ecosystem

| Resource | Link |
|----------|------|
| **McpMux Desktop App** | [Download](https://mcpmux.com/download) — Windows, macOS, Linux |
| **Discover Servers** | [mcpmux.com](https://mcpmux.com) — browse, search, and install MCP servers |
| **Features** | [mcpmux.com/features](https://mcpmux.com/features) — Spaces, Feature Sets, encrypted credentials, and more |
| **Source Code** | [github.com/mcpmux/mcp-mux](https://github.com/mcpmux/mcp-mux) |
| **Community Chat** | [Discord](https://discord.gg/b4RDmwAHAN) — questions, help, and release news |

---

## License

[MIT](LICENSE)

---

## Questions?

- Open an [issue](https://github.com/mcpmux/mcp-servers/issues) for help or to request a new category.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.
- Browse the [examples/](examples/) directory for starter templates.
- Visit [mcpmux.com](https://mcpmux.com) to learn more about the McpMux platform.
