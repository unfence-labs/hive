import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const updaterSmokeWorkflow = await readFile(
  new URL("../../.github/workflows/updater-smoke.yml", import.meta.url),
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

test("release builds the frontend before Tauri", () => {
  const frontendBuild = workflow.indexOf("- name: Build frontend");
  const tauriBuild = workflow.indexOf("- name: Build signed and notarized Apple Silicon DMG");
  assert.match(
    workflow,
    /- name: Build frontend\n\s+working-directory: frontend[\s\S]*?npm run build/
  );
  assert.notEqual(frontendBuild, -1);
  assert.notEqual(tauriBuild, -1);
  assert.ok(frontendBuild < tauriBuild);
});

test("release signs and publishes the desktop updater artifacts", () => {
  for (const expected of [
    "TAURI_SIGNING_PRIVATE_KEY",
    "secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    "macos-arm64.app.tar.gz.sig",
    "macos-arm64.app.tar.gz.sha256",
    "latest.json",
    "verify-updater-signature.mjs",
  ]) {
    assert.ok(workflow.includes(expected), `missing ${expected}`);
  }
});

test("release notarizes and staples the DMG", () => {
  assert.match(workflow, /xcrun notarytool submit "\$dmg"[\s\S]*--wait/);
  assert.match(workflow, /xcrun stapler staple "\$dmg"/);
  assert.match(workflow, /xcrun stapler validate "\$dmg"/);
});

test("updater smoke test is manual, main-only, and cannot publish", () => {
  assert.match(updaterSmokeWorkflow, /workflow_dispatch:/);
  assert.match(updaterSmokeWorkflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(updaterSmokeWorkflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(updaterSmokeWorkflow, /contents: write/);
  assert.doesNotMatch(updaterSmokeWorkflow, /action-gh-release/);
});

test("updater smoke test builds a protected disposable baseline", () => {
  const cargoVersionOverride = updaterSmokeWorkflow.indexOf(
    "node ../scripts/release/release-version.mjs set 0.0.0",
  );
  const tauriBuild = updaterSmokeWorkflow.indexOf("npm run tauri build");

  assert.match(updaterSmokeWorkflow, /environment:\s*\n\s+name: release/);
  assert.match(updaterSmokeWorkflow, /version: "0\.0\.0"/);
  assert.match(updaterSmokeWorkflow, /createUpdaterArtifacts: false/);
  assert.match(updaterSmokeWorkflow, /releases\/download\/v\$TARGET_VERSION\/latest\.json/);
  assert.doesNotMatch(updaterSmokeWorkflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.notEqual(cargoVersionOverride, -1);
  assert.notEqual(tauriBuild, -1);
  assert.ok(cargoVersionOverride < tauriBuild);
});


test("release signs the provisioner with the updater key and requires its signature", () => {
  assert.match(workflow, /npm run tauri signer sign -- \.\.\/scripts\/provision\/dist\/provision\.sh/);
  assert.match(workflow, /verify-updater-signature\.mjs[\s\S]*provision\.sh\.sig[\s\S]*src-tauri\/tauri\.conf\.json/);
  assert.match(workflow, /dist-release\/provision\.sh\.sig/);
  assert.match(workflow, /"provision\.sh\.sig"; do/);
  assert.match(workflow, /wc -l\)" = 12/);
});

test("test releases retain protected signing and cannot become the stable update target", () => {
  assert.match(workflow, /test_release:[\s\S]*?default: false/);
  assert.match(workflow, /if \[ "\$TEST_RELEASE" = true \]; then prerelease=true; fi/);
  assert.ok(workflow.includes("make_latest: ${{ inputs.test_release && 'false' || '' }}"));
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /environment:\s*\n\s+name: release/);
  assert.match(workflow, /draft: true/);
  assert.match(workflow, /node scripts\/release\/release-version.mjs set "\$REQUESTED_VERSION"/);
  const desktop = workflow.slice(workflow.indexOf("  desktop-macos-arm64:"));
  assert.ok(desktop.indexOf('release-version.mjs set "$RELEASE_VERSION"') < desktop.indexOf("npm run tauri build"));
  assert.match(desktop, /release-version.mjs set "\$RELEASE_VERSION"/);
});
