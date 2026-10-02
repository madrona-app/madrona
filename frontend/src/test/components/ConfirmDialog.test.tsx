import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../../components/ConfirmDialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
  };

  describe('rendering', () => {
    it('renders nothing when closed', () => {
      const { container } = render(<ConfirmDialog {...defaultProps} isOpen={false} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders dialog when open', () => {
      render(<ConfirmDialog {...defaultProps} />);
      expect(screen.getByText('Confirm Action')).toBeInTheDocument();
      expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
    });

    it('renders default button text', () => {
      render(<ConfirmDialog {...defaultProps} />);
      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('renders custom button text', () => {
      render(
        <ConfirmDialog
          {...defaultProps}
          confirmText="Delete"
          cancelText="Keep"
        />
      );
      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.getByText('Keep')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onClose when cancel button clicked', () => {
      const onClose = vi.fn();
      render(<ConfirmDialog {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByText('Cancel'));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onConfirm and onClose when confirm button clicked', () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();
      render(
        <ConfirmDialog
          {...defaultProps}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      );

      fireEvent.click(screen.getByText('Confirm'));

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when clicking backdrop', () => {
      const onClose = vi.fn();
      render(<ConfirmDialog {...defaultProps} onClose={onClose} />);

      // ConfirmDialog renders into ModalPortal — query from document.body
      const backdrop = document.body.querySelector('.bg-ink\\/50');
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when clicking modal content', () => {
      const onClose = vi.fn();
      render(<ConfirmDialog {...defaultProps} onClose={onClose} />);

      // Click on the modal content (not the backdrop)
      fireEvent.click(screen.getByText('Confirm Action'));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('styles', () => {
    it('uses primary (bark) style by default', () => {
      render(<ConfirmDialog {...defaultProps} />);
      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton.className).toContain('bg-bark');
    });

    it('uses danger (semantic-error) style when specified', () => {
      render(<ConfirmDialog {...defaultProps} confirmStyle="danger" />);
      const confirmButton = screen.getByText('Confirm');
      expect(confirmButton.className).toContain('bg-semantic-error');
    });
  });

  describe('accessibility', () => {
    it('renders title with id for accessibility', () => {
      render(<ConfirmDialog {...defaultProps} />);
      const title = screen.getByText('Confirm Action');
      expect(title.id).toBeTruthy();
    });

    it('renders message with id for accessibility', () => {
      render(<ConfirmDialog {...defaultProps} />);
      const message = screen.getByText('Are you sure you want to proceed?');
      expect(message.id).toBeTruthy();
    });
  });
});
