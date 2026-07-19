// Verification harness for photodrop 1.4.0 (resumable chunked upload).
import { createHash } from 'node:crypto';
import { buildApp } from '/app/dist/app.js';
import { ensureDataDirs } from '/app/dist/lib/paths.js';
import sharp from 'sharp';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

ensureDataDirs();
const app = await buildApp();
await app.ready();

const jar = new Map();
let ipCounter = 0;
const nextIp = () => `10.${(++ipCounter >> 8) & 255}.${ipCounter & 255}.1`;
function applyCookies(res) {
  for (const c of res.cookies ?? []) {
    if (c.value === '') jar.delete(c.name); else jar.set(c.name, c.value);
  }
}
async function req(method, url, { body, raw, token } = {}) {
  const headers = {};
  // When acting as another user, REPLACE access_token rather than appending a
  // second one — two cookies of the same name and the server just reads the
  // first, which would silently run the request as the original admin.
  const ck = [...jar.entries()]
    .filter(([k]) => !(token && k === 'access_token'))
    .map(([k, v]) => `${k}=${v}`);
  if (token) ck.push(`access_token=${token}`);
  if (ck.length) headers.cookie = ck.join('; ');
  if (method !== 'GET' && jar.has('csrf_token')) headers['x-csrf-token'] = jar.get('csrf_token');
  if (raw !== undefined) headers['content-type'] = 'application/octet-stream';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.inject({
    method, url, headers, payload: raw !== undefined ? raw : body, remoteAddress: nextIp(),
  });
  applyCookies(res);
  return res;
}

// ── auth: seeded admin straight to a session token ────────────────────────
const admin = app.db.prepare('SELECT * FROM users WHERE username = ?').get(process.env.ADMIN_USERNAME);
const adminToken = app.jwt.sign({ sub: admin.id, role: 'admin', scope: 'session', tv: admin.token_version });
jar.set('access_token', adminToken);
await req('GET', '/api/auth/csrf');

// A second admin, to prove a session id isn't usable across accounts.
app.db.prepare(
  `INSERT INTO users (username, password_hash, role, totp_enabled, failed_login_attempts, token_version, created_at)
   VALUES ('intruder', 'x', 'admin', 1, 0, 0, ?)`,
).run(Date.now());
const intruder = app.db.prepare("SELECT * FROM users WHERE username = 'intruder'").get();
const intruderToken = app.jwt.sign({ sub: intruder.id, role: 'admin', scope: 'session', tv: 0 });

const album = await req('POST', '/api/admin/albums', { body: { title: 'chunked' } });
const uid = JSON.parse(album.body).uid ?? JSON.parse(album.body).album?.uid;
check('T0 album created', !!uid, album.body.slice(0, 200));

// A real JPEG big enough to span several parts (part size is 8 MiB in prod, but
// the harness sets UPLOAD_PART_BYTES small so this stays quick).
const source = await sharp({
  create: { width: 2400, height: 1600, channels: 3, background: { r: 40, g: 90, b: 160 } },
}).jpeg({ quality: 92 }).toBuffer();
const sourceHash = createHash('sha256').update(source).digest('hex');
console.log(`  ..    source image ${source.length} bytes, sha256 ${sourceHash.slice(0, 16)}…`);

async function startSession(name = 'clip.jpg', size = source.length) {
  const res = await req('POST', `/api/admin/albums/${uid}/uploads`, { body: { name, size } });
  return { status: res.statusCode, ...JSON.parse(res.body) };
}
const partOf = (s, i) => source.subarray(i * s.partSize, Math.min((i + 1) * s.partSize, source.length));

// ── T1 happy path + byte-for-byte integrity ───────────────────────────────
const s1 = await startSession();
check('T1a session created', s1.status === 201 && s1.totalParts > 1, JSON.stringify(s1));
for (let i = 0; i < s1.totalParts; i += 1) {
  const r = await req('PUT', `/api/admin/uploads/${s1.id}/parts/${i}`, { raw: partOf(s1, i) });
  if (r.statusCode !== 200) check(`T1b part ${i} accepted`, false, r.body);
}
check('T1b all parts accepted', true);
const resume = await req('GET', `/api/admin/uploads/${s1.id}`);
check('T1c resume lists every received part',
  JSON.parse(resume.body).received.length === s1.totalParts, resume.body);
const done = await req('POST', `/api/admin/uploads/${s1.id}/complete`);
check('T1d complete returns 202', done.statusCode === 202, done.body);

const row = app.db.prepare('SELECT * FROM photos WHERE album_uid = ? ORDER BY id DESC LIMIT 1').get(uid);
check('T1e photo row created as pending/ready', !!row, JSON.stringify(row));
const { readFileSync } = await import('node:fs');
const { originalsDir, safeJoin } = await import('/app/dist/lib/paths.js');
const storedHash = createHash('sha256')
  .update(readFileSync(safeJoin(originalsDir(uid), row.stored_filename))).digest('hex');
check('T1f assembled file is byte-identical to the source', storedHash === sourceHash,
  `${storedHash.slice(0, 16)} vs ${sourceHash.slice(0, 16)}`);
check('T1g session row cleaned up after completion',
  !app.db.prepare('SELECT 1 FROM upload_sessions WHERE id = ?').get(s1.id));

// ── T2 resume: skip parts the server already has ──────────────────────────
const s2 = await startSession();
await req('PUT', `/api/admin/uploads/${s2.id}/parts/0`, { raw: partOf(s2, 0) });
const partial = JSON.parse((await req('GET', `/api/admin/uploads/${s2.id}`)).body);
check('T2a resume reports only what landed', partial.received.length === 1 && partial.received[0] === 0,
  JSON.stringify(partial.received));
const early = await req('POST', `/api/admin/uploads/${s2.id}/complete`);
check('T2b completing an incomplete upload is refused', early.statusCode === 409, `got ${early.statusCode}`);
for (let i = 1; i < s2.totalParts; i += 1) {
  await req('PUT', `/api/admin/uploads/${s2.id}/parts/${i}`, { raw: partOf(s2, i) });
}
check('T2c resumed upload completes',
  (await req('POST', `/api/admin/uploads/${s2.id}/complete`)).statusCode === 202);

// ── T3 re-sending a part is idempotent ────────────────────────────────────
const s3 = await startSession();
await req('PUT', `/api/admin/uploads/${s3.id}/parts/0`, { raw: partOf(s3, 0) });
await req('PUT', `/api/admin/uploads/${s3.id}/parts/0`, { raw: partOf(s3, 0) });
const dup = JSON.parse((await req('GET', `/api/admin/uploads/${s3.id}`)).body);
check('T3 a re-sent part does not duplicate', dup.received.length === 1, JSON.stringify(dup.received));

// ── T4 the guards ─────────────────────────────────────────────────────────
const oob = await req('PUT', `/api/admin/uploads/${s3.id}/parts/${s3.totalParts}`, { raw: Buffer.alloc(10) });
check('T4a part number past the end is refused', oob.statusCode === 400, `got ${oob.statusCode}`);

const oversize = await req('PUT', `/api/admin/uploads/${s3.id}/parts/1`, {
  raw: Buffer.alloc(s3.partSize + 4096),
});
check('T4b oversized part is refused', oversize.statusCode === 400, `got ${oversize.statusCode}`);

const undersize = await req('PUT', `/api/admin/uploads/${s3.id}/parts/1`, { raw: Buffer.alloc(16) });
check('T4c undersized part is refused', undersize.statusCode === 400, `got ${undersize.statusCode}`);

const idorGet = await req('GET', `/api/admin/uploads/${s3.id}`, { token: intruderToken });
check('T4d another admin cannot read the session', idorGet.statusCode === 404, `got ${idorGet.statusCode}`);
const idorSession = await startSession(); // a clean session, so a 404 can only be the owner check
const idorPut = await req('PUT', `/api/admin/uploads/${idorSession.id}/parts/0`, {
  raw: partOf(idorSession, 0), token: intruderToken,
});
check('T4e another admin cannot write a part', idorPut.statusCode === 404, `got ${idorPut.statusCode}`);

const tooBig = await startSession('huge.jpg', 99_999_999_999);
check('T4f a file over the upload cap is refused', tooBig.status === 413, JSON.stringify(tooBig));

// ── T5 validation still applies to the assembled file ─────────────────────
const junk = Buffer.from('this is definitely not an image, no matter how it arrived');
const s5 = await req('POST', `/api/admin/albums/${uid}/uploads`, {
  body: { name: 'evil.jpg', size: junk.length },
});
const s5b = JSON.parse(s5.body);
await req('PUT', `/api/admin/uploads/${s5b.id}/parts/0`, { raw: junk });
const junkDone = await req('POST', `/api/admin/uploads/${s5b.id}/complete`);
check('T5a a non-image assembles but fails the same 415 gate', junkDone.statusCode === 415, junkDone.body);
check('T5b the rejected session is cleaned up',
  !app.db.prepare('SELECT 1 FROM upload_sessions WHERE id = ?').get(s5b.id));

// ── T6 abort + stale sweep ────────────────────────────────────────────────
const s6 = await startSession();
await req('PUT', `/api/admin/uploads/${s6.id}/parts/0`, { raw: partOf(s6, 0) });
check('T6a abort succeeds', (await req('DELETE', `/api/admin/uploads/${s6.id}`)).statusCode === 200);
check('T6b aborted session row is gone',
  !app.db.prepare('SELECT 1 FROM upload_sessions WHERE id = ?').get(s6.id));

const { uploadSweep } = await import('/app/dist/plugins/maintenance.js');
const s7 = await startSession();
await req('PUT', `/api/admin/uploads/${s7.id}/parts/0`, { raw: partOf(s7, 0) });
app.db.prepare('UPDATE upload_sessions SET created_at = ? WHERE id = ?').run(1, s7.id);
uploadSweep(app);
check('T6c stale session reclaimed by the sweep',
  !app.db.prepare('SELECT 1 FROM upload_sessions WHERE id = ?').get(s7.id));
const { existsSync } = await import('node:fs');
const { uploadSessionDir } = await import('/app/dist/lib/paths.js');
check('T6d stale session parts removed from disk', !existsSync(uploadSessionDir(s7.id)));

// A live session must survive the sweep — the whole point of resumability.
const s8 = await startSession();
await req('PUT', `/api/admin/uploads/${s8.id}/parts/0`, { raw: partOf(s8, 0) });
uploadSweep(app);
check('T6e a fresh in-flight session SURVIVES the sweep',
  !!app.db.prepare('SELECT 1 FROM upload_sessions WHERE id = ?').get(s8.id));
check('T6f its parts survive too', existsSync(uploadSessionDir(s8.id)));

// ── T7 the boot orphan sweep must not eat in-flight parts ─────────────────
const { orphanSweep } = await import('/app/dist/plugins/maintenance.js');
orphanSweep(app);
check('T7 boot orphan sweep leaves in-flight upload parts alone', existsSync(uploadSessionDir(s8.id)));

await app.close();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
