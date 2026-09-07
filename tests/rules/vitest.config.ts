import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['*.test.ts'], testTimeout: 30000, hookTimeout: 60000, env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } } });
