import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['**/__tests__/**/*.test.js'],
    // Agent worktrees under .claude/ and .worktrees/ carry full repo copies; skip them.
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/.worktrees/**']
  }
})
