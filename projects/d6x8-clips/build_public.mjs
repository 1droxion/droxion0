import {readFileSync, writeFileSync, mkdirSync, rmSync, cpSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'public-dist');
rmSync(output, {recursive:true, force:true});
mkdirSync(output, {recursive:true});
cpSync(join(root, 'static'), join(output, 'static'), {recursive:true});
const studio = [
'<section id="studio" class="studio public-studio" aria-labelledby="beta-heading">',
'<div class="public-beta-card">',
'<div class="beta-brow">DroxionClips · Early access</div>',
'<h2 id="beta-heading">Turn your gameplay into five highlight clips.</h2>',
'<p>Try the Windows creator studio: turn recordings into five vertical MP4 highlight candidates, apply styles, and add your own captions. The cloud clipping service is not available yet.</p>',
'<div class="beta-buttons">',
'<a class="cta" href="https://droxionclips-editor-beta.onrender.com/" target="_blank" rel="noopener noreferrer">Open Online Editor (Private Beta) ↗</a>',
'<a class="beta-secondary" href="https://github.com/1droxion/droxion0/archive/refs/heads/main.zip" target="_blank" rel="noopener noreferrer">Download Windows beta ↗</a>',
'</div>',
'<p class="beta-note">The online editor is a private password-protected beta for testing your own footage (up to 120 MB and 10 minutes). Choose captions and styles, then select any of five clips. YouTube watch links require your original recording. No payments are collected.</p>',
'</div></section>'
].join('');
const obs = [
'<section id="obs" class="public-obs" aria-labelledby="obs-public-title">',
'<h2 id="obs-public-title">Clips for your own OBS recordings.</h2>',
'<p>Use OBS Replay Buffer or short recording segments. The Windows version can watch your local recordings folder for newly finished files and generate highlights.</p>',
'<p>YouTube video and live links can label footage you own, but do not automatically download videos or live streams. Supply the original recording for clipping.</p>',
'<a class="beta-secondary" href="#studio">Try Windows beta ↗</a>',
'</section>'
].join('');
let html = readFileSync(join(root,'index.html'),'utf8');
const targetStudio = /<section id="studio"[\s\S]*?<\/section>/;
const targetOBS = /<section id="obs"[\s\S]*?<\/section>/;
if (!targetStudio.test(html) || !targetOBS.test(html)) throw Error('Public build anchors missing');
html = html.replace(targetStudio, studio).replace(targetOBS, obs)
.replace('<script src="/static/studio.js" defer></script>', '<script src="/static/public.js" defer></script>')
.replace('Five 9:16 exports, five styles and manual captions are available in the local studio today.', 'The Windows version includes highlight exports, styles and manual captions.')
.replace('Proposed plan · checkout closed', 'Planned only · payments not enabled')
.replace('© DroxionClips · Local creator studio', '© DroxionClips · Public early-access page · Clip processing is local')
.replace('</head>', [
'<style>',
'.public-studio,.public-obs{color:#fff}',
'.public-beta-card{display:flex;flex-direction:column;gap:16px;padding:clamp(20px,4vw,42px);border:1px solid #d4ff00;border-radius:18px;background:linear-gradient(110deg,#180e23,#1a1820 60%,#171b0a)}',
'.public-beta-card h2{font-size:clamp(26px,3vw,40px);line-height:1.12;margin:0;max-width:700px}',
'.public-beta-card p,.public-obs p{line-height:1.55;max-width:760px;color:#e4dce7;margin:0}',
'.beta-brow{font-size:12px;letter-spacing:.2em;text-transform:uppercase;font-weight:900;color:#d4ff00}',
'.beta-buttons{display:flex;gap:14px;flex-wrap:wrap}',
'.beta-secondary{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:14px 17px;border:1px solid #b8b0c4;font-weight:800}',
'.beta-secondary:hover{border-color:#d4ff00;color:#d4ff00}',
'.beta-note{font-size:13px}.beta-note code{background:#ffffff1b;padding:2px 4px;border-radius:4px}',
'.public-obs{margin:28px 0;padding:25px;border:1px solid #a6409d;border-radius:17px;background:linear-gradient(140deg,#201528,#101015)}',
'.public-obs h2{margin:0 0 13px;font-size:clamp(23px,2.3vw,32px)}',
'.public-obs p{margin:10px 0 18px}',
'@media(max-width:640px){.beta-buttons{flex-direction:column}.beta-buttons a{width:100%}}',
'</style></head>'
].join(''));
if (html.includes('id="form"') || html.includes('id="obsStart"')) throw Error('Unsafe form retained');
writeFileSync(join(output,'index.html'),html,'utf8');
writeFileSync(join(output,'static','public.js'), [
'const menu=document.getElementById("menu"),nav=document.getElementById("nav");',
'if(menu&&nav){',
'menu.addEventListener("click",()=>{const open=menu.getAttribute("aria-expanded")!=="true";menu.setAttribute("aria-expanded",String(open));nav.classList.toggle("open",open)});',
'nav.addEventListener("click",event=>{if(event.target.closest("a")){menu.setAttribute("aria-expanded","false");nav.classList.remove("open")}});',
'}'
].join('\n'),'utf8');
console.log('DroxionClips public early-access page built');
