import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScalarDiff } from '../../../components/audit/ScalarDiff';

describe('ScalarDiff', () => {
  it('renders both old and new string values with an arrow separator', () => {
    render(<ScalarDiff oldValue="Old Title" newValue="New Title" />);
    expect(screen.getByText('Old Title')).toBeInTheDocument();
    expect(screen.getByText('New Title')).toBeInTheDocument();
    // Right arrow separator
    expect(screen.getByText('→')).toBeInTheDocument();
  });

  it('shows "(empty)" italic placeholder when old value is null', () => {
    render(<ScalarDiff oldValue={null} newValue="Hello" />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows "(cleared)" italic placeholder when new value is null', () => {
    render(<ScalarDiff oldValue="Old" newValue={null} />);
    expect(screen.getByText('Old')).toBeInTheDocument();
    expect(screen.getByText('(cleared)')).toBeInTheDocument();
  });

  it('shows "(empty)" for empty string old value', () => {
    render(<ScalarDiff oldValue="" newValue="Filled" />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
  });

  it('renders numeric values', () => {
    render(<ScalarDiff oldValue={1} newValue={42} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders booleans', () => {
    render(<ScalarDiff oldValue={false} newValue={true} />);
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('formats enum values when fieldName matches a known enum', () => {
    render(
      <ScalarDiff
        fieldName="object_status"
        oldValue="on_loan"
        newValue="pending"
      />,
    );
    expect(screen.getByText('On Loan')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('passes through unknown enum values for known fields', () => {
    render(
      <ScalarDiff
        fieldName="object_status"
        oldValue="custom_status"
        newValue="another_one"
      />,
    );
    expect(screen.getByText('custom_status')).toBeInTheDocument();
    expect(screen.getByText('another_one')).toBeInTheDocument();
  });

  it('truncates long string values according to maxLength', () => {
    const long = 'a'.repeat(120);
    render(<ScalarDiff oldValue={long} newValue="short" maxLength={20} />);
    // Long value should be truncated with ellipsis (…)
    const found = screen.getByText((_, el) =>
      Boolean(el && el.textContent && el.textContent.endsWith('…')),
    );
    expect(found).toBeInTheDocument();
  });
});
