import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseDiagnostic,validateDatabaseUrl} from './database-diagnostics.js';

test('diagnóstico identifica falhas comuns sem revelar campos privados do driver',()=>{
 const secret='PRIVATE-CREDENTIAL-DO-NOT-LOG';
 for(const [code,expected] of [['28P01','DB_AUTH_FAILED'],['ENOTFOUND','DB_HOST_NOT_FOUND'],['42501','DB_PERMISSION_DENIED'],['3D000','DB_NOT_FOUND'],['ETIMEDOUT','DB_CONNECTION_TIMEOUT'],['ERR_TLS_CERT_ALTNAME_INVALID','DB_TLS_CERTIFICATE']]){
  const text=databaseDiagnostic({code,message:secret,detail:secret,stack:secret});
  assert.ok(text.includes(expected));assert.ok(!text.includes(secret));
 }
 assert.match(databaseDiagnostic({errors:[{code:'ECONNREFUSED'}]}),/DB_CONNECTION_REFUSED/);
 assert.match(databaseDiagnostic({message:'Connection terminated due to connection timeout: '+secret}),/DB_CONNECTION_TIMEOUT/);
 assert.ok(!databaseDiagnostic({code:secret,message:secret,detail:secret}).includes(secret));
 assert.match(databaseDiagnostic(null),/DB_INIT_FAILED/);
});

test('conexão rejeita senha mascarada e comandos, preservando senhas reais e parâmetros TLS',()=>{
 const valid='postgresql://neondb_owner:example-secret@db.example.test/neondb?sslmode=require&channel_binding=require';
 assert.equal(validateDatabaseUrl('  '+valid+'  '),valid);
 for(const password of ['********','%2A%2A%2A','%E2%80%A2%E2%80%A2'])assert.throws(()=>validateDatabaseUrl(`postgresql://owner:${password}@db.example.test/neondb`),/DB_URL_MASKED/);
 for(const value of [`psql '${valid}'`,`'${valid}'`,`DATABASE_URL=${valid}`,'postgresql://owner@db.example.test/neondb','not a URL'])assert.throws(()=>validateDatabaseUrl(value),/DB_URL_INVALID/);
 assert.equal(validateDatabaseUrl('postgresql://owner:real*password@db.example.test/neondb'),'postgresql://owner:real*password@db.example.test/neondb');
});
