/* Browser-only VRChat output_log reader. Based on ToNRoundRecords/VrcLogDetector.cs.
   File contents never leave the browser; no guessed numeric Terror IDs. */
(function(){
'use strict';
const ROUND_LABELS={
 'クラシック':['Classic',''],'classic':['Classic',''],'normal':['Classic',''],
 'オルタネイト':['Alternate',''],'オルタネート':['Alternate',''],'alternate':['Alternate',''],
 '8pages':['8 Pages',''],'8page':['8 Pages',''],'8ページ':['8 Pages',''],'エイトページ':['8 Pages',''],
 '霧':['Fog',''],'fog':['Fog',''],'ゴースト':['Ghost',''],'ghost':['Ghost',''],
 '狂気':['Cracked',''],'クラックト':['Cracked',''],'クラック':['Cracked',''],'cracked':['Cracked',''],
 'パニッシュ':['Punished',''],'パニッシュド':['Punished',''],'punished':['Punished',''],
 'サボタージュ':['Sabotage',''],'sabotage':['Sabotage',''],
 'ブラッドバス':['Bloodbath','BB'],'bloodbath':['Bloodbath','BB'],
 'ダブルトラブル':['Bloodbath','DT'],'doubletrouble':['Bloodbath','DT'],
 'ブラッドバスex':['Bloodbath','EX'],'bloodbathex':['Bloodbath','EX'],
 'ミッドナイト':['Midnight',''],'midnight':['Midnight',''],
 'アンバウンド':['Unbound',''],'unbound':['Unbound',''],
 'ムーン':['Moon',''],'moon':['Moon',''],'moons':['Moon',''],
 'ミスティックムーン':['Moon','Moon 1'],'mysticmoon':['Moon','Moon 1'],
 'ブラッドムーン':['Moon','Moon 2'],'bloodmoon':['Moon','Moon 2'],
 'トワイライト':['Moon','Moon 3'],'トワイライトムーン':['Moon','Moon 3'],
 'twilight':['Moon','Moon 3'],'twilightmoon':['Moon','Moon 3'],
 'ソルスティス':['Moon','Moon 4'],'ソルスティスムーン':['Moon','Moon 4'],
 'solstice':['Moon','Moon 4'],'solsticemoon':['Moon','Moon 4'],
 'run':['Other','Other 1'],'走れ':['Other','Other 1'],'ラン':['Other','Other 1']
};
const ALT_QUALIFIER=/[（(]\s*(?:Alternate|オルタネイト|オルタネート)\s*[）)]/gi;
const stamp=/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+/;
const roundMap=/This round is taking place at (.+?)\s+\(\d+\)\s+and the round type is\s+(.+?)\s*$/i;
const roundType=/(?:the round type is|Round type is)\s+(.+?)\s*$/i;
const killers=/Killers (?:have been set|have been revealed)\s*-\s*([\d\s]+)\s*\/\//i;
const joined=/(?:\[Behaviour\]\s*)?OnPlayerJoined\s+(.+?)\s+\(usr_[\da-f-]+\)/i;
const left=/(?:\[Behaviour\]\s*)?OnPlayerLeft\s+(.+?)\s+\(usr_[\da-f-]+\)/i;
const death=/\[DEATH\]\[([^\]]+)\]/;
const page=/Page Collected\s*-\s*(\d+)\s*\/\s*8/i;
/* Legacy native app: %LOCALAPPDATA%/ToNRoundRecords/terror_log_mappings.json.
   Imported mappings stay in this browser; they are never uploaded to a server. */
const MAPPING_STORAGE='ton-archive-vrc-id-mapping-v1';
function normalizeMappings(data){
 const rows=Array.isArray(data?.Entries)?data.Entries:Array.isArray(data?.entries)?data.entries:null;
 if(!rows)throw Error('旧ツールのID対応表（Entries）が見つかりません');
 const byScope={Classic:new Map(),Alternate:new Map(),'8 Pages':new Map()};
 const entries=[],known=new Set();
 for(const row of rows){
   if(!row||typeof row!=='object')continue;
   const catalog=String(row.CatalogId??row.catalogId??'').trim().toUpperCase();
   const raw=String(row.LogId??row.logId??'').trim();
   if(!raw)continue;
   const m=/^(T|ALT|8P)(\d{3})$/.exec(catalog);
   if(!m)throw Error('未対応のアイコンID: '+catalog);
   const n=Number(m[2]),limit=m[1]==='T'?134:m[1]==='ALT'?36:7;
   if(n<1||n>limit)throw Error('アイコンIDが範囲外: '+catalog);
   if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))
     throw Error('ログIDが不正です: '+catalog);
   if(known.has(catalog))throw Error('アイコンIDが重複しています: '+catalog);
   known.add(catalog);
   const scope=m[1]==='T'?'Classic':m[1]==='ALT'?'Alternate':'8 Pages';
   const logId=String(Number(raw));
   if(byScope[scope].has(logId))
     throw Error(scope+' のログID '+logId+' が重複しています');
   const iconId=m[1]==='T'?'C'+m[2]:m[1]==='ALT'?'A'+m[2]:'E'+m[2];
   byScope[scope].set(logId,iconId);
   entries.push({CatalogId:catalog,LogId:logId,DisplayName:String(row.DisplayName??row.displayName??'')});
 }
 if(!entries.length)throw Error('登録済みログIDがありません。元ツールの設定ファイルを確認してください');
 return {entries,byScope};
}
let activeMapping=null,mappingWarning='',mappingSource='';
/* Original PNG atlas-order IDs are bundled with the site. Existing manual
   assignments, including special 8 Pages IDs, remain authoritative. */
function combineMappings(manualRows){
 const shipped=window.TON_BUILTIN_TERROR_MAPPING?.Entries||[];
 if(!shipped.length&&!manualRows.length)return null;
 const manuals=manualRows.length?normalizeMappings({Entries:manualRows}).entries:[];
 const editedIds=new Set(manuals.map(row=>row.CatalogId));
 const scopeOf=catalog=>catalog.startsWith('ALT')?'ALT':catalog.startsWith('8P')?'8P':'T';
 const usedNumbers=new Set(manuals.map(row=>scopeOf(row.CatalogId)+':'+row.LogId));
 const combined=[...manuals,...shipped.filter(row=>
   !editedIds.has(row.CatalogId)&&
   !usedNumbers.has(scopeOf(row.CatalogId)+':'+String(Number(row.LogId))))];
 return normalizeMappings({Entries:combined});
}
try{
 const saved=localStorage.getItem(MAPPING_STORAGE);
 const manual=saved?normalizeMappings(JSON.parse(saved)).entries:[];
 activeMapping=combineMappings(manual);
 mappingSource=manual.length?'local':activeMapping?'builtin':'';
}catch(e){
 mappingWarning='保存済みID対応表を読み込めません: '+(e?.message||String(e));
 try{
   activeMapping=combineMappings([]);
   if(activeMapping)mappingSource='builtin';
 }catch(error){mappingWarning+=' / 組込対応表: '+(error?.message||String(error))}
}
function mappingInfo(){
 return {count:activeMapping?.entries.length||0,error:mappingWarning,source:mappingSource};
}
function mappingEntries(){
 return activeMapping?.entries.map(row=>({...row}))||[];
}
function importMappings(data){
 const validated=normalizeMappings(data);
 const combined=combineMappings(validated.entries);
 // Validate the merged result before changing stored mappings.
 localStorage.setItem(MAPPING_STORAGE,JSON.stringify({Entries:validated.entries}));
 activeMapping=combined;mappingWarning='';mappingSource='local';
 return mappingInfo();
}
function lookupTerror(logId,round,variant,position,alternate){
 if(round==='Unbound'){
   const n=Number(logId);
   return Number.isSafeInteger(n)&&n>=0&&n<84?'U'+String(n+1).padStart(3,'0'):null;
 }
 if(!activeMapping)return null;
 const byScope=activeMapping.byScope;
 const key=String(logId);
 let scope=round==='Alternate'?'Alternate':
   round==='Midnight'?(position===2?'Alternate':'Classic'):
   round==='Fog'||round==='Ghost'?(alternate?'Alternate':'Classic'):
   ['Classic','Punished','Cracked','Sabotage','Bloodbath'].includes(round)?'Classic':
   round==='Other'&&['Other 3','Other 4'].includes(variant)?'Classic':null;
 if(scope)return byScope[scope].get(key)||null;
 if(round==='8 Pages'){
   const found=Object.values(byScope).map(map=>map.get(key)).filter(Boolean);
   return found.length===1?found[0]:null;
 }
 return null;
}
function applyMappingToRound(r){
 const numbers=String(r.rawKillerIds||'').trim().split(/\s+/).filter(Boolean);
 const slots=r.round==='Moon'||r.round==='Other'&&!['Other 3','Other 4'].includes(r.variant)?0:
   r.round==='Midnight'?3:r.round==='Bloodbath'?
   (r.variant==='DT'?2:r.variant==='EX'?1:3):1;
 r.terrors=[];r.terrorSlots=[];r.unmappedKillerIds=[];
 for(let i=0;i<slots;i++){
   const raw=numbers[i],number=Number(raw);
   if(raw==null||!/^\d+$/.test(raw)||!Number.isSafeInteger(number)){
     r.terrorSlots.push(null);continue;
   }
   const id=lookupTerror(String(number),r.round,r.variant,i,r.alternate);
   r.terrorSlots.push(id);
   if(id){if(!r.terrors.includes(id))r.terrors.push(id);}
   else if(!r.unmappedKillerIds.includes(String(number)))r.unmappedKillerIds.push(String(number));
 }
 return r;
}
function applyMappingsToScan(scan){
 if(scan&&Array.isArray(scan.rounds))scan.rounds.forEach(applyMappingToRound);
 return scan;
}
function normalized(s){return String(s||'').replace(ALT_QUALIFIER,'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')}
function mapLookup(name,maps){
 const value=String(name||'').trim().toLowerCase();
 if(!value)return '';
 // Match native CatalogRepository: first matching map in catalog order.
 // Names are not unique (e.g. M13 and M23 are both "Neon Towers").
 const match=Object.entries(maps||{}).find(([,v])=>String(v.name||'').trim().toLowerCase()===value);
 return match?match[0]:'';
}
function parseTimestamp(line){
 const m=stamp.exec(line);if(!m)return null;
 const [year,month,day,hour,minute,second]=m.slice(1).map(Number);
 const date=new Date(year,month-1,day,hour,minute,second);
 if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)return null;
 const iso=m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6];
 return {ms:date.getTime(),iso};
}
function analyze(contents,filename,maps){
 if(typeof contents!=='string')throw Error('ログの内容が不正です');
 const source=String(filename||'output_log.txt').replace(/[\\/]/g,'_');
 // Native VrcLogDetector uses StringComparer.OrdinalIgnoreCase for names.
 const playerKey=name=>String(name||'').trim().toLowerCase();
 const present=new Set(),rounds=[];
 let active=null,pendingStart=false,index=0,lines=0,joins=0,deaths=0;
 function begin(time){
   index++;
   return {start:time.iso,startMs:time.ms,spawnMs:null,endMs:null,ended:false,
     roundType:'',mapName:'',rawKillerIds:'',alternate:false,
     observed:new Set(present),deathNames:new Set(),sawRoster:present.size>0,
     peak:present.size,pages:0,localDied:false,explicitWon:false,localWon:false,
     roundValid:false,respawn:false,sourceLogKey:source+'|'+time.iso+'.0000000|'+index};
 }
 function finish(r){
   if(!r)return;
   const choice=ROUND_LABELS[normalized(r.roundType)]||['',''];
   r.round=choice[0];r.variant=choice[1];
   const numbers=r.rawKillerIds.trim()?r.rawKillerIds.trim().split(/\s+/).map(Number):[];
   if(r.round==='Bloodbath'&&r.variant!=='DT'){
     if(numbers.length===3&&numbers.every(n=>n===numbers[0]))r.variant='EX';
     else if(r.variant==='EX')r.variant='BB';
   }
   r.map=mapLookup(r.mapName,maps);
   applyMappingToRound(r);
   r.durationSeconds=r.endMs==null?null:Math.max(0,Math.floor((r.endMs-(r.spawnMs??r.startMs))/1000));
   r.estimatedPlayers=r.sawRoster?Math.max(r.peak,r.observed.size):null;
   r.estimatedSurvivors=r.estimatedPlayers==null?null:Math.max(0,r.estimatedPlayers-r.deathNames.size);
   let survival=0,failed=0;
   if(r.ended){
     if(r.round!=='8 Pages'&&r.estimatedSurvivors!=null){
       if(r.estimatedSurvivors>0)survival++;else failed++;
     }
     const secs=r.durationSeconds??0;
     if(r.round==='8 Pages'){if(secs>=50)survival++;else failed++}
     else if(r.round==='Other'&&r.variant==='Other 1'){if(secs>=95)survival++;else failed++}
     else if(r.round==='Moon'){if(secs===(r.variant==='Moon 2'?100:250)||secs>(r.variant==='Moon 2'?100:250))survival++;else failed++}
     else if(['Classic','Alternate','Fog','Ghost','Punished','Cracked','Sabotage','Bloodbath','Midnight','Unbound'].includes(r.round)){
       if(secs>=170)survival++;
       if(secs<=100)failed++;
       if(secs<=80)failed++;
     }else{if(secs>=170)survival++;else failed++}
   }
   r.status=!r.ended?'途中・不明':survival-failed>0?'要確認':'勝利未確認';
   // Estimates are not certified player counts. The UI marks them as such.
   rounds.push(r);
 }
 const rows=contents.split(/\r?\n/);
 for(const line of rows){
   lines++;
   const time=parseTimestamp(line);if(!time)continue;
   if(/\[Behaviour\] OnPlayerLeftRoom/i.test(line)&&/local player|LocalPlayer/i.test(line))present.clear();
   const join=joined.exec(line);
   if(join){
     const name=join[1].trim();present.add(playerKey(name));joins++;
     if(active&&!active.ended){active.sawRoster=true;active.peak=Math.max(active.peak,present.size);active.observed.add(playerKey(name))}
   }
   const leave=left.exec(line);
   if(leave){
     if(active&&!active.ended){active.sawRoster=true;active.peak=Math.max(active.peak,present.size)}
     present.delete(playerKey(leave[1]));
   }
   if(/Everything recieved, looks good to meee~!/i.test(line)){
     finish(active);active=begin(time);pendingStart=true;continue;
   }
   const map=roundMap.exec(line);
   if(map){
     if(!active||(active.ended&&!pendingStart)){finish(active);active=begin(time)}
     active.mapName=map[1].trim();active.roundType=map[2].trim();
     active.alternate=ALT_QUALIFIER.test(active.roundType);ALT_QUALIFIER.lastIndex=0;
     pendingStart=false;
   }
   if(!active)continue;
   const type=roundType.exec(line);
   if(type&&!active.roundType)active.roundType=type[1].trim();
   const killer=killers.exec(line);
   if(/Killers (?:have been set|have been revealed|is unknown)/i.test(line)&&/^(?:霧|ゴースト|Fog|Ghost)/i.test(active.roundType)){
     active.alternate=ALT_QUALIFIER.test(line);ALT_QUALIFIER.lastIndex=0;
   }
   if(killer){
     active.spawnMs??=time.ms;
     const raw=killer[1].trim();
     if(/^\d+(?:\s+\d+){0,2}$/.test(raw))active.rawKillerIds=raw;
   }
   if(/Killers is unknown/i.test(line))active.spawnMs??=time.ms;
   const d=death.exec(line);
   if(d&&!active.ended){active.deathNames.add(playerKey(d[1]));active.observed.add(playerKey(d[1]));deaths++}
   if(!active.ended&&/You died\.|You Died iN the Round/i.test(line))active.localDied=true;
   if(/respawned|Respawned\? Coward/i.test(line))active.respawn=true;
   if(/WE WON/i.test(line))active.explicitWon=true;
   if(/Player Won, not killer/i.test(line))active.localWon=true;
   if(/Round was valid\./i.test(line))active.roundValid=true;
   const pg=page.exec(line);if(pg&&!active.ended)active.pages=Math.max(active.pages,Math.min(8,Number(pg[1])));
   if(/RoundOver/i.test(line)){active.endMs??=time.ms;active.ended=true}
 }
 finish(active);
 return {rounds,lines,joins,deaths};
}
window.TON_VRC_LOG={analyze,importMappings,applyMappingsToScan,mappingInfo,mappingEntries};
})();