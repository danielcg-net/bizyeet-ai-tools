const branchPattern = /^(bizyeet-\d+)\/[a-z0-9][a-z0-9-]*$/u;

export type PullRequestMetadata = Readonly<{ branch: unknown; title: unknown }>;
export type PullRequestMetadataValidation = Readonly<{ errors: readonly string[]; issueId: string | null }>;
export type PullRequestCommit = Readonly<{
  sha: string;
  commit: Readonly<{ message: unknown }>;
  parents: unknown;
}>;

/** Identifies the only automated author exempt from human delivery identifiers. */
export const isTrustedDependabotAuthor = (login: unknown): boolean => login === "dependabot[bot]";

const commitSubject = (message: unknown): string => {
  if (typeof message !== "string") {
    return "(empty message)";
  }

  const [firstLine = ""] = message.trim().split("\n", 1);

  return firstLine === "" ? "(empty message)" : firstLine;
};

/** Validates a pull-request branch and title against the YouTrack delivery policy. */
export const validatePullRequestMetadata = ({ branch, title }: PullRequestMetadata): PullRequestMetadataValidation => {
  if (typeof branch !== "string") {
    return { errors: ["Branch name is required."], issueId: null };
  }

  const branchMatch = branchPattern.exec(branch);

  if (branchMatch === null) {
    return {
      errors: [`Branch '${branch}' must use 'bizyeet-123/concise-description' (for example, 'bizyeet-456/add-login-page').`],
      issueId: null,
    };
  }

  const issueId = branchMatch[1];

  if (issueId === undefined) {
    return { errors: ["Branch issue identifier is required."], issueId: null };
  }

  const titlePattern = new RegExp(`^${issueId.toUpperCase()}:\\s\\S`, "u");

  return typeof title === "string" && titlePattern.test(title)
    ? { errors: [], issueId }
    : { errors: [`PR title must start with '${issueId.toUpperCase()}: '.`], issueId };
};

/** Validates non-merge pull-request commit subjects against its YouTrack issue ID. */
export const validateCommitMessages = (issueId: string, commits: readonly PullRequestCommit[]): readonly string[] => {
  if (commits.length === 0) {
    return ["PR must contain at least one commit."];
  }

  const commitPattern = new RegExp(`^${issueId}:\\s\\S`, "u");
  const invalidCommits = commits
    .map(({ sha, commit, parents }) => ({
      sha: sha.slice(0, 7),
      subject: commitSubject(commit.message),
      isMergeCommit: Array.isArray(parents) && parents.length > 1,
    }))
    .filter(({ subject, isMergeCommit }) => !isMergeCommit && !commitPattern.test(subject));

  return invalidCommits.length === 0
    ? []
    : [`Every non-merge PR commit must start with '${issueId}: '. Invalid commits: ${invalidCommits.slice(0, 10).map(({ sha, subject }) => `${sha} (${subject})`).join(", ")}`];
};
