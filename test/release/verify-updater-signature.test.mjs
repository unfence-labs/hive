import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyUpdaterSignature,
} from "../../scripts/release/verify-updater-signature.mjs";

const PUBLIC_KEY = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDFGNDZBMTM4NzFBREY5OEYKUldTUCthMXhPS0ZHSDVJemFjeFllai9pRWk5MkdIOEo5ckZWeCs0cDgyc0Uvejh0alRRamFCbnQK";
const EMPTY_ARTIFACT_SIGNATURE = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTUCthMXhPS0ZHSDEycm0zNnZpUkM1WmhGUnlKWmtaeGhSN2VqT05CWVVKV0wrbUdlV0lJbkdkcjNWOHBjM2N4Z29iMGZPOUNrM0JaL09EQ0RWekF4NitLVnhqS1kvRmc4PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg1NDg1MDc2CWZpbGU6YXJ0aWZhY3QuUDduR1hSCmxwaUNsYkRIUk8wcnpvU1hVdnlRYVduK0pid2M0QWxqbnltNWd4WHZVR0hxbjdnd3hKcjc2Uy84MkUveW5GaWFIOHZnYTJxa2dEcVFhalhjOFJISUJRPT0K";
const OTHER_PUBLIC_KEY = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEYwM0U0NDU0RjIwMzc5MjkKUldRcGVRUHlWRVErOEhTbmZrZ25aNGxzaVc2YmNmNm9TTWZ3NmFMWG1taXlDMnZ0TVc5TWNvLzIK";

test("accepts an artifact signed by the configured updater key", () => {
  assert.doesNotThrow(() => {
    verifyUpdaterSignature(Buffer.alloc(0), EMPTY_ARTIFACT_SIGNATURE, PUBLIC_KEY);
  });
});

test("rejects a modified updater artifact", () => {
  assert.throws(
    () => verifyUpdaterSignature(Buffer.from("modified"), EMPTY_ARTIFACT_SIGNATURE, PUBLIC_KEY),
    /invalid updater artifact signature/,
  );
});

test("rejects an updater signature made by another key", () => {
  assert.throws(
    () => verifyUpdaterSignature(Buffer.alloc(0), EMPTY_ARTIFACT_SIGNATURE, OTHER_PUBLIC_KEY),
    /does not match the configured public key/,
  );
});
