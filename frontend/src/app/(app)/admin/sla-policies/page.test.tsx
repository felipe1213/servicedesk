import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlaPoliciesPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/admin/sla-policies',
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));

import { useSession } from 'next-auth/react';

const adminSession = { accessToken: 'tok', user: { role: 'ADMIN', email: 'admin@test.com' } };

const mockPolicies = [
  {
    id: 'pol-1',
    name: 'Critical SLA',
    priorityLevel: 'CRITICAL',
    responseTimeMinutes: 30,
    resolutionTimeMinutes: 240,
    breachAction: 'FLAG',
    escalateToUserId: null,
    escalateToTeamId: null,
  },
];

beforeEach(() => {
  (useSession as jest.Mock).mockReturnValue({ data: adminSession });
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/users/agents')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockPolicies) });
  });
});

it('renders all four priority rows', async () => {
  render(<SlaPoliciesPage />);
  await waitFor(() => expect(screen.getByText('CRITICAL')).toBeInTheDocument());
  expect(screen.getByText('HIGH')).toBeInTheDocument();
  expect(screen.getByText('MEDIUM')).toBeInTheDocument();
  expect(screen.getByText('LOW')).toBeInTheDocument();
});

it('shows policy details for configured priority', async () => {
  render(<SlaPoliciesPage />);
  await waitFor(() => expect(screen.getByText(/30min/)).toBeInTheDocument());
  expect(screen.getByText(/240min/)).toBeInTheDocument();
});

it('shows Add button for unconfigured priorities', async () => {
  render(<SlaPoliciesPage />);
  // Wait for data to load — once Edit appears for CRITICAL, the Add buttons are also rendered
  await waitFor(() => screen.getByText('Edit'));
  const addButtons = screen.getAllByText('Add');
  expect(addButtons.length).toBe(3); // HIGH, MEDIUM, LOW have no policy
});

it('shows edit form when Edit clicked', async () => {
  render(<SlaPoliciesPage />);
  await waitFor(() => screen.getByText('Edit'));
  await userEvent.click(screen.getByText('Edit'));
  expect(screen.getByText('Save Policy')).toBeInTheDocument();
});
