const {Resvg}=require('@resvg/resvg-js');const fs=require('fs');
const svg=fs.readFileSync(process.argv[2]);
const r=new Resvg(svg,{fitTo:{mode:'width',value:Number(process.argv[4]||900)}});
fs.writeFileSync(process.argv[3], r.render().asPng());
console.log('ok', process.argv[3]);
