import{c as e,f as t,h as n,m as r,n as i,s as a}from"./canvas-SO13nWS1.js";var o=[{id:`normal`,label:`Normal`},{id:`dissolve`,label:`Dissolve`},{id:`darken`,label:`Darken`,sep:!0},{id:`multiply`,label:`Multiply`},{id:`color-burn`,label:`Color Burn`},{id:`linear-burn`,label:`Linear Burn`},{id:`darker-color`,label:`Darker Color`},{id:`lighten`,label:`Lighten`,sep:!0},{id:`screen`,label:`Screen`},{id:`color-dodge`,label:`Color Dodge`},{id:`lighter`,label:`Linear Dodge (Add)`},{id:`lighter-color`,label:`Lighter Color`},{id:`overlay`,label:`Overlay`,sep:!0},{id:`soft-light`,label:`Soft Light`},{id:`hard-light`,label:`Hard Light`},{id:`vivid-light`,label:`Vivid Light`},{id:`linear-light`,label:`Linear Light`},{id:`pin-light`,label:`Pin Light`},{id:`hard-mix`,label:`Hard Mix`},{id:`difference`,label:`Difference`,sep:!0},{id:`exclusion`,label:`Exclusion`},{id:`subtract`,label:`Subtract`},{id:`divide`,label:`Divide`},{id:`hue`,label:`Hue`,sep:!0},{id:`saturation`,label:`Saturation`},{id:`color`,label:`Color`},{id:`luminosity`,label:`Luminosity`}],s=[`red`,`orange`,`yellow`,`green`,`aqua`,`blue`,`purple`,`magenta`],c=[`reds`,`yellows`,`greens`,`cyans`,`blues`,`magentas`,`whites`,`neutrals`,`blacks`],l=()=>[{x:0,y:0},{x:255,y:255}];function u(){let e={};for(let t of s)e[t]={h:0,s:0,l:0};return{exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,temperature:0,tint:0,vibrance:0,saturation:0,hue:0,clarity:0,dehaze:0,sharpen:0,vignette:0,grain:0,fade:0,bw:!1,invert:!1,threshold:0,posterize:0,levels:{inBlack:0,inWhite:255,gamma:1,outBlack:0,outWhite:255},curves:{rgb:l(),r:l(),g:l(),b:l()},hsl:e,grade:{shadowHue:220,shadowSat:0,highlightHue:40,highlightSat:0,balance:0},mixer:{r:[100,0,0],g:[0,100,0],b:[0,0,100],mono:!1},selective:Object.fromEntries(c.map(e=>[e,{c:0,m:0,y:0,k:0}])),photoFilter:{color:`#ec8a00`,density:0,preserve:!0},gradientMap:{amount:0,shadow:`#1b0f3b`,mid:`#e8505b`,highlight:`#f9d56e`,useMid:!0},colorBalance:{shadows:[0,0,0],midtones:[0,0,0],highlights:[0,0,0],preserve:!0},bwMix:{enabled:!1,reds:40,yellows:60,greens:40,cyans:60,blues:20,magentas:80,tint:!1,tintColor:`#e1d3b3`},lut:null}}var d=[{id:`red`,color:`#e5484d`},{id:`orange`,color:`#f76b15`},{id:`yellow`,color:`#ffc53d`},{id:`green`,color:`#30a46c`},{id:`blue`,color:`#3e63dd`},{id:`violet`,color:`#8e4ec6`},{id:`gray`,color:`#8b8d98`}];function f(){return{dropShadow:{enabled:!1,color:`#000000`,opacity:45,angle:120,distance:12,size:24,spread:0},outerGlow:{enabled:!1,color:`#ffd54a`,opacity:75,size:28,spread:0},innerShadow:{enabled:!1,color:`#000000`,opacity:50,angle:120,distance:6,size:10,spread:0},innerGlow:{enabled:!1,color:`#ffffff`,opacity:60,size:14,spread:0},bevel:{enabled:!1,size:10,depth:100,angle:120,altitude:30,highlight:`#ffffff`,shadow:`#000000`,opacity:70},colorOverlay:{enabled:!1,color:`#ff3b6b`,opacity:100},gradientOverlay:{enabled:!1,from:`#7b2ff7`,to:`#f107a3`,angle:90,opacity:100},stroke:{enabled:!1,color:`#ffffff`,opacity:100,size:6,position:`outside`}}}function p(e){let t=f();if(!e)return t;let n={...t};for(let r of Object.keys(t))e[r]&&(n[r]={...t[r],...e[r]});return n}function m(e){let t=e.fx;return t?Object.values(t).some(e=>e&&e.enabled):!1}var h=1,g=1,_=(e=`id`)=>`${e}-${Date.now().toString(36)}-${(g++).toString(36)}`;function v(e){return{visible:!0,locked:!1,opacity:1,blend:`normal`,clip:!1,x:0,y:0,width:0,height:0,...e,id:_(`layer`),v:h++}}function y(e,t){return{...e,...t,v:h++}}var b=e=>e<0?0:e>1?1:e;function x(e){let t=e.replace(`#`,``);t.length===3&&(t=t.split(``).map(e=>e+e).join(``));let n=parseInt(t.slice(0,6),16)||0;return[n>>16&255,n>>8&255,n&255]}function S(e,t,n,r,i){let a=0;r[0]=0,i[0]=-1/0,i[1]=1/0;for(let n=1;n<t;n++){let t=r[a],o=(e[n]+n*n-(e[t]+t*t))/(2*n-2*t);for(;o<=i[a];)a--,t=r[a],o=(e[n]+n*n-(e[t]+t*t))/(2*n-2*t);a++,r[a]=n,i[a]=o,i[a+1]=1/0}a=0;for(let o=0;o<t;o++){for(;i[a+1]<o;)a++;let t=r[a];n[o]=(o-t)*(o-t)+e[t]}}function ee(e,t,n){let r=Math.max(t,n),i=new Float64Array(r),a=new Float64Array(r),o=new Int32Array(r),s=new Float64Array(r+1),c=new Float64Array(t*n);for(let r=0;r<t*n;r++)c[r]=e[r]?0:0x56bc75e2d63100000;for(let e=0;e<t;e++){for(let r=0;r<n;r++)i[r]=c[r*t+e];S(i,n,a,o,s);for(let r=0;r<n;r++)c[r*t+e]=a[r]}let l=new Float32Array(t*n);for(let e=0;e<n;e++){let n=e*t;for(let e=0;e<t;e++)i[e]=c[n+e];S(i,t,a,o,s);for(let e=0;e<t;e++)l[n+e]=Math.sqrt(a[e])}return l}var C=(e,t)=>b(e+1-t);function w(e,t,n){let r=new Float32Array(e);if(n<=0)return r;for(let e=0;e<r.length;e++){let i=C(n,t[e]);i>r[e]&&(r[e]=i)}return r}function te(e,t,n,r,a,o){let s=n*Math.max(0,Math.min(100,r))/100,c=w(e,t,s);return i(c,a,o,n-s),c}function ne(e,t){let n=e*Math.PI/180;return[Math.round(-Math.cos(n)*t),Math.round(Math.sin(n)*t)]}function re(e){let t=2,n=e.dropShadow;n.enabled&&(t=Math.max(t,n.distance+n.size*1.3+2)),e.outerGlow.enabled&&(t=Math.max(t,e.outerGlow.size*1.3+2));let r=e.stroke;return r.enabled&&r.position!==`inside`&&(t=Math.max(t,(r.position===`center`?r.size/2:r.size)+2)),Math.ceil(t)}function ie(e,t,n,r,a=1){let o=p(r),s=re(o),c=t+s*2,l=n+s*2,u=c*l,d=new Float32Array(u),f=c,m=l,h=-1,g=-1;for(let r=0;r<n;r++)for(let n=0;n<t;n++){let i=e[(r*t+n)*4+3]/255;d[(r+s)*c+n+s]=i,i>.01&&(n+s<f&&(f=n+s),n+s>h&&(h=n+s),r+s<m&&(m=r+s),r+s>g&&(g=r+s))}let _=null,v=null,y=()=>{if(!_){let e=new Uint8Array(u);for(let t=0;t<u;t++)e[t]=+(d[t]>=.5);_=ee(e,c,l)}return _},S=()=>{if(!v){let e=new Uint8Array(u);for(let t=0;t<u;t++)e[t]=+(d[t]<.5);v=ee(e,c,l)}return v},w=null,ie=()=>{if(!w){w=new Float32Array(u);for(let e=0;e<u;e++)w[e]=1-d[e]}return w},T=o.dropShadow,E=null,ae=0,oe=0;T.enabled&&T.opacity>0&&(E=te(d,y(),T.size,T.spread,c,l),[ae,oe]=ne(T.angle,T.distance));let D=o.outerGlow,se=D.enabled&&D.opacity>0?te(d,y(),D.size,D.spread,c,l):null,O=o.innerShadow,ce=null,le=0,k=0;O.enabled&&O.opacity>0&&(ce=te(ie(),S(),O.size,O.spread,c,l),[le,k]=ne(O.angle,O.distance));let A=o.innerGlow,ue=A.enabled&&A.opacity>0?te(ie(),S(),A.size,A.spread,c,l):null,j=o.stroke,M=null;if(j.enabled&&j.size>0&&j.opacity>0){M=new Float32Array(u);let e=j.position===`outside`?j.size:j.position===`center`?j.size/2:0,t=j.position===`inside`?j.size:j.position===`center`?j.size/2:0,n=e>0?y():null,r=t>0?S():null;for(let i=0;i<u;i++){let a=0;n&&(a+=b(Math.max(d[i],C(e,n[i]))-d[i])),r&&(a+=d[i]*C(t,r[i])),M[i]=b(a)}}let N=o.bevel,P=null,F=null;if(N.enabled&&N.size>0&&N.opacity>0){let e=S(),t=new Float32Array(u);for(let n=0;n<u;n++){let r=b(e[n]/N.size);t[n]=1-(1-r)*(1-r)}i(t,c,l,Math.max(1,N.size*.15));let n=N.size*N.depth/100,r=N.angle*Math.PI/180,a=Math.max(0,Math.min(90,N.altitude))*Math.PI/180,o=Math.cos(r)*Math.cos(a),s=-Math.sin(r)*Math.cos(a),f=Math.sin(a);P=new Float32Array(u),F=new Float32Array(u);for(let e=1;e<l-1;e++)for(let r=1;r<c-1;r++){let i=e*c+r;if(d[i]<=0)continue;let a=(t[i+1]-t[i-1])/2*n,l=(t[i+c]-t[i-c])/2*n,u=Math.sqrt(a*a+l*l+1),p=(-a*o-l*s+f)/u-f;p>0?P[i]=b(p*2.5):F[i]=b(-p*2.5)}}let I=o.gradientOverlay,de=I.enabled&&I.opacity>0&&h>=0,L=x(I.from),R=x(I.to),fe=I.angle*Math.PI/180,z=Math.cos(fe),pe=-Math.sin(fe),me=(f+h)/2,he=(m+g)/2,ge=Math.max(1,Math.abs((h-f+1)*z)+Math.abs((g-m+1)*pe)),B=o.colorOverlay,_e=B.enabled&&B.opacity>0,ve=x(T.color),ye=x(D.color),be=x(O.color),xe=x(A.color),Se=x(B.color),Ce=x(j.color),we=x(N.highlight),V=x(N.shadow),H=new Uint8ClampedArray(u*4),U=new Uint8ClampedArray(u*4),Te=b(a),W=0,G=0,K=0,q=0,J=(e,t,n,r)=>{if(r<=0)return;let i=r+q*(1-r),a=q*(1-r);W=(e*r+W*a)/i,G=(t*r+G*a)/i,K=(n*r+K*a)/i,q=i};for(let r=0;r<l;r++)for(let i=0;i<c;i++){let a=r*c+i,o=d[a];if(W=G=K=q=0,E){let e=i-ae,t=r-oe,n=e>=0&&t>=0&&e<c&&t<l?E[t*c+e]:0;J(ve[0],ve[1],ve[2],n*(T.opacity/100)*(1-o))}se&&J(ye[0],ye[1],ye[2],se[a]*(D.opacity/100));let u=a*4;if(H[u]=W,H[u+1]=G,H[u+2]=K,H[u+3]=q*255,W=G=K=q=0,o>0){let u=i-s,d=r-s;if(u>=0&&d>=0&&u<t&&d<n){let n=(d*t+u)*4;J(e[n],e[n+1],e[n+2],o*Te)}if(de){let e=b(.5+((i-me)*z+(r-he)*pe)/ge);J(L[0]+(R[0]-L[0])*e,L[1]+(R[1]-L[1])*e,L[2]+(R[2]-L[2])*e,o*(I.opacity/100))}if(_e&&J(Se[0],Se[1],Se[2],o*(B.opacity/100)),ue&&J(xe[0],xe[1],xe[2],ue[a]*o*(A.opacity/100)),ce){let e=i-le,t=r-k,n=e>=0&&t>=0&&e<c&&t<l?ce[t*c+e]:1;J(be[0],be[1],be[2],n*o*(O.opacity/100))}P&&F&&(J(we[0],we[1],we[2],P[a]*o*(N.opacity/100)),J(V[0],V[1],V[2],F[a]*o*(N.opacity/100)))}M&&J(Ce[0],Ce[1],Ce[2],M[a]*(j.opacity/100)),U[u]=W,U[u+1]=G,U[u+2]=K,U[u+3]=q*255}return{pad:s,width:c,height:l,behind:H,front:U}}var T=new WeakMap;function E(t,n,r){let i=a(n,r);return e(i).putImageData(new ImageData(t,n,r),0,0),i}function ae(n,r){let i=n.mask&&n.mask.enabled?n.mask:null,o=n.fill??1,s=`${t(r.canvas)}|${i?`${t(i.canvas)}@${i.x-r.x},${i.y-r.y}`:``}|${o}|${JSON.stringify(n.fx)}`,c=T.get(r.canvas);if(!c||c.key!==s){let{width:t,height:l}=r.canvas,u;if(i){let n=a(t,l),o=e(n);o.drawImage(r.canvas,0,0),o.globalCompositeOperation=`destination-in`,o.drawImage(i.canvas,i.x-r.x,i.y-r.y),u=o.getImageData(0,0,t,l).data}else u=e(r.canvas).getImageData(0,0,t,l).data;let d=ie(u,t,l,p(n.fx),o),f=E(d.behind,d.width,d.height),m=E(d.front,d.width,d.height),h=a(d.width,d.height),g=e(h);g.drawImage(f,0,0),g.drawImage(m,0,0),c={key:s,pad:d.pad,behind:f,front:m,full:h},T.set(r.canvas,c)}let l=r.x-c.pad,u=r.y-c.pad;return{behind:{canvas:c.behind,x:l,y:u},front:{canvas:c.front,x:l,y:u},full:{canvas:c.full,x:l,y:u}}}var oe=new Set([`normal`,`multiply`,`screen`,`overlay`,`darken`,`lighten`,`color-dodge`,`color-burn`,`lighter`,`hard-light`,`soft-light`,`difference`,`exclusion`,`hue`,`saturation`,`color`,`luminosity`]),D=e=>!oe.has(e),se=e=>e<0?0:e>1?1:e,O=(e,t)=>e>=1?1:t<=0?0:1-Math.min(1,(1-e)/t),ce=(e,t)=>e<=0?0:t>=1?1:Math.min(1,e/(1-t)),le=(e,t)=>t<=.5?O(e,2*t):ce(e,2*t-1);function k(e,t,n){switch(e){case`linear-burn`:return Math.max(0,t+n-1);case`vivid-light`:return le(t,n);case`linear-light`:return se(t+2*n-1);case`pin-light`:return n<=.5?Math.min(t,2*n):Math.max(t,2*n-1);case`hard-mix`:return+(t+n>=1);case`subtract`:return Math.max(0,t-n);case`divide`:return n<=0?+(t>0):Math.min(1,t/n);default:return n}}var A=(e,t)=>{let n=e*374761393+t*668265263|0;return n=Math.imul(n^n>>>13,1274126177),((n^n>>>16)>>>0)/4294967296};function ue(t,n,r,i,a,o,s=!1){let c=Math.max(0,Math.floor(r)),l=Math.max(0,Math.floor(i)),u=Math.min(t.width,Math.floor(r)+n.width),d=Math.min(t.height,Math.floor(i)+n.height),f=u-c,p=d-l;if(f<=0||p<=0||a<=0)return;let m=e(t),h=m.getImageData(c,l,f,p),g=e(n).getImageData(c-Math.floor(r),l-Math.floor(i),f,p).data,_=h.data,v=(e,t,n)=>.3*e+.59*t+.11*n;for(let e=0;e<p;e++)for(let t=0;t<f;t++){let n=(e*f+t)*4,r=g[n+3]/255*a;if(r<=0)continue;let i=_[n+3]/255;if(o===`dissolve`){if(A(t+c,e+l)>=r)continue;r=1}let u=g[n]/255,d=g[n+1]/255,p=g[n+2]/255,m=_[n]/255,h=_[n+1]/255,y=_[n+2]/255,b,x,S;if(o===`dissolve`)b=u,x=d,S=p;else if(o===`darker-color`||o===`lighter-color`){let e=o===`darker-color`?v(u,d,p)<v(m,h,y):v(u,d,p)>v(m,h,y);b=e?u:m,x=e?d:h,S=e?p:y}else b=k(o,m,u),x=k(o,h,d),S=k(o,y,p);let ee=(1-i)*u+i*b,C=(1-i)*d+i*x,w=(1-i)*p+i*S;if(s){if(i<=0)continue;_[n]=(r*ee+(1-r)*m)*255,_[n+1]=(r*C+(1-r)*h)*255,_[n+2]=(r*w+(1-r)*y)*255}else{let e=r+i*(1-r),t=i*(1-r);_[n]=(r*ee+t*m)/e*255,_[n+1]=(r*C+t*h)/e*255,_[n+2]=(r*w+t*y)/e*255,_[n+3]=e*255}}m.putImageData(h,c,l)}function j(e){let[t,n,r,i]=e,a=t.x-n.x+r.x-i.x,o=t.y-n.y+r.y-i.y;if(Math.abs(a)<1e-9&&Math.abs(o)<1e-9)return[n.x-t.x,i.x-t.x,t.x,n.y-t.y,i.y-t.y,t.y,0,0,1];let s=n.x-r.x,c=i.x-r.x,l=n.y-r.y,u=i.y-r.y,d=s*u-c*l,f=(a*u-c*o)/d,p=(s*o-a*l)/d;return[n.x-t.x+f*n.x,i.x-t.x+p*i.x,t.x,n.y-t.y+f*n.y,i.y-t.y+p*i.y,t.y,f,p,1]}function M(e){let[t,n,r,i,a,o,s,c,l]=e,u=a*l-o*c,d=-(i*l-o*s),f=i*c-a*s,p=1/(t*u+n*d+r*f);return[u*p,-(n*l-r*c)*p,(n*o-r*a)*p,d*p,(t*l-r*s)*p,-(t*o-r*i)*p,f*p,-(t*c-n*s)*p,(t*a-n*i)*p]}function N(e){let t=0;for(let n=0;n<4;n++){let r=e[n],i=e[(n+1)%4],a=e[(n+2)%4],o=(i.x-r.x)*(a.y-i.y)-(i.y-r.y)*(a.x-i.x);if(Math.abs(o)<1e-6)return!1;let s=Math.sign(o);if(t&&s!==t)return!1;t=s}return!0}function P(e,t,n){let r=!1;for(let i=0,a=e.length-1;i<e.length;a=i++){let o=e[i],s=e[a];o.y>n!=s.y>n&&t<(s.x-o.x)*(n-o.y)/(s.y-o.y)+o.x&&(r=!r)}return r}function F(e,t,n,r){let i=Math.floor(Math.min(...r.map(e=>e.x))),a=Math.floor(Math.min(...r.map(e=>e.y))),o=Math.ceil(Math.max(...r.map(e=>e.x))),s=Math.ceil(Math.max(...r.map(e=>e.y))),c=Math.max(1,o-i),l=Math.max(1,s-a),u=new Uint8ClampedArray(c*l*4),d=M(j(r));for(let r=0;r<l;r++){let o=a+r+.5;for(let a=0;a<c;a++){let s=i+a+.5,l=d[6]*s+d[7]*o+d[8];if(l<=0)continue;let f=(d[0]*s+d[1]*o+d[2])/l*t-.5,p=(d[3]*s+d[4]*o+d[5])/l*n-.5;if(f<-1||p<-1||f>t||p>n)continue;let m=Math.floor(f),h=Math.floor(p),g=f-m,_=p-h,v=0,y=0,b=0,x=0;for(let r=0;r<4;r++){let i=m+(r&1),a=h+(r>>1);if(i<0||a<0||i>=t||a>=n)continue;let o=(r&1?g:1-g)*(r>>1?_:1-_),s=(a*t+i)*4,c=e[s+3]*o;v+=e[s]*c,y+=e[s+1]*c,b+=e[s+2]*c,x+=c}if(x<=0)continue;let S=(r*c+a)*4;u[S]=v/x,u[S+1]=y/x,u[S+2]=b/x,u[S+3]=x}}return{data:u,x:i,y:a,width:c,height:l}}var I=[{id:`none`,label:`None`},{id:`arc`,label:`Arc`},{id:`arch`,label:`Arch`},{id:`bulge`,label:`Bulge`},{id:`flag`,label:`Flag`},{id:`wave`,label:`Wave`},{id:`rise`,label:`Rise`}];function de(e,t,n,r,i,a,o){if(r-=.5,i-=.5,r<-1||i<-1||r>t||i>n)return;let s=Math.floor(r),c=Math.floor(i),l=r-s,u=i-c,d=0,f=0,p=0,m=0;for(let r=0;r<4;r++){let i=s+(r&1),a=c+(r>>1);if(i<0||a<0||i>=t||a>=n)continue;let o=(r&1?l:1-l)*(r>>1?u:1-u),h=(a*t+i)*4,g=e[h+3]*o;d+=e[h]*g,f+=e[h+1]*g,p+=e[h+2]*g,m+=g}m<=0||(a[o]=d/m,a[o+1]=f/m,a[o+2]=p/m,a[o+3]=m)}function L(e,t,n,r,i){let a=Math.max(-1,Math.min(1,i/100));if(r===`none`||Math.abs(a)<.005)return{data:e,width:t,height:n,dx:0,dy:0};if(r===`arc`){let r=Math.sign(a),i=t/(Math.abs(a)*Math.PI),o=(e,a)=>{let o=(e-t/2)/i,s=r>0?i+(n/2-a):i+(a-n/2);return r>0?{x:s*Math.sin(o),y:-s*Math.cos(o)}:{x:s*Math.sin(o),y:s*Math.cos(o)}},s=1/0,c=1/0,l=-1/0,u=-1/0;for(let e=0;e<=64;e++)for(let[r,i]of[[t*e/64,0],[t*e/64,n],[0,n*e/64],[t,n*e/64]]){let e=o(r,i);s=Math.min(s,e.x),c=Math.min(c,e.y),l=Math.max(l,e.x),u=Math.max(u,e.y)}let d=Math.ceil(l-s)+2,f=Math.ceil(u-c)+2,p=new Uint8ClampedArray(d*f*4),m=Math.floor(s)-1,h=Math.floor(c)-1;for(let a=0;a<f;a++)for(let o=0;o<d;o++){let s=o+m+.5,c=a+h+.5,l=Math.hypot(s,c),u=r>0?Math.atan2(s,-c):Math.atan2(s,c);de(e,t,n,t/2+u*i,r>0?n/2-(l-i):n/2+(l-i),p,(a*d+o)*4)}let g=o(t/2,n/2);return{data:p,width:d,height:f,dx:m-g.x+t/2,dy:h-g.y+n/2}}let o=n*.6*a,s=(e,i)=>{let a=e/t;switch(r){case`arch`:return-o*Math.sin(Math.PI*a);case`flag`:return o*.5*Math.sin(2*Math.PI*a);case`wave`:return o*.5*Math.sin(2*Math.PI*a+i/n*Math.PI*.5);case`rise`:return-o*(a-.5)*2;default:return 0}},c=Math.ceil(Math.abs(o))+2,l=t,u=n+c*2,d=new Uint8ClampedArray(l*u*4);for(let i=0;i<u;i++)for(let o=0;o<l;o++){let u=i-c+.5,f=o+.5,p;if(r===`bulge`){let e=1+a*.6*Math.sin(f/t*Math.PI);p=n/2+(u-n/2)/Math.max(.05,e)}else{p=u-s(f,u);for(let e=0;e<3;e++)p=u-s(f,p)}de(e,t,n,f,p,d,(i*l+o)*4)}return{data:d,width:l,height:u,dx:0,dy:-c}}var R=.8;function fe(e){return`${e.italic?`italic `:``}${e.weight} ${e.size}px ${JSON.stringify(e.font)}, system-ui, sans-serif`}function z(e){return{font:e.font,size:e.size,weight:e.weight,italic:e.italic,color:e.color,underline:!!e.underline,strike:!!e.strike}}function pe(e){let t=z(e),n=Array.from({length:e.text.length},()=>t);for(let t of e.runs??[])for(let r=Math.max(0,t.start);r<Math.min(e.text.length,t.end);r++)n[r]={...n[r],...me(t)};return n}function me(e){let t={};for(let n of[`font`,`size`,`weight`,`italic`,`color`,`underline`,`strike`])e[n]!==void 0&&(t[n]=e[n]);return t}var he=(e,t)=>e===t||e.font===t.font&&e.size===t.size&&e.weight===t.weight&&e.italic===t.italic&&e.color===t.color&&e.underline===t.underline&&e.strike===t.strike;function ge(t,n,i){let a=e(r(`textMeasure`,4,4));return a.font=fe(n),a.measureText(t).width+t.length*i}function B(e,t,n,r){let i=[],a=0,o=t;for(;o<n;){let t=o+1;for(;t<n&&he(e.styles[t],e.styles[o]);)t++;let s=e.chars.slice(o,t).join(``),c=ge(s,e.styles[o],r);i.push({text:s,style:e.styles[o],x:a,width:c}),a+=c,o=t}return i}function _e(e){let t=pe(e),n=e.text,r=[],i=t=>e.caps?t.toUpperCase():t,a=0,o=[];for(let e=0;e<=n.length;e++)(e===n.length||n[e]===`
`)&&(o.push([a,e]),a=e+1);let s={chars:Array.from(n,i),styles:t},c=e.boxWidth&&e.boxWidth>0?e.boxWidth:0;for(let[t,i]of o){if(!c||t===i){r.push({from:t,to:i,g:s});continue}let a=t,o=t,l=-1;for(;o<i;)n[o]===` `&&(l=o),ve(s,a,o+1,e.tracking)>c&&o>a?(l>=a?(r.push({from:a,to:l,g:s}),a=l+1):(r.push({from:a,to:o,g:s}),a=o),l=-1,o=a):o++;r.push({from:a,to:i,g:s})}let l=[],u=0;for(let t of r){let n=B(t.g,t.from,t.to,e.tracking),r=Math.max(0,n.reduce((e,t)=>e+t.width,0)-(t.to>t.from?e.tracking:0)),i=Math.max(e.size,...t.g.styles.slice(t.from,t.to).map(e=>e.size)),a=i*e.lineHeight;l.push({segments:n,width:r,top:u,height:a,baseline:u+(a-i)/2+i*R}),u+=a}let d=Math.max(1,c||0,...l.map(e=>e.width));for(let t of l){let n=e.align===`center`?(d-t.width)/2:e.align===`right`?d-t.width:0;for(let e of t.segments)e.x+=n}return{width:d,height:Math.max(1,u),lines:l}}function ve(e,t,n,r){let i=0;for(let a of B(e,t,n,r))i+=a.width;return i-(n>t?r:0)}function ye(e,t,n,r,i){if(e.textBaseline=`top`,e.textAlign=`left`,`letterSpacing`in e&&(e.letterSpacing=`${t.tracking}px`),t.box){let a=t.boxPad??0;e.fillStyle=t.boxColor??`#000000`,e.beginPath(),e.roundRect(r-a,i-a,n.width+a*2,n.height+a*2,Math.max(0,t.boxRadius??0)),e.fill()}for(let a of n.lines)for(let n of a.segments){let o=n.style;e.font=fe(o);let s=r+n.x,c=i+a.baseline-o.size*R;t.shadow&&(e.save(),e.shadowColor=`rgba(0,0,0,0.55)`,e.shadowBlur=o.size*.15,e.shadowOffsetY=o.size*.06,e.fillStyle=o.color,e.fillText(n.text,s,c),e.restore()),t.stroke>0&&(e.lineJoin=`round`,e.lineWidth=t.stroke*2,e.strokeStyle=t.strokeColor,e.strokeText(n.text,s,c)),e.fillStyle=o.color,e.fillText(n.text,s,c);let l=Math.max(1,o.size*.06),u=c+o.size*R;o.underline&&e.fillRect(s,u+o.size*.1,n.width-t.tracking,l),o.strike&&e.fillRect(s,u-o.size*.3,n.width-t.tracking,l)}}function be(e,t){let n=[],r=e=>JSON.stringify(e),i=0;for(;i<t;){let a=r(e[i]),o=i+1;for(;o<t&&r(e[o])===a;)o++;a!==`{}`&&n.push({start:i,end:o,...e[i]}),i=o}return n}function xe(e){let t=Array.from({length:e.text.length},()=>({}));for(let n of e.runs??[]){let{start:r,end:i,...a}=n;for(let n=Math.max(0,r);n<Math.min(e.text.length,i);n++)t[n]={...t[n],...a}}return t}function Se(e,t,n,r){let i=xe(e),a=z(e);for(let o=Math.max(0,t);o<Math.min(e.text.length,n);o++){let e={...i[o],...r};for(let t of Object.keys(e))(e[t]===void 0||e[t]===a[t])&&delete e[t];i[o]=e}return be(i,e.text.length)}function Ce(e,t,n){if(!e?.length)return e;let r=0;for(;r<t.length&&r<n.length&&t[r]===n[r];)r++;let i=0;for(;i<t.length-r&&i<n.length-r&&t[t.length-1-i]===n[n.length-1-i];)i++;let a=t.length-i,o=n.length-t.length,s=(e,t)=>e<r?e:e>=a?e+o:t?a+o:r;return e.map(e=>({...e,start:s(e.start,!1),end:s(e.end,!0)})).filter(e=>e.end>e.start)}function we(e,t){return pe(e)[Math.max(0,Math.min(e.text.length-1,t))]??z(e)}function V(e){let t=new Uint8Array(256),n=[...e].sort((e,t)=>e.x-t.x);if(n.length<2){for(let e=0;e<256;e++)t[e]=e;return t}let r=n.length,i=n.map(e=>e.x),a=n.map(e=>e.y),o=[],s=[];for(let e=0;e<r-1;e++){let t=i[e+1]-i[e]||1e-6;o.push((a[e+1]-a[e])/t)}s[0]=o[0],s[r-1]=o[r-2];for(let e=1;e<r-1;e++)s[e]=o[e-1]*o[e]<=0?0:(o[e-1]+o[e])/2;for(let e=0;e<r-1;e++){if(o[e]===0){s[e]=0,s[e+1]=0;continue}let t=s[e]/o[e],n=s[e+1]/o[e],r=t*t+n*n;if(r>9){let i=3/Math.sqrt(r);s[e]=i*t*o[e],s[e+1]=i*n*o[e]}}let c=0;for(let e=0;e<256;e++){let n;if(e<=i[0])n=a[0];else if(e>=i[r-1])n=a[r-1];else{for(;c<r-2&&e>i[c+1];)c++;let t=i[c+1]-i[c]||1e-6,o=(e-i[c])/t,l=o*o,u=l*o;n=(2*u-3*l+1)*a[c]+(u-2*l+o)*t*s[c]+(-2*u+3*l)*a[c+1]+(u-l)*t*s[c+1]}t[e]=Math.max(0,Math.min(255,Math.round(n)))}return t}function H(e){let t=new Uint8Array(256),n=Math.max(1,e.inWhite-e.inBlack),r=1/Math.max(.05,e.gamma);for(let i=0;i<256;i++){let a=(Math.min(e.inWhite,Math.max(e.inBlack,i))-e.inBlack)/n;a**=+r,t[i]=Math.max(0,Math.min(255,Math.round(e.outBlack+a*(e.outWhite-e.outBlack))))}return t}function U(e){let t=H(e.levels),n=V(e.curves.rgb),r=V(e.curves.r),i=V(e.curves.g),a=V(e.curves.b),o=new Uint8Array(1024);for(let e=0;e<256;e++){let s=n[t[e]];o[e*4]=r[s],o[e*4+1]=i[s],o[e*4+2]=a[s],o[e*4+3]=255}return o}var Te=65;function W(e){let t=0,n=[0,0,0],r=[1,1,1],i=[];for(let a of e.split(/\r?\n/)){let e=a.trim();if(!e||e.startsWith(`#`))continue;let o=e.split(/\s+/),s=o[0].toUpperCase();if(s!==`TITLE`){if(s===`LUT_1D_SIZE`)throw Error(`1D LUTs are not supported, use a 3D .cube`);if(s===`LUT_3D_SIZE`){if(t=parseInt(o[1],10),!(t>=2&&t<=Te))throw Error(`Unsupported LUT size ${o[1]}`)}else if(s===`DOMAIN_MIN`)n=o.slice(1,4).map(Number);else if(s===`DOMAIN_MAX`)r=o.slice(1,4).map(Number);else if(!/^[A-Z_]+$/.test(s)){if(o.length<3)throw Error(`Malformed LUT line`);for(let e=0;e<3;e++){let t=Number(o[e]);if(!Number.isFinite(t))throw Error(`Malformed LUT value`);i.push((t-n[e])/(r[e]-n[e]||1))}}}}if(!t)throw Error(`Missing LUT_3D_SIZE`);if(i.length!==t*t*t*3)throw Error(`Expected ${t**3} entries, found ${i.length/3}`);return{size:t,data:Float32Array.from(i,e=>Math.max(0,Math.min(1,e)))}}function G(e){let t=new Uint16Array(e.data.length);for(let n=0;n<t.length;n++)t[n]=Math.round(e.data[n]*65535);let n=new Uint8Array(t.buffer),r=``;for(let e=0;e<n.length;e+=32768)r+=String.fromCharCode(...n.subarray(e,e+32768));return btoa(r)}function K(e,t){let n=atob(e),r=new Uint8Array(n.length);for(let e=0;e<n.length;e++)r[e]=n.charCodeAt(e);let i=new Uint16Array(r.buffer,0,Math.min(r.length>>1,t*t*t*3));return Float32Array.from(i,e=>e/65535)}var q=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,J=`#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform sampler2D u_lut;
uniform vec2 u_size;
uniform float u_lod;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
uniform vec3 u_wb;
uniform float u_vibrance, u_saturation, u_hue;
uniform float u_clarity, u_dehaze, u_sharpen;
uniform float u_vignette, u_grain, u_fade;
uniform float u_bw, u_invert, u_threshold, u_posterize;
uniform vec3 u_hsl[8];
uniform vec4 u_grade;
uniform float u_balance;
uniform float u_useLut;
uniform vec3 u_mixR, u_mixG, u_mixB;
uniform float u_useMix, u_mixMono;
uniform vec4 u_sel[9];
uniform float u_useSel;
uniform vec3 u_pfColor;
uniform float u_pfDensity, u_pfPreserve;
uniform vec3 u_gm0, u_gm1, u_gm2;
uniform float u_gmAmount, u_gmMid;
uniform vec3 u_cbS, u_cbM, u_cbH;
uniform float u_useCb, u_cbPreserve;
uniform float u_useBw;
uniform vec3 u_bwPrim; // reds, greens, blues
uniform vec3 u_bwSec;  // yellows, cyans, magentas
uniform vec3 u_bwTint;
uniform float u_bwUseTint;
uniform highp sampler3D u_lut3;
uniform float u_lutAmount, u_lutSize;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float CENTERS[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 275.0, 315.0);

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 localMean(vec2 uv) {
  vec2 t = exp2(u_lod) / u_size;
  vec3 s = textureLod(u_src, uv, u_lod).rgb * 0.4;
  s += textureLod(u_src, uv + vec2(t.x, 0.0), u_lod).rgb * 0.15;
  s += textureLod(u_src, uv - vec2(t.x, 0.0), u_lod).rgb * 0.15;
  s += textureLod(u_src, uv + vec2(0.0, t.y), u_lod).rgb * 0.15;
  s += textureLod(u_src, uv - vec2(0.0, t.y), u_lod).rgb * 0.15;
  return s;
}

void main() {
  vec4 src = texture(u_src, v_uv);
  if (src.a <= 0.0) { outColor = vec4(0.0); return; }
  vec3 c = src.rgb;

  // Sharpen (unsharp against 4-neighbour mean of the source)
  if (u_sharpen > 0.0) {
    vec2 px = 1.0 / u_size;
    vec3 n = texture(u_src, v_uv + vec2(px.x, 0.0)).rgb + texture(u_src, v_uv - vec2(px.x, 0.0)).rgb
           + texture(u_src, v_uv + vec2(0.0, px.y)).rgb + texture(u_src, v_uv - vec2(0.0, px.y)).rgb;
    c += (c - n * 0.25) * u_sharpen * 2.0;
  }

  // White balance + exposure in linear light
  vec3 lin = pow(max(c, 0.0), vec3(2.2));
  lin *= u_wb * exp2(u_exposure);
  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));

  vec3 blurC = localMean(v_uv);
  float Lb = dot(blurC, LUMA);

  // Dehaze (dark-channel style haze removal on the local mean)
  if (u_dehaze != 0.0) {
    float dark = min(min(blurC.r, blurC.g), blurC.b);
    if (u_dehaze > 0.0) {
      float t = max(1.0 - u_dehaze * 0.85 * dark, 0.2);
      c = (c - vec3(0.92) * (1.0 - t)) / t;
    } else {
      c = mix(c, vec3(0.78), -u_dehaze * 0.45);
    }
  }

  // Tonal regions
  float L = dot(c, LUMA);
  float Lm = mix(L, Lb, 0.6);
  float dL = 0.0;
  float shMask = 1.0 - smoothstep(0.0, 0.6, Lm);
  float hiMask = smoothstep(0.4, 1.0, Lm);
  dL += u_shadows * 0.45 * shMask * (u_shadows > 0.0 ? (1.0 - L) : L);
  dL += u_highlights * 0.45 * hiMask * (u_highlights > 0.0 ? (1.0 - L) : L);
  dL += u_whites * 0.3 * smoothstep(0.45, 1.0, L);
  dL += u_blacks * 0.3 * (1.0 - smoothstep(0.0, 0.5, L));
  if (dL != 0.0) {
    float nL = clamp(L + dL, 0.0, 1.5);
    c *= min(nL / max(L, 0.002), 6.0);
    if (L < 0.002) c += vec3(nL);
  }

  // Clarity: midtone local contrast
  if (u_clarity != 0.0) {
    float L2 = dot(c, LUMA);
    float mid = 1.0 - pow(abs(L2 - 0.5) * 2.0, 2.0);
    c += (L2 - Lb) * u_clarity * 1.6 * mid;
  }

  // Contrast (filmic S-curve)
  if (u_contrast > 0.0) {
    vec3 cc = clamp(c, 0.0, 1.0);
    vec3 s = cc * cc * (3.0 - 2.0 * cc);
    c = mix(c, s, u_contrast);
  } else if (u_contrast < 0.0) {
    c = mix(c, vec3(0.5) + (c - 0.5) * 0.4, -u_contrast);
  }

  c = clamp(c, 0.0, 1.0);

  // Saturation + vibrance (vibrance protects already-saturated colors)
  float L3 = dot(c, LUMA);
  if (u_saturation != 0.0) c = mix(vec3(L3), c, 1.0 + u_saturation);
  if (u_vibrance != 0.0) {
    float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
    c = mix(vec3(L3), c, 1.0 + u_vibrance * (1.0 - sat) * 1.2);
  }
  c = clamp(c, 0.0, 1.0);

  // Hue + 8-band HSL mixer
  vec3 hsv = rgb2hsv(c);
  float hdeg = hsv.x * 360.0;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = abs(hdeg - CENTERS[i]);
    d = min(d, 360.0 - d);
    float w = max(0.0, 1.0 - d / 42.0);
    acc += u_hsl[i] * w;
    wsum += w;
  }
  if (wsum > 0.0) acc /= max(wsum, 1.0);
  float hueShift = u_hue + acc.x * 30.0;
  if (hueShift != 0.0 || acc.y != 0.0 || acc.z != 0.0) {
    hsv.x = fract(hsv.x + hueShift / 360.0);
    hsv.y = clamp(hsv.y * (1.0 + acc.y), 0.0, 1.0);
    hsv.z = clamp(hsv.z * (1.0 + acc.z * 0.5 * hsv.y), 0.0, 1.0);
    c = hsv2rgb(hsv);
  }

  // Color grading (split toning)
  if (u_grade.y > 0.0 || u_grade.w > 0.0) {
    float L4 = dot(c, LUMA);
    float pivot = 0.5 + u_balance * 0.3;
    float ws = 1.0 - smoothstep(0.0, pivot, L4);
    float wh = smoothstep(pivot, 1.0, L4);
    vec3 sh = hsv2rgb(vec3(u_grade.x / 360.0, 1.0, 1.0)) - 0.5;
    vec3 hi = hsv2rgb(vec3(u_grade.z / 360.0, 1.0, 1.0)) - 0.5;
    c += sh * u_grade.y * ws * 0.35 + hi * u_grade.w * wh * 0.35;
  }
  c = clamp(c, 0.0, 1.0);

  // Levels + curves
  if (u_useLut > 0.5) {
    c.r = texture(u_lut, vec2((c.r * 255.0 + 0.5) / 256.0, 0.5)).r;
    c.g = texture(u_lut, vec2((c.g * 255.0 + 0.5) / 256.0, 0.5)).g;
    c.b = texture(u_lut, vec2((c.b * 255.0 + 0.5) / 256.0, 0.5)).b;
  }

  // Color balance: per tonal range, shifts along the cyan-red, magenta-green, yellow-blue axes
  if (u_useCb > 0.5) {
    float L0 = dot(c, LUMA);
    float wS = 1.0 - smoothstep(0.0, 0.5, L0);
    float wH = smoothstep(0.5, 1.0, L0);
    float wM = clamp(1.0 - wS - wH, 0.0, 1.0);
    c += (u_cbS * wS + u_cbM * wM + u_cbH * wH) * 0.4;
    c = clamp(c, 0.0, 1.0);
    if (u_cbPreserve > 0.5) c = clamp(c * (L0 / max(dot(c, LUMA), 0.001)), 0.0, 1.0);
  }

  // Black & White mixer (Photoshop's model: gray = min + secondary·(mid − min) + primary·(max − mid))
  if (u_useBw > 0.5) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float md = c.r + c.g + c.b - mx - mn;
    float prim = c.r >= mx ? u_bwPrim.x : (c.g >= mx ? u_bwPrim.y : u_bwPrim.z);
    // Secondary: the two largest channels — r+g = yellow, g+b = cyan, r+b = magenta
    float sec = c.b <= mn ? u_bwSec.x : (c.r <= mn ? u_bwSec.y : u_bwSec.z);
    float gray = clamp(mn + sec * (md - mn) + prim * (mx - md), 0.0, 1.0);
    c = u_bwUseTint > 0.5 ? clamp(u_bwTint * (gray / max(dot(u_bwTint, LUMA), 0.001)), 0.0, 1.0) : vec3(gray);
  }

  // Color lookup (3D LUT)
  if (u_lutAmount > 0.0) {
    vec3 lc = texture(u_lut3, c * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize).rgb;
    c = mix(c, clamp(lc, 0.0, 1.0), u_lutAmount);
  }

  // Channel mixer
  if (u_useMix > 0.5) {
    vec3 m = vec3(dot(c, u_mixR), dot(c, u_mixG), dot(c, u_mixB));
    c = clamp(u_mixMono > 0.5 ? vec3(m.r) : m, 0.0, 1.0);
  }

  // Selective color: each range's weight comes from how strongly the pixel belongs to it
  if (u_useSel > 0.5) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float md = c.r + c.g + c.b - mx - mn;
    float w[9];
    w[0] = c.r >= mx ? mx - md : 0.0;   // reds
    w[1] = c.b <= mn ? md - mn : 0.0;   // yellows
    w[2] = c.g >= mx ? mx - md : 0.0;   // greens
    w[3] = c.r <= mn ? md - mn : 0.0;   // cyans
    w[4] = c.b >= mx ? mx - md : 0.0;   // blues
    w[5] = c.g <= mn ? md - mn : 0.0;   // magentas
    w[6] = max(0.0, mn - 0.5) * 2.0;    // whites
    w[7] = max(0.0, 1.0 - (abs(mx - 0.5) + abs(mn - 0.5)));  // neutrals
    w[8] = max(0.0, 0.5 - mx) * 2.0;    // blacks
    vec3 ink = vec3(0.0);
    for (int i = 0; i < 9; i++) ink += w[i] * (u_sel[i].xyz + vec3(u_sel[i].w));
    c = clamp(c - ink, 0.0, 1.0);
  }

  // Photo filter
  if (u_pfDensity > 0.0) {
    float L0 = dot(c, LUMA);
    vec3 f = c * mix(vec3(1.0), u_pfColor, u_pfDensity);
    if (u_pfPreserve > 0.5) f *= L0 / max(dot(f, LUMA), 0.001);
    c = clamp(f, 0.0, 1.0);
  }

  // Gradient map
  if (u_gmAmount > 0.0) {
    float Lg = clamp(dot(c, LUMA), 0.0, 1.0);
    vec3 g = u_gmMid > 0.5
      ? (Lg < 0.5 ? mix(u_gm0, u_gm1, Lg * 2.0) : mix(u_gm1, u_gm2, Lg * 2.0 - 1.0))
      : mix(u_gm0, u_gm2, Lg);
    c = mix(c, g, u_gmAmount);
  }

  if (u_bw > 0.5) c = vec3(dot(c, vec3(0.3, 0.59, 0.11)));
  if (u_invert > 0.5) c = 1.0 - c;
  if (u_threshold > 0.0) c = vec3(step(u_threshold, dot(c, LUMA)));
  if (u_posterize > 1.0) c = floor(c * (u_posterize - 1.0) + 0.5) / (u_posterize - 1.0);

  // Vignette
  if (u_vignette != 0.0) {
    vec2 p = (v_uv - 0.5) * 2.0;
    float v = smoothstep(0.45, 1.45, length(p));
    if (u_vignette < 0.0) c *= 1.0 + u_vignette * v;
    else c = mix(c, vec3(1.0), u_vignette * v);
  }
  // Grain (luminance weighted)
  if (u_grain > 0.0) {
    float n = hash(floor(v_uv * u_size)) - 0.5;
    float Lg = dot(c, LUMA);
    c += n * u_grain * 0.22 * (1.0 - abs(Lg - 0.5));
  }
  if (u_fade > 0.0) c = mix(c, vec3(0.09) + c * 0.84, u_fade);

  outColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;function Ee(e){return JSON.stringify({...De,...e})===Oe}var De=u(),Oe=JSON.stringify(De);function ke(e){let t=new Float32Array(e*e*e*4);for(let n=0;n<e;n++)for(let r=0;r<e;r++)for(let i=0;i<e;i++){let a=((n*e+r)*e+i)*4;t.set([i/(e-1),r/(e-1),n/(e-1),1],a)}return t}function Y(e){let t=parseInt(e.replace(`#`,``).slice(0,6),16)||0;return[(t>>16&255)/255,(t>>8&255)/255,(t&255)/255]}function Ae(e,t){let n=e/100,r=t/100,i=1+.32*n+.08*r,a=1-.22*r,o=1-.32*n+.08*r;i=Math.max(.2,i),o=Math.max(.2,o);let s=.2126*i+.7152*a+.0722*o;return[i/s,a/s,o/s]}var je=class{canvas;gl;prog;srcTex;lutTex;uniforms=new Map;lastSrcKey=null;lastLutKey=``;constructor(){this.canvas=document.createElement(`canvas`);let e=this.canvas.getContext(`webgl2`,{premultipliedAlpha:!1,preserveDrawingBuffer:!0,antialias:!1});if(!e)throw Error(`WebGL2 unavailable`);this.gl=e,this.prog=this.link(q,J),e.useProgram(this.prog);let t=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,t),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW);let n=e.getAttribLocation(this.prog,`a_pos`);e.enableVertexAttribArray(n),e.vertexAttribPointer(n,2,e.FLOAT,!1,0,0),this.srcTex=e.createTexture(),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.srcTex),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),this.lutTex=e.createTexture(),e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,this.lutTex),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),this.lut3Tex=e.createTexture(),e.activeTexture(e.TEXTURE2),e.bindTexture(e.TEXTURE_3D,this.lut3Tex),e.texParameteri(e.TEXTURE_3D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_3D,e.TEXTURE_MAG_FILTER,e.LINEAR);for(let t of[e.TEXTURE_WRAP_S,e.TEXTURE_WRAP_T,e.TEXTURE_WRAP_R])e.texParameteri(e.TEXTURE_3D,t,e.CLAMP_TO_EDGE);e.texImage3D(e.TEXTURE_3D,0,e.RGBA16F,2,2,2,0,e.RGBA,e.FLOAT,ke(2)),e.uniform1i(this.u(`u_src`),0),e.uniform1i(this.u(`u_lut`),1),e.uniform1i(this.u(`u_lut3`),2)}lut3Tex;lastLut3=``;bindLut(e){let t=this.gl;t.activeTexture(t.TEXTURE2),t.bindTexture(t.TEXTURE_3D,this.lut3Tex);let n=`${e.size}:${e.data.length}:${e.data.slice(0,64)}:${e.data.slice(-64)}`;if(n===this.lastLut3)return;let r=e.size,i=K(e.data,r),a=new Float32Array(r*r*r*4);for(let e=0;e<r*r*r;e++)a[e*4]=i[e*3],a[e*4+1]=i[e*3+1],a[e*4+2]=i[e*3+2],a[e*4+3]=1;t.texImage3D(t.TEXTURE_3D,0,t.RGBA16F,r,r,r,0,t.RGBA,t.FLOAT,a),this.lastLut3=n}link(e,t){let n=this.gl,r=(e,t)=>{let r=n.createShader(e);if(n.shaderSource(r,t),n.compileShader(r),!n.getShaderParameter(r,n.COMPILE_STATUS))throw Error(n.getShaderInfoLog(r)||`shader error`);return r},i=n.createProgram();if(n.attachShader(i,r(n.VERTEX_SHADER,e)),n.attachShader(i,r(n.FRAGMENT_SHADER,t)),n.linkProgram(i),!n.getProgramParameter(i,n.LINK_STATUS))throw Error(n.getProgramInfoLog(i)||`link error`);return i}u(e){return this.uniforms.has(e)||this.uniforms.set(e,this.gl.getUniformLocation(this.prog,e)),this.uniforms.get(e)}process(e,t,n){let r=this.gl,{width:i,height:a}=e;(this.canvas.width!==i||this.canvas.height!==a)&&(this.canvas.width=i,this.canvas.height=a,this.lastSrcKey=null),r.viewport(0,0,i,a),r.useProgram(this.prog),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,this.srcTex),(n===null||n!==this.lastSrcKey)&&(r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,!1),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,r.RGBA,r.UNSIGNED_BYTE,e),r.generateMipmap(r.TEXTURE_2D),this.lastSrcKey=n);let o=JSON.stringify([t.levels,t.curves]),l=o!==Me;l&&o!==this.lastLutKey&&(r.activeTexture(r.TEXTURE1),r.bindTexture(r.TEXTURE_2D,this.lutTex),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,256,1,0,r.RGBA,r.UNSIGNED_BYTE,U(t)),this.lastLutKey=o),r.activeTexture(r.TEXTURE1),r.bindTexture(r.TEXTURE_2D,this.lutTex);let u=(e,t)=>r.uniform1f(this.u(e),t);r.uniform2f(this.u(`u_size`),i,a),u(`u_lod`,Math.max(1,Math.min(9,Math.log2(Math.max(i,a)/160)))),u(`u_exposure`,t.exposure),u(`u_contrast`,t.contrast/100),u(`u_highlights`,t.highlights/100),u(`u_shadows`,t.shadows/100),u(`u_whites`,t.whites/100),u(`u_blacks`,t.blacks/100),r.uniform3f(this.u(`u_wb`),...Ae(t.temperature,t.tint)),u(`u_vibrance`,t.vibrance/100),u(`u_saturation`,t.saturation/100),u(`u_hue`,t.hue),u(`u_clarity`,t.clarity/100),u(`u_dehaze`,t.dehaze/100),u(`u_sharpen`,t.sharpen/100),u(`u_vignette`,t.vignette/100),u(`u_grain`,t.grain/100),u(`u_fade`,t.fade/100),u(`u_bw`,+!!t.bw),u(`u_invert`,+!!t.invert),u(`u_threshold`,t.threshold>0?t.threshold/255:0),u(`u_posterize`,t.posterize),u(`u_useLut`,+!!l);let d=new Float32Array(24);s.forEach((e,n)=>{d[n*3]=t.hsl[e].h/100,d[n*3+1]=t.hsl[e].s/100,d[n*3+2]=t.hsl[e].l/100}),r.uniform3fv(this.u(`u_hsl[0]`),d),r.uniform4f(this.u(`u_grade`),t.grade.shadowHue,t.grade.shadowSat/100,t.grade.highlightHue,t.grade.highlightSat/100),u(`u_balance`,t.grade.balance/100);let f=De,p=t.mixer??f.mixer;u(`u_useMix`,JSON.stringify(p)===JSON.stringify(f.mixer)?0:1),r.uniform3f(this.u(`u_mixR`),p.r[0]/100,p.r[1]/100,p.r[2]/100),r.uniform3f(this.u(`u_mixG`),p.g[0]/100,p.g[1]/100,p.g[2]/100),r.uniform3f(this.u(`u_mixB`),p.b[0]/100,p.b[1]/100,p.b[2]/100),u(`u_mixMono`,+!!p.mono);let m=t.selective??f.selective,h=new Float32Array(36),g=!1;c.forEach((e,t)=>{let n=m[e]??{c:0,m:0,y:0,k:0};h.set([n.c/100,n.m/100,n.y/100,n.k/100],t*4),(n.c||n.m||n.y||n.k)&&(g=!0)}),u(`u_useSel`,+!!g),r.uniform4fv(this.u(`u_sel[0]`),h);let _=t.photoFilter??f.photoFilter;r.uniform3f(this.u(`u_pfColor`),...Y(_.color)),u(`u_pfDensity`,_.density/100),u(`u_pfPreserve`,+!!_.preserve);let v=t.gradientMap??f.gradientMap;r.uniform3f(this.u(`u_gm0`),...Y(v.shadow)),r.uniform3f(this.u(`u_gm1`),...Y(v.mid)),r.uniform3f(this.u(`u_gm2`),...Y(v.highlight)),u(`u_gmAmount`,v.amount/100),u(`u_gmMid`,+!!v.useMid);let y=t.colorBalance??f.colorBalance;u(`u_useCb`,+!![...y.shadows,...y.midtones,...y.highlights].some(e=>e!==0)),r.uniform3f(this.u(`u_cbS`),y.shadows[0]/100,y.shadows[1]/100,y.shadows[2]/100),r.uniform3f(this.u(`u_cbM`),y.midtones[0]/100,y.midtones[1]/100,y.midtones[2]/100),r.uniform3f(this.u(`u_cbH`),y.highlights[0]/100,y.highlights[1]/100,y.highlights[2]/100),u(`u_cbPreserve`,+!!y.preserve);let b=t.bwMix??f.bwMix;u(`u_useBw`,+!!b.enabled),r.uniform3f(this.u(`u_bwPrim`),b.reds/100,b.greens/100,b.blues/100),r.uniform3f(this.u(`u_bwSec`),b.yellows/100,b.cyans/100,b.magentas/100),r.uniform3f(this.u(`u_bwTint`),...Y(b.tintColor)),u(`u_bwUseTint`,+!!b.tint);let x=t.lut??null;return x&&x.amount>0?(this.bindLut(x),u(`u_lutAmount`,x.amount/100),u(`u_lutSize`,x.size)):u(`u_lutAmount`,0),r.drawArrays(r.TRIANGLE_STRIP,0,4),this.canvas}},Me=(()=>{let e=u();return JSON.stringify([e.levels,e.curves])})(),Ne;function Pe(){if(Ne===void 0)try{Ne=new je}catch(e){console.warn(`Skill Photo: GPU adjustments unavailable`,e),Ne=null}return Ne}function Fe(e){return`${e.italic?`italic `:``}${e.weight} ${e.size}px ${JSON.stringify(e.font)}, system-ui, sans-serif`}function Ie(e){let t=_e(e);return{width:t.width,height:t.height,lines:t.lines.map(e=>({text:e.segments.map(e=>e.text).join(``),width:e.width}))}}function Le(e,t,n,r){ye(e,t,_e(t),n,r)}function Re(e,t,n,r,i,a){e.beginPath();let o=n+i/2,s=r+a/2;switch(t.shape){case`rectangle`:t.radius>0?e.roundRect(n,r,i,a,Math.min(t.radius,Math.abs(i)/2,Math.abs(a)/2)):e.rect(n,r,i,a);break;case`ellipse`:e.ellipse(o,s,Math.abs(i)/2,Math.abs(a)/2,0,0,Math.PI*2);break;case`triangle`:e.moveTo(o,r),e.lineTo(n+i,r+a),e.lineTo(n,r+a),e.closePath();break;case`path`:{let o=t.points??[],s=e=>n+e*i,c=e=>r+e*a;if(o.forEach((t,n)=>{if(n===0)return e.moveTo(s(t.x),c(t.y));let r=o[n-1];e.bezierCurveTo(s(r.ox),c(r.oy),s(t.ix),c(t.iy),s(t.x),c(t.y))}),t.closed&&o.length>1){let t=o[o.length-1],n=o[0];e.bezierCurveTo(s(t.ox),c(t.oy),s(n.ix),c(n.iy),s(n.x),c(n.y)),e.closePath()}break}case`polygon`:case`star`:{let n=Math.max(3,t.sides),r=t.shape===`star`?n*2:n;for(let n=0;n<r;n++){let c=n*2*Math.PI/r-Math.PI/2,l=t.shape===`star`&&n%2==1?.45:1,u=o+Math.abs(i)/2*l*Math.cos(c),d=s+Math.abs(a)/2*l*Math.sin(c);n===0?e.moveTo(u,d):e.lineTo(u,d)}e.closePath();break}case`line`:case`arrow`:if(e.moveTo(n,r),e.lineTo(n+i,r+a),t.shape===`arrow`){let o=Math.atan2(a,i),s=Math.max(10,t.strokeWidth*4);e.moveTo(n+i,r+a),e.lineTo(n+i-s*Math.cos(o-.45),r+a-s*Math.sin(o-.45)),e.moveTo(n+i,r+a),e.lineTo(n+i-s*Math.cos(o+.45),r+a-s*Math.sin(o+.45))}}}function ze(e,t,n,r,i,a){Re(e,t,n,r,i,a);let o=t.shape===`line`||t.shape===`arrow`||t.shape===`path`&&!t.closed;!o&&t.fillEnabled&&(e.fillStyle=t.fill,e.fill()),(t.strokeWidth>0||o)&&(e.lineWidth=Math.max(1,t.strokeWidth),e.lineJoin=`round`,e.lineCap=`round`,e.strokeStyle=t.stroke,e.stroke())}var Be=new WeakMap;function Ve(){Be=new WeakMap}function He(t){if(t.kind===`raster`)return t.canvas?{canvas:t.canvas,x:t.x,y:t.y}:null;let n=Be.get(t);if(n)return n;let r=(t.kind===`text`||t.kind===`shape`)&&t.rotation?t.rotation:0,i=We(t),o=null;if(t.kind===`text`&&t.text){let n=t.text,s=Math.ceil(n.size*.5+n.stroke*2+4+(n.box?n.boxPad??0:0)),c=Ie(n),l={x:Math.floor(t.x)-s,y:Math.floor(t.y)-s,w:c.width+s*2,h:c.height+s*2},u=n.warp&&n.warp.style!==`none`&&n.warp.bend;if(r&&!u)return Ue(t,Ke(l,r,i,e=>Le(e,n,s,s)));let d=a(l.w,l.h);if(Le(e(d),n,s,s),o={canvas:d,x:l.x,y:l.y},u){let t=L(e(d).getImageData(0,0,d.width,d.height).data,d.width,d.height,n.warp.style,n.warp.bend),r=a(t.width,t.height);e(r).putImageData(new ImageData(t.data,t.width,t.height),0,0),o={canvas:r,x:o.x+Math.round(t.dx),y:o.y+Math.round(t.dy)}}}else if(t.kind===`shape`&&t.shape){let n=t.shape,s=Math.ceil(n.strokeWidth*4+16),c=Math.min(t.x,t.x+t.width),l=Math.min(t.y,t.y+t.height),u={x:Math.floor(c)-s,y:Math.floor(l)-s,w:Math.abs(t.width)+s*2,h:Math.abs(t.height)+s*2},d=e=>ze(e,n,t.x-u.x,t.y-u.y,t.width,t.height);if(r)return Ue(t,Ke(u,r,i,d));let f=a(u.w,u.h);d(e(f)),o={canvas:f,x:u.x,y:u.y}}return o&&r&&(o=qe(o,r,i.x,i.y)),o?Ue(t,o):null}function Ue(e,t){return Be.set(e,t),t}function We(e){return{x:e.x+e.width/2,y:e.y+e.height/2}}function Ge(e,t,n,r){let i=Math.cos(t),a=Math.sin(t),o=[[e.x,e.y],[e.x+e.w,e.y],[e.x+e.w,e.y+e.h],[e.x,e.y+e.h]].map(([e,t])=>({x:n+(e-n)*i-(t-r)*a,y:r+(e-n)*a+(t-r)*i})),s=Math.floor(Math.min(...o.map(e=>e.x))),c=Math.floor(Math.min(...o.map(e=>e.y)));return{x0:s,y0:c,w:Math.max(1,Math.ceil(Math.max(...o.map(e=>e.x)))-s),h:Math.max(1,Math.ceil(Math.max(...o.map(e=>e.y)))-c)}}function Ke(t,n,r,i){let o=n*Math.PI/180,s=Ge(t,o,r.x,r.y),c=a(s.w,s.h),l=e(c);return l.translate(r.x-s.x0,r.y-s.y0),l.rotate(o),l.translate(t.x-r.x,t.y-r.y),i(l),{canvas:c,x:s.x0,y:s.y0}}function qe(e,t,n,r){return Ke({x:e.x,y:e.y,w:e.canvas.width,h:e.canvas.height},t,{x:n,y:r},t=>{t.imageSmoothingQuality=`high`,t.drawImage(e.canvas,0,0)})}function Je(e){if(!e.text)return{width:e.width,height:e.height};let t=Ie(e.text);return{width:Math.ceil(t.width),height:Math.ceil(t.height)}}function Ye(e,n){return`${e.v}:${t(e.canvas)}:${t(e.mask?.canvas)}${n?`:o${t(n.canvas)}`:``}|`}function Xe(t,n,i){let a=t.mask;if(!a||!a.enabled)return n;let o=r(i,n.canvas.width,n.canvas.height),s=e(o);return s.drawImage(n.canvas,0,0),s.globalCompositeOperation=`destination-in`,s.drawImage(a.canvas,a.x-n.x,a.y-n.y),{canvas:o,x:n.x,y:n.y}}function Ze(t,n,r,i,a,o,s=!1){if(D(o))return ue(t,n,r,i,a,o,s);let c=e(t);c.save(),c.globalAlpha=a,c.globalCompositeOperation=o===`normal`?s?`source-atop`:`source-over`:o,c.drawImage(n,r,i),c.restore()}function Qe(e,t){let n=new Set(e.layers.filter(e=>e.kind===`group`).map(e=>e.id)),r=new Map;for(let t of e.layers){let e=t.parent&&n.has(t.parent)&&t.parent!==t.id?t.parent:void 0,i=r.get(e)??[];i.push(t),r.set(e,i)}return{doc:e,overrides:t,kids:r}}function X(e,t,n=new Set){let r=Ye(t,e.overrides?.get(t.id));if(t.kind===`group`&&!n.has(t.id)){n.add(t.id),r+=`[`;for(let i of e.kids.get(t.id)??[])r+=X(e,i,n);r+=`]`}return r}var $e=new Map;function et(t,r,i){let{width:o,height:s}=t.doc,c=`${o}x${s}|`;for(let e of t.kids.get(r.id)??[])c+=X(t,e,new Set([r.id]));let l=$e.get(r.id);if(!l||l.sig!==c||l.canvas.width!==o||l.canvas.height!==s){let u=l&&l.canvas.width===o&&l.canvas.height===s?l.canvas:a(o,s);e(u).clearRect(0,0,o,s),i<32&&rt(t,u,t.kids.get(r.id)??[],`G${r.id}|`,i+1),n(u),$e.size>64&&!l&&$e.delete($e.keys().next().value),l={sig:c,canvas:u},$e.set(r.id,l)}return{canvas:l.canvas,x:Math.round(r.x),y:Math.round(r.y)}}function tt(e,t,n){return t.kind===`group`?e.overrides?.get(t.id)??et(e,t,n):e.overrides?.get(t.id)??He(t)}function nt(e,t,n,r,i,a=!1){let o=a?1:n.opacity,s=a?`normal`:n.blend,c=`${i}${a?`b`:``}`;if(n.kind===`adjustment`){if(!n.adjust||Ee(n.adjust))return;let e=Pe();if(!e)return;let i={canvas:e.process(t,n.adjust,`${c}/${t.width}x${t.height}/${r}`),x:0,y:0};i=Xe(n,i,`adjmask${c}`),Ze(t,i.canvas,0,0,o,s,!0);return}let l=tt(e,n,i);if(!l)return;let u,d=o;if(m(n)){let e=ae(n,l);u=a?e.front:e.full}else u=Xe(n,l,`mask${c}`),d*=n.fill??1;Ze(t,u.canvas,u.x,u.y,d,s)}function rt(t,n,i,a,o){let s=0;for(;s<i.length;){let c=i[s],l=s+1;for(;l<i.length&&i[l].clip;)l++;let u=l,d=c.visible&&c.opacity>0;if(u===s+1||c.kind===`adjustment`){d&&nt(t,n,c,a,o),a+=X(t,c),s++;continue}let f=``;for(let e=s;e<u;e++)f+=X(t,i[e]);if(d){if(m(c)){let e=tt(t,c,o);if(e){let t=ae(c,e).behind;Ze(n,t.canvas,t.x,t.y,c.opacity,c.blend)}}let a=r(`clip${o}`,n.width,n.height);nt(t,a,c,`g`,o,!0);let l=`clip:${c.v}`;for(let c=s+1;c<u;c++){let s=i[c];if(s.visible&&s.opacity>0){if(s.kind===`adjustment`)nt(t,a,s,l,o);else{let i=tt(t,s,o);if(i){let t=m(s),c=t?ae(s,i).full:Xe(s,i,`clipmask${o}`),l=r(`clipTmp${o}`,n.width,n.height),u=e(l);u.drawImage(c.canvas,c.x,c.y),u.globalCompositeOperation=`destination-in`,u.drawImage(a,0,0),Ze(a,l,0,0,s.opacity*(t?1:s.fill??1),s.blend,!0)}}}l+=X(t,s)}Ze(n,a,0,0,c.opacity,c.blend)}a+=f,s=u}return a}function it(t,n,r){(n.width!==t.width||n.height!==t.height)&&(n.width=t.width,n.height=t.height),e(n).clearRect(0,0,t.width,t.height);let i=Qe(t,r);rt(i,n,i.kids.get(void 0)??[],`${t.width}x${t.height}|`,0)}var at=class{output=a(1,1);below=a(1,1);belowSig=``;lastSig=``;render(t,n){let{width:r,height:i}=t,a=Qe(t,n),o=a.kids.get(void 0)??[],s=new Map(t.layers.map(e=>[e.id,e])),c=s.get(t.activeId);for(let e=0;c?.parent&&s.get(c.parent)?.kind===`group`&&e<32;e++)c=s.get(c.parent);let l=Math.max(0,o.findIndex(e=>e.id===c?.id));for(;l>0&&o[l].clip;)l--;let u=`${r}x${i}|`;for(let e=0;e<l;e++)u+=X(a,o[e]);let d=u;for(let e=l;e<o.length;e++)d+=X(a,o[e]);if(d===this.lastSig&&this.output.width===r&&this.output.height===i)return this.output;(u!==this.belowSig||this.below.width!==r||this.below.height!==i)&&(this.below.width=r,this.below.height=i,e(this.below).clearRect(0,0,r,i),rt(a,this.below,o.slice(0,l),`${r}x${i}|`,0),this.belowSig=u),(this.output.width!==r||this.output.height!==i)&&(this.output.width=r,this.output.height=i);let f=e(this.output);return f.clearRect(0,0,r,i),f.drawImage(this.below,0,0),rt(a,this.output,o.slice(l),u,0),this.lastSig=d,this.output}invalidate(){this.lastSig=``,this.belowSig=``}get signature(){return this.lastSig}},ot=new WeakMap;function st(n,r,i,o=40,s=!1){let c=`${n.kind===`raster`?`r${t(n.canvas)}@${n.x},${n.y}`:`v${n.v}`}:${t(n.mask?.canvas)}:${s}:${r}x${i}`,l=ot.get(n.canvas??n);if(l&&l.key===c&&!s)return l.url;let u=Math.min(o/r,o/i),d=a(Math.max(1,Math.round(r*u)),Math.max(1,Math.round(i*u))),f=e(d);if(f.imageSmoothingQuality=`high`,s&&n.mask){f.fillStyle=`#000`,f.fillRect(0,0,d.width,d.height);let t=a(d.width,d.height),r=e(t);return r.fillStyle=`#fff`,r.fillRect(0,0,d.width,d.height),r.globalCompositeOperation=`destination-in`,r.drawImage(n.mask.canvas,n.mask.x*u,n.mask.y*u,n.mask.canvas.width*u,n.mask.canvas.height*u),f.drawImage(t,0,0),d}let p=He(n);return p&&f.drawImage(p.canvas,p.x*u,p.y*u,p.canvas.width*u,p.canvas.height*u),s||ot.set(n.canvas??n,{key:c,url:d}),d}var Z=e=>!!e&&e.kind===`group`;function Q(e){return new Map(e.map(e=>[e.id,e]))}function $(e,t){return t.parent&&Z((e instanceof Map?e:Q(e)).get(t.parent))?t.parent:void 0}function ct(e,t){let n=Q(e),r=[],i=new Set,a=$(n,t);for(;a&&!i.has(a);){i.add(a);let e=n.get(a);r.push(e),a=$(n,e)}return r}function lt(e,t){return t.visible&&ct(e,t).every(e=>e.visible)}function ut(e,t){let n=Q(e);return e.filter(e=>$(n,e)===t)}function dt(e,t){let n=Q(e);return e.filter(e=>{let r=new Set,i=$(n,e);for(;i&&!r.has(i);){if(i===t)return!0;r.add(i),i=$(n,n.get(i))}return!1})}function ft(e,t){return Z(t)?[...dt(e,t.id),t]:[t]}function pt(e){if(!e.some(e=>e.parent||e.kind===`group`))return e;let t=Q(e),n=e.map(e=>e.parent&&$(t,e)===void 0?y(e,{parent:void 0}):e),r=new Map,i=Q(n);for(let e of n){let t=$(i,e),n=r.get(t)??[];n.push(e),r.set(t,n)}let a=[],o=new Set,s=e=>{if(!o.has(e.id)){if(o.add(e.id),Z(e))for(let t of r.get(e.id)??[])s(t);a.push(e)}};for(let e of r.get(void 0)??[])s(e);for(let e of n)o.has(e.id)||a.push(y(e,{parent:void 0}));return a.length===e.length&&a.every((t,n)=>t===e[n])?e:a}function mt(e,t,n){let r=Q(e),i=e.filter(e=>t.includes(e.id));if(!i.length)return null;let a=new Set(i.map(e=>e.id)),o=i.filter(t=>!ct(e,t).some(e=>a.has(e.id))),s=o[o.length-1],c=v({kind:`group`,name:n,parent:$(r,s)}),l=new Set(o.map(e=>e.id)),u=[];for(let t of e)l.has(t.id)?u.push(y(t,{parent:c.id})):u.push(t),t.id===s.id&&u.push(c);return{layers:pt(u),group:c}}function ht(e,t){let n=Q(e),r=n.get(t);if(!r||!Z(r))return e;let i=$(n,r);return pt(e.filter(e=>e.id!==t).map(e=>e.parent===t?y(e,{parent:i}):e))}function gt(e,t,n,r){let i=Q(e),a=i.get(t),o=i.get(n);if(!a||!o||t===n||Z(a)&&(o.id===a.id||ct(e,o).some(e=>e.id===a.id)))return e;let s=ft(e,a),c=new Set(s.map(e=>e.id)),l=e.filter(e=>!c.has(e.id)),u=r===`into`?o.id:$(i,o),d=s.map(e=>e.id===t?y(e,{parent:u}):e),f;if(r===`above`||r===`into`)f=l.findIndex(e=>e.id===n)+ +(r===`above`);else{let e=ft(l,o);f=l.findIndex(t=>t.id===e[0].id)}return pt([...l.slice(0,f),...d,...l.slice(f)])}function _t(e,t,n){let r=Q(e),i=r.get(t);if(!i)return e;let a=ut(e,$(r,i)),o=a[a.findIndex(e=>e.id===t)+n];return o?gt(e,t,o.id,n===1?`above`:`below`):e}function vt(e){let t=e.filter(e=>Z(e)&&(e.x||e.y));if(!t.length)return e;let n=new Map;for(let r of t)for(let t of dt(e,r.id)){if(Z(t))continue;let e=n.get(t.id)??{dx:0,dy:0};n.set(t.id,{dx:e.dx+r.x,dy:e.dy+r.y})}return e.map(e=>{if(Z(e)&&(e.x||e.y))return y(e,{x:0,y:0});let t=n.get(e.id);return t?y(e,{x:e.x+t.dx,y:e.y+t.dy,mask:e.mask?{...e.mask,x:e.mask.x+t.dx,y:e.mask.y+t.dy}:void 0}):e})}export{I as A,u as B,G as C,Ce as D,_e as E,x as F,_ as G,p as H,o as I,y as K,s as L,P as M,F as N,we as O,ie as P,d as R,Pe as S,V as T,m as U,f as V,v as W,He as _,dt as a,Re as b,gt as c,_t as d,lt as f,Fe as g,Ve as h,ut as i,N as j,Se as k,pt as l,at as m,vt as n,mt as o,ht as p,ft as r,Z as s,ct as t,$ as u,st as v,W as w,Je as x,it as y,c as z};