import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function git(args: string[], cwd?: string): Promise<ExecResult> {
  const { stdout, stderr } = await execFile("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}
