/**
 * Legacy compatibility hook kept dormant while CloudCLI owns the embedded
 * 9router runtime. External connection rows are intentionally not mutated.
 */
export async function tryAutoConnect(_dependencies: unknown): Promise<void> {
  return undefined;
}
