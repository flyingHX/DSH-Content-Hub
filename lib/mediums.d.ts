import type { Atom, AtomType, SelectedAtom, StructureSection } from './store.js';
/** One orchestration section declared by a medium template. */
export interface MediumTemplateSection {
    label: string;
    duration_seconds?: string;
    max_atoms?: number;
    priority?: number;
    atom_preference: AtomType[];
    rule: string;
}
/** A medium's full declarative narrative grammar. */
export interface MediumTemplate {
    medium: string;
    label: string;
    sections: MediumTemplateSection[];
}
/** Media with an authored orchestration template. */
export declare const SUPPORTED_MEDIA: readonly string[];
/**
 * Parse the constrained YAML subset used by the medium templates: top-level
 * scalars, a `sections:` list of `- key: value` objects, and inline arrays.
 */
export declare function parseMediumTemplate(text: string): MediumTemplate;
/** Load the authored YAML template for one supported medium. */
export declare function loadTemplate(medium: string): MediumTemplate;
/** The assembled draft content produced by one orchestration. */
export interface Orchestration {
    structure: StructureSection[];
    selected_atoms: SelectedAtom[];
    adaptation_notes: string[];
    rendered_text: string;
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
export declare function orchestrate(template: MediumTemplate, atoms: readonly Atom[], medium: string, tone: string | undefined, lengthTarget: string | undefined): Orchestration;
//# sourceMappingURL=mediums.d.ts.map