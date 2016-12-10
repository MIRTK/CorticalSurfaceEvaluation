var NwBuilder = require('nw-builder');
var nw = new NwBuilder({
  files: './app.nw/**',
  platforms: ['osx64', 'linux64'],  // ['osx64', 'win64', 'linux64'],
  version: 'latest',
  flavor: 'normal',
  buildType: function () { return 'release'; },
  macIcns: './app.nw/app.icns',
  winIco: './app.nw/app.ico'
});

// .build() returns a promise but also supports a plain callback approach as well
nw.build().then(function () {
  console.log('all done!');
}).catch(function (error) {
  console.error(error);
});
