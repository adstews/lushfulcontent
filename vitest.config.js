import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['**/__tests__/**/*.test.js'],
    // Stale agent worktrees under .claude/ carry full repo copies; don't scan them.
    exclude: [...configDefaults.exclude, '**/.claude/**']
  }
})
