import { ApiKeyGuard } from './api-key.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function makeContext(apiKey: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: apiKey ? { 'x-api-key': apiKey } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  const configService = {
    get: vi.fn().mockReturnValue('secret'),
  } as unknown as ConfigService;

  beforeEach(() => {
    guard = new ApiKeyGuard(configService);
  });

  it('유효한 API Key이면 true 반환', () => {
    expect(guard.canActivate(makeContext('secret'))).toBe(true);
    expect(configService.get).toHaveBeenCalledWith('storage.apiKey');
  });

  it('API Key가 없으면 UnauthorizedException', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('API Key가 틀리면 UnauthorizedException', () => {
    expect(() => guard.canActivate(makeContext('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('API_KEY 환경변수가 설정되지 않으면 UnauthorizedException', () => {
    const emptyConfigService = {
      get: vi.fn().mockReturnValue(''),
    } as unknown as ConfigService;
    const guardWithEmptyConfig = new ApiKeyGuard(emptyConfigService);
    expect(() =>
      guardWithEmptyConfig.canActivate(makeContext('any-key')),
    ).toThrow(UnauthorizedException);
  });
});
