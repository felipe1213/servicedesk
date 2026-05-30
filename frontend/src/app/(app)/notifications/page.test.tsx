import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationsPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

const mockNotifications = [
  { id: 'n1', title: 'Unread notification', body: 'Body text here', ticketId: 't1', read: false, createdAt: new Date().toISOString() },
  { id: 'n2', title: 'Read notification', body: 'Already read', ticketId: 't2', read: true, createdAt: new Date().toISOString() },
];

global.fetch = jest.fn();

describe('NotificationsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockNotifications,
    });
  });

  it('renders unread items with left accent border (#3b82f6)', async () => {
    render(<NotificationsPage />);
    await waitFor(() => screen.getByText('Unread notification'));
    const unreadItem = screen.getByText('Unread notification').closest('li');
    expect(unreadItem).toHaveStyle({ borderLeft: '4px solid #3b82f6' });
  });

  it('renders read items without accent border', async () => {
    render(<NotificationsPage />);
    await waitFor(() => screen.getByText('Read notification'));
    const readItem = screen.getByText('Read notification').closest('li');
    expect(readItem).toHaveStyle({ borderLeft: '4px solid transparent' });
  });

  it('fires PATCH on click to mark notification read', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    render(<NotificationsPage />);
    await waitFor(() => screen.getByText('Unread notification'));

    fireEvent.click(screen.getByText('Unread notification').closest('li')!);

    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(
        calls.some((c: any[]) => String(c[0]).includes('/notifications/n1/read') && c[1]?.method === 'PATCH'),
      ).toBe(true);
    });
  });
});
