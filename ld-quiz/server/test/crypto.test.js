import { describe, it } from 'node:test';
import assert from 'node:assert';
import { encryptASEGCMPBKDF, decryptAESGCMPBKDF } from '../../shared/ld-crypto.js';

describe('Crypto (ld-crypto)', () => {
  it('encrypt -> decrypt roundtrip works', async () => {
    const plaintext = '{"title":"Test","questions":[]}';
    const password = 'my-secret-password';
    const iterations = 100000;
    
    const encrypted = await encryptASEGCMPBKDF(plaintext, password, iterations);
    assert.ok(encrypted);
    assert.ok(encrypted.includes(':'));
    
    const decrypted = await decryptAESGCMPBKDF(encrypted, password);
    assert.strictEqual(decrypted, plaintext);
  });

  it('decrypt with wrong password throws', async () => {
    const plaintext = 'secret data';
    const password = 'correct-password';
    const iterations = 100000;
    
    const encrypted = await encryptASEGCMPBKDF(plaintext, password, iterations);
    
    await assert.rejects(
      async () => decryptAESGCMPBKDF(encrypted, 'wrong-password'),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  it('decrypt with corrupted data throws', async () => {
    const plaintext = 'secret data';
    const password = 'correct-password';
    const iterations = 100000;
    
    const encrypted = await encryptASEGCMPBKDF(plaintext, password, iterations);
    const corrupted = encrypted.slice(0, -5) + 'XXXXX';
    
    await assert.rejects(
      async () => decryptAESGCMPBKDF(corrupted, password),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  it('produces different ciphertexts for same plaintext', async () => {
    const plaintext = 'same text';
    const password = 'password';
    const iterations = 100000;
    
    const encrypted1 = await encryptASEGCMPBKDF(plaintext, password, iterations);
    const encrypted2 = await encryptASEGCMPBKDF(plaintext, password, iterations);
    
    // Both should decrypt to the same plaintext
    const decrypted1 = await decryptAESGCMPBKDF(encrypted1, password);
    const decrypted2 = await decryptAESGCMPBKDF(encrypted2, password);
    assert.strictEqual(decrypted1, plaintext);
    assert.strictEqual(decrypted2, plaintext);
    
    // But ciphertexts should differ due to random salt/IV
    assert.notStrictEqual(encrypted1, encrypted2);
  });

  it('format is base64:base64:base64:base64', async () => {
    const plaintext = 'test';
    const password = 'pw';
    const iterations = 100000;
    
    const encrypted = await encryptASEGCMPBKDF(plaintext, password, iterations);
    const parts = encrypted.split(':');
    assert.strictEqual(parts.length, 4);
    
    // All parts should be valid base64
    for (const part of parts) {
      assert.ok(/^[A-Za-z0-9+/=]+$/.test(part), `Invalid base64: ${part}`);
    }
    
    // First part decodes to the iteration count
    const decodedIterations = parseInt(atob(parts[0]));
    assert.strictEqual(decodedIterations, iterations);
  });
});
