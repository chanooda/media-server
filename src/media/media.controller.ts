// src/media/media.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { UploadDto } from './dto/upload.dto';
import { UploadUrlResultDto } from './dto/upload-url-result.dto';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':key')
  @Redirect()
  @ApiOperation({
    summary: '미디어 파일 조회 (인증 불필요)',
    description:
      'WebP 변환이 완료된 경우 WebP를, 변환 중이면 원본 파일로 302 리다이렉트합니다.',
  })
  @ApiParam({
    name: 'key',
    description: '파일 키 (upload 응답의 key 값)',
    example: 'a1b2c3-photo.jpg',
  })
  @ApiResponse({ status: 302, description: '파일 presigned URL로 리다이렉트' })
  @ApiResponse({ status: 404, description: '파일 없음' })
  async getFile(
    @Param('key') key: string,
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.mediaService.getFileRedirectUrl(key);
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Post('upload')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Presigned upload URL 생성',
    description:
      '파일 업로드용 presigned URL을 반환합니다. 반환된 uploadUrl로 직접 PUT 요청하여 파일을 업로드하세요.',
  })
  @ApiResponse({
    status: 201,
    description: 'Presigned URL 생성 성공',
    type: UploadUrlResultDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation 오류 (잘못된 filename 또는 contentType)',
  })
  @ApiResponse({ status: 401, description: 'API Key 없음 또는 유효하지 않음' })
  upload(@Body() dto: UploadDto): Promise<UploadUrlResultDto> {
    return this.mediaService.generateUploadUrl(dto.filename, dto.contentType);
  }

  @Delete(':key')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '미디어 파일 삭제',
    description: '지정한 키의 파일을 스토리지에서 삭제합니다.',
  })
  @ApiParam({
    name: 'key',
    description: '삭제할 파일 키 (upload 응답의 key 값)',
    example: 'a1b2c3-photo.jpg',
  })
  @ApiResponse({ status: 204, description: '삭제 성공' })
  @ApiResponse({ status: 401, description: 'API Key 없음 또는 유효하지 않음' })
  delete(@Param('key') key: string): Promise<void> {
    return this.mediaService.deleteFile(key);
  }
}
