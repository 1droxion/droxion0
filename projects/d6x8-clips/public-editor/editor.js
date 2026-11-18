"use strict";
const API="https://droxionclips-editor-beta.onrender.com";
const $=id=>document.getElementById(id);
const form=$("clipForm"),url=$("sourceUrl"),file=$("videoFile"),fileName=$("fileName");
const status=$("editorStatus"),statusText=$("statusText"),progress=$("clipProgress");
const results=$("clipResults"),cards=$("clipCards"),submit=$("startClipping");
const captions=$("captionsOn"),text=$("captionText"),captionWrap=$("captionTextWrap");
const selectAll=$("selectAllClips"),download=$("downloadSelected"),count=$("selectedCount");
let job=null,clips=[],retryUpload=false;
const youtube=raw=>{
  try{
    const u=new URL(raw);
    return ["youtube.com","www.youtube.com","m.youtube.com","youtu.be"].includes(u.hostname.toLowerCase());
  }catch{return false;}
};
function notice(message,level=0,error=false){
  status.hidden=false;
  statusText.textContent=message;
  statusText.classList.toggle("error",error);
  progress.value=Math.max(0,Math.min(100,level));
}
function selected(){
  return Array.from(cards.querySelectorAll('input[type="checkbox"]:checked')).map(x=>x.value);
}
function updateSelection(){
  const chosen=selected();
  count.textContent=chosen.length+" selected";
  download.disabled=chosen.length===0;
}
function showClips(items,expected){
  if(!Array.isArray(items)||items.length!==expected)throw Error("Processing returned an unexpected number of clips.");
  cards.replaceChildren();
  clips=items;
  for(const clip of clips){
    const card=document.createElement("article");card.className="result-clip";
    const video=document.createElement("video");
    video.controls=true;video.playsInline=true;video.preload="metadata";
    video.src=API+clip.url;
    const label=document.createElement("label");label.className="clip-pick";
    const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.checked=true;checkbox.value=String(clip.number);
    checkbox.addEventListener("change",updateSelection);
    label.append(checkbox,document.createTextNode(" Clip "+clip.number));
    const subtitle=document.createElement("small");
    subtitle.textContent=Math.round(clip.start)+"s–"+Math.round(clip.end)+"s";
    const individual=document.createElement("a");
    individual.href=API+clip.url+"?download=true";individual.target="_blank";individual.rel="noopener noreferrer";
    individual.textContent="Download MP4";
    card.append(video,label,subtitle,individual);
    cards.append(card);
  }
  results.hidden=false;
  updateSelection();
  results.scrollIntoView({behavior:"smooth",block:"start"});
}
function errorDetail(data,fallback){return typeof data?.detail==="string"?data.detail:fallback;}
async function responseJSON(response){
  let data={};
  try{data=await response.json();}catch{}
  if(!response.ok)throw Error(errorDetail(data,"The video couldn't be processed right now."));
  return data;
}
async function run(){
  const link=url.value.trim(),video=file.files[0];
  if(!link&&!video)throw Error("Paste a YouTube video link or a direct MP4 link, or upload your recording.");
  if(video && video.size>1024**3)throw Error("Online trial maximum: 1 GiB.");
  if(link && !youtube(link) && video)throw Error("Use either an uploaded file or a direct video link, not both.");
  if(captions.checked&&!text.value.trim())throw Error("Enter a caption, or turn captions OFF.");
  if(!$("rightsCheck").checked)throw Error("Confirm that you have permission to edit the recording.");
  results.hidden=true;cards.replaceChildren();
  const body=new FormData();
  if(video)body.append("video",video);
  if(link)body.append("url",link);
  const requested=Number($("clipCount").value);
  body.append("clip_count",String(requested));
  body.append("template",$("clipStyle").value);
  body.append("captions",String(captions.checked));
  body.append("caption_text",captions.checked?text.value.trim():"");
  body.append("caption_font",$("clipFont").value);
  body.append("rights","true");
  notice(video ? "Uploading your recording…" : youtube(link) ? "Starting YouTube import…" : "Importing the video file…",5);
  const jobData=await responseJSON(await fetch(API+"/api/public/jobs",{method:"POST",body,mode:"cors"}));
  job=jobData.job_id;
  for(let i=0;i<2400;i++){
    await new Promise(resolve=>setTimeout(resolve,1500));
    const state=await responseJSON(await fetch(API+"/api/public/jobs/"+encodeURIComponent(job),{mode:"cors"}));
    notice(state.message||"Generating highlights…",state.progress||10);
    if(state.status==="error")throw Error(state.message||"This video could not be processed.");
    if(state.status==="done"){
      showClips(state.clips,requested);
      notice(requested===1 ? "Your clip is ready." : requested+" clips are ready. Select your favorites below.",100);
      return;
    }
  }
  throw Error("The job timed out. Try a shorter video.");
}
form.addEventListener("submit",async e=>{
  e.preventDefault();
  if(submit.disabled)return;
  retryUpload=false;
  submit.disabled=true;
  try{await run();}
  catch(err){
    const linkOnly=youtube(url.value.trim())&&!file.files.length;
    const blocked=linkOnly&&/sign in to confirm|not a bot|youtube blocked/i.test(err.message);
    const message=blocked?"YouTube blocked this import. Upload the video file to continue."
      :err.message||"Unable to create clips.";
    notice(message,0,true);
    if(linkOnly){
      const retry=document.createElement("button");
      retry.type="button";retry.className="file-cta";retry.textContent="Upload Video";
      retry.addEventListener("click",()=>{retryUpload=true;file.click();});
      statusText.append(" ",retry);
    }
  }
  finally{submit.disabled=false;}
});
function updateCaptions(){
  captionWrap.hidden=!captions.checked;
  $("captionFontWrap").hidden=!captions.checked;
  text.required=captions.checked;
}
captions.addEventListener("change",updateCaptions);
updateCaptions();
file.addEventListener("change",()=>{
  fileName.textContent=file.files[0]?.name||"No video selected";
  if(!file.files.length||submit.disabled)return;
  if(!youtube(url.value.trim()))url.value="";
  if(retryUpload){
    retryUpload=false;
    form.requestSubmit();
  }
});
url.addEventListener("input",()=>{
  retryUpload=false;
  if(url.value.trim()&&!youtube(url.value.trim())){file.value="";fileName.textContent="No video selected";}
  $("sourceHelp").textContent=youtube(url.value.trim())
    ?"YouTube link detected. If the import is blocked, upload your original recording."
    :"Paste a YouTube or direct video file link, or upload a recording.";
});
selectAll.addEventListener("click",()=>{
  for(const box of cards.querySelectorAll('input[type="checkbox"]'))box.checked=true;
  updateSelection();
});
download.addEventListener("click",()=>{
  const picks=selected();
  if(!job||!picks.length)return;
  window.location.assign(API+"/api/public/jobs/"+encodeURIComponent(job)+"/selected.zip?clips="+picks.join(","));
});
