import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "../../..");
const script = join(repoRoot, "infra/deploy-web.sh");

function deploy(destination) {
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      FACET_WEB_DEST: destination,
      FACET_ALLOW_DIRTY: "1",
      FACET_SKIP_CHOWN: "1",
    },
  });
}

test("deployment uses this checkout, excludes repo-only files, and keeps a rollback", (context) => {
  const parent = mkdtempSync(join(tmpdir(), "facet-deploy-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const destination = join(parent, "site");

  const first = deploy(destination);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(join(destination, "index.html"), "utf8"),
    readFileSync(join(repoRoot, "packages/web/index.html"), "utf8"));
  assert.equal(existsSync(join(destination, "tests")), false);
  assert.equal(existsSync(join(destination, "package.json")), false);
  assert.equal(existsSync(join(destination, "README.md")), false);

  writeFileSync(join(destination, "previous-release-marker"), "old");
  const second = deploy(destination);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(existsSync(join(destination, "previous-release-marker")), false);
  const backups = readdirSync(parent).filter((name) => name.startsWith("site.backup-"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(parent, backups[0], "previous-release-marker"), "utf8"), "old");
});

test("deployment refuses broad destinations", () => {
  const result = deploy("/var/www");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing unsafe destination/);
});
