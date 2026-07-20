#!/usr/bin/env node
// Validates the frozen JellyHunt v1 contract fixtures under
// tests/contracts/jellyhunt-v1/: confirms the manifest is readable and that
// every fixture file sitting alongside it exists and parses as JSON.
//
// This is intentionally minimal. Task 3 extends contract validation to also
// check fixtures against the v2 OpenAPI spec and route-level assertions.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.join(__dirname, "..", "tests", "contracts", "jellyhunt-v1");
const manifestPath = path.join(contractsDir, "manifest.json");

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const errors = [];

  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (error) {
    console.error(`FAIL: could not read or parse manifest at ${manifestPath}\n  ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push(`manifest.json is missing a string "version" field`);
  }
  if (!Array.isArray(manifest.frozenRoutes) || manifest.frozenRoutes.length === 0) {
    errors.push(`manifest.json is missing a non-empty "frozenRoutes" array`);
  }

  let entries;
  try {
    entries = await readdir(contractsDir, { withFileTypes: true });
  } catch (error) {
    console.error(`FAIL: could not read fixtures directory ${contractsDir}\n  ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const fixtureFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "manifest.json")
    .map((entry) => entry.name);

  if (fixtureFiles.length === 0) {
    errors.push(`no frozen-route fixture files found alongside ${manifestPath}`);
  }

  for (const fileName of fixtureFiles) {
    const filePath = path.join(contractsDir, fileName);
    try {
      await readJson(filePath);
    } catch (error) {
      errors.push(`fixture ${fileName} does not parse as JSON: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    console.error("FAIL: JellyHunt v1 contract fixtures are invalid:");
    for (const message of errors) {
      console.error(`  - ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `OK: manifest "${manifest.version}" and ${fixtureFiles.length} frozen-route fixture(s) validated.`,
  );
}

main().catch((error) => {
  console.error(`FAIL: unexpected error while validating JellyHunt v1 contracts\n  ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
