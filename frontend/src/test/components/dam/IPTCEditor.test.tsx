import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IPTCEditor from '../../../components/dam/IPTCEditor';

function renderEditor(props: Partial<Parameters<typeof IPTCEditor>[0]> = {}) {
  return render(
    <IPTCEditor
      iptcMetadata={null}
      onUpdate={vi.fn()}
      isUpdating={false}
      {...props}
    />,
  );
}

describe('IPTCEditor', () => {
  it('renders the section header', () => {
    renderEditor();
    expect(screen.getByText('IPTC Metadata')).toBeInTheDocument();
  });

  it('renders dashes when there is no metadata', () => {
    renderEditor();
    // 10 editable fields expected; each shows "—" since values are absent
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(10);
  });

  it('renders existing values in read mode', () => {
    renderEditor({ iptcMetadata: { headline: 'My Headline', city: 'Berlin' } });
    expect(screen.getByText('My Headline')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
  });

  it('does not show Edit button when readOnly is true', () => {
    renderEditor({ readOnly: true });
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('switches to edit mode and shows Save/Cancel', () => {
    renderEditor({ iptcMetadata: { headline: 'Old' } });
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    // Existing value pre-fills the input
    expect(screen.getByDisplayValue('Old')).toBeInTheDocument();
  });

  it('returns to read mode when Cancel is clicked', () => {
    renderEditor({ iptcMetadata: { headline: 'Old' } });
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('only sends changed fields on save', async () => {
    const onUpdate = vi.fn().mockResolvedValue({});
    renderEditor({ iptcMetadata: { headline: 'Old', city: 'Berlin' }, onUpdate });
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByDisplayValue('Old'), { target: { value: 'New' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith({ headline: 'New' });
  });

  it('sends null when an existing field is cleared', async () => {
    const onUpdate = vi.fn().mockResolvedValue({});
    renderEditor({ iptcMetadata: { headline: 'Old' }, onUpdate });
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByDisplayValue('Old'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ headline: null }));
  });

  it('does not call onUpdate when no fields changed', async () => {
    const onUpdate = vi.fn().mockResolvedValue({});
    renderEditor({ iptcMetadata: { headline: 'Old' }, onUpdate });
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));
    // After save, we should be back in read mode without calling the API
    await waitFor(() => expect(screen.getByText('Edit')).toBeInTheDocument());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('shows non-editable IPTC fields under "Other IPTC Fields"', () => {
    renderEditor({ iptcMetadata: { headline: 'H', custom_field: 'CustomValue' } });
    expect(screen.getByText('Other IPTC Fields (read-only)')).toBeInTheDocument();
    expect(screen.getByText('custom_field')).toBeInTheDocument();
    expect(screen.getByText('CustomValue')).toBeInTheDocument();
  });

  it('shows a disabled Save with "Saving..." text when isUpdating is true', () => {
    renderEditor({ iptcMetadata: { headline: 'X' }, isUpdating: true });
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });
});
