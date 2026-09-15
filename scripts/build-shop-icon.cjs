// Original Sub2-Mac storefront artwork. No downloaded art, fonts or embedded bitmaps.
// Run: node scripts/build-shop-icon.cjs [path-to-sharp]
// Writes only card_shop assets in public/public-release and output/shop-icon-final.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'output/shop-icon-final');
const gradient = (id, stops, extra = 'x1="0" y1="0" x2="0.25" y2="1"') =>
  `<linearGradient id="${id}" ${extra}>${stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('')}</linearGradient>`;
const defs = `
  ${gradient('porcelain', [[0,'#fffef7'],[.45,'#eee9da'],[1,'#c6cabb']])}
  ${gradient('side', [[0,'#bfc7bc'],[1,'#879f94']])}
  ${gradient('trim', [[0,'#fffef4'],[.42,'#eae6d5'],[.7,'#b8b9a7'],[1,'#fcf9ed']])}
  ${gradient('roof', [[0,'#ffb2a0'],[.12,'#f78774'],[.48,'#e76551'],[1,'#a63831']])}
  ${gradient('coral', [[0,'#ef8d78'],[.25,'#ffb9a0'],[.72,'#f47961'],[1,'#c64d41']])}
  ${gradient('linen', [[0,'#e5d4b8'],[.25,'#fffbe8'],[.74,'#fff2d3'],[1,'#d7bda0']])}
  ${gradient('coralHem', [[0,'#ec8068'],[.38,'#ed7c66'],[1,'#b8463d']])}
  ${gradient('linenHem', [[0,'#fff4dc'],[.42,'#f7e8cc'],[1,'#c5af91']])}
  ${gradient('frame', [[0,'#5c9d97'],[.5,'#31716e'],[1,'#194d4e']])}
  ${gradient('glass', [[0,'#c5f3eb'],[.28,'#7acbc5'],[.62,'#499e9e'],[1,'#20656e']])}
  ${gradient('doorGlass', [[0,'#8bd4ce'],[.5,'#3d9292'],[1,'#174e59']])}
  ${gradient('stone', [[0,'#f9f6e9'],[.25,'#f1eddf'],[.3,'#b5b6a9'],[1,'#8e9e94']])}
  ${gradient('brass', [[0,'#fff5c6'],[.28,'#ead596'],[.6,'#b18b46'],[.8,'#f6dfa0'],[1,'#a7864c']], 'x1="0" y1="0" x2="1" y2=".25"')}
  <linearGradient id="reflection" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".66"/><stop offset="1" stop-color="#e5fffa" stop-opacity="0"/></linearGradient>
  <filter id="shadow" x="-25%" y="-25%" width="150%" height="160%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="3" stdDeviation="2.6" flood-color="#223b34" flood-opacity=".26"/></filter>
  <filter id="canopyShadow" x="-20%" y="-30%" width="140%" height="190%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#5a2920" flood-opacity=".32"/></filter>
  <clipPath id="awning"><path d="M45 58Q46 53 52 53H204Q210 53 212 59L233 102H23Z"/></clipPath>
  <clipPath id="window"><rect x="51" y="132" width="87" height="62" rx="3"/></clipPath>
  <clipPath id="door"><rect x="158" y="132" width="35" height="75" rx="2"/></clipPath>
`;
const stripes = Array.from({ length: 7 }, (_, i) => {
  const top = 45 + i * 166 / 7, bottom = 23 + i * 30;
  const color = i % 2 ? 'linen' : 'coral';
  return `<path d="M${top} 53H${top+166/7}L${bottom+30} 103H${bottom}Z" fill="url(#${color})"/>
    <path d="M${bottom} 102h30v10c0 17-30 17-30 0Z" fill="url(#${color}Hem)"/>
    <path d="M${bottom+2} 113c2 10 24 10 26 0" fill="none" stroke="${i%2?'#fff7e3':'#ffc6ac'}" stroke-opacity=".45" stroke-width=".8"/>`;
}).join('');
const body = `
  <g filter="url(#shadow)">
    <!-- Porcelain facade with a visible right edge and inset glass, not a tile. -->
    <path d="M46 78H205q9 0 9 10v131H46Z" fill="url(#side)"/>
    <rect x="35" y="79" width="173" height="140" rx="8" fill="url(#porcelain)" stroke="#fffced" stroke-width="1.3"/>
    <path d="M206 91v125" stroke="#889b8f" stroke-width="2" opacity=".55"/>
    <rect x="43" y="124" width="103" height="78" rx="6" fill="#fdf9e9"/>
    <rect x="47" y="128" width="95" height="70" rx="4" fill="url(#frame)"/>
    <rect x="51" y="132" width="87" height="62" rx="3" fill="url(#glass)"/>
    <g clip-path="url(#window)">
      <path d="M38 178 83 132h37l-71 71Z" fill="url(#reflection)"/>
      <path d="m79 198 58-66h9l-60 66Z" fill="#d8fff4" opacity=".18"/>
      <path d="M51 182c20-5 47-5 87 1v11H51Z" fill="#164e51" opacity=".28"/>
      <!-- Small parcels behind the glass; the canopy remains the primary silhouette. -->
      <rect x="63" y="177" width="22" height="17" rx="2" fill="#efc493"/>
      <path d="M74 177v17" stroke="#fae2b8" stroke-width="3"/>
      <rect x="101" y="170" width="23" height="24" rx="2" fill="#f8e5c1"/>
      <path d="M111 170v24" stroke="#d8b384" stroke-width="3"/>
      <path d="M52 134h84" stroke="#e3fff7" stroke-opacity=".6"/>
    </g>
    <path d="M94 130v65" stroke="#276765" stroke-width="3"/>
    <path d="M95.2 131v63" stroke="#b8e2d5" stroke-width=".8" opacity=".7"/>
    <rect x="43" y="198" width="102" height="6" rx="2" fill="url(#trim)"/>
    <rect x="151" y="125" width="49" height="90" rx="5" fill="#fffced"/>
    <rect x="154" y="128" width="43" height="87" rx="3" fill="url(#frame)"/>
    <rect x="158" y="132" width="35" height="75" rx="2" fill="url(#doorGlass)"/>
    <g clip-path="url(#door)"><path d="m150 178 44-47h13l-54 65Z" fill="url(#reflection)"/><path d="M159 134h33" stroke="#cffff0" stroke-opacity=".55"/></g>
    <path d="M157 208h37v6h-37Z" fill="#3c7370"/>
    <path d="M161 212h29" stroke="#93b4a6" stroke-width="1"/>
    <rect x="181" y="174" width="5" height="19" rx="2.5" fill="#1c5353" opacity=".55"/>
    <rect x="180" y="172" width="4" height="18" rx="2" fill="url(#brass)"/>
    <path d="M181 175v12" stroke="#fff3c4" stroke-width=".8"/>
    <!-- Enamel roof cap, bevel highlights and projecting fabric canopy. -->
    <rect x="43" y="38" width="170" height="28" rx="10" fill="url(#roof)"/>
    <path d="M47 48q0-7 8-7h146q7 0 8 7" fill="none" stroke="#ffd5bd" stroke-width="1.6" stroke-opacity=".85"/>
    <path d="M47 62h161" stroke="#9d3e36" stroke-opacity=".45" stroke-width="2"/>
    <g filter="url(#canopyShadow)">
      <path d="M23 102h210l-21-44q-2-5-8-5H52q-6 0-7 5Z" fill="url(#coral)"/>
      ${stripes}
      <path d="M46 56h164" stroke="#ffe1c6" stroke-opacity=".65" stroke-width="1.2"/>
      <path d="M25 102h206" stroke="#fff1d6" stroke-opacity=".5" stroke-width="1"/>
    </g>
    <path d="M35 218h173l10 4H26Z" fill="#fffbea"/>
    <rect x="25" y="222" width="194" height="9" rx="3" fill="url(#stone)"/>
    <path d="M30 223h184" stroke="#fffcf2" stroke-width="1"/>
  </g>
`;
const svg = transform => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256"><title>小铺</title><desc>珊瑚红条纹雨棚、瓷白店面、青色玻璃橱窗与黄铜门把手。</desc><defs>${defs}</defs><g transform="${transform}">${body}</g></svg>`;
async function alphaBounds(buffer, threshold = 32) {
  const {data,info} = await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width, top=info.height, right=-1, bottom=-1, edgeMax=0;
  for(let y=0;y<info.height;y++) for(let x=0;x<info.width;x++) {
    const a=data[(y*info.width+x)*4+3];
    if(x===0||y===0||x===info.width-1||y===info.height-1) edgeMax=Math.max(edgeMax,a);
    if(a>=threshold) {left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  return {left,top,right,bottom,width:right-left+1,height:bottom-top+1,edgeMax};
}
async function main() {
  await fs.mkdir(evidence,{recursive:true});
  const rawBounds = await alphaBounds(Buffer.from(svg('translate(0 0)')));
  const scale = 840/Math.max(rawBounds.width,rawBounds.height);
  const tx = 128-((rawBounds.left+rawBounds.right+1)/8)*scale;
  const ty = 128-((rawBounds.top+rawBounds.bottom+1)/8)*scale;
  const source = Buffer.from(svg(`translate(${tx.toFixed(6)} ${ty.toFixed(6)}) scale(${scale.toFixed(6)})`));
  const hd = await sharp(source).toColourspace('srgb').png({compressionLevel:9}).toBuffer();
  const standard = await sharp(hd).resize(256,256,{kernel:'lanczos3'}).png({compressionLevel:9}).toBuffer();
  const files = {'semantic/card_shop.svg':source,'app-icons/card_shop.png':standard,'app-icons/card_shop-1024.png':hd};
  const assets=[];
  for(const dir of ['public','public-release']) for(const [file,buffer] of Object.entries(files)) {
    const target=path.join(root,'packages/sub2-console',dir,'assets',file);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,buffer);
    const metadata=await sharp(buffer).metadata(),bounds=await alphaBounds(buffer);
    assets.push({file:path.relative(root,target).replaceAll('\\','/'),bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),width:metadata.width,height:metadata.height,space:metadata.space,channels:metadata.channels,bounds});
  }
  // Visual evidence uses actual 1x display sizes on both backgrounds and a 512px detail.
  const composites=[];
  for(const [row,color] of ['#f2f3f5','#202329'].entries()) {
    composites.push({input:await sharp({create:{width:1040,height:330,channels:4,background:color}}).png().toBuffer(),left:0,top:row*330});
    let x=34;
    for(const size of [16,32,64,128,256]) {
      composites.push({input:await sharp(standard).resize(size,size).png().toBuffer(),left:x,top:row*330+36+Math.round((256-size)/2)});
      composites.push({input:Buffer.from(`<svg width="290" height="24"><text x="0" y="17" font-family="Arial,sans-serif" font-size="13" fill="${row?'#d8dde4':'#58606b'}">${size} px</text></svg>`),left:x,top:row*330+298});
      x+=size+50;
    }
  }
  await sharp({create:{width:1040,height:660,channels:4,background:'#f2f3f5'}}).composite(composites).png().toFile(path.join(evidence,'shop-sizes-light-dark.png'));
  await sharp(hd).resize(512,512).flatten({background:'#e9edee'}).png().toFile(path.join(evidence,'shop-detail.png'));
  const report={originalArtwork:true,alphaThreshold:32,targetVisibleExtent:210,assets};
  for(const asset of assets) {
    if(asset.bounds.edgeMax!==0) throw Error(`Clipped alpha: ${asset.file}`);
    const target=asset.width*210/256;
    if(Math.abs(Math.max(asset.bounds.width,asset.bounds.height)-target)>2) throw Error(`Optical size: ${asset.file}`);
  }
  await fs.writeFile(path.join(evidence,'assets.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
