/* ToN Archive: edit numerical VRChat killer IDs directly beside atlas icons.
   All mappings are user-authored; never guess from icon ordering. */
(function(){
'use strict';
const byId=id=>document.getElementById(id);
const openButton=byId('vrcLiveIdEditorOpen');
const overlay=byId('terrorIdEditor');
if(!openButton||!overlay)return;
const closeButton=byId('terrorIdEditorClose'),tabs=byId('terrorIdEditorTabs'),
  search=byId('terrorIdEditorSearch'),grid=byId('terrorIdEditorGrid'),
  save=byId('terrorIdEditorSave'),exportButton=byId('terrorIdEditorExport'),
  notice=byId('terrorIdEditorNotice'),count=byId('terrorIdEditorCount');
const groups=[
 {label:'Classic',prefix:'T',icon:'C',length:134,round:'Classic'},
 {label:'Alternate',prefix:'ALT',icon:'A',length:36,round:'Alternate'},
 {label:'8 Pages',prefix:'8P',icon:'E',length:7,round:'8 Pages'}
];
let currentGroup=0,edits=new Map(),dirty=false;
function el(tag,cls,content){
 const e=document.createElement(tag);
 if(cls)e.className=cls;
 if(content!=null)e.textContent=content;
 return e;
}
function iconName(id){
 try{
  if(typeof terrorName==='function')return terrorName(id);
  return window.TON_TERROR_CONFIG?.iconNames?.[id]||id;
 }catch{return id}
}
function info(message,isError=false){
 notice.textContent=message;
 notice.dataset.error=isError?'true':'false';
}
function allRows(){
 return groups.flatMap(g=>Array.from({length:g.length},(_,i)=>{
  const n=String(i+1).padStart(3,'0'),catalog=g.prefix+n,old=edits.get(catalog);
  const name=old?.DisplayName||iconName(g.icon+n);
  return {CatalogId:catalog,LogId:old?.LogId||'',DisplayName:name};
 }));
}
function registeredCount(){return allRows().filter(r=>r.LogId.trim()).length}
function updateCount(){count.textContent=registeredCount()+'/177件登録';}
function validateConflicts(){
 const duplicate=new Set(),byScope=new Map();
 for(const row of allRows()){
  const raw=row.LogId.trim();
  if(!raw)continue;
  if(!/^\d+$/.test(raw)){duplicate.add(row.CatalogId);continue}
  const scope=row.CatalogId.startsWith('ALT')?'A':
    row.CatalogId.startsWith('8P')?'E':'C';
  const key=scope+':'+String(Number(raw));
  if(byScope.has(key)){duplicate.add(row.CatalogId);duplicate.add(byScope.get(key));}
  else byScope.set(key,row.CatalogId);
 }
 grid.querySelectorAll('.terror-id-tile').forEach(tile=>{
  const bad=duplicate.has(tile.dataset.catalog);
  tile.classList.toggle('invalid',bad);
  const field=tile.querySelector('input');
  if(field)field.setAttribute('aria-invalid',bad?'true':'false');
 });
 if(duplicate.size){
  info(duplicate.size+'件の入力に重複または不正なIDがあるよ。',true);
 }else if(dirty){
  info('変更あり。保存するとログ一覧のアイコンにも反映されるよ。');
 }
 return duplicate.size===0;
}
function renderTabs(){
 tabs.replaceChildren();
 for(let i=0;i<groups.length;i++){
  const g=groups[i],btn=el('button','terror-id-tab'+(i===currentGroup?' active':''),g.label);
  btn.type='button';btn.setAttribute('aria-pressed',String(i===currentGroup));
  btn.onclick=()=>{currentGroup=i;renderTabs();renderGrid()};
  tabs.append(btn);
 }
}
function renderGrid(){
 grid.replaceChildren();
 const group=groups[currentGroup],query=search.value.trim().toLowerCase();
 const fragment=document.createDocumentFragment();
 let matched=0;
 for(let i=1;i<=group.length;i++){
  const n=String(i).padStart(3,'0');
  const catalog=group.prefix+n,iconId=group.icon+n;
  const previous=edits.get(catalog),display=iconName(iconId);
  const searchText=[catalog,iconId,display,previous?.DisplayName||'',previous?.LogId||''].join(' ').toLowerCase();
  if(query&&!searchText.includes(query))continue;
  matched++;
  const tile=el('div','terror-id-tile');tile.dataset.catalog=catalog;
  const art=el('div','terror-id-icon');
  try{
   const sprite=typeof terrorIcon==='function'?terrorIcon(iconId,group.round):null;
   if(sprite&&sprite.classList?.contains('missing-terror-icon')){
    art.append(el('span','',iconId));
   }else if(sprite)art.append(sprite);
   else art.append(el('span','',iconId));
  }catch{art.append(el('span','',iconId));}
  art.title=display;
  const title=el('span','terror-id-tile-code',catalog);
  const name=el('span','terror-id-tile-name',display);
  name.title=display;
  const input=el('input','terror-id-field');
  input.type='text';input.inputMode='numeric';input.autocomplete='off';
  input.placeholder='ログID';input.maxLength=10;
  input.value=previous?.LogId||'';
  input.setAttribute('aria-label',display+' のVRChatログ数値ID');
  input.addEventListener('input',()=>{
   // Existing IDs can have leading zeros, but all must compare numerically.
   const clean=input.value.replace(/[^\d]/g,'');
   if(clean!==input.value)input.value=clean;
   const old=edits.get(catalog)||{CatalogId:catalog,DisplayName:display,LogId:''};
   edits.set(catalog,{...old,LogId:clean});
   dirty=true;updateCount();validateConflicts();
  });
  tile.append(art,title,name,input);
  fragment.append(tile);
 }
 grid.append(fragment);
 if(!matched)grid.append(el('div','terror-id-noresults','一致するアイコンがありません'));
 validateConflicts();
}
function open(){
 const api=window.TON_VRC_LOG;
 if(!api?.mappingEntries){info('ID対応機能の読込に失敗しました',true);return}
 edits=new Map(api.mappingEntries().map(row=>[
  String(row.CatalogId).toUpperCase(),{...row,LogId:String(row.LogId||'')}
 ]));
 dirty=false;search.value='';currentGroup=0;
 overlay.hidden=false;document.body.classList.add('terror-id-editor-open');
 renderTabs();renderGrid();updateCount();
 info('画像の下にログの数値IDを入力して保存。未確認の画像は空欄でOK。');
 search.focus();
}
function close(){
 if(dirty&&!window.confirm('IDの変更がまだ保存されていません。閉じますか？'))return;
 overlay.hidden=true;document.body.classList.remove('terror-id-editor-open');
}
function saveRows(){
 if(!validateConflicts())return false;
 const entries=allRows().filter(row=>row.LogId.trim());
 if(!entries.length){info('登録するIDを1件以上入力してね。',true);return false}
 try{
  const api=window.TON_VRC_LOG;
  const result=api.importMappings({Entries:entries});
  if(typeof vrcLogScan!=='undefined'&&vrcLogScan)
   api.applyMappingsToScan(vrcLogScan);
  window.TON_VRC_PANEL?.refreshMappingStatus?.();
  window.TON_VRC_PANEL?.renderScan?.();
  dirty=false;
  info(result.count+'件のID対応を保存したよ。このブラウザでは次回から自動適用される。');
  updateCount();return true;
 }catch(error){info('保存できません: '+(error.message||String(error)),true);return false}
}
function download(){
 if(dirty&&!saveRows())return;
 const entries=window.TON_VRC_LOG?.mappingEntries?.()||[];
 if(!entries.length){info('先にIDを登録・保存してね。',true);return}
 const blob=new Blob([JSON.stringify({Entries:entries},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='terror_log_mappings.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 info('対応表を書き出したよ。サイト全体に組み込む場合は、このファイルを共有してね。');
}
openButton.onclick=open;
closeButton.onclick=close;
save.onclick=saveRows;
exportButton.onclick=download;
search.addEventListener('input',renderGrid);
overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden){e.preventDefault();close()}});
if(typeof terrorSheet!=='undefined'&&typeof terrorSheet.addEventListener==='function')
 terrorSheet.addEventListener('load',()=>{if(!overlay.hidden)renderGrid()});
window.TON_TERROR_ID_EDITOR={open};
})();
