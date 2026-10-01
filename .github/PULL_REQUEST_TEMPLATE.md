<!--
Thanks for contributing to the McpMux server registry!

Most PRs here add or update a server definition in `servers/`. Fill in the
sections below that apply and delete the rest. See CONTRIBUTING.md for the
full contributor guide.
-->

## Change Type

<!-- Tick one. -->

- [ ] Add a new server definition
- [ ] Update an existing server definition
- [ ] Fix a bug in an existing definition
- [ ] Other (describe in Summary)

## Summary

<!-- One or two sentences: what does this PR do and why? -->

## Server Details

<!-- Fill this section for Add / Update / Fix. Delete it for anything else. -->

- **Server Name:**
- **Server ID:** `community.example` or `com.publisher-name`
- **Transport:** `stdio` / `http`
- **Authentication:** `none` / `api_key` / `optional_api_key` / `oauth` / `basic`
- **Categories:** <!-- from categories.json, e.g. developer-tools, productivity -->
- **Upstream Repository:** https://github.com/...

## Checklist

### CI-enforced — your PR will fail without these

- [ ] JSON file lives at `servers/<id>.json`
- [ ] Filename matches the `id` field exactly
- [ ] Required fields present: `id`, `name`, `transport`
- [ ] `pnpm validate servers/<id>.json` passes
- [ ] `pnpm check-conflicts` passes (no duplicate IDs or aliases)
- [ ] `pnpm test` passes
- [ ] `pnpm check-provenance servers/<id>.json` passes (install source, publisher, logo, endpoint)
- [ ] Every commit is signed off — `git commit -s` (DCO)

### Reviewer quality bar

- [ ] `description` is one clear sentence — no marketing fluff
- [ ] At least one category from [`categories.json`](../categories.json) is assigned
- [ ] Every `${input:ID}` placeholder has a matching `metadata.inputs[].id`
- [ ] Every secret / credential input is marked `"secret": true`
- [ ] Each credential input has an `obtain` block with step-by-step instructions (numbered, `\n` between steps)
- [ ] `auth.type` is consistent with how credentials are actually wired into the transport
- [ ] `links.repository` resolves (when the upstream is public)
- [ ] `capabilities` (`tools` / `resources` / `prompts` / `read_only_mode`) reflect what the server actually implements
- [ ] `platforms` is accurate — don't claim `["all"]` without verifying Windows/macOS/Linux

### Platform-managed fields — leave unset

<!--
The validator strips these; PRs that set them are rejected. See
CONTRIBUTING.md → "Platform-Managed Fields (Do Not Set)".
-->

- [ ] I did **not** set `badges`, `stats`, `sponsored`, `featured`
- [ ] I did **not** set `publisher.official`, `publisher.verified`, `publisher.domain_verified`
- [ ] I did **not** add any `_platform*`-prefixed keys

### Trademark & branding

<!-- See CONTRIBUTING.md → "Trademark & Branding Policy" for details. -->

- [ ] No "official" / "certified" / "endorsed" wording unless I represent the trademark owner
- [ ] I have the right to reference the `logo` URL (an asset I'm allowed to hot-link — emoji are not accepted)

### Tested locally (recommended for new servers)

- [ ] Installed the server in McpMux and it started successfully
- [ ] Called at least one tool / fetched at least one resource / rendered at least one prompt

## Notes for Reviewers

<!--
Anything surprising, gotchas, links to upstream issues, reason for unusual
choices, or context maintainers should know before approving.
-->
