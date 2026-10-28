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
      manual=byId('vrcLiveManual'),reload=byId('vrcLiveRefresh'),
      selectAll=byId('vrcLiveSelectAll'),selectNone=byId('vrcLiveSelectNone'),
      importButton=byId('vrcLiveImport'),selectedCount=byId('vrcLiveSelectedCount'),
      mappingButton=byId('vrcLiveMappingButton'),mappingFile=byId('vrcLiveMappingFile'),
      mappingStatus=byId('vrcLiveMappingStatus');
const PREFIX='output_log_';
const LIMIT=75*1024*1024;
const PERIOD=12000;
let directory=null,timer=null,scanning=false,lastSignature='',fileList=[],previousFile='';
let selectedFile='latest', connected=false;
let savedStartFolder=null,lastPickedLog=null;
const selectedKeys=new Set();
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
function importable(r,seen){
  const key=String(r.sourceLogKey||'');
  return Boolean(key&&r.round&&!seen.has(key.toLowerCase()));
}
function updateSelectedCount(){
  const seen=importedKeys(),visible=[...(vrcLogScan?.rounds||[])].reverse().slice(0,60);
  const valid=new Set(visible.filter(r=>importable(r,seen)).map(r=>r.sourceLogKey));
  for(const key of selectedKeys)if(!valid.has(key))selectedKeys.delete(key);
  selectedCount.textContent=selectedKeys.size+'件選択';
  importButton.disabled=selectedKeys.size===0;
  selectAll.disabled=valid.size===0;
  selectNone.disabled=selectedKeys.size===0;
}
function renderScan(){
  const scan=typeof vrcLogScan!=='undefined'?vrcLogScan:null;
  const rounds=scan?.rounds||[],seen=importedKeys();
  total.textContent=rounds.length+'件';
  items.replaceChildren();
  const visible=[...rounds].reverse().slice(0,60);
  const available=new Set(visible.filter(r=>importable(r,seen)).map(r=>r.sourceLogKey));
  for(const key of selectedKeys)if(!available.has(key))selectedKeys.delete(key);
  if(!rounds.length){
    const empty=document.createElement('div');empty.className='vrc-live-empty';
    empty.textContent=scan?'ラウンドは未検出です':'フォルダを接続すると検出結果が表示されます';
    items.append(empty);updateSelectedCount();return;
  }
  for(const r of visible){
    const duplicate=seen.has(String(r.sourceLogKey||'').toLowerCase());
    const allowed=importable(r,seen),selected=selectedKeys.has(r.sourceLogKey);
    // The card itself is a toggle. A selected card has a highlighted background.
    const node=document.createElement('button');
    node.type='button';
    node.className='vrc-live-round'+(duplicate?' imported':'')+(allowed?'':' is-disabled')+(selected?' is-selected':'');
    node.disabled=!allowed;
    node.dataset.sourceKey=String(r.sourceLogKey||'');
    node.setAttribute('aria-pressed',String(selected));
    node.setAttribute('aria-label',
      [r.round||'未対応ラウンド',r.variant,formatDate(r.start),
        duplicate?'取込済み':selected?'選択中':'未選択'].filter(Boolean).join(' / '));
    node.onclick=()=>{
      if(!allowed)return;
      const active=!selectedKeys.has(r.sourceLogKey);
      if(active)selectedKeys.add(r.sourceLogKey);
      else selectedKeys.delete(r.sourceLogKey);
      node.classList.toggle('is-selected',active);
      node.setAttribute('aria-pressed',String(active));
      updateSelectedCount();
    };
    const body=document.createElement('span');body.className='vrc-live-round-content';
    const headline=document.createElement('span');headline.className='vrc-live-card-top';
    const roundSprite=document.createElement('span');roundSprite.className='vrc-live-round-icon';
    // Reuse the archive's actual 32x32 atlas sprite, not a scaled screenshot.
    const roundArt=typeof roundIcon==='function'?
      (roundIcon(r.round,r.variant)||roundIcon(r.round)):null;
    if(roundArt)roundSprite.append(roundArt);
    else roundSprite.textContent='?';
    // Unverified killer IDs must stay as question marks. Never guess an icon.
    const known=Array.isArray(r.terrorSlots)?r.terrorSlots:Array.isArray(r.terrors)?r.terrors:[];
    const slots=r.round==='Moon'||r.round==='Other'&&!['Other 3','Other 4'].includes(r.variant)?0:
      r.round==='Midnight'?3:r.round==='Bloodbath'?
      (r.variant==='DT'?2:r.variant==='EX'?1:3):1;
    const terrorGroup=document.createElement('span');terrorGroup.className='vrc-live-terror-icons';
    for(let i=0;i<slots;i++){
      const id=known[i];
      const art=id&&typeof terrorIcon==='function'?
        terrorIcon(id,r.round,r.variant):typeof questionIcon==='function'?
        questionIcon(r.round,r.variant):null;
      const cell=document.createElement('span');cell.className='vrc-live-terror-cell';
      if(art)cell.append(art);else cell.textContent='?';
      cell.title=id?'テラー '+id:
        (r.unmappedKillerIds?.length?'未確認ログID: '+r.unmappedKillerIds.join(', '):'テラー未確定');
      terrorGroup.append(cell);
    }
    headline.append(roundSprite);
    if(slots)headline.append(terrorGroup);
    const mapRow=document.createElement('span');mapRow.className='vrc-live-map-row';
    const badge=r.map&&typeof mapBadge==='function'?mapBadge(r.map):null;
    if(badge){mapRow.append(badge);mapRow.title=mapName(r.map);}
    else{
      const mapText=document.createElement('span');mapText.className='vrc-live-map';
      mapText.textContent=r.mapName||'MAP不明';
      mapText.title=mapText.textContent;mapRow.append(mapText);
    }
    // Compact readout: survived / players, then new survivors.
    // These are estimates, not certified counts. A dash means unknown.
    const people=document.createElement('span');people.className='vrc-live-people-compact';
    const formatCount=value=>Number.isFinite(value)&&value>=0?String(value):'?';
    const survived=formatCount(r.estimatedSurvivors);
    const players=formatCount(r.estimatedPlayers);
     const mainCount=document.createElement('strong');mainCount.className='vrc-live-count-ratio';
    mainCount.textContent=survived+'/'+players;
    people.append(mainCount);
    people.title='推定 生存 / 参加: '+survived+'/'+players;
    const statusLabel=[duplicate?'取込済み':!r.round?'ラウンド未対応':r.ended?'終了':'進行中',r.status].filter(Boolean).join(' · ');
    // Keep the status available via tooltip / accessibility; no extra visible line.
    node.title=statusLabel;
    mapRow.append(people);
    body.append(headline,mapRow);
    node.append(body);items.append(node);
  }
  updateSelectedCount();
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
function publish(data,file){
  const previousFile=vrcLogScan?.file||'';
  if(previousFile&&previousFile!==file.name)selectedKeys.clear();
  vrcLogScan={...data,file:file.name};
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
    directory=picked;savedStartFolder=picked;
    selectedFile='latest';lastSignature='';
    void saveHandle(picked);
    start();
  }catch(error){
    if(error?.name!=='AbortError'){
      setStatus('フォルダ接続に失敗','error');details.textContent=errorText(error);
    }
  }
};
function openLogFilePicker(){
  if(!window.TON_VRC_LOG){
    setStatus('ログ解析機能が未読込です','error');return;
  }
  // Browsers without the File System Access picker retain the original file input.
  if(typeof window.showOpenFilePicker!=='function'){
    byId('vrcLogFile').click();return;
  }
  const options={
    id:'ton-vrc-log-file',multiple:false,
    types:[{description:'VRChatログ (*.txt)',accept:{'text/plain':['.txt']}}]
  };
  // Start in the previously connected VRChat directory when available.
  // Otherwise the stable ID remembers the previous file-picker location.
  if(directory||savedStartFolder||lastPickedLog){
    options.startIn=directory||savedStartFolder||lastPickedLog;
  }
  // Call immediately from the click handler; awaiting first loses user activation.
  let request;
  try{request=window.showOpenFilePicker(options)}
  catch(error){setStatus('ファイル選択エラー','error');details.textContent=errorText(error);return}
  void request.then(async handles=>{
    const handle=handles?.[0];if(!handle)return;
    const file=await handle.getFile();
    if(!/^output_log_.*\.txt$/i.test(file.name))throw Error('output_log_*.txt を選択してください');
    if(file.size>50*1024*1024)throw Error('ログが50MBを超えています');
    const data=window.TON_VRC_LOG.analyze(await file.text(),file.name,MAP_DATA);
    lastPickedLog=handle;
    publish(data,file);
    details.textContent=file.name;
    setStatus(directory?'監視中':'ファイル読込済み',directory?'watching':'idle');
  }).catch(error=>{
    if(error?.name==='AbortError')return;
    setStatus('ファイル読込エラー','error');details.textContent=errorText(error);
  });
}
selectAll.onclick=()=>{
  const seen=importedKeys(),visible=[...(vrcLogScan?.rounds||[])].reverse().slice(0,60);
  selectedKeys.clear();
  for(const r of visible)if(importable(r,seen))selectedKeys.add(r.sourceLogKey);
  renderScan();
};
selectNone.onclick=()=>{selectedKeys.clear();renderScan()};
importButton.onclick=()=>{
  if(!selectedKeys.size||!window.TON_VRC_IMPORT)return;
  const requested=new Set(selectedKeys);
  const added=window.TON_VRC_IMPORT.importSelected(requested);
  if(added>0)selectedKeys.clear();
  renderScan();
};
function showMappingStatus(){
  const info=window.TON_VRC_LOG?.mappingInfo();
  const n=info?.count||0;
  const builtin=info?.source==='builtin';
  mappingButton.hidden=n>0; // Import remains available only when mappings are missing.
  mappingStatus.textContent=n?
    (builtin?'ID対応: 本体組込 '+n+'件':'ID対応: '+n+'件を自動適用'):
    'ID対応: 未登録';
  if(info?.error)mappingStatus.title=info.error;
  else mappingStatus.title=n?
    (builtin?'サイトに組み込み済み。手動読込は不要です':'このブラウザに保存済み。毎回読み込む必要はありません'):
    '旧ツールで設定した数値ログIDのJSONを一度だけ選択してください';
}
mappingButton.onclick=()=>mappingFile.click();
mappingFile.onchange=async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  try{
    if(file.size>2*1024*1024)throw Error('対応表が2MBを超えています');
    const data=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    const info=window.TON_VRC_LOG.importMappings(data);
    if(typeof vrcLogScan!=='undefined'&&vrcLogScan)
      window.TON_VRC_LOG.applyMappingsToScan(vrcLogScan);
    showMappingStatus();
    renderScan();
    mappingStatus.textContent=info.count+'件のID対応を読込済み';
  }catch(error){
    // A failed import must not overwrite the previously saved mapping.
    showMappingStatus();
    mappingStatus.textContent='読込失敗: '+errorText(error);
    mappingStatus.title='旧ツールの terror_log_mappings.json を選択してください';
  }finally{event.target.value=''}
};
showMappingStatus();
manual.onclick=openLogFilePicker;
// Keep the existing results-panel VRCログ button on the same picker behavior.
byId('vrcLogButton').onclick=openLogFilePicker;
reload.onclick=()=>{if(directory)void poll(true);else if(vrcLogScan)renderScan()};
files.onchange=()=>{selectedFile=files.value;lastSignature='';if(directory)void poll(true)};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&directory)void poll()});
window.TON_VRC_PANEL={renderScan,loadScan:publish};
// Canvas map labels and terror colors must refresh after their atlases/fonts load.
for(const atlas of [
  typeof mapAtlasImage==='undefined'?null:mapAtlasImage,
  typeof terrorSheet==='undefined'?null:terrorSheet,
  typeof unboundSheet==='undefined'?null:unboundSheet
]){
  if(atlas&&typeof atlas.addEventListener==='function'){
    atlas.addEventListener('load',()=>{if(vrcLogScan?.rounds?.length)renderScan()});
  }
}
if(document.fonts?.ready){
  document.fonts.ready.then(()=>{if(vrcLogScan?.rounds?.length)renderScan()}).catch(()=>{});
}
renderScan();
if(typeof window.showDirectoryPicker==='function'){
  void (async()=>{
    const handle=await restoreHandle();if(!handle)return;
    savedStartFolder=handle;
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
