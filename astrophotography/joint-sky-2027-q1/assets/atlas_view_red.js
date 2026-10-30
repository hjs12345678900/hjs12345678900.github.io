/* WCS-consistent live DSS map, with a fully local CAR preview fallback. */
(function(){
const M=window.SkyModel,host=document.getElementById('sky'),offline=document.getElementById('offline'),mask=document.getElementById('mask'),frames=document.getElementById('frames');
const controls={month:document.getElementById('month'),height:document.getElementById('height'),moon:document.getElementById('moon'),mode:document.getElementById('mode'),minimum:document.getElementById('minimum'),angle:document.getElementById('angle')};
let atlas=null,live=false,picked=null,selected=[],queued=false,view={ra:140,dec:0,fov:300},down=null;
const photo=new Image();photo.src=document.getElementById('offline-photo').src;
const rad=Math.PI/180;const cameras=[['A',750,3856,2180,2.9,'#00e5ff'],['B',1600,6252,4176,3.76,'#ff9c32'],['C',264,3856,2180,2.9,'#ff40e6']];
function state(){return{month:controls.month.value,height:+controls.height.value,moon:controls.moon.checked,mode:controls.mode.value,minimum:+controls.minimum.value,angle:+controls.angle.value};}
function dimensions(){const r=host.getBoundingClientRect();return[r.width,r.height];}
function pixel(x,y){if(live){try{return atlas.pix2world(x,y);}catch(e){return null;}}const[w,h]=dimensions();return[M.mod(view.ra+(w/2-x)*view.fov/w,360),view.dec+(h/2-y)*view.fov/w];}
function world(ra,dec){if(live){try{return atlas.world2pix(ra,dec);}catch(e){return null;}}const[w,h]=dimensions();const dx=M.mod(view.ra-ra+180,360)-180;return[w/2+dx*w/view.fov,h/2+(view.dec-dec)*w/view.fov];}
function fallback(){
 const[w,h]=dimensions();offline.width=Math.round(w);offline.height=Math.round(h);const c=offline.getContext('2d');c.fillStyle='#05080d';c.fillRect(0,0,w,h);
 if(!photo.complete||!photo.naturalWidth)return;
 const scale=w/view.fov,top=h/2+(view.dec-30)*scale;
 for(let shift=-360;shift<=360;shift+=360){const left=w/2+(view.ra-360+shift)*scale;c.drawImage(photo,left,top,360*scale,60*scale);}
}
function cameraBoundary(ra,dec,cam,angle){
 const a=cam[2]*cam[4]/1000/(2*cam[1]),b=cam[3]*cam[4]/1000/(2*cam[1]),ar=angle*rad,rr=ra*rad,dd=dec*rad;
 const C=[Math.cos(dd)*Math.cos(rr),Math.cos(dd)*Math.sin(rr),Math.sin(dd)],E=[-Math.sin(rr),Math.cos(rr),0],N=[-Math.sin(dd)*Math.cos(rr),-Math.sin(dd)*Math.sin(rr),Math.cos(dd)],out=[];
 const xy=[];for(let k=0;k<=40;k++){const t=-1+k/20;xy.push([a*t,-b]);}for(let k=0;k<=40;k++)xy.push([a,-b+k*b/20]);for(let k=0;k<=40;k++)xy.push([a-k*a/20,b]);for(let k=0;k<=40;k++)xy.push([-a,b-k*b/20]);
 for(const[x,y]of xy){const e=x*Math.cos(ar)-y*Math.sin(ar),n=x*Math.sin(ar)+y*Math.cos(ar),v=C.map((z,i)=>z+e*E[i]+n*N[i]),len=Math.hypot(...v);out.push([M.mod(Math.atan2(v[1],v[0])/rad,360),Math.asin(v[2]/len)/rad]);}return out;
}
function drawFrames(){
 const[w,h]=dimensions(),dpr=devicePixelRatio||1;frames.width=Math.round(w*dpr);frames.height=Math.round(h*dpr);const c=frames.getContext('2d');c.scale(dpr,dpr);if(!picked)return;
 for(const cam of cameras){c.strokeStyle=cam[5];c.lineWidth=2;c.setLineDash(cam[0]==='B'?[7,5]:[]);c.beginPath();let begun=false;
  for(const p of cameraBoundary(picked.ra,picked.dec,cam,state().angle)){const q=world(...p);if(!q){begun=false;continue;}if(!begun){c.moveTo(...q);begun=true;}else c.lineTo(...q);}c.closePath();c.stroke();}
 c.setLineDash([]);const p=world(picked.ra,picked.dec);if(p){c.strokeStyle='white';c.beginPath();c.moveTo(p[0]-7,p[1]);c.lineTo(p[0]+7,p[1]);c.moveTo(p[0],p[1]-7);c.lineTo(p[0],p[1]+7);c.stroke();}
}
function redraw(){
 queued=false;const[w,h]=dimensions();if(!live)fallback();const s=state(),mw=320,mh=Math.max(70,Math.round(mw*h/w));mask.width=mw;mask.height=mh;
 const c=mask.getContext('2d'),im=c.createImageData(mw,mh);let passing=0;
 for(let j=0;j<mh;j++)for(let i=0;i<mw;i++){const p=pixel((i+.5)*w/mw,(j+.5)*h/mh);let yes=false;if(p&&Math.abs(p[1])<=90){const v=M.evaluate(p[0],p[1],s);yes=!v.outside&&(s.mode==='common'?v.common:v.simultaneous)>=s.minimum;}
 const n=(j*mw+i)*4;im.data[n]=3;im.data[n+1]=7;im.data[n+2]=13;im.data[n+3]=yes?0:235;if(yes)passing++;}c.putImageData(im,0,0);drawFrames();
 document.getElementById('minimum-value').textContent=s.minimum+' h';document.getElementById('scope').textContent=s.mode==='common'?'亮区：两站各自都达到门槛，可分别累计':'亮区：两站在同一UTC时刻同时满足条件';
 document.getElementById('map-status').textContent=(live?'在线 DSS2 Red（放大后逐步加载细节）':'内置 DSS2 Red 全天预览（约7′有效采样）')+' · 北上东左 · 点击选点';
 if(picked)showPoint();window.atlasQA={state:s,passingMaskPixels:passing,maskPixels:mw*mh,live,geometry:{width:w,height:h},center:live?atlas.getRaDec():[view.ra,view.dec]};
}
function request(){if(!queued){queued=true;setTimeout(redraw,90);}}
function showPoint(){
 const s=state(),v=M.evaluate(picked.ra,picked.dec,s),box=document.getElementById('point');
 if(v.outside){box.textContent=`ICRS ${picked.ra.toFixed(5)}°, ${picked.dec.toFixed(5)}°：在本次共同天区规划带外。`;document.getElementById("window").textContent="";document.getElementById("add-point").disabled=true;document.getElementById("zoom-point").disabled=false;return;}
 let text=`ICRS ${picked.ra.toFixed(5)}°, ${picked.dec.toFixed(5)}° ｜ 甘肃 ${v.gansu.toFixed(1)}h ｜ ASV ${v.asv.toFixed(1)}h ｜ 两站工时 ${(v.gansu+v.asv).toFixed(1)}h ｜ 真正同时 ${v.simultaneous.toFixed(1)}h`;
 box.textContent=text;const details=[];for(const site of ['gansu','asv']){const r=M.longest(picked.ra,picked.dec,s,site);details.push(r?`${site==='gansu'?'甘肃':'ASV'}最长 ${r.hours.toFixed(2)}h：${M.night(r.start,site)} 晚，${M.local(r.start,site)} → ${M.local(r.end,site)}`:`${site}无合格窗口`);}document.getElementById('window').textContent=details.join('\n');
 document.getElementById('zoom-point').disabled=false;document.getElementById('add-point').disabled=false;
}
function pick(ra,dec){picked={ra:M.mod(ra,360),dec};showPoint();drawFrames();}
function zoomToPoint(){if(!picked)return;if(live){atlas.gotoRaDec(picked.ra,picked.dec);atlas.setFoV(4);}else{view={...view,ra:picked.ra,dec:picked.dec,fov:4};}request();}
function addPoint(){if(!picked)return;const s=state(),v=M.evaluate(picked.ra,picked.dec,s);selected.push({name:'P'+String(selected.length+1).padStart(3,'0'),ra_deg:picked.ra,dec_deg:picked.dec,...s,gansu_hours:v.gansu,asv_hours:v.asv,simultaneous_hours:v.simultaneous});document.getElementById('saved-count').textContent=`已选 ${selected.length} 处`;document.getElementById('export').disabled=false;}
function exportPoints(){const names=Object.keys(selected[0]),csv='\ufeff'+[names.join(','),...selected.map(p=>names.map(k=>JSON.stringify(p[k])).join(','))].join('\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='my_joint_sky_selections_2027Q1.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
Object.values(controls).forEach(c=>c.addEventListener('change',request));controls.minimum.addEventListener('input',request);
photo.onload=request;new ResizeObserver(request).observe(host);
document.getElementById('zoom-point').onclick=zoomToPoint;document.getElementById('add-point').onclick=addPoint;document.getElementById('export').onclick=exportPoints;
document.getElementById('reset').onclick=()=>{if(live){atlas.gotoRaDec(140,0);atlas.setFoV(300);}else view={ra:140,dec:0,fov:300};request();};
document.getElementById('mask-visible').onchange=e=>mask.style.display=e.target.checked?'block':'none';
host.addEventListener('pointerdown',e=>{if(e.target.tagName==='CANVAS')down={x:e.clientX,y:e.clientY,ra:view.ra,dec:view.dec};});
host.addEventListener('pointermove',e=>{if(!down||live||!e.buttons)return;const[w]=dimensions();view.ra=M.mod(down.ra+(e.clientX-down.x)*view.fov/w,360);view.dec=Math.max(-60,Math.min(60,down.dec+(e.clientY-down.y)*view.fov/w));request();});
host.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5){const r=host.getBoundingClientRect(),p=pixel(e.clientX-r.left,e.clientY-r.top);if(p)pick(...p);}down=null;});
host.addEventListener('wheel',e=>{if(live)return;e.preventDefault();view.fov=Math.max(.5,Math.min(360,view.fov*Math.exp(e.deltaY*.001)));request();},{passive:false});
window.initDSSAtlas=async function(){
 try{await A.init;
 const sources=[
  {url:'https://hips.china-vo.org/m/DSS2Merged',minimum:3,name:'China-VO'},
  {url:'https://alasky.cds.unistra.fr/DSS/DSS2Merged',minimum:0,name:'CDS'},
  {url:'https://alaskybis.cds.unistra.fr/DSS/DSS2Merged',minimum:0,name:'CDS mirror'}
 ];
 const source=await Promise.any(sources.map(async source=>{
  const tile=source.minimum===3?'/Norder3/Dir0/Npix300.jpg':'/Norder0/Dir0/Npix4.jpg';
  const response=await fetch(source.url+tile,{mode:'cors',credentials:'omit',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Survey mirror unavailable');
  await response.blob();return source;
 }));
 window.atlasSurveySource=source;
 const survey=A.imageHiPS(source.url,{name:'DSS2 Red / STScI–CDS / '+source.name,maxOrder:9,minOrder:source.minimum,tileSize:512,cooFrame:'ICRS',imgFormat:'jpeg'});
 atlas=A.aladin('#aladin',{survey,target:'140 0',fov:300,projection:'AIT',cooFrame:'ICRSd',log:false,showCooGrid:false,showCooGridControl:true,showLayersControl:false,showSimbadPointerControl:false,showShareControl:false,showFullscreenControl:true,showZoomControl:true,showReticle:false});
 atlas.on('positionChanged',request);atlas.on('zoomChanged',request);atlas.on('resizeChanged',request);live=true;offline.style.display='none';window.liveAtlas=atlas;request();
 }catch(e){document.getElementById('engine-note').textContent='高清镜像暂不可用，仍可使用内置真实DSS2 Red预览筛选天区；预览采样约7′，请稍后刷新重试高清。';console.warn('Using local DSS preview',e);request();}
};
window.SkyAtlas={state,evaluate:M.evaluate,pick,redraw:request,selected,cameraBoundary};request();
})();
