/** Collapse whitespace so two phrasings compare by their words. */
function normalize(text) {
    return text.replace(/\s+/g, ' ').trim();
}
/** The output format tag for one medium. */
function formatFor(medium) {
    return medium === 'short_video' ? 'storyboard' : 'markdown';
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
export function assemblePack(atoms, drafts) {
    const atomById = new Map(atoms.map((atom) => [atom.atom_id, atom]));
    const usage = new Map();
    for (const draft of drafts) {
        for (const selected of draft.selected_atoms) {
            let entry = usage.get(selected.atom_id);
            if (entry === undefined) {
                entry = { mediums: [], byContent: new Map() };
                usage.set(selected.atom_id, entry);
            }
            if (!entry.mediums.includes(draft.medium))
                entry.mediums.push(draft.medium);
            const normalized = normalize(selected.content);
            let mediums = entry.byContent.get(normalized);
            if (mediums === undefined) {
                mediums = [];
                entry.byContent.set(normalized, mediums);
            }
            if (!mediums.includes(draft.medium))
                mediums.push(draft.medium);
        }
    }
    const shared_facts = [];
    const reuse_matrix = [];
    const consistency_warnings = [];
    for (const [atomId, entry] of usage) {
        reuse_matrix.push({ atom_id: atomId, mediums: entry.mediums });
        if (entry.mediums.length >= 2) {
            shared_facts.push({
                fact: atomById.get(atomId)?.content ?? '',
                atom_id: atomId,
                used_in: entry.mediums,
            });
        }
        if (entry.byContent.size > 1) {
            const variants = [...entry.byContent.entries()]
                .map(([content, mediums]) => `${mediums.join('、')} 表述为 "${content}"`)
                .join('；');
            consistency_warnings.push(`atom ${atomId} 在不同 draft 中 content 表述不一致（${variants}）`);
        }
    }
    const deliverables = drafts.map((draft) => ({
        medium: draft.medium,
        draft_id: draft.draft_id,
        format: formatFor(draft.medium),
    }));
    return { shared_facts, reuse_matrix, consistency_warnings, deliverables };
}
//# sourceMappingURL=pack.js.map