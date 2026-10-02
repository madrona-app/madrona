/**
 * Accessibility testing utilities using axe-core
 */
import { axe } from 'vitest-axe';
import { toHaveNoViolations } from 'vitest-axe/matchers';
import type { AxeResults, RunOptions } from 'axe-core';

export { axe, toHaveNoViolations };

/**
 * Default axe configuration for this project
 */
export const defaultAxeConfig: RunOptions = {
  rules: {
    // Disable rules that may conflict with our styling approach
    'color-contrast': { enabled: true },
    'link-in-text-block': { enabled: false }, // Can be overly strict
  },
};

/**
 * Run accessibility check on a container element
 * @param container - The DOM container to check
 * @param config - Optional axe configuration overrides
 * @returns Promise<AxeResults>
 */
export async function checkA11y(
  container: Element,
  config?: RunOptions
): Promise<AxeResults> {
  return axe(container, { ...defaultAxeConfig, ...config });
}

/**
 * Format axe violations for readable test output
 */
export function formatViolations(results: AxeResults): string {
  if (results.violations.length === 0) {
    return 'No accessibility violations found';
  }

  return results.violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  - ${node.html}\n    ${node.failureSummary}`)
        .join('\n');
      return `${violation.id} (${violation.impact}): ${violation.description}\n${nodes}`;
    })
    .join('\n\n');
}
