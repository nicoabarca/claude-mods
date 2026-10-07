# claude-mods

Claude Code mods (function-hook plugins). This repository is a plugin marketplace.

| Mod | What it does |
| --- | --- |
| [selection-comment](./selection-comment) | Highlight transcript text, add a comment, and drop both into the prompt box |

## Install a mod

```
/plugin install <mod> --marketplace nicoabarca/claude-mods
```

Or, from a local clone:

```
claude plugin marketplace add ~/billion-projects/claude-mods
claude plugin install selection-comment@claude-mods
```
