import { test } from "node:test";
import assert from "node:assert/strict";
import { findUnpinned } from "./action-pins.mjs";

const sha = "a".repeat(40);
const digest = "b".repeat(64);

const uses = (value) => `    steps:\n      - uses: ${value}\n`;

test("reports a tag ref", () => {
  assert.deepEqual(findUnpinned(uses("actions/checkout@v4")), ["actions/checkout@v4"]);
});

test("accepts a 40 hex sha", () => {
  assert.deepEqual(findUnpinned(uses(`actions/checkout@${sha}`)), []);
});

test("accepts an uppercase 40 hex sha", () => {
  assert.deepEqual(findUnpinned(uses(`actions/checkout@${sha.toUpperCase()}`)), []);
});

test("reports a quoted tag ref without quotes", () => {
  assert.deepEqual(findUnpinned(uses('"actions/checkout@v4"')), ["actions/checkout@v4"]);
});

test("accepts a quoted sha", () => {
  assert.deepEqual(findUnpinned(uses(`'actions/checkout@${sha}'`)), []);
});

test("reports a sha followed by a comment", () => {
  assert.equal(findUnpinned(uses(`actions/checkout@${sha} # v4`)).length, 1);
});

test("accepts local actions", () => {
  assert.deepEqual(findUnpinned(uses("./local-action")), []);
});

test("reports a docker tag", () => {
  assert.deepEqual(findUnpinned(uses("docker://alpine:3")), ["docker://alpine:3"]);
});

test("accepts a docker digest", () => {
  assert.deepEqual(findUnpinned(uses(`docker://alpine@sha256:${digest}`)), []);
});

test("reports a reusable workflow on a branch", () => {
  const value = "owner/repo/.github/workflows/x.yml@main";
  assert.deepEqual(findUnpinned(uses(value)), [value]);
});

test("accepts a reusable workflow on a sha", () => {
  assert.deepEqual(findUnpinned(uses(`owner/repo/.github/workflows/x.yml@${sha}`)), []);
});

test("reports a 39 char hex", () => {
  const value = `actions/checkout@${sha.slice(1)}`;
  assert.deepEqual(findUnpinned(uses(value)), [value]);
});

test("reports uses without a dash", () => {
  assert.deepEqual(findUnpinned("        uses: actions/checkout@v4\n"), ["actions/checkout@v4"]);
});
