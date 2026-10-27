import { createHash } from "node:crypto";
type Mapping = Readonly<Record<string, unknown>>;
// Exact normalized fingerprint covers all privileged inline code and boundaries.
const reviewedWorkflowSha256 = "4dbfd3dd3d73c299b0516ae468c5dc3f0bf5a66c300db86361c430f13cf3a16e";
/** Permit only the explicitly reviewed release workflow; any mutation needs review. */
export const permitsProtectedRelease = (fileName: string, workflow: Mapping, jobId: string): boolean =>
  fileName === "release.yml" && ["readiness", "attest", "publish", "github-release"].includes(jobId)
  && createHash("sha256").update(JSON.stringify(workflow)).digest("hex") === reviewedWorkflowSha256;
