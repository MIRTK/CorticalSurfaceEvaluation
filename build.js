var NwBuilder = require('nw-builder');

var args = process.argv.slice(2);
if (args.length === 0) {
  args.push('osx64');
  args.push('linux64');
  args.push('win64');
}

var nw = new NwBuilder({
  files: './app.nw/**',
  platforms: args,  // ['osx64', 'win64', 'linux64'],
  version: 'latest',
  flavor: 'normal',
  buildType: function () { return 'release'; },
  macIcns: './app.nw/app.icns',
  winIco: './app.nw/app.ico'
});

// .build() returns a promise but also supports a plain callback approach as well
nw.build().then(function () {
  console.log("Done building standalone NW.js application");
}).catch(function (error) {
  console.error(error);
});

