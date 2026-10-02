import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DownloadRequestStatusBadge,
  DOWNLOAD_REQUEST_STATUS_OPTIONS,
  DOWNLOAD_REQUEST_PURPOSE_LABELS,
  DERIVATIVE_TYPE_LABELS,
} from '../../../components/dam/DownloadRequestStatusBadge';

describe('DownloadRequestStatusBadge', () => {
  it('renders submitted label', () => {
    render(<DownloadRequestStatusBadge status="submitted" />);
    expect(screen.getByText('Submitted')).toBeInTheDocument();
  });

  it('renders approved label with success styling', () => {
    const { container } = render(<DownloadRequestStatusBadge status="approved" />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(container.querySelector('.text-semantic-success')).toBeTruthy();
  });

  it('renders denied label with error styling', () => {
    const { container } = render(<DownloadRequestStatusBadge status="denied" />);
    expect(screen.getByText('Denied')).toBeInTheDocument();
    expect(container.querySelector('.text-semantic-error')).toBeTruthy();
  });

  it('renders fulfilled label', () => {
    render(<DownloadRequestStatusBadge status="fulfilled" />);
    expect(screen.getByText('Fulfilled')).toBeInTheDocument();
  });

  it('renders review label as "In Review"', () => {
    render(<DownloadRequestStatusBadge status="review" />);
    expect(screen.getByText('In Review')).toBeInTheDocument();
  });

  it('falls back to raw status label for unknown status', () => {
    render(<DownloadRequestStatusBadge status="frobnicated" />);
    expect(screen.getByText('frobnicated')).toBeInTheDocument();
  });

  it('applies smaller text class when size=sm', () => {
    const { container } = render(<DownloadRequestStatusBadge status="submitted" size="sm" />);
    expect(container.querySelector('.text-xs')).toBeTruthy();
  });

  it('applies medium text class when size=md (default)', () => {
    const { container } = render(<DownloadRequestStatusBadge status="submitted" />);
    expect(container.querySelector('.text-sm')).toBeTruthy();
  });
});

describe('download request constants', () => {
  it('exports all 7 status options', () => {
    expect(DOWNLOAD_REQUEST_STATUS_OPTIONS).toHaveLength(7);
    const values = DOWNLOAD_REQUEST_STATUS_OPTIONS.map((o) => o.value);
    expect(values).toEqual([
      'submitted',
      'review',
      'approved',
      'denied',
      'fulfilled',
      'expired',
      'cancelled',
    ]);
  });

  it('exports purpose labels map with 7 entries', () => {
    expect(Object.keys(DOWNLOAD_REQUEST_PURPOSE_LABELS)).toHaveLength(7);
    expect(DOWNLOAD_REQUEST_PURPOSE_LABELS.research).toBe('Research');
  });

  it('exports derivative labels map', () => {
    expect(DERIVATIVE_TYPE_LABELS.access_master).toBe('Access Master');
    expect(DERIVATIVE_TYPE_LABELS.original).toBe('Original');
  });
});
