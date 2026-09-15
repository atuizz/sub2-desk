#!/usr/bin/env bash
set -Eeuo pipefail
base=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
source_dir=$(cat "$base/current-source")
project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$base/.env" | head -1)
[[ "$project" =~ ^sub2-desk-[0-9]+$ ]] || { echo '项目标识无效' >&2; exit 1; }
cmd=(docker)
docker info >/dev/null 2>&1 || cmd=(sudo docker)
exec "${cmd[@]}" compose --project-name "$project" --env-file "$base/.env" -f "$source_dir/deploy/fullstack.yml" "$@"
