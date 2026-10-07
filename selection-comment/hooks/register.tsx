import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Pending } from '../types'

const pending = atom({ plugin: 'selection-comment', key: 'pending' } as const, null)

const POLL_MS = 300
const PREVIEW_CHARS = 60
const INPUT_KEY = 'comment-input'

export function formatComment(selected: string, comment: string): string {
  const quoted = selected
    .split('\n')
    .map(line => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')

  return comment.trim().length > 0 ? `${quoted}\n\n${comment.trim()}\n` : `${quoted}\n`
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat
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

        const text = (await $.ui.selection())?.text.trim()
        if (!text || text === handled) {
          if (current) {
            await update($, pending, () => null)
          }
          return
        }

        if (current?.text !== text) {
          await update($, pending, (): Pending => ({ text, isEditing: false }))
        }
      })()
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, pending, () => null).catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    bandId = e.requestId
    const current = await read($, pending)

    // Mobile draws no Input yet, so the band stays the engine's there.
    if (e.props.hasSurvey || current === null || e.surface === 'mobile') {
      return next(e)
    }

    const { Box, Button, Input, Text } = $.ui.resolve(e)

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
            label="Comment"
            onPress={async () => {
              await update($, pending, (): Pending => ({ ...current, isEditing: true }))
              if (bandId) {
                void $.ui.focus({ requestId: bandId, key: INPUT_KEY }).catch(() => undefined)
              }
            }}
          />
          <Text> </Text>
          <Button key="dismiss" label="Dismiss" onPress={dismiss} />
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
            Comment:{' '}
          </Text>
          <Input
            key={INPUT_KEY}
            placeholder="type a comment, Enter to add to prompt"
            submitLabel="add"
            autoFocus
            onSubmit={async (value: string) => {
              const box = await $.prompt.read()
              const block = formatComment(current.text, value)
              const text = box.text.trim().length > 0 ? `\n${block}` : block
              await $.prompt.fill({ text, mode: 'append' })
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
