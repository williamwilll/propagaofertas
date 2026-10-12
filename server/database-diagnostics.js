const errors = {
 '28P01':['DB_AUTH_FAILED','O Neon recusou a senha. Copie novamente a conexão completa em Conectar e atualize DATABASE_URL no Render.'],
 '28000':['DB_AUTH_FAILED','O Neon recusou a autenticação. Confira o usuário e a senha da conexão selecionada.'],
 '3D000':['DB_NOT_FOUND','O banco informado na conexão não existe. Copie a URL do banco correto no Neon.'],
 '42501':['DB_PERMISSION_DENIED','O usuário do banco não tem permissão para criar ou acessar as tabelas. Confira o papel selecionado no Neon.'],
 'ENOTFOUND':['DB_HOST_NOT_FOUND','O endereço do banco não foi encontrado. Copie novamente a URL do Neon sem editar o hostname.'],
 'EAI_AGAIN':['DB_DNS_TEMPORARY','Falha temporária de DNS. Tente o deploy novamente.'],
 'ECONNREFUSED':['DB_CONNECTION_REFUSED','A conexão foi recusada. Confira a disponibilidade e as restrições de rede do projeto Neon.'],
 'ETIMEDOUT':['DB_CONNECTION_TIMEOUT','A conexão demorou demais. Confira a disponibilidade do Neon e tente o deploy novamente.'],
 'ECONNRESET':['DB_CONNECTION_RESET','A conexão foi interrompida. Confira a disponibilidade do Neon e tente novamente.'],
 '53300':['DB_CONNECTION_LIMIT','O banco atingiu o limite de conexões. Use a conexão com agrupamento do Neon.'],
 '57P03':['DB_STARTING','O banco ainda não aceita conexões. Aguarde sua inicialização e tente novamente.'],
 'ERR_TLS_CERT_ALTNAME_INVALID':['DB_TLS_CERTIFICATE','O certificado não corresponde ao endereço. Confira o hostname da conexão; não desative a verificação TLS.'],
 'CERT_HAS_EXPIRED':['DB_TLS_CERTIFICATE','O certificado TLS expirou. Verifique o serviço Neon; não desative a verificação TLS.'],
 'SELF_SIGNED_CERT_IN_CHAIN':['DB_TLS_CERTIFICATE','A cadeia do certificado TLS não é confiável. Confira a conexão e o serviço Neon.'],
 'DEPTH_ZERO_SELF_SIGNED_CERT':['DB_TLS_CERTIFICATE','O certificado TLS não é confiável. Confira a conexão e o serviço Neon.'],
 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':['DB_TLS_CERTIFICATE','Não foi possível verificar o certificado TLS. Confira a conexão e o serviço Neon.'],
 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':['DB_TLS_CERTIFICATE','Não foi possível verificar a autoridade do certificado TLS. Confira o serviço Neon.'],
 'DB_URL_INVALID':['DB_URL_INVALID','DATABASE_URL deve conter somente a URL PostgreSQL completa, sem aspas, comando psql ou nome da variável.'],
 'DB_URL_MASKED':['DB_URL_MASKED','DATABASE_URL contém a senha mascarada. Copie a conexão com a senha real diretamente do Neon para o Render.']
};
export function databaseDiagnostic(error){
 // Only static, allowlisted messages leave this function. Never output raw messages,
 // connection strings, SQL, hostnames, stacks or driver error detail fields.
 const candidates=[error,error?.cause,...(Array.isArray(error?.errors)?error.errors.slice(0,5):[])];
 for(const item of candidates){
  if(typeof item?.code==='string'&&Object.hasOwn(errors,item.code)){
   const [code,message]=errors[item.code];return `[${code}] ${message}`;
  }
 }
 if(candidates.some(e=>typeof e?.message==='string'&&/timeout|timed out|connection terminated due to connection timeout/i.test(e.message)))return `[${errors.ETIMEDOUT[0]}] ${errors.ETIMEDOUT[1]}`;
 return '[DB_INIT_FAILED] Não foi possível inicializar o banco. Confira a conexão e a disponibilidade do Neon. A causa não foi reconhecida pelo diagnóstico seguro.';
}
export function validateDatabaseUrl(value){
 const invalid=code=>{const error=new Error(databaseDiagnostic({code}));error.code=code;throw error;};
 let url;
 try{url=new URL(value.trim());}catch{invalid('DB_URL_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||url.pathname.length<2||url.hash)invalid('DB_URL_INVALID');
 let password;
 try{password=decodeURIComponent(url.password);}catch{invalid('DB_URL_INVALID');}
 if(/^[*•●]+$/.test(password))invalid('DB_URL_MASKED');
 return value.trim();
}
