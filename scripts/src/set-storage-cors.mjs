// Sets GET-only CORS on the Storage bucket so browsers can read image responses cross-origin.
// Uses Application Default Credentials (the local gcloud/firebase login). Run:
//   node scripts/src/set-storage-cors.mjs
import { GoogleAuth } from 'google-auth-library';

const bucket = process.env.BUCKET ?? 'qareeb-dev.firebasestorage.app';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.full_control'] });
const client = await auth.getClient();
const url = `https://storage.googleapis.com/storage/v1/b/${bucket}?fields=cors`;
const res = await client.request({
  url,
  method: 'PATCH',
  data: { cors: [{ origin: ['*'], method: ['GET', 'HEAD'], responseHeader: ['Content-Type', 'Cache-Control', 'ETag'], maxAgeSeconds: 3600 }] },
});
console.log(JSON.stringify(res.data, null, 2));
