/**
 * Content Hub data model and JSON file persistence.
 *
 * Project state is stored under `<workingDirectory>/content-hub/projects/` with
 * no external database. The atom library (`atoms.json`) is the single source of
 * truth that every draft references by `atom_id`.
 * @module store
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
/** The six reusable content-atom kinds. */
export const ATOM_TYPES = ['claim', 'evidence', 'story', 'step', 'quote', 'question'];
/** The five media forms an atom may be well-suited for. */
export const MEDIUM_KEYS = ['article', 'podcast', 'short_video', 'card', 'newsletter'];
/** Absolute directory holding all projects for one workspace. */
export function projectsRoot(cwd) {
    return path.join(cwd, 'content-hub', 'projects');
}
/** Absolute directory holding one project's files. */
export function projectDir(cwd, projectId) {
    return path.join(projectsRoot(cwd), projectId);
}
/** Read and parse a JSON file, or return undefined when it is absent. */
export async function readJson(file) {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
/** Write a JSON file atomically enough for single-process tool execution. */
export async function writeJson(file, data) {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temp, file);
}
/** A fresh opaque id scoped to the `ch-` prefix. */
export function newId(prefix) {
    return `${prefix}-${randomUUID()}`;
}
//# sourceMappingURL=store.js.map