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
