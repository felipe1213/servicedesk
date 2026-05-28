import { Injectable, Logger } from '@nestjs/common';
import { KbArticleStatus, KbSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { ConnectorConfigService, SharePointConfig } from './connectors-config.service';
import { ContentConverterService } from './content-converter.service';

interface ExternalItem {
  id: string;
  title: string;
  body: string;
  version: string;
  webUrl: string;
}

interface LogRef {
  id: string;
  articlesNew: number;
  articlesUpdated: number;
  conflicts: number;
}

@Injectable()
export class SharePointService {
  private readonly logger = new Logger(SharePointService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KbService,
    private readonly configService: ConnectorConfigService,
    private readonly converter: ContentConverterService,
  ) {}

  private async getAccessToken(config: SharePointConfig): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.value;
    }
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    if (!res.ok) throw new Error(`SharePoint OAuth failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { access_token: string; expires_in: number };
    this.cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return this.cachedToken.value;
  }

  private siteId(siteUrl: string): string {
    const u = new URL(siteUrl);
    return `${u.hostname}:${u.pathname}`;
  }

  private async fetchWithRetry(url: string, token: string, options?: RequestInit, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      const res = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options?.headers as Record<string, string> ?? {}) },
      });
      if (res.status !== 429) return res;
      const after = parseInt(res.headers.get('retry-after') ?? '5', 10);
      await new Promise(r => setTimeout(r, after * 1000));
    }
    throw new Error(`Max retries exceeded for ${url}`);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const config = await this.configService.getConfig('sharepoint');
    if (!config) return { ok: false, message: 'Not configured' };
    try {
      const token = await this.getAccessToken(config);
      const res = await this.fetchWithRetry(
        `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(this.siteId(config.siteUrl))}`,
        token,
      );
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `API error: ${res.status}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async sync() {
    const config = await this.configService.getConfig('sharepoint');
    if (!config) throw new Error('SharePoint not configured');
    const log = await this.prisma.kbSyncLog.create({
      data: { connector: KbSource.SHAREPOINT, startedAt: new Date(), status: 'running' },
    });
    const logRef: LogRef = { id: log.id, articlesNew: 0, articlesUpdated: 0, conflicts: 0 };
    try {
      const token = await this.getAccessToken(config);
      const sid = encodeURIComponent(this.siteId(config.siteUrl));
      const items: ExternalItem[] = [];

      if (config.syncType === 'pages') {
        const res = await this.fetchWithRetry(`https://graph.microsoft.com/v1.0/sites/${sid}/pages`, token);
        const data = await res.json() as { value: any[] };
        for (const p of (data.value ?? [])) {
          items.push({ id: p.id, title: p.title, body: p.webHtml ?? '', version: p['@odata.etag'] ?? '', webUrl: p.webUrl ?? '' });
        }
      } else {
        const dRes = await this.fetchWithRetry(`https://graph.microsoft.com/v1.0/sites/${sid}/drives`, token);
        const drives = await dRes.json() as { value: any[] };
        const drive = drives.value?.find((d: any) => d.name === config.libraryName) ?? drives.value?.[0];
        if (drive) {
          const fRes = await this.fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${drive.id}/root/children`, token);
          const files = await fRes.json() as { value: any[] };
          for (const f of (files.value ?? []).filter((f: any) => f.name.endsWith('.md'))) {
            const cRes = await fetch(f['@microsoft.graph.downloadUrl']);
            items.push({ id: f.id, title: f.name.replace('.md', ''), body: await cRes.text(), version: f.eTag ?? '', webUrl: f.webUrl ?? '' });
          }
        }
      }

      for (const item of items) {
        await this.upsertArticle(item, logRef);
      }

      // Push local edits outbound
      const localEdited = await this.prisma.kbArticle.findMany({
        where: { source: KbSource.SHAREPOINT, syncConflict: false, externalId: { not: null } },
      });
      for (const article of localEdited) {
        if (article.lastSyncedAt && article.updatedAt > article.lastSyncedAt) {
          await this.pushArticle(article as any);
        }
      }

      const status = logRef.conflicts > 0 ? 'partial' : 'success';
      return this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { completedAt: new Date(), status } });
    } catch (e) {
      return this.prisma.kbSyncLog.update({
        where: { id: log.id },
        data: { completedAt: new Date(), status: 'failed', errorMessage: (e as Error).message },
      });
    }
  }

  async upsertArticle(item: ExternalItem, log: LogRef): Promise<void> {
    const existing = await this.prisma.kbArticle.findFirst({ where: { externalId: item.id } });
    const markdown = this.converter.htmlToMarkdown(item.body);

    if (!existing) {
      const slug = item.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Math.random().toString(36).slice(2, 8);
      await this.prisma.kbArticle.create({
        data: {
          title: item.title, body: markdown, tags: [],
          status: KbArticleStatus.PUBLISHED, slug,
          source: KbSource.SHAREPOINT, externalId: item.id,
          externalVersion: item.version, externalUrl: item.webUrl,
          lastSyncedAt: new Date(), publishedAt: new Date(), authorId: null,
        },
      });
      const created = await this.prisma.kbArticle.findFirst({ where: { externalId: item.id } });
      if (created) await this.kb.indexArticle(created);
      await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesNew: { increment: 1 } } });
      log.articlesNew++;
      return;
    }

    if (existing.externalVersion === item.version) return;

    const localEdited = existing.lastSyncedAt ? existing.updatedAt > existing.lastSyncedAt : false;

    if (localEdited) {
      await this.prisma.kbArticle.update({
        where: { id: existing.id },
        data: {
          syncConflict: true,
          conflictData: { remoteTitle: item.title, remoteBody: markdown, remoteVersion: item.version, detectedAt: new Date().toISOString() },
        },
      });
      await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { conflicts: { increment: 1 } } });
      log.conflicts++;
      return;
    }

    const updated = await this.prisma.kbArticle.update({
      where: { id: existing.id },
      data: { title: item.title, body: markdown, externalVersion: item.version, lastSyncedAt: new Date() },
    });
    if (updated.status === KbArticleStatus.PUBLISHED) await this.kb.indexArticle(updated);
    await this.prisma.kbSyncLog.update({ where: { id: log.id }, data: { articlesUpdated: { increment: 1 } } });
    log.articlesUpdated++;
  }

  async pushArticle(article: { id: string; title: string; body: string; externalId: string | null; externalVersion: string | null }): Promise<void> {
    const config = await this.configService.getConfig('sharepoint');
    if (!config || !article.externalId) return;
    const token = await this.getAccessToken(config);
    const html = this.converter.markdownToHtml(article.body);
    const sid = encodeURIComponent(this.siteId(config.siteUrl));
    const res = await this.fetchWithRetry(
      `https://graph.microsoft.com/v1.0/sites/${sid}/pages/${article.externalId}`,
      token,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: article.title, webHtml: html }) },
    );
    if (!res.ok) { this.logger.warn(`SharePoint push failed for article ${article.id}: ${res.status}`); return; }
    const etag = res.headers.get('etag') ?? article.externalVersion ?? '';
    await this.prisma.kbArticle.update({ where: { id: article.id }, data: { externalVersion: etag, lastSyncedAt: new Date() } });
  }

  async exportArticle(articleId: string): Promise<void> {
    const config = await this.configService.getConfig('sharepoint');
    if (!config) throw new Error('SharePoint not configured');
    const article = await this.prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
    const token = await this.getAccessToken(config);
    const html = this.converter.markdownToHtml(article.body);
    const sid = encodeURIComponent(this.siteId(config.siteUrl));
    const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${sid}/pages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: article.title, webHtml: html }),
    });
    if (!res.ok) throw new Error(`SharePoint export failed: ${res.status} ${await res.text()}`);
    const created = await res.json() as { id: string; webUrl: string; '@odata.etag'?: string };
    await this.prisma.kbArticle.update({
      where: { id: articleId },
      data: { source: KbSource.SHAREPOINT, externalId: created.id, externalUrl: created.webUrl, externalVersion: created['@odata.etag'] ?? '', lastSyncedAt: new Date() },
    });
  }
}
