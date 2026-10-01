#!/usr/bin/env node

/**
 * Provenance checks for MCP server definitions.
 *
 * Schema validation proves a definition is well-formed; this proves it points
 * at something real, published by the project it links to:
 *
 *   - the npm / PyPI / Docker / git install source exists and can actually run
 *   - the package's own metadata points back at the `links.repository` owner
 *   - a GitHub-avatar logo belongs to that owner, not an unrelated account
 *   - a remote endpoint resolves and answers without redirecting
 *
 * Trust is anchored on the `links.repository` owner (and its fork parent).
 * `contributor` is written by the submitter, so it never vouches for anything.
 *
 * Only definitive failures are errors (404s, missing executables, NXDOMAIN,
 * redirects). Anything that could be a transient network problem or a host
 * blocking CI runners is a warning, because this runs in a required check.
 *
 * Maintainers can waive a specific error for a specific server in
 * scripts/provenance-allowlist.json (code-owned, so it needs maintainer review).
 *
 * Usage:
 *   node scripts/check-provenance.js servers/foo.json servers/bar.json
 *   node scripts/check-provenance.js --all
 *
 * Set GITHUB_TOKEN to raise the GitHub API rate limit.
 */

const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const SERVERS_DIR = path.join(ROOT, "servers");
const ALLOWLIST_PATH = path.join(__dirname, "provenance-allowlist.json");
const USER_AGENT = "mcpmux-provenance-check";
const TIMEOUT_MS = 20000;
const MAX_WHEEL_BYTES = 30 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Parsing (pure)
// ---------------------------------------------------------------------------

/** `npx -y pkg` / `npx -p pkg cmd` -> { spec, command } */
function parseNpx(args) {
  const packages = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-p" || a === "--package") {
      packages.push(args[++i]);
    } else if (a.startsWith("--package=")) {
      packages.push(a.slice("--package=".length));
    } else if (a.startsWith("-")) {
      continue;
    } else if (packages.length) {
      return { spec: packages[0], command: a };
    } else {
      return { spec: a, command: null };
    }
  }
  return { spec: packages[0] || null, command: null };
}

/** `@scope/name@1.2.3` -> { name: "@scope/name", version: "1.2.3" } */
function splitNpmSpec(spec) {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  if (at === -1) return { name: spec, version: null };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) || null };
}

const UVX_VALUE_OPTIONS = new Set([
  "--with", "--with-editable", "--with-requirements", "--python", "-p", "--index", "--index-url",
  "--extra-index-url", "--default-index", "--find-links", "-f", "--env-file", "--refresh-package",
  "--upgrade-package", "-P", "--reinstall-package", "--exclude-newer", "--index-strategy",
  "--keyring-provider", "--resolution", "--prerelease", "--cache-dir", "--config-file", "--directory",
  "--project", "--color", "--build-constraints", "--constraints", "-c", "--overrides", "--python-platform",
]);

/**
 * `uvx [--from SRC] cmd` and `pipx run [--spec SRC] cmd` -> { source, executable }.
 * Without --from/--spec, the positional is both the package spec and the executable.
 */
function parsePythonRunner(command, args) {
  let rest = args;
  if (command === "pipx") {
    if (rest[0] !== "run") return { source: null, executable: null };
    rest = rest.slice(1);
  }
  const fromFlag = command === "pipx" ? "--spec" : "--from";
  let source = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === fromFlag) {
      source = rest[++i];
    } else if (a.startsWith(`${fromFlag}=`)) {
      source = a.slice(fromFlag.length + 1);
    } else if (UVX_VALUE_OPTIONS.has(a)) {
      i++;
    } else if (!a.startsWith("-")) {
      if (source) return { source, executable: a };
      const { name } = splitPySpec(a);
      return { source: a, executable: name || a };
    }
  }
  return { source, executable: null };
}

/** `pkg[extra]==1.2` / `pkg@1.2` / `pkg>=1` -> { name, version } (version only when pinned). */
function splitPySpec(spec) {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(?:(?:==|@)\s*([A-Za-z0-9.+!_-]+)|[<>=!~].*)?$/.exec(spec);
  if (!m) return { name: null, version: null };
  return { name: m[1], version: m[3] && m[3] !== "latest" ? m[3] : null };
}

const DOCKER_VALUE_OPTIONS = new Set([
  "-e", "--env", "-v", "--volume", "-p", "--publish", "--name", "--network", "--net", "--env-file", "-w",
  "--workdir", "--entrypoint", "-u", "--user", "--mount", "--platform", "--pull", "--add-host", "--cap-add",
  "--cap-drop", "-m", "--memory", "--cpus", "--label", "-l", "--hostname", "-h", "--dns", "--device",
  "--tmpfs", "--shm-size", "--ulimit", "--log-driver", "--log-opt", "--restart", "--security-opt",
  "--expose", "--gpus", "--ipc", "--pid", "--runtime", "--stop-signal", "--stop-timeout", "--cidfile",
]);

/** `docker run [flags] image [args]` -> image reference, or null. */
function parseDockerImage(args) {
  if (args[0] !== "run") return null;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (DOCKER_VALUE_OPTIONS.has(a)) i++;
    else if (!a.startsWith("-")) return a;
  }
  return null;
}

/** `ghcr.io/org/img:1.0` -> { registry, name, ref } with Docker Hub defaults applied. */
function splitImage(image) {
  let ref = image;
  let digest = null;
  if (ref.includes("@")) [ref, digest] = ref.split("@");
  const first = ref.split("/")[0];
  let registry = "docker.io";
  let name = ref;
  if (ref.includes("/") && (first.includes(".") || first.includes(":") || first === "localhost")) {
    registry = first;
    name = ref.slice(first.length + 1);
  }
  let tag = "latest";
  const last = name.split("/").pop();
  if (last.includes(":")) {
    tag = last.slice(last.indexOf(":") + 1);
    name = name.slice(0, name.length - tag.length - 1);
  }
  if (registry === "docker.io" && !name.includes("/")) name = `library/${name}`;
  return { registry, name, ref: digest || tag };
}

/** Any GitHub URL form (https, git+https, git@, github:o/r, o/r) -> lowercase owner, or null. */
function githubOwner(url) {
  if (!url || typeof url !== "string") return null;
  let m = /github\.com[/:]([^/\s]+)\/[^/\s]+/i.exec(url);
  if (m) return m[1].toLowerCase();
  m = /^(?:github:)?([A-Za-z0-9-]+)\/[A-Za-z0-9._-]+$/.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/** `https://github.com/o/r(.git)` -> { owner, repo } or null. */
function githubRepo(url) {
  const m = /^(?:git\+)?https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?@]+)/i.exec(url || "");
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

/** Console-script names from a wheel's entry_points.txt. */
function parseEntryPoints(text) {
  const scripts = [];
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) section = line.slice(1, -1).trim();
    else if ((section === "console_scripts" || section === "gui_scripts") && line.includes("=")) {
      scripts.push(line.split("=")[0].trim());
    }
  }
  return scripts;
}

/** Reads one file out of a zip archive held in memory; null when absent. */
function readZipEntry(buf, predicate) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip archive");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error("zip64 archives are not supported");
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (predicate(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data.toString("utf8");
      if (method === 8) return zlib.inflateRawSync(data).toString("utf8");
      throw new Error(`unsupported zip compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rules (pure): facts -> errors and warnings
// ---------------------------------------------------------------------------

/**
 * @param {object} def    parsed server definition
 * @param {object} facts  output of gatherFacts()
 * @param {object} allow  allowlist entry for this server: { [code]: reason }
 * @returns {{ errors: {code,message}[], warnings: {code,message}[], waived: {code,message,reason}[] }}
 */
function evaluate(def, facts, allow = {}) {
  const errors = [];
  const warnings = [];
  const error = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  // -- links.repository: the trust anchor
  const repo = facts.repo || { status: "none" };
  const trusted = new Set();
  if (repo.status === "ok") {
    for (const o of [repo.owner, repo.requestedOwner, repo.parentOwner]) if (o) trusted.add(o.toLowerCase());
  }
  if (repo.status === "missing") {
    error("repo-missing", `links.repository does not exist: ${repo.url}`);
  } else if (repo.status === "none") {
    warn("repo-none", "no GitHub links.repository, so the install source and logo can't be tied to a publisher");
  } else if (repo.status === "unknown") {
    warn("repo-unknown", `could not look up links.repository (${repo.detail})`);
  }
  const anchored = trusted.size > 0;
  const id = String(def.id || "");
  const tld = id.split(".")[0];
  const personalNamespace = id.startsWith("io.github-");
  if (repo.status === "ok" && repo.ownerType === "User" && !personalNamespace && /^(com|io|ai|co|dev|app|org|net)$/.test(tld)) {
    warn("brand-personal-account", `\`${tld}.*\` ID, but links.repository is owned by a personal account (${repo.owner})`);
  }

  // -- logo
  const logo = facts.logo || { kind: "none" };
  if (logo.kind === "github-avatar") {
    if (logo.status === "missing") {
      error("logo-account-missing", `logo is the avatar of GitHub account #${logo.id}, which does not exist`);
    } else if (logo.status === "ok" && !anchored) {
      warn("logo-unverified", `logo is the avatar of ${logo.type} "${logo.login}"; no links.repository to compare with`);
    } else if (logo.status === "ok" && !trusted.has(logo.login.toLowerCase())) {
      const msg = `logo is the avatar of ${logo.type} "${logo.login}", which does not own links.repository (${[...trusted].join(", ")})`;
      if (logo.type === "Organization") warn("logo-unrelated-account", msg);
      else error("logo-unrelated-account", msg);
    } else if (logo.status === "unknown") {
      warn("logo-unknown", `could not look up logo account #${logo.id} (${logo.detail})`);
    }
  }

  // -- install source
  const inst = facts.install || { kind: "none" };
  const publisherCheck = (code, owners, what) => {
    if (!owners.length) return;
    if (!anchored) {
      warn(code, `${what} name ${owners.join(", ")} as the source; no links.repository to compare with`);
    } else if (!owners.some((o) => trusted.has(o))) {
      error(code, `${what} name ${owners.join(", ")} as the source, not the links.repository owner (${[...trusted].join(", ")})`);
    }
  };
  if (inst.kind === "npm") {
    const label = `npm package ${inst.name}${inst.version ? `@${inst.version}` : ""}`;
    if (inst.status === "missing-package") error("npm-missing", `${inst.name} is not published on npm`);
    else if (inst.status === "missing-version") error("npm-version-missing", `${label} does not exist`);
    else if (inst.status === "unknown") warn("npm-unknown", `could not look up ${label} (${inst.detail})`);
    else if (inst.status === "ok") {
      const unscoped = inst.name.split("/").pop();
      if (inst.command) {
        if (!inst.bins.includes(inst.command)) error("npm-command-missing", `${label} has no "${inst.command}" executable (has: ${inst.bins.join(", ") || "none"})`);
      } else if (inst.bins.length === 0) {
        error("npm-no-executable", `${label} has no executable ("bin"), so npx cannot run it`);
      } else if (inst.bins.length > 1 && !inst.bins.includes(unscoped)) {
        error("npm-ambiguous-executable", `${label} has several executables (${inst.bins.join(", ")}) and none is named "${unscoped}"; use npx -p ${inst.name} <command>`);
      }
      if (inst.repoOwner) publisherCheck("npm-publisher-mismatch", [inst.repoOwner], `${label}'s repository field`);
      else warn("npm-no-repository", `${label} has no repository field, so its publisher can't be checked`);
    }
  } else if (inst.kind === "pypi") {
    const label = `PyPI package ${inst.name}${inst.version ? `==${inst.version}` : ""}`;
    if (inst.status === "missing-package") error("pypi-missing", `${inst.name} is not published on PyPI`);
    else if (inst.status === "missing-version") error("pypi-version-missing", `${label} does not exist`);
    else if (inst.status === "unknown") warn("pypi-unknown", `could not look up ${label} (${inst.detail})`);
    else if (inst.status === "ok") {
      if (inst.scripts === null) warn("pypi-executables-unknown", `could not read ${label}'s executables (${inst.scriptsDetail})`);
      else if (inst.executable && !inst.scripts.includes(inst.executable)) {
        error("pypi-executable-missing", `${label} has no "${inst.executable}" executable (has: ${inst.scripts.join(", ") || "none"})`);
      }
      if (inst.urlOwners.length) publisherCheck("pypi-publisher-mismatch", inst.urlOwners, `${label}'s project URLs`);
      else warn("pypi-no-repository", `${label} has no GitHub project URL, so its publisher can't be checked`);
    }
  } else if (inst.kind === "git") {
    if (inst.status === "missing") error("git-source-missing", `install source ${inst.owner}/${inst.repo} does not exist`);
    else if (inst.status === "unknown") warn("git-source-unknown", `could not look up ${inst.owner}/${inst.repo} (${inst.detail})`);
    else publisherCheck("git-source-mismatch", [inst.owner.toLowerCase()], "the --from git source");
  } else if (inst.kind === "docker") {
    const label = `${inst.registry}/${inst.name}:${inst.ref}`;
    if (inst.status === "missing-image") error("docker-missing", `image ${inst.registry}/${inst.name} does not exist`);
    else if (inst.status === "missing-tag") error("docker-tag-missing", `image tag ${label} does not exist`);
    else if (inst.status === "unknown") warn("docker-unknown", `could not look up ${label} (${inst.detail})`);
  } else if (inst.kind === "unparsed") {
    warn("install-unparsed", inst.detail);
  }

  // -- remote endpoint
  const ep = facts.endpoint;
  if (ep) {
    if (ep.class === "nxdomain") error("endpoint-dns", `${ep.host} does not resolve`);
    else if (ep.class === "redirect") error("endpoint-redirect", `endpoint redirects (${ep.status}) to ${ep.location}; MCP clients don't follow redirects on POST, so use the final URL`);
    else if (ep.class === "not-found") error("endpoint-not-found", `endpoint returns ${ep.status}`);
    else if (ep.class !== "mcp" && ep.class !== "auth" && ep.class !== "templated") {
      warn("endpoint-unverified", `endpoint did not answer like an MCP server (${ep.detail})`);
    }
  }

  // -- allowlist
  const waived = [];
  const kept = [];
  for (const e of errors) {
    if (allow[e.code]) waived.push({ ...e, reason: allow[e.code] });
    else kept.push(e);
  }
  return { errors: kept, warnings, waived };
}

// ---------------------------------------------------------------------------
// Facts (network)
// ---------------------------------------------------------------------------

async function request(url, { method = "GET", headers = {}, body, redirect = "follow", maxBytes = 2_000_000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect,
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await readSome(res, maxBytes);
      if (res.status >= 500 && attempt === 0) continue;
      return { status: res.status, headers: res.headers, text };
    } catch (err) {
      const code = (err.cause && err.cause.code) || err.name || "error";
      if (attempt === 0 && code !== "ENOTFOUND") continue;
      return { status: null, error: code, text: "" };
    }
  }
}

/** Reads up to maxBytes, stopping after the first complete SSE event so open streams don't hang. */
async function readSome(res, maxBytes) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  const sse = (res.headers.get("content-type") || "").includes("text/event-stream");
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
      if (sse && /(^|\n)data:[^\n]*\n\r?\n/.test(Buffer.concat(chunks).toString("utf8"))) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function getJson(url, headers) {
  const r = await request(url, { headers: { Accept: "application/json", ...headers } });
  let json = null;
  if (r.status === 200) {
    try {
      json = JSON.parse(r.text);
    } catch {
      return { status: "unknown", detail: "invalid JSON" };
    }
  }
  return { httpStatus: r.status, json, detail: r.error || `HTTP ${r.status}` };
}

function githubHeaders() {
  const h = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function lookupRepo(url) {
  const gh = githubRepo(url);
  if (!gh) return { status: "none", url };
  const r = await getJson(`https://api.github.com/repos/${gh.owner}/${gh.repo}`, githubHeaders());
  if (r.httpStatus === 404) return { status: "missing", url };
  if (!r.json) return { status: "unknown", url, detail: r.detail };
  return {
    status: "ok",
    url,
    owner: r.json.owner.login,
    ownerType: r.json.owner.type,
    requestedOwner: gh.owner,
    parentOwner: r.json.parent ? r.json.parent.owner.login : null,
  };
}

async function lookupLogo(logo) {
  const m = /avatars\.githubusercontent\.com\/u\/(\d+)/i.exec(logo || "");
  if (!m) return { kind: logo ? "url" : "none" };
  const r = await getJson(`https://api.github.com/user/${m[1]}`, githubHeaders());
  if (r.httpStatus === 404) return { kind: "github-avatar", id: m[1], status: "missing" };
  if (!r.json) return { kind: "github-avatar", id: m[1], status: "unknown", detail: r.detail };
  return { kind: "github-avatar", id: m[1], status: "ok", login: r.json.login, type: r.json.type };
}

const RANGE_LIKE = /[\^~<>=*| ]|(^|\.)x(\.|$)/i;

async function lookupNpm(spec, command) {
  const { name, version } = splitNpmSpec(spec);
  const base = { kind: "npm", name, version, command };
  const enc = name.replace("/", "%2F");
  const r = await getJson(`https://registry.npmjs.org/${enc}/${encodeURIComponent(version || "latest")}`);
  if (r.json) {
    let bins = r.json.bin || {};
    if (typeof bins === "string") bins = { [name.split("/").pop()]: bins };
    const repoField = r.json.repository;
    const repoUrl = repoField && typeof repoField === "object" ? repoField.url : repoField;
    return { ...base, status: "ok", bins: Object.keys(bins), repoOwner: githubOwner(repoUrl) };
  }
  if (r.httpStatus !== 404) return { ...base, status: "unknown", detail: r.detail };
  if (version && RANGE_LIKE.test(version)) return { ...base, status: "unknown", detail: `version range "${version}" can't be resolved by this check` };
  // 404 on the version: distinguish "no such package" from "no such version".
  const head = await request(`https://registry.npmjs.org/${enc}`, {
    headers: { Accept: "application/vnd.npm.install-v1+json" },
    maxBytes: 1,
  });
  if (head.status === 404) return { ...base, status: "missing-package" };
  if (head.status === 200) return { ...base, status: "missing-version" };
  return { ...base, status: "unknown", detail: head.error || `HTTP ${head.status}` };
}

async function lookupPypi(name, version, executable) {
  const base = { kind: "pypi", name, version, executable };
  const r = await getJson(`https://pypi.org/pypi/${name}/json`);
  if (r.httpStatus === 404) return { ...base, status: "missing-package" };
  if (!r.json) return { ...base, status: "unknown", detail: r.detail };
  let files = r.json.urls || [];
  if (version && version !== r.json.info.version) {
    const v = await getJson(`https://pypi.org/pypi/${name}/${version}/json`);
    if (v.httpStatus === 404) return { ...base, status: "missing-version" };
    if (!v.json) return { ...base, status: "unknown", detail: v.detail };
    files = v.json.urls || [];
  }
  const info = r.json.info;
  const urls = [...Object.values(info.project_urls || {}), info.home_page];
  const urlOwners = [...new Set(urls.map(githubOwner).filter(Boolean))];
  let scripts = null;
  let scriptsDetail = null;
  const wheel = files
    .filter((f) => f.packagetype === "bdist_wheel")
    .sort((a, b) => Number(!a.filename.includes("py3-none-any")) - Number(!b.filename.includes("py3-none-any")))[0];
  if (!wheel) scriptsDetail = "no wheel published";
  else if (wheel.size > MAX_WHEEL_BYTES) scriptsDetail = `wheel is ${wheel.size} bytes`;
  else {
    try {
      const res = await fetch(wheel.url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const text = readZipEntry(buf, (n) => /\.dist-info\/entry_points\.txt$/.test(n));
      scripts = text ? parseEntryPoints(text) : [];
    } catch (err) {
      scriptsDetail = err.message;
    }
  }
  return { ...base, status: "ok", urlOwners, scripts, scriptsDetail };
}

async function lookupImage(image) {
  const { registry, name, ref } = splitImage(image);
  const base = { kind: "docker", registry, name, ref };
  if (registry === "docker.io") {
    const [ns, repo] = name.split("/");
    const r = await getJson(`https://hub.docker.com/v2/namespaces/${ns}/repositories/${repo}`);
    if (r.httpStatus === 404) return { ...base, status: "missing-image" };
    if (!r.json) return { ...base, status: "unknown", detail: r.detail };
    if (ref.startsWith("sha256:")) return { ...base, status: "ok" };
    const t = await getJson(`https://hub.docker.com/v2/namespaces/${ns}/repositories/${repo}/tags/${encodeURIComponent(ref)}`);
    if (t.httpStatus === 404) return { ...base, status: "missing-tag" };
    if (!t.json) return { ...base, status: "unknown", detail: t.detail };
    return { ...base, status: "ok" };
  }
  const accept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(", ");
  const url = `https://${registry}/v2/${name}/manifests/${ref}`;
  let r = await request(url, { method: "HEAD", headers: { Accept: accept } });
  const challenge = r.headers && r.headers.get("www-authenticate");
  if (r.status === 401 && challenge && /^bearer/i.test(challenge)) {
    const params = Object.fromEntries([...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const tok = await getJson(`${params.realm}?service=${encodeURIComponent(params.service || "")}&scope=repository:${name}:pull`);
    const token = tok.json && (tok.json.token || tok.json.access_token);
    if (token) r = await request(url, { method: "HEAD", headers: { Accept: accept, Authorization: `Bearer ${token}` } });
  }
  if (r.status === 200) return { ...base, status: "ok" };
  if (r.status === 404) return { ...base, status: "missing-image" };
  return { ...base, status: "unknown", detail: r.error || `HTTP ${r.status}` };
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: USER_AGENT, version: "1.0" } },
});

async function probeEndpoint(url) {
  if (url.includes("${input:")) return { class: "templated" };
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return { class: "not-found", status: "invalid URL" };
  }
  try {
    await dns.lookup(host);
  } catch (err) {
    if (err.code === "ENOTFOUND") return { class: "nxdomain", host };
    return { class: "unverified", host, detail: `DNS ${err.code}` };
  }
  const r = await request(url, {
    method: "POST",
    body: INITIALIZE,
    redirect: "manual",
    maxBytes: 65536,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  });
  const ctype = (r.headers && r.headers.get("content-type")) || "";
  const base = { host, status: r.status };
  if (r.error) return { ...base, class: "unverified", detail: r.error };
  if (r.status >= 300 && r.status < 400) return { ...base, class: "redirect", location: r.headers.get("location") };
  if (r.status === 401 || r.status === 403) return { ...base, class: "auth" };
  if (r.status === 404 || r.status === 410) return { ...base, class: "not-found" };
  if (/"jsonrpc"|"protocolVersion"/.test(r.text)) return { ...base, class: "mcp" };
  return { ...base, class: "unverified", detail: `HTTP ${r.status}${ctype ? ` ${ctype.split(";")[0]}` : ""}` };
}

async function gatherFacts(def) {
  const t = def.transport || {};
  const args = (t.args || []).map(String);
  const [repo, logo] = await Promise.all([lookupRepo((def.links || {}).repository), lookupLogo(def.logo || def.icon)]);
  let install = { kind: "none" };
  let endpoint = null;
  if (t.type === "stdio") {
    if (t.command === "npx") {
      const { spec, command } = parseNpx(args);
      install = spec ? await lookupNpm(spec, command) : { kind: "unparsed", detail: "could not find the npx package" };
    } else if (t.command === "uvx" || t.command === "pipx") {
      const { source, executable } = parsePythonRunner(t.command, args);
      const git = source && githubRepo(source);
      if (git) {
        const r = await lookupRepo(`https://github.com/${git.owner}/${git.repo}`);
        install = { kind: "git", owner: git.owner, repo: git.repo, status: r.status === "ok" ? "ok" : r.status, detail: r.detail };
      } else {
        const { name, version } = splitPySpec(source || "");
        install = name
          ? await lookupPypi(name, version, executable)
          : { kind: "unparsed", detail: `could not parse the ${t.command} package from: ${args.join(" ")}` };
      }
    } else if (t.command === "docker") {
      const image = parseDockerImage(args);
      install = image ? await lookupImage(image) : { kind: "unparsed", detail: "could not find the docker image" };
    }
  } else if (t.type === "http" && t.url) {
    endpoint = await probeEndpoint(t.url);
  }
  return { repo, logo, install, endpoint };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function annotate(level, file, message) {
  const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::${level} file=${file.replace(/\\/g, "/")},title=Provenance::${esc(message)}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let files = args.includes("--all")
    ? fs.readdirSync(SERVERS_DIR).filter((f) => f.endsWith(".json")).map((f) => path.join("servers", f))
    : args.filter((a) => !a.startsWith("--"));
  files = files.filter((f) => fs.existsSync(path.resolve(ROOT, f)));
  if (!files.length) {
    console.log("No server files to check.");
    return 0;
  }
  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf-8"));
  const ci = process.env.GITHUB_ACTIONS === "true";

  const results = await mapLimit(files, 8, async (file) => {
    const def = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), "utf-8"));
    const facts = await gatherFacts(def);
    return { file, id: def.id, ...evaluate(def, facts, allowlist[def.id] || {}) };
  });

  let errorCount = 0;
  const summary = ["| Server | Result |", "|---|---|"];
  for (const r of results) {
    const rel = r.file.replace(/\\/g, "/");
    errorCount += r.errors.length;
    const mark = r.errors.length ? "FAIL" : r.warnings.length ? "WARN" : "PASS";
    console.log(`${mark}  ${rel}`);
    for (const e of r.errors) {
      console.log(`  error   [${e.code}] ${e.message}`);
      if (ci) annotate("error", rel, `[${e.code}] ${e.message}`);
    }
    for (const w of r.warnings) {
      console.log(`  warning [${w.code}] ${w.message}`);
      if (ci) annotate("warning", rel, `[${w.code}] ${w.message}`);
    }
    for (const w of r.waived) console.log(`  waived  [${w.code}] ${w.message} (allowlisted: ${w.reason})`);
    const lines = [
      ...r.errors.map((e) => `❌ \`${e.code}\` ${e.message}`),
      ...r.warnings.map((w) => `⚠️ \`${w.code}\` ${w.message}`),
    ];
    summary.push(`| \`${r.id}\` | ${lines.length ? lines.join("<br>").replace(/\|/g, "\\|") : "✅"} |`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Provenance check\n\n${summary.join("\n")}\n`);
  }
  const failed = results.filter((r) => r.errors.length).length;
  console.log(`\n${results.length} checked, ${failed} with errors, ${errorCount} error(s).`);
  if (errorCount) {
    console.log("See CONTRIBUTING.md -> Provenance Checks. Maintainers can waive a specific error in scripts/provenance-allowlist.json.");
  }
  return errorCount ? 1 : 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}

module.exports = {
  parseNpx,
  splitNpmSpec,
  parsePythonRunner,
  splitPySpec,
  parseDockerImage,
  splitImage,
  githubOwner,
  githubRepo,
  parseEntryPoints,
  readZipEntry,
  evaluate,
  gatherFacts,
};
