import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
async function main() {
  const mod = await import('./src/common/checksum/hash72.ts');
  const { HASH72_AES_KEY } = mod;
  const raw = new Uint8Array(readFileSync('/tmp/apple-3alb.bin'));
  const c1 = Buffer.from(raw.subarray(0x72 + 14, 0x72 + 30));
  // node reference
  const d = createDecipheriv('aes-128-ecb', Buffer.from(HASH72_AES_KEY), null);
  d.setAutoPadding(false);
  const nodeDec = new Uint8Array(Buffer.concat([d.update(c1), d.final()]));
  console.log('node dec c1:', Buffer.from(nodeDec).toString('hex'));
  // js reference
  const saved = (globalThis as any).process;
  (globalThis as any).process = undefined;
  try {
    const mod2 = await import('./src/common/checksum/hash72.ts');
    // expose the internal decrypt via a fresh import path
    globalThis.__c1 = c1;
    // re-import with process cleared — module already loaded; call through extract
    const jsDec = await (mod2 as any).__testDecrypt ? await (mod2 as any).__testDecrypt(c1) : 'no-exposure';
    console.log('js dec c1   :', typeof jsDec === 'string' ? jsDec : Buffer.from(jsDec).toString('hex'));
  } finally { (globalThis as any).process = saved; }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
