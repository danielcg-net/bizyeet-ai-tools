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
temporary writes acquire an exclusive file handle before entering cleanup, then
write/chmod through it, close before rename, and unlink the owned temporary path
on partial-write/chmod/close/rename failure. Never unlink after failed exclusive
open: EEXIST may identify a pre-existing file not owned by this operation.
Cleanup errors other than ENOENT remain visible. Injected failures must preserve
existing saved credentials and leave no temporary secret when cleanup succeeds.
Malformed JSON must produce a fixed error without parser excerpts or causes.

Never classify every error mentioning keyring as an unavailable backend. Only
an explicit, anchored unavailable/unsupported backend statement permits file
fallback. Denied, locked (any capitalization), ambiguous, corrupt, and unknown
errors must preserve failure for reads, writes and logout cleanup. Published
@napi-rs/keyring 2.0.0 returns undefined only for NoEntry; other native errors
propagate. Its Linux builder tries Secret Service then keyutils. A container
failure alone is not permission to classify an inaccessible store as absent.

Headless POSIX operators can explicitly select BIZYEET_CREDENTIAL_STORE=file
in the trusted harness environment. All credential operations then use the
existing owner-only file implementation without probing/copying/removing native
entries. Use a dedicated profile and stable private configuration directory;
switching stores is not migration or logout from the other store. Defaults
remain auto/native-first and denied native access still fails closed. Reject
file mode on Windows and reject unknown mode values without echoing them.
Installed POSIX fixture environments explicitly choose file mode, while Windows
continues to exercise native storage. Unit tests preserve default denial gates.

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

Browser launch uses pinned open11.0.2, not cmd.exe /c start. Validate HTTPS-only
targets and pass URL data to the opener; its Windows path uses encoded PowerShell
with literal escaping (including typographic quote delimiters). This is not a
claim that no PowerShell process exists. Windows tests launch a temporary capture
app, not a browser/network destination, to verify metacharacter URL preservation.
Authorization Code requires PKCE S256; separately approved Device Authorization
is retained for headless use under639/643. Do not remove device login by conflating
the authorization-code proof with the distinct OAuth device grant.
