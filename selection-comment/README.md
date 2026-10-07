# selection-comment

Highlight text in the Claude Code transcript, add a comment, and both land in your prompt box as a tagged block with an id, where the text came from, and the lines around it.

1. Highlight output text (fullscreen mode must be on).
2. A bar appears above the prompt with the selection preview and a **Comment as C1** button.
3. Click it, type, press Enter. The prompt box gets:

   ```
   <comment id="C1" source="assistant · turn 4">
   <quote>
   highlighted text
   </quote>
   <context>
   the line before
   [SELECTION]
   the line after
   </context>
   <note>your comment</note>
   </comment>
   ```

Repeat to stack several comments, then send the prompt yourself. Ids count up through the session, so you can write "do C1, skip C2".

- `source` names the tool call when the text is in a tool row (`Bash · npm test · turn 4`, `Edit · src/foo.ts · turn 2`), else the message that holds it. Left out when the text is not found.
- `<context>` is the nearest line before and after; left out for selections over 5 lines.
- Quotes over 20 lines are cut, with a `[… N more lines]` marker.
- An empty comment leaves out `<note>`, so the block is a plain highlight.

## Install

```
/plugin install selection-comment --marketplace nicoabarca/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Limits

- The bar sits above the prompt, not next to the highlighted text: the plugin API gives the selected text, not its position.
- Selecting the exact same text again does not reopen the bar; select something else.
- Not on mobile, which has no text field yet.
