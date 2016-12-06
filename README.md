Cortical Surface Evaluation
===========================

App for manual evaluation of surfaces reconstructed
using the [MIRTK](https://mirtk.github.io)
[recon-neonatal-cortex](https://github.com/MIRTK/Deformable/blob/add-recon-neonatal-cortex/tools/recon-neonatal-cortex.py)
command.

## Package

This application uses NW.js and can be packaged for macOS with the following commands:

### Dependencies

```
brew install npm appdmg
npm install -g nw nw-gyp nw-builder
npm install jquery tether bootstrap@4.0.0-alpha.5

## https://www.npmjs.com/package/sqlite3#building-for-node-webkit
NODE_WEBKIT_VERSION=0.19.0 # see latest version at https://github.com/rogerwang/node-webkit#downloads
npm install sqlite3 --build-from-source --runtime=node-webkit --target_arch=x64 --target=$NODE_WEBKIT_VERSION
```

### Build package

```
nwbuild -p osx64 app.nw
cp app.nw/app/app.icns build/.../CorticalSurfaceEvaluation.app/Contents/Resources/app.icns
cp app.nw/app/app.icns build/.../CorticalSurfaceEvaluation.app/Contents/Resources/document.icns
cp app.nw/appdmg.json build/.../
cd build/.../
appdmg appdmg.json CorticalSurfaceEvaluation.dmg
```
