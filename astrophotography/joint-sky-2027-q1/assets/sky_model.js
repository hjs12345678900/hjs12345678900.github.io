/* Monthly CIRS horizon model; all angles are radians internally, ICRS inputs degrees.
   The 5-minute eligibility indices retain every actual Sun/Moon and UTC cell.
   A one-degree CIRS correction grid is bilinearly interpolated for arbitrary clicks. */
(function(){
const raw=JSON.parse(document.getElementById('sky-data').textContent),TAU=2*Math.PI,R=Math.PI/180;
const wrap=x=>((x%TAU)+TAU)%TAU, mod=(x,n)=>((x%n)+n)%n;
function unpack(s){const a=Uint8Array.from(atob(s),c=>c.charCodeAt(0));return new Float32Array(a.buffer);}
const theta=unpack(raw.theta_g),delta=(raw.sites.asv[1]-raw.sites.gansu[1])*R;
const corrections={};Object.entries(raw.correction).forEach(([m,c])=>corrections[m]={dra:unpack(c.dra),ddec:unpack(c.ddec)});
const sorted={};Object.entries(raw.eligible).forEach(([key,sites])=>{sorted[key]={};Object.entries(sites).forEach(([site,ids])=>sorted[key][site]=ids.map(i=>wrap(theta[i]+(site==='asv'?delta:0))).sort((a,b)=>a-b));});
function bound(a,x,right=false){let lo=0,hi=a.length;while(lo<hi){const j=(lo+hi)>>1;if(a[j]<x||(right&&a[j]===x))lo=j+1;else hi=j;}return lo;}
function interval(a,low,high){const len=high-low;if(len<=0)return 0;if(len>=TAU)return a.length;const l=wrap(low),h=l+len;return bound(a,Math.min(h,TAU),true)-bound(a,l)+(h>TAU?bound(a,h-TAU,true):0);}
function cirs(ra,dec,month){
 const x=mod(ra,360),y=Math.max(0,Math.min(60,dec+30)),i=Math.floor(x),j=Math.min(59,Math.floor(y)),fx=x-i,fy=y-j;
 function read(a){const at=(row,col)=>a[row*360+mod(col,360)];return(1-fy)*((1-fx)*at(j,i)+fx*at(j,i+1))+fy*((1-fx)*at(j+1,i)+fx*at(j+1,i+1));}
 return[wrap(ra*R+read(corrections[month].dra)),dec*R+read(corrections[month].ddec)];
}
function limits(dec,height){return['gansu','asv'].map(s=>{const p=raw.sites[s][0]*R,q=(Math.sin(height*R)-Math.sin(p)*Math.sin(dec))/(Math.cos(p)*Math.cos(dec));return Math.acos(Math.max(-1,Math.min(1,q)));});}
function evaluate(ra,dec,state){
 if(dec< -30||dec>30)return{outside:true,gansu:0,asv:0,simultaneous:0,common:0};
 const [a,d]=cirs(ra,dec,state.month),[g,h]=limits(d,state.height),key=state.month+(state.moon?'/moon_down':'/all_moon'),s=sorted[key];
 const gs=interval(s.gansu,a-g,a+g)/12,as=interval(s.asv,a-h,a+h)/12;
 const si=interval(s.simultaneous,a+Math.max(-g,-delta-h),a+Math.min(g,-delta+h))/12;
 return{outside:false,gansu:gs,asv:as,simultaneous:si,common:Math.min(gs,as),cirs:[a,d],limits:[g,h],key};
}
function longest(ra,dec,state,site){
 const v=evaluate(ra,dec,state);if(v.outside)return null;
 const ids=raw.eligible[v.key][site];let start=-1,previous=-2,best=null;
 function finish(){if(start>=0&&(!best||previous-start+1>best.n))best={a:start,b:previous+1,n:previous-start+1};start=-1;}
 for(const i of ids){const eg=Math.abs(Math.atan2(Math.sin(theta[i]-v.cirs[0]),Math.cos(theta[i]-v.cirs[0])))<=v.limits[0];
  const ea=Math.abs(Math.atan2(Math.sin(theta[i]+delta-v.cirs[0]),Math.cos(theta[i]+delta-v.cirs[0])))<=v.limits[1];
  const yes=site==='gansu'?eg:site==='asv'?ea:eg&&ea;
  if(yes){if(i!==previous+1)finish();if(start<0)start=i;previous=i;}else finish();}
 finish();if(!best)return null;best.hours=best.n/12;best.start=(raw.first_edge_unix+best.a*300)*1000;best.end=(raw.first_edge_unix+best.b*300)*1000;return best;
}
function local(ms,site){const off=site==='asv'?11:8;return new Date(ms+off*3600000).toISOString().slice(0,16).replace('T',' ')+` UTC+${off}`;}
function night(ms,site){const off=site==='asv'?11:8;return new Date(ms+(off-12)*3600000).toISOString().slice(0,10);}
window.SkyModel={raw,evaluate,longest,local,night,wrap,mod};
})();
