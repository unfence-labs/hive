import assert from "node:assert/strict";
import test from "node:test";

import {
  cargoLockVersion,
  cargoVersion,
  parseVersion,
} from "../../scripts/release/release-version.mjs";

test("stable and prerelease versions expose a numeric macOS version", () => {
  assert.deepEqual(parseVersion("1.2.3"), {
    version: "1.2.3",
    core: "1.2.3",
    prerelease: "",
    isPrerelease: false,
  });
  assert.deepEqual(parseVersion("1.2.3-beta.4"), {
    version: "1.2.3-beta.4",
    core: "1.2.3",
    prerelease: "beta.4",
    isPrerelease: true,
  });
  assert.equal(parseVersion("1.2.3-rc.1+build.5").core, "1.2.3");
});

test("invalid semantic versions are rejected", () => {
  for (const version of [
    "1.2",
    "1.2.03",
    "1.2.3-",
    "1.2.3-01",
    "1.2.3+",
    "1.2.3+bad_value",
  ]) {
    assert.throws(() => parseVersion(version), /invalid semantic version/);
  }
});

test("Cargo package versions are read from their exact package blocks", () => {
  assert.equal(
    cargoVersion('[package]\nname = "hive"\nversion = "2.0.0-beta.1"\n\n[dependencies]\n'),
    "2.0.0-beta.1",
  );
  assert.equal(
    cargoLockVersion(
      '[[package]]\nname = "hive"\nversion = "2.0.0-beta.1"\ndependencies = []\n',
    ),
    "2.0.0-beta.1",
  );
});
