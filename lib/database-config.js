function databaseConfig(env = process.env) {
  // Nunca mistura a URL de uma instalação com o token de outra.
  const dedicated = Object.hasOwn(env, 'PROTOVIA_TURSO_DATABASE_URL') || Object.hasOwn(env, 'PROTOVIA_TURSO_AUTH_TOKEN');
  const prefix = dedicated ? 'PROTOVIA_' : '';
  const url = String(env[`${prefix}TURSO_DATABASE_URL`] || '').trim();
  const authToken = String(env[`${prefix}TURSO_AUTH_TOKEN`] || '').trim();
  if (!url || !authToken) throw new Error(`Configure ${prefix}TURSO_DATABASE_URL e ${prefix}TURSO_AUTH_TOKEN juntos.`);
  return { url, authToken };
}
module.exports = { databaseConfig };
