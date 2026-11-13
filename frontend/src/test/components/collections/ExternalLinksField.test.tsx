import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ExternalLinksField, isValidExternalUrl } from '../../../components/collections/ExternalLinksField';
import type { ExternalLinkValue } from '../../../components/collections/ExternalLinksField';
import { checkA11y } from '../../a11y';

function Harness({ initial, onSave }: { initial: ExternalLinkValue[]; onSave: () => void }) {
  const [links, setLinks] = useState(initial);
  return <ExternalLinksField links={links} isEditing onChange={setLinks} onSave={onSave} />;
}

describe('isValidExternalUrl', () => {
  it('accepts http(s) and blank, rejects script and relative URLs', () => {
    expect(isValidExternalUrl('https://en.wikipedia.org/wiki/X')).toBe(true);
    expect(isValidExternalUrl('')).toBe(true);
    expect(isValidExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isValidExternalUrl('example.org')).toBe(false);
  });
});

describe('ExternalLinksField', () => {
  it('read mode renders labelled links that announce a new tab', () => {
    render(
      <ExternalLinksField
        links={[{ url: 'https://en.wikipedia.org/wiki/NFB', label: 'Wikipedia' }]}
        isEditing={false}
        onChange={() => {}}
        onSave={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: "Wikipedia, opens in a new tab" });
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/NFB');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('every edit control has an accessible name and the form has no axe violations', async () => {
    const { container } = render(
      <Harness initial={[{ url: 'https://a.org', label: 'A', link_type: 'website' }]} onSave={() => {}} />,
    );
    expect(screen.getByRole('group', { name: 'External links' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link 1 web address')).toHaveValue('https://a.org');
    expect(screen.getByLabelText('Link 1 label')).toHaveValue('A');
    expect(screen.getByLabelText('Link 1 type')).toHaveValue('website');
    expect(screen.getByRole('button', { name: 'Remove link 1, A' })).toBeInTheDocument();
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('adding a row moves focus to its address field and announces it', () => {
    render(<Harness initial={[]} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add external link' }));
    expect(screen.getByLabelText('Link 1 web address')).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Link 1 added');
  });

  it('invalid address is marked invalid with a described error and is not saved on blur', () => {
    const onSave = vi.fn();
    render(<Harness initial={[{ url: '', label: '' }]} onSave={onSave} />);
    const input = screen.getByLabelText('Link 1 web address');
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/start(ing)? with https:\/\//);
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removing a row returns focus to Add and saves after the change applies', async () => {
    const onSave = vi.fn();
    render(<Harness initial={[{ url: 'https://a.org', label: 'A' }]} onSave={onSave} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove link 1, A' }));
    });
    expect(screen.queryByLabelText('Link 1 web address')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add external link' })).toHaveFocus();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
