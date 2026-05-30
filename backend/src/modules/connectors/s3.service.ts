import { Injectable, Logger } from '@nestjs/common';
import { KbArticleStatus, KbSource } from '@prisma/client';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { ConnectorConfigService, S3Config } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';

const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.html', '.pdf'] as const;

@Injectable()
export class S3ConnectorService {
  private readonly logger = new Logger(S3ConnectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KbService,
    private readonly configService: ConnectorConfigService,
    private readonly converter: ContentConverterService,
  ) {}

  private makeClient(config: S3Config): S3Client {
    return new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey ?? '',
      },
    });
  }

  private async readBody(body: Readable): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk as Uint8Array);
    return Buffer.concat(chunks);
  }

  private titleFromKey(key: string): string {
    const filename = key.split('/').pop() ?? key;
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const config = await this.configService.getConfig('s3');
    if (!config) return { ok: false, message: 'Not configured' };
    try {
      const client = this.makeClient(config);
      await client.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }));
      return { ok: true, message: 'Connection successful' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async sync() {
    const config = await this.configService.getConfig('s3');
    if (!config) throw new Error('S3 not configured');
    const log = await this.prisma.kbSyncLog.create({
      data: { connector: KbSource.S3, startedAt: new Date(), status: 'running' },
    });
    try {
      const client = this.makeClient(config);
      let continuationToken: string | undefined;

      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: config.prefix || undefined,
            ContinuationToken: continuationToken,
          }),
        );

        for (const obj of res.Contents ?? []) {
          const key = obj.Key!;
          const ext = key.substring(key.lastIndexOf('.')).toLowerCase();
          if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) continue;

          const externalId = `${config.bucket}/${key}`;
          const existing = await this.prisma.kbArticle.findFirst({ where: { externalId } });
          if (existing?.externalVersion === obj.ETag) continue;

          const getRes = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
          const buffer = await this.readBody(getRes.Body as Readable);

          let body: string;
          try {
            if (ext === '.pdf') {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
              const parsed = await pdfParse(buffer);
              body = parsed.text;
            } else if (ext === '.html') {
              body = this.converter.htmlToMarkdown(buffer.toString('utf-8'));
            } else {
              body = buffer.toString('utf-8');
            }
          } catch (e) {
            this.logger.warn(`Skipping ${key}: ${(e as Error).message}`);
            continue;
          }

          const title = this.titleFromKey(key);
          const slug = `s3-${key.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

          if (!existing) {
            const created = await this.prisma.kbArticle.create({
              data: {
                title, body, tags: [],
                status: KbArticleStatus.PUBLISHED, slug,
                source: KbSource.S3, externalId,
                externalVersion: obj.ETag!,
                externalUrl: `s3://${config.bucket}/${key}`,
                lastSyncedAt: new Date(), publishedAt: new Date(), authorId: null,
              },
            });
            await this.kb.indexArticle(created);
            await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesNew: { increment: 1 } } });
          } else {
            const updated = await this.prisma.kbArticle.update({
              where: { id: existing.id },
              data: { title, body, externalVersion: obj.ETag!, lastSyncedAt: new Date() },
            });
            if (updated.status === KbArticleStatus.PUBLISHED) await this.kb.indexArticle(updated);
            await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesUpdated: { increment: 1 } } });
          }
        }

        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);

      return this.prisma.kbSyncLog.update({
        where: { id: log.id },
        data: { completedAt: new Date(), status: 'success' },
      });
    } catch (e) {
      return this.prisma.kbSyncLog.update({
        where: { id: log.id },
        data: { completedAt: new Date(), status: 'failed', errorMessage: (e as Error).message },
      });
    }
  }
}
