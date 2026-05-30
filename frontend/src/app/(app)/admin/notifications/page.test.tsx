import { render, screen, waitFor } from '@testing-library/react';
import AdminNotificationsPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' }, status: 'authenticated' }),
}));

global.fetch = jest.fn();

describe('AdminNotificationsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'notification.event.ticket_created': true,
          'notification.event.ticket_assigned': false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transport: 'SMTP',
          config: { host: 'smtp.test.com', port: 587, secure: false, user: 'u', pass: '***', fromAddress: 'from@test.com' },
        }),
      });
  });

  it('renders event toggle checkboxes from the GET /config response', async () => {
    render(<AdminNotificationsPage />);
    await waitFor(() => screen.getByText(/Ticket created/));
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  it('shows SMTP fields when transport is SMTP', async () => {
    render(<AdminNotificationsPage />);
    await waitFor(() => screen.getByDisplayValue('smtp.test.com'));
    expect(screen.getByPlaceholderText('smtp.example.com')).toBeInTheDocument();
  });

  it('does not show Graph fields when transport is SMTP', async () => {
    render(<AdminNotificationsPage />);
    await waitFor(() => screen.getByDisplayValue('smtp.test.com'));
    expect(screen.queryByText('Tenant ID')).not.toBeInTheDocument();
  });
});
