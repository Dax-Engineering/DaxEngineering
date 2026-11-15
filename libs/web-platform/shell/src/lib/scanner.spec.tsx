import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearOfflineData } from './pwa';
import { Scanner } from './scanner';

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderScanner(
  onCode: (code: string) => void | Promise<'ok' | 'miss' | void>,
) {
  return render(
    <MantineProvider>
      <Scanner onCode={onCode} />
    </MantineProvider>,
  );
}

describe('Scanner', () => {
  it('explains when the camera cannot be used here', async () => {
    renderScanner(vi.fn());
    expect(
      await screen.findByText(/only works on a secure \(https\) connection/),
    ).toBeTruthy();
  });

  it('submits typed or hand-scanner codes on Enter', () => {
    const onCode = vi.fn();
    renderScanner(onCode);
    const input = screen.getByLabelText(/Type or scan a code/);
    fireEvent.change(input, { target: { value: '  A-01-02-B ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onCode).toHaveBeenCalledWith('A-01-02-B', 'typed');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('handles scans one at a time, in order, without dropping any', async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const onCode = vi.fn(async (code: string) => {
      seen.push(`start ${code}`);
      if (code === 'A') await new Promise<void>((r) => (release = r));
      seen.push(`end ${code}`);
      return 'ok' as const;
    });
    renderScanner(onCode);
    const input = screen.getByLabelText(/Type or scan a code/);
    const form = input.closest('form') as HTMLFormElement;
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.submit(form);
    expect(seen).toEqual(['start A']);
    release();
    await vi.waitFor(() =>
      expect(seen).toEqual(['start A', 'end A', 'start B', 'end B']),
    );
  });
});

describe('clearOfflineData', () => {
  it('unregisters service workers and empties caches', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['dax-static-v1']),
      delete: remove,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) },
    });

    await clearOfflineData();

    expect(unregister).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('dax-static-v1');
  });
});
