# Repository action pinning

The TypeScript security:actions admin script is read-only by default and targets
only danielcg-net/bizyeet-ai-tools through existing gh authentication. --apply
enables SHA pinning while preserving enabled/allowed-actions settings, then
verifies read-back. No tenant credentials, CI invocation, automatic retries or
rollback. Remote enforcement must be verified independently of unit tests.
