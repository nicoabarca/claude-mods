# selection-comment

Highlight text in the Claude Code transcript, add a comment, and a short token lands in your prompt box. When you send, Claude gets the full comment: an id, where the text came from, the lines around it, and your note.

1. Highlight output text (fullscreen mode must be on).
2. A bar appears above the prompt with the selection preview and a **Comment as C1** button.
3. Click it, type, press Enter. The prompt box gets one line:

   ```
   [C1 · assistant · turn 4: "highlighted text" → your comment]
   ```

4. Send the prompt. Claude reads the token as:

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

Repeat to stack several comments. Ids count up through the session, so you can write "do C1, skip C2".

Editing a comment:

- **The note:** edit the text after `→` right in the token. Whatever is there when you send is the note.
- **Anything else:** press **Expand comments** in the bar to turn every token into its full block, edit the quote, context, source or note, then press **Collapse comments**. Your edits are kept. Blocks you leave expanded are sent as they are.

- `source` names the tool call when the text is in a tool row (`Bash · npm test · turn 4`, `Edit · src/foo.ts · turn 2`), else the message that holds it. Left out when the text is not found.
- `<context>` is the nearest line before and after; left out for selections over 5 lines.
- Quotes over 20 lines are cut, with a `[… N more lines]` marker.
- An empty comment leaves out `<note>`, so the block is a plain highlight.
- A token must stay on its own line, starting `[C1` and ending `]`. One you break is sent as typed. Same for a block whose `<quote>` tags you remove: collapse leaves it as it is.

## Install

```
/plugin install selection-comment --marketplace nicoabarca/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Limits

- The bar sits above the prompt, not next to the highlighted text: the plugin API gives the selected text, not its position.
- Selecting the exact same text again does not reopen the bar; select something else.
- Not on mobile, which has no text field yet.
