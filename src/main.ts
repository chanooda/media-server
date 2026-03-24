import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import basicAuth from 'express-basic-auth';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ConfigService는 DI 컨테이너 초기화 후에만 사용 가능하므로
  // 부트스트랩 단계에서는 process.env를 직접 읽는 것이 표준 NestJS 패턴이다.
  const swaggerUser = process.env.SWAGGER_USER;
  const swaggerPassword = process.env.SWAGGER_PASSWORD;
  if (!swaggerUser || !swaggerPassword) {
    throw new Error('SWAGGER_USER and SWAGGER_PASSWORD must be set');
  }

  // /api-docs-json도 함께 보호 — Swagger UI가 이 경로로 OpenAPI 스펙을 fetch하기 때문
  app.use(
    ['/api-docs', '/api-docs-json'],
    basicAuth({
      users: { [swaggerUser]: swaggerPassword },
      challenge: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Media Server API')
    .setDescription('미디어 파일 업로드 및 관리 API')
    .setVersion('1.0')
    .addSecurity('api-key', {
      type: 'apiKey',
      in: 'header',
      name: 'x-api-key',
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
