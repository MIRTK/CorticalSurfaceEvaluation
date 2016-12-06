Cortical Surface Evaluation
===========================

App for manual evaluation of surfaces reconstructed
using the [MIRTK](https://mirtk.github.io)
[recon-neonatal-cortex](https://github.com/MIRTK/Deformable/blob/add-recon-neonatal-cortex/tools/recon-neonatal-cortex.py)
command.

## Package

This application uses NW.js and can be packaged for macOS with the following commands:

### Install Node.js

#### Ubuntu

This application was developed with Node.js 7.2. Earlier versions may work as well,
including the version available through the official Ubuntu 14.04 `nodejs` package.
However, `nwbuild` to create a package failed with this version.
Therefore, use `nvm` to install a more recent version with the commands below or
see [here](http://www.hostingadvice.com/how-to/install-nodejs-ubuntu-14-04/#node-version-manager)
for alternative installation methods.

```
sudo apt-get install libssl-dev
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.0/install.sh | bash
nvm install 7.2
```

#### macOS

```
brew install node npm
```

### Install NW.js

This application was developed with NW.js 0.19.0.

```
npm install -g nw nw-gyp nw-builder
```

### Dependencies

```
cd app.nw
npm install jquery tether bootstrap@4.0.0-alpha.5

## https://www.npmjs.com/package/sqlite3#building-for-node-webkit
NODE_WEBKIT_VERSION=0.19.0 # see latest version at https://github.com/rogerwang/node-webkit#downloads
npm install sqlite3 --build-from-source --runtime=node-webkit --target_arch=x64 --target=$NODE_WEBKIT_VERSION
```

### Build package

Run the following commands from the top-level directory of this project.

#### Linux

```
nwbuild -p linux64 -o linux64 app.nw
mv linux64/CorticalSurfaceEvaluation/linux64/* linux64/CorticalSurfaceEvaluation/
rmdir linux64/CorticalSurfaceEvaluation/linux64
tar -C linux64 -cjf linux64/CorticalSurfaceEvaluation.tar.bz2 CorticalSurfaceEvaluation
rm -rf linux64/CorticalSurfaceEvaluation  # optional clean up
```

#### macOS

```
brew install appdmg
nwbuild -p osx64 -o osx64 app.nw
mv osx64/CorticalSurfaceEvaluation/osx64/CorticalSurfaceEvaluation.app osx64/
rm -rf osx64/CorticalSurfaceEvaluation
cp app.nw/app.icns osx64/CorticalSurfaceEvaluation.app/Contents/Resources/app.icns
cp app.nw/app.icns osx64/CorticalSurfaceEvaluation.app/Contents/Resources/document.icns
cp app.nw/appdmg.json osx64/
cd osx64 && appdmg appdmg.json CorticalSurfaceEvaluation.dmg
rm -rf CorticalSurfaceEvaluation.app  # optional clean up
```
