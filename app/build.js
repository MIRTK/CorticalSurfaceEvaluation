var path = require('path');
var NwBuilder = require('nw-builder');

var platforms = process.argv.slice(2);
if (platforms.length === 0) {
  if (process.platform === 'darwin') {
    platforms.push('osx64');
  } else if (process.platform === 'linux') {
    platforms.push('linux64');
  } else if (process.platform === 'win32') {
    platforms.push('win64');
  }
}

var files = [
  'package.json',
  'index.html',
  'app.css',
  'app.js',
  'compare-contours.png',
  'evaluate-accuracy.png',
  'node_modules/jquery/**',
  'node_modules/bootstrap/**',
  'node_modules/tether/**',
  'node_modules/nan/**',
  'node_modules/sqlite3/**'
];

for (var i = 0; i < files.length; i++) {
  files[i] = path.join(__dirname, files[i]);
}

var nw = new NwBuilder({
  files: files,
  platforms: platforms,
  version: '0.19.1',
  flavor: 'normal',
  buildDir: __dirname,
  cacheDir: path.join(__dirname, 'build', 'cache'),
  buildType: function () { return 'build'; },
  macIcns: path.join(__dirname, 'app.icns'),
  winIco: path.join(__dirname, 'app.ico'),
  downloadUrl: 'https://dl.nwjs.io/'
});

// .build() returns a promise but also supports a plain callback approach as well
nw.build().then(function () {
  console.log("Done building standalone NW.js application");
}).catch(function (error) {
  console.error(error);
});

