// Plain-Node test (repo has no test framework). Run: node netlify/functions/lib/allowedOrigin.test.js
const assert = require('assert');
const { resolveAllowedOrigin } = require('./allowedOrigin');

function run(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

run('bare request with no headers is rejected', () => {
  assert.strictEqual(resolveAllowedOrigin({ headers: {} }), null);
});

run('legitimate www.fprmembers.com Origin is allowed', () => {
  assert.strictEqual(
    resolveAllowedOrigin({ headers: { origin: 'https://www.fprmembers.com' } }),
    'https://www.fprmembers.com'
  );
});

run('legitimate fprmembers.com Referer is allowed when Origin absent', () => {
  assert.strictEqual(
    resolveAllowedOrigin({ headers: { referer: 'https://fprmembers.com/app/dashboard' } }),
    'https://fprmembers.com'
  );
});

run('members subdomain (storefront) is allowed', () => {
  assert.strictEqual(
    resolveAllowedOrigin({ headers: { origin: 'https://members.fprmembers.com' } }),
    'https://members.fprmembers.com'
  );
});

run('off-site Origin is rejected', () => {
  assert.strictEqual(resolveAllowedOrigin({ headers: { origin: 'https://evil.example.com' } }), null);
});

run('lookalike domain (fprmembers.com.evil.com) is rejected', () => {
  assert.strictEqual(
    resolveAllowedOrigin({ headers: { origin: 'https://fprmembers.com.evil.com' } }),
    null
  );
});

run('non-https Origin is rejected', () => {
  assert.strictEqual(resolveAllowedOrigin({ headers: { origin: 'http://www.fprmembers.com' } }), null);
});

run('malformed Origin header does not throw', () => {
  assert.strictEqual(resolveAllowedOrigin({ headers: { origin: 'not-a-url' } }), null);
});

console.log('all allowedOrigin tests passed');
