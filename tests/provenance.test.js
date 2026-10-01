import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import zlib from "zlib";

const require = createRequire(import.meta.url);
const {
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
} = require("../scripts/check-provenance.js");

const codes = (list) => list.map((e) => e.code).sort();

/** A repo fact as lookupRepo() returns it. */
const repo = (owner, extra = {}) => ({ status: "ok", url: `https://github.com/${owner}/x`, owner, ownerType: "Organization", requestedOwner: owner, parentOwner: null, ...extra });
const avatar = (login, type = "Organization") => ({ kind: "github-avatar", id: "1", status: "ok", login, type });

describe("install command parsing", () => {
  it("parses npx package specs and explicit commands", () => {
    expect(parseNpx(["-y", "@scope/pkg@1.2.3", "--flag"])).toEqual({ spec: "@scope/pkg@1.2.3", command: null });
    expect(parseNpx(["-y", "-p", "pkg", "cmd", "x"])).toEqual({ spec: "pkg", command: "cmd" });
    expect(parseNpx(["--package=pkg", "cmd"])).toEqual({ spec: "pkg", command: "cmd" });
    expect(splitNpmSpec("@scope/pkg@1.2.3")).toEqual({ name: "@scope/pkg", version: "1.2.3" });
    expect(splitNpmSpec("pkg")).toEqual({ name: "pkg", version: null });
  });

  it("parses uvx and pipx sources and executables", () => {
    expect(parsePythonRunner("uvx", ["mcp-server-x"])).toEqual({ source: "mcp-server-x", executable: "mcp-server-x" });
    expect(parsePythonRunner("uvx", ["pkg@1.0", "serve"])).toEqual({ source: "pkg@1.0", executable: "pkg" });
    expect(parsePythonRunner("uvx", ["--python", "3.12", "--from", "git+https://github.com/a/b@v1", "cmd"])).toEqual({
      source: "git+https://github.com/a/b@v1",
      executable: "cmd",
    });
    expect(parsePythonRunner("pipx", ["run", "--spec", "pkg==2", "tool"])).toEqual({ source: "pkg==2", executable: "tool" });
    expect(splitPySpec("pkg[extra]==1.2")).toEqual({ name: "pkg", version: "1.2" });
    expect(splitPySpec("pkg>=1")).toEqual({ name: "pkg", version: null });
    expect(splitPySpec("pkg@latest")).toEqual({ name: "pkg", version: null });
  });

  it("parses docker images", () => {
    expect(parseDockerImage(["run", "-i", "--rm", "-e", "TOKEN", "ghcr.io/org/img:1.0", "stdio"])).toBe("ghcr.io/org/img:1.0");
    expect(splitImage("ghcr.io/org/img:1.0")).toEqual({ registry: "ghcr.io", name: "org/img", ref: "1.0" });
    expect(splitImage("redis")).toEqual({ registry: "docker.io", name: "library/redis", ref: "latest" });
    expect(splitImage("localhost:5000/x")).toEqual({ registry: "localhost:5000", name: "x", ref: "latest" });
  });

  it("extracts GitHub owners from every repository URL form", () => {
    for (const url of ["git+https://github.com/Owner/repo.git", "git@github.com:Owner/repo.git", "github:Owner/repo", "Owner/repo", "https://github.com/Owner/repo#readme"]) {
      expect(githubOwner(url)).toBe("owner");
    }
    expect(githubOwner("https://gitlab.com/owner/repo")).toBe(null);
    expect(githubRepo("git+https://github.com/zilliztech/mcp-server-milvus@6a2bff9")).toEqual({ owner: "zilliztech", repo: "mcp-server-milvus" });
  });
});

describe("wheel entry points", () => {
  /** Minimal zip with one deflated entry, enough to exercise readZipEntry. */
  function zipOf(name, content) {
    const data = zlib.deflateRawSync(Buffer.from(content));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 42);
    const cdOffset = local.length + nameBuf.length + data.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + nameBuf.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
  }

  it("reads console scripts out of a wheel", () => {
    const text = "[console_scripts]\ncalibre-mcp = calibre_mcp.__main__:run\nschip-mcp-calibre = calibre_mcp.__main__:run\n\n[other]\nx = y:z\n";
    const wheel = zipOf("calibremcp-3.0.0.dist-info/entry_points.txt", text);
    const read = readZipEntry(wheel, (n) => n.endsWith(".dist-info/entry_points.txt"));
    expect(parseEntryPoints(read)).toEqual(["calibre-mcp", "schip-mcp-calibre"]);
    expect(readZipEntry(wheel, (n) => n === "missing.txt")).toBe(null);
  });
});

// Fixtures below are the facts the network layer produced for real registry
// entries during the 2026-10-01 audit.
describe("rules: definitions that must fail", () => {
  it("PyPI package with a different publisher and no matching executable (Calibre)", () => {
    const r = evaluate({ id: "sandraschi.calibremcp-uvx" }, {
      repo: repo("sandraschi", { ownerType: "User" }),
      logo: avatar("sandraschi", "User"),
      install: { kind: "pypi", name: "calibremcp", version: null, executable: "calibremcp", status: "ok", urlOwners: ["moranon"], scripts: ["calibre-mcp", "schip-mcp-calibre"] },
    });
    expect(codes(r.errors)).toEqual(["pypi-executable-missing", "pypi-publisher-mismatch"]);
  });

  it("PyPI package published from a third-party fork (Milvus before the fix)", () => {
    const r = evaluate({ id: "io.milvus-mcp-uvx" }, {
      repo: repo("zilliztech"),
      logo: avatar("zilliztech"),
      install: { kind: "pypi", name: "mcp-server-milvus", version: null, executable: "mcp-server-milvus", status: "ok", urlOwners: ["danchev"], scripts: ["mcp-server-milvus"] },
    });
    expect(codes(r.errors)).toEqual(["pypi-publisher-mismatch"]);
  });

  it("attribution to a repository that doesn't exist (global-chat)", () => {
    const r = evaluate({ id: "io.global-chat-mcp-npx" }, {
      repo: { status: "missing", url: "https://github.com/nicobailon/global-chat" },
      logo: { kind: "url" },
      install: { kind: "npm", name: "@global-chat/mcp-server", status: "ok", bins: ["global-chat-mcp"], repoOwner: "pumanitro" },
    });
    expect(codes(r.errors)).toEqual(["repo-missing"]);
  });

  it("logo borrowed from an unrelated personal account (Trello squatter)", () => {
    const r = evaluate({ id: "com.trello-mcp-http" }, {
      repo: repo("atlassian"),
      logo: avatar("Trello", "User"),
      endpoint: { class: "auth" },
    });
    expect(codes(r.errors)).toEqual(["logo-unrelated-account"]);
  });

  it("unpublished npm package and PyPI package (finalapproval, Weaviate)", () => {
    const npm = evaluate({ id: "ai.finalapproval-mcp-npx" }, { repo: repo("finalapproval"), install: { kind: "npm", name: "@finalapproval/mcp-server", status: "missing-package" } });
    const pypi = evaluate({ id: "io.weaviate-mcp-uvx" }, { repo: repo("weaviate"), install: { kind: "pypi", name: "mcp-server-weaviate", status: "missing-package" } });
    expect(codes(npm.errors)).toEqual(["npm-missing"]);
    expect(codes(pypi.errors)).toEqual(["pypi-missing"]);
  });

  it("npm package with several executables and none matching", () => {
    const r = evaluate({ id: "x.y" }, { repo: repo("o"), install: { kind: "npm", name: "pkg", status: "ok", bins: ["a", "b"], repoOwner: "o" } });
    expect(codes(r.errors)).toEqual(["npm-ambiguous-executable"]);
  });

  it("dead domain and redirecting endpoint", () => {
    const dead = evaluate({ id: "com.clauxel-dbqueryguard" }, { repo: repo("clauxel"), endpoint: { class: "nxdomain", host: "dbqueryguard.clauxel.com" } });
    const moved = evaluate({ id: "com.instantdomainsearch-mcp-http" }, { endpoint: { class: "redirect", status: 308, location: "https://mcp.instantdomainsearch.com/mcp" } });
    expect(codes(dead.errors)).toEqual(["endpoint-dns"]);
    expect(codes(moved.errors)).toEqual(["endpoint-redirect"]);
  });
});

describe("rules: definitions that must pass", () => {
  it("official remote server with matching repo and logo (Cloudflare)", () => {
    const r = evaluate({ id: "com.cloudflare-api" }, { repo: repo("cloudflare"), logo: avatar("cloudflare"), endpoint: { class: "auth" } });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("hosted SaaS entry without a repository only warns (Asana)", () => {
    const r = evaluate({ id: "com.asana-mcp" }, { repo: { status: "none" }, logo: avatar("Asana"), endpoint: { class: "auth" } });
    expect(r.errors).toEqual([]);
    expect(codes(r.warnings)).toEqual(["logo-unverified", "repo-none"]);
  });

  it("install from the upstream git source (Milvus after the fix)", () => {
    const r = evaluate({ id: "io.milvus-mcp-uvx" }, { repo: repo("zilliztech"), logo: avatar("zilliztech"), install: { kind: "git", owner: "zilliztech", repo: "mcp-server-milvus", status: "ok" } });
    expect(r.errors).toEqual([]);
  });

  it("package published from the fork parent or a transferred repo", () => {
    const fork = evaluate({ id: "x.y" }, { repo: repo("forker", { parentOwner: "upstream" }), install: { kind: "npm", name: "pkg", status: "ok", bins: ["pkg"], repoOwner: "upstream" } });
    const moved = evaluate({ id: "x.y" }, { repo: repo("new-owner", { requestedOwner: "old-owner" }), install: { kind: "npm", name: "pkg", status: "ok", bins: ["pkg"], repoOwner: "old-owner" } });
    expect(fork.errors).toEqual([]);
    expect(moved.errors).toEqual([]);
  });

  it("the contributor field can't vouch for a publisher", () => {
    const r = evaluate({ id: "x.y", contributor: { github: "evil" } }, { repo: repo("victim"), install: { kind: "npm", name: "pkg", status: "ok", bins: ["pkg"], repoOwner: "evil" } });
    expect(codes(r.errors)).toEqual(["npm-publisher-mismatch"]);
  });

  it("network trouble is a warning, never an error", () => {
    const r = evaluate({ id: "gr.bestprice-mcp" }, {
      repo: { status: "unknown", detail: "HTTP 502" },
      logo: { kind: "github-avatar", id: "1", status: "unknown", detail: "timeout" },
      install: { kind: "npm", name: "pkg", status: "unknown", detail: "ETIMEDOUT" },
      endpoint: { class: "unverified", detail: "UND_ERR_CONNECT_TIMEOUT" },
    });
    expect(r.errors).toEqual([]);
    expect(codes(r.warnings)).toEqual(["endpoint-unverified", "logo-unknown", "npm-unknown", "repo-unknown"]);
  });

  it("allowlisted errors are waived, others still fail", () => {
    const facts = { repo: repo("couchbase-ecosystem"), install: { kind: "pypi", name: "p", status: "ok", executable: "p", scripts: [], urlOwners: ["couchbase"] } };
    const r = evaluate({ id: "com.couchbase-mcp-uvx" }, facts, { "pypi-publisher-mismatch": "same publisher, repo moved" });
    expect(codes(r.waived)).toEqual(["pypi-publisher-mismatch"]);
    expect(codes(r.errors)).toEqual(["pypi-executable-missing"]);
  });
});
