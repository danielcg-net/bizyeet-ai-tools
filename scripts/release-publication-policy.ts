import { createHash } from "node:crypto";
type Mapping = Readonly<Record<string, unknown>>;
// Exact normalized fingerprint covers all privileged inline code and boundaries.
const reviewedWorkflowSha256 = "cca7b68b65b7da85392fe28b1b245b34f3c2a58cec1a8e591f960a7b0ba76cec";
/** Permit only the explicitly reviewed release workflow; any mutation needs review. */
export const permitsProtectedRelease = (fileName: string, workflow: Mapping, jobId: string): boolean =>
  fileName === "release.yml" && ["readiness", "attest", "publish", "github-release"].includes(jobId)
  && createHash("sha256").update(JSON.stringify(workflow)).digest("hex") === reviewedWorkflowSha256;
