import { defineConfig } from 'vitest/config';

// EMU_PORT_OFFSET shifts every emulator port (see test/emu.ts); the admin SDK reads these env vars.
const off = Number(process.env.EMU_PORT_OFFSET ?? 0) || 0;
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    env: {
      FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${9099 + off}`,
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${8080 + off}`,
      FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${9199 + off}`,
      GCLOUD_PROJECT: 'qareeb-dev',
    },
  },
});
