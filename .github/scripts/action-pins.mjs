import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const USES_LINE = /^\s*(?:-\s+)?uses:\s*(.+?)\s*$/;
const REMOTE_SHA = /^[^\s@]+\/[^\s@]+@[0-9a-fA-F]{40}$/;
const DOCKER_DIGEST = /^docker:\/\/\S+@sha256:[0-9a-fA-F]{64}$/;

const unquote = (value) => value.replace(/^(["'])(.*)\1(?=\s|$)/, "$2");

const isPinned = (value) =>
  value.startsWith("./") || REMOTE_SHA.test(value) || DOCKER_DIGEST.test(value);

export function findUnpinned(workflowText) {
  const unpinned = [];
  for (const line of workflowText.split("\n")) {
    const match = USES_LINE.exec(line);
    if (!match) continue;
    const value = unquote(match[1]);
    if (!isPinned(value)) unpinned.push(value);
  }
  return unpinned;
}

function main(dir) {
  let failed = false;
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort();
  for (const name of files) {
    for (const value of findUnpinned(readFileSync(join(dir, name), "utf8"))) {
      console.log(`${join(dir, name)}: ${value}`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]);
}
