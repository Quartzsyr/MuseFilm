// Only public release metadata is published or sent to the release-check Worker.
export function releaseSnapshot(pages,updatedAt=new Date().toISOString()) {
  if(!Array.isArray(pages))throw new Error('Expected GitHub release pages');
  const releases=pages.flat().filter(r=>!r.draft).map(r=>{
    if(!Number.isSafeInteger(r.id) || r.id<=0 || !r.tag_name || !Number.isFinite(Date.parse(r.published_at)))throw new Error('Invalid GitHub release');
    return {id:r.id,name:r.name,tag_name:r.tag_name,html_url:r.html_url,published_at:r.published_at,created_at:r.created_at,prerelease:Boolean(r.prerelease),draft:false,body:r.body,
      assets:(r.assets || []).map(a=>{
        if(!Number.isSafeInteger(a.download_count) || a.download_count<0)throw new Error('Invalid GitHub download count');
        return {name:a.name,state:a.state,browser_download_url:a.browser_download_url,size:a.size,digest:a.digest,download_count:a.download_count};
      })};
  });
  if(!releases.length || releases.length>1000)throw new Error('No public releases or release feed too large');
  return {schemaVersion:1,repository:'Quartzsyr/MuseFilm',updatedAt,releases};
}
