import {validatePhotoFile,PHOTO_LIMIT} from './field-domain.js';
// Decode and re-encode supported raster photos; original filenames and EXIF/GPS are not uploaded.
export async function preparePhoto(file){
  validatePhotoFile(file);
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!(file.type==='image/jpeg'&&jpeg||file.type==='image/png'&&png||file.type==='image/webp'&&webp))throw new Error('The selected file is not a supported photo.');
  let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error('This photo could not be opened. Try a JPEG image.');}
  try{
    if(bitmap.width*bitmap.height>40000000)throw new Error('This photo is too large. Choose a smaller image.');
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
    if(!blob||blob.size>PHOTO_LIMIT)throw new Error('Unable to prepare a photo under 5 MB.');
    return blob;
  }finally{bitmap.close();}
}
