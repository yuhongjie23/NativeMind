/**
 * ESLint 配置（legacy 格式，配合 scripts.lint 的 --ext 使用）
 *
 * 项目 TS strict，禁 any（AGENTS.md）。两条较吵的规则先按代码库实际收敛：
 * - no-explicit-any / no-unused-vars 是 warning；--max-warnings 0 要求归零，
 *   若出现真实告警就改代码，不要用 disable 塞住。
 * - react-hooks/exhaustive-deps 关闭：本项目的 useEffect 依赖大量是稳定回调，
 *   该规则会批量误报，且不构成真实 bug。
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    // 打开类型感知 lint，让 no-floating-promises / no-misused-promises 能工作
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'node_modules/', 'src-tauri/target/', '*.config.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-unused-vars': 'off',
    'no-empty': 'warn',
    'no-constant-condition': 'off',
    'no-useless-escape': 'warn',
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/no-unused-expressions': 'warn',
    'no-undef': 'off',

    // 类型感知规则：抓住「忘 await/void/catch 的 promise」与「把 async 当同步回调」这两类真实 bug
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    // 打开 exhaustive-deps：依赖缺失（如专注音乐 effect 没把 focusOverlay 纳入）正是历史 bug 来源。
    // 确属稳定回调的 effect 用行内 disable 并注明原因，不要整条关掉。
    'react-hooks/exhaustive-deps': 'warn',
  },
};
