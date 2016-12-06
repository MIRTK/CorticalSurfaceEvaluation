Cortical Surface Evaluation
===========================

App for manual evaluation of cortical surfaces automatically reconstructed
using the [MIRTK](https://mirtk.github.io)
[recon-neonatal-cortex](https://github.com/MIRTK/Deformable/blob/add-recon-neonatal-cortex/tools/recon-neonatal-cortex.py)
command.


Package
-------

This application uses NW.js and can be packaged for macOS with the following command:

```
brew install npm appdmg
npm install -g nw-builder
nwbuild -p osx64 app.nw
cp app.nw/app/app.icns build/.../CorticalSurfaceEvaluation.app/Contents/Resources/app.icns
cp app.nw/app/app.icns build/.../CorticalSurfaceEvaluation.app/Contents/Resources/document.icns
cp app.nw/appdmg.json build/.../
cd build/.../
appdmg appdmg.json CorticalSurfaceEvaluation.dmg
```