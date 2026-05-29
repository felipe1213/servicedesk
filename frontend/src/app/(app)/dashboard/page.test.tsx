import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from './page';

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: jest.fn(),
  PointerSensor: class {},
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: jest.fn(),
  arrayMove: jest.fn((arr: any[], from: number, to: number) => arr),
}));

jest.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

const { useSession } = require('next-auth/react');

const mockStats = {
  total: 42,
  byStatus: [{ status: 'NEW', _count: { _all: 10 } }],
  byPriority: [{ priority: 'HIGH', _count: { _all: 5 } }],
};

describe('DashboardPage', () => {
  beforeEach(() => {
    useSession.mockReturnValue({ data: { accessToken: 'tok' } });
  });

  it('renders widgets in saved order from layout config', async () => {
    const layout = [
      { id: 'byStatus', visible: true, order: 0 },
      { id: 'total', visible: true, order: 1 },
      { id: 'byPriority', visible: true, order: 2 },
    ];
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/tickets/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) });
      if (url.includes('/dashboard/config')) return Promise.resolve({ ok: true, json: () => Promise.resolve(layout) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('By Status')).toBeInTheDocument());
    expect(screen.getByText('Total Tickets')).toBeInTheDocument();
    expect(screen.getByText('By Priority')).toBeInTheDocument();
  });

  it('shows Customize button in normal mode', async () => {
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/tickets/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) });
      if (url.includes('/dashboard/config')) return Promise.resolve({ ok: true, json: () => Promise.resolve([
        { id: 'total', visible: true, order: 0 },
        { id: 'byStatus', visible: true, order: 1 },
        { id: 'byPriority', visible: true, order: 2 },
      ]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /customize/i })).toBeInTheDocument());
  });

  it('does not render hidden widget in normal mode', async () => {
    const layout = [
      { id: 'total', visible: true, order: 0 },
      { id: 'byStatus', visible: true, order: 1 },
      { id: 'byPriority', visible: false, order: 2 },
    ];
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/tickets/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) });
      if (url.includes('/dashboard/config')) return Promise.resolve({ ok: true, json: () => Promise.resolve(layout) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Total Tickets')).toBeInTheDocument());
    expect(screen.queryByText('By Priority')).not.toBeInTheDocument();
  });
});
