#!/usr/bin/env npx ts-node
/**
 * Adapter scaffold CLI — generates a new site adapter + test file.
 *
 * Usage:
 *   npx ts-node scripts/create-adapter.ts <name> <url-pattern>
 *
 * Example:
 *   npx ts-node scripts/create-adapter.ts bilibili "bilibili.com/video/"
 */

import * as path from "node:path";
import { validateName, buildScaffold, writeScaffold } from "./adapter-scaffold";

const [, , name, urlPattern] = process.argv;

if (!name || !urlPattern) {
  console.error("Usage: npx ts-node scripts/create-adapter.ts <name> <url-pattern>");
  console.error('Example: npx ts-node scripts/create-adapter.ts bilibili "bilibili.com/video/"');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, "..");
const adaptersDir = path.join(projectRoot, "src", "browser", "adapters");

const validationError = validateName(name, adaptersDir);
if (validationError) {
  console.error(`Error: ${validationError}`);
  process.exit(1);
}

const result = buildScaffold(name, urlPattern, projectRoot);
writeScaffold(result);

console.log(`Created adapter:  ${result.adapterPath}`);
console.log(`Created test:     ${result.testPath}`);
console.log(result.registrationHint);
