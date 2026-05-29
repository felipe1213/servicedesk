import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ConflictsPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: any) => <div>{children}</div> }));

import { useSession } from 'next-auth/react';

const mockConflicts = [
  {
    id: 'art-1', title: 'VPN Article', body: 'local content', source: 'SHAREPOINT',
    updatedAt: new Date().toISOString(),
    conflictData: { remoteTitle: 'VPN Article', remoteBody: 'remote content', remoteVersion: 'v2', detectedAt: new Date().toISOString() },
  },
  {
    id: 'art-2', title: 'Confluence Doc', body: 'cf local', source: 'CONFLUENCE',
    updatedAt: new Date().toISOString(),
    conflictData: { remoteTitle: 'Confluence Doc', remoteBody: 'cf content', remoteVersion: '5', detectedAt: new Date().toISOString() },
  },
];

beforeEach(() => {
  (useSession as jest.Mock).mockReturnValue({ data: { accessToken: 'tok' } });

  global.fetch = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (opts?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockConflicts) });
  }) as any;
});

describe('ConflictsPage', () => {
  it('renders conflict table with article titles', async () => {
    render(<ConflictsPage />);
    await waitFor(() => expect(screen.getByText('VPN Article')).toBeInTheDocument());
    expect(screen.getByText('Confluence Doc')).toBeInTheDocument();
  });

  it('shows connector source badges', async () => {
    render(<ConflictsPage />);
    await waitFor(() => expect(screen.getByText('SHAREPOINT')).toBeInTheDocument());
    expect(screen.getByText('CONFLUENCE')).toBeInTheDocument();
  });

  it('shows Review buttons for each conflict', async () => {
    render(<ConflictsPage />);
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /review/i });
      expect(buttons).toHaveLength(2);
    });
  });

  it('shows empty state when there are no conflicts', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
    render(<ConflictsPage />);
    await waitFor(() => expect(screen.getByText(/no conflicts/i)).toBeInTheDocument());
  });
});
