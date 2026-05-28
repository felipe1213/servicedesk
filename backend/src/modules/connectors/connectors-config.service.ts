import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

export interface SharePointConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  syncType: 'library' | 'pages';
  libraryName?: string;
  rootPageId?: string;
  enabled: boolean;
  syncIntervalMinutes: number;
}

export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  syncType: 'space' | 'pagetree';
  spaceKey?: string;
  rootPageId?: string;
  enabled: boolean;
  syncIntervalMinutes: number;
}

@Injectable()
export class ConnectorConfigService {
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

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(stored: string): string {
    const [ivHex, authTagHex, encryptedHex] = stored.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  async getConfig(connector: 'sharepoint'): Promise<SharePointConfig | null>;
  async getConfig(connector: 'confluence'): Promise<ConfluenceConfig | null>;
  async getConfig(connector: 'sharepoint' | 'confluence'): Promise<SharePointConfig | ConfluenceConfig | null> {
    const record = await this.prisma.appConfig.findUnique({ where: { key: `connector.${connector}` } });
    if (!record) return null;
    try {
      const parsed = JSON.parse(record.value);
      if (connector === 'sharepoint') return { ...parsed, clientSecret: this.decrypt(parsed.clientSecret) };
      return { ...parsed, apiToken: this.decrypt(parsed.apiToken) };
    } catch {
      throw new Error(`Connector config for ${connector} is corrupt or encrypted with a different key`);
    }
  }

  async getRedactedConfig(connector: 'sharepoint' | 'confluence') {
    const cfg = await this.getConfig(connector as any);
    if (!cfg) return null;
    if (connector === 'sharepoint') return { ...(cfg as SharePointConfig), clientSecret: '***' };
    return { ...(cfg as unknown as ConfluenceConfig), apiToken: '***' };
  }

  async saveConfig(connector: 'sharepoint', config: SharePointConfig): Promise<void>;
  async saveConfig(connector: 'confluence', config: ConfluenceConfig): Promise<void>;
  async saveConfig(connector: 'sharepoint' | 'confluence', config: SharePointConfig | ConfluenceConfig): Promise<void> {
    let toStore: Record<string, unknown>;
    if (connector === 'sharepoint') {
      const sp = config as SharePointConfig;
      toStore = { ...sp, clientSecret: this.encrypt(sp.clientSecret) };
    } else {
      const cf = config as ConfluenceConfig;
      toStore = { ...cf, apiToken: this.encrypt(cf.apiToken) };
    }
    const value = JSON.stringify(toStore);
    await this.prisma.appConfig.upsert({
      where: { key: `connector.${connector}` },
      create: { key: `connector.${connector}`, value },
      update: { value },
    });
  }
}
