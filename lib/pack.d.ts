/**
 * Channel-pack assembly: aggregate several drafts, extract shared facts and the
 * reuse matrix, and flag cross-draft content drift for the same atom.
 * @module pack
 */
import type { Atom, Deliverable, Draft, ReuseRow, SharedFact } from './store.js';
/** The assembled pack minus the id/name envelope (added by the caller). */
export interface PackBody {
    shared_facts: SharedFact[];
    reuse_matrix: ReuseRow[];
    consistency_warnings: string[];
    deliverables: Deliverable[];
}
/**
 * Assemble a channel pack from the atom library and selected drafts.
 *
 * A consistency warning is emitted whenever the same `atom_id` carries
 * different `content` phrasings across drafts, which signals potential fact
 * drift. The pack reports, never rewrites.
 * @param atoms - the project's single source of truth.
 * @param drafts - the drafts to pack.
 */
export declare function assemblePack(atoms: readonly Atom[], drafts: readonly Draft[]): PackBody;
//# sourceMappingURL=pack.d.ts.map