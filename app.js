const file=document.querySelector('#file');
const cameraArea=document.querySelector('#cameraArea');
const cameraView=document.querySelector('#cameraView');
const openCameraButton=document.querySelector('#openCamera');
const captureButton=document.querySelector('#capture');
let cameraStream=null, cameraFacing='user';
function stopCamera(){
  if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}
  cameraView.srcObject=null;
  cameraArea.hidden=true;
  captureButton.disabled=true;
  openCameraButton.disabled=false;
}
async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia){
    setStatus('A câmera exige HTTPS ou localhost e um navegador compatível.');
    return;
  }
  stopCamera();
  cameraArea.hidden=false;
  openCameraButton.disabled=true;
  setStatus('Solicitando permissão da câmera...');
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:false, video:{facingMode:{ideal:cameraFacing},width:{ideal:1920},height:{ideal:2560}}
    });
    cameraStream=stream;
    cameraView.srcObject=stream;
    cameraView.style.transform=cameraFacing==='user'?'scaleX(-1)':'none';
    await cameraView.play();
    captureButton.disabled=false;
    setStatus('Câmera pronta. Posicione seu rosto e clique em Capturar foto.');
  }catch(e){
    stopCamera();
    setStatus('Não foi possível abrir a câmera. Confira a permissão no navegador e use HTTPS ou localhost.');
  }
}
function isTouchDevice(){
  return navigator.maxTouchPoints>0 && window.matchMedia('(pointer:coarse)').matches;
}
function openPhotoCamera(){
  return startCamera();
}
openCameraButton.addEventListener('click',openPhotoCamera);
document.querySelector('#closeCamera').addEventListener('click',()=>{stopCamera();setStatus('Câmera fechada.');});
document.querySelector('#switchCamera').addEventListener('click',()=>{cameraFacing=cameraFacing==='user'?'environment':'user';startCamera();});
captureButton.addEventListener('click',()=>{
  if(!cameraStream || !cameraView.videoWidth || !cameraView.videoHeight || cameraView.readyState<2){setStatus('A câmera ainda não está pronta. Aguarde a imagem aparecer.');return;}
  captureButton.disabled=true;
  const snap=document.createElement('canvas');
  const captureScale=Math.min(1,1600/Math.max(cameraView.videoWidth,cameraView.videoHeight));
  snap.width=Math.max(1,Math.round(cameraView.videoWidth*captureScale));
  snap.height=Math.max(1,Math.round(cameraView.videoHeight*captureScale));
  const sc=snap.getContext('2d');
  // Espelha a câmera frontal para corresponder à prévia apresentada.
  if(cameraFacing==='user'){sc.translate(snap.width,0);sc.scale(-1,1);}
  sc.drawImage(cameraView,0,0,snap.width,snap.height);
  stopCamera();
  snap.toBlob(blob=>{
    if(!blob){setStatus('Não foi possível capturar a foto.');return;}
    loadPhoto(URL.createObjectURL(blob));
  },'image/png');
});
window.addEventListener('pagehide',stopCamera);
const canvas=document.querySelector('#editor');
const ctx=canvas.getContext('2d');
const zoom=document.querySelector('#zoom');
const quality=document.querySelector('#quality');
const preview=document.querySelector('#preview');
const statusEl=document.querySelector('#status');
const details=document.querySelector('#details');
const zoomVal=document.querySelector('#zoomval');
const qVal=document.querySelector('#qval');
const W=600,H=800;
const enhance=document.querySelector('#enhance');
const enhanceStrength=document.querySelector('#enhanceStrength');
const compareEnhancement=document.querySelector('#compareEnhancement');
let comparingEnhancement=false;

let originalImg=null;
let processedCanvas=null;
let scale=1,minScale=1,dx=0,dy=0,drag=null,renderToken=0,loadToken=0;
let faceLibPromise=null,bgLibPromise=null;
let previewReady=false;

function currentSource(){ return processedCanvas || originalImg; }

function setStatus(msg){
  statusEl.dataset.tone=/^(Não|Erro|Falha|O celular ficou)/i.test(msg)?'error':/^Fundo branco aplicado|^Foto JPG pronta/i.test(msg)?'success':'neutral';
  statusEl.textContent=msg;
  document.querySelector('#mobileStatus').textContent=msg;
  if(bgBusy){
    document.querySelector('#processingMessage').textContent=msg;
    const progress=document.querySelector('#processingProgress');
    const percent=/Baixando[^:]*:\s*(\d+)%/i.exec(msg);
    if(percent){
      progress.value=Math.min(100,Math.max(0,Number(percent[1])));
      progress.setAttribute('aria-label','Download dos recursos para preparar sua foto');
    }else{
      progress.removeAttribute('value');
      progress.setAttribute('aria-label','Preparação da foto em andamento');
    }
  }
}

// Work on the final 600x800 crop to bound memory and keep all source pixels intact.
function enhancePhotoPixels(input,width,height,intensity){
  const amount=Math.max(0,Math.min(100,Number(intensity)||0))/100;
  const output=new Uint8ClampedArray(input);
  if(!amount)return output;
  const count=width*height,luma=new Float32Array(count);
  let sum=0,samples=0;
  for(let i=0;i<count;i++){
    const p=i*4,y=.2126*input[p]+.7152*input[p+1]+.0722*input[p+2];
    luma[i]=y;
    if(y>10 && y<245 && input[p+3]>0){sum+=y;samples++;}
  }
  const average=samples?sum/samples:128;
  const lift=Math.min(18,Math.max(0,(125-average)*.28))*amount;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,p=i*4,light=luma[i];
    // The white backdrop and transparent pixels must remain unchanged.
    if((input[p]===255 && input[p+1]===255 && input[p+2]===255) || input[p+3]===0)continue;
    let detail=0;
    if(x>0 && x<width-1 && y>0 && y<height-1){
      const left=luma[i-1],right=luma[i+1],top=luma[i-width],bottom=luma[i+width];
      // Avoid sharpening the subject against white into a visible halo.
      if(light<245 && left<245 && right<245 && top<245 && bottom<245){
        const blur=(light*4+left+right+top+bottom)/8;
        detail=Math.max(-8,Math.min(8,(light-blur)*.7))*amount;
      }
    }
    const shadows=1-light/255;
    const delta=lift*shadows*shadows+(light-128)*.035*amount+detail;
    for(let channel=0;channel<3;channel++)output[p+channel]=input[p+channel]+delta;
  }
  return output;
}

function updateEnhancementControls(){
  const ready=!!originalImg;
  enhance.disabled=!ready;
  enhanceStrength.disabled=!ready || !enhance.checked;
  compareEnhancement.disabled=!ready || !enhance.checked || +enhanceStrength.value===0;
  document.querySelector('#enhanceVal').textContent=enhanceStrength.value+'%';
  if(compareEnhancement.disabled)comparingEnhancement=false;
  compareEnhancement.setAttribute('aria-pressed',String(comparingEnhancement));
  compareEnhancement.textContent=comparingEnhancement?'Voltar à melhoria':'Ver sem ajustes';
  document.querySelector('#compareHint').hidden=!comparingEnhancement;
}

function paint(forExport=false){
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,W,H);
  const src=currentSource();
  if(!src){
    ctx.fillStyle='#869980';
    ctx.textAlign='center';
    ctx.font='23px system-ui, sans-serif';
    ctx.fillText('Sua foto começa aqui',W/2,H/2);
    return;
  }
  const sw=src.width || src.naturalWidth;
  const sh=src.height || src.naturalHeight;
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(src,dx,dy,sw*scale,sh*scale);
  if(enhance.checked && (!comparingEnhancement || forExport) && +enhanceStrength.value>0){
    const pixels=ctx.getImageData(0,0,W,H);
    pixels.data.set(enhancePhotoPixels(pixels.data,W,H,+enhanceStrength.value));
    ctx.putImageData(pixels,0,0);
  }
}

function constrain(){
  const src=currentSource();
  if(!src) return;
  const sw=(src.width || src.naturalWidth)*scale;
  const sh=(src.height || src.naturalHeight)*scale;
  dx=Math.min(0,Math.max(W-sw,dx));
  dy=Math.min(0,Math.max(H-sh,dy));
}

function recenter(){
  const src=currentSource();
  if(!src) return;
  const sw=src.width || src.naturalWidth;
  const sh=src.height || src.naturalHeight;
  minScale=Math.max(W/sw,H/sh);
  scale=minScale*(+zoom.value/100);
  dx=(W-sw*scale)/2;
  dy=(H-sh*scale)/2;
  paint();
  schedule();
}

function setZoom(v){
  const src=currentSource();
  if(!src) return;
  const old=scale;
  zoom.value=Math.min(350,Math.max(100,v));
  scale=minScale*(+zoom.value/100);
  dx=W/2-(W/2-dx)*(scale/old);
  dy=H/2-(H/2-dy)*(scale/old);
  constrain();
  zoomVal.textContent=zoom.value+'%';
  paint();
  schedule();
}

function fitFace(box){
  const src=currentSource() || originalImg;
  if(!src) return;
  const sw=src.width || src.naturalWidth;
  const sh=src.height || src.naturalHeight;
  const bw=Math.max(1,box.width), bh=Math.max(1,box.height);
  const faceScale=Math.min(W/(bw*2.35),H/(bh*3.25));
  minScale=Math.max(W/sw,H/sh);
  const targetScale=Math.max(minScale,faceScale);
  scale=Math.min(minScale*3.5,targetScale);
  zoom.value=Math.round(Math.min(350,Math.max(100,100*scale/minScale)));
  scale=minScale*(+zoom.value/100);
  dx=W*.5-(box.x+bw*.5)*scale;
  dy=H*.36-(box.y+bh*.5)*scale;
  constrain();
  paint();
  zoomVal.textContent=zoom.value+'%';
  schedule();
}

function loadScript(src){
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;
    s.onload=resolve;
    s.onerror=()=>reject(new Error('Falha ao carregar '+src));
    document.head.appendChild(s);
  });
}

function loadFaceApi(){
  if(faceLibPromise) return faceLibPromise;
  faceLibPromise=(async()=>{
    if('FaceDetector' in window) return 'native';
    if(!window.FaceDetection){
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/face_detection.js');
    }
    return 'mediapipe';
  })().catch(err=>{faceLibPromise=null; throw err;});
  return faceLibPromise;
}

const BG_MODEL='studioludens/birefnet-lite-512';
let bgRuntimePromise=null,bgForceCpu=false,bgBusy=false;
let pendingAutoProcess=false;
let bgProgress=()=>{};
let backgroundCache=new WeakMap();

function loadBgApi(){
  if(bgLibPromise) return bgLibPromise;
  bgLibPromise=(async()=>{
    bgRuntimePromise ??= import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    const runtime=await bgRuntimePromise;
    runtime.env.allowLocalModels=false;
    // This page does not require cross-origin isolation or a threaded server.
    runtime.env.backends.onnx.wasm.numThreads=1;
    let device='wasm',dtype='fp32';
    if(!bgForceCpu && navigator.gpu){
      try{
        const adapter=await navigator.gpu.requestAdapter();
        // The fp16 export produced low-opacity masks on the tested GPU.
        if(adapter) device='webgpu';
      }catch(e){ console.info('WebGPU indisponível; usando CPU.',e); }
    }
    bgProgress('Carregando os recursos para remover o fundo. Aguarde…');
    let lastPercent=-1;
    let model;
    try{
      model=await runtime.AutoModel.from_pretrained(BG_MODEL,{
        device,dtype,
        progress_callback:event=>{
          if(event.status==='progress' && event.file?.endsWith('.onnx') && Number.isFinite(event.progress)){
            const percent=Math.floor(event.progress);
            if(percent!==lastPercent){lastPercent=percent;bgProgress(`Baixando recursos: ${percent}%. Aguarde, sua foto permanece neste dispositivo.`);}
          }else if(event.status==='done' && event.file?.endsWith('.onnx')){
            bgProgress('Preparando a remoção de fundo. Aguarde mais um momento…');
          }
        }
      });
    }catch(error){
      if(device==='webgpu'){
        bgForceCpu=true;
        bgLibPromise=null;
        bgProgress('A aceleração gráfica falhou. Carregando a versão para CPU…');
        return loadBgApi();
      }
      throw error;
    }
    let processor;
    try{processor=await runtime.AutoProcessor.from_pretrained(BG_MODEL);}
    catch(error){await model.dispose().catch(()=>{});throw error;}
    return {runtime,model,processor,device};
  })().catch(error=>{bgLibPromise=null;bgRuntimePromise=null;throw error;});
  return bgLibPromise;
}

// Presentation state is separate from segmentation and image enhancement.
function syncPhotoUi(){
  const ready=!!originalImg && previewReady && !bgBusy;
  document.body.dataset.photoState=bgBusy?'processing':!originalImg?'empty':ready?'ready':'editing';
  document.querySelector('#download').disabled=!ready;
  document.querySelector('#newImage').disabled=!originalImg || bgBusy;
  for(const button of document.querySelectorAll('[data-move]'))button.disabled=!originalImg || bgBusy;
}

function resetPhoto(){
  if(bgBusy)return;
  ++loadToken;++renderToken;
  pendingAutoProcess=false;
  stopCamera();
  originalImg=null;processedCanvas=null;previewReady=false;
  backgroundCache=new WeakMap();
  scale=minScale=1;dx=dy=0;drag=null;
  file.value='';zoom.value=100;quality.value=90;
  zoom.disabled=quality.disabled=true;
  zoomVal.textContent='100%';qVal.textContent='90%';
  enhance.checked=false;enhanceStrength.value=35;comparingEnhancement=false;
  updateEnhancementControls();
  if(preview.dataset.url)URL.revokeObjectURL(preview.dataset.url);
  delete preview.dataset.url;preview.removeAttribute('src');
  details.textContent='600 × 800 pixels · proporção 3×4';
  document.querySelector('#fileName').textContent='Nenhum arquivo selecionado';
  document.querySelector('#fileName').removeAttribute('title');
  for(const id of ['auto','bg','reset','minus','plus'])document.getElementById(id).disabled=true;
  syncPhotoUi();paint();
  setStatus('Selecione uma imagem ou abra a câmera para começar.');
  file.focus();
}

function setBackgroundBusy(busy){
  bgBusy=busy;
  document.querySelector('#processingNotice').hidden=!busy;
  statusEl.setAttribute('aria-live',busy?'off':'polite');
  if(busy) setStatus('Aguarde. Estamos preparando os recursos para sua foto…');
  for(const id of ['auto','bg','download']) document.getElementById(id).disabled=busy || !originalImg;
  document.querySelector('.editor-controls').setAttribute('aria-busy',String(busy));
  syncPhotoUi();
  if(!busy && pendingAutoProcess){
    pendingAutoProcess=false;
    queueMicrotask(()=>autoProcess());
  }
}

async function findFace(image){
  await loadFaceApi();
  if('FaceDetector' in window){
    try{
      const d=new window.FaceDetector({fastMode:true,maxDetectedFaces:5});
      const faces=await d.detect(image);
      if(faces.length){
        const b=faces.sort((a,b)=>b.boundingBox.width*b.boundingBox.height-a.boundingBox.width*a.boundingBox.height)[0].boundingBox;
        return {x:b.x,y:b.y,width:b.width,height:b.height};
      }
    }catch(e){}
  }
  const Detection=window.FaceDetection;
  if(!Detection) return null;
  const det=new Detection({locateFile:f=>'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/'+f});
  det.setOptions({model:'short',minDetectionConfidence:.5});
  let result=null;
  det.onResults(r=>{
    const boxes=(r.detections||[]).map(d=>d.boundingBox).filter(Boolean);
    boxes.sort((a,b)=>b.width*b.height-a.width*a.height);
    if(boxes.length){
      const b=boxes[0], w=image.naturalWidth, h=image.naturalHeight;
      result={x:(b.xCenter-b.width/2)*w, y:(b.yCenter-b.height/2)*h, width:b.width*w, height:b.height*h};
    }
  });
  try{ await det.send({image}); return result; }
  finally{ if(det.close) await det.close(); }
}

function getBackgroundMaskTensor(prediction){
  // ONNX exports may name the only mask "output" rather than "logits".
  const isMask=tensor=>{
    if(!tensor || !Array.isArray(tensor.dims) || tensor.dims.length<2) return false;
    const dims=tensor.dims;
    return dims[dims.length-1]>1 && dims[dims.length-2]>1
      && dims.slice(0,-2).every(size=>size===1);
  };
  if(isMask(prediction.logits)) return prediction.logits;
  const candidates=Object.values(prediction).filter(isMask);
  if(candidates.length===1) return candidates[0];
  const outputs=Object.entries(prediction).map(([name,tensor])=>`${name}: ${tensor?.dims?.join('×') || 'sem dimensões'}`).join(', ');
  throw new Error('A saída do BiRefNet não contém uma máscara única. '+outputs);
}

function validateBackgroundPrediction(prediction){
  const mask=getBackgroundMaskTensor(prediction);
  if(mask.type!=='float32') throw new Error('A máscara precisa usar precisão completa (float32).');
  let peak=-Infinity;
  for(const value of mask.data){
    if(!Number.isFinite(value)) throw new Error('O modelo retornou uma máscara inválida.');
    if(value>peak) peak=value;
  }
  // A portrait must contain confidently opaque foreground. Reject a washed-out
  // mask rather than composing a nearly transparent person over white.
  if(peak<Math.log(9)) throw new Error('O modelo não identificou uma pessoa com confiança suficiente.');
  return mask;
}

async function inferBackground(engine,raw){
  const inputs=await engine.processor(raw);
  try{
    const prediction=await engine.model({input_image:inputs.pixel_values});
    try{validateBackgroundPrediction(prediction);return prediction;}
    catch(error){
      for(const tensor of Object.values(prediction)) tensor?.dispose?.();
      throw error;
    }
  }finally{
    inputs.pixel_values?.dispose?.();
  }
}

function shouldUseLightweightBackground(){
  return isTouchDevice() || navigator.userAgentData?.mobile===true
    || (navigator.deviceMemory>0 && navigator.deviceMemory<=4);
}

// Keep the smaller portrait model in its own worker. A failed WASM instance
// can be terminated and recreated without poisoning the page's runtime.
function portraitWorkerMain(){
  let segmenterPromise=null;
  self.onmessage=async({data:request})=>{
    const {id,width,height,pixels}=request;
    const report=message=>self.postMessage({id,kind:'progress',message});
    try{
      segmenterPromise ??= (async()=>{
        const runtime=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
        runtime.env.allowLocalModels=false;
        runtime.env.backends.onnx.wasm.numThreads=1;
        runtime.env.backends.onnx.wasm.proxy=false;
        let lastPercent=-1;
        const segmenter=await runtime.pipeline('background-removal','Xenova/modnet',{
          device:'wasm',dtype:'fp32',
          progress_callback:event=>{
            if(event.status==='progress' && event.file?.endsWith('.onnx') && Number.isFinite(event.progress)){
              const percent=Math.floor(event.progress);
              if(percent!==lastPercent){lastPercent=percent;report(`Baixando recursos para celular: ${percent}%. Aguarde…`);}
            }
          }
        });
        return {runtime,segmenter};
      })();
      const {runtime,segmenter}=await segmenterPromise;
      report('Aplicando o fundo branco com o modelo para celular. Aguarde…');
      const image=new runtime.RawImage(new Uint8ClampedArray(pixels),width,height,4);
      const results=await segmenter(image);
      const result=results[0];
      if(!result || result.channels!==4 || result.width!==width || result.height!==height){
        throw new Error('O modelo não retornou um retrato válido.');
      }
      let peak=0;
      for(let i=3;i<result.data.length;i+=4)peak=Math.max(peak,result.data[i]);
      if(peak<230)throw new Error('Não foi possível identificar a pessoa. Tente uma foto mais iluminada.');
      const output=new Uint8ClampedArray(result.data);
      self.postMessage({id,kind:'done',width,height,pixels:output.buffer},[output.buffer]);
    }catch(error){
      segmenterPromise=null;
      self.postMessage({id,kind:'error',message:error.message || String(error)});
    }
  };
}

let portraitWorker=null,portraitWorkerUrl=null,portraitRequestId=0;
function resetPortraitWorker(){
  portraitWorker?.terminate();portraitWorker=null;
  if(portraitWorkerUrl)URL.revokeObjectURL(portraitWorkerUrl);
  portraitWorkerUrl=null;
}
window.addEventListener('pagehide',resetPortraitWorker);

async function createMobileWhiteBackground(image,report){
  report('Preparando a remoção de fundo para celular. Aguarde…');
  if(!portraitWorker){
    portraitWorkerUrl=URL.createObjectURL(new Blob(['('+portraitWorkerMain.toString()+')();'],{type:'text/javascript'}));
    try{portraitWorker=new Worker(portraitWorkerUrl,{type:'module'});}
    catch(error){resetPortraitWorker();throw new Error('Não foi possível iniciar o processamento. Atualize a página e tente novamente.');}
  }
  const canvas=document.createElement('canvas');
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const input=ctx.getImageData(0,0,canvas.width,canvas.height);
  const worker=portraitWorker,id=++portraitRequestId;
  const output=await new Promise((resolve,reject)=>{
    let timer;
    const cleanup=()=>{
      clearTimeout(timer);worker.removeEventListener('message',onMessage);
      worker.removeEventListener('error',onError);worker.removeEventListener('messageerror',onError);
    };
    const fail=error=>{cleanup();resetPortraitWorker();reject(error);};
    const onError=event=>fail(new Error(event.message || 'Não foi possível iniciar o processamento no celular.'));
    const onMessage=({data})=>{
      if(data.id!==id)return;
      if(data.kind==='progress'){report(data.message);return;}
      if(data.kind==='error'){
        const message=/aborted|memory|allocation/i.test(data.message)
          ? 'O celular ficou sem memória para processar a foto. Feche outras abas e tente novamente.'
          : data.message;
        fail(new Error(message));return;
      }
      if(data.kind==='done'){cleanup();resolve(data);}
    };
    worker.addEventListener('message',onMessage);worker.addEventListener('error',onError);
    worker.addEventListener('messageerror',onError);
    timer=setTimeout(()=>fail(new Error('O processamento demorou demais. Verifique a conexão e tente novamente.')),180000);
    try{worker.postMessage({id,width:canvas.width,height:canvas.height,pixels:input.data.buffer},[input.data.buffer]);}
    catch(error){fail(error);}
  });
  ctx.putImageData(new ImageData(new Uint8ClampedArray(output.pixels),output.width,output.height),0,0);
  ctx.globalCompositeOperation='destination-over';
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.globalCompositeOperation='source-over';
  return canvas;
}

async function createWhiteBackgroundVersion(image,onProgress=()=>{}){
  if(backgroundCache.has(image)) return backgroundCache.get(image);
  if(shouldUseLightweightBackground()){
    const out=await createMobileWhiteBackground(image,onProgress);
    backgroundCache.set(image,out);
    return out;
  }
  bgProgress=onProgress;
  try{
    let engine=await loadBgApi();
    const source=document.createElement('canvas');
    source.width=image.naturalWidth;source.height=image.naturalHeight;
    source.getContext('2d').drawImage(image,0,0);
    const raw=engine.runtime.RawImage.fromCanvas(source).rgb();
    onProgress('BiRefNet está refinando o cabelo e o contorno. Aguarde…');
    let prediction;
    try{
      prediction=await inferBackground(engine,raw);
    }catch(error){
      if(engine.device!=='webgpu') throw error;
      // GPU initialization can succeed even when inference is unsupported.
      await engine.model.dispose().catch(()=>{});
      bgLibPromise=null;bgForceCpu=true;
      onProgress('A GPU não produziu um recorte confiável. Processando em precisão completa pela CPU…');
      engine=await loadBgApi();
      prediction=await inferBackground(engine,raw);
    }
    try{
      const logits=getBackgroundMaskTensor(prediction);
      const alphaTensor=logits.sigmoid().mul(255).to('uint8');
      const maskHeight=logits.dims.at(-2),maskWidth=logits.dims.at(-1);
      const alpha=await new engine.runtime.RawImage(alphaTensor.data,maskWidth,maskHeight,1)
        .resize(source.width,source.height);
      if(alpha.channels!==1 || alpha.data.length!==source.width*source.height){
        throw new Error('Máscara BiRefNet com dimensões inválidas.');
      }
      // Apply the model's continuous alpha directly, without blur or thresholds.
      const pixels=source.getContext('2d').getImageData(0,0,source.width,source.height);
      for(let i=0;i<alpha.data.length;i++) pixels.data[i*4+3]=alpha.data[i];
      source.getContext('2d').putImageData(pixels,0,0);
      const out=document.createElement('canvas');
      out.width=source.width;out.height=source.height;
      const outCtx=out.getContext('2d');
      outCtx.fillStyle='#ffffff';outCtx.fillRect(0,0,out.width,out.height);
      outCtx.drawImage(source,0,0);
      backgroundCache.set(image,out);
      return out;
    }finally{
      for(const tensor of Object.values(prediction)) tensor?.dispose?.();
    }
  }finally{
    bgProgress=()=>{};
  }
}

async function autoProcess(){
  if(!originalImg) return;
  if(bgBusy){pendingAutoProcess=true;return;}
  pendingAutoProcess=false;
  const token=++loadToken,img=originalImg;
  const isCurrent=()=>token===loadToken && img===originalImg;
  setBackgroundBusy(true);
  const report=message=>{if(isCurrent())setStatus(message);};
  let bgApplied=false,bgError=null,faceBox=null;
  try{
    // Background removal must not wait for a face-detection library or camera GPU.
    report('Foto recebida. Aguarde enquanto aplicamos o fundo branco…');
    try{
      const output=await createWhiteBackgroundVersion(img,report);
      if(!isCurrent()) return;
      processedCanvas=output;
      bgApplied=true;
    }catch(error){
      if(!isCurrent()) return;
      bgError=error;
      console.warn('Falha na remoção de fundo:',error);
      processedCanvas=null;
    }
    if(!isCurrent()) return;
    zoom.value=100;zoomVal.textContent='100%';
    recenter();
    report(bgApplied?'Fundo branco aplicado. Finalizando o enquadramento…':'Finalizando o enquadramento. A remoção de fundo precisará de uma nova tentativa.');
    let timer;
    try{
      faceBox=await Promise.race([
        findFace(img),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(null),8000);})
      ]);
    }catch(error){console.warn('Falha na detecção facial:',error);}
    finally{clearTimeout(timer);}
    if(!isCurrent()) return;
    if(faceBox) fitFace(faceBox);
    if(bgApplied){
      setStatus('Fundo branco aplicado. '+(faceBox?'Rosto centralizado. ':'')+'Confira a prévia antes de baixar.');
    }else{
      setStatus('Não foi possível aplicar o fundo branco: '+(bgError?.message || 'falha no processamento')+'. Toque em Aplicar fundo branco para tentar novamente.');
    }
  }finally{
    setBackgroundBusy(false);
  }
}

async function applyBackgroundOnly(){
  if(!originalImg || bgBusy) return;
  const token=++loadToken,img=originalImg;
  setBackgroundBusy(true);
  setStatus('Preparando a remoção de fundo. Aguarde…');
  try{
    const out=await createWhiteBackgroundVersion(img,message=>{
      if(token===loadToken && img===originalImg)setStatus(message);
    });
    if(token!==loadToken || img!==originalImg) return;
    processedCanvas=out;
    // Preserve the crop and zoom selected by the user.
    paint();schedule();
    setStatus('Fundo branco aplicado. Confira o contorno antes de baixar.');
  }catch(e){
    console.warn(e);
    if(token===loadToken)setStatus('Não foi possível aplicar o fundo branco: '+(e.message || String(e))+'. Sua foto continua disponível para ajuste manual.');
  }finally{
    setBackgroundBusy(false);
  }
}

function blobJpeg(q){
  // The comparison only affects the editor, never the selected download result.
  paint(true);
  const blob=new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',q));
  if(comparingEnhancement)paint();
  return blob;
}

async function exportBlob(){
  let q=+quality.value/100;
  let b=await blobJpeg(q);
  while(b && b.size>3*1024*1024 && q>0.4){
    q=Math.max(.4,q-.05);
    b=await blobJpeg(q);
  }
  return b;
}

function schedule(){
  let t=++renderToken;
  const src=currentSource();
  if(!src) return;
  previewReady=false;syncPhotoUi();
  setTimeout(async()=>{
    const b=await exportBlob();
    if(t!==renderToken || !b) return;
    if(preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
    const u=URL.createObjectURL(b);
    preview.dataset.url=u;
    preview.src=u;
    previewReady=true;syncPhotoUi();
    details.textContent=`600 × 800 pixels · JPG · ${(b.size/1024).toFixed(0)} KB`;
  },100);
}

function loadPhoto(url){
  const token=++loadToken;
  const i=new Image();
  i.onload=()=>{
    URL.revokeObjectURL(url);
    if(token!==loadToken)return;
    if(Math.max(i.naturalWidth,i.naturalHeight)>1600){
      const ratio=1600/Math.max(i.naturalWidth,i.naturalHeight);
      const resized=document.createElement('canvas');
      resized.width=Math.max(1,Math.round(i.naturalWidth*ratio));
      resized.height=Math.max(1,Math.round(i.naturalHeight*ratio));
      const resizeCtx=resized.getContext('2d');
      resizeCtx.fillStyle='#ffffff';resizeCtx.fillRect(0,0,resized.width,resized.height);
      resizeCtx.drawImage(i,0,0,resized.width,resized.height);
      setStatus('Preparando a foto para aplicar o fundo branco…');
      resized.toBlob(blob=>{
        if(token!==loadToken) return;
        if(!blob){setStatus('Não foi possível preparar a foto. Tente selecionar outra imagem.');return;}
        loadPhoto(URL.createObjectURL(blob));
      },'image/png');
      return;
    }
    originalImg=i;
    previewReady=false;
    preview.removeAttribute('src');
    syncPhotoUi();
    comparingEnhancement=false;
    updateEnhancementControls();
    processedCanvas=null;
    zoom.disabled=quality.disabled=false;
    ['auto','bg','reset','minus','plus','download'].forEach(id=>document.getElementById(id).disabled=bgBusy && ['auto','bg','download'].includes(id));
    zoom.value=100;
    zoomVal.textContent='100%';
    qVal.textContent=quality.value+'%';
    recenter();
    setStatus('Imagem carregada. Iniciando processamento automático...');
    autoProcess();
    if(bgBusy && pendingAutoProcess) setStatus('Nova foto recebida. Aguarde: ela será processada automaticamente em seguida.');
  };
  i.onerror=()=>{ URL.revokeObjectURL(url);setStatus('Não foi possível abrir esta imagem.'); };
  i.src=url;
}
function loadSelectedPhoto(input){
  const photo=input.files?.[0];
  if(!photo) return;
  // Some native camera pickers return a valid image without a MIME type.
  if(photo.type && !photo.type.startsWith('image/')){setStatus('Escolha um arquivo de imagem.');return;}
  const fileName=document.querySelector('#fileName');
  if(fileName){fileName.textContent=photo.name || 'Foto selecionada';fileName.title=fileName.textContent;}
  stopCamera();
  loadPhoto(URL.createObjectURL(photo));
}
file.addEventListener('change',()=>loadSelectedPhoto(file));
const uploadZone=document.querySelector('.upload-drop');
for(const name of ['dragenter','dragover'])uploadZone.addEventListener(name,event=>{
  event.preventDefault();
  if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
  uploadZone.classList.add('is-dragging');
});
uploadZone.addEventListener('dragleave',event=>{
  if(!uploadZone.contains(event.relatedTarget))uploadZone.classList.remove('is-dragging');
});
uploadZone.addEventListener('drop',event=>{
  event.preventDefault();uploadZone.classList.remove('is-dragging');
  const photo=event.dataTransfer?.files?.[0];
  if(photo)loadSelectedPhoto({files:[photo]});
});
document.querySelector('#newImage').addEventListener('click',resetPhoto);
function movePhoto(direction,step=5){
  if(!currentSource() || bgBusy)return;
  if(direction==='left')dx-=step;
  if(direction==='right')dx+=step;
  if(direction==='up')dy-=step;
  if(direction==='down')dy+=step;
  constrain();paint();schedule();
}
for(const button of document.querySelectorAll('[data-move]'))button.addEventListener('click',()=>movePhoto(button.dataset.move,10));
canvas.addEventListener('keydown',event=>{
  const direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];
  if(!currentSource() || bgBusy || !direction)return;
  event.preventDefault();movePhoto(direction,event.shiftKey?20:5);
});

enhance.addEventListener('change',()=>{
  comparingEnhancement=false;updateEnhancementControls();paint();schedule();
});
enhanceStrength.addEventListener('input',()=>{
  comparingEnhancement=false;updateEnhancementControls();paint();schedule();
});
compareEnhancement.addEventListener('click',()=>{
  comparingEnhancement=!comparingEnhancement;updateEnhancementControls();paint();
});
zoom.addEventListener('input',()=>setZoom(+zoom.value));
quality.addEventListener('input',()=>{ qVal.textContent=quality.value+'%'; schedule(); });
document.querySelector('#auto').onclick=autoProcess;
document.querySelector('#bg').onclick=applyBackgroundOnly;
document.querySelector('#reset').onclick=()=>{ zoom.value=100; zoomVal.textContent='100%'; recenter(); setStatus('Imagem centralizada.'); };
document.querySelector('#minus').onclick=()=>setZoom(+zoom.value-10);
document.querySelector('#plus').onclick=()=>setZoom(+zoom.value+10);

canvas.addEventListener('pointerdown',e=>{
  if(!currentSource()) return;
  canvas.setPointerCapture(e.pointerId);
  drag={x:e.clientX,y:e.clientY,dx,dy};
});
canvas.addEventListener('pointermove',e=>{
  if(!drag) return;
  const rect=canvas.getBoundingClientRect();
  dx=drag.dx+(e.clientX-drag.x)*W/rect.width;
  dy=drag.dy+(e.clientY-drag.y)*H/rect.height;
  constrain();
  paint();
  schedule();
});
canvas.addEventListener('pointerup',()=>drag=null);
canvas.addEventListener('pointercancel',()=>drag=null);

document.querySelector('#download').onclick=async()=>{
  if(!currentSource()) return;
  setStatus('Preparando arquivo...');
  const b=await exportBlob();
  if(!b){ setStatus('Erro ao gerar JPG.'); return; }
  if(b.size>3*1024*1024){ setStatus('Arquivo acima de 3 MB: diminua a qualidade.'); return; }
  const u=URL.createObjectURL(b);
  const a=document.createElement('a');
  a.href=u;
  a.download='foto-3x4.jpg';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(u),5000);
  setStatus('Foto JPG pronta para envio.');
};

syncPhotoUi();
paint();
