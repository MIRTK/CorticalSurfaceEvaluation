#!/bin/bash
node build.js $@

for platform in 'linux32' 'linux64'; do
  if [ -d "build/release/$platform" ]; then
    echo "Creating archive for ${platform}..."
    desktop_file="build/release/$platform/CorticalSurfaceEvaluation.desktop"
    cp "app.nw/app.desktop" "$desktop_file" && chmod a+x "$desktop_file" || exit 1
    cp -r "build/release/$platform" /tmp/CorticalSurfaceEvaluation
    tar -C /tmp -cjf build/release/CorticalSurfaceEvaluation-${platform}.tar.bz2 CorticalSurfaceEvaluation
    rm -rf /tmp/CorticalSurfaceEvaluation
    echo "Creating archive for ${platform}... done"
  fi
done

for platform in 'osx32' 'osx64'; do
  if [ -d "build/release/$platform" ]; then
    echo "Creating archive for ${platform}..."
    cp "app.nw/dmg.json" "build/release/$platform/dmg.json" || exit 1
    cd "build/release/$platform" || exit 1
    appdmg dmg.json CorticalSurfaceEvaluation-${platform}.dmg || exit 1
    rm -f dmg.json
    mv CorticalSurfaceEvaluation-${platform}.dmg ..
    cd ../../.. || exit 1
    echo "Creating archive for ${platform}... done"
  fi
done
