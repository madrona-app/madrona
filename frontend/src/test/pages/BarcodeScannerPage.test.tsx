import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BarcodeScannerPage from '../../pages/collections/BarcodeScannerPage';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

// html5-qrcode reaches for a camera that does not exist in jsdom. The manual
// entry path is precisely the one that must not depend on it.
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    static getCameras = vi.fn().mockResolvedValue([]);
    start = vi.fn().mockRejectedValue(new Error('no camera in jsdom'));
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/barcodes/scanner`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/barcodes/scanner"
            element={<BarcodeScannerPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * The scanner was camera-only. That excluded the two groups most likely to be
 * using it: operators with a USB/Bluetooth wedge scanner (which types the
 * barcode and presses Enter, and never touches a camera) and anyone working by
 * keyboard or screen reader, who cannot aim a viewfinder at all.
 */
describe('BarcodeScannerPage manual entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ items: [] } as never);
  });

  it('exposes a labelled text input', async () => {
    renderPage();
    const input = await screen.findByLabelText(/barcode or object number/i);
    expect(input).toBeInTheDocument();
  });

  it('focuses the input on mount, so a wedge scanner types into it', async () => {
    renderPage();
    const input = await screen.findByLabelText(/barcode or object number/i);
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('submitting on Enter looks the barcode up', async () => {
    renderPage();
    const input = await screen.findByLabelText(/barcode or object number/i);

    fireEvent.change(input, { target: { value: 'OBJ-000123' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      const scanCall = mockApiFetch.mock.calls.find(([url]) =>
        String(url).includes('/barcodes/scan')
      );
      expect(scanCall, 'no scan request was made').toBeTruthy();
      expect(JSON.stringify(scanCall![1])).toContain('OBJ-000123');
    });
  });

  it('clears the input after submitting, ready for the next scan', async () => {
    renderPage();
    const input = (await screen.findByLabelText(/barcode or object number/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'OBJ-1' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('does not submit an empty or whitespace-only value', async () => {
    renderPage();
    const input = await screen.findByLabelText(/barcode or object number/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      const scanCalls = mockApiFetch.mock.calls.filter(([url]) =>
        String(url).includes('/barcodes/scan')
      );
      expect(scanCalls).toHaveLength(0);
    });
  });
});
