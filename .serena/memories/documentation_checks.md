# Offline documentation contracts

`npm run check:docs` checks tracked root/public docs Markdown through Marked GFM.
It verifies local link/image file targets, valid JSON fences and documented npm
script names against package.json. Actual nested/reference destinations are used;
code and unused definitions are not mistaken for live links. No links are fetched
and no examples are executed. Public Markdown is bounded to1MiB per regular
in-repository file; symlinks and escaping paths fail closed.

This is not external availability, fragment-anchor, full JSON-schema or arbitrary
shell/CLI semantic verification. Installed CLI/MCP contract tests remain required.
The existing full check runs it in PR CI and the six-platform release matrix.

Fence language is the normalized first info-string word, so metadata cannot
skip checks. Pinned shell-quote1.10.0 tokenizes complete literal npm script operands
(including quotes/punctuation); variable expansion gets a rejected sentinel, never
process.env. Nonliteral names or options before the name fail this static gate;
use a directly named package script in checked examples. No shell is launched.

The pinned shell-quote parser discards newlines and comments consume its remaining
input, so a quote/escape-aware preprocessing pass splits unquoted physical lines
before parsing. Preserve quoted newlines and join escaped continuations; comments
end at the physical line. Redirection operators consume a target, not the script
operand; continue to the next operand before accepting bare npm run. Unquoted
numeric descriptor prefixes immediately adjacent to a redirect are removed before
tokenization, but quoted/escaped numbers and whitespace-separated numeric script
names remain operands. Never infer descriptors from dequoted words. Regression
coverage includes poisoned scripts behind redirects, multiline bare commands,
comments, quoting, continuation, and malformed/missing redirect targets. This is
still an offline static subset, not an execution engine or full shell grammar.

Bash combined output redirects &> and &>> are normalized only in explicit bash
fences before shell-quote; sh/shell/console, unlabelled fences and inline snippets
retain the background-command boundary rather than assume Bash. The parser
otherwise splits their ampersand into a command boundary. Only adjacent
unquoted/unescaped syntax is normalized; quoted/escaped ampersands, whitespace
separation and && retain their original meaning for command-position detection.

Match npm run only at shell command positions (start or after command operators),
not as arguments to echo/printf/other scripts or ordinary Usage output. Prefix
redirection targets do not consume the command position. Console fences support
the explicit dollar-space prompt; quoted dollar text is not a prompt. Environment
assignments, wrappers and arbitrary prompt formats are outside this direct-command
static subset; use direct literal invocations for checked examples.
