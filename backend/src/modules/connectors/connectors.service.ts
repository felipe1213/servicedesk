import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KbSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KbService } from '../kb/kb.service';
import { SharePointService } from './sharepoint.service';
import { ConfluenceService } from './confluence.service';

@Injectable()
export class ConnectorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kb: KbService,
    private readonly sharepoint: SharePointService,
    private readonly confluence: ConfluenceService,
  ) {}

  listConflicts() {
    return this.prisma.kbArticle.findMany({
      where: { syncConflict: true },
      select: { id: true, title: true, source: true, conflictData: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async resolveConflict(articleId: string, resolution: 'LOCAL' | 'REMOTE' | 'MERGED', mergedBody?: string) {
    const article = await this.prisma.kbArticle.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);
    if (!article.syncConflict) throw new BadRequestException('Article is not in conflict');

    const conflictData = article.conflictData as { remoteBody: string; remoteVersion: string } | null;

    if (resolution === 'LOCAL') {
      article.source === KbSource.SHAREPOINT
        ? await this.sharepoint.pushArticle(article as any)
        : await this.confluence.pushArticle(article as any);
      await this.prisma.kbArticle.update({
        where: { id: articleId },
        data: { syncConflict: false, conflictData: Prisma.JsonNull},
      });
      return;
    }

    if (resolution === 'REMOTE') {
      if (!conflictData) throw new BadRequestException('No conflict data');
      const updated = await this.prisma.kbArticle.update({
        where: { id: articleId },
        data: { body: conflictData.remoteBody, externalVersion: conflictData.remoteVersion, lastSyncedAt: new Date(), syncConflict: false, conflictData: Prisma.JsonNull},
      });
      await this.kb.indexArticle(updated);
      return;
    }

    if (resolution === 'MERGED') {
      if (!mergedBody) throw new BadRequestException('mergedBody required for MERGED resolution');
      const updated = await this.prisma.kbArticle.update({
        where: { id: articleId },
        data: { body: mergedBody, syncConflict: false, conflictData: Prisma.JsonNull},
      });
      article.source === KbSource.SHAREPOINT
        ? await this.sharepoint.pushArticle(updated as any)
        : await this.confluence.pushArticle(updated as any);
      await this.kb.indexArticle(updated);
    }
  }

  getLogs() {
    return this.prisma.kbSyncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 20 });
  }
}
