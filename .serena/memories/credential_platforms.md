# Credential platform boundaries

Prefer the native OAuth credential manager. POSIX headless fallback uses
owner-only mode checks. Windows chmod does not distinguish owner/group/others;
refuse plaintext fallback rather than pretending0600 is protection. Missing
fallback cleanup must be a no-op, especially after successful native storage.

POSIX fallback checks the immediate config directory with lstat (owned by the
current uid, no group/other permissions, not a symlink). Credential reads use
O_NOFOLLOW plus O_NONBLOCK and validate the open descriptor: regular file,
single hard link, current uid, owner-only mode. Read via that same descriptor
and always close it. This removes a pathname stat/read race and avoids blocking
on special files. Ancestor directories must remain trusted; this is not a
defense against another process already running as the same OS user. Atomic
temporary writes use exclusive creation and clean up after rename failures.
Malformed JSON must produce a fixed error without parser excerpts or causes.

Never classify every error mentioning keyring as an unavailable backend. Only
an explicit, anchored unavailable/unsupported backend statement permits file
fallback. Denied, locked (any capitalization), ambiguous, corrupt, and unknown
errors must preserve failure for reads, writes and logout cleanup. Published
@napi-rs/keyring 2.0.0 returns undefined only for NoEntry; other native errors
propagate. Its Linux builder tries Secret Service then keyutils. A container
failure alone is not permission to classify an inaccessible store as absent.

Installed package tests use unique synthetic profiles. Windows fixtures use
the native credential manager and remove their entries afterward; POSIX fixtures
exercise the permission-checked file path. Never seed a real user's profile.

Launch npm via process.execPath plus npm_execpath, and installed commands via
offline npm exec, not direct spawn of Windows cmd files. When constructing a
child environment, consolidate PATH/Path casing so the system search path is
retained. Release verification streams full test output so late failures are
not truncated inside an execFile error's stdout property.

Let the CLI event loop drain instead of forcing process.exit after native async
credential work. The sole process.exitCode assignment is a documented external
I/O boundary exception; application variables and data remain immutable and
the global ESLint rules stay enabled. Installed tests verify nonzero exit codes.
