const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseConfig } = require('../lib/database-config');
test('conexão dedicada tem prioridade sem misturar credenciais', () => {
  const base = { TURSO_DATABASE_URL:'turso:legacy', TURSO_AUTH_TOKEN:'legacy-test' };
  assert.equal(databaseConfig(base).url, 'turso:legacy');
  assert.deepEqual(databaseConfig({...base,PROTOVIA_TURSO_DATABASE_URL:'turso:new',PROTOVIA_TURSO_AUTH_TOKEN:'new-test'}),{url:'turso:new',authToken:'new-test'});
  assert.throws(()=>databaseConfig({...base,PROTOVIA_TURSO_DATABASE_URL:'turso:new'}));
  assert.throws(()=>databaseConfig({...base,PROTOVIA_TURSO_AUTH_TOKEN:''}));
});
