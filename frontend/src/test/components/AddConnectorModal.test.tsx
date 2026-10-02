import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddConnectorModal from '../../components/AddConnectorModal';

const CONNECTORS = [
  { connector_instance_id: 'c-1', name: 'Postgres CMS' },
  { connector_instance_id: 'c-2', name: 'Salesforce' },
  { connector_instance_id: 'c-3', name: 'WordPress' },
] as never;

function renderModal(extra: Partial<React.ComponentProps<typeof AddConnectorModal>> = {}) {
  const onClose = vi.fn();
  const onAdd = vi.fn();
  const utils = render(
    <AddConnectorModal
      isOpen
      onClose={onClose}
      onAdd={onAdd}
      title="Add Source"
      connectors={CONNECTORS}
      existingConnectorIds={[]}
      {...extra}
    />,
  );
  return { onClose, onAdd, ...utils };
}

describe('AddConnectorModal', () => {
  it('renders nothing when not open', () => {
    const { container } = render(
      <AddConnectorModal
        isOpen={false}
        onClose={() => {}}
        onAdd={() => {}}
        title="X"
        connectors={[]}
        existingConnectorIds={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the supplied title', () => {
    renderModal();
    expect(screen.getByText('Add Source')).toBeInTheDocument();
  });

  it('renders all available connectors as options', () => {
    renderModal();
    expect(screen.getByText('Postgres CMS')).toBeInTheDocument();
    expect(screen.getByText('Salesforce')).toBeInTheDocument();
    expect(screen.getByText('WordPress')).toBeInTheDocument();
  });

  it('hides connectors that are already added', () => {
    renderModal({ existingConnectorIds: ['c-2'] });
    expect(screen.queryByText('Salesforce')).toBeNull();
    expect(screen.getByText('Postgres CMS')).toBeInTheDocument();
  });

  it('shows the no-connectors empty state when nothing remains', () => {
    renderModal({ existingConnectorIds: ['c-1', 'c-2', 'c-3'] });
    expect(screen.getByText('No available connectors')).toBeInTheDocument();
  });

  it('Add button is disabled until a connector is selected', () => {
    renderModal();
    const submit = screen.getByText('Add Connector') as HTMLButtonElement;
    expect(submit).toBeDisabled();
  });

  it('selecting a connector enables the Add button', () => {
    renderModal();
    const select = screen.getByLabelText('Select Connector') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'c-1' } });
    expect(screen.getByText('Add Connector')).not.toBeDisabled();
  });

  it('Add button calls onAdd with the chosen id and closes', () => {
    const { onAdd, onClose } = renderModal();
    const select = screen.getByLabelText('Select Connector') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'c-2' } });
    fireEvent.submit(select.closest('form')!);
    expect(onAdd).toHaveBeenCalledWith('c-2');
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel button calls onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Close icon button calls onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});
