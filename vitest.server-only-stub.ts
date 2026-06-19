// Empty stub for the `server-only` package under Vitest.
//
// `server-only` is a runtime guard shipped by Next.js (resolved by its bundler)
// to make importing a server module from a Client Component a build error. It is
// not resolvable in the plain Vitest/Vite graph, so any test that transitively
// pulls a guarded module (e.g. `@/lib/boards/queries`, usually only for its
// TYPES) would otherwise fail with "Failed to resolve import 'server-only'".
// Aliasing the specifier here to this no-op module keeps those tests loadable
// without weakening the guard in app/build code.
export {};
