// Original geometric artwork for the redistributable build. No external image inputs.
// Generated files are committed; regeneration is optional: node scripts/generate-release-art.cjs [path-to-sharp]
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
// Historical alternate artwork only. Never overwrite the approved release theme.
const output = path.resolve(__dirname, '../output/artwork-experiments/assets');
const shapes = {
  finder: '<path d="M66 96V78h43l15 18h66v83H66z"/><path d="M66 110h124"/>',
  launchpad: '<rect x="68" y="68" width="46" height="46" rx="12"/><rect x="140" y="68" width="46" height="46" rx="12"/><rect x="68" y="140" width="46" height="46" rx="12"/><rect x="140" y="140" width="46" height="46" rx="12"/>',
  dashboard: '<path d="M68 166a72 72 0 1 1 120 0M128 68v16M75 102l14 8M181 102l-14 8M128 139l37-39"/><circle cx="128" cy="139" r="9"/>',
  ops: '<path d="M57 132h29l19-49 27 93 21-65 15 21h30"/>',
  users: '<circle cx="114" cy="102" r="24"/><path d="M63 183v-16a51 43 0 0 1 102 0v16M166 81a23 23 0 0 1 0 45M185 151q18 8 18 32"/>',
  groups: '<path d="m128 66 68 34-68 34-68-34zM65 131l63 32 63-32M65 159l63 32 63-32"/>',
  channels: '<circle cx="77" cy="87" r="20"/><circle cx="179" cy="87" r="20"/><circle cx="128" cy="180" r="20"/><path d="M94 100l24 59M162 100l-24 59M98 87h60"/>',
  admin_subscriptions: '<rect x="68" y="75" width="120" height="115" rx="17"/><path d="M68 112h120M94 63v26M162 63v26M94 144h17M144 144h17M94 167h17"/>',
  accounts: '<rect x="68" y="77" width="120" height="107" rx="20"/><circle cx="112" cy="119" r="19"/><path d="m125 133 27 26M144 151l11-11M154 160l11-11"/>',
  plugins: '<path d="M83 105V77h40c-4-30 32-30 28 0h27v40c30-4 30 32 0 28v34h-44c4 30-32 30-28 0H78v-42c-30 4-30-32 0-28z"/>',
  announcements: '<path d="m65 113 113-36v102L65 143zM85 150l12 36h26l-12-43M195 99l13-8M198 127h14M195 155l13 8"/>',
  proxies: '<circle cx="128" cy="128" r="64"/><ellipse cx="128" cy="128" rx="29" ry="64"/><path d="M66 112h124M66 145h124"/>',
  security: '<path d="m128 61 58 23v51c0 27-26 49-58 65-32-16-58-38-58-65V84zM99 131l20 21 39-46"/>',
  commerce: '<path d="M70 68v119h124M93 162v-27M128 162v-48M163 162V89"/>',
  keychain: '<circle cx="99" cy="102" r="32"/><path d="m122 125 59 59M152 153l17-17M168 170l17-17"/><circle cx="90" cy="93" r="5" fill="white" stroke="none"/>',
  safari: '<circle cx="128" cy="128" r="66"/><path d="m148 103-9 39-33 16 10-40zM128 70v10M128 176v10M70 128h10M176 128h10"/>',
  activity: '<rect x="78" y="65" width="102" height="128" rx="12"/><path d="M101 99h56M101 129h56M101 159h34"/>',
  network: '<path d="M60 102a96 96 0 0 1 136 0M83 127a64 64 0 0 1 90 0M106 151a32 32 0 0 1 44 0"/><circle cx="128" cy="177" r="7" fill="white" stroke="none"/>',
  subscriptions: '<rect x="64" y="84" width="128" height="94" rx="18"/><path d="M65 110h126m-100 38 13 12 23-26M145 141h24M145 159h16"/>',
  wallet: '<path d="M72 94V78h105v21M70 99h118v84H70z"/><path d="M188 128h-37v31h37"/><circle cx="164" cy="143" r="3" fill="white"/>',
  voucher: '<path d="M66 90h124v29a18 18 0 0 0 0 36v22H66v-22a18 18 0 0 0 0-36zM149 103v60" stroke-dasharray="none"/><path d="m91 119 29 29M92 149l27-30"/>',
  appstore: '<path d="m128 62 63 37v65l-63 35-63-35V99zM65 99l63 35 63-35M128 134v65M96 81l63 36v29"/>',
  terminal: '<rect x="58" y="73" width="140" height="111" rx="18"/><path d="m85 105 26 24-26 24M128 154h37"/>',
  settings: '<circle cx="128" cy="128" r="42"/><circle cx="128" cy="128" r="17"/><path d="M128 58v28M128 170v28M58 128h28M170 128h28M79 79l19 19M158 158l19 19M79 177l19-19M158 98l19-19"/>',
};
const colors = ['#368de0','#dd975d','#4b73d1','#42a9a1','#477dcc','#ab7298','#6b83ae','#d27a64','#aa8246','#7774b5','#cb8265','#438ea2','#5380bb','#5d9e83','#ce9d47','#4983b6','#a99975','#5795b2','#9479b5','#b27d61','#c5857c','#6a9b92','#4e617d','#7e8b9c'];
function icon(id, index) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="tile" x2=".25" y2="1"><stop stop-color="${colors[index % colors.length]}"/><stop offset="1" stop-color="#182e4b"/></linearGradient><linearGradient id="shine" x2="0" y2="1"><stop stop-color="white" stop-opacity=".22"/><stop offset=".65" stop-color="white" stop-opacity="0"/></linearGradient><filter id="shadow" x="-.2" y="-.2" width="1.4" height="1.5"><feDropShadow dy="5" stdDeviation="5" flood-color="#17263b" flood-opacity=".24"/></filter></defs><rect x="23" y="23" width="210" height="210" rx="49" fill="url(#tile)" filter="url(#shadow)"/><rect x="24" y="24" width="208" height="208" rx="48" fill="url(#shine)" stroke="white" stroke-opacity=".28"/><g fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round" stroke-linecap="round">${shapes[id] || shapes.appstore}</g></svg>`;
}
const aliases = { 'activity':'ops','apps':'launchpad','calendar':'admin_subscriptions','keychain':'accounts','passwords':'keychain','developer':'plugins','reminders':'announcements','numbers':'commerce','notes':'activity','shortcuts':'groups','avatar':'users','accounts':'accounts','finder':'finder','wallet':'wallet','voucher':'voucher','appstore':'appstore','settings':'settings','terminal':'terminal','safari':'safari','network':'network','proxies':'proxies','users':'users','security':'security','dashboard':'dashboard','launchpad':'launchpad','subscriptions':'subscriptions' };
async function main() {
  await fs.mkdir(path.join(output,'app-icons'), {recursive:true});
  const ids=Object.keys(shapes);
  for (const [i,id] of ids.entries()) {
    const svg=icon(id,i);
    await fs.writeFile(path.join(output,'app-icons',id+'.svg'),svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(output,'app-icons',id+'.png'));
  }
  for (const [alias,id] of Object.entries(aliases)) {
    const svg=icon(id,ids.indexOf(id));
    await fs.writeFile(path.join(output,alias+'.svg'),svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(output,alias+'.png'));
  }
  const palettes={tahoe:['#c4def0','#6b9fbf','#395f8b'], 'tahoe-night':['#0a192f','#1e4964','#253c65'], sequoia:['#d1e1d5','#689c8c','#2b5963'], sonoma:['#e5d6e3','#a184b4','#5c5a89'], monterey:['#e2d8e6','#9086b8','#536994'], ventura:['#efdfd1','#d89d83','#805776'], galaxy:['#141c37','#454973','#665684'], 'monaco-f1':['#e3d5cd','#b48772','#6b6171']};
  for (const [id,c] of Object.entries(palettes)) {
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1600" viewBox="0 0 2560 1600"><defs><linearGradient id="sky" x2=".3" y2="1"><stop stop-color="${c[0]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient><linearGradient id="flow" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="55"/></filter></defs><rect width="2560" height="1600" fill="url(#sky)"/><ellipse cx="690" cy="230" rx="900" ry="580" fill="${c[0]}" opacity=".5" filter="url(#blur)"/><path d="M-100 1260C590 1650 850 350 1590 660s750 650 1100 300v800H-100Z" fill="url(#flow)"/><path d="M-100 1360C730 1610 920 570 1530 750s1000 470 1190 220" fill="none" stroke="${c[0]}" stroke-width="2" opacity=".4"/><path d="M-100 1510C760 1610 1030 870 1630 910s750 290 1110 200v550H-100Z" fill="${c[2]}" opacity=".48"/><path d="M-100 1470C790 1690 1040 810 1640 850s870 410 1100 230" fill="none" stroke="${c[0]}" stroke-width="1.5" opacity=".28"/></svg>`;
    await fs.writeFile(path.join(output,id+'.svg'),svg);
    await sharp(Buffer.from(svg)).jpeg({quality:90}).toFile(path.join(output,id+'.jpg'));
  }
  await fs.writeFile(path.join(output,'ARTWORK.md'),'# Sub2-Mac original release artwork\n\nGenerated from scripts/generate-release-art.cjs; no downloaded images, Apple logos, fonts or external image inputs. Geometric symbols and layered landscapes authored for this project. Source SVG and PNG/JPEG derivatives are provided under the project license.\n');
  console.log('Generated 24 application icons, compatibility aliases, and 8 original wallpapers.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
