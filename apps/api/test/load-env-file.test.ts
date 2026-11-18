import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from '../src/config/load-env-file';

describe('loadEnvFile', () => {
  afterEach(() => {
    delete process.env.TEST_LOAD_A;
    delete process.env.TEST_LOAD_B;
  });

  it('charge les variables absentes sans écraser celles déjà définies', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    writeFileSync(file, 'TEST_LOAD_A=depuis-fichier\nTEST_LOAD_B="valeur b"\n');
    process.env.TEST_LOAD_A = 'deja-la';

    expect(loadEnvFile(file)).toBe(true);
    expect(process.env.TEST_LOAD_A).toBe('deja-la');
    expect(process.env.TEST_LOAD_B).toBe('valeur b');
  });

  it('retourne false si le fichier n’existe pas', () => {
    expect(loadEnvFile(join(tmpdir(), 'inexistant', '.env'))).toBe(false);
  });
});
