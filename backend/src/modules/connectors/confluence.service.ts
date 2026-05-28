import { Injectable, Logger } from '@nestjs/common';
import { KbArticleStatus, KbSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { ConnectorConfigService, ConfluenceConfig } from './connectors-config.service';
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
export class ConfluenceService {
  private readonly logger = new Logger(ConfluenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KbService,
    private readonly configService: ConnectorConfigService,
    private readonly converter: ContentConverterService,
  ) {}

  private authHeader(config: ConfluenceConfig): string {
    return 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  }

  private async fetchWithRetry(url: string, auth: string, options?: RequestInit, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      const res = await fetch(url, {
        ...options,
        headers: { Authorization: auth, ...(options?.headers as Record<string, string> ?? {}) },
      });
      if (res.status !== 429) return res;
      const after = parseInt(res.headers.get('retry-after') ?? '5', 10);
      await new Promise(r => setTimeout(r, after * 1000));
    }
    throw new Error(`Max retries exceeded for ${url}`);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const config = await this.configService.getConfig('confluence');
    if (!config) return { ok: false, message: 'Not configured' };
    try {
      const res = await this.fetchWithRetry(`${config.baseUrl}/wiki/rest/api/space`, this.authHeader(config));
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `API error: ${res.status}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async sync() {
    const config = await this.configService.getConfig('confluence');
    if (!config) throw new Error('Confluence not configured');
    const log = await this.prisma.kbSyncLog.create({
      data: { connector: KbSource.CONFLUENCE, startedAt: new Date(), status: 'running' },
    });
    const logRef: LogRef = { id: log.id, articlesNew: 0, articlesUpdated: 0, conflicts: 0 };
    try {
      const auth = this.authHeader(config);
      const items: ExternalItem[] = [];

      if (config.syncType === 'space') {
        let url: string | null = `${config.baseUrl}/wiki/rest/api/content?spaceKey=${config.spaceKey}&type=page&status=current&expand=body.storage,version&limit=50`;
        while (url) {
          const res = await this.fetchWithRetry(url, auth);
          const data = await res.json() as { results: any[]; _links?: { next?: string } };
          for (const p of (data.results ?? [])) {
            items.push({ id: p.id, title: p.title, body: p.body?.storage?.value ?? '', version: String(p.version?.number ?? 0), webUrl: `${config.baseUrl}/wiki${p._links?.webui ?? ''}` });
          }
          url = data._links?.next ? `${config.baseUrl}${data._links.next}` : null;
        }
      } else {
        if (!config.rootPageId) throw new Error('rootPageId is required for pagetree sync mode');
        const pages = await this.fetchDescendants(config, auth, config.rootPageId);
        items.push(...pages);
      }

      for (const item of items) {
        await this.upsertArticle(item, logRef);
      }

      // Push local edits outbound
      const localEdited = await this.prisma.kbArticle.findMany({
        where: { source: KbSource.CONFLUENCE, syncConflict: false, externalId: { not: null } },
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

  private async fetchDescendants(config: ConfluenceConfig, auth: string, rootPageId: string): Promise<ExternalItem[]> {
    const items: ExternalItem[] = [];
    let url: string | null = `${config.baseUrl}/wiki/rest/api/content/${rootPageId}/descendant/page?expand=body.storage,version&limit=50`;
    while (url) {
      const res = await this.fetchWithRetry(url, auth);
      const data = await res.json() as { results: any[]; _links?: { next?: string } };
      items.push(...(data.results ?? []).map((p: any) => ({
        id: p.id, title: p.title, body: p.body?.storage?.value ?? '',
        version: String(p.version?.number ?? 0),
        webUrl: `${config.baseUrl}/wiki${p._links?.webui ?? ''}`,
      })));
      url = data._links?.next ? `${config.baseUrl}${data._links.next}` : null;
    }
    return items;
  }

  async upsertArticle(item: ExternalItem, log: LogRef): Promise<void> {
    const existing = await this.prisma.kbArticle.findFirst({ where: { externalId: item.id } });
    const markdown = this.converter.htmlToMarkdown(item.body);

    if (!existing) {
      const slug = `cf-${item.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const created = await this.prisma.kbArticle.create({
        data: {
          title: item.title, body: markdown, tags: [],
          status: KbArticleStatus.PUBLISHED, slug,
          source: KbSource.CONFLUENCE, externalId: item.id,
          externalVersion: item.version, externalUrl: item.webUrl,
          lastSyncedAt: new Date(), publishedAt: new Date(), authorId: null,
        },
      });
      await this.kb.indexArticle(created);
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
    const config = await this.configService.getConfig('confluence');
    if (!config || !article.externalId) return;
    const auth = this.authHeader(config);
    const html = this.converter.markdownToHtml(article.body);
    const currentVersion = parseInt(article.externalVersion ?? '0', 10);
    const res = await this.fetchWithRetry(
      `${config.baseUrl}/wiki/rest/api/content/${article.externalId}`,
      auth,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: { number: currentVersion + 1 }, title: article.title, type: 'page', body: { storage: { value: html, representation: 'storage' } } }),
      },
    );
    if (!res.ok) { this.logger.warn(`Confluence push failed for article ${article.id}: ${res.status}`); return; }
    const updated = await res.json() as { version?: { number: number } };
    await this.prisma.kbArticle.update({
      where: { id: article.id },
      data: { externalVersion: String(updated.version?.number ?? currentVersion + 1), lastSyncedAt: new Date() },
    });
  }

  async exportArticle(articleId: string): Promise<void> {
    const config = await this.configService.getConfig('confluence');
    if (!config) throw new Error('Confluence not configured');
    const article = await this.prisma.kbArticle.findUniqueOrThrow({ where: { id: articleId } });
    const auth = this.authHeader(config);
    const html = this.converter.markdownToHtml(article.body);
    const res = await this.fetchWithRetry(
      `${config.baseUrl}/wiki/rest/api/content`,
      auth,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'page',
          title: article.title,
          space: { key: config.spaceKey ?? '' },
          body: { storage: { value: html, representation: 'storage' } },
        }),
      },
    );
    if (!res.ok) throw new Error(`Confluence export failed: ${res.status}`);
    const created = await res.json() as { id: string; _links?: { webui?: string }; version?: { number: number } };
    await this.prisma.kbArticle.update({
      where: { id: articleId },
      data: { source: KbSource.CONFLUENCE, externalId: created.id, externalUrl: `${config.baseUrl}/wiki${created._links?.webui ?? ''}`, externalVersion: String(created.version?.number ?? 1), lastSyncedAt: new Date() },
    });
  }
}
