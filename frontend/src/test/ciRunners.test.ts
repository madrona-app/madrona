import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

/**
 * Every CI job runs on a pinned runner image, never a floating `-latest`
 * label.
 *
 * `ubuntu-latest` is moved to a new Ubuntu release on GitHub's schedule, not
 * ours — the move to Ubuntu 26 was announced for 19 October 2026 — and it
 * moves every job at once, the release included. apt packages, the Docker
 * version, Playwright's browser dependencies and the toolcaches can all
 * change underneath a pipeline that did not change. Pinning makes that an
 * upgrade made in a pull request whose checks pass.
 */

const WORKFLOWS = join(__dirname, '../../../.github/workflows');

describe('CI runners', () => {
  it('pins every job to a versioned runner image', () => {
    const jobs = readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) =>
        readFileSync(join(WORKFLOWS, f), 'utf8')
          .split('\n')
          .map((line, i) => ({ where: `${f}:${i + 1}`, line: line.trim() }))
          .filter(({ line }) => line.startsWith('runs-on:')),
      );

    // Guards the assertion below against passing because nothing was read.
    expect(jobs.length).toBeGreaterThan(0);

    const floating = jobs
      .filter(({ line }) => /-latest\b/.test(line))
      .map(({ where, line }) => `${where}: ${line}`);
    expect(floating, `pin these to a versioned image:\n${floating.join('\n')}`).toEqual([]);
  });
});
