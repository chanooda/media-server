import { ApiProperty } from '@nestjs/swagger';

export class UploadUrlResultDto {
  @ApiProperty({ description: '파일 고유 키', example: 'a1b2c3-photo.jpg' })
  key: string;

  @ApiProperty({
    description: 'S3 presigned 업로드 URL',
    example: 'https://r2.example.com/...',
  })
  uploadUrl: string;

  @ApiProperty({
    description: 'CDN 공개 접근 URL',
    example: 'https://cdn.example.com/media/a1b2c3-photo.webp',
  })
  publicUrl: string;

  @ApiProperty({ description: 'URL 만료 시간 (초)', example: 600 })
  expiresIn: number;
}
