# Credential platform boundaries

Native saves can commit before obsolete fallback removal fails. Report that
cleanup failure without revoking the now-authoritative grant; do not swallow the
error or treat it as successful cleanup. Pre-commit failures still revoke a newly
issued grant. Device user codes must be nonempty, bounded and display-safe before
returning device authorization to terminal progress output.

Choose the operation-lock profile only from arguments before the `--` separator.
Opaque record IDs such as `--profile=other` must not change the lock or storage
profile. Successful canonical read request IDs use the same bounded printable
correlation helper as errors and writes; preserve absent optional IDs.

Bound-profile logout must retain credentials and return a safe nonzero error if
discovery or revocation fails. Delete only after confirmed server revocation;
local_only is for records without a usable issuer/client binding, not a swallowed
network failure. Tests verify no deletion on failure and a later successful retry.

Load @napi-rs/keyring only when a native operation is selected, never during CLI
module startup. Missing optional platform bindings must not break version,
diagnostics or explicit POSIX file mode. Loader errors remain errors for native
operations: do not classify arbitrary binding failures as permission to downgrade.
The installed-package regression uses --omit=optional, proves direct binding
import fails, then verifies credential-independent commands and explicit file mode.

Browser awaitCode has a five-minute timeout, cancels its delay on every completion,
and closes the real listener. Every shutdown grants active connections one second
then force-closes them, with delay cancellation on earlier close. Device intervals must be at least one second
and fit the timer; missing intervals still default to five seconds. Wire and
direct-exchange inputs share this bound; accepted fractional milliseconds round up.

Fallback credential read/modify/replace and removal transactions hold an exclusive
owner-only .credentials.lock directory, with at most50 contention retries100ms
apart. Only the acquiring operation removes its empty lock in finally; never
automatically remove a pre-existing/stale lock. Operator recovery requires stopping
all owners first. Cross-process tests preserve independently saved profiles and
removals; this does not serialize the network refresh operation for one profile.

Token exchange validation rejects positive finite expires_in values whose absolute
expiration cannot fit a JavaScript Date, before login/refresh consumers serialize
the timestamp. The same predicate protects authorization-code, refresh and device
token responses; malformed responses fail opaquely without retry or token output.
This cannot undo a server-side refresh rotation already performed by a malformed
issuer. Do not claim client validation recovers an already consumed refresh token.

Reject an explicitly configured empty or relative XDG_CONFIG_HOME before fallback
I/O; never place plaintext credentials beneath the process workspace by accident.
Browser login cleanup covers dynamic registration, PKCE generation and launching;
once awaitCode starts it owns callback shutdown. Registration-failure tests open
the real loopback listener and verify it no longer accepts connections.

Issuer/client identity is authoritative only inside the protected StoredCredentials
record alongside access/refresh tokens. Login performs one saveCredentials call,
not separate public profile and secret writes. All CLI status/check/read/write/
logout routing and device client reuse use that protected binding. profiles.json
is legacy non-authoritative metadata; never migrate token destinations from it.
Unbound legacy entries parse only for explicit re-login/replacement or local-only
logout and must not trigger token-bearing requests. Refresh retains the binding;
the agent boundary rejects missing/mismatched issuer/client before token use.
Installed tests poison profiles.json and still exercise the proper issuer on
native Windows and POSIX fallback. Partial fallback-save regression preserves the
original identity and tokens together. These are local-process trust protections,
not a defense against an attacker already running as the same OS user.

Prefer the native OAuth credential manager. POSIX headless fallback uses
owner-only mode checks. Windows chmod does not distinguish owner/group/others;
refuse plaintext fallback rather than pretending0600 is protection. Missing
fallback cleanup must be a no-op, especially after successful native storage.

POSIX auto mode uses permission-checked credential-authority.json and a separate
.credential-authority.lock transaction around store operations. A UUIDv4 pending
generation is persisted before native/fallback secret writes; the identical
storageGeneration is saved inside the protected credential. Committed ownership
selects only its matching record. Pending recovery accepts only exact-generation
records, never older native or fallback values. Missing/mismatched records and
ambiguous legacy stores yield no authenticated credential so re-login can replace
them. Legacy unversioned native/fallback records are usable only when unambiguous;
an unavailable native service plus legacy fallback requires explicit file mode or
re-login. No timestamps determine ordering. Native ownership is committed before
old fallback cleanup, preventing cleanup failures from reviving stale tokens.
Removal must confirm native deletion and remove fallback before recording removed
ownership; never swallow native-unavailable errors or claim successful logout.
Windows is native-only and does not use POSIX authority files. Explicit file mode
remains an independent operator choice as documented below, not an automatic
migration between stores. Metadata carries no tokens or issuer/client bindings.

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

Profile replacement retires the selected old bound refresh grant before new
authorization starts. Revocation failure retains the old record and starts no
new login; reuse the old issuer/client binding for revocation, never the requested
replacement issuer. A cancelled replacement cannot restore a successfully retired
grant. Unbound legacy refresh records require explicit dashboard revocation/local
logout instead of silently overwriting an unrevocable token.

CLI profile operations acquire a separate .profile-<name>.lock before reads,
authorization, refresh and writes. Never nest the existing authority/file locks
around their own public read/save methods. Profile locks contain no credentials,
use bounded exclusive mkdir contention and release in finally; Windows tokens
remain native-only. Invalid OAuth scope syntax fails before locking/storage or
revocation. Failed new-credential persistence attempts grant revocation; combined
storage/revocation failure is explicit and requires dashboard cleanup, never a
successful login or secret-bearing diagnostic. Multi-process synthetic CLI tests
verify that every displaced login grant is retired.
