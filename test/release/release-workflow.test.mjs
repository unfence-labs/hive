import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

test("release is a main-only manual workflow", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.doesNotMatch(workflow, /^\s+tags:/m);
});

test("release waits for protected Apple secrets and creates a draft", () => {
  assert.match(workflow, /environment:\s*\n\s+name: release/);
  assert.match(workflow, /APPLE_CERTIFICATE/);
  assert.match(workflow, /APPLE_API_PRIVATE_KEY/);
  assert.match(workflow, /draft: true/);
  assert.match(workflow, /tag_name:/);
  assert.match(workflow, /target_commitish:/);
});

test("release requires native backends and an Apple Silicon DMG", () => {
  for (const expected of [
    "ubuntu-24.04-arm",
    "aarch64-apple-darwin",
    "linux-x64.tar.gz.sha256",
    "linux-arm64.tar.gz.sha256",
    "macos-arm64.dmg.sha256",
    "provision.sh",
  ]) {
    assert.ok(workflow.includes(expected), `missing ${expected}`);
  }
});
