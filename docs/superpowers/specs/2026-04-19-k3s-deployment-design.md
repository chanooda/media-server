# k3s 배포 전환 설계

**날짜:** 2026-04-19
**상태:** 승인됨

## 개요

현재 Docker Compose + nginx + bash 기반의 blue/green 배포를 k3s(경량 Kubernetes)로 전환한다.
단일 서버에 k3s를 설치하고, Traefik(기본 내장 Ingress) + cert-manager(Let's Encrypt SSL)를 사용한다.
자체 Docker 레지스트리(`registry.yourdomain.com`)는 그대로 유지한다.

## 아키텍처

```
GitHub Actions (CI/CD)
       │
       ▼
registry.yourdomain.com  ← 자체 Docker 레지스트리 (유지)
       │
       ▼
  k3s (단일 서버)
  ├── Traefik (기본 내장 Ingress, 80/443)
  │     └── cert-manager (Let's Encrypt SSL 자동 발급/갱신)
  ├── Deployment: media-server (Pod × 2, Rolling Update)
  └── Service (ClusterIP → Traefik)
```

## 파일 구조

```
deploy/
└── k8s/
    ├── namespace.yaml       # media-server 네임스페이스
    ├── deployment.yaml      # Deployment (Rolling Update 설정 포함)
    ├── service.yaml         # ClusterIP Service
    ├── ingress.yaml         # Traefik Ingress + cert-manager 어노테이션
    ├── cluster-issuer.yaml  # Let's Encrypt ClusterIssuer
    └── registry-secret.yaml # 자체 레지스트리 imagePullSecret
```

기존 `deploy/docker-compose.yml`, `deploy/deploy.sh`, `deploy/nginx/` 는 제거한다.

## 배포 흐름 (CI/CD)

1. `main` 브랜치 push
2. Docker 이미지 빌드 → `registry.yourdomain.com/media-server:<sha>` 푸시
3. GitHub Secrets → k8s Secret 변환 후 `kubectl apply`
4. `kubectl set image deployment/media-server app=registry.../media-server:<sha>`
5. `kubectl rollout status deployment/media-server` 로 완료 확인

**Rolling Update 설정:**
- `maxSurge: 1` — 새 Pod 1개 먼저 기동
- `maxUnavailable: 0` — 헬스체크 통과 전까지 구 Pod 유지
- 롤백: `kubectl rollout undo deployment/media-server`

## 환경변수 처리

- 현재: SCP로 서버에 `.env` 파일 업로드
- 변경: GitHub Actions에서 `kubectl create secret generic` 으로 k8s Secret 직접 생성
- 서버에 `.env` 파일 불필요

## SSL / Ingress

**설치 (서버 1회):**
```bash
# k3s 설치 (Traefik 자동 포함)
curl -sfL https://get.k3s.io | sh -

# cert-manager 설치
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
```

**Ingress 핵심 설정:**
```yaml
annotations:
  cert-manager.io/cluster-issuer: letsencrypt-prod
  traefik.ingress.kubernetes.io/router.entrypoints: websecure
spec:
  tls:
    - hosts: [media.yourdomain.com]
      secretName: media-tls
```

**현재 nginx에서 유지되는 설정:**
- `client_max_body_size 100m` → Traefik IngressRoute annotation
- 보안 헤더(`X-Content-Type-Options`, `X-Frame-Options`, `HSTS`) → Traefik Middleware

## 레지스트리 인증

- `/etc/rancher/k3s/registries.yaml` 로 자체 레지스트리 insecure 허용
- k8s `imagePullSecret` 으로 인증 정보 주입

## 도메인

- `media.yourdomain.com` — 미디어 서버 앱
- `registry.yourdomain.com` — 자체 Docker 레지스트리 (k3s 외부에서 직접 운영 유지)

## 범위 밖

- 멀티 노드 구성 (단일 서버만)
- blue/green 배포 (Rolling Update로 대체)
- 외부 레지스트리 전환
