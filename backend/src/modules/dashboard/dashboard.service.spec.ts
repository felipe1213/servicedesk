import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService, WidgetConfig } from './dashboard.service';

const DEFAULT: WidgetConfig[] = [
  { id: 'total', visible: true, order: 0 },
  { id: 'byStatus', visible: true, order: 1 },
  { id: 'byPriority', visible: true, order: 2 },
];

const mockPrisma = {
  dashboardConfig: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  appConfig: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(DashboardService);
    jest.clearAllMocks();
  });

  describe('getConfig', () => {
    it('returns personal config when DashboardConfig exists for user', async () => {
      const personal: WidgetConfig[] = [
        { id: 'byStatus', visible: true, order: 0 },
        { id: 'total', visible: false, order: 1 },
        { id: 'byPriority', visible: true, order: 2 },
      ];
      mockPrisma.dashboardConfig.findUnique.mockResolvedValue({ widgetLayout: { widgets: personal } });

      const result = await service.getConfig('user-1', Role.AGENT);
      expect(result).toEqual(personal);
      expect(mockPrisma.appConfig.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to role default from AppConfig when no personal config', async () => {
      const roleDefault: WidgetConfig[] = [
        { id: 'byPriority', visible: true, order: 0 },
        { id: 'total', visible: true, order: 1 },
        { id: 'byStatus', visible: false, order: 2 },
      ];
      mockPrisma.dashboardConfig.findUnique.mockResolvedValue(null);
      mockPrisma.appConfig.findUnique.mockResolvedValue({
        value: JSON.stringify({ widgets: roleDefault }),
      });

      const result = await service.getConfig('user-1', Role.MANAGER);
      expect(result).toEqual(roleDefault);
    });

    it('falls back to hardcoded default when neither personal nor role default exists', async () => {
      mockPrisma.dashboardConfig.findUnique.mockResolvedValue(null);
      mockPrisma.appConfig.findUnique.mockResolvedValue(null);

      const result = await service.getConfig('user-1', Role.END_USER);
      expect(result).toEqual(DEFAULT);
    });
  });

  describe('saveConfig', () => {
    it('creates DashboardConfig when none exists (upsert with create data)', async () => {
      mockPrisma.dashboardConfig.upsert.mockResolvedValue({});
      const widgets: WidgetConfig[] = [{ id: 'total', visible: true, order: 0 }];

      const result = await service.saveConfig('user-1', Role.AGENT, widgets);

      expect(mockPrisma.dashboardConfig.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', role: Role.AGENT, widgetLayout: { widgets } },
        update: { role: Role.AGENT, widgetLayout: { widgets } },
      });
      expect(result).toEqual(widgets);
    });

    it('updates existing DashboardConfig when one already exists', async () => {
      mockPrisma.dashboardConfig.upsert.mockResolvedValue({
        userId: 'user-1',
        role: Role.AGENT,
        widgetLayout: { widgets: [{ id: 'total', visible: true, order: 0 }] },
      });
      const updated: WidgetConfig[] = [
        { id: 'byStatus', visible: true, order: 0 },
        { id: 'total', visible: false, order: 1 },
        { id: 'byPriority', visible: true, order: 2 },
      ];

      const result = await service.saveConfig('user-1', Role.AGENT, updated);

      expect(mockPrisma.dashboardConfig.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', role: Role.AGENT, widgetLayout: { widgets: updated } },
        update: { role: Role.AGENT, widgetLayout: { widgets: updated } },
      });
      expect(result).toEqual(updated);
    });
  });

  describe('getRoleDefault', () => {
    it('returns hardcoded default when AppConfig key is absent', async () => {
      mockPrisma.appConfig.findUnique.mockResolvedValue(null);
      const result = await service.getRoleDefault(Role.ADMIN);
      expect(result).toEqual(DEFAULT);
    });
  });

  describe('saveRoleDefault', () => {
    it('upserts AppConfig with key dashboard.default.{role}', async () => {
      mockPrisma.appConfig.upsert.mockResolvedValue({});
      const widgets: WidgetConfig[] = [{ id: 'byStatus', visible: true, order: 0 }];

      await service.saveRoleDefault(Role.MANAGER, widgets);

      expect(mockPrisma.appConfig.upsert).toHaveBeenCalledWith({
        where: { key: 'dashboard.default.MANAGER' },
        create: { key: 'dashboard.default.MANAGER', value: JSON.stringify({ widgets }) },
        update: { value: JSON.stringify({ widgets }) },
      });
    });
  });
});
