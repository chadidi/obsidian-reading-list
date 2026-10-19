/** Maps the `obsidian` package to the in-memory mock so the plugin and tests run under Node. */
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'obsidian') {
    return {
      format: 'module',
      shortCircuit: true,
      url: new URL('./obsidian.ts', import.meta.url).href,
    };
  }
  return nextResolve(specifier, context);
}
