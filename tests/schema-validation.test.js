import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { glob } from "glob";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCHEMA_PATH = path.join(ROOT, "schemas", "server-definition.schema.json");
const SERVERS_DIR = path.join(ROOT, "servers");
const BUNDLE_PATH = path.join(ROOT, "bundle", "bundle.json");
const CATEGORIES_PATH = path.join(ROOT, "categories.json");

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("Server Definition Schema", () => {
  let validate;
  let serverFiles;

  beforeAll(async () => {
    const schema = loadJson(SCHEMA_PATH);
    delete schema.$schema; // ajv v8 compat
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    validate = ajv.compile(schema);

    const pattern = path.join(SERVERS_DIR, "*.json").replace(/\\/g, "/");
    serverFiles = await glob(pattern);
  });

  it("schema file exists and is valid JSON", () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
    const schema = loadJson(SCHEMA_PATH);
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("id");
    expect(schema.required).toContain("name");
    expect(schema.required).toContain("transport");
  });

  it("has server definition files", () => {
    expect(serverFiles.length).toBeGreaterThan(0);
  });

  it.each([
    { id: "com.example-test", name: "Test", transport: { type: "stdio", command: "echo" } },
    { id: "com.example-remote", name: "Remote", transport: { type: "http", url: "https://example.com/mcp" } },
    {
      id: "com.example-defaults", name: "Defaults Test",
      transport: {
        type: "stdio", command: "node", args: ["server.js"],
        env: { "LOG_LEVEL": "${input:LOG_LEVEL}" },
        metadata: {
          inputs: [
            { id: "LOG_LEVEL", label: "Log Level", type: "text", required: false, default: "info" },
            { id: "API_KEY", label: "API Key", type: "password", required: true, secret: true },
          ],
        },
      },
    },
  ])("validates valid server definition: $id", (data) => {
    expect(validate(data)).toBe(true);
  });

  it.each([
    [{ name: "NoId", transport: { type: "stdio", command: "x" } }, "missing id"],
    [{ id: "x", transport: { type: "stdio", command: "x" } }, "missing name"],
    [{ id: "x", name: "X" }, "missing transport"],
    [{ id: "INVALID-CAPS", name: "X", transport: { type: "stdio", command: "x" } }, "invalid id pattern (caps)"],
    [{ id: "com.foo.bar", name: "X", transport: { type: "stdio", command: "x" } }, "invalid id pattern (multi-dot)"],
    [{ id: "noDot", name: "X", transport: { type: "stdio", command: "x" } }, "invalid id pattern (no dot)"],
    [{ id: "x", name: "", transport: { type: "stdio", command: "x" } }, "empty name"],
  ])("rejects invalid definition: %s", (data) => {
    expect(validate(data)).toBe(false);
  });

  it("validates all server files against schema", async () => {
    const errors = [];

    for (const filePath of serverFiles) {
      const data = loadJson(filePath);
      // Strip platform-managed fields like the validator does
      delete data.badges;
      delete data.stats;
      delete data.sponsored;
      delete data.featured;

      const valid = validate(data);
      if (!valid) {
        errors.push({
          file: path.basename(filePath),
          errors: validate.errors,
        });
      }
    }

    if (errors.length > 0) {
      const details = errors
        .map((e) => `${e.file}: ${e.errors.map((err) => `${err.instancePath} ${err.message}`).join(", ")}`)
        .join("\n");
      expect.fail(`Schema validation failed:\n${details}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Required fields and consistency
// ---------------------------------------------------------------------------

describe("Server definitions consistency", () => {
  let serverFiles;
  let servers;

  beforeAll(async () => {
    const pattern = path.join(SERVERS_DIR, "*.json").replace(/\\/g, "/");
    serverFiles = await glob(pattern);
    servers = serverFiles.map((f) => ({
      file: path.basename(f),
      data: loadJson(f),
    }));
  });

  it("every server has a unique ID", () => {
    const ids = servers.map((s) => s.data.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every server has a unique alias (when present)", () => {
    const aliases = servers
      .filter((s) => s.data.alias)
      .map((s) => s.data.alias);
    const unique = new Set(aliases);
    expect(unique.size).toBe(aliases.length);
  });

  it("no alias collides with any ID", () => {
    const ids = new Set(servers.map((s) => s.data.id));
    const aliasCollisions = servers.filter(
      (s) => s.data.alias && ids.has(s.data.alias)
    );
    expect(aliasCollisions).toHaveLength(0);
  });

  it("every server ID uses {tld}.{publisher}-{name} format", () => {
    const pattern = /^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$/;
    for (const { data, file } of servers) {
      expect(data.id, `${file} ID should match {tld}.{publisher}-{name} format`).toMatch(pattern);
    }
  });

  it("every server has a description", () => {
    for (const { data, file } of servers) {
      expect(data.description, `${file} missing description`).toBeTruthy();
    }
  });

  it("every server has at least one category", () => {
    for (const { data, file } of servers) {
      expect(
        data.categories?.length,
        `${file} should have at least one category`
      ).toBeGreaterThan(0);
    }
  });

  it("stdio servers have a command", () => {
    for (const { data, file } of servers) {
      if (data.transport.type === "stdio") {
        expect(data.transport.command, `${file} stdio missing command`).toBeTruthy();
      }
    }
  });

  it("http servers have a url", () => {
    for (const { data, file } of servers) {
      if (data.transport.type === "http") {
        expect(data.transport.url, `${file} http missing url`).toBeTruthy();
      }
    }
  });

  it("filename is a valid JSON file derived from the server ID", () => {
    for (const { data, file } of servers) {
      // Filename should end with .json
      expect(file, `${file} should end with .json`).toMatch(/\.json$/);
      // Filename should be lowercase kebab or dot notation
      expect(file, `${file} should be lowercase`).toMatch(/^[a-z0-9.-]+\.json$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

describe("Categories", () => {
  it("categories.json exists and is valid", () => {
    expect(fs.existsSync(CATEGORIES_PATH)).toBe(true);
    const categories = loadJson(CATEGORIES_PATH);
    expect(categories).toBeInstanceOf(Array);
    expect(categories.length).toBeGreaterThan(0);
  });

  it("every category has id and name", () => {
    const categories = loadJson(CATEGORIES_PATH);
    for (const cat of categories) {
      expect(cat.id).toBeTruthy();
      expect(cat.name).toBeTruthy();
    }
  });

  it("category IDs are unique", () => {
    const categories = loadJson(CATEGORIES_PATH);
    const ids = categories.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all server categories reference valid category IDs", async () => {
    const categories = loadJson(CATEGORIES_PATH);
    const validIds = new Set(categories.map((c) => c.id));

    const pattern = path.join(SERVERS_DIR, "*.json").replace(/\\/g, "/");
    const files = await glob(pattern);

    const invalid = [];
    for (const f of files) {
      const data = loadJson(f);
      for (const cat of data.categories || []) {
        if (!validIds.has(cat)) {
          invalid.push(`${path.basename(f)}: unknown category "${cat}"`);
        }
      }
    }

    if (invalid.length > 0) {
      expect.fail(`Invalid category references:\n${invalid.join("\n")}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

describe("Bundle", () => {
  it("bundle can be built successfully", async () => {
    // Run the build script
    const { execSync } = await import("child_process");
    execSync("node scripts/build-bundle.js", { cwd: ROOT, timeout: 30000 });
    expect(fs.existsSync(BUNDLE_PATH)).toBe(true);
  });

  it("bundle has correct structure", () => {
    const bundle = loadJson(BUNDLE_PATH);
    expect(bundle.version).toBeTruthy();
    expect(bundle.updated_at).toBeTruthy();
    expect(bundle.servers).toBeInstanceOf(Array);
    expect(bundle.categories).toBeInstanceOf(Array);
    expect(bundle.servers.length).toBeGreaterThan(0);
  });

  it("bundle servers match filesystem servers", async () => {
    const bundle = loadJson(BUNDLE_PATH);
    const pattern = path.join(SERVERS_DIR, "*.json").replace(/\\/g, "/");
    const files = await glob(pattern);
    expect(bundle.servers.length).toBe(files.length);
  });

  it("bundle includes UI config", () => {
    const bundle = loadJson(BUNDLE_PATH);
    expect(bundle.ui).toBeDefined();
    expect(bundle.ui.filters).toBeInstanceOf(Array);
    expect(bundle.ui.sort_options).toBeInstanceOf(Array);
    expect(bundle.ui.default_sort).toBe("recommended");
    expect(bundle.ui.items_per_page).toBe(24);
  });

  it("bundle includes home section with featured servers", () => {
    const bundle = loadJson(BUNDLE_PATH);
    expect(bundle.home).toBeDefined();
    expect(bundle.home.featured_server_ids).toBeInstanceOf(Array);
  });
});
