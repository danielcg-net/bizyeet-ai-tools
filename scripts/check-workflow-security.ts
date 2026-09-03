import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

type Workflow = Readonly<Record<string, unknown>>;

const workflowDirectory = new URL("../../.github/workflows/", import.meta.url);
const workflowExtension = /\.ya?ml$/u;
const commitSha = /^[a-f0-9]{40}$/u;
const permittedPermissions: Readonly<Record<string, readonly string[]>> = {
  contents: ["read"],
  "security-events": ["write"],
};

const isRecord = (value: unknown): value is Workflow => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

const parseWorkflow = (source: string): Workflow => {
  const document = parseDocument(source, { prettyErrors: true });

  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join("\n"));
  }

  const workflow: unknown = document.toJS({ maxAliasCount: 0 });

  if (!isRecord(workflow)) {
    throw new Error("Workflow root must be a mapping.");
  }

  return workflow;
};

const usesSelfHostedRunner = (runner: unknown): boolean =>
  runner === "self-hosted" ||
  (isStringArray(runner) && runner.includes("self-hosted")) ||
  (isRecord(runner) && usesSelfHostedRunner(runner.labels));

const jobUsesSelfHostedRunner = (jobs: unknown): boolean =>
  isRecord(jobs) && Object.values(jobs).some((job) => isRecord(job) && usesSelfHostedRunner(job["runs-on"]));

const hasLeastPrivilegePermissions = (permissions: unknown): boolean =>
  isRecord(permissions) &&
  Object.entries(permissions).every(
    ([scope, access]) => typeof access === "string" && permittedPermissions[scope]?.includes(access) === true,
  );

const actionReferences = (jobs: unknown): readonly string[] =>
  !isRecord(jobs)
    ? []
    : Object.values(jobs).flatMap((job) =>
        !isRecord(job) || !Array.isArray(job.steps)
          ? []
          : job.steps.flatMap((step) => (isRecord(step) && typeof step.uses === "string" ? [step.uses] : [])),
      );

const isPinnedExternalAction = (reference: string): boolean => {
  const [action, revision] = reference.split("@");

  return action?.startsWith("./") === true || (action !== undefined && commitSha.test(revision ?? ""));
};

/** Validates public-workflow restrictions before CI is trusted. */
export const validateWorkflow = (fileName: string, source: string): readonly string[] => {
  const workflow = parseWorkflow(source);
  const invalidActionReferences = actionReferences(workflow.jobs).filter((reference) => !isPinnedExternalAction(reference));

  return [
    ...("pull_request_target" in workflow ? [`${fileName}: pull_request_target is forbidden`] : []),
    ...(jobUsesSelfHostedRunner(workflow.jobs) ? [`${fileName}: self-hosted runners are forbidden`] : []),
    ...(!hasLeastPrivilegePermissions(workflow.permissions) ? [`${fileName}: permissions must use the approved least-privilege mapping`] : []),
    ...invalidActionReferences.map((reference) => `${fileName}: action must use a full commit SHA (${reference})`),
  ];
};

/** Reads and validates every GitHub Actions workflow in this public repository. */
export const checkWorkflowSecurity = async (): Promise<readonly string[]> => {
  const directoryPath = workflowDirectory.pathname;
  const fileNames = (await readdir(directoryPath)).filter((fileName) => workflowExtension.test(fileName));
  const workflows = await Promise.all(fileNames.map(async (fileName) => ({ fileName, source: await readFile(join(directoryPath, fileName), "utf8") })));

  return workflows.flatMap(({ fileName, source }) => validateWorkflow(fileName, source));
};

const violations = await checkWorkflowSecurity();

if (violations.length > 0) {
  throw new Error(violations.join("\n"));
}

console.log("Verified public-workflow security restrictions.");
