# Windows export subprocess deadline

- Export ACL establishment and verification use one bounded PowerShell invocation per stage, with a 30-second timeout and a 16 KiB output bound.
- A postmerge Windows/Node 26 run terminated the original 10-second invocation during directory protection. The increased cold-start allowance does not bypass owner-only ACL verification or retry a partially completed invocation.
- A timeout still fails closed before response data is written. The regression test checks one attempt, no file opening, and cleanup of the temporary directory.
- Keep the native Windows ACL test enabled in the supported Windows release matrix; mocked tests cannot prove native Windows behavior.
