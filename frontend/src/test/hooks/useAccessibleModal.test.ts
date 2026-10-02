import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';

describe('useAccessibleModal', () => {
  const mockOnClose = vi.fn();
  let _originalActiveElement: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a button to be the "previous" active element
    const button = document.createElement('button');
    button.id = 'test-button';
    document.body.appendChild(button);
    button.focus();
    _originalActiveElement = button;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('return values', () => {
    it('returns modalRef', () => {
      const { result } = renderHook(() =>
        useAccessibleModal({
          isOpen: false,
          onClose: mockOnClose,
          titlePrefix: 'test-modal',
        })
      );

      expect(result.current.modalRef).toBeDefined();
      expect(result.current.modalRef.current).toBeNull();
    });

    it('returns titleId based on prefix', () => {
      const { result } = renderHook(() =>
        useAccessibleModal({
          isOpen: false,
          onClose: mockOnClose,
          titlePrefix: 'my-dialog',
        })
      );

      expect(result.current.titleId).toBe('my-dialog-title');
    });

    it('returns descriptionId based on prefix', () => {
      const { result } = renderHook(() =>
        useAccessibleModal({
          isOpen: false,
          onClose: mockOnClose,
          titlePrefix: 'my-dialog',
        })
      );

      expect(result.current.descriptionId).toBe('my-dialog-description');
    });
  });

  describe('ESC key handling', () => {
    it('calls onClose when ESC is pressed while modal is open', () => {
      renderHook(() =>
        useAccessibleModal({
          isOpen: true,
          onClose: mockOnClose,
          titlePrefix: 'test-modal',
        })
      );

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when ESC is pressed while modal is closed', () => {
      renderHook(() =>
        useAccessibleModal({
          isOpen: false,
          onClose: mockOnClose,
          titlePrefix: 'test-modal',
        })
      );

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('does not call onClose for other keys', () => {
      renderHook(() =>
        useAccessibleModal({
          isOpen: true,
          onClose: mockOnClose,
          titlePrefix: 'test-modal',
        })
      );

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(event);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('removes event listener when modal closes', () => {
      const { rerender } = renderHook(
        ({ isOpen }) =>
          useAccessibleModal({
            isOpen,
            onClose: mockOnClose,
            titlePrefix: 'test-modal',
          }),
        { initialProps: { isOpen: true } }
      );

      // Close the modal
      rerender({ isOpen: false });

      // ESC should not trigger onClose anymore
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('removes event listener on unmount', () => {
      const { unmount } = renderHook(() =>
        useAccessibleModal({
          isOpen: true,
          onClose: mockOnClose,
          titlePrefix: 'test-modal',
        })
      );

      unmount();

      // ESC should not trigger onClose anymore
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('isOpen changes', () => {
    it('sets up listeners when modal opens', () => {
      const { rerender } = renderHook(
        ({ isOpen }) =>
          useAccessibleModal({
            isOpen,
            onClose: mockOnClose,
            titlePrefix: 'test-modal',
          }),
        { initialProps: { isOpen: false } }
      );

      // ESC should not work when closed
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(mockOnClose).not.toHaveBeenCalled();

      // Open the modal
      rerender({ isOpen: true });

      // Now ESC should work
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });
});

describe('getModalAriaProps', () => {
  it('returns basic aria props', () => {
    const props = getModalAriaProps('my-title');

    expect(props.role).toBe('dialog');
    expect(props['aria-modal']).toBe(true);
    expect(props['aria-labelledby']).toBe('my-title');
    expect(props.tabIndex).toBe(-1);
  });

  it('includes aria-describedby when descriptionId is provided', () => {
    const props = getModalAriaProps('my-title', 'my-description');

    expect(props['aria-describedby']).toBe('my-description');
  });

  it('does not include aria-describedby when descriptionId is undefined', () => {
    const props = getModalAriaProps('my-title');

    expect(props['aria-describedby']).toBeUndefined();
  });

  it('does not include aria-describedby when descriptionId is empty string', () => {
    const props = getModalAriaProps('my-title', '');

    expect(props['aria-describedby']).toBeUndefined();
  });
});
