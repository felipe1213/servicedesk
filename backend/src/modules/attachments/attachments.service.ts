import { Injectable, Inject, NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MINIO_CLIENT, MINIO_BUCKET_DEFAULT, PRESIGNED_EXPIRY_SECONDS } from './attachments.constants';

type RequestUser = { id: string; role: Role };

@Injectable()
export class AttachmentsService {
  constructor(
    private prisma: PrismaService,
    @Inject(MINIO_CLIENT) private minio: Minio.Client,
    private config: ConfigService,
  ) {}

  private get bucket() {
    return this.config.get<string>('MINIO_BUCKET', MINIO_BUCKET_DEFAULT);
  }

  async upload(ticketId: string, user: RequestUser, file: Express.Multer.File) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    const key = `tickets/${ticketId}/${crypto.randomUUID()}-${file.originalname}`;

    try {
      await this.minio.putObject(this.bucket, key, file.buffer, file.size, {
        'Content-Type': file.mimetype,
      });
    } catch {
      throw new ServiceUnavailableException('File storage unavailable');
    }

    return this.prisma.attachment.create({
      data: {
        ticketId,
        filename: file.originalname,
        mimeType: file.mimetype,
        storagePath: key,
        uploadedById: user.id,
      },
    });
  }

  async findByTicket(ticketId: string, user: RequestUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (user.role === Role.END_USER && ticket.createdById !== user.id) throw new ForbiddenException();

    const attachments = await this.prisma.attachment.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      attachments.map(async (a) => ({
        ...a,
        downloadUrl: await this.minio.presignedGetObject(this.bucket, a.storagePath, PRESIGNED_EXPIRY_SECONDS),
      })),
    );
  }

  // Internal helper — callers catch and log attachment errors; no NestJS exception wrapping needed.
  async uploadBuffer(
    ticketId: string,
    userId: string,
    filename: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<void> {
    const key = `tickets/${ticketId}/${crypto.randomUUID()}-${filename}`;
    await this.minio.putObject(this.bucket, key, buffer, buffer.length, { 'Content-Type': mimeType });
    await this.prisma.attachment.create({
      data: { ticketId, filename, mimeType, storagePath: key, uploadedById: userId },
    });
  }

  getPresignedUrl(key: string): Promise<string> {
    return this.minio.presignedGetObject(this.bucket, key, PRESIGNED_EXPIRY_SECONDS);
  }
}
