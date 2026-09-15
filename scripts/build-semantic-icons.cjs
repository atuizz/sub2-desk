// Business-specific icons: solid objects, directional light, inset rims and material depth.
// Existing macOS-equivalent artwork is intentionally left unchanged.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const base = path.resolve(__dirname, '../packages/sub2-console/public/assets');
const gradient = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const icons = {
  dashboard: { colors: ['#d0e8fc','#71a6d3'], defs: gradient('screen','#fdfefe','#dae5f0')+gradient('chart','#5eb8fb','#326cbd'), body: `
    <g filter="url(#object)">
      <rect x="48" y="63" width="160" height="137" rx="20" fill="#5b83aa"/>
      <rect x="48" y="58" width="160" height="137" rx="20" fill="url(#screen)" stroke="#f5fcff" stroke-width="2"/>
      <path d="M49 87h158" stroke="#bbcddd" stroke-width="2"/>
      <circle cx="65" cy="73" r="3" fill="#83a0ba"/><circle cx="76" cy="73" r="3" fill="#abc1d2"/>
      <rect x="63" y="101" width="49" height="33" rx="7" fill="#378cdd"/><path d="M73 112h19M73 122h29" stroke="#d9f3ff" stroke-width="4" stroke-linecap="round"/>
      <rect x="124" y="101" width="68" height="33" rx="7" fill="#d1e2ee"/><path d="m134 124 13-13 12 7 19-10" stroke="#378dbe" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="63" y="144" width="129" height="37" rx="7" fill="#e8f0f5"/>
      <path d="M77 172v-10M97 172v-17M117 172v-11M137 172v-22M157 172v-16M177 172v-27" stroke="url(#chart)" stroke-width="10" stroke-linecap="round"/>
    </g>` },
  security: { colors: ['#f0d6b3','#bf8361'], defs: gradient('auditPaper','#fffdf5','#e3dcd0')+gradient('lensRim','#f6d592','#a76c32'), body: `
    <g filter="url(#object)">
      <rect x="65" y="53" width="117" height="145" rx="12" fill="url(#auditPaper)" stroke="#fffdf7" stroke-width="2"/>
      <path d="M84 77h55M84 94h78M84 111h64M84 128h44M84 147h34M84 166h29" stroke="#b9b2a4" stroke-width="5" stroke-linecap="round"/>
      <path d="m166 166 29 31" stroke="#65472f" stroke-width="18" stroke-linecap="round"/>
      <path d="m167 166 28 29" stroke="#a77545" stroke-width="11" stroke-linecap="round"/>
      <circle cx="145" cy="142" r="38" fill="#537f9a" fill-opacity=".2" stroke="url(#lensRim)" stroke-width="9"/>
      <path d="m145 118 18 7v17c0 12-10 19-18 24-8-5-18-12-18-24v-17Z" fill="#bf6746"/>
      <path d="M145 130v13" stroke="#fff7e7" stroke-width="5" stroke-linecap="round"/><circle cx="145" cy="153" r="2.5" fill="#fff7e7"/>
      <path d="M119 134a28 28 0 0 1 23-20" fill="none" stroke="#fffdf6" stroke-width="3" stroke-linecap="round" opacity=".85"/>
    </g>` },
  accounts: { colors: ['#d8e9f0','#729aad'], defs: gradient('accountCard','#fdfefe','#d5e1ec')+gradient('accountAccent','#5fbbeb','#3779be'), body: `
    <g filter="url(#object)">
      <rect x="91" y="53" width="114" height="132" rx="16" fill="#7392bc" transform="rotate(10 145 120)"/>
      <rect x="72" y="62" width="115" height="131" rx="16" fill="#a5d4df" transform="rotate(4 128 125)"/>
      <rect x="50" y="72" width="119" height="130" rx="16" fill="url(#accountCard)" stroke="#f7fcff" stroke-width="1.5"/>
      <path d="M66 74h87q14 0 14 14v14H52V88q0-14 14-14Z" fill="url(#accountAccent)"/>
      <circle cx="69" cy="88" r="4" fill="#d5f6ff"/><path d="M83 88h51" stroke="#d5f6ff" stroke-width="4" stroke-linecap="round"/>
      <circle cx="91" cy="129" r="13" fill="#7097b6"/><path d="M68 163v-6c0-23 47-23 47 0v6Z" fill="#7097b6"/>
      <path d="M126 120h25M126 133h20M126 147h25M70 182h65" stroke="#afc2d0" stroke-width="5" stroke-linecap="round"/>
      <circle cx="177" cy="182" r="26" fill="#2c91a4" stroke="#b9f0ef" stroke-width="2"/>
      <path d="M166 177h22m-22 10h22M173 173v8M181 183v8" stroke="#edffff" stroke-width="4" stroke-linecap="round"/>
    </g>` },
  groups: { colors: ['#f4f9ff','#c5d9f1'], defs: gradient('folder','#69c9fb','#1477d8'), body: `
    <g filter="url(#object)">
      <path d="M58 79q0-10 10-10h36l12 13h73q10 0 10 10v76H58Z" fill="#478dcc"/>
      <path d="M51 95q0-10 10-10h39l13 13h77q10 0 10 10v70H51Z" fill="#8ad2fa"/>
      <path d="M46 115q0-11 12-11h142q11 0 9 12l-10 68q-2 11-14 11H65q-12 0-13-12Z" fill="url(#folder)"/>
      <path d="M59 105h139" fill="none" stroke="#d8f5ff" stroke-width="2" stroke-opacity=".8"/>
      <g fill="#eefaff"><circle cx="126" cy="140" r="13"/><circle cx="102" cy="141" r="9" opacity=".65"/><circle cx="150" cy="141" r="9" opacity=".65"/><path d="M105 177v-7c0-22 42-22 42 0v7Z"/><path d="M83 173c0-16 15-24 25-14l-7 14zm68 0-7-14c10-10 25-2 25 14Z" opacity=".65"/></g>
    </g>` },
  channels: { colors: ['#f6f8fb','#c5ccd6'], defs: gradient('metal','#edf3fb','#8399af')+gradient('port','#20334a','#071523'), body: `
    <g filter="url(#object)">
      <path d="m49 113 25-32h113l22 32v72H49Z" fill="#8fa6ba"/>
      <path d="m49 113 25-32h113l22 32Z" fill="#e6eef6"/>
      <path d="M68 99h121" stroke="#c1d0de" stroke-width="2"/>
      <rect x="47" y="110" width="164" height="78" rx="13" fill="url(#metal)" stroke="#f4f9ff" stroke-width="1.5"/>
      <rect x="56" y="121" width="146" height="49" rx="8" fill="#53677d"/>
      ${[65,110,155].map(x=>`<path d="M${x} 128h34v29h-8v6h-18v-6h-8Z" fill="url(#port)" stroke="#b6c7d8" stroke-width="1"/>${[8,13,18,23].map(d=>`<path d="M${x+d} 131v8" stroke="#e3c587" stroke-width="2"/>`).join('')}<circle cx="${x+17}" cy="179" r="3" fill="#6fdb91"/>`).join('')}
      <path d="M89 73V54M128 73V48M166 73V54" stroke="#779fbd" stroke-width="5" stroke-linecap="round"/>
      <circle cx="128" cy="47" r="5" fill="#45a9ee"/>
    </g>` },
  plugins: { colors: ['#a4b9ef','#5269ab'], defs: gradient('piece','#fff','#d1def6')+gradient('piece2','#a3e0ff','#3698dc'), body: `
    <g filter="url(#object)">
      <path d="M72 75h40c-10-30 41-30 31 0h37v37c30-10 30 40 0 30v40h-39c10-30-40-30-30 0H72v-41c-30 10-30-40 0-30Z" fill="#526ea4" transform="translate(0 5)"/>
      <path d="M72 72h40c-10-30 41-30 31 0h37v37c30-10 30 40 0 30v40h-39c10-30-40-30-30 0H72v-41c-30 10-30-40 0-30Z" fill="url(#piece)" stroke="#f8fbff" stroke-width="1.5"/>
      <path d="M141 139h39v40h-39c10-30-40-30-30 0v-40c30 10 30-40 0-30h30Z" fill="url(#piece2)" stroke="#b1e5ff" stroke-width="1"/>
      <path d="M81 79h20" stroke="white" stroke-width="3" stroke-linecap="round"/>
    </g>` },
  announcements: { colors: ['#ffc77b','#ed7949'], defs: gradient('horn','#fffef9','#d7dce5')+gradient('grip','#708aa7','#354b66'), body: `
    <g filter="url(#object)" transform="rotate(-13 128 128)">
      <path d="m99 139 12 54q2 8 13 6l9-3q5-2 3-9l-13-51Z" fill="url(#grip)"/>
      <rect x="56" y="103" width="58" height="44" rx="13" fill="#ecf0f7"/>
      <path d="m94 101 75-34v116l-75-34Z" fill="url(#horn)"/>
      <path d="m102 104 59-27v11l-59 23Z" fill="white" opacity=".85"/>
      <ellipse cx="171" cy="125" rx="13" ry="59" fill="#8ea5bd"/>
      <ellipse cx="170" cy="125" rx="9" ry="49" fill="#344d69"/>
      <ellipse cx="168" cy="122" rx="4" ry="35" fill="#182d47"/>
      <path d="M61 116h22" stroke="#bacbdb" stroke-width="4" stroke-linecap="round"/>
    </g>
    <path d="m199 92 12-8m-7 37 14-1m-16 30 12 6" stroke="#fff7df" stroke-width="6" stroke-linecap="round"/>` },
  commerce: { colors: ['#d3e7df','#88b5a4'], defs: gradient('paper','#fffefa','#e1e7e3')+gradient('coin','#86d4a7','#228962'), body: `
    <g filter="url(#object)">
      <path d="M72 55h112v149l-11-7-11 7-11-7-11 7-11-7-11 7-11-7-11 7-11-7-13 7Z" fill="url(#paper)" stroke="#f8fffa" stroke-width="1"/>
      <path d="M88 78h57M88 94h80M88 112h80M88 130h34" stroke="#a6b8ad" stroke-width="6" stroke-linecap="round"/>
      <path d="M88 159h21M88 174h31" stroke="#c4cec7" stroke-width="5" stroke-linecap="round"/>
      <circle cx="166" cy="166" r="38" fill="#267454"/>
      <circle cx="166" cy="163" r="38" fill="url(#coin)" stroke="#b6edd0" stroke-width="2"/>
      <path d="M176 148c-21-11-32 10-10 15s11 24-12 12m12-37v49" stroke="#f1fff5" stroke-width="5" fill="none" stroke-linecap="round"/>
    </g>` },
  network: { colors: ['#53cfdd','#126eac'], defs: gradient('plug','#f9fdff','#bed6e6')+gradient('cable','#c6f8fb','#68cddc'), body: `
    <g filter="url(#object)">
      <path d="M68 70v31q0 25 29 25h61q30 0 30 26v32" stroke="#1b6b98" stroke-width="20" fill="none" stroke-linecap="round" transform="translate(0 3)"/>
      <path d="M68 70v31q0 25 29 25h61q30 0 30 26v32" stroke="url(#cable)" stroke-width="16" fill="none" stroke-linecap="round"/>
      <rect x="50" y="49" width="36" height="46" rx="8" fill="url(#plug)"/><path d="M58 50V39h20v11" fill="#708b9e"/><path d="M61 41v8m6-8v8m6-8v8" stroke="#e1c891" stroke-width="2"/>
      <rect x="170" y="161" width="36" height="46" rx="8" fill="url(#plug)"/><path d="M178 206v11h20v-11" fill="#708b9e"/><path d="M182 209v6m6-6v6m6-6v6" stroke="#e1c891" stroke-width="2"/>
      <circle cx="127" cy="126" r="27" fill="#dcfaf6" stroke="#f4ffff" stroke-width="2"/>
      <path d="m115 126 9 9 17-20" stroke="#27a078" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </g>` },
  subscriptions: { colors: ['#dacffc','#947bc4'], defs: gradient('badge','#fffdf7','#e2dce8')+gradient('gold','#ffe6a2','#c39639'), body: `
    <g filter="url(#object)">
      <rect x="65" y="69" width="126" height="126" rx="15" fill="url(#badge)" stroke="#fff" stroke-width="1.5"/>
      <rect x="65" y="68" width="126" height="27" rx="13" fill="#7c6da1"/>
      <path d="M92 56v25M164 56v25" stroke="#d6deed" stroke-width="9" stroke-linecap="round"/>
      <path d="m116 152-8 42 19-11 18 11-7-42" fill="#9880be"/>
      <circle cx="127" cy="132" r="30" fill="url(#gold)" stroke="#fff0c5" stroke-width="2"/>
      <path d="m127 114 6 12 14 2-10 10 2 14-12-6-13 6 3-14-10-10 14-2Z" fill="#fff9df"/>
    </g>` },
  appstore: { colors: ['#597da3','#203d5f'], defs: gradient('chip','#e6edf5','#849db9')+gradient('die','#5787da','#253f95'), body: `
    <g filter="url(#object)">
      ${[83,105,127,149,171].map(v=>`<path d="M${v} 52v20M${v} 184v20M52 ${v}h20M184 ${v}h20" stroke="#a3b8cc" stroke-width="8" stroke-linecap="round"/>`).join('')}
      <rect x="67" y="67" width="124" height="124" rx="23" fill="#50667c" transform="translate(0 4)"/>
      <rect x="67" y="65" width="124" height="124" rx="23" fill="url(#chip)" stroke="#edf8ff" stroke-width="1.5"/>
      <rect x="83" y="81" width="92" height="92" rx="15" fill="url(#die)" stroke="#5b78ab" stroke-width="2"/>
      <path d="m129 100-22 38h44Zm0 0v49" fill="none" stroke="#c1d6ff" stroke-width="5" stroke-linejoin="round"/>
      <circle cx="129" cy="102" r="10" fill="#94eff0"/><circle cx="108" cy="138" r="10" fill="#e2c4ff"/><circle cx="151" cy="138" r="10" fill="#ffd290"/>
      <path d="M92 88h32" stroke="#a3c3ff" stroke-width="2" stroke-linecap="round" opacity=".65"/>
    </g>` },
};
function svg(item) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256"><defs>${gradient('tile',...item.colors)}${item.defs}<linearGradient id="rim" x2="0" y2="1"><stop stop-color="white" stop-opacity=".75"/><stop offset=".45" stop-color="white" stop-opacity=".12"/><stop offset="1" stop-color="#183044" stop-opacity=".25"/></linearGradient><filter id="drop" x="-.2" y="-.2" width="1.4" height="1.5"><feDropShadow dy="3" stdDeviation="2" flood-color="#12273e" flood-opacity=".3"/></filter><filter id="object" x="-.3" y="-.3" width="1.6" height="1.7"><feDropShadow dy="3" stdDeviation="2.5" flood-color="#19324e" flood-opacity=".25"/></filter></defs><rect x="23" y="23" width="210" height="210" rx="48" fill="url(#tile)" filter="url(#drop)"/><rect x="24" y="24" width="208" height="208" rx="47" fill="none" stroke="url(#rim)" stroke-width="2"/>${item.body}</svg>`;
}
async function main() {
  await fs.mkdir(path.join(base,'semantic'),{recursive:true});
  for(const [id,item] of Object.entries(icons)) {
    if (process.argv.length > 3 && !process.argv.slice(3).includes(id)) continue;
    const source=svg(item);
    await fs.writeFile(path.join(base,'semantic',id+'.svg'),source);
    await sharp(Buffer.from(source)).resize(256,256).png().toFile(path.join(base,'app-icons',id+'.png'));
    console.log(id);
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
