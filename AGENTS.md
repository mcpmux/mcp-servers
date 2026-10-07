# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor, Copilot, …) working inside the `mcp-servers` registry repo. Complements [`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md); when anything here conflicts with an explicit user instruction in the current session, the user wins.

## Project Overview

`mcp-servers` is the community-maintained registry of MCP server definitions for [McpMux](https://mcpmux.com). Each server is a single JSON file in `servers/`, validated against a JSON Schema on every PR. Merges to `main` are bundled and published to the McpMux discovery API, so definitions land in user installs automatically.

This is **not** a code repo — there is no runtime to ship, no UI to build. The artefact is the set of JSON files and the bundle generated from them. Agent changes here are almost always JSON edits plus CI green.

The schema only checks shape. Most real-world breakage is a definition that validates but doesn't work: a key that's collected and never sent, an env var name the server doesn't read, an `auth.type` that doesn't match the inputs. Most of this file is about avoiding those.

## Repository Layout

```
mcp-servers/
├── servers/                       # One JSON file per MCP server — the registry
├── schemas/
│   └── server-definition.schema.json   # JSON Schema 2020-12 — the contract
├── categories.json                # Allowed categories
├── examples/                      # Validated templates, copies of live servers — see examples/README.md
├── scripts/
│   ├── validate.js                # AJV validation + conflict detection
│   └── build-bundle.js            # Aggregates servers into bundle/bundle.json
├── tests/                         # Vitest — schema, examples, placeholders, categories, bundle
├── bundle/                        # Generated — do not edit by hand
├── .claude/skills/                # Claude Code skills: add-mcp-server, review-server-pr, review-server-trust
├── CLAUDE.md                      # Imports this file for Claude Code
├── CONTRIBUTING.md
└── LICENSE
```

## Setup & Commands

```bash
pnpm install      # or: npm ci  (CI uses npm)
```

Node.js 20+. No Rust, no native deps.

| pnpm | npm (what CI runs) | What it does |
|------|--------------------|--------------|
| `pnpm validate servers/<file>.json` | `npm run validate -- servers/<file>.json` | Validate specific definition(s) against the schema + categories |
| `pnpm validate:all` | `npm run validate:all` | Validate every file in `servers/` |
| `pnpm check-conflicts` | `npm run check-conflicts` | Detect ID/alias collisions across definitions |
| `pnpm test` | `npm test` | Full suite: schema, examples, `${input:ID}` ↔ input matching, categories, bundle |
| `pnpm build` | `npm run build` | Generate `bundle/bundle.json` |

**Always run `pnpm validate:all && pnpm check-conflicts && pnpm test` before claiming a change is done.** CI runs the same checks on every PR.

## The Credential Model (read this before writing any definition)

A definition describes credentials in three separate places. All three must agree:

| Layer | Field | Effect in McpMux |
|-------|-------|------------------|
| 1. Label | `auth.type`, `auth.instructions` | Badge + help text only. **Creates no input and sends nothing** (exception: `oauth`, below) |
| 2. Form | `transport.metadata.inputs[]` | One setup-form field per entry. `required` blocks saving until filled. `secret` stores it in the OS keychain |
| 3. Delivery | `${input:ID}` placeholders | Substitutes the value where the server reads it |

Where placeholders can go:

- **stdio:** `env`, `args`, `command`. McpMux *also* exports every input to the process as an env var named after its `id`. Still prefer an explicit `env` mapping, and use one whenever the server's variable name differs from the input `id`.
- **http:** `url` and `headers` **only**. An http input that isn't referenced in either is collected from the user and thrown away.

Picking `auth.type`, derived from the inputs:

| Inputs | `auth.type` |
|--------|-------------|
| No secret inputs (paths, options, toggles are fine) | `none` |
| ≥1 input with `"secret": true, "required": true`, wired via a placeholder | `api_key` |
| Secret input(s) all `"required": false` (anonymous / free tier / passwordless works) | `optional_api_key` |
| Hosted `http` endpoint where McpMux runs the browser OAuth flow; normally zero inputs | `oauth` |
| Username + secret password (both required) | `api_key` |

OAuth behavior (verified in the McpMux gateway):

- For `http` servers, McpMux starts the MCP OAuth flow when the endpoint answers `401`. Don't add client ID/secret/token inputs for that.
- With `auth.type: "oauth"`, McpMux does not auto-connect the server until the user has completed sign-in through McpMux.
- If the definition sends its own `Authorization` header (a PAT variant), McpMux skips OAuth for that server.

Other gotchas:

- Input `type` is one of `text`, `number`, `boolean`, `url`, `select`, `file_path`, `directory_path`. **There is no `password` type** (the schema rejects it). Secrets are `"type": "text", "secret": true`.
- `boolean` values are substituted as the strings `"true"` / `"false"`. `default` values are strings too (`"8443"`).
- A blank optional input is substituted as an empty string. `--api-key ""` in `args` can break a CLI, so route optional values through `env` where the server supports it.
- Secrets in `args` are visible in process listings. Use `env` whenever the server reads an env var.
- Docker doesn't inherit the host env. Use a bare `"-e", "NAME"` in `args` plus `"NAME": "${input:NAME}"` in `env`, never `-e NAME=${input:...}`.
- Real anti-pattern to avoid: an `http` definition with a required `EXA_API_KEY` input but no `headers` — the key never leaves McpMux.

See the README's [Examples Cookbook](README.md#examples-cookbook) and [Common Mistakes](README.md#common-mistakes) for worked snippets.

## Agent Workflow: Adding a Server

Typical prompt: *"Add a definition for https://github.com/acme/acme-mcp"*. In Claude Code, the `add-mcp-server` skill runs this workflow.

1. **Check for duplicates.** `ls servers | grep -i <name>`, and grep `servers/` for the upstream repo URL and package name. If it exists, you're updating, not adding. Never change an existing `id`.
2. **Research the upstream. Don't guess.** Read the upstream README (and `package.json` / `pyproject.toml` / Dockerfile if needed) and write down:
   - How it runs: an npm package (`npx -y <pkg>`), a PyPI package (`uvx <pkg>`), a container image (`docker run -i --rm … <image>`), or a hosted URL (`http`). If several exist, each is a separate definition with its own suffix.
   - Every env var and CLI flag it reads, which are required, and what happens when an optional one is unset.
   - How it authenticates: an API key/token (which header for http?), OAuth handled by the endpoint, or nothing.
   - Whether it exposes tools, resources and prompts, and whether it can write or delete anything (that decides `read_only_mode`).
   - The repository, homepage, docs and releases URLs.
   - Confirm the artefact exists without running it: `npm view <pkg> name version`, `curl -s https://pypi.org/pypi/<pkg>/json`, the image's registry page. **Never execute the server** to find out.
3. **Choose the ID.** Use `{tld}.{publisher}-{name}` plus a transport suffix (`-npx`, `-uvx`, `-docker`, `-http`). Use the publisher's own TLD (`com.`, `io.`, `ai.`, …) for vendor-published servers and `community.` for third-party packaging. The filename is `servers/<id>.json`. The `alias` is short, lowercase kebab-case and unique; `check-conflicts` will tell you.
4. **Copy the closest example** from [`examples/README.md`](examples/README.md) and replace every field. Don't leave the example's description, tags, logo or links behind.
5. **Write the transport.** Use exact package names, flags and env var names from step 2.
6. **Add inputs and wire them.** Add one input per user-supplied value, with a `${input:ID}` placeholder for each. Credentials get `secret: true` and an `obtain` block: URL, numbered `\n`-separated steps naming exact scopes, and a short `button_label`. Optional values get `required: false` plus a `description` saying what happens when they're blank.
7. **Set `auth.type`** from the table above and add a one-sentence `auth.instructions`.
8. **Fill in the metadata.**
   - `description`: one or two plain sentences, no hype, no "official".
   - `categories`: from `categories.json`.
   - `tags`: 3–8 lowercase keywords.
   - `logo`: an HTTP(S) URL. A GitHub org avatar works well: `https://avatars.githubusercontent.com/u/<id>?v=4`, with `<id>` from `https://api.github.com/users/<org>`.
   - Also `contributor`, `links`, `platforms` (`["all"]` unless it really isn't cross-platform), `capabilities`, `changelog_url`, `"schema_version": "2.1"`, `"$schema": "../schemas/server-definition.schema.json"`.
9. **Validate:** `pnpm validate servers/<id>.json && pnpm check-conflicts && pnpm test`.
10. **Self-review** against the checklist below, then commit with `git commit -s` and open a PR using the template.

## Reviewing a Definition (your own, or someone's PR)

In Claude Code, the `review-server-pr` skill runs this checklist against a PR.

- [ ] File is `servers/<id>.json`, the ID follows the convention, and only intended files changed (no edits to `schemas/`, `scripts/`, `tests/`, `.github/`, `bundle/`)
- [ ] `validate`, `check-conflicts` and `test` pass against **current** `main`, not just the PR's base
- [ ] The package / image / endpoint exists and matches `links.repository`
- [ ] Trust: the brand's own site or org links the endpoint/package (not just the other way round), credentials reach only their issuer, and the live tool surface asks for no card data, seed phrases or keys. The `review-server-trust` skill runs these checks
- [ ] Every input is referenced by a placeholder. For http that means `headers` or `url`
- [ ] `auth.type` matches the inputs (table above). No `oauth` + client-secret inputs on a hosted endpoint
- [ ] Env var names and flags match the upstream docs
- [ ] Secrets are `secret: true`, go through `env` rather than `args` where possible, and have an `obtain` block
- [ ] No `"type": "password"`
- [ ] `capabilities` are accurate, and `read_only_mode: true` only if nothing writes
- [ ] Description is factual, with no "official/certified/endorsed" unless the submitter is the vendor
- [ ] No platform-managed fields
- [ ] Not a duplicate of an existing server or another open PR

Leave review comments with concrete JSON fixes, not just "please fix auth".

## Server Definition Rules

Every definition must include **`id`**, **`name`**, and **`transport`**. Recommended additions: `description`, `alias`, `categories`, `capabilities`, `links.repository`, `contributor`, `platforms`, `auth`.

- **ID regex:** `^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$`. The filename must match.
- **Transport:** `stdio` (`command` required; `args`, `env`, `cwd`, `metadata` allowed) or `http` (`url` required; `headers`, `metadata` allowed). The schema's `oneOf` rejects mixed fields.
- **Input IDs:** uppercase, `^[A-Z0-9_]+$`. They must match their placeholders exactly.
- **Categories:** from `categories.json` only. Need a new one? Open a registry issue — don't invent an ID inline.

## Platform-Managed Fields (do not set)

Contributor PRs that touch these are rejected:

- `badges`, `stats`, `sponsored`, `featured`
- `publisher.official`, `publisher.verified`, `publisher.domain_verified`
- Any `_platform*` prefix

These are computed or granted by McpMux maintainers after verification.

## Trademark & Branding

- Reference third-party products with "works with", "for", or "connects to" — never "official", "certified", "endorsed" unless you represent the trademark owner and are verified.
- Logos are referenced by HTTP(S) URL in the `logo` field — McpMux does not host logo files and emoji are not accepted. Only link to assets you have the right to reference. The legacy field name `icon` is still accepted for backward compatibility, but tests reject it in `servers/`.
- See `TRADEMARK-TAKEDOWN.md` for the full IP policy.

## Commit & PR Guidelines

- Commits must be **signed off** (DCO): `git commit -s -m "..."`.
- One server per PR keeps review fast. Multi-server PRs are fine for coordinated maintenance sweeps.
- PRs follow [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md). The checklist exists to catch the common failure modes — please actually tick it.
- Don't bypass hooks (`--no-verify`) or DCO signing unless explicitly told to.

## Issue Templates

Two templates live in `.github/ISSUE_TEMPLATE/`:

- `request-server.yml` — ask the community to add a server you don't have a definition for. **Deep-linked from the McpMux desktop app** — keep the filename stable.
- `bug-report.yml` — flag a broken or incorrect existing definition. **Deep-linked from the McpMux desktop app** — keep the filename stable.

Contributors who want to add a server open a PR against `servers/` — there is no issue-based submission path. See `CONTRIBUTING.md` for the flow.

Renaming or removing either template breaks deep links shipped in every installed McpMux — don't do it without coordinating with the app.

## Things Not To Do

- **Don't edit `bundle/`** — it's generated by `scripts/build-bundle.js`. CI will overwrite anything you put there.
- **Don't edit `schemas/server-definition.schema.json`** as part of a server submission. Schema changes are their own PR, discussed separately.
- **Don't claim official status** (`publisher.official: true`, "official" badge, etc.) unless you're a verified publisher.
- **Don't remove or rename issue-template files** without coordinating with the McpMux app — the desktop app links to specific template filenames.
- **Don't add servers that require the user to run arbitrary shell scripts during install.** Stick to `npx`, `uvx`, `docker`, `python`, `node`, or HTTPS endpoints.
- **Don't run an upstream server to "test" a definition** from an agent session. Verify from docs and package metadata, and leave the live test to a human in McpMux.
- **Don't invent env var names, flags or endpoint URLs.** If the upstream docs don't say, ask the user or leave the input out.
