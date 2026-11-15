// CPU inference for 720 × 480 native BASS-II frames. No image leaves this worker.
function reflect(index, size) {
  if (index < 0) return -index - 1;
  return index >= size ? 2 * size - index - 1 : index;
}
function blur(values, width, height, sigma) {
  const radius = 4 * sigma;
  const weights = Array.from({length: radius * 2 + 1}, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)));
  const sum = weights.reduce((a,b) => a+b);
  for (let i=0; i<weights.length; i++) weights[i] /= sum;
  let current = values;
  for (const vertical of [true, false]) {
    const length = vertical ? height : width;
    const stride = vertical ? width : 1;
    const table = Array.from({length}, (_, k) => Int32Array.from(weights, (_, i) => (reflect(k+i-radius,length)-k)*stride));
    const output = new Float32Array(values.length);
    for (let y=0; y<height; y++) {
      for (let x=0; x<width; x++) {
        const p=y*width+x, offsets=table[vertical?y:x];
        let v=0;
        for (let i=0;i<weights.length;i++) v+=weights[i]*current[p+offsets[i]];
        output[p]=v;
      }
    }
    current=output;
  }
  return current;
}
function segment(rgba, trees) {
  const width=720, height=480, size=width*height;
  const channels=Array.from({length:6},()=>new Float32Array(size));
  const peak=new Float32Array(size);
  for(let p=0;p<size;p++){
    const r=Math.fround(rgba[4*p]/255), g=Math.fround(rgba[4*p+1]/255), b=Math.fround(rgba[4*p+2]/255);
    peak[p]=Math.max(r,g,b);
    channels[0][p]=r;channels[1][p]=g;channels[2][p]=b;channels[3][p]=r-g;
    channels[4][p]=r-b;channels[5][p]=peak[p]-Math.min(r,g,b);
  }
  for(const radius of [2,8,24]){
    for(const plane of [peak,channels[4]]){
      const smooth=blur(plane,width,height,radius);
      channels.push(plane.map((value,p)=>value-smooth[p]));
    }
  }
  const result=new Uint8Array(size);
  for(const [bit,ref] of [[1,'A'],[2,'B']]){
    const [offsets,left,right,feature,threshold,prob]=['offsets','left','right','feature','threshold','prob'].map(key=>trees[ref+'_'+key]);
    for(let p=0;p<size;p++){
      let votes=0;
      for(let tree=0;tree<offsets.length-1;tree++){
        let node=offsets[tree];
        while(left[node]>=0) node=channels[feature[node]][p]<=threshold[node]?left[node]:right[node];
        votes+=prob[node];
      }
      if(votes>(offsets.length-1)/2) result[p]|=bit;
    }
  }
  return result;
}
let model;
self.onmessage=async({data})=>{
  try{
    if(!model){
      const response=data.packed ? await fetch('data:application/octet-stream;base64,'+data.packed) : await fetch(new URL('optical-model.gz',self.location.href));
      if(!response.ok)throw Error('Model download failed');
      const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
      model=await new Response(stream).json();
    }
    const mask=segment(data.rgba,model);
    self.postMessage({mask},[mask.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
