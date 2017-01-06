var path = require('path');
var NwBuilder = require('nw-builder');

var args = process.argv.slice(2);
if (args.length === 0) {
  if (process.platform === 'darwin') {
    args.push('osx64');
  } else if (process.platform === 'linux') {
    args.push('linux64');
  } else if (process.platform === 'win32') {
    args.push('win64');
  }
}

var nw = new NwBuilder({
  files: path.join(__dirname, '**'),
  platforms: args,
  version: '0.19.1',
  flavor: 'normal',
  buildType: function () { return 'release'; },
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

