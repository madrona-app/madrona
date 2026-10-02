import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthLayout, {
  AuthInput,
  AuthButton,
  AuthError,
  AuthSuccess,
  AuthLink,
  AuthFooter,
} from '../../components/AuthLayout';

describe('AuthLayout', () => {
  it('renders title', () => {
    render(
      <AuthLayout title="Test Title">
        <div>Content</div>
      </AuthLayout>
    );

    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(
      <AuthLayout title="Title" subtitle="Test subtitle">
        <div>Content</div>
      </AuthLayout>
    );

    expect(screen.getByText('Test subtitle')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <AuthLayout title="Title">
        <div>Test Content</div>
      </AuthLayout>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('renders Madrona wordmark', () => {
    render(
      <AuthLayout title="Title">
        <div>Content</div>
      </AuthLayout>
    );

    expect(screen.getByText('Madrona')).toBeInTheDocument();
  });

  it('has centered layout', () => {
    const { container } = render(
      <AuthLayout title="Title">
        <div>Content</div>
      </AuthLayout>
    );

    expect(container.firstChild).toHaveClass('min-h-screen');
  });
});

describe('AuthInput', () => {
  it('renders label', () => {
    render(
      <AuthInput id="test" label="Email" value="" onChange={() => {}} />
    );

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders with value', () => {
    render(
      <AuthInput id="test" label="Email" value="test@example.com" onChange={() => {}} />
    );

    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
  });

  it('calls onChange when typing', () => {
    const handleChange = vi.fn();
    render(
      <AuthInput id="test" label="Email" value="" onChange={handleChange} />
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('renders with placeholder', () => {
    render(
      <AuthInput id="test" label="Email" value="" placeholder="Enter email" onChange={() => {}} />
    );

    expect(screen.getByPlaceholderText('Enter email')).toBeInTheDocument();
  });

  it('supports disabled state', () => {
    render(
      <AuthInput id="test" label="Email" value="" disabled onChange={() => {}} />
    );

    expect(screen.getByLabelText('Email')).toBeDisabled();
  });

  it('supports required attribute', () => {
    render(
      <AuthInput id="test" label="Email" value="" required onChange={() => {}} />
    );

    expect(screen.getByLabelText('Email')).toBeRequired();
  });

  it('supports password type', () => {
    render(
      <AuthInput id="test" label="Password" type="password" value="" onChange={() => {}} />
    );

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('supports readOnly state', () => {
    render(
      <AuthInput id="test" label="Email" value="readonly@test.com" readOnly onChange={() => {}} />
    );

    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
  });
});

describe('AuthButton', () => {
  it('renders button text', () => {
    render(
      <AuthButton onClick={() => {}}>Submit</AuthButton>
    );

    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(
      <AuthButton onClick={handleClick}>Click Me</AuthButton>
    );

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalled();
  });

  it('can be disabled', () => {
    render(
      <AuthButton onClick={() => {}} disabled>Submit</AuthButton>
    );

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('supports submit type by default', () => {
    render(
      <AuthButton onClick={() => {}}>Submit</AuthButton>
    );

    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('supports button type', () => {
    render(
      <AuthButton onClick={() => {}} type="button">Click</AuthButton>
    );

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('renders with secondary variant', () => {
    render(
      <AuthButton onClick={() => {}} variant="secondary">Secondary</AuthButton>
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

describe('AuthError', () => {
  it('renders error message', () => {
    render(
      <AuthError message="Something went wrong" />
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('has error styling', () => {
    const { container } = render(
      <AuthError message="Error" />
    );

    expect(container.firstChild).toHaveClass('border');
  });
});

describe('AuthSuccess', () => {
  it('renders success message', () => {
    render(
      <AuthSuccess message="Operation successful" />
    );

    expect(screen.getByText('Operation successful')).toBeInTheDocument();
  });

  it('has success styling', () => {
    const { container } = render(
      <AuthSuccess message="Success" />
    );

    expect(container.firstChild).toHaveClass('border');
  });
});

describe('AuthLink', () => {
  it('renders link text', () => {
    render(
      <AuthLink href="/sign-up">Create account</AuthLink>
    );

    expect(screen.getByRole('link', { name: /create account/i })).toBeInTheDocument();
  });

  it('has correct href', () => {
    render(
      <AuthLink href="/sign-up">Create account</AuthLink>
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/sign-up');
  });

  it('supports custom className', () => {
    render(
      <AuthLink href="/test" className="custom-class">Link</AuthLink>
    );

    expect(screen.getByRole('link')).toHaveClass('custom-class');
  });
});

describe('AuthFooter', () => {
  it('renders footer content', () => {
    render(
      <AuthFooter>
        <span>Footer content</span>
      </AuthFooter>
    );

    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });
});
