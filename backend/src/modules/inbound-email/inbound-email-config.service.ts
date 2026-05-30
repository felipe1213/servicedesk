import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateInboundTransportDto, UpdateInboundAccessDto } from './dto/update-inbound-config.dto';

@Injectable()
export class InboundEmailConfigService {
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

  async getConfig(): Promise<{ transport: 'IMAP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }> {
    const transportRecord = await this.prisma.appConfig.findUnique({
      where: { key: 'email.inbound.transport' },
    });
    const transport = (transportRecord?.value as 'IMAP' | 'GRAPH' | 'NONE') ?? 'NONE';
    if (transport === 'NONE' || !transportRecord) return { transport: 'NONE', config: {} };

    const configKey = transport === 'IMAP' ? 'email.inbound.imap' : 'email.inbound.graph';
    const configRecord = await this.prisma.appConfig.findUnique({ where: { key: configKey } });
    if (!configRecord) return { transport, config: {} };

    try {
      const raw = JSON.parse(configRecord.value) as Record<string, unknown>;
      if (transport === 'IMAP') {
        return { transport, config: { ...raw, pass: this.decrypt(raw.pass as string) } };
      }
      return { transport, config: { ...raw, clientSecret: this.decrypt(raw.clientSecret as string) } };
    } catch {
      return { transport, config: {} };
    }
  }

  async getRedactedConfig(): Promise<{ transport: 'IMAP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> }> {
    const { transport, config } = await this.getConfig();
    if (transport === 'IMAP' && config.pass) return { transport, config: { ...config, pass: '***' } };
    if (transport === 'GRAPH' && config.clientSecret) return { transport, config: { ...config, clientSecret: '***' } };
    return { transport, config };
  }

  async saveConfig(dto: UpdateInboundTransportDto): Promise<void> {
    const { transport } = dto;

    if (transport === 'IMAP') {
      if (!dto.host || !dto.port || dto.secure === undefined || !dto.user || !dto.pass) {
        throw new BadRequestException('IMAP transport requires host, port, secure, user, and pass');
      }
      const toStore = {
        host: dto.host,
        port: dto.port,
        secure: dto.secure,
        user: dto.user,
        pass: this.encrypt(dto.pass),
        mailbox: dto.mailbox ?? 'INBOX',
      };
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.transport' },
        create: { key: 'email.inbound.transport', value: transport },
        update: { value: transport },
      });
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.imap' },
        create: { key: 'email.inbound.imap', value: JSON.stringify(toStore) },
        update: { value: JSON.stringify(toStore) },
      });
    } else if (transport === 'GRAPH') {
      if (!dto.tenantId || !dto.clientId || !dto.clientSecret || !dto.mailboxAddress) {
        throw new BadRequestException('Graph transport requires tenantId, clientId, clientSecret, and mailboxAddress');
      }
      const toStore = {
        tenantId: dto.tenantId,
        clientId: dto.clientId,
        clientSecret: this.encrypt(dto.clientSecret),
        mailboxAddress: dto.mailboxAddress,
      };
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.transport' },
        create: { key: 'email.inbound.transport', value: transport },
        update: { value: transport },
      });
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.graph' },
        create: { key: 'email.inbound.graph', value: JSON.stringify(toStore) },
        update: { value: JSON.stringify(toStore) },
      });
    } else {
      await this.prisma.appConfig.upsert({
        where: { key: 'email.inbound.transport' },
        create: { key: 'email.inbound.transport', value: 'NONE' },
        update: { value: 'NONE' },
      });
    }
  }

  async getAccessControl(): Promise<{ mode: 'ANYONE' | 'DOMAINS' | 'USERS'; list: string[] }> {
    const modeRecord = await this.prisma.appConfig.findUnique({ where: { key: 'email.inbound.access.mode' } });
    const mode = (modeRecord?.value as 'ANYONE' | 'DOMAINS' | 'USERS') ?? 'ANYONE';
    const listRecord = await this.prisma.appConfig.findUnique({ where: { key: 'email.inbound.access.list' } });
    const list: string[] = listRecord ? (JSON.parse(listRecord.value) as string[]) : [];
    return { mode, list };
  }

  async saveAccessControl(dto: UpdateInboundAccessDto): Promise<void> {
    await this.prisma.appConfig.upsert({
      where: { key: 'email.inbound.access.mode' },
      create: { key: 'email.inbound.access.mode', value: dto.mode },
      update: { value: dto.mode },
    });
    await this.prisma.appConfig.upsert({
      where: { key: 'email.inbound.access.list' },
      create: { key: 'email.inbound.access.list', value: JSON.stringify(dto.list ?? []) },
      update: { value: JSON.stringify(dto.list ?? []) },
    });
  }
}
