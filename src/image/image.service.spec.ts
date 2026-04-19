import { ImageService } from './image.service';
import sharp from 'sharp';

vi.mock('sharp');

describe('ImageService', () => {
  let service: ImageService;

  beforeEach(() => {
    service = new ImageService();
  });

  it('Buffer를 webp로 변환한다', async () => {
    const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from('webp-data'));
    const mockWebp = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
    (sharp as unknown as vi.Mock).mockReturnValue({ webp: mockWebp });

    const input = Buffer.from('raw-image');
    const result = await service.convertToWebp(input);

    expect(sharp).toHaveBeenCalledWith(input);
    expect(mockWebp).toHaveBeenCalledWith({ quality: 80 });
    expect(result).toBeInstanceOf(Buffer);
  });
});
