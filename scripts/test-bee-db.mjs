#!/usr/bin/env node
// Real PostgreSQL tests; no production connection or application secrets used.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const container = `trackbing-bee-test-${randomUUID().slice(0, 12)}`;
const docker = (args, options = {}) => {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Docker failed");
  return result.stdout.trim();
};
const query = (sql, role = "postgres") => docker(
  ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
  { input: `set role ${role};\n${sql}` },
);
const queryAsync = (sql) => new Promise((resolve, reject) => {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres"]);
  let output = "";
  let error = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { error += chunk; });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
  child.stdin.end(`set role service_role;\n${sql}`);
});
const literal = (value) => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const rpcSql = (name, args) => `select public.${name}(${args.join(",")});`;
const rpc = (name, args) => JSON.parse(query(rpcSql(name, args), "service_role") || "null");
const fixture = (file) => query(readFileSync(`${root}${file}`, "utf8"));

let started = false;
try {
  docker(["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16-alpine"]);
  started = true;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = spawnSync("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { encoding: "utf8" });
    if (ready.status === 0) break;
    if (attempt === 39) throw new Error("PostgreSQL did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fixture("supabase/tests/bee_fixture.sql");
  fixture("supabase/migrations/20260613000000_legacy_base_schema.sql");
  fixture("supabase/migrations/20260614000000_add_nutrition_goal_metadata.sql");
  fixture("supabase/migrations/20260624000000_enable_rls_user_tables.sql");
  fixture("supabase/migrations/20260624000100_add_get_weekly_stats_rpc.sql");
  fixture("supabase/migrations/20260629000000_add_ai_and_entitlements.sql");
  fixture("supabase/migrations/20260629000100_ai_usage_increment.sql");
  fixture("supabase/migrations/20260731000000_add_personal_food_barcodes.sql");
  fixture("supabase/recipes.sql");
  if (!process.argv.includes("--baseline")) fixture("supabase/migrations/20260915000000_bee_conversations.sql");
  assert.equal(query("select to_regclass('public.bee_pending_actions') is not null;"), "t", "reviewed drafts must have a persisted table");
  const { runBeeDatabaseTests } = await import("../supabase/tests/bee_database.mjs");
  const { runBeeMigrationDatabaseTests } = await import("../supabase/tests/bee_migration_database.mjs");
  const { seedLaunchLegacyRows, runLaunchDatabaseTests } = await import("../supabase/tests/launch_database.mjs");
  const context = { assert, query, queryAsync, literal, json, rpcSql, rpc };
  const legacy = seedLaunchLegacyRows(context);
  if (!process.argv.includes("--launch-baseline")) fixture("supabase/migrations/20260927000000_launch_validation.sql");
  if (!process.argv.includes("--launch-only") && !process.argv.includes("--adaptive-only")) {
    await runBeeMigrationDatabaseTests(context);
    if (!process.argv.includes("--migration-only")) await runBeeDatabaseTests(context);
  }
  if (!process.argv.includes("--adaptive-only")) await runLaunchDatabaseTests({ ...context, legacy });
  fixture("supabase/migrations/20260928000000_adaptive_bee.sql");
  fixture("supabase/migrations/20260929000000_subscription_budgets.sql");
  fixture("supabase/migrations/20260930000000_billing_actions.sql");
  fixture("supabase/migrations/20260930000100_account_cascade_context.sql");
  const { runAdaptiveDatabaseTests } = await import("../supabase/tests/adaptive_database.mjs");
  await runAdaptiveDatabaseTests(context);
  const edge = spawnSync(process.env.DENO_BINARY ?? "deno", ["test", "--cached-only", "--config", "supabase/functions/deno.json", "--allow-env", "supabase/tests/usda_proxy_deno.mts", "supabase/tests/billing_deno.mts"], { cwd: root, stdio: "inherit" });
  if (edge.status !== 0) throw new Error(edge.error?.message ?? "USDA Edge Function tests failed");
  process.stdout.write("Bee and launch PostgreSQL invariants and USDA Edge Function checks passed.\n");
} finally {
  if (started) docker(["rm", "-f", container]);
}
