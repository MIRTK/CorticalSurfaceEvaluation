Cortical Surface Evaluation
===========================

App for the manual evaluation of surfaces reconstructed using the [MIRTK](https://mirtk.github.io)
[recon-neonatal-cortex](https://github.com/MIRTK/Deformable/blob/add-recon-neonatal-cortex/tools/recon-neonatal-cortex.py)
command.

The `tools` subdirectory contains utility scripts for the import of the data files from the
dHCP project, the execution of the surface reconstruction, and the preparation of the SQLite
database including a script to take screenshots that are presented by the graphical App to
the expert for manual scoring and comparison to the reference method.


## Import dHCP data

To import data files from the dHCP project, use the `bin/import` command and provide either a
CSV file with columns "SubjectId,SessionId" for each subject session data files to be imported,
or list individual sessions as "SubjectId-SessionId", e.g., "CC00050XX01-7201".


## Run surface reconstruction

To run the MIRTK surface reconstruction, use the `bin/recon` command and provide either a
CSV file with columns "SubjectId,SessionId" for each subject session for which to run the
cortical surface reconstruction, or list individual sessions as "SubjectId-SessionId",
e.g., "CC00050XX01-7201".


## Create SQLite database

With all data files available in the `images`, `meshes`, and `labels` subdirectories,
the SQLite database file with corresponding offline rendered slices of automatically
determined ROIs saved to PNG image files can be created using the `bin/eval-db` command.
This command executes the following steps:

- `init`: Write new SQLite database file and create tables if database file missing.
- `select-rois`: Select ROIs and best orthogonal viewing directions if none found in database.
- `take-screenshots`: Save screenshots of selected ROIs to PNG image files if files and/or database entry missing.
- `add`: Perform all of the above steps.

To add the information of an expert rater, i.e., email address and "password" (stored plain text!),
use the `tools/add-rater.py` script.


## Build NW.js App

### Install Node.js

#### Ubuntu

This application was developed with [Node.js](https://nodejs.org/en/) 7.2. Earlier versions may work as well,
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

This application was developed with [NW.js](https://nwjs.io/) 0.19.0.

```
npm install -g nw nw-gyp
```

### Dependencies

Required dependencies are
- [jQuery](https://jquery.com/)
- [Tether](http://tether.io/) (required by Bootstrap 4)
- [Bootstrap 4](https://v4-alpha.getbootstrap.com/)
- [node-sqlite3](https://github.com/mapbox/node-sqlite3)

You can install these easily with the following [npm](https://www.npmjs.com/) commands:
```
cd app
npm install jquery tether bootstrap@4.0.0-alpha.5

## https://www.npmjs.com/package/sqlite3#building-for-node-webkit
NODE_WEBKIT_VERSION=0.19.0 # see latest version at https://github.com/rogerwang/node-webkit#downloads
npm install sqlite3 --build-from-source --runtime=node-webkit --target_arch=x64 --target=$NODE_WEBKIT_VERSION
```

### Build package

An App release package can be build using nw-builder. Additionally, `appdmg` is used
to create a .dmg file for macOS users. These build dependencies can be installed
with the following npm commands:
```
npm install -g nw-builder
npm install -g appdmg
```

To create a tar archive for Linux users, run:
```
./bin/build-app linux64
```

To create a dmg file for macOS users, run:
```
./bin/build-app osx64
```

When no platform argument is given, the release package for the host platform is build.


## Evaluate cortical surfaces

Finally, run the evaluation App and open the database file to perform the manual evaluation
of the cortical surface reconstruction results. The assigned scores and comparison choices
are stored in the SQLite database for consecutive analysis. Figures to visualize the results
can be created using the `tools/plot-results.py` script.