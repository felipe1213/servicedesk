import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type WidgetId = 'total' | 'byStatus' | 'byPriority';

export const WIDGET_IDS: readonly WidgetId[] = ['total', 'byStatus', 'byPriority'];

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'total', visible: true, order: 0 },
  { id: 'byStatus', visible: true, order: 1 },
  { id: 'byPriority', visible: true, order: 2 },
];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(userId: string, role: Role): Promise<WidgetConfig[]> {
    const personal = await this.prisma.dashboardConfig.findUnique({ where: { userId } });
    if (personal) {
      const layout = personal.widgetLayout as { widgets?: unknown };
      if (layout && Array.isArray(layout.widgets)) {
        return layout.widgets as WidgetConfig[];
      }
      return DEFAULT_WIDGETS;
    }
    return this.getRoleDefault(role);
  }

  async saveConfig(userId: string, role: Role, widgets: WidgetConfig[]): Promise<WidgetConfig[]> {
    const layout = { widgets } as unknown as Prisma.InputJsonValue;
    await this.prisma.dashboardConfig.upsert({
      where: { userId },
      create: { userId, role, widgetLayout: layout },
      update: { role, widgetLayout: layout },
    });
    return widgets;
  }

  async getRoleDefault(role: Role): Promise<WidgetConfig[]> {
    const record = await this.prisma.appConfig.findUnique({
      where: { key: `dashboard.default.${role}` },
    });
    if (!record) return DEFAULT_WIDGETS;
    try {
      return (JSON.parse(record.value) as { widgets: WidgetConfig[] }).widgets;
    } catch {
      return DEFAULT_WIDGETS;
    }
  }

  async saveRoleDefault(role: Role, widgets: WidgetConfig[]): Promise<WidgetConfig[]> {
    await this.prisma.appConfig.upsert({
      where: { key: `dashboard.default.${role}` },
      create: { key: `dashboard.default.${role}`, value: JSON.stringify({ widgets }) },
      update: { value: JSON.stringify({ widgets }) },
    });
    return widgets;
  }
}
