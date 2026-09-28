import { mkdir, copyFile, readdir } from 'node:fs/promises';
// An explicit allowlist keeps PRDs, design screenshots, backups and test fixtures off the public site.
const files = ['index.html','styles.css','app.js','data.mjs','rules.mjs','crypto.mjs','reminders.mjs','favicon.svg'];
await mkdir(new URL('./dist/',import.meta.url),{recursive:true});
if ((await readdir(new URL('./dist/',import.meta.url))).some(file=>!files.includes(file))) throw new Error('dist 包含非发布文件；拒绝上传，请先检查旧构建产物。');
for (const file of files) await copyFile(new URL(file,import.meta.url),new URL('dist/'+file,import.meta.url));
console.log(`Prepared ${files.length} public assets; no user data included.`);
