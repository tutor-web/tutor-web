# Prerequisites
First, configure your system to include the Yarn repository: https://yarnpkg.com/lang/en/docs/install/

...then the nodejs repository:

```
curl -s https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -
echo "deb https://deb.nodesource.com/node_6.x xenial main" > /etc/apt/sources.list.d/nodesource.list
apt-get update
```

Server-side dependencies:

```
apt install \
    python3 python3-venv python3-dev \
    libreadline-dev \
    r-base-core r-base-dev \
    postgresql postgresql-contrib libpq-dev
```

Client-side dependencies:

```
apt install \
    make nodejs nodejs-legacy yarn nginx ssl-cert
```

R packages for question bank:

```
cat <<EOF | R --vanilla
install.packages('jsonlite', repos = "https://cloud.r-project.org")
install.packages('htmltools', repos = "https://cloud.r-project.org")
EOF
```

## Production configuration

Create a ``.local-conf`` configuration file, including the smileycoin wallet configuration:

    cat <<EOF > .local-conf
    PROJECT_MODE=production
    SERVER_NAME=beta.tutor-web.net

    APP_SMILEYCOIN_rpc_pass=(passphrase)
    EOF

For more information in service options, see ``install.sh``. For more information on
smileycoin options, see ``tutorweb_quizdb/smileycoin.py``.

## Debugging

### Fake SMTP server for activation e-mails

First reconfigure the backend to use a non-priveliged port:

    cat <<EOF >> .local-conf
    UWSGI_MAILPORT="8025"
    EOF

You can start a fake SMTP server to receive e-mails with:

    make fakesmtp
