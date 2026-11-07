// Diagnostic-only instrumentation. Never promote profile builds into vendor/runtime.
import { readFile, writeFile } from 'node:fs/promises';
export async function instrumentWebGPU(file) {
  let source = await readFile(file, 'utf8');
  source = source.replace(
    '    ggml_backend_webgpu_wait_queue(backend_ctx->webgpu_ctx->global_ctx);',
    `    WEBGPU_CPU_PROFILE_TOTAL_START(synchronize);
    ggml_backend_webgpu_wait_queue(backend_ctx->webgpu_ctx->global_ctx);
    WEBGPU_CPU_PROFILE_TOTAL_END(synchronize, backend_ctx->webgpu_ctx->global_ctx);`,
  );
  const marker = '    WEBGPU_CPU_PROFILE_TOTAL_END(graph_compute, ctx->global_ctx);';
  if (source.split(marker).length !== 2) throw Error('WebGPU profiler requires review');
  source = source.replace(
    marker,
    marker +
      `
    // Cumulative counters: take differences between request boundaries in the harness.
    std::cout << "GLOSSIDE_PROFILE {\\\"cpu\\\":{";
    bool comma = false;
    for (const auto & kv : ctx->global_ctx->cpu_time_ms) {
        if (comma) std::cout << ",";
        std::cout << "\\\"" << kv.first << "\\\":" << kv.second;
        comma = true;
    }
    std::cout << "},\\\"gpu\\\":{";
#ifdef GGML_WEBGPU_GPU_PROFILE
    comma = false;
    for (const auto & kv : ctx->shader_gpu_time_ms) {
        if (comma) std::cout << ",";
        std::cout << "\\\"" << kv.first << "\\\":" << kv.second;
        comma = true;
    }
#endif
    std::cout << "}}" << std::endl;
`,
  );
  await writeFile(file, source);
}
