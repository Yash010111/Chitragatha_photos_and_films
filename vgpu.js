// vgpu.js - Simple WebGPU (VGPU) holographic card animation
// This script creates a rotating "holographic card" effect on the canvas with id "vgpuCanvas".
// It uses native WebGPU API; no external dependencies.

(async () => {
  const canvas = document.getElementById('vgpuCanvas');
  if (!canvas) {
    console.warn('VGPU canvas not found');
    return;
  }

  if (!('gpu' in navigator)) {
    console.warn('WebGPU not supported in this browser');
    canvas.style.display = 'none';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.warn('Failed to get GPU adapter');
    canvas.style.display = 'none';
    return;
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'opaque',
  });

  // Vertex data for a full-screen quad
  const vertexData = new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
     1,  1, 1, 1,
  ]);
  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
  vertexBuffer.unmap();

  const shaderCode = `
  @group(0) @binding(0) var<uniform> u_params : vec2<f32>; // x = time, y = scroll

  struct VertexOutput {
    @builtin(position) Position : vec4<f32>,
    @location(0) uv : vec2<f32>,
  };

  @vertex
  fn vs(@location(0) pos : vec2<f32>, @location(1) uv : vec2<f32>) -> VertexOutput {
    var out : VertexOutput;
    out.Position = vec4<f32>(pos, 0.0, 1.0);
    out.uv = uv;
    return out;
  }

  @fragment
  fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    // Holographic effect influenced by time and scroll
    let t = u_params.x;
    let s = u_params.y;
    let color = vec3<f32>(
      0.5 + 0.5 * sin(t + in.uv.x * 10.0 + s * 5.0),
      0.5 + 0.5 * sin(t + in.uv.y * 10.0 + s * 5.0),
      0.8
    );
    let alpha = 0.6 + 0.4 * sin(t * 2.0);
    return vec4<f32>(color, alpha);
  }
  `;

  const shaderModule = device.createShaderModule({ code: shaderCode });

  const uniformBufferSize = 16; // vec2<f32>: time + scrollY (16-byte aligned)
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // Create pipeline first (auto layout resolves @group/@binding)
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs',
      buffers: [{
        arrayStride: 4 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position
          { shaderLocation: 1, offset: 2 * 4, format: 'float32x2' }, // uv
        ],
      }],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs',
      targets: [{ format: presentationFormat, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'zero' } } }],
    },
    primitive: { topology: 'triangle-strip', stripIndexFormat: 'uint32' },
  });
  // Create bind group using the pipeline's layout
  const uniformBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  let startTime = performance.now();
  let scrollY = 0;
  window.addEventListener('scroll', () => {
    scrollY = window.scrollY / window.innerHeight; // normalized
  });
  function frame() {
    const now = performance.now();
    const elapsed = (now - startTime) / 1000; // seconds
    // Update uniform buffer with time and scroll
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([elapsed, scrollY]));

    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(pipeline);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.setBindGroup(0, uniformBindGroup);
    renderPass.draw(4, 1, 0, 0);
    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
