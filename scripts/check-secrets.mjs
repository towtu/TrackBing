import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(process.argv.includes('--dist')){function walk(dir){for(const name of readdirSync(dir)){const p=join(dir,name);if(statSync(p).isDirectory())walk(p);else files.push(p);}}walk('dist');}
const patterns=[/AIza[0-9A-Za-z_-]{30,}/g,/\bsk_(?:live|test)_[0-9a-zA-Z]{24,}\b/g,/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,/EXPO_PUBLIC_(?:GEMINI|DEEPSEEK|TAVILY|USDA)_API_KEY/g,/EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']?eyJ/g];
let failures=0;for(const file of files){if(/\.(?:png|ico|jpg|jpeg|webp|ttf|woff2?|zip)$/.test(file))continue;const text=readFileSync(file,'utf8');for(const pattern of patterns){pattern.lastIndex=0;if(pattern.test(text)){console.error(`Potential server secret in ${file}; inspect locally and rotate if real.`);failures++;}}if(/\.env(?:\.|$)/.test(file)&&!file.endsWith('.example')){console.error(`Real environment file tracked: ${file}`);failures++;}}
if(failures)process.exit(1);console.log(`Secret patterns checked in ${files.length} tracked/export files; no values printed. This is a pattern scan, not proof against every credential format.`);
