import { describe, expect, it } from "vitest";
import {
  INSTALL_LOG_LIMIT,
  applyInstallRecord,
  initialProgress,
  type InstallProgress,
} from "@/pages/installer/install-progress";
import type { ProvisionRecord } from "@/lib/provision-client";
import { ACCESS_TOKEN, failureRecords, successRecords } from "./mock-provision-client";

function fold(records: ProvisionRecord[], from = initialProgress()): InstallProgress {
  return records.reduce(applyInstallRecord, from);
}

describe("install progress", () => {
  it("shows the whole plan from the first frame, then each step's state", () => {
    const started = fold(successRecords().slice(0, 1));
    expect(started.steps.map((step) => step.status)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);

    const done = fold(successRecords());
    expect(done.status).toBe("succeeded");
    expect(done.steps.map((step) => [step.id, step.status])).toEqual([
      ["probe_os", "done"],
      ["create_user", "done"],
      ["generate_token", "done"],
      ["health_check", "done"],
    ]);
    // The title comes off the script's own step_start record.
    expect(done.steps[0].title).toBe("Check the server");
  });

  it("keeps the streamed output and reports both accounts the landing needs", () => {
    const progress = fold(successRecords());

    expect(progress.logs).toEqual(["ubuntu 24.04 x86_64"]);
    expect(progress.accessToken).toBe(ACCESS_TOKEN);
    expect(progress.serviceUser).toBe("hive");
  });

  it("marks a resumed run and its already-done steps", () => {
    const progress = fold(successRecords(true));

    expect(progress.resumed).toBe(true);
    expect(progress.steps.find((step) => step.id === "create_user")?.status).toBe("skipped");
    // A skipped create_user still names the account, so a resumed run lands the
    // same connection a fresh one would.
    expect(progress.serviceUser).toBe("hive");
    expect(progress.status).toBe("succeeded");
  });

  it("keeps the step's own error rather than the terminal record's repeat of it", () => {
    const progress = fold(failureRecords());

    expect(progress.status).toBe("failed");
    expect(progress.failure).toEqual({
      code: "DIRECTORY_UNUSABLE",
      detail: "/home/hive/.hive is not writable",
      step: "create_user",
    });
    expect(progress.steps.find((step) => step.id === "create_user")?.status).toBe("failed");
  });

  it("fails a run that ends without a token rather than landing on an unreachable server", () => {
    const records = successRecords().filter((record) => record.step !== "generate_token");
    const progress = fold(records);

    expect(progress.status).toBe("failed");
    expect(progress.failure?.detail).toContain("no access token");
  });

  it("fails a run that names no service account rather than guessing one", () => {
    // An older script whose create_user reports nothing on a resume.
    const records = successRecords(true).map((record) =>
      record.step === "create_user" ? { ...record, data: undefined } : record,
    );
    const progress = fold(records);

    expect(progress.status).toBe("failed");
    expect(progress.failure?.detail).toContain("no service account");
  });

  it("treats a terminal record with no step behind it as the failure", () => {
    const progress = fold([
      { event: "run_end", status: "error", errorCode: "SSH_AUTH_FAILED", detail: "denied" },
    ]);

    expect(progress.status).toBe("failed");
    expect(progress.failure).toEqual({ code: "SSH_AUTH_FAILED", detail: "denied" });
  });

  it("ignores records that are not part of the run's own progress", () => {
    const progress = fold([
      { event: "some_future_event", status: "ok" },
      { event: "preflight_check", status: "ok" },
    ]);

    expect(progress).toEqual(initialProgress());
  });

  it("keeps only the tail of an unbounded stream", () => {
    const noise: ProvisionRecord[] = Array.from({ length: INSTALL_LOG_LIMIT + 50 }, (_, index) => ({
      seq: index,
      step: "apt_baseline",
      status: "log",
      line: `line ${index}`,
    }));
    const progress = fold(noise);

    expect(progress.logs).toHaveLength(INSTALL_LOG_LIMIT);
    expect(progress.logs.at(-1)).toBe(`line ${INSTALL_LOG_LIMIT + 49}`);
  });
});
