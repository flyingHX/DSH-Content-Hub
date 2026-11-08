import type { Context } from '@deepseek-ai/cordis';
export declare const name = "content-hub";
export declare const inject: string[];
/** The working-directory service, typed locally to avoid a runtime dependency. */
declare module '@deepseek-ai/cordis' {
    interface Context {
        workingDirectory: {
            ensure(agent: unknown, signal?: AbortSignal): Promise<string>;
        };
    }
}
/**
 * Register the five tools. The plugin has no deployment config, so it injects
 * only `tools` and `workingDirectory`.
 * @param ctx - registrant context carrying the tool and working-directory services.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map