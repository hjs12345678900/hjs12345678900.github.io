/* Location-independent horizon integrator. Public angles are degrees; internal
   angles radians, duration hours, Unix times milliseconds. Terrain/refraction
   are excluded. ITRS positions are geocentric km; WGS84 subtraction includes
   lunar parallax. Monthly CIRS unit vectors are bilinearly interpolated. */
(function(){
const M=window.SkyModel,R=Math.PI/180,T=2*Math.PI,D=window.generalEphemeris;
const unpack=s=>new Float32Array(Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer);
const era=unpack(D.era),sun=unpack(D.sun_itrs_km),moon=unpack(D.moon_itrs_km);
const grids=Object.fromEntries(Object.entries(D.cirs).map(([k,v])=>[k,unpack(v)]));
const ids=['gansu','asv'];let sites=[],cache=new Map();
function bound(a,x,right=false){let l=0,h=a.length;while(l<h){let m=(l+h)>>1;if(a[m]<x||(right&&a[m]===x))l=m+1;else h=m;}return l;}
function interval(a,l,h){if(h<=l)return 0;if(h-l>=T)return a.length;let x=M.wrap(l),y=x+h-l;return bound(a,Math.min(y,T),true)-bound(a,x)+(y>T?bound(a,y-T,true):0);}
function direction(ra,dec,month){
 const x=M.mod(ra,360),y=dec+90,i=Math.floor(x),j=Math.min(179,Math.floor(y)),fx=x-i,fy=y-j,a=grids[month];
 const v=[0,1,2].map(k=>{const at=(r,c)=>a[(r*360+M.mod(c,360))*3+k];return(1-fy)*((1-fx)*at(j,i)+fx*at(j,i+1))+fy*((1-fx)*at(j+1,i)+fx*at(j+1,i+1));});
 return[M.wrap(Math.atan2(v[1],v[0])),Math.atan2(v[2],Math.hypot(v[0],v[1]))];
}
function halfwidth(dec,site){const a=Math.sin(site.lat*R)*Math.sin(dec),b=Math.cos(site.lat*R)*Math.cos(dec),s=Math.sin(site.height*R);if(Math.abs(b)<1e-14)return a>=s?Math.PI:0;return Math.acos(Math.max(-1,Math.min(1,(s-a)/b)));}
function observer(s){const p=s.lat*R,l=s.lon*R,n=6378.137/Math.sqrt(1-0.00669437999014*Math.sin(p)**2);return{up:[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)],xyz:[n*Math.cos(p)*Math.cos(l),n*Math.cos(p)*Math.sin(l),n*(1-0.00669437999014)*Math.sin(p)]};}
function altitude(body,i,o){const v=o.xyz.map((x,k)=>body[i*3+k]-x);return Math.asin(v.reduce((s,x,k)=>s+x*o.up[k],0)/Math.hypot(...v))/R;}
function fields(ms,formatter){return Object.fromEntries(formatter.formatToParts(ms).map(p=>[p.type,p.value]));}
function evening(ms,formatter){const p=fields(ms,formatter);return new Date(Date.UTC(+p.year,+p.month-1,+p.day)-(+p.hour<12?86400000:0)).toISOString().slice(0,10);}
function eligible(state){
 const key=state.month+'/'+state.moon;if(cache.has(key))return cache.get(key);
 const lists=[[],[]],orders=[[],[]],both=[],bothOrder=[],start=Date.parse(state.month+'-01T00:00:00Z')/1000;
 const date=new Date(start*1000);date.setUTCMonth(date.getUTCMonth()+1);const end=date.getTime()/1000;
 for(let i=Math.max(0,Math.floor((start-86400-D.first_edge_unix)/300));i<era.length&&D.first_edge_unix+i*300<end+172800;i++){
  const ms=(D.first_edge_unix+i*300+150)*1000;
  const valid=sites.map((s,k)=>{if(altitude(sun,i,s.observer)>=-18||(state.moon&&altitude(moon,i,s.observer)>=0))return false;if(!evening(ms,s.formatter).startsWith(state.month))return false;lists[k].push(i);orders[k].push(M.wrap(era[i]+s.lon*R));return true;});
  if(valid[0]&&valid[1]){both.push(i);bothOrder.push(M.wrap(era[i]+sites[0].lon*R));}
 }
 const result={lists:[...lists,both],orders:[...orders,bothOrder].map(a=>a.sort((a,b)=>a-b))};cache.set(key,result);return result;
}
/* Intersect circular hour-angle arcs in site 1's coordinates; merging prevents
   duplicate counts for circumpolar targets and longitude/date-line wraps. */
function intersections(g,h,delta){const parts=[];for(let k=-1;k<=1;k++){let l=Math.max(-g,-delta-h+k*T),r=Math.min(g,-delta+h+k*T);if(r>l)parts.push([l,r]);}parts.sort((a,b)=>a[0]-b[0]);const out=[];for(const p of parts){const last=out.at(-1);if(last&&p[0]<=last[1])last[1]=Math.max(last[1],p[1]);else out.push(p);}return out;}
function evaluate(ra,dec,state){
 if(!Number.isFinite(ra)||!Number.isFinite(dec)||Math.abs(dec)>90)return{outside:true,gansu:0,asv:0,common:0,simultaneous:0};
 const[a,d]=direction(ra,dec,state.month),[g,h]=sites.map(s=>halfwidth(d,s)),e=eligible(state),delta=Math.atan2(Math.sin((sites[1].lon-sites[0].lon)*R),Math.cos((sites[1].lon-sites[0].lon)*R));
 const gs=interval(e.orders[0],a-g,a+g)/12,as=interval(e.orders[1],a-h,a+h)/12;
 const si=intersections(g,h,delta).reduce((n,[l,r])=>n+interval(e.orders[2],a+l,a+r),0)/12;
 return{outside:false,gansu:gs,asv:as,common:Math.min(gs,as),simultaneous:si,cirs:[a,d],limits:[g,h]};
}
function longest(ra,dec,state,site){const v=evaluate(ra,dec,state);if(v.outside)return null;const k=site==='gansu'?0:site==='asv'?1:2;let start=-1,prev=-2,best=null;
 function finish(){if(start>=0&&(!best||prev-start+1>best.n))best={a:start,b:prev+1,n:prev-start+1};start=-1;}
 for(const i of eligible(state).lists[k]){const ok=sites.map((s,j)=>Math.abs(Math.atan2(Math.sin(era[i]+s.lon*R-v.cirs[0]),Math.cos(era[i]+s.lon*R-v.cirs[0])))<=v.limits[j]);if(k===2?ok[0]&&ok[1]:ok[k]){if(i!==prev+1)finish();if(start<0)start=i;prev=i;}else finish();}finish();if(!best)return null;return{...best,hours:best.n/12,start:(D.first_edge_unix+best.a*300)*1000,end:(D.first_edge_unix+best.b*300)*1000};}
function configure(input){
 const next=input.map(s=>{if(![s.lat,s.lon,s.height].every(Number.isFinite)||Math.abs(s.lat)>90||Math.abs(s.lon)>180||s.height<0||s.height>90)throw Error('纬度 −90…90，经度 −180…180，最低高度 0…90°。');return{...s,observer:observer(s),formatter:new Intl.DateTimeFormat('en-CA',{timeZone:s.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'})};});
 sites=next;cache.clear();
}
Object.assign(M,{evaluate,longest,configure,getSites:()=>sites.map(({name,lat,lon,zone,height})=>({name,lat,lon,zone,height})),local:(ms,id)=>{const p=fields(ms,sites[ids.indexOf(id)].formatter);return`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName.replace('GMT','UTC')}`;},night:(ms,id)=>evening(ms,sites[ids.indexOf(id)].formatter)});
configure(ids.map((id,i)=>({name:i?'ASV St Arnaud':'甘肃',lat:M.raw.sites[id][0],lon:M.raw.sites[id][1],zone:M.raw.timezones[id],height:30})));
})();
