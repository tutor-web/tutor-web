#!/bin/sh
set -ex

# This script will create a systemd unit for running the backend, and
# an nginx config.
#
# It is tested on Debian, but should hopefully work on anything systemd-based.

# ---------------------------
# Config options, to override any of these, set them in .local.conf

set -a  # Auto-export for --exec option
[ -e ".local-conf" ] && . ./.local-conf
PROJECT_PATH="${PROJECT_PATH-$(dirname "$(readlink -f "$0")")}"  # The full project path, e.g. /srv/tutor-web.beta
PROJECT_NAME="${PROJECT_NAME-$(basename ${PROJECT_PATH})}"  # The project directory name, e.g. tutor-web.beta
PROJECT_MODE="${PROJECT_MODE-development}"  # The project mode, development or production

SERVER_NAME="${SERVER_NAME-$(hostname --fqdn)}"  # The server_name(s) NGINX responds to
SERVER_CERT_PATH="${SERVER_CERT_PATH-/var/lib/dehydrated}"  # Dehydrated working dir
if [ "${PROJECT_MODE}" = "production" ]; then
    # Default to nobody
    UWSGI_USER="${UWSGI_USER-nobody}"
    UWSGI_GROUP="${UWSGI_GROUP-nogroup}"
else
    # Default to user that checked out code (i.e the developer)
    UWSGI_USER="${UWSGI_USER-$(stat -c '%U' ${PROJECT_PATH}/.git)}"
    UWSGI_GROUP="${UWSGI_GROUP-$(stat -c '%U' ${PROJECT_PATH}/.git)}"
fi
UWSGI_SOCKET="${UWSGI_SOCKET-/tmp/${PROJECT_NAME}_uwsgi.${PROJECT_MODE}.sock}"
UWSGI_MAILSENDER="${UWSGI_MAILSENDER-noreply@$SERVER_NAME}"
UWSGI_MAILHOST="${UWSGI_MAILHOST-localhost}"
UWSGI_MAILPORT="${UWSGI_MAILPORT-25}"

DB_SUDO_USER="${DB_SUDO_USER-postgres}"  # The user that has root access to DB
DB_HOST="${DB_HOST-/var/run/postgresql/}"  # The hostname / socket path to connect to
DB_NAME="${DB_NAME-$(echo -n ${PROJECT_NAME} | sed 's/\W/_/g')_db}"  # The DB to create
DB_USER="${DB_USER-}"  # The credentials that the app will use
DB_PASS="${DB_PASS-}"  # The credentials that the app will use
DB_URL="postgresql://${DB_USER}:${DB_PASS}@/${DB_NAME}?host=${DB_HOST}"

if [ "${PROJECT_MODE}" = "production" ]; then
    UWSGI_LOGLEVEL_ROOT="${UWSGI_LOGLEVEL_ROOT-INFO}"
    UWSGI_LOGLEVEL_APP="${UWSGI_LOGLEVEL_APP-DEBUG}"
else
    UWSGI_LOGLEVEL_ROOT="${UWSGI_LOGLEVEL_ROOT-WARN}"
    UWSGI_LOGLEVEL_APP="${UWSGI_LOGLEVEL_APP-WARN}"
fi
set +a

set | grep -E '^PROJECT_|^SERVER_|^UWSGI_|^APP_|^DB_'

# If just used to execute a server (in development mode, e.g.) do that
[ "$1" = "--exec" ] && { shift; exec $*; }

# ---------------------------
# (re)create postgresql datbase
(cd schema && sudo -u "${DB_SUDO_USER}" DB_RW_USERS="${DB_RW_USERS-}" DB_RO_USERS="${DB_RO_USERS-}" ./rebuild.sh "${DB_NAME}" "${UWSGI_USER}"; ) || exit 1

# ---------------------------
# Systemd unit file to run uWSGI
systemctl | grep -q "${PROJECT_NAME}.service" && systemctl stop ${PROJECT_NAME}.service
cat <<EOF > /etc/systemd/system/${PROJECT_NAME}.service
[Unit]
Description=uWSGI daemon for ${PROJECT_NAME}
After=network.target

[Service]
ExecStart=${PROJECT_PATH}/server/bin/pserve \
    ${PROJECT_PATH}/server/application.ini
WorkingDirectory=${PROJECT_PATH}/server
User=${UWSGI_USER}
Group=${UWSGI_GROUP}
Restart=on-failure
RestartSec=5s
Type=simple
StandardError=syslog
NotifyAccess=all

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
if [ "${PROJECT_MODE}" = "production" ]; then
    [ -f "${UWSGI_SOCKET}" ] && chown ${UWSGI_USER}:${UWSGI_GROUP} "${UWSGI_SOCKET}"
    systemctl enable ${PROJECT_NAME}.service
    systemctl start ${PROJECT_NAME}.service
else
    systemctl disable ${PROJECT_NAME}.service
    systemctl stop ${PROJECT_NAME}.service
fi

# ---------------------------
# NGINX config for serving clientside
echo -n "" > /etc/nginx/sites-available/${PROJECT_NAME}

if [ -e "${SERVER_CERT_PATH}" ]; then
    # Generate self-signed cert as fallthrough
    mkdir -p -- "${SERVER_CERT_PATH}/certs/${SERVER_NAME}"
    [ -e "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/privkey-ss.pem" ] || openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
        -keyout "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/privkey-ss.pem" \
        -out "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/fullchain-ss.pem" \
        -subj "/C=GB/CN=${SERVER_NAME}" \
        -addext "subjectAltName = DNS:selfsigned.${SERVER_NAME}"
    [ -e "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/fullchain.pem" ] || ln -rs \
        "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/fullchain-ss.pem" \
        "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/fullchain.pem"
    [ -e "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/privkey.pem" ] || ln -rs \
        "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/privkey-ss.pem" \
        "${SERVER_CERT_PATH}/certs/${SERVER_NAME}/privkey.pem"
    [ -e "${SERVER_CERT_PATH}/dhparam.pem" ] || openssl dhparam -out "${SERVER_CERT_PATH}/dhparam.pem" 4096

    # Generate full-blown SSL config
    cat <<EOF >> /etc/nginx/sites-available/${PROJECT_NAME}
server {
    listen      80;
    server_name ${SERVER_NAME};

    location /.well-known/acme-challenge/ {
        alias "${SERVER_CERT_PATH}/acme-challenge/";
    }

    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen [::]:443 ssl;
    listen      443 ssl;
    server_name ${SERVER_NAME};

    ssl_certificate      ${SERVER_CERT_PATH}/certs/${SERVER_NAME}/fullchain.pem;
    ssl_certificate_key  ${SERVER_CERT_PATH}/certs/${SERVER_NAME}/privkey.pem;
    ssl_trusted_certificate ${SERVER_CERT_PATH}/certs/${SERVER_NAME}/fullchain.pem;
    ssl_dhparam ${SERVER_CERT_PATH}/dhparam.pem;

    # https://mozilla.github.io/server-side-tls/ssl-config-generator/
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    # intermediate configuration. tweak to your needs.
    ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-DSS-AES128-GCM-SHA256:kEDH+AESGCM:ECDHE-RSA-AES128-SHA256:ECDHE-ECDSA-AES128-SHA256:ECDHE-RSA-AES128-SHA:ECDHE-ECDSA-AES128-SHA:ECDHE-RSA-AES256-SHA384:ECDHE-ECDSA-AES256-SHA384:ECDHE-RSA-AES256-SHA:ECDHE-ECDSA-AES256-SHA:DHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA:DHE-DSS-AES128-SHA256:DHE-RSA-AES256-SHA256:DHE-DSS-AES256-SHA:DHE-RSA-AES256-SHA:ECDHE-RSA-DES-CBC3-SHA:ECDHE-ECDSA-DES-CBC3-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA256:AES256-SHA256:AES128-SHA:AES256-SHA:AES:CAMELLIA:DES-CBC3-SHA:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!aECDH:!EDH-DSS-DES-CBC3-SHA:!EDH-RSA-DES-CBC3-SHA:!KRB5-DES-CBC3-SHA';
    ssl_prefer_server_ciphers on;

EOF
elif [ -n "${SERVER_CERT_PATH}" ]; then
    # HTTP only, but add acme-challenge section for bootstrapping
    cat <<EOF >> /etc/nginx/sites-available/${PROJECT_NAME}
server {
    listen      80;
    server_name ${SERVER_NAME};

    location /.well-known/acme-challenge/ {
        alias "${SERVER_CERT_PATH}/acme-challenge/";
    }
EOF
else
    # HTTP only
    cat <<EOF >> /etc/nginx/sites-available/${PROJECT_NAME}
server {
    listen      80;
    server_name ${SERVER_NAME};
EOF
fi

cat <<EOF >> /etc/nginx/sites-available/${PROJECT_NAME}
    charset     utf-8;
    root "${PROJECT_PATH}/client/www";
    gzip        on;

    proxy_intercept_errors on;
    proxy_set_header Host            \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host \$host:\$server_port;
    proxy_set_header X-Forwarded-Port \$server_port;
    error_page 502 503 504 /error/bad_gateway.json;

    location /api/ {
        proxy_pass  http://unix:${UWSGI_SOCKET}:/api/;
    }

    location /auth/ {
        proxy_pass  http://unix:${UWSGI_SOCKET}:/auth/;
    }

    location = /lti-tool-config.xml {
        proxy_pass  http://unix:${UWSGI_SOCKET}:/auth/lti-tool-config.xml;
    }

    location /mathjax/ {
        alias "${PROJECT_PATH}/client/node_modules/mathjax/";
    }

    location / {
        if (\$request_method = POST ) {
            # Assume any POST requests outside the API are Oauth attempts
            rewrite ^/([A-Za-z0-9]+) /auth/sso/\$1 break;
            proxy_pass  http://unix:${UWSGI_SOCKET}:;
        }

        # Old Plone URL that we told coin explorers to use
        rewrite /@@quizdb-coin-totalcoins /api/coin/totalcoin permanent;
        try_files \$uri \$uri.html /index.html;
    }
}
EOF
ln -fs /etc/nginx/sites-available/${PROJECT_NAME} /etc/nginx/sites-enabled/${PROJECT_NAME}
nginx -t
systemctl reload nginx.service
