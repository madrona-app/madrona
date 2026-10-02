import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DescriptionSection } from '../../../pages/collections/CollectionObjectWorkspacePage/DescriptionSection';
import { makeCollectionObject } from './fixtures';
import type { FormData } from '../../../pages/collections/CollectionObjectWorkspacePage/types';

// WorkspaceSection reads ActiveSectionContext optionally; avoid binding to a provider.
vi.mock('../../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({ activeSection: null, setActiveSection: vi.fn() }),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const baseFormData: Partial<FormData> = {
  brief_description: '',
  full_description: '',
  comments: '',
  distinguishing_features: '',
  content_description: '',
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 'org-1',
    objectId: 'obj-1',
    isEditing: false,
    isCreateMode: false,
    formData: baseFormData as FormData,
    object: makeCollectionObject({
      brief_description: 'Brief description text',
      full_description: 'Full description text',
    }),
    updateField: vi.fn(),
    updateFieldSilent: vi.fn(),
    handleFieldBlur: vi.fn(),
    expandedSections: { description: true },
    toggleSection: vi.fn(),
    sectionRefs: { current: {} },
    getSectionOrder: () => 1,
    isEmpty: false,
    sectionSummaries: { description: 'A short hint' },
    isRestricted: () => false,
    ...overrides,
  } as Parameters<typeof DescriptionSection>[0];
}

describe('DescriptionSection', () => {
  describe('view mode (collapsed)', () => {
    it('renders the section title', () => {
      render(
        <DescriptionSection
          {...makeProps({ expandedSections: { description: false } })}
        />,
      );
      expect(screen.getByText('Description')).toBeInTheDocument();
    });

    it('renders the section hint when collapsed', () => {
      render(
        <DescriptionSection
          {...makeProps({ expandedSections: { description: false } })}
        />,
      );
      expect(screen.getByText('A short hint')).toBeInTheDocument();
    });

    it('does not render any field labels when collapsed', () => {
      render(
        <DescriptionSection
          {...makeProps({ expandedSections: { description: false } })}
        />,
      );
      expect(screen.queryByText('Brief Description')).not.toBeInTheDocument();
    });
  });

  describe('view mode (expanded)', () => {
    it('renders the brief description value from object data when not editing', () => {
      render(<DescriptionSection {...makeProps()} />);
      expect(screen.getByText('Brief description text')).toBeInTheDocument();
    });

    it('renders the full description value from object data', () => {
      render(<DescriptionSection {...makeProps()} />);
      expect(screen.getByText('Full description text')).toBeInTheDocument();
    });

    it('renders all 5 description field labels', () => {
      render(<DescriptionSection {...makeProps()} />);
      expect(screen.getByText('Brief Description')).toBeInTheDocument();
      expect(screen.getByText('Full Description')).toBeInTheDocument();
      expect(screen.getByText('Content Description')).toBeInTheDocument();
      expect(screen.getByText('Distinguishing Features')).toBeInTheDocument();
      expect(screen.getByText('Comments')).toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    it('renders the brief description from formData (not object) when editing', () => {
      const props = makeProps({
        isEditing: true,
        formData: {
          ...baseFormData,
          brief_description: 'New form value',
        } as FormData,
      });
      render(<DescriptionSection {...props} />);
      // form value shown in input rather than object value
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.some((el) => (el as HTMLInputElement | HTMLTextAreaElement).value === 'New form value')).toBe(true);
    });

    it('calls updateField when the brief description input changes', () => {
      const updateField = vi.fn();
      const props = makeProps({
        isEditing: true,
        updateField,
        formData: { ...baseFormData, brief_description: 'a' } as FormData,
      });
      render(<DescriptionSection {...props} />);
      const inputs = screen.getAllByRole('textbox');
      const targetInput = inputs.find((el) => (el as HTMLInputElement | HTMLTextAreaElement).value === 'a')!;
      fireEvent.change(targetInput, { target: { value: 'updated' } });
      expect(updateField).toHaveBeenCalledWith('brief_description', 'updated');
    });

    it('calls handleFieldBlur (autosave) when an input is blurred', () => {
      const handleFieldBlur = vi.fn();
      const props = makeProps({
        isEditing: true,
        handleFieldBlur,
        formData: { ...baseFormData, brief_description: 'something' } as FormData,
      });
      render(<DescriptionSection {...props} />);
      const inputs = screen.getAllByRole('textbox');
      fireEvent.blur(inputs[0]);
      expect(handleFieldBlur).toHaveBeenCalled();
    });
  });

  describe('toggle behavior', () => {
    it('calls toggleSection when the collapsed header is clicked', () => {
      const toggleSection = vi.fn();
      render(
        <DescriptionSection
          {...makeProps({
            expandedSections: { description: false },
            toggleSection,
          })}
        />,
      );
      fireEvent.click(screen.getByText('Description'));
      expect(toggleSection).toHaveBeenCalledWith('description');
    });
  });

  describe('isEmpty', () => {
    it('renders compact empty state when isEmpty=true and collapsed', () => {
      render(
        <DescriptionSection
          {...makeProps({
            expandedSections: { description: false },
            isEmpty: true,
          })}
        />,
      );
      expect(screen.getByText('+ Add')).toBeInTheDocument();
    });
  });
});
