#!/data/data/com.termux/files/usr/bin/bash
set -eu
termux-job-scheduler --job-id 161017 --script "$HOME/.power-editor-collector/run.sh" --period-ms 3600000 --network any --battery-not-low true --persisted true
printf '시간당 확인 작업 등록. Android 절전 상태에 따라 지연될 수 있습니다.\n'
