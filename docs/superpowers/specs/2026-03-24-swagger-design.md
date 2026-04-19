# Swagger API 문서 추가 설계

**Date**: 2026-03-24
**Status**: Approved

---

## 개요

NestJS 미디어 서버에 OpenAPI(Swagger) 문서를 추가한다. 모든 환경에서 `/api-docs` 경로로 접근 가능하며, Basic Auth로 보호한다.

---

## 결정 사항

| 항목 | 결정 |
|------|------|
| 라이브러리 | `@nestjs/swagger` + `express-basic-auth` |
| URL 경로 | `/api-docs` |
| 노출 환경 | 전체 (개발/스테이징/프로덕션) |
| 접근 보호 | Basic Auth (`SWAGGER_USER` / `SWAGGER_PASSWORD`) |

---

## 추가 패키지

```
@nestjs/swagger
express-basic-auth
```

---

## 환경 변수

| 변수명 | 설명 | 필수 |
|--------|------|------|
| `SWAGGER_USER` | Swagger UI 접근 ID | ✅ |
| `SWAGGER_PASSWORD` | Swagger UI 접근 PW | ✅ |

미설정 시 `ConfigService.getOrThrow`로 서버 시작 실패 처리.

---

## 변경 파일

### `src/main.ts`

1. `express-basic-auth` 미들웨어를 `/api-docs` 경로에 먼저 등록
2. `DocumentBuilder`로 API 메타데이터 설정 (title, version, security scheme)
3. `SwaggerModule.createDocument` + `SwaggerModule.setup` 등록

```
app.use('/api-docs', basicAuth({ users: { [user]: password }, challenge: true }))

const document = SwaggerModule.createDocument(app, config)
SwaggerModule.setup('api-docs', app, document)
```

### `src/media/dto/upload.dto.ts`

- `filename` 필드에 `@ApiProperty` 추가 (description, example)
- `contentType` 필드에 `@ApiProperty` 추가 (description, enum 값 목록)

### `src/media/media.controller.ts`

- `@ApiTags('media')` — 컨트롤러 태그
- `@ApiSecurity('api-key')` — API Key 보안 스키마 표시
- `POST /media/upload`
  - `@ApiOperation({ summary: 'Presigned upload URL 생성' })`
  - `@ApiResponse({ status: 201, type: UploadUrlResultDto })`
  - `@ApiResponse({ status: 400, description: 'Validation error' })`
  - `@ApiResponse({ status: 401, description: 'Unauthorized' })`
- `DELETE /media/:key`
  - `@ApiOperation({ summary: '미디어 파일 삭제' })`
  - `@ApiParam({ name: 'key', description: '삭제할 파일 키' })`
  - `@ApiResponse({ status: 204, description: 'No Content' })`
  - `@ApiResponse({ status: 401, description: 'Unauthorized' })`

### `src/media/dto/upload-url-result.dto.ts` (신규)

`UploadUrlResult` 인터페이스를 Swagger 응답 스키마로 문서화하기 위한 클래스. 기존 인터페이스는 유지하고 별도 DTO 클래스로 분리.

---

## 보안 스키마

`DocumentBuilder`에 `addApiKey` 대신 커스텀 보안 스키마 등록:

```ts
.addSecurity('api-key', {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-key',
})
```

---

## 범위 외

- Swagger JSON export 자동화
- API versioning
- 기존 Guard 로직 변경 없음
