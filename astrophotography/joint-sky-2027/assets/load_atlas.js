/* Load the frozen annual model before starting the independent display modules. */
(async function(){
 function script(path){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=path;s.onload=resolve;s.onerror=reject;document.body.append(s);});}
 try{
  const [response]=await Promise.all([fetch('data/point_model.json'),script('assets/aladin.browser.js')]);
  if(!response.ok)throw Error('Annual model unavailable');
  document.getElementById('sky-data').textContent=await response.text();
  await script('assets/sky_model.js');await script('assets/atlas_view_red.js');
  window.initDSSAtlas();
 }catch(error){document.getElementById('map-status').textContent='年度数据加载失败，请刷新重试。';console.error(error);}
})();
