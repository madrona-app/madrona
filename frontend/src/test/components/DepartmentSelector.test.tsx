import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DepartmentSelector } from '../../components/collections/DepartmentSelector';

// Mock useAuth — DepartmentSelector reads `user.department_memberships`
const mockAuth = vi.hoisted(() => ({
  user: {
    department_memberships: [
      {
        department_id: 'dept-1',
        department_name: 'Paintings',
        department_code: 'PTG',
        department_color: 'rgb(var(--color-bark))',
      },
      {
        department_id: 'dept-2',
        department_name: 'Sculpture',
        department_code: 'SCL',
        department_color: null,
      },
    ],
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

describe('DepartmentSelector', () => {
  describe('view mode', () => {
    it('renders nothing when no department is selected', () => {
      const { container } = render(
        <DepartmentSelector
          organizationId="org-1"
          value={null}
          onChange={vi.fn()}
          isEditing={false}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders department name and code when a department is selected', () => {
      render(
        <DepartmentSelector
          organizationId="org-1"
          value="dept-1"
          onChange={vi.fn()}
          isEditing={false}
        />
      );
      expect(screen.getByText('Paintings')).toBeInTheDocument();
      expect(screen.getByText('(PTG)')).toBeInTheDocument();
    });

    it('uses default label "Department"', () => {
      render(
        <DepartmentSelector
          organizationId="org-1"
          value="dept-1"
          onChange={vi.fn()}
          isEditing={false}
        />
      );
      expect(screen.getByText('Department')).toBeInTheDocument();
    });

    it('uses custom label when provided', () => {
      render(
        <DepartmentSelector
          organizationId="org-1"
          value="dept-1"
          onChange={vi.fn()}
          isEditing={false}
          label="Owning Department"
        />
      );
      expect(screen.getByText('Owning Department')).toBeInTheDocument();
    });

    it('renders color swatch when department has a color', () => {
      const { container } = render(
        <DepartmentSelector
          organizationId="org-1"
          value="dept-1"
          onChange={vi.fn()}
          isEditing={false}
        />
      );
      // The swatch is a span with inline backgroundColor
      const swatch = container.querySelector('span[style*="background"]');
      expect(swatch).not.toBeNull();
    });

    it('omits color swatch when department has no color', () => {
      const { container } = render(
        <DepartmentSelector
          organizationId="org-1"
          value="dept-2"
          onChange={vi.fn()}
          isEditing={false}
        />
      );
      const swatch = container.querySelector('span[style*="background"]');
      expect(swatch).toBeNull();
    });
  });

  describe('edit mode', () => {
    it('renders a select with all department memberships', () => {
      render(
        <DepartmentSelector
          organizationId="org-1"
          value="dept-1"
          onChange={vi.fn()}
          isEditing
        />
      );
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('dept-1');
      expect(select.options).toHaveLength(3); // "No department" + 2 depts
    });

    it('renders the "No department" option for clearing selection', () => {
      render(
        <DepartmentSelector
          organizationId="org-1"
          value={null}
          onChange={vi.fn()}
          isEditing
        />
      );
      expect(screen.getByRole('option', { name: 'No department' })).toBeInTheDocument();
    });

    it('calls onChange with the selected department id', () => {
      const onChange = vi.fn();
      render(
        <DepartmentSelector
          organizationId="org-1"
          value={null}
          onChange={onChange}
          isEditing
        />
      );
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dept-2' } });
      expect(onChange).toHaveBeenCalledWith('dept-2');
    });

    it('calls onChange with null when cleared', () => {
      const onChange = vi.fn();
      render(
        <DepartmentSelector
          organizationId="org-1"
          value="dept-1"
          onChange={onChange}
          isEditing
        />
      );
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
      expect(onChange).toHaveBeenCalledWith(null);
    });

    it('calls onBlur when select loses focus', () => {
      const onBlur = vi.fn();
      render(
        <DepartmentSelector
          organizationId="org-1"
          value="dept-1"
          onChange={vi.fn()}
          isEditing
          onBlur={onBlur}
        />
      );
      fireEvent.blur(screen.getByRole('combobox'));
      expect(onBlur).toHaveBeenCalledTimes(1);
    });
  });
});
