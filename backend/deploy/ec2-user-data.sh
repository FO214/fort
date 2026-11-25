#!/bin/bash
# Paste as EC2 "User data" on an Amazon Linux 2023 t3.micro (free tier).
# Open inbound 80 + 443 in the security group. First boot takes ~2 min.
set -eux
dnf install -y docker git
systemctl enable --now docker
curl -sSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
cd /opt && git clone https://github.com/FO214/loonie.git
cd loonie/backend/deploy
IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
echo "PUBLIC_HOST=${IP//./-}.sslip.io" > .env
# The key for uploading maps (POST /maps/{id}). Read it back with: cat /opt/loonie/backend/deploy/.env
echo "LOONIE_UPLOAD_KEY=$(openssl rand -hex 24)" >> .env
docker-compose up -d --build
