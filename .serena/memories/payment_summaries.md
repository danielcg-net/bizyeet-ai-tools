# Received-payment summaries

- `payments received-summary` uses only the canonical `/api/agent/payments/received-summary` endpoint through the existing OAuth refresh, persistence and profile-lock flow. No local provider decisions, timezone conversion, currency conversion or summation.
- Input accepts named ranges or inclusive custom dates; reject tenant/currency/timezone/provider overrides. Response validation projects documented fields and preserves distinct currency/legacy groups. Do not label gross receipts as net revenue.
- MCP `bizyeet_payments_received_summary` must exactly match the private server descriptor; keep dedicated MCP guide, README and installed cross-repo tests aligned. Availability depends on server deployment.
- `readCompletedAt` is not a snapshot or provider-sync claim. CLI export uses the existing protected export path; no arbitrary output paths or credentials in output.
