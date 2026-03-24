// src/media/media.controller.ts
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { UploadDto } from './dto/upload.dto';
import { MediaService, UploadUrlResult } from './media.service';

@Controller('media')
@UseGuards(ApiKeyGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  upload(@Body() dto: UploadDto): Promise<UploadUrlResult> {
    return this.mediaService.generateUploadUrl(dto.filename, dto.contentType);
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('key') key: string): Promise<void> {
    return this.mediaService.deleteFile(key);
  }
}
