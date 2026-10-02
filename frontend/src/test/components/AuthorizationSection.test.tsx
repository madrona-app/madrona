import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthorizationSection } from '../../components/collections/AuthorizationSection';

// Replace workspace internals with simple shells so we can drive props
// directly without dealing with field types, focus management, etc.
vi.mock('../../components/workspace', () => ({
  WorkspaceSection: ({
    title,
    children,
    onToggle,
    isExpanded,
  }: {
    title: string;
    children: React.ReactNode;
    onToggle: () => void;
    isExpanded: boolean;
  }) => (
    <section data-testid="ws-section">
      <button onClick={onToggle}>{title}</button>
      {isExpanded && <div>{children}</div>}
    </section>
  ),
  EditableField: ({
    label,
    value,
    isEditing,
    onChange,
    onSave,
    type,
  }: {
    label: string;
    value: string;
    isEditing: boolean;
    onChange: (v: string) => void;
    onSave?: () => void;
    type?: string;
  }) => (
    <label>
      <span>{label}</span>
      {isEditing ? (
        <input
          aria-label={label}
          type={type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onSave}
        />
      ) : (
        <span data-testid={`field-${label}`}>{value}</span>
      )}
    </label>
  ),
}));

function renderSection(props: Partial<Parameters<typeof AuthorizationSection>[0]> = {}) {
  return render(
    <AuthorizationSection
      authorizerId=""
      authorizerContact={undefined}
      authorizationDate=""
      authorizationNote=""
      isEditing={false}
      isExpanded
      order={undefined}
      onToggle={vi.fn()}
      onUpdateField={vi.fn()}
      onOpenAuthorizerSelector={vi.fn()}
      {...props}
    />,
  );
}

describe('AuthorizationSection', () => {
  it('uses default title "Authorization"', () => {
    renderSection();
    expect(screen.getByRole('button', { name: 'Authorization' })).toBeInTheDocument();
  });

  it('uses a custom title when provided', () => {
    renderSection({ title: 'Internal Approval' });
    expect(screen.getByRole('button', { name: 'Internal Approval' })).toBeInTheDocument();
  });

  describe('view mode', () => {
    it('renders authorizer name + organization', () => {
      renderSection({
        authorizerId: 'c-1',
        authorizerContact: { name: 'Jane Curator', organization_name: 'Madrona' },
      });
      expect(screen.getByText('Jane Curator')).toBeInTheDocument();
      expect(screen.getByText('(Madrona)')).toBeInTheDocument();
    });

    it('renders "Not specified" when no authorizer is set', () => {
      renderSection();
      expect(screen.getByText('Not specified')).toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    it('renders the search button when no authorizer is set', () => {
      renderSection({ isEditing: true });
      expect(
        screen.getByRole('button', { name: /Search or create authorizer/i }),
      ).toBeInTheDocument();
    });

    it('opens the authorizer selector when search button is clicked', () => {
      const onOpenAuthorizerSelector = vi.fn();
      renderSection({ isEditing: true, onOpenAuthorizerSelector });
      fireEvent.click(screen.getByRole('button', { name: /Search or create authorizer/i }));
      expect(onOpenAuthorizerSelector).toHaveBeenCalledTimes(1);
    });

    it('renders the selected contact with Change and clear buttons', () => {
      renderSection({
        isEditing: true,
        authorizerId: 'c-1',
        authorizerContact: { name: 'Jane', organization_name: null },
      });
      expect(screen.getByText('Jane')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    });

    it('clears the authorizer by calling onUpdateField with empty string', () => {
      const onUpdateField = vi.fn();
      const { container } = renderSection({
        isEditing: true,
        authorizerId: 'c-1',
        authorizerContact: { name: 'Jane' },
        onUpdateField,
      });
      // The X clear button is the only button without a visible label inside
      // the selected-contact card — find the SVG-only button via its parent.
      const clearBtn = container.querySelector('button.ml-auto') as HTMLButtonElement;
      fireEvent.click(clearBtn);
      expect(onUpdateField).toHaveBeenCalledWith('authorizer_id', '');
    });

    it('forwards date input changes via onUpdateField', () => {
      const onUpdateField = vi.fn();
      renderSection({ isEditing: true, onUpdateField });
      fireEvent.change(screen.getByLabelText('Authorization date'), {
        target: { value: '2024-04-01' },
      });
      expect(onUpdateField).toHaveBeenCalledWith('authorization_date', '2024-04-01');
    });

    it('forwards notes textarea changes via onUpdateField', () => {
      const onUpdateField = vi.fn();
      renderSection({ isEditing: true, onUpdateField });
      fireEvent.change(screen.getByLabelText('Authorization notes'), {
        target: { value: 'Approved by board' },
      });
      expect(onUpdateField).toHaveBeenCalledWith('authorization_note', 'Approved by board');
    });

    it('triggers onFieldBlur when a field loses focus', () => {
      const onFieldBlur = vi.fn();
      renderSection({ isEditing: true, onFieldBlur });
      fireEvent.blur(screen.getByLabelText('Authorization date'));
      expect(onFieldBlur).toHaveBeenCalled();
    });
  });

  it('collapses children when isExpanded is false', () => {
    renderSection({ isExpanded: false });
    // No fields rendered when collapsed
    expect(screen.queryByText(/Authorizer/)).not.toBeInTheDocument();
  });
});
