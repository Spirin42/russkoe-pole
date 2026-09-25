(async function () {
  'use strict';
  const {W,H,WORLD,describe,Renderer,Surface,clamp} = Pole;
  const $=id=>document.getElementById(id);
  const field=$('field'),about=$('about');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse=matchMedia('(pointer: coarse)').matches;
  const MIN_ZOOM=.18,HOME_ZOOM=.19,ZOOM_REVISION=4;
  const view={width:innerWidth,height:innerHeight,cx:W/2,cy:H/2,zoom:HOME_ZOOM,dpr:Math.min(devicePixelRatio||1,3)};
  const safeZoom=value=>Number.isFinite(value)&&value>0?Math.max(MIN_ZOOM,value):view.zoom;
  const storeKey=WORLD+':lights',cameraKey=WORLD+':camera',pendingKey=WORLD+':pending';
  const local=new Map(),remote=new Map(),versions=new Map(),confirmed=new Set(),pendingSnapshots=new Map();
  const pointers=new Map(),keys=new Set(),outbox=[];
  let surface,busy=false,frame=0,lastTime=0,dirty=true,velocity={x:0,y:0},drag=null,pinch=null,multi=false;
  let pointerMoved=false,noticeTimer,cameraTimer,localTimer,viewportTimer,viewportAbort;
  let mode='local',stream=null,streamTimer,pollTimer,sending=false,remoteReady=false;
  let storageOK=true,channel=null,activeBounds=null,activeSnapshot=null,loadSerial=0;
  const MAX_COORD=2000000000;
  const coordinateFormat=new Intl.NumberFormat('ru-RU'),zoomFormat=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
  let lastLabelX,lastLabelY,lastLabelZoom;
  function validCoord(n){return Number.isInteger(n)&&Math.abs(n)<=MAX_COORD;}
  function safeRead(k){try{return JSON.parse(localStorage.getItem(k));}catch{return null;}}
  try {
    const saved=safeRead(storeKey);
    if(Array.isArray(saved))for(const [k,v]of saved){const p=k.split(',').map(Number);if(p.length===2&&p.every(validCoord)&&typeof v==='boolean')local.set(k,v);}
    const c=safeRead(cameraKey);
    if(c&&Number.isFinite(c.cx)&&Number.isFinite(c.cy)&&Math.abs(c.cx)<MAX_COORD*W&&Math.abs(c.cy)<MAX_COORD*H){
      view.cx=c.cx;view.cy=c.cy;
      const previous=Number(c.zoom)||HOME_ZOOM;
      view.zoom=safeZoom(previous);
    }
  }catch{}
  function tell(text,ms=2400){$('notice').textContent=text;$('notice').classList.add('visible');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').classList.remove('visible'),ms);}
  function invalidate(){dirty=true;if(!frame)frame=requestAnimationFrame(tick);}
  function state(d){
    if(d.blank)return false;
    if(mode==='local')return local.get(d.id)??d.defaultOn;
    let on=remote.get(d.id)??d.defaultOn;
    for(const p of outbox)if(p.x===d.x&&p.y===d.y&&!confirmed.has(p.id))on=!on;
    return on;
  }
  function changed(d,before){if(before!==state(d))surface?.invalidate(d.x,d.y);invalidate();}
  function saveLocal(){clearTimeout(localTimer);localTimer=setTimeout(()=>{try{localStorage.setItem(storeKey,JSON.stringify([...local]));}catch{if(storageOK)tell('Браузер не разрешил сохранить изменения.');storageOK=false;}},80);}
  function savePending(){try{localStorage.setItem(pendingKey,JSON.stringify(outbox));}catch{}}
  function saveCamera(){clearTimeout(cameraTimer);cameraTimer=setTimeout(()=>{try{localStorage.setItem(cameraKey,JSON.stringify({cx:view.cx,cy:view.cy,zoom:view.zoom,zoomRevision:ZOOM_REVISION}));}catch{}},300);}
  try{channel=new BroadcastChannel(WORLD);channel.onmessage=e=>{const {x,y,on}=e.data||{};if(mode!=='local'||!validCoord(x)||!validCoord(y)||typeof on!=='boolean')return;const d=describe(x,y),before=state(d);local.set(d.id,on);changed(d,before);};}catch{}
  addEventListener('storage',e=>{if(e.key!==storeKey||mode!=='local')return;const entries=safeRead(storeKey);if(!Array.isArray(entries))return;for(const [id,on]of entries){if(typeof on!=='boolean')continue;const [x,y]=id.split(',').map(Number);if(!validCoord(x)||!validCoord(y))continue;const d=describe(x,y),before=state(d);local.set(id,on);changed(d,before);}});
  function setMode(next){
    if((mode==='local')!==(next==='local'))surface?.reset();
    mode=next;
    $('mode').classList.toggle('connected',next==='online');$('mode').classList.toggle('pending',next==='connecting'||next==='offline');
    $('mode').hidden=next==='local';
    $('mode-label').textContent=next==='online'?'Общее поле':next==='connecting'?'Соединение…':next==='offline'?'Связь прервана':'';
    $('connection-title').textContent=next==='online'?'Одно поле для всех':next==='offline'?'Соединение восстанавливается':next==='connecting'?'Подключаемся к общему полю':'Локальное поле';
    $('connection-detail').textContent=next==='online'?'Свет меняется одновременно у всех, кто открыл этот сервер. Все изменения сохраняются.':next==='offline'?'Ваши нажатия будут отправлены после восстановления связи. Новые участки поля обновятся при подключении.':next==='connecting'?'Загружаем состояния окон.': 'Ваши изменения сохраняются в этом браузере. Общая карта доступна при запуске вместе с сервером проекта.';
    invalidate();
  }
  async function toggle(x,y){
    if(!validCoord(x)||!validCoord(y))return;
    const d=describe(x,y);
    if(d.blank)return;
    const before=state(d);
    if(mode==='local'){
      local.set(d.id,!before);saveLocal();channel?.postMessage({x,y,on:!before});changed(d,before);
    }else{
      if(outbox.length>=100){tell('Дождитесь восстановления связи.');return;}
      // The server performs an atomic toggle, not a last-write-wins guessed value.
      outbox.push({x,y,id:crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`});savePending();changed(d,before);flush();
    }
    if(document.body.classList.contains('keyboard'))tell(!before?'Свет включен':'Свет выключен',1000);
  }
  let lastRevision=0;
  function applyCell(record){
    if(!validCoord(record.x)||!validCoord(record.y)||typeof record.on!=='boolean')return;
    const d=describe(record.x,record.y),before=state(d);
    if(record.operation&&outbox.some(p=>p.id===record.operation))confirmed.add(record.operation);
    // Per-cell versions reject late HTTP replies and overlapping older snapshots.
    const floor=activeSnapshot&&inside(activeSnapshot.box,record.x,record.y)?activeSnapshot.revision:0;
    if((record.revision||0)>=Math.max(versions.get(d.id)||0,floor)){
      remote.set(d.id,record.on);versions.set(d.id,record.revision||0);
    }
    changed(d,before);lastRevision=Math.max(lastRevision,record.revision||0);
  }
  async function flush(){
    if(sending||!outbox.length||mode==='local')return;sending=true;
    try{
      while(outbox.length){
        const item=outbox[0];
        const response=await fetch('/api/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item),signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw Error('toggle');const result=await response.json();
        applyCell(result);outbox.shift();confirmed.delete(item.id);
        const id=`${item.x},${item.y}`,snapshot=pendingSnapshots.get(id);
        if(snapshot&&!outbox.some(p=>p.x===item.x&&p.y===item.y&&!confirmed.has(p.id))){pendingSnapshots.delete(id);applyCell(snapshot);}
        savePending();invalidate();
      }
    }catch{setMode('offline');clearTimeout(streamTimer);streamTimer=setTimeout(reconnect,2500);}
    finally{sending=false;}
  }
  function bounds(){
    const x=Math.floor(view.cx/W),y=Math.floor(view.cy/H),rx=Math.ceil(view.width/(2*view.zoom*W))+3,ry=Math.ceil(view.height/(2*view.zoom*H))+3;
    return {x0:x-rx,x1:x+rx,y0:y-ry,y1:y+ry};
  }
  function sameBounds(a,b){return a&&b&&a.x0===b.x0&&a.y0===b.y0&&a.x1===b.x1&&a.y1===b.y1;}
  function inside(box,x,y){return x>=box.x0&&x<=box.x1&&y>=box.y0&&y<=box.y1;}
  async function loadViewport(force=false){
    if(mode==='local')return;const box=bounds();if(!force&&sameBounds(box,activeBounds))return;
    activeBounds=box;const serial=++loadSerial;
    viewportAbort?.abort();viewportAbort=new AbortController();
    try{
      const response=await fetch('/api/cells?'+new URLSearchParams(box),{signal:viewportAbort.signal,cache:'no-store'});
      if(!response.ok)throw Error('snapshot');const data=await response.json();
      if(serial!==loadSerial)return;
      // Keep untouched apartments implicit, even when millions are visible.
      // The snapshot revision rejects old events for those implicit defaults too.
      activeSnapshot={box,revision:data.revision};
      const records=new Map(data.cells.map(c=>[`${c.x},${c.y}`,{...c,revision:data.revision}]));
      for(const id of remote.keys()){
        const [x,y]=id.split(',').map(Number);
        if(inside(box,x,y)&&!records.has(id))records.set(id,{x,y,on:describe(x,y).defaultOn,revision:data.revision});
      }
      for(const p of outbox){const id=`${p.x},${p.y}`;if(inside(box,p.x,p.y)&&!records.has(id))records.set(id,{x:p.x,y:p.y,on:describe(p.x,p.y).defaultOn,revision:data.revision});}
      for(const record of records.values()){
        if(outbox.some(p=>p.x===record.x&&p.y===record.y&&!confirmed.has(p.id)))pendingSnapshots.set(`${record.x},${record.y}`,record);
        else applyCell(record);
      }
      lastRevision=Math.max(lastRevision,data.revision);remoteReady=true;setMode('online');connectStream(box,data.revision);flush();
      // Bounded in-memory state. The database is the durable record of distant cells.
      if(remote.size>10000)for(const id of remote.keys()){const [x,y]=id.split(',').map(Number);if(x<box.x0-20||x>box.x1+20||y<box.y0-20||y>box.y1+20){remote.delete(id);versions.delete(id);surface?.invalidate(x,y);}}
    }catch(e){if(e.name==='AbortError')return;activeBounds=null;setMode('offline');clearTimeout(streamTimer);streamTimer=setTimeout(reconnect,2000);}
  }
  function connectStream(box,revision){
    stream?.close();
    stream=new EventSource('/api/events?'+new URLSearchParams({...box,since:revision}));
    stream.addEventListener('cell',e=>{try{applyCell(JSON.parse(e.data));}catch{}});
    stream.addEventListener('reset',()=>{activeBounds=null;loadViewport(true);});
    stream.onopen=()=>{setMode('online');flush();};
    stream.onerror=()=>{setMode('offline');};
  }
  function reconnect(){if(document.hidden||mode==='local')return;activeBounds=null;loadViewport(true);}
  function viewportChanged(){saveCamera();clearTimeout(viewportTimer);if(mode!=='local')viewportTimer=setTimeout(()=>loadViewport(),150);}
  async function detectServer(){
    if(!/^https?:$/.test(location.protocol))return;
    try{
      const response=await fetch('/api/meta',{signal:AbortSignal.timeout(2500),cache:'no-store'});
      if(!response.ok)return;const meta=await response.json();if(meta.world!==WORLD)return;
      const pending=safeRead(pendingKey);
      if(Array.isArray(pending))for(const p of pending.slice(0,100))if(validCoord(p.x)&&validCoord(p.y)&&typeof p.id==='string'&&/^[A-Za-z0-9-]{10,100}$/.test(p.id))outbox.push(p);
      setMode('connecting');await loadViewport(true);
      pollTimer=setInterval(()=>{if(!document.hidden)loadViewport(true);},20000);
    }catch{}
  }
  function resize(){
    view.width=innerWidth;view.height=innerHeight;view.dpr=Math.min(devicePixelRatio||1,3);
    clampCamera();invalidate();viewportChanged();
  }
  function clampCamera(){const mx=Math.ceil(view.width/(2*view.zoom*W))+4,my=Math.ceil(view.height/(2*view.zoom*H))+4;view.cx=clamp(view.cx,(-MAX_COORD+mx)*W,(MAX_COORD-mx)*W);view.cy=clamp(view.cy,(-MAX_COORD+my)*H,(MAX_COORD-my)*H);}
  function worldAt(x,y){return {x:view.cx+(x-view.width/2)/view.zoom,y:view.cy+(y-view.height/2)/view.zoom};}
  function zoomAt(value,x=view.width/2,y=view.height/2){const a=worldAt(x,y);view.zoom=safeZoom(value);view.cx=a.x-(x-view.width/2)/view.zoom;view.cy=a.y-(y-view.height/2)/view.zoom;clampCamera();invalidate();viewportChanged();}
  function interacted(){document.body.classList.remove('keyboard');}
  function pinchInfo(){const a=[...pointers.values()];return {x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2,d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)};}
  field.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.pointerType==='mouse')return;
    e.preventDefault();field.focus({preventScroll:true});field.setPointerCapture(e.pointerId);
    interacted();velocity.x=velocity.y=0;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1){multi=false;pointerMoved=false;drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,time:e.timeStamp,start:e.timeStamp};}
    else if(pointers.size===2){multi=true;pinch=pinchInfo();drag=null;}
    field.classList.add('dragging');
  });
  field.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;e.preventDefault();
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size>=2){const now=pinchInfo();if(pinch&&pinch.d>0){const a=worldAt(pinch.x,pinch.y);view.zoom=safeZoom(view.zoom*now.d/pinch.d);view.cx=a.x-(now.x-view.width/2)/view.zoom;view.cy=a.y-(now.y-view.height/2)/view.zoom;}pinch=now;pointerMoved=true;}
    else if(drag){
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y,dt=Math.max(8,e.timeStamp-drag.time);
      if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>(coarse?8:5))pointerMoved=true;
      if(pointerMoved){view.cx-=dx/view.zoom;view.cy-=dy/view.zoom;velocity.x=velocity.x*.35+(-dx/view.zoom/dt)*.65;velocity.y=velocity.y*.35+(-dy/view.zoom/dt)*.65;}
      drag.x=e.clientX;drag.y=e.clientY;drag.time=e.timeStamp;
    }
    clampCamera();invalidate();viewportChanged();
  });
  function release(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;
    if(!cancelled&&!multi&&!pointerMoved&&drag&&e.timeStamp-drag.start<650){const p=worldAt(e.clientX,e.clientY);toggle(Math.floor(p.x/W),Math.floor(p.y/H));}
    if(cancelled||multi||reduced||!drag||e.timeStamp-drag.time>90)velocity.x=velocity.y=0;
    pointers.delete(e.pointerId);pinch=null;
    if(pointers.size===1){const p=[...pointers.values()][0];drag={...p,startX:p.x,startY:p.y,time:e.timeStamp,start:e.timeStamp};pointerMoved=true;}
    else if(!pointers.size){drag=null;field.classList.remove('dragging');}
    invalidate();viewportChanged();
  }
  field.addEventListener('pointerup',e=>release(e));field.addEventListener('pointercancel',e=>release(e,true));
  field.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))release(e,true);});
  field.addEventListener('contextmenu',e=>e.preventDefault());
  field.addEventListener('wheel',e=>{e.preventDefault();interacted();velocity.x=velocity.y=0;const units=e.deltaMode===1?16:e.deltaMode===2?view.height:1;zoomAt(view.zoom*Math.exp(-e.deltaY*units*.0012),e.clientX,e.clientY);},{passive:false});
  addEventListener('keydown',e=>{
    if(about.open||e.target.closest('input,textarea,select'))return;
    if(e.target.closest('button')&&['Enter',' '].includes(e.key))return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();keys.add(e.key);document.body.classList.add('keyboard');invalidate();}
    else if(e.key==='+'||e.key==='='){e.preventDefault();zoomAt(view.zoom*1.15);}
    else if(e.key==='-'){e.preventDefault();zoomAt(view.zoom/1.15);}
    else if(e.key==='Home'){e.preventDefault();home();}
    else if((e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();document.body.classList.add('keyboard');toggle(Math.floor(view.cx/W),Math.floor(view.cy/H));}
    else if(e.key==='Escape'){document.body.classList.remove('keyboard');}
  });
  addEventListener('keyup',e=>keys.delete(e.key));
  function stop(){keys.clear();pointers.clear();velocity.x=velocity.y=0;drag=null;pinch=null;field.classList.remove('dragging');}
  addEventListener('blur',stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();stream?.close();}else{invalidate();reconnect();}});
  addEventListener('online',reconnect);
  addEventListener('pagehide',()=>{try{localStorage.setItem(storeKey,JSON.stringify([...local]));}catch{}stream?.close();});
  function home(){velocity.x=velocity.y=0;view.cx=W/2;view.cy=H/2;view.zoom=HOME_ZOOM;invalidate();viewportChanged();field.focus({preventScroll:true});}
  function openAbout(){stop();about.showModal();} $('mode').onclick=openAbout;$('project-info').onclick=openAbout;$('close-about').onclick=()=>about.close();
  about.addEventListener('click',e=>{if(e.target!==about)return;const r=about.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)about.close();});
  addEventListener('resize',resize);
  function tick(time){
    frame=0;const dt=Math.min(40,lastTime?time-lastTime:16);lastTime=time;
    let moving=false;
    if(!pointers.size&&(Math.abs(velocity.x)+Math.abs(velocity.y)>.012)){
      // A fling slows down to what is already prepared instead of outrunning the painting.
      const dx=velocity.x*dt,dy=velocity.y*dt,t=surface?surface.reach(view,dx,dy):1;
      view.cx+=dx*t;view.cy+=dy*t;if(t<1){velocity.x*=t;velocity.y*=t;}
      const f=Math.exp(-dt/150);velocity.x*=f;velocity.y*=f;moving=true;
    }
    if(keys.size){const dx=Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),dy=Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'));const norm=dx&&dy?Math.SQRT1_2:1;view.cx+=dx*.59*dt/view.zoom*norm;view.cy+=dy*.59*dt/view.zoom*norm;moving=true;}
    if(moving){clampCamera();dirty=true;viewportChanged();}
    if(surface&&(dirty||busy)){
      // The surface keeps painting in small portions until the frame and its neighbours are ready.
      busy=surface.update(view,state,time);dirty=false;
      // The title moves from the centre to its corner once the facade is complete.
      if(surface.shown&&document.body.classList.contains('loading'))document.body.classList.remove('loading');
      const x=Math.floor(view.cx/W),y=Math.floor(view.cy/H);
      if(x!==lastLabelX||y!==lastLabelY){$('coordinates').textContent=`${coordinateFormat.format(x)} · ${coordinateFormat.format(-y||0)}`;lastLabelX=x;lastLabelY=y;}
      if(view.zoom!==lastLabelZoom){$('scale-label').textContent=`${zoomFormat.format(view.zoom*100)}%`;lastLabelZoom=view.zoom;}
      if(document.body.classList.contains('keyboard')){const f=$('focus-cell');f.style.left=`${(x*W-view.cx)*view.zoom+view.width/2}px`;f.style.top=`${(y*H-view.cy)*view.zoom+view.height/2}px`;f.style.width=`${W*view.zoom}px`;f.style.height=`${H*view.zoom}px`;}
    }
    if(moving||keys.size||busy)frame=requestAnimationFrame(tick);
  }
  try {
    const data=JSON.parse($('texture-data').textContent),images={};
    await Promise.all(Object.entries(data).map(([key,src])=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{images[key]=im;resolve();};im.onerror=reject;im.src=src;})));
    const renderer=new Renderer(images,(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},{dpr:view.dpr});
    surface=new Surface(renderer,$('tiles'),{maxResolution:4,budget:(coarse?112:256)*1024*1024});
    // Release embedded base64 text after decoding; the images remain alive in the renderer.
    $('texture-data').remove();resize();await detectServer();
  }catch(e){console.error(e);tell('Не удалось открыть фактуры. Перезагрузите страницу.',15000);}
  if(document.modelContext?.registerTool){
    try{document.modelContext.registerTool({name:'navigate_field',title:'Переместиться по полю',description:'Move the visible field to apartment coordinates.',inputSchema:{type:'object',properties:{x:{type:'integer'},y:{type:'integer'}},required:['x','y'],additionalProperties:false},annotations:{readOnlyHint:true},execute:({x,y})=>{if(!validCoord(x)||!validCoord(y))throw Error('Invalid coordinates');view.cx=(x+.5)*W;view.cy=(y+.5)*H;invalidate();viewportChanged();return{x,y};}});
    document.modelContext.registerTool({name:'toggle_apartment_light',title:'Переключить свет',description:'Toggle light in an apartment in the same shared field as the visible interface.',inputSchema:{type:'object',properties:{x:{type:'integer'},y:{type:'integer'}},required:['x','y'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async({x,y})=>{if(!validCoord(x)||!validCoord(y))throw Error('Invalid coordinates');await toggle(x,y);return{x,y,on:state(describe(x,y)),pending:mode!=='local'&&outbox.some(p=>p.x===x&&p.y===y)};}});}catch{}
  }
})();
