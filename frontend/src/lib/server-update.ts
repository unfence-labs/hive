export interface ServerVersionResponse {
  version: string;
  updateMethod: "manual" | "provisioner";
}
