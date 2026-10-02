import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

/**
 * CI and the shipped image must build the frontend on the same Node major.
 *
 * They did not: every setup-node step pinned Node 20 while frontend/Dockerfile
 * built the released image on node:24-alpine, so the runtime that produced the
 * release was one CI never ran. frontend/.nvmrc is now the single source — the
 * workflows read it through node-version-file — and this guards the one place
 * that cannot read it, the Dockerfile's FROM line.
 */

const FRONTEND = join(__dirname, '../..');
const WORKFLOWS = join(FRONTEND, '../.github/workflows');

function nvmrcMajor(): string {
  const raw = readFileSync(join(FRONTEND, '.nvmrc'), 'utf8').trim();
  const major = raw.replace(/^v/, '').split('.')[0];
  expect(major, `.nvmrc should name a Node major, got "${raw}"`).toMatch(/^\d+$/);
  return major;
}

describe('Node version', () => {
  it('builds the image on the Node major in .nvmrc', () => {
    const dockerfile = readFileSync(join(FRONTEND, 'Dockerfile'), 'utf8');
    const from = dockerfile.match(/^FROM node:(\d+)/m);
    expect(from, 'frontend/Dockerfile should start FROM node:<major>').not.toBeNull();
    expect(from![1]).toBe(nvmrcMajor());
  });

  it('has every workflow read .nvmrc instead of pinning its own version', () => {
    const pinned = readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) =>
        readFileSync(join(WORKFLOWS, f), 'utf8')
          .split('\n')
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => /^\s*node-version\s*:/.test(line)),
      )
      .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`);
    expect(pinned, `use node-version-file: frontend/.nvmrc instead:\n${pinned.join('\n')}`).toEqual(
      [],
    );
  });
});
