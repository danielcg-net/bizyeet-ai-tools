import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const workflowDirectory = new URL("../../.github/workflows/", import.meta.url);
const workflowExtension = /\.ya?ml$/u;
const externalAction = /^\s*uses:\s+[^/\s]+\/[^@\s]+@([^\s#]+).*$/gmu;
const commitSha = /^[a-f0-9]{40}$/u;

const collectActionReferences = (workflow: string): readonly string[] =>
  [...workflow.matchAll(externalAction)].map((match) => match[1] ?? "");
const hasExplicitTopLevelPermissions = (workflow: string): boolean => /^permissions:\s*$/mu.test(workflow);
const hasForbiddenTrigger = (workflow: string): boolean => /(^|\n)\s*pull_request_target\s*:/u.test(workflow);
const usesSelfHostedRunner = (workflow: string): boolean => /runs-on:\s*\[?self-hosted/u.test(workflow);

const validateWorkflow = (fileName: string, workflow: string): readonly string[] => {
  const invalidActionReferences = collectActionReferences(workflow).filter((reference) => !commitSha.test(reference));

  return [
    ...(hasForbiddenTrigger(workflow) ? [`${fileName}: pull_request_target is forbidden`] : []),
    ...(usesSelfHostedRunner(workflow) ? [`${fileName}: self-hosted runners are forbidden`] : []),
    ...(!hasExplicitTopLevelPermissions(workflow) ? [`${fileName}: explicit top-level permissions are required`] : []),
    ...invalidActionReferences.map((reference) => `${fileName}: action must use a full commit SHA (${reference})`),
  ];
};

/** Validates public-workflow restrictions before CI is trusted. */
export const checkWorkflowSecurity = async (): Promise<readonly string[]> => {
  const directoryPath = workflowDirectory.pathname;
  const fileNames = (await readdir(directoryPath)).filter((fileName) => workflowExtension.test(fileName));
  const workflows = await Promise.all(fileNames.map(async (fileName) => ({ fileName, content: await readFile(join(directoryPath, fileName), "utf8") })));

  return workflows.flatMap(({ fileName, content }) => validateWorkflow(fileName, content));
};

const violations = await checkWorkflowSecurity();

if (violations.length > 0) {
  throw new Error(violations.join("\n"));
}

console.log("Verified public-workflow security restrictions.");
