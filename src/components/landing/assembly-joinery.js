/* Self-contained WebGL sculpture. All geometry is procedural; no remote models. */
export function createJoineryRenderer(canvas, isMobile) {
  // The scene is cached between view changes; retain it while other canvases animate.
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const voxel = (x, y, z) => {
    if (y < 2 || (y === 2 && (x === 1 || x === 4) && z > 0 && z < 3)) return 3;
    if ((y === 4 || y === 5) && x >= 2 && x < 4) return 2;
    return x < (y < 4 ? 4 : y < 8 ? 2 : 3) ? 0 : 1;
  };
  const cells = new Map();
  for (let x = 0; x < 6; x++)
    for (let y = 0; y < 10; y++)
      for (let z = 0; z < 4; z++) cells.set(`${x},${y},${z}`, voxel(x, y, z));
  const boxes = [[], [], [], []];
  while (cells.size) {
    const [key, part] = cells.entries().next().value,
      [x, y, z] = key.split(",").map(Number);
    let w = 1,
      h = 1,
      d = 1;
    while (cells.get(`${x + w},${y},${z}`) === part) w++;
    row: while (true) {
      for (let i = 0; i < w; i++)
        if (cells.get(`${x + i},${y + h},${z}`) !== part) break row;
      h++;
    }
    depth: while (true) {
      for (let i = 0; i < w; i++)
        for (let j = 0; j < h; j++)
          if (cells.get(`${x + i},${y + j},${z + d}`) !== part) break depth;
      d++;
    }
    for (let i = 0; i < w; i++)
      for (let j = 0; j < h; j++)
        for (let k = 0; k < d; k++) cells.delete(`${x + i},${y + j},${z + k}`);
    boxes[part].push({
      center: [
        (x + w / 2 - 3) * 0.31,
        -(y + h / 2 - 5) * 0.31,
        (z + d / 2 - 2) * 0.31,
      ],
      half: [w * 0.155, h * 0.155, d * 0.155],
    });
  }
  const vec = (v) => "vec3(" + v.map((n) => n.toFixed(4)).join(",") + ")";
  const shapes = boxes
    .map(
      (list, i) =>
        `vec3 q${i}=(p-offsets[${i}])/0.95;\nfloat d${i}=100.0;\n` +
        list
          .map(
            (b) =>
              `d${i}=min(d${i},box(q${i}-${vec(b.center)},${vec(b.half)}));`,
          )
          .join("\n") +
        `\nd${i}=(d${i}-0.045)*0.95;`,
    )
    .join("\n");
  const vert = `attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}`;
  const frag = `precision highp float;
  uniform vec2 resolution;
  uniform vec3 offsets[4];
  uniform float yaw, pitch, progress, time;
  float box(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
  vec2 scene(vec3 p){
    ${shapes}
    // A sloped crown recalls the cut of the Monolith wordmark.
    d3=max(d3,(q3.y-1.48-q3.x*.12)*.99);
    // Recessed tooling lines run across the face of the locking key.
    float groove=box(q2-vec3(0.,.0,.619),vec3(.37,.027,.019));
    d2=max(d2,-groove);
    vec2 v=vec2(d0,0.);
    if(d1<v.x)v=vec2(d1,1.);if(d2<v.x)v=vec2(d2,2.);if(d3<v.x)v=vec2(d3,3.);
    return v;
  }
  vec3 normal(vec3 p){vec2 e=vec2(.002,0.);return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,scene(p+e.yxy).x-scene(p-e.yxy).x,scene(p+e.yyx).x-scene(p-e.yyx).x));}
  float occlusion(vec3 p,vec3 n){float occ=0.,weight=1.;for(int i=1;i<=4;i++){float h=.035*float(i);occ+=(h-scene(p+n*h).x)*weight;weight*=.68;}return clamp(1.-occ*4.,.3,1.);}
  float shadow(vec3 p,vec3 l){float shade=1.,t=.025;for(int i=0;i<20;i++){float h=scene(p+l*t).x;shade=min(shade,10.*h/t);t+=clamp(h,.025,.2);if(h<.002||t>3.)break;}return clamp(shade,.12,1.);}
  float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  vec3 shade(vec3 p,vec3 n,vec3 view,float part){
    float ao=occlusion(p,n);
    vec3 base=part==2.?vec3(.018,.027,.048):vec3(.009,.012,.018);
    if(part==3.)base=vec3(.014,.018,.025);
    float grain=(hash(floor(p*vec3(700.,3700.,700.)))-.5)*.006;
    base+=grain;
    vec3 key=normalize(vec3(-3.,5.,4.)),rim=normalize(vec3(4.,1.,-2.)),fill=normalize(vec3(3.,2.,4.));
    float nl=max(dot(n,key),0.),nr=max(dot(n,rim),0.),nf=max(dot(n,fill),0.);
    float visibility=shadow(p+n*.01,key);
    vec3 color=base*(vec3(.12,.16,.24)*ao+vec3(2.3,2.15,1.95)*nl*visibility+vec3(.27,.4,.85)*nr+vec3(.17,.24,.4)*nf);
    vec3 reflected=reflect(-view,n);
    // Broad photographic softboxes reveal the curved bevel and brushed finish.
    float soft=pow(max(dot(reflected,key),0.),25.);
    float strip=pow(max(dot(reflected,rim),0.),45.);
    float faceLight=pow(max(dot(reflected,fill),0.),15.);
    float fresnel=.18+.82*pow(1.-max(dot(n,view),0.),4.);
    color+=vec3(1.,.94,.82)*soft*.65*visibility+vec3(.38,.52,1.)*strip*2.;
    float edgeSoftbox=pow(max(dot(reflected,normalize(vec3(-2.,1.7,1.2))),0.),75.);
    color+=vec3(1.,.91,.77)*edgeSoftbox*1.9;
    color+=vec3(.3,.4,.6)*faceLight*.045;
    color+=vec3(.025,.05,.12)*fresnel*ao;
    float line=exp(-abs(p.y-offsets[2].y)*70.)*smoothstep(.53,.61,p.z-offsets[2].z);
    if(part==2.)color+=vec3(.3,.5,1.)*line*.6;
    return color;
  }
  void main(){
    vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
    vec3 ro=vec3(sin(yaw)*7.8,pitch*7.8,cos(yaw)*7.8);
    vec3 target=vec3(0.,.12,0.),forward=normalize(target-ro),right=normalize(cross(forward,vec3(0.,1.,0.))),up=cross(right,forward);
    float focal=1.18*min(resolution.x/resolution.y*1.12,1.);
    vec3 rd=normalize(forward*focal+right*uv.x+up*uv.y);
    float t=0.,id=0.,nearest=10.;bool hit=false;
    for(int i=0;i<88;i++){
      vec3 p=ro+rd*t;vec2 s=scene(p);nearest=min(nearest,s.x);
      if(s.x<.0025){hit=true;id=s.y;break;}t+=s.x*.85;if(t>13.)break;
    }
    vec3 col=vec3(.03137,.04314,.06667);
    // Diffuse blue light behind the sculpture. Bloom is deliberately restrained.
    float haze=exp(-length(uv*vec2(1.,.7))*5.5);
    col+=vec3(.009,.014,.029)*haze;
    if(hit){vec3 p=ro+rd*t,n=normal(p);col=shade(p,n,-rd,id);col=col/(col+vec3(1.));col=pow(col,vec3(.4545));}
    else{
      float bloom=exp(-nearest*22.)*.2;
      col+=vec3(.22,.34,.7)*bloom;
      float floorGlow=exp(-length((uv-vec2(0.,-.38))*vec2(3.,19.)))*.018;
      col+=vec3(.35,.5,1.)*floorGlow;
    }
    gl_FragColor=vec4(col,1.);
  }`;
  const shaders = [];
  function shader(type, source) {
    const s = gl.createShader(type);
    shaders.push(s);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw Error(gl.getShaderInfoLog(s));
    return s;
  }
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vert));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw Error(gl.getProgramInfoLog(program));
  } catch {
    shaders.forEach((s) => gl.deleteShader(s));
    if (program) gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const attribute = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(
    ["resolution", "offsets", "yaw", "pitch", "progress", "time"].map((k) => [
      k,
      gl.getUniformLocation(program, k),
    ]),
  );
  let previousFrame = "",
    previousTime = -100;
  let lost = false;
  const onLost = (event) => {
    event.preventDefault();
    lost = true;
    canvas.style.visibility = "hidden";
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    get available() {
      return !lost;
    },
    destroy() {
      lost = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteBuffer(buffer);
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
    render({ width, height, offsets, yaw, pitch, progress, time }) {
      if (lost) return;
      const frameKey = [width, height, yaw, pitch, progress, ...offsets.flat()]
        .map((n) => n.toFixed(3))
        .join(",");
      if (frameKey === previousFrame) return;
      if (time !== previousTime && time - previousTime < 30) return;
      previousFrame = frameKey;
      previousTime = time;
      const quality = isMobile ? 1 : 1.3;
      const w = Math.round(width * quality),
        h = Math.round(height * quality);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uniforms.resolution, w, h);
      gl.uniform3fv(uniforms.offsets, new Float32Array(offsets.flat()));
      gl.uniform1f(uniforms.yaw, yaw);
      gl.uniform1f(uniforms.pitch, pitch);
      gl.uniform1f(uniforms.progress, progress);
      gl.uniform1f(uniforms.time, time);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
}
