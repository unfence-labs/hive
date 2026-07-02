import { git } from "./git.js";

export async function getBranchName(wsPath: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], wsPath);
  return stdout;
}
