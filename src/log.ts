export function log(scope: string, message: string): void {
  if (process.env.PRISM_DEBUG === "1") console.debug(`[${scope}] ${message}`);
}
