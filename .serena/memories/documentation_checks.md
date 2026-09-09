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
