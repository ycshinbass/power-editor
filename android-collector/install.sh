#!/data/data/com.termux/files/usr/bin/bash
set -eu
command -v python >/dev/null || { printf '먼저 pkg install python termux-api 를 실행하세요.\n'; exit 1; }
command -v termux-job-scheduler >/dev/null || { printf 'termux-api 패키지와 Termux:API 앱이 필요합니다.\n'; exit 1; }
mkdir -p "$HOME/.power-editor-collector"
chmod 700 "$HOME/.power-editor-collector"
cp "$(dirname "$0")/collector.py" "$HOME/.power-editor-collector/collector.py"
cat > "$HOME/.power-editor-collector/run.sh" <<'RUN'
#!/data/data/com.termux/files/usr/bin/bash
exec /data/data/com.termux/files/usr/bin/python /data/data/com.termux/files/home/.power-editor-collector/collector.py --once
RUN
chmod 700 "$HOME/.power-editor-collector/run.sh"
python "$HOME/.power-editor-collector/collector.py" --configure
printf '설정 완료. 먼저 python ~/.power-editor-collector/collector.py --once 로 시험하세요.\n'
printf '시험 성공 후 bash start.sh 로 예약을 켜세요.\n'
