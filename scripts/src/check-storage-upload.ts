/**
 * Preflight for photo uploads on a live project.
 *
 * Photo upload was dead on `qareeb-dev` from the day the bucket was created until 2026-09-09,
 * and the cause was invisible from the code: `storage.rules` calls `firestore.get()`/`exists()`,
 * and those only resolve when the Cloud Storage service agent holds
 * `roles/firebaserules.firestoreServiceAgent`. An interactive `firebase deploy --only storage`
 * offers to grant it; the `--non-interactive` deploys this repo uses in CI never do. Without it
 * every rule guarded by a Firestore lookup errors, and the client sees a bare
 * `storage/unauthorized` that is indistinguishable from a genuine permission denial.
 *
 * Nothing else in the repo can catch that: the Storage emulator does not resolve cross-service
 * lookups at all (see the note in tests/rules/storage.test.ts), so the positive owner path cannot
 * be asserted locally. This script is the substitute — it checks the binding and then replays the
 * real upload against the *deployed* ruleset through the Rules test API.
 *
 *   node --experimental-strip-types src/check-storage-upload.ts [projectId]
 *
 * Read-only: it reads the IAM policy and evaluates rules; it never writes to the project.
 * Exits non-zero on any failure so it can gate a deploy.
 */
import { GoogleAuth } from 'google-auth-library';

const PROJECT = process.argv[2] || process.env.GCLOUD_PROJECT || 'qareeb-dev';
const REQUIRED_ROLE = 'roles/firebaserules.firestoreServiceAgent';
/** Cross-service Rules allow at most this many unique Firestore documents per evaluation. */
const DOCUMENT_BUDGET = 2;

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const client = await auth.getClient();
// ADC minted from a user account carries no project, and these APIs bill against one.
const headers = { 'x-goog-user-project': PROJECT };

const failures: string[] = [];
const note = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

async function get<T>(url: string): Promise<T> {
  const r = await client.request<T>({ url, headers });
  return r.data;
}

// ---------- 1. the IAM binding the cross-service lookups depend on ----------

const { projectNumber } = await get<{ projectNumber: string }>(
  `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`,
);
const agent = `serviceAccount:service-${projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`;
const policy = await client
  .request<{ bindings?: Array<{ role: string; members?: string[] }> }>({
    url: `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,
    method: 'POST',
    data: {},
    headers,
  })
  .then((r) => r.data);

const bound = (policy.bindings ?? []).some((b) => b.role === REQUIRED_ROLE && (b.members ?? []).includes(agent));
note(bound, `${agent} holds ${REQUIRED_ROLE}`);
if (!bound) {
  console.log(`\n      grant it once, then re-run:\n\n        gcloud projects add-iam-policy-binding ${PROJECT} \\\n          --member="${agent}" \\\n          --role="${REQUIRED_ROLE}"\n`);
}

// ---------- 2. the deployed ruleset, replayed against a real owner ----------

const { releases = [] } = await get<{ releases?: Array<{ name: string; rulesetName: string }> }>(
  `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`,
);
const release = releases.find((r) => r.name.includes('/releases/firebase.storage/'));
note(!!release, 'a storage ruleset is released');

if (release) {
  const ruleset = await get<{ source: { files: Array<{ name: string; content: string }> } }>(
    `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
  );
  const source = ruleset.source.files;
  const bucket = release.name.split('/releases/firebase.storage/')[1];

  const uid = 'uid-owner';
  const businessId = 'biz-1';
  const branchId = 'branch-1';
  const userPath = `/databases/(default)/documents/users/${uid}`;
  const membershipPath = `/databases/(default)/documents/memberships/${uid}_${businessId}`;

  // Mirrors a real owner: users/{uid} present and not suspended, an active owner membership.
  const mocks = [
    { function: 'firestore.exists', args: [{ anyValue: {} }], result: { value: true } },
    { function: 'firestore.get', args: [{ exactValue: userPath }], result: { value: { data: { suspended: false, isAdmin: false } } } },
    {
      function: 'firestore.get',
      args: [{ exactValue: membershipPath }],
      result: { value: { data: { active: true, role: 'owner', allBranches: true, branchIds: [] } } },
    },
  ];
  const authed = { uid, token: { sub: uid, firebase: { sign_in_provider: 'password' } } };
  const image = { contentType: 'image/webp', size: 120_000 };
  const logo = `businesses/${businessId}/logo-abc12345.webp`;
  const product = `businesses/${businessId}/branches/${branchId}/products/prod-1/aaaaaaaaaa.webp`;

  const testCase = (
    expectation: 'ALLOW' | 'DENY',
    objectPath: string,
    over: { auth?: unknown; resource?: Record<string, unknown> } = {},
  ) => ({
    expectation,
    request: {
      auth: 'auth' in over ? over.auth : authed,
      path: `/b/${bucket}/o/${objectPath}`,
      method: 'create',
      time: '2026-01-01T00:00:00Z',
      resource: { ...image, ...(over.resource ?? {}), name: objectPath },
    },
    functionMocks: mocks,
    pathEncoding: 'URL_ENCODED',
    expressionReportLevel: 'FULL',
  });

  // The positive cases are the ones that were never covered anywhere: an owner uploading a logo
  // and a product photo. The negative cases pin the guards that positive-only coverage would rot.
  const cases: Array<[string, ReturnType<typeof testCase>]> = [
    ['owner uploads a business logo', testCase('ALLOW', logo)],
    ['owner uploads a product photo', testCase('ALLOW', product)],
    ['guest is refused', testCase('DENY', logo, { auth: null })],
    ['non-image content type is refused', testCase('DENY', logo, { resource: { contentType: 'application/pdf' } })],
    ['oversized upload is refused', testCase('DENY', logo, { resource: { size: 5 * 1024 * 1024 + 1 } })],
    ['a file that is neither logo nor cover is refused', testCase('DENY', `businesses/${businessId}/notlogo.webp`)],
    ['a path outside the tenant layout is refused', testCase('DENY', 'receipts/secret.webp')],
  ];

  const { testResults = [] } = await client
    .request<{ testResults?: Array<{ state: string; debugMessages?: string[]; functionCalls?: Array<{ args: string[] }> }> }>({
      url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
      method: 'POST',
      headers,
      data: { source: { files: source }, testSuite: { testCases: cases.map(([, c]) => c) } },
    })
    .then((r) => r.data);

  cases.forEach(([label], i) => {
    const result = testResults[i];
    const ok = result?.state === 'SUCCESS';
    note(ok, `deployed rules: ${label}`);
    if (!ok && result?.debugMessages?.length) console.log(`        ${result.debugMessages.join('\n        ')}`);
  });

  // The cap that has no other guard: the rules service denies with a bare 403 once an evaluation
  // touches a third document, and the simulator above would still pass because it only sees mocks.
  const reads = testResults[0]?.functionCalls ?? [];
  const unique = new Set(reads.map((c) => c.args[0]));
  note(
    unique.size <= DOCUMENT_BUDGET,
    `owner upload reads ${unique.size} unique Firestore document(s), budget ${DOCUMENT_BUDGET}`,
  );
}

console.log('');
if (failures.length) {
  console.error(`${failures.length} check(s) failed on ${PROJECT} — photo upload is not safe to ship.`);
  process.exit(1);
}
console.log(`photo upload preflight passed on ${PROJECT}.`);
