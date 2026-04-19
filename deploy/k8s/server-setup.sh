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
echo "▶ cert-manager 준비 대기 (최대 3분)..."
kubectl -n cert-manager rollout status deployment/cert-manager --timeout=180s
kubectl -n cert-manager rollout status deployment/cert-manager-webhook --timeout=180s
kubectl -n cert-manager rollout status deployment/cert-manager-cainjector --timeout=180s

echo "▶ Docker 레지스트리 실행..."
docker run -d \
  --name registry \
  --restart unless-stopped \
  -p 127.0.0.1:5000:5000 \
  -e REGISTRY_AUTH=htpasswd \
  -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm" \
  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
  -v /opt/registry/data:/var/lib/registry \
  -v /opt/registry/auth:/auth \
  registry:2

echo "▶ registry-service.yaml에 노드 IP 주입..."
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sed -i "s/NODE_IP_PLACEHOLDER/${NODE_IP}/" "${SCRIPT_DIR}/registry-service.yaml"
echo "  노드 IP: ${NODE_IP}"

echo "✅ 서버 초기 설정 완료"
echo ""
echo "다음 단계:"
echo "  1. htpasswd 생성: docker run --rm httpd:2 htpasswd -Bbn <user> <password>"
echo "     → sudo mkdir -p /opt/registry/auth"
echo "     → 위 출력값을 sudo tee /opt/registry/auth/htpasswd"
echo "  2. GitHub Secrets에 KUBE_CONFIG 추가: sudo cat /etc/rancher/k3s/k3s.yaml | base64"
echo "  3. GitHub Actions에서 첫 배포 실행"
