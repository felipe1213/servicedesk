import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminKbPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/admin/kb',
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: any) => <div>{children}</div> }));

import { useSession } from 'next-auth/react';

const adminSession = { accessToken: 'tok', user: { role: 'ADMIN', email: 'admin@test.com' } };

const mockArticles = [
  { id: 'art-1', title: 'Reset Password', slug: 'reset-password-abc123', status: 'PUBLISHED', tags: ['auth'], body: 'Guide to reset password', viewCount: 5, publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), author: { name: 'Admin User' }, source: 'INTERNAL' },
  { id: 'art-2', title: 'VPN Draft', slug: 'vpn-draft-xyz', status: 'DRAFT', tags: [], body: 'Draft content', viewCount: 0, publishedAt: null, updatedAt: new Date().toISOString(), author: null, source: 'INTERNAL' },
];

beforeEach(() => {
  (useSession as jest.Mock).mockReturnValue({ data: adminSession });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockArticles) });
});

it('renders all articles including drafts', async () => {
  render(<AdminKbPage />);
  await waitFor(() => expect(screen.getByText('Reset Password')).toBeInTheDocument());
  expect(screen.getByText('VPN Draft')).toBeInTheDocument();
});

it('shows draft badge for draft article', async () => {
  render(<AdminKbPage />);
  await waitFor(() => expect(screen.getByText('VPN Draft')).toBeInTheDocument());
  expect(screen.getByText('DRAFT')).toBeInTheDocument();
  expect(screen.getByText('PUBLISHED')).toBeInTheDocument();
});

it('opens edit form when Edit clicked', async () => {
  render(<AdminKbPage />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit' })[0]).toBeInTheDocument());
  await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  expect(screen.getByText('Edit Article')).toBeInTheDocument();
  // form is pre-populated with first article title
  expect(screen.getByDisplayValue('Reset Password')).toBeInTheDocument();
});

it('shows New Article form when button clicked', async () => {
  render(<AdminKbPage />);
  await waitFor(() => expect(screen.getByText('New Article')).toBeInTheDocument());
  await userEvent.click(screen.getByText('New Article', { selector: 'button' }));
  expect(screen.getByText('New Article', { selector: 'h2' })).toBeInTheDocument();
});
