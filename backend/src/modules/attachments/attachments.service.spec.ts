import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AttachmentsService } from './attachments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { MINIO_CLIENT, PRESIGNED_EXPIRY_SECONDS } from './attachments.constants';

const mockPrisma = {
  ticket: { findUnique: jest.fn() },
  attachment: { create: jest.fn(), findMany: jest.fn() },
};

const mockMinio = {
  putObject: jest.fn(),
  presignedGetObject: jest.fn(),
};

const mockConfig = { get: jest.fn((_key: string, def?: string) => def) };

describe('AttachmentsService', () => {
  let service: AttachmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MINIO_CLIENT, useValue: mockMinio },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<AttachmentsService>(AttachmentsService);
    jest.clearAllMocks();
  });

  const agent = { id: 'agent-1', role: Role.AGENT };
  const endUser = { id: 'user-1', role: Role.END_USER };
  const mockFile = {
    originalname: 'test.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('data'),
    size: 4,
  } as Express.Multer.File;

  describe('upload', () => {
    it('puts object in MinIO and creates Attachment row', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'agent-1' });
      mockMinio.putObject.mockResolvedValue(undefined);
      const attachment = { id: 'a1', filename: 'test.pdf' };
      mockPrisma.attachment.create.mockResolvedValue(attachment);

      const result = await service.upload('t1', agent, mockFile);

      expect(mockMinio.putObject).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^tickets\/t1\//),
        mockFile.buffer,
        mockFile.size,
        expect.objectContaining({ 'Content-Type': 'application/pdf' }),
      );
      expect(mockPrisma.attachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ticketId: 't1', filename: 'test.pdf', mimeType: 'application/pdf' }),
        }),
      );
      expect(result).toBe(attachment);
    });

    it('throws NotFoundException when ticket does not exist', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(null);
      await expect(service.upload('bad', agent, mockFile)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when END_USER uploads to another user ticket', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'other' });
      await expect(service.upload('t1', endUser, mockFile)).rejects.toThrow(ForbiddenException);
    });

    it('throws ServiceUnavailableException when MinIO fails', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'agent-1' });
      mockMinio.putObject.mockRejectedValue(new Error('connection refused'));
      await expect(service.upload('t1', agent, mockFile)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('findByTicket', () => {
    it('returns attachments with presigned download URLs', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'agent-1' });
      mockPrisma.attachment.findMany.mockResolvedValue([
        { id: 'a1', storagePath: 'tickets/t1/file.pdf', filename: 'file.pdf' },
      ]);
      mockMinio.presignedGetObject.mockResolvedValue('https://minio/signed');

      const result = await service.findByTicket('t1', agent);

      expect(result).toHaveLength(1);
      expect(result[0].downloadUrl).toBe('https://minio/signed');
      expect(mockPrisma.attachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ticketId: 't1' } }),
      );
    });

    it('returns empty array when ticket has no attachments', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 't1', createdById: 'agent-1' });
      mockPrisma.attachment.findMany.mockResolvedValue([]);
      mockMinio.presignedGetObject.mockResolvedValue('https://minio/signed');
      const result = await service.findByTicket('t1', agent);
      expect(result).toHaveLength(0);
    });
  });

  describe('getPresignedUrl', () => {
    it('calls MinIO with correct key and expiry', async () => {
      mockMinio.presignedGetObject.mockResolvedValue('https://minio/signed');
      const result = await service.getPresignedUrl('tickets/t1/file.pdf');
      expect(mockMinio.presignedGetObject).toHaveBeenCalledWith(
        expect.any(String),
        'tickets/t1/file.pdf',
        PRESIGNED_EXPIRY_SECONDS,
      );
      expect(result).toBe('https://minio/signed');
    });
  });
});
