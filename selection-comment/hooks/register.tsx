import { atom, read, update } from 'claude-code'
import type { Register, SessionMessage } from 'claude-code'

import type { Pending, Stored, View } from '../types'
import { collapseDraft, expandDraft, findOrigin, flat, tokenFor, tokenRuns, viewOf } from './comment'

const pending = atom({ plugin: 'selection-comment', key: 'pending' } as const, null)
// Comments added this session, so each one gets the next id.
const count = atom({ plugin: 'selection-comment', key: 'count' } as const, 0)
// What each token in the draft stands for, by id.
const comments = atom({ plugin: 'selection-comment', key: 'comments' } as const, {})
const view = atom({ plugin: 'selection-comment', key: 'view' } as const, null)

const POLL_MS = 300
const PREVIEW_CHARS = 60
const INPUT_KEY = 'comment-input'

function preview(text: string): string {
  return flat(text, PREVIEW_CHARS)
}

export const register: Register = on => {
  // The last selection the person commented on or dismissed, so the band
  // stays down until they select something else.
  let handled: string | undefined
  let bandId: string | undefined

  on('session.start', async ($, e, next) => {
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const current = await read($, pending)
        if (current?.isEditing) {
          return
        }

        const selection = await $.ui.selection()
        const text = selection?.text.trim()
        if (!text || text === handled) {
          if (current) {
            await update($, pending, () => null)
          }
          return
        }

        if (current?.text !== text) {
          await update($, pending, (): Pending => ({ text, requestId: selection?.requestId, isEditing: false }))
        }
      })()
    })

    return next(e)
  })

  // Keeps the tokens painted and the band's toggle in step with the draft.
  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    try {
      const known = await read($, comments)
      if (Object.keys(known).length === 0) {
        return result
      }
      const shown = viewOf(result.text, known)
      if (shown !== (await read($, view))) {
        await update($, view, (): View => shown)
      }
      return { ...result, decorations: [...(result.decorations ?? []), ...tokenRuns(result.text, known)] }
    } catch {
      return result
    }
  })

  // The model reads each token as its full block, with the note as the token
  // has it now.
  on('prompt.submit', async ($, e, next) => {
    let text = e.text
    try {
      text = expandDraft(e.text, await read($, comments))
      await update($, pending, () => null)
      await update($, view, (): View => null)
    } catch {
      // Sent as typed.
    }

    return next(text === e.text ? e : { ...e, text })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    bandId = e.requestId
    const current = await read($, pending)
    const shown = await read($, view)

    // Mobile draws no Input yet, so the band stays the engine's there.
    if (e.props.hasSurvey || (current === null && shown === null) || e.surface === 'mobile') {
      return next(e)
    }

    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const nextId = `C${(await read($, count)) + 1}`

    const toggle = async () => {
      const box = await $.prompt.read()
      const known = await read($, comments)
      if (shown === 'tokens') {
        const text = expandDraft(box.text, known)
        await $.prompt.fill({ text, mode: 'replace' })
        await update($, view, (): View => viewOf(text, known))
        return
      }
      const collapsed = collapseDraft(box.text, known)
      await update($, comments, () => collapsed.comments)
      await $.prompt.fill({ text: collapsed.text, mode: 'replace', decorations: tokenRuns(collapsed.text, collapsed.comments) })
      await update($, view, (): View => viewOf(collapsed.text, collapsed.comments))
    }

    const toggleButton =
      shown === null ? null : (
        <Button key="toggle" label={shown === 'tokens' ? 'Expand comments' : 'Collapse comments'} onPress={toggle} />
      )

    if (current === null) {
      return <Box>{toggleButton}</Box>
    }

    const dismiss = async () => {
      handled = current.text
      await update($, pending, () => null)
    }

    if (!current.isEditing) {
      return (
        <Box>
          <Text color="claude" bold>
            “{preview(current.text)}”{' '}
          </Text>
          <Button
            key="comment"
            label={`Comment as ${nextId}`}
            onPress={async () => {
              await update($, pending, (): Pending => ({ ...current, isEditing: true }))
              if (bandId) {
                void $.ui.focus({ requestId: bandId, key: INPUT_KEY }).catch(() => undefined)
              }
            }}
          />
          <Text> </Text>
          <Button key="dismiss" label="Dismiss" onPress={dismiss} />
          {toggleButton && <Text> </Text>}
          {toggleButton}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text color="claude" bold>
          “{preview(current.text)}”
        </Text>
        <Box borderStyle="round" borderColor="suggestion" paddingX={1}>
          <Text color="suggestion" bold>
            {nextId}:{' '}
          </Text>
          <Input
            key={INPUT_KEY}
            placeholder="type a comment, Enter to add to prompt"
            submitLabel="add"
            autoFocus
            onSubmit={async (value: string) => {
              let n = 0
              await update($, count, c => (n = c + 1))
              const found = await $.session.messages().catch(() => [])
              const messages = Array.isArray(found) ? (found as SessionMessage[]) : []
              const stored: Stored = { id: `C${n}`, text: current.text, ...findOrigin(messages, current.text, current.requestId) }
              await update($, comments, known => ({ ...known, [stored.id]: stored }))

              // A token holds a line of its own, so it reads back whole.
              const box = await $.prompt.read()
              const prefix = box.text.length > 0 && !box.text.endsWith('\n') ? '\n' : ''
              const token = tokenFor({ ...stored, note: value })
              await $.prompt.fill({
                text: `${prefix}${token}\n`,
                mode: 'append',
                decorations: [{ start: prefix.length, end: prefix.length + token.length, color: 'suggestion' }],
              })
              await update($, view, (): View => 'tokens')
              await dismiss()
            }}
          />
          <Text> </Text>
          <Button key="cancel" label="Cancel" onPress={dismiss} />
        </Box>
      </Box>
    )
  })
}
