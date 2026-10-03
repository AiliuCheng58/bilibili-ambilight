(() => {
  "use strict";
  const vertex = `attribute vec2 position; varying vec2 uv;
    void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.,1.);}`;
  const fragment = `precision mediump float;
    varying vec2 uv; uniform sampler2D image; uniform float vibrance,noise,oled;
    uniform vec4 anchor,directions; uniform vec2 viewport,sourceSize; uniform float seed;
    uniform vec4 crop; uniform float edge,spread,style;
    float saturationCurve(float c,float v){
      float x=v<0.?1.-c:c;
      float a=1.+5.*(1.-abs(v));
      float y=a*a-x*((a*a-1.)/(a*a))-(a-x/a)*(a-x/a);
      y=min(1.,x+(y-x)*5.);
      return v>=0.?y:1.-y;
    }
    void main(){
      vec2 p=vec2(uv.x,1.-uv.y)*viewport;
      vec2 low=anchor.xy+(anchor.zw-anchor.xy)*crop.xy;
      vec2 size=(anchor.zw-anchor.xy)*crop.zw;
      vec2 high=low+size;
      vec2 point;
      if(style>0.5){
        vec2 center=(low+high)*.5;
        float outer=max(spread,max(max(low.x,viewport.x-high.x),max(low.y,viewport.y-high.y)));
        float levels=max(2.,min(200.,ceil(outer/max(1.,max(size.x,size.y)*edge))));
        float radius=max(0.,max(abs(p.x-center.x)-size.x*.5,abs(p.y-center.y)-size.y*.5));
        radius=ceil(radius/max(.01,outer/levels))*outer/levels;
        point=(p-center)/(size+radius*2.)+.5;
      }else{
        vec2 band=max(vec2(1.)/sourceSize,vec2(edge));
        point=(p-low)/size;
        if(p.x<low.x)point.x=band.x*clamp(p.x/max(1.,low.x),0.,1.);
        if(p.x>high.x)point.x=1.-band.x+band.x*clamp((p.x-high.x)/max(1.,viewport.x-high.x),0.,1.);
        if(p.y<low.y)point.y=band.y*clamp(p.y/max(1.,low.y),0.,1.);
        if(p.y>high.y)point.y=1.-band.y+band.y*clamp((p.y-high.y)/max(1.,viewport.y-high.y),0.,1.);
      }
      point=crop.xy+clamp(point,0.,1.)*crop.zw;
      vec3 color=texture2D(image,vec2(point.x,1.-point.y)).rgb;
      float gray=dot(color,vec3(.2126,.7152,.0722));
      float highColor=max(color.r,max(color.g,color.b));
      float chroma=highColor-min(color.r,min(color.g,color.b));
      if(abs(vibrance-1.)>.001 && chroma>.001){
        float saturation=chroma/max(highColor,.001);
        color=vec3(highColor)-(vec3(highColor)-color)*saturationCurve(saturation,vibrance-1.)/saturation;
      }
      vec4 distance=vec4(anchor.y-p.y,p.x-anchor.z,p.y-anchor.w,anchor.x-p.x);
      float furthest=max(max(distance.x,distance.y),max(distance.z,distance.w));
      float direction=1.;
      if(furthest>0.){
        if(distance.x==furthest)direction=directions.x;
        else if(distance.y==furthest)direction=directions.y;
        else if(distance.z==furthest)direction=directions.z;
        else direction=directions.w;
      }
      color*=mix(1.,direction,smoothstep(0.,20.,max(0.,furthest)));
      float random=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+seed)*43758.5453)-.5;
      float strength=mix(1.,4.*gray*(1.-gray),oled);
      color+=random*noise*.025*strength;
      gl_FragColor=vec4(clamp(color,0.,1.),1.);
    }`;
  class ColorRenderer {
    constructor(parent, recover) {
      this.canvas = document.createElement("canvas");
      this.canvas.className = "bili-ambient-output";
      this.gl = this.canvas.getContext("webgl", { alpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false });
      this.lost = false;
      this.failed = false;
      this.canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); this.lost=true; this.canvas.style.display="none"; recover(); });
      this.canvas.addEventListener("webglcontextrestored", () => { this.lost=false; this.failed=false; this.init(); recover(); });
      if(this.gl) this.init();
      parent.append(this.canvas);
    }
    init() {
      const gl = this.gl;
      this.ready=false;
      const compile = (type,source) => {
        const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw new Error("Color shader compilation failed");}
        return shader;
      };
      try {
        this.program=gl.createProgram();
        const vs=compile(gl.VERTEX_SHADER,vertex), fs=compile(gl.FRAGMENT_SHADER,fragment);
        gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);
        if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error("Color shader linking failed");
        gl.useProgram(this.program);
        this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
        const position=gl.getAttribLocation(this.program,"position");gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        this.uniforms=Object.fromEntries(["image","vibrance","noise","oled","anchor","directions","viewport","seed","crop","edge","spread","style","sourceSize"].map(name=>[name,gl.getUniformLocation(this.program,name)]));
        gl.uniform1i(this.uniforms.image,0);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        this.ready=true;
      } catch { this.failed=true; }
    }
    available(settings) { return settings.webGL && this.gl && !this.lost && !this.failed; }
    retry() { if(this.ready && !this.lost)this.failed=false; }
    draw(source,background,crop,anchor,viewport,settings,now) {
      const usable=settings.webGL && this.gl && !this.lost && !this.failed;
      this.canvas.style.display=usable ? "block" : "none";
      if(!usable) return false;
      const gl=this.gl;
      try {
        if(this.canvas.width!==background.width || this.canvas.height!==background.height){this.canvas.width=background.width;this.canvas.height=background.height;}
        gl.viewport(0,0,background.width,background.height);gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
        gl.uniform1f(this.uniforms.vibrance,settings.vibrance/100);
        gl.uniform1f(this.uniforms.noise,settings.debandingStrength/100);
        gl.uniform1f(this.uniforms.oled,settings.debandingBlendMode);
        gl.uniform1f(this.uniforms.seed,Math.floor(now/100));
        gl.uniform2f(this.uniforms.viewport,viewport.width,viewport.height);
        gl.uniform2f(this.uniforms.sourceSize,source.width*crop.width,source.height*crop.height);
        gl.uniform4f(this.uniforms.crop,crop.x,crop.y,crop.width,crop.height);
        gl.uniform1f(this.uniforms.edge,settings.edge/100);
        gl.uniform1f(this.uniforms.spread,settings.spread);
        gl.uniform1f(this.uniforms.style,settings.projectionStyle);
        gl.uniform4f(this.uniforms.anchor,anchor.left-viewport.left,anchor.top-viewport.top,anchor.left+anchor.width-viewport.left,anchor.top+anchor.height-viewport.top);
        gl.uniform4f(this.uniforms.directions,Number(settings.directionTopEnabled),Number(settings.directionRightEnabled),Number(settings.directionBottomEnabled),Number(settings.directionLeftEnabled));
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        if(gl.getError()!==gl.NO_ERROR) throw new Error("Color rendering failed");
        return true;
      } catch {
        this.failed=true;this.canvas.style.display="none";return false;
      }
    }
    dispose() {
      if(this.gl && !this.lost){this.gl.deleteTexture(this.texture);this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);}
      this.canvas.remove();
    }
  }
  globalThis.BiliAmbientRenderer=ColorRenderer;
})();
