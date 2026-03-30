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
  ├── media-server-blue      ← 앱 컨테이너 (포트 3001)
  └── media-server-green     ← 앱 컨테이너 (포트 3002)
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
              ├── 비활성 컨테이너 시작 (docker-compose up -d)
              ├── /health 엔드포인트 폴링 (최대 30초, 1초 간격)
              ├── 헬스체크 통과 → nginx upstream 심볼릭 링크 교체 + nginx reload
              ├── active_color 파일 업데이트
              └── 기존(구버전) 컨테이너 중지
```

### 롤백
- 배포 실패(헬스체크 미통과) 시 새 컨테이너 중지, nginx 전환 없이 종료
- 수동 롤백: `deploy.sh`에 이전 이미지 태그를 직접 지정하여 재실행

---

## 3. 서버 디렉토리 구조

```
/opt/media-server/
├── docker-compose.yml       ← 전체 서비스 정의
├── deploy.sh                ← Blue-Green 배포 스크립트
├── active_color             ← 현재 활성 색상 ("blue" or "green")
├── nginx/
│   ├── conf.d/
│   │   ├── registry.conf    ← registry 가상호스트
│   │   └── media.conf       ← media-server 가상호스트 (upstream 포함)
│   └── upstream/
│       ├── blue.conf        ← upstream blue { server 127.0.0.1:3001; }
│       └── green.conf       ← upstream green { server 127.0.0.1:3002; }
└── registry/
    ├── auth/
    │   └── htpasswd         ← Registry Basic Auth 자격증명
    └── data/                ← Registry 이미지 저장소
```

---

## 4. Registry 보안

- nginx가 `registry.yourdomain.com` 앞에 위치하여 TLS 종료
- Let's Encrypt (Certbot) 으로 SSL 인증서 발급 및 자동 갱신
- `htpasswd` 기반 Basic Auth로 인증 없는 push/pull 차단
- Registry 컨테이너는 localhost에만 바인딩, 외부에는 nginx를 통해서만 접근

---

## 5. GitHub Actions Secrets

| Secret 이름 | 용도 |
|-------------|------|
| `REGISTRY_USER` | Registry docker login 유저명 |
| `REGISTRY_PASSWORD` | Registry docker login 패스워드 |
| `SSH_PRIVATE_KEY` | 서버 SSH 접속용 ED25519 개인키 |
| `SSH_HOST` | 서버 공인 IP 또는 도메인 |
| `SSH_USER` | SSH 접속 유저명 |

---

## 6. 홈서버 초기 셋업 (1회성 작업)

### 6-1. 필수 패키지 설치
```bash
sudo apt update
sudo apt install -y docker.io docker-compose nginx certbot python3-certbot-nginx apache2-utils
sudo systemctl enable --now docker
```

### 6-2. DNS 레코드 설정
DNS 공급자(도메인 관리 콘솔)에서:
- `registry.yourdomain.com` A레코드 → 홈서버 공인 IP
- `media.yourdomain.com` A레코드 → 홈서버 공인 IP

라우터/공유기 포트포워딩:
- 80 → 홈서버:80 (Certbot HTTP 인증용)
- 443 → 홈서버:443

### 6-3. Registry htpasswd 생성
```bash
sudo mkdir -p /opt/media-server/registry/auth
sudo htpasswd -Bc /opt/media-server/registry/auth/htpasswd <registry-username>
```

### 6-4. SSL 인증서 발급
```bash
sudo certbot --nginx -d registry.yourdomain.com -d media.yourdomain.com
```

### 6-5. 디렉토리 초기화
```bash
sudo mkdir -p /opt/media-server/{nginx/conf.d,nginx/upstream,registry/data}
echo "blue" | sudo tee /opt/media-server/active_color
```

### 6-6. GitHub Actions용 SSH 키 설정
```bash
# 개발 머신에서 실행
ssh-keygen -t ed25519 -C "github-actions-media-server" -f ~/.ssh/github_actions_media

# 공개키를 서버에 등록
ssh-copy-id -i ~/.ssh/github_actions_media.pub <user>@<server-ip>

# 개인키 내용을 GitHub Repository Secrets에 SSH_PRIVATE_KEY로 등록
cat ~/.ssh/github_actions_media
```

### 6-7. 환경변수 파일 준비
서버의 `/opt/media-server/.env` 에 앱 환경변수 작성:
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
CDN_DOMAIN=...
API_KEY=...
SWAGGER_USER=...
SWAGGER_PASSWORD=...
```

### 6-8. 초기 기동 확인
```bash
cd /opt/media-server
docker-compose up -d
docker-compose ps
```

---

## 7. 생성할 파일 목록

| 파일 | 위치 |
|------|------|
| `Dockerfile` | 프로젝트 루트 |
| `.dockerignore` | 프로젝트 루트 |
| `.github/workflows/deploy.yml` | GitHub Actions 워크플로우 |
| `deploy/docker-compose.yml` | 서버 배포용 compose 파일 |
| `deploy/deploy.sh` | Blue-Green 전환 스크립트 |
| `deploy/nginx/registry.conf` | Registry nginx 설정 |
| `deploy/nginx/media.conf` | Media-server nginx 설정 |

---

## 8. 성공 기준

- `main` 브랜치 push 시 GitHub Actions가 자동으로 이미지 빌드 및 배포
- 배포 중 `/health` 응답이 유지됨 (무중단)
- Registry에 인증 없이 push/pull 불가
- 배포 실패 시 기존 컨테이너가 계속 서비스
