/**
 * Shared workspace + section primitive stubs for ObjectEntryWorkspacePage
 * section component tests. Import the factories and pass them to vi.mock().
 *
 * Each section test file must declare:
 *   vi.mock('../../../components/workspace', () => createWorkspaceStubs());
 *
 * (vi.mock is hoisted, so we can call factories at module top level.)
 */

import React from 'react';
import { vi } from 'vitest';

export function createWorkspaceStubs() {
  return {
    WorkspaceSection: ({
      title,
      children,
      onToggle,
      isExpanded,
      badge,
      icon: _icon,
    }: {
      title: string;
      children: React.ReactNode;
      onToggle: () => void;
      isExpanded: boolean;
      badge?: React.ReactNode;
      icon?: React.ReactNode;
    }) => (
      <section data-testid="ws-section">
        <button onClick={onToggle}>{title}</button>
        {badge && <div data-testid="ws-badge">{badge}</div>}
        {isExpanded && <div>{children}</div>}
      </section>
    ),
    EditableField: ({
      label,
      value,
      isEditing,
      onChange,
      type,
      required,
      multiline,
    }: {
      label: string;
      value: string;
      isEditing: boolean;
      onChange: (v: string) => void;
      type?: string;
      required?: boolean;
      multiline?: boolean;
    }) => (
      <label data-testid={`ef-${label}`}>
        <span>
          {label}
          {required && '*'}
        </span>
        {isEditing ? (
          multiline ? (
            <textarea
              aria-label={label}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <input
              aria-label={label}
              type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )
        ) : (
          <span data-testid={`view-${label}`}>{value}</span>
        )}
      </label>
    ),
    EditableSelect: ({
      label,
      value,
      isEditing,
      onChange,
      options,
      required,
    }: {
      label: string;
      value: string;
      isEditing: boolean;
      onChange: (v: string) => void;
      options: Array<{ value: string; label: string }>;
      required?: boolean;
    }) =>
      isEditing ? (
        <label data-testid={`es-${label}`}>
          <span>
            {label}
            {required && '*'}
          </span>
          <select
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div data-testid={`es-view-${label}`}>
          {options.find((o) => o.value === value)?.label ?? value}
        </div>
      ),
  };
}

export function createCompletionBadgeStub() {
  return {
    SectionCompletionBadge: ({
      completion,
    }: {
      completion: { percentage: number; requiredComplete?: boolean };
    }) => (
      <span data-testid="completion-badge">
        {completion.percentage}%
      </span>
    ),
  };
}

// Helper used by callers to keep vi import in scope (suppresses unused warning)
export const _ = vi;
