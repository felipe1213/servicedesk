import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KbPage from './page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/kb',
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));

import { useSession } from 'next-auth/react';

const mockArticles = [
  { id: 'art-1', title: 'Reset Password', slug: 'reset-password-abc123', status: 'PUBLISHED', tags: ['auth', 'login'], body: 'To reset your password go to settings and click forgot password link for full details', viewCount: 42, updatedAt: new Date().toISOString(), author: { name: 'Admin User' } },
  { id: 'art-2', title: 'VPN Setup', slug: 'vpn-setup-xyz456', status: 'PUBLISHED', tags: ['vpn', 'network'], body: 'Download the VPN client from the portal', viewCount: 10, updatedAt: new Date().toISOString(), author: null },
];

beforeEach(() => {
  (useSession as jest.Mock).mockReturnValue({ data: { accessToken: 'tok', user: { role: 'AGENT' } } });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockArticles) });
});

it('renders article cards from API', async () => {
  render(<KbPage />);
  await waitFor(() => expect(screen.getByText('Reset Password')).toBeInTheDocument());
  expect(screen.getByText('VPN Setup')).toBeInTheDocument();
});

it('shows tag chips', async () => {
  render(<KbPage />);
  await waitFor(() => expect(screen.getByText('auth')).toBeInTheDocument());
  expect(screen.getByText('login')).toBeInTheDocument();
});

it('triggers search endpoint when query entered', async () => {
  render(<KbPage />);
  await waitFor(() => screen.getByPlaceholderText('Search articles…'));
  await userEvent.type(screen.getByPlaceholderText('Search articles…'), 'password');
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/kb/search?q=password'),
      expect.anything(),
    )
  );
});
