import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const PRERELEASE = /^v?\d+\.\d+\.\d+-.+$/;

function parse(version) {
  const match = VERSION.exec(String(version).trim());
  if (!match) throw new Error(`unparsable version: ${version}`);
  return match.slice(1).map(Number);
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function newerSecurityRelease(deployed, releases) {
  const current = parse(deployed);
  let newest = null;
  let newestParts = current;
  for (const release of releases) {
    if (typeof release.version === "string" && PRERELEASE.test(release.version.trim())) continue;
    const parts = parse(release.version);
    if (release.security !== true || parts[0] !== current[0]) continue;
    if (compare(parts, newestParts) > 0) {
      newest = release.version;
      newestParts = parts;
    }
  }
  return newest;
}

function main(deployed, indexPath) {
  try {
    const releases = JSON.parse(readFileSync(indexPath, "utf8"));
    if (!Array.isArray(releases)) throw new Error("releases index is not an array");
    const newer = newerSecurityRelease(deployed, releases);
    if (newer) {
      console.log(`production runs ${deployed}; security release ${newer} exists in the same major`);
      process.exit(1);
    }
    console.log(`up to date: production runs ${deployed}`);
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2], process.argv[3]);
}
