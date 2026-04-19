# k3s 배포 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker Compose + nginx + bash 기반 배포를 k3s(Traefik + cert-manager)로 전환하고 GitHub Actions CI/CD를 업데이트한다.

**Architecture:** 단일 서버에 k3s를 설치하고 기본 내장 Traefik을 Ingress로 사용한다. cert-manager가 Let's Encrypt SSL을 자동 발급/갱신한다. GitHub Actions는 이미지 빌드 후 kubectl로 Rolling Update를 트리거한다.

**Tech Stack:** k3s, Traefik v2, cert-manager, kubectl, GitHub Actions

---

## 파일 구조

**새로 생성:**
- `deploy/k8s/namespace.yaml` — media-server 네임스페이스
- `deploy/k8s/registry-secret.yaml` — 레지스트리 imagePullSecret 템플릿 (값은 CI에서 주입)
- `deploy/k8s/cluster-issuer.yaml` — Let's Encrypt ClusterIssuer
- `deploy/k8s/deployment.yaml` — Deployment (Rolling Update, 환경변수 Secret 참조)
- `deploy/k8s/service.yaml` — ClusterIP Service
- `deploy/k8s/ingress.yaml` — Traefik Ingress (보안 헤더 Middleware 포함)
- `deploy/k8s/server-setup.sh` — 서버 1회 초기 설정 스크립트 (k3s + cert-manager 설치)

**수정:**
- `.github/workflows/deploy.yml` — kubectl 기반 배포로 교체

**삭제:**
- `deploy/docker-compose.yml`
- `deploy/deploy.sh`
- `deploy/nginx/` (전체)

---

## Task 1: k8s 매니페스트 — namespace + registry secret 템플릿

**Files:**
- Create: `deploy/k8s/namespace.yaml`
- Create: `deploy/k8s/registry-secret.yaml`

- [ ] **Step 1: namespace.yaml 작성**

```yaml
# deploy/k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: media-server
```

- [ ] **Step 2: registry-secret.yaml 작성**

이 파일은 템플릿이다. 실제 값은 CI/CD에서 `kubectl create secret` 으로 주입하므로
여기서는 Secret 이름과 타입만 문서화한다.

```yaml
# deploy/k8s/registry-secret.yaml
# 실제 생성은 GitHub Actions에서 수행:
# kubectl create secret docker-registry regcred \
#   --docker-server=registry.chanoo.dev \
#   --docker-username=$REGISTRY_USER \
#   --docker-password=$REGISTRY_PASSWORD \
#   -n media-server --dry-run=client -o yaml | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: regcred
  namespace: media-server
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <CI에서_주입>
```

- [ ] **Step 3: 커밋**

```bash
git add deploy/k8s/namespace.yaml deploy/k8s/registry-secret.yaml
git commit -m "feat: k8s namespace 및 레지스트리 secret 템플릿 추가"
```

---

## Task 2: k8s 매니페스트 — Deployment + Service

**Files:**
- Create: `deploy/k8s/deployment.yaml`
- Create: `deploy/k8s/service.yaml`

- [ ] **Step 1: deployment.yaml 작성**

```yaml
# deploy/k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: media-server
  namespace: media-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: media-server
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: media-server
    spec:
      imagePullSecrets:
        - name: regcred
      containers:
        - name: app
          image: registry.chanoo.dev/media-server:latest
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: media-server-env
          env:
            - name: NODE_ENV
              value: production
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 6
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

- [ ] **Step 2: service.yaml 작성**

```yaml
# deploy/k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: media-server
  namespace: media-server
spec:
  selector:
    app: media-server
  ports:
    - port: 3000
      targetPort: 3000
  type: ClusterIP
```

- [ ] **Step 3: 커밋**

```bash
git add deploy/k8s/deployment.yaml deploy/k8s/service.yaml
git commit -m "feat: k8s Deployment 및 Service 매니페스트 추가"
```

---

## Task 3: k8s 매니페스트 — ClusterIssuer + Ingress (Traefik + cert-manager)

**Files:**
- Create: `deploy/k8s/cluster-issuer.yaml`
- Create: `deploy/k8s/ingress.yaml`

- [ ] **Step 1: cluster-issuer.yaml 작성**

```yaml
# deploy/k8s/cluster-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: hanrhfqkq@gmail.com
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            class: traefik
```

- [ ] **Step 2: ingress.yaml 작성**

보안 헤더(X-Content-Type-Options, X-Frame-Options, HSTS)를 Traefik Middleware로 적용하고
업로드 크기 100m 제한도 함께 설정한다.

```yaml
# deploy/k8s/ingress.yaml
apiVersion: traefik.containo.us/v1alpha1
kind: Middleware
metadata:
  name: security-headers
  namespace: media-server
spec:
  headers:
    contentTypeNosniff: true
    frameDeny: true
    stsSeconds: 31536000
    stsIncludeSubdomains: true
    stsPreload: true
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: media-server
  namespace: media-server
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.middlewares: media-server-security-headers@kubernetescrd
    traefik.ingress.kubernetes.io/router.tls: "true"
    # 업로드 크기 100MB 제한
    traefik.ingress.kubernetes.io/buffering: |
      maxRequestBodyBytes: 104857600
      memRequestBodyBytes: 2097152
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - media.chanoo.dev
      secretName: media-tls
  rules:
    - host: media.chanoo.dev
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: media-server
                port:
                  number: 3000
```

- [ ] **Step 3: 커밋**

```bash
git add deploy/k8s/cluster-issuer.yaml deploy/k8s/ingress.yaml
git commit -m "feat: cert-manager ClusterIssuer 및 Traefik Ingress 매니페스트 추가"
```

---

## Task 4: 서버 초기 설정 스크립트 작성

**Files:**
- Create: `deploy/k8s/server-setup.sh`

서버에서 1회만 실행하는 스크립트다. k3s 설치, cert-manager 설치, 레지스트리 설정을 포함한다.

- [ ] **Step 1: server-setup.sh 작성**

```bash
#!/usr/bin/env bash
# deploy/k8s/server-setup.sh
# 서버에서 1회만 실행. root 또는 sudo 권한 필요.
set -euo pipefail

echo "▶ k3s 설치 (Traefik 기본 포함)..."
curl -sfL https://get.k3s.io | sh -

echo "▶ kubectl 설정..."
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown "$(id -u):$(id -g)" ~/.kube/config
chmod 600 ~/.kube/config

echo "▶ k3s 준비 대기..."
kubectl wait --for=condition=ready node --all --timeout=120s

echo "▶ cert-manager 설치..."
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
echo "▶ cert-manager 준비 대기 (최대 2분)..."
kubectl wait --namespace cert-manager \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/instance=cert-manager \
  --timeout=120s

echo "▶ 자체 레지스트리(registry.chanoo.dev) insecure 허용 설정..."
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/registries.yaml > /dev/null <<'EOF'
mirrors:
  "registry.chanoo.dev":
    endpoint:
      - "https://registry.chanoo.dev"
EOF
sudo systemctl restart k3s
echo "▶ k3s 재시작 후 준비 대기..."
sleep 10
kubectl wait --for=condition=ready node --all --timeout=60s

echo "✅ 서버 초기 설정 완료"
echo ""
echo "다음 단계:"
echo "  1. GitHub Secrets에 KUBE_CONFIG 추가 (cat ~/.kube/config | base64)"
echo "  2. GitHub Actions에서 첫 배포 실행"
```

- [ ] **Step 2: 실행 권한 부여**

```bash
chmod +x deploy/k8s/server-setup.sh
```

- [ ] **Step 3: 커밋**

```bash
git add deploy/k8s/server-setup.sh
git commit -m "feat: k3s 서버 초기 설정 스크립트 추가"
```

---

## Task 5: GitHub Actions 워크플로우 교체

**Files:**
- Modify: `.github/workflows/deploy.yml`

기존 SSH + deploy.sh 방식을 kubectl 기반으로 교체한다.
`KUBE_CONFIG` secret에는 서버의 `~/.kube/config` 를 base64 인코딩한 값을 저장한다.

**필요한 GitHub Secrets (추가):**
- `KUBE_CONFIG` — `cat ~/.kube/config | base64` 출력값

**기존 Secrets (유지):**
- `REGISTRY_USER`, `REGISTRY_PASSWORD` — 레지스트리 인증
- 나머지 앱 환경변수 secrets (기존 .env 항목들)

**제거 가능한 Secrets:**
- `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `SSH_USER`, `SSH_HOST`, `ENV_FILE`

- [ ] **Step 1: deploy.yml 전체 교체**

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
          registry: registry.chanoo.dev
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            registry.chanoo.dev/media-server:${{ steps.tag.outputs.tag }}
            registry.chanoo.dev/media-server:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Setup kubectl
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > /tmp/kubeconfig
          chmod 600 /tmp/kubeconfig
        env:
          KUBECONFIG: /tmp/kubeconfig

      - name: Apply k8s base manifests
        run: |
          kubectl apply -f deploy/k8s/namespace.yaml
          kubectl apply -f deploy/k8s/cluster-issuer.yaml
          kubectl apply -f deploy/k8s/service.yaml
          kubectl apply -f deploy/k8s/ingress.yaml
        env:
          KUBECONFIG: /tmp/kubeconfig

      - name: Create registry secret
        run: |
          kubectl create secret docker-registry regcred \
            --docker-server=registry.chanoo.dev \
            --docker-username=${{ secrets.REGISTRY_USER }} \
            --docker-password=${{ secrets.REGISTRY_PASSWORD }} \
            -n media-server --dry-run=client -o yaml | kubectl apply -f -
        env:
          KUBECONFIG: /tmp/kubeconfig

      - name: Create app env secret
        run: |
          # GitHub Secrets에서 앱 환경변수만 추출하여 k8s Secret 생성
          # SSH_, REGISTRY_, KUBE_ 접두사 secrets는 제외
          jq -r 'to_entries
            | map(select(.key | test("^(SSH_|REGISTRY_|KUBE_)") | not))
            | map("--from-literal=\(.key)=\(.value|tostring)")
            | .[]' <<< "$SECRETS_CONTEXT" | xargs \
            kubectl create secret generic media-server-env \
              -n media-server --dry-run=client -o yaml | kubectl apply -f -
        env:
          KUBECONFIG: /tmp/kubeconfig
          SECRETS_CONTEXT: ${{ toJson(secrets) }}

      - name: Apply deployment
        run: kubectl apply -f deploy/k8s/deployment.yaml
        env:
          KUBECONFIG: /tmp/kubeconfig

      - name: Update image and trigger rolling update
        run: |
          kubectl set image deployment/media-server \
            app=registry.chanoo.dev/media-server:${{ steps.tag.outputs.tag }} \
            -n media-server
        env:
          KUBECONFIG: /tmp/kubeconfig

      - name: Wait for rollout
        run: |
          kubectl rollout status deployment/media-server \
            -n media-server --timeout=120s
        env:
          KUBECONFIG: /tmp/kubeconfig
```

- [ ] **Step 2: 커밋**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: GitHub Actions를 kubectl 기반 배포로 교체"
```

---

## Task 6: 기존 Docker Compose / nginx / deploy.sh 제거

**Files:**
- Delete: `deploy/docker-compose.yml`
- Delete: `deploy/deploy.sh`
- Delete: `deploy/nginx/` (전체)

- [ ] **Step 1: 파일 삭제**

```bash
rm deploy/docker-compose.yml
rm deploy/deploy.sh
rm -rf deploy/nginx/
```

- [ ] **Step 2: 삭제 확인**

```bash
ls deploy/
# 기대 출력:
# k8s/
```

- [ ] **Step 3: 커밋**

```bash
git add -u deploy/
git commit -m "chore: Docker Compose, nginx, deploy.sh 제거"
```

---

## Task 7: 서버 실행 및 첫 배포 검증

이 Task는 서버에서 직접 수행한다.

- [ ] **Step 1: 서버에서 초기 설정 스크립트 실행**

```bash
# 서버 SSH 접속 후
bash /path/to/deploy/k8s/server-setup.sh
```

기대 출력: `✅ 서버 초기 설정 완료`

- [ ] **Step 2: KUBE_CONFIG secret 추가**

```bash
# 서버에서
cat ~/.kube/config | base64
```

출력값을 GitHub 저장소 → Settings → Secrets → `KUBE_CONFIG` 로 저장.

- [ ] **Step 3: main 브랜치에 push하여 첫 배포 트리거**

```bash
git push origin main
```

- [ ] **Step 4: GitHub Actions 로그에서 각 단계 확인**

- `Build and push image` — 성공
- `Apply k8s base manifests` — 성공
- `Create registry secret` — 성공
- `Create app env secret` — 성공
- `Update image and trigger rolling update` — 성공
- `Wait for rollout` — 성공 (`deployment "media-server" successfully rolled out`)

- [ ] **Step 5: 서버에서 Pod 상태 확인**

```bash
kubectl get pods -n media-server
# 기대 출력 (2개 Running):
# NAME                            READY   STATUS    RESTARTS   AGE
# media-server-xxxxxxxxx-xxxxx    1/1     Running   0          1m
# media-server-xxxxxxxxx-xxxxx    1/1     Running   0          1m
```

- [ ] **Step 6: 엔드포인트 헬스체크**

```bash
curl https://media.chanoo.dev/health
# 기대 출력: {"status":"ok"} 혹은 200 OK
```

- [ ] **Step 7: SSL 인증서 발급 확인**

```bash
kubectl get certificate -n media-server
# 기대 출력:
# NAME        READY   SECRET      AGE
# media-tls   True    media-tls   2m
```

---

## 롤백 방법 (참고)

```bash
# 이전 버전으로 즉시 롤백
kubectl rollout undo deployment/media-server -n media-server

# 롤백 상태 확인
kubectl rollout status deployment/media-server -n media-server
```
