# Canonical CRM search

BIZYEET-849 preserves the advertised 200 Unicode-code-point search bound.
`src/search-contract.ts` provides the bound shared by CLI validation and MCP schema.
Validate raw length before normalization; do not truncate, route providers, or
duplicate the server's trim/filter logic. The private canonical service owns
normalization and complete-search cursor binding. Test ASCII and non-BMP exact
boundaries and rejection before network dispatch. Coordinate deployment with the
private BIZYEET-849 server change; raising the CLI limit alone does not fix the
former server-side 120-unit truncation.
