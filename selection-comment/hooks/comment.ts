import type { PromptDecoration, SessionMessage, ToolUseSummary } from 'claude-code'

import type { Stored, View } from '../types'

const SOURCE_CHARS = 60
const QUOTE_MAX_LINES = 20
// Longer selections carry their own context.
const CONTEXT_MAX_LINES = 5
// The tool input that best names a call, in order of preference.
const SOURCE_KEYS = ['file_path', 'command', 'path', 'pattern', 'url', 'description']

export type Comment = Stored & { note: string }

export type Origin = { source?: string; context?: string }

function quoteOf(text: string): string {
  const lines = text.split('\n')

  return lines.length > QUOTE_MAX_LINES
    ? [...lines.slice(0, QUOTE_MAX_LINES), `[… ${lines.length - QUOTE_MAX_LINES} more lines]`].join('\n')
    : text
}

export function formatComment(comment: Comment): string {
  const quote = quoteOf(comment.text)
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

export function flat(text: string, max: number): string {
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

const TOKEN_QUOTE_CHARS = 40
const NOTE_MARK = ' → '
// A token sits on a line of its own: `[C1 · source: "quote…" → note]`.
const TOKEN = /^\[(C\d+)[ :][^\n]*\]$/gm
const BLOCK = /<comment id="(C\d+)"[^>\n]*>\n[\s\S]*?\n<\/comment>/g

// Keeps the token's own marks out of what it shows.
function clean(text: string): string {
  return text.replace(/\[/g, '(').replace(/\]/g, ')').replace(/→/g, '->').replace(/"/g, "'")
}

export function tokenFor(comment: Comment): string {
  const head = clean([comment.id, comment.source].filter(Boolean).join(' · '))
  const note = flat(comment.note, Infinity)

  return `[${head}: "${clean(flat(comment.text, TOKEN_QUOTE_CHARS))}"${note ? `${NOTE_MARK}${note}` : ''}]`
}

// The note is everything after the first arrow, up to the closing bracket, so
// the person may type anything there, brackets included.
function noteOf(token: string): string {
  const at = token.indexOf(NOTE_MARK)

  return at < 0 ? '' : token.slice(at + NOTE_MARK.length, -1).trim()
}

/** Each token of a known comment, replaced by its full block. */
export function expandDraft(text: string, comments: Record<string, Stored>): string {
  return text.replace(TOKEN, (token, id: string) => {
    const stored = comments[id]
    return stored ? formatComment({ ...stored, note: noteOf(token) }).trimEnd() : token
  })
}

function parseBlock(block: string, stored: Stored): Comment | undefined {
  const quote = /<quote>\n([\s\S]*?)\n<\/quote>/.exec(block)?.[1]
  if (quote === undefined) {
    return undefined
  }

  return {
    id: stored.id,
    // A cut quote stands for the whole one while it is left as it was.
    text: quote === quoteOf(stored.text) ? stored.text : quote,
    source: /^<comment [^>\n]*source="([^"]*)"/.exec(block)?.[1],
    context: /<context>\n([\s\S]*?)\n<\/context>/.exec(block)?.[1],
    note: /<note>([\s\S]*?)<\/note>/.exec(block)?.[1]?.trim() ?? '',
  }
}

/**
 * Each full block of a known comment, read back with the person's edits and
 * replaced by its token; a block too mangled to read stays as it is.
 */
export function collapseDraft(
  text: string,
  comments: Record<string, Stored>,
): { text: string; comments: Record<string, Stored> } {
  const next = { ...comments }
  const collapsed = text.replace(BLOCK, (block, id: string) => {
    const stored = comments[id]
    const comment = stored && parseBlock(block, stored)
    if (!comment) {
      return block
    }
    const { note: _, ...rest } = comment
    next[id] = rest
    return tokenFor(comment)
  })

  return { text: collapsed, comments: next }
}

function known(text: string, pattern: RegExp, comments: Record<string, Stored>): RegExpMatchArray[] {
  return [...text.matchAll(pattern)].filter(match => comments[match[1]!] !== undefined)
}

/** What the draft shows of the comments; tokens win when it holds both. */
export function viewOf(text: string, comments: Record<string, Stored>): View {
  if (known(text, TOKEN, comments).length > 0) {
    return 'tokens'
  }

  return known(text, BLOCK, comments).length > 0 ? 'blocks' : null
}

/** A run painting each token of a known comment as a chip. */
export function tokenRuns(text: string, comments: Record<string, Stored>): PromptDecoration[] {
  return known(text, TOKEN, comments).map(match => ({
    start: match.index!,
    end: match.index! + match[0].length,
    color: 'suggestion',
  }))
}
