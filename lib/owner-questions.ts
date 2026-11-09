// Owner questions (migration 0073, /admin/owner-questions). Pure.
//
// Replaces the handoff spreadsheet's QuickBooks-fix, pack and
// photo-proofread tabs. The owner answers on the screen; "Send to Name
// review" turns an answer into a pending rename (name_review_items), which
// then goes through Name review's audited rename (and its pack-spec guard).

export const OWNER_KINDS = [
  'QuickBooks fix',
  'Pack question',
  'Wrong or mismatched photo',
  'Pack layout',
  'Packs per case',
  'Size',
  'Name typo',
  'Name vs photo',
  'OK to show?',
] as const

export type OwnerQuestionAction =
  | { id: string; action: 'answer'; answer: string }
  | { id: string; action: 'done' }
  | { id: string; action: 'reopen' }
  | { id: string; action: 'rename'; name: string }

export const MAX_ANSWER = 2000

export function parseOwnerQuestionBody(body: unknown): OwnerQuestionAction | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request' }
  const b = body as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!id) return { error: 'Missing id' }
  switch (b.action) {
    case 'answer': {
      const answer = typeof b.answer === 'string' ? b.answer.trim() : ''
      if (!answer) return { error: 'Type an answer first.' }
      if (answer.length > MAX_ANSWER) return { error: `Keep the answer under ${MAX_ANSWER} characters.` }
      return { id, action: 'answer', answer }
    }
    case 'done':
    case 'reopen':
      return { id, action: b.action }
    case 'rename': {
      const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : ''
      if (!name) return { error: 'Type the new product name.' }
      if (name.length > 200) return { error: 'Keep the name under 200 characters.' }
      return { id, action: 'rename', name }
    }
    default:
      return { error: 'Action must be answer, done, reopen or rename' }
  }
}

/** Kinds whose answer is often a new name, so the screen offers "Send to Name review". */
export function offersRename(kind: string): boolean {
  return kind === 'Name typo' || kind === 'Name vs photo' || kind === 'Wrong or mismatched photo'
}
