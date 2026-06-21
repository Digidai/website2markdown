import { execFileSync } from "node:child_process";

const REQUIRED_INDEXES = [
  "idx_conversion_debug_traces_account",
  "idx_conversion_debug_traces_created",
  "idx_conversion_debug_traces_expires",
  "idx_conversion_debug_traces_request",
];

function runD1(command) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const output = execFileSync(
        "wrangler",
        ["d1", "execute", "AUTH_DB", "--remote", "--json", "--command", command],
        { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
      );
      const payload = JSON.parse(output);
      if (!Array.isArray(payload) || payload.length === 0 || payload[0]?.success !== true) {
        throw new Error(`D1 command failed: ${command}`);
      }
      return payload[0].results ?? [];
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`D1 verify attempt ${attempt} failed; retrying...`);
      }
    }
  }
  throw lastError;
}

const tables = runD1(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='conversion_debug_traces';",
);
if (!tables.some((row) => row.name === "conversion_debug_traces")) {
  throw new Error("Missing D1 table: conversion_debug_traces");
}

const indexes = runD1(
  "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversion_debug_traces';",
);
const indexNames = new Set(indexes.map((row) => row.name));
for (const name of REQUIRED_INDEXES) {
  if (!indexNames.has(name)) {
    throw new Error(`Missing D1 index: ${name}`);
  }
}

console.log("D1 schema verified: conversion_debug_traces table and indexes exist");
