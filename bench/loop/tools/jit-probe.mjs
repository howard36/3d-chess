// Where a WebGL program's cost lands under the bench's renderer (SwiftShader
// through ANGLE): links one synthetic fragment shader (N lines of sin/cos)
// and draws it twice, in one context and then in a second, and prints
// [link + status ms, first draw + read-back ms, second draw ms] per case.
// Run 1303 found the link ~1-4 ms and the first draw of each program 14-150
// ms (by the shader's length): a draw-time JIT, paid again by a new program
// object of the same source, in the same context or a second one (Chromium's
// program cache only makes the link cheaper).
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=... node jit-probe.mjs   (from client/)
import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});
const page = await (await browser.newContext()).newPage();
await page.goto('about:blank');
console.log(
  await page.evaluate(() => {
    const heavy = (tag, n) => {
      let body = '';
      for (let i = 0; i < n; i++)
        body += `c += sin(c.yzx * ${(i * 0.37 + 1).toFixed(2)} + u${i % 8}) * cos(c.zxy + float(${i}));\n`;
      return `precision highp float; uniform vec3 u0,u1,u2,u3,u4,u5,u6,u7; void main(){ vec3 c = gl_FragCoord.xyz; ${body} gl_FragColor = vec4(c,1.); } // ${tag}`;
    };
    const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }';
    const context = () => document.createElement('canvas').getContext('webgl2');
    const run = (gl, fs, blend = false) => {
      const sh = (t, s) => {
        const x = gl.createShader(t);
        gl.shaderSource(x, s);
        gl.compileShader(x);
        return x;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      const t0 = performance.now();
      gl.linkProgram(p);
      gl.getProgramParameter(p, gl.LINK_STATUS);
      const t1 = performance.now();
      gl.useProgram(p);
      if (!gl.__b) {
        gl.__b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.__b);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, -0.9, -1, -1, -0.9]),
          gl.STATIC_DRAW,
        );
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      }
      if (blend) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      const px = new Uint8Array(4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t2 = performance.now();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [t1 - t0, t2 - t1, performance.now() - t2].map(Math.round);
    };
    const A = context();
    const B = context();
    return {
      'A: trivial': run(A, 'precision highp float; void main(){ gl_FragColor = vec4(1.); }'),
      'A: 120 lines': run(A, heavy('a', 120)),
      'A: 120 lines, other source': run(A, heavy('b', 120)),
      'A: 120 lines, same source again (new program), blending on': run(A, heavy('a', 120), true),
      'A: 30 lines': run(A, heavy('c', 30)),
      'A: 10 lines': run(A, heavy('d', 10)),
      'B (second context): 120 lines, same source as A': run(B, heavy('a', 120)),
    };
  }),
);
await browser.close();
