import { IsIn, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const ALLOWED_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_DOCUMENT_TYPES,
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_SIZE_BY_TYPE: Record<string, number> = {
  'image/jpeg': 5 * 1024 * 1024,
  'image/png': 5 * 1024 * 1024,
  'image/gif': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
  'application/pdf': 20 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    20 * 1024 * 1024,
};

export class UploadDto {
  @ApiProperty({
    description: '업로드할 파일명 (영문자, 숫자, . _ - ( ) 허용)',
    example: 'profile-photo.jpg',
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9._\-\s()]+$/, {
    message: 'filename must be alphanumeric with . _ - ( ) allowed',
  })
  filename: string;

  @ApiProperty({
    description: '파일 MIME 타입',
    enum: ALLOWED_CONTENT_TYPES,
    example: 'image/jpeg',
  })
  @IsIn(ALLOWED_CONTENT_TYPES, {
    message: `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
  })
  contentType: AllowedContentType;
}
