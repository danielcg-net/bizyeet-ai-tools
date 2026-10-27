import { createHash } from "node:crypto";
type Mapping = Readonly<Record<string, unknown>>;
// Exact normalized fingerprint covers all privileged inline code and boundaries.
const reviewedWorkflowSha256 = "39da6855f7376c289dd9a5c2fe77b64f5a9a55902c3454859b23666c71ba3076";
/** Permit only the explicitly reviewed release workflow; any mutation needs review. */
export const permitsProtectedRelease = (fileName: string, workflow: Mapping, jobId: string): boolean =>
  fileName === "release.yml" && ["readiness", "attest", "publish", "github-release"].includes(jobId)
  && createHash("sha256").update(JSON.stringify(workflow)).digest("hex") === reviewedWorkflowSha256;
