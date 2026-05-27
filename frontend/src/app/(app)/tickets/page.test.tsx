import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import TicketsPage from './page';

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/tickets',
  useSearchParams: () => mockSearchParams,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import { useSession } from 'next-auth/react';

const agentSession = { accessToken: 'tok', user: { role: 'AGENT' } };
const endUserSession = { accessToken: 'tok', user: { role: 'END_USER' } };

const mockPage = {
  data: [{ id: '1', title: 'Login broken', status: 'NEW', priority: 'HIGH', category: null, sourceChannel: 'WEB', createdBy: { name: 'Alice' }, assignedTo: null, createdAt: '2026-01-01T00:00:00Z' }],
  total: 1, page: 1, limit: 25,
};

global.fetch = jest.fn();

beforeEach(() => {
  mockSearchParams = new URLSearchParams();
  mockReplace.mockClear();
  (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/users/agents')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockPage) });
  });
});

it('renders status and priority filter dropdowns', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<React.Suspense fallback={null}><TicketsPage /></React.Suspense>);
  await waitFor(() => expect(screen.getByLabelText('Status')).toBeInTheDocument());
  expect(screen.getByLabelText('Priority')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Search tickets…')).toBeInTheDocument();
});

it('shows ticket title from API response', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<React.Suspense fallback={null}><TicketsPage /></React.Suspense>);
  await waitFor(() => expect(screen.getByText('Login broken')).toBeInTheDocument());
});

it('shows Assignee column header for AGENT', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<React.Suspense fallback={null}><TicketsPage /></React.Suspense>);
  await waitFor(() => expect(screen.getByText('Login broken')).toBeInTheDocument());
  expect(screen.getByText('Assignee')).toBeInTheDocument();
});

it('does not show Assignee column for END_USER', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: endUserSession });
  render(<React.Suspense fallback={null}><TicketsPage /></React.Suspense>);
  await waitFor(() => expect(screen.getByText('Login broken')).toBeInTheDocument());
  expect(screen.queryByText('Assignee')).not.toBeInTheDocument();
});

it('shows pagination info', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<React.Suspense fallback={null}><TicketsPage /></React.Suspense>);
  await waitFor(() => expect(screen.getByText(/Showing 1–1 of 1/)).toBeInTheDocument());
});
