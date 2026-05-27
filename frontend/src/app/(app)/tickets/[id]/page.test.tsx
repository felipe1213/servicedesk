import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import TicketDetailPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useParams: () => ({ id: 'ticket-1' }),
}));

import { useSession } from 'next-auth/react';

const agentSession = { accessToken: 'tok', user: { role: 'AGENT' } };
const endUserSession = { accessToken: 'tok', user: { role: 'END_USER' } };

const mockTicket = {
  id: 'ticket-1', title: 'VPN broken', description: 'Cannot connect',
  status: 'NEW', priority: 'HIGH', category: null, sourceChannel: 'WEB',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  createdBy: { name: 'Alice', email: 'alice@example.com' },
  assignedTo: null, team: null, comments: [], auditLogs: [],
};

global.fetch = jest.fn();

beforeEach(() => {
  (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/attachments')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/users/agents')) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'a1', name: 'Bob' }]) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTicket) });
  });
});

it('renders ticket title', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketDetailPage />);
  await waitFor(() => expect(screen.getByText('VPN broken')).toBeInTheDocument());
});

it('shows assignment dropdown for AGENT', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketDetailPage />);
  await waitFor(() => expect(screen.getByText('VPN broken')).toBeInTheDocument());
  expect(screen.getByText('Assigned to:')).toBeInTheDocument();
});

it('shows attachment upload button', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: agentSession });
  render(<TicketDetailPage />);
  await waitFor(() => expect(screen.getByText('Attachments')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /Upload File/i })).toBeInTheDocument();
});

it('shows empty attachments message when none exist', async () => {
  (useSession as jest.Mock).mockReturnValue({ data: endUserSession });
  render(<TicketDetailPage />);
  await waitFor(() => expect(screen.getByText('No attachments yet.')).toBeInTheDocument());
});
