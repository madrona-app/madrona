import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderContextMenu } from '../../../components/dam/FolderContextMenu';

const folder = {
  folder_id: 'f-1',
  name: 'Archives',
  parent_folder_id: null,
  depth: 0,
  sort_order: 0,
} as never;

function renderMenu(props?: Partial<Parameters<typeof FolderContextMenu>[0]>) {
  return render(
    <FolderContextMenu
      folder={folder}
      position={{ x: 50, y: 50 }}
      onClose={vi.fn()}
      onCreateSubfolder={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />
  );
}

describe('FolderContextMenu', () => {
  it('renders menu with folder actions when folder provided', () => {
    renderMenu();
    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows Move to... only when onMoveToFolder provided', () => {
    const { rerender } = renderMenu();
    expect(screen.queryByText('Move to...')).not.toBeInTheDocument();

    rerender(
      <FolderContextMenu
        folder={folder}
        position={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        onCreateSubfolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMoveToFolder={vi.fn()}
      />
    );
    expect(screen.getByText('Move to...')).toBeInTheDocument();
  });

  it('renders only "New Subfolder" for null folder (root context)', () => {
    renderMenu({ folder: null });
    expect(screen.getByText('New Subfolder')).toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('calls onCreateSubfolder with folder id when New Subfolder clicked', () => {
    const onCreateSubfolder = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onCreateSubfolder, onClose });
    fireEvent.click(screen.getByText('New Subfolder'));
    expect(onCreateSubfolder).toHaveBeenCalledWith('f-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onRename with folder object when Rename clicked', () => {
    const onRename = vi.fn();
    renderMenu({ onRename });
    fireEvent.click(screen.getByText('Rename'));
    expect(onRename).toHaveBeenCalledWith(folder);
  });

  it('calls onDelete with folder when Delete clicked', () => {
    const onDelete = vi.fn();
    renderMenu({ onDelete });
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith(folder);
  });

  it('calls onClose on Escape keydown', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on click outside the menu', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with menu role and accessible label', () => {
    renderMenu();
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('aria-label', 'Actions for Archives');
  });
});
