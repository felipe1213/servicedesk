import { Controller, Get, Post, Param, Request, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { AttachmentsService } from './attachments.service';

type RequestUser = { id: string; role: Role };

@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private attachments: AttachmentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  upload(
    @Param('ticketId') ticketId: string,
    @Request() req: { user: RequestUser },
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachments.upload(ticketId, req.user, file);
  }

  @Get()
  findByTicket(
    @Param('ticketId') ticketId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.attachments.findByTicket(ticketId, req.user);
  }
}
