# Native ACL test diagnostics

- BIZYEET-741: Windows native export tests decorate the constant ACL script with fixed stderr phase labels and elapsed milliseconds. They never log paths, environment values or canonical response data.
- Diagnostics retain the production executor timeout, buffer limit, executable arguments and every ACL assertion. Production export-security.ts is unchanged; this is instrumentation, not a timeout fix.
- A failure before `start` suggests process startup; later labels narrow the pending operation. Labels report entry, not completion. Windows CI remains required because local POSIX runs skip native ACL execution.
