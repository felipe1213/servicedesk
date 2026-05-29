// backend/src/modules/notifications/notification-config.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';

export const NOTIFICATION_EVENT_KEYS = [
  'notification.event.ticket_created',
  'notification.event.ticket_assigned',
  'notification.event.ticket_commented',
  'notification.event.ticket_status_changed',
  'notification.event.sla_breach',
] as const;

@Injectable()
export class NotificationConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get encryptionKey(): Buffer {
    const hex = this.config.getOrThrow<string>('CONNECTOR_ENCRYPTION_KEY');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('CONNECTOR_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    return Buffer.from(hex, 'hex');
  }

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 3) throw new Error('Malformed ciphertext — expected iv:authTag:ciphertext');
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  async getEventToggles(): Promise<Record<string, boolean>> {
    const records = await this.prisma.appConfig.findMany({
      where: { key: { in: [...NOTIFICATION_EVENT_KEYS] } },
    });
    const result: Record<string, boolean> = {};
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const record = records.find((r) => r.key === key);
      result[key] = record?.value === 'true';
    }
    return result;
  }

  async updateEventToggles(toggles: Record<string, boolean>): Promise<void> {
    await Promise.all(
      NOTIFICATION_EVENT_KEYS.filter((key) => key in toggles).map((key) =>
        this.prisma.appConfig.upsert({
          where: { key },
          create: { key, value: toggles[key] ? 'true' : 'false' },
          update: { value: toggles[key] ? 'true' : 'false' },
        }),
      ),
    );
  }

  async isEventEnabled(key: string): Promise<boolean> {
    const record = await this.prisma.appConfig.findUnique({ where: { key } });
    return record?.value === 'true';
  }

  async getEmailConfig(): Promise<{ transport: 'SMTP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }> {
    const transportRecord = await this.prisma.appConfig.findUnique({
      where: { key: 'notification.email.transport' },
    });
    const transport = (transportRecord?.value as 'SMTP' | 'GRAPH' | 'NONE') ?? 'NONE';
    if (transport === 'NONE' || !transportRecord) return { transport: 'NONE', config: {} };

    const configKey = transport === 'SMTP' ? 'notification.email.smtp' : 'notification.email.graph';
    const configRecord = await this.prisma.appConfig.findUnique({ where: { key: configKey } });
    if (!configRecord) return { transport, config: {} };

    try {
      const raw = JSON.parse(configRecord.value) as Record<string, unknown>;
      if (transport === 'SMTP') {
        return { transport, config: { ...raw, pass: this.decrypt(raw.pass as string) } };
      }
      return { transport, config: { ...raw, clientSecret: this.decrypt(raw.clientSecret as string) } };
    } catch {
      return { transport, config: {} };
    }
  }

  async getRedactedEmailConfig(): Promise<{ transport: 'SMTP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }> {
    const { transport, config } = await this.getEmailConfig();
    if (transport === 'SMTP' && config.pass) return { transport, config: { ...config, pass: '***' } };
    if (transport === 'GRAPH' && config.clientSecret) return { transport, config: { ...config, clientSecret: '***' } };
    return { transport, config };
  }

  async saveEmailConfig(dto: UpdateEmailConfigDto): Promise<void> {
    const { transport } = dto;

    if (transport === 'SMTP') {
      if (!dto.host || !dto.port || dto.secure === undefined || !dto.user || !dto.pass || !dto.fromAddress) {
        throw new BadRequestException('SMTP transport requires host, port, secure, user, pass, and fromAddress');
      }
      const toStore = {
        host: dto.host, port: dto.port, secure: dto.secure,
        user: dto.user, pass: this.encrypt(dto.pass), fromAddress: dto.fromAddress,
      };
      await this.prisma.appConfig.upsert({
        where: { key: 'notification.email.transport' },
        create: { key: 'notification.email.transport', value: transport },
        update: { value: transport },
      });
      await this.prisma.appConfig.upsert({
        where: { key: 'notification.email.smtp' },
        create: { key: 'notification.email.smtp', value: JSON.stringify(toStore) },
        update: { value: JSON.stringify(toStore) },
      });
    } else if (transport === 'GRAPH') {
      if (!dto.tenantId || !dto.clientId || !dto.clientSecret || !dto.fromAddress) {
        throw new BadRequestException('Graph transport requires tenantId, clientId, clientSecret, and fromAddress');
      }
      const toStore = {
        tenantId: dto.tenantId, clientId: dto.clientId,
        clientSecret: this.encrypt(dto.clientSecret), fromAddress: dto.fromAddress,
      };
      await this.prisma.appConfig.upsert({
        where: { key: 'notification.email.transport' },
        create: { key: 'notification.email.transport', value: transport },
        update: { value: transport },
      });
      await this.prisma.appConfig.upsert({
        where: { key: 'notification.email.graph' },
        create: { key: 'notification.email.graph', value: JSON.stringify(toStore) },
        update: { value: JSON.stringify(toStore) },
      });
    } else {
      // transport === 'NONE'
      await this.prisma.appConfig.upsert({
        where: { key: 'notification.email.transport' },
        create: { key: 'notification.email.transport', value: transport },
        update: { value: transport },
      });
    }
  }
}
