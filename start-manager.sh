#!/bin/bash
export HOST='0.0.0.0'
export MANAGER_ALLOWED_IPS='127.0.0.1,192.168.7.200'
export UV_BIN='/home/leonard/.local/bin/uv'
exec node /home/leonard/openclaw-manager/apps/api/dist/index.js
