/**
 * Content Hub data model and JSON file persistence.
 *
 * Project state is stored under `<workingDirectory>/content-hub/projects/` with
 * no external database. The atom library (`atoms.json`) is the single source of
 * truth that every draft references by `atom_id`.
 * @module store
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** The six reusable content-atom kinds. */
export const ATOM_TYPES = ['claim', 'evidence', 'story', 'step', 'quote', 'question'] as const
export type AtomType = (typeof ATOM_TYPES)[number]

/** Source traceability for one atom. */
export type Confidence = 'high' | 'medium' | 'low'

/** The five media forms an atom may be well-suited for. */
export const MEDIUM_KEYS = ['article', 'podcast', 'short_video', 'card', 'newsletter'] as const
export type MediumKey = (typeof MEDIUM_KEYS)[number]

/** Cross-medium suitability scores in [0, 1]. */
export interface MediumAffinity {
  article: number
  podcast: number
  short_video: number
  card: number
  newsletter: number
}

/** One extracted content atom. */
export interface Atom {
  atom_id: string
  type: AtomType
  content: string
  source_ref: string
  confidence: Confidence
  medium_affinity: MediumAffinity
}

/** One detected section/paragraph in an ingested source. */
export interface StructureItem {
  ref: string
  kind: string
  snippet: string
}

/** Persisted project metadata and ingested source. */
export interface ProjectRecord {
  project_id: string
  project_name: string
  source_type: 'text' | 'url' | 'file'
  source_text: string
  source_summary: string
  detected_structure: StructureItem[]
  stage: string
  created_at: string
}

/** One atom as selected and phrased inside a single draft. */
export interface SelectedAtom {
  atom_id: string
  role_in_medium: string
  content: string
}

/** One orchestrated section of an adapted draft. */
export interface StructureSection {
  section_label: string
  atom_ids: string[]
  transition_instruction: string
}

/** An adapted draft for one medium. */
export interface Draft {
  draft_id: string
  project_id: string
  medium: string
  tone?: string
  length_target?: string
  selected_atoms: SelectedAtom[]
  structure: StructureSection[]
  adaptation_notes: string[]
  rendered_text: string
}

/** One cross-channel fact that must stay consistent. */
export interface SharedFact {
  fact: string
  atom_id: string
  used_in: string[]
}

/** One atom × media reuse row. */
export interface ReuseRow {
  atom_id: string
  mediums: string[]
}

/** One deliverable in a channel pack. */
export interface Deliverable {
  medium: string
  draft_id: string
  format: string
}

/** An assembled channel pack. */
export interface Pack {
  pack_id: string
  project_id: string
  pack_name: string
  shared_facts: SharedFact[]
  reuse_matrix: { rows: ReuseRow[] }
  consistency_warnings: string[]
  deliverables: Deliverable[]
}

/** Per-type atom counts reported by get_project_state. */
export interface AtomStats {
  total: number
  by_type: Record<AtomType, number>
}

/** Absolute directory holding all projects for one workspace. */
export function projectsRoot(cwd: string): string {
  return path.join(cwd, 'content-hub', 'projects')
}

/** Absolute directory holding one project's files. */
export function projectDir(cwd: string, projectId: string): string {
  return path.join(projectsRoot(cwd), projectId)
}

/** Read and parse a JSON file, or return undefined when it is absent. */
export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Write a JSON file atomically enough for single-process tool execution. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(temp, file)
}

/** A fresh opaque id scoped to the `ch-` prefix. */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}
