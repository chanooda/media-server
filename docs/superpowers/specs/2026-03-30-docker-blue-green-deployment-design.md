# Docker Blue-Green 배포 설계

**날짜:** 2026-03-30
**프로젝트:** media-server (NestJS)
**목표:** 홈서버(Ubuntu)에 Docker + Self-hosted Registry를 이용한 무중단 Blue-Green 배포 파이프라인 구축

---

## 1. 전체 아키텍처

```
개발 머신 (Mac)
  └── git push → GitHub

GitHub
  └── GitHub Actions
        1. docker build (이미지 태그: registry.yourdomain.com/media-server:<sha>)
        2. docker push → Self-hosted Registry
        3. SSH → 홈서버 deploy.sh 실행

홈서버 (Ubuntu)
  ├── nginx                  ← SSL 종료 + 트래픽 라우팅
  ├── registry:2             ← Self-hosted Docker Registry
  ├── media-server-blue      ← 앱 컨테이너 (PORT=3001)
  └── media-server-green     ← 앱 컨테이너 (PORT=3002)
```

### 도메인 구성

| 도메인 | 대상 | 비고 |
|--------|------|------|
| `registry.yourdomain.com` | registry 컨테이너 | nginx Basic Auth + TLS |
| `media.yourdomain.com` | blue 또는 green | nginx upstream 동적 전환 |

---

## 2. Blue-Green 배포 흐름

```
GitHub push (main 브랜치)
  → GitHub Actions 트리거
      ├── docker build -t registry.yourdomain.com/media-server:<git-sha> .
      ├── docker push registry.yourdomain.com/media-server:<git-sha>
      └── SSH → 서버에서 /opt/media-server/deploy.sh <image-tag> 실행
              ├── active_color 파일에서 현재 색상 확인 (blue or green)
              ├── 비활성 색상의 컨테이너에 새 이미지 pull
              ├── 비활성 컨테이너 시작 (docker compose up -d)
              ├── /health 엔드포인트 폴링 (최대 60초, 2초 간격 — sharp 포함 NestJS 콜드 스타트 고려)
              ├── 헬스체크 통과 → nginx upstream symlink 교체 + nginx reload
              ├── active_color 파일 업데이트
              └── 기존(구버전) 컨테이너 중지
```

### 롤백
- 배포 실패(헬스체크 미통과) 시 새 컨테이너 중지, nginx 전환 없이 종료
- 수동 롤백: `deploy.sh`에 이전 이미지 태그를 직접 지정하여 재실행

---

## 3. nginx Upstream 전환 메커니즘

`media.yourdomain.com` nginx 설정은 `active.conf` 심볼릭 링크를 `include`합니다.

```
/opt/media-server/nginx/upstream/
├── blue.conf         ← "upstream app { server 127.0.0.1:3001; }"
├── green.conf        ← "upstream app { server 127.0.0.1:3002; }"
└── active.conf       ← 심볼릭 링크 (blue.conf 또는 green.conf 를 가리킴)
```

`media.conf`는 다음과 같이 include합니다:
```nginx
include /opt/media-server/nginx/upstream/active.conf;

server {
    ...
    location / {
        proxy_pass http://app;
    }
}
```

`deploy.sh`에서 전환 시:
```bash
ln -sfn /opt/media-server/nginx/upstream/${NEW_COLOR}.conf \
        /opt/media-server/nginx/upstream/active.conf
nginx -s reload
```

---

## 4. 서버 디렉토리 구조

```
/opt/media-server/
├── docker-compose.yml       ← 전체 서비스 정의
├── deploy.sh                ← Blue-Green 배포 스크립트
├── .env                     ← 앱 환경변수
├── active_color             ← 현재 활성 색상 ("blue" or "green")
├── nginx/
│   ├── conf.d/
│   │   ├── registry.conf    ← registry 가상호스트
│   │   └── media.conf       ← media-server 가상호스트 (upstream include)
│   └── upstream/
│       ├── blue.conf        ← upstream app { server 127.0.0.1:3001; }
│       ├── green.conf       ← upstream app { server 127.0.0.1:3002; }
│       └── active.conf      ← symlink → blue.conf 또는 green.conf
└── registry/
    ├── auth/
    │   └── htpasswd         ← Registry Basic Auth 자격증명
    └── data/                ← Registry 이미지 저장소
```

---

## 5. docker-compose.yml 컨테이너 포트 설정

앱은 `PORT` 환경변수로 리슨 포트를 결정합니다 (`process.env.PORT ?? 3000`).
Blue-Green 컨테이너는 각각 다른 포트를 사용하도록 명시적으로 설정해야 합니다:

```yaml
services:
  media-server-blue:
    image: registry.yourdomain.com/media-server:latest
    environment:
      - PORT=3001
      - NODE_ENV=production
      # 나머지 env는 env_file 또는 직접 주입
    ports:
      - "3001:3001"

  media-server-green:
    image: registry.yourdomain.com/media-server:latest
    environment:
      - PORT=3002
      - NODE_ENV=production
    ports:
      - "3002:3002"
```

**`NODE_ENV=production` 필수:** `main.ts`가 이 값으로 Swagger Basic Auth 적용 여부를 결정합니다. 누락 시 Swagger UI가 인증 없이 노출됩니다.

---

## 6. Registry 보안

- nginx가 `registry.yourdomain.com` 앞에 위치하여 TLS 종료
- Let's Encrypt (Certbot) 으로 SSL 인증서 발급 및 자동 갱신
- `htpasswd` 기반 Basic Auth로 인증 없는 push/pull 차단
- Registry 컨테이너는 localhost에만 바인딩, 외부에는 nginx를 통해서만 접근

---

## 7. GitHub Actions Secrets

| Secret 이름 | 용도 |
|-------------|------|
| `REGISTRY_USER` | Registry docker login 유저명 |
| `REGISTRY_PASSWORD` | Registry docker login 패스워드 |
| `SSH_PRIVATE_KEY` | 서버 SSH 접속용 ED25519 개인키 |
| `SSH_HOST` | 서버 공인 IP 또는 도메인 |
| `SSH_USER` | SSH 접속 유저명 |
| `SSH_KNOWN_HOSTS` | 서버 호스트 키 (ssh-keyscan으로 생성) |

### SSH known_hosts 처리
GitHub Actions에서 호스트 키 검증을 위해 `SSH_KNOWN_HOSTS` secret을 사전 등록합니다:
```bash
# 개발 머신에서 실행하여 출력값을 GitHub Secret에 등록
ssh-keyscan -H <server-ip-or-domain>
```

Actions workflow에서:
```yaml
- name: Setup SSH
  run: |
    mkdir -p ~/.ssh
    echo "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
    chmod 600 ~/.ssh/id_ed25519
    echo "${{ secrets.SSH_KNOWN_HOSTS }}" >> ~/.ssh/known_hosts
```

---

## 8. 홈서버 초기 셋업 (1회성 작업)

### 8-1. 필수 패키지 설치 (Docker Compose V2 기준)
```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx apache2-utils
sudo systemctl enable --now docker
```

> **주의:** `docker-compose` (V1, EOL)가 아닌 `docker-compose-plugin` (V2)을 설치합니다.
> 이후 모든 명령은 `docker compose` (띄어쓰기) 형식을 사용합니다.

### 8-2. DNS 레코드 설정
DNS 공급자(도메인 관리 콘솔)에서:
- `registry.yourdomain.com` A레코드 → 홈서버 공인 IP
- `media.yourdomain.com` A레코드 → 홈서버 공인 IP

라우터/공유기 포트포워딩:
- 80 → 홈서버:80 (Certbot HTTP 인증용)
- 443 → 홈서버:443

### 8-3. Registry htpasswd 생성
```bash
sudo mkdir -p /opt/media-server/registry/auth
sudo htpasswd -Bc /opt/media-server/registry/auth/htpasswd <registry-username>
```

### 8-4. SSL 인증서 발급
```bash
sudo certbot --nginx -d registry.yourdomain.com -d media.yourdomain.com
```

### 8-5. 배포 파일을 서버로 복사
프로젝트 `deploy/` 디렉토리의 파일들을 서버에 복사합니다:
```bash
# 개발 머신에서 실행
scp -r deploy/* <user>@<server-ip>:/opt/media-server/
ssh <user>@<server-ip> "chmod +x /opt/media-server/deploy.sh"
```

### 8-6. 디렉토리 및 symlink 초기화
```bash
sudo mkdir -p /opt/media-server/nginx/upstream
# 초기 active 색상을 blue로 설정
echo "blue" | sudo tee /opt/media-server/active_color
ln -sfn /opt/media-server/nginx/upstream/blue.conf \
        /opt/media-server/nginx/upstream/active.conf
```

### 8-7. GitHub Actions용 SSH 키 설정
```bash
# 개발 머신에서 실행
ssh-keygen -t ed25519 -C "github-actions-media-server" -f ~/.ssh/github_actions_media

# 공개키를 서버에 등록
ssh-copy-id -i ~/.ssh/github_actions_media.pub <user>@<server-ip>

# 개인키 내용 → GitHub Secret SSH_PRIVATE_KEY
cat ~/.ssh/github_actions_media

# 호스트 키 내용 → GitHub Secret SSH_KNOWN_HOSTS
ssh-keyscan -H <server-ip>
```

### 8-8. 서버에서 Registry docker login (1회)
배포 시 서버의 Docker가 registry에서 pull할 수 있도록 서버에서도 로그인합니다:
```bash
docker login registry.yourdomain.com
# username/password 입력 (htpasswd에 등록한 자격증명)
```

### 8-9. 환경변수 파일 준비
서버의 `/opt/media-server/.env`에 작성:
```
NODE_ENV=production
PORT=3001  # blue 기준 (green은 docker-compose에서 오버라이드)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
CDN_DOMAIN=...
API_KEY=...
SWAGGER_USER=...
SWAGGER_PASSWORD=...
CRON_CONCURRENCY=3  # 홈서버 사양에 따라 조정
```

### 8-10. 초기 기동 확인
```bash
cd /opt/media-server
docker compose up -d
docker compose ps
```

---

## 9. 생성할 파일 목록

| 파일 | 위치 (repo) | 서버 복사 위치 |
|------|-------------|----------------|
| `Dockerfile` | 프로젝트 루트 | — (빌드만 사용) |
| `.dockerignore` | 프로젝트 루트 | — |
| `.github/workflows/deploy.yml` | GitHub Actions 워크플로우 | — |
| `deploy/docker-compose.yml` | repo | `/opt/media-server/docker-compose.yml` |
| `deploy/deploy.sh` | repo | `/opt/media-server/deploy.sh` |
| `deploy/nginx/registry.conf` | repo | `/opt/media-server/nginx/conf.d/registry.conf` |
| `deploy/nginx/media.conf` | repo | `/opt/media-server/nginx/conf.d/media.conf` |
| `deploy/nginx/upstream/blue.conf` | repo | `/opt/media-server/nginx/upstream/blue.conf` |
| `deploy/nginx/upstream/green.conf` | repo | `/opt/media-server/nginx/upstream/green.conf` |

---

## 10. 성공 기준

- `main` 브랜치 push 시 GitHub Actions가 자동으로 이미지 빌드 및 배포
- 배포 중 `/health` 응답이 유지됨 (무중단)
- Registry에 인증 없이 push/pull 불가
- Swagger UI는 production 환경에서 Basic Auth 보호
- 배포 실패 시 기존 컨테이너가 계속 서비스
