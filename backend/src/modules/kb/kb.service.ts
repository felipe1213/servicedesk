import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { DeflectionType, KbArticleStatus, Role, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

type RequestUser = { id: string; role: Role };

const ES_INDEX = 'kb_articles';

@Injectable()
export class KbService implements OnModuleInit {
  private readonly logger = new Logger(KbService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly es: ElasticsearchService,
    private readonly ticketsService: TicketsService,
  ) {}

  async onModuleInit() {
    const exists = await this.es.indices.exists({ index: ES_INDEX });
    if (!exists) {
      await this.es.indices.create({
        index: ES_INDEX,
        mappings: {
          properties: {
            title: { type: 'text' },
            body: { type: 'text' },
            tags: { type: 'keyword' },
            slug: { type: 'keyword' },
            publishedAt: { type: 'date' },
          },
        },
      });
      this.logger.log(`Created Elasticsearch index ${ES_INDEX}`);
    }
  }

  private generateSlug(title: string): string {
    const base = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base}-${suffix}`;
  }

  private async indexArticle(article: {
    id: string; title: string; body: string; tags: string[];
    slug: string; publishedAt: Date | null;
  }) {
    try {
      await this.es.index({
        index: ES_INDEX,
        id: article.id,
        document: {
          title: article.title,
          body: article.body,
          tags: article.tags,
          slug: article.slug,
          publishedAt: article.publishedAt,
        },
      });
    } catch (e) {
      this.logger.warn(`ES index failed for article ${article.id}: ${(e as Error).message}`);
    }
  }

  private async removeFromIndex(id: string) {
    try {
      await this.es.delete({ index: ES_INDEX, id });
    } catch (e) {
      this.logger.warn(`ES delete failed for article ${id}: ${(e as Error).message}`);
    }
  }
}
