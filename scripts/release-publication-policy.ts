import { createHash } from "node:crypto";
type Mapping = Readonly<Record<string, unknown>>;
// Exact normalized fingerprint covers all privileged inline code and boundaries.
const reviewedWorkflowSha256 = "12434a52e0bb803e230f2f79b4f27c2ac3b41e7229adb53bf5a31e22ecc879c5";
/** Permit only the explicitly reviewed release workflow; any mutation needs review. */
export const permitsProtectedRelease = (fileName: string, workflow: Mapping, jobId: string): boolean =>
  fileName === "release.yml" && ["readiness", "attest", "publish", "github-release"].includes(jobId)
  && createHash("sha256").update(JSON.stringify(workflow)).digest("hex") === reviewedWorkflowSha256;
