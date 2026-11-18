import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTicketSigner } from '../src/lib/ticket-codes';

const SECRET = 'secret-des-billets-de-test-de-plus-de-32-car';
const signer = createTicketSigner(SECRET);
const ticketId = '7b0f8e8e-2c8a-4d7e-9f0a-1c2b3d4e5f60';
const otherId = '00000000-0000-4000-8000-000000000000';

describe('createTicketSigner', () => {
  it('code = base64url(id) + "." + base64url(HMAC-SHA256(secret, id))', () => {
    const expected = `${Buffer.from(ticketId).toString('base64url')}.${createHmac('sha256', SECRET)
      .update(ticketId)
      .digest('base64url')}`;

    expect(signer.sign(ticketId)).toBe(expected);
  });

  it('vérifie un code authentique et renvoie l’identifiant du billet', () => {
    expect(signer.verify(signer.sign(ticketId))).toBe(ticketId);
  });

  it('refuse un code signé avec un autre secret', () => {
    const forged = createTicketSigner('un-autre-secret-de-plus-de-32-caracteres!!').sign(ticketId);
    expect(signer.verify(forged)).toBeNull();
  });

  it('refuse un identifiant remplacé (signature d’un autre billet)', () => {
    const [, signature] = signer.sign(ticketId).split('.');
    const swapped = `${Buffer.from(otherId).toString('base64url')}.${signature}`;
    expect(signer.verify(swapped)).toBeNull();
  });

  it('refuse une signature modifiée d’un seul caractère', () => {
    const code = signer.sign(ticketId);
    const last = code.at(-2) === 'A' ? 'B' : 'A';
    const tampered = `${code.slice(0, -2)}${last}${code.at(-1)}`;
    expect(signer.verify(tampered)).toBeNull();
  });

  it('refuse une écriture non canonique du même code (décodage base64url tolérant)', () => {
    const code = signer.sign(ticketId);
    expect(signer.verify(`${code}=`)).toBeNull();
    expect(signer.verify(code.replace('.', '.\n'))).toBeNull();
  });

  it.each([
    ['vide', ''],
    ['sans point', 'abcdef'],
    ['trois parties', 'a.b.c'],
    ['identifiant qui n’est pas un UUID', `${Buffer.from('billet-42').toString('base64url')}.abc`],
    ['signature trop courte', `${Buffer.from(ticketId).toString('base64url')}.abc`],
    ['charabia', '%%%.%%%'],
  ])('refuse un code mal formé : %s', (_label, code) => {
    expect(signer.verify(code)).toBeNull();
  });
});
