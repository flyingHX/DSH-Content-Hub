import type { Atom, AtomType, Confidence, MediumAffinity, StructureItem } from './store.js';
/** All six atom types, for callers that need a runtime set. */
export declare const ALL_ATOM_TYPES: readonly AtomType[];
/** Split source text into addressable blocks (blank lines and newlines). */
export declare function splitBlocks(text: string): {
    ref: string;
    text: string;
}[];
/** Detect the paragraph/heading structure of an ingested source. */
export declare function detectStructure(text: string): StructureItem[];
/** A one-line source summary for the project metadata. */
export declare function summarize(text: string): string;
/** A quoted span: the text between delimiters plus its start and end offsets. */
export interface QuoteSpan {
    text: string;
    start: number;
    end: number;
}
/** Find every quoted span in a sentence, returning the inner text and offsets. */
export declare function findQuoteSpans(text: string): QuoteSpan[];
/**
 * Split a block into sentences on terminal punctuation, keeping a quotation
 * together with its enclosing sentence so a period inside quotes never splits.
 */
export declare function splitSentences(text: string): string[];
/** Classify one sentence into its most likely atom type. */
export declare function classifyAtom(text: string): AtomType;
/**
 * Traceability of one atom type. Direct verbatim extracts are high; subjective
 * narration and judgments are medium; `low` marks synthesized atoms such as a
 * generated guiding question.
 */
export declare function confidenceFor(type: AtomType): Confidence;
/**
 * Map the five content features to the five media with the spec's weights:
 * short_video favors narrative and spreadability, article favors argument and
 * specificity, card favors spreadability, podcast favors narrative, newsletter
 * favors actionability. The atom type is deliberately ignored so two atoms of
 * the same type still diverge when their content differs.
 * @param text - the atom's content.
 * @param _type - the atom's classified type, unused by design.
 */
export declare function computeAffinity(text: string, _type: AtomType): MediumAffinity;
/**
 * Extract atoms from source text, optionally restricted to a subset of types.
 * One sentence decomposes into one atom plus any direct speech, condensed
 * aphorisms, and result clauses it contains. When the source has no explicit
 * question, one guiding question is generated to keep all six types covered.
 */
export declare function extractAtoms(text: string, atomTypes?: readonly string[]): Atom[];
//# sourceMappingURL=atoms.d.ts.map