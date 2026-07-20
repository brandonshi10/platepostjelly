// Test-only stub for the "server-only" package.
// The real package throws when bundled into a client component; under
// vitest's plain node environment that check misfires, so we alias it
// to a no-op here (see vitest.config.ts).
export {};
