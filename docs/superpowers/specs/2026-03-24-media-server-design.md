# NestJS + Cloudflare R2 미디어 서버 설계 스펙

## 1. 개요

Cloudflare R2를 스토리지 백엔드로 사용하는 NestJS 기반 미디어 서버.
모든 파일은 Presigned PUT URL로 R2에 직접 업로드하고,
이미지는 Cron으로 주기적으로 webp 변환하여 R2에 재저장한다.
뷰/다운로드는 R2 Public Bucket + Custom Domain을 통해 CDN에서 직접 서빙한다.

## 2. 요구사항

### 2.1 기능 요구사항

- **업로드**: Presigned PUT URL 발급 → 클라이언트가 R2에 직접 업로드 (이미지/문서 모두)
- **이미지 변환**: Cron이 주기적으로 R2의 `raw/` 경로에서 미변환 이미지를 webp로 변환 → `media/`로 이동
- **뷰/다운로드**: R2 Public Bucket + Custom Domain으로 CDN 직접 서빙 (서버 경유 없음)
- **삭제**: R2에서 파일 삭제

### 2.2 허용 파일 타입 및 크기 제한

| 분류 | MIME 타입 | 저장 포맷 | 최대 크기 |
|------|-----------|-----------|-----------|
| 이미지 | `image/jpeg`, `image/png`, `image/gif`, `image/webp` | webp (cron 변환) | 5MB |
| 문서 | `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 원본 그대로 | 20MB |

### 2.3 인증/접근 제어

| 기능 | 인증 방식 |
|------|-----------|
| 업로드 URL 발급 (POST) | API Key (`x-api-key` 헤더) |
| 뷰/다운로드 | Cloudflare Hotlink Protection (허용 도메인만) |
| 삭제 (DELETE) | API Key (`x-api-key` 헤더) |

### 2.4 메타데이터

- 별도 DB 없음. R2에만 파일 저장.

## 3. 아키텍처

### 3.1 시스템 구성

```
[Client]
  │
  ├─ POST /media/upload  (API Key)
  │     → presigned PUT URL 발급
  │     → 이미지: R2 raw/ 경로에 업로드
  │     → 문서: R2 media/ 경로에 업로드
  │
  ├─ GET https://media.example.com/media/:key
  │     → Cloudflare CDN에서 직접 서빙 (서버 경유 없음)
  │
  └─ DELETE /media/:key  (API Key)
        → NestJS 서버가 R2에서 파일 삭제

[Cron - 매 1분]
  └─ R2 raw/ 스캔 → sharp webp 변환 → media/에 저장 → raw/ 원본 삭제
```

### 3.2 R2 경로 구조

```
R2 Bucket
├── raw/                          # 이미지 원본 (변환 대기)
│   ├── a1b2c3d4-photo.png
│   └── b2c3d4e5-image.jpg
└── media/                        # 서빙 경로 (변환 완료 + 문서)
    ├── a1b2c3d4-photo.webp       # 변환 완료된 이미지
    ├── c3d4e5f6-report.pdf       # 문서 (직접 업로드)
    └── d4e5f6g7-doc.docx
```

- `raw/` — 이미지 원본이 임시 저장되는 경로. Cron이 처리 후 삭제.
- `media/` — 최종 서빙 경로. CDN Public Domain이 이 경로를 서빙.

### 3.3 스토리지 추상화

구체적인 스토리지 구현을 인터페이스 뒤로 숨겨, 향후 R2 외 다른 스토리지로 교체 가능하게 한다.

```
MediaService
  │
  └─ StorageProvider (interface)
       ├─ R2StorageProvider (현재 구현)
       ├─ S3StorageProvider (향후)
       └─ GCSStorageProvider (향후)

ImageConversionService (Cron)
  │
  ├─ StorageProvider (R2 읽기/쓰기/삭제)
  └─ sharp (webp 변환)
```

#### StorageProvider 인터페이스

```ts
interface StorageProvider {
  generateUploadUrl(key: string, contentType: string, maxSize: number): Promise<string>;
  getObject(key: string): Promise<{ body: Buffer; contentType: string }>;
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<{ key: string; contentType: string }[]>;
}
```

> `getObject`, `upload`, `listObjects` — Cron에서 원본 읽기, 변환 후 업로드, 목록 조회에 사용

### 3.4 CDN 구성 (Cloudflare)

- R2 버킷을 **Public Access** 활성화
- Custom Domain 연결 (예: `media.example.com`)
- **Hotlink Protection** 설정으로 허용 도메인만 접근 가능
- Cloudflare CDN 캐싱 자동 적용

## 4. API 상세

### 4.1 POST /media/upload

Presigned PUT URL을 발급한다. 파일 타입에 따라 R2 저장 경로가 달라진다.

**Request:**

```
POST /media/upload
Headers:
  x-api-key: <API_KEY>
Body:
  {
    "filename": "photo.jpg",
    "contentType": "image/jpeg"
  }
```

**Response (200):**

이미지인 경우:
```json
{
  "key": "a1b2c3d4-photo.jpg",
  "uploadUrl": "https://<bucket>.r2.cloudflarestorage.com/raw/a1b2c3d4-photo.jpg?X-Amz-...",
  "publicUrl": "https://media.example.com/media/a1b2c3d4-photo.webp",
  "expiresIn": 600
}
```

문서인 경우:
```json
{
  "key": "b2c3d4e5-report.pdf",
  "uploadUrl": "https://<bucket>.r2.cloudflarestorage.com/media/b2c3d4e5-report.pdf?X-Amz-...",
  "publicUrl": "https://media.example.com/media/b2c3d4e5-report.pdf",
  "expiresIn": 600
}
```

**내부 분기 로직:**
- 이미지 → presigned URL 경로: `raw/{key}`, publicUrl 확장자: `.webp`
- 문서 → presigned URL 경로: `media/{key}`, publicUrl 확장자: 원본 그대로

**검증:**
- `contentType`이 허용 목록에 포함되는지 확인
- `contentType`에 따라 적절한 크기 제한을 presigned URL 조건에 포함

**키 생성 규칙:**
- `uuid-원본파일명` 형식으로 고유 키 생성

### 4.2 DELETE /media/:key

R2에서 파일을 삭제한다.

**Request:**

```
DELETE /media/:key
Headers:
  x-api-key: <API_KEY>
```

**Response (204):** No Content

**삭제 대상:**
- `media/{key}` 경로의 파일 삭제
- 이미지의 경우 `raw/` 에 원본이 남아있을 수 있으므로 `raw/{key}`도 함께 삭제 시도

## 5. Cron: 이미지 변환

### 5.1 동작 방식

```
[매 1분 실행]
  │
  ├─ R2 raw/ prefix로 ListObjects
  ├─ 이미지 파일 목록 조회
  │
  ├─ 각 이미지에 대해 (동시 3개 제한):
  │   ├─ R2에서 원본 다운로드 (GetObject)
  │   ├─ sharp로 webp 변환 (quality: 80)
  │   ├─ media/ 경로에 업로드 (PutObject)
  │   └─ raw/ 원본 삭제 (DeleteObject)
  │
  └─ 처리 결과 로깅
```

### 5.2 안전장치

- **동시 처리 제한**: 최대 3개 병렬 처리 (서버 리소스 보호)
- **파일 크기 체크**: 변환 전 크기 확인, 비정상적으로 큰 파일 스킵
- **실패 시 원본 유지**: 변환 또는 업로드 실패 시 raw/ 원본을 삭제하지 않음 → 다음 Cron에서 재시도
- **중복 처리 방지**: 이미 처리 중인 파일은 스킵 (메모리 내 처리 목록 관리)

### 5.3 플로우

```
Cron                            NestJS                         R2
  │                               │                             │
  ├─ 트리거 (매 1분) ────────────►│                             │
  │                               ├─ ListObjects(raw/) ────────►│
  │                               │◄── [file1, file2, ...] ─────┤
  │                               │                             │
  │                               ├─ GetObject(raw/file1) ─────►│
  │                               │◄── 원본 바이너리 ────────────┤
  │                               ├─ sharp: webp 변환           │
  │                               ├─ PutObject(media/file1.webp)►│
  │                               │◄── OK ──────────────────────┤
  │                               ├─ DeleteObject(raw/file1) ──►│
  │                               │◄── OK ──────────────────────┤
  │                               │                             │
  │◄── 완료 로그 ─────────────────┤                             │
```

## 6. 플로우 상세

### 6.1 업로드 플로우

```
Client                          NestJS                         R2
  │                               │                             │
  ├─ POST /media/upload ─────────►│                             │
  │  (x-api-key, filename,        │                             │
  │   contentType)                 │                             │
  │                               ├─ API Key 검증               │
  │                               ├─ contentType 허용 여부 검증  │
  │                               ├─ UUID 기반 key 생성          │
  │                               ├─ 이미지? → prefix: raw/      │
  │                               │  문서?  → prefix: media/     │
  │                               ├─ presigned PUT URL 생성 ───►│
  │                               │  (만료 10분, 크기 제한)      │
  │◄── { key, uploadUrl,          │                             │
  │      publicUrl } ─────────────┤                             │
  │                               │                             │
  ├─ PUT uploadUrl + 파일 ─────────────────────────────────────►│
  │◄── 200 OK ──────────────────────────────────────────────────┤
```

### 6.2 뷰/다운로드 플로우

```
Client                          Cloudflare CDN                 R2
  │                               │                             │
  ├─ GET media.example.com/       │                             │
  │     media/:key ──────────────►│                             │
  │                               ├─ Hotlink Protection 검증    │
  │                               ├─ 캐시 히트? ──► 캐시 반환    │
  │                               ├─ 캐시 미스? ──────────────►│
  │                               │◄── 파일 반환 ───────────────┤
  │◄── 파일 반환 (+ 캐싱) ────────┤                             │
```

### 6.3 삭제 플로우

```
Client                          NestJS                         R2
  │                               │                             │
  ├─ DELETE /media/:key ─────────►│                             │
  │  (x-api-key)                  │                             │
  │                               ├─ API Key 검증               │
  │                               ├─ DeleteObject(media/:key) ─►│
  │                               ├─ DeleteObject(raw/:key) ───►│ (있으면 삭제)
  │                               │◄── OK ──────────────────────┤
  │◄── 204 No Content ───────────┤                             │
```

## 7. 프로젝트 구조

```
src/
├── app.module.ts
├── main.ts
├── config/
│   └── storage.config.ts              # R2 credentials, bucket, CDN domain, API key
├── common/
│   └── guards/
│       └── api-key.guard.ts           # x-api-key 헤더 검증
├── storage/
│   ├── storage.module.ts
│   ├── storage-provider.interface.ts  # StorageProvider 인터페이스
│   └── providers/
│       └── r2-storage.provider.ts     # R2 구현체
├── image/
│   ├── image.module.ts
│   ├── image-conversion.service.ts    # Cron: raw/ 스캔 → webp 변환 → media/ 저장
│   └── image.service.ts              # sharp를 이용한 webp 변환
└── media/
    ├── media.module.ts
    ├── media.controller.ts            # 2개 엔드포인트 (upload, delete)
    ├── media.service.ts               # StorageProvider 주입받아 사용
    └── dto/
        └── upload.dto.ts              # filename, contentType 검증
```

## 8. 기술 스택

| 패키지 | 용도 |
|--------|------|
| `@nestjs/core`, `@nestjs/common` | NestJS 프레임워크 |
| `@nestjs/config` | 환경변수 관리 |
| `@nestjs/schedule` | Cron 스케줄링 |
| `@aws-sdk/client-s3` | R2 연동 (S3 호환 API) |
| `@aws-sdk/s3-request-presigner` | Presigned URL 생성 |
| `sharp` | 이미지 → webp 변환 |
| `class-validator`, `class-transformer` | DTO 검증 |
| `uuid` | 파일 키 생성 |

## 9. 환경변수

```env
# Storage (R2)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=

# CDN
CDN_DOMAIN=media.example.com

# Auth
API_KEY=

# Cron
CRON_CONCURRENCY=3              # 동시 변환 수 제한

# Server
PORT=3000
```

## 10. Cloudflare 설정 가이드

### 10.1 R2 Public Access 활성화

1. Cloudflare 대시보드 → R2 → 버킷 선택
2. Settings → Public Access → Enable
3. Custom Domain 연결 (예: `media.example.com`)

### 10.2 Hotlink Protection

1. Cloudflare 대시보드 → 해당 도메인 → Scrape Shield
2. Hotlink Protection → On
3. 허용 도메인 추가 (예: `blog.example.com`, `admin.example.com`)

## 11. 에러 처리

| 상황 | HTTP 상태 | 응답 |
|------|-----------|------|
| API Key 누락/불일치 | 401 | Unauthorized |
| 허용되지 않은 MIME 타입 | 400 | Bad Request |
| 파일 미존재 (삭제 시) | 404 | Not Found |
| R2 연결 오류 | 502 | Bad Gateway |

### Cron 에러 처리

| 상황 | 동작 |
|------|------|
| 변환 실패 | 원본 유지, 다음 Cron에서 재시도 |
| R2 읽기 실패 | 해당 파일 스킵, 로그 기록 |
| R2 쓰기 실패 | 원본 유지, 로그 기록 |
| 원본 삭제 실패 | 로그 기록 (다음 Cron에서 재처리되어도 idempotent) |

## 12. 주의사항

### 12.1 이미지 업로드 후 publicUrl 접근 지연

이미지 업로드 시 반환되는 `publicUrl`은 webp 변환 완료 후에 접근 가능하다.
Cron 주기(1분)에 따라 최대 1분간 404가 발생할 수 있다.

**클라이언트 대응 방안:**
- 업로드 응답에 `status: "processing"` 필드를 포함하여 클라이언트가 인지할 수 있게 함
- 또는 클라이언트에서 이미지 로드 실패 시 재시도 로직 구현
