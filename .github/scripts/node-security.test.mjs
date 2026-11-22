import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { newerSecurityRelease } from "./node-security.mjs";

const script = fileURLToPath(new URL("./node-security.mjs", import.meta.url));

const release = (version, security) => ({ version, security, date: "2026-01-01", lts: false });

test("returns a newer security release in the same major", () => {
  assert.equal(newerSecurityRelease("v24.22.3", [release("v24.23.0", true)]), "v24.23.0");
});

test("ignores a newer non-security release", () => {
  assert.equal(newerSecurityRelease("v24.22.3", [release("v24.23.0", false)]), null);
});

test("ignores a security release in another major", () => {
  assert.equal(newerSecurityRelease("v24.22.3", [release("v26.1.0", true)]), null);
});

test("ignores an equal version", () => {
  assert.equal(newerSecurityRelease("v24.22.3", [release("v24.22.3", true)]), null);
});

test("ignores an older security release", () => {
  assert.equal(newerSecurityRelease("v24.22.3", [release("v24.21.0", true)]), null);
});

test("accepts a deployed version without v", () => {
  assert.equal(newerSecurityRelease("24.22.3", [release("v24.23.0", true)]), "v24.23.0");
});

test("compares components numerically", () => {
  assert.equal(newerSecurityRelease("v24.9.0", [release("v24.10.0", true)]), "v24.10.0");
  assert.equal(newerSecurityRelease("v24.10.0", [release("v24.9.0", true)]), null);
});

test("returns the newest of several security releases", () => {
  const releases = [
    release("v24.23.0", true),
    release("v24.25.1", true),
    release("v24.24.0", true),
    release("v24.26.0", false),
  ];
  assert.equal(newerSecurityRelease("v24.22.3", releases), "v24.25.1");
});

test("throws on an unparsable deployed version", () => {
  assert.throws(() => newerSecurityRelease("garbage", [release("v24.23.0", true)]));
});

test("throws on an unparsable release version", () => {
  assert.throws(() => newerSecurityRelease("v24.22.3", [release("nightly", false)]));
});

test("skips a pre-release security release in the same major", () => {
  assert.equal(newerSecurityRelease("v24.22.3", [release("v24.23.0-rc.1", true)]), null);
});

test("skips pre-releases and returns the real newer security release", () => {
  const releases = [
    release("v27.0.0-alpha.0.1.1", true),
    release("v24.30.0-rc.1", true),
    release("v24.23.0", true),
  ];
  assert.equal(newerSecurityRelease("v24.22.3", releases), "v24.23.0");
});

test("throws on a pre-release deployed version", () => {
  assert.throws(() => newerSecurityRelease("v24.22.3-rc.1", [release("v24.23.0", true)]));
});

test("throws on malformed release versions", () => {
  for (const version of ["nightly", "24.1", "", 5, null]) {
    assert.throws(() => newerSecurityRelease("v24.22.3", [release(version, false)]));
  }
});

const run = (deployed, indexText) => {
  const dir = mkdtempSync(join(tmpdir(), "node-security-"));
  const file = join(dir, "index.json");
  if (indexText !== undefined) writeFileSync(file, indexText);
  return spawnSync(process.execPath, [script, deployed, file], { encoding: "utf8" });
};

test("cli exits 1 with a message when a security release exists", () => {
  const result = run("v24.22.3", JSON.stringify([release("v24.23.0", true)]));
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /production runs v24\.22\.3; security release v24\.23\.0 exists in the same major/);
});

test("cli exits 0 naming the deployed version when up to date", () => {
  const result = run("v24.22.3", JSON.stringify([release("v24.22.3", true)]));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /up to date.*v24\.22\.3/);
});

test("cli exits 2 on an unparsable version", () => {
  const result = run("garbage", JSON.stringify([]));
  assert.equal(result.status, 2);
  assert.notEqual(result.stderr, "");
});

test("cli exits 2 on invalid json", () => {
  const result = run("v24.22.3", "{not json");
  assert.equal(result.status, 2);
  assert.notEqual(result.stderr, "");
});

test("cli exits 2 on an unreadable file", () => {
  const result = run("v24.22.3", undefined);
  assert.equal(result.status, 2);
  assert.notEqual(result.stderr, "");
});

test("cli exits 0 when the index contains a pre-release", () => {
  const result = run("v24.22.3", JSON.stringify([release("v27.0.0-alpha.0.1.1", true)]));
  assert.equal(result.status, 0);
});
