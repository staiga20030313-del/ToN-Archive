/* ToN Archive: read-only browser-side VRChat log watcher.
   Chrome/Edge require user-granted directory access; no network upload. */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const panel=byId('vrcLivePanel');
if(!panel)return;
const status=byId('vrcLiveStatus'),details=byId('vrcLiveDetails'),
      files=byId('vrcLiveFiles'),items=byId('vrcLiveRounds'),
      total=byId('vrcLiveCount'),connect=byId('vrcLiveConnect'),
      manual=byId('vrcLiveManual'),reload=byId('vrcLiveRefresh');
const PREFIX='output_log_';
const LIMIT=75*1024*1024;
const PERIOD=12000;
let directory=null,timer=null,scanning=false,lastSignature='',fileList=[],previousFile='';
let selectedFile='latest', connected=false;
function setStatus(message,mode='idle'){
  status.textContent=message;status.dataset.state=mode;
}
function formatDate(value){
  if(!value)return '?';
  const str=String(value).replace('T',' ');
  return str.length>16?str.slice(0,16):str;
}
function humanTime(ms){
  if(!ms)return '';
  try{return new Date(ms).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}
  catch{return ''}
}
function importedKeys(){
  try{return new Set(current().records.map(r=>String(r.sourceLogKey||'').toLowerCase()).filter(Boolean))}
  catch{return new Set()}
}
function renderScan(){
  const scan=typeof vrcLogScan!=='undefined'?vrcLogScan:null;
  const rounds=scan?.rounds||[],seen=importedKeys();
  total.textContent=rounds.length+'件';
  items.replaceChildren();
  if(!rounds.length){
    const empty=document.createElement('div');empty.className='vrc-live-empty';
    empty.textContent=scan?'ラウンドは未検出です':'フォルダを接続すると検出結果が表示されます';
    items.append(empty);return;
  }
  const sorted=[...rounds].reverse().slice(0,60);
  for(const r of sorted){
    const duplicate=seen.has(String(r.sourceLogKey||'').toLowerCase());
    const node=document.createElement('button');
    node.type='button';node.className='vrc-live-round'+(duplicate?' imported':'');
    const headline=document.createElement('span');headline.className='vrc-live-round-head';
    const time=document.createElement('span');time.className='vrc-live-round-time';
    time.textContent=formatDate(r.start).slice(5);
    const round=document.createElement('strong');round.textContent=[r.round||'未対応',r.variant].filter(Boolean).join(' / ');
    headline.append(time,round);
    const map=document.createElement('span');map.className='vrc-live-map';
    map.textContent=r.map?mapName(r.map):r.mapName||'MAP不明';
    const info=document.createElement('span');info.className='vrc-live-meta';
    const people=r.estimatedPlayers==null?'人数 ?':'人数 約'+r.estimatedPlayers;
    info.textContent=[duplicate?'取込済み':r.ended?'終了':'進行中',people,r.status].filter(Boolean).join(' · ');
    node.append(headline,map,info);
    node.title='クリックでラウンドを確認・取込';
    node.onclick=()=>{
      if(typeof vrcLogRender!=='function')return;
      vrcLogRender();
      const boxes=[...byId('vrcLogRows').querySelectorAll('input[type="checkbox"]')];
      for(const check of boxes)check.checked=!check.disabled&&check.dataset.sourceKey===r.sourceLogKey;
      vrcLogUpdateSelection();
      const dialog=byId('vrcLogDialog');if(!dialog.open)dialog.showModal();
      const selected=boxes.find(b=>b.dataset.sourceKey===r.sourceLogKey);
      selected?.closest('label')?.scrollIntoView({block:'nearest'});
    };
    items.append(node);
  }
}
function renderFiles(){
  const previous=files.value||selectedFile;
  files.replaceChildren();
  const latest=document.createElement('option');latest.value='latest';latest.textContent='最新ログ（自動）';
  files.append(latest);
  for(const e of fileList.slice(0,20)){
    const option=document.createElement('option');option.value=e.name;
    option.textContent=e.name.replace(/^output_log_/i,'').replace(/\.txt$/i,'');
    files.append(option);
  }
  files.value=selectedFile==='latest'||fileList.some(e=>e.name===selectedFile)?selectedFile:'latest';
}
function preserveDialogChoice(){
  const selected=new Set();
  if(!byId('vrcLogDialog')?.open)return selected;
  for(const checkbox of byId('vrcLogRows').querySelectorAll('input[type="checkbox"]:checked')){
    selected.add(checkbox.dataset.sourceKey);
  }
  return selected;
}
function publish(data,file){
  const choices=preserveDialogChoice();
  vrcLogScan={...data,file:file.name};
  vrcLogRender();
  if(choices.size)for(const check of byId('vrcLogRows').querySelectorAll('input[type="checkbox"]')){
    check.checked=!check.disabled&&choices.has(check.dataset.sourceKey);
  }
  vrcLogUpdateSelection();
  renderScan();
}
function errorText(error){
  return error?.message||String(error||'不明なエラー');
}
async function poll(force=false){
  if(!directory||scanning)return;
  scanning=true;
  try{
    const found=[];
    for await(const [name,handle] of directory.entries()){
      if(handle.kind==='file'&&/^output_log_.*\.txt$/i.test(name))found.push({name,handle});
    }
    found.sort((a,b)=>b.name.localeCompare(a.name));
    fileList=found;
    renderFiles();
    if(!found.length){
      lastSignature='';details.textContent='output_log_*.txt が見つかりません';
      setStatus('ログ待機中','watching');renderScan();return;
    }
    const chosen=selectedFile==='latest'?found[0]:(found.find(e=>e.name===selectedFile)||found[0]);
    if(selectedFile!=='latest'&&chosen.name!==selectedFile){selectedFile='latest';files.value='latest'}
    const file=await chosen.handle.getFile();
    const signature=[file.name,file.size,file.lastModified].join('|');
    details.textContent=file.name+' · '+humanTime(file.lastModified);
    if(file.size>LIMIT){
      setStatus('ファイル容量が75MBを超過','error');return;
    }
    if(!force&&signature===lastSignature){
      setStatus('監視中','watching');return;
    }
    if(!window.TON_VRC_LOG)throw Error('ログ解析機能が未読込です');
    const data=window.TON_VRC_LOG.analyze(await file.text(),file.name,MAP_DATA);
    lastSignature=signature;previousFile=file.name;
    publish(data,file);
    setStatus('監視中 · '+data.rounds.length+'ラウンド','watching');
  }catch(error){
    setStatus('読込エラー','error');details.textContent=errorText(error);
  }finally{scanning=false}
}
function stop(){
  if(timer){clearInterval(timer);timer=null}
}
function start(){
  stop();
  connected=true;connect.textContent='フォルダ変更';
  setStatus('解析中','watching');
  void poll(true);
  timer=setInterval(()=>{if(!document.hidden)void poll()},PERIOD);
}
async function saveHandle(handle){
  if(!('indexedDB'in window))return;
  return new Promise(resolve=>{
    try{
      const request=indexedDB.open('ton-archive-log-access',1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('handles'))db.createObjectStore('handles');
      };
      request.onerror=()=>resolve();
      request.onsuccess=()=>{
        const db=request.result;
        try{
          const tx=db.transaction('handles','readwrite');
          tx.objectStore('handles').put(handle,'vrc');
          tx.oncomplete=()=>{db.close();resolve()};
          tx.onerror=()=>{db.close();resolve()};
        }catch{db.close();resolve()}
      };
    }catch{resolve()}
  });
}
async function restoreHandle(){
  if(!('indexedDB'in window))return null;
  return new Promise(resolve=>{
    try{
      const request=indexedDB.open('ton-archive-log-access',1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('handles'))db.createObjectStore('handles');
      };
      request.onerror=()=>resolve(null);
      request.onsuccess=()=>{
        const db=request.result;
        try{
          const tx=db.transaction('handles','readonly');
          const get=tx.objectStore('handles').get('vrc');
          get.onsuccess=()=>{db.close();resolve(get.result||null)};
          get.onerror=()=>{db.close();resolve(null)};
        }catch{db.close();resolve(null)}
      };
    }catch{resolve(null)}
  });
}
connect.onclick=async()=>{
  if(typeof window.showDirectoryPicker!=='function'){
    setStatus('Chrome / Edgeのフォルダ接続を利用してください','error');
    byId('vrcLogFile').click();return;
  }
  try{
    // Must be called directly from the click gesture.
    const picked=await window.showDirectoryPicker({id:'ton-vrc-log',mode:'read'});
    if(picked.name!=='VRChat'){
      // Allow any folder that contains VRChat log files, but report what was selected.
      details.textContent='選択フォルダ: '+picked.name;
    }
    directory=picked;
    selectedFile='latest';lastSignature='';
    void saveHandle(picked);
    start();
  }catch(error){
    if(error?.name!=='AbortError'){
      setStatus('フォルダ接続に失敗','error');details.textContent=errorText(error);
    }
  }
};
manual.onclick=()=>byId('vrcLogButton').click();
reload.onclick=()=>{if(directory)void poll(true);else if(vrcLogScan)renderScan()};
files.onchange=()=>{selectedFile=files.value;lastSignature='';if(directory)void poll(true)};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&directory)void poll()});
window.TON_VRC_PANEL={renderScan,loadScan:publish};
renderScan();
if(typeof window.showDirectoryPicker==='function'){
  void (async()=>{
    const handle=await restoreHandle();if(!handle)return;
    try{
      const permission=typeof handle.queryPermission==='function'
        ?await handle.queryPermission({mode:'read'}):'prompt';
      if(permission==='granted'){directory=handle;start();}
      else{setStatus('再接続が必要','idle');details.textContent='フォルダ接続を押して読み取りを許可してください'}
    }catch{setStatus('フォルダの再接続が必要','idle')}
  })();
}else{
  setStatus('ログファイルを手動選択','idle');
  details.textContent='自動監視はPCのChrome / Edgeで利用できます';
}
})();
