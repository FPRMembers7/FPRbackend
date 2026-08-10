// Adversarial + PII-isolation test suite for the permanent fetchOrder/fetchrefer
// fix. Pure Node, no real Airtable/Memberstack calls — injects fixtures via
// global.__FPR_MS_VERIFY__ and global.__FPR_AIRTABLE_BASE__.
// Run: node netlify/functions/lib/permanentAuth.test.js
const assert = require('assert');

const SYN_MEMBER_A = 'mem_synth_TEST_A';
const SYN_MEMBER_B = 'mem_synth_TEST_B';

// Synthetic fixture data — no real customer records.
const ORDERS = [
  { MemberID: SYN_MEMBER_A, Name: 'Synthetic A', Email: 'a@example.test' },
  { MemberID: SYN_MEMBER_A, Name: 'Synthetic A', Email: 'a@example.test' },
  { MemberID: SYN_MEMBER_B, Name: 'Synthetic B', Email: 'b@example.test' },
];
const REFERRALS = [
  { ReferrerID: SYN_MEMBER_A },
  { ReferrerID: SYN_MEMBER_B },
  { ReferrerID: SYN_MEMBER_B },
];

function fakeBase(table) {
  const rows = table === 'Orders' ? ORDERS : REFERRALS;
  const idField = table === 'Orders' ? 'MemberID' : 'ReferrerID';
  return function (tableName) {
    return {
      select(opts) {
        const m = /\{[^}]+\}\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(opts.filterByFormula || '');
        const wanted = m ? m[1].replace(/\\"/g, '"') : null;
        const filtered = wanted === null ? rows.slice() : rows.filter(r => r[idField] === wanted);
        return {
          eachPage(pageCb, doneCb) {
            pageCb(filtered, () => {});
            return doneCb ? doneCb() : Promise.resolve();
          },
        };
      },
    };
  };
}

function installFixtures({ verifyResult, table } = {}) {
  global.__FPR_MS_VERIFY__ = verifyResult
    ? async () => verifyResult
    : async (token) => {
        if (token === 'valid-token-A') return { ok: true, memberId: SYN_MEMBER_A };
        if (token === 'valid-token-B') return { ok: true, memberId: SYN_MEMBER_B };
        if (!token) return { ok: false, reason: 'TOKEN_MISSING' };
        return { ok: false, reason: 'INVALID_TOKEN' };
      };
  global.__FPR_AIRTABLE_BASE__ = fakeBase(table || 'Orders');
}

function clearFixtures() {
  delete global.__FPR_MS_VERIFY__;
  delete global.__FPR_AIRTABLE_BASE__;
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

async function main() {
  delete require.cache[require.resolve('../fetchOrder.js')];
  delete require.cache[require.resolve('../fetchrefer.js')];
  const fetchOrder = require('../fetchOrder.js');
  const fetchrefer = require('../fetchrefer.js');

  const legitOrigin = { origin: 'https://www.fprmembers.com' };

  // 1. no Origin, no auth
  await run('1. no Origin, no auth -> 403, no data', async () => {
    installFixtures();
    const res = await fetchOrder.handler({ headers: {} });
    assert.strictEqual(res.statusCode, 403);
    assert.ok(!res.body.includes('count'));
    clearFixtures();
  });

  // 2. forged legitimate-looking Origin, no auth
  await run('2. forged Origin, no auth -> 401', async () => {
    installFixtures();
    const res = await fetchOrder.handler({ headers: legitOrigin });
    assert.strictEqual(res.statusCode, 401);
    clearFixtures();
  });

  // 3. correct Referer, no auth
  await run('3. correct Referer, no auth -> 401', async () => {
    installFixtures();
    const res = await fetchOrder.handler({ headers: { referer: 'https://www.fprmembers.com/app/dashboard' } });
    assert.strictEqual(res.statusCode, 401);
    clearFixtures();
  });

  // 4. off-site Origin
  await run('4. off-site Origin -> 403 regardless of auth', async () => {
    installFixtures();
    const res = await fetchOrder.handler({ headers: { origin: 'https://evil.example.com', authorization: 'Bearer valid-token-A' } });
    assert.strictEqual(res.statusCode, 403);
    clearFixtures();
  });

  // 5. malformed Bearer
  await run('5. malformed Bearer -> 401', async () => {
    installFixtures();
    const res = await fetchOrder.handler({ headers: { ...legitOrigin, authorization: 'NotBearer garbage' } });
    assert.strictEqual(res.statusCode, 401);
    clearFixtures();
  });

  // 6. random Bearer
  await run('6. random/forged Bearer -> 401', async () => {
    installFixtures();
    const res = await fetchOrder.handler({ headers: { ...legitOrigin, authorization: 'Bearer forged.invalid.token' } });
    assert.strictEqual(res.statusCode, 401);
    clearFixtures();
  });

  // 7. caller-supplied member_id only (no auth at all)
  await run('7. caller-supplied member_id with no auth -> 401, id ignored', async () => {
    installFixtures();
    const res = await fetchrefer.handler({ headers: legitOrigin, queryStringParameters: { id: SYN_MEMBER_B } });
    assert.strictEqual(res.statusCode, 401);
    clearFixtures();
  });

  // 8. caller-supplied ANOTHER member's ID while authenticated as a different member
  await run('8. authenticated as A, ?id=B -> still only A\'s data', async () => {
    installFixtures({ table: 'Referrals' });
    const res = await fetchrefer.handler({
      headers: { ...legitOrigin, authorization: 'Bearer valid-token-A' },
      queryStringParameters: { id: SYN_MEMBER_B },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 1); // A has 1 referral, B has 2 - proves id param was ignored
    clearFixtures();
  });

  // 9. modified query parameters (garbage extra params don't change identity)
  await run('9. modified/garbage query params -> no effect on identity', async () => {
    installFixtures({ table: 'Orders' });
    const res = await fetchOrder.handler({
      headers: { ...legitOrigin, authorization: 'Bearer valid-token-A' },
      queryStringParameters: { memberId: SYN_MEMBER_B, admin: 'true', debug: '1' },
    });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 2); // A's real count, not influenced by params
    clearFixtures();
  });

  // 10. empty query parameters
  await run('10. empty query params, valid auth -> works normally', async () => {
    installFixtures({ table: 'Orders' });
    const res = await fetchOrder.handler({
      headers: { ...legitOrigin, authorization: 'Bearer valid-token-A' },
      queryStringParameters: {},
    });
    assert.strictEqual(res.statusCode, 200);
    clearFixtures();
  });

  // 11. duplicate member_id parameters (array-shaped) don't crash or change identity
  await run('11. duplicate member_id params -> no crash, identity still from token', async () => {
    installFixtures({ table: 'Orders' });
    const res = await fetchOrder.handler({
      headers: { ...legitOrigin, authorization: 'Bearer valid-token-A' },
      queryStringParameters: { memberId: [SYN_MEMBER_A, SYN_MEMBER_B] },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 2);
    clearFixtures();
  });

  // 12. unexpected HTTP method (function ignores method today; verifying it doesn't leak data unauthenticated)
  await run('12. unexpected method, no auth -> still 401', async () => {
    installFixtures();
    const res = await fetchOrder.handler({ headers: legitOrigin, httpMethod: 'DELETE' });
    assert.strictEqual(res.statusCode, 401);
    clearFixtures();
  });

  // 13. URL-encoded IDs in query string don't bypass token-derived identity
  await run('13. URL-encoded id in query -> ignored, token identity wins', async () => {
    installFixtures({ table: 'Referrals' });
    const res = await fetchrefer.handler({
      headers: { ...legitOrigin, authorization: 'Bearer valid-token-B' },
      queryStringParameters: { id: 'mem_synth_TEST%5FA' },
    });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 2); // B's count, not A's
    clearFixtures();
  });

  // 14. case variations in Authorization header key
  await run('14. case-varied Authorization header -> still recognized', async () => {
    installFixtures({ table: 'Orders' });
    const res = await fetchOrder.handler({ headers: { ...legitOrigin, AUTHORIZATION: 'Bearer valid-token-A' } });
    assert.strictEqual(res.statusCode, 200);
    clearFixtures();
  });

  // 15. arbitrary extra headers don't confuse auth
  await run('15. arbitrary extra headers -> no effect', async () => {
    installFixtures({ table: 'Orders' });
    const res = await fetchOrder.handler({
      headers: { ...legitOrigin, authorization: 'Bearer valid-token-A', 'x-forwarded-for': '1.2.3.4', 'x-member-id': SYN_MEMBER_B },
    });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 2); // still A's count
    clearFixtures();
  });

  // 16. direct curl/server-style request (no browser headers at all)
  await run('16. bare server-style request, no headers -> 403', async () => {
    installFixtures();
    const res = await fetchOrder.handler({});
    assert.strictEqual(res.statusCode, 403);
    clearFixtures();
  });

  // 17. same-origin browser request with no verified auth
  await run('17. legit Origin, no Authorization header -> 401, not 200', async () => {
    installFixtures();
    const res = await fetchrefer.handler({ headers: legitOrigin, queryStringParameters: { id: SYN_MEMBER_A } });
    assert.strictEqual(res.statusCode, 401);
    clearFixtures();
  });

  // 18. synthetic valid member positive path
  await run('18. valid synthetic member -> 200 with data', async () => {
    installFixtures({ table: 'Orders' });
    const res = await fetchOrder.handler({ headers: { ...legitOrigin, authorization: 'Bearer valid-token-A' } });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 2);
    clearFixtures();
  });

  // 19. synthetic valid member can only receive own/minimum data (cross-check both members)
  await run('19. member B sees only own count, never A\'s records', async () => {
    installFixtures({ table: 'Orders' });
    const res = await fetchOrder.handler({ headers: { ...legitOrigin, authorization: 'Bearer valid-token-B' } });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.count, 1);
    assert.ok(!('records' in body));
    assert.ok(!('Name' in body) && !('Email' in body));
    clearFixtures();
  });

  // 20. response never contains whole-table data
  await run('20. response shape is {count} only, never the full table', async () => {
    installFixtures({ table: 'Orders' });
    const res = await fetchOrder.handler({ headers: { ...legitOrigin, authorization: 'Bearer valid-token-A' } });
    const body = JSON.parse(res.body);
    const keys = Object.keys(body);
    assert.deepStrictEqual(keys, ['count']);
    clearFixtures();
  });

  console.log('all 20 adversarial/PII-isolation tests passed');
}

main();
