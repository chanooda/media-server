#!/usr/bin/env bash
# deploy/deploy.sh
# Usage: ./deploy.sh <image-tag>

set -euo pipefail

export IMAGE_TAG="${1:?이미지 태그를 인자로 전달하세요. 예: ./deploy.sh abc1234}"
APP_DIR="/opt/media-server"
REGISTRY="registry.yourdomain.com"
IMAGE="${REGISTRY}/media-server:${IMAGE_TAG}"
ACTIVE_COLOR_FILE="${APP_DIR}/active_color"
HEALTH_CHECK_RETRIES=30
HEALTH_CHECK_INTERVAL=2

if [[ ! -f "${ACTIVE_COLOR_FILE}" ]]; then
  echo "ERROR: ${ACTIVE_COLOR_FILE} not found. Create it with: echo blue > ${ACTIVE_COLOR_FILE}" >&2
  exit 1
fi
ACTIVE_COLOR=$(tr -d '[:space:]' < "${ACTIVE_COLOR_FILE}")
if [[ "${ACTIVE_COLOR}" != "blue" && "${ACTIVE_COLOR}" != "green" ]]; then
  echo "ERROR: Invalid active color '${ACTIVE_COLOR}'. Must be 'blue' or 'green'." >&2
  exit 1
fi
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

echo "▶ 이미지 pull..."
docker pull "${IMAGE}"

cd "${APP_DIR}"
echo "▶ media-server-${NEW_COLOR} 시작..."
docker compose up -d "media-server-${NEW_COLOR}"

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

echo "▶ nginx upstream 전환: ${NEW_COLOR}"
ln -sfn "${APP_DIR}/nginx/upstream/${NEW_COLOR}.conf" \
        "${APP_DIR}/nginx/upstream/active.conf"

if ! sudo nginx -t 2>/dev/null; then
  echo "  ✗ nginx 설정 오류 — symlink 롤백"
  ln -sfn "${APP_DIR}/nginx/upstream/${ACTIVE_COLOR}.conf" \
          "${APP_DIR}/nginx/upstream/active.conf"
  docker compose stop "media-server-${NEW_COLOR}"
  exit 1
fi
sudo nginx -s reload

echo "${NEW_COLOR}" > "${ACTIVE_COLOR_FILE}"

echo "▶ 구버전 media-server-${ACTIVE_COLOR} 중지..."
docker compose stop "media-server-${ACTIVE_COLOR}"
docker compose rm -f "media-server-${ACTIVE_COLOR}"

echo "✅ 배포 완료: ${NEW_COLOR} (태그: ${IMAGE_TAG})"
