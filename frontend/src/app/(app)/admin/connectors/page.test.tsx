import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ConnectorsPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));

import { useSession } from 'next-auth/react';

beforeEach(() => {
  (useSession as jest.Mock).mockReturnValue({ data: { accessToken: 'tok' } });

  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/sharepoint/config')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: true, syncIntervalMinutes: 60 }) });
    }
    if (url.includes('/confluence/config')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false, syncIntervalMinutes: 30 }) });
    }
    if (url.includes('/conflicts')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url.includes('/logs')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
  }) as any;
});

describe('ConnectorsPage', () => {
  it('renders SharePoint and Confluence cards', async () => {
    render(<ConnectorsPage />);
    await waitFor(() => expect(screen.getByText('SharePoint')).toBeInTheDocument());
    expect(screen.getByText('Confluence')).toBeInTheDocument();
  });

  it('shows Enabled badge for SharePoint and Disabled for Confluence', async () => {
    render(<ConnectorsPage />);
    await waitFor(() => expect(screen.getByText('Enabled')).toBeInTheDocument());
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});
