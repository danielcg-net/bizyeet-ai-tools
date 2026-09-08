# Suggested commands

- Install locked dependencies: `npm ci`.
- Run the complete local gate: `npm run check`.
- Build executable artifacts: `npm run build`.
- Run the development CLI after building: `node dist/src/cli.js --help`.
- Inspect local credential metadata: `node dist/src/cli.js auth status`.
- Verify current server access without reading CRM data: `node dist/src/cli.js auth check`.
- Installed-package tests require OpenSSL to generate an ephemeral loopback-only TLS certificate. They never disable TLS verification or use production credentials.
