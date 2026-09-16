#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
VERSION=1.1.2
INSTALL_DIR="${SUB2_DESK_INSTALL_DIR:-$HOME/sub2-desk}"
PORT="${SUB2_DESK_PORT:-8080}"
[[ "$PORT" =~ ^[0-9]+$ ]] && ((10#$PORT >= 1 && 10#$PORT <= 65535)) || { echo '端口必须在 1–65535 之间。' >&2; exit 1; }
die() { printf '安装未完成：%s\n' "$*" >&2; exit 1; }
trap 'echo "安装中断，已生成的配置和数据会保留。修复错误后可重复执行安装命令。" >&2' ERR
command -v curl >/dev/null || die '请先安装 curl。'
command -v tar >/dev/null || die '请先安装 tar。'
admin=()
if [[ "$(id -u)" != 0 ]]; then admin=(sudo); fi
if ! command -v docker >/dev/null; then
  [[ "$(uname -s)" == Linux ]] || die '请先安装并启动 Docker Desktop，然后重新执行。'
  echo '正在通过 Docker 官方安装器安装 Docker Engine…'
  docker_setup=$(mktemp)
  curl -fLsS --retry 3 https://get.docker.com -o "$docker_setup"
  "${admin[@]}" sh "$docker_setup"
  rm -f "$docker_setup"
fi
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  if [[ "$(uname -s)" == Linux ]]; then
    if command -v systemctl >/dev/null; then "${admin[@]}" systemctl start docker; fi
    docker_cmd=("${admin[@]}" docker)
  fi
fi
"${docker_cmd[@]}" info >/dev/null 2>&1 || die 'Docker 未启动或当前用户无访问权限。'
"${docker_cmd[@]}" compose version >/dev/null 2>&1 || die '需要 Docker Compose v2 插件。'
mkdir -p "$INSTALL_DIR"
INSTALL_DIR=$(cd "$INSTALL_DIR" && pwd -P)
[[ ! -L "$INSTALL_DIR/.env" ]] || die '配置文件不能是符号链接。'
if ! mkdir "$INSTALL_DIR/.install-lock" 2>/dev/null; then die "另一个安装正在运行；若上次被强制终止，请确认无安装进程后删除 $INSTALL_DIR/.install-lock。"; fi
stage=''
cleanup() { [[ -z "$stage" ]] || rm -rf -- "$stage"; rmdir "$INSTALL_DIR/.install-lock"; }
trap cleanup EXIT
random_hex() { od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'; }
if [[ ! -e "$INSTALL_DIR/.env" ]]; then
  config_tmp=$(mktemp "$INSTALL_DIR/.env.XXXXXX")
  {
    printf 'SUB2_DESK_PORT=%s\n' "$PORT"
    printf 'SUB2_DESK_BIND=0.0.0.0\n'
    printf 'COMPOSE_PROJECT_NAME=sub2-desk-%s\n' "$(printf '%s' "$INSTALL_DIR" | cksum | cut -d ' ' -f 1)"
    printf 'ADMIN_EMAIL=admin@sub2desk.local\n'
    printf 'ADMIN_PASSWORD=%s\n' "$(random_hex 16)"
    printf 'POSTGRES_PASSWORD=%s\n' "$(random_hex 32)"
    printf 'REDIS_PASSWORD=%s\n' "$(random_hex 32)"
    printf 'JWT_SECRET=%s\n' "$(random_hex 32)"
    printf 'TOTP_ENCRYPTION_KEY=%s\n' "$(random_hex 32)"
  } > "$config_tmp"
  mv "$config_tmp" "$INSTALL_DIR/.env"
fi
chmod 600 "$INSTALL_DIR/.env"
release_dir="$INSTALL_DIR/releases/$VERSION"
if [[ -n "${SUB2_DESK_SOURCE_DIR:-}" ]]; then
  # Allows offline source installs and CI to exercise this exact installer before tagging.
  release_dir=$(cd "$SUB2_DESK_SOURCE_DIR" && pwd -P)
elif [[ ! -f "$release_dir/deploy/fullstack.yml" ]]; then
  mkdir -p "$INSTALL_DIR/releases"
  stage=$(mktemp -d "$INSTALL_DIR/releases/.stage.XXXXXX")
  curl -fLsS --retry 3 "https://github.com/atuizz/sub2-desk/archive/refs/tags/v$VERSION.tar.gz" -o "$stage/source.tar.gz"
  mkdir "$stage/source"
  # Private credentials stay 0600; public source assets must be readable by nginx.
  (umask 022; tar -xzf "$stage/source.tar.gz" --strip-components=1 -C "$stage/source")
  [[ -f "$stage/source/deploy/fullstack.yml" ]] || die '下载内容不完整。'
  [[ ! -e "$release_dir" ]] || die '版本目录不完整，请检查后重试。'
  mv "$stage/source" "$release_dir"
fi
project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$INSTALL_DIR/.env" | head -1)
[[ "$project" =~ ^sub2-desk-[0-9]+$ ]] || die '配置缺少有效的 COMPOSE_PROJECT_NAME。'
compose=("${docker_cmd[@]}" compose --project-name "$project" --env-file "$INSTALL_DIR/.env" -f "$release_dir/deploy/fullstack.yml")
"${compose[@]}" config --quiet
echo '正在下载官方后端、数据库与 Redis，并构建 Sub2 Desk；首次安装需要几分钟…'
"${compose[@]}" up -d --build --wait --wait-timeout 300
printf '%s\n' "$release_dir" > "$INSTALL_DIR/current-source"
cp "$release_dir/deploy/manage.sh" "$INSTALL_DIR/manage.sh"
port=$(sed -n 's/^SUB2_DESK_PORT=//p' "$INSTALL_DIR/.env" | head -1)
curl -fLsS --retry 3 "http://127.0.0.1:$port/health" >/dev/null || die '服务健康检查失败。'
printf '\nSub2 Desk 安装完成！\n本机访问：http://localhost:%s\n远程访问：http://服务器IP:%s\n配置目录：%s\n' "$port" "$port" "$INSTALL_DIR"
if [[ "${SUB2_DESK_SHOW_CREDENTIALS:-1}" == 1 ]]; then
  sed -n -e 's/^ADMIN_EMAIL=/管理员账号：/p' -e 's/^ADMIN_PASSWORD=/初始密码（修改过密码时以新密码为准）：/p' "$INSTALL_DIR/.env"
fi
echo '登录后请修改初始密码；公网使用请配置 HTTPS。'
