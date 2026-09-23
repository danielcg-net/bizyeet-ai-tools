# Quote reads

- CLI list/get use canonical OAuth `/api/agent/quotes` via the shared refresh, profile lock, bounded output and credential persistence boundaries.
- Treat IDs, pricing revisions, cursors and line handles as server facts. Do not decode handles or reproduce provider routing or pricing logic.
- Project only the documented public fields and id/description/quantity/unit_price for lines. Never expose nested costs, raw customer references, notes or private contact metadata.
- Quote mutations are not implemented by these reads. MCP entries are read-only contract declarations, not proof of advertised runtime tools or backend deployment.
