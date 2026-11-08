/**
 * Medium-orchestration templates: load declarative YAML templates and assemble
 * a deterministic selection of atoms into a draft following each medium's
 * narrative grammar.
 * @module mediums
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATOM_TYPES, MEDIUM_KEYS } from './store.js'
import type { Atom, AtomType, MediumKey, SelectedAtom, StructureSection } from './store.js'

/** Directory holding `article.yml` and `short_video.yml`. */
const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url))

/** One orchestration section declared by a medium template. */
export interface MediumTemplateSection {
  label: string
  duration_seconds?: string
  max_atoms?: number
  priority?: number
  atom_preference: AtomType[]
  rule: string
}

/** A medium's full declarative narrative grammar. */
export interface MediumTemplate {
  medium: string
  label: string
  sections: MediumTemplateSection[]
}

/** Media with an authored orchestration template. */
export const SUPPORTED_MEDIA: readonly string[] = ['article', 'short_video', 'card_series', 'podcast_script']

/** Strip a trailing `# comment` outside of an inline list or quotes. */
function stripComment(line: string): string {
  const hash = line.indexOf('#')
  return hash >= 0 ? line.slice(0, hash) : line
}

/** Parse `[a, b, c]` into a string list. */
function parseInlineArray(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (inner === '') return []
  return inner.split(',').map((item) => item.trim().replace(/^['"]/, '').replace(/['"]$/, ''))
}

/** Strip one pair of surrounding quotes, when present. */
function unquote(value: string): string {
  const v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
  return v
}

/**
 * Parse the constrained YAML subset used by the medium templates: top-level
 * scalars, a `sections:` list of `- key: value` objects, and inline arrays.
 */
export function parseMediumTemplate(text: string): MediumTemplate {
  const template: MediumTemplate = { medium: '', label: '', sections: [] }
  let current: MediumTemplateSection | null = null
  for (const raw of text.split('\n')) {
    const line = stripComment(raw)
    if (line.trim() === '') continue
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    const content = line.trim()
    if (indent === 0) {
      const match = content.match(/^([\w-]+):\s*(.*)$/)
      if (match === null) continue
      if (match[1] === 'medium') template.medium = match[2] ?? ''
      else if (match[1] === 'label') template.label = match[2] ?? ''
    } else if (content.startsWith('- ')) {
      const match = content.slice(2).trim().match(/^([\w-]+):\s*(.*)$/)
      if (match === null) continue
      if (match[1] === 'label') {
        current = { label: match[2] ?? '', atom_preference: [], rule: '' }
        template.sections.push(current)
      }
    } else if (current !== null) {
      const match = content.match(/^([\w-]+):\s*(.*)$/)
      if (match === null) continue
      if (match[1] === 'duration_seconds' && match[2] !== undefined) current.duration_seconds = match[2]
      else if (match[1] === 'atom_preference') {
        current.atom_preference = parseInlineArray(match[2] ?? '').filter(
          (t): t is AtomType => (ATOM_TYPES as readonly string[]).includes(t),
        )
      } else if (match[1] === 'rule') current.rule = unquote(match[2] ?? '')
      else if (match[1] === 'max_atoms') {
        const n = Number.parseInt(match[2] ?? '', 10)
        if (!Number.isNaN(n) && n > 0) current.max_atoms = n
      } else if (match[1] === 'priority') {
        const n = Number.parseInt(match[2] ?? '', 10)
        if (!Number.isNaN(n)) current.priority = n
      }
    }
  }
  return template
}

/** Load the authored YAML template for one supported medium. */
export function loadTemplate(medium: string): MediumTemplate {
  if (!SUPPORTED_MEDIA.includes(medium)) {
    throw new Error(`unsupported medium "${medium}"; supported: ${SUPPORTED_MEDIA.join(', ')}`)
  }
  const file = path.join(TEMPLATES_DIR, `${medium}.yml`)
  return parseMediumTemplate(readFileSync(file, 'utf8'))
}

/** Read one atom's suitability score for a medium, defaulting to 0. */
function affinityFor(atom: Atom, medium: string): number {
  if ((MEDIUM_KEYS as readonly string[]).includes(medium)) {
    return atom.medium_affinity[medium as MediumKey]
  }
  return 0
}

/** A short excerpt for adaptation notes. */
function excerpt(text: string, max = 42): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/** The assembled draft content produced by one orchestration. */
export interface Orchestration {
  structure: StructureSection[]
  selected_atoms: SelectedAtom[]
  adaptation_notes: string[]
  rendered_text: string
}

/**
 * Select atoms per template section and render a deterministic draft. Sections
 * with a higher `priority` claim their preferred atoms first (e.g. a thesis
 * takes the claim before the lede falls back), while the output structure keeps
 * template order. Each section takes up to its `max_atoms` (default 1),
 * preferring its atom types in order and ranking candidates by medium affinity,
 * so a dense data walk picks a representative subset instead of dumping every
 * data point.
 * @param template - the medium's declarative grammar.
 * @param atoms - the project's atom library.
 * @param medium - the target medium.
 * @param tone - optional tone preference, recorded as an adaptation note.
 * @param lengthTarget - optional length target, recorded as an adaptation note.
 */
export function orchestrate(
  template: MediumTemplate,
  atoms: readonly Atom[],
  medium: string,
  tone: string | undefined,
  lengthTarget: string | undefined,
): Orchestration {
  const used = new Set<string>()
  const structure: StructureSection[] = []
  const selected_atoms: SelectedAtom[] = []
  const adaptation_notes: string[] = []

  // Allocate in priority order (higher first), keeping template order for output.
  const order = template.sections
    .map((section, index) => ({ section, index, priority: section.priority ?? 0 }))
    .sort((a, b) => b.priority - a.priority)

  const chosenByIndex = new Map<number, Atom[]>()
  for (const { section, index } of order) {
    const max = section.max_atoms ?? 1
    const chosen: Atom[] = []
    for (const preference of section.atom_preference) {
      if (chosen.length >= max) break
      const candidates = atoms
        .filter((atom) => atom.type === preference && !used.has(atom.atom_id))
        .sort((a, b) => affinityFor(b, medium) - affinityFor(a, medium))
      for (const candidate of candidates) {
        if (chosen.length >= max) break
        used.add(candidate.atom_id)
        chosen.push(candidate)
      }
    }
    chosenByIndex.set(index, chosen)
  }

  for (let i = 0; i < template.sections.length; i++) {
    const section = template.sections[i]!
    const chosen = chosenByIndex.get(i) ?? []
    structure.push({
      section_label: section.label,
      atom_ids: chosen.map((atom) => atom.atom_id),
      transition_instruction: section.rule,
    })
    for (const atom of chosen) {
      selected_atoms.push({ atom_id: atom.atom_id, role_in_medium: section.label, content: atom.content })
      adaptation_notes.push(
        `${atom.type}「${excerpt(atom.content)}」在 ${medium} 中作为 ${section.label} 段`,
      )
    }
  }

  if (tone !== undefined && tone !== '') adaptation_notes.push(`语气偏好：${tone}`)
  if (lengthTarget !== undefined && lengthTarget !== '') adaptation_notes.push(`篇幅目标：${lengthTarget}`)

  const parts: string[] = []
  structure.forEach((section, index) => {
    const source = template.sections[index]
    const heading = source !== undefined && source.duration_seconds !== undefined && medium === 'short_video'
      ? `【${source.duration_seconds}s ${section.section_label}】`
      : `【${section.section_label}】`
    parts.push(heading)
    for (const id of section.atom_ids) {
      const atom = atoms.find((candidate) => candidate.atom_id === id)
      if (atom !== undefined) parts.push(atom.content)
    }
  })

  return { structure, selected_atoms, adaptation_notes, rendered_text: parts.join('\n\n') }
}
