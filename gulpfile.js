// gulpfile.js
const gulp = require('gulp');
const terser = require('gulp-terser');
const rename = require('gulp-rename');
const del = require('del');
const obfuscator = require('javascript-obfuscator');
const cleanCSS = require('gulp-clean-css');
const through = require('through2');
const gulpIf = require('gulp-if');
const path = require('path');

const SRC_JS = 'public/javascripts/**/*.js';
const OUT_DIR = 'public/javascripts';
const SRC_CSS = 'public/stylesheets/**/*.css';

// toggle via env: NODE_ENV=production npm run build:prod
const isProd = process.env.ENVIRONMENT === 'prod';

// 1) Clean old minified/obfuscated files (optional keep originals)
function clean() {
  return del([
    `${OUT_DIR}/**/*.min.js`,
    'public/stylesheets/**/*.min.css'
  ]);
}

// 2) Minify JS with terser
function minifyJs() {
  return gulp.src([SRC_JS, `!${OUT_DIR}/**/*.min.js`]) // skip existing min files
    .pipe(terser({
      ecma: 2020,
      module: true,
      compress: true,
      mangle: true,
    }))
    .pipe(rename({ suffix: '.min' }))
    .pipe(gulp.dest(OUT_DIR));
}

// 3) Obfuscate the generated .min.js files (strong settings)
function obfuscateJs() {
  // Only run in production builds; safe to skip in dev
  if (!isProd) return Promise.resolve();

  return gulp.src(`${OUT_DIR}/**/*.min.js`)
    .pipe(through.obj(function (file, enc, cb) {
      if (file.isBuffer()) {
        const code = file.contents.toString();
        const obf = obfuscator.obfuscate(code, {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.75,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.4,
          stringArray: true,
          stringArrayThreshold: 0.75,
          stringArrayEncoding: ['rc4'],
          disableConsoleOutput: true,
          transformObjectKeys: true,
          renameGlobals: false,
        }).getObfuscatedCode();
        file.contents = Buffer.from(obf);
        // optionally rename further (keeping .min.js)
      }
      cb(null, file);
    }))
    .pipe(gulp.dest(OUT_DIR));
}

// 4) Minify CSS
function minifyCss() {
  return gulp.src([SRC_CSS, '!public/stylesheets/**/*.min.css'])
    .pipe(cleanCSS({ compatibility: 'ie8' }))
    .pipe(rename({ suffix: '.min' }))
    .pipe(gulp.dest('public/stylesheets'));
}

// helper combined tasks
const buildDev = gulp.series(clean, minifyJs, minifyCss);
const buildProd = gulp.series(clean, minifyJs, obfuscateJs, minifyCss);

exports.clean = clean;
exports.minify = minifyJs;
exports.obfuscate = obfuscateJs;
exports.css = minifyCss;
exports.build = isProd ? buildProd : buildDev;
exports['build:prod'] = gulp.series((done) => { process.env.NODE_ENV = 'production'; done(); }, buildProd);
