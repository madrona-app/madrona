import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MfaVerifyForm from '../../components/MfaVerifyForm';

describe('MfaVerifyForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();
  const mockOnVerify = vi.fn();

  const defaultProps = {
    email: 'test@example.com',
    session: 'session-123',
    onSuccess: mockOnSuccess,
    onCancel: mockOnCancel,
    onVerify: mockOnVerify,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('rendering', () => {
    it('renders MFA verification form', () => {
      render(<MfaVerifyForm {...defaultProps} />);

      expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('shows authenticator app instruction by default', () => {
      render(<MfaVerifyForm {...defaultProps} />);

      expect(screen.getByText(/enter the code from your authenticator app/i)).toBeInTheDocument();
    });

    it('shows SMS instruction when mfaType is sms', () => {
      render(<MfaVerifyForm {...defaultProps} mfaType="sms" />);

      expect(screen.getByText(/enter the code sent to your phone/i)).toBeInTheDocument();
    });

    it('shows email instruction with masked recipient when mfaType is email', () => {
      render(<MfaVerifyForm {...defaultProps} mfaType="email" />);

      // Masked address keeps the first 2 chars of the local part and the
      // domain, replacing the rest with bullets — confirms identity
      // without leaking the full address to a shoulder-surfer.
      expect(screen.getByText(/enter the code we sent to te.*@example\.com/i)).toBeInTheDocument();
    });
  });

  describe('code input validation', () => {
    it('only allows numeric input', async () => {
      const user = userEvent.setup();
      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, 'abc123def456');

      expect(input).toHaveValue('123456');
    });

    it('limits input to 6 digits', async () => {
      const user = userEvent.setup();
      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '12345678');

      expect(input).toHaveValue('123456');
    });

    it('prevents submission with less than 6 digits via disabled button', async () => {
      const user = userEvent.setup();
      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123');

      // The verify button should be disabled, preventing submission
      const verifyButton = screen.getByRole('button', { name: /verify/i });
      expect(verifyButton).toBeDisabled();

      // onVerify should not be called
      expect(mockOnVerify).not.toHaveBeenCalled();
    });

    it('verify button is disabled when code is not 6 digits', async () => {
      const user = userEvent.setup();
      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123');

      expect(screen.getByRole('button', { name: /verify/i })).toBeDisabled();
    });

    it('verify button is enabled when code is 6 digits', async () => {
      const user = userEvent.setup();
      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');

      expect(screen.getByRole('button', { name: /verify/i })).not.toBeDisabled();
    });
  });

  describe('form submission', () => {
    it('calls onVerify with correct parameters', async () => {
      const user = userEvent.setup();
      mockOnVerify.mockResolvedValueOnce({});

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        expect(mockOnVerify).toHaveBeenCalledWith(
          'test@example.com',
          '123456',
          'session-123',
          'totp',
        );
      });
    });

    it('passes mfaType through to onVerify so backend picks the right challenge', async () => {
      const user = userEvent.setup();
      mockOnVerify.mockResolvedValueOnce({});

      render(<MfaVerifyForm {...defaultProps} mfaType="email" />);
      await user.type(screen.getByLabelText(/verification code/i), '987654');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        expect(mockOnVerify).toHaveBeenCalledWith(
          'test@example.com',
          '987654',
          'session-123',
          'email',
        );
      });
    });

    it('calls onSuccess after successful verification', async () => {
      const user = userEvent.setup();
      mockOnVerify.mockResolvedValueOnce({});

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalled();
      });
    });

    it('shows loading state during verification', async () => {
      const user = userEvent.setup();

      mockOnVerify.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      expect(screen.getByRole('button', { name: /verifying/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /verifying/i })).toBeDisabled();
    });

    it('disables input during verification', async () => {
      const user = userEvent.setup();

      mockOnVerify.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      expect(input).toBeDisabled();
    });
  });

  describe('error handling', () => {
    it('shows error message on verification failure', async () => {
      const user = userEvent.setup();
      mockOnVerify.mockRejectedValueOnce(new Error('Invalid code'));

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      expect(await screen.findByText(/invalid code. please check and try again/i)).toBeInTheDocument();
    });

    it('clears code input on error', async () => {
      const user = userEvent.setup();
      mockOnVerify.mockRejectedValueOnce(new Error('Invalid code'));

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        expect(input).toHaveValue('');
      });
    });

    it('clears error when typing new code', async () => {
      const user = userEvent.setup();
      mockOnVerify.mockRejectedValueOnce(new Error('Invalid code'));

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      await screen.findByText(/invalid code/i);

      // Type a new digit
      await user.type(input, '1');

      expect(screen.queryByText(/invalid code/i)).not.toBeInTheDocument();
    });
  });

  describe('cancel button', () => {
    it('calls onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<MfaVerifyForm {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('disables cancel button during verification', async () => {
      const user = userEvent.setup();

      mockOnVerify.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    });
  });

  describe('accessibility', () => {
    it('focuses code input on mount', async () => {
      render(<MfaVerifyForm {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByLabelText(/verification code/i)).toHaveFocus();
      });
    });

    it('clears input and re-enables verification after error', async () => {
      const user = userEvent.setup();
      mockOnVerify.mockRejectedValueOnce(new Error('Invalid code'));

      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      await user.type(input, '123456');
      await user.click(screen.getByRole('button', { name: /verify/i }));

      // After error, input should be cleared and user can try again
      await waitFor(() => {
        expect(input).toHaveValue('');
      });

      // Input should be enabled again
      expect(input).not.toBeDisabled();
    });

    it('has numeric inputMode for mobile keyboards', () => {
      render(<MfaVerifyForm {...defaultProps} />);

      const input = screen.getByLabelText(/verification code/i);
      expect(input).toHaveAttribute('inputMode', 'numeric');
    });
  });
});
