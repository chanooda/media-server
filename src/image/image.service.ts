import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

@Injectable()
export class ImageService {
  async convertToWebp(input: Buffer): Promise<Buffer> {
    return sharp(input).webp({ quality: 80 }).toBuffer();
  }
}
