#!/bin/bash
clear
echo "=========================================================="
echo "          SKILL SUITE v1.0 — MAC INSTALLER                "
echo "=========================================================="
echo ""
echo "This installer will copy all 4 applications to your /Applications folder:"
echo " - Skill Photo.app"
echo " - Skill Vector.app"
echo " - Skill Motion.app"
echo " - Skill Design.app"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_SOURCE="$SCRIPT_DIR/Applications"

if [ ! -d "$APPS_SOURCE" ]; then
  echo "Error: Applications folder not found at $APPS_SOURCE"
  exit 1
fi

DEST="/Applications"

for app in "Skill Photo.app" "Skill Vector.app" "Skill Motion.app" "Skill Design.app"; do
  echo "-> Installing $app to $DEST..."
  rm -rf "$DEST/$app"
  cp -R "$APPS_SOURCE/$app" "$DEST/"
  xattr -dr com.apple.quarantine "$DEST/$app" 2>/dev/null || true
  chmod -R 755 "$DEST/$app"
  echo "   ✓ $app installed successfully!"
done

echo ""
echo "=========================================================="
echo "  ✓ INSTALLATION COMPLETE! All 4 apps are in /Applications"
echo "=========================================================="
echo ""
echo "You can launch them directly from Launchpad, Spotlight, or Applications."
osascript -e 'display notification "All 4 Skill Suite applications installed to /Applications!" with title "Skill Suite v1.0 Installed"' 2>/dev/null || true
read -p "Press [Enter] to exit..."
