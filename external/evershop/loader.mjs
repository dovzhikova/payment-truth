// Resolve hooks for evershop's sources: .js specifiers that only exist as .ts,
// and the query builder wrapped so type-only names (PoolClient) resolve.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WRAPPER = new URL('./qb-wrapper.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === '@evershop/postgres-query-builder' && context.parentURL !== WRAPPER) return { url: WRAPPER, shortCircuit: true };
  if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('/')) && /\/vendor[^/]*\/src\//.test(context.parentURL ?? '')) {
    const target = new URL(specifier, context.parentURL);
    const ts = fileURLToPath(target).replace(/\.js$/, '.ts');
    if (!existsSync(fileURLToPath(target)) && existsSync(ts)) return { url: pathToFileURL(ts).href, shortCircuit: true };
  }
  return next(specifier, context);
}
