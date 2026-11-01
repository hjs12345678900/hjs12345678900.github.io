/* Apply validated observer settings atomically; invalid inputs retain results. */
(function(){
const M=window.SkyModel,form=document.getElementById('site-settings'),status=document.getElementById('site-status');
const defaults=M.getSites();
function fill(sites){sites.forEach((s,i)=>Object.entries(s).forEach(([k,v])=>{form.elements['site'+i+'_'+k].value=v;}));}
fill(defaults);
form.onsubmit=e=>{e.preventDefault();try{const sites=[0,1].map(i=>Object.fromEntries(['name','lat','lon','zone','height'].map(k=>[k,['lat','lon','height'].includes(k)?Number(form.elements['site'+i+'_'+k].value):form.elements['site'+i+'_'+k].value.trim()])));M.configure(sites);status.textContent='已应用：'+sites.map(s=>`${s.name} ≥${s.height}°`).join(' × ');window.SkyAtlas.redraw();}catch(error){status.textContent='未应用：'+error.message;}};
document.getElementById('default-sites').onclick=()=>{fill(defaults);form.requestSubmit();};
})();
