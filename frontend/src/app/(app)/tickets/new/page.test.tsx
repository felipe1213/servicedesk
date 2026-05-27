import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewTicketPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok', user: { role: 'AGENT' } } }),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

global.fetch = jest.fn();

beforeEach(() => {
  mockPush.mockClear();
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ id: 'new-ticket-1' }),
  });
});

it('renders file input for attachments', () => {
  render(<NewTicketPage />);
  expect(screen.getByText('Attachments')).toBeInTheDocument();
  const fileInput = document.querySelector('input[type="file"]');
  expect(fileInput).toBeInTheDocument();
});

it('submits without attachments using a single fetch call', async () => {
  render(<NewTicketPage />);
  fireEvent.change(screen.getByPlaceholderText('Brief summary of the issue'), { target: { value: 'My issue' } });
  fireEvent.change(screen.getByPlaceholderText('Describe the issue in detail'), { target: { value: 'Details here' } });
  fireEvent.click(screen.getByRole('button', { name: /Submit Ticket/i }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/tickets');
  expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('POST');
});

it('shows attachment file input as multiple', () => {
  render(<NewTicketPage />);
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(fileInput.multiple).toBe(true);
});
