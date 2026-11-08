/**
 * Content Hub: register five model-facing tools over a JSON-persisted project
 * store. Ingest a source, extract six types of content atoms, adapt them per
 * medium (article / short video), assemble a channel pack with consistency
 * warnings, and query project state.
 * @module content-hub
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ALL_ATOM_TYPES, detectStructure, extractAtoms, summarize } from './atoms.js'
import { loadTemplate, orchestrate } from './mediums.js'
import { assemblePack } from './pack.js'
import { newId, projectDir, readJson, writeJson } from './store.js'
import type { Atom, AtomType, Draft, MediumAffinity, Pack, ProjectRecord } from './store.js'

export const name = 'content-hub'
export const inject = ['tools', 'workingDirectory']

/** The working-directory service, typed locally to avoid a runtime dependency. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    workingDirectory: {
      ensure(agent: unknown, signal?: AbortSignal): Promise<string>
    }
  }
}

const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const

/** Resolve a file path against the session working directory when relative. */
function resolvePath(cwd: string, target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(cwd, target)
}

/** Read the session working directory, requiring an owning agent. */
async function requireCwd(ctx: Context, agent: unknown, signal: AbortSignal): Promise<string> {
  if (agent === undefined) throw new Error('this tool requires an agent session')
  return ctx.workingDirectory.ensure(agent, signal)
}

/** Load one project or throw a clear error. */
async function loadProject(cwd: string, projectId: string): Promise<ProjectRecord> {
  const project = await readJson<ProjectRecord>(path.join(projectDir(cwd, projectId), 'project.json'))
  if (project === undefined) throw new Error(`project ${projectId} not found`)
  return project
}

/** Load one draft or throw a clear error. */
async function loadDraft(cwd: string, projectId: string, draftId: string): Promise<Draft> {
  const draft = await readJson<Draft>(path.join(projectDir(cwd, projectId), 'drafts', `${draftId}.json`))
  if (draft === undefined) throw new Error(`draft ${draftId} not found`)
  return draft
}

/** List draft ids in a project's drafts directory (empty when absent). */
async function listDraftIds(cwd: string, projectId: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(projectDir(cwd, projectId), 'drafts'))
    return entries.filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Persist the current workflow stage onto the project record. */
async function updateStage(cwd: string, projectId: string, stage: string): Promise<void> {
  const project = await loadProject(cwd, projectId)
  project.stage = stage
  await writeJson(path.join(projectDir(cwd, projectId), 'project.json'), project)
}

/** Count atoms per type for get_project_state. */
function countAtoms(atoms: readonly Atom[]): Record<AtomType, number> {
  const counts: Record<AtomType, number> = { claim: 0, evidence: 0, story: 0, step: 0, quote: 0, question: 0 }
  for (const atom of atoms) counts[atom.type] += 1
  return counts
}

/** Suggest the next workflow stage from the project's current stage. */
function nextSteps(stage: string): string[] {
  if (stage === 'ingested') return ['调用 extract_atoms 抽取内容原子']
  if (stage === 'extracted') return ['调用 adapt_for_medium 生成 article 或 short_video 适配稿']
  if (stage === 'adapted') return ['调用 assemble_pack 打包渠道包']
  return []
}

/** Fixed display order for the six atom types. */
const ATOM_TYPE_ORDER: readonly AtomType[] = ['claim', 'evidence', 'story', 'step', 'quote', 'question']

/** Reason shown in the render when one atom type came back empty. */
const EMPTY_REASON: Record<AtomType, string> = {
  claim: '未发现可独立成立的判断',
  evidence: '未发现数据或可核验事实',
  story: '未发现带场景/人物/时间线的叙事片段',
  step: '未发现带编号或序数的操作流程',
  quote: '未发现直接引语或可传播短句',
  question: '未发现显式问句，且未生成引导问题',
}

/** Render one medium-affinity vector as a compact `medium=score` list. */
function formatAffinity(affinity: MediumAffinity): string {
  return `article=${affinity.article}, podcast=${affinity.podcast}, short_video=${affinity.short_video}, card=${affinity.card}, newsletter=${affinity.newsletter}`
}

/**
 * Format the extracted atoms grouped by type, printing every atom's six fields
 * and an explicit `[type] 0 条 — reason` line for any empty type.
 * @param atoms - the canonical extracted atoms.
 */
function formatExtractResult(atoms: readonly Atom[]): string {
  const grouped = new Map<AtomType, Atom[]>()
  for (const type of ATOM_TYPE_ORDER) grouped.set(type, [])
  for (const atom of atoms) {
    const group = grouped.get(atom.type)
    if (group !== undefined) group.push(atom)
  }
  const counts = ATOM_TYPE_ORDER.map((type) => `${type}=${grouped.get(type)!.length}`).join(', ')
  const lines: string[] = [`提取完成：共 ${atoms.length} 条原子（按类型统计：${counts}）`]
  for (const type of ATOM_TYPE_ORDER) {
    const group = grouped.get(type)!
    lines.push('', `[${type}]`)
    if (group.length === 0) {
      lines.push(`${EMPTY_REASON[type]} — 0 条`)
      continue
    }
    for (const atom of group) {
      lines.push(`- atom_id: ${atom.atom_id} | source_ref: ${atom.source_ref} | confidence: ${atom.confidence}`)
      lines.push(`  content: ${atom.content}`)
      lines.push(`  medium_affinity: ${formatAffinity(atom.medium_affinity)}`)
    }
  }
  return lines.join('\n')
}

/**
 * Register the five tools. The plugin has no deployment config, so it injects
 * only `tools` and `workingDirectory`.
 * @param ctx - registrant context carrying the tool and working-directory services.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'ingest_source',
    description: 'Ingest source material (raw text, a URL, or a local file) into a Content Hub project and detect its paragraph/section structure for later atom extraction.',
    parameters: {
      source_type: { type: 'string', required: true, enum: ['text', 'url', 'file'], description: 'How `content` should be read.' },
      content: { type: 'string', required: true, description: 'Raw text, or a URL / absolute file path.' },
      project_name: { type: 'string', required: true, description: 'Human-readable project name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: { type: 'string', required: true },
          source_summary: { type: 'string', required: true },
          detected_structure: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ref: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Ingested project ${value.project_id}: ${value.detected_structure.length} sections.` },
      ],
    },
    async execute(args, exec) {
      const cwd = await requireCwd(ctx, exec.agent, exec.signal)
      let text: string
      if (args.source_type === 'text') {
        text = args.content
      } else if (args.source_type === 'file') {
        text = await readFile(resolvePath(cwd, args.content), 'utf8')
      } else {
        const response = await fetch(args.content, { signal: exec.signal })
        if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status}`)
        text = await response.text()
      }
      const detected_structure = detectStructure(text)
      const source_summary = summarize(text)
      const project_id = newId('prj')
      const record: ProjectRecord = {
        project_id,
        project_name: args.project_name,
        source_type: args.source_type,
        source_text: text,
        source_summary,
        detected_structure,
        stage: 'ingested',
        created_at: new Date().toISOString(),
      }
      await writeJson(path.join(projectDir(cwd, project_id), 'project.json'), record)
      return { project_id, source_summary, detected_structure }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Ingest source',
      kind: 'other',
      rawInput: { project_name: args.project_name, source_type: args.source_type },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'extract_atoms',
    description: 'Extract six types of content atoms (claim, evidence, story, step, quote, question) from an ingested source, each annotated with a source reference, traceability confidence, and cross-medium affinity.',
    parameters: {
      project_id: { type: 'string', required: true, description: 'The project whose source should be atomized.' },
      atom_types: {
        type: 'array',
        items: { type: 'string', enum: [...ALL_ATOM_TYPES] },
        description: 'Atom types to extract; omit to extract all six.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          atoms: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                atom_id: { type: 'string', required: true },
                type: { type: 'string', required: true, enum: [...ALL_ATOM_TYPES] },
                content: { type: 'string', required: true },
                source_ref: { type: 'string', required: true },
                confidence: { type: 'string', required: true, enum: [...CONFIDENCE_VALUES] },
                medium_affinity: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    article: { type: 'number', required: true },
                    podcast: { type: 'number', required: true },
                    short_video: { type: 'number', required: true },
                    card: { type: 'number', required: true },
                    newsletter: { type: 'number', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: formatExtractResult(value.atoms) },
      ],
    },
    async execute(args, exec) {
      const cwd = await requireCwd(ctx, exec.agent, exec.signal)
      const project = await loadProject(cwd, args.project_id)
      const atoms = extractAtoms(project.source_text, args.atom_types)
      await writeJson(path.join(projectDir(cwd, args.project_id), 'atoms.json'), atoms)
      await updateStage(cwd, args.project_id, 'extracted')
      return { atoms }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Extract atoms',
      kind: 'other',
      rawInput: { project_id: args.project_id, atom_types: args.atom_types },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'adapt_for_medium',
    description: 'Orchestrate a selection of atoms into an adapted draft following one medium\'s declarative narrative template (article or short_video).',
    parameters: {
      project_id: { type: 'string', required: true },
      target_medium: { type: 'string', required: true, enum: ['article', 'short_video', 'card_series', 'podcast_script'], description: 'The medium whose narrative grammar to follow.' },
      tone: { type: 'string', description: 'Optional tone preference, e.g. analytical, conversational, provocative.' },
      length_target: { type: 'string', description: 'Optional length target: short / medium / long.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          draft_id: { type: 'string', required: true },
          medium: { type: 'string', required: true },
          selected_atoms: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                atom_id: { type: 'string', required: true },
                role_in_medium: { type: 'string', required: true },
                content: { type: 'string', required: true },
              },
            },
          },
          structure: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                section_label: { type: 'string', required: true },
                atom_ids: { type: 'array', required: true, items: { type: 'string' } },
                transition_instruction: { type: 'string', required: true },
              },
            },
          },
          adaptation_notes: { type: 'array', required: true, items: { type: 'string' } },
          rendered_text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Drafted ${value.medium} with ${value.selected_atoms.length} atoms.` },
      ],
    },
    async execute(args, exec) {
      const cwd = await requireCwd(ctx, exec.agent, exec.signal)
      await loadProject(cwd, args.project_id)
      const atoms = await readJson<Atom[]>(path.join(projectDir(cwd, args.project_id), 'atoms.json')) ?? []
      const template = loadTemplate(args.target_medium)
      const result = orchestrate(template, atoms, args.target_medium, args.tone, args.length_target)
      const draft_id = newId('draft')
      const draft: Draft = {
        draft_id,
        project_id: args.project_id,
        medium: args.target_medium,
        selected_atoms: result.selected_atoms,
        structure: result.structure,
        adaptation_notes: result.adaptation_notes,
        rendered_text: result.rendered_text,
      }
      if (args.tone !== undefined) draft.tone = args.tone
      if (args.length_target !== undefined) draft.length_target = args.length_target
      await writeJson(path.join(projectDir(cwd, args.project_id), 'drafts', `${draft_id}.json`), draft)
      await updateStage(cwd, args.project_id, 'adapted')
      return {
        draft_id,
        medium: args.target_medium,
        selected_atoms: result.selected_atoms,
        structure: result.structure,
        adaptation_notes: result.adaptation_notes,
        rendered_text: result.rendered_text,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Adapt for ${args.target_medium}`,
      kind: 'other',
      rawInput: { project_id: args.project_id, target_medium: args.target_medium },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'assemble_pack',
    description: 'Assemble several drafts into a channel pack with shared facts, a reuse matrix, and cross-draft consistency warnings for the same atom.',
    parameters: {
      project_id: { type: 'string', required: true },
      draft_ids: { type: 'array', required: true, items: { type: 'string' }, description: 'Draft ids to pack together.' },
      pack_name: { type: 'string', description: 'Optional pack name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pack_id: { type: 'string', required: true },
          shared_facts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fact: { type: 'string', required: true },
                atom_id: { type: 'string', required: true },
                used_in: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          reuse_matrix: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              rows: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    atom_id: { type: 'string', required: true },
                    mediums: { type: 'array', required: true, items: { type: 'string' } },
                  },
                },
              },
            },
          },
          consistency_warnings: { type: 'array', required: true, items: { type: 'string' } },
          deliverables: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                medium: { type: 'string', required: true },
                draft_id: { type: 'string', required: true },
                format: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Packed ${value.deliverables.length} drafts with ${value.consistency_warnings.length} consistency warnings.` },
      ],
    },
    async execute(args, exec) {
      const cwd = await requireCwd(ctx, exec.agent, exec.signal)
      await loadProject(cwd, args.project_id)
      const atoms = await readJson<Atom[]>(path.join(projectDir(cwd, args.project_id), 'atoms.json')) ?? []
      const drafts: Draft[] = []
      for (const draftId of args.draft_ids) drafts.push(await loadDraft(cwd, args.project_id, draftId))
      const body = assemblePack(atoms, drafts)
      const pack_id = newId('pack')
      const pack_name = args.pack_name ?? `pack-${drafts.length}`
      const pack: Pack = {
        pack_id,
        project_id: args.project_id,
        pack_name,
        shared_facts: body.shared_facts,
        reuse_matrix: { rows: body.reuse_matrix },
        consistency_warnings: body.consistency_warnings,
        deliverables: body.deliverables,
      }
      await writeJson(path.join(projectDir(cwd, args.project_id), 'packs', `${pack_id}.json`), pack)
      await updateStage(cwd, args.project_id, 'packed')
      return {
        pack_id,
        shared_facts: body.shared_facts,
        reuse_matrix: { rows: body.reuse_matrix },
        consistency_warnings: body.consistency_warnings,
        deliverables: body.deliverables,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Assemble pack',
      kind: 'other',
      rawInput: { project_id: args.project_id, draft_ids: args.draft_ids },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'get_project_state',
    description: 'Query a Content Hub project\'s current state: source metadata, atom statistics, generated drafts, and the next pending workflow stage.',
    parameters: {
      project_id: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              project_id: { type: 'string', required: true },
              project_name: { type: 'string', required: true },
              source_type: { type: 'string', required: true },
              source_summary: { type: 'string', required: true },
              stage: { type: 'string', required: true },
              created_at: { type: 'string', required: true },
            },
          },
          atom_stats: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              total: { type: 'integer', required: true },
              by_type: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  claim: { type: 'integer', required: true },
                  evidence: { type: 'integer', required: true },
                  story: { type: 'integer', required: true },
                  step: { type: 'integer', required: true },
                  quote: { type: 'integer', required: true },
                  question: { type: 'integer', required: true },
                },
              },
            },
          },
          drafts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                draft_id: { type: 'string', required: true },
                medium: { type: 'string', required: true },
              },
            },
          },
          next_steps: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Project ${value.project.project_name} at stage "${value.project.stage}".` },
      ],
    },
    async execute(args, exec) {
      const cwd = await requireCwd(ctx, exec.agent, exec.signal)
      const project = await loadProject(cwd, args.project_id)
      const atoms = await readJson<Atom[]>(path.join(projectDir(cwd, args.project_id), 'atoms.json')) ?? []
      const draftIds = await listDraftIds(cwd, args.project_id)
      const drafts: { draft_id: string; medium: string }[] = []
      for (const draftId of draftIds) {
        const draft = await readJson<Draft>(path.join(projectDir(cwd, args.project_id), 'drafts', `${draftId}.json`))
        if (draft !== undefined) drafts.push({ draft_id: draft.draft_id, medium: draft.medium })
      }
      return {
        project: {
          project_id: project.project_id,
          project_name: project.project_name,
          source_type: project.source_type,
          source_summary: project.source_summary,
          stage: project.stage,
          created_at: project.created_at,
        },
        atom_stats: { total: atoms.length, by_type: countAtoms(atoms) },
        drafts,
        next_steps: nextSteps(project.stage),
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Get project state',
      kind: 'other',
      rawInput: { project_id: args.project_id },
    }),
  }))
}
