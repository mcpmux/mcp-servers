# Contributing to the McpMux Server Registry

Thank you for contributing! Every definition in `servers/` becomes a one-click install for every McpMux user once it's merged. This guide walks you through the full lifecycle of a contribution: license, setup, definition anatomy, validation, PR workflow, review criteria, and the trademark rules that keep the registry honest.

If you're in a hurry, jump to:

- [Quick Start](#quick-start) — five commands to a green PR
- [Anatomy of a Definition](#anatomy-of-a-definition) — every field, whether it's required, and what it does
- [PR Checklist](#pr-checklist) — what CI and reviewers verify
- [Troubleshooting](#troubleshooting) — fixes for the validation errors you'll actually hit

> Looking to **request** a server rather than add one yourself? Open a [Request a Server](https://github.com/mcpmux/mcp-servers/issues/new?template=request-server.yml) issue. Looking to **report a broken definition**? Use the [Bug in a Server Definition](https://github.com/mcpmux/mcp-servers/issues/new?template=bug-report.yml) template.

---

## Table of Contents

- [License & DCO](#license--dco)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Repository Layout](#repository-layout)
- [Anatomy of a Definition](#anatomy-of-a-definition)
  - [Required Fields](#required-fields)
  - [Recommended Fields](#recommended-fields)
  - [Optional Fields](#optional-fields)
- [ID & Filename Rules](#id--filename-rules)
- [Transports](#transports)
  - [`stdio` — Local Command](#stdio--local-command)
  - [`http` — Remote Endpoint](#http--remote-endpoint)
- [User Inputs](#user-inputs)
  - [Placeholder Syntax](#placeholder-syntax)
  - [Input Definition](#input-definition)
  - [Input Types](#input-types)
  - [The `obtain` Block](#the-obtain-block)
- [Authentication](#authentication)
- [Categories](#categories)
- [Capabilities](#capabilities)
- [Links, Contributor, Platforms, Media](#links-contributor-platforms-media)
- [Platform-Managed Fields (Do Not Set)](#platform-managed-fields-do-not-set)
- [Validation Commands](#validation-commands)
- [PR Workflow](#pr-workflow)
- [PR Checklist](#pr-checklist)
- [Review Criteria](#review-criteria)
- [Updating an Existing Server](#updating-an-existing-server)
- [Removing a Server](#removing-a-server)
- [Trademark & Branding Policy](#trademark--branding-policy)
- [Security Expectations](#security-expectations)
- [Troubleshooting](#troubleshooting)
- [Questions & Help](#questions--help)

---

## License & DCO

This repository is licensed under the [Elastic License 2.0 (ELv2)](LICENSE). By contributing, you agree that your contributions will be licensed under the same license.

All contributions require a **Developer Certificate of Origin** sign-off on every commit. Add it automatically with `-s`:

```bash
git commit -s -m "Add community.my-server"
```

That produces a trailer like `Signed-off-by: Your Name <you@example.com>` on the commit. By signing off, you certify the statements in the [Developer Certificate of Origin v1.1](https://developercertificate.org/):

1. You created the contribution, or
2. It's based on work you have the right to submit under this license, or
3. It was provided to you by someone who certified the above.

**CI rejects unsigned commits.** If you forget, amend with `git commit --amend -s --no-edit` and force-push your branch.

## Prerequisites

- **Node.js 20+** and **pnpm 9+** — no Rust, no native dependencies.
- A GitHub account with your fork of this repo.
- A text editor with JSON support. VS Code picks up `"$schema": "../schemas/server-definition.schema.json"` and gives you field-level autocomplete and inline errors while you type.

## Quick Start

```bash
# 1. Fork on github.com, then clone your fork
git clone https://github.com/<you>/mcp-servers.git
cd mcp-servers && pnpm install

# 2. Copy the closest starter template
cp examples/complete-example.json servers/community.my-server.json

# 3. Edit the file (at minimum: id, name, description, transport, categories, links.repository)

# 4. Validate locally
pnpm validate servers/community.my-server.json
pnpm check-conflicts
pnpm test

# 5. Commit (signed off) and open a PR
git checkout -b add-my-server
git add servers/community.my-server.json
git commit -s -m "Add community.my-server"
git push origin add-my-server
# Open the PR in your browser from the link git prints
```

Your PR will be validated automatically and reviewed by a maintainer. Once merged, the next registry bundle build publishes the definition to every McpMux install.

## Repository Layout

```
mcp-servers/
├── servers/                                # One JSON file per server — the registry
├── schemas/
│   └── server-definition.schema.json       # JSON Schema 2020-12 — the contract
├── categories.json                         # Allowed category IDs
├── examples/                               # Validated templates — see examples/README.md
│   ├── stdio-no-auth.json                  # stdio, no inputs
│   ├── stdio-local-path.json               # stdio, non-secret path input, auth none
│   ├── stdio-select-toggle.json            # stdio, select + boolean options
│   ├── stdio-api-key.json                  # stdio, required API key in env
│   ├── stdio-multi-input.json              # uvx, connection details with defaults
│   ├── complete-example.json               # docker, token via -e passthrough
│   ├── sponsored-example.json              # npx, integration token
│   ├── read-only-example.json              # HTTP docs server, no auth
│   ├── http-api-key-header.json            # HTTP, token in Authorization header
│   ├── http-optional-api-key.json          # HTTP, optional token header
│   └── remote-hosted-example.json          # HTTP, OAuth handled by McpMux
├── scripts/
│   ├── validate.js                         # AJV validation + conflict detection
│   └── build-bundle.js                     # Aggregates definitions into bundle.json
├── tests/                                  # Vitest — schema, consistency, categories
├── bundle/                                 # Generated — do not edit
└── CONTRIBUTING.md                         # This file
```

Pick the example that most resembles the server you're contributing and start from there — it's faster than building from scratch and ensures you don't miss fields. [`examples/README.md`](examples/README.md) has a table of which example fits which kind of server; every example is a copy of a live definition and is validated by `pnpm test`.

---

## Anatomy of a Definition

Every server is a single JSON file at `servers/<id>.json`. The schema at [`schemas/server-definition.schema.json`](schemas/server-definition.schema.json) is the authoritative spec. This section summarises what you'll actually use.

### Required Fields

Three fields are non-negotiable — validation fails without them:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Pattern `^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$`. See [ID & Filename Rules](#id--filename-rules). |
| `name` | string | Human-readable display name. Minimum length 1. |
| `transport` | object | See [Transports](#transports). Must be `stdio` or `http`. |

### Recommended Fields

Strongly encouraged — the registry UI shows them prominently and users filter by them:

| Field | Type | Notes |
|-------|------|-------|
| `$schema` | string | `"../schemas/server-definition.schema.json"` — gives editors autocomplete. |
| `description` | string | One sentence, plain English. Shown in listings. |
| `alias` | string | Short CLI alias, pattern `^[a-z0-9-]+$`. Must not collide with any `id` or other alias. |
| `logo` | string | Stable HTTP(S) URL to a logo image (avatar or project PNG/SVG). Emoji are **not** accepted — use a GitHub avatar URL like `https://avatars.githubusercontent.com/u/{id}?v=4`. McpMux does **not** host logo files. (The legacy field name `icon` is still accepted for backward compatibility, but `logo` is the preferred name.) |
| `schema_version` | string | Currently `"2.1"`. Bump when the project publishes a new contributor schema version. |
| `categories` | string[] | IDs from [`categories.json`](categories.json). At least one. |
| `tags` | string[] | Lowercase keywords for search (`"git"`, `"search"`, `"wiki"`). 3–8 is a good target. |
| `auth` | object | See [Authentication](#authentication). Tells users what credential they need. |
| `contributor` | object | Who's adding this (`name`, `github`, `url`). |
| `links` | object | `repository`, `homepage`, `documentation`. At least `repository` if one exists. |
| `platforms` | string[] | `["all"]` or any subset of `["windows", "macos", "linux"]`. |
| `capabilities` | object | `tools`, `resources`, `prompts`, `read_only_mode` — see [Capabilities](#capabilities). |

### Optional Fields

Use when they add value:

| Field | Type | Notes |
|-------|------|-------|
| `media.screenshots` | string[] | Up to 5 URLs. Recommended 1200×800. |
| `media.demo_video` | string | YouTube / Vimeo / similar. |
| `media.banner` | string | For featured display (1200×400). |
| `changelog_url` | string | Releases or CHANGELOG URL. |

---

## ID & Filename Rules

IDs follow the format `{tld}.{publisher}-{name}`, usually ending in a suffix for how the server runs: `-npx`, `-uvx`, `-docker` or `-http`. The suffix lets one product ship several variants (`com.context7-mcp-npx`, `com.context7-mcp-docker`, `com.context7-mcp-http`).

| Namespace | Who | Examples |
|-----------|-----|----------|
| `com.*` (or the publisher's own TLD: `io.*`, `ai.*`, `co.*`, …) | Official publisher or a well-known org with legitimate claim to the namespace | `com.github-mcp-docker`, `com.notion-mcp-npx`, `com.cloudflare-docs` |
| `community.*` | Third-party contributors packaging someone else's server | `community.sqlite`, `community.brave-search-npx` |

Additional rules the validator enforces:

- **Lowercase** only. No uppercase, no spaces, no underscores in the publisher or name segment.
- **Regex:** `^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$`. One dot, first segment is TLD-ish, second segment starts with alphanumeric and may contain hyphens.
- **Filename must match ID:** `servers/com.github-mcp-docker.json`. The bundler derives the filename from the ID.
- **Uniqueness:** `pnpm check-conflicts` fails if an ID is reused, or if an `alias` collides with any `id` or other `alias` in the registry.
- **Multiple servers per publisher are fine:** `com.cloudflare-docs` and `com.cloudflare-bindings` coexist happily.

Pick the alias deliberately — users type it, so short and obvious wins (`gh`, `brave`, `cf-docs`).

---

## Transports

Exactly one of two transport types is allowed. The `oneOf` in the schema means mixing fields from both will fail validation.

### `stdio` — Local Command

Spawns a process on the user's machine; McpMux speaks MCP over stdin/stdout. Use for CLI tools, local SDKs, and anything that already ships as `npx`, `uvx`, `docker`, `python`, or `node`.

```json
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
        "secret": true,
        "placeholder": "BSAxxxx",
        "obtain": {
          "url": "https://brave.com/search/api/",
          "instructions": "1. Sign up\n2. Subscribe (free tier)\n3. Copy the key",
          "button_label": "Get API Key"
        }
      }
    ]
  }
}
```

Allowed fields: `type`, `command` (required), `args`, `env`, `cwd`, `metadata`. Nothing else — `additionalProperties: false`.

**Command choice matters:**

- `npx -y <pkg>` and `uvx <pkg>` are preferred — they install on first run with no separate setup.
- `docker run --rm -i ...` works too; use `-i` for stdin and `--rm` to clean up.
- `python`, `node`, or a raw binary path only if users realistically have them available.
- **Avoid** `bash -c`, `sh -c`, or anything that invokes a shell to run a script. See [Security Expectations](#security-expectations).

### `http` — Remote Endpoint

Points at a hosted Streamable-HTTP MCP server. No local install required.

```json
"transport": {
  "type": "http",
  "url": "https://mcp.atlassian.com/v1/mcp",
  "headers": {
    "X-My-Header": "${input:HEADER_VAL}"
  },
  "metadata": { "inputs": [] }
}
```

Allowed fields: `type`, `url` (required), `headers`, `metadata`. `headers` values support `${input:ID}` interpolation just like `env`.

Prefer HTTP transport when the upstream is a SaaS product — users don't have to install anything locally, and OAuth flows stay clean.

---

## User Inputs

Anything a user has to provide — API keys, file paths, workspace slugs, enable/disable toggles — goes through `transport.metadata.inputs`. McpMux renders a setup form from this array, substitutes values at runtime, and encrypts secrets.

### Placeholder Syntax

Reference inputs as `${input:ID}` anywhere inside `env`, `args`, or `headers`:

```json
"env": { "GITHUB_TOKEN": "${input:GITHUB_TOKEN}" },
"args": ["--db-path", "${input:DB_PATH}"],
"headers": { "Authorization": "Bearer ${input:TOKEN}" }
```

**Every placeholder must have a matching `inputs[].id`.** `pnpm test` fails if one doesn't. An unmatched placeholder is never filled in, so the server would receive the literal text `${input:...}`.

**The reverse matters too: every input should be referenced by a placeholder.** On stdio, McpMux also exports each input as an env var named after its `id`. On http, an input that isn't used in `headers` or `url` is collected from the user and never sent.

### Input Definition

| Property | Required | Notes |
|----------|----------|-------|
| `id` | Yes | Uppercase regex `^[A-Z0-9_]+$` (e.g. `API_KEY`, `DB_PATH`). Matches the `${input:ID}` placeholder. |
| `label` | Yes | Human-readable label shown in the UI. |
| `type` | No | See [Input Types](#input-types). Default `"text"`. |
| `required` | No | Default `false`. Required inputs block form submission until provided. |
| `secret` | No | Default `false`. `true` → stored in the OS keychain, never written to plain SQLite or logged. |
| `description` | No | Help text shown beneath the field. |
| `default` | No | Pre-filled value used when the user provides none. |
| `placeholder` | No | Greyed hint inside the input. |
| `obtain` | No | See [The `obtain` Block](#the-obtain-block). |
| `options` | No | For `type: "select"` only — array of `{ value, label, description? }`. |

### Input Types

Pick the type that matches how the value is used:

| Type | When to use |
|------|-------------|
| `text` | Free-form string (default). |
| `number` | Numeric values — the UI renders a number input. |
| `boolean` | On/off toggles — becomes `"true"` / `"false"` as a string when substituted. |
| `url` | URLs — the UI validates shape. |
| `select` | Closed set of options — pair with `options: [{ value, label, description? }]`. |
| `file_path` | File picker. |
| `directory_path` | Directory picker. |

There is no `password` input type: the schema rejects `"type": "password"` and validation fails. For API keys, tokens and passwords, use `type: "text"` plus `secret: true`. The UI masks secret fields regardless of `type`.

**Always pair API keys with `secret: true` and `required: true`.** That's how McpMux knows to stash the value in the OS keychain instead of SQLite.

### The `obtain` Block

Whenever a value requires the user to visit a dashboard, sign up, or generate a token, include an `obtain` block. It becomes a one-click button next to the field in the setup UI.

```json
"obtain": {
  "url": "https://github.com/settings/tokens/new",
  "instructions": "1. Click 'Generate new token (classic)'\n2. Give it a name like 'McpMux'\n3. Select scopes: repo, read:org\n4. Click 'Generate token'\n5. Copy the token (starts with ghp_)",
  "button_label": "Create Token"
}
```

Guidance:

- **Number your steps** and use `\n` between them — the UI renders each as a separate line.
- **Be specific about scopes / permissions** users should check. A GitHub token with no scopes is useless; they'll open an issue asking why the server "doesn't work".
- **Link deep** when you can (`.../settings/tokens/new?scopes=repo,read:org&description=McpMux`) — GitHub and a few others pre-fill the form.
- **Keep `button_label` short** (<= 20 characters). "Create Token", "Get API Key", "Open Console".

---

## Authentication

The top-level `auth` field advertises what kind of credential the server expects, independent of how it's wired up in `transport`.

| `type` | When to use |
|--------|-------------|
| `none` | No credentials (local filesystem, public docs, open search). |
| `api_key` | A token is required for any useful call. |
| `optional_api_key` | Works without auth (rate-limited or read-only) but unlocks more with a key. |
| `oauth` | Full OAuth 2.1 + PKCE flow. McpMux drives the redirect. |
| `basic` | HTTP Basic auth (username + password). Rare; prefer `api_key` or `oauth`. |

```json
"auth": {
  "type": "api_key",
  "instructions": "Get an API key at https://brave.com/search/api/"
}
```

`instructions` is free-form. Keep it to one or two sentences — the detailed flow belongs in the input's `obtain` block.

> **`auth.type` does not create an input.** It's the badge and help text users see. The setup form comes only from `transport.metadata.inputs`, and a value reaches the server only through a `${input:ID}` placeholder: `env` / `args` / `command` for stdio, `headers` / `url` for http. An `api_key` server with no inputs never asks for a key. An http input that isn't referenced in `headers` or `url` is never sent.
>
> The one behavioral exception is `oauth`: McpMux won't auto-connect an `oauth` server until the user has signed in through McpMux's browser flow. For http servers, McpMux starts OAuth when the endpoint answers `401`, and skips it when the definition sends its own `Authorization` header.
>
> See [Auth, Inputs & Placeholders](README.md#auth-inputs--placeholders--how-they-fit-together) and [Common Mistakes](README.md#common-mistakes) in the README for a decision table and worked examples.

---

## Categories

Every server should declare at least one category from [`categories.json`](categories.json):

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

Multiple categories are fine when they genuinely apply (e.g. `["productivity", "documentation"]` for a wiki tool). Don't stuff every plausible category — it dilutes filtering.

Need a new category? Open an [issue](https://github.com/mcpmux/mcp-servers/issues/new/choose) **before** opening your PR — category changes touch `categories.json`, the schema tests, and the discovery UI, so they're easier to land separately.

---

## Capabilities

Declare what the server actually implements — the registry UI uses these as filters.

```json
"capabilities": {
  "tools": true,           // Exposes callable MCP tools
  "resources": true,       // Provides readable MCP resources
  "prompts": false,        // Provides prompt templates
  "read_only_mode": false  // true = server never writes or performs destructive actions
}
```

- `tools`, `resources`, `prompts` mirror the [MCP capabilities](https://modelcontextprotocol.io/) the server advertises on `initialize`.
- `read_only_mode: true` is a **strong** claim. Set it only for docs lookup, search, observability dashboards, and similar — any write endpoint disqualifies. This drives a filter users rely on to sandbox agents.

If you're unsure, install the server locally, run it, and check the `initialize` response. Declaring a capability the server doesn't implement is a reviewer reject.

---

## Links, Contributor, Platforms, Media

### `links`

```json
"links": {
  "repository": "https://github.com/brave/brave-search-mcp-server",
  "homepage": "https://brave.com/search/api/",
  "documentation": "https://api.search.brave.com/app/documentation"
}
```

At least `repository` when one exists. Format: valid URI. Broken links are a reviewer reject.

### `contributor`

```json
"contributor": {
  "name": "Brave",
  "github": "brave",
  "url": "https://brave.com"
}
```

This is you, or the org you represent. `github` is a username without the `@`.

### `platforms`

```json
"platforms": ["all"]
// or
"platforms": ["macos", "linux"]
```

Use `["all"]` unless the server genuinely doesn't run on one of Windows / macOS / Linux (e.g. it spawns `.dll` hooks). Containerised servers are typically `all`.

### `media`

Optional but discoverable — up to 5 screenshots, one demo video, one banner:

```json
"media": {
  "screenshots": [
    "https://example.com/screens/1.png",
    "https://example.com/screens/2.png"
  ],
  "demo_video": "https://youtube.com/watch?v=...",
  "banner": "https://example.com/banner-1200x400.png"
}
```

Only reference images you have the right to display. McpMux hot-links these; a broken or rotating URL will look bad in the registry.

---

## Platform-Managed Fields (Do Not Set)

The validator strips and **warns** on these during `pnpm validate`. Setting them in a PR is a review reject:

- `badges` — computed from publisher verification status
- `stats` — installs, stars, usage metrics (computed)
- `sponsored` — commercial sponsorship slot (McpMux only)
- `featured` — homepage feature selection (McpMux only)
- `publisher.official`, `publisher.verified`, `publisher.domain_verified` — require maintainer verification
- Any top-level key prefixed with `_platform` — reserved for the bundler

If you believe your server qualifies for verified or official status, say so in the PR description and a maintainer will follow up separately.

---

## Validation Commands

Run locally before pushing — CI runs the same commands and will fail the PR otherwise:

```bash
pnpm validate servers/community.my-server.json   # Validate a specific file
pnpm validate:all                                 # Validate every server
pnpm check-conflicts                              # ID / alias collision detection
pnpm check-provenance servers/community.my-server.json  # Install source, publisher, logo, endpoint (needs network)
pnpm test                                         # Full vitest suite (schema, consistency, categories, bundle)
pnpm build                                        # Generate bundle/bundle.json (optional locally)
```

`validate` accepts multiple file arguments: `pnpm validate servers/a.json servers/b.json`. It prints:

- `PASS  servers/your-file.json` — structurally valid.
- `FAIL  servers/your-file.json` — followed by `- /field/path: reason` lines from AJV.
- `WARNING:` lines when platform-managed fields are present (they'll be stripped at build time).

`check-conflicts` reports:

- `CONFLICT  Duplicate ID "..."` — same `id` in two files.
- `CONFLICT  Duplicate alias "..."` — same `alias` in two files.
- `CONFLICT  ID "..." collides with alias in ...` — your ID matches an existing alias (or vice versa).

### Provenance Checks

Schema validation proves a definition is well-formed. `check-provenance` proves it points at something real, published by the project it links to. CI runs it on every changed server file.

| Check | Fails when |
|-------|------------|
| Install source | The npm / PyPI package, version, Docker image or tag, or `--from` git repo doesn't exist; or the package has no executable matching the command (`uvx <pkg>` needs a `<pkg>` console script; `npx` needs a single `bin` or one named after the package) |
| Publisher | The package's own metadata (npm `repository`, PyPI project URLs, `--from` git owner) points to a different GitHub owner than `links.repository` |
| Logo | A GitHub-avatar logo belongs to a personal or bot account that doesn't own `links.repository` |
| Repository | `links.repository` doesn't exist |
| Endpoint | The host doesn't resolve, the URL redirects (MCP clients don't follow redirects on POST — use the final URL), or it returns 404 |

Trust is anchored on the owner of `links.repository` (and its fork parent). `contributor` never vouches for a package or logo. Timeouts, rate limits and hosts that block CI runners only produce warnings.

If a legitimate definition trips an error — say, a publisher whose package metadata still names an old org — say so in the PR. A maintainer can waive that specific error for that server in `scripts/provenance-allowlist.json`.

---

## PR Workflow

1. **Fork & branch.** Keep unrelated changes on separate branches; one server per PR keeps review fast.

2. **Add or edit the JSON** in `servers/<id>.json`.

3. **Validate locally** — all three commands should pass before you push:
   ```bash
   pnpm validate servers/<id>.json
   pnpm check-conflicts
   pnpm test
   ```

4. **Commit with sign-off:**
   ```bash
   git commit -s -m "Add community.my-server"
   ```

5. **Push and open a PR.** Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md). A good title is `Add com.example-tool` or `Fix env var name for community.sqlite`.

6. **CI runs.** The `validate-pr` workflow runs the same commands you ran locally, plus bundle regeneration. Red tick → read the log, fix, push again (no need to close/reopen).

7. **Review.** A maintainer will sanity-check the definition and, for stdio servers, may test the install locally. Expect feedback within a few days; poke the thread if you don't hear back in a week.

8. **Merge.** On merge, the registry bundler picks up the new definition and uploads a fresh `bundle.json` to Cloudflare R2. Desktop apps see it on their next refresh (usually under a minute).

## PR Checklist

CI automatically verifies:

- [ ] JSON file placed in `servers/`
- [ ] Filename matches the `id` field (`servers/com.example.json` ↔ `"id": "com.example"`)
- [ ] Schema validates (`pnpm validate`)
- [ ] No ID / alias conflicts (`pnpm check-conflicts`)
- [ ] All required fields present (`id`, `name`, `transport`)
- [ ] DCO sign-off on every commit

Reviewers additionally check:

- [ ] `description` is accurate, one sentence, and doesn't oversell
- [ ] `transport.command` / `transport.url` actually works (for stdio, preferably installable via `npx`/`uvx`/`docker`)
- [ ] Every `${input:ID}` placeholder has a matching `inputs[].id`
- [ ] Secrets are marked `secret: true` so they land in the OS keychain
- [ ] `obtain` blocks exist and have usable instructions for every credential
- [ ] At least one valid category from `categories.json`
- [ ] `links.repository` (when one exists) is public and resolves
- [ ] `capabilities` reflect what the server actually implements
- [ ] No platform-managed fields (`badges`, `stats`, `sponsored`, `featured`, `publisher.official`, etc.)
- [ ] No trademark / branding violations (see below)

## Review Criteria

Beyond the checklist, reviewers apply judgement on:

- **Is this useful to more than one person?** The registry isn't a dump for hobby scripts. A "works on my machine" tool with no upstream repo is usually a reject.
- **Is the upstream project alive?** Commit recency, open issue triage, signs of maintenance. Abandoned servers get nudged toward archival.
- **Is the install command correct on every declared platform?** If you claim `platforms: ["all"]` and the command only works on Linux, that's a blocker.
- **Does the description avoid marketing fluff?** "The best MCP server for X" → no. "Search Brave with privacy-focused results" → yes.
- **Does the definition avoid claiming official/verified status it hasn't earned?** That's an auto-reject — see the policy below.

---

## Updating an Existing Server

Same process as adding one: edit the JSON in `servers/`, validate, sign-off commit, PR. Title the PR `Update <id>: <what changed>` so it's obvious at a glance.

If you're the original contributor, you can make changes freely. If someone else originally submitted the server, prefer opening an issue first to coordinate — especially for breaking changes like renaming inputs, changing the transport, or adjusting scopes.

**Never change an `id` on an existing server.** Users with the server installed will lose their configuration. If you truly need to rename, add a new file under the new ID and flag the old one for archival in the PR description.

## Removing a Server

Open an issue or PR explaining why (upstream archived, security issue, duplicate, trademark takedown). Maintainers handle the actual removal so the bundler knows to signal existing installs.

---

## Trademark & Branding Policy

The registry is community-built but consumed via the McpMux brand, so we're careful here.

### Names & descriptions

- **Descriptive use is fine:** "MCP Server for GitHub", "Connects to Notion", "Works with Linear".
- **Implied endorsement is not:** "Official GitHub MCP", "Certified by Notion", "Endorsed by Linear" — unless you actually represent the trademark owner and have been verified.
- Phrases to prefer: *works with*, *for*, *connects to*, *integrates with*.

### Logos

- McpMux does not host logo files. The `logo` field must be an HTTP(S) URL to an image. Emoji are not accepted.
- **Only reference assets you have the right to use.** Corporate logos are usually fine for descriptive, non-commercial use in a directory listing; but don't hot-link assets with restrictive terms.
- Prefer GitHub avatars (`https://avatars.githubusercontent.com/u/<id>?v=4`) or official brand URLs over random CDN copies that may rotate.
- The legacy field name `icon` is still accepted for backward compatibility, but new submissions should use `logo`.

### Official / verified claims

- All community submissions default to unverified.
- `publisher.official`, `publisher.verified`, `publisher.domain_verified`, and `"official"`/`"verified"` badges are maintainer-controlled. PRs that set them are rejected unless submitted by a verified publisher.
- To request verification, open an issue from your org's GitHub account and we'll follow up.

### Takedowns

See [TRADEMARK-TAKEDOWN.md](TRADEMARK-TAKEDOWN.md) for the full IP policy and the maintainer contact path.

By opening a PR you agree that:

1. You have the right to reference any URLs you include.
2. You're not claiming official status or endorsement you don't have.
3. You accept responsibility for trademark compliance of your submission.
4. You grant McpMux a license to display your definition — including rendering any referenced logo URLs — on the discover site and desktop app.
5. McpMux may modify or remove your submission in response to trademark concerns.

---

## Security Expectations

The registry installs code on end-user machines (for stdio servers) and proxies credentials on their behalf. We hold definitions to a higher bar than typical community packages.

- **No arbitrary shell scripts.** `bash -c "curl ... | sh"` and similar get rejected on sight. Stick to `npx`, `uvx`, `docker`, `python`, `node`, or HTTP endpoints.
- **Credential sanity.** Mark every token/key with `secret: true`. Never bake credentials into `args` that persist in process listings; route them through `env` instead.
- **No network side effects from the definition itself.** The JSON file must be static — no fetched values, no templated install scripts.
- **OAuth prefers PKCE.** If `auth.type: "oauth"`, the upstream should support PKCE; otherwise add a note in `auth.instructions`.
- **Declare `read_only_mode: true` honestly.** A server that deletes calendar events is not read-only, no matter how "safe" the tool author thinks the call is.
- **Report vulnerabilities privately.** If you spot a security issue in an existing definition or upstream server, don't open a public issue — email the maintainers (see repo for current contact) or use GitHub private vulnerability reporting.

---

## Troubleshooting

### `FAIL  servers/foo.json` with `must match pattern`

You've violated a regex. The two most common culprits:

- **`id`:** must match `^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$`. No uppercase, no underscores in the publisher segment, exactly one dot.
- **Input `id`:** must match `^[A-Z0-9_]+$`. Uppercase + underscores only.

### `must match exactly one schema in oneOf` under `transport`

You've mixed fields from both transport types. An `http` transport can't have `command`/`args`/`env`/`cwd`; a `stdio` transport can't have `url`/`headers`. Start fresh from the matching example in `examples/`.

### `must have required property 'command'` (or `'url'`)

A transport with `"type": "stdio"` requires `command`. A transport with `"type": "http"` requires `url`. These are enforced by the transport's `oneOf` branches.

### `CONFLICT  Duplicate ID "..."`

Someone else already registered that ID. Pick another — or if you're updating, make sure you're editing the existing file rather than creating a new one.

### `CONFLICT  Alias "..." collides with ID in ...`

Aliases share a namespace with IDs. Pick a different alias.

### `WARNING: "badges" is a platform-managed field and will be stripped`

You've set a field the platform controls. Remove it from your definition — leaving it in works (the validator strips it) but a reviewer will ask you to clean it up anyway.

### `must match format "uri"`

A URL field isn't a valid URI. Common fix: missing scheme. `example.com` fails; `https://example.com` passes.

### The `$schema` line isn't giving autocomplete in VS Code

`"$schema": "../schemas/server-definition.schema.json"` works when the file is in `servers/`. If you moved it, adjust the relative path. Restart the JSON language server if it's stuck.

---

## Questions & Help

- **Ask a question or request a new category:** open an [issue](https://github.com/mcpmux/mcp-servers/issues/new/choose).
- **Discuss designs or roadmap:** [GitHub Discussions](https://github.com/mcpmux/mcp-mux/discussions) on the main repo.
- **Browse before contributing:** the live registry is at [mcpmux.com](https://mcpmux.com) — search first to avoid duplicates.
- **Starter templates:** [`examples/`](examples/) — copy the closest match.

Thanks for making the registry better.
