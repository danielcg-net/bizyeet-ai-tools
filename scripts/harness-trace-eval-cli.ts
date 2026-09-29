import { readFile, stat } from "node:fs/promises";
import { evaluateHarnessTrace, parseHarnessTrace } from "./harness-trace-eval.js";

const maximumTraceBytes = 262_144;

const scoreFile = async (path: string): Promise<number> => {
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size > maximumTraceBytes) throw new Error("invalid_trace");
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    const trace = parseHarnessTrace(value);
    if (!trace) throw new Error("invalid_trace");
    const score = evaluateHarnessTrace(trace);
    process.stdout.write(`${JSON.stringify(score)}\n`);
    return score.passed ? 0 : 1;
  } catch {
    // Never echo a trace path, content, parser diagnostic, or secret-like value.
    process.stderr.write('{"error":"invalid_trace"}\n');
    return 2;
  }
};

const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  process.stderr.write('{"error":"usage"}\n');
  process.exit(2);
}

process.exit(await scoreFile(path));
