import { execSync } from 'node:child_process';
import path from 'node:path';

/** Requires the emulators to be running (scripts/emulators.sh). Clears Firestore/Auth and re-seeds. */
export default async function setup() {
  const project = 'qareeb-dev';
  const wipe = async (url: string) => {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`failed to clear ${url}: ${res.status}`);
  };
  await wipe(`http://127.0.0.1:8080/emulator/v1/projects/${project}/databases/(default)/documents`);
  await wipe(`http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`);
  execSync('node --experimental-strip-types src/seed.ts', {
    cwd: path.resolve(process.cwd(), '../scripts'),
    stdio: 'pipe',
    env: { ...process.env, SEED_ALWAYS_OPEN: '1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: project, HTTPS_PROXY: '', https_proxy: '' },
  });
}
