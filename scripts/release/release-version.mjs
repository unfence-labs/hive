#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CARGO_TOML = path.join(ROOT, "frontend/src-tauri/Cargo.toml");
const CARGO_LOCK = path.join(ROOT, "frontend/src-tauri/Cargo.lock");

function invalid(version) {
  throw new Error(`invalid semantic version: ${version}`);
}

export function parseVersion(version) {
  if (typeof version !== "string" || version === "" || version.trim() !== version) {
    invalid(version);
  }

  const plus = version.indexOf("+");
  if (plus !== -1 && version.indexOf("+", plus + 1) !== -1) {
    invalid(version);
  }
  const withoutBuild = plus === -1 ? version : version.slice(0, plus);
  const build = plus === -1 ? "" : version.slice(plus + 1);
  if (build && !build.split(".").every((part) => /^[0-9A-Za-z-]+$/.test(part))) {
    invalid(version);
  }
  if (plus !== -1 && build === "") {
    invalid(version);
  }

  const dash = withoutBuild.indexOf("-");
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const prerelease = dash === -1 ? "" : withoutBuild.slice(dash + 1);
  const coreParts = core.split(".");
  if (
    coreParts.length !== 3 ||
    !coreParts.every((part) => /^(0|[1-9][0-9]*)$/.test(part))
  ) {
    invalid(version);
  }
  if (dash !== -1) {
    const validPrerelease =
      prerelease !== "" &&
      prerelease.split(".").every((part) => {
        if (!/^[0-9A-Za-z-]+$/.test(part)) return false;
        return !/^[0-9]+$/.test(part) || /^(0|[1-9][0-9]*)$/.test(part);
      });
    if (!validPrerelease) invalid(version);
  }

  return {
    version,
    core,
    prerelease,
    isPrerelease: prerelease !== "",
  };
}

function packageBlock(contents, header) {
  const start = contents.indexOf(header);
  if (start === -1) throw new Error(`missing ${header}`);
  const bodyStart = start + header.length;
  const next = contents.indexOf("\n[", bodyStart);
  return {
    start: bodyStart,
    end: next === -1 ? contents.length : next,
    body: contents.slice(bodyStart, next === -1 ? contents.length : next),
  };
}

export function cargoVersion(contents) {
  const { body } = packageBlock(contents, "[package]");
  const match = body.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) throw new Error("missing Cargo package version");
  return parseVersion(match[1]).version;
}

export function cargoLockVersion(contents) {
  for (const block of contents.split("[[package]]").slice(1)) {
    if (/^\s*name\s*=\s*"hive"\s*$/m.test(block) && !/^\s*source\s*=/m.test(block)) {
      const match = block.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
      if (!match) throw new Error("missing hive version in Cargo.lock");
      return parseVersion(match[1]).version;
    }
  }
  throw new Error("missing hive package in Cargo.lock");
}

function replaceCargoVersion(contents, version) {
  const block = packageBlock(contents, "[package]");
  if (!/^(\s*version\s*=\s*)"[^"]+"(\s*)$/m.test(block.body)) {
    throw new Error("missing Cargo package version");
  }
  const body = block.body.replace(
    /^(\s*version\s*=\s*)"[^"]+"(\s*)$/m,
    `$1"${version}"$2`,
  );
  return contents.slice(0, block.start) + body + contents.slice(block.end);
}

function replaceCargoLockVersion(contents, version) {
  let replaced = false;
  const updated = contents
    .split("[[package]]")
    .map((block, index) => {
      if (
        index > 0 &&
        /^\s*name\s*=\s*"hive"\s*$/m.test(block) &&
        !/^\s*source\s*=/m.test(block)
      ) {
        replaced = true;
        return block.replace(
          /^(\s*version\s*=\s*)"[^"]+"(\s*)$/m,
          `$1"${version}"$2`,
        );
      }
      return block;
    })
    .join("[[package]]");
  if (!replaced) throw new Error("missing hive package in Cargo.lock");
  return updated;
}

export function readVersion() {
  return cargoVersion(readFileSync(CARGO_TOML, "utf8"));
}

export function checkVersion(expected) {
  const version = readVersion();
  const lockVersion = cargoLockVersion(readFileSync(CARGO_LOCK, "utf8"));
  if (lockVersion !== version) {
    throw new Error(`Cargo.lock version ${lockVersion} does not match Cargo.toml ${version}`);
  }
  if (expected !== undefined && expected !== version) {
    throw new Error(`requested version ${expected} does not match Cargo.toml ${version}`);
  }
  return parseVersion(version);
}

function setVersion(version) {
  parseVersion(version);
  writeFileSync(
    CARGO_TOML,
    replaceCargoVersion(readFileSync(CARGO_TOML, "utf8"), version),
  );
  writeFileSync(
    CARGO_LOCK,
    replaceCargoLockVersion(readFileSync(CARGO_LOCK, "utf8"), version),
  );
}

function usage() {
  console.error(
    "usage: release-version.mjs get | check [version] | set <version> | macos <version>",
  );
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  try {
    if (command === "get" && argument === undefined) {
      console.log(checkVersion().version);
    } else if (command === "check") {
      checkVersion(argument);
    } else if (command === "set" && argument !== undefined) {
      setVersion(argument);
      console.log(argument);
    } else if (command === "macos" && argument !== undefined) {
      console.log(parseVersion(argument).core);
    } else {
      usage();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
