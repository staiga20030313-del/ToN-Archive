/* ToN Archive: read-only browser-side VRChat log watcher.
   Chrome/Edge require user-granted directory access; no network upload. */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const panel=byId('vrcLivePanel');
if(!panel)return;
const status=byId('vrcLiveStatus'),details=byId('vrcLiveDetails'),
      items=byId('vrcLiveRounds'),
      total=byId('vrcLiveCount'),connect=byId('vrcLiveConnect'),
      manual=byId('vrcLiveManual'),reload=byId('vrcLiveRefresh'),
      selectAll=byId('vrcLiveSelectAll'),selectNone=byId('vrcLiveSelectNone'),
      importButton=byId('vrcLiveImport'),selectedCount=byId('vrcLiveSelectedCount'),
      mappingButton=byId('vrcLiveMappingButton'),mappingFile=byId('vrcLiveMappingFile'),
      mappingStatus=byId('vrcLiveMappingStatus');
const PREFIX='output_log_';
const LIMIT=75*1024*1024;
const PERIOD=12000;
let directory=null,timer=null,scanning=false,lastSignature='',previousFile='';
let connected=false;
let savedStartFolder=null,lastPickedLog=null;
const selectedKeys=new Set();
// Matches the native LogRoundFilterPanel: all enabled by default, each round
// and each subround may be toggled independently.
const sortButton=byId('vrcLiveSort'),roundFilterButton=byId('vrcLiveRoundFilterToggle'),
      roundFilterPopup=byId('vrcLiveRoundFilter'),
      roundFilterClose=byId('vrcLiveRoundFilterClose'),
      roundFilterGrid=byId('vrcLiveRoundFilterGrid'),
      roundFilterVariants=byId('vrcLiveRoundFilterVariants');
const disabledRounds=new Set();
let sortBySurvival=false,expandedRound='';
const roundList=typeof rounds!=='undefined'?rounds:[];
const variantList=typeof variants!=='undefined'?variants:{};
function roundKeys(round){return [round,...(variantList[round]||[]).map(v=>round+'/'+v)]}
function roundAllowed(r){
  if(!r.round)return true;
  if(r.round==='Sabotage'&&!r.variant)return ['Sabotage 1','Sabotage 2'].some(v=>!disabledRounds.has('Sabotage/'+v));
  return !disabledRounds.has(r.round+(r.variant?'/'+r.variant:''));
}
function survivalScore(r){
  if(Number.isFinite(r.survivalLevel))return r.survivalLevel;
  return (Number(r.survivalFlags)||0)-(Number(r.deathFlags)||0);
}
function orderedRounds(){
  const rows=[...(typeof vrcLogScan!=='undefined'?vrcLogScan?.rounds||[]:[])].filter(roundAllowed).reverse();
  // The original Windows application ranks by SurvivalFlags - DeathFlags.
  // Retain newest-first ordering for equal scores (stable Array.sort).
  if(sortBySurvival)rows.sort((a,b)=>survivalScore(b)-survivalScore(a));
  return rows;
}
function visibleRounds(){return orderedRounds().slice(0,60)}
function updateSortButton(){
  sortButton.textContent=sortBySurvival?'生存優先':'最新順';
  sortButton.classList.toggle('on',sortBySurvival);
  sortButton.setAttribute('aria-pressed',String(sortBySurvival));
  sortButton.title=sortBySurvival?'生存・死亡フラグの差が高い順。クリックで最新順':'新しいラウンド順。クリックで生存優先';
}
function makeRoundTile(round,variant='',enabled=true){
  const button=document.createElement('button');button.type='button';
  button.className='vrc-round-filter-tile'+(enabled?' on':'');
  button.setAttribute('aria-pressed',String(enabled));
  const name=variant?round+' / '+variant:round;
  button.title=name+'：'+(enabled?'表示ON':'表示OFF')+'（クリックで切替）';
  button.setAttribute('aria-label',button.title);
  const icon=typeof roundIcon==='function'?roundIcon(round,variant):null;
  if(icon)button.append(icon);else button.textContent=variant||round;
  return button;
}
function renderRoundFilter(){
  roundFilterGrid.replaceChildren();roundFilterVariants.replaceChildren();
  for(const round of roundList){
    const subrounds=variantList[round]||[];
    const on=subrounds.length?subrounds.some(v=>!disabledRounds.has(round+'/'+v)):!disabledRounds.has(round);
    const tile=makeRoundTile(round,'',on);
    tile.onclick=()=>{
      if(subrounds.length){expandedRound=expandedRound===round?'':round;}
      else{if(on)disabledRounds.add(round);else disabledRounds.delete(round);expandedRound='';}
      renderRoundFilter();renderScan();
    };
    roundFilterGrid.append(tile);
  }
  for(const variant of (variantList[expandedRound]||[])){
    const key=expandedRound+'/'+variant,on=!disabledRounds.has(key);
    const tile=makeRoundTile(expandedRound,variant,on);
    tile.onclick=()=>{
      if(on)disabledRounds.add(key);else disabledRounds.delete(key);
      renderRoundFilter();renderScan();
    };
    roundFilterVariants.append(tile);
  }
}
function placeRoundFilter(){
  const rect=roundFilterButton.getBoundingClientRect();
  const width=Math.min(535,window.innerWidth-20);
  const height=Math.min(280,window.innerHeight-20);
  roundFilterPopup.style.left=Math.max(10,Math.min(window.innerWidth-width-10,rect.right-width))+'px';
  roundFilterPopup.style.top=Math.max(10,Math.min(window.innerHeight-height-10,rect.bottom+6))+'px';
}
function closeRoundFilter(){
  roundFilterPopup.hidden=true;
  roundFilterButton.setAttribute('aria-expanded','false');
  roundFilterButton.classList.remove('on');
}

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
  const seen=importedKeys(),visible=visibleRounds();
  const valid=new Set(visible.filter(r=>importable(r,seen)).map(r=>r.sourceLogKey));
  // Keep hidden selections in memory, but never import them while filtered out.
  const allValid=new Set((vrcLogScan?.rounds||[]).filter(r=>importable(r,seen)).map(r=>r.sourceLogKey));
  for(const key of selectedKeys)if(!allValid.has(key))selectedKeys.delete(key);
  const selectedVisible=[...valid].filter(key=>selectedKeys.has(key)).length;
  selectedCount.textContent=selectedVisible+'件選択';
  importButton.disabled=selectedVisible===0;
  selectAll.disabled=valid.size===0;
  selectNone.disabled=selectedVisible===0;
}
function renderScan(){
  const scan=typeof vrcLogScan!=='undefined'?vrcLogScan:null;
  const rounds=scan?.rounds||[],seen=importedKeys();
  const sorted=orderedRounds(),visible=sorted.slice(0,60);
  total.textContent=sorted.length+'件';
  items.replaceChildren();
  if(!visible.length){
    const empty=document.createElement('div');empty.className='vrc-live-empty';
    empty.textContent=rounds.length?'表示中のラウンドがありません':scan?'ラウンドは未検出です':'ファイル読込でログを選択してください';
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
    node.draggable=allowed;
    node.addEventListener('dragstart',event=>{
      if(!allowed){event.preventDefault();return}
      event.dataTransfer.effectAllowed='copy';
      event.dataTransfer.setData('application/x-ton-vrc-round',String(r.sourceLogKey||''));
      event.dataTransfer.setData('text/plain',String(r.sourceLogKey||''));
      node.classList.add('is-dragging');
    });
    node.addEventListener('dragend',()=>node.classList.remove('is-dragging'));
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
      (roundIcon(r.round,r.round==='Sabotage'?(r.variant||'Sabotage 1'):r.variant)||roundIcon(r.round)):null;
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
    // Match the desktop log detector's measured round duration.
    // Do not manufacture seconds for a round with no recorded end.
    const seconds=Number.isFinite(r.durationSeconds)&&r.durationSeconds>=0?
      Math.floor(r.durationSeconds):null;
    const duration=document.createElement('span');duration.className='vrc-live-duration';
    duration.textContent=seconds===null?'—':seconds+'s';
    duration.title=seconds===null?'ラウンド秒数: 未確定':'ラウンド秒数: '+seconds+'秒';
    people.append(duration);
    people.title='推定 生存 / 参加: '+survived+'/'+players;
    const statusLabel=[duplicate?'取込済み':!r.round?'ラウンド未対応':r.ended?'終了':'進行中',r.status,
      '生存フラグ '+(r.survivalFlags??0)+' / 死亡フラグ '+(r.deathFlags??0)].filter(Boolean).join(' · ');
    // Keep the status available via tooltip / accessibility; no extra visible line.
    node.title=statusLabel;
    mapRow.append(people);
    body.append(headline,mapRow);
    node.append(body);items.append(node);
  }
  updateSelectedCount();
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
    if(!found.length){
      lastSignature='';details.textContent='output_log_*.txt が見つかりません';
      setStatus('ログ待機中','watching');renderScan();return;
    }
    const chosen=found[0]; // With no dropdown, always follow the latest output_log file.
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
    lastSignature='';
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
  const seen=importedKeys(),visible=visibleRounds();
  selectedKeys.clear();
  for(const r of visible)if(importable(r,seen))selectedKeys.add(r.sourceLogKey);
  renderScan();
};
selectNone.onclick=()=>{selectedKeys.clear();renderScan()};
importButton.onclick=()=>{
  if(!selectedKeys.size||!window.TON_VRC_IMPORT)return;
  const seen=importedKeys();
  const requested=new Set(visibleRounds()
    .filter(r=>selectedKeys.has(r.sourceLogKey)&&importable(r,seen))
    .map(r=>r.sourceLogKey));
  if(!requested.size)return;
  const added=window.TON_VRC_IMPORT.importSelected(requested);
  if(added>0)for(const key of requested)selectedKeys.delete(key);
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
sortButton.onclick=()=>{
  sortBySurvival=!sortBySurvival;
  updateSortButton();renderScan();
};
roundFilterButton.onclick=()=>{
  if(!roundFilterPopup.hidden){closeRoundFilter();return;}
  renderRoundFilter();roundFilterPopup.hidden=false;placeRoundFilter();
  roundFilterButton.setAttribute('aria-expanded','true');
  roundFilterButton.classList.add('on');
};
roundFilterClose.onclick=closeRoundFilter;
document.addEventListener('pointerdown',event=>{
  if(!roundFilterPopup.hidden&&!roundFilterPopup.contains(event.target)&&
    !roundFilterButton.contains(event.target))closeRoundFilter();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!roundFilterPopup.hidden)closeRoundFilter()});
window.addEventListener('resize',()=>{if(!roundFilterPopup.hidden)placeRoundFilter()},{passive:true});
window.addEventListener('scroll',()=>{if(!roundFilterPopup.hidden)placeRoundFilter()},{passive:true});
updateSortButton();
// Keep the existing results-panel VRCログ button on the same picker behavior.
byId('vrcLogButton').onclick=openLogFilePicker;
reload.onclick=()=>{if(directory)void poll(true);else if(vrcLogScan)renderScan()};

document.addEventListener('visibilitychange',()=>{if(!document.hidden&&directory)void poll()});
window.TON_VRC_PANEL={renderScan,loadScan:publish,refreshMappingStatus:showMappingStatus};
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
// Drop a single log round into the summary without affecting the existing reorder drag.
const summaryTarget=document.querySelector('.results-workspace .records-panel');
if(summaryTarget){
  summaryTarget.addEventListener('dragover',event=>{
    if(!event.dataTransfer.types.includes('application/x-ton-vrc-round'))return;
    event.preventDefault();event.dataTransfer.dropEffect='copy';
    summaryTarget.classList.add('vrc-summary-drag-target');
  });
  summaryTarget.addEventListener('dragleave',event=>{
    if(!summaryTarget.contains(event.relatedTarget))summaryTarget.classList.remove('vrc-summary-drag-target');
  });
  summaryTarget.addEventListener('drop',event=>{
    const key=event.dataTransfer.getData('application/x-ton-vrc-round');
    if(!key)return;
    event.preventDefault();event.stopPropagation();
    summaryTarget.classList.remove('vrc-summary-drag-target');
    const round=(vrcLogScan?.rounds||[]).find(r=>r.sourceLogKey===key);
    if(!round||!roundAllowed(round)||!importable(round,importedKeys()))return;
    window.TON_VRC_IMPORT?.importSelected(new Set([key]));
    selectedKeys.delete(key);renderScan();
  },true);
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
