const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(__dirname, '..');
const images = [
  ['glass-dawn', '暖金晨光', 'D:/Users/Administrator/Downloads/ChatGPT Image 2026年9月12日 02_16_25.png', false],
  ['glass-midnight', '午夜蓝玻璃', 'D:/Users/Administrator/Downloads/ChatGPT Image 2026年9月12日 02_16_17.png', false],
  ['glass-lake', '冰蓝湖光', 'D:/Users/Administrator/Downloads/ChatGPT Image 2026年9月12日 02_16_07.png', false],
  ['tahoe-hd', 'Tahoe · 浅色 4K', 'output/wallpapers/sources/26-Tahoe-Light-6K.png', true],
  ['tahoe-dark-hd', 'Tahoe · 深色 4K', 'output/wallpapers/sources/26-Tahoe-Dark-6K.png', true],
  ['tahoe-beach-hd', 'Tahoe · 湖畔 4K', 'output/wallpapers/sources/26-Tahoe-Beach-Day.png', true],
];
(async () => {
  const report=[];
  for (const [id,name,input,thirdParty] of images) {
    const source=path.resolve(root,input), meta=await sharp(source).metadata();
    if(thirdParty && (meta.width<3840 || meta.height<2160)) throw Error('Source is not 4K: '+source);
    for(const profile of thirdParty?['public']:['public','public-release']) {
      const dir=path.join(root,'packages/sub2-console',profile,'assets');
      fs.mkdirSync(path.join(dir,'wallpaper-thumbs'),{recursive:true});
      let image=sharp(source).rotate();
      if(thirdParty) image=image.resize(3840,2160,{fit:'cover'});
      await image.jpeg({quality:94,mozjpeg:true,chromaSubsampling:'4:4:4'}).toFile(path.join(dir,id+'.jpg'));
      await sharp(source).resize(480,270,{fit:'cover'}).jpeg({quality:82,mozjpeg:true}).toFile(path.join(dir,'wallpaper-thumbs',id+'.jpg'));
    }
    const output=path.join(root,'packages/sub2-console/public/assets',id+'.jpg');
    const result=await sharp(output).metadata();
    report.push({id,name,sourceWidth:meta.width,sourceHeight:meta.height,width:result.width,height:result.height,bytes:fs.statSync(output).size,thirdParty,source:thirdParty?'https://media.512pixels.net/downloads/macos-wallpapers-6k/'+path.basename(source):'User supplied ChatGPT image'});
  }
  fs.writeFileSync(path.join(root,'output/wallpapers/manifest.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
