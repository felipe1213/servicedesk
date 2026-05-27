import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoutingRulesPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/admin/routing-rules',
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));

import { useSession } from 'next-auth/react';

const adminSession = { accessToken: 'tok', user: { role: 'ADMIN', email: 'admin@test.com' } };

const mockRules = [
  {
    id: 'rule-1',
    priorityOrder: 1,
    isActive: true,
    conditions: [{ field: 'category', operator: 'eq', value: 'Auth' }],
    assignToAgentId: 'a1',
    assignToAgent: { id: 'a1', name: 'Alice' },
    assignToTeamId: null,
    assignToTeam: null,
  },
];

beforeEach(() => {
  (useSession as jest.Mock).mockReturnValue({ data: adminSession });
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/users/agents')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'a1', name: 'Alice', email: 'alice@test.com' }]) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRules) });
  });
});

it('renders routing rules table with rule data', async () => {
  render(<RoutingRulesPage />);
  await waitFor(() => expect(screen.getByText(/category = "Auth"/)).toBeInTheDocument());
  expect(screen.getByText(/Agent: Alice/)).toBeInTheDocument();
});

it('shows New Rule form when button clicked', async () => {
  render(<RoutingRulesPage />);
  await waitFor(() => screen.getByText('New Rule'));
  await userEvent.click(screen.getByText('New Rule'));
  expect(screen.getByText('New Rule', { selector: 'h2' })).toBeInTheDocument();
});

it('calls DELETE endpoint when Delete button clicked and confirmed', async () => {
  window.confirm = jest.fn(() => true);
  render(<RoutingRulesPage />);
  await waitFor(() => screen.getByText('Delete'));
  await userEvent.click(screen.getByText('Delete'));
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/routing-rules/rule-1'),
    expect.objectContaining({ method: 'DELETE' }),
  );
});
