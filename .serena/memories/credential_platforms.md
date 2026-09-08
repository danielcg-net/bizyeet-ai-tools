# Credential platform boundaries

Prefer the native OAuth credential manager. POSIX headless fallback uses
owner-only mode checks. Windows chmod does not distinguish owner/group/others;
refuse plaintext fallback rather than pretending0600 is protection. Missing
fallback cleanup must be a no-op, especially after successful native storage.

Installed package tests use unique synthetic profiles. Windows fixtures use
the native credential manager and remove their entries afterward; POSIX fixtures
exercise the permission-checked file path. Never seed a real user's profile.

Launch npm via process.execPath plus npm_execpath, and installed commands via
offline npm exec, not direct spawn of Windows cmd files. When constructing a
child environment, consolidate PATH/Path casing so the system search path is
retained. Release verification streams full test output so late failures are
not truncated inside an execFile error's stdout property.
