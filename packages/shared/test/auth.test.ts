import { describe, expect, it } from 'vitest';
import { demoLoginSchema, loginSchema, registerSchema } from '../src';

const valid = { email: ' Awa.Diop@Mail.SN ', password: 'motdepasse', name: ' Awa Diop ' };

describe('registerSchema', () => {
  it('nettoie l’e-mail et le nom', () => {
    expect(registerSchema.parse(valid)).toEqual({
      email: 'awa.diop@mail.sn',
      password: 'motdepasse',
      name: 'Awa Diop',
    });
  });

  it.each([
    ['e-mail invalide', { ...valid, email: 'awa@' }],
    ['mot de passe trop court', { ...valid, password: 'court' }],
    ['mot de passe > 72 octets', { ...valid, password: 'é'.repeat(37) }],
    ['nom trop court', { ...valid, name: 'A' }],
    ['champ inconnu', { ...valid, role: 'admin' }],
  ])('refuse : %s', (_label, input) => {
    expect(registerSchema.safeParse(input).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('n’impose pas de longueur minimale (seulement non vide)', () => {
    expect(loginSchema.safeParse({ email: 'a@b.sn', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.sn', password: '' }).success).toBe(false);
  });
});

describe('demoLoginSchema', () => {
  it('accepte voyageur et contrôleur, refuse admin', () => {
    expect(demoLoginSchema.safeParse({ role: 'traveler' }).success).toBe(true);
    expect(demoLoginSchema.safeParse({ role: 'controller' }).success).toBe(true);
    expect(demoLoginSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
});
