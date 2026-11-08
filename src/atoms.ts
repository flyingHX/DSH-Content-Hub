/**
 * Deterministic source splitting and six-type atom extraction.
 *
 * The extraction is heuristic and dependency-free: it never calls a model and
 * always traces every atom back to a source paragraph, so it never fabricates a
 * `source_ref`. Source text is split into quote-aware sentences so each atom
 * carries a single information unit, every sentence is evaluated against the
 * six atom-type rules (claim/evidence/story/step/quote/question), and embedded
 * direct speech is extracted as a `quote`. When a source has no explicit
 * question, one guiding question is generated. Cross-medium affinity is scored
 * from five content features rather than a per-type template.
 * @module atoms
 */
import { ATOM_TYPES, newId } from './store.js'
import type { Atom, AtomType, Confidence, MediumAffinity, StructureItem } from './store.js'

/** All six atom types, for callers that need a runtime set. */
export const ALL_ATOM_TYPES: readonly AtomType[] = ATOM_TYPES

/** Split source text into addressable blocks (blank lines and newlines). */
export function splitBlocks(text: string): { ref: string; text: string }[] {
  return text
    .split(/\n\s*\n|\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block, index) => ({ ref: `para-${index + 1}`, text: block }))
}

/** A block reads as a heading when it is short and ends without terminal punctuation. */
function isHeading(text: string): boolean {
  return text.length <= 80 && !/[。.!！?？;；]\s*$/.test(text)
}

/** Detect the paragraph/heading structure of an ingested source. */
export function detectStructure(text: string): StructureItem[] {
  return splitBlocks(text).map((block) => ({
    ref: block.ref,
    kind: isHeading(block.text) ? 'heading' : 'paragraph',
    snippet: block.text.slice(0, 120),
  }))
}

/** A one-line source summary for the project metadata. */
export function summarize(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 200 ? `${one.slice(0, 200)}…` : one
}

/** True when the character begins a quoted span. */
function opensQuote(ch: string): boolean {
  return ch === '"' || ch === '“' || ch === '「' || ch === "'" || ch === '‘'
}

/** The closing character that matches an opening quote, defaulting to itself. */
function closerFor(open: string): string {
  if (open === '“') return '”'
  if (open === '「') return '」'
  if (open === '‘') return '’'
  return open
}

/** A quoted span: the text between delimiters plus its start and end offsets. */
export interface QuoteSpan {
  text: string
  start: number
  end: number
}

/** Find every quoted span in a sentence, returning the inner text and offsets. */
export function findQuoteSpans(text: string): QuoteSpan[] {
  const spans: QuoteSpan[] = []
  let closeQuote: string | null = null
  let openIndex = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (closeQuote !== null) {
      if (ch === closeQuote) {
        const inner = text.slice(openIndex + 1, i)
        if (inner.trim().length > 0) spans.push({ text: inner, start: openIndex, end: i })
        closeQuote = null
        openIndex = -1
      }
      continue
    }
    if (opensQuote(ch)) {
      closeQuote = closerFor(ch)
      openIndex = i
    }
  }
  return spans
}

/**
 * Split a block into sentences on terminal punctuation, keeping a quotation
 * together with its enclosing sentence so a period inside quotes never splits.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''
  let closeQuote: string | null = null
  for (const ch of text) {
    current += ch
    if (closeQuote !== null) {
      if (ch === closeQuote) closeQuote = null
      continue
    }
    if (opensQuote(ch)) {
      closeQuote = closerFor(ch)
      continue
    }
    if (ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?') {
      sentences.push(current.trim())
      current = ''
    }
  }
  if (current.trim().length > 0) sentences.push(current.trim())
  return sentences
}

/** True when the sentence ends by asking a question. */
function isQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim())
}

/** Remove every quoted span so scare-quotes never seed a type classifier. */
function stripQuotes(text: string): string {
  let out = ''
  let cursor = 0
  for (const span of findQuoteSpans(text)) {
    out += text.slice(cursor, span.start)
    cursor = span.end + 1
  }
  out += text.slice(cursor)
  return out
}

/** True when the sentence names an ordered or imperative procedure. */
function isStep(text: string): boolean {
  const t = stripQuotes(text).trim()
  // 序数词（第N + 单位/枚举符）后须紧跟可执行动作/流程动词，否则是时间状语或叙事
  if (/第[一二三四五六七八九十\d]+[步条周天月阶段，,、:：；;].{0,20}(做|改|复盘|关闭|打开|记录|开始|选|观察|保留|提前|写|告诉|要求|进行|执行|设置|调整|检查|下载|安装|删除|复制|粘贴|运行|停止|推迟|同步|推送|审计|实验|测试|评估|统计|分析|开启|替换|重写|改成|通知)/.test(t)) {
    return true
  }
  if (/^(步骤|Step\s*\d+|First|Then|Next|Finally|首先|其次|然后|接下来|最后|如何|How to|To do)/i.test(t)) return true
  if (/(分[一二三四五六七八九十\d]+(?:个)?(?:步|阶段)|步骤|怎么做|如何操作)/.test(t)) return true
  // 连续祈使动词序列：打开…点击…等待…重启
  const imperatives = t.match(/(打开|点击|等待|重启|进入|选择|输入|保存|提交|设置|调整|检查|下载|安装|删除|复制|粘贴|运行|改成|关闭|复盘|保留|要求)/g)
  return (imperatives?.length ?? 0) >= 3
}

/** True when the sentence carries a datum, percentage, or citation. */
function isEvidence(text: string): boolean {
  if (/[%％]/.test(text)) return true
  const hasNumber = /\d+(\.\d+)?/.test(text)
  const hasCitation = /(数据|研究|调查|调研|报告|统计|显示|表明|根据|据|发现|study|research|report|survey|data|according|GitLab|麦肯锡|大学|研究院|统计局|白皮书)/i.test(text)
  return hasNumber && hasCitation
}

/** True when the sentence tells an anecdote with a scene, person, or timeline. */
function isStory(text: string): boolean {
  return /(我见过|见证|曾经|有一次|一位|当时|那天|年前|记得|有一天|三个月后|后来|之后|创始人|核心工程师|站会|故事|场景|采访|实验|试点|复盘会|One day|once|years ago|remember|story)/i.test(text)
}

/** Classify one sentence into its most likely atom type. */
export function classifyAtom(text: string): AtomType {
  const t = text.trim()
  if (isQuestion(t)) return 'question'
  if (isStep(t)) return 'step'
  if (isStory(t)) return 'story'
  if (isEvidence(t)) return 'evidence'
  return 'claim'
}

/**
 * Traceability of one atom type. Direct verbatim extracts are high; subjective
 * narration and judgments are medium; `low` marks synthesized atoms such as a
 * generated guiding question.
 */
export function confidenceFor(type: AtomType): Confidence {
  if (type === 'evidence' || type === 'quote' || type === 'step') return 'high'
  return 'medium'
}

/**
 * True when a quoted span is attributable speech or thought. It accepts a
 * colon right before the quote, a speaking/cognition verb in the preceding
 * text (excluding the fixed phrases 问题/说明/也就是说/答案 etc.), an
 * attribution right after the quote ("……"某某说 / "……"——某人), or a complete
 * question with narrative setup before it ("——"客户找不到人怎么办？").
 */
function isAttributedQuote(sentence: string, span: QuoteSpan): boolean {
  const prefix = sentence.slice(0, span.start)
  const suffix = sentence.slice(span.end + 1).trimStart()

  // 引号前以冒号结尾："……：" 或 写："……"
  if (/[:：]\s*$/.test(prefix)) return true

  // 前文（近 6 字内）含言说/认知动词，排除"问题/说明/答案/说到底"等固定短语
  const tail = prefix.slice(-6)
  if (/(?:说(?!明|法|到)|写|问(?!题|号)|答(?!案)|表示|道|喊|讲|抱怨|要求|认为|觉得|理解|提到|称|评论|引用|写清楚)/.test(tail)) return true

  // 引号后紧跟归属说明："……"某某说 / "……"某某的回答是 / "……"——某人
  if (/(?:回答|答道|说道|写道|表示|说|问|答)[^，。；]{0,6}[:：]/.test(suffix)) return true
  if (/^(?:——|—)/.test(suffix)) return true

  // 引号内是完整问句，且前文有叙事铺垫（破折号/言说动词）
  if (/[?？]\s*$/.test(span.text.trim()) && /(——|—|说|问|写|答|道|炸)/.test(prefix)) return true

  return false
}

/** Clamp a score to [0, 1] and round to two decimals. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100))
}

/**
 * Five content-derived feature scores, each in [0, 1]. The five dimensions are
 * 具体性 (specificity), 叙事性 (narrative), 可操作性 (actionability),
 * 传播性 (spreadability), and 论证性 (argumentativeness).
 */
interface ContentFeatures {
  specificity: number
  narrative: number
  actionability: number
  spreadability: number
  argumentativeness: number
}

/** Score one content unit on the five feature dimensions. */
function featuresFor(text: string): ContentFeatures {
  const hasNumber = /(\d+(\.\d+)?|[一二三四五六七八九十百千万两]|%|％)/.test(text)
  const hasInstitution = /(GitLab|调研|研究|调查|报告|统计|机构|公司|团队|员工|用户|麦肯锡|大学|研究院|统计局|白皮书)/i.test(text)
  const hasNarrative = /(我见过|见证|曾经|有一次|一次|一位|当时|那天|年前|记得|有一天|三个月后|后来|之后|创始人|核心工程师|站会|故事|场景|把自己关|连续|没合眼)/.test(text)
  const hasAction = /(分[一二三四五六七八九十\d]+(?:个)?(?:步|阶段)|三步|两步|一步|步骤|流程|方法|怎么做|如何操作|第一[周步条阶段]|第二[周步条阶段]|第三[周步条阶段]|第[一二三四五六七八九十\d]+[步条周天月阶段]|改成|打开|关闭|复盘|保留|要求|首先|其次|然后|接下来|最后|如何)/.test(text)
  const hasArgument = /(因为|所以|而是|说到底|本质上|不是|结论|显示|表明|意味着|承担|功能|让|导致|结果)/.test(text)
  const hasContrast = /(反而|不是|而是|说到底|本质上|但是|但|比[^。，]*更|却|竟然|居然|其实|没想到|意外|反差|相反)/.test(text)
  const length = text.replace(/\s+/g, '').length
  const short = length <= 40
  const punchy = /(！|!|反而|归零|最清醒|缩短|增加|减少|增长|翻倍|提升|下降|终极|高成本|不沟通|更累|竟然|居然|其实|震惊|为什么|意外|没想到)/.test(text)

  return {
    specificity: clamp01(0.3 + (hasNumber ? 0.35 : 0) + (hasInstitution ? 0.25 : 0) + Math.min(length / 250, 0.1)),
    narrative: clamp01(0.2 + (hasNarrative ? 0.5 : 0) + (short ? 0.1 : 0)),
    actionability: clamp01(0.1 + (hasAction ? 0.55 : 0) + (hasNumber ? 0.1 : 0)),
    spreadability: clamp01(0.2 + (short ? 0.35 : 0) + (punchy ? 0.3 : 0) + (hasContrast ? 0.15 : 0)),
    argumentativeness: clamp01(0.2 + (hasArgument ? 0.45 : 0) + (hasContrast ? 0.2 : 0)),
  }
}

/**
 * Map the five content features to the five media with the spec's weights:
 * short_video favors narrative and spreadability, article favors argument and
 * specificity, card favors spreadability, podcast favors narrative, newsletter
 * favors actionability. The atom type is deliberately ignored so two atoms of
 * the same type still diverge when their content differs.
 * @param text - the atom's content.
 * @param _type - the atom's classified type, unused by design.
 */
export function computeAffinity(text: string, _type: AtomType): MediumAffinity {
  const f = featuresFor(text)
  return {
    article: clamp01(0.4 * f.argumentativeness + 0.3 * f.specificity + 0.3 * f.actionability),
    podcast: clamp01(0.4 * f.narrative + 0.3 * f.argumentativeness + 0.3 * f.actionability),
    short_video: clamp01(0.4 * f.narrative + 0.4 * f.spreadability + 0.2 * f.specificity),
    card: clamp01(0.5 * f.spreadability + 0.3 * f.specificity + 0.2 * f.narrative),
    newsletter: clamp01(0.4 * f.actionability + 0.3 * f.specificity + 0.3 * f.argumentativeness),
  }
}

/** True when a clause reports a measurable change with a quantity or unit. */
function isResultClause(text: string): boolean {
  return /(缩短|增加|减少|降低|提升|提高|延长|下降|翻倍|增长|改善|优化|归零|砍掉|降到)[^，。；]*?([两三四五六七八九十\d]+\s*[周天月年倍个]|[%％]|一倍|两倍)/.test(text)
}

/** Split a trailing result clause (such as "缩短了两周") out of a narrative sentence. */
function splitResultEvidence(sentence: string): { evidence: string; remainder: string } | null {
  const lastComma = sentence.lastIndexOf('，')
  if (lastComma === -1) return null
  const tail = sentence.slice(lastComma + 1).trim().replace(/[。；;！？!?]+$/, '')
  if (tail.length === 0 || !isResultClause(tail)) return null
  const remainder = sentence.slice(0, lastComma).trim()
  if (remainder.length === 0) return null
  return { evidence: tail.replace(/^(结果|最后|最终|于是|因此)[,，]?\s*/, ''), remainder }
}

/**
 * Extract a quotable B part from a "不是…而是…" contrast sentence. The full
 * sentence stays as one claim; only the condensed aphorism becomes an extra
 * quote excerpt, so the claim and quote coexist under the same source_ref.
 */
function splitCondensedQuote(sentence: string): { quote: string } | null {
  const marker = '，而是'
  const idx = sentence.indexOf(marker)
  if (idx === -1) return null
  const after = sentence.slice(idx + marker.length).trim().replace(/[。；;！？!?]+$/, '')
  if (after.length === 0 || after.length > 30) return null
  // 只拆含引号强调词或"从X变成Y"的可传播短句
  if (!/["“「]/.test(after) && !/从[^，。]{0,12}(?:变成|转为|走向|到)/.test(after)) return null
  const quote = after.replace(/^["“「]/, '').replace(/["”」]$/, '')
  return { quote }
}

/** Build one atom with a fresh id, type, content, and source reference. */
function makeAtom(type: AtomType, content: string, sourceRef: string, confidence?: Confidence): Atom {
  return {
    atom_id: newId('atom'),
    type,
    content,
    source_ref: sourceRef,
    confidence: confidence ?? confidenceFor(type),
    medium_affinity: computeAffinity(content, type),
  }
}

/** True when a comma-segment is a standalone data point (number + measure, not a date). */
function isDataSegment(segment: string): boolean {
  const s = segment.trim()
  if (s.length === 0) return false
  if (/^[0-9一二三四五六七八九十]{2,4}\s*[年季度月]/.test(s) && !/[%％亿万千毫秒秒分钟个倍元人款条项]/.test(s)) return false
  return /(\d+(\.\d+)?|[一二三四五六七八九十百千万两])\s*[%％亿万千毫秒秒分钟个倍元人款条项]/.test(s)
}

/** Split a dense evidence sentence into standalone data points when 2+ exist. */
function splitEvidencePoints(sentence: string): string[] {
  const segments = sentence.split(/[，,]/).map((s) => s.trim()).filter((s) => s.length > 0)
  const points = segments.filter(isDataSegment)
  return points.length >= 2 ? points : [sentence.trim()]
}

/**
 * Decompose one sentence into its atoms: attributed speech becomes a `quote`,
 * a condensed contrast aphorism becomes a `quote`, a trailing result clause
 * becomes `evidence`, a dense data sentence splits into multiple `evidence`
 * points, and the remaining narrative/claim is one atom. Every atom shares the
 * sentence's source reference.
 */
function extractSentenceAtoms(sentence: string, ref: string, wanted: ReadonlySet<string> | undefined): Atom[] {
  const atoms: Atom[] = []
  const push = (type: AtomType, content: string, confidence?: Confidence): void => {
    if (wanted === undefined || wanted.has(type)) atoms.push(makeAtom(type, content, ref, confidence))
  }

  for (const span of findQuoteSpans(sentence)) {
    if (isAttributedQuote(sentence, span)) push('quote', span.text)
  }

  let body = sentence
  const condensed = splitCondensedQuote(body)
  if (condensed !== null) {
    push('quote', condensed.quote, 'medium')
    // 保留完整原句作为 claim，不再劈成两半
  }

  const preliminaryType = classifyAtom(body)
  if (preliminaryType === 'story' || preliminaryType === 'claim') {
    const result = splitResultEvidence(body)
    if (result !== null) {
      push('evidence', result.evidence, 'medium')
      body = result.remainder
    }
  }

  const finalType = classifyAtom(body)
  if (finalType === 'evidence') {
    for (const point of splitEvidencePoints(body)) push('evidence', point)
  } else {
    push(finalType, body)
  }
  return atoms
}

/** Generate one curiosity-driving question from the source's most striking fact. */
function generateGuidingQuestion(text: string): Atom {
  const sentences = splitBlocks(text).flatMap((block) => splitSentences(block.text))
  const interesting = sentences.find((s) => /(值得注意的是|唯一|反而|竟然|居然|其实|没想到|意外|负增长|下降|缩短|归零|高成本|不沟通|降低|提升)/.test(s))
    ?? sentences[0]
    ?? ''
  const cleaned = interesting
    .replace(/[。！？!?]$/, '')
    .replace(/^(值得注意的是|有趣的是|关键是|问题是|说白了|说到底|然而|但是|但)[,，]?\s*/, '')
    .trim()
  const short = cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
  return makeAtom('question', `为什么${short}？`, 'generated', 'low')
}

/** Break any same-type atoms that end up with an identical affinity vector. */
function ensureDistinctAffinities(atoms: Atom[]): void {
  const groups = new Map<AtomType, Atom[]>()
  for (const atom of atoms) {
    const group = groups.get(atom.type) ?? []
    group.push(atom)
    groups.set(atom.type, group)
  }
  for (const group of groups.values()) {
    const seen = new Set<string>()
    for (const atom of group) {
      let key = JSON.stringify(atom.medium_affinity)
      while (seen.has(key)) {
        atom.medium_affinity.short_video = clamp01(atom.medium_affinity.short_video + 0.01)
        key = JSON.stringify(atom.medium_affinity)
      }
      seen.add(key)
    }
  }
}

/**
 * Extract atoms from source text, optionally restricted to a subset of types.
 * One sentence decomposes into one atom plus any direct speech, condensed
 * aphorisms, and result clauses it contains. When the source has no explicit
 * question, one guiding question is generated to keep all six types covered.
 */
export function extractAtoms(text: string, atomTypes?: readonly string[]): Atom[] {
  const wanted = atomTypes !== undefined && atomTypes.length > 0 ? new Set(atomTypes) : undefined
  const atoms: Atom[] = []
  for (const block of splitBlocks(text)) {
    const sentences = splitSentences(block.text)
    for (let s = 0; s < sentences.length; s++) {
      atoms.push(...extractSentenceAtoms(sentences[s]!, `${block.ref}-s${s + 1}`, wanted))
    }
  }
  if ((wanted === undefined || wanted.has('question')) && !atoms.some((atom) => atom.type === 'question')) {
    atoms.push(generateGuidingQuestion(text))
  }
  ensureDistinctAffinities(atoms)
  return atoms
}
