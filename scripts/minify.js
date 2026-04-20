const { minify } = require('terser');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../public/javascripts');
const outDir = path.join(__dirname, '../public/dist/javascripts');

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

(async () => {
    let ok = 0, fail = 0;
    for (const file of files) {
        const src = fs.readFileSync(path.join(srcDir, file), 'utf8');
        const result = await minify(src, { compress: true, mangle: true });
        if (result.error) {
            console.error(`FAIL: ${file} — ${result.error}`);
            fail++;
        } else {
            fs.writeFileSync(path.join(outDir, file), result.code);
            console.log(`OK: ${file}`);
            ok++;
        }
    }
    console.log(`\nDone: ${ok} minified, ${fail} failed`);
})();
