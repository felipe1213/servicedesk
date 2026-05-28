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
    try {
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
    } catch (err) {
      this.logger.warn(`Could not initialise Elasticsearch index ${ES_INDEX}: ${(err as any)?.message ?? err}`);
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

  async findAll(user: RequestUser) {
    const where: Record<string, unknown> = {};
    if (user.role !== Role.ADMIN && user.role !== Role.MANAGER) {
      where.status = KbArticleStatus.PUBLISHED;
    }
    return this.prisma.kbArticle.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, title: true, slug: true, status: true, tags: true,
        body: true, viewCount: true, updatedAt: true,
        author: { select: { name: true } },
      },
    });
  }

  async findOne(id: string) {
    const article = await this.prisma.kbArticle.findUnique({
      where: { id },
      include: { author: { select: { name: true } } },
    });
    if (!article) throw new NotFoundException(`Article ${id} not found`);
    await this.prisma.kbArticle.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
    return article;
  }

  async create(dto: CreateArticleDto, user: RequestUser) {
    const slug = this.generateSlug(dto.title);
    const status = dto.status ?? KbArticleStatus.DRAFT;
    const publishedAt = status === KbArticleStatus.PUBLISHED ? new Date() : null;
    const article = await this.prisma.kbArticle.create({
      data: {
        title: dto.title,
        body: dto.body,
        tags: dto.tags ?? [],
        status,
        slug,
        publishedAt,
        authorId: user.id,
      },
    });
    if (article.status === KbArticleStatus.PUBLISHED) {
      await this.indexArticle(article);
    }
    return article;
  }

  async update(id: string, dto: UpdateArticleDto) {
    const existing = await this.prisma.kbArticle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Article ${id} not found`);

    const data: Record<string, unknown> = { ...dto };
    if (dto.status === KbArticleStatus.PUBLISHED && !existing.publishedAt) {
      data.publishedAt = new Date();
    }

    const updated = await this.prisma.kbArticle.update({ where: { id }, data });

    if (updated.status === KbArticleStatus.PUBLISHED) {
      await this.indexArticle(updated);
    } else {
      await this.removeFromIndex(id);
    }

    return updated;
  }

  async remove(id: string) {
    await this.prisma.kbArticle.delete({ where: { id } });
    await this.removeFromIndex(id);
  }

  async search(q: string) {
    try {
      const result = await this.es.search({
        index: ES_INDEX,
        query: {
          multi_match: {
            query: q,
            fields: ['title^3', 'body', 'tags'],
          },
        },
      });
      return (result.hits.hits as Array<{ _id: string; _source: Record<string, any> }>).map(hit => ({
        id: hit._id,
        title: hit._source.title as string,
        slug: hit._source.slug as string,
        tags: hit._source.tags as string[],
        excerpt: (hit._source.body as string).slice(0, 200),
      }));
    } catch {
      throw new ServiceUnavailableException('Search unavailable');
    }
  }

  async suggest(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);

    const likeText = `${ticket.title} ${ticket.description}`;
    const result = await this.es.search({
      index: ES_INDEX,
      query: {
        more_like_this: {
          fields: ['title', 'body'],
          like: likeText,
          min_term_freq: 1,
          min_doc_freq: 1,
        },
      },
      size: 5,
      _source: ['title', 'slug'],
    });
    return (result.hits.hits as Array<{ _id: string; _source: Record<string, any> }>).map(hit => ({
      id: hit._id,
      title: hit._source.title as string,
      slug: hit._source.slug as string,
    }));
  }

  async deflect(
    articleId: string,
    ticketId: string | undefined,
    type: DeflectionType,
    user: RequestUser,
  ) {
    const article = await this.prisma.kbArticle.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);

    if (ticketId) {
      const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);
      if (type === DeflectionType.END_USER && ticket.createdById !== user.id) {
        throw new ForbiddenException('Cannot deflect a ticket you did not create');
      }
    }

    const deflection = await this.prisma.kbDeflection.create({
      data: { articleId, ticketId, type },
    });

    if (type === DeflectionType.AGENT && ticketId) {
      try {
        await this.ticketsService.update(ticketId, { status: TicketStatus.RESOLVED }, user);
      } catch (e) {
        this.logger.warn(`Could not resolve ticket ${ticketId}: ${(e as Error).message}`);
      }
    }

    return deflection;
  }
}
