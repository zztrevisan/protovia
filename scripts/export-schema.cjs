// Gera apenas o esquema, em memória. Não abre bancos operacionais.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const filename = path.resolve(__dirname, '../banco/db.js');
const source = fs.readFileSync(filename, 'utf8').replace('new DatabaseSync(bancoPath)', "new DatabaseSync(':memory:')");
const isolated = new Module(filename, module);
isolated.filename = filename;
isolated.paths = Module._nodeModulePaths(path.dirname(filename));
isolated._compile(source, filename);
const db = isolated.exports;
const statements = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name").all();
fs.writeFileSync(path.resolve(__dirname, '../banco/schema.sql'), statements.map(row => row.sql.replace(/^CREATE TABLE /,'CREATE TABLE IF NOT EXISTS ').replace(/^CREATE UNIQUE INDEX /,'CREATE UNIQUE INDEX IF NOT EXISTS ').replace(/^CREATE INDEX /,'CREATE INDEX IF NOT EXISTS ')+';').join('\n\n')+'\n');
db.close();
