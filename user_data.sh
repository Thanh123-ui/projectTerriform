#!/bin/bash
set -u
set -x

exec > >(tee /var/log/user-data.log | logger -t user-data 2>/dev/console) 2>&1

APP_DIR="/opt/hospital-booking"
APP_USER="ec2-user"
SERVICE_NAME="hospital-booking"

echo "=== Update OS and install required packages on AL2023 ==="
dnf update -y
dnf install -y git mariadb105 nodejs npm

echo "=== Prepare application directory ==="
rm -rf "$${APP_DIR}"
mkdir -p "$${APP_DIR}"

echo "=== Clone GitHub repo ==="
git clone --depth 1 "${github_repo_url}" "$${APP_DIR}" || exit 1
chown -R "$${APP_USER}:$${APP_USER}" "$${APP_DIR}"

echo "=== Create .env ==="
cat > "$${APP_DIR}/.env" <<EOF_ENV
PORT=${app_port}
DB_HOST=${db_host}
DB_PORT=${db_port}
DB_NAME=${db_name}
DB_USER=${db_username}
DB_PASSWORD=${db_password}
SESSION_SECRET=lab-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=Thanh2004
EOF_ENV

chown "$${APP_USER}:$${APP_USER}" "$${APP_DIR}/.env"
chmod 600 "$${APP_DIR}/.env"

echo "=== Install Node dependencies ==="
runuser -u "$${APP_USER}" -- bash -lc "cd '$${APP_DIR}' && npm install" || exit 1

echo "=== Create wait-for-rds script ==="
cat > /usr/local/bin/wait-for-rds.sh <<'EOF_WAIT'
#!/bin/bash
set -euo pipefail

ENV_FILE="/opt/hospital-booking/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Missing $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

ATTEMPTS=60
SLEEP_SECONDS=10

for ((i=1; i<=ATTEMPTS; i++)); do
  if getent hosts "$DB_HOST" >/dev/null 2>&1; then
    if MYSQL_PWD="$DB_PASSWORD" mysql \
      --protocol=tcp \
      --connect-timeout=5 \
      --host="$DB_HOST" \
      --port="$DB_PORT" \
      --user="$DB_USER" \
      --database="$DB_NAME" \
      -e "SELECT 1;" >/dev/null 2>&1; then
      echo "RDS is ready."
      exit 0
    fi
  fi

  echo "[$i/$ATTEMPTS] Waiting for RDS at $DB_HOST:$DB_PORT ..."
  sleep "$SLEEP_SECONDS"
done

echo "ERROR: RDS is not ready after $ATTEMPTS attempts."
exit 1
EOF_WAIT

chmod +x /usr/local/bin/wait-for-rds.sh

echo "=== Create systemd service ==="
cat > /etc/systemd/system/hospital-booking.service <<EOF_SERVICE
[Unit]
Description=Hospital Booking Node.js Application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$${APP_USER}
WorkingDirectory=$${APP_DIR}
EnvironmentFile=$${APP_DIR}/.env
ExecStartPre=/usr/local/bin/wait-for-rds.sh
ExecStart=/usr/bin/bash -lc 'cd $${APP_DIR} && npm start'
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF_SERVICE

echo "=== Enable and start service ==="
systemctl daemon-reload
systemctl enable "$${SERVICE_NAME}.service"
systemctl start "$${SERVICE_NAME}.service"

echo "=== Bootstrap completed ==="