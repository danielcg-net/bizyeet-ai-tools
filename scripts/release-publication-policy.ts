import { createHash } from "node:crypto";
type Mapping = Readonly<Record<string, unknown>>;
// Exact normalized fingerprint covers all privileged inline code and boundaries.
const reviewedWorkflowSha256 = "c54f8d09d431cfb700db31b3c12755c219f94896ea3a68fdd65a90ca7cd48b29";
/** Permit only the explicitly reviewed release workflow; any mutation needs review. */
export const permitsProtectedRelease = (fileName: string, workflow: Mapping, jobId: string): boolean =>
  fileName === "release.yml" && ["readiness", "attest", "publish", "github-release"].includes(jobId)
  && createHash("sha256").update(JSON.stringify(workflow)).digest("hex") === reviewedWorkflowSha256;
