#!/usr/bin/env bash
# Script to launch all 3 Skill Suite macOS applications in separate windows

APPS=(
  "Skill Photo.app"
  "Skill Vector.app"
  "Skill Motion.app"
)

echo "=========================================="
echo "    Launching Skill Suite Applications    "
echo "=========================================="

for app in "${APPS[@]}"; do
  app_path="/Applications/$app"
  if [ -d "$app_path" ]; then
    echo "-> Opening $app..."
    open -n "$app_path"
  else
    fallback="./installer/Mac/Applications/$app"
    if [ -d "$fallback" ]; then
      echo "-> Opening from installer: $app..."
      open -n "$fallback"
    else
      echo "-> Warning: Could not find $app"
    fi
  fi
  sleep 0.5
done

echo "✓ Skill Suite applications launched in separate windows!"
