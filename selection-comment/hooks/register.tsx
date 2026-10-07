import { atom, read, update } from 'claude-code'
import type { Register, SessionMessage, ToolUseSummary } from 'claude-code'

import type { Pending } from '../types'

const pending = atom({ plugin: 'selection-comment', key: 'pending' } as const, null)
// Comments added this session, so each one gets the next id.
const count = atom({ plugin: 'selection-comment', key: 'count' } as const, 0)

const POLL_MS = 300
const PREVIEW_CHARS = 60
const SOURCE_CHARS = 60
const QUOTE_MAX_LINES = 20
// Longer selections carry their own context.
const CONTEXT_MAX_LINES = 5
const INPUT_KEY = 'comment-input'
// The tool input that best names a call, in order of preference.
const SOURCE_KEYS = ['file_path', 'command', 'path', 'pattern', 'url', 'description']

export type Comment = {
  id: string
  text: string
  note: string
  source?: string
  context?: string
}

export type Origin = { source?: string; context?: string }

export function formatComment(comment: Comment): string {
  const lines = comment.text.split('\n')
  const quote =
    lines.length > QUOTE_MAX_LINES
      ? [...lines.slice(0, QUOTE_MAX_LINES), `[… ${lines.length - QUOTE_MAX_LINES} more lines]`].join('\n')
      : comment.text
  const source = comment.source ? ` source="${comment.source.replace(/"/g, "'")}"` : ''
  const parts = [`<comment id="${comment.id}"${source}>`, '<quote>', quote, '</quote>']

  if (comment.context) {
    parts.push('<context>', comment.context, '</context>')
  }
  const note = comment.note.trim()
  if (note.length > 0) {
    parts.push(`<note>${note}</note>`)
  }
  parts.push('</comment>')

  return `${parts.join('\n')}\n`
}

// The screen shows rendered markdown, so compare without its markers and
// without the wrapping.
function normalize(text: string): string {
  return text.replace(/[*`_#>]/g, '').replace(/\s+/g, ' ').trim()
}

function locate(lines: string[], selected: string[]): { start: number; end: number } | undefined {
  const first = normalize(selected[0] ?? '')
  const last = normalize(selected.at(-1) ?? '')
  if (normalize(selected.join(' ')).length < 3 || first.length === 0 || last.length === 0) {
    return undefined
  }

  for (let start = 0; start < lines.length; start++) {
    if (!normalize(lines[start]!).includes(first)) {
      continue
    }
    // Rendering can split or join lines, so allow some slack for the end.
    const limit = Math.min(lines.length, start + selected.length * 2 + 5)
    for (let end = start; end < limit; end++) {
      if (normalize(lines[end]!).includes(last)) {
        return { start, end }
      }
    }
  }

  return undefined
}

function surround(lines: string[], hit: { start: number; end: number }, selectedLines: number): string | undefined {
  if (selectedLines > CONTEXT_MAX_LINES) {
    return undefined
  }
  const before = lines
    .slice(0, hit.start)
    .reverse()
    .find(line => line.trim().length > 0)
  const after = lines.slice(hit.end + 1).find(line => line.trim().length > 0)
  if (before === undefined && after === undefined) {
    return undefined
  }

  return [before?.trim(), '[SELECTION]', after?.trim()].filter(line => line !== undefined).join('\n')
}

function flat(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max)}…` : line
}

function toolLabel(use: ToolUseSummary): string {
  const key = SOURCE_KEYS.find(k => typeof use.input[k] === 'string' && (use.input[k] as string).trim().length > 0)

  return key ? `${use.tool} · ${flat(use.input[key] as string, SOURCE_CHARS)}` : use.tool
}

function toolLines(use: ToolUseSummary): string[] {
  const inputs = Object.values(use.input).filter((v): v is string => typeof v === 'string')

  return [...inputs, use.text ?? ''].flatMap(text => text.split('\n'))
}

// A turn opens with each prompt the person typed; tool results ride on user
// messages too but open none.
function turnNumbers(messages: readonly SessionMessage[]): number[] {
  let turn = 0

  return messages.map(message => {
    if (message.role === 'user' && !message.toolResults?.length && message.text.trim().length > 0) {
      turn++
    }
    return Math.max(turn, 1)
  })
}

/**
 * Where the selection came from: the tool call its row belongs to, or else
 * the newest message or tool output holding it, plus the lines around it.
 */
export function findOrigin(messages: readonly SessionMessage[], text: string, requestId?: string): Origin {
  const selected = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
  const turns = turnNumbers(messages)
  const match = (lines: string[], source: string): Origin | undefined => {
    const hit = locate(lines, selected)
    return hit ? { source, context: surround(lines, hit, selected.length) } : undefined
  }

  if (requestId) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const use = messages[i]!.toolUses.find(u => u.tool_use_id === requestId)
      if (use) {
        const source = `${toolLabel(use)} · turn ${turns[i]}`
        return match(toolLines(use), source) ?? { source }
      }
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    const found =
      match(message.text.split('\n'), `${message.role} · turn ${turns[i]}`) ??
      message.toolUses.map(use => match(toolLines(use), `${toolLabel(use)} · turn ${turns[i]}`)).find(Boolean)
    if (found) {
      return found
    }
  }

  return {}
}

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
    const nextId = `C${(await read($, count)) + 1}`

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
              const origin = findOrigin(messages, current.text, current.requestId)
              const box = await $.prompt.read()
              const block = formatComment({ id: `C${n}`, text: current.text, note: value, ...origin })
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
