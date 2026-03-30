# Docker Blue-Green 배포 파이프라인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NestJS media-server를 홈서버(Ubuntu)에 Docker Blue-Green 배포로 무중단 자동 배포

**Architecture:** GitHub Actions가 이미지를 빌드해 self-hosted registry에 push하고, SSH로 서버의 deploy.sh를 실행해 Blue-Green 컨테이너를 전환한다. nginx symlink를 교체해 트래픽을 전환하고 헬스체크로 안정성을 검증한다.

**Tech Stack:** NestJS 11, Docker, Docker Compose V2, nginx, GitHub Actions, Let's Encrypt (Certbot), pnpm

---

## 파일 구조

```
프로젝트 루트 (repo)
├── Dockerfile                          # 신규: 멀티스테이지 빌드
├── .dockerignore                       # 신규
├── src/
│   ├── health/
│   │   ├── health.controller.ts        # 신규: GET /health
│   │   ├── health.controller.spec.ts   # 신규: 유닛 테스트
│   │   └── health.module.ts            # 신규
│   └── app.module.ts                   # 수정: HealthModule import 추가
├── deploy/
│   ├── docker-compose.yml              # 신규: registry + blue + green 서비스
│   ├── deploy.sh                       # 신규: Blue-Green 전환 스크립트
│   └── nginx/
│       ├── conf.d/
│       │   ├── registry.conf           # 신규: registry 가상호스트
│       │   └── media.conf              # 신규: media 가상호스트
│       └── upstream/
│           ├── blue.conf               # 신규: upstream app { server 127.0.0.1:3001; }
│           └── green.conf              # 신규: upstream app { server 127.0.0.1:3002; }
└── .github/
    └── workflows/
        └── deploy.yml                  # 신규: CI/CD 워크플로우
```

서버 `/opt/media-server/`는 `deploy/` 내용 복사본 + `.env` + `active_color` + `registry/` + `nginx/upstream/active.conf`(symlink)로 구성된다.

---

## Task 1: /health 엔드포인트 추가

`deploy.sh`의 헬스체크가 의존하는 엔드포인트. `GET /health` → `{ status: "ok" }` + HTTP 200.

**Files:**
- Create: `src/health/health.controller.ts`
- Create: `src/health/health.controller.spec.ts`
- Create: `src/health/health.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/health/health.controller.spec.ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = module.get(HealthController);
  });

  it('should return status ok', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test
```
Expected: ERROR — `Cannot find module './health.controller'` (모듈 없음으로 에러 발생, Vitest 정상 동작)

- [ ] **Step 3: HealthController 구현**

```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 4: HealthModule 생성**

```typescript
// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

- [ ] **Step 5: AppModule에 등록**

`src/app.module.ts` 수정:
```typescript
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
    ScheduleModule.forRoot(),
    HealthModule,   // 추가
    StorageModule,
    ImageModule,
    MediaModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm test
```
Expected: PASS (전체 테스트 suite 통과)

- [ ] **Step 7: 로컬에서 엔드포인트 수동 확인**

```bash
pnpm start:dev &
sleep 5
curl http://localhost:3000/health
# 예상 응답: {"status":"ok"}
kill %1
```

- [ ] **Step 8: 커밋**

```bash
git add src/health/ src/app.module.ts
git commit -m "feat: /health 엔드포인트 추가"
```

---

## Task 2: Dockerfile + .dockerignore 작성

멀티스테이지 빌드. `sharp`는 네이티브 바이너리를 포함하므로 **production 스테이지는 builder의 `node_modules`를 그대로 복사**한다. pnpm `--prod` 재설치 시 postinstall 스크립트가 실행되지 않아 sharp 바이너리가 누락될 수 있기 때문이다.

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: .dockerignore 작성**

```
# .dockerignore
node_modules
dist
.git
.github
*.md
docs
test
coverage
.env*
deploy
```

- [ ] **Step 2: Dockerfile 작성**

```dockerfile
# Dockerfile

# ---- Build stage ----
FROM node:22-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# sharp postinstall 스크립트가 반드시 실행되어야 하므로 --ignore-scripts 사용 금지
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Production stage ----
FROM node:22-alpine AS production

WORKDIR /app

# sharp 네이티브 바이너리 호환을 위해 builder의 node_modules 전체 복사
# (같은 베이스 이미지를 사용하므로 바이너리 ABI 일치 보장)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/main"]
```

- [ ] **Step 3: 로컬 빌드 테스트**

```bash
docker build -t media-server:test .
```
Expected: `Successfully built` (경고 없이)

- [ ] **Step 4: 컨테이너 실행 테스트**

```bash
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e API_KEY=test \
  -e SWAGGER_USER=admin \
  -e SWAGGER_PASSWORD=admin \
  media-server:test &

sleep 10
curl http://localhost:3000/health
# 예상: {"status":"ok"}

docker stop $(docker ps -q --filter ancestor=media-server:test)
```

- [ ] **Step 5: 커밋**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: 멀티스테이지 Dockerfile 추가"
```

---

## Task 3: deploy/docker-compose.yml 작성

registry, media-server-blue, media-server-green 세 서비스 정의. 포트는 `127.0.0.1`에만 바인딩하여 nginx를 통해서만 외부 접근 가능.

**Files:**
- Create: `deploy/docker-compose.yml`

- [ ] **Step 1: docker-compose.yml 작성**

```yaml
# deploy/docker-compose.yml
# 서버 경로: /opt/media-server/docker-compose.yml
# 이미지 태그는 배포 시 IMAGE_TAG 환경변수로 주입됨

services:

  registry:
    image: registry:2
    container_name: media-registry
    restart: unless-stopped
    ports:
      - "127.0.0.1:5000:5000"   # localhost에만 바인딩, nginx가 앞단 처리
    volumes:
      - ./registry/data:/var/lib/registry
      - ./registry/auth:/auth
    environment:
      REGISTRY_AUTH: htpasswd
      REGISTRY_AUTH_HTPASSWD_REALM: Registry Realm
      REGISTRY_AUTH_HTPASSWD_PATH: /auth/htpasswd

  media-server-blue:
    image: registry.yourdomain.com/media-server:${IMAGE_TAG:-latest}
    container_name: media-server-blue
    restart: unless-stopped
    env_file:
      - .env
    environment:
      PORT: "3001"
      NODE_ENV: production
    ports:
      - "127.0.0.1:3001:3001"

  media-server-green:
    image: registry.yourdomain.com/media-server:${IMAGE_TAG:-latest}
    container_name: media-server-green
    restart: unless-stopped
    env_file:
      - .env
    environment:
      PORT: "3002"
      NODE_ENV: production
    ports:
      - "127.0.0.1:3002:3002"
```

> `environment:` 블록의 `PORT`와 `NODE_ENV`는 `env_file:.env`보다 우선 적용되어 컨테이너별로 정확한 포트를 사용한다.

- [ ] **Step 2: 커밋**

```bash
git add deploy/docker-compose.yml
git commit -m "feat: deploy/docker-compose.yml 추가 (registry + blue/green)"
```

---

## Task 4: nginx 설정 파일 작성

**Files:**
- Create: `deploy/nginx/upstream/blue.conf`
- Create: `deploy/nginx/upstream/green.conf`
- Create: `deploy/nginx/conf.d/registry.conf`
- Create: `deploy/nginx/conf.d/media.conf`

- [ ] **Step 1: upstream 파일 작성**

```nginx
# deploy/nginx/upstream/blue.conf
upstream app {
    server 127.0.0.1:3001;
}
```

```nginx
# deploy/nginx/upstream/green.conf
upstream app {
    server 127.0.0.1:3002;
}
```

- [ ] **Step 2: registry.conf 작성**

```nginx
# deploy/nginx/conf.d/registry.conf
# TLS 블록은 Certbot이 서버에서 자동 추가함

server {
    listen 80;
    server_name registry.yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name registry.yourdomain.com;

    # Certbot이 자동으로 채워줌:
    # ssl_certificate /etc/letsencrypt/live/registry.yourdomain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/registry.yourdomain.com/privkey.pem;

    client_max_body_size 2g;

    auth_basic "Registry";
    auth_basic_user_file /opt/media-server/registry/auth/htpasswd;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 900;
    }
}
```

- [ ] **Step 3: media.conf 작성**

```nginx
# deploy/nginx/conf.d/media.conf
# active.conf symlink를 include — deploy.sh가 blue/green으로 교체
include /opt/media-server/nginx/upstream/active.conf;

server {
    listen 80;
    server_name media.yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name media.yourdomain.com;

    # ssl_certificate /etc/letsencrypt/live/media.yourdomain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/media.yourdomain.com/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
    }
}
```

- [ ] **Step 4: 커밋**

```bash
git add deploy/nginx/
git commit -m "feat: nginx 설정 파일 추가 (registry, media, upstream)"
```

---

## Task 5: deploy.sh 작성

Blue-Green 전환 핵심 스크립트.

**주의사항 (서버 셋업 시 필요):** `deploy.sh`는 `sudo nginx`를 비밀번호 없이 실행해야 한다. Task 7 Step 3에서 sudoers 규칙을 추가한다.

**Files:**
- Create: `deploy/deploy.sh`

- [ ] **Step 1: deploy.sh 작성**

```bash
#!/usr/bin/env bash
# deploy/deploy.sh
# 사용법: ./deploy.sh <image-tag>
# 예시:   ./deploy.sh abc1234

set -euo pipefail

export IMAGE_TAG="${1:?이미지 태그를 인자로 전달하세요. 예: ./deploy.sh abc1234}"
APP_DIR="/opt/media-server"
REGISTRY="registry.yourdomain.com"
IMAGE="${REGISTRY}/media-server:${IMAGE_TAG}"
ACTIVE_COLOR_FILE="${APP_DIR}/active_color"
HEALTH_CHECK_RETRIES=30   # 30회 × 2초 = 최대 60초
HEALTH_CHECK_INTERVAL=2

# 현재 활성 색상 읽기
ACTIVE_COLOR=$(cat "${ACTIVE_COLOR_FILE}")
if [[ "${ACTIVE_COLOR}" == "blue" ]]; then
  NEW_COLOR="green"
  NEW_PORT=3002
else
  NEW_COLOR="blue"
  NEW_PORT=3001
fi

HEALTH_URL="http://127.0.0.1:${NEW_PORT}/health"

echo "▶ 배포 시작: ${IMAGE}"
echo "  현재 활성: ${ACTIVE_COLOR} → 새로운: ${NEW_COLOR} (포트 ${NEW_PORT})"

# 새 이미지 pull
echo "▶ 이미지 pull..."
docker pull "${IMAGE}"

# 새 컨테이너 시작
cd "${APP_DIR}"
echo "▶ media-server-${NEW_COLOR} 시작..."
docker compose up -d "media-server-${NEW_COLOR}"

# 헬스체크 대기 (최대 60초)
echo "▶ 헬스체크 대기 중 (최대 $((HEALTH_CHECK_RETRIES * HEALTH_CHECK_INTERVAL))초)..."
for i in $(seq 1 ${HEALTH_CHECK_RETRIES}); do
  if curl -sf "${HEALTH_URL}" > /dev/null 2>&1; then
    echo "  ✓ 헬스체크 통과 (${i}회차)"
    break
  fi
  if [[ ${i} -eq ${HEALTH_CHECK_RETRIES} ]]; then
    echo "  ✗ 헬스체크 실패 — 롤백: media-server-${NEW_COLOR} 중지"
    docker compose stop "media-server-${NEW_COLOR}"
    exit 1
  fi
  echo "  … 대기 중 (${i}/${HEALTH_CHECK_RETRIES})"
  sleep ${HEALTH_CHECK_INTERVAL}
done

# nginx upstream symlink 교체 후 검증
echo "▶ nginx upstream 전환: ${NEW_COLOR}"
ln -sfn "${APP_DIR}/nginx/upstream/${NEW_COLOR}.conf" \
        "${APP_DIR}/nginx/upstream/active.conf"

# 문법 검사 통과 후 reload (실패 시 symlink 롤백)
if ! sudo nginx -t 2>/dev/null; then
  echo "  ✗ nginx 설정 오류 — symlink 롤백"
  ln -sfn "${APP_DIR}/nginx/upstream/${ACTIVE_COLOR}.conf" \
          "${APP_DIR}/nginx/upstream/active.conf"
  docker compose stop "media-server-${NEW_COLOR}"
  exit 1
fi
sudo nginx -s reload

# active_color 파일 업데이트
echo "${NEW_COLOR}" > "${ACTIVE_COLOR_FILE}"

# 구버전 컨테이너 중지
echo "▶ 구버전 media-server-${ACTIVE_COLOR} 중지..."
docker compose stop "media-server-${ACTIVE_COLOR}"

echo "✅ 배포 완료: ${NEW_COLOR} (태그: ${IMAGE_TAG})"
```

- [ ] **Step 2: 실행 권한 부여**

```bash
chmod +x deploy/deploy.sh
```

- [ ] **Step 3: 문법 검사**

```bash
bash -n deploy/deploy.sh
```
Expected: 출력 없음 (오류 없음)

- [ ] **Step 4: 커밋**

```bash
git add deploy/deploy.sh
git commit -m "feat: Blue-Green deploy.sh 스크립트 추가"
```

---

## Task 6: GitHub Actions 워크플로우 작성

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: deploy.yml 작성**

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set image tag
        id: tag
        run: echo "tag=${GITHUB_SHA::7}" >> $GITHUB_OUTPUT

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to self-hosted registry
        uses: docker/login-action@v3
        with:
          registry: registry.yourdomain.com
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            registry.yourdomain.com/media-server:${{ steps.tag.outputs.tag }}
            registry.yourdomain.com/media-server:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          echo "${{ secrets.SSH_KNOWN_HOSTS }}" >> ~/.ssh/known_hosts

      - name: Deploy to server
        run: |
          ssh ${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }} \
            "/opt/media-server/deploy.sh ${{ steps.tag.outputs.tag }}"
```

- [ ] **Step 2: 커밋**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: GitHub Actions 배포 워크플로우 추가"
```

---

## Task 7: 홈서버 초기 셋업 (수동 작업)

SSH로 홈서버에 접속해서 수행한다.

**사전 준비물:**
- 홈서버 SSH 접속 정보
- 도메인 2개 (`registry.yourdomain.com`, `media.yourdomain.com`)
- 라우터 포트포워딩 접근 권한

- [ ] **Step 1: 패키지 설치**

```bash
# 홈서버에서 실행
sudo apt update
sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx apache2-utils
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# 이후 재로그인 필요 (docker 그룹 적용)
```

> `docker-compose-plugin`을 설치해야 `docker compose`(V2) 명령을 사용할 수 있다. `docker-compose`(V1, EOL)와 혼동 주의.

- [ ] **Step 2: 라우터 포트포워딩 설정**

라우터 관리 콘솔에서:
- 80 (TCP) → 홈서버 내부 IP:80
- 443 (TCP) → 홈서버 내부 IP:443

- [ ] **Step 3: deploy.sh를 위한 sudoers 규칙 추가**

`deploy.sh`는 자동화된 SSH 세션에서 `sudo nginx`를 실행한다. 패스워드 없이 실행되도록 설정이 필요하다.

```bash
# SSH 유저명이 'deploy'인 경우 예시 (실제 유저명으로 교체)
echo "$USER ALL=(ALL) NOPASSWD: /usr/sbin/nginx -s reload, /usr/sbin/nginx -t" | \
  sudo tee /etc/sudoers.d/nginx-reload
sudo chmod 440 /etc/sudoers.d/nginx-reload

# 검증
sudo nginx -t
```
Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful`

- [ ] **Step 4: DNS A레코드 설정**

도메인 관리 콘솔에서:
- `registry.yourdomain.com` → 홈서버 공인 IP
- `media.yourdomain.com` → 홈서버 공인 IP

DNS 전파 확인:
```bash
dig +short registry.yourdomain.com
# 공인 IP가 출력되어야 함
```

- [ ] **Step 5: 디렉토리 구조 생성**

```bash
sudo mkdir -p /opt/media-server/nginx/{conf.d,upstream}
sudo mkdir -p /opt/media-server/registry/{auth,data}
sudo chown -R $USER:$USER /opt/media-server

# nginx(www-data)가 upstream 디렉토리를 읽을 수 있도록 권한 부여
chmod o+rx /opt/media-server/nginx/upstream
```

- [ ] **Step 6: Registry htpasswd 생성**

```bash
htpasswd -Bc /opt/media-server/registry/auth/htpasswd <registry-username>
# 패스워드 입력 프롬프트
```

- [ ] **Step 7: 배포 파일 서버로 복사**

개발 머신에서:
```bash
scp deploy/docker-compose.yml <user>@<server-ip>:/opt/media-server/
scp deploy/deploy.sh <user>@<server-ip>:/opt/media-server/
scp deploy/nginx/conf.d/registry.conf deploy/nginx/conf.d/media.conf \
    <user>@<server-ip>:/opt/media-server/nginx/conf.d/
scp deploy/nginx/upstream/blue.conf deploy/nginx/upstream/green.conf \
    <user>@<server-ip>:/opt/media-server/nginx/upstream/
ssh <user>@<server-ip> "chmod +x /opt/media-server/deploy.sh"
```

- [ ] **Step 8: upstream symlink 초기화**

> **순서 중요:** nginx 활성화 전에 symlink를 먼저 생성해야 한다. `media.conf`가 `active.conf`를 include하므로 symlink 없이 nginx -t를 실행하면 오류가 발생한다.

```bash
# 홈서버에서
echo "blue" > /opt/media-server/active_color
ln -sfn /opt/media-server/nginx/upstream/blue.conf \
        /opt/media-server/nginx/upstream/active.conf

# 확인
ls -la /opt/media-server/nginx/upstream/active.conf
# → active.conf -> /opt/media-server/nginx/upstream/blue.conf
```

- [ ] **Step 9: nginx 설정 활성화 및 SSL 인증서 발급**

```bash
# nginx conf.d에 심볼릭 링크
sudo ln -sf /opt/media-server/nginx/conf.d/registry.conf /etc/nginx/conf.d/registry.conf
sudo ln -sf /opt/media-server/nginx/conf.d/media.conf /etc/nginx/conf.d/media.conf

# 문법 검사 (symlink가 이미 존재하므로 통과해야 함)
sudo nginx -t
# Expected: nginx: configuration file test is successful

sudo systemctl start nginx

# SSL 인증서 발급 (포트 80이 열려있어야 함)
sudo certbot --nginx -d registry.yourdomain.com -d media.yourdomain.com
```

- [ ] **Step 10: .env 파일 작성**

```bash
cat > /opt/media-server/.env << 'EOF'
NODE_ENV=production
PORT=3001
R2_ACCOUNT_ID=실제값
R2_ACCESS_KEY_ID=실제값
R2_SECRET_ACCESS_KEY=실제값
R2_BUCKET_NAME=실제값
CDN_DOMAIN=실제값
API_KEY=실제값
SWAGGER_USER=실제값
SWAGGER_PASSWORD=실제값
CRON_CONCURRENCY=3
EOF
chmod 600 /opt/media-server/.env
```

- [ ] **Step 11: 서버에서 Registry docker login (1회)**

```bash
docker login registry.yourdomain.com
# htpasswd에 등록한 username/password 입력
```

- [ ] **Step 12: Registry 컨테이너 기동 및 초기 앱 이미지 준비**

```bash
cd /opt/media-server
docker compose up -d registry
docker compose ps
# registry 컨테이너가 Up 상태여야 함
```

개발 머신에서 초기 이미지를 수동으로 push:
```bash
docker build -t registry.yourdomain.com/media-server:init .
docker push registry.yourdomain.com/media-server:init
```

서버에서 초기 앱 컨테이너 기동 확인:
```bash
cd /opt/media-server
IMAGE_TAG=init docker compose up -d media-server-blue
sleep 15
curl http://127.0.0.1:3001/health
# 예상: {"status":"ok"}
docker compose stop media-server-blue
```

---

## Task 8: GitHub Secrets 등록 (수동 작업)

GitHub 레포지토리 → Settings → Secrets and variables → Actions → New repository secret

- [ ] **Step 1: SSH 키 생성 (개발 머신)**

```bash
ssh-keygen -t ed25519 -C "github-actions-media-server" -f ~/.ssh/github_actions_media -N ""
# 서버에 공개키 등록
ssh-copy-id -i ~/.ssh/github_actions_media.pub <user>@<server-ip>
```

- [ ] **Step 2: Secrets 등록**

| Secret 이름 | 값 확인 명령 |
|-------------|-------------|
| `SSH_PRIVATE_KEY` | `cat ~/.ssh/github_actions_media` |
| `SSH_KNOWN_HOSTS` | `ssh-keyscan -H <server-ip>` |
| `SSH_HOST` | 서버 공인 IP 또는 도메인 |
| `SSH_USER` | 서버 SSH 유저명 |
| `REGISTRY_USER` | htpasswd에 등록한 유저명 |
| `REGISTRY_PASSWORD` | htpasswd에 등록한 패스워드 |

---

## Task 9: 엔드-투-엔드 검증

- [ ] **Step 1: main 브랜치에 push**

```bash
git push origin main
```

- [ ] **Step 2: GitHub Actions 로그 확인**

GitHub 레포지토리 → Actions 탭에서 워크플로우 실행 상태 확인. 모든 스텝이 초록색이어야 한다.

- [ ] **Step 3: 서버에서 컨테이너 상태 확인**

```bash
docker compose -f /opt/media-server/docker-compose.yml ps
# 하나의 media-server 컨테이너가 running, 하나가 stopped 상태여야 함

cat /opt/media-server/active_color
# "blue" 또는 "green"
```

- [ ] **Step 4: 헬스체크 확인**

```bash
curl https://media.yourdomain.com/health
# 예상: {"status":"ok"}
```

- [ ] **Step 5: Blue-Green 전환 확인**

```bash
# 빈 커밋으로 두 번째 배포 트리거
git commit --allow-empty -m "chore: Blue-Green 전환 테스트"
git push origin main
```

두 번째 배포 후:
```bash
cat /opt/media-server/active_color
# 첫 번째와 다른 색상 (blue ↔ green 전환 확인)
curl https://media.yourdomain.com/health
# 예상: {"status":"ok"}
```

- [ ] **Step 6: Registry 보안 확인**

```bash
# 인증 없이 pull 시도 → 401이어야 함
docker logout registry.yourdomain.com
docker pull registry.yourdomain.com/media-server:latest
# 예상: unauthorized: authentication required
```

---

## 완료 기준 체크리스트

- [ ] `GET /health` → `{"status":"ok"}` + HTTP 200
- [ ] `main` push → GitHub Actions 자동 빌드/배포
- [ ] 배포 중 `/health` 응답 유지 (무중단)
- [ ] 두 번 배포 후 `active_color`가 교대로 변경됨
- [ ] 인증 없이 registry push/pull 불가 (401)
- [ ] `https://media.yourdomain.com` HTTPS 접속 가능
- [ ] Swagger UI (`/api-docs`) Basic Auth 보호 확인
