#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const TRUSTED_COMMENT_PREFIX = "trusted comment: ";

function decodeBase64(value, label) {
  const normalized = value.trim();
  if (normalized === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`invalid ${label}`);
  }
  return Buffer.from(normalized, "base64");
}

function decodeText(value, label) {
  const decoded = decodeBase64(value, label);
  const text = decoded.toString("utf8");
  if (!decoded.equals(Buffer.from(text, "utf8"))) {
    throw new Error(`invalid UTF-8 in ${label}`);
  }
  return text;
}

function parsePublicKey(encodedPublicKey) {
  const lines = decodeText(encodedPublicKey, "updater public key").trimEnd().split(/\r?\n/);
  if (lines.length !== 2) throw new Error("invalid updater public key");

  const packet = decodeBase64(lines[1], "updater public key packet");
  if (packet.length !== 42 || packet.subarray(0, 2).toString("ascii") !== "Ed") {
    throw new Error("invalid updater public key packet");
  }
  return {
    id: packet.subarray(2, 10),
    key: createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, packet.subarray(10)]),
      format: "der",
      type: "spki",
    }),
  };
}

function parseSignature(encodedSignature) {
  const lines = decodeText(encodedSignature, "updater signature").trimEnd().split(/\r?\n/);
  if (lines.length !== 4 || !lines[2].startsWith(TRUSTED_COMMENT_PREFIX)) {
    throw new Error("invalid updater signature");
  }

  const packet = decodeBase64(lines[1], "updater signature packet");
  const algorithm = packet.subarray(0, 2).toString("ascii");
  if (packet.length !== 74 || (algorithm !== "Ed" && algorithm !== "ED")) {
    throw new Error("invalid updater signature packet");
  }

  const globalSignature = decodeBase64(lines[3], "updater global signature");
  if (globalSignature.length !== 64) {
    throw new Error("invalid updater global signature");
  }

  return {
    algorithm,
    id: packet.subarray(2, 10),
    signature: packet.subarray(10),
    trustedComment: lines[2].slice(TRUSTED_COMMENT_PREFIX.length),
    globalSignature,
  };
}

export function verifyUpdaterSignature(artifact, encodedSignature, encodedPublicKey) {
  const publicKey = parsePublicKey(encodedPublicKey);
  const signature = parseSignature(encodedSignature);

  if (!publicKey.id.equals(signature.id)) {
    throw new Error("updater signature does not match the configured public key");
  }

  const message = signature.algorithm === "ED"
    ? createHash("blake2b512").update(artifact).digest()
    : artifact;
  if (!verify(null, message, publicKey.key, signature.signature)) {
    throw new Error("invalid updater artifact signature");
  }

  const globalMessage = Buffer.concat([
    signature.signature,
    Buffer.from(signature.trustedComment, "utf8"),
  ]);
  if (!verify(null, globalMessage, publicKey.key, signature.globalSignature)) {
    throw new Error("invalid updater global signature");
  }
}

function usage() {
  console.error(
    "usage: verify-updater-signature.mjs <artifact> <signature> <tauri-config>",
  );
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [artifactPath, signaturePath, configPath, extra] = process.argv.slice(2);
  if (!artifactPath || !signaturePath || !configPath || extra !== undefined) {
    usage();
  } else {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      const publicKey = config.plugins?.updater?.pubkey;
      if (typeof publicKey !== "string" || publicKey === "") {
        throw new Error("missing plugins.updater.pubkey in Tauri config");
      }
      verifyUpdaterSignature(
        readFileSync(artifactPath),
        readFileSync(signaturePath, "utf8"),
        publicKey,
      );
      console.log(`verified updater signature: ${artifactPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
