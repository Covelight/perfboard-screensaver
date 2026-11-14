const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const out = process.argv[3];
  const w = Number(process.argv[4] || 1000), h = Number(process.argv[5] || 1250);
  const dsf = Number(process.argv[6] || 1);
  const b = await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const p = await b.newPage({viewport:{width:w,height:h}, deviceScaleFactor:dsf});
  let nc=0; p.on('console', m => { if(nc++<14) console.log('LOG:', m.text().slice(0,300)); });
  p.on('pageerror', e => console.log('ERR:', String(e).slice(0,400)));
  await p.goto(url, {waitUntil:'load'});
  await p.waitForTimeout(Number(process.argv[7] || 4000));
  const ok = await p.evaluate(()=>!!window.__READY__);
  console.log('ready:', ok);
  // optional: run a JS snippet before the shot, e.g. "setView(1.3,0.05,-0.02)"
  const pre = process.env.PRESHOT;
  if (pre) console.log('pre:', JSON.stringify(await p.evaluate(pre)));
  if (pre) await p.waitForTimeout(1500);
  await p.screenshot({path: out, timeout: 180000});
  await b.close();
})();
