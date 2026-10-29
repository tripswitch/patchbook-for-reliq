/**
 * Validates every modules/*.json file and writes src/generated/library.json,
 * the bundle the app imports. Runs before dev, build and test.
 *   npx tsx scripts/library.ts           validate + generate
 *   npx tsx scripts/library.ts --check   validate only (CI)
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateModule } from "../src/lib/validate";
import type { ModuleDef } from "../src/lib/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "modules");
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "schema.json").sort();

const errors: string[] = [];
const mods: ModuleDef[] = [];
const ids = new Set<string>();

for (const f of files) {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(join(dir, f), "utf8"));
  } catch (e) {
    errors.push(`${f}: not valid JSON (${(e as Error).message})`);
    continue;
  }
  const problems = validateModule(data);
  const m = data as ModuleDef;
  if (m && typeof m.id === "string" && f !== `${m.id}.json`) problems.push(`file name must be ${m.id}.json`);
  if (m && ids.has(m.id)) problems.push(`duplicate id ${m.id}`);
  if (problems.length) errors.push(...problems.map((p) => `${f}: ${p}`));
  else {
    ids.add(m.id);
    mods.push(m);
  }
}

if (errors.length) {
  console.error(`Module library has ${errors.length} problem(s):\n  ` + errors.join("\n  "));
  process.exit(1);
}

const jacks = mods.reduce((n, m) => n + m.inputs.length + m.outputs.length, 0);
console.log(`Module library OK: ${mods.length} modules, ${jacks} jacks.`);

if (!process.argv.includes("--check")) {
  mkdirSync(join(root, "src/generated"), { recursive: true });
  writeFileSync(join(root, "src/generated/library.json"), JSON.stringify(mods));
}
