import { readFile, stat } from "node:fs/promises";
import { evaluateHarnessTrace, parseHarnessScenario, parseHarnessTrace } from "./harness-trace-eval.js";

const maximumTraceBytes = 262_144;
const maximumPolicyBytes = 4096;

const readJson = async (path: string, maximum: number): Promise<unknown> => {
  const file = await stat(path);
  if (!file.isFile() || file.size > maximum) throw new Error("invalid_input");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
};

const scoreFiles = async (policyPath: string, tracePath: string): Promise<number> => {
  try {
    const policy = parseHarnessScenario(await readJson(policyPath, maximumPolicyBytes));
    const trace = parseHarnessTrace(await readJson(tracePath, maximumTraceBytes));
    if (!policy || !trace) throw new Error("invalid_input");
    const score = evaluateHarnessTrace(policy, trace);
    process.stdout.write(`${JSON.stringify(score)}\n`);
    return score.passed ? 0 : 1;
  } catch {
    // Never echo an input path, content, parser diagnostic, or secret-like value.
    process.stderr.write('{"error":"invalid_trace"}\n');
    return 2;
  }
};

const policyPath = process.argv[2];
const tracePath = process.argv[3];
if (!policyPath || !tracePath || process.argv.length !== 4) {
  process.stderr.write('{"error":"usage"}\n');
  process.exit(2);
}

process.exit(await scoreFiles(policyPath, tracePath));
