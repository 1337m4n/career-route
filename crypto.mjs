const ITERATIONS = 600000;
const TYPE = 'career-route-encrypted';
const encoder = new TextEncoder();
const aad = encoder.encode(TYPE + ':1');
const toBase64 = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
function fromBase64(value) {
  if (typeof value !== 'string' || value.length > 14000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('加密备份内容无效。');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
async function key(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('加密需要 HTTPS 或 localhost 安全环境。');
  if (typeof password !== 'string' || !password) throw new Error('请输入备份口令。');
  const material = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptBackup(json, password) {
  if (password.length < 12) throw new Error('导出口令至少 12 个字符；忘记口令无法恢复备份。');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt),encoder.encode(json));
  return JSON.stringify({type:TYPE,version:1,algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:ITERATIONS,salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(encrypted))},null,2);
}
export async function decodeBackup(text, password = '') {
  if (text.length > 14000000) throw new Error('备份超过 10 MB 限制。');
  const envelope = JSON.parse(text);
  if (envelope.type !== TYPE) return text;
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS) throw new Error('加密备份格式不受支持。');
  const salt = fromBase64(envelope.salt), iv = fromBase64(envelope.iv), cipher = fromBase64(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || cipher.length < 16) throw new Error('加密备份参数无效。');
  try {
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt),cipher);
    return new TextDecoder('utf-8',{fatal:true}).decode(plain);
  } catch { throw new Error('口令错误或备份已损坏。原数据未被替换。'); }
}
