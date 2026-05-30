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

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  prefix: string;
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
  async getConfig(connector: 's3'): Promise<S3Config | null>;
  async getConfig(connector: 'sharepoint' | 'confluence' | 's3'): Promise<SharePointConfig | ConfluenceConfig | S3Config | null> {
    const record = await this.prisma.appConfig.findUnique({ where: { key: `connector.${connector}` } });
    if (!record) return null;
    try {
      const parsed = JSON.parse(record.value);
      if (connector === 'sharepoint') return { ...parsed, clientSecret: this.decrypt(parsed.clientSecret) };
      if (connector === 's3') return { ...parsed, secretAccessKey: this.decrypt(parsed.secretAccessKey) };
      return { ...parsed, apiToken: this.decrypt(parsed.apiToken) };
    } catch {
      throw new Error(`Connector config for ${connector} is corrupt or encrypted with a different key`);
    }
  }

  async getRedactedConfig(connector: 'sharepoint' | 'confluence' | 's3') {
    const cfg = await this.getConfig(connector as any);
    if (!cfg) return null;
    if (connector === 'sharepoint') return { ...(cfg as unknown as SharePointConfig), clientSecret: '***' };
    if (connector === 's3') return { ...(cfg as unknown as S3Config), secretAccessKey: '***' };
    return { ...(cfg as unknown as ConfluenceConfig), apiToken: '***' };
  }

  async saveConfig(connector: 'sharepoint', config: SharePointConfig): Promise<void>;
  async saveConfig(connector: 'confluence', config: ConfluenceConfig): Promise<void>;
  async saveConfig(connector: 's3', config: S3Config): Promise<void>;
  async saveConfig(connector: 'sharepoint' | 'confluence' | 's3', config: SharePointConfig | ConfluenceConfig | S3Config): Promise<void> {
    let toStore: Record<string, unknown>;
    if (connector === 'sharepoint') {
      const sp = config as SharePointConfig;
      toStore = { ...sp, clientSecret: this.encrypt(sp.clientSecret) };
    } else if (connector === 's3') {
      const s3 = config as S3Config;
      toStore = { ...s3, secretAccessKey: this.encrypt(s3.secretAccessKey) };
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
