# selection-comment

Highlight text in the Claude Code transcript, add a comment, and both land in your prompt box as a quote plus your note.

1. Highlight output text (fullscreen mode must be on).
2. A bar appears above the prompt with the selection preview and a **Comment** button.
3. Click **Comment**, type, press Enter. The prompt box gets:

   ```
   > highlighted text

   your comment
   ```

Repeat to stack several comments, then send the prompt yourself.

## Install

```
/plugin install selection-comment --marketplace nicoabarca/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Limits

- The bar sits above the prompt, not next to the highlighted text: the plugin API gives the selected text, not its position.
- Selecting the exact same text again does not reopen the bar; select something else.
- Not on mobile, which has no text field yet.
