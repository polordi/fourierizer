#!/bin/bash
# Fourierizer for macOS: one .pkg with the instrument (VST3), Fourierizer Capture (VST3) and the
# Standalone app. Built by .github/workflows/release.yml:
#   installer/macos/build-pkg.sh 2.0.0 build/release
#
# The package is not signed or notarized (that needs a paid Apple Developer account, PLAN §3.8):
# the first time, open it with right-click > Open.
set -euo pipefail

VERSION="${1:?version}"
BUILD="${2:-build/release}"
OUT="build/installer"
STAGE="$(mktemp -d)"
mkdir -p "$OUT" "$STAGE/vst3" "$STAGE/capture" "$STAGE/app" "$STAGE/pkgs"

cp -R "$BUILD/plugin/Fourierizer_artefacts/Release/VST3/Fourierizer.vst3" "$STAGE/vst3/"
cp -R "$BUILD/capture/FourierizerCapture_artefacts/Release/VST3/Fourierizer Capture.vst3" "$STAGE/capture/"
cp -R "$BUILD/plugin/Fourierizer_artefacts/Release/Standalone/Fourierizer.app" "$STAGE/app/"

# Bundles must land exactly where we say (not "relocated" to another copy found on the disk).
component() {   # root, install location, identifier, output
    local plist="$STAGE/$3.plist"
    pkgbuild --analyze --root "$1" "$plist"
    /usr/libexec/PlistBuddy -c "Set :0:BundleIsRelocatable false" "$plist" 2>/dev/null || true
    pkgbuild --root "$1" --component-plist "$plist" --install-location "$2" --identifier "$3" --version "$VERSION" "$4"
}
component "$STAGE/vst3" /Library/Audio/Plug-Ins/VST3 com.wavesp.fourierizer.vst3 "$STAGE/pkgs/fourierizer-vst3.pkg"
component "$STAGE/capture" /Library/Audio/Plug-Ins/VST3 com.wavesp.fourierizercapture.vst3 "$STAGE/pkgs/fourierizer-capture.pkg"
component "$STAGE/app" /Applications com.wavesp.fourierizer.app "$STAGE/pkgs/fourierizer-app.pkg"

productbuild --package "$STAGE/pkgs/fourierizer-vst3.pkg" \
             --package "$STAGE/pkgs/fourierizer-capture.pkg" \
             --package "$STAGE/pkgs/fourierizer-app.pkg" \
             "$OUT/Fourierizer-$VERSION-macOS.pkg"
echo "built $OUT/Fourierizer-$VERSION-macOS.pkg"
