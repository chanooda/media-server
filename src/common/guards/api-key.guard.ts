import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string> }>();
    const apiKey = request.headers['x-api-key'];
    const validKey = this.configService.get<string>('storage.apiKey');

    if (!apiKey || !validKey || apiKey !== validKey) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
